// D1 — why the FLOOR binds and the ceiling does not, in the SHIPPED search.
// Hypothesis: proteinShortfallPct (weeklyPlanner.js:426-428) is one-sided, so an
// over-sized portion pays nothing on protein while an under-sized one pays twice.
// READ-ONLY on a COPY of dev.db.
import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const M = ["kcal", "protein", "fat", "carb"];
const bundle = (I) => { const a = { kcal: 0, protein: 0, fat: 0, carb: 0 }; for (const i of I) for (const m of M) a[m] += (i.food[m] || 0) * (i.baseGrams / 100); return a; };
const g2 = (a11, a12, a21, a22, b1, b2) => { let A = [[a11, a12, b1], [a21, a22, b2]]; if (Math.abs(A[1][0]) > Math.abs(A[0][0])) A = [A[1], A[0]]; if (A[0][0] === 0) return null; const f = A[1][0] / A[0][0]; const r1 = A[1][1] - f * A[0][1], r2 = A[1][2] - f * A[0][2]; if (r1 === 0) return null; const y = r2 / r1; return [(A[0][2] - A[0][1] * y) / A[0][0], y]; };
const cl = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const pr5 = (g) => (!(g > 0) ? 0 : g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));
const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);
const qq = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const LO = 0.5, HI = 2, KT = 0.15, PT = 0.12;
const mb = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const rec = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
const R = rec.map((r) => {
  const fixed = bundle(r.ingredients.filter((i) => !i.scalable));
  const sc = r.ingredients.filter((i) => i.scalable);
  const pI = sc.filter((i) => i.role === "protein");
  const P = bundle(pI), S = bundle(sc.filter((i) => i.role !== "protein"));
  const det = P.protein * S.kcal - S.protein * P.kcal;
  return { r, fixed, P, S, det, degen: pI.length === 0 || Math.abs(det) < 1e-6,
    minKcal: fixed.kcal + LO * (P.kcal + S.kcal), maxKcal: fixed.kcal + HI * (P.kcal + S.kcal) };
});
const targets = [];
for (const dk of [1500, 1750, 2000, 2250, 2500, 2750, 3000]) for (const p of [0.06, 0.075, 0.09]) for (const sh of [0.9 / 3.45, 1 / 3.45, 1.15 / 3.45, 0.4 / 3.45]) targets.push({ kcal: dk * sh, protein: dk * p * sh });

const macros = (x, p, s) => { let k = 0, q = 0, f = 0, c = 0; for (const i of x.r.ingredients) { const g = pr5(i.baseGrams * (!i.scalable ? 1 : i.role === "protein" ? p : s)); k += (i.food.kcal || 0) * g / 100; q += (i.food.protein || 0) * g / 100; f += (i.food.fat || 0) * g / 100; c += (i.food.carb || 0) * g / 100; } return { kcal: k, protein: q, fat: f, carb: c }; };

const rng = mb(13579);
let lowN = 0, highN = 0, lowPassGate = 0, highPassGate = 0;
let lowProteinOver = 0, lowProteinOverFree = 0, highProteinShort = 0;
const lowKcalOver = [], lowProteinExcess = [], lowFatOver = [], highFatUnder = [];
let symLowPass = 0, symHighPass = 0;   // what a SYMMETRIC protein rule would do
for (let k = 0; k < 60000; k++) {
  const x = R[Math.floor(rng() * R.length)];
  const t = targets[Math.floor(rng() * targets.length)];
  if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
  let rp, rs;
  if (x.degen) rp = rs = x.r.kcal > 0 ? t.kcal / x.r.kcal : 1;
  else { const g = g2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal); if (!g) continue; [rp, rs] = g; }
  const lo = rp < LO || rs < LO, hi = rp > HI || rs > HI;
  if (lo === hi) continue;                              // only single-direction pins
  const m = macros(x, cl(rp, LO, HI), cl(rs, LO, HI));
  const kOff = Math.abs(m.kcal - t.kcal) / t.kcal;
  const pShortOneSided = Math.max(0, (t.protein - m.protein) / t.protein);
  const pTwoSided = Math.abs(m.protein - t.protein) / t.protein;
  const passOneSided = kOff <= KT && pShortOneSided <= PT;
  const passSym = kOff <= KT && pTwoSided <= PT;
  // fat ask: 28 % of the slot's kcal
  const fatAsk = (t.kcal * 0.28) / 9;
  if (lo) {
    lowN++; if (passOneSided) lowPassGate++; if (passSym) symLowPass++;
    lowKcalOver.push((m.kcal - t.kcal) / t.kcal);
    if (m.protein > t.protein) { lowProteinOver++; lowProteinExcess.push((m.protein - t.protein) / t.protein); if (pTwoSided > PT) lowProteinOverFree++; }
    lowFatOver.push((m.fat - fatAsk) / fatAsk);
  } else {
    highN++; if (passOneSided) highPassGate++; if (passSym) symHighPass++;
    if (m.protein < t.protein) highProteinShort++;
    highFatUnder.push((m.fat - fatAsk) / fatAsk);
  }
}
console.log(JSON.stringify({
  ASYMMETRY: {
    note: "single-direction pins only. proteinShortfallPct is one-sided (weeklyPlanner.js:426-428); kcalOffPct is two-sided (L420-422).",
    floorPinnedPairs: lowN, ceilingPinnedPairs: highN,
    floorPinned_passShippedGate: lowPassGate, floorPass_pct: pct(lowPassGate, lowN),
    ceilingPinned_passShippedGate: highPassGate, ceilingPass_pct: pct(highPassGate, highN),
    floorPinned_proteinOverTarget: lowProteinOver, floorProteinOver_pct: pct(lowProteinOver, lowN),
    floorPinned_proteinOverBy_gt12pct_butUNPENALISED: lowProteinOverFree, freeOvershoot_pct: pct(lowProteinOverFree, lowN),
    floorPinned_proteinExcess_median: +qq(lowProteinExcess, 0.5).toFixed(3),
    floorPinned_proteinExcess_p90: +qq(lowProteinExcess, 0.9).toFixed(3),
    ceilingPinned_proteinShort: highProteinShort, ceilingProteinShort_pct: pct(highProteinShort, highN),
    floorPinned_kcalOver_median: +qq(lowKcalOver, 0.5).toFixed(3),
    floorPinned_fatVsAsk_median: +qq(lowFatOver, 0.5).toFixed(3),
    ceilingPinned_fatVsAsk_median: +qq(highFatUnder, 0.5).toFixed(3),
    IF_PROTEIN_RULE_WERE_SYMMETRIC: {
      floorPass_pct: pct(symLowPass, lowN), ceilingPass_pct: pct(symHighPass, highN),
      floorSlotsThatWouldNoLongerPass: lowPassGate - symLowPass,
      ceilingSlotsThatWouldNoLongerPass: highPassGate - symHighPass,
    },
  },
}, null, 1));
await prisma.$disconnect();
