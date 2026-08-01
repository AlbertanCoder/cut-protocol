// A13 hook v3 — THE FLOOR EXPERIMENT (C10). Moves the 0.5x MINIMUM only.
//
// C10: "of 70 bound-pinned missed days, 66 needed the day to be SMALLER and
// were blocked at 0.5x; zero were blocked at the 2.0x ceiling alone." The
// ceiling is NOT touched here — `max: 2` is asserted unchanged, so A24 can
// verify nobody widened the wrong end.
//
// Two textual edits to an in-memory copy of weeklyPlanner.js (backend/src is
// never written):
//   1. `const SCALE_BOUNDS = { min: 0.5, max: 2 };` -> `{ min: <A13_FLOOR>, max: 2 }`
//   2. (only when A13_SOLVER=on) the same 4-macro 2-bundle portioner as
//      a13-hook-v2.cjs, so "floor alone" and "floor + objective" are separable.
//
// A13_FLOOR=0.25  A13_SOLVER=off|on
//
// New file rather than an edit because .claude/hooks/guard-edit.js makes
// everything under docs/surgery/CAMPAIGN/ create-only (same block A10 recorded).

const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");

const REPO = "C:/Users/<account>/Desktop/cut-protocol";
const TARGET = path.resolve(REPO, "backend/src/lib/weeklyPlanner.js");
const FLOOR = Number(process.env.A13_FLOOR || 0.25);
const USE_SOLVER = (process.env.A13_SOLVER || "off") === "on";
const DUMP = process.env.A13_DUMP || null;

const diag = { variant: `floor${FLOOR}${USE_SOLVER ? "-wls2" : "-legacy"}`, floor: FLOOR, calls: 0, legacyFallback: 0, noCompTarget: 0, kHist: {}, converged: 0, hitIterCap: 0, iterSum: 0 };
const scaleIndex = new Map();
process.on("exit", () => {
  if (!DUMP) return;
  const rows = []; for (const [k, v] of scaleIndex) rows.push({ key: k, ...v });
  fs.writeFileSync(DUMP, JSON.stringify({ diag, scales: rows }));
});

const MACROS = ["kcal", "protein", "fat", "carb"];

