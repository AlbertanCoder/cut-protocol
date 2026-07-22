#!/usr/bin/env node
// Bulk-import USDA FoodData Central (Foundation + SR Legacy + FNDDS survey
// foods) into the Food table.
//
//   node scripts/downloadFdcDatasets.mjs
//   node scripts/buildFdcIndex.mjs
//   node scripts/importFdcBulk.mjs            # dry run
//   node scripts/importFdcBulk.mjs --apply    # write
//   node scripts/importFdcBulk.mjs --fixture  # against committed samples
//
// ── THE RULE THAT MATTERS ────────────────────────────────────────────────
// Identity is the FDC id. Nothing in this pipeline compares food NAMES to
// decide what a record is or whether it already exists — name similarity is
// what produced the corruption this track repaired (fdcId 170160 "Nuts,
// almond paste" copied onto six unrelated curry/tahini pastes). Here:
//
//   * a record's identity is `record.fdcId`, taken verbatim from USDA
//   * "do we already have it?" is a lookup in a Set of existing fdcIds
//   * `name` is USDA's own description, copied — never matched, never fuzzed
//
// Consequently a re-run is idempotent and can never re-point an existing row
// at a different food.
//
// Every row is validated on the way in by the SAME fiber-adjusted-Atwater
// validator the app uses (src/lib/foodValidation.js) and records its verdict
// in `dataQuality`. A record that fails and has no documented exception is
// REJECTED, not imported with a warning — the startup [data-audit] must stay
// clean, and a food table that quietly contains known-bad rows is the thing
// this whole track exists to prevent. Rejections are counted and reported by
// reason, never silently dropped.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeLocalPrisma, localDatabaseUrl } = require("./lib/prismaLocal.js");
const { validateFood } = require("../src/lib/foodValidation.js");
const { loadFoodOverrides } = require("../src/lib/foodOverrides.js");
const { classifyFood, CATEGORY_SLUGS } = require("../src/lib/foodCategories.js");
const { CACHE_DIR } = require("./lib/fdcDataset.js");

const apply = process.argv.includes("--apply");
const fixture = process.argv.includes("--fixture");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const indexFile = path.join(CACHE_DIR, fixture ? "fdc-index.fixture.json" : "fdc-index.json");
if (!fs.existsSync(indexFile)) {
  console.error(`Missing ${path.relative(process.cwd(), indexFile)}.`);
  console.error("Run: node scripts/downloadFdcDatasets.mjs && node scripts/buildFdcIndex.mjs" + (fixture ? " --fixture" : ""));
  process.exit(2);
}
const idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
const exemptions = loadFoodOverrides();

console.log(`Database: ${localDatabaseUrl()}`);
console.log(`FDC index: ${idx.records.length} records${idx.fixture ? " [FIXTURE]" : ""} from ${idx.datasets.map((d) => d.key).join(", ")}`);

const prisma = makeLocalPrisma();
const existing = await prisma.food.findMany({ select: { fdcId: true, name: true } });
// Identity check — by id, never by name.
const claimedIds = new Set(existing.filter((f) => f.fdcId != null).map((f) => f.fdcId));
const existingNames = new Set(existing.map((f) => f.name.trim().toLowerCase()));
console.log(`Existing foods: ${existing.length} (${claimedIds.size} already carry an fdcId)`);

// USDA's own category names for alcohol-bearing foods.
const ALCOHOL_CATEGORIES = new Set([
  "Alcoholic Beverages", "Liquor and cocktails", "Wine", "Beer",
]);

const toInsert = [];
const rejected = [];
const stats = { alreadyPresent: 0, pass: 0, exception: 0, nameCollision: 0 };
const rejectReasons = new Map();

