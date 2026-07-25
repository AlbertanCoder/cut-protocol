// Protein-floor / recomposition mode — shared, LLM-free weighting primitives.
// Additive module (new file, nothing else restructured) so it merges cleanly
// alongside the parallel solver-benchmarking work in this directory.
//
// Consumed by TWO places on purpose:
//   - mealSolver.js (the LIVE deterministic day/week solver every request
//     actually runs through)
//   - scorer.js (the Brain v3 objective — dormant until that spine is wired
//     to a route, kept in step so wiring it later needs no new floor logic)
// Both read the SAME numbers here so "the floor" means one thing everywhere,
// and neither depends on Prisma/Anthropic — safe on the always-on hot path.
//
// WHAT THE FLOOR IS: this app's existing macro engine (bmrEngine.js
// computeMacros) already targets 1.14-1.25 g protein per lb lean body mass
// (~2.5-2.8 g/kg LBM), stored as dailyTarget.proteinLo/proteinHi. proteinLo —
// the low end of that range — IS the floor protein-priority mode defends. No
// new number is invented here; this module only changes how hard the solver
// is made to defend a number the engine already computes, and honestly
// reports when it can't.
//
// BASIS (surfaced in the UI next to the number, never asserted bare):
//   Helms, Aragon & Fitschen (2014), J Int Soc Sports Nutr 11:20 —
//   "Evidence-based recommendations for natural bodybuilding contest
//   preparation": 2.3-3.1 g/kg fat-free mass/day during a caloric deficit
//   preserves lean mass. This app's 1.14-1.25 g/lb LBM (~2.5-2.8 g/kg LBM)
//   sits inside that band.
//   Longland et al. (2016), Am J Clin Nutr 103(3):738-46 — 2.4 g/kg/day
//   (vs 1.2 g/kg/day) produced lean-mass GAIN, not just preservation, during
//   a deficit combined with resistance training; the secondary reason this
//   mode pairs its copy with a nudge toward the Training tab rather than
//   treating protein as sufficient on its own.
const PROTEIN_FLOOR_SOURCE = {
  label: "Helms, Aragon & Fitschen (2014)",
  detail: "J Int Soc Sports Nutr 11:20 — 2.3-3.1 g/kg fat-free mass/day preserves lean mass in a caloric deficit.",
  secondary: "Longland et al. (2016), Am J Clin Nutr 103(3) — 2.4 g/kg/day produced lean-mass gain (not just preservation) during a deficit combined with resistance training.",
  url: "https://jissn.biomedcentral.com/articles/10.1186/1550-2783-11-20",
  note: "This app's own 1.14-1.25 g/lb lean-mass target (see the Engine tab) already sits inside that range — protein-priority mode makes the solver defend the low end of it instead of trading it off against calories.",
};

// Protein-priority weighting: protein goes from "one of four traded-off
// terms" to the dominant one. kcal stays meaningful (a plan that blows the
// calorie target isn't "priority," it's broken) but no longer outweighs
// protein the way the default weights do.
//
// REBALANCED 2026-07-24 — these numbers are MEASURED, not chosen by eye.
//
// WHY. mealSolver's default SCORE_WEIGHTS moved to 0.46/0.30/0.12/0.12, and at
// the same time the fat/carb error basis changed: it is now `bandMiss ÷ that
// macro's own day tolerance`, capped at 1, so a term of 1.0 IS the line
// dayInTolerance() draws. This table kept its pre-change 0.075 fat/carb
// weights, so protein-priority mode inherited the new, harsher error basis but
// only ~62% of the weight to express it — it systematically UNDER-reported a
// fat miss relative to default mode.
//
// MEASURED, 175 real solver-days (5 body shapes x 5 diets x a week each, real
// computeMacros targets, real 889-recipe pool, filters.proteinPriority on),
// looking at the days that FAILED the four-macro tolerance:
//
//   fat/carb weight | fail-days scoring >=90 | worst fake-green | avg fail score
//   ----------------|------------------------|------------------|---------------
//   0.075 (old)     | 29.4%                  | 92               | 86.5
//   0.12  (this)    |  0.0%                  | 88               | 80.0
//   0.12  (default) |  0.0%                  | 88               | 79.8
//
// So under the old weights, 30 of 102 out-of-tolerance days were still shown a
// 90-something match — the exact "fake-green" overstatement that was just fixed
// in default mode. At 0.12 that class is empty, and priority mode's honesty is
// within 0.2 points of default mode's.
//
// WHY 0.12 SPECIFICALLY and not higher: fat/carb match SCORE_WEIGHTS exactly, so
// a given fat miss costs the SAME number of points in both modes. That is the
// property that matters — the headline number must not disagree with the
// green/amber verdict more in one mode than the other. Raising them further
// (0.15 was measured: worst fake-green 87, avg 75.6) would make protein-priority
// mode HARSHER on fat than default mode, which is a different bug in the other
// direction.
//
// kcal 0.32 / protein 0.44 splits the remaining 0.76 with protein dominant, so
// the mode still does its job (protein > kcal, and 0.44 is well above both
// SCORE_WEIGHTS.protein 0.30 and scorer.js DEFAULT_WEIGHTS.protein 0.35). Sums
// to 1.00, like SCORE_WEIGHTS, so matchPct stays a true weighted closeness
// measure rather than clamping early at 0.
//
// NOTE: these weights are a POST-HOC READ of an already-solved day — the same
// 175-day sweep showed candidate SELECTION is byte-identical across every weight
// set tried (the solver now ranks candidates by remaining fat/carb budget, not
// by this objective). So this change moves the reported number and nothing else;
// days-in-tolerance was 41.7% before and after.
const PROTEIN_PRIORITY_WEIGHTS = { kcal: 0.32, protein: 0.44, fat: 0.12, carb: 0.12 };

// A day is short of the floor once achieved protein falls more than this
// fraction below the target's floor. 5% (~10g at a 200g floor) is inside
// normal portion-rounding noise (5g practical rounding, 0.5-2x scale
// clamping); past that it's a real miss the UI must own, never absorb into
// a blended score silently.
const FLOOR_TOLERANCE_FRAC = 0.05;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * checkProteinFloor(achievedProteinG, floorG, toleranceFrac?) -> {
 *   met, floorG, achievedG, shortG, shortPct, reason
 * }
 * reason is null when met — the honesty contract is "declare when unmeetable,"
 * not "narrate every success."
 */
function checkProteinFloor(achievedProteinG, floorG, toleranceFrac = FLOOR_TOLERANCE_FRAC) {
  const floor = Math.max(0, Number(floorG) || 0);
  const achieved = Math.max(0, Number(achievedProteinG) || 0);
  if (floor <= 0) {
    return { met: true, floorG: 0, achievedG: round1(achieved), shortG: 0, shortPct: 0, reason: null };
  }
  const shortG = Math.max(0, floor - achieved);
  const shortPct = shortG / floor;
  const met = shortPct <= toleranceFrac;
  return {
    met,
    floorG: round1(floor),
    achievedG: round1(achieved),
    shortG: round1(shortG),
    shortPct: Math.round(shortPct * 1000) / 10, // one decimal place, as a percent
    reason: met
      ? null
      : `${round1(shortG)} g short of the ${round1(floor)} g protein floor (${Math.round(shortPct * 100)}% under) — the compliant pool couldn't scale up to close the gap within the 0.5-2x portion limit.`,
  };
}

module.exports = { PROTEIN_FLOOR_SOURCE, PROTEIN_PRIORITY_WEIGHTS, FLOOR_TOLERANCE_FRAC, checkProteinFloor };
