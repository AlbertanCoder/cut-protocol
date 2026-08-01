// A14/A14-runRig.mjs — A1's runRig.mjs plus TWO sweepable knobs.
//
// Identical call sequence, identical schema (schema.mjs::buildDayRecord), so
// A1/rig/compare.v2.mjs pairs these JSONL files against each other and against
// A1's own baselines.
//
// Knob 1 — week restarts:  --attempts=N   -> generateHorizonPlan({attempts})
//          (mealSolver.js:658 `const attempts = options.attempts ?? 5;`)
// Knob 2 — per-slot draws: --flat=N | --min=N --max=N --div=N
//          (weeklyPlanner.js:102-105 slotAttemptBudget)
//
// Knob 2 has no options seam, so this file does NOT edit backend/src. It reads
// weeklyPlanner.js, rewrites ONLY the body of slotAttemptBudget in memory,
// compiles it under the ORIGINAL filename and seeds require.cache with it BEFORE
// mealSolver.js is required. mealSolver.js:15 `} = require("./weeklyPlanner.js");`
// then resolves to the patched module. Product code on disk is untouched.
//
//   node A14-runRig.mjs --seed=424242 --label=base --out=<abs>.jsonl
//   node A14-runRig.mjs --seed=424242 --label=flat12 --flat=12 --out=<abs>.jsonl

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Module from "node:module";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { prepareAgentDb, assertIsolated, REPO } from "../A1/rig/dbcopy.mjs";
import { buildDayRecord, validateRecord, SCALE_LO, SCALE_HI } from "../A1/rig/schema.mjs";
import { SEEDS, seedName } from "../A1/rig/seeds.mjs";

process.env.BRAIN = "off";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

const AGENT = "A14";
const POP = String(argv.pop || "personas");
const SEED = Number(argv.seed ?? SEEDS.primary);
const N = argv.n ? Number(argv.n) : null;
const LABEL = String(argv.label || "base");
const QUIET = !!argv.quiet;

const K_FLAT = argv.flat ? Number(argv.flat) : null;
const K_MIN = argv.min ? Number(argv.min) : 5;
const K_MAX = argv.max ? Number(argv.max) : 20;
const K_DIV = argv.div ? Number(argv.div) : 10;
const K_ATTEMPTS = argv.attempts ? Number(argv.attempts) : null;

const budgetSpec = K_FLAT ? `flat(${K_FLAT})` : `max(${K_MIN},min(${K_MAX},floor(n/${K_DIV})))`;
const attemptsSpec = K_ATTEMPTS == null ? "default(5)" : String(K_ATTEMPTS);

// ── DB ISOLATION FIRST. Nothing may require prisma before this line. ────────
const db = prepareAgentDb(AGENT, { force: false });
assertIsolated(AGENT);

const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");

// ── KNOB 2: patched weeklyPlanner into require.cache, BEFORE mealSolver ─────
globalThis.__A14_STAT = { calls: 0, sumB: 0, sumPool: 0, cur: null };
const WP = require.resolve(path.join(B, "src/lib/weeklyPlanner.js"));
// CRLF-proof: match the single return line inside slotAttemptBudget's body.
const NEEDLE = /return Math\.max\(MIN_SLOT_ATTEMPTS, Math\.min\(MAX_SLOT_ATTEMPTS, Math\.floor\(n \/ 10\)\)\);/;
const EXPR = K_FLAT ? String(K_FLAT) : `Math.max(${K_MIN}, Math.min(${K_MAX}, Math.floor(n / ${K_DIV})))`;
const PATCH = `const b = ${EXPR}; const S = globalThis.__A14_STAT; `
  + `if (S) { S.calls++; S.sumB += b; S.sumPool += n; if (S.cur) { S.cur.calls++; S.cur.sumB += b; S.cur.sumPool += n; } } return b;`;
{
  const src = fs.readFileSync(WP, "utf8");
  const hits = src.match(new RegExp(NEEDLE.source, "g")) || [];
  if (hits.length !== 1) {
    throw new Error(`A14: expected exactly 1 slotAttemptBudget return line, found ${hits.length} — refusing to run with an unverified patch`);
  }
  const patched = src.replace(NEEDLE, PATCH);
  const m = new Module(WP, null);
  m.filename = WP;
  m.paths = Module._nodeModulePaths(path.dirname(WP));
  m._compile(patched, WP);
  m.loaded = true;
  require.cache[WP] = m;
}

