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
const { requireAuth } = require("../lib/auth.js");
const { requirePremium } = require("../lib/entitlement.js");
const { planContext } = require("../lib/planContext.js");
const { solvePrescriptionDay } = require("../lib/prescription/daySolver.js");
const { buildPreferenceBias } = require("../lib/prescription/preferenceBias.js");
const { checkTargetFeasibility } = require("../lib/prescription/feasibility.js");
const { makeRng } = require("../lib/prescription/rng.js");
const { dayNum, todayStr } = require("../lib/dates.js");

const router = express.Router();
router.use(requireAuth);
router.use(requirePremium);

const FIBER_ALLOWANCE_G = 25;
const KETO_NET_CARB_CEILING_G = 30; // mirrors the engine's 30 g keto ceiling

function mapToRulerTargets(dailyTarget, profile) {
  const pLo = Math.max(dailyTarget.proteinLo, dailyTarget.proteinFloorG || 0);
  const pHi = Math.max(dailyTarget.proteinHi, pLo);
  const keto = profile.dietaryStyle === "keto";
  // KETO GETS NO FIBER SUBTRACTION. The engine's keto band is already
  // carb-scarce (10–30 g TOTAL); subtracting the general 25 g allowance
  // produced a {0,5} net band that failed honest 13 g-net keto days
  // (measured live, 2026-08-20). Net ≤ total, so treating the total band as
  // the net band is the conservative direction, and the ceiling truncates.
  const netLo = keto ? 0 : Math.max(0, dailyTarget.carbLo - FIBER_ALLOWANCE_G);
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

router.post("/preview", async (req, res, next) => {
  try {
    const daysAsked = Number(req.body?.days);
    const days = Number.isFinite(daysAsked) ? Math.max(1, Math.min(14, Math.round(daysAsked))) : 1;
    const seedAsked = Number(req.body?.seed);
    const seed = Number.isFinite(seedAsked) ? seedAsked >>> 0 : dayNum(todayStr());

    const { profile, dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
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
        diagnosis: solved.diagnosis,
        slots: solved.slots,
      };
      const banner = dayBanner(entry, targets);
      if (banner) entry.banner = banner;
      out.push(entry);
    }
    res.json({ seed, targets, feasibility, summary: previewSummary(out), days: out, note: NOTE });
  } catch (e) { next(e); }
});

module.exports = router;
