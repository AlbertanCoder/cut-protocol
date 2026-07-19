// Brain v3 — the PORTIONING optimizer (deterministic; the "how much"). Given
// candidate macro bundles and a target, find each candidate's scale. This is
// exact search, never the LLM: the model proposes WHICH items; this decides HOW
// MUCH and is provably correct.
//
// DETERMINISM (required, golden-asserted): fixed iteration order, no Math.random,
// no wall-clock — identical inputs → byte-identical outputs on every machine.
//
// k=2 PARITY (LAW 1 / Stage-A DoD): the two-candidate case reproduces the legacy
// 2-factor solver (weeklyPlanner.scaleRecipe) byte-for-byte on (kcal, protein):
//   • non-degenerate → closed-form Cramer, the exact same expressions;
//   • degenerate (no protein bundle, or det≈0) → uniform kcal-scale fallback,
//     target.kcal / Σkcal (== scaleRecipe's kcalTarget/recipe.kcal when the
//     recipe has no fixed ingredients — the case the golden test pins).
// It is golden-locked (optimizer.golden.test.js) BEFORE it is ever allowed to
// replace scaleRecipe (a later stage wires that, passing the net-of-fixed target).

const SCALE_BOUNDS = { min: 0.5, max: 2 };
const DET_EPS = 1e-6;

const clamp = (v, b) => (Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : b.min);

// Σ xᵢ · candidateᵢ over all four macros.
function mix(candidates, scales) {
  return candidates.reduce(
    (s, c, i) => {
      const x = scales[i];
      return {
        kcal: s.kcal + (c.kcal || 0) * x,
        protein: s.protein + (c.protein || 0) * x,
        fat: s.fat + (c.fat || 0) * x,
        carb: s.carb + (c.carb || 0) * x,
      };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

// Weighted L2 deviation of the mixed macros from target (kcal + protein are the
// load-bearing axes the 2-var solver constrains; fat/carb included at low weight).
function residualOf(macros, target, weights) {
  const w = weights || { kcal: 1, protein: 1, fat: 0.1, carb: 0.1 };
  let sum = 0;
  for (const k of ["kcal", "protein", "fat", "carb"]) {
    if (target[k] == null) continue;
    const d = (macros[k] || 0) - target[k];
    sum += (w[k] || 0) * d * d;
  }
  return Math.sqrt(sum);
}

// Exactly the legacy 2-factor arithmetic (weeklyPlanner.scaleRecipe), operand
// for operand — do not "simplify": byte-identity depends on this order.
function solve2(candidates, target, bounds) {
  const [c0, c1] = candidates; // c0 = protein-role bundle, c1 = the rest
  const remainingKcal = target.kcal;
  const remainingProtein = target.protein;
  const det = c0.protein * c1.kcal - c1.protein * c0.kcal;

  let x0;
  let x1;
  const noProteinBundle = (c0.protein === 0 && c0.kcal === 0);
  if (noProteinBundle || Math.abs(det) < DET_EPS) {
    const sumKcal = c0.kcal + c1.kcal; // == recipe.kcal with no fixed ingredients
    const raw = sumKcal > 0 ? target.kcal / sumKcal : 1;
    x0 = clamp(raw, bounds);
    x1 = x0;
  } else {
    x0 = clamp((remainingProtein * c1.kcal - c1.protein * remainingKcal) / det, bounds);
    x1 = clamp((c0.protein * remainingKcal - remainingProtein * c0.kcal) / det, bounds);
  }
  return [x0, x1];
}

// Deterministic projected-gradient box least-squares for k≠2 (used from Stage F
// onward; Stage A only needs it deterministic + within bounds). Fixed step count
// and order — no randomness, no time.
function solveGeneral(candidates, target, bounds, weights) {
  const n = candidates.length;
  if (n === 0) return [];
  const w = weights || { kcal: 1, protein: 1, fat: 0.1, carb: 0.1 };
  const axes = ["kcal", "protein", "fat", "carb"].filter((k) => target[k] != null);
  // Normalize the step by the largest column energy so a single lr is stable
  // across wildly different kcal magnitudes.
  let maxCol = 1;
  for (const c of candidates) {
    let e = 0;
    for (const k of axes) e += (w[k] || 0) * (c[k] || 0) ** 2;
    if (e > maxCol) maxCol = e;
  }
  const lr = 1 / (2 * maxCol);
  const x = new Array(n).fill(1);
  for (let iter = 0; iter < 200; iter++) {
    const m = mix(candidates, x);
    const grad = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let g = 0;
      for (const k of axes) g += (w[k] || 0) * ((m[k] || 0) - target[k]) * (candidates[i][k] || 0);
      grad[i] = 2 * g;
    }
    for (let i = 0; i < n; i++) x[i] = clamp(x[i] - lr * grad[i], bounds);
  }
  return x;
}

/**
 * solvePortions(candidates, target, opts) -> { scales, macros, residual, prov }
 * candidates: [{kcal, protein, fat, carb}] (candidate[0] is the protein bundle
 * in the k=2 legacy-parity case). target: {kcal, protein, fat?, carb?}.
 */
function solvePortions(candidates, target, opts = {}) {
  const bounds = opts.bounds || SCALE_BOUNDS;
  const weights = opts.weights;
  const scales = candidates.length === 2 ? solve2(candidates, target, bounds) : solveGeneral(candidates, target, bounds, weights);
  const macros = mix(candidates, scales);
  return {
    scales,
    macros,
    residual: residualOf(macros, target, weights),
    prov: { formulaId: "solvePortions", inputs: { k: candidates.length, target, bounds }, value: scales },
  };
}

module.exports = { solvePortions, SCALE_BOUNDS, DET_EPS, mix, residualOf };
