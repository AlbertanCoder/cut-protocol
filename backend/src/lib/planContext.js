// Shared plan CONTEXT builder — the single source of the solver's recipe pool.
// Extracted from routes/plans.js (Stage 1, v2) so the brain's chat planner and
// every /plans route build the SAME exclusion-filtered pool. The M8 invariant
// (the recipe LISTING and the solver POOL can never diverge) depends on this
// staying single-sourced: exclusions are computed in code from the
// authoritative profile only — never from LLM output, memory, or free text
// (LAW 2).
//
// The exclusion DECISION itself no longer lives here. It moved to
// exclusionGate.js, because "single-sourced" was only ever true of the plan
// pool: the library browse, the cart and the brain pool each had their own
// weaker copy, and against the real library those copies showed 210 recipe/
// allergy pairs this pool correctly hid. This file now owns two things — the
// diet stamp the solver needs, and the library cache the eight /plans call
// sites need.
const { prisma } = require("./prisma.js");
const { computeMacros } = require("./bmrEngine.js");
const { getWeightNowKg } = require("./weightNow.js");
const { reconcileTarget } = require("./profileTarget.js");
// Adjuster resolution (see loadAdjusters below) needs the shared gate and the
// macro-trust check — deliberately the SAME ones every recipe surface uses.
const { isExcluded, FOOD_GATE_SELECT } = require("./exclusionGate.js");
const { macroTrustIssue } = require("./foodValidation.js");
// The exclusion decision is NOT made here anymore. It lives in exclusionGate.js
// so the library browse, the cart, the brain pool and this pool answer the same
// question with the same evidence — see that file's header for the 210 recipe/
// allergy pairs the old five-implementations arrangement was leaking.
const { filterRecipes, RECIPE_GATE_SELECT, recipeTrustExclusion } = require("./exclusionGate.js");
// Phase-2 plausibility fence (recipeSanityGate): a recipe whose per-serving
// numbers are implausible — 10,000 g of one ingredient, 9,000 kcal a serving —
// is fenced from every PLAN pool the same way trust-excluded rows are. It
// stays visible in the Recipes browse; it is never served. Totals are
// recomputed FDC-canonically from the gate-select rows (nutritionCore), never
// read from the cached Recipe columns.
const { macroTotals } = require("./nutritionCore.js");
const { sanityCheckRecipe } = require("./recipeSanityGate.js");

// The pool carries the diet style it was admitted under (solver-core-3).
// "Pool membership = compliance" is this codebase's invariant, but membership is
// decided at 1× while the solver ships PORTIONS — and its two-factor scaling can
// double a side's carbs. Stamping the style onto each recipe lets the post-scale
// keto ceiling in weeklyPlanner.enforceScaledCarbCeiling() re-check the shipped
// portion without every call site having to thread a profile down. Pure: the
// input rows are never mutated, and a null style stamps nothing.
function stampDietGuard(recipes, dietaryStyle) {
  if (!dietaryStyle) return recipes;
  return recipes.map((r) => (r.dietGuardStyle === dietaryStyle ? r : { ...r, dietGuardStyle: dietaryStyle }));
}

// The solver's pool = the gate's verdict + the diet stamp. All four evidence
// sources (ingredient rows with metadata, "Add'l ingredients:" prose, the
// title, the full step text) now live in exclusionGate.collectEvidence(), so
// this function no longer decides anything about allergens — it only decides
// what the SOLVER additionally needs to know about what it admitted.
//
// The ingredient-TRUST gate (owner ruling 2026-08-12) also runs here, and
// deliberately here rather than inside explainRecipeExclusion: this function is
// the one chokepoint every plan entry point builds its candidates through
// (generate, day-options, alternates, apply, place-recipe, fill-today-from-
// cart, legacy swap, mealRouter.verifyDraft, the recipe-brain pool), while the
// library browse — which must keep SHOWING flagged recipes with their amber
// marker — never calls it. A recipe whose stated calories are materially
// another food's numbers is not a number the solver may build a day on.
// The removal is never silent: loadRecipePool() counts it, planContext()
// forwards it, and the poolCounts/diagnosis layer names it.
function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const trusted = recipePool.filter((r) => !recipeTrustExclusion(r).excluded);
  const sane = trusted.filter((r) => !recipeSanityExclusion(r).excluded);
  return stampDietGuard(filterRecipes(sane, profile), dietaryStyle);
}

