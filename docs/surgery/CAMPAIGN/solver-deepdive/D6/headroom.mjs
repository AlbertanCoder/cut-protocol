// D6 — headroom. Re-runs the gate's own recipe verdict with a hand-judged set
// of FALSE (food, term) exclusions neutralised, and diffs the pool. The
// judgement set was built by READING each row (see readrows.mjs output), not by
// re-running the gate's vocabulary — that is the point.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const { PrismaClient } = require(path.join(ROOT, "backend/node_modules/@prisma/client"));
const gate = require(path.join(ROOT, "backend/src/lib/exclusionGate.js"));
const df = require(path.join(ROOT, "backend/src/lib/dietaryFilter.js"));

const prisma = new PrismaClient({
  datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D6/dev-copy.db" } },
});
const recipes = await prisma.recipe.findMany({ select: gate.RECIPE_GATE_SELECT });

// ── the judgement set. foodName -> terms it must NOT be excluded for. ──────
// Each entry is justified in D6-FINDINGS.md by reading the row's identity,
// fdcId provenance and macros.
const FALSE = new Map(Object.entries({
  // paired FDC category "Dairy and Egg Products" -> egg fires on pure dairy
  "Heavy Cream": ["eggs"], "Feta": ["eggs"], "Cream Cheese": ["eggs"],
  "Cheddar Cheese": ["eggs"], "Dulce de leche": ["eggs"], "Salted Butter": ["eggs"],
  "Gouda Cheese": ["eggs"], "Cheese, parmesan, grated": ["eggs"],
  "Cheese, swiss, low fat": ["eggs"], "Swiss Cheese": ["eggs"],
  "Full fat sour cream": ["eggs"],
  // paired FDC category "Finfish and Shellfish Products" -> both families
  "Shrimp": ["fish"], "Conchs": ["fish"], "Smoked Haddock": ["shellfish"],
  "Monkfish": ["shellfish"], "Fish, tuna, light, canned in water, drained solids": ["shellfish"],
  "Frogs Legs": ["fish", "shellfish"],
  // "Soy-based condiments" shelf label on non-soy condiments
  "Fish Sauce": ["soy"],
  // "Baked Products" category inherited from a CORRUPTED donor record
  "Cinnamon": ["gluten"], "Peaches": ["gluten"], "Oatmeal": ["gluten"],
  // gluten-free-grain adjacency guard not wired to `pasta` / `noodle`
  "Lentil pasta, dry": ["gluten"], "Chickpea pasta, dry": ["gluten"],
  "Rice Noodles": ["gluten"],
  // plain name false friends
  "Oyster Mushrooms": ["shellfish"], "flax eggs": ["eggs"],
}));

function exempt(row, term) {
  const t = String(term).trim().toLowerCase();
  const list = FALSE.get(row?.name);
  return !!(list && list.includes(t));
}

// Mirror of exclusionGate.explainRecipeExclusion, with the exemption applied.
function verdictFixed(recipe, profile) {
  const dietaryStyle = profile.dietaryStyle || "none";
  const excludedFoods = profile.excludedFoods || [];
  const { rows, gap } = gate.collectEvidence(recipe);
  if (gap) return true;
  if (df.recipeExceedsKetoCeiling(recipe, dietaryStyle)) return true;
  if (df.recipeExcludedByStyle({ ingredients: rows }, dietaryStyle)) return true;
  for (const term of excludedFoods) {
    if (rows.some((row) => !exempt(row, term) && df.foodMatchesExclusionTerm(row, term))) return true;
  }
  return false;
}

const PERSONAS = [
  ["egg allergy", "none", ["eggs"]],
  ["gluten (celiac)", "none", ["gluten"]],
  ["fish allergy", "none", ["fish"]],
  ["shellfish allergy", "none", ["shellfish"]],
  ["soy allergy", "none", ["soy"]],
  ["dairy allergy", "none", ["dairy"]],
  ["dairy+gluten", "none", ["dairy", "gluten"]],
  ["dairy+gluten+soy", "none", ["dairy", "gluten", "soy"]],
  ["vegetarian+egg", "vegetarian", ["eggs"]],
  ["vegan+gluten", "vegan", ["gluten"]],
  ["vegetarian+gluten", "vegetarian", ["gluten"]],
  ["keto+dairy", "keto", ["dairy"]],
  ["mediterranean+shellfish", "mediterranean", ["shellfish"]],
];
const R = recipes.length;
console.log("persona                     now    fixed   recovered  (of 910)");
for (const [label, style, ex] of PERSONAS) {
  const p = { dietaryStyle: style, excludedFoods: ex };
  const now = recipes.filter((r) => !gate.explainRecipeExclusion(r, p).excluded).length;
  const fixed = recipes.filter((r) => !verdictFixed(r, p)).length;
  const d = fixed - now;
  console.log(`${label.padEnd(26)} ${String(now).padStart(4)}   ${String(fixed).padStart(5)}   ${(d > 0 ? "+" + d : String(d)).padStart(7)}   ${(now / R * 100).toFixed(1)}% -> ${(fixed / R * 100).toFixed(1)}%`);
}
await prisma.$disconnect();
