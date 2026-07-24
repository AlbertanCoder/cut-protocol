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
const { normaliseAllergenTags } = require("./dietaryFilter.js");

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
  const { allergenTags, mayContain } = allergenFieldsFromOffProduct(product);
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
    // Allergen contract (Food.allergenTags / Food.mayContain): a JSON array of
    // normalised OFF tag slugs, or null for honest absence. See below — this
    // is finding dietary-safety-4: the manufacturer's own allergen declaration
    // was fetched and dropped on the floor, leaving name keywords as the only
    // evidence for a BRANDED product, which is exactly the case where a name
    // ("Choco Delight") tells you nothing.
    allergenTags,
    mayContain,
  };
}

/**
 * Pull the allergen declaration off an Open Food Facts result.
 *
 * Accepts three shapes on purpose, because the raw field names and the
 * normalised ones both legitimately reach this function:
 *   - `allergenTags` / `mayContain`     already normalised upstream
 *   - `allergens_tags` / `traces_tags`  OFF's own raw field names
 *   - `raw.allergens_tags` / `raw.traces_tags`  a pass-through envelope
 *
 * Returns null (never []) when the source carried no declaration at all —
 * "Open Food Facts doesn't know" and "the manufacturer declares none" are
 * different facts and the schema keeps them different. An empty array from the
 * source is preserved as [] for exactly that reason.
 *
 * NOTE (open, tracked in docs/qc/handoff/agent04.md): openFoodFactsClient.js
 * does not currently request `allergens_tags`/`traces_tags` in its FIELDS list
 * nor pass them through lookupUpc(), and that file is outside this agent's
 * ownership. Until that one-line change lands, this function is correct but
 * receives nothing — it is wired, tested, and dormant, not speculative.
 */
function allergenFieldsFromOffProduct(product) {
  const p = product || {};
  const raw = p.raw || {};
  const declared = p.allergenTags ?? p.allergens_tags ?? raw.allergens_tags ?? p.allergens ?? raw.allergens ?? null;
  const traces = p.mayContain ?? p.traces_tags ?? raw.traces_tags ?? p.traces ?? raw.traces ?? null;
  return {
    allergenTags: normaliseAllergenTags(declared),
    mayContain: normaliseAllergenTags(traces),
  };
}

module.exports = { assessImport, candidateFromOffProduct, allergenFieldsFromOffProduct, HARD_REJECT_CODES };