// The plausibility fence. Profile-independent, like the trust gate: it reads
// only the recipe's own ingredient rows. Attribution order for the counts is
// raw -> trust -> sanity -> diet, and a row is billed to the FIRST fence that
// removes it, so the two counts never double-count one recipe.
function recipeSanityExclusion(recipe) {
  // Rows that carry NO gram field at all are not this fence's business —
  // absence of data is exclusionGate's fail-closed territory; this fence
  // judges data that EXISTS and is implausible. A stored baseGrams of 0 or a
  // negative still fails (the field exists and lies).
  const ings = (recipe.ingredients || [])
    .filter((i) => i.baseGrams !== undefined && i.baseGrams !== null)
    .map((i) => ({
      foodId: i.foodId,
      grams: i.baseGrams,
      name: i.food?.name,
    }));
  const foodsById = new Map((recipe.ingredients || []).map((i) => [i.foodId, i.food]));
  const { ok, totals } = macroTotals(ings, foodsById);
  // The kcal/protein bounds are judged only when EVERY ingredient row carries
  // grams and resolves — a partial sum reads artificially low and would trip
  // the 150-kcal floor on recipes whose data is merely incomplete (that class
  // is exclusionGate's fail-closed job, not this fence's). Gram bounds still
  // apply to every row that states a gram figure.
  const complete = ok && ings.length > 0 && ings.length === (recipe.ingredients || []).length;
  const sanity = sanityCheckRecipe(
    { name: recipe.name, ingredients: ings },
    // No kcal floor at the runtime fence: a small side dish in the library
    // harms nobody. The floor is a candidate-ADMISSION rule (see the gate's
    // own doc); here it would fence legitimate light recipes and every
    // minimal test fixture.
    { totals: complete ? totals : null, foodsById, enforceKcalFloor: false }
  );
  return sanity.ok ? { excluded: false } : { excluded: true, reason: "sanity", issues: sanity.issues };
}

// ── the recipe library cache (plan-perf-1) ────────────────────────────────
// planContext() is called from eight places in routes/plans.js, and every one
// of them was re-loading all 889 recipes with their ingredients and foods:
// measured 192–532 ms and ~7 MB per call, then 350–400 ms to filter them —
// 10-17x the solve itself (30-50 ms). It is the dominant cost of a plan
// request by an order of magnitude, and the data is a shared LIBRARY that
// changes a few times a day at most.
//
// Two layers, both keyed on a library VERSION so a stale pool is not
// representable:
//   • _library — the raw rows, loaded with the gate's own selection.
//   • _pools   — the FILTERED pool per exclusion-rule set. The filter is the
//     more expensive half (the step-prose probe runs the whole allergen vocab
//     over multi-KB strings), and a user's rules change far less often than
//     they request a plan, so this is the layer that actually pays.
//
// INVALIDATION is belt-and-braces on purpose, because getting it wrong means
// serving a plan built from a recipe that no longer exists — or worse, from
// one whose allergen metadata just changed:
//   1. invalidateRecipeLibrary() — called explicitly by the routes that mutate
//      recipes. Instant, and the only mechanism that catches a change made
//      microseconds before the next read.
//   2. LIBRARY_VERSION_SQL — a checksum over exactly the columns the gate and
//      the solver read (row counts, name/steps/metadata lengths, macro and
//      gram sums). ~12 ms, run on every planContext() call, and it is what
//      covers the paths that do NOT call (1): a maintenance script in another
//      process, a seeder, or a mutation route wired after this comment was
//      written. Any insert, delete, rename, macro edit, allergen-tag edit or
//      portion change moves it.
// Prisma 6 removed $use, so a client-level write hook is not available; if the
// checksum ever becomes the bottleneck the right answer is an updatedAt column
// on Recipe/Food, not a longer TTL.
const LIBRARY_VERSION_SQL =
  "SELECT (SELECT COUNT(*)||'/'||IFNULL(SUM(LENGTH(name)+LENGTH(steps)+kcal+protein+fat+carb),0) FROM Recipe) r," +
  // source + dataQuality are in here because they are what macroTrustIssue()
  // reads. Without them a row could be QUARANTINED — its macros declared another
  // food's numbers — without moving the checksum, so a maintenance script that
  // quarantines rows in another process (which is how the 2026-07-31 provenance
  // repair ran) stayed invisible to every cache below. Everything else the gate
  // and solver read was already covered; trust was the gap.
  " (SELECT COUNT(*)||'/'||IFNULL(SUM(LENGTH(name)+LENGTH(IFNULL(allergenTags,''))+LENGTH(IFNULL(fdcCategory,''))+LENGTH(IFNULL(mayContain,''))+LENGTH(IFNULL(source,''))+LENGTH(IFNULL(dataQuality,''))+kcal+protein+fat+carb+fiber),0) FROM Food) f," +
  " (SELECT COUNT(*)||'/'||IFNULL(SUM(baseGrams),0) FROM RecipeIngredient) i";
