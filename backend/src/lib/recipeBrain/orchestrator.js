// Recipe Brain — the ORCHESTRATOR. One question, four channels, honest answers.
//
// solveRecipeForSlot() is the recipe brain's front door: given a spec (or the
// target to derive one), find — or make — ONE recipe that satisfies it, using
// the cheapest channel that can:
//
//   0 SPEC        what exactly does this gap need? (spec.js — derived, provenanced)
//   1 CACHE       a recipe a previous request already paid for, found by the
//                 durable fingerprint (Recipe.aiFingerprint) or the in-process
//                 index. 0 calls, 0 fetches.
//   2 LIBRARY     matrix-ranked scan of the wall-filtered pool: the best
//                 kcal/protein fit among candidates honouring the user's
//                 cost/time/complexity/taste dials. 0 calls, 0 fetches.
//   3 WEB         owner-enabled curated sites, robots-respecting, through the
//                 Phase 5 importer. Proposals only — full verify gate applies.
//   4 AI          the governed generator, prompt-aimed by the spec. Proposals
//                 only — same verify gate, cache-forever on success.
//   5 DEGRADE     the deterministic closest fit + the MEASURED reason (which
//                 cap or wall is binding), never a silent miss, never a crash.
//
// WHY THE BRAINS COMPOSE INSTEAD OF MERGING: the solver brain owns the rulers
// (what "on target" means), the portion brain owns the arithmetic (what grams
// ship), and this brain owns SOURCING (what exists to portion). Every gate this
// file applies is imported from the module that owns it — mealRouter's
// verifyDraft, weeklyPlanner's tolerances via tweak/refit, recipeCost's caps,
// planContext's walls. If a number here disagreed with the plan screen, one of
// us would be lying; importing the same functions makes that structurally
// impossible.
//
// PRISMA POSTURE: pure by default. Anything that must touch the DB
// (persistence, ingredient resolution, food loads, durable cache lookups) is
// an injectable dep with a lazy-required production default — the same seam
// discipline as mealRouter, so the whole brain tests keyless and DB-less.
const { buildSpec, specFingerprint, gapSpecsFromDay } = require("./spec.js");
const { matrixFromSpec, judge } = require("./matrix.js");
const { refit } = require("./tweak.js");
const librarySource = require("./sources/librarySource.js");
const cacheSource = require("./sources/cacheSource.js");
const webSource = require("./sources/webSource.js");
const aiSource = require("./sources/aiSource.js");
const { filterRecipePool } = require("../planContext.js");
const { eligibleRecipes } = require("../weeklyPlanner.js");
const { verifyDraft } = require("../mealRouter.js");
const { resolveIngredient } = require("../ingredientResolver.js");
const { clampProposedTier } = require("../brain/taste.js");

// The screens a generated/imported row passed before persistence — written to
// Recipe.aiVerifiedBy so "why is this row in my library" has an answer in the
// data (the audit gap the stage-4 handoff named).
const VERIFY_SCREENS = ["post-resolution-names", "pool-filter", "placeholder-audit", "macro-math", "matrix-caps"];

function makeStats() {
  return {
    requests: 0, cacheHits: 0, libraryHits: 0, webImports: 0, generations: 0,
    discarded: 0, degraded: 0, unsolved: 0, modelCalls: 0, webFetches: 0,
  };
}
const _stats = makeStats();
const snapshot = (s) => ({ ...s });

function defaultPersistRecipe(resolved, opts) {
  return require("../recipeGeneration.js").persistRecipe(resolved, opts);
}
function defaultLoadFoodsLazy(ids) {
  return require("../recipeGeneration.js").defaultLoadFoods(ids);
}

/**
 * solveRecipeForSlot(request, deps?) -> outcome
 *
 * request:
 *   spec         a RecipeSpec — OR pass { target, dailyTarget, filters } and
 *                one is built here (target = weeklyPlanner slot shape).
 *   profile      the authoritative Profile row (walls read from HERE only).
 *   recipePool   RAW Recipe rows with ingredients.food included. Walls are
 *                applied inside (the pool builder is the safety boundary).
 *   existingRecipeNames, ratings (Map), options:
 *     allowGeneration (default true)  — spend permission for channel 4
 *     allowWeb        (default false) — channel 3 (also needs owner-enabled
 *                                       sites in data/recipeSources.json)
 *     maxWebImports   (default 2)
 *
 * outcome:
 *   { ok, status, recipe, scaled, tweak, spec, fingerprint, matrix,
 *     channelsTried, attempts, notice, reason, stats }
 *   status: "cache-hit" | "library-hit" | "web-imported" | "generated"
 *         | "closest-fit" | "unsolved"
 */
