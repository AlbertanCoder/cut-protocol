// A10 — does per-ROLE portioning beat the 2-knob (protein/sides) split?
// READ-ONLY: imports product code, mutates nothing. Own DB copy.
// Deterministic: fixed target grid, fixed iteration order, no Math.random.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("file:///C:/Users/<account>/Desktop/cut-protocol/backend/package.json");
const { PrismaClient } = require("@prisma/client");
const { solvePortions, SCALE_BOUNDS } = require("./src/lib/brain/optimizer.js");

const prisma = new PrismaClient();

// mirrors weeklyPlanner.practicalGrams (quoted: "5 g steps once past spice territory")
const practicalGrams = (raw) => {
  if (!(raw > 0)) return 0;
  if (raw >= 20) return Math.round(raw / 5) * 5;
  return Math.max(1, Math.round(raw));
};
const MACROS = ["kcal", "protein", "fat", "carb"];
const zero = () => ({ kcal: 0, protein: 0, fat: 0, carb: 0 });
function addScaled(acc, food, grams) {
  const f = grams / 100;
  acc.kcal += food.kcal * f; acc.protein += food.protein * f;
  acc.fat += food.fat * f; acc.carb += food.carb * f;
  return acc;
}
const bundleOf = (ings) => ings.reduce((a, i) => addScaled(a, i.food, i.baseGrams), zero());

// A LOCAL copy of solveGeneral with a configurable iteration count, used ONLY to
// test whether the shipped 200-iteration fixed-step loop has converged.
function solveGeneralN(cands, target, bounds, weights, iters) {
  const n = cands.length; if (!n) return [];
  const w = weights || { kcal: 1, protein: 1, fat: 0.1, carb: 0.1 };
  const axes = MACROS.filter((k) => target[k] != null);
  let maxCol = 1;
  for (const c of cands) { let e = 0; for (const k of axes) e += (w[k] || 0) * (c[k] || 0) ** 2; if (e > maxCol) maxCol = e; }
  const lr = 1 / (2 * maxCol);
  const x = new Array(n).fill(1);
  const clamp = (v, b) => (Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : b.min);
  for (let it = 0; it < iters; it++) {
    const m = cands.reduce((s, c, i) => { for (const k of MACROS) s[k] += (c[k] || 0) * x[i]; return s; }, zero());
    for (let i = 0; i < n; i++) {
      let g = 0; for (const k of axes) g += (w[k] || 0) * ((m[k] || 0) - target[k]) * (cands[i][k] || 0);
      x[i] = clamp(x[i] - lr * (2 * g), bounds);
    }
  }
  return x;
}

// materialise scales -> practical grams -> macros recomputed FROM those grams
function materialise(groups, fixedIngs, scales) {
  const tot = zero();
  let pinnedLo = 0, pinnedHi = 0;
  for (const i of fixedIngs) addScaled(tot, i.food, practicalGrams(i.baseGrams));
  groups.forEach((g, gi) => {
    const s = scales[gi];
    if (Math.abs(s - SCALE_BOUNDS.min) < 1e-9) pinnedLo++;
    if (Math.abs(s - SCALE_BOUNDS.max) < 1e-9) pinnedHi++;
    for (const i of g.ings) addScaled(tot, i.food, practicalGrams(i.baseGrams * s));
  });
  return { tot, pinnedLo, pinnedHi, pinned: pinnedLo + pinnedHi > 0 };
}

// per-slot PROXY band (NOT dayTolerance — that grades a DAY). Same percentages.
function proxyBand(t, m) {
  const kcalOk = t.kcal > 0 && Math.abs(m.kcal - t.kcal) / t.kcal <= 0.15;
  const protOk = t.protein > 0 && Math.max(0, (t.protein - m.protein) / t.protein) <= 0.15;
  const fatOk = t.fat > 0 && Math.abs(m.fat - t.fat) / t.fat <= 0.25;
  const carbOk = t.carb > 0 && Math.abs(m.carb - t.carb) / t.carb <= 0.25;
  return { kcalOk, protOk, fatOk, carbOk, all: kcalOk && protOk && fatOk && carbOk };
}
function resid(m, t, w) {
  let s = 0; for (const k of MACROS) { const d = (m[k] || 0) - t[k]; s += (w[k] || 0) * d * d; }
  return Math.sqrt(s);
}
const W_OPT = { kcal: 1, protein: 1, fat: 0.1, carb: 0.1 };
const W_EQ = { kcal: 1, protein: 1, fat: 1, carb: 1 }; // what dayTolerance implies

// ---- target grid: macro-consistent (4p + 9f + 4c == kcal) ----
const TARGETS = [];
for (const kcal of [400, 550, 700, 850]) {
  for (const pf of [0.25, 0.35]) {
    for (const ff of [0.25, 0.35]) {
      const protein = (kcal * pf) / 4, fat = (kcal * ff) / 9;
      const carb = (kcal * (1 - pf - ff)) / 4;
      TARGETS.push({ kcal, protein, fat, carb });
    }
  }
}

const recipes = await prisma.recipe.findMany({
  include: { ingredients: { include: { food: true }, orderBy: { id: "asc" } } },
  orderBy: { id: "asc" },
});

const rows = [];
let convMaxDelta = 0, convWorse = 0, convN = 0;

