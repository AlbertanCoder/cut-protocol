// Bridges an Open Food Facts lookup to the shared fiber-adjusted-Atwater
// validator (foodValidation.js — owned by the USDA-import track, imported
// here and never modified) and turns its verdict into the Food.dataQuality
// string the schema and the startup [data-audit] report both expect.
//
// Policy (CLAUDE.md: "reject or flag rows whose declared macros do not
// reconcile with declared calories"):
//   HARD-REJECT — the row is physically broken, nothing gets saved:
//     missing  a required macro isn't even a number
//     negative a macro is negative
//     absurd   kcal/macros exceed physically possible values
//     zero-kcal kcal is 0 but macros are present (classic incomplete
//               community record)
//   FLAG (import anyway, recorded loudly) — the row is internally
//   parseable but its own numbers don't reconcile, which is exactly the
//   crowd-sourced-panel problem this track exists to guard against:
//     atwater     kcal doesn't reconcile with 4P+4C+9F (fiber-adjusted)
//     name-shape  the product name implies a macro shape the numbers
//                 contradict (rare for specific branded names, checked
//                 anyway — the validator is generic)
const { validateFood } = require("./foodValidation.js");
const { classifyFood, CATEGORY_SLUGS } = require("./foodCategories.js");

const HARD_REJECT_CODES = new Set(["missing", "negative", "absurd", "zero-kcal", "category", "placeholder"]);

/**
 * candidate: { name, category, kcal, protein, fat, carb, fiber, source }
 * Returns { verdict: "pass" | "warn" | "reject", dataQuality: string|null,
 *           issues, hardIssues, softIssues }
 * dataQuality is null only for a "reject" verdict — a rejected row is never
 * persisted, so it never gets a dataQuality value at all.
 */
function assessImport(candidate) {
  const { issues } = validateFood(candidate, { validCategories: CATEGORY_SLUGS });
  const hardIssues = issues.filter((i) => HARD_REJECT_CODES.has(i.code));
  const softIssues = issues.filter((i) => !HARD_REJECT_CODES.has(i.code));

  if (hardIssues.length > 0) {
    return { verdict: "reject", dataQuality: null, issues, hardIssues, softIssues };
  }
  if (softIssues.length > 0) {
    return { verdict: "warn", dataQuality: `warn:${softIssues.map((i) => i.code).join(",")}`, issues, hardIssues, softIssues };
  }
  return { verdict: "pass", dataQuality: "pass", issues: [], hardIssues: [], softIssues: [] };
}

/**
 * Turns an openFoodFactsClient.lookupUpc() "found" result into a
 * Food-shaped candidate ready for validateFood()/prisma.food.create().
 * Category is classified from the product name with the SAME classifier
 * every other import path uses (usdaClient, ingredientResolver) — never
 * taken from OFF's own unrelated category taxonomy. source is always
 * "community": this function can never produce "usda-verified", keeping
 * the provenance tiers structurally un-mixable, not just conventionally.
 */
function candidateFromOffProduct(product) {
  const { category } = classifyFood(product.name);
  return {
    name: product.name,
    category,
    kcal: product.per100g.kcal,
    protein: product.per100g.protein,
    fat: product.per100g.fat,
    carb: product.per100g.carb,
    fiber: product.per100g.fiber,
    upc: product.upc,
    brand: product.brand,
    source: "community",
    // micros contract (Food.micros): { [nutrientKey]: amount } per 100g, or
    // null for honest absence — never guessed, never a 0 standing in for
    // "unreported". validateFood() never looks at this field (it's outside
    // the Atwater/macro contract), so it rides along unmodified either way.
    micros: product.micros ?? null,
  };
}

module.exports = { assessImport, candidateFromOffProduct, HARD_REJECT_CODES };
