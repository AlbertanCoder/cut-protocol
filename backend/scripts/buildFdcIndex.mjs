#!/usr/bin/env node
// Reduce the FDC bulk archives to a compact index the audit / repair / import
// scripts can load in a fraction of a second.
//
//   node scripts/buildFdcIndex.mjs            # from data/fdc-cache/*.zip
//   node scripts/buildFdcIndex.mjs --fixture  # from the committed samples
//
// Output: data/fdc-cache/fdc-index.json  (or fdc-index.fixture.json)
// Shape:  { builtAt, datasets:[...], records:[{ fdcId, description, dataType,
//           datasetKey, priority, fdcCategory, kcal, protein, fat, carb, fiber,
//           energyBasis }], incomplete:[{ fdcId, description, missing }] }

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DATASETS, CACHE_DIR, iterateFdcRecords, normalizeFdcRecord, datasetPath, availableDatasets } =
  require("./lib/fdcDataset.js");
const { extractMicros } = require("./lib/fdcMicros.js");

const fixture = process.argv.includes("--fixture");
const outFile = path.join(CACHE_DIR, fixture ? "fdc-index.fixture.json" : "fdc-index.json");

const present = availableDatasets({ fixture });
if (present.length === 0) {
  console.error(
    fixture
      ? "No fixture samples found in backend/data/fdc-fixtures/."
      : "No FDC archives found in backend/data/fdc-cache/.\nRun: node scripts/downloadFdcDatasets.mjs",
  );
  process.exit(1);
}
if (present.length < DATASETS.length) {
  const missing = DATASETS.filter((d) => !present.includes(d)).map((d) => d.key);
  console.log(`[fdc-index] NOTE: only ${present.map((d) => d.key).join(", ")} available — missing ${missing.join(", ")}`);
}

fs.mkdirSync(CACHE_DIR, { recursive: true });

const records = [];
const incomplete = [];
const seen = new Set();
let duplicateIds = 0;
let droppedMicros = 0;
const microCoverage = [];

for (const ds of present) {
  const file = datasetPath(ds, { fixture });
  let n = 0;
  const started = Date.now();
  for await (const raw of iterateFdcRecords(file)) {
    const rec = normalizeFdcRecord(raw, ds);
    n++;
    if (rec.fdcId == null || !rec.description) continue;
    // fdcId is globally unique across FDC datasets; a repeat means we already
    // have the record from a higher-priority dataset.
    if (seen.has(rec.fdcId)) { duplicateIds++; continue; }
    seen.add(rec.fdcId);
    if (!rec.macros.ok) {
      incomplete.push({ fdcId: rec.fdcId, description: rec.description, dataType: rec.dataType, missing: rec.macros.missing });
      continue;
    }
    const micro = extractMicros(raw);
    if (micro.dropped.length) droppedMicros += micro.dropped.length;
    microCoverage.push(micro.count);
    records.push({
      fdcId: rec.fdcId,
      description: rec.description,
      dataType: rec.dataType,
      datasetKey: rec.datasetKey,
      priority: rec.priority,
      fdcCategory: rec.fdcCategory,
      energyBasis: rec.macros.energyBasis,
      atwaterFactors: rec.atwaterFactors,
      kcal: rec.macros.kcal,
      protein: rec.macros.protein,
      fat: rec.macros.fat,
      carb: rec.macros.carb,
      fiber: rec.macros.fiber,
      // null = this food reports no micronutrients at all (honest absence).
      micros: micro.micros,
    });
  }
  console.log(`[fdc-index] ${ds.key.padEnd(10)} ${String(n).padStart(6)} records read in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const out = {
  builtAt: new Date().toISOString(),
  fixture,
  datasets: present.map((d) => ({ key: d.key, dataType: d.dataType, file: d.file })),
  counts: {
    usable: records.length,
    incomplete: incomplete.length,
    duplicateIds,
    withMicros: microCoverage.filter((c) => c > 0).length,
    droppedMicroValues: droppedMicros,
    meanMicrosPerFood: microCoverage.length
      ? Math.round((microCoverage.reduce((a, b) => a + b, 0) / microCoverage.length) * 10) / 10
      : 0,
  },
  records,
  incomplete,
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`[fdc-index] wrote ${path.relative(process.cwd(), outFile)} — ${records.length} usable, ${incomplete.length} incomplete (missing macros), ${duplicateIds} cross-dataset duplicate ids`);
console.log(`[fdc-index] micronutrients: ${out.counts.withMicros} foods carry some, mean ${out.counts.meanMicrosPerFood} nutrients/food, ${droppedMicros} values dropped (non-mass units)`);
