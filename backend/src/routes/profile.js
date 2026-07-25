const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { computeEnergy, rateSafety, RATE_OPTIONS, SAFE_FLOOR, FORMULA_KEYS } = require("../lib/bmrEngine.js");
const { recomputeTarget } = require("../lib/profileTarget.js");
const { OCCUPATION_BY_KEY, TRAINING_BY_KEY } = require("../lib/activityData.js");
const { DIETARY_STYLES } = require("../lib/dietaryFilter.js");
const { PROTEIN_FLOOR_SOURCE } = require("../lib/brain/proteinFloor.js");
const { todayStr } = require("../lib/dates.js");

const router = express.Router();
router.use(requireAuth);

// targetKcal is deliberately absent: it's derived (rate → deficit → floor
// clamp) and materialized by recomputeTarget(), never set by the client.
const BODY_FAT_SOURCES = ["visual-estimate", "measured"]; // E2 (v2)
const PROFILE_FIELDS = [
  "sex", "age", "heightCm", "bodyFatPct", "bodyFatSource",
  "occupationKey", "activityOverride", "sessionsPerWeek", "trainingStyle", "minutesPerSession",
  "startWeightKg", "goalWeightKg", "startDate", "unitPref",
  "rateLbPerWeek", "rateAcknowledged", "floorKcal", "excludedFormulas",
  "mealsPerDay", "snacksPerDay", "excludedFoods", "dietaryStyle",
  "cuisinePreferences", "mealPreferencesNote",
];

// ── VALIDATION: two shapes, one source ────────────────────────────────────
//
// `validateProfileFields()` returns FIELD → one sentence a person can act on.
// `validateProfilePatch()` wraps it in the old array-of-strings shape (each
// entry prefixed with the field key) for logs and for the unit tests that
// already assert against it.
//
// THE BUG THIS CLOSES: the route used to answer a bad edit with
//   "heightCm must be a number between 100 and 250; goalWeightKg must be a
//    number between 30 and 400 kg"
// — object keys and enum unions (`dietaryStyle must be null or one of
// none|mediterranean|vegetarian|…`, `unitPref must be imperial|metric`),
// semicolon-joined and rendered raw in a red box at the top of the Profile
// tab. That is developer output that escaped into the product: it names
// internals the user has never seen, it does not say WHICH box on screen is
// wrong, and a list of pipe-separated enum members is not a sentence.
//
// The map lets the UI put each message under the input that produced it (the
// same FieldError pattern LoginScreen already uses). Nothing here may name a
// column, print an enum union, or quote a unit the user isn't working in
// without also giving theirs.
// The numeric bounds, in one place, because /meta serves them to the wizard.
// A wizard carrying its own copy of "age 14-100" is how the old
// `+d.age >= 14` came to disagree with this file in the first place.
const BOUNDS = {
  age: [14, 100],
  heightCm: [100, 250],
  weightKg: [30, 400],
  bodyFatPct: [0, 70],
};

