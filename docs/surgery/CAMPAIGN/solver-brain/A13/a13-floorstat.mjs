// A13 — pinning + spread for an arm whose BOX FLOOR was moved (C10).
// a13-pinmiss.mjs hardcodes LO=0.5 and a13-spread.mjs hardcodes LO=0.5/HI=2.0;
// both are wrong for a 0.25-floor arm. Neither file can be edited
// (guard-edit.js: create-only under docs/surgery/CAMPAIGN/), so this is a new
// file. HI is asserted at 2.0 in every arm — the ceiling was never moved.
//
//   A13_LO=0.25 node a13-floorstat.mjs <arm.jsonl> [diag.json]

import fs from "node:fs";
import path from "node:path";

const [jsonlPath, diagPath] = process.argv.slice(2);
const LO = Number(process.env.A13_LO || 0.5), HI = 2.0;
const rows = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const idx = new Map();
if (diagPath && fs.existsSync(diagPath)) {
  const d = JSON.parse(fs.readFileSync(diagPath, "utf8"));
  for (const s of d.scales || []) idx.set(s.key, s);
}
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");

let slots = 0, pinned = 0, pinLo = 0, pinHi = 0, joined = 0;
let warned = 0, warnedPinned = 0;
let belowHalf = 0; // knobs that went under the OLD 0.5 floor — the new territory
let gt3 = 0, gt4 = 0;
const spreads = [], minScales = [];
let dIn = 0, dOut = 0, dOutPin = 0, dInPin = 0, dOutPinLo = 0;

for (const r of rows) {
  if (!r.judged || r.satisfiable === false) continue;
  let dayLo = false, dayPin = false;
  for (const s of r.slots || []) {
    if (!s.recipeId) continue;
    slots++;
    const d = idx.get(`${s.recipeId}|${r2(s.proteinScale)}|${r2(s.sidesScale)}`);
    let lo, hi;
    if (d) { joined++; lo = d.lo; hi = d.hi; }
    else { lo = Math.min(s.proteinScale, s.sidesScale); hi = Math.max(s.proteinScale, s.sidesScale); }
    const pl = lo <= LO + 1e-9, ph = hi >= HI - 1e-9;
    if (pl) { pinLo++; dayLo = true; }
    if (ph) pinHi++;
    if (pl || ph) { pinned++; dayPin = true; }
    if (lo < 0.5 - 1e-9) belowHalf++;
    const sp = lo > 0 ? hi / lo : 1;
    spreads.push(sp); minScales.push(lo);
    if (sp > 3) gt3++;
    if (sp > 4) gt4++;
    if (s.warning) { warned++; if (pl || ph) warnedPinned++; }
  }
  if (r.verdict.inBand) { dIn++; if (dayPin) dInPin++; }
  else { dOut++; if (dayPin) dOutPin++; if (dayLo) dOutPinLo++; }
}
spreads.sort((a, b) => a - b); minScales.sort((a, b) => a - b);
const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);

console.log(JSON.stringify({
  file: path.basename(jsonlPath), floorAssumed: LO, ceilingAssumed: HI, diagJoined: joined,
  satisfiable: {
    slots, pinnedPct: pct(pinned, slots), pinLoPct: pct(pinLo, slots), pinHiPct: pct(pinHi, slots),
    knobsUnder0p5: belowHalf, knobsUnder0p5Pct: pct(belowHalf, slots),
    warnedSlots: warned, pinnedGivenMissPct: pct(warnedPinned, warned),
    meanSpread: (spreads.reduce((a, b) => a + b, 0) / (spreads.length || 1)).toFixed(3),
    medianSpread: q(spreads, 0.5), p90Spread: q(spreads, 0.9), maxSpread: spreads[spreads.length - 1],
    slotsSpreadGt3Pct: pct(gt3, slots), slotsSpreadGt4Pct: pct(gt4, slots),
    minScaleP01: q(minScales, 0.01), minScaleP05: q(minScales, 0.05),
    daysIn: dIn, daysInAnyPinnedPct: pct(dInPin, dIn),
    daysOut: dOut, daysOutAnyPinnedPct: pct(dOutPin, dOut), daysOutPinnedAtLoPct: pct(dOutPinLo, dOut),
  },
}));
