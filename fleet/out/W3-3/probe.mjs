// W3-3 selection-probe — measurement only. Nothing under backend/src or
// frontend/src is touched; this file lives in fleet/scratch and imports product
// code read-only.
//
//   BRAIN=off node fleet/scratch/W3-3/probe.mjs --seed=424242 --out=fleet/out/W3-3/probe-s424242.json
//
// WHAT IT MEASURES (mission A-F)
//   A. cap-violation rate of the naive per-day-argmax cherry-pick, per diet
//   B. oracle (post-hoc per-day best-of, ignores cap) vs realised cap-feasible
//   C. W2-2's safe rule (cherry-pick -> check -> attain-or-repair) + LNS repair
//   D. the free permutation (weekday assignment) vs usedYesterday adjacency
//   E. variety violations for EVERY arm (cap breaches + adjacency repeats)
//   F. D5 - attempts exhausted, dayTolerance as the selection key
//
// It re-runs its own baseline (A3) by reconstructing generateBestWeekPlan's
// selection from the same attempt stream, and cross-checks that reconstruction
// against W1-2's canonical dump day-by-day.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

process.env.BRAIN = "off";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const PERSONAS_PATH = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));
const SEED = Number(argv.seed ?? 424242);
const K = Number(argv.k ?? 5);              // attempts per persona (shipping default 5)
// budget ladder: arms are reconstructed at each of these attempt counts from the
// SAME attempt stream, so k=5 is bit-identical to the shipping run.
const KS = String(argv.ks || "1,5").split(",").map(Number).filter((x) => x >= 1);
const K_MAIN = Number(argv.kmain ?? 5);     // the k the headline arms are built at
const N = argv.n ? Number(argv.n) : null;
const AGENT = "W3-3";
const LNS_ROUNDS = Number(argv.lnsRounds ?? 3);
const LNS_DESTROY = Number(argv.lnsDestroy ?? 2);
const LNS_TRIES = Number(argv.lnsTries ?? 3);
const OUT = path.resolve(REPO, String(argv.out || `fleet/out/W3-3/probe-s${SEED}.json`));
const XCHECK = argv.xcheck ? path.resolve(REPO, String(argv.xcheck)) : null;

const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// ── DB isolation (dayDump.mjs method, verbatim) ─────────────────────────────
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
function prepareDb(agentId) {
  if (!fs.existsSync(SHARED_DB)) throw new Error(`shared DB not found at ${SHARED_DB}`);
  const dir = path.resolve(REPO, "fleet/scratch", agentId);
  const dbPath = path.resolve(dir, "dev.db");
  if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — resolved to the SHARED dev.db");
  fs.mkdirSync(dir, { recursive: true });
  if (argv.freshdb || !fs.existsSync(dbPath)) {
    fs.copyFileSync(SHARED_DB, dbPath);
    for (const ext of ["-wal", "-shm"]) {
      const src = SHARED_DB + ext;
      if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + ext);
      else if (fs.existsSync(dbPath + ext)) fs.rmSync(dbPath + ext);
    }
  }
  process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;
  return { dbPath, sourceSha256: sha256(SHARED_DB), copySha256: sha256(dbPath) };
}
const DB = prepareDb(AGENT);
if (norm(String(process.env.DATABASE_URL).slice(5)) === norm(SHARED_DB)) throw new Error("DATABASE_URL points at the SHARED dev.db — refusing");

