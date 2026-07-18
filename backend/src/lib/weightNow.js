const { prisma } = require("./prisma.js");

// Same "current weight" definition used by the Engine tab: 7-day average
// of the most recent weigh-ins, falling back to the profile's start weight
// if there isn't enough data yet.
async function getWeightNowKg(userId, profile) {
  const weighins = await prisma.weighin.findMany({
    where: { userId }, orderBy: { date: "asc" },
  });
  const last7 = weighins.slice(-7);
  if (last7.length === 0) return profile.startWeightKg;
  return last7.reduce((s, w) => s + w.weightKg, 0) / last7.length;
}

module.exports = { getWeightNowKg };