function validateProfileFields(body) {
  const f = {};
  const intBetween = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  if (body.mealsPerDay !== undefined && !intBetween(body.mealsPerDay, 1, 8)) {
    f.mealsPerDay = "Enter a whole number of meals a day, from 1 to 8.";
  }
  if (body.snacksPerDay !== undefined && !intBetween(body.snacksPerDay, 0, 8)) {
    f.snacksPerDay = "Enter a whole number of snacks a day, from 0 to 8.";
  }
  if (body.sex !== undefined && !["M", "F"].includes(body.sex)) {
    f.sex = "Choose male or female — the calorie formulas need one or the other.";
  }
  if (body.occupationKey !== undefined && !OCCUPATION_BY_KEY[body.occupationKey]) {
    f.occupationKey = "That job isn't in the list. Pick one from the search results, or set the multiplier by hand below.";
  }
  if (body.trainingStyle !== undefined && !TRAINING_BY_KEY[body.trainingStyle]) {
    f.trainingStyle = "Pick a training style from the list.";
  }
  if (body.minutesPerSession !== undefined && !intBetween(body.minutesPerSession, 0, 300)) {
    f.minutesPerSession = "Enter whole minutes per session, from 0 to 300 (5 hours).";
  }
  if (body.sessionsPerWeek !== undefined && !intBetween(body.sessionsPerWeek, 0, 14)) {
    f.sessionsPerWeek = "Enter whole sessions per week, from 0 to 14.";
  }
  if (body.activityOverride !== undefined && body.activityOverride !== null) {
    if (typeof body.activityOverride !== "number" || body.activityOverride < 1 || body.activityOverride > 2.2) {
      f.activityOverride = "Enter a multiplier between 1.0 and 2.2, or leave it blank to use your job's.";
    }
  }
  if (body.rateLbPerWeek !== undefined && !RATE_OPTIONS.includes(body.rateLbPerWeek)) {
    f.rateLbPerWeek = "Pick one of the rate buttons — the app only prescribes the rates it offers.";
  }
  if (body.unitPref !== undefined && !["imperial", "metric"].includes(body.unitPref)) {
    f.unitPref = "Choose either pounds and inches, or kilograms and centimetres.";
  }
  if (body.dietaryStyle !== undefined && body.dietaryStyle !== null && !DIETARY_STYLES.includes(body.dietaryStyle)) {
    f.dietaryStyle = "That dietary style isn't one this app knows — pick one from the list, or none.";
  }
  if (body.excludedFormulas !== undefined) {
    if (!Array.isArray(body.excludedFormulas) || body.excludedFormulas.some((k) => !FORMULA_KEYS.includes(k))) {
      f.excludedFormulas = "One of the formulas you switched off isn't one this app uses. Reload the Engine tab and try again.";
    }
  }
  // Stage-C fix (C5/L2): the vitals every derived number depends on used to
  // accept anything — age −5, height 0, goal 0 all saved and silently
  // corrupted the target.
  //
  // NOTE ON THE AGE BOUND. It stays at 14, NOT 18, on purpose: 14-17 is
  // handled by adultGate() below, which refuses the save with copy that
  // explains why and points somewhere useful. A range error would be the
  // wrong answer to "I am 15" — it reads as a typo notice. The message here
  // quotes 18 because 18 is genuinely the lowest age the app will accept;
  // anything under it is answered by the gate, not by this line.
  const numBetween = (v, [lo, hi]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (body.age !== undefined && !numBetween(body.age, BOUNDS.age)) {
    f.age = "Enter your age in years — this app is built for adults, 18 to 100.";
  }
  if (body.heightCm !== undefined && !numBetween(body.heightCm, BOUNDS.heightCm)) {
    f.heightCm = "Enter a height between 100 and 250 cm (3 ft 3 in to 8 ft 2 in).";
  }
  if (body.bodyFatPct !== undefined && body.bodyFatPct !== null && !numBetween(body.bodyFatPct, BOUNDS.bodyFatPct)) {
    f.bodyFatPct = "Enter a body fat percentage between 0 and 70, or leave it blank if you don't know it.";
  }
  if (body.bodyFatSource !== undefined && body.bodyFatSource !== null && !BODY_FAT_SOURCES.includes(body.bodyFatSource)) {
    f.bodyFatSource = "Body fat has to come from either the silhouette picker or a real measurement.";
  }
  if (body.startWeightKg !== undefined && !numBetween(body.startWeightKg, BOUNDS.weightKg)) {
    f.startWeightKg = "Enter a weight between 30 and 400 kg (66 to 880 lb).";
  }
  if (body.goalWeightKg !== undefined && !numBetween(body.goalWeightKg, BOUNDS.weightKg)) {
    f.goalWeightKg = "Enter a goal weight between 30 and 400 kg (66 to 880 lb).";
  }
  // Stage-C fix (M11/L3): a non-string excludedFoods member (e.g. [5]) was
  // accepted and then 500-bricked every recipe screen. Require clean text.
  if (body.excludedFoods !== undefined) {
    if (!Array.isArray(body.excludedFoods) || body.excludedFoods.length > 40 ||
        body.excludedFoods.some((t) => typeof t !== "string" || !t.trim() || t.length > 60)) {
      f.excludedFoods = "Each allergy or exclusion has to be a short piece of text — up to 40 of them, 60 characters each.";
    }
  }
  return f;
}

/**
 * Developer/log shape: ["age: Enter your age in years…", …]. Kept because the
 * field key belongs in a log line even though it does not belong on a screen.
 */
function validateProfilePatch(body) {
  return Object.entries(validateProfileFields(body)).map(([key, msg]) => `${key}: ${msg}`);
}

// ── SAFETY GATES ──────────────────────────────────────────────────────────
//
// These are not validation. Validation asks "is this a number in range";
// these ask "should this app write a calorie prescription for this person at
// all". They run on the MERGED candidate (existing row + patch), server-side,
// because a UI check is a suggestion and this has to be a rule — the desktop
// build ships an HTTP API on loopback and the wizard is not the only caller.
//
// ── WHAT IS STILL MISSING, AND WHY IT ISN'T HERE ─────────────────────────
// There is no pregnancy, breastfeeding, or eating-disorder-history question
// anywhere in the app, and none can be added from this file: the `Profile`
// model lives in backend/prisma/schema.prisma, which belongs to another
// workstream. What that schema needs, in the shape the rest of the row uses:
//
//   lifeStage        String?   // null | "pregnant" | "breastfeeding"
//                              // both RAISE energy needs; a deficit is
//                              // contraindicated. Gate: refuse to prescribe
//                              // a deficit, offer maintenance only.
//   edHistoryAck     Boolean?  // asked once, never nagged, never displayed
//                              // back. Present → suppress goal-weight
//                              // projections and the aggressive rates, and
//                              // surface the resource list instead.
//   healthFlagsAt    DateTime? // when the above were last confirmed, so a
//                              // year-old "not pregnant" is not treated as
//                              // current fact.
//
// Until those exist the app cannot know, and the honest position is that it
// does not ask rather than that it has cleared anyone.
const ADULT_MIN_AGE = 18;

// Goal-weight floor, expressed as BMI of the GOAL (never of the current
// weight — a person's real weight is a fact and is never refused; only the
// target the app would then prescribe a deficit toward is gated).
//
// BMI is a population statistic from 1832, not a diagnosis. It cannot see a
// frame, a sport, or a kilogram of muscle, and it systematically penalises
// short people. So it is used here the only way it is defensible: as a coarse
// tripwire with two very different consequences.
//   ≥ 18.5          nothing happens.
//   16.0 … 18.5     GREY ZONE. Warn, explain, require an explicit tick. A
//                   lean, muscular, or simply small user can legitimately
//                   live here and the app has no standing to overrule them.
//   < 16.0          REFUSED, no override. WHO calls this severe thinness;
//                   it is where the risks stop being arguable, and it is not
//                   a place an app that knows a height and a weight should be
//                   steering anyone.
const GOAL_BMI_ACK = 18.5;
const GOAL_BMI_REFUSE = 16.0;

const bmiOf = (weightKg, heightCm) => {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
};
const kgAtBmi = (bmi, heightCm) => bmi * ((heightCm / 100) ** 2);
const r1 = (n) => Math.round(n * 10) / 10;
const lbOf = (kg) => Math.round(kg * 2.20462);

/**
 * Refuse to prescribe to a minor. Returns a response body, or null to proceed.
 *
 * Every BMR formula this app runs (Mifflin-St Jeor, Harris-Benedict,
 * Katch-McArdle, Cunningham) was fitted on adults. Applied to an adolescent
 * they read LOW, because a growing body spends energy on growing that no
 * adult equation accounts for. Run for real: a 14-year-old girl, 50 kg /
 * 160 cm, at the 2.0 lb/wk the rate menu offers, comes out at 1,212 kcal/day
 * with a 90-99 g protein floor. A 14-year-old boy at 60 kg comes out at
 * ~1,500. Published adolescent EER is roughly 1,800-2,200. The engine cannot
 * tell the difference and has no growth input to tell it with, so it must not
 * answer at all. A line in a modal saying "consult a professional if you are
 * under 18" is not a gate; this is.
 */
function adultGate(candidate) {
  const age = candidate?.age;
  if (typeof age !== "number" || !Number.isFinite(age) || age >= ADULT_MIN_AGE) return null;
  return {
    gate: "adult-only",
    error: `Cut Protocol can't build an eating plan for someone under ${ADULT_MIN_AGE}.`,
    detail: [
      "Every calorie formula in this app was worked out from adults. A body that is still growing spends energy on growing, and none of these equations know that — so they come out low for a teenager, sometimes by 600-900 kcal a day.",
      "That is not a rounding error. It is the difference between a plan and a deficit on top of a deficit, during the years bone density and height are being laid down.",
      "If you want help with food or training, someone who can actually see you — a doctor, or a dietitian who works with teenagers — is the right first step. They can do what this app can't, which is take growth into account.",
    ],
    whatNow: `If you're ${ADULT_MIN_AGE} or over and mistyped your age, correct it and carry on.`,
  };
}

/**
 * Goal-weight floor. Returns null (fine), or { refuse } / { needsAck } with
 * the copy to show. Only evaluated when the request actually touches the goal
 * or the height it is measured against — this never blocks an unrelated edit.
 *
 * A height edit that drops an ALREADY-SAVED goal under the hard floor is
 * downgraded to the acknowledgement path rather than refused: a height is a
 * fact being corrected, and refusing the correction would trap the user with
 * the wrong height AND the unsafe goal. The message names the goal as the
 * thing that has to move.
 */
function goalWeightGate(candidate, body) {
  const touchesGoal = body.goalWeightKg !== undefined;
  const touchesHeight = body.heightCm !== undefined;
  if (!touchesGoal && !touchesHeight) return null;

  const heightCm = candidate?.heightCm;
  const goalKg = candidate?.goalWeightKg;
  const bmi = bmiOf(goalKg, heightCm);
  if (bmi == null || bmi >= GOAL_BMI_ACK) return null;

  const shown = r1(bmi);
  const goal = `${r1(goalKg)} kg (${lbOf(goalKg)} lb)`;
  const height = `${r1(heightCm)} cm`;
  const floorKg = r1(kgAtBmi(GOAL_BMI_REFUSE, heightCm));
  const ackKg = r1(kgAtBmi(GOAL_BMI_ACK, heightCm));

  if (bmi < GOAL_BMI_REFUSE && touchesGoal) {
    return {
      refuse: true,
      body: {
        gate: "goal-weight-floor",
        error: `A goal of ${goal} at ${height} works out to a BMI of ${shown}. This app won't prescribe a deficit down to it.`,
        fields: { goalWeightKg: `Too low to plan for at your height — ${floorKg} kg (${lbOf(floorKg)} lb) is the lowest goal this app will take.` },
        detail: [
          `BMI is a crude population statistic and it gets individuals wrong all the time — but ${GOAL_BMI_REFUSE} is far enough below the range that the risks (heart rhythm, bone density, immune function, fertility) stop being arguable.`,
          `At ${height}, the lowest goal this app will accept is ${floorKg} kg (${lbOf(floorKg)} lb). ${ackKg} kg (${lbOf(ackKg)} lb) is where the usual population range starts.`,
          "This limits what the app will PRESCRIBE. It is not a judgment about you, and it changes nothing about tracking: your real weight is your real weight, and a weigh-in is never refused or hidden.",
          "If a goal this low is something you have been set by a coach or a clinician, they should be the one steering it, with eyes on you.",
        ],
      },
    };
  }

  // Grey zone (and the height-correction downgrade): explain, then let them
  // decide. The tick is per-request and is never stored — this app has no
  // column to remember it in, and inventing a persisted "they agreed once"
  // flag would be worse than asking again.
  const belowFloor = bmi < GOAL_BMI_REFUSE;
  return {
    needsAck: true,
    body: {
      requiresAck: true,
      ack: "goalWeight",
      gate: "goal-weight-low",
      error: `That goal is ${shown} BMI — below the usual range. Confirm you want it.`,
      reasons: [
        belowFloor
          ? `With this height, your saved goal of ${goal} is a BMI of ${shown}. That is below ${GOAL_BMI_REFUSE}, low enough that the app won't plan a route down to it — raise the goal on the Profile tab. Saving the height itself is fine; it's a fact, and correcting it is the right call.`
          : `${goal} at ${height} is a BMI of ${shown}. The population range usually quoted starts at ${GOAL_BMI_ACK} — about ${ackKg} kg (${lbOf(ackKg)} lb) for you.`,
        "BMI knows nothing about your frame or how much muscle you carry, and it penalises short people by design. Lean, strong, small-framed people sit under 18.5 and are fine. It is a prompt to think, not a verdict, and this app is in no position to overrule you about your own body.",
        "The things worth watching are the ones a scale can't show: strength going backwards, sleep breaking up, feeling cold, mood flattening, periods changing or stopping. If any of those are already happening, the goal is too low whatever the number says — and that is true above 18.5 too.",
      ],
    },
  };
}

router.get("/", async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  res.json(profile);
});

