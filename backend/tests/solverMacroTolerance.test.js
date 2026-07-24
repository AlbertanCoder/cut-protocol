// solver-core-2 — FAT AND CARBS ARE FIRST-CLASS IN THE VERDICT, THE MISS
// LINE, AND THE DIAGNOSIS.
//
// The bug these lock down: scoreDay already computed fatInRange/carbInRange,
// but dayTolerance / dayMissLine / diagnoseFromResult were kcal + protein
// ONLY. A day that hit calories and protein while sitting far outside its fat
// range shipped as "in tolerance", with nothing on screen saying otherwise —
// the app prescribing a macro and then declining to report on it.
//
// (Related but NOT this: commit c2015b8's non-keto carb FLOOR changes what
// computeMacros TARGETS. This is about what the solver REPORTS.)
//
// Pure fixtures only — no DB, no clock, no network.
process.env.BRAIN = "off";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  dayTolerance, dayMissLine, dayInTolerance, scoreWeek, diagnoseFromResult,
  DAY_FAT_TOLERANCE_PCT, DAY_CARB_TOLERANCE_PCT,
} = require("../src/lib/mealSolver.js");

// 2,000 kcal, protein 140–160, fat 60–75 (mid 67.5), carbs 180–220 (mid 200).
const T = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 60, fatHi: 75, carbLo: 180, carbHi: 220 };

// ── 1. the headline property ──────────────────────────────────────────────

test("a day that meets kcal + protein but is badly short on FAT is NOT in tolerance", () => {
  // Calories and protein are exactly on target; the fat that should have been
  // there arrived as carbohydrate instead. Under the old rule this was green.
  const totals = { kcal: 2000, protein: 150, fat: 25, carb: 275 };
  const tol = dayTolerance(T, totals);
  assert.equal(tol.kcalOk, true, "calories are on target");
  assert.equal(tol.proteinOk, true, "protein is on target");
  assert.equal(tol.fatOk, false, "35 g under a 60–75 g range is not in tolerance");
  assert.equal(dayInTolerance(tol), false, "and therefore the DAY is not in tolerance");
});

test("a day that meets kcal + protein but is badly over on CARBS is NOT in tolerance", () => {
  const totals = { kcal: 2000, protein: 150, fat: 62, carb: 300 };
  const tol = dayTolerance(T, totals);
  assert.equal(tol.kcalOk, true);
  assert.equal(tol.proteinOk, true);
  assert.equal(tol.fatOk, true);
  assert.equal(tol.carbOk, false, "80 g over a 180–220 g range is not in tolerance");
  assert.equal(dayInTolerance(tol), false);
});

test("the fat/carb allowance is measured against the BAND MIDPOINT, and the boundary is exact", () => {
  // fat mid = 67.5, so the allowance is 67.5 × 0.25 = 16.875 g outside the band.
  const fatMid = (T.fatLo + T.fatHi) / 2;
  const slack = fatMid * DAY_FAT_TOLERANCE_PCT;
  const atEdge = { kcal: 2000, protein: 150, fat: T.fatLo - slack, carb: 200 };
  const pastEdge = { kcal: 2000, protein: 150, fat: T.fatLo - slack - 0.01, carb: 200 };
  assert.equal(dayTolerance(T, atEdge).fatOk, true, "exactly at the allowance is inside it");
  assert.equal(dayTolerance(T, pastEdge).fatOk, false, "a hair past it is not");

  const carbMid = (T.carbLo + T.carbHi) / 2;
  const carbSlack = carbMid * DAY_CARB_TOLERANCE_PCT;
  assert.equal(dayTolerance(T, { kcal: 2000, protein: 150, fat: 67, carb: T.carbHi + carbSlack }).carbOk, true);
  assert.equal(dayTolerance(T, { kcal: 2000, protein: 150, fat: 67, carb: T.carbHi + carbSlack + 0.01 }).carbOk, false);
});

test("inside the band is always inside tolerance, in both directions", () => {
  for (const fat of [T.fatLo, 67, T.fatHi]) {
    for (const carb of [T.carbLo, 200, T.carbHi]) {
      const tol = dayTolerance(T, { kcal: 2000, protein: 150, fat, carb });
      assert.equal(dayInTolerance(tol), true, `fat ${fat} / carb ${carb} sits inside both bands and must pass`);
    }
  }
});

// ── 2. the miss line says it out loud ─────────────────────────────────────

