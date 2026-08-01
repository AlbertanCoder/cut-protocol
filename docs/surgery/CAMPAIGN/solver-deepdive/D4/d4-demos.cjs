// D4 — behavioural demonstrations. These CALL the shipped functions on purpose:
// the claim under test is "the function behaves like X", not "the ruler is Y".
const path = require("node:path");
const S = path.resolve("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/mealSolver.js");
const { scoreDay, dayTolerance, dayInTolerance, classifyBinding, alternatesForSlot } = require(S);

// A realistic non-keto target: lbm 160 lb -> P 182/200, fat 54/64, carbs mid 180.
const T = { kcal: 2400, proteinLo: 182, proteinHi: 200, fatLo: 54, fatHi: 64, carbLo: 168, carbHi: 192, keto: false };
const pMid = (T.proteinLo + T.proteinHi) / 2;
const one = (o) => [{ kcal: o.kcal, protein: o.protein, fat: o.fat, carb: o.carb }];
const show = (name, o) => {
  const t = dayTolerance(T, o);
  const s = scoreDay(T, one(o));
  console.log(`  ${name.padEnd(46)} matchPct=${String(s.matchPct).padStart(3)}  inTolerance=${dayInTolerance(t)}  [k${t.kcalOk ? "+" : "-"} p${t.proteinOk ? "+" : "-"} f${t.fatOk ? "+" : "-"} c${t.carbOk ? "+" : "-"}]`);
  return { m: s.matchPct, ok: dayInTolerance(t) };
};

console.log("\n=== DEMO 1: does matchPct rank an OUT-of-tolerance day above an IN-tolerance one? ===");
console.log("  (generateDayCandidates sorts candidates by matchPct ALONE — mealSolver.js:504)");
// A: inside tolerance on all four, but spends nearly the whole kcal + protein allowance
const A = { kcal: 2400 * 1.14, protein: pMid * 0.86, fat: 64 + 0.25 * 59, carb: 180 };
// B: OUTSIDE tolerance — protein 16% short — but perfect on everything else
const B = { kcal: 2400, protein: pMid * 0.84, fat: 59, carb: 180 };
const a = show("A  in-tolerance (kcal +14%, prot -14%, fat at line)", A);
const b = show("B  OUT of tolerance (protein 16% short)", B);
console.log(`  => ranking inversion: ${b.m > a.m && b.ok === false && a.ok === true ? "YES — B (a miss) is offered FIRST" : "no"}`);
// C: OUTSIDE tolerance on kcal only
const C = { kcal: 2400 * 1.16, protein: pMid, fat: 59, carb: 180 };
const c = show("C  OUT of tolerance (kcal +16%)", C);
console.log(`  => C over A: ${c.m > a.m ? "YES" : "no"}`);

console.log("\n=== DEMO 2: matchPct's fat/carb terms saturate — how bad can a 'good' score be? ===");
show("fat 3x its band ceiling, all else perfect", { kcal: 2400, protein: pMid, fat: 64 * 3, carb: 180 });
show("fat AND carb both wildly out, kcal+protein perfect", { kcal: 2400, protein: pMid, fat: 200, carb: 500 });
console.log("  => floor on matchPct for a day failing BOTH composition macros = 100 - 12 - 12 = 76");

console.log("\n=== DEMO 3: compositionReach uses the POINT kcal target, not the +/-15% window ===");
// pool whose fat-per-kcal minimum lands just above the allowed ceiling at exact kcal,
// but inside it at 0.85x kcal — a legal in-tolerance day.
const allowHiG = 64 + 0.25 * 59; // 78.75 g
const perKcalNeeded = (allowHiG + 0.5) / 2400; // just OVER the ceiling at exact kcal
const pool = [
  { id: "r1", kcal: 600, fat: 600 * perKcalNeeded, carb: 45, protein: 45 },
  { id: "r2", kcal: 700, fat: 700 * (perKcalNeeded + 0.004), carb: 50, protein: 50 },
];
const bind = classifyBinding({ counts: { raw: 2, afterDiet: 2, afterPrep: 2 }, filters: {}, dailyTarget: T, mealConfig: { meals: 3, snacks: 0 }, pool, days: 1 });
console.log("  binding:", bind.key);
console.log("  detail :", bind.detail);
const fatAt085 = 0.85 * 2400 * perKcalNeeded;
console.log(`  fat the SAME pool delivers at 0.85x kcal (still inside the +/-15% kcal gate): ${fatAt085.toFixed(1)} g`);
console.log(`  allowed fat ceiling: ${allowHiG.toFixed(1)} g  ->  reachable in reality? ${fatAt085 <= allowHiG ? "YES" : "no"}`);
console.log(`  => classifyBinding says "no mix of these recipes reaches the band": ${bind.key === "macro-composition" ? "and that is FALSE here" : "n/a"}`);

console.log("\n=== DEMO 4: classifyBinding's protein-density branch pre-empts composition ===");
// same pool but protein-thin; observed says the solve failed on FAT only.
const thin = [{ id: "a", kcal: 600, protein: 5, fat: 20, carb: 90 }, { id: "b", kcal: 500, protein: 4, fat: 18, carb: 80 }];
const obs = { totalDays: 7, fatOffDays: 7, carbOffDays: 0, kcalOffDays: 0, proteinShortDays: 0 };
const bind2 = classifyBinding({ counts: { raw: 2, afterDiet: 2, afterPrep: 2 }, filters: {}, dailyTarget: T, mealConfig: { meals: 3, snacks: 0 }, pool: thin, days: 7, observed: obs });
console.log("  observed: 7/7 days failed FAT, 0 failed protein.  binding reported:", bind2.key);

console.log("\n=== DEMO 5: alternatesForSlot returns UNSORTED; solveOneMeal calls [0] 'best' ===");
(async () => {
  const mk = (id, kcal, protein) => ({
    id, name: id, mealType: "meal", kcal, protein, fat: kcal * 0.03, carb: kcal * 0.08,
    ingredients: [{ foodId: `f${id}`, name: "x", role: "protein", baseGrams: 100, scalable: true, food: { name: "x", kcal, protein, fat: kcal * 0.03, carb: kcal * 0.08 } }],
  });
  const p = [mk("far", 900, 20), mk("near", 600, 45), mk("mid", 750, 30)];
  const st = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget: 600, proteinTarget: 45 };
  let i = 0; const rng = () => [0.05, 0.5, 0.95, 0.2, 0.7, 0.4, 0.9, 0.1, 0.6, 0.3, 0.8, 0.15][i++ % 12];
  const alts = await alternatesForSlot({ slotTarget: st, recipePool: p, existingSlots: [], count: 3, rng });
  console.log("  returned order:", alts.map((x) => `${x.recipeId}(${x.matchPct}%)`).join("  "));
  const sorted = [...alts].sort((x, y) => y.matchPct - x.matchPct).map((x) => x.recipeId).join(",");
  console.log("  sorted-by-matchPct order would be:", sorted);
  console.log(`  => options[0] is the best-scoring option? ${alts.length ? (alts[0].matchPct === Math.max(...alts.map((x) => x.matchPct)) ? "yes (this draw)" : "NO") : "n/a"}`);
})();
