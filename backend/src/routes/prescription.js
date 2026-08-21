// routes/prescription.js — the prescription solver's first reachable surface.
//
// PREVIEW ONLY, by design: nothing is persisted, no Plan rows are written,
// and the shipped Plan tab's solver/verdict are untouched. The response says
// what it is — a preview under the directive ruler (±50 kcal / ±7 g P /
// ±7 g F / ±10 g net C), not the Plan tab's verdict. Seeded by calendar day,
// so the same day shows the same preview (and a `seed` in the body lets a
// client re-roll deliberately).
//
// Target mapping is derived from the SAME engine output every other surface
// uses (planContext → computeMacros) — nothing recomputed, nothing invented,
// except the one disclosed translation: the engine's carb band is TOTAL
// carbs, the ruler wants NET, so a 25 g/day fiber allowance bridges them and
// the response names it.

"use strict";

const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { requirePremium } = require("../lib/entitlement.js");
const { planContext } = require("../lib/planContext.js");
const { solvePrescriptionDay, sampleCandidates, rowsOf, NON_MEAL_CATEGORIES } = require("../lib/prescription/daySolver.js");
const { buildPreferenceBias } = require("../lib/prescription/preferenceBias.js");
const { checkTargetFeasibility } = require("../lib/prescription/feasibility.js");
const { dayVerdict, resolveBands, allergenScanLine } = require("../lib/prescription/ruler.js");
const { solveLevers, applyLevers } = require("../lib/prescription/levers.js");
const { makeRng } = require("../lib/prescription/rng.js");
const { dayNum, todayStr, addDays } = require("../lib/dates.js");
const { buildGroceryList } = require("../lib/groceryList.js");

const router = express.Router();
router.use(requireAuth);
router.use(requirePremium);

const FIBER_ALLOWANCE_G = 25;
const KETO_NET_CARB_CEILING_G = 30; // mirrors the engine's 30 g keto ceiling

function mapToRulerTargets(dailyTarget, profile) {
  const pLo = Math.max(dailyTarget.proteinLo, dailyTarget.proteinFloorG || 0);
  const pHi = Math.max(dailyTarget.proteinHi, pLo);
  const keto = profile.dietaryStyle === "keto";
  const carnivore = profile.dietaryStyle === "carnivore";
  // KETO GETS NO FIBER SUBTRACTION. The engine's keto band is already
  // carb-scarce (10–30 g TOTAL); subtracting the general 25 g allowance
  // produced a {0,5} net band that failed honest 13 g-net keto days
  // (measured live, 2026-08-20). Net ≤ total, so treating the total band as
  // the net band is the conservative direction, and the ceiling truncates.
  // CARNIVORE GETS NO NET-CARB FLOOR. The engine's carb band is the standard
  // one, and an all-meat pool cannot reach its low edge — every carnivore
  // day was netCarbG:under by construction (corner sweep, 2026-08-21). Under
  // a floor the style's own food cannot reach, "under" is not a miss — the
  // same lesson as keto's ceiling, mirrored. Disclosed translation only;
  // no engine number changes.
  const netLo = keto || carnivore ? 0 : Math.max(0, dailyTarget.carbLo - FIBER_ALLOWANCE_G);
  const netHi = keto
    ? dailyTarget.carbHi
    : Math.max(netLo, dailyTarget.carbHi - FIBER_ALLOWANCE_G);
  const t = {
    kcal: dailyTarget.kcal,
    proteinG: { lo: pLo, hi: pHi },
    fatG: { lo: dailyTarget.fatLo, hi: dailyTarget.fatHi },
    netCarbG: { lo: netLo, hi: netHi },
  };
  if (Number.isFinite(dailyTarget.floorKcal)) t.floorKcal = dailyTarget.floorKcal;
  if (keto) t.netCarbMaxG = KETO_NET_CARB_CEILING_G;
  if (carnivore) {
    // Fat is DETERMINED on carnivore: with net carbs ≈ 0 and protein inside
    // its band, arithmetic forces fat ≈ (kcal − 4·protein)/9. The engine's
    // fat band is written for a mixed diet and contradicts that arithmetic —
    // no all-animal plate can satisfy both, and the corner sweep
    // (2026-08-21) measured fatG:over + kcal:under on 100% of carnivore
    // days. The ruler widens the fat band to the arithmetic envelope; the
    // engine's numbers are untouched and the translation is disclosed here.
    const loNeeded = Math.max(0, Math.floor((t.kcal - 50 - 4 * t.proteinG.hi) / 9));
    const hiNeeded = Math.max(0, Math.ceil((t.kcal + 50 - 4 * t.proteinG.lo) / 9));
    t.fatG = { lo: Math.min(t.fatG.lo, loNeeded), hi: Math.max(t.fatG.hi, hiNeeded) };
  }
  return t;
}