// Static vocabulary the Profile UI and wizard render from — served rather
// than mirrored client-side so the option lists can never drift.
router.get("/meta", (req, res) => {
  const { OCCUPATIONS, TRAINING_STYLES } = require("../lib/activityData.js");
  res.json({
    occupations: OCCUPATIONS,
    trainingStyles: TRAINING_STYLES,
    rateOptions: RATE_OPTIONS,
    dietaryStyles: DIETARY_STYLES,
    safeFloor: SAFE_FLOOR,
    // Bounds and safety thresholds, served for the same reason as everything
    // else on this endpoint: the wizard needs to stop a 15-year-old on step 1
    // rather than at the end, and it must not carry its own copy of the numbers
    // that decide it — the hardcoded `+d.age >= 14` in SetupWizard is exactly
    // how the wizard and this file drifted apart. The server is still the
    // authority; these only let the UI ask the question early and word its own
    // messages in the user's units.
    limits: {
      adultMinAge: ADULT_MIN_AGE,
      age: { min: ADULT_MIN_AGE, max: BOUNDS.age[1] },
      heightCm: { min: BOUNDS.heightCm[0], max: BOUNDS.heightCm[1] },
      weightKg: { min: BOUNDS.weightKg[0], max: BOUNDS.weightKg[1] },
      goalBmi: { needsAckBelow: GOAL_BMI_ACK, refusedBelow: GOAL_BMI_REFUSE },
    },
    // Cited basis for protein-priority / recomposition mode's floor — served
    // rather than duplicated in the frontend, same pattern as everything else
    // on this endpoint (the option lists can never drift from the source).
    proteinFloorSource: PROTEIN_FLOOR_SOURCE,
    allergyOptions: [
      { key: "shellfish", label: "Shellfish" },
      { key: "fish", label: "Fish" },
      { key: "kiwi", label: "Kiwi" },
      { key: "soy", label: "Soy" },
      { key: "dairy", label: "Dairy" },
      { key: "eggs", label: "Eggs" },
      { key: "gluten", label: "Gluten" },
      { key: "peanuts", label: "Peanuts" },
      { key: "tree nuts", label: "Tree nuts" },
      { key: "sesame", label: "Sesame" },
    ],
  });
});

