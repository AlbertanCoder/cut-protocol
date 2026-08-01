// D1 — the 0.5x floor, the degenerate branch's fixed-ingredient bias,
// practical-rounding effects, and the pin-label false-positive band.
// All arithmetic re-derived here; scaleRecipe is only used as a cross-check.
// READ-ONLY on a COPY of dev.db.

import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const MACROS = ["kcal", "protein", "fat", "carb"];
const bundle = (ings) => {
  const a = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  for (const i of ings) for (const m of MACROS) a[m] += (i.food[m] || 0) * (i.baseGrams / 100);
  return a;
};
const gauss2 = (a11, a12, a21, a22, b1, b2) => {
  let A = [[a11, a12, b1], [a21, a22, b2]];
  if (Math.abs(A[1][0]) > Math.abs(A[0][0])) A = [A[1], A[0]];
  if (A[0][0] === 0) return null;
  const f = A[1][0] / A[0][0];
  const r1 = A[1][1] - f * A[0][1], r2 = A[1][2] - f * A[0][2];
  if (r1 === 0) return null;
  const y = r2 / r1;
  return [(A[0][2] - A[0][1] * y) / A[0][0], y];
};
const clampv = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const practical = (g) => (!(g > 0) ? 0 : g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => +(100 * a / b).toFixed(2);
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };

const LO = 0.5, HI = 2;

const recipes0 = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
const R = recipes0.map((r) => {
  const fixed = bundle(r.ingredients.filter((i) => !i.scalable));
  const scal = r.ingredients.filter((i) => i.scalable);
  const pIng = scal.filter((i) => i.role === "protein");
  const P = bundle(pIng), S = bundle(scal.filter((i) => i.role !== "protein"));
  const det = P.protein * S.kcal - S.protein * P.kcal;
  return { r, fixed, P, S, nP: pIng.length, det, degen: pIng.length === 0 || Math.abs(det) < 1e-6,
    minKcal: fixed.kcal + LO * (P.kcal + S.kcal), maxKcal: fixed.kcal + HI * (P.kcal + S.kcal),
    baseKcal: fixed.kcal + P.kcal + S.kcal };
});
const out = {};

// ── A. the true reachable kcal window of a dish (the floor's real shape) ──
// The floor is NOT 0.5 x recipe.kcal: non-scalable ingredients never shrink.
const fixedShare = R.map((x) => (x.baseKcal > 0 ? x.fixed.kcal / x.baseKcal : 0));
out.A_reachWindow = {
  recipesWithFixedKcal: R.filter((x) => x.fixed.kcal > 0).length,
  fixedKcalShare_median: +q(fixedShare, 0.5).toFixed(3),
  fixedKcalShare_p90: +q(fixedShare, 0.9).toFixed(3),
  fixedKcalShare_max: +Math.max(...fixedShare).toFixed(3),
  // "0.5x floor" as a fraction of base kcal, actual:
  effectiveFloorFrac_median: +q(R.map((x) => x.minKcal / x.baseKcal), 0.5).toFixed(3),
  effectiveFloorFrac_p90: +q(R.map((x) => x.minKcal / x.baseKcal), 0.9).toFixed(3),
  minKcal_median: Math.round(q(R.map((x) => x.minKcal), 0.5)),
  baseKcal_median: Math.round(q(R.map((x) => x.baseKcal), 0.5)),
};
// how many recipes can be portioned DOWN to a typical snack / meal slot at all
const slotSizes = { snack_2000kcal_232: 232, meal_2000kcal_580: 580, meal_1600kcal_464: 464, meal_2600kcal_754: 754 };
out.A_reachability = {};
for (const [k, kt] of Object.entries(slotSizes)) {
  out.A_reachability[k] = {
    tooBigEvenAtFloor: R.filter((x) => x.minKcal > kt * 1.15).length,
    tooSmallEvenAtCeiling: R.filter((x) => x.maxKcal < kt * 0.85).length,
    reachable: R.filter((x) => x.minKcal <= kt * 1.15 && x.maxKcal >= kt * 0.85).length,
    ofTotal: R.length,
  };
}

