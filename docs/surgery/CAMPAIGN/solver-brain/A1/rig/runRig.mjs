// A1/rig/runRig.mjs — the shared Phase-4 experiment runner.
//
// It is a WRAPPER, not a harness. The call sequence is the one
// backend/scripts/qc/runSolve.mjs uses to grade the shipping product
// ("computeEnergy -> deriveTarget -> computeMacros / filterRecipePool ->
// applyPrepFilter / generate"), with the two things the real route
// (backend/src/routes/plans.js:324) does that runSolve omits:
//   · generateHorizonPlan instead of generateBestWeekPlan, so a persona that
//     asked for ONE day is solved as one day (185 of the 250 personas do);
//   · `adjusters` (the macro closer), which the route passes from planContext.
//     planContext.loadAdjusters() is not exported, so the candidate list and
//     both gates (exclusionGate.isExcluded, foodValidation.macroTrustIssue) are
//     imported from product code and re-assembled here — same rows, same gates.
//
// Verdicts are NOT recomputed here: dayTolerance/dayInTolerance are imported
// from mealSolver.js, the single source of truth named in BRIEF.md. Day totals
// ARE recomputed independently from raw Food rows (the oracle.mjs method), so
// every record carries both the solver's claim and the re-derivation, plus the
// drift between them.
//
//   node runRig.mjs --agent=A7 --pop=personas --seed=424242 \
//     --out=<abs>/A7/A7-baseline.jsonl --label=baseline
//   node runRig.mjs --agent=A7 --pop=personas --seed=424242 \
//     --treatment=./treatments/noop.mjs --out=<abs>/A7/A7-treat.jsonl --label=treat
//
// BRAIN=off is forced. No port is bound. The DB is the agent's own copy.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { prepareAgentDb, assertIsolated, REPO } from "./dbcopy.mjs";
import { buildDayRecord, validateRecord, SCALE_LO, SCALE_HI } from "./schema.mjs";
import { SEEDS, seedName } from "./seeds.mjs";

process.env.BRAIN = "off";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

const AGENT = String(argv.agent || "A1");
const POP = String(argv.pop || "personas");
const SEED = Number(argv.seed ?? SEEDS.primary);
const N = argv.n ? Number(argv.n) : null;          // cap the customer count
const LABEL = String(argv.label || "baseline");
const QUIET = !!argv.quiet;

// ── DB ISOLATION FIRST. Nothing may require prisma before this line. ────────
const db = prepareAgentDb(AGENT, { force: !!argv.freshdb });
assertIsolated(AGENT);

const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const bmr = require(path.join(B, "src/lib/bmrEngine.js"));
const solver = require(path.join(B, "src/lib/mealSolver.js"));
const planCtx = require(path.join(B, "src/lib/planContext.js"));
const gate = require(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

const OUT = path.resolve(String(argv.out || path.join(REPO, `docs/surgery/CAMPAIGN/solver-brain/${AGENT}/${AGENT}-${LABEL}-s${SEED}.jsonl`)));

// ── seeded RNG (identical to backend/scripts/qc/rng.mjs) ───────────────────
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

// ── populations ────────────────────────────────────────────────────────────
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
      // BRIEF.md's denominator rule: IMPOSSIBLE personas are engineered to be
      // unsatisfiable — correct output is a refusal. A3 owns auditing that tier;
      // until A3 says otherwise this is the split every agent uses.
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

async function loadGenProfilePop(seed, n) {
  const { genProfile } = await import(pathToFileURL(path.join(B, "scripts/qc/genProfile.mjs")).href);
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = genProfile(seed, i);
    out.push({
      id: `g${String(i).padStart(4, "0")}`, idx: i,
      tier: "UNTIERED",
      // genProfile carries no difficulty tier, so satisfiability is UNKNOWN, not
      // true. compare.mjs treats null as "not excludable" and says so.
      satisfiable: null,
      profile: g.profile, weightKg: g.weightKg,
      mealConfig: g.mealConfig, dietProfile: g.dietProfile, filters: g.filters,
      horizonKey: "week",
    });
  }
  return out;
}

// ── adjusters: planContext.loadAdjusters(), re-assembled (not exported) ────
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

