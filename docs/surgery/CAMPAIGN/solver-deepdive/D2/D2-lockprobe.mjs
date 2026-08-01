// D2-lockprobe.mjs — the locked-slot path the persona rig never exercises.
//
// The rig population carries lockedSlots for 0 of 250 personas, so everything
// solveDay does with locks is unmeasured. This calls solveDay DIRECTLY with a
// lock that consumes most/all of the day's budget and reports what the open
// slots are then asked for and what they ship. No HTTP, no writes.

import path from "node:path";
import { createRequire } from "node:module";
import { prepareAgentDb, assertIsolated, REPO } from "../../solver-brain/A1/rig/dbcopy.mjs";

process.env.BRAIN = "off";
prepareAgentDb("D2");
assertIsolated("D2");
const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const wp = require(path.join(B, "src/lib/weeklyPlanner.js"));
const planCtx = require(path.join(B, "src/lib/planContext.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dailyTarget = {
  kcal: 2000, proteinLo: 140, proteinHi: 160,
  fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210,
};

const main = async () => {
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const pool = planCtx.filterRecipePool(rawPool, { dietaryStyle: null, excludedFoods: [] });
  const mealConfig = { meals: 3, snacks: 1 };
  const dayTargets = wp.targetsForSlots(dailyTarget, wp.buildSlots(mealConfig, [0]));
  console.log(`pool ${pool.length} · dayTargets:`);
  for (const t of dayTargets) console.log(`   ${t.slotType}#${t.slotIndex} w=${t.weight} kcal=${t.kcalTarget.toFixed(0)} protein=${t.proteinTarget.toFixed(0)}`);

  const scenarios = [
    { name: "no lock (control)", locked: [] },
    { name: "lock meal#0 at 1200 kcal (60% of day)", locked: [{ dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: pool[0].id, kcal: 1200, protein: 90, fat: 45, carb: 100, ingredients: [], proteinScale: 1, sidesScale: 1 }] },
    { name: "lock meal#0 at 2000 kcal (100% of day)", locked: [{ dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: pool[0].id, kcal: 2000, protein: 160, fat: 65, carb: 210, ingredients: [], proteinScale: 1, sidesScale: 1 }] },
    { name: "lock meal#0 at 2600 kcal (130% of day)", locked: [{ dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: pool[0].id, kcal: 2600, protein: 200, fat: 95, carb: 260, ingredients: [], proteinScale: 1, sidesScale: 1 }] },
  ];

  for (const sc of scenarios) {
    const lockedByKey = wp.buildLockedMap(sc.locked);
    const usage = new Map();
    if (lockedByKey) for (const s of lockedByKey.values()) usage.set(s.recipeId, 1);
    const { slots } = await wp.solveDay(
      dayTargets, dailyTarget, pool, usage, new Set(), mulberry32(424242),
      null, null, wp.DEFAULT_REPEAT_CAP, null, lockedByKey, null
    );
    const t = slots.reduce((a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein, fat: a.fat + s.fat, carb: a.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
    console.log(`\n### ${sc.name}`);
    for (const s of slots) {
      console.log(`   ${s.slotType}#${s.slotIndex}${s.locked ? " [LOCKED]" : "        "}  kcal ${s.kcal.toFixed(0).padStart(5)}  protein ${s.protein.toFixed(0).padStart(4)}  fat ${s.fat.toFixed(0).padStart(4)}  ps/ss ${s.proteinScale}/${s.sidesScale}${s.warning ? "  WARN: " + s.warning.slice(0, 70) : ""}`);
    }
    console.log(`   DAY TOTAL kcal ${t.kcal.toFixed(0)} (target ${dailyTarget.kcal}, ${((t.kcal / dailyTarget.kcal - 1) * 100).toFixed(0)}%)  fat ${t.fat.toFixed(0)} (band ${dailyTarget.fatLo}-${dailyTarget.fatHi})`);
  }
  await prisma.$disconnect();
};
main();