// ── B. degenerate branch: kcalTarget/recipe.kcal ignores `fixed` ──────────
// The 2-knob branch nets fixed out (L402-403); the 1-knob branch (L410) does not.
const degen = R.filter((x) => x.degen);
let degenWithFixed = 0;
const degenErr = [];
for (const x of degen) {
  if (x.fixed.kcal > 0) degenWithFixed++;
  for (const kt of [232, 464, 580, 754]) {
    const rawCode = x.r.kcal > 0 ? kt / x.r.kcal : 1;              // what L410 computes
    const rawCorrect = (x.P.kcal + x.S.kcal) > 0 ? (kt - x.fixed.kcal) / (x.P.kcal + x.S.kcal) : 1;
    const sCode = clampv(rawCode, LO, HI), sCorr = clampv(rawCorrect, LO, HI);
    const achCode = x.fixed.kcal + sCode * (x.P.kcal + x.S.kcal);
    const achCorr = x.fixed.kcal + sCorr * (x.P.kcal + x.S.kcal);
    // only meaningful where the correct answer is INSIDE the box (else both pin)
    if (rawCorrect > LO && rawCorrect < HI) {
      degenErr.push({ codeOffPct: Math.abs(achCode - kt) / kt, corrOffPct: Math.abs(achCorr - kt) / kt });
    }
  }
}
out.B_degenerateBranch = {
  oneKnobRecipes: degen.length,
  oneKnobRecipesWithFixedKcal: degenWithFixed,
  interiorCases: degenErr.length,
  code_kcalOff_median: +q(degenErr.map((e) => e.codeOffPct), 0.5).toFixed(4),
  code_kcalOff_p90: +q(degenErr.map((e) => e.codeOffPct), 0.9).toFixed(4),
  code_kcalOff_max: +Math.max(...degenErr.map((e) => e.codeOffPct)).toFixed(4),
  correct_kcalOff_max: +Math.max(...degenErr.map((e) => e.corrOffPct)).toFixed(6),
  code_casesOver15pctTol: degenErr.filter((e) => e.codeOffPct > 0.15).length,
};

