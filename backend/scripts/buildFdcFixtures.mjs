#!/usr/bin/env node
// Cut small, committed samples out of the full FDC archives so the import
// pipeline is testable in CI without an 18 MB download.
//
//   node scripts/buildFdcFixtures.mjs
//
// Writes backend/data/fdc-fixtures/{key}.sample.json. The picks are not
// random: they pin the records that exercise every branch of the pipeline —
// the almond-paste record at the centre of the corruption, a food whose USDA
// Atwater factors are not 4/4/9, a negative carbohydrate-by-difference, an
// alcohol record, and a food with no micronutrients.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DATASETS, FIXTURE_DIR, iterateFdcRecords, datasetPath } = require("./lib/fdcDataset.js");

// Records that must be present because a test asserts on them.
const PINNED = new Set([
  170160, // "Nuts, almond paste" — the record copied onto six unrelated pastes
  169394, // "Pepper, banana, raw" — state-relaxed agreement case
  170461, // "Tomato powder" — name-containment rejection case
  173161, // "Rice crackers" — "Rice" must NOT be able to claim this
  168191, // limes / non-standard Atwater factors territory
  167723, // "Alcoholic beverage, rice (sake)" — alcohol exception
  171705, // a plain, well-behaved SR Legacy food
]);
const PER_DATASET = 25;

// Full SR Legacy records are ~40 KB each, almost all of it provenance metadata
// the pipeline never reads (per-nutrient derivation chains, food portions,
// input foods). Fixtures keep exactly the fields the parser consumes, so they
// stay committable while remaining structurally identical to the real archives
// for every code path under test.
function trim(rec) {
  return {
    foodClass: rec.foodClass,
    fdcId: rec.fdcId,
    description: rec.description,
    dataType: rec.dataType,
    foodCategory: rec.foodCategory,
    nutrientConversionFactors: rec.nutrientConversionFactors,
    foodNutrients: (rec.foodNutrients || [])
      .filter((fn) => fn.nutrient?.id != null && typeof fn.amount === "number")
      .map((fn) => ({
        type: "FoodNutrient",
        amount: fn.amount,
        nutrient: { id: fn.nutrient.id, name: fn.nutrient.name, unitName: fn.nutrient.unitName },
      })),
  };
}

fs.mkdirSync(FIXTURE_DIR, { recursive: true });

for (const ds of DATASETS) {
  const src = datasetPath(ds);
  if (!fs.existsSync(src)) {
    console.log(`[fixtures] ${ds.key}: archive not present, skipping`);
    continue;
  }
  const picked = [];
  const pinned = [];
  let seen = 0;
  for await (const rec of iterateFdcRecords(src)) {
    seen++;
    if (PINNED.has(rec.fdcId)) { pinned.push(trim(rec)); continue; }
    // Deterministic spread across the file rather than the first N (which are
    // all one food group).
    if (picked.length < PER_DATASET && seen % 137 === 0) picked.push(trim(rec));
  }
  const out = { [ds.arrayKey]: [...pinned, ...picked] };
  const dest = path.join(FIXTURE_DIR, `${ds.key}.sample.json`);
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  const kb = (fs.statSync(dest).size / 1024).toFixed(0);
  console.log(`[fixtures] ${ds.key}: ${pinned.length} pinned + ${picked.length} sampled = ${out[ds.arrayKey].length} records (${kb} KB)`);
}
console.log(`\nFixtures in ${path.relative(process.cwd(), FIXTURE_DIR)}. Build an index from them with:`);
console.log("  node scripts/buildFdcIndex.mjs --fixture");
