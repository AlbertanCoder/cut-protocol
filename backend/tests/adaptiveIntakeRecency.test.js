// ── Wave 6 · adaptive-tdee-1: no recency gate on intake ──────────────────
//
// THE BUG. Every pre-existing gate counted food-logged days across the whole
// look-back and none of them looked at WHEN those days were. So this shape got
// through: fresh daily weigh-ins + a food log that stopped two weeks ago. The
// estimator saw a falling scale, believed a stale (and typically low — it is
// the week the person was actually dieting AND logging) intake mean still
// described today, and returned expenditure = staleIntake − ρ·slope. That is a
// LOW expenditure, which becomes a LOW calorie target, and it arrived wearing a
// "confident" label.
//
// Undereating is the failure direction that hurts, so recency is a HARD gate:
// below the bar the estimator refuses to move the target at all and the target
// falls back to the formula, labelled honestly.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  estimateExpenditure, KCAL_PER_KG,
  robustWeightedFit, robustWeightedMean,
  HALF_LIFE_DAYS, MIN_WEIGHT_SCALE_KG, MIN_INTAKE_SCALE_KCAL,
  RECENT_WINDOW_DAYS, MIN_RECENT_INTAKE_DAYS, MAX_INTAKE_STALE_DAYS,
  CONFIDENT_INTAKE_STALE_DAYS, CONFIDENT_RECENT_INTAKE_DAYS,
} = require("../src/lib/expenditureEstimator.js");
const { resolveAppliedTarget } = require("../src/lib/adaptiveTarget.js");
const { addDays, dayNum } = require("../src/lib/dates.js");

/**
 * `intakeStopsDaysAgo` is the whole point: weigh-ins always run to `asOf`, the
 * food log stops early. Test data only, never an app default.
 */
function makeHistory({
  asOf = "2026-06-30", days = 56, startKg = 98,
  trueExpenditure = 3100, intakeKcal = 2300,
  intakeStopsDaysAgo = 0, logSkip = null,
} = {}) {
  const weighins = [], intake = [];
  let mass = startKg;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    mass += (intakeKcal - trueExpenditure) / KCAL_PER_KG;
    weighins.push({ date, weightKg: mass });
    if (i >= intakeStopsDaysAgo && !(logSkip && logSkip(days - 1 - i))) {
      intake.push({ date, kcal: intakeKcal });
    }
  }
  return { weighins, intake, asOf };
}

const PROFILE = {
  sex: "M", age: 34, heightCm: 180, bodyFatPct: 22,
  occupationKey: "desk-office", activityOverride: null,
  sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
  rateLbPerWeek: 1.0, floorKcal: null, excludedFormulas: [],
  startWeightKg: 98, startDate: "2026-05-01", targetKcal: 0,
};

// ── the thresholds are explicit and exported, not folklore ───────────────

test("the recency thresholds are declared in code and published in the method block", () => {
  assert.equal(RECENT_WINDOW_DAYS, 14);
  assert.equal(MIN_RECENT_INTAKE_DAYS, 8);
  assert.equal(MAX_INTAKE_STALE_DAYS, 4);
  assert.equal(CONFIDENT_INTAKE_STALE_DAYS, 2);
  assert.equal(CONFIDENT_RECENT_INTAKE_DAYS, 11);
  const h = makeHistory({ days: 40 });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.method.gates.recentWindowDays, RECENT_WINDOW_DAYS);
  assert.equal(r.method.gates.minRecentIntakeDays, MIN_RECENT_INTAKE_DAYS);
  assert.equal(r.method.gates.maxIntakeStaleDays, MAX_INTAKE_STALE_DAYS);
});

// ── the regression itself ────────────────────────────────────────────────

