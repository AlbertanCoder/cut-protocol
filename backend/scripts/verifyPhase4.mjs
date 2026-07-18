// Phase 4 verification against the REAL recipe pool: 5 fake profiles ×
// diets → week solve + day candidates + grocery list. Read-only.
//
// The honesty contract being asserted: every profile either lands ≥6/7 days
// inside tolerance, OR the solver ships closest fits WITH a non-empty
// diagnosis naming the binding constraint AND a warning label on every
// rough day. Allergy/style compliance is zero-tolerance either way.
import "dotenv/config";
import assert from "node:assert/strict";
import prismaPkg from "../src/lib/prisma.js";
import solverPkg from "../src/lib/mealSolver.js";
import dietPkg from "../src/lib/dietaryFilter.js";
import groceryPkg from "../src/lib/groceryList.js";
import unitsPkg from "../src/lib/purchaseUnits.js";

const { prisma } = prismaPkg;
const { generateDayCandidates, generateBestWeekPlan } = solverPkg;
const { recipeExcludedByStyle, matchesExclusionTerm } = dietPkg;
const { buildGroceryList } = groceryPkg;
const { toPurchaseUnits } = unitsPkg;

const KETO_RECIPE_CARB_CEILING_G = 30;
function filterPool(pool, { dietaryStyle, excludedFoods }) {
  return pool.filter((r) => {
    if (dietaryStyle === "keto" && r.carb > KETO_RECIPE_CARB_CEILING_G) return false;
    const flat = r.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flat }, dietaryStyle)) return false;
    if (excludedFoods.length && flat.some((ing) => excludedFoods.some((t) => matchesExclusionTerm(ing.name, t)))) return false;
    return true;
  });
}

const PROFILES = [
  { tag: "omnivore 2,800", diet: { dietaryStyle: null, excludedFoods: [] }, target: { kcal: 2800, proteinLo: 180, proteinHi: 200, fatLo: 70, fatHi: 90, carbLo: 250, carbHi: 310 }, meals: 3, snacks: 1 },
  { tag: "vegan 1,800 + gluten", diet: { dietaryStyle: "vegan", excludedFoods: ["gluten"] }, target: { kcal: 1800, proteinLo: 90, proteinHi: 105, fatLo: 45, fatHi: 60, carbLo: 180, carbHi: 230 }, meals: 3, snacks: 1 },
  { tag: "keto 2,200", diet: { dietaryStyle: "keto", excludedFoods: [] }, target: { kcal: 2200, proteinLo: 150, proteinHi: 170, fatLo: 120, fatHi: 150, carbLo: 20, carbHi: 60 }, meals: 3, snacks: 1 },
  { tag: "halal 2,400 + tree nuts", diet: { dietaryStyle: "halal", excludedFoods: ["tree nuts"] }, target: { kcal: 2400, proteinLo: 150, proteinHi: 170, fatLo: 65, fatHi: 85, carbLo: 210, carbHi: 270 }, meals: 3, snacks: 1 },
  { tag: "vegetarian 2,000 + shellfish/peanuts/sesame", diet: { dietaryStyle: "vegetarian", excludedFoods: ["shellfish", "peanuts", "sesame"] }, target: { kcal: 2000, proteinLo: 100, proteinHi: 115, fatLo: 50, fatHi: 65, carbLo: 190, carbHi: 240 }, meals: 3, snacks: 1 },
];

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

