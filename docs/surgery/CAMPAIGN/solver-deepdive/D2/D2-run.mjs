// D2/D2-run.mjs — A1's runRig.mjs call sequence + per-slot telemetry.
//
// Deliberately a FORK of A1/rig/runRig.mjs rather than a new harness: same
// computeEnergy -> deriveTarget -> computeMacros / filterRecipePool ->
// applyPrepFilter -> generateHorizonPlan sequence, same adjuster re-assembly,
// same seeded RNG, same day record. The only additions are:
//   · globalThis.__D2_PERSONA, so D2-hook.cjs can label its records
//   · a per-persona drain of the hook buffer into <out>.slots.jsonl / .days.jsonl
//
// Run it under the hook:
//   node --require ./D2-hook.cjs D2-run.mjs --seed=424242 --out=... [--attempts=N]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { prepareAgentDb, assertIsolated, REPO } from "../../solver-brain/A1/rig/dbcopy.mjs";
import { buildDayRecord, validateRecord } from "../../solver-brain/A1/rig/schema.mjs";
import { SEEDS, seedName } from "../../solver-brain/A1/rig/seeds.mjs";

process.env.BRAIN = "off";

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

const AGENT = "D2";
const SEED = Number(argv.seed ?? SEEDS.primary);
const N = argv.n ? Number(argv.n) : null;
const LABEL = String(argv.label || "baseline");
const ATTEMPTS = argv.attempts != null ? Number(argv.attempts) : null;

const db = prepareAgentDb(AGENT);
assertIsolated(AGENT);

