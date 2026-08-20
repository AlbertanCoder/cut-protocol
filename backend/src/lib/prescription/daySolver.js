// prescription/daySolver.js — assemble one day of food to the directive ruler.
//
// Pipeline (§3.1/§3.2): SELECT dishes from the (already gate-filtered) pool —
// greedy over K sampled candidates per slot with carry-forward, adding a
// second/third dish to a slot when one dish's levers cannot reach the slot's
// share (an OMAD slot is ONE slot holding SEVERAL dishes — §3.1's unit note)
// — then REFINE every dish's levers jointly against the day target, ROUND to
// food-scale grams, MICRO-ADJUST calorie-dense 1 g items to close the kcal
// band, and RE-VERIFY the rounded day with the prescription ruler. The whole
// assembly runs BEST-OF-N attempts (selection is stochastic; the shipped
// solver paid for the same lesson with generateBestWeekPlan's best-of-5).
// Assembly re-runs the allergen gate over the final plate (belt and braces,
// §3.3.1) and emits the §3.3.4 allergen_scan metadata line.
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
const MAX_DISHES_PER_SLOT = 4;
const DISH_KCAL_GUESS = 650; // how much one dish comfortably carries at 1-2×
const DEFAULT_ATTEMPTS = 5;
const BAND_W = { kcal: 1 / 50 ** 2, protein: 1 / 7 ** 2, fat: 1 / 7 ** 2, netCarb: 1 / 10 ** 2 };
const MISS_W = { kcal: 1 / 50, proteinG: 1 / 7, fatG: 1 / 7, netCarbG: 1 / 10 };

function foodMacrosUsable(f) {
  return f && Number.isFinite(f.kcal) && Number.isFinite(f.protein) && Number.isFinite(f.fat) && Number.isFinite(f.carb);
}

function rowsOf(recipe) {
  return (recipe.ingredients || [])
    .filter((i) => Number.isFinite(i.baseGrams) && i.food)
    .map((i) => ({ grams: i.baseGrams, scalable: i.scalable !== false, role: i.role, food: i.food, foodId: i.foodId, name: i.food.name }));
}

// A recipe carrying a macro-incomplete food (null kcal — this library is
// documented to hold such rows) cannot be solved honestly: NaN survives
// Math.min/max clamps and poisons every total. Dropping the ROW would
// silently change the dish, so the whole recipe is ineligible — the same
// fail-closed posture as exclusionGate and nutritionCore (review finding
// 2026-08-20).
function recipeSolvable(recipe) {
  const rows = rowsOf(recipe);
  return rows.length > 0 && rows.every((r) => foodMacrosUsable(r.food));
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
    return recipeSolvable(r);
  });
}

// Weighted sample without replacement. Weight = protein-density fit ×
// fat-share fit × caller bias × noise. The fat-share term exists because the
// first measured persona run failed P0 on fatG:over 9/30 days — protein-only
// density steering picks fatty proteins and no lever can undo composition
// (the shipped solver's own lesson: fat was 59% of its failing days).
// `bias` is the caller's soft-preference hook — a MULTIPLIER, never a veto.
function sampleCandidates(list, k, rng, dayMid, bias) {
  const pdT = dayMid.kcal > 0 ? dayMid.protein / dayMid.kcal : 0.05;
  const fsT = dayMid.kcal > 0 ? (dayMid.fat * 9) / dayMid.kcal : 0.3;
  const scored = list.map((r) => {
    const pd = r.kcal > 0 ? r.protein / r.kcal : 0;
    const fs = r.kcal > 0 && Number.isFinite(r.fat) ? (r.fat * 9) / r.kcal : fsT;
    const w = (1 / (Math.abs(pd - pdT) + 0.015)) *
              (1 / (Math.abs(fs - fsT) + 0.08)) *
              (bias ? Math.max(0.01, bias(r) ?? 1) : 1) *
              (0.5 + rng());
    return { r, w };
  });
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, k).map((s) => s.r);
}

function sumRows(rows) {
  const t = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
  for (const r of rows) {
    const k = r.grams / 100;
    t.kcal += r.food.kcal * k;
    t.protein += r.food.protein * k;
    t.fat += r.food.fat * k;
    t.carb += r.food.carb * k;
    t.fiber += (Number.isFinite(r.food.fiber) ? r.food.fiber : 0) * k;
  }
  t.netCarb = Math.max(0, t.carb - t.fiber);
  return t;
}

function missScore(verdict) {
  let s = 0;
  for (const m of verdict.misses) s += (MISS_W[m.key] || 1) * (m.by || 1);
  return s;
}

