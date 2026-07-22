const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { mondayOf, dayNum } = require("../lib/dates.js");
const { recomputeTarget } = require("../lib/profileTarget.js");

const router = express.Router();
router.use(requireAuth);

// Logged intake is one of the two series the adaptive expenditure estimator
// reconciles (see lib/expenditureEstimator.js), so a diary write can move the
// derived target exactly as a weigh-in can. Best-effort: a target recompute
// must never fail a diary write — the next weigh-in or profile save re-derives.
async function refreshTargetQuietly(userId) {
  try { await recomputeTarget(userId); } catch { /* derived state; recomputed on next write */ }
}

// Sane bounds for a single logged food entry — big enough for a genuine large
// meal, small enough to reject fat-fingered / junk payloads (a single entry
// over 10,000 kcal or 2,000 g of one macro is not real food). Mirrors the
// bounds-then-type validation style the other routes use (weighins' 35-300 kg,
// plans' portion clamps) rather than an Atwater gate: the diary logs the user's
// ACTUAL intake (labels legitimately deviate from 4/4/9), so the constitution's
// food/recipe sanity gate — which guards LIBRARY data — is deliberately not
// imposed on hand-logged actuals.
const KCAL_MAX = 10000;
const MACRO_MAX = 2000;
const NAME_MAX = 200;

const isDateStr = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00"));

// Shared response contract for every write + the GET: the day's entries plus
// its running totals. Per-entry kcal is stored as an Int; the macros are Floats
// rounded here only for display (never for storage).
function toDiaryShape(logs) {
  const entries = logs.map((l) => ({
    id: l.id,
    name: l.name,
    kcal: l.kcal,
    proteinG: l.proteinG,
    carbG: l.carbG,
    fatG: l.fatG,
    slotType: l.slotType,
    source: l.source,
  }));
  const sum = entries.reduce(
    (t, e) => ({ kcal: t.kcal + e.kcal, protein: t.protein + e.proteinG, carb: t.carb + e.carbG, fat: t.fat + e.fatG }),
    { kcal: 0, protein: 0, carb: 0, fat: 0 }
  );
  const r1 = (n) => Math.round(n * 10) / 10;
  return { entries, totals: { kcal: Math.round(sum.kcal), protein: r1(sum.protein), carb: r1(sum.carb), fat: r1(sum.fat) } };
}

async function diaryForDate(userId, date) {
  const logs = await prisma.mealLog.findMany({ where: { userId, date }, orderBy: { createdAt: "asc" } });
  return toDiaryShape(logs);
}

// GET /api/diary/:date -> { entries:[...], totals:{kcal,protein,carb,fat} }
router.get("/:date", async (req, res) => {
  const { date } = req.params;
  if (!isDateStr(date)) return res.status(400).json({ error: "date must be yyyy-mm-dd" });
  res.json(await diaryForDate(req.userId, date));
});

// POST /api/diary/log-planned { date } -> copies that date's solved PlanSlot
// rows into the diary as source:"planned". Idempotent: re-logging replaces the
// prior "planned" rows for that date (so a double-click can't duplicate them)
// while leaving any "manual" entries untouched. Returns the diary shape.
router.post("/log-planned", async (req, res) => {
  try {
    const date = req.body?.date;
    if (!isDateStr(date)) return res.status(400).json({ error: "date must be yyyy-mm-dd" });

    const monday = mondayOf(date);
    const dayOfWeek = dayNum(date) - dayNum(monday); // 0 = Monday .. 6 = Sunday
    const plan = await prisma.plan.findUnique({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      include: { slots: { include: { recipe: true } } },
    });

    // Only real, solved meals become diary rows. A slot with recipeId still set
    // has its recipe (PlanSlot.recipe is SetNull on delete, so recipeId != null
    // guarantees the recipe row exists), carrying the display name; unsolved
    // slots (recipeId null, kcal 0) are skipped, never logged as empty food.
    const rows = (plan?.slots || [])
      .filter((s) => s.dayOfWeek === dayOfWeek && s.recipeId && s.recipe)
      .map((s) => ({
        userId: req.userId,
        date,
        source: "planned",
        recipeId: s.recipeId,
        name: s.recipe.name,
        kcal: Math.round(s.kcal || 0),
        proteinG: s.protein || 0,
        carbG: s.carb || 0,
        fatG: s.fat || 0,
        slotType: s.slotType || null,
      }));

    await prisma.$transaction([
      prisma.mealLog.deleteMany({ where: { userId: req.userId, date, source: "planned" } }),
      ...(rows.length ? [prisma.mealLog.createMany({ data: rows })] : []),
    ]);

    await refreshTargetQuietly(req.userId);
    res.json(await diaryForDate(req.userId, date));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/diary/entry { date,name,kcal,proteinG,carbG,fatG,slotType?,recipeId? }
// Validated hand-logged entry. Rejects junk (bad types / out-of-bounds) with
// 400 before touching the DB. Returns the day's diary shape.
router.post("/entry", async (req, res) => {
  try {
    const b = req.body || {};
    if (!isDateStr(b.date)) return res.status(400).json({ error: "date must be yyyy-mm-dd" });

    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > NAME_MAX) return res.status(400).json({ error: `name is required (1-${NAME_MAX} chars)` });

    const num = (v) => (typeof v === "number" ? v : NaN);
    const kcal = num(b.kcal), proteinG = num(b.proteinG), carbG = num(b.carbG), fatG = num(b.fatG);
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > KCAL_MAX) return res.status(400).json({ error: `kcal must be a number 0-${KCAL_MAX}` });
    for (const [k, v] of [["proteinG", proteinG], ["carbG", carbG], ["fatG", fatG]]) {
      if (!Number.isFinite(v) || v < 0 || v > MACRO_MAX) return res.status(400).json({ error: `${k} must be a number 0-${MACRO_MAX}` });
    }

    // Optional, lenient: slotType is a free label, recipeId a provenance tag.
    // Present-but-wrong-type is junk (400); absent/null is fine.
    if (b.slotType != null && (typeof b.slotType !== "string" || b.slotType.length > 40)) {
      return res.status(400).json({ error: "slotType must be a short string or null" });
    }
    if (b.recipeId != null && typeof b.recipeId !== "string") {
      return res.status(400).json({ error: "recipeId must be a string or null" });
    }

    await prisma.mealLog.create({
      data: {
        userId: req.userId,
        date: b.date,
        source: "manual",
        recipeId: b.recipeId ?? null,
        name,
        kcal: Math.round(kcal),
        proteinG, carbG, fatG,
        slotType: b.slotType ?? null,
      },
    });

    await refreshTargetQuietly(req.userId);
    res.status(201).json(await diaryForDate(req.userId, b.date));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /api/diary/entry/:id -> ownership-checked delete. 404 when the entry
// doesn't exist OR belongs to another user (never reveal the difference).
router.delete("/entry/:id", async (req, res) => {
  const existing = await prisma.mealLog.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!existing) return res.status(404).json({ error: "diary entry not found" });
  await prisma.mealLog.delete({ where: { id: existing.id } });
  await refreshTargetQuietly(req.userId);
  res.status(204).end();
});

module.exports = router;
// Exposed for unit testing the pure shaping/validation helpers without Prisma.
module.exports.toDiaryShape = toDiaryShape;
module.exports.isDateStr = isDateStr;