async function main() {
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  console.log(`raw pool: ${rawPool.length} recipes\n`);
  const rows = [];

  for (const p of PROFILES) {
    const pool = filterPool(rawPool, p.diet);
    const t0 = performance.now();
    const best = await generateBestWeekPlan(p.target, { meals: p.meals, snacks: p.snacks }, pool, { rng: seeded(1234) });
    const { slots } = best;
    const weekMs = Math.round(performance.now() - t0);

    // ZERO-tolerance allergy/style leaks across every shipped ingredient.
    let checkedIngredients = 0;
    for (const s of slots) {
      for (const ing of s.ingredients) {
        checkedIngredients++;
        for (const term of p.diet.excludedFoods) {
          assert.ok(!matchesExclusionTerm(ing.name, term), `${p.tag}: LEAK "${ing.name}" ~ "${term}"`);
        }
        if (p.diet.dietaryStyle && p.diet.dietaryStyle !== "keto") {
          assert.ok(!recipeExcludedByStyle({ ingredients: [{ name: ing.name }] }, p.diet.dietaryStyle), `${p.tag}: style LEAK "${ing.name}"`);
        }
      }
    }

    const byDay = new Map();
    for (const s of slots) {
      const t = byDay.get(s.dayOfWeek) || { kcal: 0, protein: 0 };
      t.kcal += s.kcal; t.protein += s.protein;
      byDay.set(s.dayOfWeek, t);
    }
    const pMid = (p.target.proteinLo + p.target.proteinHi) / 2;
    let good = 0;
    const roughDays = [];
    for (const [d, t] of byDay) {
      const ok = Math.abs(t.kcal - p.target.kcal) / p.target.kcal <= 0.15 && (pMid - t.protein) / pMid <= 0.15;
      if (ok) good++; else roughDays.push(d);
    }

    let diagnosed = "—";
    if (good < 6) {
      assert.ok(best.diagnosis && best.diagnosis.reasons.length > 0, `${p.tag}: ${good}/7 days with NO diagnosis — silent failure is banned`);
      for (const d of roughDays) {
        assert.ok(slots.some((s) => s.dayOfWeek === d && s.warning), `${p.tag}: rough day ${d} shipped without a warning label`);
      }
      for (const sug of best.diagnosis.suggestions) {
        assert.ok(!/allerg/i.test(sug), `${p.tag}: diagnosis must never suggest loosening allergies`);
      }
      diagnosed = best.diagnosis.reasons[0].slice(0, 55) + "…";
      // Diagnosed weeks still owe closest-fit QUALITY: the average day match
      // must stay decent even when strict tolerance can't be met.
      assert.ok(best.score.avgMatch >= 70, `${p.tag}: diagnosed week but avgMatch only ${best.score.avgMatch}% — closest-fit quality floor breached`);
    }

    // 3 scored day candidates, fast.
    const t1 = performance.now();
    const day = await generateDayCandidates({ dailyTarget: p.target, mealConfig: { meals: p.meals, snacks: p.snacks }, recipePool: pool, rng: seeded(9) });
    const dayMs = Math.round(performance.now() - t1);
    assert.ok(day.candidates.length >= 3, `${p.tag}: only ${day.candidates.length} day candidates`);

    // Grocery list sanity + practical units.
    const grocery = buildGroceryList({
      meals: slots.filter((s) => s.recipeId).map((s) => ({ status: "solved", anchor: { ingredients: s.ingredients.map((i) => ({ name: i.name, grams: i.grams })) }, adjusters: [] })),
    });
    assert.ok(grocery.items.length > 10, `${p.tag}: grocery list suspiciously small`);
    for (const item of grocery.items) {
      assert.ok(Number.isFinite(item.preparedGrams) && item.preparedGrams > 0, `${p.tag}: bad grams for ${item.name}`);
    }
    const withUnits = grocery.items.filter((i) => toPurchaseUnits(i.name, i.purchase?.grams ?? i.preparedGrams)).length;

    rows.push({
      tag: p.tag, pool: pool.length, weekMs, dayMs,
      daysOk: `${good}/7`, bestDayMatch: `${day.candidates[0].score.matchPct}%`,
      diagnosed,
      groceryItems: grocery.items.length, practicalUnits: withUnits,
      leaksChecked: checkedIngredients,
    });
  }

  console.table(rows);
  const slow = rows.filter((r) => r.weekMs > 3000);
  assert.equal(slow.length, 0, `week solves over 3s: ${slow.map((r) => r.tag).join(", ")}`);
  console.log("\nPHASE 4 VERIFICATION: ALL ASSERTIONS PASSED");
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
