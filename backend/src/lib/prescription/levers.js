// prescription/levers.js — per-role portion levers (directive §3.2).
//
// The shipped solver's scaling is a 2×2 closed form over exactly two groups
// (proteinScale/sidesScale, both 0.5–2×) — measured cost: 38% of shipped
// slots pinned at a clamp, composition unreachable (AUDIT.md §5.3). This
// module gives each ROLE its own lever with the directive's palatability
// bounds, solved by band-normalized projected coordinate descent — the
// "hand-rolled greedy-plus-refine" §3.2 explicitly permits. Deterministic,
// no RNG, no clock, no DB.
//
// Levers (directive values):
//   protein 0.5–2.5× · carb 0.3–2.5× · fat 0.5–2.0× ·
//   veg/fruit/dairy/other 0.5–2.0× · fixed rows (scalable:false) 1× always,
//   aromatic wiggle ±25% is available to the micro-adjust stage only.
//
// Every returned gram figure is FDC-honest: totals are recomputed from the
// (rounded) grams via the same per-100g arithmetic as nutritionCore.

"use strict";

const LEVER_BOUNDS = {
  protein: { lo: 0.5, hi: 2.5 },
  carb: { lo: 0.3, hi: 2.5 },
  fat: { lo: 0.5, hi: 2.0 },
  other: { lo: 0.5, hi: 2.0 }, // veg / fruit / dairy / null roles
};

const LEVER_OF_ROLE = {
  protein: "protein",
  carb: "carb",
  fat: "fat",
  veg: "other",
  fruit: "other",
  dairy: "other",
  other: "other",
};

// Band-normalized weights: an error of one band-width in any dimension costs
// the same. netCarb weight only participates when the caller supplies a
// netCarb target (day-level refine); slot-level solves typically target
// kcal + protein and leave composition to candidate choice.
const BAND = { kcal: 50, protein: 7, fat: 7, netCarb: 10 };

function leverOf(ing) {
  if (ing.scalable === false) return null; // frozen at 1×
  return LEVER_OF_ROLE[ing.role] || "other";
}

// Bundle the recipe's rows by lever. Each bundle is a macro vector per 1×.
// rows: [{ grams, scalable, role, food: {kcal,protein,fat,carb,fiber} per 100g }]
function bundleByLever(rows) {
  const bundles = new Map(); // lever -> {kcal,protein,fat,netCarb}
  const fixed = { kcal: 0, protein: 0, fat: 0, netCarb: 0 };
  for (const r of rows) {
    const f = r.food;
    const k = r.grams / 100;
    const vec = {
      kcal: f.kcal * k,
      protein: f.protein * k,
      fat: f.fat * k,
      netCarb: Math.max(0, (f.carb - (Number.isFinite(f.fiber) ? f.fiber : 0))) * k,
    };
    const lever = leverOf(r);
    if (!lever) {
      fixed.kcal += vec.kcal; fixed.protein += vec.protein; fixed.fat += vec.fat; fixed.netCarb += vec.netCarb;
      continue;
    }
    const b = bundles.get(lever) || { kcal: 0, protein: 0, fat: 0, netCarb: 0 };
    b.kcal += vec.kcal; b.protein += vec.protein; b.fat += vec.fat; b.netCarb += vec.netCarb;
    bundles.set(lever, b);
  }
  return { bundles, fixed };
}

/**
 * solveLevers(rows, target) → { scales: {lever: s}, achieved, distance }
 *
 * target: { kcal, protein, fat?, netCarb? } — dimensions present participate,
 * weighted by their band widths. Projected coordinate descent: each lever's
 * unconstrained optimum given the others is closed-form (1-D weighted least
 * squares), clamped to its bounds; iterate to convergence. Deterministic.
 */