function makeSolver(helpers) {
  const { practicalGrams, SCALE_BOUNDS } = helpers;
  const cl = (v) => (v < SCALE_BOUNDS.min ? SCALE_BOUNDS.min : v > SCALE_BOUNDS.max ? SCALE_BOUNDS.max : v);
  return function (recipe, kcalTarget, proteinTarget, slotTarget) {
    diag.calls++;
    if (!USE_SOLVER) { diag.legacyFallback++; return null; }
    const fatShare = slotTarget && slotTarget.fatShare > 0 ? slotTarget.fatShare : 0;
    const carbShare = slotTarget && slotTarget.carbShare > 0 ? slotTarget.carbShare : 0;
    if (!fatShare && !carbShare) { diag.noCompTarget++; diag.legacyFallback++; return null; }
    const scalable = recipe.ingredients.filter((i) => i.scalable);
    if (!scalable.length) { diag.legacyFallback++; return null; }
    const keyOf = (ing) => (ing.role === "protein" ? "protein" : "rest");
    const order = [], byKey = new Map();
    for (const ing of scalable) {
      const k = keyOf(ing);
      if (!byKey.has(k)) { byKey.set(k, { key: k, kcal: 0, protein: 0, fat: 0, carb: 0 }); order.push(k); }
      const b = byKey.get(k), f = ing.baseGrams / 100;
      b.kcal += ing.food.kcal * f; b.protein += ing.food.protein * f;
      b.fat += ing.food.fat * f; b.carb += ing.food.carb * f;
    }
    const B = order.map((k) => byKey.get(k)), K = B.length;
    diag.kHist[K] = (diag.kHist[K] || 0) + 1;
    const F = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    for (const ing of recipe.ingredients) {
      if (ing.scalable) continue;
      const f = ing.baseGrams / 100;
      F.kcal += ing.food.kcal * f; F.protein += ing.food.protein * f;
      F.fat += ing.food.fat * f; F.carb += ing.food.carb * f;
    }
    const aim = {
      kcal: kcalTarget, protein: proteinTarget,
      fat: slotTarget.fatTarget != null ? slotTarget.fatTarget : fatShare,
      carb: slotTarget.carbTarget != null ? slotTarget.carbTarget : carbShare,
    };
    const allow = { kcal: 0.15 * kcalTarget, protein: 0.15 * proteinTarget, fat: 0.25 * fatShare, carb: 0.25 * carbShare };
    const active = MACROS.filter((m) => allow[m] > 1e-9);
    const W = {}; for (const m of active) W[m] = 1 / (allow[m] * allow[m]);
    const proteinIngs = scalable.filter((i) => i.role === "protein");
    const pB = { kcal: 0, protein: 0 }, rB = { kcal: 0, protein: 0 };
    for (const ing of scalable) {
      const f = ing.baseGrams / 100, t = ing.role === "protein" ? pB : rB;
      t.kcal += ing.food.kcal * f; t.protein += ing.food.protein * f;
    }
    const det = pB.protein * rB.kcal - rB.protein * pB.kcal;
    const remK = kcalTarget - F.kcal, remP = proteinTarget - F.protein;
    let ps, ss;
    if (!proteinIngs.length || Math.abs(det) < 1e-6) {
      const raw = recipe.kcal > 0 ? kcalTarget / recipe.kcal : 1; ps = ss = cl(raw);
    } else {
      ps = cl((remP * rB.kcal - rB.protein * remK) / det);
      ss = cl((pB.protein * remK - remP * pB.kcal) / det);
    }
    const x = B.map((b) => cl(b.key === "protein" ? ps : ss));
    const ach = (xv) => { const a = { ...F }; for (let j = 0; j < K; j++) for (const m of MACROS) a[m] += xv[j] * B[j][m]; return a; };
    const resid = (a) => { const r = {}; for (const m of active) { let d = a[m] - aim[m]; if (m === "protein" && d > 0) d = 0; r[m] = d; } return r; };
    const fval = (xv) => { const r = resid(ach(xv)); let s = 0; for (const m of active) s += W[m] * r[m] * r[m]; return s; };
    let L = 0;
    for (let j = 0; j < K; j++) { let row = 0; for (let l = 0; l < K; l++) { let h = 0; for (const m of active) h += W[m] * B[j][m] * B[l][m]; row += Math.abs(2 * h); } if (row > L) L = row; }
    if (!(L > 0)) { diag.legacyFallback++; return null; }
    const lr = 1 / L, MAX_IT = 2000;
    let it = 0;
    for (; it < MAX_IT; it++) {
      const r = resid(ach(x)); let moved = 0;
      const g = new Array(K).fill(0);
      for (let j = 0; j < K; j++) { let s = 0; for (const m of active) s += 2 * W[m] * r[m] * B[j][m]; g[j] = s; }
      for (let j = 0; j < K; j++) { const nx = cl(x[j] - lr * g[j]); if (Math.abs(nx - x[j]) > moved) moved = Math.abs(nx - x[j]); x[j] = nx; }
      if (moved < 1e-9) break;
    }
    diag.iterSum += it; if (it >= MAX_IT) diag.hitIterCap++; else diag.converged++;
    const xL = B.map((b) => cl(b.key === "protein" ? ps : ss));
    if (fval(xL) <= fval(x)) for (let j = 0; j < K; j++) x[j] = xL[j];
    const sBy = new Map(order.map((k, j) => [k, x[j]]));
    const resolved = recipe.ingredients.map((ing) => ({
      foodId: ing.foodId, name: ing.food.name, role: ing.role,
      grams: practicalGrams(ing.baseGrams * (!ing.scalable ? 1 : sBy.get(keyOf(ing)))),
    }));
    const totals = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    for (const r of resolved) {
      const food = recipe.ingredients.find((i) => i.foodId === r.foodId).food, f = r.grams / 100;
      totals.kcal += food.kcal * f; totals.protein += food.protein * f;
      totals.fat += food.fat * f; totals.carb += food.carb * f;
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    const pIdx = order.indexOf("protein"), rIdx = order.indexOf("rest");
    const proteinScale = pIdx >= 0 ? x[pIdx] : 1, sidesScale = rIdx >= 0 ? x[rIdx] : 1;
    const lo = Math.min(...x), hi = Math.max(...x);
    const key = `${recipe.id}|${r2(proteinScale)}|${r2(sidesScale)}`;
    if (!scaleIndex.has(key)) scaleIndex.set(key, { spread: lo > 0 ? hi / lo : 1, k: K, lo, hi });
    return { proteinScale: r2(proteinScale), sidesScale: r2(sidesScale), ingredients: resolved, ...totals };
  };
}

const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (mod, filename) {
  if (path.resolve(filename) !== TARGET) return origJs(mod, filename);
  let src = fs.readFileSync(filename, "utf8");
  const BOUNDS = "const SCALE_BOUNDS = { min: 0.5, max: 2 };";
  if (!src.includes(BOUNDS)) throw new Error("A13 hook v3: SCALE_BOUNDS literal not found");
  src = src.replace(BOUNDS, `const SCALE_BOUNDS = { min: ${FLOOR}, max: 2 };`);
  const CALL = "scaleRecipe(recipe, target.kcalTarget, target.proteinTarget)";
  const n = src.split(CALL).length - 1;
  if (n !== 2) throw new Error(`A13 hook v3: expected 2 call sites, found ${n}`);
  src = src.split(CALL).join("scaleRecipe(recipe, target.kcalTarget, target.proteinTarget, target)");
  const SIG = "function scaleRecipe(recipe, kcalTarget, proteinTarget) {";
  if (!src.includes(SIG)) throw new Error("A13 hook v3: signature not found");
  src = src.replace(SIG, `function scaleRecipe(recipe, kcalTarget, proteinTarget, slotTarget) {
  if (!globalThis.__A13_SOLVER__) globalThis.__A13_SOLVER__ = globalThis.__A13_MAKE__({ practicalGrams, bundleMacros, SCALE_BOUNDS });
  { const __r = globalThis.__A13_SOLVER__(recipe, kcalTarget, proteinTarget, slotTarget); if (__r) return __r; }
`);
  mod._compile(src, filename);
};
globalThis.__A13_MAKE__ = makeSolver;
process.stderr.write(`[a13v3] armed floor=${FLOOR} ceiling=2 (UNCHANGED) solver=${USE_SOLVER}\n`);
