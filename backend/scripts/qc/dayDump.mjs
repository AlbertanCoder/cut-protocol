// dayDump.mjs — W1-1 (harness-truth). THE per-day substrate for the measure fleet.
//
//   node backend/scripts/qc/dayDump.mjs --seed=424242 --out=fleet/out/W1-1/dump-s424242.jsonl
//
// WHY THIS FILE EXISTS
// The solver already computes everything needed to grade a day on all four
// macros. Every instrument on this tree throws most of it away:
//
//   · qc/runSolve.mjs calls generateBestWeekPlan — no `horizon`, no `adjusters`.
//     74% of the persona fleet (185/250) asked for a ONE-DAY plan and gets solved
//     as a 7-day week, and the macro closer (macroCloser.js) never runs at all.
//     What it grades is not the shape the shipping route (routes/plans.js:324)
//     solves.
//   · qc/oracle.mjs grades on `acceptOk` = |kcalDev| <= 5% AND protein >= lo-5g,
//     with NO fat and NO carb term (oracle.mjs:38-39, :194). That is a THIRD
//     ruler, incompatible with the product's own dayTolerance/dayInTolerance.
//     Its `daysInTol` may never appear in a table next to "days in band".
//   · qc/mc.mjs aggregates the oracle's ruler and streams one row PER RUN
//     (per week), keeping only seed/corner/outcome/kcalDevMax/proteinShortMax.
//     Fat and carb never reach the disk, so nothing downstream can re-grade.
//
// So a downstream agent that wants to ask "what would the level be under a
// different ruler?" has to RE-SOLVE — which is expensive, non-deterministic on
// some surfaces (K4), and makes ruler work and solver work impossible to
// separate. This file fixes that: it solves ONCE, in the shipping shape, and
// writes every number the four-macro verdict is made of, per day, to JSONL.
// Everything downstream is arithmetic on that file.
//
// WHAT IT DOES NOT DO
// It changes no product behaviour. Nothing under backend/src or frontend/src is
// touched. Verdicts are NOT recomputed here: dayTolerance/dayInTolerance are
// imported from mealSolver.js, the single source of truth. Day totals ARE
// recomputed independently from raw Food rows (the oracle.mjs method), and both
// numbers plus their drift are on every record, so an instrument fault shows up
// as a number rather than as silence.
//
// DENOMINATORS (the A6 fix, brief §10)
// The rig's schema.mjs:83 sets `judged: filled.length > 0`, which drops
// total-failure days from the primary denominator — so a treatment that REFUSES
// more days scores higher. This file emits both flags on every record
// (`judged`, and `planned` which is always true) and its report prints all three
// denominators, with ALL PLANNED DAYS mandatory and unjudged counts shown. The
// primary denominator is not silently changed; both are published.
//
// GROUND RULE #1 (zero API cost) is enforced, not assumed: BRAIN=off is set
// before any module loads, and after the pool is warm every outbound
// http/https/fetch is trapped and counted. A non-zero count is a P0 stop.
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
// HERE = backend/scripts/qc -> three up is the repo root.
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const PERSONAS_PATH = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");

// Canonical seeds — mirrors A1/rig/seeds.mjs so a run is nameable.
const SEEDS = { primary: 424242, replicateA: 20260730, replicateB: 8675309, smoke: 1337 };
const seedName = (s) => Object.entries(SEEDS).find(([, v]) => v === Number(s))?.[0] ?? "custom";

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

const SEED = Number(argv.seed ?? SEEDS.primary);
const N = argv.n ? Number(argv.n) : null;
const LABEL = String(argv.label || "baseline");
const AGENT = String(argv.agent || "W1-1");
const QUIET = !!argv.quiet;
// --nostack reproduces the A1-rig / runSolve.mjs pool shape EXACTLY by skipping
// mealSolver.applyFilterStack. The default (stack ON) is what routes/plans.js:220
// actually does. MEASURED on this tree: the stack narrows the pool for 32 of the
// 250 personas, by up to 69.9% (p039: 123 -> 37 recipes), 4.1% of pooled
// recipe-slots. Numbers from the two modes are NOT interchangeable; the flag
// exists so the difference can be measured rather than argued about.
const NOSTACK = !!argv.nostack;
const OUT = path.resolve(REPO, String(argv.out || `fleet/out/${AGENT}/daydump-${LABEL}-s${SEED}.jsonl`));

const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);

// ── DB ISOLATION. Nothing may require prisma before this block. ─────────────
// The shared backend/prisma/dev.db is READ-ONLY to the fleet. Prisma opens
// SQLite read-write and enables WAL, so "we only read" is not a property the
// filesystem enforces — a copy is. WAL sidecars come along, because copying
// dev.db alone can drop recently-committed pages still living in the -wal.
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
function prepareDb(agentId) {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error(`bad agent id ${JSON.stringify(agentId)}`);
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
  const url = `file:${dbPath.replace(/\\/g, "/")}`;
  process.env.DATABASE_URL = url;
  return { dbPath, url, sourceSha256: sha256(SHARED_DB), copySha256: sha256(dbPath) };
}
const DB = prepareDb(AGENT);
if (norm(String(process.env.DATABASE_URL).slice(5)) === norm(SHARED_DB)) throw new Error("DATABASE_URL points at the SHARED dev.db — refusing");

