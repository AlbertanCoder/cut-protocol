// A13 — servability cost of a portioning variant, on SERVED slots only.
//
// A gain bought with unservable plates is not a gain. A10 measured spread on a
// paired proxy over every (recipe,target) pair; this measures it on the plates
// the real solver actually shipped.
//
// The join: the hook records {spread, lo, hi, k} under the same
// `recipeId|round2(proteinScale)|round2(sidesScale)` triple that the rig writes
// into each slot row. Unjoined slots are REPORTED, never dropped.
//
// Pinning is recomputed from the hook's per-knob lo/hi, NOT from the rig's
// `pinned` column: the rig infers pinning from proteinScale/sidesScale, and for
// a per-role variant `sidesScale` is a kcal-weighted MEAN of several knobs,
// which almost never sits exactly on a bound. Reading the rig's column for a
// per-role run would report a pinning collapse that is pure artefact.
//
//   node a13-spread.mjs <variant.jsonl> <diag.json>

import fs from "node:fs";
import path from "node:path";

const [jsonlPath, diagPath] = process.argv.slice(2);
const rows = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const diag = JSON.parse(fs.readFileSync(diagPath, "utf8"));
const idx = new Map(diag.scales.map((s) => [s.key, s]));

const LO = 0.5, HI = 2.0;
const r2 = (n) => Math.round(n * 100) / 100;

let served = 0, joined = 0, unjoined = 0;
let spreadGt3 = 0, spreadGt2 = 0, spreadSum = 0;
let pinnedSlots = 0;
let daysAny = 0, daysWithGt3 = 0;
const spreads = [];
// satisfiable-only slices
let sServed = 0, sJoined = 0, sGt3 = 0, sPinned = 0;

for (const r of rows) {
  if (!r.judged) continue;
  const sat = r.satisfiable !== false;
  let dayGt3 = false, dayHas = false;
  for (const s of r.slots || []) {
    if (!s.recipeId) continue;
    served++; if (sat) sServed++;
    dayHas = true;
    const key = `${s.recipeId}|${r2(s.proteinScale)}|${r2(s.sidesScale)}`;
    const d = idx.get(key);
    if (!d) {
      unjoined++;
      // legacy-path slot (hook declined): spread is the 2-knob ratio.
      const lo = Math.min(s.proteinScale, s.sidesScale), hi = Math.max(s.proteinScale, s.sidesScale);
      const sp = lo > 0 ? hi / lo : 1;
      spreads.push(sp); spreadSum += sp;
      if (sp > 3) { spreadGt3++; dayGt3 = true; if (sat) sGt3++; }
      if (sp > 2) spreadGt2++;
      if (s.pinnedLo || s.pinnedHi) { pinnedSlots++; if (sat) sPinned++; }
      continue;
    }
    joined++; if (sat) sJoined++;
    spreads.push(d.spread); spreadSum += d.spread;
    if (d.spread > 3) { spreadGt3++; dayGt3 = true; if (sat) sGt3++; }
    if (d.spread > 2) spreadGt2++;
    if (d.lo <= LO + 1e-9 || d.hi >= HI - 1e-9) { pinnedSlots++; if (sat) sPinned++; }
  }
  if (dayHas) { daysAny++; if (dayGt3) daysWithGt3++; }
}

spreads.sort((a, b) => a - b);
const q = (p) => (spreads.length ? spreads[Math.min(spreads.length - 1, Math.floor(p * spreads.length))] : null);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");

const out = {
  variant: diag.diag.variant,
  file: path.basename(jsonlPath),
  hookCalls: diag.diag.calls,
  hookDeclined_legacyFallback: diag.diag.legacyFallback,
  declined_noCompositionTarget: diag.diag.noCompTarget,
  kHistogram: diag.diag.kHist,
  converged: diag.diag.converged, hitIterCap: diag.diag.hitIterCap,
  meanIters: diag.diag.converged + diag.diag.hitIterCap ? (diag.diag.iterSum / (diag.diag.converged + diag.diag.hitIterCap)).toFixed(1) : "—",
  servedSlots: served, joined, unjoined, joinRatePct: pct(joined, served),
  meanSpread: (spreadSum / (spreads.length || 1)).toFixed(3),
  medianSpread: q(0.5), p90Spread: q(0.9), p99Spread: q(0.99), maxSpread: spreads[spreads.length - 1],
  slotsSpreadGt2: spreadGt2, slotsSpreadGt2Pct: pct(spreadGt2, served),
  slotsSpreadGt3: spreadGt3, slotsSpreadGt3Pct: pct(spreadGt3, served),
  daysWithAnySpreadGt3: daysWithGt3, daysWithAnySpreadGt3Pct: pct(daysWithGt3, daysAny),
  anyKnobPinnedSlots: pinnedSlots, anyKnobPinnedPct: pct(pinnedSlots, served),
  satisfiable: {
    servedSlots: sServed, spreadGt3: sGt3, spreadGt3Pct: pct(sGt3, sServed),
    anyKnobPinned: sPinned, anyKnobPinnedPct: pct(sPinned, sServed),
  },
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(jsonlPath.replace(/\.jsonl$/, "-spread.json"), JSON.stringify(out, null, 2));
