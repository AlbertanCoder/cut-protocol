// prescription/feasibility.js — joint feasibility at TARGET-SETTING time.
//
// Directive §3.2: when calories and all macros are declared together, a
// tightly specified profile can be arithmetically unsatisfiable before the
// solver ever runs — fiber contributes energy, per-food Atwater factors
// differ from 4/4/9, so "4/4/9 over net macros" undershoots FDC calories.
// Never hand the solver impossible numbers and let it fail mysteriously:
// check here, and when infeasible propose the one-tap adjustment with CARBS
// as the flex macro (the filler, §4.7).
//
// This is deliberately a GENEROUS screen: it flags only arithmetic
// impossibility, not tight-but-solvable targets. The energy a food supplies
// per macro gram varies by food (protein 3.5–4.4, net carbs 3.6–4.2 plus
// fiber's ~2, fat 8.4–9.0 kcal/g in FDC data), so the implied-energy window
// below uses those spreads; a kcal band that cannot intersect the window on
// ANY real food mix is infeasible for every solver.

"use strict";

const { resolveBands } = require("./ruler.js");

// Per-gram FDC energy windows (kcal/g). Fiber rides along with net carbs at
// an assumed 8–40 g/day contributing ~2 kcal/g.
const PER_G = {
  protein: { lo: 3.5, hi: 4.4 },
  fat: { lo: 8.4, hi: 9.0 },
  netCarb: { lo: 3.6, hi: 4.2 },
};
const FIBER_G = { lo: 8, hi: 40 };
const FIBER_KCAL_PER_G = 2;

/**
 * checkTargetFeasibility(targets) → {
 *   feasible, impliedKcal: {lo, hi}, kcalBand: {lo, hi},
 *   suggestion?: { netCarbG, note }   — carbs flex first, one-tap shaped
 * }
 * targets: the ruler shape (points or {lo,hi}; floor/ceiling respected).
 */
function checkTargetFeasibility(targets) {
  const bands = resolveBands(targets);
  const implied = {
    lo: bands.proteinG.lo * PER_G.protein.lo + bands.fatG.lo * PER_G.fat.lo +
        bands.netCarbG.lo * PER_G.netCarb.lo + FIBER_G.lo * FIBER_KCAL_PER_G,
    hi: bands.proteinG.hi * PER_G.protein.hi + bands.fatG.hi * PER_G.fat.hi +
        bands.netCarbG.hi * PER_G.netCarb.hi + FIBER_G.hi * FIBER_KCAL_PER_G,
  };
  const overlap = bands.kcal.hi >= implied.lo && implied.hi >= bands.kcal.lo;
  if (overlap) return { feasible: true, impliedKcal: implied, kcalBand: { lo: bands.kcal.lo, hi: bands.kcal.hi } };

  // Infeasible — flex net carbs to re-center the implied energy on the kcal
  // midpoint at MID per-gram factors (the honest single-number suggestion).
  const midPerG = Object.fromEntries(Object.entries(PER_G).map(([k, v]) => [k, (v.lo + v.hi) / 2]));
  const fiberMid = ((FIBER_G.lo + FIBER_G.hi) / 2) * FIBER_KCAL_PER_G;
  const proteinMid = (bands.proteinG.lo + bands.proteinG.hi) / 2;
  const fatMid = (bands.fatG.lo + bands.fatG.hi) / 2;
  const kcalMid = (bands.kcal.lo + bands.kcal.hi) / 2;
  let netCarbG = (kcalMid - fiberMid - proteinMid * midPerG.protein - fatMid * midPerG.fat) / midPerG.netCarb;
  netCarbG = Math.max(0, Math.round(netCarbG));
  const note = Number.isFinite(targets.netCarbMaxG) && netCarbG > targets.netCarbMaxG
    ? `even with carbs flexed, ${netCarbG} g net carbs would breach your ${targets.netCarbMaxG} g ceiling — the calorie target or a macro has to move instead`
    : `these numbers don't add up as food: protein + fat + carbs imply ${Math.round(implied.lo)}–${Math.round(implied.hi)} kcal against a ${Math.round(bands.kcal.lo)}–${Math.round(bands.kcal.hi)} kcal target. Flexing net carbs to ~${netCarbG} g closes it`;
  return {
    feasible: false,
    impliedKcal: implied,
    kcalBand: { lo: bands.kcal.lo, hi: bands.kcal.hi },
    suggestion: { netCarbG, note },
  };
}

module.exports = { checkTargetFeasibility, PER_G, FIBER_G };
