const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  estimateExpenditure, robustWeightedFit, robustWeightedMean, madScale,
  KCAL_PER_KG, PRIOR_SD_KCAL, MIN_SPAN_DAYS, MIN_WEIGHINS, MIN_INTAKE_DAYS,
  MAX_STALE_DAYS, MAX_DEVIATION_FRAC, MISSING_DAY_BIAS_KCAL, HALF_LIFE_DAYS,
  MODEL_ERROR_KCAL, lag1Autocorr,
} = require("../src/lib/expenditureEstimator.js");
const { buildLedger, resolveEnergy, weightNowKgAt, adaptiveEnabled } = require("../src/lib/adaptiveTarget.js");
const { addDays, dayNum } = require("../src/lib/dates.js");

// ── deterministic fixture builder ────────────────────────────────────────
// A synthetic history with a KNOWN true expenditure, built from a seeded LCG so
// every assertion below is reproducible. This is test data, never an app default.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}
// Box–Muller from the LCG.
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Builds `days` of history ending on `asOf` for a person whose real burn is
 * `trueExpenditure` and who really eats `intakeKcal` per day.
 */
function makeHistory({
  asOf = "2026-06-30", days = 35, startKg = 95, trueExpenditure = 2900,
  intakeKcal = 2400, weightNoiseKg = 0, seed = 7,
  weighinEveryDay = true, logEveryDay = true, reportFactor = 1,
} = {}) {
  const rnd = lcg(seed);
  const weighins = [], intake = [];
  let mass = startKg;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    mass += (intakeKcal - trueExpenditure) / KCAL_PER_KG;
    if (weighinEveryDay || i % 2 === 0) {
      weighins.push({ date, weightKg: mass + (weightNoiseKg ? gauss(rnd) * weightNoiseKg : 0) });
    }
    if (logEveryDay) intake.push({ date, kcal: Math.round(intakeKcal * reportFactor) });
  }
  return { weighins, intake, asOf };
}

// ── the core claim: it reconciles intake vs weight, not a point weight ────

test("recovers a known expenditure from noise-free intake + weight history", () => {
  const h = makeHistory({ trueExpenditure: 2900, intakeKcal: 2400, days: 35 });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.status, "confident");
  assert.ok(Math.abs(r.estimate.dataKcal - 2900) < 15, `raw data estimate ${r.estimate.dataKcal} !≈ 2900`);
  assert.ok(Math.abs(r.estimate.expenditureKcal - 2900) < 20, `posterior ${r.estimate.expenditureKcal} !≈ 2900`);
});

test("finds an expenditure the FORMULA got wrong — this is what a point-weight substitution cannot do", () => {
  // The formula says 2500. The person actually burns 3000 and the scale proves
  // it: eating 2400 they lose ~0.6 lb/wk MORE than 2500 would predict.
  const h = makeHistory({ trueExpenditure: 3000, intakeKcal: 2400, days: 42 });
  const r = estimateExpenditure({ ...h, priorTdee: 2500 });
  assert.equal(r.status, "confident");
  assert.ok(r.estimate.dataKcal > 2950 && r.estimate.dataKcal < 3050, `data estimate ${r.estimate.dataKcal}`);
  // Posterior is pulled toward the prior, but must land far closer to truth.
  assert.ok(Math.abs(r.estimate.expenditureKcal - 3000) < Math.abs(2500 - 3000) * 0.35,
    `posterior ${r.estimate.expenditureKcal} did not move most of the way to 3000`);
  assert.ok(r.estimate.deltaVsFormulaKcal > 300, "adjustment should be a large upward move");
});

test("the reconciliation block is predicted-vs-actual, and its gap equals the correction", () => {
  const h = makeHistory({ trueExpenditure: 3000, intakeKcal: 2400, days: 42 });
  const r = estimateExpenditure({ ...h, priorTdee: 2500 });
  const rec = r.reconciliation;
  // Formula predicted a 100 kcal/day deficit; reality ran a 600 kcal/day one.
  assert.ok(rec.predictedDeltaKg < 0 && rec.observedDeltaKg < 0);
  assert.ok(rec.observedDeltaKg < rec.predictedDeltaKg, "actual loss must exceed predicted loss");
  assert.ok(Math.abs(rec.gapKcalPerDay - (r.estimate.dataKcal - rec.formulaTdeeKcal)) <= 2,
    "gap kcal/day must equal (data estimate − formula TDEE)");
  // and the arithmetic is literally intake − ρ·slope
  const hand = rec.meanIntakeKcal - KCAL_PER_KG * r.weight.slopeKgPerDay;
  assert.ok(Math.abs(hand - r.estimate.dataKcal) < 3, `${hand} !≈ ${r.estimate.dataKcal}`);
});

