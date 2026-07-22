#!/usr/bin/env node
// Cross-check every fdcId in the micronutrient registry (src/lib/nutrients.js)
// against the nutrient ids that actually appear in the FDC bulk datasets.
//
//   node scripts/verifyNutrientIds.mjs
//
// A silently mis-mapped id would write (say) vitamin A numbers into the
// vitamin D field for every food in the table — the same "confidently wrong
// number" failure this whole track exists to remove. So the registry's ids are
// verified against real data, and the observed FDC nutrient NAME is printed
// next to the registry's declared name for eyeball confirmation.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DATASETS, iterateFdcRecords, datasetPath, availableDatasets } = require("./lib/fdcDataset.js");
const { NUTRIENT_LIST } = require("../src/lib/nutrients.js");
const { normalizeUnit } = require("./lib/fdcMicros.js");

const fixture = process.argv.includes("--fixture");
const present = availableDatasets({ fixture });
if (!present.length) {
  console.error("No FDC datasets found. Run: node scripts/downloadFdcDatasets.mjs");
  process.exit(1);
}

// id -> { names:Set, units:Set, count }
const observed = new Map();
for (const ds of present) {
  for await (const rec of iterateFdcRecords(datasetPath(ds, { fixture }))) {
    for (const fn of rec.foodNutrients || []) {
      const n = fn.nutrient;
      if (!n || n.id == null) continue;
      let e = observed.get(n.id);
      if (!e) observed.set(n.id, (e = { names: new Set(), units: new Set(), count: 0 }));
      e.names.add(n.name);
      e.units.add(n.unitName);
      if (typeof fn.amount === "number") e.count++;
    }
  }
}
console.log(`[nutrient-ids] observed ${observed.size} distinct nutrient ids across ${present.map((d) => d.key).join(", ")}\n`);

// Loose semantic agreement between the registry's label and FDC's own name:
// compare alphanumeric word stems, ignoring FDC's qualifier tails.
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 2));
const overlaps = (a, b) => {
  const A = words(a), B = words(b);
  for (const w of A) for (const v of B) if (w === v || w.startsWith(v) || v.startsWith(w)) return true;
  return false;
};

// FDC names some nutrients by lipid notation rather than common name, so word
// overlap alone would report a false mismatch. Each entry here is a manually
// confirmed identity, not a guess.
const KNOWN_FDC_ALIASES = {
  // 18:2 n-6 IS linoleic acid; FDC labels the undifferentiated pool "PUFA 18:2".
  omega6LinoleicAcid: [/^pufa 18:2/i],
  omega3ALA: [/^pufa 18:3/i],
  omega3EPA: [/^pufa 20:5/i],
  omega3DHA: [/^pufa 22:6/i],
};

const CONVERTIBLE = new Set(["g", "mg", "mcg"]);
const problems = [];
const notes = [];
const rows = [];
for (const n of NUTRIENT_LIST) {
  const e = observed.get(n.fdcId);
  if (!e) {
    problems.push(`${n.key} (id ${n.fdcId}): NOT PRESENT in any FDC dataset`);
    rows.push([n.key, n.fdcId, "—", "—", 0, "MISSING"]);
    continue;
  }
  const fdcNames = [...e.names];
  const fdcUnits = [...e.units];
  const alias = KNOWN_FDC_ALIASES[n.key] || [];
  const nameOk = fdcNames.some((fn) => overlaps(n.name, fn) || alias.some((re) => re.test(fn)));
  const units = [...new Set(fdcUnits.map(normalizeUnit))];
  // The contract is that the STORED value is in the registry's unit. FDC
  // reporting a different mass unit is fine — the importer converts. Only a
  // non-mass unit (IU) is unusable.
  const unusable = units.filter((u) => !CONVERTIBLE.has(u));

  let status = "ok";
  if (!nameOk) {
    status = "NAME MISMATCH";
    problems.push(`${n.key} (id ${n.fdcId}): registry says "${n.name}" but FDC id ${n.fdcId} is "${fdcNames.join(" / ")}"`);
  } else if (unusable.length) {
    status = "UNIT UNUSABLE";
    problems.push(`${n.key} (id ${n.fdcId}): FDC reports non-mass unit(s) ${unusable.join("/")} — cannot convert to "${n.unit}"`);
  } else if (!units.every((u) => u === n.unit)) {
    status = `converts ${units.join("/")}->${n.unit}`;
    notes.push(`${n.key}: FDC reports ${units.join("/")}, registry canonical is ${n.unit} — importer converts (x${units[0] === "g" && n.unit === "mg" ? "1000" : "?"}).`);
  }
  rows.push([n.key, n.fdcId, fdcNames.join(" / ").slice(0, 46), fdcUnits.join("/"), e.count, status]);
}

const w = [24, 6, 48, 6, 8, 14];
const line = (c) => c.map((v, i) => String(v).padEnd(w[i])).join(" ");
console.log(line(["registry key", "id", "FDC nutrient name (observed)", "unit", "values", "status"]));
console.log("-".repeat(w.reduce((a, b) => a + b + 1, 0)));
for (const r of rows) console.log(line(r));

// Coverage is not a defect, but it IS something callers must know: a nutrient
// reported by 46 of 13,545 foods can never be aggregated into a meaningful
// daily total, and pretending otherwise would be its own quiet lie.
const SPARSE = 0.2;
const total = [...observed.values()].reduce((m, e) => Math.max(m, e.count), 0);
const sparse = rows.filter((r) => r[4] > 0 && r[4] / total < SPARSE).map((r) => `${r[0]} (${r[4]} foods, ${((r[4] / total) * 100).toFixed(1)}%)`);

console.log();
if (notes.length) {
  console.log(`[nutrient-ids] ${notes.length} unit conversion(s) applied on import:`);
  for (const n of notes) console.log("  - " + n);
  console.log();
}
if (sparse.length) {
  console.log(`[nutrient-ids] sparsely reported (<${SPARSE * 100}% of foods) — expect low coverage downstream:`);
  console.log("  " + sparse.join(", "));
  console.log();
}
if (problems.length === 0) {
  console.log(`[nutrient-ids] CLEAN — all ${NUTRIENT_LIST.length} registry ids resolve to the nutrient they claim, in a convertible unit.`);
} else {
  console.log(`[nutrient-ids] ${problems.length} PROBLEM(S) — report these back so the registry is corrected:`);
  for (const p of problems) console.log("  - " + p);
}
process.exit(problems.length ? 1 : 0);