async function solveRecipeForSlot(request = {}, deps = {}) {
  const {
    profile = {}, recipePool = [], existingRecipeNames = [], ratings = null,
    options = {},
  } = request;
  const {
    persistRecipeImpl = defaultPersistRecipe,
    resolveIngredientImpl = resolveIngredient,
    loadFoodsImpl = defaultLoadFoodsLazy,
    stats = _stats,
    now = () => new Date(),
    // channel deps pass through: cacheDeps, webDeps, aiDeps, refitImpl
  } = deps;
  const allowGeneration = options.allowGeneration !== false;
  const allowWeb = options.allowWeb === true;

  stats.requests++;

  // ── 0. THE SPEC ───────────────────────────────────────────────────────────
  const spec = request.spec || buildSpec({
    target: request.target, dailyTarget: request.dailyTarget ?? null,
    filters: request.filters ?? {}, profile,
  });
  const target = { slotType: spec.slotType, kcalTarget: spec.kcalTarget, proteinTarget: spec.proteinTarget };
  const fingerprint = specFingerprint(spec);
  const matrix = matrixFromSpec(spec);
  const rules = {
    excludedFoods: Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [],
    dietaryStyle: profile?.dietaryStyle || null,
  };

  // ── THE POOL. The real builder, on the raw rows. ──────────────────────────
  const walled = filterRecipePool(recipePool, profile || {});
  const pool = eligibleRecipes(walled, spec.slotType, new Map(), Infinity);

  const attempts = [];
  const channelsTried = [];
  const base = { spec, fingerprint, matrix, attempts, channelsTried };

  // ── 1. CACHE ──────────────────────────────────────────────────────────────
  channelsTried.push("cache");
  const cached = await cacheSource.lookup({ spec, fingerprint, pool, ratings }, deps.cacheDeps || {});
  attempts.push({ channel: "cache", records: cached.attempts });
  if (cached.hit) {
    stats.cacheHits++;
    return { ...base, ok: true, status: "cache-hit", recipe: cached.hit.recipe, scaled: cached.hit.scaled, tweak: cached.hit.tweak, cached: true, via: cached.hit.via, notice: null, reason: null, stats: snapshot(stats) };
  }

  // ── 2. LIBRARY ────────────────────────────────────────────────────────────
  channelsTried.push("library");
  const lib = librarySource.search({ spec, pool, ratings }, { refitImpl: deps.refitImpl || refit });
  attempts.push({ channel: "library", refitAttempts: lib.attempts, skippedForDensity: lib.skippedForDensity, explain: { ok: lib.explain.ok, bindingConstraint: lib.explain.bindingConstraint, survivorCount: lib.explain.survivorCount, message: lib.explain.message } });
  if (lib.hit) {
    const wasGenerated = lib.hit.recipe.source === "ai-generated";
    if (wasGenerated) { stats.cacheHits++; cacheSource.remember(fingerprint, lib.hit.recipe.id, deps.cacheDeps || {}); }
    else stats.libraryHits++;
    return { ...base, ok: true, status: wasGenerated ? "cache-hit" : "library-hit", recipe: lib.hit.recipe, scaled: lib.hit.scaled, tweak: lib.hit.tweak, cached: wasGenerated, via: "scan", adherence: lib.hit.adherence, notice: null, reason: null, stats: snapshot(stats) };
  }

  // A GENUINE GAP. Shared verify gate for every proposal path from here on:
  // mealRouter.verifyDraft (resolution → walls → placeholder → macro fit),
  // then the matrix caps on the resolved row, then the refit for the final
  // portion. Web and AI face the IDENTICAL screen.
  const verifyProposal = async (draft) => {
    const verdict = await verifyDraft(draft, { profile: profile || {}, target, rules, resolveIngredientImpl, loadFoodsImpl });
    if (!verdict.ok) { stats.discarded++; return verdict; }
    const j = judge(verdict.row, matrix, { ratings });
    if (!j.passes) {
      stats.discarded++;
      return { ok: false, reason: `"${verdict.resolved.name}" passed safety and macros but fails the ${j.gate.bindingConstraint?.toUpperCase() ?? "matrix"} cap`, matrixReject: true, gate: j.gate };
    }
    const t = (deps.refitImpl || refit)(verdict.row, spec);
    return { ...verdict, ok: true, matrix: j, tweak: t, scaled: t && t.scaled ? t.scaled : verdict.fit.scaled };
  };

  // ── 3. WEB ────────────────────────────────────────────────────────────────
  if (allowWeb) {
    channelsTried.push("web");
    const swept = await webSource.sweep({ spec }, { maxTotalImports: options.maxWebImports ?? 2, ...(deps.webDeps || {}) });
    stats.webFetches += swept.attempts.filter((a) => a.outcome === "imported-draft" || a.outcome === "search-fetch-failed" || a.outcome === "no-candidate-links").length;
    attempts.push({ channel: "web", records: swept.attempts, enabledSites: swept.enabledSites });
    for (const { draft, sourceUrl } of swept.drafts) {
      const verdict = await verifyProposal(draft);
      if (!verdict.ok) { attempts.push({ channel: "web", url: sourceUrl, outcome: "discarded", reason: verdict.reason }); continue; }
      // Acting user, so a web-imported row can be edited/deleted by whoever
      // caused the import. Visibility is unaffected — no pool query filters on
      // createdByUserId.
      const saved = await persistRecipeImpl(verdict.resolved, { source: "imported", createdByUserId: profile?.userId ?? null });
      const recipe = saved && saved.id ? { ...verdict.row, id: saved.id, source: "imported" } : verdict.row;
      if (saved && saved.id) cacheSource.remember(fingerprint, saved.id, deps.cacheDeps || {});
      stats.webImports++;
      attempts.push({ channel: "web", url: sourceUrl, outcome: "web-imported" });
      return {
        ...base, ok: true, status: "web-imported", recipe, scaled: verdict.scaled, tweak: verdict.tweak, cached: false, via: "web",
        provenance: { source: "imported", sourceUrl, verified: true, verifiedBy: VERIFY_SCREENS },
        notice: null, reason: null, stats: snapshot(stats),
      };
    }
  }

  // ── 4. AI ─────────────────────────────────────────────────────────────────
  let lastRefusal = null;
  if (allowGeneration) {
    channelsTried.push("ai");
    const gen = await aiSource.generate(
      { spec, target, profile, existingRecipeNames, verifyImpl: verifyProposal },
      deps.aiDeps || {}
    );
    stats.modelCalls += gen.modelCalls;
    attempts.push({ channel: "ai", records: gen.attempts });
    lastRefusal = gen.lastRefusal;
    if (gen.accepted) {
      const { verdict, model } = gen.accepted;
      const saved = await persistRecipeImpl(verdict.resolved, {
        source: "ai-generated",
        tasteTier: clampProposedTier(gen.accepted.draft.tasteTier),
        tasteTierSource: "llm",
        aiFingerprint: fingerprint,
        aiVerifiedAt: now(),
        aiVerifiedBy: { screens: VERIFY_SCREENS, model, specVersion: spec.version },
        createdByUserId: profile?.userId ?? null,
      });
      const recipe = saved && saved.id ? { ...verdict.row, id: saved.id, source: "ai-generated" } : verdict.row;
      if (saved && saved.id) cacheSource.remember(fingerprint, saved.id, deps.cacheDeps || {});
      stats.generations++;
      return {
        ...base, ok: true, status: "generated", recipe, scaled: verdict.scaled, tweak: verdict.tweak, cached: false, via: "brain",
        provenance: { source: "ai-generated", verified: true, verifiedBy: VERIFY_SCREENS, model, fingerprint },
        notice: null, reason: null, stats: snapshot(stats),
      };
    }
  }

  // ── 5. DEGRADE. Honest, deterministic, never an error. ───────────────────
  const why = degradeNotice({ lastRefusal, allowGeneration, allowWeb, explain: lib.explain });
  if (lib.closest) {
    stats.degraded++;
    return {
      ...base, ok: false, status: "closest-fit",
      recipe: lib.closest.recipe, scaled: lib.closest.scaled, tweak: lib.closest.tweak, cached: false, via: "closest-fit",
      notice: `${why} Showing the closest deterministic fit (${describeMiss(lib.closest.verdict)}).`,
      reason: lastRefusal?.code || (allowGeneration ? "no-fit-found" : "generation-not-requested"),
      stats: snapshot(stats),
    };
  }
  stats.unsolved++;
  return {
    ...base, ok: false, status: "unsolved", recipe: null, scaled: null, tweak: null, cached: false, via: null,
    notice: `${why} No compliant recipe in the library can fill this slot.`,
    reason: lastRefusal?.code || (allowGeneration ? "no-fit-found" : "generation-not-requested"),
    stats: snapshot(stats),
  };
}