test("REGRESSION (adaptive-tdee-1): fresh weigh-ins + a stale food log no longer move the target", () => {
  // 56 days of daily weigh-ins; the food log stops 14 days before today. Every
  // volume gate still passes — 42 logged days, 75% whole-window coverage — and
  // that is exactly why the volume gates alone were not enough.
  const h = makeHistory({ days: 56, intakeStopsDaysAgo: 14, trueExpenditure: 3100, intakeKcal: 2300 });
  assert.equal(h.intake.length, 42, "fixture must still clear the volume gates");
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });

  assert.equal(r.applied, false, "a stale food log must not be allowed to set a calorie target");
  assert.equal(r.status, "insufficient");
  assert.equal(r.estimate, null);
  assert.ok(
    r.reasons.some((x) => /last full day of food logged was 14 days ago/.test(x)),
    r.reasons.join(" | ")
  );
  // and it names the danger in plain words rather than just refusing
  assert.ok(r.reasons.some((x) => /lower burn than it is/.test(x)), r.reasons.join(" | "));
});

test("REGRESSION (adaptive-tdee-1): the stale-log target falls back to the FORMULA, never below it", () => {
  const stale = makeHistory({ days: 56, intakeStopsDaysAgo: 14, trueExpenditure: 3100, intakeKcal: 2300 });
  const r = resolveAppliedTarget({ profile: PROFILE, weighins: stale.weighins, intake: stale.intake, asOf: stale.asOf });
  assert.equal(r.applied, false);
  assert.equal(r.tdeeSource, "formula");
  assert.equal(r.indicatedTarget.target, r.formulaTarget.target, "with the estimator withheld, the indicated target IS the formula target");
  // The step cap is walking the previously-adjusted target back to the formula.
  // While it does, it holds the user ABOVE the formula target, never below —
  // undereating is the direction that hurts, so the cap must not create it.
  assert.ok(r.target.target >= r.formulaTarget.target,
    `applied ${r.target.target} must not sit below the formula target ${r.formulaTarget.target}`);
  assert.ok(r.target.target >= r.target.floor);
  assert.equal(r.adaptive.confidence.measured, false);
  assert.equal(r.adaptive.confidence.basis, "formula-only");
});

test("REGRESSION (adaptive-tdee-1): the INCIDENT shape — logging stops, eating rebounds, scale flattens", () => {
  // Five weeks of dieting at a logged 1,800 kcal, then logging stops and eating
  // rebounds. The scale flattens. The only intake the app can see is the old
  // low number, so an intake-believing estimator concludes this person burns
  // far less than the formula says — and hands them an even lower target.
  const asOf = "2026-06-30", days = 56, stopDaysAgo = 21;
  const weighins = [], intake = [];
  let mass = 98;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    const stopped = i < stopDaysAgo;
    mass += ((stopped ? 3600 : 1800) - 3000) / KCAL_PER_KG;
    weighins.push({ date, weightKg: mass });
    if (!stopped) intake.push({ date, kcal: 1800 });
  }

  // The volume gates are all satisfied — 35 logged days, 63% whole-window
  // coverage, a weigh-in this morning. Only recency separates this from a good
  // window, which is the whole finding.
  const priorTdee = 2505;
  const r = estimateExpenditure({ weighins, intake, asOf, priorTdee });
  assert.equal(r.window.completeIntakeDays, 35);
  assert.ok(r.window.effectiveCoveragePct >= 60, `coverage ${r.window.effectiveCoveragePct}%`);
  assert.equal(r.window.staleDays, 0, "the scale is current");
  assert.equal(r.window.intakeStaleDays, stopDaysAgo);

  // What the withheld number WOULD have been: the estimator's own energy
  // balance, expenditure = mean logged intake − ρ × weight slope, computed with
  // the estimator's own primitives on exactly this data.
  const asOfDay = dayNum(asOf);
  const fit = robustWeightedFit(weighins.map((w) => ({ x: dayNum(w.date), y: w.weightKg })),
    { refX: asOfDay, halfLife: HALF_LIFE_DAYS, minScale: MIN_WEIGHT_SCALE_KG });
  const im = robustWeightedMean(intake.map((d) => ({ x: dayNum(d.date), y: d.kcal })),
    { refX: asOfDay, halfLife: HALF_LIFE_DAYS, minScale: MIN_INTAKE_SCALE_KCAL });
  const wouldBe = im.mean - KCAL_PER_KG * fit.slope;
  assert.ok(wouldBe < priorTdee - 250,
    `the withheld estimate is ${Math.round(wouldBe)} against a ${priorTdee} formula — it must be materially LOW for this test to mean anything`);

  // And it is withheld.
  assert.equal(r.applied, false);
  assert.equal(r.status, "insufficient");
  assert.equal(r.estimate, null);
  assert.ok(r.reasons.some((x) => /out-of-date food log/.test(x)), r.reasons.join(" | "));
});

