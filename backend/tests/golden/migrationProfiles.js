// Light-migration Phase 1 — golden fixtures for the derived-number chain.
//
// WHY THIS EXISTS, AND WHY IT IS NOT tests/golden/fixtures.js
//
// `fixtures.js` already locks a `bmr` section: six profiles, snapshotting rmr,
// the included formula values, and the spread. That is the FIRST link in the
// chain and it has been guarded since Stage A0.
//
// It stops there. Nothing locks what happens AFTER the BMR average:
//
//     computeEnergy → deriveTarget → computeMacros
//        (rmr)         (targetKcal)   (protein / fat / carb ranges)
//
// So the number a user actually eats to — Profile.targetKcal — and every macro
// range derived from it could move by any amount with the whole suite green.
// That is precisely the failure the migration runbook names: "the calorie math
// getting quietly rewritten into something that looks equivalent and is off by
// forty calories, and nobody noticing for a month."
//
// This file locks the WHOLE chain, per profile, exactly.
//
// DETERMINISM: every function called here is pure arithmetic over fixed inputs.
// No RNG, no DB, no network, no wall-clock. So the lock is EXACT — no
// tolerances. A tolerance would only buy room for a real drift to hide.
//
// REGENERATE ONLY ON AN INTENDED ENGINE CHANGE, and read the diff line by line —
// a diff here is a diff in somebody's daily calorie target:
//   cd backend && node tests/golden/migrationProfiles.js --write

const path = require("node:path");
const fs = require("node:fs");

const {
  computeEnergy, deriveTarget, computeMacros, rateSafety, effectiveFloor,
} = require("../../src/lib/bmrEngine.js");

const GOLDEN_DIR = path.resolve(__dirname, "..", "..", "..", "MIGRATION", "golden");

// ── the ten cases the runbook names ───────────────────────────────────────
//
// Two deliberate departures, both stated rather than smuggled:
//
//  · Case 8 ("age at each boundary value the app accepts") is TWO profiles, not
//    one. The accepted band is 18–100: routes/profile.js:51-52 sets
//    BOUNDS.age = [14, 100], but ADULT_MIN_AGE (line 178) refuses anything under
//    18, so 18 is the real floor a saved profile can hold.
//
//  · Case 12 (keto) is an ADDITION. computeMacros carries a dedicated ketogenic
//    branch that inverts the whole model — carbs become a hard cap and FAT
//    absorbs the remaining calories, instead of fat being fixed by lean mass and
//    carbs taking the leftover. It is the largest single branch in the macro
//    engine. Locking eleven profiles that all miss it would leave the fixture set
//    looking like it guards the macro engine while guarding only one half of it.
//
// UNITS, honestly: `unitPref` is DISPLAY-ONLY in this app — the engine always
// takes heightCm and weightKg. So the runbook's "imperial throughout" and
// "metric throughout" cases cannot diverge inside the engine. What CAN diverge
// is the value that gets STORED after an imperial round-trip (5'10" → 177.8 cm,
// 180 lb → 81.65 kg) versus a metric user typing 178 / 81.6 directly. Cases 3
// and 4 are that near-twin pair, so the fixtures lock the arithmetic at both
// landing points rather than pretending a unit toggle changes the math.

