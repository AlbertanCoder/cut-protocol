#!/usr/bin/env node
// Apply the provenance repair decided by scripts/lib/provenanceAudit.js.
//
//   node scripts/repairFoodProvenance.mjs           dry run (default)
//   node scripts/repairFoodProvenance.mjs --apply   write to the database
//   node scripts/repairFoodProvenance.mjs --revert  undo a previous --apply
//                                                   from data/provenance-repair-log.json
//
// Target database: this worktree's backend/prisma/dev.db, resolved explicitly
// (see scripts/lib/prismaLocal.js — a bare PrismaClient here silently targets
// the MAIN repo's database through the shared node_modules junction).
//
// Safety properties:
//   * dry run is the default — you have to ask for writes
//   * every change is written to data/provenance-repair-log.json BEFORE it is
//     applied, with the full prior row, so any row can be restored
//     (CLAUDE.md: every automatic adjustment is logged, visible, reversible)
//   * macro changes cascade: any recipe whose ingredients changed has its
//     cached per-serving macros recomputed in the same transaction, so the
//     startup [data-audit] cannot be left reporting recipe drift
//   * no row ever gets a guessed number — see provenanceAudit.js

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeLocalPrisma, localDatabaseUrl } = require("./lib/prismaLocal.js");
const { buildMatchIndex } = require("./lib/fdcMatch.js");
const { auditFoods } = require("./lib/provenanceAudit.js");
const { loadFoodOverrides } = require("../src/lib/foodOverrides.js");
const { computeRecipeMacros } = require("../src/lib/foodValidation.js");
const { extractMicros } = require("./lib/fdcMicros.js");
const { CACHE_DIR } = require("./lib/fdcDataset.js");

const apply = process.argv.includes("--apply");
const revert = process.argv.includes("--revert");
const fixture = process.argv.includes("--fixture");
const LOG_FILE = path.resolve(import.meta.dirname, "..", "data", "provenance-repair-log.json");

console.log(`Database: ${localDatabaseUrl()}`);

// ── revert ───────────────────────────────────────────────────────────────
// Restores every row this script previously changed to its logged `before`
// state, then recomputes the recipe caches from the restored foods. Rows the
// log does not mention are never touched, so a concurrent agent's inserts
// survive a revert untouched.
if (revert) {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`No change log at ${LOG_FILE} — nothing to revert.`);
    process.exit(2);
  }
  const log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  const prisma = makeLocalPrisma();
  let restored = 0, missing = 0;
  await prisma.$transaction(async (tx) => {
    for (const c of log.changes) {
      const exists = await tx.food.findUnique({ where: { id: c.id } });
      if (!exists) { missing++; continue; }
      await tx.food.update({ where: { id: c.id }, data: c.before });
      restored++;
    }
  }, { timeout: 120_000 });

  const { computeRecipeMacros: recompute } = require("../src/lib/foodValidation.js");
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  let recipeFixed = 0;
  for (const r of recipes) {
    const t = recompute(r.ingredients);
    const per = { kcal: Math.round(t.kcal * 10) / 10, protein: Math.round(t.protein * 10) / 10, fat: Math.round(t.fat * 10) / 10, carb: Math.round(t.carb * 10) / 10 };
    if (["kcal", "protein", "fat", "carb"].some((k) => Math.abs(r[k] - per[k]) > 0.05)) {
      await prisma.recipe.update({ where: { id: r.id }, data: per });
      recipeFixed++;
    }
  }
  console.log(`Reverted ${restored} food rows (${missing} no longer present), recomputed ${recipeFixed} recipe caches.`);
  await prisma.$disconnect();
  process.exit(0);
}

const indexFile = path.join(CACHE_DIR, fixture ? "fdc-index.fixture.json" : "fdc-index.json");
if (!fs.existsSync(indexFile)) {
  console.error(`Missing ${indexFile}. Run: node scripts/downloadFdcDatasets.mjs && node scripts/buildFdcIndex.mjs`);
  process.exit(2);
}
const idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
const byFdcId = new Map(idx.records.map((r) => [r.fdcId, r]));
const matchIndex = buildMatchIndex(idx.records);

