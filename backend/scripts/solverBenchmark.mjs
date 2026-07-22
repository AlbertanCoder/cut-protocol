// Solver benchmark harness — the evidence behind Cut Protocol's sharpest claim:
// "the solver publishes an honest match % and declares unsolvable + why; it
// never silently misses a target."
//
// WHAT IT DOES
// Runs the REAL solver path (the same calls routes/plans.js POST /generate
// makes) over a grid of
//     calorie/macro target × dietary style × allergy set × max-prep cap
// for a HORIZON of consecutive weeks (default 4 — the window where Eat This
// Much users report plans going repetitive), and reports:
//   · match % distribution (per day and per week)
//   · infeasibility rate + the reason text given in every case
//   · variety / repetition across the horizon (the "repetitive by week 3" mode)
//   · solve-time distribution
//   · a HONESTY AUDIT: every day whose totals land outside tolerance must be
//     declared somewhere the user can see it (its own published match %, a slot
//     warning, or the week diagnosis). A day that misses with nothing declared
//     is a SILENT MISS and fails the run under --assert.
//
// DETERMINISTIC: seeded RNG, so a re-run on the same DB reproduces byte-identical
// numbers. Re-runnable by design — the food table is under repair (a fuzzy
// name-match import put ~242 foods' macros on the wrong row), so every ABSOLUTE
// nutritional number here is PROVISIONAL until that lands. The STRUCTURAL
// findings (silent miss? variety collapse? degenerate slots?) hold regardless,
// because they are properties of the solver, not of the macros.
//
// USAGE
//   node scripts/solverBenchmark.mjs                 # full grid, 4-week horizon
//   node scripts/solverBenchmark.mjs --quick         # small grid, fast smoke
//   node scripts/solverBenchmark.mjs --assert        # exit 1 on any silent miss
//   node scripts/solverBenchmark.mjs --weeks=8 --seed=7
//   node scripts/solverBenchmark.mjs --no-memory     # weeks as independent draws
//   node scripts/solverBenchmark.mjs --full          # keep the per-day trace (~30 MB)
//   node scripts/solverBenchmark.mjs --out=docs/solver-benchmark
// Read-only against the DB. Never writes a plan.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import prismaPkg from "../src/lib/prisma.js";
import solverPkg from "../src/lib/mealSolver.js";
import plannerPkg from "../src/lib/weeklyPlanner.js";
import contextPkg from "../src/lib/planContext.js";
import bmrPkg from "../src/lib/bmrEngine.js";

const { prisma } = prismaPkg;
const { generateBestWeekPlan, generateDayCandidates, applyPrepFilter, buildBias } = solverPkg;
const { DEFAULT_REPEAT_CAP, BATCH_REPEAT_CAP, SCALE_BOUNDS } = plannerPkg;

// The harness must also run against an OLDER checkout of the solver, so a
// before/after is a measured artifact and not a recollection. Anything the old
// solver did not export degrades to a no-op, and the run banner says so.
const HAS_VARIETY_OUTLOOK = typeof solverPkg.varietyOutlook === "function";
const HAS_CROSS_WEEK_MEMORY = typeof plannerPkg.buildPriorUsage === "function";
const varietyOutlook = HAS_VARIETY_OUTLOOK ? solverPkg.varietyOutlook : () => ({ notes: [] });
const buildPriorUsage = HAS_CROSS_WEEK_MEMORY ? plannerPkg.buildPriorUsage : () => new Map();
const RECENCY_WEIGHTS = plannerPkg.RECENCY_WEIGHTS || [1, 0.6, 0.35];
const { filterRecipePool } = contextPkg;
const { computeMacros } = bmrPkg;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// ── CLI ───────────────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);
const WEEKS = Number(argv.weeks ?? 4);
const SEED = Number(argv.seed ?? 20260721);
const QUICK = !!argv.quick;
const ASSERT = !!argv.assert;
// Runs weeks as independent draws (the pre-fix behaviour) so the cross-week
// variety memory can be measured against its own baseline.
const NO_MEMORY = !!argv["no-memory"];
// Persist the full per-day trace (~30 MB) instead of the compact summary rows.
const FULL = !!argv.full;
const OUT_DIR = path.resolve(REPO, String(argv.out ?? "docs/solver-benchmark"));

// Determinism guard: the LLM critic must never touch a benchmark run.
process.env.BRAIN = "off";

// mulberry32 — the same PRNG the unit tests use. Integer ops only, so the
// sequence is identical on every machine, forever.
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── scenario grid ─────────────────────────────────────────────────────────
// Targets come from the REAL macro engine (computeMacros), not hand-typed
// bands — so the benchmark asks the solver for the same shapes the app asks
// for. Nothing user-specific: these are synthetic body shapes spanning the
// range the app supports, per CLAUDE.md rule 3.
const BODIES = [
  { tag: "1500F", label: "1,500 kcal · small female cut", weightKg: 61, bodyFatPct: 30, targetKcal: 1500 },
  { tag: "1800F", label: "1,800 kcal · female cut", weightKg: 68, bodyFatPct: 27, targetKcal: 1800 },
  { tag: "2200M", label: "2,200 kcal · male cut", weightKg: 82, bodyFatPct: 22, targetKcal: 2200 },
  { tag: "2600M", label: "2,600 kcal · male maintenance", weightKg: 91, bodyFatPct: 18, targetKcal: 2600 },
  { tag: "3200M", label: "3,200 kcal · large male bulk", weightKg: 104, bodyFatPct: 15, targetKcal: 3200 },
];

const DIETS = ["none", "mediterranean", "vegetarian", "vegan", "paleo", "keto", "carnivore", "halal", "kosher"];

