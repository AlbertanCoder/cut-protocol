// ── Adaptive target resolution ───────────────────────────────────────────
//
// The seam between the pure estimator (expenditureEstimator.js — no DB, no
// clock) and the app.
//
// TWO functions, one answer:
//   · resolveEnergy()        — what the data INDICATES today. No memory, no cap.
//   · resolveAppliedTarget() — what is IN FORCE today: the indicated target
//                              walked toward at ±STEP_CAP_KCAL per weekly cycle.
// Every app surface reads the SECOND one — the materialized Profile.targetKcal
// (profileTarget.js) and the Engine screen (routes/weighins.js) both do — so
// they cannot disagree. The live resolver is authoritative; the stored
// Profile.targetKcal is a cache of it and is reconciled on read.
//
// Constitutional obligations this file carries:
//   · LOGGED    — buildLedger() replays the estimator at weekly checkpoints and
//                 returns the full adjustment history, each row naming the data
//                 window and the exact numbers that produced it.
//   · VISIBLE   — every intermediate lands in the /weighins/summary payload and
//                 is rendered on the Engine screen (§2b), not just the result.
//   · REVERSIBLE— the adaptive target is DERIVED state, held nowhere. Correct or
//                 delete a weigh-in / diary entry and the next recompute un-does
//                 the adjustment. `ADAPTIVE_TDEE=off` disables the layer entirely
//                 and every target falls straight back to the formula. The
//                 per-user in-app opt-out needs one Boolean column that this
//                 file already reads (see adaptiveEnabled) — requested, not added.
const { prisma } = require("./prisma.js");
const { computeEnergy, deriveTarget, rateSafety } = require("./bmrEngine.js");
const { estimateExpenditure, PRIOR_SD_KCAL, VERSION, confidenceBlock, KCAL_PER_LB } = require("./expenditureEstimator.js");
const { dayNum, todayStr, addDays } = require("./dates.js");

const LEDGER_WEEKS = 12; // ~3 months of weekly checkpoints

// ── the step cap (owner-approved, ±125 kcal per adjustment) ───────────────
//
// resolveEnergy() returns the INDICATED target: what the data says today, with
// no memory. On its own that is jumpy — one noisy weigh-in week could yank a
// real person's eating target several hundred kcal in a single day, and then
// yank it back. STEP_CAP_KCAL limits how far the target may move per weekly
// cycle; walkTarget() below applies it.
//
// HOW IT STAYS HONEST AND IDEMPOTENT. The obvious implementation — "clamp
// against the value stored in the profile row" — is a trap: every read would be
// allowed another 125 kcal, so refreshing the screen five times would walk the
// target 625 kcal. Instead the cap is applied by REPLAYING a fixed weekly
// checkpoint grid anchored on profile.startDate, exactly like buildLedger. The
// applied target is therefore still a pure function of (profile, weigh-ins,
// food log, asOf): reading twice gives the same number, deleting a bad weigh-in
// un-does its effect, and the walk is auditable step by step.
//
// WHAT THE CAP DOES AND DOES NOT RATE-LIMIT. The replay runs on the CURRENT
// profile, so a deliberate profile change (a new rate, a new job, a corrected
// height) shifts every checkpoint by the same amount and lands in full,
// immediately — the user asked for it. What gets rate-limited is the part that
// varies from checkpoint to checkpoint, i.e. the data-driven adaptive move.
// That is the part that can be noise.
const STEP_CAP_KCAL = 125;
// Bound the replay cost for a long-running account (each step is a full
// estimator fit; a 2-year daily history costs ~65 ms, a 1-year one ~33 ms).
// 52 is not a guess: the widest plausible target range is roughly 1,200-5,000
// kcal, so the walk needs at most ceil(3800/125) = 31 steps to traverse it end
// to end. Once it has caught the indicated path even once, where the anchor
// started is unrecoverable from the output. 52 weeks is a 1.7x margin over
// that worst case, so truncating the replay cannot change today's answer.
const STEP_WALK_MAX_WEEKS = 52;

/**
 * Kill switches, strictest first.
 *  1. `ADAPTIVE_TDEE=off` in the environment — whole-install revert to formula
 *     targets (the same env-flag convention BRAIN=off already uses).
 *  2. `profile.adaptiveTdee === false` — the per-user opt-out. The column does
 *     not exist yet (shared schema lock); `undefined !== false`, so today this
 *     is inert and the switch lights up the moment the column lands.
 */
function adaptiveEnabled(profile) {
  if (String(process.env.ADAPTIVE_TDEE || "").toLowerCase() === "off") return false;
  return profile?.adaptiveTdee !== false;
}

