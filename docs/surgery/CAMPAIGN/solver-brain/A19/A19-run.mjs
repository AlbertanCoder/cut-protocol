// A19-run.mjs — A19's fork of A1/rig/runRig.mjs.
//
// WHY A FORK AND NOT A TREATMENT: runRig's treatment hook patches INPUTS
// (target/pool/mealConfig/filters/adjusters/solveOpts). A19's question is about
// the SELECTION LOOP inside generateBestWeekPlan, which no input patch reaches,
// and generateHorizonPlan calls generateBestWeekPlan by lexical reference, so
// monkey-patching the export does nothing. So the loop is re-implemented here,
// out of exported product functions, and NOTHING in backend/src is modified.
//
// The fork is validated by --mode=week, which must reproduce A1's baseline
// byte-for-byte. If it does not, every other mode's delta is meaningless.
//
//   node A19-run.mjs --seed=424242 --mode=week  --out=... --probe=...
//   node A19-run.mjs --seed=424242 --mode=dayN  --out=... --probe=...
//
// BRAIN=off forced, no port bound, DB is A19's own copy.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RIG = path.resolve(HERE, "../A1/rig");

const { prepareAgentDb, assertIsolated, REPO } = await import(pathToFileURL(path.join(RIG, "dbcopy.mjs")).href);
const { buildDayRecord, validateRecord, SCALE_LO, SCALE_HI } = await import(pathToFileURL(path.join(RIG, "schema.mjs")).href);
const { SEEDS, seedName } = await import(pathToFileURL(path.join(RIG, "seeds.mjs")).href);

process.env.BRAIN = "off";

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

const AGENT = "A19";
const SEED = Number(argv.seed ?? SEEDS.primary);
const MODE = String(argv.mode || "week");
const N = argv.n ? Number(argv.n) : null;
const LABEL = String(argv.label || MODE);
const QUIET = !!argv.quiet;

const db = prepareAgentDb(AGENT, {});
assertIsolated(AGENT);