router.put("/", async (req, res) => {
  const body = req.body || {};
  const fields = validateProfileFields(body);
  if (Object.keys(fields).length) {
    // `error` stays a single sentence for anything that only reads that key;
    // `fields` is what the UI renders, one message under one input.
    return res.status(400).json({
      error: Object.keys(fields).length === 1
        ? Object.values(fields)[0]
        : "A few of these can't be saved — see the note under each one.",
      fields,
    });
  }

  const patch = {};
  for (const key of PROFILE_FIELDS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }

  const existing = await prisma.profile.findUnique({ where: { userId: req.userId } });
  const candidate = { ...(existing || defaultProfile()), ...patch };

  // GATE 1 — adult only. First, and before anything derives a number from
  // this row: a minor must not get as far as having a TDEE computed for them.
  const minor = adultGate(candidate);
  if (minor) return res.status(403).json(minor);

  // Stricter-only user floor: never allow a floor below the sex-based safe
  // minimum (that would be a way to disable the safety rail).
  const sexFloor = SAFE_FLOOR[candidate.sex] ?? SAFE_FLOOR.M;
  if (candidate.floorKcal != null && candidate.floorKcal < sexFloor) {
    const msg = `Your own floor can be stricter than the app's, never looser — ${sexFloor} kcal is the lowest this app will hold you at.`;
    return res.status(400).json({ error: msg, fields: { floorKcal: msg } });
  }

  // GATE 2 — goal weight against height. Refuses outright below BMI 16;
  // between 16 and 18.5 explains itself and waits for an explicit tick
  // (goalWeightAcknowledged, request-only — deliberately never persisted, see
  // goalWeightGate).
  const goalGate = goalWeightGate(candidate, body);
  if (goalGate?.refuse) return res.status(400).json(goalGate.body);
  if (goalGate?.needsAck && body.goalWeightAcknowledged !== true) {
    return res.status(422).json(goalGate.body);
  }

  // Unsafe-rate contract: >1% of body weight per week (or floor-clamped
  // target) requires an explicit rateAcknowledged: true IN THIS REQUEST
  // whenever the rate/floor inputs change. 422 tells the UI to show the
  // "I understand" confirmation and resend. `ack` names WHICH confirmation is
  // being asked for, so a client can't answer the goal-weight gate with a
  // rate acknowledgement (they are different questions and both are 422).
  const touchesRate = body.rateLbPerWeek !== undefined || body.floorKcal !== undefined;
  if (touchesRate) {
    const weightKg = await getWeightNowKg(req.userId, candidate);
    const energy = computeEnergy(candidate, weightKg);
    const safety = rateSafety(candidate, weightKg, energy.tdee, energy.rmr);
    if (safety.unsafe && body.rateAcknowledged !== true) {
      return res.status(422).json({ requiresAck: true, ack: "rate", reasons: safety.reasons, error: "this rate needs an explicit confirmation" });
    }
    patch.rateAcknowledged = safety.unsafe ? true : false;
  }

  const profile = await prisma.profile.upsert({
    where: { userId: req.userId },
    update: patch,
    create: { userId: req.userId, ...defaultProfile(), ...patch },
  });
  // Materialize the derived target (rate/stats/activity may have changed it).
  await recomputeTarget(req.userId);
  const fresh = await prisma.profile.findUnique({ where: { userId: req.userId } });
  res.json(fresh || profile);
});