test("a stale log walks the target back UP to the formula and stops there", () => {
  // Weigh-ins keep coming; the food log stays dead. The previously-adjusted
  // target must converge back to the formula target, from above, and settle.
  const asOf = "2026-08-25", days = 112;
  const weighins = [], intake = [];
  let mass = 98;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    mass += (2300 - 3100) / KCAL_PER_KG;
    weighins.push({ date, weightKg: mass });
    if (i >= 56) intake.push({ date, kcal: 2300 }); // log died 8 weeks ago
  }
  const r = resolveAppliedTarget({ profile: PROFILE, weighins, intake, asOf });
  assert.equal(r.applied, false);
  assert.equal(r.target.target, r.formulaTarget.target, "given enough cycles the walk lands exactly on the formula target");
  assert.equal(r.stepCap.capped, false);
  assert.equal(r.stepCap.remainingKcal, 0);
});

test("the same history WITH a current log does move the target — the gate is recency, not paranoia", () => {
  const fresh = makeHistory({ days: 56, intakeStopsDaysAgo: 0, trueExpenditure: 3100, intakeKcal: 2300 });
  const r = estimateExpenditure({ ...fresh, priorTdee: 2900 });
  assert.equal(r.applied, true);
  assert.equal(r.window.intakeStaleDays, 0);
  assert.equal(r.window.lastIntakeDate, fresh.asOf);
});

test("the staleness gate trips exactly at MAX_INTAKE_STALE_DAYS, not a day before", () => {
  const ok = estimateExpenditure({ ...makeHistory({ days: 56, intakeStopsDaysAgo: MAX_INTAKE_STALE_DAYS }), priorTdee: 2900 });
  assert.equal(ok.window.intakeStaleDays, MAX_INTAKE_STALE_DAYS);
  assert.equal(ok.applied, true, "a log exactly at the bar is still allowed");

  const over = estimateExpenditure({ ...makeHistory({ days: 56, intakeStopsDaysAgo: MAX_INTAKE_STALE_DAYS + 1 }), priorTdee: 2900 });
  assert.equal(over.window.intakeStaleDays, MAX_INTAKE_STALE_DAYS + 1);
  assert.equal(over.applied, false, "one day past the bar blocks");
});

test("sporadic recent logging is blocked too — currency is about coverage as well as the last date", () => {
  // Logs yesterday (so staleness passes) but only ~1 day in 4 for the last
  // fortnight: 4 of 14, under the 8-day floor.
  const h = makeHistory({
    days: 56, trueExpenditure: 3100, intakeKcal: 2300,
    logSkip: (t) => t >= 56 - RECENT_WINDOW_DAYS && (56 - 1 - t) % 4 !== 1,
  });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.ok(r.window.intakeStaleDays <= MAX_INTAKE_STALE_DAYS, `staleness ${r.window.intakeStaleDays} should pass`);
  assert.ok(r.window.recentIntakeDays < MIN_RECENT_INTAKE_DAYS, `recent days ${r.window.recentIntakeDays}`);
  assert.equal(r.applied, false);
  assert.ok(r.reasons.some((x) => /in the last 14/.test(x)), r.reasons.join(" | "));
});