function solveLevers(rows, target) {
  const { bundles, fixed } = bundleByLever(rows);
  const levers = [...bundles.keys()];
  const dims = ["kcal", "protein", "fat", "netCarb"].filter((d) => Number.isFinite(target[d]));
  const w = Object.fromEntries(dims.map((d) => [d, 1 / BAND[d] ** 2]));

  const scales = Object.fromEntries(levers.map((l) => [l, 1]));
  const achievedAt = (s) => {
    const a = { ...fixed };
    for (const l of levers) {
      const b = bundles.get(l);
      for (const d of ["kcal", "protein", "fat", "netCarb"]) a[d] += b[d] * s[l];
    }
    return a;
  };

  for (let iter = 0; iter < 40; iter++) {
    let moved = 0;
    for (const l of levers) {
      const b = bundles.get(l);
      // rest = everything except lever l at current scales
      const rest = { ...fixed };
      for (const o of levers) {
        if (o === l) continue;
        const ob = bundles.get(o);
        for (const d of dims) rest[d] += ob[d] * scales[o];
      }
      let num = 0, den = 0;
      for (const d of dims) {
        num += w[d] * b[d] * (target[d] - rest[d]);
        den += w[d] * b[d] * b[d];
      }
      if (den < 1e-12) continue; // this lever moves nothing that is targeted
      const bound = LEVER_BOUNDS[l];
      const next = Math.min(bound.hi, Math.max(bound.lo, num / den));
      moved = Math.max(moved, Math.abs(next - scales[l]));
      scales[l] = next;
    }
    if (moved < 1e-6) break;
  }

  const achieved = achievedAt(scales);
  let distance = 0;
  for (const d of dims) distance += w[d] * (achieved[d] - target[d]) ** 2;
  return { scales, achieved, distance, bundles, fixed };
}

// Aromatic ceiling (fleet, 2026-08-20). Herb/spice rows are ordinary "other"
// levers to the math, so a recipe whose data carries a large herb amount
// scaled up like food: customers were prescribed 50–105 g of bay leaves,
// 25–155 g of thyme and 150 g of tarragon as if they were vegetables —
// "nobody is eating a bowl of bay leaves" (verbatim review). Nothing
// culinary ever needs more: dried herbs/spices cap at 10 g per row, fresh
// ones (basil for a pistou, root ginger) at 60 g. Classified by the FDC
// category the gate already loads; the kcal density separates dried
// (~250–350 kcal/100 g) from fresh (~25–100).
const AROMATIC_DRIED_CAP_G = 10;
const AROMATIC_FRESH_CAP_G = 60;
function aromaticCapG(food) {
  if (!food) return null;
  const cat = String(food.fdcCategory || "").toLowerCase();
  if (cat !== "spices and herbs") return null;
  const dried = Number.isFinite(food.kcal) && food.kcal >= 150;
  return dried ? AROMATIC_DRIED_CAP_G : AROMATIC_FRESH_CAP_G;
}

// Food-scale rounding (directive §3.2): 5 g steps for ordinary amounts,
// 1 g for calorie-dense items (≥500 kcal/100 g — oils, nut butters), whole
// grams under 20 g, and never 0 for a real amount (the shipped solver's
// measured lesson: plain rounding deleted 4.3% of ingredients).
// Aromatic rows are capped here — this is the one choke point every scaled
// gram passes through.
function roundGrams(raw, food) {
  if (!(raw > 0)) return 0;
  const cap = aromaticCapG(food);
  if (cap != null && raw > cap) raw = cap;
  const dense = food && Number.isFinite(food.kcal) && food.kcal >= 500;
  if (dense) return Math.max(1, Math.round(raw));
  if (raw < 20) return Math.max(1, Math.round(raw));
  return Math.max(20, Math.round(raw / 5) * 5);
}

/**
 * applyLevers(rows, scales) → rows with {grams} scaled by the row's lever and
 * ROUNDED, plus FDC-honest totals recomputed from the rounded grams.
 */
function applyLevers(rows, scales) {
  const out = rows.map((r) => {
    const lever = leverOf(r);
    const s = lever ? scales[lever] ?? 1 : 1;
    const grams = roundGrams(r.grams * s, r.food);
    return { ...r, grams };
  });
  const totals = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
  for (const r of out) {
    const k = r.grams / 100;
    totals.kcal += r.food.kcal * k;
    totals.protein += r.food.protein * k;
    totals.fat += r.food.fat * k;
    totals.carb += r.food.carb * k;
    totals.fiber += (Number.isFinite(r.food.fiber) ? r.food.fiber : 0) * k;
  }
  totals.netCarb = Math.max(0, totals.carb - totals.fiber);
  return { rows: out, totals };
}

module.exports = { LEVER_BOUNDS, LEVER_OF_ROLE, leverOf, bundleByLever, solveLevers, roundGrams, applyLevers, aromaticCapG };
