// D1 — (J) coordinate-wise clamping of the UNCONSTRAINED exact solution is not
// the box-constrained optimum. How much accuracy is lost for free?
// (K) lexicographic in-gate fat/carb steering: improvement available WITHOUT
// leaving the kcal+protein tolerance the slot is already gated on.
// READ-ONLY on a COPY of dev.db.

import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const MACROS = ["kcal", "protein", "fat", "carb"];
const bundle = (ings) => { const a = { kcal: 0, protein: 0, fat: 0, carb: 0 }; for (const i of ings) for (const m of MACROS) a[m] += (i.food[m] || 0) * (i.baseGrams / 100); return a; };
const gauss2 = (a11, a12, a21, a22, b1, b2) => { let A = [[a11, a12, b1], [a21, a22, b2]]; if (Math.abs(A[1][0]) > Math.abs(A[0][0])) A = [A[1], A[0]]; if (A[0][0] === 0) return null; const f = A[1][0] / A[0][0]; const r1 = A[1][1] - f * A[0][1], r2 = A[1][2] - f * A[0][2]; if (r1 === 0) return null; const y = r2 / r1; return [(A[0][2] - A[0][1] * y) / A[0][0], y]; };
const clampv = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const practical = (g) => (!(g > 0) ? 0 : g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));
const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);
const qq = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const LO = 0.5, HI = 2, KTOL = 0.15, PTOL = 0.12;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const recipes0 = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
const R = recipes0.map((r) => {
  const fixed = bundle(r.ingredients.filter((i) => !i.scalable));
  const scal = r.ingredients.filter((i) => i.scalable);
  const pI = scal.filter((i) => i.role === "protein");
  const P = bundle(pI), S = bundle(scal.filter((i) => i.role !== "protein"));
  const det = P.protein * S.kcal - S.protein * P.kcal;
  return { r, fixed, P, S, nP: pI.length, det, degen: pI.length === 0 || Math.abs(det) < 1e-6,
    minKcal: fixed.kcal + LO * (P.kcal + S.kcal), maxKcal: fixed.kcal + HI * (P.kcal + S.kcal) };
});
const out = {};
const dailyKcals = [1500, 1750, 2000, 2250, 2500, 2750, 3000];
const shares = [0.9 / 3.45, 1 / 3.45, 1.15 / 3.45, 0.4 / 3.45];
const targets = [];
for (const dk of dailyKcals) for (const pr of [0.06, 0.075, 0.09]) for (const sh of shares) {
  // realistic composition asks: 28 % of kcal from fat, remainder carbs
  const kcal = dk * sh, protein = dk * pr * sh;
  const fat = (kcal * 0.28) / 9;
  const carb = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  targets.push({ kcal, protein, fat, carb });
}

// linear (pre-rounding) macros for a (p,s) pair
const lin = (x, p, s) => ({
  kcal: x.fixed.kcal + p * x.P.kcal + s * x.S.kcal,
  protein: x.fixed.protein + p * x.P.protein + s * x.S.protein,
});
// tolerance-normalised worst ratio, the SHIPPED accept rule (kcalOffPct / KCAL_TOLERANCE_PCT
// vs proteinShortfallPct / PROTEIN_TOLERANCE_PCT), re-derived here not imported
const worst = (m, t) => Math.max(
  (t.kcal > 0 ? Math.abs(m.kcal - t.kcal) / t.kcal : 0) / KTOL,
  (t.protein > 0 ? Math.max(0, (t.protein - m.protein) / t.protein) : 0) / PTOL
);
// neutral, gate-independent residual
const l2rel = (m, t) => Math.hypot((m.kcal - t.kcal) / t.kcal, (m.protein - t.protein) / t.protein);

// ── J. naive clamp vs box-constrained optimum (LINEAR, rounding excluded) ──
const rngJ = mulberry(90210);
let jN = 0, jOutside = 0, jBetter = 0, jGateFlips = 0;
const dWorst = [], dL2 = [];
for (let k = 0; k < 4000; k++) {
  const x = R[Math.floor(rngJ() * R.length)];
  if (x.degen) continue;
  const t = targets[Math.floor(rngJ() * targets.length)];
  if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
  const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal);
  if (!g) continue;
  jN++;
  const outsideBox = g[0] < LO || g[0] > HI || g[1] < LO || g[1] > HI;
  if (!outsideBox) continue;                       // interior => clamp is a no-op
  jOutside++;
  const cp = clampv(g[0], LO, HI), cs = clampv(g[1], LO, HI);
  const shipped = lin(x, cp, cs);
  let bestW = Infinity, bestL2 = Infinity;
  for (let p = LO; p <= HI + 1e-9; p += 0.005) {
    for (let s = LO; s <= HI + 1e-9; s += 0.005) {
      const m = lin(x, p, s);
      const w = worst(m, t); if (w < bestW) bestW = w;
      const l = l2rel(m, t); if (l < bestL2) bestL2 = l;
    }
  }
  const wShip = worst(shipped, t), lShip = l2rel(shipped, t);
  if (bestW < wShip - 1e-9) jBetter++;
  dWorst.push(wShip - bestW);
  dL2.push(lShip - bestL2);
  if (wShip > 1 && bestW <= 1) jGateFlips++;       // a feasible-in-gate point existed and was missed
}
out.J_clampVsConstrainedOptimum = {
  note: "linear model, no practical rounding, non-degenerate recipes, grid 0.005",
  plausiblePairs: jN,
  exactSolutionOutsideBox: jOutside, outsidePct: pct(jOutside, jN),
  clampIsSuboptimal: jBetter, suboptimalPct: pct(jBetter, jOutside),
  worstRatio_excessOverOptimum_median: +qq(dWorst, 0.5).toFixed(4),
  worstRatio_excessOverOptimum_p90: +qq(dWorst, 0.9).toFixed(4),
  worstRatio_excessOverOptimum_max: +Math.max(...dWorst, 0).toFixed(4),
  l2rel_excess_median: +qq(dL2, 0.5).toFixed(4),
  SLOTS_THE_CLAMP_LOSES_OUTRIGHT: jGateFlips,
  slotsLostPct_ofOutside: pct(jGateFlips, jOutside),
  slotsLostPct_ofAllPlausible: pct(jGateFlips, jN),
};

