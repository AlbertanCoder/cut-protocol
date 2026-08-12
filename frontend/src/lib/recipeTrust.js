// Ingredient-trust signal for one recipe — shared by the full Recipes tab
// (components/RecipesTab.jsx) and the simple surface's recipe sheet
// (simple/SimpleRecipes.jsx).
//
// MOVED VERBATIM from RecipesTab.jsx (simple-declutter audit 2026-08-11,
// Order of Work item 8). `recipe.trust` was never a field the API returns, so
// the simple sheet's honesty panel could never fire — while the full tab
// measured that 779 of 889 recipes carry at least one ingredient with another
// food's macros. Both surfaces now read this ONE notion of "untrusted"
// instead of inventing two.
//
// Nothing here feeds a calorie, macro, target or payload: `share` measures
// how much of the recipe's STATED kcal total comes from rows quarantineNote
// flags. It is a caveat about the record, never a correction of the number.
import { quarantineNote } from "../data/foodCategories.js";

// ── the original design rationale, unabridged ────────────────────────────
// The startup audit fails 779 of 889 recipes with `untrusted-ingredients`,
// and NONE of it reached the screen. A recipe built on a row carrying another
// food's macros rendered identically to a clean one — same layout, same badge
// row, same confident bold kcal number. validateRecipe's own detail string
// says the total "should read 'incomplete data'"; the server computed that and
// the client dropped it on the floor. Exactly the bug DraftCard calls out for
// `allergenViolation` in RecipesTab.jsx.
//
// The food rows arrive complete (RECIPE_INCLUDE is `{ ingredients: { include:
// { food: true } } }`), so `dataQuality` / `source` are already here — this
// reads the same `quarantineNote` FoodsTab uses, rather than inventing a
// second notion of what "untrusted" means.
//
// PROPORTIONALITY, which is the whole design problem. The backend flag is
// BINARY: one quarantined row out of twenty trips it, which is how 88% of the
// library ends up "failing". Rendering that verdict on 779 of 889 recipes
// would be pure alarm fatigue — a warning on almost everything teaches the
// user to ignore it, and that is strictly worse than silence, because the
// handful of recipes whose calories are genuinely half-fiction get the same
// grey noise as one with a quarantined pinch of salt.
//
// So loudness follows the SHARE of the recipe's stated calories that comes
// from untrusted rows:
//   * any untrusted ingredient       -> named in the expanded detail, always
//   * >= MATERIAL_SHARE of calories  -> amber marker on the collapsed row too
// Amber, never red (design law b): a caveat about the record, not a verdict on
// the food.
//
// THE THRESHOLD IS MEASURED, NOT GUESSED. Against the real 889-recipe library
// (counted in-page, see the findings note on this change):
//     >=1 untrusted ingredient   779  (87.6%)   <- the audit's own number
//     >= 5% of calories          723  (81.3%)
//     >=15% of calories          677  (76.2%)
//     >=25% of calories          624  (70.2%)
//     >=40% of calories          483  (54.3%)
//     >=60% of calories          303  (34.1%)
//     >=80% of calories          141  (15.9%)
//     median share among flagged      51.7%
// The first pass used 15% on the assumption that the cascade was mostly
// trivial — a quarantined pinch of salt tripping a binary flag. THE DATA SAYS
// OTHERWISE: the median affected recipe draws HALF its calories from rows
// carrying another food's macros. The 88% is largely earned, and no threshold
// makes this library look calm without lying about it.
//
// So the row marker is set where it still discriminates AND still means
// something a user can act on — "more of this total is another food's than is
// this one's". Everything below that is carried by the always-on detail panel
// and by the library-wide summary line, which states the true scale ONCE
// instead of stamping it on three rows out of four.
//
// SOLVER-SIDE GATE (2026-08-12, owner ruling on QC 2026-08-10 item 2):
// backend/src/lib/exclusionGate.js `recipeTrustExclusion` makes ANY recipe
// with an untrusted non-placeholder row ineligible as a PLAN candidate —
// deliberately STRICTER than this display threshold. MATERIAL_SHARE decides
// only how LOUD the browse marker is (collapsed-row amber at >= 0.6); a
// non-null trustReport at any share means the recipe sits out of automatic
// planning, and both surfaces say so in the detail. Browse stays untouched.
export const MATERIAL_SHARE = 0.6;

export const ingredientKcal = (i) => ((i.food?.kcal || 0) * (i.baseGrams || 0)) / 100;

export function trustReport(recipe) {
  const rows = recipe?.ingredients || [];
  const flagged = [];
  let untrustedKcal = 0;
  let totalKcal = 0;
  for (const i of rows) {
    const kcal = ingredientKcal(i);
    totalKcal += kcal;
    const note = quarantineNote(i.food);
    if (!note) continue;
    untrustedKcal += kcal;
    flagged.push({ name: i.food?.name || "unnamed ingredient", detail: note.detail });
  }
  if (flagged.length === 0) return null;
  // Share of the STATED total — the number actually on screen. The untrusted
  // row's own kcal is itself the wrong food's, so this measures how much of
  // the displayed figure is in question. It is not a correction of it, and is
  // deliberately not presented as one.
  const share = totalKcal > 0 ? untrustedKcal / totalKcal : 0;
  // planExcluded mirrors the backend gate's any-flagged verdict: a non-null
  // report means the solver will not build a plan on this recipe.
  return { flagged, share, material: share >= MATERIAL_SHARE, planExcluded: true };
}
