// poolAdmissionSweep.mjs — measure the recipe pool against the Phase-1 gates.
//
//   DATABASE_URL=file:./rebuild-qa.db node scripts/poolAdmissionSweep.mjs
//
// Runs every recipe in the connected DB through:
//   1. RESOLUTION   — every ingredient resolves to a Food with complete
//                     kcal/protein/fat/carb (nutritionCore.macroTotals.ok)
//   2. SANITY       — recipeSanityGate bounds (kcal/serving, protein ceiling,
//                     implausible grams, seasoning bounds)
//   3. DRIFT        — cached Recipe.kcal vs FDC-computed, >15% flagged
//   4. TRUST        — the existing recipeTrustExclusion (quarantined macros)
// and then sizes the ADMITTED pool per persona-shaped exclusion profile.
//
// Read-only against the DB. Writes one markdown report and prints a summary.
// Never point this at a database you are not allowed to open.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/prisma.js");
const { macroTotals } = require("../src/lib/nutritionCore.js");
const { sanityCheckRecipe } = require("../src/lib/recipeSanityGate.js");
const { filterRecipes, recipeTrustExclusion } = require("../src/lib/exclusionGate.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT = path.resolve(__dirname, "../../docs/qc/pool-admission-2026-08-19.md");

const PERSONAS = [
  { id: "P0", label: "founder profile — shellfish/gluten/kiwi/soy", profile: { dietaryStyle: null, excludedFoods: ["shellfish", "gluten", "kiwi", "soy"] } },
  { id: "P1", label: "celiac vegan", profile: { dietaryStyle: "vegan", excludedFoods: ["gluten"] } },
  { id: "P2", label: "soy + wheat allergy", profile: { dietaryStyle: null, excludedFoods: ["soy", "wheat"] } },
  { id: "P3", label: "keto", profile: { dietaryStyle: "keto", excludedFoods: [] } },
  { id: "P5", label: "pescatarian", profile: { dietaryStyle: "pescatarian", excludedFoods: [] } },
  { id: "P6", label: "lactose-intolerant (dairy wall)", profile: { dietaryStyle: null, excludedFoods: ["lactose"] } },
];

const recipes = await prisma.recipe.findMany({
  include: { ingredients: { include: { food: true } } },
});

const rows = [];
for (const r of recipes) {
  const ings = r.ingredients.map((i) => ({ foodId: i.foodId, grams: i.baseGrams, name: i.food?.name }));
  const foodsById = new Map(r.ingredients.map((i) => [i.foodId, i.food]));
  const { ok: resolved, totals, missing } = macroTotals(ings, foodsById);
  const sanity = sanityCheckRecipe({ name: r.name, ingredients: ings }, { totals: resolved ? totals : null, foodsById });
  const trust = recipeTrustExclusion(r);
  const driftPct = resolved && totals.kcal > 0 && Number.isFinite(r.kcal)
    ? Math.abs(r.kcal - totals.kcal) / totals.kcal * 100
    : null;
  rows.push({
    id: r.id, name: r.name, slotType: r.slotType, source: r.source, mealCategory: r.mealCategory,
    resolved, missing, sanity, trusted: !trust.excluded, trustReason: trust.excluded ? trust.reason : null,
    kcalCached: r.kcal, kcalComputed: resolved ? Math.round(totals.kcal * 10) / 10 : null, driftPct,
    recipe: r,
  });
}

const failResolution = rows.filter((x) => !x.resolved);
const failSanity = rows.filter((x) => x.resolved && !x.sanity.ok);
const warnOnly = rows.filter((x) => x.resolved && x.sanity.ok && x.sanity.issues.length > 0);
const failTrust = rows.filter((x) => !x.trusted);
const drifted = rows.filter((x) => x.driftPct !== null && x.driftPct > 15);
const admitted = rows.filter((x) => x.resolved && x.sanity.ok && x.trusted);

const personaCounts = PERSONAS.map((p) => {
  const pool = filterRecipes(admitted.map((x) => x.recipe), p.profile);
  const meals = pool.filter((r) => r.slotType !== "snack" && !["dessert", "bread_or_pastry_side", "condiment_or_sauce"].includes(r.mealCategory || ""));
  const snacks = pool.filter((r) => r.slotType === "snack" || r.slotType === "either");
  return { ...p, total: pool.length, meals: meals.length, snacks: snacks.length };
});

const fmtFail = (x) =>
  `- **${x.name}** (${x.source}) — ${x.sanity.issues.filter((i) => i.severity === "fail").map((i) => i.message).join("; ")}`;

const lines = [];
lines.push("# Pool admission sweep — seeded pool, 2026-08-19");
lines.push("");
lines.push(`Database: isolated \`rebuild-qa.db\` built from migrations + the three seed scripts`);
lines.push(`(the same construction CI uses — NOT the owner's library).`);
lines.push("");
lines.push(`| Gate | Count | of ${rows.length} |`);
lines.push(`|---|---:|---:|`);
lines.push(`| Admitted (resolution ✓ sanity ✓ trust ✓) | **${admitted.length}** | ${(admitted.length / rows.length * 100).toFixed(1)}% |`);
lines.push(`| Failed resolution (ingredient without complete macros) | ${failResolution.length} | ${(failResolution.length / rows.length * 100).toFixed(1)}% |`);
lines.push(`| Failed sanity bounds | ${failSanity.length} | ${(failSanity.length / rows.length * 100).toFixed(1)}% |`);
lines.push(`| Sanity warnings only (admitted, flagged for curation) | ${warnOnly.length} | ${(warnOnly.length / rows.length * 100).toFixed(1)}% |`);
lines.push(`| Trust-excluded (existing quarantine rule) | ${failTrust.length} | ${(failTrust.length / rows.length * 100).toFixed(1)}% |`);
lines.push(`| Cached-vs-computed kcal drift >15% | ${drifted.length} | ${(drifted.length / rows.length * 100).toFixed(1)}% |`);
lines.push("");
lines.push("## Persona pools (over the ADMITTED set)");
lines.push("");
lines.push("| Persona | Pool | Meal-eligible | Snack-eligible |");
lines.push("|---|---:|---:|---:|");
for (const p of personaCounts) lines.push(`| ${p.id} — ${p.label} | ${p.total} | ${p.meals} | ${p.snacks} |`);
lines.push("");
lines.push("## Sanity failures, in full");
lines.push("");
for (const x of failSanity) lines.push(fmtFail(x));
lines.push("");
lines.push("## Resolution failures, in full");
lines.push("");
for (const x of failResolution) lines.push(`- **${x.name}** (${x.source}) — unresolved foodIds: ${x.missing.join(", ")}`);
lines.push("");
lines.push("## Drift >15%, in full");
lines.push("");
for (const x of drifted) lines.push(`- **${x.name}** — cached ${x.kcalCached} vs computed ${x.kcalComputed} (${x.driftPct.toFixed(1)}%)`);
lines.push("");

fs.writeFileSync(REPORT, lines.join("\n"));

console.log(`recipes ${rows.length} · admitted ${admitted.length} · failSanity ${failSanity.length} · failResolution ${failResolution.length} · trustExcluded ${failTrust.length} · drift>15% ${drifted.length}`);
for (const p of personaCounts) console.log(`${p.id} ${p.label}: pool ${p.total} (meals ${p.meals}, snacks ${p.snacks})`);
console.log(`report → ${REPORT}`);
await prisma.$disconnect();
