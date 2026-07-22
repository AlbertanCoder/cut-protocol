// ── Adaptive target resolution ───────────────────────────────────────────
//
// The seam between the pure estimator (expenditureEstimator.js — no DB, no
// clock) and the app. ONE function decides what TDEE the app runs on, so the
// materialized Profile.targetKcal and the Engine screen can never disagree:
// both call resolveEnergy().
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
const { estimateExpenditure, PRIOR_SD_KCAL, VERSION } = require("./expenditureEstimator.js");
const { dayNum, todayStr, addDays } = require("./dates.js");

const LEDGER_WEEKS = 12; // ~3 months of weekly checkpoints

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
 * THE single source of truth for "what TDEE is this app running on today".
 * Pure — takes the loaded history, returns everything both callers need.
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
 * The adjustment log. Because the estimate is a pure function of logged data,
 * the history is REPLAYED rather than stored — which is strictly stronger than
 * a stored log: it can never drift from its inputs, and correcting a bad
 * weigh-in retroactively un-does the adjustment it caused.
 *
 * Returns newest-first. `changeKcal` is the move from the previous checkpoint —
 * that is the "automatic adjustment" the constitution requires to be visible.
 */
function buildLedger({ profile, weighins, intake, asOf = todayStr(), weeks = LEDGER_WEEKS }) {
  const startDay = dayNum(profile.startDate);
  const dates = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = addDays(asOf, -7 * i);
    if (dayNum(d) >= startDay) dates.push(d);
  }
  if (!dates.length) dates.push(asOf);

  const rows = [];
  let prevTarget = null;
  for (const date of dates) {
    const r = resolveEnergy({ profile, weighins, intake, asOf: date });
    rows.push({
      date,
      status: r.adaptive.status,
      source: r.tdeeSource,
      formulaTdeeKcal: r.energy.tdee,
      expenditureKcal: r.applied ? r.adaptive.estimate.expenditureKcal : null,
      deltaVsFormulaKcal: r.applied ? r.adaptive.estimate.deltaVsFormulaKcal : null,
      formulaTargetKcal: r.formulaTarget.target,
      targetKcal: r.target.target,
      changeKcal: prevTarget == null ? null : r.target.target - prevTarget,
      floored: r.target.floored,
      reason: r.applied ? null : (r.adaptive.reasons[0] || null),
      coveragePct: r.adaptive.window ? r.adaptive.window.effectiveCoveragePct : null,
    });
    prevTarget = r.target.target;
  }
  return rows.reverse();
}

/** Everything the Engine screen and the target materializer need, in one call. */
async function adaptiveContext(userId, profile, asOf = todayStr()) {
  const { weighins, intake } = await loadHistory(userId);
  const resolved = resolveEnergy({ profile, weighins, intake, asOf });
  return {
    ...resolved,
    ledger: buildLedger({ profile, weighins, intake, asOf }),
    reversible: {
      derived: true,
      how: "This adjustment is recomputed from your weigh-ins and food log every time they change — nothing is stored. Fix or delete an entry and the adjustment recalculates with it.",
      installSwitch: "ADAPTIVE_TDEE=off",
      perUserSwitch: adaptiveEnabled(profile),
      perUserSwitchPersisted: profile?.adaptiveTdee !== undefined,
    },
  };
}

module.exports = {
  adaptiveEnabled, offReason, loadHistory, weightNowKgAt,
  resolveEnergy, buildLedger, adaptiveContext,
  LEDGER_WEEKS,
};
