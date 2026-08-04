// solver-core-2 / goal-ruler (2026-08-03) — FAT AND CARBS ARE FIRST-CLASS IN THE VERDICT.
//
// The goal ruler:
// Kcal: ±10%
// Protein: floor only (>= proteinLo)
// Fat: 15–35 %E guardrail (except Keto, which has no ceiling)
// Carbs: Goal-dependent (floor for muscle gain/recomp, otherwise ungraded, Keto ceiling survives)

process.env.BRAIN = "off";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  dayTolerance, dayMissLine, dayInTolerance, scoreWeek, diagnoseFromResult,
  DAY_FAT_TOLERANCE_PCT, DAY_CARB_TOLERANCE_PCT,
} = require("../src/lib/mealSolver.js");

// 2,000 kcal, protein 140–160, fat 60–75 (mid 67.5), carbs 180–220 (mid 200).
const T = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 60, fatHi: 75, carbLo: 180, carbHi: 220, goal: "fat loss" };

// ── 1. the headline property ──────────────────────────────────────────────

test("a day that meets kcal + protein but is badly short on FAT is NOT in tolerance", () => {
  // Below 15% E fat is a miss. 15% of 2000 is 300 kcal (33.3g).
  const totals = { kcal: 2000, protein: 150, fat: 25, carb: 275 };
  const tol = dayTolerance(T, totals);
  assert.equal(tol.kcalOk, true, "calories are on target");
  assert.equal(tol.proteinOk, true, "protein is on target");
  assert.equal(tol.fatOk, false, "25 g fat is below the 15% guardrail");
  assert.equal(dayInTolerance(tol), false, "and therefore the DAY is not in tolerance");
});

test("carbs are NOT graded for fat loss targets (the remainder) — overshoot is fine", () => {
  const totals = { kcal: 2000, protein: 150, fat: 62, carb: 300 };
  const tol = dayTolerance(T, totals);
  assert.equal(tol.kcalOk, true);
  assert.equal(tol.proteinOk, true);
  assert.equal(tol.fatOk, true);
  assert.equal(tol.carbOk, true, "carbs take the remainder and are not graded");
  assert.equal(dayInTolerance(tol), true);
});

test("carbs ARE graded against a floor for muscle gain targets", () => {
  const target = { ...T, goal: "muscle gain" };
  const totals = { kcal: 2000, protein: 150, fat: 62, carb: 100 }; // short of 180g floor
  const tol = dayTolerance(target, totals);
  assert.equal(tol.carbOk, false, "short of the glycogen floor is a miss");
  assert.equal(dayInTolerance(tol), false);
});

test("the fat allowance is a 15–35 %E guardrail measured on the day's ACTUAL kcal", () => {
  // At 2000 kcal, 15% is 300 kcal (33.3 g fat), 35% is 700 kcal (77.7 g fat).
  const lowFat = { kcal: 2000, protein: 150, fat: 33, carb: 200 }; // just under 15% (33 * 9 / 2000 = 14.85%)
  const okFatLo = { kcal: 2000, protein: 150, fat: 34, carb: 200 }; // 15.3%
  const okFatHi = { kcal: 2000, protein: 150, fat: 77, carb: 200 }; // 34.6%
  const hiFat = { kcal: 2000, protein: 150, fat: 78, carb: 200 }; // 35.1%
  assert.equal(dayTolerance(T, lowFat).fatOk, false, "below 15% E is a miss");
  assert.equal(dayTolerance(T, okFatLo).fatOk, true);
  assert.equal(dayTolerance(T, okFatHi).fatOk, true);
  assert.equal(dayTolerance(T, hiFat).fatOk, false, "above 35% E is a miss");
});

test("inside the guardrail is always inside tolerance, in both directions", () => {
  const target = { ...T, goal: "muscle gain" }; // enforce carb floor
  for (const fat of [34, 50, 77]) {
    const tol = dayTolerance(target, { kcal: 2000, protein: 150, fat, carb: 180 });
    assert.equal(dayInTolerance(tol), true, `fat ${fat} sits inside %E guardrail and must pass`);
  }
});

// ── 1b. the safety floor outranks the calorie band ────────────────────────

test("the calorie band may narrow a day, never widen it past the safety floor", () => {
  // Reproduced on a real derived target: M/40/178cm/20%BF/90.7kg at 2.0 lb/wk
  // wants 1,470 kcal, is clamped UP to an 1,834 floor (RMR×0.95) — and the old
  // symmetric ±10% band then graded 1,651 kcal green, 183 beneath the number the
  // engine had just refused to prescribe below.
  const floored = { kcal: 1834, floorKcal: 1834, proteinLo: 180, proteinHi: 200, fatLo: 50, fatHi: 70, carbLo: 100, carbHi: 130 };
  const under = { kcal: 1651, protein: 185, fat: 55, carb: 110 };
  assert.equal(dayTolerance(floored, under).kcalOk, false, "a day below the floor is never in tolerance");
  assert.match(dayMissLine(floored, under), /1,651 kcal vs your 1,834 floor — 183 under/);
  // The floor is named, not the target — the floor is the constraint that bound.
  assert.doesNotMatch(dayMissLine(floored, under), /target/);

  // At the floor is fine; over the band is still over.
  assert.equal(dayTolerance(floored, { ...under, kcal: 1834 }).kcalOk, true);
  assert.equal(dayTolerance(floored, { ...under, kcal: 2100 }).kcalOk, false, "the ceiling is unchanged");
});

