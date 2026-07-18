// Materializes the rate-derived calorie target onto the profile row.
// targetKcal is DERIVED state (TDEE − rate×500, floor-clamped) that the
// planner and macro engine read — recompute it whenever the profile or the
// current weight changes so it can never drift from its inputs.
const { prisma } = require("./prisma.js");
const { getWeightNowKg } = require("./weightNow.js");
const { computeEnergy, deriveTarget, rateSafety } = require("./bmrEngine.js");

async function recomputeTarget(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const weightKg = await getWeightNowKg(userId, profile);
  const energy = computeEnergy(profile, weightKg);
  const t = deriveTarget(profile, energy.tdee, energy.rmr);
  const safety = rateSafety(profile, weightKg, energy.tdee, energy.rmr);
  if (profile.targetKcal !== t.target) {
    await prisma.profile.update({ where: { userId }, data: { targetKcal: t.target } });
  }
  return { ...t, tdee: energy.tdee, safety, weightKg };
}

module.exports = { recomputeTarget };