// ── K. lexicographic in-gate fat/carb steering (WITH practical rounding) ──
// Among box points that PASS the shipped kcal+protein gate, how much closer to
// the fat/carb ask can we get than the point the exact 2-macro solve lands on?
const rngK = mulberry(60613);
let kPairs = 0, kExactInGate = 0, kImproved = 0;
const fatBefore = [], fatAfter = [], carbBefore = [], carbAfter = [], compBefore = [], compAfter = [];
for (let k = 0; k < 1200; k++) {
  const x = R[Math.floor(rngK() * R.length)];
  const t = targets[Math.floor(rngK() * targets.length)];
  if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
  kPairs++;
  let ep, es;
  if (x.degen) ep = es = x.r.kcal > 0 ? t.kcal / x.r.kcal : 1;
  else { const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal); if (!g) continue; [ep, es] = g; }
  const cp = clampv(ep, LO, HI), cs = clampv(es, LO, HI);
  const full = (p, s) => {
    let kc = 0, pr = 0, ft = 0, cb = 0;
    for (const i of x.r.ingredients) {
      const gm = practical(i.baseGrams * (!i.scalable ? 1 : i.role === "protein" ? p : s));
      kc += (i.food.kcal || 0) * gm / 100; pr += (i.food.protein || 0) * gm / 100;
      ft += (i.food.fat || 0) * gm / 100; cb += (i.food.carb || 0) * gm / 100;
    }
    return { kcal: kc, protein: pr, fat: ft, carb: cb };
  };
  const inGate = (m) => Math.abs(m.kcal - t.kcal) / t.kcal <= KTOL && Math.max(0, (t.protein - m.protein) / t.protein) <= PTOL;
  // composition distance, re-derived: mean |got-want| / want over fat and carb
  const comp = (m) => ((t.fat > 0 ? Math.abs(m.fat - t.fat) / t.fat : 0) + (t.carb > 0 ? Math.abs(m.carb - t.carb) / t.carb : 0)) / 2;
  const shipped = full(cp, cs);
  if (!inGate(shipped)) continue;                  // only slots the solver already ships clean
  kExactInGate++;
  let best = shipped, bestC = comp(shipped);
  for (let p = LO; p <= HI + 1e-9; p += 0.01) {
    for (let s = LO; s <= HI + 1e-9; s += 0.01) {
      const m = full(p, s);
      if (!inGate(m)) continue;
      const c = comp(m);
      if (c < bestC) { bestC = c; best = m; }
    }
  }
  if (bestC < comp(shipped) - 1e-9) kImproved++;
  fatBefore.push(Math.abs(shipped.fat - t.fat)); fatAfter.push(Math.abs(best.fat - t.fat));
  carbBefore.push(Math.abs(shipped.carb - t.carb)); carbAfter.push(Math.abs(best.carb - t.carb));
  compBefore.push(comp(shipped)); compAfter.push(bestC);
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
out.K_inGateSteering = {
  note: "practical rounding applied; only slots whose exact 2-macro solve ALREADY passes the kcal+protein gate; the alternative point must also pass it",
  slotsConsidered: kPairs, slotsWhereExactSolveIsInGate: kExactInGate,
  slotsWhereAStrictlyBetterInGatePointExists: kImproved, improvablePct: pct(kImproved, kExactInGate),
  fatAbsErr_g_mean_before: +mean(fatBefore).toFixed(2), fatAbsErr_g_mean_after: +mean(fatAfter).toFixed(2),
  fatAbsErr_g_median_before: +qq(fatBefore, 0.5).toFixed(2), fatAbsErr_g_median_after: +qq(fatAfter, 0.5).toFixed(2),
  carbAbsErr_g_mean_before: +mean(carbBefore).toFixed(2), carbAbsErr_g_mean_after: +mean(carbAfter).toFixed(2),
  carbAbsErr_g_median_before: +qq(carbBefore, 0.5).toFixed(2), carbAbsErr_g_median_after: +qq(carbAfter, 0.5).toFixed(2),
  compositionDistance_mean_before: +mean(compBefore).toFixed(3), compositionDistance_mean_after: +mean(compAfter).toFixed(3),
  compositionDistance_median_before: +qq(compBefore, 0.5).toFixed(3), compositionDistance_median_after: +qq(compAfter, 0.5).toFixed(3),
};

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
