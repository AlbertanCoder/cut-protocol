// Stage 4 — THE LIBRARY→BRAIN ROUTER.
//
// One question, asked per meal slot: can something we ALREADY HAVE fill this?
// If yes, it is free and instant and no model is involved. Only when the answer
// is genuinely no does a model get asked to design something — and what comes
// back is treated as a PROPOSAL that the deterministic engine then re-checks,
// re-portions and either accepts or throws away. Anything accepted is saved to
// the library, so the same gap is never paid for twice.
//
// THE ORDER IS THE ARCHITECTURE:
//   1 POOL      planContext.filterRecipePool — the real safety boundary, not a
//               fork of it. Everything downstream is screened by this one
//               function, including AI output.
//   2 CACHE     the fingerprint index over previously-generated recipes. 0 calls.
//   3 LIBRARY   full scan of the filtered pool for a recipe the deterministic
//               scaler can land on target. 0 calls.
//   4 BRAIN     only now, and only through aiRecipeClient.generateRecipeDrafts,
//               which goes through brain/governance.js's governedModelCall —
//               the ONE door with the gate, the caps, the ledger, the guards and
//               the timeout. This module never touches a model transport itself.
//   5 VERIFY    every returned recipe is re-checked IN CODE: resolved names,
//               the pool filter (metadata probes and all), the placeholder
//               audit, and the macro math. Fail = discarded, never shown, never
//               stored. Retry the next draft, then the next tier, then degrade.
//   6 CACHE IT  a recipe that passes is persisted as an ordinary library row and
//               indexed by the fingerprint that produced it.
//   7 DEGRADE   a cap breach, a switched-off brain or a total failure returns
//               the deterministic CLOSEST FIT with honest copy. Never an error,
//               never a crash, never a silent target miss.
//
// LAWS THIS FILE IS BOUND BY:
//   • The deterministic engine owns ALL numbers. The model proposes ingredients
//     and grams; scaleRecipe() decides the portion that ships and the tolerance
//     check decides whether it may ship at all. No number in the response comes
//     from the model's own arithmetic.
//   • Allergy exclusions are zero-tolerance and FAIL CLOSED. Every uncertainty
//     below resolves to "reject", including "I could not load the Food rows I
//     need in order to check".
//   • BRAIN=off must be byte-identical. With the gate off this module never
//     generates: it answers from the library or degrades honestly, and the
//     deterministic paths it uses are the solver's own.
const { filterRecipePool } = require("./planContext.js");
const {
  eligibleRecipes, scaleRecipe, enforceScaledCarbCeiling,
  KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT,
} = require("./weeklyPlanner.js");
const { resolveIngredient } = require("./ingredientResolver.js");
const { generateRecipeDrafts, DRAFT_MAX_TOKENS } = require("./aiRecipeClient.js");
const {
  resolveDraftIngredients, persistRecipe, resolvedDraftViolation, placeholderRefusalReason,
  defaultLoadFoods,
} = require("./recipeGeneration.js");
const { MODELS } = require("./brain/config.js");
const { estimateUsd } = require("./brain/pricing.js");
const { defaultBudget } = require("./brain/userBudget.js");
const { slotFingerprint, defaultSlotCache } = require("./brain/slotCache.js");
const { clampProposedTier } = require("./brain/taste.js");

// ── the model ladder ───────────────────────────────────────────────────────
// Cheapest CAPABLE first. The classifier tier (haiku) is deliberately absent:
// this task is an 8k-token schema-constrained structured generation, and a tier
// that fails it does not save money — it spends a call AND then spends the
// escalation anyway. The ladder is data, not a decision baked into control flow;
// re-order it here if measurement says otherwise (and measure before you do).
const MODEL_LADDER = [MODELS.workhorse, MODELS.escalation];