test("weight gain reads as expenditure BELOW intake (sign convention holds both ways)", () => {
  const h = makeHistory({ trueExpenditure: 2200, intakeKcal: 2800, days: 35 });
  const r = estimateExpenditure({ ...h, priorTdee: 2200 });
  assert.ok(r.weight.slopeKgPerDay > 0, "gaining");
  assert.ok(r.weight.slopeLbPerWeek < 0, "lb/wk is reported as loss-positive");
  assert.ok(Math.abs(r.estimate.dataKcal - 2200) < 20);
});

// ── honesty gates ────────────────────────────────────────────────────────

test("says INSUFFICIENT rather than guessing when the window is too short", () => {
  const h = makeHistory({ days: MIN_SPAN_DAYS - 3 });
  const r = estimateExpenditure({ ...h, priorTdee: 2800 });
  assert.equal(r.status, "insufficient");
  assert.equal(r.applied, false);
  assert.equal(r.estimate, null);
  assert.ok(r.reasons.some((x) => /day/.test(x)), r.reasons.join(" | "));
});

test("says INSUFFICIENT with plenty of weigh-ins but almost no food logged", () => {
  const h = makeHistory({ days: 35, logEveryDay: false });
  h.intake = h.intake || [];
  const r = estimateExpenditure({ weighins: h.weighins, intake: [], asOf: h.asOf, priorTdee: 2800 });
  assert.equal(r.status, "insufficient");
  assert.ok(r.reasons.some((x) => /food logged/.test(x)), r.reasons.join(" | "));
  assert.equal(r.intake, null);
});

test("says INSUFFICIENT with a full food log but too few weigh-ins", () => {
  const h = makeHistory({ days: 35 });
  const thin = h.weighins.filter((_, i) => i % 6 === 0).slice(0, MIN_WEIGHINS - 4);
  const r = estimateExpenditure({ weighins: thin, intake: h.intake, asOf: h.asOf, priorTdee: 2800 });
  assert.equal(r.status, "insufficient");
  assert.ok(r.reasons.some((x) => /weigh-in/.test(x)), r.reasons.join(" | "));
});

test("a stale scale blocks the estimate — an old weight cannot describe today", () => {
  const h = makeHistory({ days: 45 });
  const cut = dayNum(h.asOf) - (MAX_STALE_DAYS + 4);
  const stale = h.weighins.filter((w) => dayNum(w.date) <= cut);
  const r = estimateExpenditure({ weighins: stale, intake: h.intake, asOf: h.asOf, priorTdee: 2800 });
  assert.equal(r.status, "insufficient");
  assert.ok(r.reasons.some((x) => /last weigh-in/.test(x)), r.reasons.join(" | "));
});

test("insufficient results still SHOW what data exists — no blank screen", () => {
  const h = makeHistory({ days: 10 });
  const r = estimateExpenditure({ ...h, priorTdee: 2800 });
  assert.equal(r.status, "insufficient");
  assert.ok(r.window.spanDays > 0);
  assert.ok(r.window.weighinCount > 0);
  assert.ok(r.method.gates.minSpanDays === MIN_SPAN_DAYS);
});

// ── noise handling ───────────────────────────────────────────────────────

test("unlogged days are NEVER treated as zero-calorie days", () => {
  const full = makeHistory({ days: 35, trueExpenditure: 2900, intakeKcal: 2400 });
  const sparse = { ...full, intake: full.intake.filter((_, i) => i % 4 !== 0) }; // 75% coverage
  const r = estimateExpenditure({ ...sparse, priorTdee: 2900 });
  // Mean intake must stay ~2400, not fall toward 1800 (which zero-filling gives).
  assert.ok(Math.abs(r.intake.meanKcal - 2400) < 25, `mean intake ${r.intake.meanKcal}`);
  // But the missing quarter is charged as uncertainty, not ignored.
  assert.ok(r.estimate.seBudget.unloggedDaysKcal > 100, "missing days must widen the error bar");
  assert.ok(r.estimate.dataSeKcal > estimateExpenditure({ ...full, priorTdee: 2900 }).estimate.dataSeKcal);
});

