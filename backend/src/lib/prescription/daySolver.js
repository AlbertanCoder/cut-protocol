// prescription/daySolver.js — assemble one day of food to the directive ruler.
//
// Pipeline (§3.1/§3.2): SELECT meals from the (already gate-filtered) pool —
// greedy over K sampled candidates per slot with carry-forward — then REFINE
// all slots' levers jointly against the day target, ROUND to food-scale
// grams, MICRO-ADJUST calorie-dense 1 g items to close the kcal band, and
// RE-VERIFY the rounded day with the prescription ruler. Assembly re-runs
// the allergen gate over the final plate (belt and braces, §3.3.1) and emits
// the §3.3.4 allergen_scan metadata line.
//
// Purity contract (same as the shipped solver): rng is INJECTED, no
// Math.random, no Date.now, no DB. The pool arrives from planContext —
// "pool membership = compliance" — and this file still re-checks.

"use strict";

const { solveLevers, applyLevers, bundleByLever, LEVER_BOUNDS } = require("./levers.js");
const { dayVerdict, resolveBands, allergenScanLine } = require("./ruler.js");
const { isExcluded } = require("../exclusionGate.js");

const NON_MEAL_CATEGORIES = new Set(["dessert", "bread_or_pastry_side", "condiment_or_sauce"]);
const CANDIDATES_PER_SLOT = 12;
const SNACK_KCAL_GUESS = 220;

function rowsOf(recipe) {
  return (recipe.ingredients || [])
    .filter((i) => Number.isFinite(i.baseGrams) && i.food)
    .map((i) => ({ grams: i.baseGrams, scalable: i.scalable !== false, role: i.role, food: i.food, foodId: i.foodId, name: i.food.name }));
}

function eligible(pool, slotType, usedToday, recentIds) {
  return pool.filter((r) => {
    if (usedToday.has(r.id)) return false;
    if (recentIds && recentIds.has(r.id)) return false; // §3.2 variety: no repeat within 3 days
    if (slotType === "meal") {
      if (r.slotType === "snack") return false;
      if (NON_MEAL_CATEGORIES.has(r.mealCategory || "")) return false;
    } else if (slotType === "snack") {
      if (r.slotType === "meal") return false;
    }
    return rowsOf(r).length > 0;
  });
}

// Weighted sample without replacement — weight favors protein density fit.
function sampleCandidates(list, k, rng, proteinPerKcalTarget) {
  const scored = list.map((r) => {
    const density = r.kcal > 0 ? r.protein / r.kcal : 0;
    const wFit = 1 / (Math.abs(density - proteinPerKcalTarget) + 0.015);
    return { r, w: wFit * (0.5 + rng()) };
  });
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, k).map((s) => s.r);
}

/**
 * solvePrescriptionDay({ pool, targets, mealConfig, profile, rng, recentIds })
 *
 * targets: the ruler's shape — { kcal, proteinG, fatG, netCarbG, floorKcal?,
 *          netCarbMaxG? } (points or {lo,hi} ranges).
 * mealConfig: { meals, snacks } — HARD structure (§3.2): OMAD = {meals:1,
 *          snacks:0} yields exactly one slot; the soft per-meal shaping
 *          rules apply only at 3+ meals and always yield to the structure.
 * rng: () => [0,1) — injected.
 * recentIds: Set of recipe ids used in the previous 2 days (3-day window).
 *
 * Returns { ok, slots, totals, verdict, scan, scanLine, diagnosis }.
 */