for (const r of recipes) {
  const scal = r.ingredients.filter((i) => i.scalable && i.food);
  const fixedIngs = r.ingredients.filter((i) => !i.scalable && i.food);
  if (scal.length < 2) continue;

  // --- k=2 grouping, exactly weeklyPlanner.scaleRecipe's split ---
  const pIngs = scal.filter((i) => i.role === "protein");
  const restIngs = scal.filter((i) => i.role !== "protein");
  if (!pIngs.length || !restIngs.length) continue; // 2-knob branch must fire
  const g2 = [{ key: "protein", ings: pIngs }, { key: "rest", ings: restIngs }];

  // --- per-ROLE grouping; null role -> its own "unroled" bundle ---
  const byRole = new Map();
  for (const i of scal) {
    const k = i.role || "unroled";
    if (!byRole.has(k)) byRole.set(k, []);
    byRole.get(k).push(i);
  }
  const gR = [...byRole.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, ings]) => ({ key, ings }));
  if (gR.length < 3) continue; // no extra DoF to test

  const fixedMac = fixedIngs.reduce((a, i) => addScaled(a, i.food, i.baseGrams), zero());
  const vec2 = g2.map((g) => bundleOf(g.ings));
  const vecR = gR.map((g) => bundleOf(g.ings));

  for (const T of TARGETS) {
    const net = {};
    for (const k of MACROS) net[k] = T[k] - fixedMac[k];

    // k=2 : only kcal+protein are given to solve2, as scaleRecipe does
    const s2 = solvePortions(vec2, { kcal: net.kcal, protein: net.protein }).scales;
    const m2 = materialise(g2, fixedIngs, s2);

    // per-role : all four macros, shipped default weights
    const sR = solvePortions(vecR, net).scales;
    const mR = materialise(gR, fixedIngs, sR);

    // convergence probe: same algorithm, 5000 iters
    const sR5 = solveGeneralN(vecR, net, SCALE_BOUNDS, W_OPT, 5000);
    const mixOf = (v, s) => v.reduce((a, c, i) => { for (const k of MACROS) a[k] += (c[k] || 0) * s[i]; return a; }, zero());
    const rA = resid(mixOf(vecR, sR), net, W_OPT), rB = resid(mixOf(vecR, sR5), net, W_OPT);
    convN++; if (rB < rA - 1e-6) { convWorse++; convMaxDelta = Math.max(convMaxDelta, rA - rB); }

    rows.push({
      recipeId: r.id, k: gR.length, kcal: T.kcal, pf: Math.round((T.protein * 4 / T.kcal) * 100), ff: Math.round((T.fat * 9 / T.kcal) * 100),
      r2opt: resid(m2.tot, T, W_OPT), rRopt: resid(mR.tot, T, W_OPT),
      r2eq: resid(m2.tot, T, W_EQ), rReq: resid(mR.tot, T, W_EQ),
      p2: m2.pinned ? 1 : 0, pR: mR.pinned ? 1 : 0,
      p2n: m2.pinnedLo + m2.pinnedHi, pRn: mR.pinnedLo + mR.pinnedHi,
      b2: proxyBand(T, m2.tot), bR: proxyBand(T, mR.tot),
    });
  }
}

const n = rows.length;
const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / n;
const pct = (f) => (100 * rows.filter(f).length) / n;

const summary = {
  pairs: n,
  recipes: new Set(rows.map((r) => r.recipeId)).size,
  meanResidual_optWeights: { k2: mean((r) => r.r2opt), perRole: mean((r) => r.rRopt) },
  meanResidual_equalWeights: { k2: mean((r) => r.r2eq), perRole: mean((r) => r.rReq) },
  perRoleResidualLower_optW_pct: pct((r) => r.rRopt < r.r2opt - 1e-9),
  perRoleResidualLower_eqW_pct: pct((r) => r.rReq < r.r2eq - 1e-9),
  pinnedAnyKnob_pct: { k2: pct((r) => r.p2), perRole: pct((r) => r.pR) },
  meanPinnedKnobCount: { k2: mean((r) => r.p2n), perRole: mean((r) => r.pRn) },
  proxyBandAll4_pct: { k2: pct((r) => r.b2.all), perRole: pct((r) => r.bR.all) },
  proxyPerMacro_pct: {
    k2: { kcal: pct((r) => r.b2.kcalOk), protein: pct((r) => r.b2.protOk), fat: pct((r) => r.b2.fatOk), carb: pct((r) => r.b2.carbOk) },
    perRole: { kcal: pct((r) => r.bR.kcalOk), protein: pct((r) => r.bR.protOk), fat: pct((r) => r.bR.fatOk), carb: pct((r) => r.bR.carbOk) },
  },
  // pinned-and-missed, the study's structural stat
  pinnedGivenMiss_pct: {
    k2: (100 * rows.filter((r) => !r.b2.all && r.p2).length) / Math.max(1, rows.filter((r) => !r.b2.all).length),
    perRole: (100 * rows.filter((r) => !r.bR.all && r.pR).length) / Math.max(1, rows.filter((r) => !r.bR.all).length),
  },
  convergence200iter: { pairsTested: convN, pairsWhere5000IterBeat200: convWorse, maxResidualGap: convMaxDelta },
};

fs.writeFileSync(new URL("./A10-perrole-summary.json", import.meta.url), JSON.stringify(summary, null, 2));
fs.writeFileSync(new URL("./A10-perrole-rows.jsonl", import.meta.url), rows.map((r) => JSON.stringify(r)).join("\n"));
console.log(JSON.stringify(summary, null, 2));
await prisma.$disconnect();