test("thinner coverage shrinks the estimate harder toward the formula", () => {
  const full = makeHistory({ days: 35, trueExpenditure: 3200, intakeKcal: 2400 });
  const sparse = { ...full, intake: full.intake.filter((_, i) => i % 3 !== 0) }; // ~67%
  const a = estimateExpenditure({ ...full, priorTdee: 2700 });
  const b = estimateExpenditure({ ...sparse, priorTdee: 2700 });
  assert.ok(b.estimate.dataWeightPct < a.estimate.dataWeightPct, "less data must mean less influence");
  assert.ok(Math.abs(b.estimate.deltaVsFormulaKcal) < Math.abs(a.estimate.deltaVsFormulaKcal));
});

test("a partial-log day is flagged and discounted, not believed", () => {
  const h = makeHistory({ days: 35, trueExpenditure: 2900, intakeKcal: 2400 });
  h.intake[h.intake.length - 3].kcal = 300; // logged breakfast, forgot the rest
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.window.partialDays, 1);
  assert.ok(r.notes.some((n) => /under half/.test(n)), r.notes.join(" | "));
  // The robust mean must not collapse toward the bad day.
  assert.ok(Math.abs(r.intake.meanKcal - 2400) < 40, `mean intake ${r.intake.meanKcal}`);
});

test("a single water-weight spike is down-weighted, not deleted, and barely moves the answer", () => {
  const clean = makeHistory({ days: 35, trueExpenditure: 2900, intakeKcal: 2400 });
  const spiked = { ...clean, weighins: clean.weighins.map((w, i) => (i === 28 ? { ...w, weightKg: w.weightKg + 2.2 } : w)) };
  const a = estimateExpenditure({ ...clean, priorTdee: 2900 });
  const b = estimateExpenditure({ ...spiked, priorTdee: 2900 });
  assert.ok(b.notes.some((n) => /off the trend/.test(n)), b.notes.join(" | "));
  assert.ok(Math.abs(b.estimate.expenditureKcal - a.estimate.expenditureKcal) < 120,
    `a 2.2 kg sodium spike moved the estimate ${Math.abs(b.estimate.expenditureKcal - a.estimate.expenditureKcal)} kcal`);
});

test("noisy scale data widens the error bar and reduces the data's weight", () => {
  const quiet = makeHistory({ days: 35, trueExpenditure: 2900, intakeKcal: 2400, weightNoiseKg: 0.1, seed: 11 });
  const noisy = makeHistory({ days: 35, trueExpenditure: 2900, intakeKcal: 2400, weightNoiseKg: 1.4, seed: 11 });
  const a = estimateExpenditure({ ...quiet, priorTdee: 2900 });
  const b = estimateExpenditure({ ...noisy, priorTdee: 2900 });
  assert.ok(b.estimate.seBudget.weightTrendKcal > a.estimate.seBudget.weightTrendKcal);
  assert.ok(b.estimate.dataWeightPct < a.estimate.dataWeightPct);
});

// ── rails ────────────────────────────────────────────────────────────────

test("the estimate may not claim the formula is more than 30% wrong", () => {
  // Physically impossible history: eating 2400, losing 1.5 kg/week.
  const h = makeHistory({ days: 35, trueExpenditure: 4100, intakeKcal: 2400 });
  const r = estimateExpenditure({ ...h, priorTdee: 2500 });
  assert.equal(r.estimate.clamped, true);
  assert.equal(r.estimate.expenditureKcal, Math.round(2500 * (1 + MAX_DEVIATION_FRAC)));
  assert.ok(r.notes.some((n) => /logging or scale problem/.test(n)), r.notes.join(" | "));
});

