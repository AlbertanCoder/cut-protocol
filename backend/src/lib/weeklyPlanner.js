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

const { generateAndSaveSlotRecipe } = require("./recipeGeneration.js");

const SCALE_BOUNDS = { min: 0.4, max: 2.5 };
// With only ~24 curated recipes, a low repeat cap exhausts the best-match
// recipes partway through the week. 3 gives enough headroom while still
// keeping variety (not the same recipe every day).
const MAX_REPEATS_PER_WEEK = 3;
const DAYS = 7;
// A slot's scaled result missing the target by more than this is not a fit,
// full stop - matches the threshold resolveSlot() already warned at before
// this became a real reject/retry gate instead of just a label.
const KCAL_TOLERANCE_PCT = 0.15;
// Protein is the "load-bearing" macro (see this file's own header comment,
// and EngineTab.jsx's "protein + calories are load-bearing walls") - the
// accept/reject gate below previously checked kcal only, which shipped
// calorie-perfect, protein-short recipes (desserts/sides with no separable
// protein-role ingredient landing exactly on kcal via a single uniform
// scale). Tighter than KCAL_TOLERANCE_PCT because protein is the metric this
// module's two-factor solver exists specifically to protect. Deliberately
// ASYMMETRIC - only a SHORTFALL below target counts against a candidate;
// delivering more protein than the slot's target is never penalized (the
// daily target itself is the midpoint of a proteinLo-proteinHi range, so
// "over" is inside the acceptable band by construction). Per PABLO_REVIEW.md
// §2.6 - the kcal-only gate shipped calories within 5% on every day of a
// real-pool re-run while protein landed 10-32% short on 6/7 days.
const PROTEIN_TOLERANCE_PCT = 0.12;
// Real pool is 628 recipes deep - trying a handful of distinct candidates
// before giving up costs nothing (pickRecipe/scaleRecipe are cheap, sync)
// and is exactly what "reject and retry" per the AUDIT.md fix means.
const MAX_SLOT_ATTEMPTS = 5;
// Each slot solves independently against a fixed share of the day's target
// (a recipe's fixed macro ratio only gets clamped-scaled, per SCALE_BOUNDS,
// toward it) - with no correction, several slots landing off in the same
// direction lets a whole day run away from target with nothing to catch it.
// Confirmed via Monte Carlo (500 trials, real recipe pool, 2026-07-13):
// day-level kcal deviation p95 ~79%, worst observed days 2.5-3x over target.
// Fix: within-day carry-forward (generateWeekPlan below) redistributes the
// REMAINING day budget across not-yet-solved slots after each slot resolves,
// capped at CARRY_CAP_PCT of that slot's original target so one bad miss
// can't force the next slot into an unreasonable ask.
const CARRY_CAP_PCT = 0.3;

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
// recipes are excluded from ordinary "meal" slot eligibility - this is how
// Flan, Postre Chajá, and Yorkshire Puddings ended up scaled to a 400-600
// kcal lunch/dinner target in the first place (AUDIT.md §3, PABLO_REVIEW.md
// §2.6). breakfast_only is deliberately NOT excluded here (see the roadmap
// doc §1.5) - the solver has no time-of-day concept, so excluding it would
// just shrink the pool with no corresponding "only for breakfast slots"
// mechanism; those recipes are tagged for future use, not filtered today.
const NON_MEAL_CATEGORIES = new Set(["dessert", "beverage", "bread_or_pastry_side", "condiment_or_sauce"]);

function eligibleRecipes(recipePool, slotType, usageCount) {
  const matchesType = (r) => r.slotType === slotType || r.slotType === "either";
  const isMealEligible = (r) => slotType !== "meal" || !NON_MEAL_CATEGORIES.has(r.mealCategory);
  return recipePool.filter((r) => matchesType(r) && isMealEligible(r) && (usageCount.get(r.id) || 0) < MAX_REPEATS_PER_WEEK);
}