const require_ = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const bmr = require_(path.join(B, "src/lib/bmrEngine.js"));
const solver = require_(path.join(B, "src/lib/mealSolver.js"));
const planner = require_(path.join(B, "src/lib/weeklyPlanner.js"));
const planCtx = require_(path.join(B, "src/lib/planContext.js"));
const gate = require_(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require_(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require_(path.join(B, "src/lib/prisma.js"));

// repeatCapFor is not exported; this is weeklyPlanner.js:113-116 verbatim.
const repeatCapFor = (options) =>
  Number.isInteger(options?.repeatCap) ? options.repeatCap
    : (options?.allowBatchRepeats ? planner.BATCH_REPEAT_CAP : planner.DEFAULT_REPEAT_CAP);

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

function loadPersonas() {
  const rows = fs.readFileSync(PERSONAS_PATH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
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
      id: p.id, idx: p.idx, tier: p.tier, satisfiable: p.tier !== "IMPOSSIBLE",
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

// ── day digest: everything an arm needs, graded by the PRODUCT's own ruler ──
function digestDay(target, slots, priority) {
  const totals = slots.reduce(
    (a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein, fat: a.fat + s.fat, carb: a.carb + s.carb }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  const tol = solver.dayTolerance(target, totals);
  const inBand = solver.dayInTolerance(tol);
  const sc = solver.scoreDay(target, slots, { proteinPriority: priority });
  const recipeIds = slots.map((s) => s.recipeId).filter((x) => x != null);
  return {
    inBand, matchPct: sc.matchPct,
    floorMet: priority ? !!sc.proteinFloor?.met : false,
    filled: recipeIds.length, slotsTotal: slots.length,
    recipeIds,
    sig: recipeIds.slice().sort((a, b) => a - b).join(",") + "|" + slots.map((s) => `${s.recipeId}:${s.proteinScale}:${s.sidesScale}`).join("|"),
    totals: { kcal: r2(totals.kcal), protein: r2(totals.protein), fat: r2(totals.fat), carb: r2(totals.carb) },
  };
}

// selection key for one day, mirroring generateBestWeekPlan's week key
const dayBetter = (a, b, priority) => {
  if (!b) return true;
  if (a.inBand !== b.inBand) return a.inBand;
  if (priority && a.floorMet !== b.floorMet) return a.floorMet;
  return a.matchPct > b.matchPct;
};

const weekBetter = (s, best, priority) => {
  if (!best) return true;
  if (s.daysInTolerance !== best.daysInTolerance) return s.daysInTolerance > best.daysInTolerance;
  if (priority && (s.floorDaysMet ?? 0) !== (best.floorDaysMet ?? 0)) return (s.floorDaysMet ?? 0) > (best.floorDaysMet ?? 0);
  return s.avgMatch > best.avgMatch;
};

const usageOf = (days) => {
  const m = new Map();
  for (const d of days) for (const id of d.recipeIds) m.set(id, (m.get(id) || 0) + 1);
  return m;
};
const maxUsage = (m) => { let x = 0; for (const v of m.values()) if (v > x) x = v; return x; };

// adjacency: calendar-consecutive day pairs (dayIndices order) sharing a recipe
function adjacency(days) {
  let pairs = 0, incidences = 0;
  for (let i = 1; i < days.length; i++) {
    const prev = new Set(days[i - 1].recipeIds);
    let hit = 0;
    for (const id of days[i].recipeIds) if (prev.has(id)) hit++;
    if (hit) pairs++;
    incidences += hit;
  }
  return { pairs, incidences };
}

// exact cap-feasible master over the candidate set: one candidate per calendar
// day, maximise days-in-band then total matchPct, subject to usage(r) <= cap.
// DFS + bound; the instance is 7 x K.
function exactMaster(perDay, cap, priority) {
  const D = perDay.length;
  // dedupe identical candidates per day
  const cands = perDay.map((list) => {
    const seen = new Map();
    for (const c of list) if (!seen.has(c.sig)) seen.set(c.sig, c);
    return [...seen.values()].sort((a, b) => (b.inBand - a.inBand) || (priority ? (b.floorMet - a.floorMet) : 0) || (b.matchPct - a.matchPct));
  });
  const suffixBest = new Array(D + 1).fill(0);
  for (let i = D - 1; i >= 0; i--) suffixBest[i] = suffixBest[i + 1] + (cands[i].some((c) => c.inBand) ? 1 : 0);
  let bestScore = -1, bestMatch = -1, bestPick = null;
  const usage = new Map();
  const pick = new Array(D);
  let nodes = 0, truncated = false;
  const NODE_CAP = 4_000_000;
  const dfs = (i, score, match) => {
    nodes++;
    if (nodes > NODE_CAP) { truncated = true; return; } // never reached at K<=5
    if (i === D) {
      if (score > bestScore || (score === bestScore && match > bestMatch)) {
        bestScore = score; bestMatch = match; bestPick = pick.slice();
      }
      return;
    }
    if (score + suffixBest[i] < bestScore) return;
    for (const c of cands[i]) {
      let ok = true;
      const bumped = [];
      for (const id of c.recipeIds) {
        const n = (usage.get(id) || 0) + 1;
        usage.set(id, n); bumped.push(id);
        if (n > cap) { ok = false; break; }
      }
      if (ok) { pick[i] = c; dfs(i + 1, score + (c.inBand ? 1 : 0), match + c.matchPct); }
      for (const id of bumped) { const n = usage.get(id) - 1; if (n <= 0) usage.delete(id); else usage.set(id, n); }
    }
  };
  dfs(0, 0, 0);
  return { pick: bestPick, daysInBand: Math.max(0, bestScore), nodes, truncated, feasible: bestPick != null };
}

// naive greedy-with-skip — MEASURED FOR REFERENCE ONLY. W2-2 §3(iv) forbids
// shipping it: it converts a bound into an unquantified heuristic.
function greedySkip(perDay, cap, priority) {
  const usage = new Map();
  const out = [];
  for (const list of perDay) {
    const sorted = list.slice().sort((a, b) => (b.inBand - a.inBand) || (priority ? (b.floorMet - a.floorMet) : 0) || (b.matchPct - a.matchPct));
    let chosen = null;
    for (const c of sorted) {
      const tmp = new Map();
      let ok = true;
      for (const id of c.recipeIds) { const n = (usage.get(id) || 0) + (tmp.get(id) || 0) + 1; tmp.set(id, (tmp.get(id) || 0) + 1); if (n > cap) { ok = false; break; } }
      if (ok) { chosen = c; break; }
    }
    if (!chosen) chosen = sorted[0];   // no legal candidate: keep the best, record the breach
    for (const id of chosen.recipeIds) usage.set(id, (usage.get(id) || 0) + 1);
    out.push(chosen);
  }
  return out;
}

// optimal weekday permutation minimising adjacency incidences. Objective is
// invariant to which weekday a candidate lands on (targets are calendar-day
// invariant: weeklyPlanner.js:145-149 + :159-175), so this is free by
// construction — and verified numerically (daysInBand must not move).
function bestPermutation(days) {
  const D = days.length;
  if (D < 3) return { order: days.map((_, i) => i), adjacency: adjacency(days) };
  const sets = days.map((d) => new Set(d.recipeIds));
  const shared = (i, j) => { let n = 0; for (const id of sets[j]) if (sets[i].has(id)) n++; return n; };
  const cost = Array.from({ length: D }, (_, i) => Array.from({ length: D }, (_, j) => shared(i, j)));
  let bestOrder = null, bestCost = Infinity, bestPairs = Infinity;
  const used = new Array(D).fill(false);
  const order = new Array(D);
  const dfs = (pos, c, p) => {
    if (c > bestCost) return;
    if (pos === D) {
      if (c < bestCost || (c === bestCost && p < bestPairs)) { bestCost = c; bestPairs = p; bestOrder = order.slice(); }
      return;
    }
    for (let i = 0; i < D; i++) {
      if (used[i]) continue;
      const add = pos === 0 ? 0 : cost[order[pos - 1]][i];
      used[i] = true; order[pos] = i;
      dfs(pos + 1, c + add, p + (add > 0 ? 1 : 0));
      used[i] = false;
    }
  };
  dfs(0, 0, 0);
  return { order: bestOrder, adjacency: { pairs: bestPairs, incidences: bestCost } };
}

function gitInfo() {
  const run = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); } catch { return null; } };
  return { sha: run(["rev-parse", "HEAD"]), branch: run(["rev-parse", "--abbrev-ref", "HEAD"]), srcPorcelain: run(["status", "--porcelain", "--", "backend/src", "frontend/src"]) || "" };
}

async function main() {
  const t00 = Date.now();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true } });
  const recipeNameById = new Map(rawPool.map((r) => [r.id, r.name]));
  const adjusterFoods = await loadAdjusterFoods();
  const foodFingerprint = crypto.createHash("sha256")
    .update(foods.map((f) => `${f.id}:${f.kcal}:${f.protein}:${f.fat}:${f.carb}`).sort().join("|")).digest("hex");

  // ── ground rule #1: trap the network AFTER prisma is warm ──────────────────
  let netCalls = 0;
  const trap = (label) => () => { netCalls++; throw new Error(`W3-3 probe attempted a ${label} call — ground rule #1 violated`); };
  https.request = trap("https.request"); https.get = trap("https.get");
  http.request = trap("http.request"); http.get = trap("http.get");
  if (globalThis.fetch) globalThis.fetch = trap("fetch");
  if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

  const all = loadPersonas();
  const use = N ? all.slice(0, N) : all;
  const rows = [];
  let lnsSolves = 0;

  for (const c of use) {
    const rng = mulberry32(childSeed(SEED, c.idx));
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    const target = bmr.computeMacros(c.profile, c.weightKg, derived.target);
    const priority = !!c.filters.proteinPriority;

    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const afterPrep = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const { survivors: pool, explain: stackExplain } = solver.applyFilterStack(afterPrep, c.filters, null);
    const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: afterPrep.length, afterStack: pool.length, stackExplain };
    const adjusters = adjustersFor(adjusterFoods, c.profile);
    const horizon = solver.resolveHorizon(c.horizonKey);
    const windows = solver.horizonWindows(horizon.days, 0);
    const bias = solver.buildBias(c.filters, null);
    const priorUsage = planner.buildPriorUsage([]);
    const cap = repeatCapFor({ allowBatchRepeats: c.filters.allowBatchRepeats });

    // single-window by construction for this population (all personas are
    // 1-day or 1-week); assert rather than assume.
    if (windows.length !== 1) throw new Error(`persona ${c.id} has ${windows.length} windows — probe assumes 1`);
    const dayIndices = windows[0];

    const wkOpts = {
      rng, bias, filters: c.filters, counts,
      allowBatchRepeats: c.filters.allowBatchRepeats,
      dayIndices, lockedSlots: [], priorUsage, adjusters, aiFallback: undefined,
    };

    // ── K attempts, all of them (no early exit), recorded ────────────────────
    const attempts = [];
    let crash = null;
    for (let i = 0; i < K; i++) {
      let slots;
      try { slots = await planner.generateWeekPlan(target, c.mealConfig, pool, wkOpts); }
      catch (e) { crash = String((e && e.message) || e); break; }
      const byDay = new Map();
      for (const s of slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
      const days = dayIndices.map((d) => digestDay(target, byDay.get(d) || [], priority));
      const daysInTolerance = days.filter((d) => d.inBand).length;
      const avgMatch = days.length ? Math.round(days.reduce((s, d) => s + d.matchPct, 0) / days.length) : 0;
      const floorDaysMet = priority ? days.filter((d) => d.floorMet).length : undefined;
      attempts.push({ days, daysInTolerance, avgMatch, floorDaysMet, rawSlots: slots });
    }

    if (crash || !attempts.length) {
      rows.push({ id: c.id, idx: c.idx, tier: c.tier, satisfiable: c.satisfiable, diet: c.profile.dietaryStyle || "none",
        horizonDays: horizon.days, dayIndices, crash: crash || "no-attempt", D: dayIndices.length });
      continue;
    }

    const nothingToSolve = pool.length === 0 || counts.afterDiet === 0;

    // ── ARM 0: shipping baseline (replay the loop WITH the early exit) ───────
    // Reconstructed at each k in KS from the SAME attempt stream: attempts
    // 1..j are byte-identical whatever K is, because the early exit only stops
    // DRAWING, it never alters an already-drawn attempt.
    const baselineAt = (kk) => {
      let bestW = null, run = 0;
      for (let i = 0; i < Math.min(kk, attempts.length); i++) {
        run++;
        const s = attempts[i];
        if (weekBetter(s, bestW?.score, priority)) bestW = { score: s, index: i };
        if (bestW.score.days.length > 0 && bestW.score.daysInTolerance === bestW.score.days.length
            && bestW.score.avgMatch >= 95 && (!priority || bestW.score.floorDaysMet === bestW.score.days.length)) break;
        if (nothingToSolve) break;
      }
      return { ...bestW, attemptsRun: run };
    };
    const best = baselineAt(K_MAIN);
    const attemptsRun = best.attemptsRun;
    const baseDays = best.score.days;

    // ── D5: which key actually decided the winner? ──────────────────────────
    // Among the attempts the loop ACTUALLY drew (1..attemptsRun), was the
    // winner's daysInTolerance a UNIQUE maximum (=> dayTolerance decided), or
    // was it tied and broken by avgMatch (=> SCORE_WEIGHTS decided)?
    const drawn = attempts.slice(0, attemptsRun);
    const maxDit = Math.max(...drawn.map((a) => a.daysInTolerance));
    const tiedOnDit = drawn.filter((a) => a.daysInTolerance === maxDit).length;
    // The counterfactual: select on avgMatch ALONE (i.e. on SCORE_WEIGHTS),
    // ignoring the four-macro verdict. If that loses days, dayTolerance is
    // doing the deciding, not the score.
    const byMatch = drawn.reduce((m, a) => (!m || a.avgMatch > m.avgMatch ? a : m), null);

    // ── candidate sets, one list per calendar day ───────────────────────────
    const perDayAt = (kk) => dayIndices.map((_, di) => attempts.slice(0, kk).map((a) => a.days[di]));
    const perDay = perDayAt(K_MAIN);

    // ── ARM 1: ORACLE (post-hoc per-day best-of; IGNORES the cap) ───────────
    const oracleDaysAt = (kk) => perDayAt(kk).map((list) => list.reduce((m, c2) => (dayBetter(c2, m, priority) ? c2 : m), null));
    const oracleDays = oracleDaysAt(K_MAIN);
    const oracleInBand = oracleDays.filter((d) => d.inBand).length;

    // ── ARM 2: naive cherry-pick argmax + THE CAP CHECK ─────────────────────
    const pickDays = oracleDays;                       // argmax under the same key
    const pickUsage = usageOf(pickDays);
    const pickMax = maxUsage(pickUsage);
    const capViolated = pickMax > cap;
    const capExcess = [...pickUsage.entries()].filter(([, v]) => v > cap).map(([id, v]) => ({ recipeId: id, name: recipeNameById.get(id) ?? null, used: v, cap }));

    // ── ARM 3: exact cap-feasible master over the candidate set ─────────────
    const master = exactMaster(perDay, cap, priority);

    // ── ARM 4: greedy-with-skip (reference only; W2-2 forbids shipping) ─────
    const greedy = greedySkip(perDay, cap, priority);
    const greedyUsage = usageOf(greedy);

    // ── the k-ladder: baseline / oracle / cap-violation at every k in KS ────
    const ladder = {};
    for (const kk of KS) {
      const b = baselineAt(kk);
      const o = oracleDaysAt(kk);
      const ou = usageOf(o);
      const m = kk <= 8 ? exactMaster(perDayAt(kk), cap, priority) : null;
      ladder[kk] = {
        base: b.score.daysInTolerance,
        oracle: o.filter((d) => d.inBand).length,
        oracleMaxUsage: maxUsage(ou),
        capViolated: maxUsage(ou) > cap,
        master: m ? m.daysInBand : null,
        attemptsRun: b.attemptsRun,
      };
    }

    // ── ARM 5: LNS repair — keep the best whole week, destroy the d worst
    //     days, re-solve them AGAINST the surviving usageCount ledger. ───────
    const daySlotTargets = planner.targetsForSlots(target, planner.buildSlots(c.mealConfig, dayIndices));
    const targetsByDay = new Map();
    for (const t of daySlotTargets) targetsByDay.set(t.dayOfWeek, [...(targetsByDay.get(t.dayOfWeek) || []), t]);

    const byDayBase = new Map();
    for (const s of attempts[best.index].rawSlots) byDayBase.set(s.dayOfWeek, [...(byDayBase.get(s.dayOfWeek) || []), s]);
    let lnsWeek = dayIndices.map((d) => ({ dow: d, slots: byDayBase.get(d) || [], digest: baseDays[dayIndices.indexOf(d)] }));
    let lnsAccepted = 0;
    // LNS draws from its OWN stream so the arm is reproducible at any K — the
    // attempt loop's rng position must not leak into the repair result.
    const lnsRng = mulberry32(childSeed(SEED ^ 0x5eed5eed, c.idx));
    if (!nothingToSolve) {
      for (let round = 0; round < LNS_ROUNDS; round++) {
        const bad = lnsWeek.map((x, i) => ({ i, m: x.digest.matchPct, ok: x.digest.inBand }))
          .filter((x) => !x.ok).sort((a, b) => a.m - b.m).slice(0, LNS_DESTROY);
        if (!bad.length) break;
        let changed = false;
        for (const { i } of bad) {
          const ledger = usageOf(lnsWeek.filter((_, j) => j !== i).map((x) => x.digest));
          const dts = targetsByDay.get(lnsWeek[i].dow) || [];
          const prevIds = new Set(i > 0 ? lnsWeek[i - 1].digest.recipeIds : []);
          let cand = null;
          for (let t = 0; t < LNS_TRIES; t++) {
            lnsSolves++;
            const { slots } = await planner.solveDay(dts, target, pool, new Map(ledger), prevIds, lnsRng, null, bias, cap, priorUsage, null, adjusters);
            const dg = digestDay(target, slots, priority);
            // never leave the feasible region: the re-solve is checked against
            // the SURVIVING ledger before it is allowed to be accepted.
            const merged = new Map(ledger);
            for (const id of dg.recipeIds) merged.set(id, (merged.get(id) || 0) + 1);
            if (maxUsage(merged) > cap) continue;
            if (dayBetter(dg, cand, priority)) cand = { dg, slots };
          }
          if (cand && dayBetter(cand.dg, lnsWeek[i].digest, priority)) {
            lnsWeek[i] = { dow: lnsWeek[i].dow, slots: cand.slots, digest: cand.dg };
            lnsAccepted++; changed = true;
          }
        }
        if (!changed) break;
      }
    }
    const lnsDays = lnsWeek.map((x) => x.digest);

    // ── ARM 6: THE SAFE RULE = argmax if cap-feasible, else LNS repair ──────
    const realisedDays = capViolated ? lnsDays : pickDays;
    const realisedSource = capViolated ? "lns-repair" : "argmax(attains bound)";

    // ── D: the free permutation, applied to baseline / pick / lns ──────────
    const permOf = (days) => {
      const before = adjacency(days);
      const p = bestPermutation(days);
      const after = p.adjacency;
      const reordered = p.order.map((i) => days[i]);
      return { before, after, inBandBefore: days.filter((d) => d.inBand).length, inBandAfter: reordered.filter((d) => d.inBand).length };
    };

    // ── capacity arithmetic: is the cap near-tight BEFORE selection starts? ──
    const mealEligible = planner.eligibleRecipes(pool, "meal", new Map(), cap).length;
    const snackEligible = planner.eligibleRecipes(pool, "snack", new Map(), cap).length;
    const D = dayIndices.length;
    const mealSlots = (c.mealConfig.meals || 0) * D;
    const snackSlots = (c.mealConfig.snacks || 0) * D;

    rows.push({
      id: c.id, idx: c.idx, tier: c.tier, satisfiable: c.satisfiable,
      diet: c.profile.dietaryStyle || "none", priority,
      horizonDays: horizon.days, D, cap, poolSize: pool.length,
      mealEligible, snackEligible, mealSlots, snackSlots,
      mealCapacity: mealEligible * cap, snackCapacity: snackEligible * cap,
      attemptsRun, attemptsTotal: attempts.length,
      d5: {
        drawn: drawn.length,
        maxDaysInTolerance: maxDit,
        tiedOnDaysInTolerance: tiedOnDit,
        decidedBy: drawn.length === 1 ? "single-attempt" : (tiedOnDit === 1 ? "daysInTolerance" : "avgMatch-tiebreak"),
        attemptScores: drawn.map((a) => ({ dit: a.daysInTolerance, am: a.avgMatch })),
        byMatchOnly: { inBand: byMatch.daysInTolerance, avgMatch: byMatch.avgMatch },
      },
      exhausted: attemptsRun === attempts.length && attempts.length === K,
      distinctWeeks: new Set(attempts.map((a) => a.days.map((d) => d.sig).join("||"))).size,

      // `judged` is a property of the BASELINE solve (>=1 filled slot) and is
      // held FIXED across arms so no treatment can move its own denominator
      // (A6 / E11's inflation trap).
      judgedPerDay: baseDays.map((d) => d.filled > 0),
      base:   { inBand: baseDays.filter((d) => d.inBand).length, filled: baseDays.reduce((s, d) => s + d.filled, 0), slots: baseDays.reduce((s, d) => s + d.slotsTotal, 0), maxUsage: maxUsage(usageOf(baseDays)), adj: adjacency(baseDays), perDayInBand: baseDays.map((d) => d.inBand), perDayFilled: baseDays.map((d) => d.filled) },
      oracle: { inBand: oracleInBand, maxUsage: pickMax, capViolated, capExcess, adj: adjacency(pickDays), perDayInBand: pickDays.map((d) => d.inBand), perDayFilled: pickDays.map((d) => d.filled) },
      master: { inBand: master.daysInBand, feasible: master.feasible, nodes: master.nodes, truncated: master.truncated, maxUsage: master.pick ? maxUsage(usageOf(master.pick)) : null, adj: master.pick ? adjacency(master.pick) : null, perDayInBand: master.pick ? master.pick.map((d) => d.inBand) : null, attainsOracle: master.daysInBand === oracleInBand },
      greedy: { inBand: greedy.filter((d) => d.inBand).length, maxUsage: maxUsage(greedyUsage), capViolated: maxUsage(greedyUsage) > cap, adj: adjacency(greedy), perDayInBand: greedy.map((d) => d.inBand) },
      lns:    { inBand: lnsDays.filter((d) => d.inBand).length, accepted: lnsAccepted, maxUsage: maxUsage(usageOf(lnsDays)), adj: adjacency(lnsDays), perDayInBand: lnsDays.map((d) => d.inBand), perDayFilled: lnsDays.map((d) => d.filled) },
      realised: { inBand: realisedDays.filter((d) => d.inBand).length, source: realisedSource, maxUsage: maxUsage(usageOf(realisedDays)), adj: adjacency(realisedDays), perDayInBand: realisedDays.map((d) => d.inBand) },
      perm: { base: permOf(baseDays), pick: permOf(pickDays), lns: permOf(lnsDays) },
      ladder,
    });
  }

  await prisma.$disconnect();
  const git = gitInfo();
  const out = {
    schema: "fleet/W3-3/probe/v1",
    agent: AGENT, seed: SEED, k: K, kMain: K_MAIN, ks: KS, personas: use.length,
    lns: { rounds: LNS_ROUNDS, destroy: LNS_DESTROY, tries: LNS_TRIES, extraDaySolves: lnsSolves },
    provenance: {
      dbSha256: DB.sourceSha256, dbCopySha256: DB.copySha256, foodFingerprint,
      foodRows: foods.length, recipeRows: rawPool.length,
      personasSha256: sha256(PERSONAS_PATH),
      gitSha: git.sha, gitBranch: git.branch, srcPorcelain: git.srcPorcelain,
      brain: "off", networkCalls: netCalls,
      ruler: "product/dayTolerance+dayInTolerance (mealSolver.js)",
      poolShape: "route (applyFilterStack ON)",
      elapsedSec: r2((Date.now() - t00) / 1000),
    },
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`[W3-3] seed ${SEED} k=${K} personas ${use.length} · ${((Date.now() - t00) / 1000).toFixed(1)}s · net ${netCalls} · lns day-solves ${lnsSolves} -> ${OUT}`);
  if (netCalls > 0) process.exit(1);

  if (XCHECK) {
    const dump = fs.readFileSync(XCHECK, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const byKey = new Map();
    for (const d of dump) byKey.set(`${d.personaId}#${d.dayOfWeek}`, d);
    let checked = 0, mismatch = 0, missing = 0;
    for (const r of rows) {
      if (!r.base) continue;
      r.dayIndicesResolved = r.dayIndicesResolved;
      const dis = Array.from({ length: r.D }, (_, i) => i);
      for (const i of dis) {
        const rec = byKey.get(`${r.id}#${i}`);
        if (!rec) { missing++; continue; }
        checked++;
        if (!!rec.verdict.inBand !== !!r.base.perDayInBand[i]) mismatch++;
      }
    }
    console.log(`[W3-3] XCHECK vs ${path.basename(XCHECK)}: checked ${checked} · mismatches ${mismatch} · missing ${missing}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