// Governance codes that mean the transport was NEVER reached (no spend), and
// which are TERMINAL — a more expensive model cannot fix a switched-off feature,
// a refused input, or an exhausted cap, and trying is the exact behaviour a cap
// exists to prevent.
const PRE_CALL_REFUSALS = new Set(["llm-disabled", "input-refused", "cost-cap"]);
// Failures a better model plausibly fixes. Everything else stops the ladder:
// a leak (output-guard) and a timeout both get WORSE with a bigger model.
const ESCALATABLE = new Set(["no-usable-draft", "verification-failed", "llm-error"]);

// ── fit: the deterministic accept gate ─────────────────────────────────────
// The tolerance CONSTANTS are imported from weeklyPlanner so the router and the
// solver can never disagree about what "on target" means. The two one-line
// percentage formulas below are copied from weeklyPlanner's kcalOffPct /
// proteinShortfallPct, which that module does not export — kept character-for-
// character identical on purpose. If you change one, change both.
// (Protein is asymmetric by design: only a SHORTFALL counts against a recipe.)
function fitFor(recipe, target) {
  const raw = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
  // Post-scale keto ceiling — a dish that is legal at 1× can breach it at the
  // portion the solver actually ships. null = unrepairable, reject outright.
  const scaled = enforceScaledCarbCeiling(recipe, raw, recipe.dietGuardStyle);
  if (!scaled) return { ok: false, scaled: null, kcalOff: Infinity, proteinShort: Infinity, score: Infinity, reason: "breaches the diet's carb ceiling at every servable portion" };
  const kcalOff = target.kcalTarget > 0 ? Math.abs(scaled.kcal - target.kcalTarget) / target.kcalTarget : 0;
  const proteinShort = target.proteinTarget > 0 ? Math.max(0, (target.proteinTarget - scaled.protein) / target.proteinTarget) : 0;
  const ok = kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT;
  return {
    ok, scaled, kcalOff, proteinShort,
    // Protein is the load-bearing macro, so a shortfall costs double when
    // RANKING closest-fit candidates. Ranking only — the accept gate above is
    // the solver's, unweighted.
    score: kcalOff + 2 * proteinShort,
    reason: ok ? null : missLine(target, scaled, kcalOff, proteinShort),
  };
}

function missLine(target, scaled, kcalOff, proteinShort) {
  const parts = [];
  if (kcalOff > KCAL_TOLERANCE_PCT) parts.push(`lands ${Math.round(scaled.kcal)} kcal against a ${Math.round(target.kcalTarget)} target`);
  if (proteinShort > PROTEIN_TOLERANCE_PCT) parts.push(`delivers ${Math.round(scaled.protein)}g protein against a ${Math.round(target.proteinTarget)}g target`);
  return parts.join(" and ") || "misses the slot target";
}

// Best candidate by fit score. Returns null when nothing can even be scaled.
function bestCandidate(candidates, target) {
  let best = null;
  for (const r of candidates) {
    const fit = fitFor(r, target);
    if (!fit.scaled) continue;
    if (!best || fit.score < best.fit.score) best = { recipe: r, fit };
  }
  return best;
}

// ── the metric that IS the economic argument ───────────────────────────────
// Counters, not estimates. `cacheHitRate` deliberately returns null rather than
// 0 when there is no data: a fabricated 0% is a claim, and an empty denominator
// is not evidence of anything.
function makeRouterStats() {
  return {
    requests: 0,
    libraryHits: 0, // served by a curated/imported library recipe
    cacheHits: 0, // served by a recipe a PREVIOUS request paid to generate
    generations: 0, // a model designed a recipe that passed verification
    discarded: 0, // AI recipes that failed verification and were thrown away
    degraded: 0, // closest-fit fallbacks (cap, brain off, or nothing fit)
    unsolved: 0, // not even a closest fit existed
    modelCalls: 0, // calls that actually reached the transport
  };
}

// Of the requests the curated library could NOT serve, the share answered for
// free by something already generated. That ratio is the whole case for caching:
// it starts at 0 and climbs as the library learns the user's constraint space.
function cacheHitRate(stats) {
  const gaps = stats.cacheHits + stats.generations;
  return gaps > 0 ? stats.cacheHits / gaps : null;
}
// Share of ALL requests that cost nothing.
function freeRate(stats) {
  return stats.requests > 0 ? (stats.libraryHits + stats.cacheHits) / stats.requests : null;
}