test("ordinary weekend gaps still pass — this gate catches 'stopped', not 'imperfect'", () => {
  // Both weekends off in the trailing fortnight: 10 of 14 logged.
  const asOf = "2026-06-30";
  const h = makeHistory({
    days: 56, asOf, trueExpenditure: 3100, intakeKcal: 2300,
    logSkip: (t) => {
      const d = new Date(addDays(asOf, -(56 - 1 - t)) + "T12:00:00").getDay();
      return d === 0 || d === 6;
    },
  });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.ok(r.window.recentIntakeDays >= MIN_RECENT_INTAKE_DAYS, `recent ${r.window.recentIntakeDays}`);
  assert.equal(r.applied, true, `weekends off must not blank the estimate: ${r.reasons.join(" | ")}`);
});

// ── the label, not just the number ───────────────────────────────────────

test("'confident' now requires a CURRENT log — a 3-day-old one is held provisional", () => {
  const h = makeHistory({ days: 56, intakeStopsDaysAgo: CONFIDENT_INTAKE_STALE_DAYS + 1, trueExpenditure: 3100, intakeKcal: 2300 });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.applied, true, "still inside the hard gate");
  assert.equal(r.status, "provisional", "but not confident — the log is 3 days behind");
  assert.ok(r.notes.some((n) => /3 days old/.test(n)), r.notes.join(" | "));
  const fresh = estimateExpenditure({ ...makeHistory({ days: 56, trueExpenditure: 3100, intakeKcal: 2300 }), priorTdee: 2900 });
  assert.equal(fresh.status, "confident", "the identical history with a current log IS confident");
});

test("the confidence block never dresses a formula fallback up as a measurement", () => {
  const stale = estimateExpenditure({ ...makeHistory({ days: 56, intakeStopsDaysAgo: 20 }), priorTdee: 2900 });
  assert.equal(stale.confidence.level, "insufficient");
  assert.equal(stale.confidence.measured, false);
  assert.equal(stale.confidence.basis, "formula-only");
  assert.match(stale.confidence.label, /straight from the formula/i);

  const good = estimateExpenditure({ ...makeHistory({ days: 56 }), priorTdee: 2900 });
  assert.equal(good.confidence.measured, true);
  assert.equal(good.confidence.basis, "logged-intake-vs-weight-trend");
  assert.equal(good.confidence.intakeCurrentThrough, "2026-06-30");
});

test("the window block SHOWS the recency numbers — a reader can tell current from abandoned", () => {
  const h = makeHistory({ days: 56, intakeStopsDaysAgo: 9 });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.window.recentWindowDays, RECENT_WINDOW_DAYS);
  assert.equal(r.window.intakeStaleDays, 9);
  assert.equal(r.window.lastIntakeDate, addDays(h.asOf, -9));
  assert.equal(r.window.recentIntakeDays, 5, "days 9..13 back are the only recent logged ones");
  assert.equal(r.window.recentCoveragePct, Math.round((5 / 14) * 100));
  // whole-window coverage is still HIGH — which is precisely why it was not enough
  assert.ok(r.window.effectiveCoveragePct >= 60, `whole-window coverage ${r.window.effectiveCoveragePct}%`);
});

test("a part-logged day does not count as evidence the log is current", () => {
  // Log runs to today, but the last 3 days are 300-kcal partials: the newest
  // COMPLETE day is 3 days back, so the estimate drops to provisional.
  const h = makeHistory({ days: 56, trueExpenditure: 3100, intakeKcal: 2300 });
  const cut = dayNum(h.asOf) - 2;
  for (const row of h.intake) if (dayNum(row.date) >= cut) row.kcal = 300;
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.window.partialDays, 3);
  assert.equal(r.window.intakeStaleDays, 3, "recency is measured on COMPLETE days only");
  assert.equal(r.status, "provisional");
});