// Distinct rule-sets held at once. A single-user desktop app needs 1; the cap
// exists so a future multi-tenant deployment cannot grow this without bound.
const POOL_CACHE_MAX = 32;
let _epoch = 0;
let _library = null; // { version, rows }
let _pools = new Map(); // rulesKey -> filtered+stamped pool
let _adjusterFoods = null; // { version, byLower } — see loadAdjusterFoods()
// Profile-INDEPENDENT count of library recipes the trust gate removes from
// every plan pool (exclusionGate.recipeTrustExclusion). Cached per library
// version for the same staleness reasons as _pools: source/dataQuality are in
// LIBRARY_VERSION_SQL, so a quarantine run in another process moves it.
let _trustCount = null; // { version, count }
// Same shape and staleness rules for the plausibility fence — macro and gram
// sums are in LIBRARY_VERSION_SQL, so any edit that could change a verdict
// moves the version.
let _sanityCount = null; // { version, count }

// Called by every route that mutates a Recipe, RecipeIngredient or Food.
function invalidateRecipeLibrary() {
  _epoch++;
  _library = null;
  _pools = new Map();
  // The adjuster map is a Food cache too. It used to be missing from this list,
  // so a Food row edited or quarantined through any route was correctly dropped
  // from _library and every _pools entry while the adjuster map kept handing out
  // the pre-edit object for the rest of the process lifetime — and the
  // macroTrustIssue() re-check in loadAdjusters() reads that same cached object,
  // so it could not catch it either. A row quarantined for bad macros kept being
  // added to real users' days, with the bad macros, until restart.
  _adjusterFoods = null;
  _trustCount = null;
  _sanityCount = null;
}

// How many library recipes the trust gate removes from every plan pool —
// the number the diagnosis layer reports so the removal is never silent.
function countTrustExcluded(rows) {
  let n = 0;
  for (const r of rows) if (recipeTrustExclusion(r).excluded) n++;
  return n;
}

// Counted among rows the trust gate PASSED, so a recipe removed by both
// fences is billed once, to trust (attribution order raw -> trust -> sanity).
function countSanityExcluded(rows) {
  let n = 0;
  for (const r of rows) {
    if (recipeTrustExclusion(r).excluded) continue;
    if (recipeSanityExclusion(r).excluded) n++;
  }
  return n;
}

async function libraryVersion() {
  try {
    const [row] = await prisma.$queryRawUnsafe(LIBRARY_VERSION_SQL);
    return `${_epoch}|${row.r}|${row.f}|${row.i}`;
  } catch {
    // No checksum (unsupported provider, schema drift, a mocked client) means
    // no PROOF the cache is current — so don't use one. Fails toward slow,
    // never toward stale.
    return null;
  }
}

// The raw library rows, cached by version. Returns the array itself; callers
// must treat it as read-only (filterRecipePool already never mutates).
async function loadRecipeLibrary() {
  const version = await libraryVersion();
  if (version && _library && _library.version === version) return _library.rows;
  const rows = await prisma.recipe.findMany({ select: RECIPE_GATE_SELECT });
  if (version) {
    if (!_library || _library.version !== version) _pools = new Map();
    _library = { version, rows };
  } else {
    _library = null;
    _pools = new Map();
  }
  return rows;
}