test("an unfloored target keeps the full ±10% band, and a target with no floor known is not given one", () => {
  // The common case: the floor sits well below the band, so it never binds.
  const roomy = { kcal: 2400, floorKcal: 1500, proteinLo: 180, proteinHi: 200, fatLo: 60, fatHi: 90, carbLo: 200, carbHi: 260 };
  assert.equal(dayTolerance(roomy, { kcal: 2160, protein: 185, fat: 75, carb: 220 }).kcalOk, true, "−10% exactly");
  assert.equal(dayTolerance(roomy, { kcal: 2159, protein: 185, fat: 75, carb: 220 }).kcalOk, false);

  // No floorKcal on the target ⇒ no floor is invented. Same rule as the absent
  // fat/carb bands: absent is absent.
  const unknown = { kcal: 2400, proteinLo: 180, proteinHi: 200, fatLo: 60, fatHi: 90, carbLo: 200, carbHi: 260 };
  const tol = dayTolerance(unknown, { kcal: 2160, protein: 185, fat: 75, carb: 220 });
  assert.equal(tol.kcalFloor, null);
  assert.equal(tol.kcalFloorBinding, false);
  assert.equal(tol.kcalOk, true);
});

// ── 2. the miss line says it out loud ─────────────────────────────────────

test("dayMissLine names the fat guardrail and carb floor misses with plain numbers", () => {
  const target = { ...T, goal: "muscle gain" };
  const line = dayMissLine(target, { kcal: 2000, protein: 150, fat: 25, carb: 100 });
  assert.ok(line, "a day outside fat/carb tolerance must not report a silent null");
  assert.match(line, /25 g fat vs a 33–78 g range — 8 g short/);
  assert.match(line, /100 g carbs vs 180 g floor — 80 g short/);
  assert.doesNotMatch(line, /kcal/);
  assert.doesNotMatch(line, /protein/);
});

test("dayMissLine keeps the no-guilt vocabulary on the new lines too (design law b)", () => {
  const target = { ...T, goal: "muscle gain" };
  const lines = [
    dayMissLine(target, { kcal: 2000, protein: 150, fat: 20, carb: 290 }),
    dayMissLine(target, { kcal: 2000, protein: 150, fat: 130, carb: 90 }),
    dayMissLine(target, { kcal: 1200, protein: 80, fat: 20, carb: 90 }),
  ];
  for (const line of lines) {
    assert.ok(line);
    assert.doesNotMatch(line, /fail|bad|wrong|blew|ruin|should|must/i, `guilt language in: ${line}`);
  }
});

test("a day inside all macro tolerances still states no miss at all", () => {
  assert.equal(dayMissLine(T, { kcal: 2000, protein: 150, fat: 67, carb: 200 }), null);
});

// ── 3. keto's carb ceiling is a law, not a preference ─────────────────────

test("KETO is exempt from the fat CEILING only — the floor still binds", () => {
  // Reproduced against the pre-fix source: computeMacros() prescribes 157–185 g
  // fat for this profile, and a day delivering 13 g (4.9 %E) graded green with
  // dayMissLine() returning null. `dailyTarget.keto` short-circuited the whole
  // guardrail, floor included, while the comment above it said "ceiling".
  const keto = { kcal: 2400, proteinLo: 181, proteinHi: 199, fatLo: 157, fatHi: 185, carbLo: 10, carbHi: 30, keto: true };
  const starved = { kcal: 2400, protein: 181, fat: 13, carb: 20 };
  assert.equal(dayTolerance(keto, starved).fatOk, false, "4.9 %E fat on a keto day is a miss, not the diet");
  assert.equal(dayInTolerance(dayTolerance(keto, starved)), false);
  assert.match(dayMissLine(keto, starved), /13 g fat vs a 40 g floor — 27 g short/);

  // The ceiling is still waived — that part is the diet's definition.
  const high = { kcal: 2400, protein: 181, fat: 160, carb: 20 }; // 60 %E
  assert.equal(dayTolerance(keto, high).fatOk, true, "high fat IS keto");
  // …and a non-keto target with the same numbers is over the ceiling.
  assert.equal(dayTolerance({ ...keto, keto: false }, high).fatOk, false);
});

