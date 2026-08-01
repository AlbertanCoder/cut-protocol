// D1 — how much of the clamp loss is recoverable WITHOUT touching the bounds,
// the objective, or the gate; plus degenerate-input probes on scaleRecipe.
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
const cl = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
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
for (const dk of dailyKcals) for (const pr of [0.06, 0.075, 0.09]) for (const sh of shares) targets.push({ kcal: dk * sh, protein: dk * pr * sh });

const macrosOf = (x, p, s) => {
  let kc = 0, pr = 0, ft = 0, cb = 0;
  for (const i of x.r.ingredients) {
    const g = practical(i.baseGrams * (!i.scalable ? 1 : i.role === "protein" ? p : s));
    kc += (i.food.kcal || 0) * g / 100; pr += (i.food.protein || 0) * g / 100;
    ft += (i.food.fat || 0) * g / 100; cb += (i.food.carb || 0) * g / 100;
  }
  return { kcal: kc, protein: pr, fat: ft, carb: cb };
};
const worst = (m, t) => Math.max(
  (t.kcal > 0 ? Math.abs(m.kcal - t.kcal) / t.kcal : 0) / KTOL,
  (t.protein > 0 ? Math.max(0, (t.protein - m.protein) / t.protein) : 0) / PTOL
);

// ── the three portioning policies ────────────────────────────────────────
// V0 = shipped: coordinate-wise clamp of the unconstrained exact solution.
function V0(x, t) {
  if (x.degen) { const raw = x.r.kcal > 0 ? t.kcal / x.r.kcal : 1; const c = cl(raw, LO, HI); return [c, c]; }
  const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal);
  if (!g) return [1, 1];
  return [cl(g[0], LO, HI), cl(g[1], LO, HI)];
}
// V1 = clamp, then BACK-SUBSTITUTE: with one knob pinned, re-solve the other
// for exact kcal and clamp it. Try both pin orders + the raw corner, keep the
// best on the shipped accept rule. Same box, same two macros, no new knobs.
function V1(x, t) {
  if (x.degen) {
    const scalK = x.P.kcal + x.S.kcal;
    const raw = scalK > 0 ? (t.kcal - x.fixed.kcal) / scalK : 1;   // net of fixed
    const c = cl(raw, LO, HI); return [c, c];
  }
  const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, t.protein - x.fixed.protein, t.kcal - x.fixed.kcal);
  if (!g) return [1, 1];
  const cands = [[cl(g[0], LO, HI), cl(g[1], LO, HI)]];
  // pin protein knob, solve sides for kcal
  for (const pv of [cl(g[0], LO, HI), LO, HI]) {
    if (x.S.kcal > 0) cands.push([pv, cl((t.kcal - x.fixed.kcal - pv * x.P.kcal) / x.S.kcal, LO, HI)]);
  }
  // pin sides knob, solve protein bundle for kcal
  for (const sv of [cl(g[1], LO, HI), LO, HI]) {
    if (x.P.kcal > 0) cands.push([cl((t.kcal - x.fixed.kcal - sv * x.S.kcal) / x.P.kcal, LO, HI), sv]);
  }
  let best = cands[0], bw = Infinity;
  for (const c of cands) { const w = worst(macrosOf(x, c[0], c[1]), t); if (w < bw) { bw = w; best = c; } }
  return best;
}
// V2 = exhaustive box optimum on the same rule (the ceiling, not a proposal).
function V2(x, t) {
  let best = [1, 1], bw = Infinity;
  for (let p = LO; p <= HI + 1e-9; p += 0.01) for (let s = LO; s <= HI + 1e-9; s += 0.01) {
    const w = worst(macrosOf(x, p, s), t); if (w < bw) { bw = w; best = [p, s]; }
  }
  return best;
}