test("under-reported intake is recovered as expenditure IN REPORTING UNITS (documented bias)", () => {
  // Really eats 2800 / burns 3000, but only logs 85% of it.
  const h = makeHistory({ days: 42, trueExpenditure: 3000, intakeKcal: 2800, reportFactor: 0.85 });
  const r = estimateExpenditure({ ...h, priorTdee: 3000 });
  const underBy = 2800 * 0.15; // 420 kcal/day unlogged
  assert.ok(Math.abs(r.estimate.dataKcal - (3000 - underBy)) < 30,
    `${r.estimate.dataKcal} should track 3000 − ${underBy} (expenditure in the units the user reports in)`);
});

test("every reported number carries its inputs (shown-math contract)", () => {
  const h = makeHistory({ days: 35 });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  for (const k of ["window", "intake", "weight", "reconciliation", "estimate", "method"]) {
    assert.ok(r[k], `${k} missing`);
  }
  const b = r.estimate.seBudget;
  const quad = Math.sqrt(b.weightTrendKcal ** 2 + b.intakeMeanKcal ** 2 + b.unloggedDaysKcal ** 2 + b.tissueCompositionKcal ** 2 + b.modelErrorKcal ** 2);
  assert.ok(Math.abs(quad - r.estimate.dataSeKcal) < 2, "the five error terms must sum in quadrature to the reported SE");
  assert.equal(r.method.rhoKcalPerKg, Math.round(KCAL_PER_KG));
  assert.equal(r.method.priorSdKcal, PRIOR_SD_KCAL);
  assert.equal(r.method.doc, "docs/adaptive-tdee-methodology.md");
});

// ── numeric helpers ──────────────────────────────────────────────────────

test("robustWeightedFit recovers an exact slope and reports zero-ish residual scale", () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 100 - 0.05 * i }));
  const f = robustWeightedFit(pts, { refX: 19, halfLife: HALF_LIFE_DAYS, minScale: 0 });
  assert.ok(Math.abs(f.slope + 0.05) < 1e-9);
  assert.ok(f.scale < 1e-9);
  assert.ok(f.nEff > 10 && f.nEff <= 20);
});

test("robustWeightedFit refuses a slope when every point shares one day", () => {
  const pts = Array.from({ length: 5 }, () => ({ x: 10, y: 90 }));
  assert.equal(robustWeightedFit(pts, { refX: 10, halfLife: 21 }), null);
});

test("exponential weighting makes recent data dominate", () => {
  const old = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 1000 }));
  const recent = Array.from({ length: 20 }, (_, i) => ({ x: 20 + i, y: 3000 }));
  const m = robustWeightedMean([...old, ...recent], { refX: 39, halfLife: 21, minScale: 0 });
  assert.ok(m.mean > 2200, `weighted mean ${m.mean} should sit well above the flat 2000 midpoint`);
});

test("madScale is a normal-consistent scale", () => {
  assert.equal(madScale([]), null);
  assert.ok(Math.abs(madScale([-1, 1, -1, 1]) - 1.4826) < 1e-9);
});

// ── ledger + resolver (the logged/visible/reversible contract) ────────────

const LEDGER_PROFILE = {
  sex: "M", age: 34, heightCm: 180, bodyFatPct: 22,
  occupationKey: "desk-office", activityOverride: null,
  sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
  rateLbPerWeek: 1.0, floorKcal: null, excludedFormulas: [],
  startWeightKg: 95, startDate: "2026-05-01", targetKcal: 0,
};