function solvePrescriptionDay({ pool, targets, mealConfig, profile = {}, rng, recentIds = null }) {
  const bands = resolveBands(targets);
  const meals = Math.max(0, mealConfig?.meals ?? 3);
  const snacks = Math.max(0, mealConfig?.snacks ?? 0);
  const slotPlan = [
    ...Array.from({ length: meals }, (_, i) => ({ slotType: "meal", slotIndex: i })),
    ...Array.from({ length: snacks }, (_, i) => ({ slotType: "snack", slotIndex: i })),
  ];
  if (slotPlan.length === 0) return { ok: false, slots: [], diagnosis: "zero slots — a day with no meals is not a plan" };

  const dayMid = { kcal: bands.kcal.mid, protein: bands.proteinG.mid, fat: bands.fatG.mid, netCarb: bands.netCarbG.mid };
  const proteinPerKcal = dayMid.kcal > 0 ? dayMid.protein / dayMid.kcal : 0.05;

  // ── stage 1: greedy selection with carry-forward ─────────────────────────
  const used = new Set();
  const chosen = [];
  const remaining = { ...dayMid };
  let slotsLeft = slotPlan.length;
  for (const slot of slotPlan) {
    // Share of what is left; snacks take a fixed modest share at 3+ meals.
    const share = slot.slotType === "snack" && meals >= 3
      ? Math.min(SNACK_KCAL_GUESS, remaining.kcal / slotsLeft)
      : remaining.kcal / slotsLeft;
    const frac = remaining.kcal > 0 ? share / remaining.kcal : 1 / slotsLeft;
    const slotTarget = {
      kcal: share,
      protein: remaining.protein * frac,
      fat: remaining.fat * frac,
    };
    const list = eligible(pool, slot.slotType, used, recentIds);
    if (list.length === 0) {
      chosen.push({ ...slot, recipe: null, reason: "empty-pool" });
      slotsLeft--;
      continue;
    }
    const candidates = sampleCandidates(list, CANDIDATES_PER_SLOT, rng, proteinPerKcal);
    let best = null;
    for (const r of candidates) {
      const rows = rowsOf(r);
      const solved = solveLevers(rows, slotTarget);
      if (!best || solved.distance < best.solved.distance) best = { recipe: r, rows, solved };
    }
    used.add(best.recipe.id);
    chosen.push({ ...slot, recipe: best.recipe, rows: best.rows, scales: best.solved.scales });
    for (const d of ["kcal", "protein", "fat"]) remaining[d] = Math.max(0, remaining[d] - best.solved.achieved[d]);
    slotsLeft--;
  }

  const filled = chosen.filter((s) => s.recipe);
  if (filled.length === 0) {
    return { ok: false, slots: chosen, diagnosis: "no eligible recipes for any slot — the pool is empty after your rules" };
  }

  // ── stage 2: joint day-level refinement across every slot's levers ──────
  // Same projected coordinate descent as one recipe, over slot×lever
  // variables against the DAY midpoints (the LP-refinement stage §3.2 asks
  // for, hand-rolled as permitted).
  const dims = ["kcal", "protein", "fat", "netCarb"];
  const W = { kcal: 1 / 50 ** 2, protein: 1 / 7 ** 2, fat: 1 / 7 ** 2, netCarb: 1 / 10 ** 2 };
  const vars = [];
  for (const s of filled) {
    const { bundles, fixed } = bundleByLever(s.rows);
    s.bundles = bundles; s.fixed = fixed;
    for (const [lever, vec] of bundles) vars.push({ slot: s, lever, vec });
  }
  const scaleOf = (v) => v.slot.scales[v.lever] ?? 1;
  const dayAchieved = () => {
    const a = { kcal: 0, protein: 0, fat: 0, netCarb: 0 };
    for (const s of filled) for (const d of dims) a[d] += s.fixed[d];
    for (const v of vars) for (const d of dims) a[d] += v.vec[d] * scaleOf(v);
    return a;
  };
  for (let iter = 0; iter < 60; iter++) {
    let moved = 0;
    for (const v of vars) {
      const rest = dayAchieved();
      for (const d of dims) rest[d] -= v.vec[d] * scaleOf(v);
      let num = 0, den = 0;
      for (const d of dims) {
        num += W[d] * v.vec[d] * (dayMid[d] - rest[d]);
        den += W[d] * v.vec[d] * v.vec[d];
      }
      if (den < 1e-12) continue;
      const bound = LEVER_BOUNDS[v.lever];
      const next = Math.min(bound.hi, Math.max(bound.lo, num / den));
      moved = Math.max(moved, Math.abs(next - scaleOf(v)));
      v.slot.scales[v.lever] = next;
    }
    if (moved < 1e-6) break;
  }

  // ── stage 3: round to food-scale grams, recompute honestly ───────────────
  for (const s of filled) {
    const applied = applyLevers(s.rows, s.scales);
    s.finalRows = applied.rows;
    s.totals = applied.totals;
  }
  const sumDay = () => {
    const t = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
    for (const s of filled) for (const k of Object.keys(t)) t[k] += s.totals[k];
    return t;
  };

  // ── stage 4: micro-adjust — close the kcal band with 1 g-dense items ────
  // Rounding moves a day by tens of kcal; the fix is a few grams of the
  // day's own oils/dense items, never a new ingredient and never past the
  // row's lever bound (±25% of the rounded amount, the aromatic-wiggle cap).
  let day = sumDay();
  let verdict = dayVerdict(day, targets);
  const kcalMiss = () => verdict.misses.find((m) => m.key === "kcal");
  for (let guard = 0; guard < 24 && kcalMiss(); guard++) {
    const miss = kcalMiss();
    const wantMore = miss.kind === "under";
    let bestRow = null, bestSlot = null;
    for (const s of filled) {
      for (const r of s.finalRows) {
        // Dense items only (1 g granularity), and every nudge stays inside
        // ±25% of the rounded amount — the aromatic-wiggle cap, applied to
        // all micro-adjustments so a number-chase can never ruin a dish.
        if (!(r.food.kcal >= 500) || r.grams < 4) continue;
        if (r._base === undefined) r._base = r.grams;
        const withinCap = wantMore ? r.grams + 1 <= r._base * 1.25 : r.grams - 1 >= Math.max(1, r._base * 0.75);
        if (withinCap && (!bestRow || r.food.kcal > bestRow.food.kcal)) { bestRow = r; bestSlot = s; }
      }
    }
    if (!bestRow) break;
    bestRow.grams += wantMore ? 1 : -1;
    // Recompute the slot's totals from its (now nudged) grams — FDC-honest,
    // never patched arithmetic.
    const t = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
    for (const r of bestSlot.finalRows) {
      const k = r.grams / 100;
      t.kcal += r.food.kcal * k; t.protein += r.food.protein * k;
      t.fat += r.food.fat * k; t.carb += r.food.carb * k;
      t.fiber += (Number.isFinite(r.food.fiber) ? r.food.fiber : 0) * k;
    }
    t.netCarb = Math.max(0, t.carb - t.fiber);
    bestSlot.totals = t;
    day = sumDay();
    verdict = dayVerdict(day, targets);
  }

  // ── stage 5: belt-and-braces allergen re-scan of the FINAL plate ─────────
  const exclusions = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  const hits = [];
  let ingredientCount = 0;
  for (const s of filled) {
    ingredientCount += s.finalRows.length;
    if (isExcluded(s.recipe, profile)) hits.push(`${s.recipe.name} (slot ${s.slotType}#${s.slotIndex})`);
  }
  const scan = { profile: [...exclusions, ...(profile.dietaryStyle ? [`style:${profile.dietaryStyle}`] : [])], ingredientCount, hits };

  const unfilled = chosen.filter((s) => !s.recipe);
  return {
    ok: verdict.inBand && hits.length === 0 && unfilled.length === 0,
    slots: chosen.map((s) => s.recipe ? ({
      slotType: s.slotType, slotIndex: s.slotIndex, recipeId: s.recipe.id, recipeName: s.recipe.name,
      scales: s.scales, ingredients: s.finalRows.map((r) => ({ foodId: r.foodId, name: r.name, grams: r.grams, role: r.role })),
      totals: s.totals,
    }) : ({ slotType: s.slotType, slotIndex: s.slotIndex, recipeId: null, reason: s.reason })),
    totals: day,
    verdict,
    scan,
    scanLine: allergenScanLine(scan),
    diagnosis: verdict.inBand && unfilled.length === 0 ? null
      : unfilled.length > 0 ? `${unfilled.length} slot(s) had no eligible recipe`
      : `off band: ${verdict.misses.map((m) => `${m.key} ${m.kind} by ${Math.round(m.by * 10) / 10}`).join(", ")}`,
  };
}

module.exports = { solvePrescriptionDay };
