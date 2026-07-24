// Read-only "one customer's experience" CLI. Given a persona's real inputs, it
// derives targets through the REAL engine, generates a real week plan, and prints
// what that customer would actually get — targets, the week, per-day match %, any
// honest "unsolvable" diagnosis, and an INDEPENDENT allergen re-check of the
// shipped ingredients. Never writes to the DB, never binds a port. Used by the
// persona-customer QC agents so their critique is grounded in real output.
//
//   node scripts/qc/personaPlan.mjs --sex=F --age=34 --heightCm=165 --weightKg=72 \
//     --bodyFat=30 --diet=vegetarian --exclude=dairy,nuts --meals=3 --snacks=1 \
//     --rate=1.0 --occupation=nurse-healthcare
import "dotenv/config";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.BRAIN = "off";

const bmr = require(path.join(HERE, "..", "..", "src", "lib", "bmrEngine.js"));
const solver = require(path.join(HERE, "..", "..", "src", "lib", "mealSolver.js"));
const ctx = require(path.join(HERE, "..", "..", "src", "lib", "planContext.js"));
const { prisma } = require(path.join(HERE, "..", "..", "src", "lib", "prisma.js"));
const O = await import("./oracle.mjs");

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const num = (k, d) => (argv[k] != null ? Number(argv[k]) : d);
const str = (k, d) => (argv[k] != null ? String(argv[k]) : d);

function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
  const profile = {
    sex: str("sex", "M"), age: num("age", 35), heightCm: num("heightCm", 178),
    bodyFatPct: num("bodyFat", 0), occupationKey: str("occupation", "desk-office"),
    activityOverride: null, sessionsPerWeek: num("sessions", 3), trainingStyle: str("training", "mixed"),
    minutesPerSession: 45, rateLbPerWeek: num("rate", 1.0), floorKcal: null, excludedFormulas: [],
    dietaryStyle: str("diet", "none") === "none" ? null : str("diet", "none"),
    mealsPerDay: num("meals", 3), snacksPerDay: num("snacks", 1),
    excludedFoods: str("exclude", "") ? str("exclude", "").split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
  const weightKg = num("weightKg", 82);

  const energy = bmr.computeEnergy(profile, weightKg);
  const derived = bmr.deriveTarget(profile, energy.tdee, energy.rmr);
  const floor = bmr.effectiveFloor(profile, energy.rmr);
  const target = bmr.computeMacros(profile, weightKg, derived.target);

  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const afterDiet = ctx.filterRecipePool(rawPool, { dietaryStyle: profile.dietaryStyle, excludedFoods: profile.excludedFoods });
  const pool = solver.applyPrepFilter(afterDiet, undefined);
  const recipeById = new Map(rawPool.map((r) => [r.id, r.name]));

  const filters = { cuisines: [], protein: null, budget: null, maxPrepMin: null, allowBatchRepeats: false };
  const week = await solver.generateBestWeekPlan(target, { meals: profile.mealsPerDay, snacks: profile.snacksPerDay }, pool, {
    rng: mulberry(0xC0FFEE), bias: solver.buildBias(filters, null), allowBatchRepeats: false, filters,
    counts: { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: pool.length },
  });

  console.log(`\n=== CUSTOMER: ${profile.sex} ${profile.age}y ${weightKg}kg ${profile.heightCm}cm · ${profile.dietaryStyle || "no diet"} · excl [${profile.excludedFoods.join(", ") || "none"}] · ${profile.mealsPerDay}m+${profile.snacksPerDay}s · ${profile.rateLbPerWeek} lb/wk ===`);
  console.log(`TDEE ${energy.tdee} · RMR ${energy.rmr} · floor ${floor} · TARGET ${derived.target} kcal${derived.floored ? " (FLOORED — chosen rate not achievable by diet alone)" : ""}`);
  console.log(`Macro target: protein ${target.proteinLo}-${target.proteinHi}g · fat ${target.fatLo}-${target.fatHi}g · carbs ~${target.carbMid}g`);
  console.log(`Pool: ${rawPool.length} recipes -> ${afterDiet.length} after your diet/allergies -> ${pool.length} after prep filter`);

  // per-day view + independent allergen re-check
  const byDay = new Map();
  for (const s of week.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let leaks = 0;
  for (const [dow, slots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    let k = 0, p = 0; const names = [];
    for (const s of slots) {
      if (!s.recipeId) { names.push("(empty slot)"); continue; }
      names.push(`${recipeById.get(s.recipeId)}${s.slotType === "snack" ? " [snack]" : ""}`);
      for (const ing of s.ingredients || []) {
        k += (ing.grams || 0); // placeholder; macros come from slot
        for (const term of profile.excludedFoods) if (O.hitsAny(ing.name, O.AUDIT_ALLERGENS[term] || [term], term === "dairy")) { leaks++; console.log(`  !! ALLERGEN LEAK: "${ing.name}" (${term}) day ${DAYS[dow]}`); }
      }
      k = s.kcal ? k : k; p += s.protein || 0;
    }
    const dayKcal = slots.reduce((a, s) => a + (s.kcal || 0), 0);
    const dev = target.kcal ? Math.round(((dayKcal - target.kcal) / target.kcal) * 100) : 0;
    console.log(`  ${DAYS[dow]}: ${Math.round(dayKcal)} kcal (${dev >= 0 ? "+" : ""}${dev}%), protein ${Math.round(p)}g — ${names.join(", ")}`);
  }
  if (week.diagnosis) console.log(`\nHONEST DIAGNOSIS shown to the user: ${typeof week.diagnosis === "string" ? week.diagnosis : JSON.stringify(week.diagnosis).slice(0, 300)}`);
  console.log(`\nIndependent allergen re-check: ${leaks === 0 ? "clean (no excluded allergen on any plate)" : leaks + " LEAK(S)"}`);
  console.log(`Distinct recipes across the week: ${new Set(week.slots.filter((s) => s.recipeId).map((s) => s.recipeId)).size} (variety signal)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
