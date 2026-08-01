// A13 — portioning-mechanism hook.
//
// Intercepts require() of backend/src/lib/weeklyPlanner.js and compiles a
// PATCHED SOURCE STRING in memory. backend/src is never written to; verify with
// `git status` after any run. Two textual edits, both asserted:
//
//   1. both live call sites `scaleRecipe(recipe, target.kcalTarget,
//      target.proteinTarget)` gain a 4th argument `target`, so the slot's
//      fat/carb budget (which the 2-knob solve throws away) reaches the solver;
//   2. `function scaleRecipe(...)` gains a dispatch to globalThis.__A13__.
//      Returning null from the hook falls through to the untouched legacy body,
//      so every path the variant declines is byte-identical to baseline.
//
// Variant is chosen by env A13_VARIANT. `legacy` = pure pass-through (the
// no-op A/B that proves the hook itself costs nothing).
//
// Usage: node --require <this> A1/rig/runRig.mjs --agent=A13 ...

const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");

const REPO = "C:/Users/<account>/Desktop/cut-protocol";
const TARGET = path.resolve(REPO, "backend/src/lib/weeklyPlanner.js");
const VARIANT = process.env.A13_VARIANT || "legacy";
const DUMP = process.env.A13_DUMP || null;

// ── diagnostics ────────────────────────────────────────────────────────────
const diag = {
  variant: VARIANT,
  calls: 0,          // every scaleRecipe invocation (candidates, not served)
  legacyFallback: 0, // hook declined -> legacy body ran
  noCompTarget: 0,   // slot carried no fat/carb budget
  oneKnob: 0,        // degenerate branch: no scalable protein role, or det~0
  twoKnob: 0,
  kHist: {},
  converged: 0,
  hitIterCap: 0,
  iterSum: 0,
};
// key `${recipeId}|${proteinScale}|${sidesScale}` -> {spread, k}
// Deduped so the join file stays small; the rig's slot rows carry exactly
// these three fields, which is how served slots are recovered post hoc.
const scaleIndex = new Map();

function dump() {
  if (!DUMP) return;
  const rows = [];
  for (const [k, v] of scaleIndex) rows.push({ key: k, ...v });
  fs.writeFileSync(DUMP, JSON.stringify({ diag, scales: rows }));
}
process.on("exit", dump);

// ── the n-knob weighted least-squares portioner ────────────────────────────
const MACROS = ["kcal", "protein", "fat", "carb"];

// Per-role boxes for the `roleb` variant. Rationale, not tuning: 2x oil is
// greasy, and a plate whose vegetables halved while the starch doubled is the
// shape customers rejected. protein/carb keep today's box.
const ROLE_BOUNDS = {
  protein: { min: 0.5, max: 2.0 },
  carb: { min: 0.5, max: 2.0 },
  veg: { min: 0.75, max: 2.0 },
  fat: { min: 0.5, max: 1.5 },
  unroled: { min: 0.5, max: 2.0 },
};

function bundleKey(ing, mode) {
  if (mode === "two") return ing.role === "protein" ? "protein" : "unroled";
  const r = ing.role;
  if (r === "protein" || r === "carb" || r === "veg" || r === "fat") return r;
  return "unroled"; // null + other/dairy/fruit collapsed (A10 sec.7)
}