test("dayMissLine names the fat and carb misses with the range and the gram gap", () => {
  const line = dayMissLine(T, { kcal: 2000, protein: 150, fat: 25, carb: 275 });
  assert.ok(line, "a day outside fat/carb tolerance must not report a silent null");
  assert.match(line, /25 g fat vs a 60–75 g range — 35 g short/);
  assert.match(line, /275 g carbs vs a 180–220 g range — 55 g over/);
  // …and the kcal/protein lines stay silent, because those really were fine.
  assert.doesNotMatch(line, /kcal/);
  assert.doesNotMatch(line, /protein/);
});

test("dayMissLine keeps the no-guilt vocabulary on the new lines too (design law b)", () => {
  const lines = [
    dayMissLine(T, { kcal: 2000, protein: 150, fat: 20, carb: 290 }),
    dayMissLine(T, { kcal: 2000, protein: 150, fat: 130, carb: 90 }),
    dayMissLine(T, { kcal: 1200, protein: 80, fat: 20, carb: 90 }),
  ];
  for (const line of lines) {
    assert.ok(line);
    assert.doesNotMatch(line, /fail|bad|wrong|blew|ruin|should|must/i, `guilt language in: ${line}`);
  }
});

test("a day inside all four macro tolerances still states no miss at all", () => {
  assert.equal(dayMissLine(T, { kcal: 2000, protein: 150, fat: 67, carb: 200 }), null);
});

// ── 3. keto's carb ceiling is a law, not a preference ─────────────────────

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
  const tol = dayTolerance(partial, { kcal: 2000, protein: 150, fat: 0, carb: 0 });
  assert.equal(tol.fatJudged, false);
  assert.equal(tol.carbJudged, false);
  assert.equal(tol.fatOk, true, "unjudgeable is not a failure");
  assert.equal(tol.carbOk, true);
  assert.equal(dayInTolerance(tol), true);
  assert.equal(dayMissLine(partial, { kcal: 2000, protein: 150 }), null);
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
  assert.match(score.days[0].miss, /g fat vs a 60–75 g range/);
  assert.equal(score.days[1].inTolerance, true);
  assert.equal(score.daysInTolerance, 1);
});

test("diagnoseFromResult names the fat/carb shortfall — never gated behind another reason", () => {
  const slots = [0, 1, 2].map((d) => ({
    dayOfWeek: d, slotType: "meal", slotIndex: 0, recipeId: "a",
    kcal: 2000, protein: 150, fat: 25, carb: 275, ingredients: [], warning: null,
  }));
  const pool = [{ id: "a", name: "Carb Plate", slotType: "meal", mealCategory: null, kcal: 2000, protein: 150, fat: 25, carb: 275, ingredients: [] }];
  const d = diagnoseFromResult({ dailyTarget: T, slots, pool, mealConfig: { meals: 1, snacks: 0 }, filters: {} });

  const fatReason = d.reasons.find((r) => /fat range/.test(r));
  assert.ok(fatReason, `no fat reason in:\n${d.reasons.join("\n")}`);
  assert.match(fatReason, /3 day\(s\) landed outside your 60–75 g fat range/);
  assert.match(fatReason, /3 day\(s\) landed outside your 180–220 g carb range/);
  assert.ok(d.suggestions.some((s) => /macro you keep missing/.test(s)), "and it must offer something actionable");
  // The one rule that outranks everything here.
  for (const s of d.suggestions) assert.doesNotMatch(s, /allerg/i);
});

test("diagnoseFromResult says nothing about fat/carbs when every day landed inside both bands", () => {
  const slots = [0, 1].map((d) => ({
    dayOfWeek: d, slotType: "meal", slotIndex: 0, recipeId: "a",
    kcal: 1200, protein: 150, fat: 67, carb: 200, ingredients: [], warning: null, // kcal-short only
  }));
  const pool = [{ id: "a", name: "Plate", slotType: "meal", mealCategory: null, kcal: 1200, protein: 150, fat: 67, carb: 200, ingredients: [] }];
  const d = diagnoseFromResult({ dailyTarget: T, slots, pool, mealConfig: { meals: 1, snacks: 0 }, filters: {} });
  assert.ok(!d.reasons.some((r) => /fat range|carb range/.test(r)), `invented a fat/carb reason:\n${d.reasons.join("\n")}`);
  assert.ok(d.reasons.length > 0, "but the kcal miss still owes a reason");
});
