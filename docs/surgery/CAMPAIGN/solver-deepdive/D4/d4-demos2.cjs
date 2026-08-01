// D4 — demos 3/4/5, with recipe fixtures that pass eligibleRecipes().
const path = require("node:path");
const S = path.resolve("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/mealSolver.js");
const { classifyBinding, alternatesForSlot, solveOneMeal } = require(S);

const T = { kcal: 2400, proteinLo: 182, proteinHi: 200, fatLo: 54, fatHi: 64, carbLo: 168, carbHi: 192, keto: false };
const fatMid = (T.fatLo + T.fatHi) / 2;          // 59
const allowHiG = T.fatHi + 0.25 * fatMid;        // 78.75
const allowLoG = T.fatLo - 0.25 * fatMid;        // 39.25

// A meal-eligible, protein-DENSE recipe with a chosen fat-per-kcal.
let n = 0;
const mk = (kcal, protein, fatPerKcal, carb = 40) => {
  const id = `r${++n}`;
  const fat = kcal * fatPerKcal;
  return {
    id, name: id, slotType: "meal", mealCategory: "main", kcal, protein, fat, carb,
    prepTimeMin: 20,
    ingredients: [
      { foodId: `${id}p`, name: "prot", role: "protein", baseGrams: 150, scalable: true, food: { name: "prot", kcal: (kcal * 0.5) / 1.5, protein: protein / 1.5, fat: (fat * 0.3) / 1.5, carb: 0 } },
      { foodId: `${id}s`, name: "side", role: "side", baseGrams: 100, scalable: true, food: { name: "side", kcal: kcal * 0.5, protein: 0, fat: fat * 0.7, carb } },
    ],
  };
};

console.log("=== DEMO 3: compositionReach uses the POINT kcal target, not the +/-15% kcal window ===");
// fat-per-kcal chosen so the pool's MINIMUM lands just above the allowed ceiling
// at exactly targetKcal, but comfortably inside it at 0.85 x targetKcal.
const perKcal = (allowHiG + 1) / T.kcal;
const pool3 = [];
for (let i = 0; i < 14; i++) pool3.push(mk(600, 50, perKcal + i * 0.0002));
const b3 = classifyBinding({ counts: { raw: pool3.length, afterDiet: pool3.length, afterPrep: pool3.length }, filters: {}, dailyTarget: T, mealConfig: { meals: 3, snacks: 0 }, pool: pool3, days: 1 });
console.log("  binding.key :", b3.key);
console.log("  detail      :", b3.detail);
console.log(`  allowed fat window: ${allowLoG.toFixed(1)} .. ${allowHiG.toFixed(1)} g`);
console.log(`  pool fat at EXACT target kcal (2400): ${(perKcal * 2400).toFixed(1)} g  -> above ceiling`);
console.log(`  pool fat at 0.85x kcal (2040, still inside the +/-15% kcal gate): ${(perKcal * 2040).toFixed(1)} g  -> ${perKcal * 2040 <= allowHiG ? "INSIDE the allowed window" : "still out"}`);
console.log(`  => the "no mix of these recipes reaches the band" sentence is ${perKcal * 2040 <= allowHiG && b3.key === "macro-composition" ? "FALSE for this pool" : "n/a"}`);

console.log("\n=== DEMO 4: the protein-density branch (L1121) pre-empts the composition branch (L1131) ===");
const pool4 = [];
for (let i = 0; i < 14; i++) pool4.push(mk(600, 6, 0.05)); // protein-thin, fat fine
const obs = { totalDays: 1, fatOffDays: 1, carbOffDays: 0, kcalOffDays: 0, proteinShortDays: 0 };
const b4 = classifyBinding({ counts: { raw: 14, afterDiet: 14, afterPrep: 14 }, filters: {}, dailyTarget: T, mealConfig: { meals: 3, snacks: 0 }, pool: pool4, days: 1, observed: obs });
console.log("  observed says: 1/1 day failed FAT, 0 days failed protein");
console.log("  binding.key reported:", b4.key, "->", b4.detail.slice(0, 90) + "...");
console.log(`  => observed is IGNORED by every branch above L1131: ${b4.key === "protein-density" ? "CONFIRMED" : "not reproduced"}`);

console.log("\n=== DEMO 5: alternatesForSlot returns UNSORTED; [0] is called 'best' ===");
(async () => {
  const pool5 = [mk(1100, 25), mk(620, 46), mk(850, 33), mk(700, 40), mk(520, 52)].map((r, i) => ({ ...r, fat: 20 + i, carb: 40 }));
  const st = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget: 620, proteinTarget: 46 };
  let inversions = 0, trials = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let s = seed * 7919;
    const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alts = await alternatesForSlot({ slotTarget: st, recipePool: pool5, existingSlots: [], count: 3, rng });
    if (alts.length < 2) continue;
    trials++;
    const best = Math.max(...alts.map((x) => x.matchPct));
    if (alts[0].matchPct !== best) inversions++;
    if (seed <= 3) console.log(`  seed ${seed}: returned ${alts.map((x) => `${x.recipeId}=${x.matchPct}%`).join(" ")}  | [0] is best? ${alts[0].matchPct === best}`);
  }
  console.log(`  => over ${trials} draws, options[0] was NOT the highest-matchPct option in ${inversions} (${((inversions / Math.max(1, trials)) * 100).toFixed(0)}%)`);

  const om = await solveOneMeal({
    dailyTarget: T, remaining: { kcal: 620, protein: 46 }, mealConfig: { meals: 3, snacks: 0 },
    recipePool: pool5, filters: {}, basis: "full-day", count: 3,
    rng: (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })(),
    clock: () => 0,
  });
  console.log(`  solveOneMeal: options ${om.options.map((o) => `${o.recipeId}=${o.matchPct}%`).join(" ")}`);
  console.log(`  solveOneMeal: best = ${om.best?.recipeId} (${om.best?.matchPct}%)  fits=${om.fits}  miss=${om.miss || "null"}`);
  console.log("  NOTE: `fits` is computed on kcal + protein ONLY (mealSolver.js:1419) — fat/carb are never judged on this path.");
})();