function makeSolver(helpers) {
  const { practicalGrams, SCALE_BOUNDS } = helpers;

  return function a13Scale(recipe, kcalTarget, proteinTarget, slotTarget) {
    diag.calls++;
    if (VARIANT === "legacy") { diag.legacyFallback++; return null; }

    // The slot must carry a fat/carb budget or there is nothing for the extra
    // two macros to aim at, and the variant degenerates to the legacy solve.
    const fatShare = slotTarget && slotTarget.fatShare > 0 ? slotTarget.fatShare : 0;
    const carbShare = slotTarget && slotTarget.carbShare > 0 ? slotTarget.carbShare : 0;
    if (!fatShare && !carbShare) { diag.noCompTarget++; diag.legacyFallback++; return null; }

    const scalable = recipe.ingredients.filter((i) => i.scalable);
    if (scalable.length === 0) { diag.legacyFallback++; return null; }

    const mode = VARIANT === "wls2" ? "two" : "role";
    const perRoleBounds = VARIANT === "roleb";

    // ── bundle ──
    const order = [];
    const byKey = new Map();
    for (const ing of scalable) {
      const k = bundleKey(ing, mode);
      if (!byKey.has(k)) { byKey.set(k, { key: k, kcal: 0, protein: 0, fat: 0, carb: 0 }); order.push(k); }
      const b = byKey.get(k);
      const f = ing.baseGrams / 100;
      b.kcal += ing.food.kcal * f; b.protein += ing.food.protein * f;
      b.fat += ing.food.fat * f; b.carb += ing.food.carb * f;
    }
    const B = order.map((k) => byKey.get(k));
    const K = B.length;
    diag.kHist[K] = (diag.kHist[K] || 0) + 1;

    // fixed (non-scalable) contribution
    const F = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    for (const ing of recipe.ingredients) {
      if (ing.scalable) continue;
      const f = ing.baseGrams / 100;
      F.kcal += ing.food.kcal * f; F.protein += ing.food.protein * f;
      F.fat += ing.food.fat * f; F.carb += ing.food.carb * f;
    }

    // ── targets + allowances ──
    // Aim exactly where compositionDistance (weeklyPlanner.js:468-469) aims:
    // the remaining budget when present, else the slot's nominal share.
    const aim = {
      kcal: kcalTarget,
      protein: proteinTarget,
      fat: slotTarget.fatTarget != null ? slotTarget.fatTarget : fatShare,
      carb: slotTarget.carbTarget != null ? slotTarget.carbTarget : carbShare,
    };
    // Allowance = the day-grader's own tolerance, apportioned to this slot, so
    // all four residuals are measured in "fractions of the allowance that
    // actually decides the day" and none can dominate by unit magnitude.
    // DAY_KCAL 0.15 / DAY_PROTEIN 0.15 / DAY_FAT 0.25 / DAY_CARB 0.25.
    const allow = {
      kcal: 0.15 * kcalTarget,
      protein: 0.15 * proteinTarget,
      fat: 0.25 * fatShare,
      carb: 0.25 * carbShare,
    };
    const active = MACROS.filter((m) => allow[m] > 1e-9);
    const W = {};
    for (const m of active) W[m] = 1 / (allow[m] * allow[m]);

    // protein overshoot is FREE in dayTolerance() -- a symmetric L2 term hands
    // back protein the plan could have kept (A10 sec.3.2).
    const hinge = true;

    const boundsFor = (j) => (perRoleBounds ? (ROLE_BOUNDS[B[j].key] || SCALE_BOUNDS) : SCALE_BOUNDS);
    const clampJ = (v, j) => { const b = boundsFor(j); return v < b.min ? b.min : v > b.max ? b.max : v; };

    // ── warm start from the LEGACY answer ──
    // Guarantees the variant starts from today's plate and can only move
    // downhill on the objective; also keeps the k=2 degenerate case sane.
    const proteinIngs = scalable.filter((i) => i.role === "protein");
    const pB = { kcal: 0, protein: 0 }, rB = { kcal: 0, protein: 0 };
    for (const ing of scalable) {
      const f = ing.baseGrams / 100;
      const t = ing.role === "protein" ? pB : rB;
      t.kcal += ing.food.kcal * f; t.protein += ing.food.protein * f;
    }
    const det = pB.protein * rB.kcal - rB.protein * pB.kcal;
    const remK = kcalTarget - F.kcal, remP = proteinTarget - F.protein;
    let ps, ss;
    if (proteinIngs.length === 0 || Math.abs(det) < 1e-6) {
      diag.oneKnob++;
      const raw = recipe.kcal > 0 ? kcalTarget / recipe.kcal : 1;
      ps = ss = Math.min(SCALE_BOUNDS.max, Math.max(SCALE_BOUNDS.min, raw));
    } else {
      diag.twoKnob++;
      ps = Math.min(SCALE_BOUNDS.max, Math.max(SCALE_BOUNDS.min, (remP * rB.kcal - rB.protein * remK) / det));
      ss = Math.min(SCALE_BOUNDS.max, Math.max(SCALE_BOUNDS.min, (pB.protein * remK - remP * pB.kcal) / det));
    }
    const x = B.map((b, j) => clampJ(b.key === "protein" ? ps : ss, j));

    // ── objective ──
    const ach = (xv) => {
      const a = { kcal: F.kcal, protein: F.protein, fat: F.fat, carb: F.carb };
      for (let j = 0; j < K; j++) for (const m of MACROS) a[m] += xv[j] * B[j][m];
      return a;
    };
    const resid = (a) => {
      const r = {};
      for (const m of active) {
        let d = a[m] - aim[m];
        if (m === "protein" && hinge && d > 0) d = 0; // overshoot is free
        r[m] = d;
      }
      return r;
    };
    const fval = (xv) => { const r = resid(ach(xv)); let s = 0; for (const m of active) s += W[m] * r[m] * r[m]; return s; };

    // ── step size: Gershgorin bound on the Hessian H = 2 A^T W A. A real
    // Lipschitz bound, unlike the max-column-energy heuristic in optimizer.js
    // L91, which A10 measured as unconverged on 73% of inputs at 200 iters.
    let L = 0;
    for (let j = 0; j < K; j++) {
      let row = 0;
      for (let l = 0; l < K; l++) { let h = 0; for (const m of active) h += W[m] * B[j][m] * B[l][m]; row += Math.abs(2 * h); }
      if (row > L) L = row;
    }
    if (!(L > 0)) { diag.legacyFallback++; return null; }
    const lr = 1 / L;

    const MAX_IT = 2000;
    let it = 0;
    for (; it < MAX_IT; it++) {
      const r = resid(ach(x));
      let moved = 0;
      const g = new Array(K).fill(0);
      for (let j = 0; j < K; j++) { let s = 0; for (const m of active) s += 2 * W[m] * r[m] * B[j][m]; g[j] = s; }
      for (let j = 0; j < K; j++) {
        const nx = clampJ(x[j] - lr * g[j], j);
        if (Math.abs(nx - x[j]) > moved) moved = Math.abs(nx - x[j]);
        x[j] = nx;
      }
      if (moved < 1e-9) break; // real convergence test, not a fixed trip count
    }
    diag.iterSum += it;
    if (it >= MAX_IT) diag.hitIterCap++; else diag.converged++;

    // Never ship a plate the legacy solve would have beaten on our own ruler.
    const xLegacy = B.map((b, j) => clampJ(b.key === "protein" ? ps : ss, j));
    if (fval(xLegacy) <= fval(x)) for (let j = 0; j < K; j++) x[j] = xLegacy[j];

    // ── materialise: practicalGrams, then totals recomputed FROM the rounded
    // grams (verbatim shape of applyScales, weeklyPlanner.js:334-357) ──
    const scaleByKey = new Map(order.map((k, j) => [k, x[j]]));
    const resolved = recipe.ingredients.map((ing) => {
      const s = !ing.scalable ? 1 : scaleByKey.get(bundleKey(ing, mode));
      return { foodId: ing.foodId, name: ing.food.name, role: ing.role, grams: practicalGrams(ing.baseGrams * s) };
    });
    const totals = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    for (const r of resolved) {
      const food = recipe.ingredients.find((i) => i.foodId === r.foodId).food;
      const f = r.grams / 100;
      totals.kcal += food.kcal * f; totals.protein += food.protein * f;
      totals.fat += food.fat * f; totals.carb += food.carb * f;
    }

    // Downstream (enforceScaledCarbCeiling, stored plans, mealRouter) reads
    // these two fields. Keep them meaningful: the protein-role scale, and a
    // kcal-weighted mean of everything else.
    const round2 = (n) => Math.round(n * 100) / 100;
    const pIdx = order.indexOf("protein");
    const proteinScale = pIdx >= 0 ? x[pIdx] : 1;
    let wk = 0, wsum = 0;
    for (let j = 0; j < K; j++) { if (order[j] === "protein") continue; wk += B[j].kcal; wsum += x[j] * B[j].kcal; }
    const sidesScale = wk > 1e-9 ? wsum / wk : 1;

    const lo = Math.min(...x), hi = Math.max(...x);
    const key = `${recipe.id}|${round2(proteinScale)}|${round2(sidesScale)}`;
    if (!scaleIndex.has(key)) scaleIndex.set(key, { spread: lo > 0 ? hi / lo : 1, k: K, lo, hi });

    return { proteinScale: round2(proteinScale), sidesScale: round2(sidesScale), ingredients: resolved, ...totals };
  };
}