function defaultProfile() {
  return {
    sex: "M", age: 30, heightCm: 178, bodyFatPct: 0, bodyFatSource: null,
    occupationKey: "desk-office", activityOverride: null,
    sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
    startWeightKg: 90, goalWeightKg: 85,
    // todayStr(), never an inline toISOString().slice(0, 10). That inline form
    // is the date in UTC, so finishing setup after 18:00 local in Edmonton
    // stamped startDate as TOMORROW — permanently offsetting "Day N of
    // protocol" for the life of the account. It was the last of four copies of
    // this expression; the shared helper in lib/dates.js computes the LOCAL
    // calendar day, which is the one on the user's wall. Do not re-inline it —
    // re-implementation is exactly how the bug reached four places.
    startDate: todayStr(),
    unitPref: "imperial",
    rateLbPerWeek: 1.0, rateAcknowledged: false, floorKcal: null,
    excludedFormulas: [],
    targetKcal: 2150, // placeholder until recomputeTarget() runs right after create
    mealsPerDay: 3, snacksPerDay: 1,
    excludedFoods: [], dietaryStyle: null,
    cuisinePreferences: [], mealPreferencesNote: null,
  };
}

module.exports = router;
// Exposed for unit testing (the router itself is a function, so attaching a
// property leaves `app.use("/api/profile", router)` working unchanged).
module.exports.validateProfilePatch = validateProfilePatch;
module.exports.validateProfileFields = validateProfileFields;
module.exports.adultGate = adultGate;
module.exports.goalWeightGate = goalWeightGate;
module.exports.SAFETY_GATES = { ADULT_MIN_AGE, GOAL_BMI_ACK, GOAL_BMI_REFUSE };
