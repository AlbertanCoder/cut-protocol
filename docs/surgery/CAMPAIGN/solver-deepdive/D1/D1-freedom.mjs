// D1 — (F) does fat/carb influence the PORTIONING at all?  (G) negative raw
// solves.  (H) the keto trim loop.  (I) how much fat/carb freedom actually
// exists inside the box once kcal+protein tolerance is respected.
// READ-ONLY on a COPY of dev.db.

import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const wp = require("./src/lib/weeklyPlanner.js");

const MACROS = ["kcal", "protein", "fat", "carb"];
const bundle = (ings) => { const a = { kcal: 0, protein: 0, fat: 0, carb: 0 }; for (const i of ings) for (const m of MACROS) a[m] += (i.food[m] || 0) * (i.baseGrams / 100); return a; };
const gauss2 = (a11, a12, a21, a22, b1, b2) => { let A = [[a11, a12, b1], [a21, a22, b2]]; if (Math.abs(A[1][0]) > Math.abs(A[0][0])) A = [A[1], A[0]]; if (A[0][0] === 0) return null; const f = A[1][0] / A[0][0]; const r1 = A[1][1] - f * A[0][1], r2 = A[1][2] - f * A[0][2]; if (r1 === 0) return null; const y = r2 / r1; return [(A[0][2] - A[0][1] * y) / A[0][0], y]; };
const clampv = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const practical = (g) => (!(g > 0) ? 0 : g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));
const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);
const qq = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const LO = 0.5, HI = 2;
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

// ── F. INVARIANCE: identical kcal/protein, opposite fat/carb ask ──────────
// One-recipe pool so selection cannot confound. If the shipped grams are
// identical, the portioning provably never reads fat or carb.
const rngF = mulberry(11111);
let fTested = 0, fIdentical = 0, fDiffered = 0;
const fatSpread = [];
for (let k = 0; k < 250; k++) {
  const x = R[Math.floor(rngF() * R.length)];
  const kt = 300 + rngF() * 700, pt = 20 + rngF() * 50;
  const base = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget: kt, proteinTarget: pt };
  const lean = { ...base, fatShare: 5, fatTarget: 0.1, carbShare: 60, carbTarget: 60 };
  const fatty = { ...base, fatShare: 60, fatTarget: 60, carbShare: 5, carbTarget: 0.1 };
  const pool = [{ ...x.r, slotType: "either" }];
  const a = await wp.resolveSlot(lean, [pool[0]], new Map(), new Set(), new Set(), () => 0.5, null, null, 99);
  const b = await wp.resolveSlot(fatty, [pool[0]], new Map(), new Set(), new Set(), () => 0.5, null, null, 99);
  if (!a.recipeId || !b.recipeId) continue;
  fTested++;
  const ga = a.ingredients.map((i) => i.grams).join(","), gb = b.ingredients.map((i) => i.grams).join(",");
  if (ga === gb) fIdentical++; else fDiffered++;
  fatSpread.push(Math.abs(a.fat - b.fat));
}
out.F_fatCarbInvariance = {
  scaleRecipeArity: wp.scaleRecipe.length,
  pairsTested: fTested,
  identicalShippedGrams: fIdentical, differed: fDiffered,
  maxFatDifferenceAcrossOppositeAsks: +Math.max(...fatSpread, 0).toFixed(6),
  verdict: fDiffered === 0 ? "PORTIONING IS INVARIANT TO fat/carb TARGETS" : "fat/carb influenced portioning",
};

// ── G. how often is the exact (kcal,protein) solution physically absurd? ──
const dailyKcals = [1500, 1750, 2000, 2250, 2500, 2750, 3000];
const shares = [0.9 / 3.45, 1 / 3.45, 1.15 / 3.45, 0.4 / 3.45];
const targets = [];
for (const dk of dailyKcals) for (const pr of [0.06, 0.075, 0.09]) for (const sh of shares) targets.push({ kcal: dk * sh, protein: dk * pr * sh });
let gN = 0, gNegP = 0, gNegS = 0, gNegAny = 0, gHugeAny = 0;
for (const x of R) {
  if (x.degen) continue;
  for (const t of targets) {
    if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
    const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal);
    if (!g) continue;
    gN++;
    if (g[0] < 0) gNegP++; if (g[1] < 0) gNegS++;
    if (g[0] < 0 || g[1] < 0) gNegAny++;
    if (g[0] > 10 || g[1] > 10) gHugeAny++;
  }
}
out.G_absurdExactSolutions = {
  nonDegeneratePlausiblePairs: gN,
  exactSolutionNeedsNegativeProteinBundle: gNegP, pctP: pct(gNegP, gN),
  exactSolutionNeedsNegativeSidesBundle: gNegS, pctS: pct(gNegS, gN),
  anyNegative: gNegAny, anyNegativePct: pct(gNegAny, gN),
  anyKnobOver10x: gHugeAny, anyOver10xPct: pct(gHugeAny, gN),
};