test("a KETO target gets no upward allowance on carbs (the ceiling is a diet law)", () => {
  const keto = { kcal: 2000, proteinLo: 150, proteinHi: 170, fatLo: 130, fatHi: 160, carbLo: 20, carbHi: 30, keto: true };
  const overCeiling = { kcal: 2000, protein: 160, fat: 145, carb: 33 };
  assert.equal(dayTolerance(keto, overCeiling).carbOk, false, "3 g over a keto ceiling is over the ceiling");
  assert.match(dayMissLine(keto, overCeiling), /33 g carbs vs a 20–30 g range — 3 g over/);
  // The identical numbers on a NON-keto target are inside the ordinary slack.
  assert.equal(dayTolerance({ ...keto, keto: false }, overCeiling).carbOk, true);
  // Going UNDER on a keto target is still just the ordinary slack — a keto day
  // landing below its carb floor is not a diet violation.
  assert.equal(dayTolerance(keto, { kcal: 2000, protein: 160, fat: 145, carb: 18 }).carbOk, true);
});

// ── 4. absent bands are never invented ────────────────────────────────────

test("a target carrying no fat/carb band is not judged on one (honest absence)", () => {
  const partial = { kcal: 2000, proteinLo: 140, proteinHi: 160 };
  const tol = dayTolerance(partial, { kcal: 2000, protein: 150, fat: 50, carb: 0 });
  assert.equal(tol.fatJudged, false);
  assert.equal(tol.carbJudged, false);
  assert.equal(tol.fatOk, true, "within %E guardrail");
  assert.equal(tol.carbOk, true);
  assert.equal(dayInTolerance(tol), true);

  const partialShort = dayTolerance(partial, { kcal: 2000, protein: 150, fat: 0, carb: 0 });
  assert.equal(partialShort.fatOk, false, "0% E fat fails the guardrail even if fatLo/fatHi are missing");
});

// ── 5. the week report and the diagnosis carry it through ─────────────────

test("scoreWeek: a fat-starved day does not count toward daysInTolerance and carries a miss", () => {
  const slots = [
    // kcal + protein perfect, fat replaced by carbs.
    { dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: "a", kcal: 2000, protein: 150, fat: 25, carb: 275, ingredients: [], warning: null },
    // a genuinely clean day
    { dayOfWeek: 1, slotType: "meal", slotIndex: 0, recipeId: "b", kcal: 2000, protein: 150, fat: 67, carb: 200, ingredients: [], warning: null },
  ];
  const score = scoreWeek(T, slots);
  assert.equal(score.days[0].inTolerance, false, "the fat-starved day must not ship green");
  assert.equal(score.days[0].fatOk, false, "and the per-day row must publish WHICH macro failed");
  assert.match(score.days[0].miss, /25 g fat vs a 33–78 g range — 8 g short/);
  assert.equal(score.days[1].inTolerance, true);
  assert.equal(score.daysInTolerance, 1);
});

test("diagnoseFromResult names the fat/carb shortfall — never gated behind another reason", () => {
  const slots = [0, 1, 2].map((d) => ({
    dayOfWeek: d, slotType: "meal", slotIndex: 0, recipeId: "a",
    kcal: 2000, protein: 150, fat: 25, carb: 100, ingredients: [], warning: null,
  }));
  const pool = [{ id: "a", name: "Plate", slotType: "meal", mealCategory: null, kcal: 2000, protein: 150, fat: 25, carb: 100, ingredients: [] }];
  const target = { ...T, goal: "muscle gain" };
  const d = diagnoseFromResult({ dailyTarget: target, slots, pool, mealConfig: { meals: 1, snacks: 0 }, filters: {} });

  const fatReason = d.reasons.find((r) => /fat guardrail/.test(r));
  assert.ok(fatReason, `no fat reason in:\n${d.reasons.join("\n")}`);
  assert.match(fatReason, /3 day\(s\) landed outside the 15-35% fat guardrail/);
  assert.match(fatReason, /3 day\(s\) landed below your 180 g carb floor/);
  assert.ok(d.suggestions.some((s) => /macro you keep missing/.test(s)), "and it must offer something actionable");
  for (const s of d.suggestions) assert.doesNotMatch(s, /allerg/i);
});

test("diagnoseFromResult says nothing about fat/carbs when every day landed inside guardrails", () => {
  const slots = [0, 1].map((d) => ({
    dayOfWeek: d, slotType: "meal", slotIndex: 0, recipeId: "a",
    kcal: 1200, protein: 150, fat: 40, carb: 200, ingredients: [], warning: null, // kcal-short only, 40g fat = 30% of 1200 kcal
  }));
  const pool = [{ id: "a", name: "Plate", slotType: "meal", mealCategory: null, kcal: 1200, protein: 150, fat: 40, carb: 200, ingredients: [] }];
  const d = diagnoseFromResult({ dailyTarget: T, slots, pool, mealConfig: { meals: 1, snacks: 0 }, filters: {} });
  assert.ok(!d.reasons.some((r) => /fat guardrail|carb floor|carb range/.test(r)), `invented a fat/carb reason:\n${d.reasons.join("\n")}`);
  assert.ok(d.reasons.length > 0, "but the kcal miss still owes a reason");
});
