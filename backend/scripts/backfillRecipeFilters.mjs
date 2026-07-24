#!/usr/bin/env node
// backfillRecipeFilters.mjs — Stage 3. Derive the missing five-filter values
// for the real recipe library, OFFLINE and DETERMINISTICALLY.
//
//   node scripts/backfillRecipeFilters.mjs                  DRY RUN (default)
//   node scripts/backfillRecipeFilters.mjs --apply          write, one transaction
//   node scripts/backfillRecipeFilters.mjs --db=<path>      target another db file
//   node scripts/backfillRecipeFilters.mjs --json=<path>    write the full preview
//   node scripts/backfillRecipeFilters.mjs --limit=N        sample N recipes
//
// WHAT IT DERIVES, and the provenance it stamps:
//   costPerServing  computeRecipeCost()   -> "estimated"
//   prepMin         estimatePrepMin()     -> "estimated"  (only where NULL —
//                                            a real measured value is never
//                                            overwritten by an estimate)
//   difficulty      computeComplexity()   -> "estimated"
//
// PROVENANCE IS NOT OPTIONAL. The constitution requires it on every entry and
// requires that estimates never masquerade as measurements. This script writes
// Recipe.filterProvenance as a JSON map {field: "estimated"|"measured"} so a
// later reader can always tell which of the three numbers it is looking at.
//
// SAFETY:
//   * DRY RUN opens the database READ-ONLY. It is physically unable to write.
//   * --apply opens read-write and wraps every UPDATE in ONE transaction:
//     all rows land or none do.
//   * It refuses to create a database. node:sqlite will happily CREATE an empty
//     file at a mistyped path; the existence check below stops that, because an
//     empty dev.db that boots and shows zero recipes is worse than a crash.
//   * It writes ONLY to columns that already exist. Missing columns are
//     reported with the exact DDL needed — this script never runs a migration.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeRecipeCost } = require("../src/lib/recipeCost.js");
const { computeComplexity, estimatePrepMin } = require("../src/lib/recipeComplexity.js");

const BACKEND = path.resolve(path.join(import.meta.dirname, ".."));
const DEFAULT_DB = path.join(BACKEND, "prisma", "dev.db");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const APPLY = flag("apply");
const DB_PATH = path.resolve(value("db") || DEFAULT_DB);
const JSON_OUT = value("json");
const LIMIT = Number(value("limit")) || null;

// Target columns. `prepTimeMin` is the one that already exists; the other three
// need the migration printed at the end of this run.
const TARGETS = [
  { column: "costPerServing", kind: "REAL", field: "costPerServing" },
  { column: "prepTimeMin", kind: "INTEGER", field: "prepMin" },
  { column: "difficulty", kind: "INTEGER", field: "difficulty" },
  { column: "filterProvenance", kind: "TEXT", field: "provenance" },
];