// The 10 allergy checkboxes the Profile UI ships, in the combinations that
// actually co-occur (plus the empty set as control).
const ALLERGY_SETS = [
  { tag: "—", list: [] },
  { tag: "dairy", list: ["dairy"] },
  { tag: "gluten", list: ["gluten"] },
  { tag: "dairy+gluten", list: ["dairy", "gluten"] },
  { tag: "fish+shellfish", list: ["fish", "shellfish"] },
  { tag: "nuts+sesame", list: ["peanuts", "tree nuts", "sesame"] },
  { tag: "eggs+soy", list: ["eggs", "soy"] },
];

const PREP_CAPS = [null, 45, 30, 20];

// Meal structure is a 5th axis but a small one — the grid runs 3+1 (the app
// default shape) and a rotating structure so slot-count effects still appear.
const MEAL_CONFIGS = [
  { tag: "3m+1s", meals: 3, snacks: 1 },
  { tag: "4m+0s", meals: 4, snacks: 0 },
  { tag: "3m+2s", meals: 3, snacks: 2 },
  { tag: "2m+1s", meals: 2, snacks: 1 },
];

function buildScenarios() {
  const bodies = QUICK ? BODIES.slice(1, 3) : BODIES;
  const diets = QUICK ? ["none", "vegan", "keto"] : DIETS;
  const allergies = QUICK ? ALLERGY_SETS.slice(0, 3) : ALLERGY_SETS;
  const preps = QUICK ? [null, 30] : PREP_CAPS;
  const out = [];
  let i = 0;
  for (const body of bodies) {
    for (const diet of diets) {
      for (const allergy of allergies) {
        for (const prep of preps) {
          // Rotate meal structure across the grid rather than multiplying it
          // out — every structure still gets hundreds of scenarios, and the
          // grid stays inside a ~1-minute run.
          const mealConfig = MEAL_CONFIGS[i % MEAL_CONFIGS.length];
          out.push({
            id: `${body.tag}|${diet}|${allergy.tag}|prep${prep ?? "∞"}|${mealConfig.tag}`,
            index: i, body, diet, allergy, prep, mealConfig,
          });
          i++;
        }
      }
    }
  }
  return out;
}

// ── tolerance rules (the SAME ones scoreWeek uses) ────────────────────────
const KCAL_DAY_TOL = 0.15;
const PROTEIN_DAY_TOL = 0.15;