// ── install the require hook ───────────────────────────────────────────────
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (mod, filename) {
  if (path.resolve(filename) !== TARGET) return origJs(mod, filename);
  let src = fs.readFileSync(filename, "utf8");

  const CALL = "scaleRecipe(recipe, target.kcalTarget, target.proteinTarget)";
  const nCall = src.split(CALL).length - 1;
  if (nCall !== 2) throw new Error(`A13 hook: expected 2 live call sites, found ${nCall}`);
  src = src.split(CALL).join("scaleRecipe(recipe, target.kcalTarget, target.proteinTarget, target)");

  const SIG = "function scaleRecipe(recipe, kcalTarget, proteinTarget) {";
  if (!src.includes(SIG)) throw new Error("A13 hook: scaleRecipe signature not found");
  src = src.replace(SIG, `function scaleRecipe(recipe, kcalTarget, proteinTarget, slotTarget) {
  if (!globalThis.__A13_SOLVER__) globalThis.__A13_SOLVER__ = globalThis.__A13_MAKE__({ practicalGrams, bundleMacros, SCALE_BOUNDS });
  { const __r = globalThis.__A13_SOLVER__(recipe, kcalTarget, proteinTarget, slotTarget); if (__r) return __r; }
`);

  mod._compile(src, filename);
};

globalThis.__A13_MAKE__ = makeSolver;
process.stderr.write(`[a13] hook armed, variant=${VARIANT}\n`);