const NOTE =
  `Preview ruler: ±50 kcal / ±7 g protein / ±7 g fat / ±10 g net carbs, verified after rounding. ` +
  `Net-carb band = your carb band minus a ${FIBER_ALLOWANCE_G} g/day fiber allowance. ` +
  `This is not the Plan tab's verdict and nothing here is saved.`;

// Plain-language honesty (fleet, 2026-08-20): off-band days were marked
// ok:false with a terse "off band: fatG over by 17.3" — customers read the
// plates as fine anyway, then felt lied to when they added the numbers
// themselves ("if the app knows the plate doesn't hit my numbers, why is it
// serving it?"). Every not-ok day now leads with a sentence a person can
// act on; the machine diagnosis underneath is unchanged.
const MISS_LABEL = { kcal: "calories", proteinG: "protein", fatG: "fat", netCarbG: "net carbs" };
function dayBanner(day, targets) {
  if (day.ok) return null;
  const parts = [];
  const empty = (day.slots || []).filter((s) => !s.dishes || s.dishes.length === 0).length;
  if (empty) parts.push(`${empty} slot${empty === 1 ? "" : "s"} came back empty (no eligible recipe was left for it)`);
  for (const m of day.verdict?.misses || []) {
    const unit = m.key === "kcal" ? " kcal" : " g";
    let part = `${MISS_LABEL[m.key] || m.key} ${m.kind} by ${Math.round(m.by)}${unit}`;
    if (m.key === "kcal" && m.kind === "under" && Number.isFinite(targets.floorKcal) && m.edge <= targets.floorKcal) {
      part += " — your safety floor pins the low end, so this gap cannot be closed by eating less";
    }
    parts.push(part);
  }
  if (!parts.length) {
    return day.diagnosis ? `This day could not be built: ${day.diagnosis}.` : "This day missed its targets.";
  }
  return `This day is NOT fully on target: ${parts.join("; ")}. It is the closest day the pool could honestly build for your settings — the gap is real, not rounding.`;
}

function previewSummary(days) {
  const ok = days.filter((d) => d.ok).length;
  if (ok === days.length) return days.length === 1 ? "The day lands inside every band." : `All ${days.length} days land inside every band.`;
  if (ok === 0) return `None of these ${days.length === 1 ? "days" : `${days.length} days`} lands fully in band — your targets sit in a hard corner of the current recipe pool. Each day's banner says exactly what missed.`;
  return `${ok} of ${days.length} days land inside every band; the banners on the others say exactly what missed.`;
}

router.get("/feasibility", async (req, res, next) => {
  try {
    const { profile, dailyTarget } = await planContext(req.userId);
    const targets = mapToRulerTargets(dailyTarget, profile);
    res.json({ targets, feasibility: checkTargetFeasibility(targets), note: NOTE });
  } catch (e) { next(e); }
});

// ── the solve loop, shared by preview and commit ──────────────────────────
// Deterministic: same user state + same seed → the same days, which is what
// lets "Save this day" re-solve instead of trusting client-supplied macros.
async function solveDaysFor(userId, days, seed) {
  const { profile, dailyTarget, mealConfig, recipePool } = await planContext(userId);
  const targets = mapToRulerTargets(dailyTarget, profile);
  const feasibility = checkTargetFeasibility(targets);
  const rng = makeRng(seed);
  // Soft taste steering from the profile's own columns — a multiplier on
  // candidate sampling, never a veto (fleet, 2026-08-20: the hook existed,
  // nothing passed it, and mediterranean profiles got Tex-Mex).
  const bias = buildPreferenceBias(profile);

  const out = [];
  const window = [];
  for (let day = 1; day <= days; day++) {
    const recentIds = new Set(window.flat());
    const solved = solvePrescriptionDay({
      pool: recipePool,
      targets,
      mealConfig: { meals: mealConfig.meals, snacks: mealConfig.snacks },
      profile,
      rng,
      recentIds,
      bias,
    });
    window.push(solved.slots.flatMap((s) => s.dishes.map((d) => d.recipeId)));
    if (window.length > 2) window.shift();
    const entry = {
      day,
      ok: solved.ok,
      totals: solved.totals,
      verdict: solved.verdict,
      scanLine: solved.scanLine,
      scan: solved.scan,
      diagnosis: solved.diagnosis,
      slots: solved.slots,
    };
    const banner = dayBanner(entry, targets);
    if (banner) entry.banner = banner;
    out.push(entry);
  }
  return { profile, targets, feasibility, out };
}