// Weighted random, biased toward recipes whose protein-per-kcal ratio is
// close to the slot's target — good matches need less extreme scaling.
// usedToday gets a much heavier discount than usedYesterday: repeating the
// identical dish within the SAME day (AUDIT.md §3's "feijoada served for
// both meal 1 and meal 2 Saturday" finding) is a more noticeable, more
// avoidable repeat than a day-to-day one, and should only ever be picked
// when genuinely nothing else in the eligible pool is usable. Soft discount
// rather than a hard exclude on purpose - a thin post-filter pool (heavy
// dietary exclusions, small slotType-specific pool) should still be able to
// fall back to a repeat rather than produce an unsolved slot.
function pickRecipe(candidates, targetRatio, usedYesterday, usedToday, rng) {
  if (candidates.length === 0) return null;
  const weighted = candidates.map((r) => {
    const ratio = r.kcal > 0 ? r.protein / r.kcal : 0;
    const diff = Math.abs(ratio - targetRatio);
    const discount = usedToday.has(r.id) ? 0.02 : usedYesterday.has(r.id) ? 0.15 : 1;
    return { r, weight: (1 / (diff + 0.015)) * discount };
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
      grams: Math.round(ing.baseGrams * scale),
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
// callsRemaining is a boxed number (not a plain int) so decrements are
// visible across every resolveSlot() call sharing the same object within
// one generateWeekPlan()/regenerateOneSlot() run - a real cap on live Claude
// calls per request, not per-slot (a week can have ~28 slots; each call is
// a real claude-opus-4-8 request, not free or instant).
async function tryAiFallback(target, recipePool, usageCount, aiFallback) {
  aiFallback.callsRemaining.n--;
  try {
    const generateImpl = aiFallback.generateAndSaveSlotRecipeImpl || generateAndSaveSlotRecipe;
    const generated = await generateImpl(target, aiFallback.profile, aiFallback.existingRecipeNames);
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
    // crashing the whole week's generation over one slot.
    return null;
  }
}

// Tries up to MAX_SLOT_ATTEMPTS distinct pool candidates, shipping the first
// one whose scale lands within KCAL_TOLERANCE_PCT of the slot's target. Per
// AUDIT.md §3/§10: shipping the very first (weighted-random) candidate with
// only a warning label is how a slot ends up 150-234% of its target with the
// real recipe pool. Rejecting a bad fit and trying the next-best candidate
// (falling back to AI generation, then an honest unsolved slot, only once
// every tried candidate misses) is the actual fix.
async function resolveSlot(target, recipePool, usageCount, usedYesterday, usedToday, rng, aiFallback = null) {
  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const tried = new Set();
  let best = null;

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    const candidates = eligibleRecipes(recipePool, target.slotType, usageCount).filter((r) => !tried.has(r.id));
    if (candidates.length === 0) break;
    const recipe = pickRecipe(candidates, targetRatio, usedYesterday, usedToday, rng);
    tried.add(recipe.id);
    const scaled = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
    const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
    const proteinShort = proteinShortfallPct(target.proteinTarget, scaled.protein);
    // Worse-of-the-two-tolerances score, expressed as a multiple of each
    // metric's own tolerance so the two different-scale percentages are
    // comparable. Reduces to kcal-only comparison when protein already
    // fits (proteinShort/PROTEIN_TOLERANCE_PCT <= 1 <= the kcal ratio in
    // any case where kcal itself is still missing).
    const worstRatio = Math.max(kcalOff / KCAL_TOLERANCE_PCT, proteinShort / PROTEIN_TOLERANCE_PCT);
    if (!best || worstRatio < best.worstRatio) best = { recipe, scaled, kcalOff, proteinShort, worstRatio };
    if (kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT) {
      usageCount.set(recipe.id, (usageCount.get(recipe.id) || 0) + 1);
      return { recipeId: recipe.id, warning: null, ...scaled };
    }
  }

  if (aiFallback?.enabled && aiFallback.callsRemaining.n > 0) {
    const aiResult = await tryAiFallback(target, recipePool, usageCount, aiFallback);
    if (aiResult) return aiResult;
  }

  if (best) {
    // Every pool candidate we tried missed tolerance (on kcal and/or
    // protein) and AI wasn't available (or failed). Ship the closest one we
    // found rather than declaring the slot unsolved outright - it's a real
    // recipe someone could eat, just imperfectly scaled - but say so
    // plainly, on BOTH axes (C7). Previously this warning only ever
    // mentioned kcal, so a protein-short "best effort" slot shipped with no
    // indication protein was the actual problem (PABLO_REVIEW.md §2.6).
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
// when the caller didn't opt in. options.aiFallback: { enabled, maxCalls,
// profile } - profile carries cuisinePreferences/mealPreferencesNote.
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

// recipePool: recipes with `ingredients` (each including `food`) loaded.
async function generateWeekPlan(dailyTarget, mealConfig, recipePool, { rng = Math.random, aiFallback } = {}) {
  const slots = targetsForSlots(dailyTarget, buildSlots(mealConfig));
  const usageCount = new Map();
  const byDay = new Map();
  slots.forEach((s) => byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]));
  const aiCtx = buildAiFallbackContext({ aiFallback }, recipePool);
  const proteinTargetMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;

  const resolved = [];
  let prevDayRecipeIds = new Set();
  for (let day = 0; day < DAYS; day++) {
    const todayIds = new Set();
    const todaySlots = byDay.get(day) || [];
    let dayAchievedKcal = 0;
    let dayAchievedProtein = 0;
    for (let i = 0; i < todaySlots.length; i++) {
      const target = todaySlots[i];
      // Redistribute what's left of the day's budget across this slot and
      // whatever's still unsolved today, weighted the same way the original
      // fixed shares were - then solve against THAT, not the fixed share.
      const remainingWeight = todaySlots.slice(i).reduce((s, x) => s + x.weight, 0);
      const share = remainingWeight > 0 ? target.weight / remainingWeight : 1;
      const proposedKcal = (dailyTarget.kcal - dayAchievedKcal) * share;
      const proposedProtein = (proteinTargetMid - dayAchievedProtein) * share;
      const effectiveTarget = {
        ...target,
        kcalTarget: clamp(proposedKcal, { min: target.kcalTarget * (1 - CARRY_CAP_PCT), max: target.kcalTarget * (1 + CARRY_CAP_PCT) }),
        proteinTarget: clamp(proposedProtein, { min: target.proteinTarget * (1 - CARRY_CAP_PCT), max: target.proteinTarget * (1 + CARRY_CAP_PCT) }),
      };

      // todayIds reflects every slot resolved so far THIS day (built up as
      // the loop progresses, below) - passing it into resolveSlot() lets
      // pickRecipe() heavily discount a recipe already served earlier today
      // (AUDIT.md §3's same-day-repeat finding), not just yesterday's picks.
      const result = await resolveSlot(effectiveTarget, recipePool, usageCount, prevDayRecipeIds, todayIds, rng, aiCtx);
      if (result.recipeId) todayIds.add(result.recipeId);
      resolved.push(toSlotRecord(target, result));
      // Carry forward the TRUE achieved amount, not the (possibly clamped)
      // target that was solved for - an unresolved slot (kcal:0) correctly
      // pushes its whole share onto the rest of the day.
      dayAchievedKcal += result.kcal;
      dayAchievedProtein += result.protein;
    }
    prevDayRecipeIds = todayIds;
  }
  return resolved;
}

async function regenerateOneSlot(existingSlots, target, recipePool, dailyTarget, mealConfig, { rng = Math.random, aiFallback } = {}) {
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

  const result = await resolveSlot(targeted, recipePool, usageCount, usedYesterday, usedToday, rng, aiCtx);
  return toSlotRecord(targeted, result);
}

// A representative single-slot target for a given slot type — used by
// recipe generation (Phase C), which needs a ballpark macro target before
// any specific day/slot exists yet. Reuses the same weighting as buildSlots.
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

module.exports = { generateWeekPlan, regenerateOneSlot, buildSlots, estimateSlotTarget, MAX_REPEATS_PER_WEEK };