// ── C. clamp census over realistic (recipe, slot-target) pairs ────────────
// Restricted to REACHABLE recipes (the sampler is ratio-biased, so pairing a
// 90 kcal snack with a 750 kcal dinner slot would inflate the clamp rate).
const dailyKcals = [1500, 1750, 2000, 2250, 2500, 2750, 3000];
const pRatios = [0.06, 0.075, 0.09];        // g protein per kcal
const shares = [0.9 / 3.45, 1 / 3.45, 1.15 / 3.45, 0.4 / 3.45];
const targets = [];
for (const dk of dailyKcals) for (const pr of pRatios) for (const sh of shares) {
  targets.push({ kcal: dk * sh, protein: dk * pr * sh });
}
let n = 0, pinLo = 0, pinHi = 0, bothLo = 0, anyPin = 0, interior = 0;
let pLo = 0, pHi = 0, sLo = 0, sHi = 0;
const wantedBelow = [], wantedAbove = [];
let falsePinLo = 0, falsePinHi = 0, truePinLo = 0, truePinHi = 0;
let gateFailAtFloor = 0, gateFailAtCeil = 0, floorOvershoot = [];
for (const x of R) {
  for (const t of targets) {
    if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue; // plausible draw
    n++;
    let rp, rs;
    if (x.degen) {
      rp = rs = x.r.kcal > 0 ? t.kcal / x.r.kcal : 1;
    } else {
      const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal);
      if (!g) continue;
      [rp, rs] = g;
    }
    const cp = clampv(rp, LO, HI), cs = clampv(rs, LO, HI);
    const lo = (rp < LO) || (rs < LO), hi = (rp > HI) || (rs > HI);
    if (rp < LO) pLo++; if (rp > HI) pHi++; if (rs < LO) sLo++; if (rs > HI) sHi++;
    if (lo && !hi) pinLo++; else if (hi && !lo) pinHi++; else if (lo && hi) bothLo++; else interior++;
    if (lo || hi) anyPin++;
    if (rp < LO) wantedBelow.push(rp); if (rs < LO) wantedBelow.push(rs);
    if (rp > HI) wantedAbove.push(rp); if (rs > HI) wantedAbove.push(rs);
    // pin-LABEL false positives: round2 of an INTERIOR raw value also reads 0.5 / 2.0
    for (const v of [rp, rs]) {
      if (v < LO) truePinLo++;
      else if (r2(clampv(v, LO, HI)) === LO) falsePinLo++;
      if (v > HI) truePinHi++;
      else if (r2(clampv(v, LO, HI)) === HI) falsePinHi++;
    }
    // what the slot gate sees when the solve is pinned
    const achK = x.fixed.kcal + cp * x.P.kcal + cs * x.S.kcal;
    const achP = x.fixed.protein + cp * x.P.protein + cs * x.S.protein;
    const kOff = Math.abs(achK - t.kcal) / t.kcal;
    const pShort = Math.max(0, (t.protein - achP) / t.protein);
    if (lo && !hi) { floorOvershoot.push(achK / t.kcal); if (kOff > 0.15 || pShort > 0.12) gateFailAtFloor++; }
    if (hi && !lo && (kOff > 0.15 || pShort > 0.12)) gateFailAtCeil++;
  }
}
out.C_clampCensus = {
  plausiblePairs: n,
  interiorSolves: interior, interiorPct: pct(interior, n),
  pinnedLowOnly: pinLo, pinnedLowPct: pct(pinLo, n),
  pinnedHighOnly: pinHi, pinnedHighPct: pct(pinHi, n),
  pinnedBothDirections: bothLo, pinnedBothPct: pct(bothLo, n),
  anyPinned: anyPin, anyPinnedPct: pct(anyPin, n),
  perKnob: { proteinScale_belowFloor: pLo, proteinScale_aboveCeil: pHi, sidesScale_belowFloor: sLo, sidesScale_aboveCeil: sHi },
  wantedBelowFloor_median: wantedBelow.length ? +q(wantedBelow, 0.5).toFixed(3) : null,
  wantedBelowFloor_p10: wantedBelow.length ? +q(wantedBelow, 0.1).toFixed(3) : null,
  wantedBelowFloor_min: wantedBelow.length ? +Math.min(...wantedBelow).toFixed(3) : null,
  wantedAboveCeil_median: wantedAbove.length ? +q(wantedAbove, 0.5).toFixed(3) : null,
  wantedAboveCeil_p90: wantedAbove.length ? +q(wantedAbove, 0.9).toFixed(3) : null,
  wantedAboveCeil_max: wantedAbove.length ? +Math.max(...wantedAbove).toFixed(3) : null,
  floorOvershoot_kcalRatio_median: floorOvershoot.length ? +q(floorOvershoot, 0.5).toFixed(3) : null,
  floorOvershoot_kcalRatio_p90: floorOvershoot.length ? +q(floorOvershoot, 0.9).toFixed(3) : null,
  gateFailsWhenPinnedLow: gateFailAtFloor, gateFailsWhenPinnedLowPct: pct(gateFailAtFloor, pinLo),
  gateFailsWhenPinnedHigh: gateFailAtCeil, gateFailsWhenPinnedHighPct: pct(gateFailAtCeil, pinHi),
};
out.C_pinLabelBand = {
  note: "a knob whose RAW value is interior but within 0.005 of a bound gets a round2 LABEL equal to the bound",
  trueFloorPins: truePinLo, labelOnlyFloorPins: falsePinLo,
  falsePositiveRate_floor: pct(falsePinLo, truePinLo + falsePinLo),
  trueCeilPins: truePinHi, labelOnlyCeilPins: falsePinHi,
  falsePositiveRate_ceil: pct(falsePinHi, truePinHi + falsePinHi),
};