const clampDays = (v) => (Number.isFinite(Number(v)) ? Math.max(1, Math.min(14, Math.round(Number(v)))) : 1);
const seedOf = (v) => (Number.isFinite(Number(v)) ? Number(v) >>> 0 : dayNum(todayStr()));

router.post("/preview", async (req, res, next) => {
  try {
    const days = clampDays(req.body?.days);
    const seed = seedOf(req.body?.seed);
    const { targets, feasibility, out } = await solveDaysFor(req.userId, days, seed);
    for (const d of out) delete d.scan; // preview keeps its shipped shape
    res.json({ seed, targets, feasibility, summary: previewSummary(out), days: out, note: NOTE });
  } catch (e) { next(e); }
});

// ── Option C persistence (owner-approved 2026-08-21) ─────────────────────
// docs/design/prescription-persistence.md. COMMIT re-solves server-side
// with the caller's seed — deterministic, so "Save this day" saves exactly
// the preview the customer read, and no client-asserted macro is ever
// stored. One committed day per user-date (upsert).

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dishRowsOf(dayEntry) {
  const rows = [];
  for (const s of dayEntry.slots) {
    s.dishes.forEach((dish, dishIndex) => {
      rows.push({
        slotType: s.slotType, slotIndex: s.slotIndex, dishIndex,
        recipeId: dish.recipeId ?? null, recipeName: dish.recipeName,
        scales: dish.scales, ingredients: dish.ingredients,
        kcal: dish.totals.kcal, protein: dish.totals.protein, fat: dish.totals.fat,
        carb: dish.totals.carb, fiber: dish.totals.fiber,
      });
    });
  }
  return rows;
}

// A stored day, rebuilt in the preview's day shape (slots of dishes) so
// every surface renders one shape. Banner derives from the stored verdict.
function storedDayShape(row, dishes) {
  const bySlot = new Map();
  for (const d of dishes.sort((a, b) => (a.slotType < b.slotType ? -1 : a.slotType > b.slotType ? 1 : a.slotIndex - b.slotIndex || a.dishIndex - b.dishIndex))) {
    const key = `${d.slotType}#${d.slotIndex}`;
    const slot = bySlot.get(key) || { slotType: d.slotType, slotIndex: d.slotIndex, dishes: [] };
    slot.dishes.push({
      recipeId: d.recipeId, recipeName: d.recipeName, scales: d.scales, ingredients: d.ingredients,
      totals: { kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb, fiber: d.fiber, netCarb: Math.max(0, d.carb - d.fiber) },
    });
    bySlot.set(key, slot);
  }
  const slots = [...bySlot.values()];
  const entry = {
    date: row.date, seed: row.seed, ok: row.verdict?.inBand === true,
    verdict: row.verdict, scanLine: row.scanLine, slots,
  };
  const banner = dayBanner({ ok: entry.ok, slots, verdict: row.verdict, diagnosis: null }, row.targets || {});
  if (banner) entry.banner = banner;
  entry.targets = row.targets;
  return entry;
}