const rng = mulberry(505050);
let n = 0; const inG = { V0: 0, V1: 0, V2: 0 }; const wr = { V0: [], V1: [], V2: [] };
let v1RescuesV0 = 0, v1LosesToV0 = 0, spreadOver4x = { V0: 0, V1: 0 }, sub = { V0: 0, V1: 0 };
for (let k = 0; k < 1400; k++) {
  const x = R[Math.floor(rng() * R.length)];
  const t = targets[Math.floor(rng() * targets.length)];
  if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
  n++;
  const a = V0(x, t), b = V1(x, t), c = V2(x, t);
  const wa = worst(macrosOf(x, a[0], a[1]), t), wb = worst(macrosOf(x, b[0], b[1]), t), wc = worst(macrosOf(x, c[0], c[1]), t);
  wr.V0.push(wa); wr.V1.push(wb); wr.V2.push(wc);
  if (wa <= 1) inG.V0++; if (wb <= 1) inG.V1++; if (wc <= 1) inG.V2++;
  if (wb <= 1 && wa > 1) v1RescuesV0++;
  if (wa <= 1 && wb > 1) v1LosesToV0++;
  // portion-realism guards: knob spread and how many knobs sit on the floor
  const sp = (p, s) => Math.max(p, s) / Math.min(p, s);
  if (sp(a[0], a[1]) > 4) spreadOver4x.V0++; if (sp(b[0], b[1]) > 4) spreadOver4x.V1++;
  if (a[0] === LO || a[1] === LO) sub.V0++; if (b[0] === LO || b[1] === LO) sub.V1++;
}
out.FIX_backSubstitution = {
  note: "same SCALE_BOUNDS, same 2 macros, same accept rule. V1 adds only a re-solve of the free knob once one is pinned.",
  pairs: n,
  inGate_V0_shipped: inG.V0, inGatePct_V0: pct(inG.V0, n),
  inGate_V1_backsub: inG.V1, inGatePct_V1: pct(inG.V1, n),
  inGate_V2_boxOptimum: inG.V2, inGatePct_V2: pct(inG.V2, n),
  V1_rescues: v1RescuesV0, V1_regressions: v1LosesToV0,
  worstRatio_median: { V0: +qq(wr.V0, 0.5).toFixed(3), V1: +qq(wr.V1, 0.5).toFixed(3), V2: +qq(wr.V2, 0.5).toFixed(3) },
  worstRatio_p90: { V0: +qq(wr.V0, 0.9).toFixed(3), V1: +qq(wr.V1, 0.9).toFixed(3), V2: +qq(wr.V2, 0.9).toFixed(3) },
  knobSpreadOver4x: spreadOver4x, knobsRestingOnFloor: sub,
};

// ── degenerate-input probes on the SHIPPED scaleRecipe ───────────────────
const sample = R.find((x) => !x.degen && x.fixed.kcal > 0 && x.r.ingredients.length >= 4);
const probes = {};
const rec = sample.r;
const call = (kt, pt) => { try { const s = wp.scaleRecipe(rec, kt, pt); return { proteinScale: s.proteinScale, sidesScale: s.sidesScale, kcal: +s.kcal.toFixed(1), protein: +s.protein.toFixed(1) }; } catch (e) { return { threw: e.message }; } };
probes.recipeName = rec.name;
probes.normal = call(600, 45);
probes.NaN_proteinTarget = call(600, NaN);
probes.undefined_proteinTarget = call(600, undefined);
probes.NaN_kcalTarget = call(NaN, 45);
probes.zero_targets = call(0, 0);
probes.negative_kcalTarget = call(-100, 45);
probes.huge_kcalTarget = call(1e9, 45);
probes.Infinity_kcalTarget = call(Infinity, 45);
// clamp's own NaN rule, re-derived
probes.clampRule = { "clamp(NaN)": cl(NaN, LO, HI), "clamp(Infinity)": cl(Infinity, LO, HI), "clamp(-Infinity)": cl(-Infinity, LO, HI) };
out.DEGENERATE_INPUT_PROBES = probes;

// ── role-tagging sensitivity: what if the protein role is stripped / wrong? ──
const rngR = mulberry(24680);
let rn = 0, rWorseWhenStripped = 0; const dWorstStrip = [];
for (let k = 0; k < 800; k++) {
  const x = R[Math.floor(rngR() * R.length)];
  if (x.degen) continue;
  const t = targets[Math.floor(rngR() * targets.length)];
  if (!(x.minKcal <= t.kcal * 1.5 && x.maxKcal >= t.kcal * 0.67)) continue;
  rn++;
  const a = V0(x, t);
  const wa = worst(macrosOf(x, a[0], a[1]), t);
  // strip the role: everything becomes "sides" => forced onto the one-knob branch
  const stripped = { ...x, degen: true };
  const b = V0(stripped, t);
  const wb = worst(macrosOf({ ...x, r: { ...x.r, ingredients: x.r.ingredients.map((i) => ({ ...i, role: null })) } }, b[0], b[1]), t);
  if (wb > wa + 1e-9) rWorseWhenStripped++;
  dWorstStrip.push(wb - wa);
}
out.ROLE_TAG_SENSITIVITY = {
  pairs: rn, worseWithoutProteinRole: rWorseWhenStripped, worsePct: pct(rWorseWhenStripped, rn),
  worstRatio_penalty_median: +qq(dWorstStrip, 0.5).toFixed(3),
  worstRatio_penalty_p90: +qq(dWorstStrip, 0.9).toFixed(3),
};

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
