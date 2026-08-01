// W1-4 — E6 refined: compare the OPEN-slot solve only (the earlier check
// compared day totals, which include the lock's own kcal and so differ by
// construction between a 100% and a 130% lock).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
process.env.BRAIN = "off";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
const dbPath = path.resolve(REPO, "fleet/scratch/W1-4/dev.db");
if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — SHARED dev.db");
if (!fs.existsSync(dbPath)) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); fs.copyFileSync(SHARED_DB, dbPath); }
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;

const require_ = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const solver = require_(path.join(B, "src/lib/mealSolver.js"));
const wp = require_(path.join(B, "src/lib/weeklyPlanner.js"));
const { prisma } = require_(path.join(B, "src/lib/prisma.js"));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

const dailyTarget = {
  kcal: 2000, proteinLo: 150, proteinHi: 170, proteinMid: 160,
  fatLo: 55, fatHi: 65, fatMid: 60, carbLo: 180, carbHi: 220, carbMid: 200, keto: false,
};
const mealConfig = { meals: 3, snacks: 0 };

const pool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
const dayTargets = wp.targetsForSlots(dailyTarget, wp.buildSlots(mealConfig));

const arms = {};
for (const lockPct of [0, 0.5, 0.99, 1.0, 1.3, 2.0]) {
  const locked = lockPct > 0 ? [{
    dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: pool[0].id,
    proteinScale: 1, sidesScale: 1, ingredients: [],
    kcal: dailyTarget.kcal * lockPct, protein: 60, fat: 40, carb: 100,
    locked: true, warning: null,
  }] : [];
  const { slots } = await wp.solveDay(
    dayTargets, dailyTarget, pool, new Map(), new Set(), mulberry32(424242),
    null, null, 2, null, locked.length ? wp.buildLockedMap(locked) : null
  );
  const open = slots.filter((s) => !s.locked);
  const sum = (xs, k) => xs.reduce((a, s) => a + (s[k] || 0), 0);
  arms[`lock_${Math.round(lockPct * 100)}pct`] = {
    lockedKcal: r2(dailyTarget.kcal * lockPct, 0),
    budgetKcal: r2(Math.max(0, dailyTarget.kcal - dailyTarget.kcal * lockPct), 1),
    openSlotTargetKcalEach: r2(Math.max(0, dailyTarget.kcal - dailyTarget.kcal * lockPct) / (open.length || 1), 1),
    OPEN_SLOTS_ONLY: {
      count: open.length, filled: open.filter((s) => s.recipeId).length,
      kcal: r2(sum(open, "kcal"), 0), protein: r2(sum(open, "protein")),
      fat: r2(sum(open, "fat")), carb: r2(sum(open, "carb")),
      warnings: open.filter((s) => s.warning).length,
      recipeIds: open.map((s) => s.recipeId).join(","),
    },
  };
}

const k100 = arms.lock_100pct.OPEN_SLOTS_ONLY;
const k130 = arms.lock_130pct.OPEN_SLOTS_ONLY;
const k200 = arms.lock_200pct.OPEN_SLOTS_ONLY;
const k99 = arms.lock_99pct.OPEN_SLOTS_ONLY;

const out = {
  claim: "E6 — a locked slot carrying >=100% of the day's calorie budget floors budgetKcal to 0 (weeklyPlanner.js:889 Math.max(0,...)). Every open slot then gets kcalTarget=0 and proteinTarget=0 (:896-897). kcalOffPct(0,x) and proteinShortfallPct(0,x) BOTH return 0 by their `target > 0 ? ... : 0` guard (:420-428), so worstRatio=0 and the accept gate at :630 passes on the FIRST recipe drawn, for every slot, with warning:null.",
  arms,
  gateIsDead_at100pct: k100.warnings === 0,
  gateIsAlive_justBelow: { at99pct_warnings: k99.warnings, at100pct_warnings: k100.warnings },
  lock100_vs_130_openSolveIdentical:
    k100.recipeIds === k130.recipeIds && k100.kcal === k130.kcal && k100.fat === k130.fat && k100.warnings === k130.warnings,
  lock100_vs_200_openSolveIdentical:
    k100.recipeIds === k200.recipeIds && k100.kcal === k200.kcal && k100.fat === k200.fat,
  worstCase: {
    dayTargetKcal: dailyTarget.kcal,
    fatBand: `${dailyTarget.fatLo}-${dailyTarget.fatHi} g`,
    at100pctLock_shippedByOpenSlots: `${k100.kcal} kcal, ${k100.fat} g fat, ${k100.carb} g carb`,
    dayTotalAt100pctLock: `${r2(k100.kcal + dailyTarget.kcal, 0)} kcal on a ${dailyTarget.kcal} kcal target`,
    slotWarnings: k100.warnings,
  },
  populationVisibility: "0 of 250 fleet personas lock any slot, so this vector is INVISIBLE to every fleet level number. It is reachable only through the Plan tab's lock affordance.",
};
fs.writeFileSync("fleet/out/W1-4/e6.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await prisma.$disconnect();
