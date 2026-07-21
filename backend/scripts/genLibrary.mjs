// Stage 6 (K) — in-session library generation harness. Reads a JSON file of
// recipe DRAFTS (proposed by the model in-session, on the subscription — $0 API)
// and, for each:
//   1. matches every ingredient to an EXISTING food (token-subset, normalized) —
//      any miss REJECTS the whole recipe (no USDA call, no placeholder, never an
//      invented food); numbers therefore come only from real, audited Food rows;
//   2. computes real macros from those foods;
//   3. runs the nutrition-sanity gate (Atwater 4/4/9 within 15%) + a portion
//      sanity band, and skips duplicates (by folded name key);
//   4. persists survivors as source "ai-generated" through the SAME persistRecipe
//      the app's own generation uses.
// Fully offline, keyless, deterministic. Prints a per-recipe verdict.
//
//   node scripts/genLibrary.mjs <drafts.json>            # persist
//   node scripts/genLibrary.mjs <drafts.json> --dry-run  # validate only, no writes
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/prisma.js");
const { sumMacros, persistRecipe } = require("../src/lib/recipeGeneration.js");
const { nameKey } = require("../src/lib/foodValidation.js");

const draftsPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!draftsPath) { console.error("usage: genLibrary.mjs <drafts.json> [--dry-run]"); process.exit(2); }

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter(Boolean);

const drafts = JSON.parse(fs.readFileSync(draftsPath, "utf8"));
const foods = await prisma.food.findMany();
const byNorm = new Map(foods.map((f) => [norm(f.name), f]));
const foodTokens = foods.map((f) => ({ food: f, t: tokens(f.name) }));

// exact-normalized first, else the food whose token set is a SUPERSET of the
// proposed name's tokens with the fewest extra tokens (closest specific match).
function matchFood(name) {
  const exact = byNorm.get(norm(name));
  if (exact) return exact;
  const want = tokens(name);
  if (!want.length) return null;
  let best = null, bestExtra = Infinity;
  for (const { food, t } of foodTokens) {
    if (want.every((w) => t.includes(w))) {
      const extra = t.length - want.length;
      if (extra < bestExtra) { bestExtra = extra; best = food; }
    }
  }
  return best;
}

const existing = await prisma.recipe.findMany({ select: { name: true } });
const seen = new Set(existing.map((r) => nameKey(r.name)));

let persisted = 0;
const rejects = [];
for (const d of drafts) {
  const key = nameKey(d.name || "");
  if (!d.name || !Array.isArray(d.ingredients) || d.ingredients.length < 2) { rejects.push(`${d.name || "?"} — malformed (need a name + >=2 ingredients)`); continue; }
  if (seen.has(key)) { rejects.push(`${d.name} — duplicate name`); continue; }
  const resolved = [];
  let miss = null;
  for (const ing of d.ingredients) {
    const food = matchFood(ing.name);
    if (!food) { miss = ing.name; break; }
    resolved.push({ foodId: food.id, food, grams: Number(ing.grams) || 0, role: ing.role || "other", scalable: ing.scalable ?? true });
  }
  if (miss) { rejects.push(`${d.name} — no food match for "${miss}"`); continue; }
  if (resolved.some((r) => r.grams <= 0 || r.grams > 1000)) { rejects.push(`${d.name} — a gram amount out of 1..1000`); continue; }
  const m = sumMacros(resolved);
  const atwater = 4 * m.protein + 4 * m.carb + 9 * m.fat;
  if (!(m.kcal > 0) || Math.abs(m.kcal - atwater) > Math.max(40, 0.15 * Math.max(m.kcal, atwater))) { rejects.push(`${d.name} — atwater ${Math.round(m.kcal)} vs ${Math.round(atwater)}`); continue; }
  if (m.kcal < 120 || m.kcal > 1600) { rejects.push(`${d.name} — ${Math.round(m.kcal)} kcal outside a sane 120..1600 per-serving band`); continue; }
  if (dryRun) { console.log(`  OK    ${d.name} — ${Math.round(m.kcal)} kcal P${Math.round(m.protein)} C${Math.round(m.carb)} F${Math.round(m.fat)}`); persisted++; seen.add(key); continue; }
  await persistRecipe({
    name: d.name, description: d.description || null, cuisine: d.cuisine || null,
    slotType: d.slotType === "snack" ? "snack" : "meal", prepTimeMin: d.prepTimeMin || null, steps: d.steps || [],
    ingredients: resolved.map((r) => ({ foodId: r.foodId, grams: r.grams, role: r.role, scalable: r.scalable })), ...m,
  }, { source: "ai-generated" });
  seen.add(key);
  persisted++;
}
console.log(`\n${dryRun ? "would persist" : "persisted"} ${persisted}/${drafts.length}`);
for (const r of rejects) console.log("  REJECT " + r);
await prisma.$disconnect();
