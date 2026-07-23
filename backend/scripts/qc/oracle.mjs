// oracle — INDEPENDENT verification of a solve. Ground rule #4: never trust the
// solver's self-reported numbers. Everything here is recomputed from raw Food
// rows and re-checked against the profile's own restrictions, so a bug in the
// solver's arithmetic or filtering cannot hide behind the solver's own report.
//
// What it verifies, per week solved:
//   1. MACROS  — recompute every slot's macros from a private Food snapshot
//                (per-100g × grams/100) and compare to what the solver claimed.
//   2. ALLERGY — re-check every SHIPPED ingredient against the excluded
//                allergens and the dietary style. One leak is a P0.
//   3. FLOOR   — the derived target must never sit below max(RMR×0.95, sex floor).
//   4. PORTION — every scale factor within 0.5–2×.
//   5. SLOTTING— no dessert / beverage / condiment placed in a meal slot.
//   6. FEASIBILITY — for every day that misses, a cheap upper/lower bound on
//                what the available pool can reach classifies the miss as
//                HONEST (target truly unreachable — correct behaviour) vs
//                SOLVER-MISS (reachable, but the solver failed — a bug).
//   7. VARIETY — same recipe twice in a day; a recipe past the week repeat cap.

import plannerPkg from "../../src/lib/weeklyPlanner.js";
import dietPkg from "../../src/lib/dietaryFilter.js";
import solverPkg from "../../src/lib/mealSolver.js";

const { SCALE_BOUNDS, DEFAULT_REPEAT_CAP } = plannerPkg;
const { matchesExclusionTerm, recipeExcludedByStyle } = dietPkg;
const { DAY_KCAL_TOLERANCE_PCT, DAY_PROTEIN_TOLERANCE_PCT } = solverPkg;

const SEX_FLOOR = { M: 1500, F: 1200 };
const SCALE_LO = (SCALE_BOUNDS && SCALE_BOUNDS[0]) || 0.5;
const SCALE_HI = (SCALE_BOUNDS && SCALE_BOUNDS[1]) || 2;
// Two bars, deliberately distinct:
//  · ACCEPTANCE (the gauntlet's own goal): ±5% kcal, protein down to −5 g.
//    Measured on every feasible day; the report's "in tolerance" rate uses it.
//  · SILENT-MISS (a genuine P1 bug): outside the SOLVER'S OWN declared tolerance
//    (±15%) with nothing surfaced. A day the solver knowingly ships slightly
//    off — and publishes a match % for — is honest, not a bug; only a day that
//    breaches the solver's own promise undeclared is a defect.
const KCAL_ACCEPT = 0.05;
const PROTEIN_SLACK = 5;
const KCAL_SILENT = DAY_KCAL_TOLERANCE_PCT ?? 0.15;
const PROTEIN_SILENT = DAY_PROTEIN_TOLERANCE_PCT ?? 0.15;
const MEAL_CATS_BANNED_IN_MEAL = new Set(["dessert", "beverage", "condiment_or_sauce", "bread_or_pastry_side"]);

// Recompute one slot's macros from the private Food snapshot. Uses the slot's
// OWN shipped grams (already practical-rounded by the solver), so a mismatch
// against the solver's reported totals is a genuine arithmetic defect.
function recomputeSlot(slot, foodById) {
  let kcal = 0, protein = 0, fat = 0, carb = 0, missing = 0;
  for (const ing of slot.ingredients || []) {
    const f = foodById.get(ing.foodId);
    if (!f) { missing++; continue; }
    const factor = ing.grams / 100;
    kcal += f.kcal * factor; protein += f.protein * factor; fat += f.fat * factor; carb += f.carb * factor;
  }
  return { kcal, protein, fat, carb, missing };
}

