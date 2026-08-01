/**
 * A12 — ruler coherence. READ-ONLY. No DB, no solve, no writes to backend/src.
 * Imports bmrEngine (pure functions) and replays dayTolerance()'s arithmetic
 * against the SAME constants, transcribed from mealSolver.js lines 210-256.
 *
 * Population: the canonical 250 personas (personas.jsonl, seed = RUN_ID of
 * qa-fleet-20260729-2032).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = 'C:/Users/<account>/Desktop/cut-protocol';
const { computeEnergy, deriveTarget, computeMacros } = require(`${ROOT}/backend/src/lib/bmrEngine.js`);

// transcribed from mealSolver.js — DAY_*_TOLERANCE_PCT
const K = 0.15, P = 0.15, F = 0.25, C = 0.25;

const lines = fs.readFileSync(`${ROOT}/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl`, 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

const rows = [];
for (const p of lines) {
  const prof = p.profile;
  const wKg = prof.startWeightKg;
  const e = computeEnergy(prof, wKg);
  const t = deriveTarget(prof, e.tdee, e.rmr);
  const T = t.target;
  const m = computeMacros(prof, wKg, T);

  const pMid = (m.proteinLo + m.proteinHi) / 2;
  const fMid = (m.fatLo + m.fatHi) / 2;      // the band midpoint dayTolerance grades on
  const cMid = (m.carbLo + m.carbHi) / 2;    // ditto — NOT m.carbMid on keto

  // the point where all three macros sit at the midpoint dayTolerance uses
  const midKcal = pMid * 4 + fMid * 9 + cMid * 4;

  // dayTolerance's admissible box
  const Pmin = 0.85 * pMid;                       // over is never a miss -> no max
  const Fmin = Math.max(0, m.fatLo - F * fMid);
  const Fmax = m.fatHi + F * fMid;
  const Cmin = Math.max(0, m.carbLo - C * cMid);
  const Cmax = m.keto ? m.carbHi : m.carbHi + C * cMid;   // zero upward allowance on keto
  const gradedMinKcal = 4 * Pmin + 9 * Fmin + 4 * Cmin;
  const gradedMaxKcal = 4 * (m.proteinHi * 3) + 9 * Fmax + 4 * Cmax; // protein unbounded above

  // the box the CUSTOMER is shown (MacroRail: protein range, carb range, fat FLOOR)
  const inBandMinKcal = 4 * m.proteinLo + 9 * m.fatLo + 4 * m.carbLo;
  const inBandMaxKcal = 4 * m.proteinHi + 9 * m.fatHi + 4 * m.carbHi;

  rows.push({
    id: p.id, tier: p.tier, sex: prof.sex, diet: prof.dietaryStyle, wKg,
    rmr: e.rmr, tdee: Math.round(e.tdee), rawTarget: t.raw, target: T, floored: t.floored,
    keto: !!m.keto, carbFloored: !!m.carbFloored,
    proteinLo: m.proteinLo, proteinHi: m.proteinHi, pMid,
    fatLo: m.fatLo, fatHi: m.fatHi, fMid,
    carbLo: m.carbLo, carbMid: m.carbMid, carbHi: m.carbHi, cMid,
    macroKcalGap: m.macroKcalGap,
    midKcal: Math.round(midKcal),
    midGapKcal: Math.round(T - midKcal),
    midGapPct: Math.round(((T - midKcal) / T) * 1000) / 10,
    midKcalOk: Math.abs((midKcal - T) / T) <= K,
    gradedMinKcal: Math.round(gradedMinKcal),
    gradedMaxKcal: Math.round(gradedMaxKcal),
    gradedFeasible: gradedMinKcal <= 1.15 * T && gradedMaxKcal >= 0.85 * T,
    inBandMinKcal: Math.round(inBandMinKcal),
    inBandMaxKcal: Math.round(inBandMaxKcal),
    // can a day sit inside EVERY band the UI draws AND inside +/-15% kcal?
    uiFeasible: inBandMinKcal <= 1.15 * T && inBandMaxKcal >= 0.85 * T,
    // can a day sit inside every displayed band AND hit the target EXACTLY?
    uiHitsTarget: inBandMinKcal <= T && inBandMaxKcal >= T,
    // headroom from the displayed-band ceiling to the calorie target
    inBandMaxMinusTarget: Math.round(inBandMaxKcal - T),
    // UI/grader mismatch widths (grams)
    proteinUiAmberGraderOk: Math.round(3 * m.proteinHi - m.proteinHi),      // any g above proteinHi
    proteinGraderOkUiUnderFloor: Math.round(m.proteinLo - Pmin),            // g below displayed floor grader still passes
    carbUiAmberGraderOk: Math.round(Cmax - m.carbHi),                       // g above carbHi grader still passes
    fatGraderFailsUiSilent: Math.round(Fmax),                               // UI has NO fat ceiling at all
    fatUiFloorGraderOk: Math.round(m.fatLo - Fmin),                         // g below displayed fat min grader passes
  });
}

const n = rows.length;
const pct = (k) => Math.round((rows.filter(k).length / n) * 1000) / 10;
const avg = (f) => Math.round(rows.reduce((s, r) => s + f(r), 0) / n * 10) / 10;

const summary = {
  n,
  keto: rows.filter((r) => r.keto).length,
  carbFloored: rows.filter((r) => r.carbFloored).length,
  floored: rows.filter((r) => r.floored).length,
  midGapKcal_mean: avg((r) => r.midGapKcal),
  midGapKcal_min: Math.min(...rows.map((r) => r.midGapKcal)),
  midGapKcal_max: Math.max(...rows.map((r) => r.midGapKcal)),
  midGapPct_mean: avg((r) => r.midGapPct),
  pct_midKcalOk: pct((r) => r.midKcalOk),
  pct_gradedFeasible: pct((r) => r.gradedFeasible),
  pct_uiFeasible: pct((r) => r.uiFeasible),
  pct_uiHitsTarget: pct((r) => r.uiHitsTarget),
  inBandMaxMinusTarget_mean: avg((r) => r.inBandMaxMinusTarget),
  inBandMaxMinusTarget_min: Math.min(...rows.map((r) => r.inBandMaxMinusTarget)),
  carbUiAmberGraderOk_mean: avg((r) => r.carbUiAmberGraderOk),
  proteinGraderOkUiUnderFloor_mean: avg((r) => r.proteinGraderOkUiUnderFloor),
  fatUiFloorGraderOk_mean: avg((r) => r.fatUiFloorGraderOk),
  // narrowest carb windows (the carbFloored pathology)
  tightestCarbWindows: rows.filter((r) => !r.keto).sort((a, b) => (a.carbHi - a.carbLo) - (b.carbHi - b.carbLo))
    .slice(0, 3).map((r) => ({ id: r.id, carbLo: r.carbLo, carbMid: r.carbMid, carbHi: r.carbHi, cMid: r.cMid, graderCarbMax: Math.round(r.carbHi + 0.25 * r.cMid), target: r.target })),
  ketoSample: rows.filter((r) => r.keto).slice(0, 3).map((r) => ({
    id: r.id, target: r.target, pMid: r.pMid, fatLo: r.fatLo, fatHi: r.fatHi,
    carbLo: r.carbLo, carbMid: r.carbMid, carbHi: r.carbHi, cMid: r.cMid,
    macroKcalGap: r.macroKcalGap, midGapKcal: r.midGapKcal, uiHitsTarget: r.uiHitsTarget,
    inBandMaxKcal: r.inBandMaxKcal,
  })),
  byDiet: {},
};
for (const d of [...new Set(rows.map((r) => r.diet))]) {
  const g = rows.filter((r) => r.diet === d);
  summary.byDiet[d] = {
    n: g.length,
    midGapKcal_mean: Math.round(g.reduce((s, r) => s + r.midGapKcal, 0) / g.length),
    pct_uiHitsTarget: Math.round((g.filter((r) => r.uiHitsTarget).length / g.length) * 1000) / 10,
    pct_gradedFeasible: Math.round((g.filter((r) => r.gradedFeasible).length / g.length) * 1000) / 10,
  };
}

fs.writeFileSync(`${ROOT}/docs/surgery/CAMPAIGN/solver-brain/A12/a12-per-persona.json`, JSON.stringify(rows, null, 1));
fs.writeFileSync(`${ROOT}/docs/surgery/CAMPAIGN/solver-brain/A12/a12-summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