const _stats = makeRouterStats();
function routerStats() {
  return { ...structuredClone(_stats), cacheHitRate: cacheHitRate(_stats), freeRate: freeRate(_stats) };
}
function resetRouterStats() {
  for (const k of Object.keys(_stats)) _stats[k] = 0;
}

// ── verification: the model proposed, the code decides ─────────────────────
/**
 * verifyDraft(draft, ctx) -> { ok:true, resolved, row, fit } | { ok:false, reason }
 *
 * Four independent screens, every one of which can only REJECT:
 *   1 post-resolution name check (recipeGeneration.resolvedDraftViolation) —
 *     the model's own ingredient names were already screened in aiRecipeClient,
 *     but resolution can land on a differently-named Food row, so the same
 *     filter has to run again on what the recipe will ACTUALLY contain. Without
 *     this, ingredient resolution is an allergen-erasure path.
 *   2 the REAL pool filter (planContext.filterRecipePool) over a row shaped
 *     exactly like a persisted Recipe, carrying the full Food rows. This is the
 *     screen the name check cannot do: it reads the persisted fdcCategory /
 *     allergenTags / mayContain metadata, so a food whose NAME is innocent and
 *     whose declared allergens are not still gets rejected.
 *   3 the placeholder audit — a recipe assembled from zero-macro rows would
 *     under-count, and the solver would then prefer it BECAUSE it looks small.
 *   4 the macro math — the deterministic scaler, at the solver's own tolerance.
 *
 * Fails closed everywhere, including on "I could not load the Food rows".
 */