const bmr = require(path.join(B, "src/lib/bmrEngine.js"));
const solver = require(path.join(B, "src/lib/mealSolver.js"));
const planCtx = require(path.join(B, "src/lib/planContext.js"));
const gate = require(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

// Proof the injected module is the one mealSolver is holding: if the cache trick
// had failed, mealSolver would have loaded a SECOND copy from disk and this
// counter would stay at 0 for the whole run (checked at the end).

const OUT = path.resolve(String(argv.out || path.join(HERE, `A14-${LABEL}-s${SEED}.jsonl`)));
const STATCSV = path.resolve(String(argv.statcsv || path.join(HERE, `A14-cost-${LABEL}-s${SEED}.csv`)));

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
    label: LABEL, agentId: AGENT, pop: POP, seed: SEED, seedName: seedName(SEED),
    treatment: `budget=${budgetSpec};attempts=${attemptsSpec}`,
    customers: use.length, brain: "off",
    startDayOfWeek: 0,
    foodFingerprint, poolRaw: rawPool.length, foodRows: foods.length,
    dbPath: db.dbPath, dbHash: db.copyHash,
    startedAt: new Date().toISOString(),
  };

  const stream = fs.createWriteStream(OUT);
  const cost = fs.createWriteStream(STATCSV);
  cost.write("agent,label,seed,personaId,tier,satisfiable,dietStyle,horizonDays,mealsPerDay,snacksPerDay,poolAfterDiet,poolAfterPrep,slotCalls,meanBudget,solveMs,daysJudged,daysInBand\n");

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
    const mealConfig = c.mealConfig, filters = c.filters;
    const solveOpts = K_ATTEMPTS == null ? {} : { attempts: K_ATTEMPTS };

    const horizon = solver.resolveHorizon(c.horizonKey);
    globalThis.__A14_STAT.cur = { calls: 0, sumB: 0, sumPool: 0 };
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
    const cur = globalThis.__A14_STAT.cur;
    globalThis.__A14_STAT.cur = null;

    if (crash) {
      stream.write(JSON.stringify({ schema: "solver-brain/day/v1", crash, personaId: c.id, personaIdx: c.idx, tier: c.tier, satisfiable: c.satisfiable, run, judged: false, dayIndex: -1, target: {}, achieved: {}, verdict: { inBand: false }, pinned: {} }) + "\n");
      continue;
    }

    let cJudged = 0, cInBand = 0;
    for (const w of result.windows) {
      const byDay = new Map();
      for (const s of w.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
      const engineByDow = new Map((w.days || []).map((d) => [d.dayOfWeek, d]));
      for (const [dow, slots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
        const eng = engineByDow.get(dow) || null;
        const ach = recomputeDay(slots, foodById);
        const solv = solverDay(slots);
        const tol = solver.dayTolerance(target, ach);
        const okDay = solver.dayInTolerance(tol);
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
          target, achieved: ach, achievedSolver: solv, tol, inBand: okDay,
          slots,
          engine: eng ? { inTolerance: eng.inTolerance, matchPct: eng.matchPct } : null,
          honesty: { hasWarning: slots.some((s) => s.warning), hasDiagnosis: !!(w.diagnosis || result.diagnosis) },
          solveMs,
        });
        const bad = validateRecord(rec);
        if (bad.length) { badRecords++; rec._invalid = bad; }
        days++;
        if (rec.judged) { judged++; cJudged++; if (okDay) { inBand++; cInBand++; } }
        if (rec.verdictDisagrees) disagree++;
        if (Math.abs(rec.drift.kcal) > 1) drifted++;
        stream.write(JSON.stringify(rec) + "\n");
      }
    }
    const meanB = cur.calls ? (cur.sumB / cur.calls).toFixed(3) : "";
    cost.write([AGENT, LABEL, SEED, c.id, c.tier, c.satisfiable, c.profile.dietaryStyle || "none",
      horizon.days, c.mealConfig.meals, c.mealConfig.snacks, counts.afterDiet, counts.afterPrep,
      cur.calls, meanB, solveMs, cJudged, cInBand].join(",") + "\n");

    if (!QUIET && use.length > 20 && (c.idx + 1) % Math.ceil(use.length / 10) === 0) {
      process.stderr.write(`\r  ${Math.round(((c.idx + 1) / use.length) * 100)}%  `);
    }
  }
  stream.end(); cost.end();
  await new Promise((r) => stream.on("close", r));
  await prisma.$disconnect();

  const S = globalThis.__A14_STAT;
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "-");
  if (!QUIET) process.stderr.write("\n");
  console.log(`[A14] ${LABEL} · seed=${SEED} (${seedName(SEED)}) · budget=${budgetSpec} · attempts=${attemptsSpec}`);
  console.log(`[A14] customers ${use.length} · days ${days} · judged ${judged} · in band ${inBand} (${pct(inBand, judged)}%)`);
  console.log(`[A14] PATCH PROOF slotAttemptBudget calls ${S.calls} (must be > 0) · mean budget ${S.calls ? (S.sumB / S.calls).toFixed(2) : "-"} · mean pool ${S.calls ? (S.sumPool / S.calls).toFixed(1) : "-"}`);
  console.log(`[A14] scale bounds assumed [${SCALE_LO}, ${SCALE_HI}] · food fingerprint ${foodFingerprint}`);
  console.log(`[A14] INSTRUMENT CHECKS  verdict-disagreements ${disagree} · kcal-drift>1 ${drifted} · crashes ${crashes} · invalid records ${badRecords}   (all must be 0)`);
  console.log(`[A14] WALLCLOCK ${((Date.now() - t00) / 1000).toFixed(1)}s -> ${OUT}`);
  if (S.calls === 0) { console.error("[A14] FATAL: patched slotAttemptBudget was never called — require.cache injection did not take"); process.exit(3); }
}

main().catch((e) => { console.error(e); process.exit(1); });
