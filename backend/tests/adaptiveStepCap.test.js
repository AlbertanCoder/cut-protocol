// ── Wave 6 · the ±125 kcal step cap (owner-approved) ─────────────────────
//
// The engine here decides what a real person eats. Before this cap, one noisy
// weigh-in week could move that number by several hundred kcal in a single day
// and then move it back. These tests lock four properties:
//
//   1. a single adjustment never exceeds ±STEP_CAP_KCAL;
//   2. when the cap BINDS, the engine says so — the flag, the outstanding
//      amount and a human reason are all in the output (a silently truncated
//      number that re-indicates the same move every week reads as an engine
//      ignoring its own data);
//   3. a large indicated move still ARRIVES, one step per weekly cycle;
//   4. the cap is never a way to hold a target below the safety floor, and
//      reading twice never walks the target (idempotence — the failure mode of
//      the naive "clamp against the stored value" implementation).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyStepCap, checkpointDates, walkTarget, resolveAppliedTarget, buildLedger,
  STEP_CAP_KCAL,
} = require("../src/lib/adaptiveTarget.js");
const { KCAL_PER_KG } = require("../src/lib/expenditureEstimator.js");
const { addDays, dayNum } = require("../src/lib/dates.js");

// Same deterministic fixture builder the estimator suite uses. Test data only.
function makeHistory({
  asOf = "2026-06-30", days = 56, startKg = 98, trueExpenditure = 3300,
  intakeKcal = 2300, logEveryDay = true,
} = {}) {
  const weighins = [], intake = [];
  let mass = startKg;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    mass += (intakeKcal - trueExpenditure) / KCAL_PER_KG;
    weighins.push({ date, weightKg: mass });
    if (logEveryDay) intake.push({ date, kcal: intakeKcal });
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

// ── 1. the clamp itself ──────────────────────────────────────────────────

test("a single adjustment can never exceed ±125 kcal in either direction", () => {
  const indicated = (t) => ({ rate: 1, deficit: 500, raw: t, target: t, floor: 1500, floored: false });
  const up = applyStepCap(indicated(2900), 2400);
  assert.equal(up.target.target, 2400 + STEP_CAP_KCAL);
  const down = applyStepCap(indicated(1900), 2400);
  assert.equal(down.target.target, 2400 - STEP_CAP_KCAL);
  // a move that fits is passed through untouched
  const small = applyStepCap(indicated(2460), 2400);
  assert.equal(small.target.target, 2460);
  assert.equal(small.stepCap.capped, false);
});

test("when the cap binds it SAYS SO — flag, outstanding amount, cycles, and words", () => {
  const indicated = { rate: 1, deficit: 500, raw: 2900, target: 2900, floor: 1500, floored: false };
  const { target, stepCap } = applyStepCap(indicated, 2400);
  assert.equal(stepCap.capped, true);
  assert.equal(target.stepCapped, true);
  assert.equal(stepCap.indicatedKcal, 2900);
  assert.equal(stepCap.appliedKcal, 2525);
  assert.equal(stepCap.indicatedChangeKcal, 500);
  assert.equal(stepCap.appliedChangeKcal, 125);
  assert.equal(stepCap.remainingKcal, 375);
  assert.equal(stepCap.cyclesToConverge, 3);
  assert.match(stepCap.reason, /capped/i);
  assert.match(stepCap.reason, /125/);
  // the uncapped number is never thrown away — it is reported alongside
  assert.equal(target.indicatedTargetKcal, 2900);
});

test("an uncapped step carries no cap reason, and the first cycle is an anchor not a move", () => {
  const indicated = { rate: 1, deficit: 500, raw: 2500, target: 2500, floor: 1500, floored: false };
  const first = applyStepCap(indicated, null);
  assert.equal(first.stepCap.anchor, true);
  assert.equal(first.stepCap.capped, false);
  assert.equal(first.stepCap.reason, null);
  assert.equal(first.target.target, 2500, "with nothing to move from, the indicated target IS the answer");
});

// ── 2. convergence: the move arrives, it just arrives gradually ──────────

test("a large indicated move is REACHED over consecutive cycles, not in one jump", () => {
  const indicated = { rate: 1, deficit: 500, raw: 2900, target: 2900, floor: 1500, floored: false };
  let prev = 2400;
  const path = [];
  for (let cycle = 0; cycle < 8; cycle++) {
    const { target, stepCap } = applyStepCap(indicated, prev);
    path.push(target.target);
    // every single step obeys the cap
    assert.ok(Math.abs(target.target - prev) <= STEP_CAP_KCAL, `step ${cycle} moved ${target.target - prev}`);
    // while short of the goal the engine keeps saying there is more to come
    if (target.target !== 2900) assert.ok(stepCap.remainingKcal !== 0 && stepCap.cyclesToConverge > 0);
    prev = target.target;
  }
  assert.deepEqual(path, [2525, 2650, 2775, 2900, 2900, 2900, 2900, 2900]);
  assert.equal(prev, 2900, "the indicated move must actually arrive");
  // and once it has arrived it STAYS — no oscillation, no residual cap flag
  const settled = applyStepCap(indicated, 2900);
  assert.equal(settled.stepCap.capped, false);
  assert.equal(settled.stepCap.remainingKcal, 0);
  assert.equal(settled.stepCap.cyclesToConverge, 0);
});

test("ceil(Δ/125) is the honest cycle count, and it counts down as the walk proceeds", () => {
  const indicated = { rate: 1, deficit: 500, raw: 3000, target: 3000, floor: 1500, floored: false };
  const counts = [];
  let prev = 2400;
  for (let i = 0; i < 5; i++) {
    const { target, stepCap } = applyStepCap(indicated, prev);
    counts.push(stepCap.cyclesToConverge);
    prev = target.target;
  }
  assert.deepEqual(counts, [4, 3, 2, 1, 0]);
});

// ── 3. the safety floor outranks the cap ────────────────────────────────

test("the cap may never walk a target below the safety floor", () => {
  // Floor just rose (a stricter user floor); the previous target sits under it.
  const indicated = { rate: 1, deficit: 500, raw: 1400, target: 2000, floor: 2000, floored: true };
  const { target, stepCap } = applyStepCap(indicated, 1700);
  assert.equal(target.target, 2000, "the floor wins outright — a 300 kcal jump UP is correct here");
  assert.equal(stepCap.floorOverride, true);
  assert.match(stepCap.reason, /floor/i);
});

test("a downward indicated move is held ABOVE the indicated target while it walks — the safe direction", () => {
  const indicated = { rate: 1, deficit: 500, raw: 1800, target: 1800, floor: 1500, floored: false };
  const { target } = applyStepCap(indicated, 2400);
  assert.equal(target.target, 2275);
  assert.ok(target.target > indicated.target, "mid-walk the user eats MORE than indicated, never less");
  assert.ok(target.target >= indicated.floor);
});

// ── 4. the walk: idempotent, grid-stable, floor-safe ─────────────────────

test("the checkpoint grid is anchored on the start date, so it does not slide with the clock", () => {
  const a = checkpointDates("2026-05-01", "2026-06-30");
  const b = checkpointDates("2026-05-01", "2026-07-01");
  assert.equal(a[0], "2026-05-01");
  assert.equal(b[0], "2026-05-01");
  // every historical checkpoint is identical; only the tail differs
  assert.deepEqual(a.slice(0, 9), b.slice(0, 9));
  assert.equal(a[a.length - 1], "2026-06-30");
  assert.equal(b[b.length - 1], "2026-07-01");
  // weekly spacing
  for (let i = 1; i < 9; i++) assert.equal(dayNum(a[i]) - dayNum(a[i - 1]), 7);
});

test("resolving twice returns the SAME target — reads never walk it (the naive-clamp bug)", () => {
  const h = makeHistory({ days: 56, trueExpenditure: 3300, intakeKcal: 2300 });
  const a = resolveAppliedTarget({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  const b = resolveAppliedTarget({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  const c = resolveAppliedTarget({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  assert.equal(a.target.target, b.target.target);
  assert.equal(b.target.target, c.target.target);
});

test("every step of a real walk obeys the cap, and the walk moves toward the indicated target", () => {
  const h = makeHistory({ days: 56, trueExpenditure: 3400, intakeKcal: 2300 });
  const steps = walkTarget({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  assert.ok(steps.length >= 8, `expected weekly steps, got ${steps.length}`);
  for (let i = 1; i < steps.length; i++) {
    const moved = steps[i].target.target - steps[i - 1].target.target;
    assert.ok(Math.abs(moved) <= STEP_CAP_KCAL + 1e-9,
      `step ${steps[i].date} moved ${moved} kcal, over the ${STEP_CAP_KCAL} cap`);
    assert.ok(steps[i].target.target >= steps[i].target.floor, "no step may sit under the floor");
  }
  const last = steps[steps.length - 1];
  const first = steps[0];
  assert.ok(last.target.target > first.target.target, "this fixture burns more than the formula — the walk goes up");
});

test("the applied target beats the indicated one to the punch only gradually, and both are reported", () => {
  // A history that only becomes measurable partway through, so the indicated
  // target jumps the moment the gates open — exactly the shape the cap exists
  // for. The applied target must lag it, then catch up.
  const h = makeHistory({ days: 56, trueExpenditure: 3500, intakeKcal: 2300 });
  const steps = walkTarget({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  const jumped = steps.filter((s) => s.stepCap.capped);
  assert.ok(jumped.length > 0, "this fixture must exercise the cap at least once");
  for (const s of jumped) {
    assert.ok(Math.abs(s.stepCap.indicatedChangeKcal) > STEP_CAP_KCAL);
    assert.equal(Math.abs(s.stepCap.appliedChangeKcal), STEP_CAP_KCAL);
    assert.match(s.stepCap.reason, /capped/i);
  }
});

test("the ledger publishes the cap: applied change, indicated change, reason, outstanding amount", () => {
  const h = makeHistory({ days: 56, trueExpenditure: 3500, intakeKcal: 2300 });
  const rows = buildLedger({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  assert.ok(rows.length >= 8);
  assert.equal(rows[0].date, h.asOf, "newest first");
  for (const r of rows) {
    assert.ok(Number.isFinite(r.targetKcal) && Number.isFinite(r.indicatedTargetKcal));
    if (r.changeKcal != null) assert.ok(Math.abs(r.changeKcal) <= STEP_CAP_KCAL);
    if (r.capped) {
      assert.ok(typeof r.capReason === "string" && r.capReason.length > 0, "a capped week must say why");
      assert.ok(Math.abs(r.indicatedChangeKcal) > STEP_CAP_KCAL);
      assert.notEqual(r.remainingKcal, 0);
    }
  }
  assert.ok(rows.some((r) => r.capped), "this fixture must show at least one capped week in the log");
});

test("deleting the weigh-ins that drove a capped walk un-does it (still derived state)", () => {
  const h = makeHistory({ days: 56, trueExpenditure: 3500, intakeKcal: 2300 });
  const before = resolveAppliedTarget({ profile: PROFILE, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  const after = resolveAppliedTarget({ profile: PROFILE, weighins: [], intake: h.intake, asOf: h.asOf });
  assert.notEqual(before.target.target, after.target.target);
  assert.equal(after.target.target, after.formulaTarget.target, "with no weigh-ins the target is the formula target");
  assert.equal(after.stepCap.capped, false);
});

test("a deliberate profile change is NOT rate-limited — only data-driven moves are", () => {
  // The walk replays on the CURRENT profile, so switching the chosen rate moves
  // every checkpoint by the same amount and lands in full, immediately.
  const h = makeHistory({ days: 56, trueExpenditure: 3300, intakeKcal: 2300 });
  const slow = resolveAppliedTarget({ profile: { ...PROFILE, rateLbPerWeek: 0.5 }, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  const fast = resolveAppliedTarget({ profile: { ...PROFILE, rateLbPerWeek: 1.5 }, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  const gap = slow.target.target - fast.target.target;
  assert.ok(gap > STEP_CAP_KCAL,
    `a 1.0 lb/wk rate change is worth ~500 kcal and must apply at once, got ${gap}`);
});

test("the walk never lands under the floor even with an aggressive estimate", () => {
  const p = { ...PROFILE, sex: "F", age: 45, heightCm: 158, bodyFatPct: 30, startWeightKg: 58, rateLbPerWeek: 2.0, floorKcal: 1600 };
  const h = makeHistory({ days: 56, startKg: 58, trueExpenditure: 1500, intakeKcal: 1400 });
  const steps = walkTarget({ profile: p, weighins: h.weighins, intake: h.intake, asOf: h.asOf });
  for (const s of steps) {
    assert.ok(s.target.target >= 1600, `${s.date} target ${s.target.target} broke the 1600 floor`);
  }
});
