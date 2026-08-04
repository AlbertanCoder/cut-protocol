// solver-core-2 / goal-ruler (2026-08-03) — FAT AND CARBS ARE FIRST-CLASS IN THE VERDICT.
//
// The goal ruler:
// Kcal:    ±10%, and never below the target's safety floor
// Protein: floor only (>= proteinLo); a target without one is not judged on it
// Fat:     20–35 %E, floored at the target's essential fatFloorG.
//          KETO is exempt from the CEILING only — the floor still binds.
// Carbs:   not graded as a target. Two floors survive: keto's carb ceiling
//          (a diet law) and the non-keto anti-ketosis floor (50 g, capped at
//          the target's own carbMid so it never demands more than was prescribed).

process.env.BRAIN = "off";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  dayTolerance, dayMissLine, dayInTolerance, scoreWeek, diagnoseFromResult,
  DAY_FAT_TOLERANCE_PCT, DAY_CARB_TOLERANCE_PCT,
} = require("../src/lib/mealSolver.js");

// 2,000 kcal, protein 140–160, fat 60–75 (mid 67.5), carbs 180–220 (mid 200).
// carbMid 200 => the anti-ketosis floor binds at min(50, 200) = 50 g.
const T = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 60, fatHi: 75, carbLo: 180, carbMid: 200, carbHi: 220 };

// ── 1. the headline property ──────────────────────────────────────────────

