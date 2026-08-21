// measureCorners.cjs — pool-depth loop measurement. Sweeps every stored
// re-run profile (cust-0301..0400) in-process: planContext → daySolver,
// 2 days × 3 seeds each, and aggregates in-band rate + miss kinds per
// (style × meal-structure) corner. Run from backend/ with
// DATABASE_URL=file:./rebuild-qa.db.
const path = require("path");
const CWD = process.cwd();
const { prisma } = require(path.join(CWD, "src/lib/prisma.js"));
const { planContext } = require(path.join(CWD, "src/lib/planContext.js"));
const { solvePrescriptionDay } = require(path.join(CWD, "src/lib/prescription/daySolver.js"));
const { checkTargetFeasibility } = require(path.join(CWD, "src/lib/prescription/feasibility.js"));
const { makeRng } = require(path.join(CWD, "src/lib/prescription/rng.js"));
const { buildPreferenceBias } = require(path.join(CWD, "src/lib/prescription/preferenceBias.js"));

// same mapping as routes/prescription.js (not exported there)
const FIBER_ALLOWANCE_G = 25;
const KETO_NET_CARB_CEILING_G = 30;
function mapToRulerTargets(dailyTarget, profile) {
  const pLo = Math.max(dailyTarget.proteinLo, dailyTarget.proteinFloorG || 0);
  const pHi = Math.max(dailyTarget.proteinHi, pLo);
  const keto = profile.dietaryStyle === "keto";
  const carnivore = profile.dietaryStyle === "carnivore";
  const netLo = keto || carnivore ? 0 : Math.max(0, dailyTarget.carbLo - FIBER_ALLOWANCE_G);
  const netHi = keto ? dailyTarget.carbHi : Math.max(netLo, dailyTarget.carbHi - FIBER_ALLOWANCE_G);
  const t = { kcal: dailyTarget.kcal, proteinG: { lo: pLo, hi: pHi }, fatG: { lo: dailyTarget.fatLo, hi: dailyTarget.fatHi }, netCarbG: { lo: netLo, hi: netHi } };
  if (Number.isFinite(dailyTarget.floorKcal)) t.floorKcal = dailyTarget.floorKcal;
  if (keto) t.netCarbMaxG = KETO_NET_CARB_CEILING_G;
  if (carnivore) {
    const loNeeded = Math.max(0, Math.floor((t.kcal - 50 - 4 * t.proteinG.hi) / 9));
    const hiNeeded = Math.max(0, Math.ceil((t.kcal + 50 - 4 * t.proteinG.lo) / 9));
    t.fatG = { lo: Math.min(t.fatG.lo, loNeeded), hi: Math.max(t.fatG.hi, hiNeeded) };
  }
  return t;
}

(async () => {
  const users = await prisma.user.findMany({
    where: { email: { gte: "cust-0301@qa.local", lte: "cust-0400@qa.local" } },
    select: { id: true, email: true, profile: { select: { dietaryStyle: true, mealsPerDay: true, snacksPerDay: true, mealPreferencesNote: true } } },
  });
  const corners = new Map(); // key -> {days, ok, empty, misses:{}, examples:[]}
  let profiles = 0;
  for (const u of users) {
    if (!u.profile) continue;
    profiles++;
    const { profile, dailyTarget, mealConfig, recipePool } = await planContext(u.id);
    const targets = mapToRulerTargets(dailyTarget, profile);
    const bias = buildPreferenceBias(profile);
    const style = profile.dietaryStyle || "none";
    const structure = `${mealConfig.meals}m${mealConfig.snacks}s`;
    const key = `${style}|${structure}`;
    const c = corners.get(key) || { days: 0, ok: 0, empty: 0, misses: {}, pool: recipePool.length, examples: [] };
    c.pool = recipePool.length;
    for (const seed of [13, 26, 39]) {
      const rng = makeRng(seed);
      const window = [];
      for (let day = 1; day <= 2; day++) {
        const recentIds = new Set(window.flat());
        const solved = solvePrescriptionDay({ pool: recipePool, targets, mealConfig: { meals: mealConfig.meals, snacks: mealConfig.snacks }, profile, rng, recentIds, bias });
        window.push((solved.slots || []).flatMap((s) => (s.dishes || []).map((d) => d.recipeId)));
        if (window.length > 2) window.shift();
        c.days++;
        if (solved.ok) c.ok++;
        const empties = (solved.slots || []).filter((s) => !s.dishes || !s.dishes.length).length;
        if (empties) c.empty += empties;
        for (const m of solved.verdict?.misses || []) {
          const mk = `${m.key}:${m.kind}`;
          c.misses[mk] = (c.misses[mk] || 0) + 1;
          if (m.by > 10 && c.examples.length < 2) c.examples.push(`${u.email.slice(5, 9)} s${seed}d${day} ${mk} by ${Math.round(m.by)}`);
        }
      }
    }
    corners.set(key, c);
  }
  console.log(`profiles swept: ${profiles}`);
  const rows = [...corners.entries()].map(([k, c]) => ({ k, ...c, okPct: Math.round((c.ok / c.days) * 100) }));
  rows.sort((a, b) => a.okPct - b.okPct);
  console.log("\ncorner                    pool  days  ok%   empty  worst misses");
  for (const r of rows) {
    const top = Object.entries(r.misses).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m}×${n}`).join(" ");
    console.log(`${r.k.padEnd(25)} ${String(r.pool).padStart(4)} ${String(r.days).padStart(5)} ${String(r.okPct).padStart(4)} ${String(r.empty).padStart(6)}  ${top}`);
  }
  const tot = rows.reduce((s, r) => s + r.days, 0), totOk = rows.reduce((s, r) => s + r.ok, 0);
  console.log(`\nTOTAL: ${totOk}/${tot} days in band (${Math.round((totOk / tot) * 100)}%)`);
  for (const r of rows.slice(0, 6)) if (r.examples.length) console.log(`  ${r.k}: ${r.examples.join("; ")}`);
  await prisma.$disconnect();
})();
