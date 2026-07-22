// Recipe-based planner. A recipe is a real dish with fixed cook steps, but
// its ingredients carry a "role" (protein/carb/veg/fat) — so instead of
// scaling the whole recipe by one multiplier (which can only hit calories
// OR protein, not both, unless the recipe's fixed ratio happens to match),
// we scale the protein-role ingredients and the rest of the recipe by two
// independent factors, solved via the same 2-unknown linear system v1 used
// for raw ingredients. Non-scalable ingredients (fixed spices, a single
// egg) never move. This keeps "real recipe with steps" while restoring
// the macro precision a single scale factor couldn't hit — verified
// against real seed data: single-factor scaling was landing 15-25g/day
// under the protein floor by the back half of the week.

// recipeGeneration.js pulls in the Prisma client at load time (it persists
// AI-generated recipes). It is only ever reached from the AI-fallback path
// below (tryAiFallback), so require it LAZILY there instead of here - that
// keeps this module's pure solver logic (pickRecipe/solveDay/scaleRecipe and
// the same-day/variety rules) loadable and unit-testable without a generated
// Prisma client. No production behavior change: the require still happens the
// first time AI fallback actually fires.
const { recipeExcludedByStyle, matchesExclusionTerm, recipeExceedsKetoCeiling } = require("./dietaryFilter.js");
// Single source of truth for which mealCategory values are excluded from main
// "meal" slots. Shared with the classifier so the two can never drift.
const { NON_MEAL_CATEGORIES } = require("./recipeClassification.js");

// Does a just-generated recipe comply with the profile's diet/allergy rules?
// Stage-C fix (C3): the /swap AI fallback used to write its output straight
// into the plan with no dietary check — the one generation path that skipped
// the "pool membership = compliance" invariant. Re-check here before accepting.
function aiRecipeCompliant(recipe, profile) {
  const style = profile?.dietaryStyle || null;
  const excl = Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [];
  const flat = (recipe.ingredients || []).map((i) => ({ name: i.food?.name || i.name }));
  if (recipeExceedsKetoCeiling(recipe, style)) return false;
  if (recipeExcludedByStyle({ ingredients: flat }, style)) return false;
  if (excl.length && flat.some((ing) => excl.some((t) => matchesExclusionTerm(ing.name, t)))) return false;
  return true;
}

// Phase 4 spec bounds: portions scale 0.5×–2× — beyond that a "serving"
// stops resembling the dish (half a recipe is a light portion; double is a
// big plate; 2.5× was soup-pot territory).
const SCALE_BOUNDS = { min: 0.5, max: 2 };
// Phase 4 variety rule: never the same recipe 3+ times in a week unless the
// user explicitly allows batch-cooking repeats.
const DEFAULT_REPEAT_CAP = 2;
const BATCH_REPEAT_CAP = 4;
const DAYS = 7;
// A slot's scaled result missing the target by more than this is not a fit,
// full stop - matches the threshold resolveSlot() already warned at before
// this became a real reject/retry gate instead of just a label.
const KCAL_TOLERANCE_PCT = 0.15;
// Protein is the "load-bearing" macro (see this file's own header comment,
// and EngineTab.jsx's "protein + calories are load-bearing walls") - the
// accept/reject gate below previously checked kcal only, which shipped
// calorie-perfect, protein-short recipes. Deliberately ASYMMETRIC - only a
// SHORTFALL below target counts against a candidate (the daily target is
// the midpoint of a range, so "over" is inside the band by construction).
const PROTEIN_TOLERANCE_PCT = 0.12;
// Real pool is 600+ recipes deep - trying a handful of distinct candidates
// before giving up costs nothing (pickRecipe/scaleRecipe are cheap, sync).
const MAX_SLOT_ATTEMPTS = 5;
// Within-day carry-forward (solveDay below) redistributes the REMAINING day
// budget across not-yet-solved slots after each slot resolves, capped at
// CARRY_CAP_PCT of that slot's original target so one bad miss can't force
// the next slot into an unreasonable ask. (Monte Carlo, 500 trials, real
// pool, 2026-07-13: without it day-level kcal p95 ~79% off, worst 2.5-3×.)
const CARRY_CAP_PCT = 0.3;