function describeMiss(v) {
  if (!v) return "could not be scaled onto this slot";
  const parts = [];
  if (v.kcalOff > 0.15) parts.push(`${Math.round(v.kcalOff * 100)}% off calories`);
  if (v.proteinShort > 0) parts.push(`${Math.round(v.proteinShort * 100)}% short on protein`);
  if (v.fatMiss > 0) parts.push("outside the fat guidance");
  if (v.carbMiss > 0) parts.push("outside the carb guidance");
  return parts.join(", ") || "near-miss on tolerance";
}

// Every sentence is a real measured fact or a governance message written by the
// control that fired. The library explain's binding constraint is threaded in
// so "nothing fits" always says WHICH dial is doing it when one is.
function degradeNotice({ lastRefusal, allowGeneration, allowWeb, explain }) {
  const capLine = explain && !explain.ok && explain.bindingConstraint && explain.bindingConstraint !== "pool"
    ? ` ${explain.message}` : "";
  if (!allowGeneration && !allowWeb) return `No library recipe hits this spec.${capLine} Web import and AI generation were not requested.`;
  if (!lastRefusal) return `No channel produced a recipe that passed every gate.${capLine}`;
  if (lastRefusal.code === "cost-cap") return lastRefusal.message || "The AI budget for this period is used up.";
  if (lastRefusal.code === "llm-disabled") return lastRefusal.message || "AI recipe generation is switched off in this build.";
  if (lastRefusal.code === "input-refused") return lastRefusal.message || "That request could not be sent.";
  if (lastRefusal.code === "llm-timeout") return "The AI request took too long and was cancelled. Nothing was saved.";
  if (lastRefusal.code === "verification-failed") return `No sourced recipe passed the safety, macro and matrix checks.${capLine}`;
  if (lastRefusal.code === "no-usable-draft") return `The AI returned nothing usable for this spec.${capLine}`;
  return lastRefusal.message || `Sourcing was unavailable for this spec.${capLine}`;
}

