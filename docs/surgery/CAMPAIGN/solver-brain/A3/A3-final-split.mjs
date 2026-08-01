// A3 — final three-way split + ceilings. Reads A3-classification.json (which
// carries the proven structural verdicts) and joins the fleet's recorded
// afterStack pool sizes to separate pool-limited from solver-limited.
//
// pool-limited (principled): the pool the solver ACTUALLY received is smaller
// than the horizon needs to fill its slots inside the shipped 2x/week variety
// cap -- distinctNeeded = ceil(nSlots * daysInHorizon / 2). Below that the
// solver cannot fill the horizon without breaking its own variety rule, so the
// binding constraint is the pool, not the search.
import fs from "node:fs";
const OUT = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A3/";
const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const cls = JSON.parse(fs.readFileSync(OUT + "A3-classification.json", "utf8"));
const byId = new Map(fs.readFileSync(QA + "results.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.id, r]));

const rows = [];
for (const c of cls) {
  if (!c.days) continue;
  const res = byId.get(c.id);
  const afterStack = res?.primary?.claims?.poolCounts?.afterStack ?? c.poolAfterDiet;
  const distinctNeeded = Math.ceil((c.nSlots * c.days) / 2);
  let k;
  if (c.classification === "structurally-impossible") k = "structurally-impossible";
  else if (afterStack < distinctNeeded) k = "pool-limited";
  else k = "solver-limited";
  rows.push({ ...c, afterStack, distinctNeeded, bucket: k });
}
fs.writeFileSync(OUT + "A3-final-split.json", JSON.stringify(rows, null, 2));

const agg = {};
for (const r of rows) {
  agg[r.bucket] ??= { personas: 0, days: 0, inBand: 0 };
  agg[r.bucket].personas++; agg[r.bucket].days += r.days; agg[r.bucket].inBand += r.daysInBand;
}
const T = Object.values(agg).reduce((a, b) => a + b.days, 0);
const B = Object.values(agg).reduce((a, b) => a + b.inBand, 0);
console.log("bucket\tpersonas\tdays\tinBand\trate");
for (const [k, v] of Object.entries(agg)) console.log([k, v.personas, v.days, v.inBand, (v.inBand / v.days).toFixed(3)].join("\t"));
console.log(["TOTAL", Object.values(agg).reduce((a, b) => a + b.personas, 0), T, B, (B / T).toFixed(4)].join("\t"));

const SI = agg["structurally-impossible"].days;
console.log(`\n--- CEILINGS ---`);
console.log(`structurally impossible days (PROVEN): ${SI}`);
console.log(`all-days ceiling      = (578-${SI})/578 = ${((578 - SI) / 578 * 100).toFixed(1)}%`);
console.log(`brief's 83-day figure = (578-83)/578  = ${((578 - 83) / 578 * 100).toFixed(1)}%   <- brief asserts "near 88%"`);
console.log(`corrected satisfiable denominator = ${578 - SI} days; current in-band ${B} -> ${(B / (578 - SI) * 100).toFixed(1)}%`);
console.log(`brief's satisfiable-only          = 495 days; 385 in band -> ${(385 / 495 * 100).toFixed(1)}%`);
console.log(`satisfiable-only ceiling = 100% (no proven-impossible day remains in it)`);

// sensitivity on the pool-limited cut
console.log(`\n--- SENSITIVITY: pool-limited cut on afterStack ---`);
for (const thr of [10, 20, 30, 60, 100]) {
  let pl = 0, sl = 0, plb = 0, slb = 0;
  for (const r of rows) {
    if (r.bucket === "structurally-impossible") continue;
    if (r.afterStack < thr) { pl += r.days; plb += r.daysInBand; } else { sl += r.days; slb += r.daysInBand; }
  }
  console.log(`afterStack<${String(thr).padStart(3)}  pool-limited ${String(pl).padStart(3)}d (${(plb / pl * 100).toFixed(0)}% in band)   solver-limited ${String(sl).padStart(3)}d (${(slb / sl * 100).toFixed(0)}% in band)`);
}