const PROFILES = [
  {
    slug: "01-short-light-sedentary-female",
    why: "Bottom of the range. Small body + no training — the case where the safety floor is most likely to bind.",
    weightKg: 42,
    goalWeightKg: 40,
    profile: {
      sex: "F", age: 30, heightCm: 152, bodyFatPct: null,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "none", sessionsPerWeek: 0, minutesPerSession: 0,
      rateLbPerWeek: 0.5, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "02-tall-heavy-extreme-male",
    why: "Top of the range. Heaviest occupation multiplier (mining, 1.7) plus six cardio sessions — the largest TDEE the app can produce.",
    weightKg: 140,
    goalWeightKg: 110,
    profile: {
      sex: "M", age: 30, heightCm: 200, bodyFatPct: 30,
      occupationKey: "mining", activityOverride: null,
      trainingStyle: "cardio", sessionsPerWeek: 6, minutesPerSession: 90,
      rateLbPerWeek: 2.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "03-imperial-round-trip",
    why: "What gets stored when an imperial user types 5 ft 10 in / 180 lb. Pairs with 04 — the delta between them is the round-trip cost.",
    weightKg: 81.64656,   // 180 lb
    goalWeightKg: 77.11064, // 170 lb
    profile: {
      sex: "M", age: 35, heightCm: 177.8, bodyFatPct: null,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 3, minutesPerSession: 60,
      rateLbPerWeek: 1.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "04-metric-direct",
    why: "The same person typing metric directly: 178 cm / 81.6 kg. Near-twin of 03; any divergence beyond the rounding is a bug.",
    weightKg: 81.6,
    goalWeightKg: 77,
    profile: {
      sex: "M", age: 35, heightCm: 178, bodyFatPct: null,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 3, minutesPerSession: 60,
      rateLbPerWeek: 1.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "05-already-at-goal",
    why: "goalWeightKg === current. Nothing in bmrEngine reads goal weight, so the target must be unaffected — this fixture proves that stays true.",
    weightKg: 80,
    goalWeightKg: 80,
    profile: {
      sex: "M", age: 40, heightCm: 178, bodyFatPct: 18,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 3, minutesPerSession: 45,
      rateLbPerWeek: 0.25, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "06-goal-above-current-gaining",
    why: "Goal above current weight. Same reasoning as 05 — the engine still prescribes a deficit; the gaining case lives in the frontend projection.",
    weightKg: 70,
    goalWeightKg: 78,
    profile: {
      sex: "M", age: 25, heightCm: 178, bodyFatPct: 12,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 4, minutesPerSession: 60,
      rateLbPerWeek: 0.25, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "07-aggressive-deficit-floored",
    why: "2 lb/wk on a 55 kg woman. The raw math goes under the floor, so this locks the clamp, achievableRate, and both rateSafety reasons.",
    weightKg: 55,
    goalWeightKg: 50,
    profile: {
      sex: "F", age: 30, heightCm: 160, bodyFatPct: null,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "none", sessionsPerWeek: 0, minutesPerSession: 0,
      rateLbPerWeek: 2.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "08a-age-boundary-18",
    why: "The youngest age a saved profile can hold (ADULT_MIN_AGE, routes/profile.js:178).",
    weightKg: 80,
    goalWeightKg: 74,
    profile: {
      sex: "M", age: 18, heightCm: 178, bodyFatPct: null,
      occupationKey: "student", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 3, minutesPerSession: 60,
      rateLbPerWeek: 1.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "08b-age-boundary-100",
    why: "The oldest (BOUNDS.age[1], routes/profile.js:52). Schofield's band changes above 60 — this pins the far end.",
    weightKg: 60,
    goalWeightKg: 57,
    profile: {
      sex: "F", age: 100, heightCm: 160, bodyFatPct: null,
      occupationKey: "unemployed-home", activityOverride: null,
      trainingStyle: "none", sessionsPerWeek: 0, minutesPerSession: 0,
      rateLbPerWeek: 0.5, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "09-six-day-trainer",
    why: "Six sessions a week — the additive training term at its realistic maximum for a desk worker.",
    weightKg: 88,
    goalWeightKg: 82,
    profile: {
      sex: "M", age: 28, heightCm: 183, bodyFatPct: 18,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "mixed", sessionsPerWeek: 6, minutesPerSession: 75,
      rateLbPerWeek: 1.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "10-ordinary",
    why: "The middle of the road, body fat unknown. The single most common shape a real profile takes.",
    weightKg: 85,
    goalWeightKg: 78,
    profile: {
      sex: "M", age: 35, heightCm: 178, bodyFatPct: null,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 3, minutesPerSession: 60,
      rateLbPerWeek: 1.0, floorKcal: null, dietaryStyle: null, excludedFormulas: [],
    },
  },
  {
    slug: "11-keto-macro-branch",
    why: "ADDED beyond the runbook's ten. computeMacros' ketogenic branch inverts the model — carbs capped, fat absorbs the remainder. Unlocked, half the macro engine is unguarded.",
    weightKg: 95,
    goalWeightKg: 86,
    profile: {
      sex: "M", age: 42, heightCm: 182, bodyFatPct: 24,
      occupationKey: "desk-office", activityOverride: null,
      trainingStyle: "weights", sessionsPerWeek: 3, minutesPerSession: 60,
      rateLbPerWeek: 1.0, floorKcal: null, dietaryStyle: "keto", excludedFormulas: [],
    },
  },
];

/**
 * Every number the app derives for one profile, in the order the engine
 * derives them. Formula rows are rounded to integers exactly as the Engine tab
 * renders them (EngineTab.jsx:184), so the lock matches what a user can read.
 */
function capture({ slug, why, weightKg, goalWeightKg, profile }) {
  const energy = computeEnergy(profile, weightKg);
  const target = deriveTarget(profile, energy.tdee, energy.rmr);
  const macros = computeMacros(profile, weightKg, target.target, profile.floorKcal);
  const safety = rateSafety(profile, weightKg, energy.tdee, energy.rmr);

  return {
    slug,
    why,
    inputs: { weightKg, goalWeightKg, ...profile },

    energy: {
      rmr: energy.rmr,
      spreadLo: energy.spreadLo,
      spreadHi: energy.spreadHi,
      sd: energy.sd,
      spreadPct: energy.spreadPct,
      includedCount: energy.includedCount,
      allExcludedFallback: energy.allExcludedFallback,
      jobMultiplier: energy.jobMultiplier,
      jobSource: energy.jobSource,
      jobLabel: energy.jobLabel,
      trainingStyle: energy.trainingStyle,
      trainingMet: energy.trainingMet,
      trainingKcalPerDay: energy.trainingKcalPerDay,
      tdee: energy.tdee,
      formulas: energy.rows.map((r) => ({ key: r.key, kcal: Math.round(r.v), excluded: !!r.excluded })),
    },

    floor: effectiveFloor(profile, energy.rmr),

    target: {
      rate: target.rate,
      deficit: target.deficit,
      raw: target.raw,
      floor: target.floor,
      target: target.target,
      floored: target.floored,
      actualDeficit: target.actualDeficit,
      achievableRate: target.achievableRate,
    },

    macros: {
      lbmLb: macros.lbmLb,
      kcal: macros.kcal,
      proteinLo: macros.proteinLo,
      proteinHi: macros.proteinHi,
      proteinFloorG: macros.proteinFloorG,
      fatLo: macros.fatLo,
      fatHi: macros.fatHi,
      fatFloorG: macros.fatFloorG,
      fatFloored: macros.fatFloored,
      fatPctEnergy: macros.fatPctEnergy,
      carbLo: macros.carbLo,
      carbMid: macros.carbMid,
      carbHi: macros.carbHi,
      carbBufferG: macros.carbBufferG,
      carbFloored: macros.carbFloored,
      floorKcal: macros.floorKcal,
      macroKcalGap: macros.macroKcalGap,
      bfAssumed: macros.bfAssumed,
      assumedBodyFatPct: macros.assumedBodyFatPct,
    },

    rateSafety: {
      unsafe: safety.unsafe,
      pctOfBw: safety.pctOfBw,
      reasons: safety.reasons,
    },
  };
}

function captureAll() {
  return PROFILES.map(capture);
}

function goldenPathFor(slug) {
  return path.join(GOLDEN_DIR, `${slug}.json`);
}

// `node tests/golden/migrationProfiles.js --write` regenerates the committed set.
if (require.main === module && process.argv.includes("--write")) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const snap of captureAll()) {
    fs.writeFileSync(goldenPathFor(snap.slug), JSON.stringify(snap, null, 2) + "\n");
    process.stdout.write(`wrote ${path.relative(process.cwd(), goldenPathFor(snap.slug))}\n`);
  }
  process.stdout.write(`\n${PROFILES.length} profiles captured.\n`);
}

module.exports = { PROFILES, capture, captureAll, goldenPathFor, GOLDEN_DIR };
