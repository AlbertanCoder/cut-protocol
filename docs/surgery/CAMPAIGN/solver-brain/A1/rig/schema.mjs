// A1/rig/schema.mjs — the ONE result record every Phase-4 experiment emits.
// Prose version: A1/rig/SCHEMA.md. Field meanings live there; this file is the
// builder + validator so two agents cannot drift apart by hand-rolling JSON.

export const SCHEMA_ID = "solver-brain/day/v1";

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);

// weeklyPlanner.SCALE_BOUNDS — copied, and drift-checked at run time in
// runRig.mjs against the solver's own exported bound where one is available.
export const SCALE_LO = 0.5;
export const SCALE_HI = 2.0;
const EPS = 1e-6;

export const atLo = (s) => s != null && Math.abs(s - SCALE_LO) <= EPS;
export const atHi = (s) => s != null && Math.abs(s - SCALE_HI) <= EPS;

/**
 * Build one per-day record.
 *
 * @param {object} a
 * @param {object} a.run       run header (label, agentId, pop, seed, ...)
 * @param {object} a.customer  { id, idx, tier, satisfiable, dietStyle, allergens,
 *                               mealsPerDay, snacksPerDay, horizonDays }
 * @param {object} a.day       { dayIndex, dayOfWeek, windowIndex }
 * @param {object} a.target    the computeMacros() target object
 * @param {object} a.achieved  { kcal, protein, fat, carb } recomputed from Food rows
 * @param {object} a.achievedSolver same, summed from the solver's own slot fields
 * @param {object} a.tol       the product's dayTolerance(target, achieved) result
 * @param {boolean} a.inBand   the product's dayInTolerance(tol)
 * @param {Array}  a.slots     the day's slots
 * @param {object} a.engine    { inTolerance, matchPct } — the solver's own claim
 * @param {object} a.honesty   { hasWarning, hasDiagnosis }
 * @param {number} a.solveMs
 */
export function buildDayRecord(a) {
  const { run, customer, day, target, achieved, achievedSolver, tol, inBand, slots, engine, honesty, solveMs } = a;

  const scales = [];
  const slotRows = slots.map((s) => {
    for (const sc of [s.proteinScale, s.sidesScale]) if (sc != null) scales.push(sc);
    return {
      slotType: s.slotType ?? null,
      slotIndex: s.slotIndex ?? null,
      recipeId: s.recipeId ?? null,
      proteinScale: r4(s.proteinScale),
      sidesScale: r4(s.sidesScale),
      pinnedLo: atLo(s.proteinScale) || atLo(s.sidesScale),
      pinnedHi: atHi(s.proteinScale) || atHi(s.sidesScale),
      kcal: r2(s.kcal),
      protein: r2(s.protein),
      warning: s.warning ? String(s.warning).slice(0, 160) : null,
    };
  });

  const filled = slotRows.filter((s) => s.recipeId != null);
  const pinnedLo = slotRows.filter((s) => s.pinnedLo).length;
  const pinnedHi = slotRows.filter((s) => s.pinnedHi).length;

  return {
    schema: SCHEMA_ID,
    run,
    personaId: customer.id,
    personaIdx: customer.idx,
    tier: customer.tier,
    satisfiable: customer.satisfiable,
    dietStyle: customer.dietStyle,
    allergens: customer.allergens,
    allergenStack: (customer.allergens || []).slice().sort().join("+") || "none",
    mealsPerDay: customer.mealsPerDay,
    snacksPerDay: customer.snacksPerDay,
    horizonDays: customer.horizonDays,

    dayIndex: day.dayIndex,
    dayOfWeek: day.dayOfWeek,
    windowIndex: day.windowIndex ?? 0,
    dayKey: `${customer.id}#${day.dayIndex}`,

    // A day with no filled slot is a refusal, not a graded plan. `judged` is the
    // denominator flag: compare.mjs counts judged days only, and reports the
    // unjudged count separately so nothing is hidden.
    judged: filled.length > 0,
    slotsTotal: slotRows.length,
    slotsFilled: filled.length,

    target: {
      kcal: target.kcal ?? null,
      proteinLo: target.proteinLo ?? null, proteinHi: target.proteinHi ?? null,
      fatLo: target.fatLo ?? null, fatHi: target.fatHi ?? null,
      carbLo: target.carbLo ?? null, carbHi: target.carbHi ?? null,
      keto: !!target.keto,
    },
    achieved: { kcal: r2(achieved.kcal), protein: r2(achieved.protein), fat: r2(achieved.fat), carb: r2(achieved.carb) },
    achievedSolver: { kcal: r2(achievedSolver.kcal), protein: r2(achievedSolver.protein), fat: r2(achievedSolver.fat), carb: r2(achievedSolver.carb) },
    drift: { kcal: r2(achievedSolver.kcal - achieved.kcal), protein: r2(achievedSolver.protein - achieved.protein) },

    verdict: {
      inBand,
      kcalOk: tol.kcalOk, proteinOk: tol.proteinOk, fatOk: tol.fatOk, carbOk: tol.carbOk,
      fatJudged: tol.fatJudged, carbJudged: tol.carbJudged,
      kcalDeltaPct: r4(tol.kcalDeltaPct), proteinShortPct: r4(tol.proteinShortPct),
      fatShortPct: r4(tol.fatShortPct), fatOverPct: r4(tol.fatOverPct),
      carbShortPct: r4(tol.carbShortPct), carbOverPct: r4(tol.carbOverPct),
    },
    engineInBand: engine?.inTolerance ?? null,
    engineMatchPct: engine?.matchPct ?? null,
    // TRUE when the engine's own verdict disagrees with the verdict recomputed
    // from raw Food rows. Any non-zero count here is an instrument problem and
    // must be reported before any headline number is.
    verdictDisagrees: engine?.inTolerance != null && engine.inTolerance !== inBand,

    pinned: {
      scaledSlots: scales.length,
      atLoBound: pinnedLo,
      atHiBound: pinnedHi,
      anyPinned: pinnedLo + pinnedHi > 0,
    },
    honesty: {
      hasWarning: !!honesty?.hasWarning,
      hasDiagnosis: !!honesty?.hasDiagnosis,
      // The load-bearing property: an out-of-band day MUST carry a warning or a
      // week-level diagnosis. FALSE here on an out-of-band day is a silent miss.
      declared: inBand ? null : !!(honesty?.hasWarning || honesty?.hasDiagnosis),
    },
    slots: slotRows,
    solveMs: r2(solveMs),
  };
}

const REQUIRED = ["schema", "personaId", "dayIndex", "judged", "tier", "satisfiable", "target", "achieved", "verdict", "pinned"];

/** Cheap structural check. Returns [] when the record is well-formed. */
export function validateRecord(rec) {
  const bad = [];
  for (const k of REQUIRED) if (rec[k] === undefined) bad.push(`missing ${k}`);
  if (rec.schema !== SCHEMA_ID) bad.push(`schema is ${rec.schema}, expected ${SCHEMA_ID}`);
  if (rec.verdict && typeof rec.verdict.inBand !== "boolean") bad.push("verdict.inBand is not a boolean");
  return bad;
}