function repeatCapFor(options) {
  if (Number.isInteger(options?.repeatCap)) return options.repeatCap;
  return options?.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;
}

function buildSlots(mealConfig) {
  const slots = [];
  for (let day = 0; day < DAYS; day++) {
    for (let i = 0; i < mealConfig.meals; i++) {
      const weight = mealConfig.meals === 1 ? 1 : i === mealConfig.meals - 1 ? 1.15 : i === 0 ? 0.9 : 1;
      slots.push({ dayOfWeek: day, slotType: "meal", slotIndex: i, weight });
    }
    for (let i = 0; i < mealConfig.snacks; i++) {
      slots.push({ dayOfWeek: day, slotType: "snack", slotIndex: i, weight: 0.4 });
    }
  }
  return slots;
}

function targetsForSlots(dailyTarget, slots) {
  const perDayWeight = slots.filter((s) => s.dayOfWeek === 0).reduce((s, x) => s + x.weight, 0);
  return slots.map((s) => {
    const share = s.weight / perDayWeight;
    return {
      ...s,
      kcalTarget: dailyTarget.kcal * share,
      proteinTarget: ((dailyTarget.proteinLo + dailyTarget.proteinHi) / 2) * share,
    };
  });
}

// roadmap/03-recipe-curation.md §2: dessert/beverage/bread-side/condiment
// recipes are excluded from ordinary "meal" slot eligibility. breakfast_only
// is deliberately NOT excluded (no time-of-day concept to route it with).
// NON_MEAL_CATEGORIES now lives in recipeClassification.js (imported above) so
// the classifier's notion of "not a main meal" and this filter stay in sync.

function eligibleRecipes(recipePool, slotType, usageCount, repeatCap) {
  const matchesType = (r) => r.slotType === slotType || r.slotType === "either";
  const isMealEligible = (r) => slotType !== "meal" || !NON_MEAL_CATEGORIES.has(r.mealCategory);
  return recipePool.filter((r) => matchesType(r) && isMealEligible(r) && (usageCount.get(r.id) || 0) < repeatCap);
}

// Weighted random, biased toward recipes whose protein-per-kcal ratio is
// close to the slot's target — good matches need less extreme scaling.
// usedToday gets a much heavier discount than usedYesterday: repeating the
// identical dish within the SAME day should only happen when nothing else
// is usable. Soft discount rather than a hard exclude on purpose - a thin
// post-filter pool should fall back to a repeat rather than an unsolved
// slot. `bias` (Phase 4) is an optional per-recipe multiplier carrying the
// user's soft preferences (cuisine / protein choice / budget) — it shapes
// probability, never eligibility (hard rules live in the pool filter).
// `priorUsage` (solver benchmark, 2026-07-21) is the cross-WEEK memory the
// planner never had: a Map<recipeId, recencyWeight> summarising what the
// user's previous plans already served. Weeks used to be independent draws, so
// by week 3 the same dishes reappeared even with a 600-recipe pool untouched —
// the exact "repetitive by week 3" failure mode that sinks Eat This Much
// (measured: median week-3 novelty 47.6%, week-4 35.7%). Like every other
// variety rule here it is a SOFT discount, never a veto: a thin compliant pool
// must still fill the week rather than leave slots empty.
function priorDiscount(priorUsage, id) {
  if (!priorUsage) return 1;
  const w = priorUsage.get(id) || 0;
  return w > 0 ? 1 / (1 + 2 * w) : 1;
}

function pickRecipe(candidates, targetRatio, usedYesterday, usedToday, rng, bias, priorUsage) {
  if (candidates.length === 0) return null;
  const weighted = candidates.map((r) => {
    const ratio = r.kcal > 0 ? r.protein / r.kcal : 0;
    const diff = Math.abs(ratio - targetRatio);
    const discount = usedToday.has(r.id) ? 0.02 : usedYesterday.has(r.id) ? 0.15 : 1;
    const pref = bias ? bias(r) : 1;
    return { r, weight: (1 / (diff + 0.015)) * discount * pref * priorDiscount(priorUsage, r.id) };
  });
  const total = weighted.reduce((s, x) => s + x.weight, 0);
  let roll = rng() * total;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.r;
  }
  return weighted[weighted.length - 1].r;
}