function offReason(profile) {
  if (String(process.env.ADAPTIVE_TDEE || "").toLowerCase() === "off") return "adaptive targeting is switched off for this install (ADAPTIVE_TDEE=off)";
  if (profile?.adaptiveTdee === false) return "you switched adaptive targeting off — targets come straight from the formula";
  return null;
}

/** Load the two series the estimator reconciles. Diary rows are summed per day. */
async function loadHistory(userId) {
  const [weighins, logs] = await Promise.all([
    prisma.weighin.findMany({ where: { userId }, orderBy: { date: "asc" }, select: { date: true, weightKg: true } }),
    prisma.mealLog.findMany({ where: { userId }, select: { date: true, kcal: true } }),
  ]);
  const byDay = new Map();
  for (const l of logs) byDay.set(l.date, (byDay.get(l.date) || 0) + (l.kcal || 0));
  const intake = [...byDay.entries()]
    .map(([date, kcal]) => ({ date, kcal }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { weighins: weighins.map((w) => ({ date: w.date, weightKg: w.weightKg })), intake };
}

/**
 * "Current weight" AS OF a date — same definition weightNow.js uses (mean of
 * the most recent 7 weigh-in rows), just replayable at a past checkpoint so the
 * ledger shows what the engine would genuinely have said that week.
 */
function weightNowKgAt(weighins, profile, asOf) {
  const upto = weighins.filter((w) => w.date <= asOf);
  const last7 = upto.slice(-7);
  if (!last7.length) return profile.startWeightKg;
  return last7.reduce((s, w) => s + w.weightKg, 0) / last7.length;
}

/**
 * What the data INDICATES for a given day: the expenditure the app would run
 * on, and the target that falls out of it, with no memory of yesterday's
 * target. Pure. Callers who need the number a user is actually told to eat want
 * resolveAppliedTarget() — this one feeds it.
 */
function resolveEnergy({ profile, weighins, intake, asOf = todayStr() }) {
  const weightKg = weightNowKgAt(weighins, profile, asOf);
  const energy = computeEnergy(profile, weightKg);
  const formulaTarget = deriveTarget(profile, energy.tdee, energy.rmr);

  const enabled = adaptiveEnabled(profile);
  const adaptive = enabled
    ? estimateExpenditure({ weighins, intake, asOf, priorTdee: energy.tdee, priorSd: PRIOR_SD_KCAL })
    : {
      version: VERSION, status: "off", applied: false,
      confidence: confidenceBlock("off", false, null),
      reasons: [offReason(profile)].filter(Boolean),
      notes: [], window: null, prior: { tdeeKcal: energy.tdee, sdKcal: PRIOR_SD_KCAL },
      intake: null, weight: null, reconciliation: null, estimate: null, method: null,
    };

  const applied = Boolean(adaptive.applied);
  const effectiveTdee = applied ? adaptive.estimate.expenditureKcal : energy.tdee;
  const target = applied ? deriveTarget(profile, effectiveTdee, energy.rmr) : formulaTarget;
  const safety = rateSafety(profile, weightKg, effectiveTdee, energy.rmr);

  return {
    asOf, weightKg, energy, adaptive, applied,
    effectiveTdee,
    tdeeSource: applied ? "adaptive" : "formula",
    formulaTarget, target, safety,
  };
}

/**
 * One capped step. PURE and deliberately tiny so it can be unit-tested on its
 * own: given the target the data indicates and the target the previous cycle
 * left in force, what may the user actually be told to eat?
 *
 * Rules, in order:
 *   1. no previous cycle → the indicated target IS the anchor; nothing to cap.
 *   2. move no more than ±cap.
 *   3. the safety floor outranks the cap. The cap may hold a target ABOVE what
 *      the data indicates (that is the safe direction — more food, applied
 *      gradually), but it may never hold one BELOW the floor.
 *   4. if the cap bound, SAY SO, and say how much move is still outstanding.
 *      A silently truncated number that re-indicates the same move every week
 *      looks like an engine ignoring its own data.
 */
function applyStepCap(indicated, prevKcal, cap = STEP_CAP_KCAL, effectiveTdee = null) {
  const indicatedKcal = indicated.target;
  const floor = indicated.floor;
  const anchor = !Number.isFinite(prevKcal) || prevKcal <= 0;

  let appliedKcal = indicatedKcal;
  let floorOverride = false;
  let indicatedChangeKcal = null;

  if (!anchor) {
    indicatedChangeKcal = indicatedKcal - prevKcal;
    const allowed = Math.max(-cap, Math.min(cap, indicatedChangeKcal));
    appliedKcal = Math.round(prevKcal + allowed);
    if (appliedKcal < floor) { appliedKcal = floor; floorOverride = true; }
  }

  // `capped` means "the cap is actually holding something back RIGHT NOW", not
  // merely "the indicated move was big". When the safety floor lifts the target
  // all the way to the indicated number the cap bound nothing, and saying it did
  // would be a false explanation attached to a real number.
  const remainingKcal = indicatedKcal - appliedKcal;
  const capped = remainingKcal !== 0;
  const cyclesToConverge = remainingKcal === 0 ? 0 : Math.ceil(Math.abs(remainingKcal) / cap);

  const target = {
    ...indicated,
    target: appliedKcal,
    indicatedTargetKcal: indicatedKcal,
    stepCapped: capped,
    atFloor: appliedKcal <= floor,
  };
  // Recompute the "you'll actually lose about X lb/wk" pair against the target
  // the user is really being given, not the one the data merely indicated.
  if (Number.isFinite(effectiveTdee)) {
    target.actualDeficit = Math.max(0, effectiveTdee - appliedKcal);
    target.achievableRate = Math.round((target.actualDeficit * 7 / KCAL_PER_LB) * 100) / 100;
  }

  const appliedChangeKcal = anchor ? null : appliedKcal - prevKcal;
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const parts = [];
  if (floorOverride) {
    parts.push("lifted to your safety floor — the step cap may never hold a target below it");
  }
  if (capped) {
    parts.push(
      `capped — your data indicates ${sign(indicatedChangeKcal)} kcal, so we are applying ${sign(appliedChangeKcal)} now ` +
      `and the remaining ${Math.abs(remainingKcal)} over the next ${cyclesToConverge} weekly update${cyclesToConverge === 1 ? "" : "s"}. ` +
      "Big single jumps are usually noise, not news"
    );
  }

  const stepCap = {
    capKcal: cap,
    anchor,
    capped,
    floorOverride,
    previousKcal: anchor ? null : prevKcal,
    indicatedKcal,
    appliedKcal,
    indicatedChangeKcal,
    appliedChangeKcal,
    remainingKcal,
    cyclesToConverge,
    reason: parts.length ? `${parts.join(". ")}.` : null,
  };

  return { target, stepCap };
}

/**
 * The weekly checkpoint grid. Anchored on profile.startDate, NOT counted back
 * from today, so it does not slide as the clock moves: adding a day cannot
 * reshuffle every historical step and quietly change the answer.
 */
function checkpointDates(startDate, asOf, maxWeeks = STEP_WALK_MAX_WEEKS) {
  const startDay = dayNum(startDate);
  const asOfDay = dayNum(asOf);
  if (!Number.isFinite(startDay) || !Number.isFinite(asOfDay) || asOfDay <= startDay) return [asOf];
  const totalWeeks = Math.floor((asOfDay - startDay) / 7);
  const firstK = Math.max(0, totalWeeks - maxWeeks);
  const dates = [];
  for (let k = firstK; k <= totalWeeks; k++) dates.push(addDays(startDate, 7 * k));
  if (dates[dates.length - 1] !== asOf) dates.push(asOf);
  return dates;
}

/**
 * THE walk. Replays the checkpoint grid, applying one capped step per cycle,
 * and returns every step. Pure: same inputs → same steps → same final target,
 * however many times it is called.
 */
function walkTarget({ profile, weighins, intake, asOf = todayStr(), cap = STEP_CAP_KCAL, maxWeeks = STEP_WALK_MAX_WEEKS }) {
  const dates = checkpointDates(profile.startDate, asOf, maxWeeks);
  const steps = [];
  let prev = null;
  for (const date of dates) {
    const resolved = resolveEnergy({ profile, weighins, intake, asOf: date });
    const { target, stepCap } = applyStepCap(resolved.target, prev, cap, resolved.effectiveTdee);
    steps.push({ date, resolved, target, stepCap });
    prev = target.target;
  }
  return steps;
}

/**
 * THE single source of truth for "what is this app telling the user to eat
 * today". resolveEnergy() answers "what does the data indicate" (no memory);
 * this answers "what is in force" (indicated, walked to at ±STEP_CAP_KCAL per
 * weekly cycle). Both the Engine screen and the materialized Profile.targetKcal
 * read THIS, so they cannot disagree.
 */
function resolveAppliedTarget({ profile, weighins, intake, asOf = todayStr(), cap = STEP_CAP_KCAL }) {
  const steps = walkTarget({ profile, weighins, intake, asOf, cap });
  const last = steps[steps.length - 1];
  return {
    ...last.resolved,
    target: last.target,
    indicatedTarget: last.resolved.target,
    stepCap: last.stepCap,
    steps,
  };
}

/** Ledger row shape — one weekly checkpoint, with the cap made visible. */
function ledgerRow(step, prevStep) {
  const r = step.resolved;
  return {
    date: step.date,
    status: r.adaptive.status,
    source: r.tdeeSource,
    formulaTdeeKcal: r.energy.tdee,
    expenditureKcal: r.applied ? r.adaptive.estimate.expenditureKcal : null,
    deltaVsFormulaKcal: r.applied ? r.adaptive.estimate.deltaVsFormulaKcal : null,
    formulaTargetKcal: r.formulaTarget.target,
    targetKcal: step.target.target,
    indicatedTargetKcal: r.target.target,
    changeKcal: prevStep == null ? null : step.target.target - prevStep.target.target,
    indicatedChangeKcal: step.stepCap.indicatedChangeKcal,
    capped: step.stepCap.capped,
    capReason: step.stepCap.reason,
    remainingKcal: step.stepCap.remainingKcal,
    floored: step.target.floored,
    reason: r.applied ? null : (r.adaptive.reasons[0] || null),
    coveragePct: r.adaptive.window ? r.adaptive.window.effectiveCoveragePct : null,
    intakeStaleDays: r.adaptive.window ? (r.adaptive.window.intakeStaleDays ?? null) : null,
  };
}

/** The tail of a walk, newest-first — the visible adjustment log. */
function ledgerFromWalk(steps, weeks = LEDGER_WEEKS) {
  const tail = steps.slice(-weeks);
  const rows = tail.map((s, i) => ledgerRow(s, i === 0 ? null : tail[i - 1]));
  // The first visible row's change is only null if it is genuinely the first
  // checkpoint; otherwise report the real move from the step just off-screen.
  if (tail.length && steps.length > tail.length) {
    const before = steps[steps.length - tail.length - 1];
    rows[0].changeKcal = tail[0].target.target - before.target.target;
  }
  return rows.reverse();
}

/**
 * The adjustment log. Because the estimate is a pure function of logged data,
 * the history is REPLAYED rather than stored — which is strictly stronger than
 * a stored log: it can never drift from its inputs, and correcting a bad
 * weigh-in retroactively un-does the adjustment it caused.
 *
 * Returns newest-first. `changeKcal` is the APPLIED move from the previous
 * checkpoint; `indicatedChangeKcal` is what the data asked for. When those
 * differ, `capped` is true and `capReason` says so in words — that is the
 * "automatic adjustment is logged and visible" clause of the constitution.
 */
function buildLedger({ profile, weighins, intake, asOf = todayStr(), weeks = LEDGER_WEEKS }) {
  return ledgerFromWalk(walkTarget({ profile, weighins, intake, asOf }), weeks);
}

/** Everything the Engine screen and the target materializer need, in one call. */
async function adaptiveContext(userId, profile, asOf = todayStr()) {
  const { weighins, intake } = await loadHistory(userId);
  const steps = walkTarget({ profile, weighins, intake, asOf });
  const last = steps[steps.length - 1];
  return {
    ...last.resolved,
    target: last.target,
    indicatedTarget: last.resolved.target,
    stepCap: last.stepCap,
    confidence: last.resolved.adaptive.confidence
      || confidenceBlock(last.resolved.adaptive.status, last.resolved.applied, last.resolved.adaptive.window),
    ledger: ledgerFromWalk(steps),
    reversible: {
      derived: true,
      how: "This adjustment is recomputed from your weigh-ins and food log every time they change — nothing is stored. Fix or delete an entry and the adjustment recalculates with it.",
      stepCap: `Adjustments move at most ${STEP_CAP_KCAL} kcal per weekly update, so one odd week cannot swing your target. A larger indicated change is applied over consecutive weeks, and the outstanding amount is shown.`,
      installSwitch: "ADAPTIVE_TDEE=off",
      perUserSwitch: adaptiveEnabled(profile),
      perUserSwitchPersisted: profile?.adaptiveTdee !== undefined,
    },
  };
}

module.exports = {
  adaptiveEnabled, offReason, loadHistory, weightNowKgAt,
  resolveEnergy, resolveAppliedTarget, applyStepCap, checkpointDates, walkTarget,
  buildLedger, ledgerFromWalk, adaptiveContext,
  LEDGER_WEEKS, STEP_CAP_KCAL, STEP_WALK_MAX_WEEKS,
};