// ── independent day totals, recomputed from raw Food rows (oracle method) ──
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

  // Fingerprint: two runs are only comparable if this matches.
  const foodFingerprint = crypto.createHash("sha256")
    .update(foods.map((f) => `${f.id}:${f.kcal}:${f.protein}:${f.fat}:${f.carb}`).sort().join("|"))
    .digest("hex").slice(0, 16);

  // Treatment hook. A Phase-4 agent ships a module exporting
  //   applyTreatment(ctx) -> {} | { target?, pool?, mealConfig?, filters?, adjusters?, solveOpts? }
  // and NEVER edits backend/src (BRIEF.md).
  let treatment = null, treatmentName = "none";
  if (argv.treatment) {
    const tp = path.resolve(HERE, String(argv.treatment));
    treatment = await import(pathToFileURL(tp).href);
    treatmentName = treatment.NAME || path.basename(tp);
    if (typeof treatment.applyTreatment !== "function") throw new Error(`treatment ${tp} exports no applyTreatment()`);
  }

  const customers = POP === "personas" ? loadPersonas() : await loadGenProfilePop(SEED, N ?? 250);
  const use = N ? customers.slice(0, N) : customers;

  const run = {
    schemaRun: "solver-brain/run/v1",
    label: LABEL, agentId: AGENT, pop: POP, seed: SEED, seedName: seedName(SEED),
    treatment: treatmentName,
    customers: use.length, brain: "off",
    startDayOfWeek: 0,
    foodFingerprint, poolRaw: rawPool.length, foodRows: foods.length,
    dbPath: db.dbPath, dbHash: db.copyHash,
    startedAt: new Date().toISOString(),
  };

  const stream = fs.createWriteStream(OUT);
  let days = 0, judged = 0, inBand = 0, disagree = 0, drifted = 0, crashes = 0, badRecords = 0;

  for (const c of use) {
    const rng = mulberry32(childSeed(SEED, c.idx));
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    let target = bmr.computeMacros(c.profile, c.weightKg, derived.target);

    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    let pool = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: pool.length };
    let adjusters = adjustersFor(adjusterFoods, c.profile);
    let mealConfig = c.mealConfig, filters = c.filters;
    let solveOpts = {};

    if (treatment) {
      const patch = (await treatment.applyTreatment({
        customer: c, profile: c.profile, target, pool, mealConfig, filters, adjusters, counts, rng, prisma, foodById,
      })) || {};
      if (patch.target) target = patch.target;
      if (patch.pool) pool = patch.pool;
      if (patch.mealConfig) mealConfig = patch.mealConfig;
      if (patch.filters) filters = patch.filters;
      if (patch.adjusters) adjusters = patch.adjusters;
      if (patch.solveOpts) solveOpts = patch.solveOpts;
    }

    // startDayOfWeek is PINNED to 0. routes/plans.js starts a sub-week horizon
    // on TODAY's index; pinning it makes a run reproducible on any calendar day.
    const horizon = solver.resolveHorizon(c.horizonKey);
    const t0 = Date.now();
    let result = null, crash = null;
    try {
      result = await solver.generateHorizonPlan({
        dailyTarget: target, mealConfig, recipePool: pool, horizon, filters,
        counts, adjusters, bias: solver.buildBias(filters, null),
        priorPlans: [], lockedSlotsByWindow: [], startDayOfWeek: 0, rng,
        ...solveOpts,
      });
    } catch (e) { crash = String((e && e.message) || e); crashes++; }
    const solveMs = Date.now() - t0;

    if (crash) {
      stream.write(JSON.stringify({ schema: "solver-brain/day/v1", crash, personaId: c.id, personaIdx: c.idx, tier: c.tier, satisfiable: c.satisfiable, run, judged: false, dayIndex: -1, target: {}, achieved: {}, verdict: { inBand: false }, pinned: {} }) + "\n");
      continue;
    }

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
    if (!QUIET && use.length > 20 && (c.idx + 1) % Math.ceil(use.length / 10) === 0) {
      process.stderr.write(`\r  ${Math.round(((c.idx + 1) / use.length) * 100)}%  `);
    }
  }
  stream.end();
  await new Promise((r) => stream.on("close", r));
  await prisma.$disconnect();

  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");
  if (!QUIET) process.stderr.write("\n");
  console.log(`[rig] ${LABEL} · pop=${POP} · seed=${SEED} (${seedName(SEED)}) · treatment=${treatmentName}`);
  console.log(`[rig] customers ${use.length} · days ${days} · judged ${judged} · in band ${inBand} (${pct(inBand, judged)}%)`);
  console.log(`[rig] scale bounds assumed [${SCALE_LO}, ${SCALE_HI}] · food fingerprint ${foodFingerprint}`);
  console.log(`[rig] INSTRUMENT CHECKS  verdict-disagreements ${disagree} · kcal-drift>1 ${drifted} · crashes ${crashes} · invalid records ${badRecords}   (all must be 0)`);
  console.log(`[rig] ${((Date.now() - t00) / 1000).toFixed(1)}s -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