const clamp = (v, { min, max }) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
const round2 = (n) => Math.round(n * 100) / 100;

// Practical kitchen amounts: nobody weighs 217 g of potato — 5 g steps once
// past spice territory. Totals are recomputed from the rounded grams, so
// the shipped macros always match what's actually on the scale.
//
// The 1 g floor is a HONESTY rule, not a nicety (solver benchmark, 2026-07-21):
// plain Math.round() sent any sub-0.5 g amount to 0, and 4.3% of every
// ingredient the solver shipped came out at 0 g — a real ingredient (garlic
// clove, saffron, a pinch of yeast) silently vanishing from the plate AND from
// the grocery list while the recipe card still named it. An ingredient that is
// genuinely part of the dish is never rounded out of existence; it rounds to
// 1 g and stays visible. Only a truly zero/absent amount stays zero.
const practicalGrams = (raw) => {
  if (!(raw > 0)) return 0;
  if (raw >= 20) return Math.round(raw / 5) * 5;
  return Math.max(1, Math.round(raw));
};

function bundleMacros(ingredients) {
  return ingredients.reduce(
    (sum, ing) => {
      const factor = ing.baseGrams / 100;
      sum.kcal += ing.food.kcal * factor;
      sum.protein += ing.food.protein * factor;
      sum.fat += ing.food.fat * factor;
      sum.carb += ing.food.carb * factor;
      return sum;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

// recipe.ingredients must be loaded with `food` included.
function scaleRecipe(recipe, kcalTarget, proteinTarget) {
  const fixed = bundleMacros(recipe.ingredients.filter((i) => !i.scalable));
  const scalable = recipe.ingredients.filter((i) => i.scalable);
  const proteinIngs = scalable.filter((i) => i.role === "protein");
  const restIngs = scalable.filter((i) => i.role !== "protein");
  const proteinBundle = bundleMacros(proteinIngs);
  const restBundle = bundleMacros(restIngs);

  const remainingKcal = kcalTarget - fixed.kcal;
  const remainingProtein = proteinTarget - fixed.protein;
  const det = proteinBundle.protein * restBundle.kcal - restBundle.protein * proteinBundle.kcal;

  let proteinScale, sidesScale;
  if (proteinIngs.length === 0 || Math.abs(det) < 1e-6) {
    // no separable protein ingredient, or degenerate ratio — fall back to
    // a single uniform scale over everything scalable
    const raw = recipe.kcal > 0 ? kcalTarget / recipe.kcal : 1;
    proteinScale = sidesScale = clamp(raw, SCALE_BOUNDS);
  } else {
    proteinScale = clamp((remainingProtein * restBundle.kcal - restBundle.protein * remainingKcal) / det, SCALE_BOUNDS);
    sidesScale = clamp((proteinBundle.protein * remainingKcal - remainingProtein * proteinBundle.kcal) / det, SCALE_BOUNDS);
  }

  const resolvedIngredients = recipe.ingredients.map((ing) => {
    const scale = !ing.scalable ? 1 : ing.role === "protein" ? proteinScale : sidesScale;
    return {
      foodId: ing.foodId, name: ing.food.name, role: ing.role,
      grams: practicalGrams(ing.baseGrams * scale),
    };
  });

  const totals = resolvedIngredients.reduce(
    (sum, r) => {
      const food = recipe.ingredients.find((i) => i.foodId === r.foodId).food;
      const factor = r.grams / 100;
      sum.kcal += food.kcal * factor;
      sum.protein += food.protein * factor;
      sum.fat += food.fat * factor;
      sum.carb += food.carb * factor;
      return sum;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );

  return { proteinScale: round2(proteinScale), sidesScale: round2(sidesScale), ingredients: resolvedIngredients, ...totals };
}

function kcalOffPct(target, scaledKcal) {
  return target > 0 ? Math.abs(scaledKcal - target) / target : 0;
}

// Asymmetric by design (see PROTEIN_TOLERANCE_PCT comment) - only a
// shortfall counts. Delivering >= target is always 0 (no penalty).
function proteinShortfallPct(target, scaledProtein) {
  return target > 0 ? Math.max(0, (target - scaledProtein) / target) : 0;
}

function unsolvedResult(warning) {
  return { recipeId: null, proteinScale: 1, sidesScale: 1, ingredients: [], kcal: 0, protein: 0, fat: 0, carb: 0, warning };
}

// aiFallback: { enabled, callsRemaining: {n}, profile, existingRecipeNames } | null.
// callsRemaining is a boxed number so decrements are visible across every
// resolveSlot() call sharing the same object within one run - a real cap on
// live Claude calls per request, not per-slot.
async function tryAiFallback(target, recipePool, usageCount, aiFallback) {
  aiFallback.callsRemaining.n--;
  try {
    // Lazy require (see the top-of-file note): only load the Prisma-backed
    // generator when AI fallback actually runs, never at module load.
    const generateImpl = aiFallback.generateAndSaveSlotRecipeImpl || require("./recipeGeneration.js").generateAndSaveSlotRecipe;
    const generated = await generateImpl(target, aiFallback.profile, aiFallback.existingRecipeNames);
    // Never write a diet/allergy-violating AI recipe into the plan (C3). A
    // failed check yields an honest unsolved slot, same as any other miss.
    if (!aiRecipeCompliant(generated, aiFallback.profile)) return null;
    recipePool.push(generated); // available to later slots in this same run too
    aiFallback.existingRecipeNames.push(generated.name);
    const scaled = scaleRecipe(generated, target.kcalTarget, target.proteinTarget);
    usageCount.set(generated.id, 1);
    const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
    const proteinShort = proteinShortfallPct(target.proteinTarget, scaled.protein);
    const aiMisses = [];
    if (kcalOff > KCAL_TOLERANCE_PCT) aiMisses.push(`landed ${Math.round(scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} target`);
    if (proteinShort > PROTEIN_TOLERANCE_PCT) aiMisses.push(`delivered ${Math.round(scaled.protein)}g protein vs a ${Math.round(target.proteinTarget)}g target`);
    const warning = aiMisses.length ? `AI-generated recipe still missed tolerance — ${aiMisses.join("; ")}.` : null;
    return { recipeId: generated.id, warning, ...scaled };
  } catch (e) {
    // Live generation failed (network, refusal, allergy-filtered all 3
    // drafts) - fall through to an honest unsolved state rather than
    // crashing the whole run over one slot.
    return null;
  }
}

// Tries up to MAX_SLOT_ATTEMPTS distinct pool candidates, shipping the first
// one whose scale lands within tolerance on BOTH kcal and protein. Shipping
// the closest miss (labeled plainly, on both axes) only once every tried
// candidate failed; an honest unsolved slot only when nothing was eligible.
//
// VARIETY NEVER COSTS ACCURACY. When cross-week memory is in play the slot is
// resolved in two passes:
//   pass 1 — search with the freshness discount, evaluate the whole shortlist,
//            and among the candidates that FIT choose the least-recently-served
//            one (ties broken by the better fit). Freshness is spent only on
//            options that already hit the target.
//   pass 2 — nothing in pass 1 fit, so search again with the discount OFF: a
//            dish the user had last week comes back rather than shipping a
//            worse-fitting "fresh" one.
// Without memory the original behaviour is untouched, first-fit-wins and all.
// Measured on the benchmark grid: naive freshness-first cost ~150 of 5,040 weeks
// their clean 7/7 day count; fit-first alone cost thin-pool variety (keto week-3
// novelty 28.6% → 7.1%). This shape keeps both.
async function resolveSlot(target, recipePool, usageCount, usedYesterday, usedToday, rng, aiFallback = null, bias = null, repeatCap = DEFAULT_REPEAT_CAP, priorUsage = null) {
  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const tried = new Set();
  let best = null;

  const ship = (recipe, scaled) => {
    usageCount.set(recipe.id, (usageCount.get(recipe.id) || 0) + 1);
    return { recipeId: recipe.id, warning: null, ...scaled };
  };

  const passes = priorUsage && priorUsage.size > 0 ? [priorUsage, null] : [null];
  for (const passUsage of passes) {
    const fits = [];
    for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
      const candidates = eligibleRecipes(recipePool, target.slotType, usageCount, repeatCap).filter((r) => !tried.has(r.id));
      if (candidates.length === 0) break;
      const recipe = pickRecipe(candidates, targetRatio, usedYesterday, usedToday, rng, bias, passUsage);
      tried.add(recipe.id);
      const scaled = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
      const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
      const proteinShort = proteinShortfallPct(target.proteinTarget, scaled.protein);
      // Worse-of-the-two-tolerances score, expressed as a multiple of each
      // metric's own tolerance so the two different-scale percentages are
      // comparable.
      const worstRatio = Math.max(kcalOff / KCAL_TOLERANCE_PCT, proteinShort / PROTEIN_TOLERANCE_PCT);
      if (!best || worstRatio < best.worstRatio) best = { recipe, scaled, kcalOff, proteinShort, worstRatio };
      if (kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT) {
        // No cross-week memory → the original first-fit-wins path, unchanged.
        if (!passUsage) return ship(recipe, scaled);
        fits.push({ recipe, scaled, worstRatio, prior: passUsage.get(recipe.id) || 0 });
      }
    }
    if (fits.length) {
      fits.sort((a, b) => a.prior - b.prior || a.worstRatio - b.worstRatio);
      return ship(fits[0].recipe, fits[0].scaled);
    }
  }

  if (aiFallback?.enabled && aiFallback.callsRemaining.n > 0) {
    const aiResult = await tryAiFallback(target, recipePool, usageCount, aiFallback);
    if (aiResult) return aiResult;
  }

  if (best) {
    usageCount.set(best.recipe.id, (usageCount.get(best.recipe.id) || 0) + 1);
    const misses = [];
    if (best.kcalOff > KCAL_TOLERANCE_PCT) misses.push(`landed ${Math.round(best.scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} target`);
    if (best.proteinShort > PROTEIN_TOLERANCE_PCT) misses.push(`delivered ${Math.round(best.scaled.protein)}g protein vs a ${Math.round(target.proteinTarget)}g target`);
    return {
      recipeId: best.recipe.id,
      warning: `Tried ${tried.size} recipe(s) for this slot, none fit within tolerance — closest was "${best.recipe.name}" (${misses.join("; ")}).`,
      ...best.scaled,
    };
  }

  return unsolvedResult(`No eligible ${target.slotType} recipe left for this slot.`);
}

function toSlotRecord(target, result) {
  return {
    dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex,
    recipeId: result.recipeId, proteinScale: result.proteinScale, sidesScale: result.sidesScale,
    ingredients: result.ingredients, locked: false,
    kcal: result.kcal, protein: result.protein, fat: result.fat, carb: result.carb,
    warning: result.warning,
  };
}

// Builds the shared aiFallback context object resolveSlot() reads, or null
// when the caller didn't opt in.
function buildAiFallbackContext(options, recipePool) {
  if (!options?.aiFallback?.enabled) return null;
  return {
    enabled: true,
    callsRemaining: { n: options.aiFallback.maxCalls ?? 5 },
    profile: options.aiFallback.profile,
    existingRecipeNames: recipePool.map((r) => r.name),
    // Test-only override (see recipeGeneration.test.js) — real callers never set this.
    generateAndSaveSlotRecipeImpl: options.aiFallback.generateAndSaveSlotRecipeImpl,
  };
}

/**
 * Solve ONE day's slots with within-day carry-forward. Extracted from the
 * week loop so Phase 4's day-candidate generation can run a single day
 * repeatedly (different rng) without touching week state. Mutates
 * usageCount (per-week repeat tracking) — pass a copy if you don't want that.
 */
async function solveDay(dayTargets, dailyTarget, recipePool, usageCount, prevDayRecipeIds, rng, aiCtx, bias, repeatCap, priorUsage = null) {
  const proteinTargetMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  const todayIds = new Set();
  const results = [];
  let dayAchievedKcal = 0;
  let dayAchievedProtein = 0;
  for (let i = 0; i < dayTargets.length; i++) {
    const target = dayTargets[i];
    // Redistribute what's left of the day's budget across this slot and
    // whatever's still unsolved today, weighted the same way the original
    // fixed shares were - then solve against THAT, not the fixed share.
    const remainingWeight = dayTargets.slice(i).reduce((s, x) => s + x.weight, 0);
    const share = remainingWeight > 0 ? target.weight / remainingWeight : 1;
    const proposedKcal = (dailyTarget.kcal - dayAchievedKcal) * share;
    const proposedProtein = (proteinTargetMid - dayAchievedProtein) * share;
    const effectiveTarget = {
      ...target,
      kcalTarget: clamp(proposedKcal, { min: target.kcalTarget * (1 - CARRY_CAP_PCT), max: target.kcalTarget * (1 + CARRY_CAP_PCT) }),
      proteinTarget: clamp(proposedProtein, { min: target.proteinTarget * (1 - CARRY_CAP_PCT), max: target.proteinTarget * (1 + CARRY_CAP_PCT) }),
    };

    const result = await resolveSlot(effectiveTarget, recipePool, usageCount, prevDayRecipeIds, todayIds, rng, aiCtx, bias, repeatCap, priorUsage);
    if (result.recipeId) todayIds.add(result.recipeId);
    results.push(toSlotRecord(target, result));
    // Carry forward the TRUE achieved amount, not the (possibly clamped)
    // target that was solved for - an unresolved slot (kcal:0) correctly
    // pushes its whole share onto the rest of the day.
    dayAchievedKcal += result.kcal;
    dayAchievedProtein += result.protein;
  }
  return { slots: results, todayIds };
}

// Fisher-Yates using the caller's rng (deterministic when rng is seeded).
function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// recipePool: recipes with `ingredients` (each including `food`) loaded.
async function generateWeekPlan(dailyTarget, mealConfig, recipePool, options = {}) {
  const { rng = Math.random, aiFallback, bias = null, priorUsage = null } = options;
  const repeatCap = repeatCapFor(options);
  const slots = targetsForSlots(dailyTarget, buildSlots(mealConfig));
  const usageCount = new Map();
  const byDay = new Map();
  slots.forEach((s) => byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]));
  const aiCtx = buildAiFallbackContext({ aiFallback }, recipePool);

  // Stage-C fix (L4): solve days in a RANDOMIZED order, not a fixed 0..6.
  // Days share one variety-usage map, so with a fixed order the last calendar
  // days always drew from the most-depleted pool and drifted over target
  // (live: only 4/7 days within 10%, day 6 at +24%). Randomizing which day
  // gets the freshest pool spreads that pressure evenly, and best-of-N week
  // selection then has genuinely different distributions to choose from.
  // Results are stored back at each day's real calendar index.
  const resolvedByDay = new Map();
  let prevDayRecipeIds = new Set();
  for (const day of shuffled([...Array(DAYS).keys()], rng)) {
    const { slots: daySlots, todayIds } = await solveDay(
      byDay.get(day) || [], dailyTarget, recipePool, usageCount, prevDayRecipeIds, rng, aiCtx, bias, repeatCap, priorUsage
    );
    resolvedByDay.set(day, daySlots);
    prevDayRecipeIds = todayIds;
  }
  const resolved = [];
  for (let day = 0; day < DAYS; day++) resolved.push(...(resolvedByDay.get(day) || []));
  return resolved;
}

async function regenerateOneSlot(existingSlots, target, recipePool, dailyTarget, mealConfig, options = {}) {
  const { rng = Math.random, aiFallback, bias = null, priorUsage = null } = options;
  const repeatCap = repeatCapFor(options);
  const targeted = targetsForSlots(dailyTarget, buildSlots(mealConfig))
    .find((s) => s.dayOfWeek === target.dayOfWeek && s.slotType === target.slotType && s.slotIndex === target.slotIndex);
  if (!targeted) throw new Error("slot not found in current meal config");

  const usageCount = new Map();
  for (const s of existingSlots) {
    if (s.recipeId && !(s.dayOfWeek === target.dayOfWeek && s.slotType === target.slotType && s.slotIndex === target.slotIndex)) {
      usageCount.set(s.recipeId, (usageCount.get(s.recipeId) || 0) + 1);
    }
  }
  const prevDay = target.dayOfWeek - 1;
  const usedYesterday = new Set(existingSlots.filter((s) => s.dayOfWeek === prevDay && s.recipeId).map((s) => s.recipeId));
  // Same-day slots other than the one being regenerated - so swapping meal 2
  // doesn't reintroduce whatever meal 1 or 3 already served today.
  const usedToday = new Set(
    existingSlots
      .filter((s) => s.dayOfWeek === target.dayOfWeek && s.recipeId && !(s.slotType === target.slotType && s.slotIndex === target.slotIndex))
      .map((s) => s.recipeId)
  );
  const aiCtx = buildAiFallbackContext({ aiFallback }, recipePool);

  const result = await resolveSlot(targeted, recipePool, usageCount, usedYesterday, usedToday, rng, aiCtx, bias, repeatCap, priorUsage);
  return toSlotRecord(targeted, result);
}

/**
 * Build the cross-week variety memory from the user's PREVIOUS plans.
 *
 * `priorPlans` is newest-first: [{ slots: [{recipeId}] }, …]. Each plan's
 * servings are weighted by how recent it is (last week counts fully, the week
 * before less, and so on) and summed per recipe. The result feeds
 * pickRecipe()'s soft discount, so a dish served last week has to be a clearly
 * better fit than a fresh one to come back. Pure — no DB, no clock.
 */
const RECENCY_WEIGHTS = [1, 0.6, 0.35];

function buildPriorUsage(priorPlans, weights = RECENCY_WEIGHTS) {
  const usage = new Map();
  (priorPlans || []).forEach((plan, i) => {
    const w = weights[i] ?? 0;
    if (w <= 0) return;
    for (const slot of plan?.slots || []) {
      if (!slot?.recipeId) continue;
      usage.set(slot.recipeId, (usage.get(slot.recipeId) || 0) + w);
    }
  });
  return usage;
}

// A representative single-slot target for a given slot type — used by
// recipe generation, which needs a ballpark macro target before any
// specific day/slot exists yet. Reuses the same weighting as buildSlots.
function estimateSlotTarget(dailyTarget, mealConfig, slotType) {
  const oneDay = buildSlots({ meals: mealConfig.meals, snacks: mealConfig.snacks }).filter((s) => s.dayOfWeek === 0);
  const totalWeight = oneDay.reduce((s, x) => s + x.weight, 0);
  const matching = oneDay.filter((s) => s.slotType === slotType);
  const weight = matching.length ? matching.reduce((s, x) => s + x.weight, 0) / matching.length : slotType === "snack" ? 0.4 : 1;
  const share = weight / totalWeight;
  return {
    kcalTarget: dailyTarget.kcal * share,
    proteinTarget: ((dailyTarget.proteinLo + dailyTarget.proteinHi) / 2) * share,
  };
}

module.exports = {
  generateWeekPlan, regenerateOneSlot, buildSlots, targetsForSlots, solveDay,
  resolveSlot, scaleRecipe, buildAiFallbackContext, estimateSlotTarget,
  eligibleRecipes, buildPriorUsage, practicalGrams, RECENCY_WEIGHTS,
  SCALE_BOUNDS, DEFAULT_REPEAT_CAP, BATCH_REPEAT_CAP,
  KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT,
  // Back-compat alias for older call sites/tests: the default weekly repeat cap.
  MAX_REPEATS_PER_WEEK: DEFAULT_REPEAT_CAP,
};