export function oracle(res, ctx) {
  const { foodById, recipeById } = ctx;
  const target = res.target;
  const excluded = res.inputs.dietProfile.excludedFoods || [];
  const style = res.inputs.dietProfile.dietaryStyle;
  const nMeal = res.inputs.mealConfig.meals;
  const nSnack = res.inputs.mealConfig.snacks;

  const findings = [];
  const add = (kind, severity, detail) => findings.push({ kind, severity, detail, seed: res.seed });

  // Crash short-circuits everything else — it is its own P0.
  if (res.crash) {
    add("crash", "P0", res.crash.message);
    return baseSummary(res, { crash: true, findings });
  }

  // ── FLOOR (invariant on the target) ───────────────────────────────────
  const sexFloor = SEX_FLOOR[res.inputs.profile.sex] ?? 1500;
  const requiredFloor = Math.max(sexFloor, Math.round(res.energy.rmr * 0.95), res.inputs.profile.floorKcal || 0);
  if (res.derived.target < requiredFloor - 1) {
    add("kcal-floor-breach", "P0", `target ${res.derived.target} < floor ${requiredFloor} (RMR ${res.energy.rmr})`);
  }

  // ── pool feasibility bounds (cheap, per slot type) ────────────────────
  const pool = res._pool || [];
  const mealPool = pool.filter((r) => r.slotType === "meal" || r.slotType === "either" || r.slotType == null);
  const snackPool = pool.filter((r) => r.slotType === "snack" || r.slotType === "either");
  const maxOf = (arr, key) => arr.reduce((m, r) => Math.max(m, r[key] || 0), 0);
  const minPosOf = (arr, key) => arr.reduce((m, r) => (r[key] > 0 ? Math.min(m, r[key]) : m), Infinity);
  const maxMealK = maxOf(mealPool, "kcal"), maxMealP = maxOf(mealPool, "protein");
  const maxSnackK = maxOf(snackPool, "kcal"), maxSnackP = maxOf(snackPool, "protein");
  const minMealK = Number.isFinite(minPosOf(mealPool, "kcal")) ? minPosOf(mealPool, "kcal") : 0;
  const minSnackK = Number.isFinite(minPosOf(snackPool, "kcal")) ? minPosOf(snackPool, "kcal") : 0;
  // Loosest reachable band for a whole day (max scale 2×, min scale 0.5×):
  const dayMaxKcal = nMeal * maxMealK * SCALE_HI + nSnack * maxSnackK * SCALE_HI;
  const dayMinKcal = nMeal * minMealK * SCALE_LO + nSnack * minSnackK * SCALE_LO;
  const dayMaxProtein = nMeal * maxMealP * SCALE_HI + nSnack * maxSnackP * SCALE_HI;

  // ── per-day pass over the shipped plan ────────────────────────────────
  const byDay = new Map();
  for (const s of res.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);

  let daysInTol = 0, daysFeasible = 0, feasibleMisses = 0, honestMisses = 0, silentMisses = 0;
  let allergyLeaks = 0, portionViolations = 0, dessertInMeal = 0, macroDrift = 0, sameRecipeSameDay = 0;
  let unfilledSilent = 0, unfilledDeclared = 0;
  const kcalDevs = [], proteinShorts = [];
  const declaredWeek = !!res.diagnosis;

  for (const [dow, slots] of byDay) {
    let dKcal = 0, dProt = 0, dFat = 0, dCarb = 0;
    const seenToday = new Map();

    for (const s of slots) {
      // portion bounds
      for (const sc of [s.proteinScale, s.sidesScale]) {
        if (sc != null && (sc < SCALE_LO - 1e-6 || sc > SCALE_HI + 1e-6)) {
          portionViolations++; add("portion-bound", "P0", `scale ${sc} outside [${SCALE_LO}, ${SCALE_HI}] (day ${dow})`);
        }
      }
      if (!s.recipeId) {
        if (s.warning || declaredWeek) unfilledDeclared++;
        else { unfilledSilent++; add("silent-unfilled-slot", "P1", `empty ${s.slotType} slot day ${dow}, no warning or diagnosis`); }
        continue;
      }
      // same recipe twice in one day
      seenToday.set(s.recipeId, (seenToday.get(s.recipeId) || 0) + 1);

      // dessert / non-meal in a meal slot
      if (s.slotType === "meal") {
        const rec = recipeById.get(s.recipeId);
        if (rec && rec.mealCategory && MEAL_CATS_BANNED_IN_MEAL.has(rec.mealCategory)) {
          dessertInMeal++; add("dessert-as-meal", "P0", `"${rec.name}" (${rec.mealCategory}) in a meal slot, day ${dow}`);
        }
      }

      // independent macro recompute vs the solver's own numbers
      const re = recomputeSlot(s, foodById);
      if (re.missing) add("missing-food-row", "P1", `slot day ${dow} references ${re.missing} food id(s) absent from the snapshot`);
      if (Math.abs(re.kcal - (s.kcal ?? re.kcal)) > 1.0 || Math.abs(re.protein - (s.protein ?? re.protein)) > 0.5) {
        macroDrift++; add("macro-drift", "P0", `day ${dow} slot: solver ${Math.round(s.kcal)}kcal/${Math.round(s.protein)}p vs oracle ${Math.round(re.kcal)}kcal/${Math.round(re.protein)}p`);
      }
      dKcal += re.kcal; dProt += re.protein; dFat += re.fat; dCarb += re.carb;

      // ALLERGY re-check on the actually-shipped ingredients (the real leak test)
      for (const ing of s.ingredients || []) {
        for (const term of excluded) {
          if (matchesExclusionTerm(ing.name, term)) {
            allergyLeaks++; add("allergy-leak", "P0", `"${ing.name}" matches excluded "${term}" (day ${dow})`);
          }
        }
      }
      if (style) {
        const rec = { ingredients: (s.ingredients || []).map((i) => ({ name: i.name })) };
        if (recipeExcludedByStyle(rec, style)) {
          allergyLeaks++; add("diet-style-leak", "P0", `placed recipe violates "${style}" (day ${dow})`);
        }
      }
    }

    for (const [, n] of seenToday) if (n > 1) { sameRecipeSameDay++; add("same-recipe-same-day", "P2", `a recipe served ${n}× on day ${dow}`); }

    // day acceptance (±5%) + silent-miss (outside solver's own ±15%) + feasibility
    const kcalDev = target.kcal > 0 ? (dKcal - target.kcal) / target.kcal : 0;
    const proteinShort = Math.max(0, target.proteinLo - dProt);
    kcalDevs.push(kcalDev * 100);
    proteinShorts.push(proteinShort);
    const acceptOk = Math.abs(kcalDev) <= KCAL_ACCEPT && dProt >= target.proteinLo - PROTEIN_SLACK;
    if (acceptOk) daysInTol++;
    // "within the solver's own promise" — outside this AND undeclared is the bug.
    const withinSolverPromise = Math.abs(kcalDev) <= KCAL_SILENT && (target.proteinLo <= 0 || (target.proteinLo - dProt) / target.proteinLo <= PROTEIN_SILENT);

    // Is this day even feasible from the pool? (loose bounds — only call HONEST
    // when we're confident the target is unreachable in the reachable band.)
    const reachable = target.kcal <= dayMaxKcal && target.kcal >= dayMinKcal && dayMaxProtein >= target.proteinLo;
    if (reachable) daysFeasible++;
    if (!acceptOk && reachable) feasibleMisses++;      // acceptance-bar miss (metric)
    if (!acceptOk && !reachable) honestMisses++;
    // A true silent miss: feasible, breaches the solver's OWN tolerance, and the
    // week carries no diagnosis to declare it. This is the P1 that matters.
    if (reachable && !withinSolverPromise && !declaredWeek) {
      silentMisses++;
      add("silent-solver-miss", "P1", `day ${dow} feasible, outside the solver's own ±15% (kcal ${Math.round(dKcal)}/${target.kcal}, protein ${Math.round(dProt)}/${target.proteinLo}), no diagnosis`);
    }
    void dFat; void dCarb;
  }

  // week repeat-cap
  const recipeCounts = new Map();
  for (const s of res.slots) if (s.recipeId) recipeCounts.set(s.recipeId, (recipeCounts.get(s.recipeId) || 0) + 1);
  let repeatCapViolations = 0;
  for (const [, n] of recipeCounts) if (n > DEFAULT_REPEAT_CAP) { repeatCapViolations++; add("week-repeat-cap", "P2", `a recipe used ${n}× (cap ${DEFAULT_REPEAT_CAP})`); }

  // ── outcome classification for this week ──────────────────────────────
  const totalDays = byDay.size || 1;
  let outcome;
  if (allergyLeaks || macroDrift || dessertInMeal || portionViolations) outcome = "unsafe";
  else if (silentMisses > 0 || unfilledSilent > 0) outcome = "silent-miss";           // a genuine P1 defect
  else if (daysInTol === totalDays && unfilledSilent === 0 && unfilledDeclared === 0) outcome = "converged";
  else if (feasibleMisses > 0) outcome = "off-target-declared";                        // outside ±5% but honest
  else if (honestMisses > 0 || unfilledDeclared > 0) outcome = "honest-unsolvable";
  else outcome = "partial";

  return baseSummary(res, {
    crash: false, outcome, findings,
    daysInTol, daysFeasible, feasibleMisses, honestMisses, silentMisses, totalDays,
    allergyLeaks, portionViolations, dessertInMeal, macroDrift, sameRecipeSameDay,
    repeatCapViolations, unfilledSilent, unfilledDeclared,
    kcalDevMax: kcalDevs.length ? Math.max(...kcalDevs.map(Math.abs)) : 0,
    proteinShortMax: proteinShorts.length ? Math.max(...proteinShorts) : 0,
    declaredWeek,
  });
}

function baseSummary(res, extra) {
  return {
    seed: res.seed,
    corner: res.corner,
    solveMs: res.solveMs,
    target: res.derived.target,
    floored: res.derived.floored,
    counts: res.counts,
    ...extra,
  };
}