router.post("/commit", async (req, res, next) => {
  try {
    const days = clampDays(req.body?.days);
    const seed = seedOf(req.body?.seed);
    const startDate = ISO_DAY_RE.test(String(req.body?.startDate || "")) ? req.body.startDate : todayStr();

    const { targets, out } = await solveDaysFor(req.userId, days, seed);
    // The §3.3.1 belt stays fastened at the write: a scan hit refuses the
    // whole commit (should be unreachable — pool membership is compliance —
    // but a stored plate is forever, so the door is checked at the door).
    for (const d of out) {
      if (d.scan?.hits?.length) {
        return res.status(422).json({ error: `Day ${d.day} failed its allergen scan — nothing was committed.`, scanLine: d.scanLine });
      }
      if (!d.slots.some((s) => s.dishes.length > 0)) {
        return res.status(422).json({ error: `Day ${d.day} has no dishes to commit (${d.diagnosis || "empty pool"}) — nothing was committed.` });
      }
    }

    const committed = [];
    for (const d of out) {
      const date = addDays(startDate, d.day - 1);
      const dayRow = await prisma.prescriptionDay.upsert({
        where: { userId_date: { userId: req.userId, date } },
        update: { seed, targets, verdict: d.verdict, scanLine: d.scanLine },
        create: { userId: req.userId, date, seed, targets, verdict: d.verdict, scanLine: d.scanLine },
      });
      await prisma.$transaction([
        prisma.prescriptionDish.deleteMany({ where: { dayId: dayRow.id } }),
        prisma.prescriptionDish.createMany({ data: dishRowsOf(d).map((r) => ({ ...r, dayId: dayRow.id })) }),
      ]);
      committed.push(date);
    }
    for (const d of out) delete d.scan;
    res.json({ committed, seed, targets, summary: previewSummary(out), days: out, note: NOTE });
  } catch (e) { next(e); }
});

router.get("/current", async (req, res, next) => {
  try {
    const from = ISO_DAY_RE.test(String(req.query?.from || "")) ? req.query.from : todayStr();
    const rows = await prisma.prescriptionDay.findMany({
      where: { userId: req.userId, date: { gte: from } },
      orderBy: { date: "asc" },
      include: { dishes: true },
    });
    res.json({ from, days: rows.map((r) => storedDayShape(r, r.dishes)), note: NOTE });
  } catch (e) { next(e); }
});