// The exclusion-filtered, diet-stamped pool for one profile's rules, cached by
// (library version + rules). The key is built from the AUTHORITATIVE profile
// fields only — the same two the gate reads — so two profiles that exclude the
// same things share one entry and nothing else about the user leaks into it.
// The returned ARRAY is always a fresh copy, never the cached one. The solver's
// AI-fallback path (weeklyPlanner.finishAiSlot) push()es a newly generated
// recipe into the pool it was handed so later slots in the same run can use it
// — which, against a shared cached array, would append that recipe to every
// subsequent request's pool and mutate a live array another request may be
// iterating. Copying the array (550 refs, sub-millisecond) keeps that
// per-run behaviour exactly as it was while the rows themselves stay shared.
async function loadRecipePool(profile) {
  const rows = await loadRecipeLibrary();
  // trustExcludedCount is profile-independent (the trust gate reads only the
  // recipe's own ingredient rows), so it is computed once per library version.
  // Attribution order for the counts: raw -> trust -> diet/allergy — the trust
  // gate runs first inside filterRecipePool, so `pool.length` is after BOTH.
  if (!_library) {
    return {
      pool: filterRecipePool(rows, profile), rawPoolCount: rows.length,
      trustExcludedCount: countTrustExcluded(rows), sanityExcludedCount: countSanityExcluded(rows),
    };
  }
  if (!_trustCount || _trustCount.version !== _library.version) {
    _trustCount = { version: _library.version, count: countTrustExcluded(rows) };
  }
  if (!_sanityCount || _sanityCount.version !== _library.version) {
    _sanityCount = { version: _library.version, count: countSanityExcluded(rows) };
  }
  const trustExcludedCount = _trustCount.count;
  const sanityExcludedCount = _sanityCount.count;
  const excluded = Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [];
  const rulesKey = JSON.stringify([
    profile?.dietaryStyle || null,
    [...excluded].map((t) => String(t).trim().toLowerCase()).sort(),
  ]);
  const hit = _pools.get(rulesKey);
  if (hit) return { pool: [...hit], rawPoolCount: rows.length, trustExcludedCount, sanityExcludedCount };
  const pool = filterRecipePool(rows, profile);
  if (_pools.size >= POOL_CACHE_MAX) _pools.delete(_pools.keys().next().value);
  _pools.set(rulesKey, pool);
  return { pool: [...pool], rawPoolCount: rows.length, trustExcludedCount, sanityExcludedCount };
}

// ── macro adjusters ─────────────────────────────────────────────────────────
//
// The small, ordinary components the solver may ADD to a day when portion scaling
// alone cannot land it — see macroCloser.js for the measurement that motivated it
// (68.3% of missing slots were pinned at a 0.5x/2.0x scale bound).
//
// Ordered by preference within each role, plainest first. Every candidate is passed
// through the SAME exclusion gate as every recipe, so a dairy wall removes the
// yogurt and butter, a vegan style removes all four animal rows, and a customer with
// no safe option in a role simply gets no adjuster in that role.
const ADJUSTER_CANDIDATES = [
  { name: "Olive Oil", role: "fat" },
  { name: "Butter", role: "fat" },
  { name: "Avocado", role: "fat" },
  { name: "White rice, cooked", role: "carb" },
  { name: "Potatoes", role: "carb" },
  { name: "Oats", role: "carb" },
  { name: "Chicken breast, cooked, skinless", role: "protein" },
  { name: "Greek Yogurt", role: "protein" },
  { name: "Tofu", role: "protein" },
  { name: "Lentils", role: "protein" },
];

// Version-keyed for the same reason loadRecipeLibrary() is: invalidateRecipeLibrary()
// only covers in-process mutation routes, and the paths that quarantine food rows in
// bulk are maintenance scripts running in ANOTHER process. A null version means no
// proof the cache is current, so it is not used — fails toward slow, never stale.
async function loadAdjusterFoods() {
  const version = await libraryVersion();
  if (version && _adjusterFoods && _adjusterFoods.version === version) return _adjusterFoods.byLower;
  const rows = await prisma.food.findMany({
    where: { name: { in: ADJUSTER_CANDIDATES.map((a) => a.name) } },
    select: FOOD_GATE_SELECT,
  });
  const byLower = new Map();
  for (const f of rows) {
    const k = f.name.trim().toLowerCase();
    if (!byLower.has(k)) byLower.set(k, f);
  }
  _adjusterFoods = version ? { version, byLower } : null;
  return byLower;
}

/**
 * The adjusters THIS profile may be offered. Allergy safety is structural: the food
 * goes through explainFoodExclusion, the same call every recipe surface uses, so
 * there is no second vocabulary here to drift from the first.
 *
 * A row whose macros are not trustworthy is also refused — adding an unverified food
 * to close a macro gap would be closing it with a number nobody can stand behind.
 */
