// D4 — DEMO 5, sharpened. Pool where the scale band bites differently per dish,
// so the offered alternates carry genuinely different matchPct values.
const path = require("node:path");
const S = path.resolve("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/mealSolver.js");
const { alternatesForSlot, solveOneMeal } = require(S);

let n = 0;
// single scalable "side" ingredient => scaleRecipe falls back to one uniform
// scale clamped to 0.5-2x, so each dish's reachable kcal is a fixed interval.
const mk = (kcal, protein) => {
  const id = `r${++n}_${kcal}`;
  return {
    id, name: id, slotType: "meal", mealCategory: "main", kcal, protein, fat: kcal * 0.03, carb: kcal * 0.08, prepTimeMin: 15,
    ingredients: [{ foodId: `${id}s`, name: "side", role: "side", baseGrams: 100, scalable: true, food: { name: "side", kcal, protein, fat: kcal * 0.03, carb: kcal * 0.08 } }],
  };
};

const T = { kcal: 2400, proteinLo: 182, proteinHi: 200, fatLo: 54, fatHi: 64, carbLo: 168, carbHi: 192, keto: false };
const st = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget: 620, proteinTarget: 46 };
//   exact fit | slightly-off fit | unreachable (max 2x = 380) | unreachable (min .5x = 900)
const pool = [mk(620, 46), mk(560, 42), mk(190, 14), mk(1800, 130)];

(async () => {
  let inv = 0, trials = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let s = seed * 7919;
    const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alts = await alternatesForSlot({ slotTarget: st, recipePool: pool, existingSlots: [], count: 3, rng });
    if (alts.length < 2) continue;
    trials++;
    const best = Math.max(...alts.map((x) => x.matchPct));
    if (alts[0].matchPct !== best) {
      inv++;
      if (inv <= 3) console.log(`  seed ${seed}: ${alts.map((x) => `${x.recipeId}=${x.matchPct}%`).join("  ")}   <-- [0] is NOT best`);
    }
  }
  console.log(`\n  options[0] was NOT the highest-matchPct alternate in ${inv} of ${trials} draws (${((inv / Math.max(1, trials)) * 100).toFixed(0)}%)`);

  for (const seed of [1, 2, 3]) {
    let s = seed * 31337;
    const om = await solveOneMeal({
      dailyTarget: T, remaining: { kcal: 620, protein: 46 }, mealConfig: { meals: 3, snacks: 0 },
      recipePool: pool, filters: {}, basis: "full-day", count: 3,
      rng: () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff), clock: () => 0,
    });
    const best = Math.max(...om.options.map((o) => o.matchPct));
    console.log(`  solveOneMeal seed ${seed}: options ${om.options.map((o) => `${o.recipeId}=${o.matchPct}%`).join(" ")} | "best"=${om.best?.recipeId}(${om.best?.matchPct}%) ${om.best?.matchPct === best ? "" : "<-- NOT the best-scoring option"} fits=${om.fits}`);
  }
})();
