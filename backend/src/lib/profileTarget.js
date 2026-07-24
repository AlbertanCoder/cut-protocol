// Materializes the calorie target onto the profile row.
//
// ── WHO IS AUTHORITATIVE (finding adaptive-tdee-2) ────────────────────────
// The LIVE RESOLVER is authoritative. `Profile.targetKcal` is a CACHE of it —
// nothing more. It exists only so that readers who have a profile row in hand
// (the planner, the macro engine, the brain's prompt builder) do not each have
// to replay the weigh-in history.
//
// A cache with no invalidation drifts, and this one drifted BY CLOCK ALONE:
// every write path called recomputeTarget(), but the resolver's answer also
// depends on `asOf` (the estimator's look-back window slides, weigh-ins go
// stale, the step-cap walk gains a checkpoint). So a user who neither weighed
// in nor edited their profile for a week could open the Plan screen — which
// reads the stored number — and the Engine screen — which resolves live — and
// be shown two different calorie targets. Two numbers, one body.
//
// The fix is reconciliation ON READ, not just on write: `reconcileTarget()`
// resolves live, and if the stored value disagrees the RESOLVER WINS and the
// row is refreshed. Every such correction is logged with both numbers and the
// delta (`[target-drift]`), so drift is diagnosable instead of mysterious.
//
// The target itself is DERIVED (expenditure − rate×500, floor-clamped, then
// walked at most ±STEP_CAP_KCAL per weekly cycle) and is produced by
// adaptiveTarget.resolveAppliedTarget() — the SAME call the Engine screen
// makes, so the number on screen is the number in the database.
const { prisma } = require("./prisma.js");
const { loadHistory, resolveAppliedTarget } = require("./adaptiveTarget.js");
const { todayStr } = require("./dates.js");

/** Shape returned to callers — unchanged from the pre-reconciler contract. */
function report(r, drift) {
  return {
    ...r.target,
    tdee: r.effectiveTdee,
    formulaTdee: r.energy.tdee,
    tdeeSource: r.tdeeSource,
    adaptiveStatus: r.adaptive.status,
    confidence: r.adaptive.confidence || null,
    stepCap: r.stepCap,
    safety: r.safety,
    weightKg: r.weightKg,
    drift,
  };
}

/**
 * Resolve live, compare against the cached row, and make them agree.
 *
 * @param {string}  userId
 * @param {object}  opts
 * @param {string}  opts.asOf    yyyy-mm-dd, defaults to today
 * @param {string}  opts.reason  what triggered this (shows up in the drift log)
 * @param {boolean} opts.write   false → diagnose only, do not touch the row
 * @param {object}  opts.profile   already-loaded row, to save a query
 * @param {object}  opts.resolved  an already-computed resolveAppliedTarget()/
 *                                 adaptiveContext() result for THIS asOf — the
 *                                 read path has one in hand and re-resolving it
 *                                 would be a second answer to the same question
 * @returns {Promise<object|null>} null when the user has no profile yet
 */
async function reconcileTarget(userId, { asOf = todayStr(), reason = "read", write = true, profile: given = null, resolved = null } = {}) {
  const profile = given || await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  let r = resolved;
  if (!r) {
    const { weighins, intake } = await loadHistory(userId);
    r = resolveAppliedTarget({ profile, weighins, intake, asOf });
  }

  const storedKcal = profile.targetKcal;
  const liveKcal = r.target.target;
  const drifted = storedKcal !== liveKcal;
  const drift = {
    storedKcal, liveKcal,
    deltaKcal: Number.isFinite(storedKcal) ? liveKcal - storedKcal : null,
    drifted, reason, asOf,
    authority: "live-resolver",
    refreshed: drifted && write,
  };

  if (drifted && write) {
    await prisma.profile.update({ where: { userId }, data: { targetKcal: liveKcal } });
    // Observable by design: a silent self-heal is indistinguishable from a bug.
    console.log(
      `[target-drift] user=${userId} trigger=${reason} asOf=${asOf} stored=${storedKcal} live=${liveKcal} ` +
      `delta=${drift.deltaKcal > 0 ? "+" : ""}${drift.deltaKcal} source=${r.tdeeSource} ` +
      `status=${r.adaptive.status}${r.stepCap?.capped ? " stepCapped" : ""} — resolver wins, row refreshed`
    );
  }

  return report(r, drift);
}

/**
 * Write-path entry point. Same reconciler, just labelled with what caused it
 * (a weigh-in, a diary entry, a profile edit) so the drift log reads as a
 * story rather than a stream of anonymous corrections.
 */
async function recomputeTarget(userId, asOf = todayStr(), reason = "write") {
  return reconcileTarget(userId, { asOf, reason });
}

module.exports = { recomputeTarget, reconcileTarget };