for (const rec of idx.records) {
  if (toInsert.length >= limit) break;
  if (claimedIds.has(rec.fdcId)) { stats.alreadyPresent++; continue; }

  const name = rec.description.trim();
  const { category } = classifyFood(name);

  // USDA's carbohydrate is "by difference" (100 − water − protein − fat − ash),
  // which lands a few hundredths below zero on very lean meats. That is
  // rounding in the subtraction, not negative carbohydrate. Clamp only that
  // tiny band, and say so on the row.
  const notes = [];
  let carb = rec.carb;
  if (carb < 0 && carb >= -1) {
    notes.push(`carbohydrate-by-difference was ${carb} (subtraction rounding on a near-zero-carb food) and is stored as 0`);
    carb = 0;
  }

  const candidate = {
    name, category,
    kcal: rec.kcal, protein: rec.protein, fat: rec.fat, carb, fiber: rec.fiber,
    source: "usda-verified",
  };

  // Two verdicts. `strict` is what the generic startup [data-audit] will
  // compute later; `aware` additionally knows the Atwater factors USDA really
  // used and that `name` IS this record's description. A row is imported only
  // if `aware` passes; where the two disagree, the row carries a documented
  // exception explaining which part of the generic model does not apply.
  const strict = validateFood(candidate, { exemptions, validCategories: CATEGORY_SLUGS });
  const aware = validateFood(candidate, {
    exemptions,
    validCategories: CATEGORY_SLUGS,
    atwaterFactors: rec.atwaterFactors || undefined,
    nameIsSourceDescription: true,
  });
  const exemption = exemptions[name.toLowerCase()];

  // Ethanol carries 7 kcal/g and appears in NO macro field, so an alcoholic
  // drink's energy legitimately exceeds anything 4/4/9 can account for — the
  // physical exception foodValidation.js already documents, applied here from
  // USDA's own food category rather than by guessing at the name.
  // SR Legacy files alcohol under the generic "Beverages" category but marks
  // it unambiguously in its own description prefix, so both signals count.
  // (Matching the prefix is reading USDA's taxonomy, not guessing from words.)
  const isAlcohol = ALCOHOL_CATEGORIES.has(rec.fdcCategory) || /^alcoholic beverage[,\s]/i.test(name);
  const onlyAtwaterFails = aware.issues.length > 0 && aware.issues.every((i) => i.code === "atwater");
  if (!aware.ok && isAlcohol && onlyAtwaterFails) {
    stats.exception++;
    if (existingNames.has(name.toLowerCase())) stats.nameCollision++;
    toInsert.push({
      name, category, fdcId: rec.fdcId,
      kcal: rec.kcal, protein: rec.protein, fat: rec.fat, carb, fiber: rec.fiber,
      source: "usda-verified",
      dataQuality: `exception:alcohol-energy — ethanol supplies ~7 kcal/g and is reported in no macro field, so kcal ${rec.kcal} legitimately exceeds the Atwater sum (${aware.issues[0].detail}); USDA category "${rec.fdcCategory}"; fdcId ${rec.fdcId} (${rec.dataType})`,
      micros: rec.micros ?? undefined,
    });
    claimedIds.add(rec.fdcId);
    continue;
  }

  if (!aware.ok) {
    const codes = aware.issues.map((i) => i.code).join(",");
    rejectReasons.set(codes, (rejectReasons.get(codes) || 0) + 1);
    rejected.push({ fdcId: rec.fdcId, name, dataType: rec.dataType, issues: aware.issues.map((i) => i.detail) });
    continue;
  }

  const provenance = `fdcId ${rec.fdcId} (${rec.dataType})`;
  let dataQuality;
  if (strict.ok && notes.length === 0) {
    dataQuality = `pass — fiber-adjusted Atwater within tolerance; ${provenance}`;
    stats.pass++;
  } else {
    const why = [];
    const strictCodes = new Set(strict.issues.map((i) => i.code));
    if (strictCodes.has("atwater")) {
      const f = rec.atwaterFactors;
      why.push(f
        ? `USDA computed this record's energy with food-specific Atwater factors P${f.protein}/C${f.carb}/F${f.fat}, not the generic 4/4/9; kcal ${rec.kcal} reconciles against those`
        : `energy reconciles under the fiber-adjusted model but not the classic one`);
    }
    if (strictCodes.has("name-shape")) {
      why.push(`name is USDA's own description, so the wrong-record name-shape heuristic does not apply (it fires on descriptions like "canned in olive oil")`);
    }
    if (exemption?.atwaterExempt) why.push(exemption.reason || exemption.note || "documented physical exception");
    why.push(...notes);
    dataQuality = `exception:usda-source-model — ${why.join("; ")}; ${provenance}`;
    stats.exception++;
  }

  if (existingNames.has(name.toLowerCase())) stats.nameCollision++;

  toInsert.push({
    name,
    category,
    fdcId: rec.fdcId,
    kcal: rec.kcal, protein: rec.protein, fat: rec.fat, carb, fiber: rec.fiber,
    source: "usda-verified",
    dataQuality,
    // null when this food reports no micronutrients at all. Keys absent from a
    // present object mean "USDA does not report it for this food" — never 0.
    micros: rec.micros ?? undefined,
  });
  claimedIds.add(rec.fdcId);
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + "%" : "—");
console.log("");
console.log(`Candidates            : ${idx.records.length}`);
console.log(`  already in the table: ${stats.alreadyPresent}  (matched by fdcId)`);
console.log(`  validated -> import : ${toInsert.length}  (${stats.pass} pass, ${stats.exception} documented exception)`);
console.log(`  REJECTED            : ${rejected.length}  (${pct(rejected.length, idx.records.length)})`);
for (const [codes, n] of [...rejectReasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${String(n).padStart(5)}  ${codes}`);
}
console.log(`  name also used by an existing row: ${stats.nameCollision} (allowed — name is not unique; fdcId is the identity)`);
const withMicros = toInsert.filter((r) => r.micros).length;
console.log(`  carrying micronutrients: ${withMicros} (${pct(withMicros, toInsert.length)})`);

if (rejected.length) {
  const rejectFile = path.resolve(import.meta.dirname, "..", "data", "fdc-import-rejects.json");
  fs.writeFileSync(rejectFile, JSON.stringify({ generatedAt: new Date().toISOString(), count: rejected.length, rejected }, null, 2));
  console.log(`\nRejected records written to ${path.relative(process.cwd(), rejectFile)} — nothing is dropped silently.`);
  console.log("Examples:");
  for (const r of rejected.slice(0, 5)) console.log(`   fdcId ${r.fdcId} "${r.name}" — ${r.issues[0]}`);
}

if (!apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

const BATCH = 500;
let written = 0;
for (let i = 0; i < toInsert.length; i += BATCH) {
  const batch = toInsert.slice(i, i + BATCH);
  await prisma.food.createMany({ data: batch });
  written += batch.length;
  if (written % 2500 === 0 || written === toInsert.length) {
    process.stdout.write(`\r[import] ${written}/${toInsert.length}`);
  }
}
console.log("");
const total = await prisma.food.count();
console.log(`Imported ${written} foods. Table now holds ${total}.`);
await prisma.$disconnect();