function fail(msg) {
  console.error(`[backfill] FAIL — ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  fail(`no database at ${DB_PATH}. Refusing to continue — opening a SQLite handle on a missing path CREATES an empty database, and an empty dev.db is a silent data loss, not an error.`);
}

console.log(`[backfill] db        ${DB_PATH}`);
console.log(`[backfill] mode      ${APPLY ? "APPLY (writes, single transaction)" : "DRY RUN (read-only handle)"}`);

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });

// ── column discovery ───────────────────────────────────────────────────────
const existingCols = new Set(db.prepare("PRAGMA table_info(Recipe)").all().map((r) => r.name));
const present = TARGETS.filter((t) => existingCols.has(t.column));
const missing = TARGETS.filter((t) => !existingCols.has(t.column));

// ── load ───────────────────────────────────────────────────────────────────
const recipeRows = db
  .prepare(`SELECT id, name, steps, prepTimeMin, tasteTier, userRatingAvg, userRatingCount FROM Recipe ORDER BY id${LIMIT ? ` LIMIT ${LIMIT}` : ""}`)
  .all();

const ingRows = db
  .prepare("SELECT ri.recipeId, ri.baseGrams, f.name AS foodName, f.category AS foodCategory FROM RecipeIngredient ri JOIN Food f ON f.id = ri.foodId")
  .all();

const byRecipe = new Map();
for (const r of ingRows) {
  if (!byRecipe.has(r.recipeId)) byRecipe.set(r.recipeId, []);
  byRecipe.get(r.recipeId).push({ baseGrams: r.baseGrams, food: { name: r.foodName, category: r.foodCategory } });
}

// ── coverage BEFORE ────────────────────────────────────────────────────────
const total = recipeRows.length;
const coverageBefore = {
  costPerServing: existingCols.has("costPerServing")
    ? db.prepare("SELECT COUNT(*) c FROM Recipe WHERE costPerServing IS NOT NULL").get().c
    : 0,
  prepMin: recipeRows.filter((r) => r.prepTimeMin != null).length,
  difficulty: existingCols.has("difficulty")
    ? db.prepare("SELECT COUNT(*) c FROM Recipe WHERE difficulty IS NOT NULL").get().c
    : 0,
  provenance: existingCols.has("filterProvenance")
    ? db.prepare("SELECT COUNT(*) c FROM Recipe WHERE filterProvenance IS NOT NULL").get().c
    : 0,
};

// ── derive ─────────────────────────────────────────────────────────────────
const derived = [];
const calibration = []; // |estimate - measured| on rows that already have a real prepTimeMin

for (const row of recipeRows) {
  const recipe = { id: row.id, name: row.name, steps: row.steps, ingredients: byRecipe.get(row.id) || [] };
  const cost = computeRecipeCost(recipe);
  const complexity = computeComplexity(recipe);
  const prep = estimatePrepMin(recipe);

  if (row.prepTimeMin != null) calibration.push({ id: row.id, measured: row.prepTimeMin, estimated: prep.minutes });

  // A measured prepTimeMin is authoritative and is never overwritten.
  const prepMinFinal = row.prepTimeMin != null ? row.prepTimeMin : prep.minutes;
  const prepProvenance = row.prepTimeMin != null ? "measured" : "estimated";

  derived.push({
    id: row.id,
    name: row.name,
    costPerServing: cost.costCad,
    costCoverage: cost.coverage,
    costTier: cost.tier,
    prepMin: prepMinFinal,
    prepWasNull: row.prepTimeMin == null,
    difficulty: complexity.score,
    difficultyBand: complexity.band,
    provenance: JSON.stringify({ costPerServing: "estimated", prepTimeMin: prepProvenance, difficulty: "estimated" }),
  });
}

// ── calibration report (honest fit check, every run) ───────────────────────
const errs = calibration.map((c) => Math.abs(c.estimated - c.measured)).sort((a, b) => a - b);
const pct = (p) => (errs.length ? errs[Math.min(errs.length - 1, Math.max(0, Math.ceil(p * errs.length) - 1))] : null);
const within = (n) => (errs.length ? Math.round((errs.filter((e) => e <= n).length / errs.length) * 1000) / 10 : null);
const meanErr = errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length) * 10) / 10 : null;

// ── report ─────────────────────────────────────────────────────────────────
const nl = () => console.log("");
nl();
console.log(`[backfill] recipes   ${total}`);
console.log(`[backfill] columns   present: ${present.map((t) => t.column).join(", ") || "(none)"}`);
if (missing.length) console.log(`[backfill] columns   MISSING: ${missing.map((t) => t.column).join(", ")}`);

nl();
console.log("FIELD COVERAGE (of " + total + " recipes)");
console.log("  field            before        after (this run)   writable now");
for (const t of TARGETS) {
  const before = coverageBefore[t.field];
  const canWrite = existingCols.has(t.column);
  const after = canWrite ? total : before;
  const pctOf = (n) => `${n}/${total} (${Math.round((n / total) * 1000) / 10}%)`;
  console.log(`  ${t.column.padEnd(16)} ${pctOf(before).padEnd(13)} ${pctOf(after).padEnd(18)} ${canWrite ? "yes" : "NO — column missing"}`);
}

nl();
console.log("PREP-TIME ESTIMATOR CALIBRATION (vs the " + calibration.length + " rows that carry a MEASURED prepTimeMin)");
console.log(`  mean abs error   ${meanErr} min`);
console.log(`  median (p50)     ${pct(0.5)} min`);
console.log(`  p75              ${pct(0.75)} min`);
console.log(`  p90              ${pct(0.9)} min`);
console.log(`  within  5 min    ${within(5)}%`);
console.log(`  within 10 min    ${within(10)}%`);
console.log(`  within 15 min    ${within(15)}%`);
console.log("  (measured values are NEVER overwritten; this is a fit check on the estimator that fills the NULLs)");

const costs = derived.map((d) => d.costPerServing).sort((a, b) => a - b);
const cp = (p) => costs[Math.min(costs.length - 1, Math.max(0, Math.ceil(p * costs.length) - 1))];
const covLow = derived.filter((d) => d.costTier === "unknown").length;
nl();
console.log("DERIVED COST / SERVING (CAD, estimated)");
console.log(`  min ${cp(0).toFixed(2)}  p25 ${cp(0.25).toFixed(2)}  median ${cp(0.5).toFixed(2)}  p75 ${cp(0.75).toFixed(2)}  p95 ${cp(0.95).toFixed(2)}  max ${cp(1).toFixed(2)}`);
console.log(`  tier unknown (price coverage <50% of grams): ${covLow}/${total} (${Math.round((covLow / total) * 1000) / 10}%)`);

const bands = derived.reduce((a, d) => ((a[d.difficultyBand] = (a[d.difficultyBand] || 0) + 1), a), {});
nl();
console.log("DERIVED COMPLEXITY BANDS");
for (const b of ["simple", "moderate", "involved"]) console.log(`  ${b.padEnd(10)} ${bands[b] || 0}`);

// ── data-defect surfacing ──────────────────────────────────────────────────
// The cost model is a magnifying glass on RecipeIngredient.baseGrams: those
// grams are per SERVING, so a row carrying whole-batch (or plainly wrong) grams
// shows up here as an absurd price. Report it instead of clamping it — clamping
// would hide a real data bug behind a plausible-looking number, and a plausible
// wrong number is the worst outcome available.
const GRAM_ROW_LIMIT = 1000; // per-serving grams for ONE ingredient
const GRAM_TOTAL_LIMIT = 1500; // per-serving grams for a whole dish
const fatRows = [];
for (const [rid, ings] of byRecipe) {
  const totalG = ings.reduce((a, i) => a + (Number(i.baseGrams) || 0), 0);
  const worst = ings.reduce((a, i) => ((Number(i.baseGrams) || 0) > (Number(a?.baseGrams) || 0) ? i : a), null);
  if (totalG > GRAM_TOTAL_LIMIT || (worst && worst.baseGrams > GRAM_ROW_LIMIT)) {
    fatRows.push({ id: rid, name: recipeRows.find((r) => r.id === rid)?.name || rid, totalG: Math.round(totalG), worst: worst ? `${Math.round(worst.baseGrams)}g ${worst.food.name}` : null });
  }
}
nl();
console.log(`IMPLAUSIBLE PER-SERVING GRAMS (>${GRAM_TOTAL_LIMIT}g/dish or >${GRAM_ROW_LIMIT}g/ingredient): ${fatRows.length} recipe(s)`);
if (fatRows.length) {
  console.log("  NOT a cost-model bug — these are pre-existing RecipeIngredient rows that look like");
  console.log("  whole-batch grams stored in a per-serving column. They inflate cost AND macros.");
  for (const f of fatRows.slice(0, 12)) console.log(`  ${String(f.totalG).padStart(6)}g total  worst: ${String(f.worst).padEnd(34)} ${f.name}`);
  if (fatRows.length > 12) console.log(`  ...and ${fatRows.length - 12} more`);
}

if (JSON_OUT) {
  const outPath = path.resolve(JSON_OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedFrom: DB_PATH, total, coverageBefore, calibration: { n: calibration.length, meanErr, p50: pct(0.5), p90: pct(0.9), within5: within(5), within10: within(10) }, rows: derived }, null, 2));
  nl();
  console.log(`[backfill] preview written to ${outPath}`);
}

// ── write ──────────────────────────────────────────────────────────────────
if (!APPLY) {
  nl();
  console.log("[backfill] DRY RUN — nothing written. Re-run with --apply to write.");
} else if (present.length === 0) {
  nl();
  console.log("[backfill] --apply given but NO target column exists. Nothing written.");
} else {
  const setCols = present.map((t) => `${t.column} = ?`).join(", ");
  const stmt = db.prepare(`UPDATE Recipe SET ${setCols} WHERE id = ?`);
  db.exec("BEGIN");
  try {
    let n = 0;
    for (const d of derived) {
      const args = present.map((t) => d[t.field]);
      stmt.run(...args, d.id);
      n++;
    }
    db.exec("COMMIT");
    nl();
    console.log(`[backfill] APPLIED — ${n} rows updated in one transaction (columns: ${present.map((t) => t.column).join(", ")}).`);
  } catch (err) {
    db.exec("ROLLBACK");
    fail(`transaction rolled back, nothing written: ${err.message}`);
  }
}

if (missing.length) {
  nl();
  console.log("MIGRATION REQUIRED — this script does NOT run migrations. Add to prisma/schema.prisma:");
  console.log("");
  console.log("  model Recipe {");
  console.log("    // Stage 3 five-filter cache. All three are DERIVED, never authored;");
  console.log("    // filterProvenance records which of them is estimated vs measured.");
  for (const t of missing) {
    const prismaType = t.kind === "REAL" ? "Float?" : t.kind === "INTEGER" ? "Int?" : "String?";
    console.log(`    ${t.column.padEnd(18)} ${prismaType}`);
  }
  console.log("  }");
  console.log("");
  console.log("  -- migration SQL");
  for (const t of missing) console.log(`  ALTER TABLE "Recipe" ADD COLUMN "${t.column}" ${t.kind};`);
}

db.close();