test("the ledger replays weekly checkpoints, newest first, with the change each week", () => {
  const h = makeHistory({ asOf: "2026-06-30", days: 56, startKg: 98, trueExpenditure: 3100, intakeKcal: 2400 });
  const rows = buildLedger({ profile: LEDGER_PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  assert.ok(rows.length >= 8, `expected weekly checkpoints, got ${rows.length}`);
  assert.equal(rows[0].date, "2026-06-30");
  assert.ok(dayNum(rows[0].date) > dayNum(rows[1].date), "newest first");
  for (const r of rows) {
    assert.ok(Number.isFinite(r.targetKcal) && Number.isFinite(r.formulaTargetKcal));
    assert.ok(["insufficient", "provisional", "confident", "off"].includes(r.status));
    if (r.status === "insufficient") assert.ok(typeof r.reason === "string" && r.reason.length > 0, "a withheld week must say why");
  }
  // Early weeks are withheld, later weeks apply — that transition is the log.
  const oldest = rows[rows.length - 1], newest = rows[0];
  assert.equal(oldest.status, "insufficient");
  assert.equal(newest.source, "adaptive");
  assert.ok(newest.expenditureKcal > newest.formulaTdeeKcal, "this fixture burns more than the formula says");
});

test("resolveEnergy falls back to the formula target when the estimator is unsure", () => {
  const h = makeHistory({ asOf: "2026-05-10", days: 9, startKg: 95 });
  const r = resolveEnergy({ profile: LEDGER_PROFILE, weighins: h.weighins, intake: h.intake, asOf: "2026-05-10" });
  assert.equal(r.applied, false);
  assert.equal(r.tdeeSource, "formula");
  assert.equal(r.target.target, r.formulaTarget.target);
  assert.equal(r.effectiveTdee, r.energy.tdee);
});

test("resolveEnergy moves the target off the formula once the data supports it, and never below the floor", () => {
  const h = makeHistory({ asOf: "2026-06-30", days: 49, startKg: 98, trueExpenditure: 3300, intakeKcal: 2300 });
  const r = resolveEnergy({ profile: LEDGER_PROFILE, weighins: h.weighins, intake: h.intake, asOf: "2026-06-30" });
  assert.equal(r.applied, true);
  assert.equal(r.tdeeSource, "adaptive");
  assert.ok(r.target.target !== r.formulaTarget.target, "the target must actually move");
  assert.ok(r.target.target >= r.target.floor, "the safety floor still wins");
  assert.equal(r.target.target, Math.max(r.effectiveTdee - r.target.deficit, r.target.floor));
});

test("the safety floor is never crossed even with an aggressive adaptive estimate", () => {
  // Small woman, high floor, huge apparent deficit.
  const p = { ...LEDGER_PROFILE, sex: "F", age: 45, heightCm: 158, bodyFatPct: 30, startWeightKg: 58, rateLbPerWeek: 2.0, floorKcal: 1600 };
  const h = makeHistory({ asOf: "2026-06-30", days: 49, startKg: 58, trueExpenditure: 1500, intakeKcal: 1400 });
  const r = resolveEnergy({ profile: p, weighins: h.weighins, intake: h.intake, asOf: "2026-06-30" });
  assert.ok(r.target.target >= 1600, `target ${r.target.target} broke the user floor`);
  assert.equal(r.target.floored, true);
});

test("ADAPTIVE_TDEE=off reverts every target to the formula, and says so", () => {
  const h = makeHistory({ asOf: "2026-06-30", days: 49, startKg: 98, trueExpenditure: 3300, intakeKcal: 2300 });
  const on = resolveEnergy({ profile: LEDGER_PROFILE, weighins: h.weighins, intake: h.intake, asOf: "2026-06-30" });
  const prev = process.env.ADAPTIVE_TDEE;
  process.env.ADAPTIVE_TDEE = "off";
  try {
    assert.equal(adaptiveEnabled(LEDGER_PROFILE), false);
    const off = resolveEnergy({ profile: LEDGER_PROFILE, weighins: h.weighins, intake: h.intake, asOf: "2026-06-30" });
    assert.equal(off.applied, false);
    assert.equal(off.adaptive.status, "off");
    assert.ok(off.adaptive.reasons[0].includes("ADAPTIVE_TDEE=off"));
    assert.equal(off.target.target, off.formulaTarget.target);
    assert.notEqual(on.target.target, off.target.target, "the switch must actually change the outcome");
  } finally {
    if (prev === undefined) delete process.env.ADAPTIVE_TDEE; else process.env.ADAPTIVE_TDEE = prev;
  }
});

test("the per-user opt-out is honoured the moment the column exists", () => {
  const h = makeHistory({ asOf: "2026-06-30", days: 49, startKg: 98, trueExpenditure: 3300, intakeKcal: 2300 });
  const off = resolveEnergy({ profile: { ...LEDGER_PROFILE, adaptiveTdee: false }, weighins: h.weighins, intake: h.intake, asOf: "2026-06-30" });
  assert.equal(off.applied, false);
  assert.equal(off.target.target, off.formulaTarget.target);
  // and today, with no such column, adaptive stays on
  assert.equal(adaptiveEnabled(LEDGER_PROFILE), true);
});

test("deleting the weigh-ins that caused an adjustment un-does it (derived-state reversibility)", () => {
  const h = makeHistory({ asOf: "2026-06-30", days: 49, startKg: 98, trueExpenditure: 3300, intakeKcal: 2300 });
  const before = resolveEnergy({ profile: LEDGER_PROFILE, weighins: h.weighins, intake: h.intake, asOf: "2026-06-30" });
  assert.equal(before.applied, true);
  const after = resolveEnergy({ profile: LEDGER_PROFILE, weighins: [], intake: h.intake, asOf: "2026-06-30" });
  assert.equal(after.applied, false);
  assert.equal(after.target.target, after.formulaTarget.target);
});

test("weightNowKgAt replays the 7-weigh-in average as of a past date", () => {
  const h = makeHistory({ asOf: "2026-06-30", days: 40, startKg: 100, trueExpenditure: 3000, intakeKcal: 2500 });
  const past = "2026-06-10";
  const got = weightNowKgAt(h.weighins, LEDGER_PROFILE, past);
  const expect = h.weighins.filter((w) => w.date <= past).slice(-7).reduce((s, w) => s + w.weightKg, 0) / 7;
  assert.ok(Math.abs(got - expect) < 1e-9);
  assert.equal(weightNowKgAt([], LEDGER_PROFILE, past), LEDGER_PROFILE.startWeightKg);
});

// ── error-bar calibration (found by the self-benchmark, fixed here) ───────

test("autocorrelated water weight widens the reported error bar", () => {
  // Same residual SIZE, different structure: iid vs a persistent drift-and-hold.
  const days = 35, asOf = "2026-06-30";
  const build = (noiseAt) => {
    const weighins = [], intake = [];
    let mass = 95;
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(asOf, -i);
      mass += (2400 - 2900) / KCAL_PER_KG;
      weighins.push({ date, weightKg: mass + noiseAt(days - 1 - i) });
      intake.push({ date, kcal: 2400 });
    }
    return { weighins, intake, asOf };
  };
  const flip = (t) => (t % 2 === 0 ? 0.6 : -0.6);      // alternating — no persistence
  const block = (t) => (Math.floor(t / 7) % 2 === 0 ? 0.6 : -0.6); // week-long blocks
  const a = estimateExpenditure({ ...build(flip), priorTdee: 2900 });
  const b = estimateExpenditure({ ...build(block), priorTdee: 2900 });
  assert.ok(b.weight.lag1Autocorr > a.weight.lag1Autocorr, "block noise must read as more autocorrelated");
  assert.ok(b.weight.varianceInflation > a.weight.varianceInflation);
  assert.ok(b.estimate.seBudget.weightTrendKcal > a.estimate.seBudget.weightTrendKcal,
    "persistent water noise must produce a wider error bar than alternating noise of the same size");
});

test("lag1Autocorr only counts consecutive calendar days and stays silent on thin data", () => {
  assert.equal(lag1Autocorr([0, 2, 4, 6], [1, -1, 1, -1]), null, "no adjacent days → no answer");
  assert.equal(lag1Autocorr([0, 1, 2], [1, -1, 1]), null, "under 5 pairs → no answer");
  const xs = Array.from({ length: 20 }, (_, i) => i);
  const persistent = lag1Autocorr(xs, xs.map((i) => (Math.floor(i / 5) % 2 === 0 ? 1 : -1)));
  const alternating = lag1Autocorr(xs, xs.map((i) => (i % 2 === 0 ? 1 : -1)));
  assert.ok(persistent > 0.5, `persistent ${persistent}`);
  assert.ok(alternating < 0, `alternating ${alternating}`);
});

test("the irreducible model-error floor is always charged", () => {
  const h = makeHistory({ days: 42, trueExpenditure: 2900, intakeKcal: 2400 });
  const r = estimateExpenditure({ ...h, priorTdee: 2900 });
  assert.equal(r.estimate.seBudget.modelErrorKcal, MODEL_ERROR_KCAL);
  assert.ok(r.estimate.dataSeKcal >= MODEL_ERROR_KCAL, "the SE can never fall below the model-error floor");
});
