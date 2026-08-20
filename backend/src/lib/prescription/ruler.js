// prescription/ruler.js — the directive's verification ruler.
//
// CUT_PROTOCOL_DIRECTIVE.md §3.2: per-day bands ±50 kcal · ±7 g protein ·
// ±7 g fat · ±10 g net carbs. This is a NEW ruler in a NEW file — the shipped
// dayTolerance in mealSolver.js is the product's current verdict and stays
// byte-untouched (docs/BLOCKERS.md B4). Nothing here recomputes calories as
// 4/4/9: totals arrive FDC-canonical from nutritionCore.
//
// Band semantics:
//   · A POINT target gets the band around it. A RANGE target IS the band
//     (aim at its midpoint) — callers express ranges by passing lo/hi.
//   · CEILINGS TRUNCATE BANDS, never license crossing: keto's netCarbMax
//     caps the upper edge of the netCarb band wherever it lands.
//   · FLOORS outrank bands the same way: the kcal band's lower edge never
//     sits below floorKcal (the shipped rule, kept).
// Pure module: no DB, no clock, no RNG.

"use strict";

const BANDS = { kcal: 50, proteinG: 7, fatG: 7, netCarbG: 10 };

// targets: {
//   kcal            — point target (number)  OR {lo, hi} range
//   proteinG        — point or {lo, hi}
//   fatG            — point or {lo, hi}
//   netCarbG        — point or {lo, hi}
//   floorKcal?      — hard lower bound on the kcal band edge
//   netCarbMaxG?    — hard ceiling (keto); truncates the band's upper edge
// }
function bandFor(spec, halfWidth) {
  if (spec && typeof spec === "object" && Number.isFinite(spec.lo) && Number.isFinite(spec.hi)) {
    return { lo: spec.lo, hi: spec.hi, mid: (spec.lo + spec.hi) / 2 };
  }
  const point = Number(spec);
  return { lo: point - halfWidth, hi: point + halfWidth, mid: point };
}

function resolveBands(targets) {
  const kcal = bandFor(targets.kcal, BANDS.kcal);
  if (Number.isFinite(targets.floorKcal)) {
    kcal.lo = Math.max(kcal.lo, targets.floorKcal);
    kcal.hi = Math.max(kcal.hi, kcal.lo); // a floor above the band pins both edges to the floor
    kcal.mid = Math.max(kcal.mid, kcal.lo);
  }
  const proteinG = bandFor(targets.proteinG, BANDS.proteinG);
  const fatG = bandFor(targets.fatG, BANDS.fatG);
  const netCarbG = bandFor(targets.netCarbG, BANDS.netCarbG);
  if (Number.isFinite(targets.netCarbMaxG)) {
    netCarbG.hi = Math.min(netCarbG.hi, targets.netCarbMaxG);
    netCarbG.lo = Math.min(netCarbG.lo, netCarbG.hi);
    netCarbG.mid = Math.min(netCarbG.mid, netCarbG.hi);
  }
  return { kcal, proteinG, fatG, netCarbG };
}

// totals: FDC-canonical {kcal, protein, fat, netCarb} (nutritionCore shape;
// protein/fat/netCarb in grams).
function dayVerdict(totals, targets) {
  const bands = resolveBands(targets);
  const read = {
    kcal: totals.kcal,
    proteinG: totals.protein,
    fatG: totals.fat,
    netCarbG: totals.netCarb,
  };
  const misses = [];
  for (const key of ["kcal", "proteinG", "fatG", "netCarbG"]) {
    const b = bands[key];
    const v = read[key];
    if (!Number.isFinite(v)) { misses.push({ key, kind: "unmeasurable" }); continue; }
    if (v < b.lo - 1e-9) misses.push({ key, kind: "under", by: b.lo - v, edge: b.lo });
    else if (v > b.hi + 1e-9) misses.push({ key, kind: "over", by: v - b.hi, edge: b.hi });
  }
  return { inBand: misses.length === 0, misses, bands, read };
}

// The §3.3.4 machine-written metadata line. `scan` comes from the assembly
// re-check: { profile: string[], ingredientCount, hits: [] }.
function allergenScanLine(scan) {
  const profile = (scan.profile || []).join(", ") || "none";
  if ((scan.hits || []).length === 0) {
    return `allergen_scan: PASS (profile: ${profile}) — 0 hits across ${scan.ingredientCount} ingredients`;
  }
  return `allergen_scan: FAIL (profile: ${profile}) — ${scan.hits.length} hit(s): ${scan.hits.join("; ")}`;
}

module.exports = { BANDS, resolveBands, dayVerdict, allergenScanLine };
