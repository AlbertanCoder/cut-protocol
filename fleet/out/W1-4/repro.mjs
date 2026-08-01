// W1-4 — direct reproduction of the silent-miss vectors E5, E6, E7, D6, E9, E10.
// BRAIN=off, network trapped and counted. No product source is modified.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

process.env.BRAIN = "off";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const PERSONAS = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

// ── isolated DB copy (never the shared dev.db) ───────────────────────────────
const dir = path.resolve(REPO, "fleet/scratch/W1-4");
fs.mkdirSync(dir, { recursive: true });
const dbPath = path.resolve(dir, "dev.db");
if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — resolved to the SHARED dev.db");
if (!fs.existsSync(dbPath)) {
  fs.copyFileSync(SHARED_DB, dbPath);
  for (const ext of ["-wal", "-shm"]) if (fs.existsSync(SHARED_DB + ext)) fs.copyFileSync(SHARED_DB + ext, dbPath + ext);
}
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;
if (norm(String(process.env.DATABASE_URL).slice(5)) === norm(SHARED_DB)) throw new Error("DATABASE_URL points at SHARED dev.db");

const require_ = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const solver = require_(path.join(B, "src/lib/mealSolver.js"));
const wp = require_(path.join(B, "src/lib/weeklyPlanner.js"));
const planCtx = require_(path.join(B, "src/lib/planContext.js"));
const bmr = require_(path.join(B, "src/lib/bmrEngine.js"));
const { prisma } = require_(path.join(B, "src/lib/prisma.js"));

// ── GROUND RULE #1: trap every outbound call, count it, never assume ─────────
let netCalls = 0;
const trap = (name) => () => { netCalls++; throw new Error(`NETWORK CALL ATTEMPTED: ${name} — P0`); };
const R = {};

// deterministic RNG (mulberry32) so every number below is reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const out = { agent: "W1-4", brain: process.env.BRAIN, vectors: {} };
const round = (x, n = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x);