/**
 * solvePrescriptionDay({ pool, targets, mealConfig, profile, rng, recentIds,
 *                        bias, attempts })
 *
 * targets: the ruler's shape — { kcal, proteinG, fatG, netCarbG, floorKcal?,
 *          netCarbMaxG? } (points or {lo,hi} ranges).
 * mealConfig: { meals, snacks } — HARD structure (§3.2): OMAD = {meals:1,
 *          snacks:0} yields exactly one slot (which may hold several dishes);
 *          the soft per-meal shaping rules always yield to the structure.
 * rng: () => [0,1) — injected. recentIds: Set of recipe ids used in the
 * previous 2 days. bias: optional (recipe) => multiplier — soft preferences.
 *
 * Returns { ok, slots, totals, verdict, scan, scanLine, diagnosis } where
 * slots[i] = { slotType, slotIndex, dishes: [{recipeId, recipeName, scales,
 * ingredients, totals}] }.
 */
function solvePrescriptionDay({ pool, targets, mealConfig, profile = {}, rng, recentIds = null, bias = null, attempts = DEFAULT_ATTEMPTS }) {
  const bands = resolveBands(targets);
  const meals = Math.max(0, mealConfig?.meals ?? 3);
  const snacks = Math.max(0, mealConfig?.snacks ?? 0);
  const slotPlan = [
    ...Array.from({ length: meals }, (_, i) => ({ slotType: "meal", slotIndex: i })),
    ...Array.from({ length: snacks }, (_, i) => ({ slotType: "snack", slotIndex: i })),
  ];
  if (slotPlan.length === 0) return { ok: false, slots: [], diagnosis: "zero slots — a day with no meals is not a plan" };

  const dayMid = { kcal: bands.kcal.mid, protein: bands.proteinG.mid, fat: bands.fatG.mid, netCarb: bands.netCarbG.mid };

  function assembleOnce() {
    // ── stage 1: greedy selection with carry-forward; multi-dish slots ────
    const used = new Set();
    const slots = [];
    const remaining = { ...dayMid };
    let slotsLeft = slotPlan.length;
    for (const slot of slotPlan) {
      const share = slot.slotType === "snack" && meals >= 3
        ? Math.min(SNACK_KCAL_GUESS, remaining.kcal / slotsLeft)
        : remaining.kcal / slotsLeft;
      const frac = remaining.kcal > 0 ? share / remaining.kcal : 1 / slotsLeft;
      const slotResidual = {
        kcal: share,
        protein: remaining.protein * frac,
        fat: remaining.fat * frac,
      };
      const dishes = [];
      for (let d = 0; d < MAX_DISHES_PER_SLOT; d++) {
        if (dishes.length > 0 && slotResidual.kcal < 180) break;
        const list = eligible(pool, slot.slotType, used, recentIds);
        if (list.length === 0) break;
        // Aim each dish at its fair SHARE of the slot residual, not the whole
        // of it — targeting 2,400 kcal at one dish pins every lever and
        // distorts composition (measured: keto OMAD 4/30 before this).
        const dishesLeft = Math.max(1, Math.min(MAX_DISHES_PER_SLOT - d, Math.round(slotResidual.kcal / DISH_KCAL_GUESS)));
        const dishTarget = {
          kcal: slotResidual.kcal / dishesLeft,
          protein: slotResidual.protein / dishesLeft,
          fat: slotResidual.fat / dishesLeft,
        };
        const candidates = sampleCandidates(list, CANDIDATES_PER_SLOT, rng, dayMid, bias);
        let best = null;
        for (const r of candidates) {
          const rows = rowsOf(r);
          const solved = solveLevers(rows, dishTarget);
          if (!best || solved.distance < best.solved.distance) best = { recipe: r, rows, solved };
        }
        if (!best) break;
        used.add(best.recipe.id);
        dishes.push({ recipe: best.recipe, rows: best.rows, scales: best.solved.scales });
        for (const k of ["kcal", "protein", "fat"]) slotResidual[k] = Math.max(0, slotResidual[k] - best.solved.achieved[k]);
        for (const k of ["kcal", "protein", "fat"]) remaining[k] = Math.max(0, remaining[k] - best.solved.achieved[k]);
      }
      slots.push({ ...slot, dishes, reason: dishes.length ? null : "empty-pool" });
      slotsLeft--;
    }

    const allDishes = slots.flatMap((s) => s.dishes);
    if (allDishes.length === 0) return { slots, allDishes, day: null, verdict: null };

    // ── stage 2: joint day-level refinement across every dish's levers ────
    const dims = ["kcal", "protein", "fat", "netCarb"];
    const vars = [];
    for (const d of allDishes) {
      const { bundles, fixed } = bundleByLever(d.rows);
      d.bundles = bundles; d.fixed = fixed;
      for (const [lever, vec] of bundles) vars.push({ dish: d, lever, vec });
    }
    const scaleOf = (v) => v.dish.scales[v.lever] ?? 1;
    const dayAchieved = () => {
      const a = { kcal: 0, protein: 0, fat: 0, netCarb: 0 };
      for (const d of allDishes) for (const k of dims) a[k] += d.fixed[k];
      for (const v of vars) for (const k of dims) a[k] += v.vec[k] * scaleOf(v);
      return a;
    };
    for (let iter = 0; iter < 60; iter++) {
      let moved = 0;
      for (const v of vars) {
        const rest = dayAchieved();
        for (const k of dims) rest[k] -= v.vec[k] * scaleOf(v);
        let num = 0, den = 0;
        for (const k of dims) {
          num += BAND_W[k] * v.vec[k] * (dayMid[k] - rest[k]);
          den += BAND_W[k] * v.vec[k] * v.vec[k];
        }
        if (den < 1e-12) continue;
        const bound = LEVER_BOUNDS[v.lever];
        const next = Math.min(bound.hi, Math.max(bound.lo, num / den));
        moved = Math.max(moved, Math.abs(next - scaleOf(v)));
        v.dish.scales[v.lever] = next;
      }
      if (moved < 1e-6) break;
    }

    // ── stage 3: round to food-scale grams, recompute honestly ────────────
    for (const d of allDishes) {
      const applied = applyLevers(d.rows, d.scales);
      d.finalRows = applied.rows;
      d.totals = applied.totals;
    }
    const sumDay = () => {
      const t = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
      for (const d of allDishes) for (const k of Object.keys(t)) t[k] += d.totals[k];
      return t;
    };

    // ── stage 4: micro-adjust — close the kcal band with 1 g-dense items ──
    let day = sumDay();
    let verdict = dayVerdict(day, targets);
    const kcalMiss = () => verdict.misses.find((m) => m.key === "kcal");
    for (let guard = 0; guard < 24 && kcalMiss(); guard++) {
      const miss = kcalMiss();
      const wantMore = miss.kind === "under";
      let bestRow = null, bestDish = null;
      for (const d of allDishes) {
        for (const r of d.finalRows) {
          // Dense items only (1 g granularity); every nudge stays inside
          // ±25% of the rounded amount — the aromatic-wiggle cap, applied to
          // all micro-adjustments so a number-chase can never ruin a dish.
          if (!(r.food.kcal >= 500) || r.grams < 4) continue;
          if (r._base === undefined) r._base = r.grams;
          const withinCap = wantMore ? r.grams + 1 <= r._base * 1.25 : r.grams - 1 >= Math.max(1, r._base * 0.75);
          if (withinCap && (!bestRow || r.food.kcal > bestRow.food.kcal)) { bestRow = r; bestDish = d; }
        }
      }
      if (!bestRow) break;
      bestRow.grams += wantMore ? 1 : -1;
      bestDish.totals = sumRows(bestDish.finalRows);
      day = sumDay();
      verdict = dayVerdict(day, targets);
    }
    return { slots, allDishes, day, verdict };
  }

  // ── best-of-N attempts; early exit on a clean day ─────────────────────────
  let best = null;
  for (let a = 0; a < Math.max(1, attempts); a++) {
    const attempt = assembleOnce();
    if (!attempt.day) { best = best || attempt; continue; }
    const score = [attempt.verdict.misses.length, missScore(attempt.verdict)];
    if (!best || !best.day ||
        score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
      best = { ...attempt, score };
    }
    if (attempt.verdict.inBand && attempt.slots.every((s) => s.dishes.length > 0)) break;
  }

  if (!best || !best.day) {
    return { ok: false, slots: best ? best.slots : [], totals: null, diagnosis: "no eligible recipes for any slot — the pool is empty after your rules" };
  }
  const { slots, day, verdict } = best;

  // ── stage 5: belt-and-braces allergen re-scan of the FINAL plate ─────────
  const exclusions = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  const hits = [];
  let ingredientCount = 0;
  for (const s of slots) {
    for (const d of s.dishes) {
      ingredientCount += d.finalRows.length;
      if (isExcluded(d.recipe, profile)) hits.push(`${d.recipe.name} (slot ${s.slotType}#${s.slotIndex})`);
    }
  }
  const scan = { profile: [...exclusions, ...(profile.dietaryStyle ? [`style:${profile.dietaryStyle}`] : [])], ingredientCount, hits };

  const unfilled = slots.filter((s) => s.dishes.length === 0);
  return {
    ok: verdict.inBand && hits.length === 0 && unfilled.length === 0,
    slots: slots.map((s) => ({
      slotType: s.slotType, slotIndex: s.slotIndex, reason: s.reason,
      dishes: s.dishes.map((d) => ({
        recipeId: d.recipe.id, recipeName: d.recipe.name, scales: d.scales,
        ingredients: d.finalRows.map((r) => ({ foodId: r.foodId, name: r.name, grams: r.grams, role: r.role })),
        totals: d.totals,
      })),
    })),
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