async function verifyDraft(draft, { profile, target, rules, resolveIngredientImpl, loadFoodsImpl }) {
  // One fetch, two readers. resolveDraftIngredients needs the Food rows to
  // compute real macros; the pool-filter screen below needs the SAME rows to
  // read their allergen metadata. Memoised so verifying a draft is one query,
  // not two — and so both screens are guaranteed to look at identical data.
  let loaded = null;
  const load = async (ids) => { if (!loaded) loaded = await loadFoodsImpl(ids); return loaded; };

  const resolved = await resolveDraftIngredients(draft, resolveIngredientImpl, load);

  const violation = resolvedDraftViolation(resolved, rules);
  if (violation) return { ok: false, reason: `"${resolved.name}" contains ${violation} after ingredient resolution` };

  const placeholder = placeholderRefusalReason(resolved);
  if (placeholder) return { ok: false, reason: placeholder };

  const ids = [...new Set(resolved.ingredients.map((i) => i.foodId))];
  const foods = await load(ids);
  const byId = new Map((foods || []).map((f) => [f.id, f]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    // FAIL CLOSED: without the Food rows the metadata probes have nothing to
    // read, and a filter that cannot see its evidence must never return "safe".
    return { ok: false, reason: `"${resolved.name}" could not be safety-checked: ${missing.length} of its resolved foods could not be loaded` };
  }

  const candidateRow = {
    id: null,
    name: resolved.name,
    steps: resolved.steps || [],
    slotType: resolved.slotType || "meal",
    mealCategory: null,
    kcal: resolved.kcal, protein: resolved.protein, fat: resolved.fat, carb: resolved.carb,
    ingredients: resolved.ingredients.map((i) => ({
      foodId: i.foodId,
      baseGrams: i.grams,
      scalable: i.scalable !== false,
      role: i.role || null,
      food: byId.get(i.foodId),
    })),
  };

  const survivors = filterRecipePool([candidateRow], profile);
  if (survivors.length !== 1) {
    return { ok: false, reason: `"${resolved.name}" was rejected by the recipe pool filter after ingredient resolution — its resolved foods violate this profile's diet or exclusions` };
  }
  const row = survivors[0]; // carries dietGuardStyle for the post-scale ceiling

  const fit = fitFor(row, target);
  if (!fit.ok) return { ok: false, reason: `"${resolved.name}" ${fit.reason}` };

  return { ok: true, resolved, row, fit };
}

// ── the router ─────────────────────────────────────────────────────────────
/**
 * routeMealSlot(request, deps) -> outcome (never throws for an expected failure)
 *
 * request:
 *   target   { slotType, kcalTarget, proteinTarget }  (weeklyPlanner's shape)
 *   profile  the authoritative Profile row — dietaryStyle / excludedFoods are
 *            read from HERE and nowhere else (never from model output, LAW 2)
 *   recipePool  RAW Recipe rows with ingredients.food included; filtered here
 *   existingRecipeNames  passed to the drafter to reduce near-duplicates
 *   allowGeneration  false = library-only (the caller has already decided not
 *                    to spend); default true
 *
 * outcome:
 *   { ok, status, recipe, scaled, fingerprint, cached, modelCalls, attempts,
 *     notice, reason, stats }
 *   status: "cache-hit" | "library-hit" | "generated"   (ok:true)
 *         | "closest-fit" | "unsolved"                  (ok:false, degraded)
 *
 * deps are for tests and for the caller that wants its own budget/cache; real
 * callers pass nothing.
 */
async function routeMealSlot(request, deps = {}) {
  const {
    target, profile, recipePool = [], existingRecipeNames = [], allowGeneration = true,
  } = request;
  const {
    generateDraftsImpl = generateRecipeDrafts,
    resolveIngredientImpl = resolveIngredient,
    persistRecipeImpl = persistRecipe,
    loadFoodsImpl = defaultLoadFoods,
    cache = defaultSlotCache(),
    budget = defaultBudget({ userId: profile?.userId ?? null }),
    ladder = MODEL_LADDER,
    stats = _stats,
  } = deps;

  stats.requests++;

  // Exclusions come from the PROFILE, recomputed every time. Never cached,
  // never carried on a recipe, never taken from model output.
  const rules = {
    excludedFoods: Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [],
    dietaryStyle: profile?.dietaryStyle || null,
  };
  const cuisine = pickCuisine(profile);
  const fingerprint = slotFingerprint({
    slotType: target.slotType,
    kcalTarget: target.kcalTarget,
    proteinTarget: target.proteinTarget,
    dietaryStyle: rules.dietaryStyle,
    excludedFoods: rules.excludedFoods,
    cuisine,
  });

  // ── 1. THE POOL. The real builder, on the raw rows. ──────────────────────
  const pool = filterRecipePool(recipePool, profile || {});
  const slotType = target.slotType === "snack" ? "snack" : "meal";
  const eligible = eligibleRecipes(pool, slotType, new Map(), Infinity);
  const byId = new Map(eligible.map((r) => [r.id, r]));

  const attempts = [];
  const base = { fingerprint, attempts, modelCalls: 0 };

  // ── 2. THE CACHE. Previously-generated recipes, by constraint fingerprint. ─
  // Only ids that are STILL in the filtered pool can be served: an id that no
  // longer survives the filter (recipe deleted, exclusions changed) is evicted
  // here rather than trusted. The fit check runs again too — the fingerprint
  // buckets targets, so it decides where to look, never what ships.
  for (const id of cache.get(fingerprint)) {
    const row = byId.get(id);
    if (!row) { cache.forget(fingerprint, id); continue; }
    const fit = fitFor(row, target);
    if (!fit.ok) continue;
    stats.cacheHits++;
    return { ...base, ok: true, status: "cache-hit", recipe: row, scaled: fit.scaled, cached: true, via: "index", notice: null, reason: null, stats: snapshot(stats) };
  }

  // ── 3. THE LIBRARY. Full scan; free and instant. ─────────────────────────
  const libraryBest = bestCandidate(eligible, target);
  if (libraryBest && libraryBest.fit.ok) {
    // A previously-generated recipe found by scan rather than by index is still
    // a cache hit economically — someone already paid for it once.
    const wasGenerated = libraryBest.recipe.source === "ai-generated";
    if (wasGenerated) { stats.cacheHits++; cache.remember(fingerprint, libraryBest.recipe.id); }
    else stats.libraryHits++;
    return {
      ...base, ok: true, status: wasGenerated ? "cache-hit" : "library-hit",
      recipe: libraryBest.recipe, scaled: libraryBest.fit.scaled,
      cached: wasGenerated, via: "scan", notice: null, reason: null, stats: snapshot(stats),
    };
  }

  // ── A GENUINE GAP. ───────────────────────────────────────────────────────
  if (!allowGeneration) {
    return degrade({ base, stats, libraryBest, target, reason: "generation-not-requested", notice: "No library recipe hits this slot's target." });
  }

  let lastRefusal = null;
  for (const [tier, model] of ladder.entries()) {
    // ESCALATION REQUIRES A PRIOR FAILURE. Tier 0 always runs first; a tier
    // above it is only reached because the one below it was tried and failed in
    // a way a stronger model can plausibly fix.
    if (tier > 0) {
      const prior = attempts[attempts.length - 1];
      if (!prior || !ESCALATABLE.has(prior.outcome)) break;
    }

    // COST, PRE-CALL. Governance prechecks the same estimate again at the door;
    // this one exists so the router can DECIDE not to escalate rather than
    // discover the cap by being refused. Cheapest-first means an unaffordable
    // tier makes every tier above it unaffordable too — stop, don't shop.
    const projectedUsd = estimateUsd(model, { turns: 1, maxTokens: DRAFT_MAX_TOKENS });
    const gate = await budget.precheck(projectedUsd);
    if (!gate.allowed) {
      attempts.push({ model, tier, outcome: "cost-cap", reason: gate.reason, projectedUsd });
      lastRefusal = { code: "cost-cap", reason: gate.reason, message: gate.notice };
      break;
    }

    let out;
    try {
      out = await generateDraftsImpl(
        {
          slotType,
          cuisine,
          freeText: profile?.mealPreferencesNote || undefined,
          allowAllergens: false, // never negotiable on an unattended path
          targetKcal: target.kcalTarget,
          targetProtein: target.proteinTarget,
          existingRecipeNames,
          excludedFoods: rules.excludedFoods,
          dietaryStyle: rules.dietaryStyle,
          userId: profile?.userId ?? null,
        },
        { ledger: budget, model }
      );
    } catch (e) {
      const code = e && e.code ? e.code : "llm-error";
      const reachedTransport = !PRE_CALL_REFUSALS.has(code);
      if (reachedTransport) { stats.modelCalls++; base.modelCalls++; }
      attempts.push({ model, tier, outcome: code, reason: e && e.reason ? e.reason : null, message: e && e.message ? e.message : null });
      lastRefusal = { code, reason: e && e.reason ? e.reason : null, message: e && e.message ? e.message : String(e) };
      if (!ESCALATABLE.has(code)) break;
      continue;
    }

    stats.modelCalls++;
    base.modelCalls++;
    const drafts = Array.isArray(out?.drafts) ? out.drafts : [];
    if (!drafts.length) {
      attempts.push({ model, tier, outcome: "no-usable-draft", droppedForAllergies: out?.droppedForAllergies?.length ?? 0, droppedForShape: out?.droppedForShape?.length ?? 0 });
      lastRefusal = { code: "no-usable-draft", reason: "every draft was dropped before verification", message: null };
      continue;
    }

    // ── 5. VERIFY-THEN-GATE, per draft. ────────────────────────────────────
    const discardedReasons = [];
    for (const draft of drafts) {
      const verdict = await verifyDraft(draft, { profile: profile || {}, target, rules, resolveIngredientImpl, loadFoodsImpl });
      if (!verdict.ok) { discardedReasons.push(verdict.reason); stats.discarded++; continue; }

      // ── 6. CACHE FOREVER. Persist as an ordinary library row + index it. ──
      // tasteTier: the drafting schema carries no quality claim, so the row
      // gets taste.js's neutral prior, tagged "llm" so curated and user-derived
      // signals outrank it. Estimated, labelled as such, and never displayed.
      const saved = await persistRecipeImpl(verdict.resolved, {
        source: "ai-generated",
        tasteTier: clampProposedTier(draft.tasteTier),
        tasteTierSource: "llm",
      });
      if (saved && saved.id) cache.remember(fingerprint, saved.id);
      stats.generations++;
      attempts.push({ model, tier, outcome: "generated", discarded: discardedReasons.length });
      return {
        ...base, ok: true, status: "generated",
        recipe: saved && saved.id ? { ...verdict.row, id: saved.id, source: "ai-generated" } : verdict.row,
        scaled: verdict.fit.scaled,
        cached: false, via: "brain",
        provenance: { source: "ai-generated", verified: true, verifiedBy: ["post-resolution-names", "pool-filter", "placeholder-audit", "macro-math"], model, fingerprint },
        discarded: discardedReasons,
        notice: null, reason: null, stats: snapshot(stats),
      };
    }

    attempts.push({ model, tier, outcome: "verification-failed", discarded: discardedReasons.length, reasons: discardedReasons });
    lastRefusal = { code: "verification-failed", reason: "every generated recipe failed verification", message: discardedReasons.join(" ") };
  }

  // ── 7. DEGRADE. Honest, deterministic, never an error. ───────────────────
  return degrade({
    base, stats, libraryBest, target,
    reason: lastRefusal?.code || "no-generation-attempted",
    notice: degradeNotice(lastRefusal),
  });
}

// The honest copy. Every sentence here is either a real number the deterministic
// engine produced or a governance message written by the control that fired —
// nothing is invented, and nothing claims the slot was solved when it was not.
function degradeNotice(refusal) {
  if (!refusal) return "AI generation was not attempted.";
  if (refusal.code === "cost-cap") return refusal.message || "The AI budget for this period is used up.";
  if (refusal.code === "llm-disabled") return refusal.message || "AI recipe generation is switched off in this build.";
  if (refusal.code === "input-refused") return refusal.message || "That request could not be sent.";
  if (refusal.code === "llm-timeout") return "The AI request took too long and was cancelled. Nothing was saved.";
  if (refusal.code === "verification-failed") return `No AI recipe passed the safety and macro checks. ${refusal.message || ""}`.trim();
  if (refusal.code === "no-usable-draft") return "The AI returned nothing usable for this slot.";
  return refusal.message || "AI generation was unavailable for this slot.";
}

function degrade({ base, stats, libraryBest, target, reason, notice }) {
  if (libraryBest) {
    stats.degraded++;
    return {
      ...base, ok: false, status: "closest-fit",
      recipe: libraryBest.recipe, scaled: libraryBest.fit.scaled, cached: false, via: "closest-fit",
      notice: `${notice} Showing the closest deterministic fit, which ${libraryBest.fit.reason}.`,
      reason, stats: snapshot(stats),
    };
  }
  stats.unsolved++;
  return {
    ...base, ok: false, status: "unsolved", recipe: null, scaled: null, cached: false, via: null,
    notice: `${notice} No compliant recipe in the library can fill this slot.`,
    reason, stats: snapshot(stats),
  };
}

// A soft bias only — the user's cuisine preference shapes what is ASKED FOR,
// never what is allowed. Deterministic (first preference) rather than random:
// a random pick would change the constraint fingerprint between two identical
// requests and turn every cache hit into a coin flip.
function pickCuisine(profile) {
  const prefs = Array.isArray(profile?.cuisinePreferences) ? profile.cuisinePreferences.filter((c) => typeof c === "string" && c.trim()) : [];
  return prefs.length ? prefs[0] : undefined;
}

function snapshot(stats) {
  return { ...stats, cacheHitRate: cacheHitRate(stats), freeRate: freeRate(stats) };
}

module.exports = {
  routeMealSlot, verifyDraft, fitFor, bestCandidate,
  makeRouterStats, routerStats, resetRouterStats, cacheHitRate, freeRate,
  MODEL_LADDER, ESCALATABLE, PRE_CALL_REFUSALS,
};
