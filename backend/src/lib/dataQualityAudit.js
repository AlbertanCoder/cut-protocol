// Runtime data-quality audit — the Phase 2 guardrail wired into server
// startup. Same rules as scripts/auditFoodData.mjs (both defer to
// foodValidation.js); this one returns a compact summary instead of a full
// report file.
const { prisma } = require("./prisma.js");
const { validateFood, validateRecipe, findDuplicateGroups } = require("./foodValidation.js");
const { CATEGORY_SLUGS } = require("./foodCategories.js");
const { loadFoodOverrides } = require("./foodOverrides.js");

// A row whose dataQuality opens with "exception:" carries a DOCUMENTED reason
// why the generic check does not apply to it (see the Food.dataQuality comment
// in schema.prisma). The USDA bulk import writes these for the two cases where
// the generic model is wrong rather than the data:
//   * USDA computed the record's energy with food-specific Atwater factors
//     (limes 3.36/8.37/2.48, chicken 4.27/9.02/3.87 — 4,716 of 5,024 records
//     that declare factors are not 4/4/9)
//   * ethanol supplies ~7 kcal/g and is reported in no macro field
// The reason travels ON THE ROW, so an exception is auditable, greppable and
// individually reviewable — it is not a silent pass. A row with no
// dataQuality, or one that merely warns, still fails.
const DOCUMENTED_EXCEPTION = /^exception:/;
const isDocumentedException = (food) => DOCUMENTED_EXCEPTION.test(food.dataQuality || "");

// `injected` ({ foods, recipes }) is for unit testing; at runtime it's omitted
// and the library is read from the DB.
async function runDataQualityAudit(injected) {
  const exemptions = loadFoodOverrides();
  const foods = injected?.foods ?? await prisma.food.findMany();
  const recipes = injected?.recipes ?? await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });

  const foodFailures = [];
  const exceptions = [];
  const placeholders = [];
  for (const f of foods) {
    const { ok, issues } = validateFood(f, { exemptions, validCategories: CATEGORY_SLUGS });
    if (ok) continue;
    if (isDocumentedException(f)) { exceptions.push({ name: f.name, dataQuality: f.dataQuality }); continue; }
    // A zero-macro placeholder is a row honestly announcing that nobody has
    // real data for it yet. It still counts as a failure — that is the point,
    // it must not go quiet — but it is reported separately from a row whose
    // numbers are actually wrong, because the fix is different (find real
    // data or delete the row; never invent a number for it).
    if (issues.every((i) => i.code === "placeholder")) placeholders.push({ name: f.name });
    foodFailures.push({ name: f.name, issues: issues.map((i) => i.code) });
  }

  // Duplicate detection, split by what a duplicate MEANS for each cohort:
  //  * hand-entered rows (no fdcId): two rows folding to one name key is the
  //    same food entered twice — a real bug, and what Phase 2 fixed.
  //  * USDA rows: identity is the fdcId. Thousands of legitimately distinct
  //    FDC records fold to the same loose name key ("Beef, ground" variants),
  //    so name-folding says nothing there; a repeated fdcId is the signal.
  const nonFdc = foods.filter((f) => f.fdcId == null);
  const duplicateGroups = findDuplicateGroups(nonFdc).length;

  const fdcCounts = new Map();
  for (const f of foods) {
    if (f.fdcId == null) continue;
    fdcCounts.set(f.fdcId, (fdcCounts.get(f.fdcId) || 0) + 1);
  }
  const duplicateFdcIdGroups = [...fdcCounts.values()].filter((n) => n > 1).length;

  // Provenance + data-quality breakdown, surfaced every boot so the tier mix
  // and the unvalidated remainder are never invisible.
  const bySource = {};
  for (const f of foods) bySource[f.source] = (bySource[f.source] || 0) + 1;
  const quality = { pass: 0, exception: 0, warn: 0, unvalidated: 0 };
  for (const f of foods) {
    const q = f.dataQuality;
    if (!q) quality.unvalidated++;
    else if (q.startsWith("pass")) quality.pass++;
    else if (q.startsWith("exception:")) quality.exception++;
    else quality.warn++;
  }

  const recipeFailures = [];
  for (const r of recipes) {
    const { ok, issues } = validateRecipe(r);
    if (!ok) recipeFailures.push({ name: r.name, issues: issues.map((i) => i.code) });
  }

  // Stage-C fix (#31): an EMPTY library must never read as "clean". A partial
  // template copy or a wrong-DB misconfiguration produces exactly foods:0 /
  // recipes:0 — the one guardrail that runs every boot has to be able to tell
  // "clean" apart from "uninitialized".
  const empty = foods.length === 0 || recipes.length === 0;
  return {
    foods: foods.length,
    recipes: recipes.length,
    foodFailures,
    recipeFailures,
    duplicateGroups,
    duplicateFdcIdGroups,
    exceptions,
    placeholders,
    bySource,
    quality,
    empty,
    clean: !empty && foodFailures.length === 0 && recipeFailures.length === 0 && duplicateGroups === 0,
  };
}

module.exports = { runDataQualityAudit, isDocumentedException };