// ── D. practical-gram rounding: how far does it move the solved macros? ───
const roundErrK = [], roundErrP = [], roundErrF = [], roundErrC = [];
let inflatedTo1g = 0, roundedToZero = 0, scalableIngSeen = 0, crossedTol = 0, uncrossedTol = 0;
for (const x of R) {
  for (const t of targets.filter((_, i) => i % 4 === 0)) {
    if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
    let rp, rs;
    if (x.degen) rp = rs = x.r.kcal > 0 ? t.kcal / x.r.kcal : 1;
    else { const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal); if (!g) continue; [rp, rs] = g; }
    const cp = clampv(rp, LO, HI), cs = clampv(rs, LO, HI);
    const exact = { kcal: 0, protein: 0, fat: 0, carb: 0 }, rounded = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    for (const i of x.r.ingredients) {
      const sc = !i.scalable ? 1 : i.role === "protein" ? cp : cs;
      const raw = i.baseGrams * sc, g = practical(raw);
      if (i.scalable) { scalableIngSeen++; if (raw > 0 && raw < 0.5) inflatedTo1g++; if (g === 0 && raw > 0) roundedToZero++; }
      for (const m of MACROS) { exact[m] += (i.food[m] || 0) * raw / 100; rounded[m] += (i.food[m] || 0) * g / 100; }
    }
    if (exact.kcal > 0) roundErrK.push(Math.abs(rounded.kcal - exact.kcal) / exact.kcal);
    if (exact.protein > 0) roundErrP.push(Math.abs(rounded.protein - exact.protein) / exact.protein);
    if (exact.fat > 0) roundErrF.push(Math.abs(rounded.fat - exact.fat) / exact.fat);
    if (exact.carb > 0) roundErrC.push(Math.abs(rounded.carb - exact.carb) / exact.carb);
    const inExact = Math.abs(exact.kcal - t.kcal) / t.kcal <= 0.15 && Math.max(0, (t.protein - exact.protein) / t.protein) <= 0.12;
    const inRound = Math.abs(rounded.kcal - t.kcal) / t.kcal <= 0.15 && Math.max(0, (t.protein - rounded.protein) / t.protein) <= 0.12;
    if (inExact && !inRound) crossedTol++;
    if (!inExact && inRound) uncrossedTol++;
  }
}
out.D_practicalRounding = {
  pairs: roundErrK.length,
  kcalRelErr_median: +q(roundErrK, 0.5).toFixed(4), kcalRelErr_p95: +q(roundErrK, 0.95).toFixed(4), kcalRelErr_max: +Math.max(...roundErrK).toFixed(4),
  proteinRelErr_p95: +q(roundErrP, 0.95).toFixed(4), proteinRelErr_max: +Math.max(...roundErrP).toFixed(4),
  fatRelErr_p95: +q(roundErrF, 0.95).toFixed(4), fatRelErr_max: +Math.max(...roundErrF).toFixed(4),
  carbRelErr_p95: +q(roundErrC, 0.95).toFixed(4), carbRelErr_max: +Math.max(...roundErrC).toFixed(4),
  scalableIngredientEvaluations: scalableIngSeen,
  sub0p5gInflatedTo1g: inflatedTo1g, inflatedPct: pct(inflatedTo1g, scalableIngSeen),
  roundedToZero: roundedToZero,
  roundingKnockedOutOfTolerance: crossedTol,
  roundingKnockedIntoTolerance: uncrossedTol,
};

// ── E. how many recipes have a sub-1g scalable ingredient (hidden floor) ──
let recipesWithTinyScalable = 0, tinyIngRows = 0;
for (const x of R) {
  const tiny = x.r.ingredients.filter((i) => i.scalable && i.baseGrams > 0 && i.baseGrams * LO < 0.5);
  if (tiny.length) recipesWithTinyScalable++;
  tinyIngRows += tiny.length;
}
out.E_hiddenGramFloor = { recipesWithScalableIngThatCannotShrink: recipesWithTinyScalable, ingredientRows: tinyIngRows, ofRecipes: R.length };

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