const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const bmr = require(path.join(B, "src/lib/bmrEngine.js"));
const solver = require(path.join(B, "src/lib/mealSolver.js"));
const planCtx = require(path.join(B, "src/lib/planContext.js"));
const gate = require(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(String(argv.out || path.join(HERE, `D2-${LABEL}-s${SEED}.jsonl`)));
const OUT_SLOTS = OUT.replace(/\.jsonl$/, "") + ".slots.jsonl";
const OUT_DAYS = OUT.replace(/\.jsonl$/, "") + ".daysolve.jsonl";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function childSeed(base, i) {
  let z = (base + i * 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

const PERSONAS_PATH = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");
function loadPersonas() {
  const rows = fs.readFileSync(PERSONAS_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return rows.map((p) => {
    const pr = p.profile;
    const profile = {
      sex: pr.sex, age: pr.age, heightCm: pr.heightCm,
      bodyFatPct: pr.bodyFatPct ?? 0,
      occupationKey: pr.occupationKey, activityOverride: null,
      sessionsPerWeek: pr.sessionsPerWeek, trainingStyle: pr.trainingStyle,
      minutesPerSession: pr.minutesPerSession,
      rateLbPerWeek: pr.rateLbPerWeek, floorKcal: pr.floorKcal ?? null,
      excludedFormulas: [],
      unitPref: pr.unitPref, startWeightKg: pr.startWeightKg, goalWeightKg: pr.goalWeightKg,
      rateAcknowledged: true,
      dietaryStyle: pr.dietaryStyle && pr.dietaryStyle !== "none" ? pr.dietaryStyle : null,
      mealsPerDay: pr.mealsPerDay, snacksPerDay: pr.snacksPerDay,
      excludedFoods: pr.excludedFoods || [],
      cuisinePreferences: p.filters?.cuisines || [],
      maxPrepMin: p.filters?.maxPrepMin ?? null,
      budgetTier: p.filters?.budget ?? null,
      allowBatch: false, maxComplexity: null, adaptiveTdee: true,
      proteinPriorityMode: !!p.filters?.proteinPriority,
    };
    return {
      id: p.id, idx: p.idx, tier: p.tier,
      satisfiable: p.tier !== "IMPOSSIBLE",
      profile, weightKg: pr.startWeightKg,
      mealConfig: { meals: pr.mealsPerDay, snacks: pr.snacksPerDay },
      dietProfile: { dietaryStyle: profile.dietaryStyle, excludedFoods: profile.excludedFoods },
      filters: {
        cuisines: p.filters?.cuisines || [], protein: null,
        budget: p.filters?.budget ?? null, maxPrepMin: p.filters?.maxPrepMin ?? null,
        allowBatchRepeats: false, proteinPriority: !!p.filters?.proteinPriority,
      },
      horizonKey: p.horizon || "week",
    };
  });
}

const ADJUSTER_CANDIDATES = [
  { name: "Olive Oil", role: "fat" }, { name: "Butter", role: "fat" }, { name: "Avocado", role: "fat" },
  { name: "White rice, cooked", role: "carb" }, { name: "Potatoes", role: "carb" }, { name: "Oats", role: "carb" },
  { name: "Chicken breast, cooked, skinless", role: "protein" }, { name: "Greek Yogurt", role: "protein" },
  { name: "Tofu", role: "protein" }, { name: "Lentils", role: "protein" },
];
async function loadAdjusterFoods() {
  const rows = await prisma.food.findMany({
    where: { name: { in: ADJUSTER_CANDIDATES.map((a) => a.name) } },
    select: gate.FOOD_GATE_SELECT,
  });
  const byLower = new Map();
  for (const f of rows) { const k = f.name.trim().toLowerCase(); if (!byLower.has(k)) byLower.set(k, f); }
  return byLower;
}
function adjustersFor(foods, profile) {
  const out = [];
  for (const cand of ADJUSTER_CANDIDATES) {
    const food = foods.get(cand.name.trim().toLowerCase());
    if (!food) continue;
    if (foodVal.macroTrustIssue(food)) continue;
    if (gate.isExcluded(food, profile)) continue;
    out.push({ role: cand.role, food });
  }
  return out;
}

function recomputeDay(slots, foodById) {
  let kcal = 0, protein = 0, fat = 0, carb = 0, missing = 0;
  for (const s of slots) {
    for (const ing of s.ingredients || []) {
      const f = foodById.get(ing.foodId);
      if (!f) { missing++; continue; }
      const k = ing.grams / 100;
      kcal += f.kcal * k; protein += f.protein * k; fat += f.fat * k; carb += f.carb * k;
    }
  }
  return { kcal, protein, fat, carb, missing };
}
function solverDay(slots) {
  const t = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  for (const s of slots) { t.kcal += s.kcal || 0; t.protein += s.protein || 0; t.fat += s.fat || 0; t.carb += s.carb || 0; }
  return t;
}

async function main() {
  const t00 = Date.now();
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const adjusterFoods = await loadAdjusterFoods();

  const foodFingerprint = crypto.createHash("sha256")
    .update(foods.map((f) => `${f.id}:${f.kcal}:${f.protein}:${f.fat}:${f.carb}`).sort().join("|"))
    .digest("hex").slice(0, 16);

  const customers = loadPersonas();
  const use = N ? customers.slice(0, N) : customers;

  const run = {
    schemaRun: "solver-brain/run/v1",
    label: LABEL, agentId: AGENT, pop: "personas", seed: SEED, seedName: seedName(SEED),
    treatment: ATTEMPTS != null ? `attempts=${ATTEMPTS}` : "none",
    customers: use.length, brain: "off", startDayOfWeek: 0,
    foodFingerprint, poolRaw: rawPool.length, foodRows: foods.length,
    dbPath: db.dbPath, dbHash: db.copyHash,
  };

  const stream = fs.createWriteStream(OUT);
  const sStream = fs.createWriteStream(OUT_SLOTS);
  const dStream = fs.createWriteStream(OUT_DAYS);
  let days = 0, judged = 0, inBand = 0, disagree = 0, drifted = 0, crashes = 0, badRecords = 0;

  for (const c of use) {
    const rng = mulberry32(childSeed(SEED, c.idx));
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    const target = bmr.computeMacros(c.profile, c.weightKg, derived.target);

    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const pool = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: pool.length };
    const adjusters = adjustersFor(adjusterFoods, c.profile);

    globalThis.__D2_PERSONA = c.id;
    const horizon = solver.resolveHorizon(c.horizonKey);
    const t0 = Date.now();
    let result = null, crash = null;
    try {
      result = await solver.generateHorizonPlan({
        dailyTarget: target, mealConfig: c.mealConfig, recipePool: pool, horizon, filters: c.filters,
        counts, adjusters, bias: solver.buildBias(c.filters, null),
        priorPlans: [], lockedSlotsByWindow: [], startDayOfWeek: 0, rng,
        ...(ATTEMPTS != null ? { attempts: ATTEMPTS } : {}),
      });
    } catch (e) { crash = String((e && e.message) || e); crashes++; }
    const solveMs = Date.now() - t0;

    // Drain the hook buffer for THIS persona, and stamp the per-day verdict onto
    // the slot rows so the loop's behaviour can be sliced by outcome.
    const tele = globalThis.__D2_DRAIN ? globalThis.__D2_DRAIN() : { slots: [], days: [] };

    if (crash) {
      stream.write(JSON.stringify({ schema: "solver-brain/day/v1", crash, personaId: c.id, personaIdx: c.idx, tier: c.tier, satisfiable: c.satisfiable, run, judged: false, dayIndex: -1, target: {}, achieved: {}, verdict: { inBand: false }, pinned: {} }) + "\n");
      continue;
    }

    const verdictByDow = new Map();
    for (const w of result.windows) {
      const byDay = new Map();
      for (const s of w.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
      const engineByDow = new Map((w.days || []).map((d) => [d.dayOfWeek, d]));
      for (const [dow, slots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
        const eng = engineByDow.get(dow) || null;
        const ach = recomputeDay(slots, foodById);
        const solv = solverDay(slots);
        const tol = solver.dayTolerance(target, ach);
        const ok = solver.dayInTolerance(tol);
        verdictByDow.set(`${w.windowIndex}:${dow}`, { ok, tol });
        const rec = buildDayRecord({
          run,
          customer: {
            id: c.id, idx: c.idx, tier: c.tier, satisfiable: c.satisfiable,
            dietStyle: c.profile.dietaryStyle || "none",
            allergens: c.profile.excludedFoods || [],
            mealsPerDay: c.mealConfig.meals, snacksPerDay: c.mealConfig.snacks,
            horizonDays: horizon.days,
          },
          day: { dayIndex: eng?.dayIndex ?? dow, dayOfWeek: dow, windowIndex: w.windowIndex },
          target, achieved: ach, achievedSolver: solv, tol, inBand: ok,
          slots,
          engine: eng ? { inTolerance: eng.inTolerance, matchPct: eng.matchPct } : null,
          honesty: { hasWarning: slots.some((s) => s.warning), hasDiagnosis: !!(w.diagnosis || result.diagnosis) },
          solveMs,
        });
        const bad = validateRecord(rec);
        if (bad.length) { badRecords++; rec._invalid = bad; }
        days++;
        if (rec.judged) { judged++; if (ok) inBand++; }
        if (rec.verdictDisagrees) disagree++;
        if (Math.abs(rec.drift.kcal) > 1) drifted++;
        stream.write(JSON.stringify(rec) + "\n");
      }
    }

    for (const r of tele.slots) {
      sStream.write(JSON.stringify({ ...r, tier: c.tier, satisfiable: c.satisfiable, diet: c.profile.dietaryStyle || "none", meals: c.mealConfig.meals, snacks: c.mealConfig.snacks }) + "\n");
    }
    for (const r of tele.days) {
      dStream.write(JSON.stringify({ ...r, tier: c.tier, satisfiable: c.satisfiable, diet: c.profile.dietaryStyle || "none", meals: c.mealConfig.meals, snacks: c.mealConfig.snacks }) + "\n");
    }
  }
  stream.end(); sStream.end(); dStream.end();
  await Promise.all([stream, sStream, dStream].map((s) => new Promise((r) => s.on("close", r))));
  await prisma.$disconnect();

  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");
  console.log(`[D2] ${LABEL} · seed=${SEED} · attempts=${ATTEMPTS ?? "default(5)"}`);
  console.log(`[D2] customers ${use.length} · days ${days} · judged ${judged} · in band ${inBand} (${pct(inBand, judged)}%)`);
  console.log(`[D2] INSTRUMENT CHECKS  verdict-disagreements ${disagree} · kcal-drift>1 ${drifted} · crashes ${crashes} · invalid ${badRecords}   (all must be 0)`);
  console.log(`[D2] dbHash ${db.copyHash} · foodFingerprint ${foodFingerprint} · poolRaw ${rawPool.length}`);
  console.log(`[D2] ${((Date.now() - t00) / 1000).toFixed(1)}s -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