// ── H. the keto ceiling trim loop, enumerated ────────────────────────────
function trimSeq(startSides) {
  const seq = [];
  for (let s = startSides - 0.05; s > LO; s -= 0.05) seq.push(s);
  return seq;
}
const seqs = {};
for (const st of [2, 1.75, 1.5, 1.23, 1, 0.85, 0.6, 0.55, 0.5]) {
  const s = trimSeq(st);
  seqs[String(st)] = { steps: s.length, first: s[0] ?? null, last: s.length ? +s[s.length - 1].toFixed(17) : null, anyBelowFloor: s.some((v) => v < LO) };
}
out.H_ketoTrimLoop = {
  step: 0.05, boundedBy: "s > SCALE_BOUNDS.min (STRICT) then one explicit floor try",
  sequences: seqs,
  proteinScalePassedToTrim: "scaled.proteinScale — the round2'd LABEL, not the raw factor (weeklyPlanner.js:386,389)",
};
// how much does re-applying with the ROUNDED proteinScale move the plate?
const rngH = mulberry(777);
let hN = 0, hChanged = 0; const hKcalDrift = [];
for (let k = 0; k < 600; k++) {
  const x = R[Math.floor(rngH() * R.length)];
  const kt = 300 + rngH() * 700, pt = 20 + rngH() * 50;
  let rp, rs;
  if (x.degen) rp = rs = x.r.kcal > 0 ? kt / x.r.kcal : 1;
  else { const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, pt - x.fixed.protein, kt - x.fixed.kcal); if (!g) continue; [rp, rs] = g; }
  const cp = clampv(rp, LO, HI), cs = clampv(rs, LO, HI);
  const rounded = Math.round(cp * 100) / 100;
  hN++;
  if (rounded !== cp) {
    const kRaw = x.r.ingredients.reduce((s2, i) => s2 + (i.food.kcal || 0) * practical(i.baseGrams * (!i.scalable ? 1 : i.role === "protein" ? cp : cs)) / 100, 0);
    const kRnd = x.r.ingredients.reduce((s2, i) => s2 + (i.food.kcal || 0) * practical(i.baseGrams * (!i.scalable ? 1 : i.role === "protein" ? rounded : cs)) / 100, 0);
    if (kRnd !== kRaw) { hChanged++; hKcalDrift.push(Math.abs(kRnd - kRaw)); }
  }
}
out.H_roundedProteinScaleReapply = {
  sampled: hN, platesWhoseKcalMovesWhenReapplied: hChanged, pctOfSampled: pct(hChanged, hN),
  kcalDrift_median: hKcalDrift.length ? +qq(hKcalDrift, 0.5).toFixed(2) : null,
  kcalDrift_max: hKcalDrift.length ? +Math.max(...hKcalDrift).toFixed(2) : null,
};

// ── I. how much fat/carb freedom exists inside the box + the kcal/protein gate? ──
// Grid the box, keep points passing the SHIPPED gate (kcal within 15 %,
// protein shortfall <= 12 %), and measure the achievable fat / carb range.
// This is the size of the degree of freedom the 2-macro objective discards.
const rngI = mulberry(31337);
const fatRangeAbs = [], fatRangeRel = [], carbRangeAbs = [], carbRangeRel = [];
let iPairs = 0, iFeasible = 0, iExactIsOnlyPoint = 0;
for (let k = 0; k < 900; k++) {
  const x = R[Math.floor(rngI() * R.length)];
  const t = targets[Math.floor(rngI() * targets.length)];
  if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
  iPairs++;
  let minF = Infinity, maxF = -Infinity, minC = Infinity, maxC = -Infinity, nPts = 0;
  for (let p = LO; p <= HI + 1e-9; p += 0.025) {
    for (let s = LO; s <= HI + 1e-9; s += 0.025) {
      let kc = 0, pr = 0, ft = 0, cb = 0;
      for (const i of x.r.ingredients) {
        const sc = !i.scalable ? 1 : i.role === "protein" ? p : s;
        const g = practical(i.baseGrams * sc);
        kc += (i.food.kcal || 0) * g / 100; pr += (i.food.protein || 0) * g / 100;
        ft += (i.food.fat || 0) * g / 100; cb += (i.food.carb || 0) * g / 100;
      }
      if (Math.abs(kc - t.kcal) / t.kcal > 0.15) continue;
      if (Math.max(0, (t.protein - pr) / t.protein) > 0.12) continue;
      nPts++;
      if (ft < minF) minF = ft; if (ft > maxF) maxF = ft;
      if (cb < minC) minC = cb; if (cb > maxC) maxC = cb;
    }
  }
  if (!nPts) continue;
  iFeasible++;
  if (nPts === 1) iExactIsOnlyPoint++;
  fatRangeAbs.push(maxF - minF); carbRangeAbs.push(maxC - minC);
  const midF = (maxF + minF) / 2, midC = (maxC + minC) / 2;
  if (midF > 0) fatRangeRel.push((maxF - minF) / midF);
  if (midC > 0) carbRangeRel.push((maxC - minC) / midC);
}
out.I_discardedFreedom = {
  note: "grid 0.025 over the 0.5-2 box, keeping only points that PASS the shipped kcal+protein slot gate",
  pairsEvaluated: iPairs, pairsWithAnyFeasiblePoint: iFeasible, pairsWithExactlyOneFeasiblePoint: iExactIsOnlyPoint,
  achievableFatRange_g_median: +qq(fatRangeAbs, 0.5).toFixed(2),
  achievableFatRange_g_p90: +qq(fatRangeAbs, 0.9).toFixed(2),
  achievableFatRange_relToMid_median: +qq(fatRangeRel, 0.5).toFixed(3),
  achievableCarbRange_g_median: +qq(carbRangeAbs, 0.5).toFixed(2),
  achievableCarbRange_g_p90: +qq(carbRangeAbs, 0.9).toFixed(2),
  achievableCarbRange_relToMid_median: +qq(carbRangeRel, 0.5).toFixed(3),
};

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