const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const bmr = require(path.join(B, "src/lib/bmrEngine.js"));
const solver = require(path.join(B, "src/lib/mealSolver.js"));
const wp = require(path.join(B, "src/lib/weeklyPlanner.js"));
const planCtx = require(path.join(B, "src/lib/planContext.js"));
const gate = require(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

const OUT = path.resolve(String(argv.out || path.join(HERE, `A19-${LABEL}-s${SEED}.jsonl`)));
const PROBE = argv.probe ? path.resolve(String(argv.probe)) : null;

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

// ═══ THE FORKED SELECTION LOOP ═══════════════════════════════════════════════
// Lines marked [P] are transcribed from mealSolver.generateBestWeekPlan
// (:655-758). The ONLY behavioural change is the block guarded by mode==="dayN".

const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const repeatCapFor = (o) => (Number.isInteger(o?.repeatCap) ? o.repeatCap : (o?.allowBatchRepeats ? wp.BATCH_REPEAT_CAP : wp.DEFAULT_REPEAT_CAP));

async function bestWeekPlan(dailyTarget, mealConfig, recipePool, options, mode, probe) {
  const attempts = options.attempts ?? 5;                                  // [P] :658
  const filters = options.filters || {};
  const priority = Boolean(filters.proteinPriority);
  const windowDays = wp.normalizeDayIndices(options.dayIndices).length;    // [P] :670
  const preSolve = options.counts
    ? solver.diagnose({ counts: options.counts, filters, dailyTarget, mealConfig, pool: recipePool, days: windowDays })
    : undefined;
  const nothingToSolve = recipePool.length === 0 || options.counts?.afterDiet === 0;
  let best = null;
  let attemptsRun = 0;
  const rolls = [];
  for (let i = 0; i < attempts; i++) {                                     // [P] :677
    attemptsRun++;
    const slots = await wp.generateWeekPlan(dailyTarget, mealConfig, recipePool, { ...options, aiFallback: undefined });
    const score = solver.scoreWeek(dailyTarget, slots, { proteinPriority: priority });
    rolls.push({ slots, score });
    const better = !best                                                   // [P] :685-691
      || score.daysInTolerance > best.score.daysInTolerance
      || (score.daysInTolerance === best.score.daysInTolerance
          && priority && (score.floorDaysMet ?? 0) > (best.score.floorDaysMet ?? 0))
      || (score.daysInTolerance === best.score.daysInTolerance
          && (!priority || (score.floorDaysMet ?? 0) === (best.score.floorDaysMet ?? 0))
          && score.avgMatch > best.score.avgMatch);
    if (better) best = { slots, score };
    if (best.score.days.length > 0 && best.score.daysInTolerance === best.score.days.length
        && best.score.avgMatch >= 95 && (!priority || best.score.floorDaysMet === best.score.floorDaysTotal)) break; // [P] :696
    if (nothingToSolve) break;                                             // [P] :700
  }

  // ── PROBE: what the discarded rolls contained. Recorded in EVERY mode, so
  //    the ceiling on per-day harvesting is measured from the baseline itself.
  const dows = [...new Set(best.slots.map((s) => s.dayOfWeek))].sort((a, b) => a - b);
  const perDay = dows.map((dow) => {
    const cands = rolls.map((r, ri) => {
      const d = r.score.days.find((x) => x.dayOfWeek === dow);
      return { ri, inTol: !!d?.inTolerance, match: d?.matchPct ?? 0 };
    });
    const chosenRi = rolls.findIndex((r) => r.slots === best.slots);
    const baseD = best.score.days.find((x) => x.dayOfWeek === dow);
    return {
      dow, chosenRi,
      baseInTol: !!baseD?.inTolerance, baseMatch: baseD?.matchPct ?? 0,
      anyInTol: cands.some((c) => c.inTol),
      nInTol: cands.filter((c) => c.inTol).length,
      bestMatch: Math.max(...cands.map((c) => c.match)),
      cands,
    };
  });
  if (probe) probe.push({ rolls: rolls.length, dows: dows.length, perDay });

  // ── MODE dayN: keep the best version of each DAY across the rolls the loop
  //    already ran, instead of the best WHOLE WEEK. No extra solving.
  //    Hard constraint that must survive: the weekly repeat cap
  //    (weeklyPlanner.js:61 DEFAULT_REPEAT_CAP = 2). Days are independent for
  //    macros but NOT for variety, so a free mix can breach it.
  let assembly = null;
  // ── MODE dayNstrict: hill-climb from the winning week (a FEASIBLE point),
  //    accepting a one-day swap only when the WHOLE week still respects the
  //    repeat cap. Cannot breach the variety contract and cannot lose a day.
  if (mode === "dayNstrict" && rolls.length > 1) {
    const cap = repeatCapFor(options);
    const byRollDay = rolls.map((r) => {
      const m = new Map();
      for (const s of r.slots) m.set(s.dayOfWeek, [...(m.get(s.dayOfWeek) || []), s]);
      return m;
    });
    const chosen = new Map();
    for (const dow of dows) chosen.set(dow, perDay.find((p) => p.dow === dow).chosenRi);
    const countWeek = (sel) => {
      const u = new Map();
      for (const s of (options.lockedSlots || [])) if (s.recipeId) u.set(s.recipeId, (u.get(s.recipeId) || 0) + 1);
      for (const [dow, ri] of sel) for (const s of (byRollDay[ri].get(dow) || [])) if (s.recipeId) u.set(s.recipeId, (u.get(s.recipeId) || 0) + 1);
      return u;
    };
    let switched = 0, capBlocked = 0;
    for (const dow of dows) {
      const p = perDay.find((x) => x.dow === dow);
      if (p.baseInTol) continue;                       // already landed; never disturb it
      const ranked = p.cands.slice().filter((c) => c.inTol).sort((a, b) => (b.match - a.match) || (a.ri - b.ri));
      for (const c of ranked) {
        const trial = new Map(chosen); trial.set(dow, c.ri);
        const u = countWeek(trial);
        let ok = true; for (const [, n] of u) if (n > cap) { ok = false; break; }
        if (!ok) { capBlocked++; continue; }
        chosen.set(dow, c.ri); switched++; break;
      }
    }
    const mixSlots = dows.flatMap((dow) => byRollDay[chosen.get(dow)].get(dow) || []);
    const mixScore = solver.scoreWeek(dailyTarget, mixSlots, { proteinPriority: priority });
    const u = countWeek(chosen);
    let maxRepeat = 0; for (const [, n] of u) if (n > maxRepeat) maxRepeat = n;
    let consecDup = 0;
    for (let i = 1; i < dows.length; i++) {
      const a = new Set((byRollDay[chosen.get(dows[i - 1])].get(dows[i - 1]) || []).map((s) => s.recipeId).filter(Boolean));
      for (const s of (byRollDay[chosen.get(dows[i])].get(dows[i]) || [])) if (s.recipeId && a.has(s.recipeId)) consecDup++;
    }
    assembly = { switched, capBlocked, consecDup, maxRepeat, capBreached: maxRepeat > cap };
    if (mixScore.daysInTolerance >= best.score.daysInTolerance) best = { slots: mixSlots, score: mixScore };
    else assembly.rejected = true;
  }
  if (mode === "dayN" && rolls.length > 1) {
    const cap = repeatCapFor(options);
    const byRollDay = rolls.map((r) => {
      const m = new Map();
      for (const s of r.slots) m.set(s.dayOfWeek, [...(m.get(s.dayOfWeek) || []), s]);
      return m;
    });
    // Locked slots count against the cap from day 0, exactly as generateWeekPlan
    // seeds usageCount (weeklyPlanner.js:~968).
    const usage = new Map();
    for (const s of (options.lockedSlots || [])) if (s.recipeId) usage.set(s.recipeId, (usage.get(s.recipeId) || 0) + 1);
    const picked = [];
    let capBlocked = 0, switched = 0;
    for (const dow of dows) {
      const ranked = perDay.find((p) => p.dow === dow).cands
        .slice()
        .sort((a, b) => (b.inTol - a.inTol) || (b.match - a.match) || (a.ri - b.ri));
      let taken = null;
      for (const c of ranked) {
        const daySlots = byRollDay[c.ri].get(dow) || [];
        const add = new Map();
        for (const s of daySlots) if (s.recipeId) add.set(s.recipeId, (add.get(s.recipeId) || 0) + 1);
        let ok = true;
        for (const [id, n] of add) if ((usage.get(id) || 0) + n > cap) { ok = false; break; }
        if (!ok) { capBlocked++; continue; }
        for (const [id, n] of add) usage.set(id, (usage.get(id) || 0) + n);
        taken = { ri: c.ri, slots: daySlots };
        break;
      }
      if (!taken) {
        // Nothing feasible: fall back to the winning week's own day, which is
        // feasible by construction only if it has not already been consumed.
        const chosenRi = perDay.find((p) => p.dow === dow).chosenRi;
        const daySlots = byRollDay[Math.max(0, chosenRi)].get(dow) || [];
        for (const s of daySlots) if (s.recipeId) usage.set(s.recipeId, (usage.get(s.recipeId) || 0) + 1);
        taken = { ri: chosenRi, slots: daySlots, forced: true };
      }
      if (taken.ri !== perDay.find((p) => p.dow === dow).chosenRi) switched++;
      picked.push(taken);
    }
    const mixSlots = picked.flatMap((p) => p.slots);
    const mixScore = solver.scoreWeek(dailyTarget, mixSlots, { proteinPriority: priority });
    // Consecutive-day duplicate count: the soft "don't serve it two days running"
    // bias inside solveDay cannot see across rolls, so mixing may reintroduce it.
    let consecDup = 0;
    for (let i = 1; i < picked.length; i++) {
      const a = new Set(picked[i - 1].slots.map((s) => s.recipeId).filter(Boolean));
      for (const s of picked[i].slots) if (s.recipeId && a.has(s.recipeId)) consecDup++;
    }
    let maxRepeat = 0;
    for (const [, n] of usage) if (n > maxRepeat) maxRepeat = n;
    assembly = { switched, capBlocked, consecDup, maxRepeat, capBreached: maxRepeat > cap };
    // Take the mix only when it is not worse on the product's own week criterion.
    // (Pareto guard: a repeat-cap fallback could in principle lose a day.)
    if (mixScore.daysInTolerance > best.score.daysInTolerance
        || (mixScore.daysInTolerance === best.score.daysInTolerance && mixScore.avgMatch >= best.score.avgMatch)) {
      best = { slots: mixSlots, score: mixScore };
    } else {
      assembly.rejected = true;
    }
  }

  const anyDayMissed = best.score.daysInTolerance < best.score.days.length;  // [P] :743
  const anyUnfilledSlot = best.slots.some((s) => !s.recipeId);
  const floorMissed = priority && best.score.floorDaysMet < best.score.floorDaysTotal;
  const noDaysAtAll = windowDays > 0 && best.score.days.length === 0 && dailyTarget?.kcal > 0;
  best.diagnosis = anyDayMissed || anyUnfilledSlot || floorMissed || noDaysAtAll
    ? solver.diagnoseFromResult({ dailyTarget, slots: best.slots, pool: recipePool, mealConfig, filters, preSolve })
    : null;
  best.attempts = attemptsRun;
  best.assembly = assembly;
  return best;
}

// Transcribed from mealSolver.generateHorizonPlan (:1173-1338), minus the brain
// branch (BRAIN=off) and with bestWeekPlan swapped in.
async function horizonPlan({ dailyTarget, mealConfig, recipePool, horizon, filters = {}, counts = null,
  bias = null, priorPlans = [], lockedSlotsByWindow = [], startDayOfWeek = 0, attempts, rng = Math.random,
  adjusters = null, mode = "week", probe = null }) {
  const t0 = Date.now();
  const windows = solver.horizonWindows(horizon.days, startDayOfWeek);
  const variety = solver.varietyPlanFor({ weeks: windows.length, days: horizon.days, mealConfig, filters });
  const horizonUsage = new Map();
  const lockedUsage = new Map();
  const solvedSoFar = [];
  const results = [];
  let dayCursor = 0;
  const admissionCeiling = variety.horizonRepeatCap - variety.perWeekCap;

  for (let i = 0; i < windows.length; i++) {
    const pool = horizonUsage.size
      ? recipePool.filter((r) => (horizonUsage.get(r.id) || 0) <= admissionCeiling)
      : recipePool;
    const week = await bestWeekPlan(dailyTarget, mealConfig, pool, {
      ...(attempts != null ? { attempts } : {}),
      rng, bias, filters, counts,
      allowBatchRepeats: filters.allowBatchRepeats,
      dayIndices: windows[i],
      lockedSlots: lockedSlotsByWindow[i] || [],
      priorUsage: wp.buildPriorUsage([...solvedSoFar, ...(priorPlans || [])]),
      adjusters,
    }, mode, probe);
    for (const s of week.slots) {
      if (!s.recipeId) continue;
      horizonUsage.set(s.recipeId, (horizonUsage.get(s.recipeId) || 0) + 1);
      if (s.locked) lockedUsage.set(s.recipeId, (lockedUsage.get(s.recipeId) || 0) + 1);
    }
    solvedSoFar.unshift({ slots: week.slots.map((s) => ({ recipeId: s.recipeId })) });
    results.push({
      windowIndex: i, dayIndices: windows[i], poolSize: pool.length,
      slots: week.slots, score: week.score, diagnosis: week.diagnosis, attempts: week.attempts,
      assembly: week.assembly,
      days: week.score.days.map((d) => ({ ...d, windowIndex: i, dayIndex: dayCursor++, key: `${i}:${d.dayOfWeek}` })),
    });
  }

  const allSlots = results.flatMap((r) => r.slots);
  const allDays = results.flatMap((r) => r.days);
  const filledSlots = allSlots.filter((s) => s.recipeId).length;
  const unfilledSlots = allSlots.length - filledSlots;
  let maxRepeat = 0;
  for (const [, n] of horizonUsage) if (n > maxRepeat) maxRepeat = n;
  const requiredDistinct = variety.horizonRepeatCap > 0 ? Math.ceil(filledSlots / variety.horizonRepeatCap) : 0;
  const varietyReport = {
    ...variety, distinctRecipes: horizonUsage.size, maxRepeat,
    filledSlots, unfilledSlots, requiredDistinct,
    capHeld: maxRepeat <= variety.horizonRepeatCap,
    floorHeld: horizonUsage.size >= requiredDistinct,
  };
  const daysInTolerance = allDays.filter((d) => d.inTolerance).length;
  const anyMissed = daysInTolerance < allDays.length;
  const varietyBreached = !varietyReport.capHeld || !varietyReport.floorHeld;
  let diagnosis = null;
  if (anyMissed || unfilledSlots > 0 || varietyBreached) {
    const reasons = uniq(results.flatMap((r) => r.diagnosis?.reasons || []));
    if (reasons.length === 0) reasons.push(`${allDays.length - daysInTolerance} of ${allDays.length} days landed outside your macro tolerance.`);
    diagnosis = { feasible: false, reasons, suggestions: uniq(results.flatMap((r) => r.diagnosis?.suggestions || [])) };
  }
  return { horizon, windows: results, variety: varietyReport, diagnosis, solveMs: Date.now() - t0 };
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
    treatment: `A19-${MODE}`,
    customers: use.length, brain: "off", startDayOfWeek: 0,
    foodFingerprint, poolRaw: rawPool.length, foodRows: foods.length,
    dbPath: db.dbPath, dbHash: db.copyHash,
    startedAt: new Date().toISOString(),
  };

  const stream = fs.createWriteStream(OUT);
  const probeRows = [];
  let days = 0, judged = 0, inBand = 0, disagree = 0, drifted = 0, crashes = 0, badRecords = 0;
  const msAll = [];

  for (const c of use) {
    const rng = mulberry32(childSeed(SEED, c.idx));
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    const target = bmr.computeMacros(c.profile, c.weightKg, derived.target);
    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const pool = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: pool.length };
    const adjusters = adjustersFor(adjusterFoods, c.profile);
    const horizon = solver.resolveHorizon(c.horizonKey);

    const probe = [];
    const t0 = Date.now();
    let result = null, crash = null;
    try {
      result = await horizonPlan({
        dailyTarget: target, mealConfig: c.mealConfig, recipePool: pool, horizon, filters: c.filters,
        counts, adjusters, bias: solver.buildBias(c.filters, null),
        priorPlans: [], lockedSlotsByWindow: [], startDayOfWeek: 0, rng, mode: MODE, probe,
      });
    } catch (e) { crash = String((e && e.message) || e); crashes++; }
    const solveMs = Date.now() - t0;
    msAll.push(solveMs);
    if (PROBE) probeRows.push({ personaId: c.id, personaIdx: c.idx, tier: c.tier, satisfiable: c.satisfiable,
      dietStyle: c.profile.dietaryStyle || "none", poolAfterPrep: pool.length, horizonDays: horizon.days,
      solveMs, windows: probe,
      assembly: result ? result.windows.map((w) => w.assembly) : null,
      varietyCapHeld: result ? result.variety.capHeld : null, maxRepeat: result ? result.variety.maxRepeat : null });

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
          customer: { id: c.id, idx: c.idx, tier: c.tier, satisfiable: c.satisfiable,
            dietStyle: c.profile.dietaryStyle || "none", allergens: c.profile.excludedFoods || [],
            mealsPerDay: c.mealConfig.meals, snacksPerDay: c.mealConfig.snacks, horizonDays: horizon.days },
          day: { dayIndex: eng?.dayIndex ?? dow, dayOfWeek: dow, windowIndex: w.windowIndex },
          target, achieved: ach, achievedSolver: solv, tol, inBand: ok, slots,
          engine: eng ? { inTolerance: eng.inTolerance, matchPct: eng.matchPct } : null,
          honesty: { hasWarning: slots.some((s) => s.warning), hasDiagnosis: !!(w.diagnosis || result.diagnosis) },
          solveMs,
        });
        rec.poolAfterPrep = pool.length;
        const bad = validateRecord(rec);
        if (bad.length) { badRecords++; rec._invalid = bad; }
        days++;
        if (rec.judged) { judged++; if (ok) inBand++; }
        if (rec.verdictDisagrees) disagree++;
        if (Math.abs(rec.drift.kcal) > 1) drifted++;
        stream.write(JSON.stringify(rec) + "\n");
      }
    }
    if (!QUIET && (c.idx + 1) % 25 === 0) process.stderr.write(`\r  ${Math.round(((c.idx + 1) / use.length) * 100)}%  `);
  }
  stream.end();
  await new Promise((r) => stream.on("close", r));
  if (PROBE) fs.writeFileSync(PROBE, probeRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await prisma.$disconnect();

  msAll.sort((a, b) => a - b);
  const q = (p) => msAll[Math.min(msAll.length - 1, Math.floor(msAll.length * p))];
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");
  console.log(`\n[A19] ${LABEL} · mode=${MODE} · seed=${SEED} (${seedName(SEED)})`);
  console.log(`[A19] customers ${use.length} · days ${days} · judged ${judged} · in band ${inBand} (${pct(inBand, judged)}%)`);
  console.log(`[A19] solveMs p50 ${q(0.5)} · p95 ${q(0.95)} · total ${((Date.now() - t00) / 1000).toFixed(1)}s`);
  console.log(`[A19] bounds [${SCALE_LO}, ${SCALE_HI}] · fingerprint ${foodFingerprint}`);
  console.log(`[A19] INSTRUMENT CHECKS  verdict-disagreements ${disagree} · kcal-drift>1 ${drifted} · crashes ${crashes} · invalid ${badRecords}   (all must be 0)`);
  console.log(`[A19] -> ${OUT}${PROBE ? ` · probe -> ${PROBE}` : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