const require_ = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const bmr = require_(path.join(B, "src/lib/bmrEngine.js"));
const solver = require_(path.join(B, "src/lib/mealSolver.js"));
const planCtx = require_(path.join(B, "src/lib/planContext.js"));
const gate = require_(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require_(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require_(path.join(B, "src/lib/prisma.js"));

// ── the ruler, named out loud ───────────────────────────────────────────────
// Every number this file emits is graded by the PRODUCT's own four-macro rule.
// Naming it in the header is not decoration: three mutually incompatible rulers
// exist on this tree (see the file header), and a level with no ruler stamped
// on it cannot be safely compared with anything.
const RULER = {
  id: "product/dayTolerance+dayInTolerance",
  source: "backend/src/lib/mealSolver.js::dayTolerance / ::dayInTolerance",
  macros: 4,
  kcalTolerancePct: solver.DAY_KCAL_TOLERANCE_PCT,
  fatPctEnergyMin: solver.DAY_FAT_PCT_ENERGY_MIN,
  fatPctEnergyMax: solver.DAY_FAT_PCT_ENERGY_MAX,
  nonKetoCarbFloorG: bmr.NONKETO_CARB_FLOOR_G,
  note: "kcal +/-DAY_KCAL_TOLERANCE_PCT symmetric on target, lower edge clamped at the target's "
      + "safety floor (floorKcal); protein one-sided floor at proteinLo, no ceiling; fat is a "
      + "%E guardrail on max(achieved, target) kcal, lower edge max(share, the target's essential "
      + "fatFloorG), KETO EXEMPT FROM THE CEILING ONLY; carbs are the remainder and are not graded "
      + "as a target -- two floors survive, keto's carb ceiling (overshoot allowance 0) and the "
      + "non-keto anti-ketosis floor at min(NONKETO_CARB_FLOOR_G, the target's carbMid).",
  // DAY_{FAT,CARB}_TOLERANCE_PCT are deliberately NOT stamped here any more. They
  // still exist and still drive `fatBandOk`/`carbBandOk`, but neither is what a day
  // is JUDGED on, and printing them in the ruler line is what let three reports on
  // disk describe a band-relative ruler they had not used.
};

// ── seeded RNG (identical to backend/scripts/qc/rng.mjs and A1/rig) ─────────
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

// ── population: the canonical 250-row persona fleet (brief A7) ──────────────
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
      id: p.id, idx: p.idx, tier: p.tier,
      // Brief's denominator rule: IMPOSSIBLE personas are engineered
      // unsatisfiable — the correct output for them is a refusal.
      satisfiable: p.tier !== "IMPOSSIBLE",
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

// ── adjusters: planContext.loadAdjusters() re-assembled (it is not exported) ─
// Same ten-name constant (planContext.js:167-178), same two gates
// (foodValidation.macroTrustIssue, exclusionGate.isExcluded), imported from
// product code so there is no second vocabulary to drift.
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

// ── independent day totals, recomputed from raw Food rows (oracle method) ───
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

const EPS = 1e-6;
const atLo = (s) => s != null && Math.abs(s - 0.5) <= EPS;
const atHi = (s) => s != null && Math.abs(s - 2.0) <= EPS;

/**
 * The target, serialized so a re-grade can REPRODUCE the verdict.
 *
 * This lived twice, inline, and both copies stored only the bands. That was
 * survivable while the ruler was band-relative and is not any more: the verdict
 * now also consults two ABSOLUTE floors — `floorKcal` (the safety floor the
 * calorie band may not re-open downward) and `fatFloorG` (essential fat) — plus
 * the target's own `carbMid` for the anti-ketosis floor. Dropping them did not
 * corrupt the LIVE numbers, which are computed from the real target object, but
 * it made every downstream re-grade silently apply a WEAKER ruler: 22 of 622
 * judged days flipped, +3.7 pp on the satisfiable rate, and scoreDays'
 * recompute-mismatch counter was reporting exactly this.
 *
 * A dump you cannot re-grade is a dump you have to re-solve to ask a second
 * question of, which is the whole reason this file exists.
 */
function serializeTarget(target) {
  const band = (lo, hi) => (Number.isFinite(lo) && Number.isFinite(hi) ? r2((lo + hi) / 2) : null);
  return {
    kcal: target.kcal ?? null,
    proteinLo: target.proteinLo ?? null, proteinHi: target.proteinHi ?? null,
    proteinMid: band(target.proteinLo, target.proteinHi),
    fatLo: target.fatLo ?? null, fatHi: target.fatHi ?? null,
    fatMid: band(target.fatLo, target.fatHi),
    carbLo: target.carbLo ?? null, carbHi: target.carbHi ?? null,
    // The target's OWN carbMid, not the band midpoint re-derived from the edges.
    // They coincide on a non-keto target by construction and do NOT on keto
    // (10-30 with a real carbMid of 25), and this is the field the anti-ketosis
    // floor is capped at.
    carbMid: target.carbMid ?? band(target.carbLo, target.carbHi),
    keto: !!target.keto,
    // The two absolute floors the verdict consults. Without these a re-grade
    // cannot reproduce it.
    floorKcal: target.floorKcal ?? null,
    fatFloorG: target.fatFloorG ?? null,
    // Disclosure flags — not graded on, but they explain WHY a floor sits where
    // it does, and an analyst reading a sub-floor day needs them.
    fatFloored: target.fatFloored ?? null,
    carbFloored: target.carbFloored ?? null,
    macroKcalGap: target.macroKcalGap ?? null,
  };
}

/**
 * The per-day binding-miss key, DERIVED from the day's own four-macro verdict.
 *
 * Deliberately distinct from the product's `classifyBinding()`, which is a
 * HORIZON-level pool diagnosis (one key for the whole plan) and is carried
 * separately on every record as `horizonBinding`. Nothing in the product emits
 * a per-day binding key, so this one is labelled DERIVED and never presented as
 * the engine's own claim.
 *
 * Shape: "<macro>[:over|:short]" for a single-macro miss, "multi:<a>+<b>" when
 * more than one macro failed, "none" when the day landed, "empty" when no slot
 * was filled at all.
 */
function bindingMissKey(tol, inBand, slotsFilled) {
  if (slotsFilled === 0) return "empty";
  if (inBand) return "none";
  const miss = [];
  if (!tol.kcalOk) miss.push(`kcal:${tol.kcalDeltaPct > 0 ? "over" : "short"}`);
  if (!tol.proteinOk) miss.push("protein:short");
  // DIRECTION COMES FROM THE RULE THAT FAILED, not from the band distance.
  //
  // `fatOverPct`/`carbOverPct` measure distance outside the target's GRAM band,
  // which is no longer what `fatOk`/`carbOk` are decided by. Reading direction off
  // them mislabelled 5 days per seed as `fat:short` when they were %E-OVER — the
  // published `multi:kcal:short+protein:short+fat:short | 5` row in all three
  // RULER reports is exactly those days, counted with the wrong sign.
  if (!tol.fatOk) miss.push(`fat:${tol.fatMissSide}`);
  if (!tol.carbOk) miss.push(`carb:${tol.carbMissSide}`);
  if (!miss.length) return "none";
  return miss.length === 1 ? miss[0] : `multi:${miss.join("+")}`;
}

function missSideOf(tol) {
  // Same correction as bindingMissKey: direction comes from the verdict's own
  // published fatMissSide/carbMissSide, never from distance outside the gram band.
  const over = (!tol.kcalOk && tol.kcalDeltaPct > 0) || tol.fatMissSide === "over" || tol.carbMissSide === "over";
  const short = (!tol.kcalOk && tol.kcalDeltaPct < 0) || !tol.proteinOk
    || tol.fatMissSide === "short" || tol.carbMissSide === "short";
  if (over && short) return "mixed";
  if (over) return "over";
  if (short) return "short";
  return null;
}

// ── Wilson, for the report's three denominators ─────────────────────────────
const Z = 1.959964;
function wilson(k, n) {
  if (!n) return { k, n, p: null, lo: null, hi: null };
  const p = k / n, d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
const pc = (x) => (x == null ? "   —  " : (x * 100).toFixed(1).padStart(5) + "%");

function gitInfo() {
  const run = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); } catch { return null; } };
  const stat = run(["diff", "--stat"]) || "";
  const statLines = stat ? stat.split("\n") : [];
  const status = run(["status", "--porcelain"]) || "";
  return {
    sha: run(["rev-parse", "HEAD"]),
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    diffStatSummary: statLines.length ? statLines[statLines.length - 1].trim() : "clean",
    diffStatFiles: Math.max(0, statLines.length - 1),
    porcelainEntries: status ? status.split("\n").length : 0,
    dirty: statLines.length > 0 || (status ? status.split("\n").length : 0) > 0,
  };
}

