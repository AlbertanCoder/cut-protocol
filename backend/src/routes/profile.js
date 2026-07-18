const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");

const router = express.Router();
router.use(requireAuth);

const PROFILE_FIELDS = [
  "sex", "age", "heightCm", "bodyFatPct", "job", "sessionsPerWeek",
  "startWeightKg", "goalWeightKg", "startDate", "unitPref", "targetKcal",
  "mealsPerDay", "snacksPerDay", "excludedFoods", "dietaryStyle",
  "cuisinePreferences", "mealPreferencesNote",
];

// mealsPerDay/snacksPerDay flow straight into weeklyPlanner.js's
// buildSlots(), which always emits `meals` slots before `snacks` slots for
// every day. As long as mealsPerDay >= 1, every day has at least one slot
// and generateWeekPlan()'s byDay.get(day) is always defined - that's the
// one rule that actually prevents the crash AUDIT.md §6 reproduced
// (mealsPerDay:0 -> buildSlots() returns [] -> byDay never populated ->
// "Cannot read properties of undefined (reading 'length')"). Upper bounds
// (8) are a sanity ceiling, not a crash-prevention requirement - flag for
// product review, arbitrary pick (this app's own fixture user eats 3
// feedings/day per CLAUDE.md §7; 8 is a generous multiple of that).
function validateProfilePatch(body) {
  const errors = [];
  if (body.mealsPerDay !== undefined) {
    if (!Number.isInteger(body.mealsPerDay) || body.mealsPerDay < 1 || body.mealsPerDay > 8) {
      errors.push("mealsPerDay must be a whole number between 1 and 8");
    }
  }
  if (body.snacksPerDay !== undefined) {
    if (!Number.isInteger(body.snacksPerDay) || body.snacksPerDay < 0 || body.snacksPerDay > 8) {
      errors.push("snacksPerDay must be a whole number between 0 and 8");
    }
  }
  return errors;
}

router.get("/", async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  res.json(profile);
});

router.put("/", async (req, res) => {
  const errors = validateProfilePatch(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const patch = {};
  for (const key of PROFILE_FIELDS) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  const profile = await prisma.profile.upsert({
    where: { userId: req.userId },
    update: patch,
    create: { userId: req.userId, ...defaultProfile(), ...patch },
  });
  res.json(profile);
});

router.put("/target", async (req, res) => {
  const { targetKcal } = req.body || {};
  if (typeof targetKcal !== "number") return res.status(400).json({ error: "targetKcal must be a number" });
  const clamped = Math.max(2000, Math.round(targetKcal));
  const profile = await prisma.profile.update({ where: { userId: req.userId }, data: { targetKcal: clamped } });
  res.json(profile);
});

function defaultProfile() {
  return {
    sex: "M", age: 30, heightCm: 178, bodyFatPct: 20,
    job: "mixed", sessionsPerWeek: 3,
    startWeightKg: 90, goalWeightKg: 85,
    startDate: new Date().toISOString().slice(0, 10),
    unitPref: "imperial", targetKcal: 2150,
    mealsPerDay: 3, snacksPerDay: 1,
    excludedFoods: [], dietaryStyle: null,
    cuisinePreferences: [], mealPreferencesNote: null,
  };
}

module.exports = router;