function dayTotals(slots) {
  return slots.reduce(
    (s, x) => ({ kcal: s.kcal + x.kcal, protein: s.protein + x.protein, fat: s.fat + x.fat, carb: s.carb + x.carb }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

function dayInTolerance(target, totals) {
  const pMid = (target.proteinLo + target.proteinHi) / 2;
  const kcalOk = target.kcal > 0 ? Math.abs(totals.kcal - target.kcal) / target.kcal <= KCAL_DAY_TOL : false;
  const proteinOk = pMid > 0 ? (pMid - totals.protein) / pMid <= PROTEIN_DAY_TOL : false;
  return { kcalOk, proteinOk, ok: kcalOk && proteinOk };
}

// ── per-week analysis ─────────────────────────────────────────────────────
function analyseWeek(target, slots, weekResult) {
  const byDay = new Map();
  for (const s of slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);

  const diagnosisPresent = !!(weekResult.diagnosis && weekResult.diagnosis.reasons?.length);
  // Does the week result publish a PER-DAY match % the UI could render? This
  // is the property the "no silent target miss" claim actually rests on.
  const perDayPublished = Array.isArray(weekResult.score?.days) && weekResult.score.days.length === byDay.size;

  const days = [];
  for (const [dow, daySlots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const totals = dayTotals(daySlots);
    const tol = dayInTolerance(target, totals);
    const warnedSlots = daySlots.filter((s) => s.warning).length;
    const unsolved = daySlots.filter((s) => !s.recipeId).length;
    // A miss is DECLARED if the user can see it on that day: the day publishes
    // its own match %, or a slot on it carries a warning. A week-level
    // diagnosis alone is "declared, unattributed" — better than silence, but
    // it does not tell you WHICH day.
    const declaredOnDay = perDayPublished || warnedSlots > 0 || unsolved > 0;
    const kcalDeltaPct = target.kcal > 0 ? (totals.kcal - target.kcal) / target.kcal : 0;
    days.push({
      dayOfWeek: dow, totals, ...tol,
      kcalDeltaPct,
      proteinShortPct: Math.max(0, ((target.proteinLo + target.proteinHi) / 2 - totals.protein) / ((target.proteinLo + target.proteinHi) / 2)),
      warnedSlots, unsolved,
      missed: !tol.ok,
      // Over-target on a calorie deficit is the dangerous direction — it eats
      // the deficit without the user being told.
      overTarget: !tol.kcalOk && kcalDeltaPct > 0,
      silent: !tol.ok && !declaredOnDay && !diagnosisPresent,
      weekLevelOnly: !tol.ok && !declaredOnDay && diagnosisPresent,
      // STRICT form: the DAY total drifted out of tolerance while every slot on
      // it sat inside its own slot tolerance. Nothing on that day says a word;
      // only a per-day match % can surface it.
      dayDriftUnlabelled: !tol.ok && warnedSlots === 0 && unsolved === 0,
    });
  }

  // slot pathologies
  let zeroGramIngredients = 0, totalIngredients = 0, clampSaturated = 0, emptySlots = 0;
  let emptyMealSlots = 0, emptySnackSlots = 0;
  for (const s of slots) {
    if (!s.recipeId) {
      emptySlots++;
      if (s.slotType === "snack") emptySnackSlots++; else emptyMealSlots++;
      continue;
    }
    for (const ing of s.ingredients || []) {
      totalIngredients++;
      if (!(ing.grams > 0)) zeroGramIngredients++;
    }
    if (s.proteinScale === SCALE_BOUNDS.min || s.proteinScale === SCALE_BOUNDS.max
      || s.sidesScale === SCALE_BOUNDS.min || s.sidesScale === SCALE_BOUNDS.max) clampSaturated++;
  }

  return {
    days,
    daysInTolerance: days.filter((d) => d.ok).length,
    avgMatch: weekResult.score?.avgMatch ?? null,
    reportedDaysInTolerance: weekResult.score?.daysInTolerance ?? null,
    perDayPublished,
    diagnosisPresent,
    diagnosisReasons: weekResult.diagnosis?.reasons || [],
    diagnosisSuggestions: weekResult.diagnosis?.suggestions || [],
    slots: slots.length,
    emptySlots, emptyMealSlots, emptySnackSlots,
    warnedSlots: slots.filter((s) => s.warning).length,
    zeroGramIngredients, totalIngredients, clampSaturated,
    silentMisses: days.filter((d) => d.silent).length,
    weekLevelOnlyMisses: days.filter((d) => d.weekLevelOnly).length,
    // The week fell short of 7 clean days but shipped no "unsolvable + why".
    missingDaysWithoutReason: days.some((d) => !d.ok) && !diagnosisPresent,
  };
}

// ── variety across the horizon ────────────────────────────────────────────
function analyseVariety(weeks) {
  // Meal slots only — snacks are analysed separately because their pool is a
  // different (and much smaller) population.
  const perWeekMeal = weeks.map((w) => w.slots.filter((s) => s.slotType === "meal" && s.recipeId).map((s) => s.recipeId));
  const perWeekSnack = weeks.map((w) => w.slots.filter((s) => s.slotType === "snack" && s.recipeId).map((s) => s.recipeId));

  const seen = new Set();
  const noveltyByWeek = [];
  const distinctByWeek = [];
  for (const ids of perWeekMeal) {
    const fresh = ids.filter((id) => !seen.has(id)).length;
    noveltyByWeek.push(ids.length ? fresh / ids.length : null);
    distinctByWeek.push(new Set(ids).size);
    ids.forEach((id) => seen.add(id));
  }
  const allMeal = perWeekMeal.flat();
  const counts = new Map();
  for (const id of allMeal) counts.set(id, (counts.get(id) || 0) + 1);
  const sortedCounts = [...counts.values()].sort((a, b) => b - a);

  const snackSeen = new Set();
  const snackNovelty = [];
  for (const ids of perWeekSnack) {
    const fresh = ids.filter((id) => !snackSeen.has(id)).length;
    snackNovelty.push(ids.length ? fresh / ids.length : null);
    ids.forEach((id) => snackSeen.add(id));
  }
  const snackCounts = new Map();
  for (const id of perWeekSnack.flat()) snackCounts.set(id, (snackCounts.get(id) || 0) + 1);

  return {
    mealServings: allMeal.length,
    distinctMealRecipes: counts.size,
    distinctByWeek,
    noveltyByWeek,                       // fraction of each week's meals never served before
    week3Novelty: noveltyByWeek[2] ?? null, // the Eat This Much failure mode, isolated
    maxServingsOfOneRecipe: sortedCounts[0] ?? 0,
    top3Share: allMeal.length ? sortedCounts.slice(0, 3).reduce((a, b) => a + b, 0) / allMeal.length : 0,
    snackServings: perWeekSnack.flat().length,
    distinctSnackRecipes: snackCounts.size,
    snackNoveltyByWeek: snackNovelty,
    maxServingsOfOneSnack: [...snackCounts.values()].sort((a, b) => b - a)[0] ?? 0,
  };
}

// ── stats helpers ─────────────────────────────────────────────────────────
const pct = (n) => (n == null ? "—" : `${Math.round(n * 1000) / 10}%`);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function describe(values) {
  const s = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    min: s[0], p05: quantile(s, 0.05), p25: quantile(s, 0.25), median: quantile(s, 0.5),
    p75: quantile(s, 0.75), p95: quantile(s, 0.95), max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const t00 = performance.now();
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const foodCount = await prisma.food.count();

  // Data fingerprint — so a results doc can state exactly which snapshot of the
  // (currently partly corrupt) food table produced its numbers, and a re-run
  // after the repair is provably a different input.
  const foods = await prisma.food.findMany({ select: { id: true, kcal: true, protein: true, fat: true, carb: true }, orderBy: { id: "asc" } });
  const macroHash = crypto.createHash("sha256")
    .update(foods.map((f) => `${f.id}:${f.kcal}:${f.protein}:${f.fat}:${f.carb}`).join("|"))
    .digest("hex").slice(0, 16);

  const scenarios = buildScenarios();
  console.log(`Cut Protocol · solver benchmark`);
  console.log(`  pool: ${rawPool.length} recipes / ${foodCount} foods (macro fingerprint ${macroHash})`);
  console.log(`  grid: ${scenarios.length} scenarios × ${WEEKS}-week horizon = ${scenarios.length * WEEKS} week solves`);
  console.log(`  seed: ${SEED}${QUICK ? "  [QUICK]" : ""}`);
  if (!HAS_VARIETY_OUTLOOK || !HAS_CROSS_WEEK_MEMORY) {
    console.log(`  NOTE: running against a solver without ${[!HAS_CROSS_WEEK_MEMORY && "cross-week variety memory", !HAS_VARIETY_OUTLOOK && "the variety outlook"].filter(Boolean).join(" or ")} — those metrics read as absent, not as zero.`);
  }
  console.log("");

  const results = [];
  let done = 0;
  for (const sc of scenarios) {
    const profileish = { bodyFatPct: sc.body.bodyFatPct };
    const target = computeMacros(profileish, sc.body.weightKg, sc.body.targetKcal);
    const dietProfile = { dietaryStyle: sc.diet === "none" ? null : sc.diet, excludedFoods: sc.allergy.list };
    const afterDiet = filterRecipePool(rawPool, dietProfile);
    const filters = { cuisines: [], protein: null, budget: null, maxPrepMin: sc.prep, allowBatchRepeats: false };
    const pool = applyPrepFilter(afterDiet, sc.prep);
    const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: pool.length };

    const rng = makeRng(SEED + sc.index * 977);
    const weeks = [];
    // Mirrors POST /generate exactly: each week is solved with the previous
    // weeks' plans as recency-weighted cross-week memory (`--no-memory` runs
    // the old independent-draws behaviour, for before/after comparison).
    const history = [];
    for (let w = 0; w < WEEKS; w++) {
      const t0 = performance.now();
      const weekResult = await generateBestWeekPlan(target, sc.mealConfig, pool, {
        rng, bias: buildBias(filters, null), allowBatchRepeats: false, filters, counts,
        priorUsage: NO_MEMORY ? null : buildPriorUsage(history),
      });
      const ms = performance.now() - t0;
      weeks.push({ slots: weekResult.slots, ms, analysis: analyseWeek(target, weekResult.slots, weekResult) });
      history.unshift({ slots: weekResult.slots }); // newest first
      if (history.length > RECENCY_WEIGHTS.length) history.pop();
    }

    // Day-candidate surface (POST /day-options) — the second place a match %
    // is published, and the one the day picker renders.
    const tD = performance.now();
    const dayOpts = await generateDayCandidates({
      dailyTarget: target, mealConfig: sc.mealConfig, recipePool: afterDiet,
      dayOfWeek: 0, filters, rng: makeRng(SEED + sc.index * 31 + 7), profile: null,
    });
    const dayMs = performance.now() - tD;

    results.push({
      id: sc.id, index: sc.index,
      body: sc.body.tag, diet: sc.diet, allergies: sc.allergy.tag, prep: sc.prep, mealConfig: sc.mealConfig.tag,
      target: { kcal: target.kcal, proteinLo: target.proteinLo, proteinHi: target.proteinHi, fatLo: target.fatLo, fatHi: target.fatHi, carbLo: target.carbLo, carbHi: target.carbHi },
      counts,
      weeks: weeks.map((w) => ({ ms: Math.round(w.ms * 10) / 10, ...w.analysis })),
      variety: analyseVariety(weeks),
      varietyOutlook: varietyOutlook({ pool, mealConfig: sc.mealConfig, filters, horizonWeeks: WEEKS, dailyTarget: target }),
      dayOptions: {
        ms: Math.round(dayMs * 10) / 10,
        candidates: dayOpts.candidates.length,
        bestMatchPct: dayOpts.candidates[0]?.score.matchPct ?? null,
        diagnosed: !!dayOpts.diagnosis,
        reasons: dayOpts.diagnosis?.reasons || [],
      },
    });

    done++;
    if (done % 100 === 0 || done === scenarios.length) {
      process.stdout.write(`\r  solved ${done}/${scenarios.length} scenarios…`);
    }
  }
  process.stdout.write("\n\n");

  const report = summarise(results, {
    generatedAt: new Date().toISOString(),
    seed: SEED, weeks: WEEKS, quick: QUICK,
    crossWeekMemory: !NO_MEMORY,
    pool: { recipes: rawPool.length, foods: foodCount, macroFingerprint: macroHash },
    repeatCaps: { default: DEFAULT_REPEAT_CAP, batch: BATCH_REPEAT_CAP },
    runtimeSec: Math.round((performance.now() - t00) / 100) / 10,
    provisional: "Absolute nutritional numbers are PROVISIONAL — the food table is under repair (fuzzy name-match import put ~242 of 864 foods' macros on the wrong row). Structural findings are unaffected.",
  });

  printReport(report);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Compact by default: the committed artifact is the summary + one row per
  // scenario (~300 KB). The full per-day trace is ~30 MB — available behind
  // --full for a local investigation, never checked in.
  const scenarioRows = FULL ? results : results.map(compactScenario);
  // meta + summary pretty-printed (they are read by humans); one dense line per
  // scenario (they are read by scripts, and 2-space indent tripled the file).
  const json = [
    "{",
    `  "meta": ${JSON.stringify(report.meta, null, 2).replace(/\n/g, "\n  ")},`,
    `  "summary": ${JSON.stringify(report.summary, roundFloats, 2).replace(/\n/g, "\n  ")},`,
    '  "scenarios": [',
    scenarioRows.map((r) => `    ${JSON.stringify(r, roundFloats)}`).join(",\n"),
    "  ]",
    "}",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "latest.json"), json + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "latest.md"), renderMarkdown(report) + "\n");
  console.log(`\nwrote ${path.relative(REPO, path.join(OUT_DIR, "latest.json"))} + latest.md`);

  if (ASSERT) {
    const s = report.summary;
    const failures = [];
    if (s.honesty.silentMissDays > 0) failures.push(`${s.honesty.silentMissDays} SILENT MISS day(s) — a day landed outside tolerance with no match %, no slot warning and no diagnosis`);
    if (s.honesty.undeclaredInfeasibleScenarios > 0) failures.push(`${s.honesty.undeclaredInfeasibleScenarios} scenario(s) shipped an unsolvable week with no reason given`);
    if (s.slots.zeroGramIngredients > 0) failures.push(`${s.slots.zeroGramIngredients} ingredient(s) shipped at 0 g (portion-rounding artifact — the ingredient silently vanishes from the plate and the grocery list)`);
    if (failures.length) {
      console.error(`\nBENCHMARK FAILED:\n${failures.map((f) => `  · ${f}`).join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log("\nBENCHMARK PASSED: no silent misses, no undeclared infeasibility, no zero-gram ingredients.");
    }
  }
}

// Full float precision is noise in a committed artifact; 4 decimals keeps every
// rate and fraction exact enough to re-derive the published tables.
function roundFloats(_key, value) {
  return typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1e4) / 1e4 : value;
}

// One committed row per scenario — everything the results doc cites, nothing
// that only matters while debugging a single solve.
function compactScenario(r) {
  const sum = (f) => r.weeks.reduce((a, w) => a + f(w), 0);
  return {
    id: r.id, body: r.body, diet: r.diet, allergies: r.allergies, prep: r.prep, mealConfig: r.mealConfig,
    targetKcal: r.target.kcal, counts: r.counts,
    weekMs: r.weeks.map((w) => w.ms),
    daysInTolerance: r.weeks.map((w) => w.daysInTolerance),
    avgMatch: r.weeks.map((w) => w.avgMatch),
    weeksWithDiagnosis: r.weeks.filter((w) => w.diagnosisPresent).length,
    weeksMissingDaysWithoutReason: r.weeks.filter((w) => w.missingDaysWithoutReason).length,
    silentMisses: sum((w) => w.silentMisses),
    weekLevelOnlyMisses: sum((w) => w.weekLevelOnlyMisses),
    dayDriftUnlabelled: sum((w) => w.days.filter((d) => d.dayDriftUnlabelled).length),
    missedDays: sum((w) => w.days.filter((d) => d.missed).length),
    overTargetDays: sum((w) => w.days.filter((d) => d.overTarget).length),
    emptySlots: sum((w) => w.emptySlots), emptyMealSlots: sum((w) => w.emptyMealSlots), emptySnackSlots: sum((w) => w.emptySnackSlots),
    warnedSlots: sum((w) => w.warnedSlots), clampSaturated: sum((w) => w.clampSaturated),
    zeroGramIngredients: sum((w) => w.zeroGramIngredients), totalIngredients: sum((w) => w.totalIngredients),
    // Distinct reason texts this scenario ever produced — the "and why" evidence.
    reasons: [...new Set(r.weeks.flatMap((w) => w.diagnosisReasons))],
    variety: r.variety, varietyOutlook: r.varietyOutlook, dayOptions: r.dayOptions,
  };
}

// ── summarisation ─────────────────────────────────────────────────────────
function summarise(results, meta) {
  const allWeeks = results.flatMap((r) => r.weeks);
  const allDays = allWeeks.flatMap((w) => w.days);

  const silentDays = allDays.filter((d) => d.silent);
  const weekOnlyDays = allDays.filter((d) => d.weekLevelOnly);
  const missedDays = allDays.filter((d) => d.missed);

  // Infeasible = the solver could not put 7 clean days on the table.
  const infeasibleWeeks = allWeeks.filter((w) => w.daysInTolerance < 7);
  const undeclared = allWeeks.filter((w) => w.daysInTolerance < 7 && !w.diagnosisPresent && !w.perDayPublished && w.warnedSlots === 0);
  const undeclaredScenarios = new Set(
    results.filter((r) => r.weeks.some((w) => w.daysInTolerance < 7 && !w.diagnosisPresent && !w.perDayPublished && w.warnedSlots === 0)).map((r) => r.id)
  );

  // reason tally across every diagnosis the run produced
  const reasonTally = new Map();
  for (const w of allWeeks) {
    for (const reason of w.diagnosisReasons) {
      const key = classifyReason(reason);
      reasonTally.set(key, (reasonTally.get(key) || 0) + 1);
    }
  }

  const varietyByDiet = new Map();
  for (const r of results) {
    const k = r.diet;
    const acc = varietyByDiet.get(k) || { n: 0, week3: [], distinct: [], maxRepeat: [], top3: [], snackDistinct: [], poolAfterDiet: [] };
    acc.n++;
    if (r.variety.week3Novelty != null) acc.week3.push(r.variety.week3Novelty);
    acc.distinct.push(r.variety.distinctMealRecipes);
    acc.maxRepeat.push(r.variety.maxServingsOfOneRecipe);
    acc.top3.push(r.variety.top3Share);
    acc.snackDistinct.push(r.variety.distinctSnackRecipes);
    acc.poolAfterDiet.push(r.counts.afterDiet);
    varietyByDiet.set(k, acc);
  }

  const byDiet = [...varietyByDiet.entries()].map(([diet, a]) => ({
    diet, scenarios: a.n,
    poolAfterDiet: Math.round(a.poolAfterDiet.reduce((x, y) => x + y, 0) / a.n),
    medianWeek3Novelty: quantile([...a.week3].sort((x, y) => x - y), 0.5),
    medianDistinctMeals: quantile([...a.distinct].sort((x, y) => x - y), 0.5),
    medianTop3Share: quantile([...a.top3].sort((x, y) => x - y), 0.5),
    worstMaxRepeat: Math.max(...a.maxRepeat),
    medianDistinctSnacks: quantile([...a.snackDistinct].sort((x, y) => x - y), 0.5),
  })).sort((a, b) => a.medianWeek3Novelty - b.medianWeek3Novelty);

  return {
    meta,
    summary: {
      scenarios: results.length,
      weekSolves: allWeeks.length,
      dayResults: allDays.length,
      honesty: {
        missedDays: missedDays.length,
        missedDayRate: missedDays.length / Math.max(1, allDays.length),
        silentMissDays: silentDays.length,
        silentMissRate: silentDays.length / Math.max(1, allDays.length),
        weekLevelOnlyDays: weekOnlyDays.length,
        dayDriftUnlabelledDays: allDays.filter((d) => d.dayDriftUnlabelled).length,
        overTargetDays: allDays.filter((d) => d.overTarget).length,
        perDayMatchPublishedWeeks: allWeeks.filter((w) => w.perDayPublished).length,
        weeksMissingDaysWithoutReason: allWeeks.filter((w) => w.missingDaysWithoutReason).length,
        undeclaredInfeasibleWeeks: undeclared.length,
        undeclaredInfeasibleScenarios: undeclaredScenarios.size,
        exampleSilent: silentDays.slice(0, 5).map((d) => ({ dayOfWeek: d.dayOfWeek, totals: d.totals, kcalDeltaPct: d.kcalDeltaPct, proteinShortPct: d.proteinShortPct })),
        exampleUndeclared: [...undeclaredScenarios].slice(0, 10),
      },
      feasibility: {
        infeasibleWeeks: infeasibleWeeks.length,
        infeasibleWeekRate: infeasibleWeeks.length / Math.max(1, allWeeks.length),
        weeksWithDiagnosis: allWeeks.filter((w) => w.diagnosisPresent).length,
        fullyCleanWeeks: allWeeks.filter((w) => w.daysInTolerance === 7).length,
        reasonTally: [...reasonTally.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
      },
      match: {
        weekAvgMatch: describe(allWeeks.map((w) => w.avgMatch)),
        daysInTolerancePerWeek: describe(allWeeks.map((w) => w.daysInTolerance)),
        dayKcalDeltaPctAbs: describe(allDays.map((d) => Math.abs(d.kcalDeltaPct) * 100)),
        dayProteinShortPct: describe(allDays.map((d) => d.proteinShortPct * 100)),
        dayCandidateBestMatch: describe(results.map((r) => r.dayOptions.bestMatchPct)),
      },
      timing: {
        weekSolveMs: describe(allWeeks.map((w) => w.ms)),
        dayOptionsMs: describe(results.map((r) => r.dayOptions.ms)),
      },
      slots: {
        total: allWeeks.reduce((a, w) => a + w.slots, 0),
        empty: allWeeks.reduce((a, w) => a + w.emptySlots, 0),
        emptyMeal: allWeeks.reduce((a, w) => a + w.emptyMealSlots, 0),
        emptySnack: allWeeks.reduce((a, w) => a + w.emptySnackSlots, 0),
        warned: allWeeks.reduce((a, w) => a + w.warnedSlots, 0),
        clampSaturated: allWeeks.reduce((a, w) => a + w.clampSaturated, 0),
        zeroGramIngredients: allWeeks.reduce((a, w) => a + w.zeroGramIngredients, 0),
        totalIngredients: allWeeks.reduce((a, w) => a + w.totalIngredients, 0),
      },
      variety: {
        week3Novelty: describe(results.map((r) => r.variety.week3Novelty).filter((v) => v != null).map((v) => v * 100)),
        noveltyByWeek: Array.from({ length: meta.weeks }, (_, w) =>
          describe(results.map((r) => r.variety.noveltyByWeek[w]).filter((v) => v != null).map((v) => v * 100))),
        distinctMealRecipes: describe(results.map((r) => r.variety.distinctMealRecipes)),
        maxServingsOfOneRecipe: describe(results.map((r) => r.variety.maxServingsOfOneRecipe)),
        distinctSnackRecipes: describe(results.map((r) => r.variety.distinctSnackRecipes)),
        maxServingsOfOneSnack: describe(results.map((r) => r.variety.maxServingsOfOneSnack)),
        // Honesty of the VARIETY claim: where repetition is genuinely
        // unavoidable, did the solver say so up front?
        scenariosWithRealRepetition: results.filter((r) => r.variety.week3Novelty != null && r.variety.week3Novelty < 0.5).length,
        scenariosWarnedAboutVariety: results.filter((r) => (r.varietyOutlook?.notes || []).length > 0).length,
        repetitionUnwarned: results.filter((r) =>
          r.variety.week3Novelty != null && r.variety.week3Novelty < 0.5 && (r.varietyOutlook?.notes || []).length === 0).length,
        byDiet,
      },
    },
  };
}

// Group free-text reasons into stable buckets so the tally is readable.
function classifyReason(reason) {
  if (/dietary style \+ allergy rules exclude every recipe/i.test(reason)) return "pool empty after diet + allergy rules";
  if (/^Max prep/i.test(reason)) return "max-prep cap cut the pool";
  if (/meal-eligible recipes/i.test(reason)) return "not enough meal-eligible recipes for a week";
  if (/snack slot\(s\) come back empty|snack slots this week come back empty/i.test(reason)) return "not enough snack recipes — snack slots come back empty";
  if (/protein per 100 kcal/i.test(reason)) return "pool lacks protein-dense recipes for these targets";
  if (/landed protein-short/i.test(reason)) return "days landed protein-short";
  if (/missed the calorie window/i.test(reason)) return "days missed the calorie window (0.5–2× portion bound)";
  if (/closest fits/i.test(reason)) return "closest-fit shipped; pool leaves little room";
  return "other";
}

// ── console + markdown output ─────────────────────────────────────────────
function fmtDesc(d, unit = "") {
  if (!d) return "—";
  const f = (v) => `${r1(v)}${unit}`;
  return `min ${f(d.min)} · p25 ${f(d.p25)} · median ${f(d.median)} · p75 ${f(d.p75)} · p95 ${f(d.p95)} · max ${f(d.max)}`;
}

function printReport(report) {
  const s = report.summary;
  console.log("── HONESTY AUDIT ─────────────────────────────────────────────");
  console.log(`  day-results               ${s.dayResults}`);
  console.log(`  days outside tolerance    ${s.honesty.missedDays} (${pct(s.honesty.missedDayRate)})`);
  console.log(`    …of which over target     ${s.honesty.overTargetDays}`);
  console.log(`  ► SILENT MISSES           ${s.honesty.silentMissDays} (${pct(s.honesty.silentMissRate)})`);
  console.log(`  declared week-level only  ${s.honesty.weekLevelOnlyDays}  (user is told the week is rough, not WHICH day)`);
  console.log(`  day-total drift, every slot individually "fine"  ${s.honesty.dayDriftUnlabelledDays}`);
  console.log(`  weeks publishing per-day match %   ${s.honesty.perDayMatchPublishedWeeks}/${s.weekSolves}`);
  console.log(`  ► weeks short of 7 clean days with NO reason given  ${s.honesty.weeksMissingDaysWithoutReason}`);
  console.log(`  ► undeclared infeasible weeks      ${s.honesty.undeclaredInfeasibleWeeks} (${s.honesty.undeclaredInfeasibleScenarios} scenarios)`);
  console.log("\n── FEASIBILITY ───────────────────────────────────────────────");
  console.log(`  clean weeks (7/7 days)    ${s.feasibility.fullyCleanWeeks}/${s.weekSolves} (${pct(s.feasibility.fullyCleanWeeks / s.weekSolves)})`);
  console.log(`  weeks missing ≥1 day      ${s.feasibility.infeasibleWeeks} (${pct(s.feasibility.infeasibleWeekRate)})`);
  console.log(`  weeks carrying a reason   ${s.feasibility.weeksWithDiagnosis}`);
  console.table(s.feasibility.reasonTally);
  console.log("── MATCH % ───────────────────────────────────────────────────");
  console.log(`  week avg match      ${fmtDesc(s.match.weekAvgMatch, "%")}`);
  console.log(`  days in tolerance   ${fmtDesc(s.match.daysInTolerancePerWeek, "/7")}`);
  console.log(`  |kcal delta| /day   ${fmtDesc(s.match.dayKcalDeltaPctAbs, "%")}`);
  console.log(`  protein short /day  ${fmtDesc(s.match.dayProteinShortPct, "%")}`);
  console.log(`  day-candidate best  ${fmtDesc(s.match.dayCandidateBestMatch, "%")}`);
  console.log("\n── VARIETY OVER THE HORIZON ──────────────────────────────────");
  s.variety.noveltyByWeek.forEach((d, i) => console.log(`  week ${i + 1} novelty     ${fmtDesc(d, "%")}`));
  console.log(`  distinct meal recipes / horizon  ${fmtDesc(s.variety.distinctMealRecipes)}`);
  console.log(`  worst single-recipe repeat        ${fmtDesc(s.variety.maxServingsOfOneRecipe, "×")}`);
  console.log(`  distinct SNACK recipes / horizon  ${fmtDesc(s.variety.distinctSnackRecipes)}`);
  console.log(`  scenarios that really repeat (wk-3 novelty <50%)  ${s.variety.scenariosWithRealRepetition}`);
  console.log(`  …warned up front by the solver                    ${s.variety.scenariosWithRealRepetition - s.variety.repetitionUnwarned}  (unwarned: ${s.variety.repetitionUnwarned})`);
  console.table(s.variety.byDiet.map((d) => ({
    diet: d.diet, pool: d.poolAfterDiet,
    "wk3 novelty": pct(d.medianWeek3Novelty),
    "distinct meals": d.medianDistinctMeals,
    "top-3 share": pct(d.medianTop3Share),
    "worst repeat": d.worstMaxRepeat,
    "distinct snacks": d.medianDistinctSnacks,
  })));
  console.log("── SLOTS ─────────────────────────────────────────────────────");
  console.log(`  slots ${s.slots.total} · unfilled ${s.slots.empty} (meal ${s.slots.emptyMeal} / snack ${s.slots.emptySnack}) · warned ${s.slots.warned} · portion-clamp saturated ${s.slots.clampSaturated}`);
  console.log(`  ► ingredients shipped at 0 g: ${s.slots.zeroGramIngredients} / ${s.slots.totalIngredients} (${pct(s.slots.zeroGramIngredients / Math.max(1, s.slots.totalIngredients))})`);
  console.log("\n── TIMING ────────────────────────────────────────────────────");
  console.log(`  week solve (best-of-5)  ${fmtDesc(s.timing.weekSolveMs, "ms")}`);
  console.log(`  day options             ${fmtDesc(s.timing.dayOptionsMs, "ms")}`);
  console.log(`\n  run: ${report.meta.runtimeSec}s`);
}

function mdTable(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function renderMarkdown(report) {
  const s = report.summary, m = report.meta;
  const d = (x, u = "") => (x ? `${r1(x.median)}${u} (p05 ${r1(x.p05)}${u} · p95 ${r1(x.p95)}${u})` : "—");
  return `<!-- GENERATED by backend/scripts/solverBenchmark.mjs — do not hand-edit. Re-run to refresh. -->
# Solver benchmark — run output

- generated: \`${m.generatedAt}\`
- seed: \`${m.seed}\` · horizon: \`${m.weeks}\` weeks · scenarios: \`${s.scenarios}\` · week solves: \`${s.weekSolves}\`
- cross-week variety memory: \`${m.crossWeekMemory ? "on (as shipped)" : "OFF (independent weekly draws — pre-fix behaviour)"}\`
- pool: \`${m.pool.recipes}\` recipes / \`${m.pool.foods}\` foods · food-macro fingerprint \`${m.pool.macroFingerprint}\`
- runtime: \`${m.runtimeSec}s\`

> **PROVISIONAL.** ${m.provisional}

## Honesty audit — does the solver ever miss silently?

${mdTable(["metric", "value"], [
  ["day-results evaluated", s.dayResults],
  ["days outside tolerance", `${s.honesty.missedDays} (${pct(s.honesty.missedDayRate)})`],
  ["…of which OVER the calorie target", s.honesty.overTargetDays],
  ["**silent misses** (miss, no match %, no slot warning, no diagnosis)", `**${s.honesty.silentMissDays} (${pct(s.honesty.silentMissRate)})**`],
  ["declared week-level only (no per-day attribution)", s.honesty.weekLevelOnlyDays],
  ["day-total drift while every slot sat inside its own tolerance", s.honesty.dayDriftUnlabelledDays],
  ["weeks publishing a per-day match %", `${s.honesty.perDayMatchPublishedWeeks} / ${s.weekSolves}`],
  ["**weeks short of 7 clean days with NO reason given**", `**${s.honesty.weeksMissingDaysWithoutReason}**`],
  ["**infeasible weeks shipped with nothing declared at all**", `**${s.honesty.undeclaredInfeasibleWeeks}**`],
])}

## Feasibility

${mdTable(["metric", "value"], [
  ["clean weeks (7/7 days in tolerance)", `${s.feasibility.fullyCleanWeeks} / ${s.weekSolves} (${pct(s.feasibility.fullyCleanWeeks / s.weekSolves)})`],
  ["weeks missing ≥1 day", `${s.feasibility.infeasibleWeeks} (${pct(s.feasibility.infeasibleWeekRate)})`],
  ["weeks carrying an explicit reason", s.feasibility.weeksWithDiagnosis],
])}

### Reasons given

${mdTable(["reason", "times given"], s.feasibility.reasonTally.map((r) => [r.reason, r.n]))}

## Match % distribution

${mdTable(["metric", "min", "p25", "median", "p75", "p95", "max"],
  [["week avg match %", s.match.weekAvgMatch], ["days in tolerance / 7", s.match.daysInTolerancePerWeek],
   ["|kcal delta| per day %", s.match.dayKcalDeltaPctAbs], ["protein shortfall per day %", s.match.dayProteinShortPct],
   ["best day-candidate match %", s.match.dayCandidateBestMatch]]
    .map(([label, x]) => [label, r1(x?.min), r1(x?.p25), r1(x?.median), r1(x?.p75), r1(x?.p95), r1(x?.max)]))}

## Variety across a ${m.weeks}-week horizon

${mdTable(["week", "novelty (share of that week's meals never served before)"],
  s.variety.noveltyByWeek.map((x, i) => [`week ${i + 1}`, d(x, "%")]))}

${mdTable(["metric", "median (p05 · p95)"], [
  ["distinct meal recipes over the horizon", d(s.variety.distinctMealRecipes)],
  ["worst single-recipe repeat count", d(s.variety.maxServingsOfOneRecipe, "×")],
  ["distinct SNACK recipes over the horizon", d(s.variety.distinctSnackRecipes)],
  ["worst single-snack repeat count", d(s.variety.maxServingsOfOneSnack, "×")],
  ["scenarios that genuinely repeat (wk-3 novelty < 50%)", s.variety.scenariosWithRealRepetition],
  ["**…that repeat WITHOUT the solver warning up front**", `**${s.variety.repetitionUnwarned}**`],
])}

### By dietary style

${mdTable(["diet", "pool after diet", "median wk-3 novelty", "median distinct meals", "median top-3 share", "worst repeat", "median distinct snacks"],
  s.variety.byDiet.map((x) => [x.diet, x.poolAfterDiet, pct(x.medianWeek3Novelty), x.medianDistinctMeals, pct(x.medianTop3Share), x.worstMaxRepeat, x.medianDistinctSnacks]))}

## Slot pathologies

${mdTable(["metric", "value"], [
  ["slots generated", s.slots.total],
  ["unfilled slots (no recipe)", `${s.slots.empty} — meal ${s.slots.emptyMeal} / snack ${s.slots.emptySnack}`],
  ["slots carrying a warning", s.slots.warned],
  ["slots pinned at the 0.5×/2× portion clamp", s.slots.clampSaturated],
  ["**ingredients shipped at 0 g**", `**${s.slots.zeroGramIngredients} / ${s.slots.totalIngredients} (${pct(s.slots.zeroGramIngredients / Math.max(1, s.slots.totalIngredients))})**`],
])}

## Solve time

${mdTable(["operation", "min", "median", "p95", "max"], [
  ["week solve (best-of-5 attempts)", r1(s.timing.weekSolveMs?.min), r1(s.timing.weekSolveMs?.median), r1(s.timing.weekSolveMs?.p95), r1(s.timing.weekSolveMs?.max)],
  ["day options (3 candidates)", r1(s.timing.dayOptionsMs?.min), r1(s.timing.dayOptionsMs?.median), r1(s.timing.dayOptionsMs?.p95), r1(s.timing.dayOptionsMs?.max)],
].map((r) => r.map((c) => (c == null ? "—" : c))))}
`;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
