// A10 experiment 2 — is the per-role mechanism's ceiling set by the GEOMETRY
// (knobs) or by the OBJECTIVE (weights + symmetric protein) + the 200-iter cap?
// Variants, all per-ROLE bundling, same box [0.5,2]:
//   A shipped   : w={kcal1,prot1,fat.1,carb.1}, 200 iters  (== solvePortions today)
//   B converged : same weights, 5000 iters
//   C equalW    : w={1,1,1,1}, 5000 iters
//   D equalW+hinge: equal weights, protein error zeroed when OVER target
//                   (matches dayTolerance: "over is never a miss"), 5000 iters
// READ-ONLY. Deterministic. Own DB copy.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("file:///C:/Users/<account>/Desktop/cut-protocol/backend/package.json");
const { PrismaClient } = require("@prisma/client");
const { SCALE_BOUNDS } = require("./src/lib/brain/optimizer.js");
const prisma = new PrismaClient();

const MACROS = ["kcal", "protein", "fat", "carb"];
const zero = () => ({ kcal: 0, protein: 0, fat: 0, carb: 0 });
const practicalGrams = (raw) => (!(raw > 0) ? 0 : raw >= 20 ? Math.round(raw / 5) * 5 : Math.max(1, Math.round(raw)));
function addScaled(a, food, g) { const f = g / 100; a.kcal += food.kcal * f; a.protein += food.protein * f; a.fat += food.fat * f; a.carb += food.carb * f; return a; }
const bundleOf = (ings) => ings.reduce((a, i) => addScaled(a, i.food, i.baseGrams), zero());
const clamp = (v, b) => (Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : b.min);

function solvePG(cands, target, bounds, w, iters, hingeProtein) {
  const n = cands.length; if (!n) return [];
  const axes = MACROS.filter((k) => target[k] != null);
  let maxCol = 1;
  for (const c of cands) { let e = 0; for (const k of axes) e += (w[k] || 0) * (c[k] || 0) ** 2; if (e > maxCol) maxCol = e; }
  const lr = 1 / (2 * maxCol);
  const x = new Array(n).fill(1);
  for (let it = 0; it < iters; it++) {
    const m = cands.reduce((s, c, i) => { for (const k of MACROS) s[k] += (c[k] || 0) * x[i]; return s; }, zero());
    for (let i = 0; i < n; i++) {
      let g = 0;
      for (const k of axes) {
        let err = (m[k] || 0) - target[k];
        if (hingeProtein && k === "protein" && err > 0) err = 0; // overshoot is free
        g += (w[k] || 0) * err * (cands[i][k] || 0);
      }
      x[i] = clamp(x[i] - lr * (2 * g), bounds);
    }
  }
  return x;
}
function materialise(groups, fixedIngs, scales) {
  const tot = zero(); let pinned = 0;
  for (const i of fixedIngs) addScaled(tot, i.food, practicalGrams(i.baseGrams));
  groups.forEach((g, gi) => {
    const s = scales[gi];
    if (Math.abs(s - SCALE_BOUNDS.min) < 1e-9 || Math.abs(s - SCALE_BOUNDS.max) < 1e-9) pinned++;
    for (const i of g.ings) addScaled(tot, i.food, practicalGrams(i.baseGrams * s));
  });
  return { tot, pinned };
}
const band = (t, m) => ({
  kcalOk: Math.abs(m.kcal - t.kcal) / t.kcal <= 0.15,
  protOk: Math.max(0, (t.protein - m.protein) / t.protein) <= 0.15,
  fatOk: Math.abs(m.fat - t.fat) / t.fat <= 0.25,
  carbOk: Math.abs(m.carb - t.carb) / t.carb <= 0.25,
  get all() { return this.kcalOk && this.protOk && this.fatOk && this.carbOk; },
});
// worst per-ingredient gram RATIO across the plate — the servability proxy
// ("625 g chicken with 2 g pine nuts")
const spread = (scales) => Math.max(...scales) / Math.min(...scales);

const W_OPT = { kcal: 1, protein: 1, fat: 0.1, carb: 0.1 };
const W_EQ = { kcal: 1, protein: 1, fat: 1, carb: 1 };
const TARGETS = [];
for (const kcal of [400, 550, 700, 850]) for (const pf of [0.25, 0.35]) for (const ff of [0.25, 0.35])
  TARGETS.push({ kcal, protein: (kcal * pf) / 4, fat: (kcal * ff) / 9, carb: (kcal * (1 - pf - ff)) / 4 });

const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
const V = ["A_shipped", "B_converged", "C_equalW", "D_equalW_hinge"];
const acc = Object.fromEntries(V.map((v) => [v, { all: 0, kcal: 0, prot: 0, fat: 0, carb: 0, pinned: 0, spreadGt3: 0, spreadSum: 0 }]));
let n = 0;

for (const r of recipes) {
  const scal = r.ingredients.filter((i) => i.scalable && i.food);
  const fixedIngs = r.ingredients.filter((i) => !i.scalable && i.food);
  const pIngs = scal.filter((i) => i.role === "protein");
  if (scal.length < 2 || !pIngs.length || pIngs.length === scal.length) continue;
  const byRole = new Map();
  for (const i of scal) { const k = i.role || "unroled"; if (!byRole.has(k)) byRole.set(k, []); byRole.get(k).push(i); }
  const gR = [...byRole.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, ings]) => ({ key, ings }));
  if (gR.length < 3) continue;
  const fixedMac = fixedIngs.reduce((a, i) => addScaled(a, i.food, i.baseGrams), zero());
  const vecR = gR.map((g) => bundleOf(g.ings));

  for (const T of TARGETS) {
    const net = {}; for (const k of MACROS) net[k] = T[k] - fixedMac[k];
    const runs = {
      A_shipped: solvePG(vecR, net, SCALE_BOUNDS, W_OPT, 200, false),
      B_converged: solvePG(vecR, net, SCALE_BOUNDS, W_OPT, 5000, false),
      C_equalW: solvePG(vecR, net, SCALE_BOUNDS, W_EQ, 5000, false),
      D_equalW_hinge: solvePG(vecR, net, SCALE_BOUNDS, W_EQ, 5000, true),
    };
    n++;
    for (const v of V) {
      const s = runs[v]; const m = materialise(gR, fixedIngs, s); const b = band(T, m.tot);
      const a = acc[v];
      if (b.all) a.all++; if (b.kcalOk) a.kcal++; if (b.protOk) a.prot++; if (b.fatOk) a.fat++; if (b.carbOk) a.carb++;
      if (m.pinned) a.pinned++;
      const sp = spread(s); a.spreadSum += sp; if (sp > 3) a.spreadGt3++;
    }
  }
}
const out = { pairs: n, variants: {} };
for (const v of V) {
  const a = acc[v];
  out.variants[v] = {
    proxyBandAll4_pct: (100 * a.all) / n, kcal_pct: (100 * a.kcal) / n, protein_pct: (100 * a.prot) / n,
    fat_pct: (100 * a.fat) / n, carb_pct: (100 * a.carb) / n,
    anyKnobPinned_pct: (100 * a.pinned) / n,
    meanScaleSpread: a.spreadSum / n, spreadOver3x_pct: (100 * a.spreadGt3) / n,
  };
}
fs.writeFileSync(new URL("./A10-variants-summary.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await prisma.$disconnect();
