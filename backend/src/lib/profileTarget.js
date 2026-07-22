// Materializes the calorie target onto the profile row.
//
// targetKcal is DERIVED state (expenditure − rate×500, floor-clamped) that the
// planner and macro engine read — recompute it whenever the profile, the weight
// history, or the food log changes so it can never drift from its inputs.
//
// The expenditure it subtracts from is resolved by adaptiveTarget.resolveEnergy():
// the intake-vs-weight reconciliation when there is enough data to support one,
// the formula TDEE otherwise. Both paths run through the SAME function the
// Engine screen renders, so the number on screen is the number in the database.
const { prisma } = require("./prisma.js");
const { loadHistory, resolveEnergy } = require("./adaptiveTarget.js");
const { todayStr } = require("./dates.js");

async function recomputeTarget(userId, asOf = todayStr()) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const { weighins, intake } = await loadHistory(userId);
  const r = resolveEnergy({ profile, weighins, intake, asOf });
  if (profile.targetKcal !== r.target.target) {
    await prisma.profile.update({ where: { userId }, data: { targetKcal: r.target.target } });
  }
  return {
    ...r.target,
    tdee: r.effectiveTdee,
    formulaTdee: r.energy.tdee,
    tdeeSource: r.tdeeSource,
    adaptiveStatus: r.adaptive.status,
    safety: r.safety,
    weightKg: r.weightKg,
  };
}

module.exports = { recomputeTarget };