async function main() {
  const t00 = Date.now();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  // Load the pool the way the route's loadRecipePool does in evidence terms:
  // a plain `include` returns every Recipe scalar (steps, description) plus
  // every Food column, so it is a strict SUPERSET of exclusionGate's
  // RECIPE_GATE_SELECT — the gate sees the same evidence it sees in production.
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const recipeNameById = new Map(rawPool.map((r) => [r.id, r.name]));
  const adjusterFoods = await loadAdjusterFoods();

  const foodFingerprint = crypto.createHash("sha256")
    .update(foods.map((f) => `${f.id}:${f.kcal}:${f.protein}:${f.fat}:${f.carb}`).sort().join("|"))
    .digest("hex");

  // ── ground rule #1: trap the network AFTER prisma is warm ────────────────
  let netCalls = 0;
  const trap = (label) => () => { netCalls++; throw new Error(`dayDump attempted a ${label} call — ground rule #1 (zero API cost) violated`); };
  https.request = trap("https.request"); https.get = trap("https.get");
  http.request = trap("http.request"); http.get = trap("http.get");
  if (globalThis.fetch) globalThis.fetch = trap("fetch");
  if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

  const all = loadPersonas();
  const use = N ? all.slice(0, N) : all;
  const git = gitInfo();

  const run = {
    schemaRun: "fleet/W1-1/run/v1",
    tool: "backend/scripts/qc/dayDump.mjs",
    label: LABEL, agentId: AGENT, pop: "personas", seed: SEED, seedName: seedName(SEED),
    customers: use.length, brain: "off",
    // Pool shape. "route" = filterRecipePool -> applyPrepFilter -> applyFilterStack,
    // which is routes/plans.js:214-220. "rig" = the first two only, which is what
    // A1/rig/runRig.mjs and qc/runSolve.mjs do. Two runs are only comparable if
    // this matches.
    poolShape: NOSTACK ? "rig (no applyFilterStack)" : "route (applyFilterStack ON)",
    // ── PROVENANCE. A level with no provenance is not a measurement. ───────
    dbSha256: DB.sourceSha256,
    dbCopySha256: DB.copySha256,
    // REPO-RELATIVE, never absolute. This was `DB.dbPath`, and on Windows an
    // absolute path contains the account name — so every record of every dump
    // carried it, 640 times per file. `fleet/out/` is TRACKED and this repo is
    // PUBLIC, and Phase 9 rewrote git history specifically to remove that
    // username from it. `frontend/src/lib/scrub.js` exists for the same reason on
    // the bug-report path, guarded by backend/tests/scrubPaths.test.js.
    //
    // The provenance value here is "which DB copy did this run read", which the
    // relative path and the sha256 beside it carry completely. The absolute
    // prefix was never information; it was only exposure.
    dbPath: path.relative(REPO, DB.dbPath).replace(/\\/g, "/"),
    foodFingerprint,
    foodRows: foods.length, recipeRows: rawPool.length,
    personasPath: path.relative(REPO, PERSONAS_PATH).replace(/\\/g, "/"),
    personasSha256: sha256(PERSONAS_PATH),
    gitSha: git.sha, gitBranch: git.branch,
    // The brief is emphatic: the baseline is a WORKING TREE, not a commit. A
    // SHA alone does not pin it, so the diff summary rides along.
    gitDiffStat: git.diffStatSummary, gitDiffStatFiles: git.diffStatFiles,
    gitPorcelainEntries: git.porcelainEntries, gitDirty: git.dirty,
    ruler: RULER,
    startDayOfWeek: 0,
    startDayOfWeekNote: "PINNED to 0 for reproducibility. routes/plans.js:276 starts a SUB-WEEK horizon on TODAY's index — a deliberate, recorded fidelity deviation.",
    startedAt: new Date().toISOString(),
  };

  const stream = fs.createWriteStream(OUT);
  const write = (o) => stream.write(JSON.stringify(o) + "\n");

  let days = 0, judged = 0, unjudged = 0, inBandJudged = 0, inBandPlanned = 0;
  let disagree = 0, drifted = 0, missingFood = 0, crashes = 0, closerFiredDays = 0;
  let satUnjudged = 0;               // A6: satisfiable total-failure days the rig would DROP
  let degenerate = 0;                // 0-slot configs the rig drops ENTIRELY (not even unjudged)
  const tallies = { satisfiable: { k: 0, n: 0 }, all: { k: 0, n: 0 }, planned: { k: 0, n: 0 } };
  const bindingHist = new Map();

  for (const c of use) {
    const rng = mulberry32(childSeed(SEED, c.idx));
    const energy = bmr.computeEnergy(c.profile, c.weightKg);
    const derived = bmr.deriveTarget(c.profile, energy.tdee, energy.rmr);
    const floor = bmr.effectiveFloor(c.profile, energy.rmr);
    const target = bmr.computeMacros(c.profile, c.weightKg, derived.target, floor);

    // The route's exact two-stage narrowing, plus the Stage-3 filter stack it
    // applies at routes/plans.js:220 and which runSolve.mjs / A1-rig omit.
    // With no maxCostCad / maxComplexity / minTaste it is a pass-through by
    // construction (mealSolver.js:48-50) — `afterStack` proves that per run
    // instead of assuming it.
    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const afterPrep = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);
    const { survivors: pool, explain: stackExplain } = NOSTACK
      ? { survivors: afterPrep, explain: null }
      : solver.applyFilterStack(afterPrep, c.filters, null);
    const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: afterPrep.length, afterStack: pool.length, stackExplain };
    const adjusters = adjustersFor(adjusterFoods, c.profile);
    const horizon = solver.resolveHorizon(c.horizonKey);

    const t0 = Date.now();
    let result = null, crash = null;
    try {
      result = await solver.generateHorizonPlan({
        dailyTarget: target, mealConfig: c.mealConfig, recipePool: pool, horizon,
        filters: c.filters, counts, adjusters,
        bias: solver.buildBias(c.filters, null),
        priorPlans: [], lockedSlotsByWindow: [], startDayOfWeek: 0, rng,
      });
    } catch (e) { crash = String((e && e.message) || e); crashes++; }
    const solveMs = Date.now() - t0;

    const personaMeta = {
      personaId: c.id, personaIdx: c.idx, tier: c.tier, satisfiable: c.satisfiable,
      dietStyle: c.profile.dietaryStyle || "none",
      allergens: c.profile.excludedFoods || [],
      allergenStack: (c.profile.excludedFoods || []).slice().sort().join("+") || "none",
      mealsPerDay: c.mealConfig.meals, snacksPerDay: c.mealConfig.snacks,
      horizonKey: c.horizonKey, horizonDays: horizon.days,
      poolCounts: { raw: counts.raw, afterDiet: counts.afterDiet, afterPrep: counts.afterPrep, afterStack: counts.afterStack },
      adjustersOffered: adjusters.length,
      adjusterRoles: adjusters.map((a) => a.role),
      energy: {
        tdee: r2(energy.tdee), rmr: r2(energy.rmr), floorKcal: r2(floor),
        targetRaw: r2(derived.raw), targetKcal: r2(derived.target), floored: !!derived.floored,
      },
    };

    if (crash) {
      write({ schema: "fleet/W1-1/day/v2", run, ...personaMeta, crash, dayIndex: -1, dayOfWeek: null, windowIndex: null, dayKey: `${c.id}#crash`, judged: false, planned: true, slotsTotal: 0, slotsFilled: 0, slotsEmpty: 0, target: {}, achieved: {}, verdict: { inBand: false }, bindingMissKey: "crash", slots: [] });
      days++; unjudged++; tallies.planned.n++;
      if (c.satisfiable !== false) satUnjudged++;
      continue;
    }

    const horizonBinding = result.diagnosis?.binding
      ? { key: result.diagnosis.binding.key, label: result.diagnosis.binding.label }
      : null;
    const hasHorizonDiagnosis = !!result.diagnosis;

    // Buffer the persona's days so per-persona aggregates (daysPlanned /
    // daysInBand / daysJudged) can ride on every one of its records — a
    // re-scorer must not have to re-group to get them.
    const pending = [];
    for (const w of result.windows) {
      const byDay = new Map();
      for (const s of w.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
      const engineByDow = new Map((w.days || []).map((d) => [d.dayOfWeek, d]));
      for (const [dow, slots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
        const eng = engineByDow.get(dow) || null;
        const ach = recomputeDay(slots, foodById);
        const solv = solverDay(slots);
        const tol = solver.dayTolerance(target, ach);
        const inBand = solver.dayInTolerance(tol);

        const slotRows = slots.map((s) => {
          const ings = s.ingredients || [];
          const adj = ings.filter((i) => i.adjuster === true);
          return {
            slotType: s.slotType ?? null,
            slotIndex: s.slotIndex ?? null,
            recipeId: s.recipeId ?? null,
            recipeName: s.recipeId != null ? (recipeNameById.get(s.recipeId) ?? null) : null,
            locked: !!s.locked,
            // The two portion knobs, and whether either is PINNED at a bound —
            // the "the clamp is not a solve" evidence (brief B4/J).
            proteinScale: r4(s.proteinScale), sidesScale: r4(s.sidesScale),
            pinnedLo: atLo(s.proteinScale) || atLo(s.sidesScale),
            pinnedHi: atHi(s.proteinScale) || atHi(s.sidesScale),
            kcal: r2(s.kcal), protein: r2(s.protein), fat: r2(s.fat), carb: r2(s.carb),
            grams: r2(ings.reduce((g, i) => g + (i.grams || 0), 0)),
            ingredientCount: ings.length,
            adjusterCount: adj.length,
            adjusterGrams: r2(adj.reduce((g, i) => g + (i.grams || 0), 0)),
            adjusters: adj.map((i) => ({ foodId: i.foodId, name: i.name, role: i.role ?? null, grams: r2(i.grams) })),
            warning: s.warning ? String(s.warning).slice(0, 240) : null,
          };
        });

        const filled = slotRows.filter((s) => s.recipeId != null);
        const closerItems = slotRows.flatMap((s) => s.adjusters);
        const fired = closerItems.length > 0;
        if (fired) closerFiredDays++;
        if (ach.missing) missingFood += ach.missing;

        const rec = {
          schema: "fleet/W1-1/day/v2",
          run,
          ...personaMeta,

          dayIndex: eng?.dayIndex ?? dow,
          dayOfWeek: dow,
          windowIndex: w.windowIndex,
          dayKey: `${c.id}#${eng?.dayIndex ?? dow}`,

          // ── DENOMINATOR FLAGS — both published, neither silent (A6) ──────
          // `judged` reproduces A1/rig/schema.mjs:83 EXACTLY so a downstream
          // number stays comparable with the rig's. `planned` is always true;
          // it is the denominator the brief prescribes as the mandatory
          // co-report, because `judged` drops total-failure days and therefore
          // REWARDS a treatment that refuses more of them.
          judged: filled.length > 0,
          planned: true,
          slotsTotal: slotRows.length,
          slotsFilled: filled.length,
          slotsEmpty: slotRows.length - filled.length,

          target: {
            ...serializeTarget(target),
          },
          // FULL PRECISION, not r2. These are the exact numbers the verdict was
          // computed from, and rounding them defeats the point of the file: a
          // re-grade then compares a rounded value against a full-precision edge
          // and flips days sitting on one. Measured — 1,469.4972 kcal against a
          // 1,470 floor stored as 1,469.5, which lands exactly ON the floor's
          // half-calorie epsilon and re-grades the other way. Display rounding is
          // the reporting layer's job; the substrate keeps what it saw.
          achieved: { kcal: ach.kcal, protein: ach.protein, fat: ach.fat, carb: ach.carb },
          achievedSolver: { kcal: r2(solv.kcal), protein: r2(solv.protein), fat: r2(solv.fat), carb: r2(solv.carb) },
          drift: {
            kcal: r2(solv.kcal - ach.kcal), protein: r2(solv.protein - ach.protein),
            fat: r2(solv.fat - ach.fat), carb: r2(solv.carb - ach.carb),
            missingFoodRows: ach.missing,
          },

          verdict: {
            inBand,
            kcalOk: tol.kcalOk, proteinOk: tol.proteinOk, fatOk: tol.fatOk, carbOk: tol.carbOk,
            fatJudged: tol.fatJudged, carbJudged: tol.carbJudged,
            kcalDeltaPct: r4(tol.kcalDeltaPct), proteinShortPct: r4(tol.proteinShortPct),
            fatShortPct: r4(tol.fatShortPct), fatOverPct: r4(tol.fatOverPct),
            carbShortPct: r4(tol.carbShortPct), carbOverPct: r4(tol.carbOverPct),
          },
          rulerId: RULER.id,

          bindingMissKey: bindingMissKey(tol, inBand, filled.length),
          missMacros: [!tol.kcalOk && "kcal", !tol.proteinOk && "protein", !tol.fatOk && "fat", !tol.carbOk && "carb"].filter(Boolean),
          missSide: missSideOf(tol),
          horizonBinding,

          engineInBand: eng?.inTolerance ?? null,
          engineMatchPct: eng?.matchPct ?? null,
          // Non-zero anywhere = INSTRUMENT FAULT. Report before any headline.
          verdictDisagrees: eng?.inTolerance != null && eng.inTolerance !== inBand,

          closer: {
            fired,
            addedCount: closerItems.length,
            addedGrams: r2(closerItems.reduce((g, i) => g + (i.grams || 0), 0)),
            roles: [...new Set(closerItems.map((i) => i.role).filter(Boolean))],
            items: closerItems,
          },

          honesty: {
            hasWarning: slotRows.some((s) => s.warning),
            warningCount: slotRows.filter((s) => s.warning).length,
            hasDiagnosis: hasHorizonDiagnosis,
            // An out-of-band day MUST carry a warning or a plan diagnosis.
            // FALSE here on an out-of-band day is a silent miss.
            declared: inBand ? null : (slotRows.some((s) => s.warning) || hasHorizonDiagnosis),
          },

          pinned: {
            scaledSlots: slotRows.filter((s) => s.proteinScale != null || s.sidesScale != null).length,
            atLoBound: slotRows.filter((s) => s.pinnedLo).length,
            atHiBound: slotRows.filter((s) => s.pinnedHi).length,
          },

          slots: slotRows,
          solveMs,
        };
        pending.push(rec);
      }
    }

    // ── the vanishing persona (W1-1) ────────────────────────────────────────
    // A persona whose meal config asks for ZERO slots per day produces zero
    // slots, so `byDay` is empty and the loop above emits NOTHING. The persona
    // does not become "unjudged" — it disappears from the corpus entirely, and
    // nothing anywhere counts it. A1/rig/runRig.mjs builds byDay the same way
    // and has the same hole, which is why every published all-planned-days
    // denominator on this campaign is 639 rather than 640.
    // MEASURED: exactly 1 of the 250 personas is affected — p233 (ROBUSTNESS
    // tier, "3 meals + 0 snacks" in its story, mealsPerDay=0 snacksPerDay=0 in
    // its profile). Emit a record for it, flagged, so a refusal is visible as a
    // refusal instead of as an absence.
    if (!pending.length) {
      for (let d = 0; d < horizon.days; d++) {
        pending.push({
          schema: "fleet/W1-1/day/v2", run, ...personaMeta,
          dayIndex: d, dayOfWeek: d % 7, windowIndex: 0, dayKey: `${c.id}#${d}`,
          judged: false, planned: true,
          // TRUE only for a config that asked for no slots at all. Distinguish
          // this from a solver total failure: nothing was attempted here.
          degenerate: true,
          slotsTotal: 0, slotsFilled: 0, slotsEmpty: 0,
          target: serializeTarget(target),
          achieved: { kcal: 0, protein: 0, fat: 0, carb: 0 },
          achievedSolver: { kcal: 0, protein: 0, fat: 0, carb: 0 },
          drift: { kcal: 0, protein: 0, fat: 0, carb: 0, missingFoodRows: 0 },
          verdict: (() => { const t = solver.dayTolerance(target, { kcal: 0, protein: 0, fat: 0, carb: 0 }); return { inBand: solver.dayInTolerance(t), kcalOk: t.kcalOk, proteinOk: t.proteinOk, fatOk: t.fatOk, carbOk: t.carbOk, fatJudged: t.fatJudged, carbJudged: t.carbJudged, kcalDeltaPct: r4(t.kcalDeltaPct), proteinShortPct: r4(t.proteinShortPct), fatShortPct: r4(t.fatShortPct), fatOverPct: r4(t.fatOverPct), carbShortPct: r4(t.carbShortPct), carbOverPct: r4(t.carbOverPct) }; })(),
          rulerId: RULER.id,
          bindingMissKey: "degenerate:zero-slot-config",
          missMacros: [], missSide: null, horizonBinding,
          engineInBand: null, engineMatchPct: null, verdictDisagrees: false,
          closer: { fired: false, addedCount: 0, addedGrams: 0, roles: [], items: [] },
          honesty: { hasWarning: false, warningCount: 0, hasDiagnosis: hasHorizonDiagnosis, declared: hasHorizonDiagnosis },
          pinned: { scaledSlots: 0, atLoBound: 0, atHiBound: 0 },
          slots: [], solveMs,
        });
      }
    }

    const daysPlanned = pending.length;
    const daysJudged = pending.filter((r) => r.judged).length;
    const daysInBand = pending.filter((r) => r.verdict.inBand).length;
    for (const rec of pending) {
      rec.daysPlanned = daysPlanned;
      rec.daysJudged = daysJudged;
      rec.daysInBand = daysInBand;
      write(rec);
      days++;
      if (rec.degenerate) degenerate++;
      if (rec.judged) { judged++; if (rec.verdict.inBand) inBandJudged++; } else {
        unjudged++;
        // A6's count is SOLVER total failures only. A config that asked for no
        // slots never gave the solver anything to fail at, so it is counted and
        // reported separately rather than folded in.
        if (rec.satisfiable !== false && !rec.degenerate) satUnjudged++;
      }
      if (rec.verdict.inBand) inBandPlanned++;
      if (rec.verdictDisagrees) disagree++;
      if (Math.abs(rec.drift.kcal ?? 0) > 1) drifted++;
      bindingHist.set(rec.bindingMissKey, (bindingHist.get(rec.bindingMissKey) || 0) + 1);
      tallies.planned.n++; if (rec.verdict.inBand) tallies.planned.k++;
      if (rec.judged) { tallies.all.n++; if (rec.verdict.inBand) tallies.all.k++; }
      if (rec.judged && rec.satisfiable !== false) { tallies.satisfiable.n++; if (rec.verdict.inBand) tallies.satisfiable.k++; }
    }

    if (!QUIET && use.length > 20 && (c.idx + 1) % Math.ceil(use.length / 10) === 0) {
      process.stderr.write(`\r  ${Math.round(((c.idx + 1) / use.length) * 100)}%  `);
    }
  }

  stream.end();
  await new Promise((r) => stream.on("close", r));
  await prisma.$disconnect();
  if (!QUIET) process.stderr.write("\n");

  // ── the report — provenance header + ALL THREE denominators, always ──────
  const L = [];
  const W = { sat: wilson(tallies.satisfiable.k, tallies.satisfiable.n), all: wilson(tallies.all.k, tallies.all.n), planned: wilson(tallies.planned.k, tallies.planned.n) };
  L.push(`# dayDump — ${LABEL} · seed ${SEED} (${seedName(SEED)})`);
  L.push("");
  L.push(`| provenance | value |`);
  L.push(`|---|---|`);
  L.push(`| tool | \`backend/scripts/qc/dayDump.mjs\` |`);
  L.push(`| dump | \`${path.relative(REPO, OUT).replace(/\\/g, "/")}\` |`);
  L.push(`| DB sha256 | \`${run.dbSha256}\` |`);
  L.push(`| DB copy sha256 | \`${run.dbCopySha256}\` ${run.dbSha256 === run.dbCopySha256 ? "MATCH" : "*** MISMATCH ***"} |`);
  L.push(`| food fingerprint | \`${run.foodFingerprint.slice(0, 16)}\` (${run.foodRows} foods / ${run.recipeRows} recipes) |`);
  L.push(`| git SHA | \`${run.gitSha}\` on \`${run.gitBranch}\` |`);
  L.push(`| git diff --stat | ${run.gitDiffStat} — **the baseline is a WORKING TREE, not a commit** |`);
  L.push(`| git status --porcelain | ${run.gitPorcelainEntries} entr${run.gitPorcelainEntries === 1 ? "y" : "ies"} |`);
  L.push(`| persona file | \`${run.personasPath}\` sha256 \`${run.personasSha256}\` |`);
  L.push(`| seed | ${SEED} (${seedName(SEED)}) · customers ${run.customers} |`);
  L.push(`| POOL SHAPE | **${run.poolShape}** — \`route\` and \`rig\` numbers are NOT interchangeable |`);
  L.push(`| RULER | **${RULER.id}** — kcal ±${RULER.kcalTolerancePct * 100}% (lower edge clamped at the target's floorKcal) · protein ≥ proteinLo (one-sided floor) · fat ${RULER.fatPctEnergyMin * 100}–${RULER.fatPctEnergyMax * 100} %E of max(achieved, target) kcal, floored at the target's fatFloorG, **keto exempt from the CEILING only** · carbs ungraded as a target, keto ceiling + a ${RULER.nonKetoCarbFloorG} g non-keto anti-ketosis floor survive |`);
  L.push(`| BRAIN | off · network calls **${netCalls}** (must be 0) |`);
  L.push(`| generated | ${new Date().toISOString()} · ${((Date.now() - t00) / 1000).toFixed(1)}s |`);
  L.push("");
  L.push(`## INSTRUMENT CHECKS (all must be 0)`);
  L.push("");
  L.push(`| check | count |`);
  L.push(`|---|--:|`);
  L.push(`| verdict disagreements (engine vs re-derived) | ${disagree} |`);
  L.push(`| kcal drift > 1 (solver claim vs raw Food rows) | ${drifted} |`);
  L.push(`| missing Food rows referenced by a slot | ${missingFood} |`);
  L.push(`| crashes | ${crashes} |`);
  L.push(`| network calls | ${netCalls} |`);
  L.push("");
  L.push(`## LEVEL — all three denominators, never mixed`);
  L.push("");
  L.push(`| denominator | in band | n | rate | 95% CI (Wilson) |`);
  L.push(`|---|--:|--:|--:|---|`);
  L.push(`| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | ${W.sat.k} | ${W.sat.n} | ${pc(W.sat.p)} | ${pc(W.sat.lo)}–${pc(W.sat.hi)} |`);
  L.push(`| ALL DAYS (every tier, judged days) | ${W.all.k} | ${W.all.n} | ${pc(W.all.p)} | ${pc(W.all.lo)}–${pc(W.all.hi)} |`);
  L.push(`| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | ${W.planned.k} | ${W.planned.n} | **${pc(W.planned.p)}** | ${pc(W.planned.lo)}–${pc(W.planned.hi)} |`);
  L.push("");
  L.push(`- **unjudged days: ${unjudged} of ${days}** (zero slots filled) — dropped by the \`judged\` denominator.`);
  L.push(`- of those, **${satUnjudged} are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.`);
  L.push(`- **degenerate days: ${degenerate}** — a meal config asking for ZERO slots per day. \`A1/rig/runRig.mjs\` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not ${tallies.planned.n}**.`);
  L.push(`- days where the macro closer fired: ${closerFiredDays} of ${days}.`);
  L.push("");
  L.push(`## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)`);
  L.push("");
  L.push(`| key | days |`);
  L.push(`|---|--:|`);
  for (const [k, v] of [...bindingHist.entries()].sort((a, b) => b[1] - a[1])) L.push(`| \`${k}\` | ${v} |`);
  L.push("");
  L.push(`## REPRODUCE`);
  L.push("```");
  L.push(`node backend/scripts/qc/dayDump.mjs --seed=${SEED}${N ? ` --n=${N}` : ""} --label=${LABEL}${NOSTACK ? " --nostack" : ""} --out=${path.relative(REPO, OUT).replace(/\\/g, "/")}`);
  L.push("```");

  const reportPath = OUT.replace(/\.jsonl$/, "") + ".report.md";
  fs.writeFileSync(reportPath, L.join("\n") + "\n");

  console.log(`[dayDump] ${LABEL} · seed ${SEED} (${seedName(SEED)}) · customers ${use.length} · days ${days}`);
  console.log(`[dayDump] SATISFIABLE ${W.sat.k}/${W.sat.n} = ${pc(W.sat.p)} · ALL-JUDGED ${W.all.k}/${W.all.n} = ${pc(W.all.p)} · ALL-PLANNED ${W.planned.k}/${W.planned.n} = ${pc(W.planned.p)}`);
  console.log(`[dayDump] unjudged ${unjudged} (satisfiable solver-failures ${satUnjudged}) · degenerate 0-slot ${degenerate} · closer fired on ${closerFiredDays} days`);
  console.log(`[dayDump] INSTRUMENT  disagree ${disagree} · drift>1 ${drifted} · missing-food ${missingFood} · crashes ${crashes} · net ${netCalls}   (all must be 0)`);
  console.log(`[dayDump] ${((Date.now() - t00) / 1000).toFixed(1)}s -> ${OUT}`);
  console.log(`[dayDump] report -> ${reportPath}`);
  if (netCalls > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
