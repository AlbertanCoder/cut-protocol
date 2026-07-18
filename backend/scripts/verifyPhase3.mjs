// Phase 3 end-to-end verification with 3 fake users (different sex, size,
// job, diet) driven through the real engine + filter pipeline. Pure library
// calls — no rows are written anywhere. Exits non-zero on any failure.
import "dotenv/config";
import assert from "node:assert/strict";
import prismaPkg from "../src/lib/prisma.js";
import bmrPkg from "../src/lib/bmrEngine.js";
import dietPkg from "../src/lib/dietaryFilter.js";

const { prisma } = prismaPkg;
const { computeEnergy, deriveTarget, rateSafety, computeMacros, verdict } = bmrPkg;
const { recipeExcludedByStyle, matchesExclusionTerm } = dietPkg;

const USERS = [
  {
    tag: "F · desk · vegan · 68 kg",
    profile: {
      sex: "F", age: 29, heightCm: 165, bodyFatPct: 28,
      occupationKey: "desk-office", activityOverride: null,
      sessionsPerWeek: 2, trainingStyle: "cardio", minutesPerSession: 30,
      rateLbPerWeek: 2.0, floorKcal: null, excludedFormulas: [],
      dietaryStyle: "vegan", excludedFoods: ["gluten"],
    },
    weightKg: 68,
  },
  {
    tag: "M · formwork · keto + shellfish/peanuts · 118 kg",
    profile: {
      sex: "M", age: 41, heightCm: 188, bodyFatPct: 0,
      occupationKey: "formwork-concrete", activityOverride: null,
      sessionsPerWeek: 4, trainingStyle: "weights", minutesPerSession: 60,
      rateLbPerWeek: 1.0, floorKcal: null, excludedFormulas: ["harris"],
      dietaryStyle: "keto", excludedFoods: ["shellfish", "peanuts"],
    },
    weightKg: 118,
  },
  {
    tag: "M · driver · halal + custom cilantro · 92 kg",
    profile: {
      sex: "M", age: 35, heightCm: 175, bodyFatPct: 22,
      occupationKey: "driver-truck", activityOverride: null,
      sessionsPerWeek: 0, trainingStyle: "mixed", minutesPerSession: 0,
      rateLbPerWeek: 0.5, floorKcal: null, excludedFormulas: [],
      dietaryStyle: "halal", excludedFoods: ["cilantro"],
    },
    weightKg: 92,
  },
];

async function main() {
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  console.log(`recipe pool: ${recipes.length}\n`);
  const results = [];

  for (const u of USERS) {
    const { profile, weightKg, tag } = u;
    const energy = computeEnergy(profile, weightKg);
    const target = deriveTarget(profile, energy.tdee);
    const safety = rateSafety(profile, weightKg, energy.tdee);
    const macros = computeMacros(profile, weightKg, target.target);
    const v = verdict({ rate: profile.rateLbPerWeek, chosenRate: profile.rateLbPerWeek, daysIn: 30, atFloor: target.floored });

    // engine sanity
    assert.ok(energy.rmr > 1000 && energy.rmr < 2600, `${tag}: implausible BMR ${energy.rmr}`);
    assert.ok(energy.tdee > energy.rmr, `${tag}: TDEE must exceed BMR`);
    assert.ok(target.target >= target.floor, `${tag}: target below floor`);
    assert.equal(v.tone, "good", `${tag}: matching pace must read ON TARGET`);
    assert.ok(macros.proteinHi > macros.proteinLo, `${tag}: protein range`);

    // formula applicability
    const keys = energy.rows.map((r) => r.key);
    if (profile.bodyFatPct > 0) {
      assert.ok(keys.includes("katch") && keys.includes("cunningham"), `${tag}: BF% should unlock LBM formulas`);
    } else {
      assert.ok(!keys.includes("katch"), `${tag}: no BF% must hide Katch-McArdle`);
    }
    if (profile.excludedFormulas.length) {
      const row = energy.rows.find((r) => r.key === profile.excludedFormulas[0]);
      assert.equal(row.excluded, true, `${tag}: exclusion flag`);
    }

    // hard filter: zero excluded ingredients may survive into the visible pool
    const visible = recipes.filter((r) => {
      const flat = r.ingredients.map((i) => ({ name: i.food.name }));
      if (recipeExcludedByStyle({ ingredients: flat }, profile.dietaryStyle)) return false;
      if (profile.excludedFoods.some((t) => flat.some((ing) => matchesExclusionTerm(ing.name, t)))) return false;
      return true;
    });
    for (const r of visible) {
      for (const ing of r.ingredients) {
        for (const term of profile.excludedFoods) {
          assert.ok(!matchesExclusionTerm(ing.food.name, term), `${tag}: "${r.name}" leaked excluded "${ing.food.name}" (${term})`);
        }
      }
    }
    assert.ok(visible.length > 20, `${tag}: pool collapsed to ${visible.length} — too restrictive to plan a week`);

    results.push({ tag, bmr: energy.rmr, spread: `${energy.spreadLo}-${energy.spreadHi}`, mult: energy.jobMultiplier, training: energy.trainingKcalPerDay, tdee: energy.tdee, target: target.target, floored: target.floored, unsafe: safety.unsafe, pool: visible.length, hidden: recipes.length - visible.length });
  }

  console.table(results);

  // Distinctness: different profiles must produce different prescriptions.
  const targets = results.map((r) => r.target);
  assert.equal(new Set(targets).size, targets.length, "three different users produced identical targets");
  // The vegan desk worker at 2.0 lb/wk on 68 kg MUST trip the safety rail.
  assert.equal(results[0].unsafe, true, "aggressive rate on a light user must be flagged unsafe");
  // The heavy formwork profile must out-burn the desk profile by a wide margin.
  assert.ok(results[1].tdee > results[0].tdee + 800, "occupation effect missing from TDEE");

  console.log("\nPHASE 3 VERIFICATION: ALL ASSERTIONS PASSED");
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
