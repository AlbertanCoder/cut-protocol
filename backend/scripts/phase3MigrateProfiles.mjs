// One-time Phase 3 data migration (run after the schema migration):
// - derive each profile's rateLbPerWeek from its pre-Phase-3 targetKcal
//   (nearest allowed option to the implied deficit) so nobody's prescription
//   jumps to an arbitrary default
// - admin account keeps its personal 2,000 kcal floor — as DATA on its row,
//   not as code (the old engine hardcoded it for everyone)
// - re-materialize targetKcal through the new engine and print old vs new
import "dotenv/config";
import prismaPkg from "../src/lib/prisma.js";
import bmrPkg from "../src/lib/bmrEngine.js";
import weightPkg from "../src/lib/weightNow.js";
import targetPkg from "../src/lib/profileTarget.js";

const { prisma } = prismaPkg;
const { computeEnergy, RATE_OPTIONS } = bmrPkg;
const { getWeightNowKg } = weightPkg;
const { recomputeTarget } = targetPkg;

const nearestRate = (r) => RATE_OPTIONS.reduce((best, o) => (Math.abs(o - r) < Math.abs(best - r) ? o : best), RATE_OPTIONS[0]);

async function main() {
  const profiles = await prisma.profile.findMany({ include: { user: { select: { email: true, role: true } } } });
  for (const p of profiles) {
    const weightKg = await getWeightNowKg(p.userId, p);
    const energy = computeEnergy(p, weightKg);
    const impliedRate = (energy.tdee - p.targetKcal) / 500;
    const rate = nearestRate(Math.min(2.0, Math.max(0.25, impliedRate)));
    const floorKcal = p.user.role === "admin" ? 2000 : p.floorKcal;

    await prisma.profile.update({ where: { id: p.id }, data: { rateLbPerWeek: rate, floorKcal } });
    const result = await recomputeTarget(p.userId);
    console.log(
      `${p.user.email}: tdee ${energy.tdee}, old target ${p.targetKcal} (implied ${impliedRate.toFixed(2)} lb/wk) → rate ${rate}, floor ${floorKcal ?? "sex-default"}, new target ${result.target}${result.floored ? " (floored)" : ""}`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
