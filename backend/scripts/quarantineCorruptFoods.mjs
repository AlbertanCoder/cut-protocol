#!/usr/bin/env node
// Quarantine the food rows that carry another food's macros — and release the
// ones that were only ever conservative false positives.
//
//   node scripts/quarantineCorruptFoods.mjs                dry run (default)
//   node scripts/quarantineCorruptFoods.mjs --apply        write to the database
//   node scripts/quarantineCorruptFoods.mjs --revert       undo a previous --apply
//   node scripts/quarantineCorruptFoods.mjs --no-release   quarantine everything,
//                                                          skip the Task-B releases
//   node scripts/quarantineCorruptFoods.mjs --near-misses  print the hand-review queue
//   node scripts/quarantineCorruptFoods.mjs --fixture      use the small FDC index
//
// WHAT THIS FIXES
// ------------------------------------------------------------------------
// A prior repair pass identified 470 Food rows whose USDA record described a
// different food, wrote a plain-English confession into each row's
// `dataQuality`, stripped the `usda-verified` claim to `manual`, nulled the
// `fdcId` — and left the wrong numbers in the columns the app reads. So
// "Chicken Breast" still serves breaded tenders' 263 kcal against real chicken
// breast's 120, "Tomato" serves tomato POWDER (16.8x), "Mayonnaise" serves
// low-calorie mayo's 263 against real mayo's 680. 469 of them are referenced
// 2,803 times across 779 of 889 recipes.
//
// The 4/4/9 Atwater gate cannot catch any of this. Every one of those rows
// holds a real, internally-consistent USDA tuple; the numbers are only wrong
// relative to the NAME. So the fix is not a better validator, it is refusing to
// serve the row: `source = "quarantined"`, which src/lib/foodValidation.js
// (isQuarantined / macroTrustIssue / recipeDataConfidence) turns into "this
// recipe's calories are incomplete" instead of a confident wrong total.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ------------------------------------------------------------------------
//   * It does not re-match the cohort against the FDC corpus. findConfidentMatch()
//     already refused every one of them by design, and its header records what
//     happened the one time that rule was loosened ("Onion" -> "Bread, onion").
//   * It does not invent a replacement number for any row.
//   * It does not rewrite recipe macro caches. Recomputing a recipe from
//     quarantined ingredients produces the same wrong total, more confidently.
//     Recipes are REPORTED, and the app tells the truth about them at read time.
//
// Safety properties (same contract as repairFoodProvenance.mjs):
//   * dry run is the default — you have to ask for writes
//   * idempotent: a second --apply changes nothing
//   * every change is logged to data/quarantine-log.json with the full prior
//     row BEFORE it is applied, so --revert restores it exactly
//     (CLAUDE.md: every automatic adjustment is logged, visible, reversible)
//   * targets THIS worktree's dev.db via scripts/lib/prismaLocal.js — a bare
//     PrismaClient silently writes the MAIN repo's database

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeLocalPrisma, localDatabaseUrl } = require("./lib/prismaLocal.js");
const { CACHE_DIR } = require("./lib/fdcDataset.js");
const { reviewCohort, nearMisses, isCleared } = require("./lib/clearedCohort.js");
const { qualityVerdict, TIER_USDA } = require("./lib/provenanceAudit.js");
const { loadFoodOverrides } = require("../src/lib/foodOverrides.js");
const { QUARANTINE_SOURCE } = require("../src/lib/foodValidation.js");

const apply = process.argv.includes("--apply");
const revert = process.argv.includes("--revert");
const noRelease = process.argv.includes("--no-release");
const showNearMisses = process.argv.includes("--near-misses");
const fixture = process.argv.includes("--fixture");
// Both overridable so the whole thing can be rehearsed against a COPY of the
// database without touching the repo: DATABASE_URL (absolute file: url, honoured
// by lib/prismaLocal.js) picks the db, QUARANTINE_LOG picks where the undo log
// lands. Unset, both point at the real thing.
const LOG_FILE = process.env.QUARANTINE_LOG
  ? path.resolve(process.env.QUARANTINE_LOG)
  : path.resolve(import.meta.dirname, "..", "data", "quarantine-log.json");

// The sentence appended to the confession when a row is pulled from service.
// Presence of this exact marker is what makes the script idempotent.
const MARKER = "; QUARANTINED — the app will not serve these macros as this food's numbers";

console.log(`Database: ${localDatabaseUrl()}`);

const prisma = makeLocalPrisma();