const prisma = makeLocalPrisma();
const foods = await prisma.food.findMany();
const { decisions, summary } = auditFoods(foods, byFdcId, matchIndex, loadFoodOverrides());
const byId = new Map(foods.map((f) => [f.id, f]));

const MACRO_KEYS = ["kcal", "protein", "fat", "carb", "fiber"];
const changes = [];
for (const d of decisions) {
  if (!d.changes) continue;
  const row = byId.get(d.id);
  const after = {};
  for (const [k, v] of Object.entries(d.changes)) {
    if (row[k] !== v) after[k] = v;
  }
  // Micronutrients ride along for rows we can attribute to a real FDC record,
  // so the bulk import does not have to make a second pass over these.
  // Absent keys stay absent — never zero-filled (see lib/fdcMicros.js).
  if (d.record && row.micros == null && d.record.micros) {
    after.micros = d.record.micros;
  }
  if (Object.keys(after).length === 0) continue;
  changes.push({
    id: d.id,
    name: d.name,
    verdict: d.verdict,
    reason: d.reason,
    before: Object.fromEntries(Object.keys(after).map((k) => [k, row[k]])),
    after,
    macrosTouched: MACRO_KEYS.some((k) => k in after),
  });
}

console.log(`Foods: ${summary.foods} | claiming an fdcId: ${summary.withFdcId}`);
console.log(`Verdicts: ${JSON.stringify(summary.all)}`);
console.log(`Rows to change: ${changes.length} (${changes.filter((c) => c.macrosTouched).length} with macro changes)`);

// ── which recipes are affected ───────────────────────────────────────────
const touchedFoodIds = new Set(changes.filter((c) => c.macrosTouched).map((c) => c.id));
const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
const affectedRecipes = recipes.filter((r) => r.ingredients.some((i) => touchedFoodIds.has(i.foodId)));
console.log(`Recipes referencing a changed food: ${affectedRecipes.length} of ${recipes.length}`);

if (!apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to commit these changes.");
  console.log("Sample:");
  for (const c of changes.slice(0, 8)) {
    console.log(`  [${c.verdict}] ${c.name}`);
    console.log(`      ${JSON.stringify(c.before)}  ->  ${JSON.stringify(c.after)}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

// Log BEFORE writing, so a crash mid-apply still leaves a restore path.
fs.writeFileSync(LOG_FILE, JSON.stringify({
  appliedAt: new Date().toISOString(),
  fdcIndex: { builtAt: idx.builtAt, records: idx.records.length, datasets: idx.datasets },
  summary,
  changes,
}, null, 2));
console.log(`\nChange log written: ${path.relative(process.cwd(), LOG_FILE)}`);

const newMacros = new Map(changes.filter((c) => c.macrosTouched).map((c) => [c.id, c.after]));
let recipeUpdates = 0;

await prisma.$transaction(async (tx) => {
  for (const c of changes) {
    await tx.food.update({ where: { id: c.id }, data: c.after });
  }
  for (const r of affectedRecipes) {
    const ingredients = r.ingredients.map((i) => {
      const patch = newMacros.get(i.foodId);
      return { baseGrams: i.baseGrams, food: patch ? { ...i.food, ...patch } : i.food };
    });
    // Recipe.kcal is the cached per-serving total at base ingredient grams —
    // exactly the ingredient sum, which is what validateRecipe() checks it
    // against. There is no servings divisor on this model.
    const totals = computeRecipeMacros(ingredients);
    const per = {
      kcal: Math.round(totals.kcal * 10) / 10,
      protein: Math.round(totals.protein * 10) / 10,
      fat: Math.round(totals.fat * 10) / 10,
      carb: Math.round(totals.carb * 10) / 10,
    };
    if (["kcal", "protein", "fat", "carb"].some((k) => Math.abs(r[k] - per[k]) > 0.05)) {
      await tx.recipe.update({ where: { id: r.id }, data: per });
      recipeUpdates++;
    }
  }
}, { timeout: 120_000 });

console.log(`Applied: ${changes.length} food rows updated, ${recipeUpdates} recipe macro caches recomputed.`);
await prisma.$disconnect();