async function loadAdjusters(profile) {
  const foods = await loadAdjusterFoods();
  const out = [];
  for (const cand of ADJUSTER_CANDIDATES) {
    const food = foods.get(cand.name.trim().toLowerCase());
    if (!food) continue;
    if (macroTrustIssue(food)) continue;
    if (isExcluded(food, profile)) continue;
    out.push({ role: cand.role, food });
  }
  return out;
}

async function planContext(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("no profile set up yet"), { status: 404 });
  const weightNowKg = await getWeightNowKg(userId, profile);
  // adaptive-tdee-2: reconcile the cached Profile.targetKcal against the live
  // resolver before solving. This is the highest-stakes reader of that number —
  // a stale target here is a whole WEEK of meal plans built to the wrong
  // calorie goal, and the drift is invisible because the plan looks internally
  // consistent. The resolver is authoritative; the row is a cache.
  const reconciled = await reconcileTarget(userId, { profile, reason: "planContext" });
  // `reconciled.floor` is deriveTarget()'s effective floor, carried through
  // report(). The solver needs it as an absolute number: its calorie band is
  // symmetric, and without the floor the band re-opens the clamp downward.
  const dailyTarget = computeMacros(profile, weightNowKg, reconciled.target, reconciled.floor);
  const mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay };
  const { pool: recipePool, rawPoolCount, trustExcludedCount, sanityExcludedCount } = await loadRecipePool(profile);
  // T (v2): the user's SOFT taste ratings, as a Map for the solver's bias. A
  // soft re-rank only — hard diet/allergy filtering already happened above.
  const ratingRows = await prisma.recipeRating.findMany({ where: { userId }, select: { recipeId: true, rating: true } });
  const ratings = new Map(ratingRows.map((r) => [r.recipeId, r.rating]));
  const adjusters = await loadAdjusters(profile);
  return { profile, dailyTarget, mealConfig, recipePool, rawPoolCount, trustExcludedCount, sanityExcludedCount, ratings, adjusters };
}

// The generation filters the Phase 4 UI sends. Cuisine/protein/budget are
// soft biases; maxPrepMin is a hard cap; allowBatchRepeats relaxes the
// variety rule; proteinPriority (recomposition mode) makes the solver defend
// the protein floor instead of trading it off — see mealSolver.js's scoreDay/
// scoreWeek/diagnoseFromResult. Allergies/diet are NOT here — they come from
// the profile and are enforced in filterRecipePool, always.
function parseFilters(body) {
  const f = body?.filters || {};
  const posNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    cuisines: Array.isArray(f.cuisines) ? f.cuisines.filter((c) => typeof c === "string").slice(0, 8) : [],
    protein: typeof f.protein === "string" && f.protein ? f.protein : null,
    budget: ["cheap", "moderate", "premium"].includes(f.budget) ? f.budget : null,
    maxPrepMin: Number.isInteger(f.maxPrepMin) && f.maxPrepMin > 0 ? f.maxPrepMin : null,
    // Stage 3: the three new OPTIONAL hard caps. null = not set = not enforced.
    // `budget` above stays a SOFT tier bias; maxCostCad is the hard cap.
    maxCostCad: posNum(f.maxCostCad),
    maxComplexity: Number.isInteger(f.maxComplexity) && f.maxComplexity >= 1 && f.maxComplexity <= 10 ? f.maxComplexity : null,
    minTaste: Number.isFinite(Number(f.minTaste)) && Number(f.minTaste) >= 0 && Number(f.minTaste) <= 1 ? Number(f.minTaste) : null,
    allowBatchRepeats: f.allowBatchRepeats === true,
    proteinPriority: f.proteinPriority === true,
  };
}

module.exports = {
  planContext, filterRecipePool, parseFilters, stampDietGuard,
  // plan-perf-1: the cache and its invalidator. Any route that creates,
  // edits or deletes a Recipe / RecipeIngredient / Food must call
  // invalidateRecipeLibrary() after the write commits.
  invalidateRecipeLibrary, loadRecipeLibrary, loadRecipePool,
  // Exported so a test can assert what the checksum actually covers. The columns
  // in here are the contract: anything the gate or the solver reads to make a
  // safety or trust decision must move it, or a cache goes stale on exactly the
  // rows that matter most.
  LIBRARY_VERSION_SQL,
};