// ── revert ───────────────────────────────────────────────────────────────
if (revert) {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`No change log at ${LOG_FILE} — nothing to revert.`);
    process.exit(2);
  }
  const log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  let restored = 0, missing = 0;
  await prisma.$transaction(async (tx) => {
    for (const c of log.changes) {
      const exists = await tx.food.findUnique({ where: { id: c.id } });
      if (!exists) { missing++; continue; }
      await tx.food.update({ where: { id: c.id }, data: c.before });
      restored++;
    }
  }, { timeout: 120_000 });
  console.log(`Reverted ${restored} food rows (${missing} no longer present).`);
  await prisma.$disconnect();
  process.exit(0);
}

// ── load the FDC index (only needed for the releases) ────────────────────
const indexFile = path.join(CACHE_DIR, fixture ? "fdc-index.fixture.json" : "fdc-index.json");
let byFdcId = new Map();
let haveIndex = false;
if (noRelease) {
  console.log("Release pass skipped (--no-release): every cleared row will be quarantined.");
} else if (!fs.existsSync(indexFile)) {
  console.log(`WARNING: no FDC index at ${indexFile} — releases cannot be judged, so every cleared`);
  console.log("         row will be quarantined. Run scripts/downloadFdcDatasets.mjs && scripts/buildFdcIndex.mjs");
  console.log("         first if you want the false positives released.");
} else {
  const idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  byFdcId = new Map(idx.records.map((r) => [r.fdcId, r]));
  haveIndex = true;
  console.log(`FDC index: ${idx.records.length} records (built ${idx.builtAt || "?"})`);
}

// ── read ─────────────────────────────────────────────────────────────────
const foods = await prisma.food.findMany();
const recipes = await prisma.recipe.findMany({ include: { ingredients: true } });

const usage = new Map();
const recipesByFood = new Map();
for (const r of recipes) {
  for (const i of r.ingredients) {
    usage.set(i.foodId, (usage.get(i.foodId) || 0) + 1);
    if (!recipesByFood.has(i.foodId)) recipesByFood.set(i.foodId, new Set());
    recipesByFood.get(i.foodId).add(r.id);
  }
}

const { cohort, reviews, released, quarantined } = reviewCohort(foods, haveIndex ? byFdcId : new Map());
const alreadyQuarantined = foods.filter((f) => f.source === QUARANTINE_SOURCE);

console.log(`\nFoods: ${foods.length} | recipes: ${recipes.length} | ingredient rows: ${[...usage.values()].reduce((a, b) => a + b, 0)}`);
console.log(`provenance-cleared cohort: ${cohort.length}   (already quarantined: ${alreadyQuarantined.length})`);
console.log(`  -> RELEASE to usda-verified: ${released.length}`);
console.log(`  -> QUARANTINE:               ${quarantined.length}`);

// ── build the change set ─────────────────────────────────────────────────
const changes = [];
const exemptions = loadFoodOverrides();

for (const r of released) {
  const row = r.row;
  const refreshed = { ...row, fdcId: r.fdcId, source: TIER_USDA };
  const quality = qualityVerdict(refreshed, exemptions);
  // The provenance sentence is ALWAYS kept, whether the validator says pass or
  // warn — a released row must still be able to explain where its number came
  // from and why the confession was withdrawn.
  const provenance = `provenance restored after review: FDC ${r.record.fdcId} "${r.record.description}" (${r.record.dataType}); ${r.reason}`;
  const after = {
    fdcId: r.fdcId,
    source: TIER_USDA,
    dataQuality: quality === "pass" ? `pass — ${provenance}` : `${quality} | ${provenance}`,
  };
  if (row.fdcId === after.fdcId && row.source === after.source && row.dataQuality === after.dataQuality) continue;
  changes.push({ kind: "release", id: row.id, name: row.name, reason: r.reason, twin: r.twin || null,
    before: Object.fromEntries(Object.keys(after).map((k) => [k, row[k]])), after });
}

for (const r of quarantined) {
  const row = r.row;
  const dq = row.dataQuality || "";
  const after = { source: QUARANTINE_SOURCE };
  if (!dq.includes(MARKER)) after.dataQuality = dq + MARKER;
  if (row.source === QUARANTINE_SOURCE && !("dataQuality" in after)) continue; // idempotent
  changes.push({ kind: "quarantine", id: row.id, name: row.name, reason: r.reason,
    before: Object.fromEntries(Object.keys(after).map((k) => [k, row[k]])), after });
}

// Macros are NEVER touched by this script — asserted, not assumed.
const MACRO_KEYS = ["kcal", "protein", "fat", "carb", "fiber", "name"];
for (const c of changes) {
  for (const k of MACRO_KEYS) {
    if (k in c.after) { console.error(`REFUSING: change to ${c.name} would touch "${k}". This script never rewrites macros or names.`); process.exit(3); }
  }
}