/**
 * fillDayGaps(request, deps?) — THE SYNERGY LOOP, half one: read a solved day
 * candidate, spec every missed slot, source recipes for them.
 *
 * request: { candidate, dailyTarget, mealConfig, profile, recipePool (RAW),
 *            filters, ratings, options { maxGapFills=3, allowWeb, allowGeneration } }
 * -> { additions,   // persisted Recipe rows ready to join the pool
 *      outcomes,    // one solveRecipeForSlot outcome per gap, full trail
 *      report }     // { gaps, filled, notices[] }
 */
async function fillDayGaps(request = {}, deps = {}) {
  const { candidate, dailyTarget, mealConfig, profile = {}, recipePool = [], filters = {}, ratings = null, options = {} } = request;
  const maxGapFills = Number.isInteger(options.maxGapFills) && options.maxGapFills > 0 ? options.maxGapFills : 3;

  const gaps = gapSpecsFromDay({ candidate, dailyTarget, mealConfig, filters, profile });
  const outcomes = [];
  const additions = [];
  const notices = [];
  const existingNames = recipePool.map((r) => r.name).filter(Boolean);

  // A gap exists because the solver could not fill it FROM THIS POOL — with
  // variety caps, prior slots, and the whole day in view. Re-offering the pool
  // unchanged would mostly re-find recipes the solver already placed (or
  // declined for variety) and return zero additions. So the recipes already ON
  // the candidate day are excluded from gap sourcing: the recipe brain's job
  // here is to bring something NEW to the re-solve, and the re-solve — not
  // this loop — decides the final placement with every rule in force.
  const placedIds = new Set(candidate?.slots?.map((s) => s.recipeId).filter(Boolean) ?? []);
  const gapPoolBase = recipePool.filter((r) => !placedIds.has(r.id));

  for (const gap of gaps.slice(0, maxGapFills)) {
    const outcome = await solveRecipeForSlot(
      {
        spec: gap.spec, profile,
        recipePool: [...gapPoolBase, ...additions],
        existingRecipeNames: [...existingNames, ...additions.map((r) => r.name)],
        ratings, options,
      },
      deps
    );
    outcomes.push({ slot: gap.slot, reason: gap.reason, outcome });
    if (outcome.ok && outcome.recipe && (outcome.status === "generated" || outcome.status === "web-imported")) {
      additions.push(outcome.recipe);
    }
    if (outcome.notice) notices.push(outcome.notice);
  }
  if (gaps.length > maxGapFills) {
    notices.push(`${gaps.length - maxGapFills} further gap(s) were not sourced this pass (cap ${maxGapFills}); re-run to continue.`);
  }

  return { additions, outcomes, report: { gaps: gaps.length, filled: additions.length, notices } };
}