// ═══════════════════════════════════════════════════════════════════════════
// E5 — non-finite kcalTarget ⇒ clamp falls to min = 0.5 ⇒ HALF PORTION,
//      warning: null. An INFINITE ask produces the SMALLEST plate.
// ═══════════════════════════════════════════════════════════════════════════
async function e5(pool) {
  const recipe = pool.find((r) => r.kcal > 300 && r.protein > 20);
  const clampProbe = {
    // weeklyPlanner.js:294 — const clamp = (v,{min,max}) => Number.isFinite(v) ? ... : min
    source: "weeklyPlanner.js:294",
    SCALE_BOUNDS: wp.SCALE_BOUNDS,
  };
  const scaledNaN = wp.scaleRecipe(recipe, NaN, 40);
  const scaledInf = wp.scaleRecipe(recipe, Infinity, 40);
  const scaledNormal = wp.scaleRecipe(recipe, recipe.kcal, 40);

  // Reach it through resolveSlot, the shipping path, and read the WARNING.
  const mk = (kcalTarget) => ({ dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget, proteinTarget: 40 });
  const rs = {};
  for (const [label, kt] of [["NaN", NaN], ["Infinity", Infinity], ["undefined", undefined], ["normal", recipe.kcal]]) {
    const res = await wp.resolveSlot(mk(kt), [recipe], new Map(), new Set(), new Set(), mulberry32(1), null, null, 2);
    rs[label] = {
      recipeId: res.recipeId ? "(filled)" : null,
      proteinScale: res.proteinScale, sidesScale: res.sidesScale,
      kcal: round(res.kcal, 1), protein: round(res.protein, 1),
      warning: res.warning,
    };
  }
  return {
    claim: "non-finite kcalTarget -> clamp falls to min 0.5 -> half portion shipped with warning:null",
    clampProbe,
    baseRecipe: { name: recipe.name, kcal: round(recipe.kcal, 1), protein: round(recipe.protein, 1) },
    scaleRecipe_direct: {
      NaN: { proteinScale: scaledNaN.proteinScale, sidesScale: scaledNaN.sidesScale, kcal: round(scaledNaN.kcal, 1) },
      Infinity: { proteinScale: scaledInf.proteinScale, sidesScale: scaledInf.sidesScale, kcal: round(scaledInf.kcal, 1) },
      normal: { proteinScale: scaledNormal.proteinScale, sidesScale: scaledNormal.sidesScale, kcal: round(scaledNormal.kcal, 1) },
    },
    resolveSlot_shipped: rs,
    reachability: "backend/src/lib/brain/tools.js:74 scaleRecipeTool({recipeId,kcalTarget,proteinTarget}) — only recipeId is validated (throws when not in pool); kcalTarget/proteinTarget are passed straight through with no finiteness check.",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// E6 — a locked slot at 100% of the day's budget floors budgetKcal to 0 ⇒
//      kcalOffPct/proteinShortfallPct return 0 for EVERY candidate ⇒ the
//      accept gate (weeklyPlanner.js:630) passes unconditionally, silently.
// ═══════════════════════════════════════════════════════════════════════════
async function e6(pool) {
  const dailyTarget = {
    kcal: 2000, proteinLo: 150, proteinHi: 170, proteinMid: 160,
    fatLo: 55, fatHi: 65, fatMid: 60, carbLo: 180, carbHi: 220, carbMid: 200, keto: false,
  };
  const mealConfig = { meals: 3, snacks: 0 };
  const dayTargets = wp.targetsForSlots(dailyTarget, wp.buildSlots(mealConfig));
  const results = {};

  for (const lockPct of [0, 0.5, 1.0, 1.3]) {
    const locked = lockPct > 0
      ? [{
          dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: pool[0].id,
          proteinScale: 1, sidesScale: 1, ingredients: [],
          kcal: dailyTarget.kcal * lockPct, protein: 60, fat: 40, carb: 100,
          locked: true, warning: null,
        }]
      : [];
    const lockedByKey = locked.length ? wp.buildLockedMap(locked) : null;
    const { slots } = await wp.solveDay(
      dayTargets, dailyTarget, pool, new Map(), new Set(), mulberry32(424242),
      null, null, 2, null, lockedByKey
    );
    const totals = slots.reduce((a, s) => ({
      kcal: a.kcal + (s.kcal || 0), protein: a.protein + (s.protein || 0),
      fat: a.fat + (s.fat || 0), carb: a.carb + (s.carb || 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
    const tol = solver.dayTolerance(dailyTarget, totals);
    results[`lock_${Math.round(lockPct * 100)}pct`] = {
      lockedKcal: round(dailyTarget.kcal * lockPct, 0),
      budgetKcal_derived: round(Math.max(0, dailyTarget.kcal - dailyTarget.kcal * lockPct), 1),
      shippedTotals: { kcal: round(totals.kcal, 0), protein: round(totals.protein, 1), fat: round(totals.fat, 1), carb: round(totals.carb, 1) },
      slotWarnings: slots.filter((s) => s.warning).length,
      slotWarningTexts: slots.map((s) => s.warning).filter(Boolean),
      openSlotsFilled: slots.filter((s) => s.recipeId && !s.locked).length,
      inBand: solver.dayInTolerance(tol),
      fatOverPct: round(tol.fatOverPct, 4), kcalDeltaPct: round(tol.kcalDeltaPct, 4),
      missLine: solver.dayMissLine(dailyTarget, totals),
    };
  }
  const a = results.lock_100pct, b = results.lock_130pct;
  return {
    claim: "a locked slot at >=100% of budget floors budgetKcal to 0; kcalOffPct(0,x)=0 and proteinShortfallPct(0,x)=0 (weeklyPlanner.js:420-428) so the :630 accept gate passes on the FIRST draw for every open slot — no warning ever forms",
    mechanism: "weeklyPlanner.js:889 budgetKcal = Math.max(0, dailyTarget.kcal - lockedKcal); :896 kcalTarget = budgetKcal * share = 0",
    results,
    lock100_vs_lock130_indistinguishable:
      a.shippedTotals.kcal === b.shippedTotals.kcal && a.slotWarnings === b.slotWarnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// D6 — compositionReach() evaluates at the EXACT kcal target while the day is
//      graded on kcal +/-15%, so the tested interval is a strict subset and
//      `unreachable` false-fires in both directions by ~15%.
// ═══════════════════════════════════════════════════════════════════════════
function d6() {
  // Synthetic pool with ONE fat-per-kcal ratio, chosen so:
  //   at 1.00x kcal the day's fat lands ABOVE allowHiG  -> declared unreachable
  //   at 1.15x kcal (still inside the +/-15% kcal gate) it lands INSIDE the band
  // Wait: more fat at more kcal. The false-fire that HELPS is on the SHORT side:
  //   at 1.00x the pool's max fat is BELOW allowLoG -> "short", unreachable
  //   at 1.15x kcal it clears allowLoG -> a real in-gate day exists.
  const dailyTarget = {
    kcal: 2000, proteinLo: 140, proteinHi: 160, proteinMid: 150,
    fatLo: 60, fatHi: 80, fatMid: 70, carbLo: 180, carbHi: 220, carbMid: 200, keto: false,
  };
  const FAT_TOL = solver.DAY_FAT_TOLERANCE_PCT;          // 0.25
  const allowLoG = Math.max(0, dailyTarget.fatLo - dailyTarget.fatMid * FAT_TOL); // 60 - 17.5 = 42.5
  const allowHiG = dailyTarget.fatHi + dailyTarget.fatMid * FAT_TOL;              // 80 + 17.5 = 97.5

  // pick fat-per-kcal so poolHi * 2000 < 42.5 but poolHi * 2300 > 42.5
  const perKcal = 0.0205;   // 41.0 g at 2000 kcal ; 47.15 g at 2300 kcal
  const pool = [
    { id: "r1", name: "low-fat A", kcal: 500, protein: 40, fat: 500 * perKcal, carb: 60, slotTypes: ["meal"], mealType: "dinner" },
    { id: "r2", name: "low-fat B", kcal: 600, protein: 45, fat: 600 * perKcal, carb: 70, slotTypes: ["meal"], mealType: "lunch" },
  ];
  // Reproduce compositionReach's arithmetic exactly (mealSolver.js:1027-1052)
  let poolLo = Infinity, poolHi = -Infinity;
  for (const r of pool) { const pk = r.fat / r.kcal; poolLo = Math.min(poolLo, pk); poolHi = Math.max(poolHi, pk); }
  const reachLoG = poolLo * dailyTarget.kcal;
  const reachHiG = poolHi * dailyTarget.kcal;
  const unreachable = reachLoG > allowHiG ? "over" : reachHiG < allowLoG ? "short" : null;

  // The SAME arithmetic at the top of the kcal gate — a day the ruler accepts
  const kcalHi = dailyTarget.kcal * (1 + solver.DAY_KCAL_TOLERANCE_PCT);
  const kcalLo = dailyTarget.kcal * (1 - solver.DAY_KCAL_TOLERANCE_PCT);
  const reachHiG_atKcalHi = poolHi * kcalHi;
  const reachLoG_atKcalLo = poolLo * kcalLo;

  // Prove a REAL day inside the gate: scale the pool to kcalHi and grade it.
  const scale = kcalHi / (pool[0].kcal + pool[1].kcal);
  const realDay = {
    kcal: (pool[0].kcal + pool[1].kcal) * scale,
    protein: (pool[0].protein + pool[1].protein) * scale,
    fat: (pool[0].fat + pool[1].fat) * scale,
    carb: (pool[0].carb + pool[1].carb) * scale,
  };
  const tol = solver.dayTolerance(dailyTarget, realDay);

  // Does classifyBinding actually emit the sentence?
  const binding = solver.classifyBinding({
    counts: { raw: pool.length, afterDiet: pool.length, afterPrep: pool.length },
    filters: {}, dailyTarget, mealConfig: { meals: 2, snacks: 0 }, pool, days: 1,
  });

  return {
    claim: "compositionReach (mealSolver.js:1047-1048) evaluates poolLo/poolHi * dailyTarget.kcal — the EXACT target — while dayTolerance grades kcal at +/-15%. The tested interval is a strict subset of the reachable one, so `unreachable` false-fires by ~15% in both directions.",
    band: { fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi, allowLoG, allowHiG },
    poolFatPerKcal: { poolLo: round(poolLo, 5), poolHi: round(poolHi, 5) },
    testedAtExactKcal: { kcal: dailyTarget.kcal, reachLoG: round(reachLoG, 2), reachHiG: round(reachHiG, 2), unreachable },
    reachableInsideTheKcalGate: {
      kcalLo, kcalHi,
      reachLoG_atKcalLo: round(reachLoG_atKcalLo, 2),
      reachHiG_atKcalHi: round(reachHiG_atKcalHi, 2),
      clearsAllowLoG: reachHiG_atKcalHi >= allowLoG,
    },
    counterexampleDay: {
      kcal: round(realDay.kcal, 1), protein: round(realDay.protein, 1),
      fat: round(realDay.fat, 1), carb: round(realDay.carb, 1),
      kcalOk: tol.kcalOk, fatOk: tol.fatOk, proteinOk: tol.proteinOk, carbOk: tol.carbOk,
      inBandOnFatAndKcal: tol.kcalOk && tol.fatOk,
    },
    classifyBindingSays: binding,
    falseFireMagnitudePct: round(solver.DAY_KCAL_TOLERANCE_PCT * 100, 1),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// E9 — /day-options sorts on matchPct ALONE (mealSolver.js:504). A day outside
//      the 4-macro tolerance can outrank an in-tolerance day and be offered first.
// ═══════════════════════════════════════════════════════════════════════════
async function e9(personas, rawPool) {
  let runs = 0, runsWithInTolCandidate = 0, misordered = 0;
  const examples = [];
  for (const c of personas) {
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    const target = bmr.computeMacros(c.profile, c.weightKg, derived.target);
    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const afterPrep = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const { survivors: pool } = solver.applyFilterStack(afterPrep, c.filters, null);
    if (!pool.length) continue;
    let res;
    try {
      res = await solver.generateDayCandidates({
        dailyTarget: target, mealConfig: c.mealConfig, recipePool: pool,
        dayOfWeek: 0, filters: c.filters, rng: mulberry32(424242 ^ c.idx),
      });
    } catch { continue; }
    const cands = res.candidates || [];
    if (cands.length < 2) continue;
    runs++;
    const anyInTol = cands.some((x) => x.inTolerance === true);
    if (!anyInTol) continue;
    runsWithInTolCandidate++;
    if (cands[0].inTolerance === false) {
      misordered++;
      if (examples.length < 6) {
        const better = cands.find((x) => x.inTolerance === true);
        examples.push({
          personaId: c.id, diet: c.profile.dietaryStyle || "none",
          offeredFirst: { matchPct: cands[0].score.matchPct, inTolerance: cands[0].inTolerance, miss: cands[0].miss },
          demotedInTolerance: { matchPct: better.score.matchPct, inTolerance: better.inTolerance },
          rankOfFirstInTolerance: cands.findIndex((x) => x.inTolerance === true) + 1,
          candidateCount: cands.length,
        });
      }
    }
  }
  return {
    claim: "generateDayCandidates ranks on score.matchPct alone (mealSolver.js:503-505); the 4-macro `inTolerance` verdict computed at :482-490 is carried on every candidate but is NOT a sort key. An out-of-tolerance day can therefore be offered first while an in-tolerance one is demoted.",
    runsWithAtLeast2Candidates: runs,
    runsWhereAnInToleranceCandidateExisted: runsWithInTolCandidate,
    runsWhereAnOutOfToleranceDayWasOfferedFirst: misordered,
    ratePctOfRunsWithAnInToleranceOption: runsWithInTolCandidate ? round((misordered / runsWithInTolCandidate) * 100, 2) : null,
    examples,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// E10 — alternatesForSlot never sorts, yet both call sites take options[0]
//       and call it `best`.
// ═══════════════════════════════════════════════════════════════════════════
async function e10(personas, rawPool) {
  let draws = 0, notBest = 0;
  let sumGap = 0, maxGap = 0;
  const examples = [];
  for (const c of personas) {
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    const target = bmr.computeMacros(c.profile, c.weightKg, derived.target);
    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const afterPrep = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const { survivors: pool } = solver.applyFilterStack(afterPrep, c.filters, null);
    if (pool.length < 4) continue;
    const dayTargets = wp.targetsForSlots(target, wp.buildSlots(c.mealConfig));
    for (const st of dayTargets.filter((t) => t.dayOfWeek === 0)) {
      let options;
      try {
        options = await solver.alternatesForSlot({
          slotTarget: st, recipePool: pool, existingSlots: [], filters: c.filters,
          count: 3, rng: mulberry32(8675309 ^ c.idx ^ st.slotIndex),
        });
      } catch { continue; }
      if (options.length < 2) continue;
      draws++;
      const top = Math.max(...options.map((o) => o.matchPct));
      if (options[0].matchPct < top) {
        notBest++;
        const gap = top - options[0].matchPct;
        sumGap += gap; maxGap = Math.max(maxGap, gap);
        if (examples.length < 6) examples.push({
          personaId: c.id, slotType: st.slotType, slotIndex: st.slotIndex,
          offeredAsBest: options[0].matchPct, actualBest: top, gapPts: gap,
          order: options.map((o) => o.matchPct),
        });
      }
    }
  }
  return {
    claim: "alternatesForSlot (mealSolver.js:821-863) pushes alternates in DRAW order and returns them unsorted; mealSolver.js:1388 (solveOneMeal) and routes/plans.js:260 both assign options[0] to `best`.",
    sortCallsInAlternatesForSlot: 0,
    draws, drawsWhereOptions0IsNotTopScoring: notBest,
    ratePct: draws ? round((notBest / draws) * 100, 2) : null,
    meanGapPtsWhenWrong: notBest ? round(sumGap / notBest, 2) : null,
    maxGapPts: maxGap,
    examples,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// E7 — the result object carries NO field naming the clamp.
// ═══════════════════════════════════════════════════════════════════════════
async function e7(pool) {
  const recipe = pool.find((r) => r.kcal > 400);
  // Ask for a slot far below what the smallest dish can shrink to -> lo pin.
  const st = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget: 60, proteinTarget: 5 };
  const res = await wp.resolveSlot(st, [recipe], new Map(), new Set(), new Set(), mulberry32(7), null, null, 2);
  const keys = Object.keys(res);
  const pinRe = /pin|bound|clamp|limit|floor|ceil/i;
  const scaled = wp.scaleRecipe(recipe, 60, 5);
  return {
    claim: "a solve pinned at the 0.5x portion floor is clamped silently — the shipped slot object carries no field naming the pin",
    askedKcal: 60,
    baseRecipeKcal: round(recipe.kcal, 1),
    shippedKcal: round(res.kcal, 1),
    overshootPct: round(((res.kcal - 60) / 60) * 100, 1),
    proteinScale: res.proteinScale, sidesScale: res.sidesScale,
    atLoBound: scaled.proteinScale === wp.SCALE_BOUNDS.min || scaled.sidesScale === wp.SCALE_BOUNDS.min,
    resultKeys: keys,
    keysMatchingPinBoundClampLimitFloorCeil: keys.filter((k) => pinRe.test(k)),
    warning: res.warning,
    warningNamesThePin: res.warning ? pinRe.test(res.warning) : false,
  };
}

// ── run ──────────────────────────────────────────────────────────────────────
(async () => {
  const rawRecipes = await prisma.recipe.findMany({
    include: { ingredients: { include: { food: true } } },
  });
  const rawPool = planCtx.toSolverRecipes ? planCtx.toSolverRecipes(rawRecipes) : rawRecipes;

  // Arm the network trap only AFTER the DB/pool is warm (mirrors dayDump.mjs).
  R.httpReq = http.request; R.httpGet = http.get;
  R.httpsReq = https.request; R.httpsGet = https.get;
  R.fetch = globalThis.fetch;
  http.request = trap("http.request"); http.get = trap("http.get");
  https.request = trap("https.request"); https.get = trap("https.get");
  globalThis.fetch = trap("fetch");

  // Persona -> solver inputs, byte-for-byte the mapping dayDump.mjs:165-205 uses,
  // so E9/E10 run against the SAME population shape as the canonical dump.
  const personas = fs.readFileSync(PERSONAS, "utf8").trim().split("\n").filter(Boolean).map((l, i) => {
    const p = JSON.parse(l);
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
      id: p.id, idx: p.idx ?? i, tier: p.tier, satisfiable: p.tier !== "IMPOSSIBLE",
      profile, weightKg: pr.startWeightKg,
      mealConfig: { meals: pr.mealsPerDay, snacks: pr.snacksPerDay },
      dietProfile: { dietaryStyle: profile.dietaryStyle, excludedFoods: profile.excludedFoods },
      filters: {
        cuisines: p.filters?.cuisines || [], protein: null,
        budget: p.filters?.budget ?? null, maxPrepMin: p.filters?.maxPrepMin ?? null,
        maxCostCad: p.filters?.maxCostCad ?? null,
        maxComplexity: p.filters?.maxComplexity ?? null,
        minTaste: p.filters?.minTaste ?? null,
        allowBatchRepeats: false, proteinPriority: !!p.filters?.proteinPriority,
      },
      horizonKey: p.horizon || "week",
    };
  });

  out.provenance = {
    dbSha256: crypto.createHash("sha256").update(fs.readFileSync(SHARED_DB)).digest("hex").slice(0, 16),
    recipeRows: rawPool.length,
    personas: personas.length,
    personasSha256: crypto.createHash("sha256").update(fs.readFileSync(PERSONAS)).digest("hex").slice(0, 16),
    SCALE_BOUNDS: wp.SCALE_BOUNDS,
    DAY_KCAL_TOLERANCE_PCT: solver.DAY_KCAL_TOLERANCE_PCT,
    DAY_FAT_TOLERANCE_PCT: solver.DAY_FAT_TOLERANCE_PCT,
  };

  out.vectors.E5 = await e5(rawPool);
  out.vectors.E6 = await e6(rawPool);
  out.vectors.E7 = await e7(rawPool);
  out.vectors.D6 = d6();
  out.vectors.E9 = await e9(personas, rawPool);
  out.vectors.E10 = await e10(personas, rawPool);

  // restore
  http.request = R.httpReq; http.get = R.httpGet;
  https.request = R.httpsReq; https.get = R.httpsGet;
  globalThis.fetch = R.fetch;
  out.networkCallsAttempted = netCalls;

  fs.writeFileSync("fleet/out/W1-4/repro.json", JSON.stringify(out, null, 2));
  for (const k of Object.keys(out.vectors)) {
    console.log("\n" + "=".repeat(70) + "\n" + k + "\n" + "=".repeat(70));
    console.log(JSON.stringify(out.vectors[k], null, 2));
  }
  console.log("\nNETWORK CALLS ATTEMPTED:", netCalls);
  await prisma.$disconnect();
})().catch(async (e) => { console.error("FATAL", e); process.exitCode = 1; });