// ── impact ───────────────────────────────────────────────────────────────
const quarantinedIds = new Set(changes.filter((c) => c.kind === "quarantine").map((c) => c.id));
for (const f of alreadyQuarantined) quarantinedIds.add(f.id);
const releasedIds = new Set(changes.filter((c) => c.kind === "release").map((c) => c.id));

const affectedRecipeIds = new Set();
let quarantinedRefs = 0;
for (const id of quarantinedIds) {
  quarantinedRefs += usage.get(id) || 0;
  for (const rid of recipesByFood.get(id) || []) affectedRecipeIds.add(rid);
}
const releasedRefs = [...releasedIds].reduce((a, id) => a + (usage.get(id) || 0), 0);

console.log(`\nBEFORE`);
console.log(`  source=quarantined rows:        ${alreadyQuarantined.length}`);
console.log(`  cleared rows still served:      ${cohort.filter((f) => f.source !== QUARANTINE_SOURCE).length}`);
console.log(`  recipes reading a cleared row:  ${new Set(cohort.flatMap((f) => [...(recipesByFood.get(f.id) || [])])).size} of ${recipes.length}`);
console.log(`AFTER`);
console.log(`  rows released to usda-verified: ${releasedIds.size}  (${releasedRefs} ingredient references get real provenance back)`);
console.log(`  rows quarantined:               ${quarantinedIds.size}  (${quarantinedRefs} ingredient references)`);
console.log(`  recipes that will report "incomplete data": ${affectedRecipeIds.size} of ${recipes.length} (${(affectedRecipeIds.size / (recipes.length || 1) * 100).toFixed(1)}%)`);
console.log(`  rows to write: ${changes.length}  (${changes.filter((c) => c.kind === "release").length} release, ${changes.filter((c) => c.kind === "quarantine").length} quarantine)`);

if (released.length) {
  console.log(`\nRELEASES (all of them — this list is short on purpose, see scripts/lib/clearedCohort.js):`);
  for (const r of released) {
    console.log(`  "${r.row.name}"  <- FDC ${r.record.fdcId} "${r.record.description}"  ${r.row.kcal} kcal  x${usage.get(r.row.id) || 0} refs`);
    console.log(`      ${r.reason}`);
  }
  const twins = released.filter((r) => r.twin);
  if (twins.length) {
    console.log(`\n  ${twins.length} of those keep fdcId NULL because a correctly-named twin already holds the id.`);
    console.log(`  Follow-up (NOT this script's job): merge each pair with scripts/mergeSynonymFoods.mjs`);
    for (const r of twins) console.log(`    "${r.row.name}" (x${usage.get(r.row.id) || 0} refs)  ==  "${r.twin.name}" (id ${r.twin.id})`);
  }
}

if (showNearMisses) {
  const band = nearMisses(reviews, usage);
  console.log(`\nHAND-REVIEW QUEUE (${band.length} rows) — a rule cannot decide these; a person can.`);
  console.log(`Each is EITHER a true match refused out of caution OR a wrong record that looks the same.`);
  for (const n of band) {
    console.log(`  x${String(n.recipeRefs).padStart(3)}  "${n.name}"  <- "${n.description}"  [${n.missing.join(", ")}]  ${n.kcal} kcal`);
  }
}

if (!apply) {
  console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit these changes.`);
  const sample = changes.filter((c) => c.kind === "quarantine").slice(0, 8);
  console.log(`Sample quarantine rows:`);
  for (const c of sample) console.log(`  "${c.name}"  source ${c.before.source} -> quarantined  (${c.reason})`);
  await prisma.$disconnect();
  process.exit(0);
}

if (!changes.length) {
  console.log(`\nNothing to do — the database already matches this script's decisions.`);
  await prisma.$disconnect();
  process.exit(0);
}

// Log BEFORE writing, so a crash mid-apply still leaves a restore path.
fs.writeFileSync(LOG_FILE, JSON.stringify({
  appliedAt: new Date().toISOString(),
  fdcIndex: haveIndex ? indexFile : null,
  summary: {
    foods: foods.length, recipes: recipes.length, cohort: cohort.length,
    released: releasedIds.size, quarantined: quarantinedIds.size,
    quarantinedIngredientRefs: quarantinedRefs, affectedRecipes: affectedRecipeIds.size,
  },
  changes,
}, null, 2));
console.log(`\nChange log written: ${path.relative(process.cwd(), LOG_FILE)}`);

await prisma.$transaction(async (tx) => {
  for (const c of changes) await tx.food.update({ where: { id: c.id }, data: c.after });
}, { timeout: 120_000 });

console.log(`Applied: ${changes.length} food rows updated (${releasedIds.size} released, ${quarantinedIds.size} quarantined).`);
console.log(`Macros and names untouched. Recipe caches untouched by design — recipes now report incomplete data at read time.`);
await prisma.$disconnect();