/**
 * solveDayWithGapFill(request, deps?) — the full loop: solver → recipe brain →
 * solver again, keeping whichever day is HONESTLY better.
 *
 * request: { dailyTarget, mealConfig, profile, recipePool (RAW), filters,
 *            ratings, dayOfWeek, rng, options }
 * -> { best, firstPass, secondPass|null, gapFill|null, improved }
 *
 * The re-solve consumes the ENRICHED pool through the same wall filter; the
 * comparison is on the solver's own matchPct — this module never re-judges a
 * day with its own math. deps.generateDayCandidatesImpl is the test seam.
 */
async function solveDayWithGapFill(request = {}, deps = {}) {
  const {
    dailyTarget, mealConfig, profile = {}, recipePool = [], filters = {},
    ratings = null, dayOfWeek = 0, rng, options = {},
  } = request;
  const generateDayCandidatesImpl = deps.generateDayCandidatesImpl
    || ((args) => require("../mealSolver.js").generateDayCandidates(args));

  const walled = filterRecipePool(recipePool, profile || {});
  const first = await generateDayCandidatesImpl({
    dailyTarget, mealConfig, recipePool: walled, dayOfWeek,
    filters: { ...filters, ratings: ratings ?? filters.ratings }, rng, profile,
  });
  const firstBest = first.candidates?.[0] ?? null;

  // Nothing missed → nothing to source. The free path stays free.
  const missed = firstBest && firstBest.slots.some((s) => s.recipeId == null || s.warning);
  if (!firstBest || !missed) {
    return { best: firstBest, firstPass: first, secondPass: null, gapFill: null, improved: false };
  }

  const gapFill = await fillDayGaps(
    { candidate: firstBest, dailyTarget, mealConfig, profile, recipePool, filters, ratings, options },
    deps
  );
  if (!gapFill.additions.length) {
    return { best: firstBest, firstPass: first, secondPass: null, gapFill, improved: false };
  }

  const enriched = filterRecipePool([...recipePool, ...gapFill.additions], profile || {});
  const second = await generateDayCandidatesImpl({
    dailyTarget, mealConfig, recipePool: enriched, dayOfWeek,
    filters: { ...filters, ratings: ratings ?? filters.ratings }, rng, profile,
  });
  const secondBest = second.candidates?.[0] ?? null;

  const improved = Boolean(
    secondBest && firstBest &&
    Number(secondBest.score?.matchPct ?? 0) > Number(firstBest.score?.matchPct ?? 0)
  );
  return { best: improved ? secondBest : firstBest, firstPass: first, secondPass: second, gapFill, improved };
}

/**
 * routeSlotCompat(request, deps?) — drop-in adapter for the weeklyPlanner
 * aiFallback seam (aiFallback.routeMealSlotImpl), same contract as
 * mealRouter.routeMealSlot: { target, profile, recipePool, existingRecipeNames,
 * allowGeneration } -> { ok, status, recipe, scaled, fingerprint, cached,
 * modelCalls, attempts, notice, reason, stats }.
 *
 * This is how the solver's unattended fallback upgrades to the full recipe
 * brain WITHOUT editing weeklyPlanner: inject this function. Statuses map 1:1
 * except "web-imported", which the planner treats like "generated" (both are
 * "a new verified row joined the pool").
 */
async function routeSlotCompat(request = {}, deps = {}) {
  const { target = {}, profile = {}, recipePool = [], existingRecipeNames = [], allowGeneration = true } = request;
  const outcome = await solveRecipeForSlot(
    {
      target, profile, recipePool, existingRecipeNames,
      dailyTarget: request.dailyTarget ?? null,
      filters: request.filters ?? {},
      ratings: request.ratings ?? null,
      options: { allowGeneration, allowWeb: request.allowWeb === true },
    },
    deps
  );
  const modelCalls = outcome.attempts
    .filter((a) => a.channel === "ai")
    .flatMap((a) => a.records || [])
    .filter((r) => r.outcome && !["cost-cap", "llm-disabled", "input-refused"].includes(r.outcome)).length;
  return {
    ok: outcome.ok,
    status: outcome.status === "web-imported" ? "generated" : outcome.status,
    recipe: outcome.recipe, scaled: outcome.scaled,
    fingerprint: outcome.fingerprint, cached: outcome.cached === true,
    modelCalls, attempts: outcome.attempts,
    notice: outcome.notice, reason: outcome.reason, stats: outcome.stats,
    recipeBrain: { spec: outcome.spec, tweak: outcome.tweak ?? null, channelsTried: outcome.channelsTried },
  };
}

function routerStats() { return snapshot(_stats); }
function resetRouterStats() { for (const k of Object.keys(_stats)) _stats[k] = 0; }

module.exports = {
  solveRecipeForSlot, fillDayGaps, solveDayWithGapFill, routeSlotCompat,
  makeStats, routerStats, resetRouterStats, VERIFY_SCREENS,
};
