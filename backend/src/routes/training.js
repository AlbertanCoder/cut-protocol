// Training routes — Phase 8 scaffold. Cleanly separated from the meal
// engine: imports only the training lib, touches only Training* tables.
const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { generatePlan } = require("../lib/training/generator.js");
const { EQUIPMENT, STYLES, EXPERIENCE } = require("../lib/training/templates.js");

const router = express.Router();
router.use(requireAuth);

const PLAN_INCLUDE = {
  weeks: {
    orderBy: { weekNumber: "asc" },
    include: { sessions: { orderBy: { dayIndex: "asc" }, include: { exercises: { orderBy: { order: "asc" } } } } },
  },
};

// Option lists for the inputs UI — served so the frontend never hardcodes.
router.get("/meta", (_req, res) => {
  res.json({
    equipment: EQUIPMENT,
    styles: STYLES,
    experience: EXPERIENCE,
    daysPerWeek: [2, 3, 4, 5, 6],
    sessionLengthMin: [30, 45, 60, 75, 90],
  });
});

router.get("/", async (req, res) => {
  const plan = await prisma.trainingPlan.findUnique({ where: { userId: req.userId }, include: PLAN_INCLUDE });
  res.json(plan);
});

// v1: one active plan per user — generating replaces the previous one in a
// single transaction (cascade deletes clean the old tree).
router.post("/generate", async (req, res) => {
  const result = generatePlan(req.body || {});
  if (!result.ok) return res.status(422).json({ error: "invalid training inputs", reasons: result.errors });
  const p = result.plan;

  const saved = await prisma.$transaction(async (tx) => {
    await tx.trainingPlan.deleteMany({ where: { userId: req.userId } });
    return tx.trainingPlan.create({
      data: {
        userId: req.userId,
        name: p.name,
        style: p.style,
        experience: p.experience,
        daysPerWeek: p.daysPerWeek,
        sessionLengthMin: p.sessionLengthMin,
        equipment: p.equipment,
        templateKey: p.templateKey,
        generator: p.generator,
        weeks: {
          create: p.weeks.map((w) => ({
            weekNumber: w.weekNumber,
            note: w.note,
            sessions: {
              create: w.sessions.map((s) => ({
                dayIndex: s.dayIndex,
                name: s.name,
                focus: s.focus,
                exercises: { create: s.exercises },
              })),
            },
          })),
        },
      },
      include: PLAN_INCLUDE,
    });
  });

  res.status(201).json({ plan: saved, description: p.description, planNotes: p.planNotes });
});

router.delete("/", async (req, res) => {
  await prisma.trainingPlan.deleteMany({ where: { userId: req.userId } });
  res.status(204).end();
});

module.exports = router;
