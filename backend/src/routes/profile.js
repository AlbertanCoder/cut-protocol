const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { computeEnergy, rateSafety, RATE_OPTIONS, SAFE_FLOOR, FORMULA_KEYS } = require("../lib/bmrEngine.js");
const { recomputeTarget } = require("../lib/profileTarget.js");
const { OCCUPATION_BY_KEY, TRAINING_BY_KEY } = require("../lib/activityData.js");
const { DIETARY_STYLES } = require("../lib/dietaryFilter.js");

const router = express.Router();
router.use(requireAuth);

// targetKcal is deliberately absent: it's derived (rate → deficit → floor
// clamp) and materialized by recomputeTarget(), never set by the client.
const PROFILE_FIELDS = [
  "sex", "age", "heightCm", "bodyFatPct",
  "occupationKey", "activityOverride", "sessionsPerWeek", "trainingStyle", "minutesPerSession",
  "startWeightKg", "goalWeightKg", "startDate", "unitPref",
  "rateLbPerWeek", "rateAcknowledged", "floorKcal", "excludedFormulas",
  "mealsPerDay", "snacksPerDay", "excludedFoods", "dietaryStyle",
  "cuisinePreferences", "mealPreferencesNote",
];

function validateProfilePatch(body) {
  const errors = [];
  const intBetween = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  if (body.mealsPerDay !== undefined && !intBetween(body.mealsPerDay, 1, 8)) {
    errors.push("mealsPerDay must be a whole number between 1 and 8");
  }
  if (body.snacksPerDay !== undefined && !intBetween(body.snacksPerDay, 0, 8)) {
    errors.push("snacksPerDay must be a whole number between 0 and 8");
  }
  if (body.sex !== undefined && !["M", "F"].includes(body.sex)) {
    errors.push("sex must be 'M' or 'F'");
  }
  if (body.occupationKey !== undefined && !OCCUPATION_BY_KEY[body.occupationKey]) {
    errors.push("unknown occupationKey");
  }
  if (body.trainingStyle !== undefined && !TRAINING_BY_KEY[body.trainingStyle]) {
    errors.push("trainingStyle must be weights|mixed|sport|cardio");
  }
  if (body.minutesPerSession !== undefined && !intBetween(body.minutesPerSession, 0, 300)) {
    errors.push("minutesPerSession must be 0-300");
  }
  if (body.sessionsPerWeek !== undefined && !intBetween(body.sessionsPerWeek, 0, 14)) {
    errors.push("sessionsPerWeek must be 0-14");
  }
  if (body.activityOverride !== undefined && body.activityOverride !== null) {
    if (typeof body.activityOverride !== "number" || body.activityOverride < 1 || body.activityOverride > 2.2) {
      errors.push("activityOverride must be between 1.0 and 2.2 (or null to use the occupation)");
    }
  }
  if (body.rateLbPerWeek !== undefined && !RATE_OPTIONS.includes(body.rateLbPerWeek)) {
    errors.push(`rateLbPerWeek must be one of ${RATE_OPTIONS.join(", ")}`);
  }
  if (body.unitPref !== undefined && !["imperial", "metric"].includes(body.unitPref)) {
    errors.push("unitPref must be imperial|metric");
  }
  if (body.dietaryStyle !== undefined && body.dietaryStyle !== null && !DIETARY_STYLES.includes(body.dietaryStyle)) {
    errors.push(`dietaryStyle must be null or one of ${DIETARY_STYLES.join("|")}`);
  }
  if (body.excludedFormulas !== undefined) {
    if (!Array.isArray(body.excludedFormulas) || body.excludedFormulas.some((k) => !FORMULA_KEYS.includes(k))) {
      errors.push(`excludedFormulas must be an array of ${FORMULA_KEYS.join("|")}`);
    }
  }
  // Stage-C fix (C5/L2): the vitals every derived number depends on used to
  // accept anything — age −5, height 0, goal 0 all saved and silently
  // corrupted the target. Bound them (age matches the wizard's own 14-100).
  const numBetween = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (body.age !== undefined && !numBetween(body.age, 14, 100)) {
    errors.push("age must be a number between 14 and 100");
  }
  if (body.heightCm !== undefined && !numBetween(body.heightCm, 100, 250)) {
    errors.push("heightCm must be a number between 100 and 250");
  }
  if (body.bodyFatPct !== undefined && body.bodyFatPct !== null && !numBetween(body.bodyFatPct, 0, 70)) {
    errors.push("bodyFatPct must be a number between 0 and 70 (0 = unknown)");
  }
  if (body.startWeightKg !== undefined && !numBetween(body.startWeightKg, 30, 400)) {
    errors.push("startWeightKg must be a number between 30 and 400 kg");
  }
  if (body.goalWeightKg !== undefined && !numBetween(body.goalWeightKg, 30, 400)) {
    errors.push("goalWeightKg must be a number between 30 and 400 kg");
  }
  // Stage-C fix (M11/L3): a non-string excludedFoods member (e.g. [5]) was
  // accepted and then 500-bricked every recipe screen. Require clean text.
  if (body.excludedFoods !== undefined) {
    if (!Array.isArray(body.excludedFoods) || body.excludedFoods.length > 40 ||
        body.excludedFoods.some((t) => typeof t !== "string" || !t.trim() || t.length > 60)) {
      errors.push("excludedFoods must be an array of non-empty text terms (max 40, each ≤ 60 chars)");
    }
  }
  return errors;
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
  const errors = validateProfilePatch(body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const patch = {};
  for (const key of PROFILE_FIELDS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }

  const existing = await prisma.profile.findUnique({ where: { userId: req.userId } });
  const candidate = { ...(existing || defaultProfile()), ...patch };

  // Stricter-only user floor: never allow a floor below the sex-based safe
  // minimum (that would be a way to disable the safety rail).
  const sexFloor = SAFE_FLOOR[candidate.sex] ?? SAFE_FLOOR.M;
  if (candidate.floorKcal != null && candidate.floorKcal < sexFloor) {
    return res.status(400).json({ error: `floorKcal cannot be below the ${sexFloor} kcal safe minimum for this profile` });
  }

  // Unsafe-rate contract: >1% of body weight per week (or floor-clamped
  // target) requires an explicit rateAcknowledged: true IN THIS REQUEST
  // whenever the rate/floor inputs change. 422 tells the UI to show the
  // "I understand" confirmation and resend.
  const touchesRate = body.rateLbPerWeek !== undefined || body.floorKcal !== undefined;
  if (touchesRate) {
    const weightKg = await getWeightNowKg(req.userId, candidate);
    const energy = computeEnergy(candidate, weightKg);
    const safety = rateSafety(candidate, weightKg, energy.tdee, energy.rmr);
    if (safety.unsafe && body.rateAcknowledged !== true) {
      return res.status(422).json({ requiresAck: true, reasons: safety.reasons, error: "this rate needs an explicit confirmation" });
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
    sex: "M", age: 30, heightCm: 178, bodyFatPct: 0,
    occupationKey: "desk-office", activityOverride: null,
    sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
    startWeightKg: 90, goalWeightKg: 85,
    startDate: new Date().toISOString().slice(0, 10),
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