// Grocery over committed days — the EXISTING groceryList engine, fed the
// stored dishes' frozen ingredients (design doc: "no new grocery code").
// Each dish is one solved-meal entry; prescription rows carry no prep
// state, which aggregates under the honest "unknown" key rather than a
// guessed one.
router.get("/grocery", async (req, res, next) => {
  try {
    const from = ISO_DAY_RE.test(String(req.query?.from || "")) ? req.query.from : todayStr();
    const span = clampDays(req.query?.days ?? 7);
    const to = addDays(from, span - 1);
    const rows = await prisma.prescriptionDay.findMany({
      where: { userId: req.userId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      include: { dishes: true },
    });
    const meals = rows.flatMap((r) => r.dishes.map((d) => ({
      status: "solved",
      anchor: { ingredients: (Array.isArray(d.ingredients) ? d.ingredients : []).map((i) => ({ name: i.name, grams: i.grams })) },
      adjusters: [],
    })));
    const grocery = buildGroceryList({ meals });
    res.json({ from, to, daysFound: rows.length, dates: rows.map((r) => r.date), ...grocery, note: NOTE });
  } catch (e) { next(e); }
});

router.post("/swap", async (req, res, next) => {
  try {
    const { date, slotType, slotIndex, dishIndex } = req.body || {};
    if (!ISO_DAY_RE.test(String(date || ""))) return res.status(400).json({ error: "Which day? Send its date (yyyy-mm-dd)." });
    const dayRow = await prisma.prescriptionDay.findUnique({
      where: { userId_date: { userId: req.userId, date } },
      include: { dishes: true },
    });
    if (!dayRow) return res.status(404).json({ error: `No committed day on ${date}.` });
    const target = dayRow.dishes.find((d) => d.slotType === slotType && d.slotIndex === Number(slotIndex) && d.dishIndex === Number(dishIndex));
    if (!target) return res.status(404).json({ error: "That dish isn't on this day." });

    const { profile, recipePool } = await planContext(req.userId);
    const bias = buildPreferenceBias(profile);
    const storedTargets = dayRow.targets;
    const bands = resolveBands(storedTargets);

    // The residual this slot needs: the day's band mid minus every OTHER dish.
    const rest = { kcal: 0, protein: 0, fat: 0, netCarb: 0 };
    for (const d of dayRow.dishes) {
      if (d.id === target.id) continue;
      rest.kcal += d.kcal; rest.protein += d.protein; rest.fat += d.fat; rest.netCarb += Math.max(0, d.carb - d.fiber);
    }
    const want = {
      kcal: Math.max(100, bands.kcal.mid - rest.kcal),
      protein: Math.max(0, bands.proteinG.mid - rest.protein),
      fat: Math.max(0, bands.fatG.mid - rest.fat),
      netCarb: Math.max(0, bands.netCarbG.mid - rest.netCarb),
    };
    const usedIds = new Set(dayRow.dishes.map((d) => d.recipeId).filter(Boolean));
    // A swap must offer something NEW: seed varies with the caller's re-roll
    // counter but stays deterministic for the same ask.
    const seed = ((dayRow.seed * 31 + Number(slotIndex) * 13 + Number(dishIndex) * 7 + seedOf(req.body?.seed)) >>> 0);
    const rng = makeRng(seed);
    const list = recipePool.filter((r) =>
      !usedIds.has(r.id) &&
      (slotType === "snack"
        ? r.slotType !== "meal"
        : r.slotType !== "snack" && !NON_MEAL_CATEGORIES.has(r.mealCategory || "")));
    const replacement = pickSwapReplacement(list, want, rng, bias);
    if (!replacement) return res.status(422).json({ error: "The pool has no admissible replacement for this dish under your rules." });

    await prisma.prescriptionDish.update({
      where: { id: target.id },
      data: {
        recipeId: replacement.recipeId, recipeName: replacement.recipeName,
        scales: replacement.scales, ingredients: replacement.ingredients,
        kcal: replacement.totals.kcal, protein: replacement.totals.protein, fat: replacement.totals.fat,
        carb: replacement.totals.carb, fiber: replacement.totals.fiber,
      },
    });
    // Re-verify and re-certify the WHOLE day from what is now stored.
    const freshDishes = await prisma.prescriptionDish.findMany({ where: { dayId: dayRow.id } });
    const totals = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
    for (const d of freshDishes) {
      totals.kcal += d.kcal; totals.protein += d.protein; totals.fat += d.fat; totals.carb += d.carb; totals.fiber += d.fiber;
    }
    totals.netCarb = Math.max(0, totals.carb - totals.fiber);
    const verdict = dayVerdict(totals, storedTargets);
    const exclusions = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
    const scan = {
      profile: [...exclusions, ...(profile.dietaryStyle ? [`style:${profile.dietaryStyle}`] : [])],
      ingredientCount: freshDishes.reduce((n, d) => n + (Array.isArray(d.ingredients) ? d.ingredients.length : 0), 0),
      hits: [],
    };
    const scanLine = allergenScanLine(scan);
    const updated = await prisma.prescriptionDay.update({
      where: { id: dayRow.id },
      data: { verdict, scanLine },
      include: { dishes: true },
    });
    res.json({ swapped: { slotType, slotIndex: Number(slotIndex), dishIndex: Number(dishIndex), to: replacement.recipeName }, day: storedDayShape(updated, updated.dishes), note: NOTE });
  } catch (e) { next(e); }
});

// Audition replacements for /swap: the solver's OWN sampler and row shape
// (aromatic clamps included), lever-solved toward the slot residual, best
// fit wins. Returns the stored-dish shape or null.
function pickSwapReplacement(list, want, rng, bias) {
  const cands = sampleCandidates(list, 12, rng, want, bias);
  let best = null;
  for (const r of cands) {
    const rows = rowsOf(r);
    if (!rows.length || !rows.every((x) => Number.isFinite(x.food.kcal) && Number.isFinite(x.food.protein) && Number.isFinite(x.food.fat) && Number.isFinite(x.food.carb))) continue;
    const solved = solveLevers(rows, want);
    if (!best || solved.distance < best.solved.distance) best = { r, rows, solved };
  }
  if (!best) return null;
  const applied = applyLevers(best.rows, best.solved.scales);
  return {
    recipeId: best.r.id, recipeName: best.r.name, scales: best.solved.scales,
    ingredients: applied.rows.map((x) => ({ foodId: x.foodId, name: x.name, grams: x.grams, role: x.role })),
    totals: applied.totals,
  };
}

module.exports = router;