test("a day that meets kcal + protein but is badly short on FAT is NOT in tolerance", () => {
  // Below 20 %E is a miss. 20% of 2,000 kcal is 400 kcal = 44.4 g.
  const totals = { kcal: 2000, protein: 150, fat: 25, carb: 275 };
  const tol = dayTolerance(T, totals);
  assert.equal(tol.kcalOk, true, "calories are on target");
  assert.equal(tol.proteinOk, true, "protein is on target");
  assert.equal(tol.fatOk, false, "25 g fat is below the 20 %E guardrail");
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

test("a NON-KETO day below the anti-ketosis floor is a miss, however the calories land", () => {
  // Measured: 20 green non-keto days under 50 g carbs across lean/heavy profiles
  // at aggressive deficits — protein at its floor and fat at the 35 %E ceiling
  // squeeze the remainder toward zero, which is bmrEngine's stated reason for
  // NONKETO_CARB_FLOOR_G. The verdict has to grade against the same number or
  // the app ships exactly the day the engine refused to prescribe.
  const ketogenic = { kcal: 2000, protein: 150, fat: 62, carb: 37 };
  const tol = dayTolerance(T, ketogenic);
  assert.equal(tol.kcalOk, true, "calories are on target");
  assert.equal(tol.proteinOk, true);
  assert.equal(tol.fatOk, true, "and the fat share is fine — nothing else catches this");
  assert.equal(tol.carbOk, false, "37 g on a non-keto plan is a silently ketogenic day");
  assert.equal(dayInTolerance(tol), false);
  assert.equal(dayTolerance(T, { ...ketogenic, carb: 50 }).carbOk, true);
});

test("the anti-ketosis floor never demands more carbs than the target could prescribe", () => {
  // bmrEngine squeezes carbMid BELOW its own 50 g floor for a lean, heavy,
  // floor-clamped profile — it surfaces that as carbFloored + macroKcalGap. The
  // day then owes what was prescribed, not 50, or the verdict would fail a day
  // for missing a number the engine never asked it to hit.
  const squeezed = { ...T, carbLo: 17, carbMid: 29, carbHi: 41 };
  assert.equal(dayTolerance(squeezed, { kcal: 2000, protein: 150, fat: 62, carb: 29 }).carbFloorG, 29);
  assert.equal(dayTolerance(squeezed, { kcal: 2000, protein: 150, fat: 62, carb: 29 }).carbOk, true);
  assert.equal(dayTolerance(squeezed, { kcal: 2000, protein: 150, fat: 62, carb: 28 }).carbOk, false);
});

test("KETO is judged on its ceiling, never on the non-keto carb floor", () => {
  // 25 g is the whole point of the diet there. Applying a 50 g floor to a keto
  // target would fail every compliant keto day.
  const keto = { kcal: 2000, proteinLo: 150, proteinHi: 170, fatLo: 130, fatHi: 160, carbLo: 10, carbMid: 25, carbHi: 30, keto: true };
  const tol = dayTolerance(keto, { kcal: 2000, protein: 160, fat: 145, carb: 25 });
  assert.equal(tol.carbFloorG, null, "no anti-ketosis floor on a ketogenic target");
  assert.equal(tol.carbOk, true);
});

test("the fat allowance is a 20–35 %E guardrail measured on the day's ACTUAL kcal", () => {
  // At 2000 kcal: 20% is 400 kcal (44.4 g fat), 35% is 700 kcal (77.7 g fat).
  // Literal grams on purpose — computing the edge from the constant under test
  // makes an assertion that passes at any value of it.
  const lowFat = { kcal: 2000, protein: 150, fat: 44, carb: 200 };  // 19.8%
  const okFatLo = { kcal: 2000, protein: 150, fat: 45, carb: 200 }; // 20.3%
  const okFatHi = { kcal: 2000, protein: 150, fat: 77, carb: 200 }; // 34.7%
  const hiFat = { kcal: 2000, protein: 150, fat: 78, carb: 200 };   // 35.1%
  assert.equal(dayTolerance(T, lowFat).fatOk, false, "below 20 %E is a miss");
  assert.equal(dayTolerance(T, okFatLo).fatOk, true);
  assert.equal(dayTolerance(T, okFatHi).fatOk, true);
  assert.equal(dayTolerance(T, hiFat).fatOk, false, "above 35 %E is a miss");
  // 15 %E used to pass here. The grader must not bless what the engine would
  // never prescribe — fatPrescriptionDrift.test.js asserts 20–35 on the target.
  assert.equal(dayTolerance(T, { kcal: 2000, protein: 150, fat: 35, carb: 200 }).fatOk, false, "15.8 %E is no longer inside the guardrail");
});

test("the target's essential-fat floor binds even when the %E share clears", () => {
  // Reproduced on a real target: M/40/178cm/20%BF/90.7kg @ 2,000 kcal prescribes
  // fatFloorG = 48 g. A 44 g day is 19.8 %E — and even at a 20 %E floor the share
  // edge is only 44.4 g, so the share alone still passes it 4 g under essential
  // fat. `fatFloorG` appeared in mealSolver.js exactly once before this: inside a
  // comment claiming it still bound.
  const withFloor = { ...T, fatFloorG: 48 };
  const under = { kcal: 2000, protein: 150, fat: 46, carb: 200 }; // 20.7 %E — share is fine
  assert.equal(dayTolerance(T, under).fatOk, true, "no floor published ⇒ judged on the share alone");
  assert.equal(dayTolerance(withFloor, under).fatOk, false, "46 g is under the 48 g essential floor");
  assert.equal(dayTolerance(withFloor, under).fatLoEdgeG, 48, "the higher of the two floors is the edge");
  assert.match(dayMissLine(withFloor, under), /46 g fat vs a 48–78 g range — 2 g short/);
  assert.equal(dayTolerance(withFloor, { ...under, fat: 48 }).fatOk, true);
});

test("inside the guardrail is always inside tolerance, in both directions", () => {
  const target = { ...T };
  for (const fat of [45, 50, 77]) { // 20.3 %E … 34.7 %E at 2,000 kcal
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
  const target = { ...T };
  const line = dayMissLine(target, { kcal: 2000, protein: 150, fat: 25, carb: 30 });
  assert.ok(line, "a day outside fat/carb tolerance must not report a silent null");
  assert.match(line, /25 g fat vs a 44–78 g range — 19 g short/);
  assert.match(line, /30 g carbs vs 50 g floor — 20 g short/);
  assert.doesNotMatch(line, /kcal/);
  assert.doesNotMatch(line, /protein/);
});

test("dayMissLine keeps the no-guilt vocabulary on the new lines too (design law b)", () => {
  const target = { ...T };
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
  assert.match(dayMissLine(keto, starved), /13 g fat vs a 53 g floor — 40 g short/);

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

test("a target carrying no protein floor is not judged on one, and never renders NaN", () => {
  // `150 >= undefined` is false, so a partial target FAILED on protein and then
  // rendered "150 g protein vs NaN g floor — NaN g short". The rule this replaced
  // (shortfall against the band midpoint) failed safe on the same input.
  const noFloor = { kcal: 2000, fatLo: 60, fatHi: 75, carbLo: 180, carbHi: 220 };
  const day = { kcal: 2000, protein: 150, fat: 62, carb: 200 };
  assert.equal(dayTolerance(noFloor, day).proteinOk, true, "absent is absent — not a silent fail");
  assert.equal(dayMissLine(noFloor, day), null);

  // Nothing the app can render may contain NaN, whichever way the verdict lands.
  for (const partial of [{ kcal: 2000 }, { kcal: 2000, proteinLo: null }, { kcal: 2000, proteinHi: 160 }]) {
    const line = dayMissLine(partial, { kcal: 1200, protein: 40, fat: 20, carb: 100 }) || "";
    assert.doesNotMatch(line, /NaN/, `NaN reached the miss line: ${line}`);
  }

  // A real floor still binds, and still says so.
  const withFloor = { ...noFloor, proteinLo: 180, proteinHi: 200 };
  assert.equal(dayTolerance(withFloor, day).proteinOk, false);
  assert.match(dayMissLine(withFloor, day), /150 g protein vs 180 g floor — 30 g short/);
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
  assert.match(score.days[0].miss, /25 g fat vs a 44–78 g range — 19 g short/);
  assert.equal(score.days[1].inTolerance, true);
  assert.equal(score.daysInTolerance, 1);
});

test("diagnoseFromResult names the fat/carb shortfall — never gated behind another reason", () => {
  const slots = [0, 1, 2].map((d) => ({
    dayOfWeek: d, slotType: "meal", slotIndex: 0, recipeId: "a",
    kcal: 2000, protein: 150, fat: 25, carb: 30, ingredients: [], warning: null,
  }));
  const pool = [{ id: "a", name: "Plate", slotType: "meal", mealCategory: null, kcal: 2000, protein: 150, fat: 25, carb: 30, ingredients: [] }];
  const target = { ...T };
  const d = diagnoseFromResult({ dailyTarget: target, slots, pool, mealConfig: { meals: 1, snacks: 0 }, filters: {} });

  const fatReason = d.reasons.find((r) => /fat guardrail/.test(r));
  assert.ok(fatReason, `no fat reason in:\n${d.reasons.join("\n")}`);
  assert.match(fatReason, /3 day\(s\) landed outside the 20-35% fat guardrail/);
  assert.match(fatReason, /3 day\(s\) landed below the 50 g carb floor a non-keto plan holds/);
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
