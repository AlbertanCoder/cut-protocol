// D1 — final probes: what the SLOT reports when the portioning solve is pinned
// or degenerate. READ-ONLY on a COPY of dev.db.
import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const wp = require("./src/lib/weeklyPlanner.js");

const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } }, take: 400 });
const out = {};
const mk = (r) => ({ ...r, slotType: "either" });
const T = (kcalTarget, proteinTarget, extra = {}) => ({ dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget, proteinTarget, ...extra });
const run = (t, pool) => wp.resolveSlot(t, pool, new Map(), new Set(), new Set(), () => 0.5, null, null, 99);

// pick a recipe that will certainly be forced to the FLOOR for a small slot
const big = recipes.filter((r) => r.kcal > 900).sort((a, b) => b.kcal - a.kcal)[0];
const small = recipes.filter((r) => r.kcal > 0 && r.kcal < 150).sort((a, b) => a.kcal - b.kcal)[0];

const floorRes = await run(T(200, 15), [mk(big)]);
out.forcedToFloor = {
  recipe: big.name, baseKcal: Math.round(big.kcal), slotKcalTarget: 200,
  proteinScale: floorRes.proteinScale, sidesScale: floorRes.sidesScale,
  shippedKcal: Math.round(floorRes.kcal), overshootPct: +(100 * (floorRes.kcal - 200) / 200).toFixed(1),
  warning: floorRes.warning,
  fieldsOnResult: Object.keys(floorRes).sort(),
  anyFieldNamingTheBound: Object.keys(floorRes).filter((k) => /pin|bound|clamp|limit|floor|ceil/i.test(k)),
};

const ceilRes = await run(T(900, 60), [mk(small)]);
out.forcedToCeiling = {
  recipe: small.name, baseKcal: Math.round(small.kcal), slotKcalTarget: 900,
  proteinScale: ceilRes.proteinScale, sidesScale: ceilRes.sidesScale,
  shippedKcal: Math.round(ceilRes.kcal), warning: ceilRes.warning,
};

// a floor pin that still passes the kcal/protein gate ships warning:null
let quietPins = 0, loudPins = 0;
for (const r of recipes) {
  for (const kt of [300, 450, 600]) {
    const res = await run(T(kt, kt * 0.075), [mk(r)]);
    if (!res.recipeId) continue;
    if (res.proteinScale === 0.5 || res.sidesScale === 0.5) { if (res.warning) loudPins++; else quietPins++; }
  }
}
out.floorPinReporting = {
  pinnedSlotsWithNoWarning: quietPins, pinnedSlotsWithWarning: loudPins,
  quietPct: +(100 * quietPins / Math.max(1, quietPins + loudPins)).toFixed(2),
  note: "a floor-pinned portion that still lands inside the kcal/protein tolerance ships with warning:null — nothing on the record says the solve ran out of room",
};

// zero / absent target: does the slot ship a half portion and call it a fit?
const zeroRes = await run(T(0, 0), [mk(big)]);
out.zeroTargetSlot = {
  proteinScale: zeroRes.proteinScale, sidesScale: zeroRes.sidesScale,
  shippedKcal: Math.round(zeroRes.kcal), warning: zeroRes.warning,
  verdict: zeroRes.recipeId && !zeroRes.warning ? "SHIPS A HALF PORTION AND REPORTS NO MISS" : "reported",
};
const nanRes = await run(T(600, undefined), [mk(big)]);
out.absentProteinTargetSlot = {
  proteinScale: nanRes.proteinScale, sidesScale: nanRes.sidesScale,
  shippedKcal: Math.round(nanRes.kcal), warning: nanRes.warning,
};

// enforceScaledCarbCeiling is a no-op unless dietaryStyle === "keto"
const s0 = wp.scaleRecipe(big, 600, 45);
out.carbCeilingScope = {
  nullStyle: wp.enforceScaledCarbCeiling(big, s0, null) === s0,
  veganStyle_unchanged: wp.enforceScaledCarbCeiling(big, s0, "vegan") === s0,
  note: "dietaryFilter.js:1866 returns false unless dietaryStyle === 'keto', so the trim loop runs for keto only",
};

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
