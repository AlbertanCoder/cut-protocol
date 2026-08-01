// W1-4 — D6 end-to-end: make classifyBinding actually EMIT the unsound
// "no mix of these recipes reaches the band" sentence about a band the
// shipping ruler would have accepted.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
process.env.BRAIN = "off";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const require_ = createRequire(import.meta.url);
const solver = require_(path.resolve(REPO, "backend/src/lib/mealSolver.js"));

const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

// A day target with a fat band, 3 meals, and a pool deep enough to clear every
// branch that precedes the composition branch in classifyBinding:
//   afterDiet>0 · no prep cap · no stack cap · mealEligible>0 ·
//   mealEligible*repeatCap >= mealSlots · snack slots 0 · protein density OK
const dailyTarget = {
  kcal: 2000, proteinLo: 140, proteinHi: 160, proteinMid: 150,
  fatLo: 60, fatHi: 80, fatMid: 70, carbLo: 180, carbHi: 220, carbMid: 200, keto: false,
};
const mealConfig = { meals: 3, snacks: 0 };

// fat-per-kcal chosen so: poolHi*2000 = 41.0 g < allowLoG 42.5  -> "short"
//                         poolHi*2300 = 47.15 g > allowLoG      -> reachable in-gate
const PER_KCAL = 0.0205;
// protein density must clear the PROTEIN_DENSITY branch: needs
// dense >= max(10, meals*4) = 12 recipes with protein/kcal >= 0.75*(150/2000)
const pool = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i}`, name: `dish ${i}`,
  kcal: 500 + i * 5,
  protein: (500 + i * 5) * 0.085,          // 8.5 g P /100 kcal — well above 5.6 needed
  fat: (500 + i * 5) * PER_KCAL,
  carb: (500 + i * 5) * 0.11,
  slotType: "either", mealCategory: "main", mealType: "dinner",
}));

const FAT_TOL = solver.DAY_FAT_TOLERANCE_PCT;
const allowLoG = Math.max(0, dailyTarget.fatLo - dailyTarget.fatMid * FAT_TOL);
const allowHiG = dailyTarget.fatHi + dailyTarget.fatMid * FAT_TOL;
const poolHi = Math.max(...pool.map((r) => r.fat / r.kcal));
const poolLo = Math.min(...pool.map((r) => r.fat / r.kcal));

const binding = solver.classifyBinding({
  counts: { raw: pool.length, afterDiet: pool.length, afterPrep: pool.length },
  filters: {}, dailyTarget, mealConfig, pool, days: 1,
});

// The counterexample: the same pool, portioned to the TOP of the kcal gate.
const kcalHi = dailyTarget.kcal * (1 + solver.DAY_KCAL_TOLERANCE_PCT);
const base = pool.slice(0, 3).reduce((a, r) => ({
  kcal: a.kcal + r.kcal, protein: a.protein + r.protein, fat: a.fat + r.fat, carb: a.carb + r.carb,
}), { kcal: 0, protein: 0, fat: 0, carb: 0 });
const k = kcalHi / base.kcal;
const day = { kcal: base.kcal * k, protein: base.protein * k, fat: base.fat * k, carb: base.carb * k };
const tol = solver.dayTolerance(dailyTarget, day);

const out = {
  claim: "D6 — compositionReach() evaluates the pool's fat-per-kcal at the EXACT kcal target (mealSolver.js:1047-1048) while dayTolerance grades kcal at +/-15%, so `unreachable` is decided on a strict SUBSET of the reachable interval and false-fires by ~15% in both directions.",
  band: { fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi, allowLoG, allowHiG },
  poolFatPerKcal: { poolLo: round(poolLo, 5), poolHi: round(poolHi, 5) },
  whatCompositionReachTests: {
    atKcal: dailyTarget.kcal,
    reachLoG: round(poolLo * dailyTarget.kcal), reachHiG: round(poolHi * dailyTarget.kcal),
    verdict: poolHi * dailyTarget.kcal < allowLoG ? "short (UNREACHABLE)" : "reachable",
  },
  whatTheRulerActuallyAllows: {
    kcalLo: dailyTarget.kcal * 0.85, kcalHi,
    reachHiG_atKcalHi: round(poolHi * kcalHi),
    insideAllowedFatWindow: poolHi * kcalHi >= allowLoG && poolHi * kcalHi <= allowHiG,
  },
  bindingEmitted: binding,
  emitsTheUnsoundSentence: binding.key === "macro-composition" && /no mix of these recipes reaches the band/.test(binding.detail),
  counterexampleDay: {
    kcal: round(day.kcal, 1), protein: round(day.protein, 1), fat: round(day.fat, 1), carb: round(day.carb, 1),
    kcalOk: tol.kcalOk, proteinOk: tol.proteinOk, fatOk: tol.fatOk, carbOk: tol.carbOk,
  },
  falseFireMagnitudePct: solver.DAY_KCAL_TOLERANCE_PCT * 100,
  directionality: "Symmetric: the OVER side false-fires the same way at kcalLo (reachLoG is tested at 1.00x when the day may legally ship at 0.85x, which lowers delivered grams by 15%).",
};
fs.writeFileSync("fleet/out/W1-4/d6.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
