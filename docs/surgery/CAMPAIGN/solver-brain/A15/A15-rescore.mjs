/**
 * A15 — ruler variants, re-scored WITHOUT re-solving.
 *
 * READ-ONLY. No DB. No solve. No writes to backend/src.
 * Imports bmrEngine.js read-only (pure functions) purely to reconstruct the
 * per-persona macro bands, and validates that reconstruction against the bands
 * the canonical run actually recorded in results.jsonl.
 *
 * Source of truth for achieved day totals:
 *   docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/results.jsonl
 *     -> primary.mine.days[]  {kcal, protein, fat, carb}
 * Source of truth for the satisfiable denominator (C7 / A3):
 *   solver-brain/A3/A3-final-split.json -> bucket !== 'structurally-impossible'
 *
 * Ruler transcribed from backend/src/lib/mealSolver.js:210-256.
 * Band construction transcribed from backend/src/lib/bmrEngine.js:294-359.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = 'C:/Users/<account>/Desktop/cut-protocol';
const QA = `${ROOT}/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032`;
const SB = `${ROOT}/docs/surgery/CAMPAIGN/solver-brain`;
const OUT = `${SB}/A15`;

const { computeEnergy, deriveTarget, computeMacros } = require(`${ROOT}/backend/src/lib/bmrEngine.js`);

// ── ruler constants, transcribed from mealSolver.js:210-213 ───────────────
const DAY_KCAL_TOLERANCE_PCT = 0.15;
const DAY_PROTEIN_TOLERANCE_PCT = 0.15;
const DAY_FAT_TOLERANCE_PCT = 0.25;
const DAY_CARB_TOLERANCE_PCT = 0.25;

// bmrEngine constants, transcribed from :268-292
const CARB_MIDPOINT_BUFFER_G = 25;
const KETO_CARB_TARGET_G = 25, KETO_CARB_LO_G = 10, KETO_CARB_CEILING_G = 30;
const ASSUMED_BODY_FAT_PCT = { M: 21, F: 28 };
const ESSENTIAL_FAT_PER_LB_LBM = 0.3;
const NONKETO_CARB_FLOOR_G = 50;
const kg2lb = (kg) => kg * 2.2046226218;

/** Transcribed computeMacros with the carb buffer as a parameter. */
function macrosWithBuffer(profile, weightKg, targetKcal, buffer) {
  const weightLb = kg2lb(weightKg);
  const bfKnown = profile.bodyFatPct != null && profile.bodyFatPct > 0;
  const bfForLbm = bfKnown ? profile.bodyFatPct : (profile.sex === 'F' ? ASSUMED_BODY_FAT_PCT.F : ASSUMED_BODY_FAT_PCT.M);
  const lbmLb = weightLb * (1 - bfForLbm / 100);
  const proteinLo = Math.round(lbmLb * 1.14);
  const proteinHi = Math.round(lbmLb * 1.25);
  const proteinMid = (proteinLo + proteinHi) / 2;

  if (profile.dietaryStyle === 'keto') {
    const carbMid = KETO_CARB_TARGET_G;
    const fatFromBalance = Math.round((targetKcal - proteinMid * 4 - carbMid * 4) / 9);
    const fatMid = Math.max(Math.round(lbmLb * ESSENTIAL_FAT_PER_LB_LBM), fatFromBalance);
    return {
      lbmLb, kcal: targetKcal, proteinLo, proteinHi,
      fatLo: Math.round(fatMid * 0.9), fatHi: Math.round(fatMid * 1.12),
      carbLo: KETO_CARB_LO_G, carbMid, carbHi: KETO_CARB_CEILING_G,
      keto: true, carbFloored: false,
    };
  }
  let fatLo = Math.round(lbmLb * 0.34);
  let fatHi = Math.round(lbmLb * 0.4);
  let fatMid = (fatLo + fatHi) / 2;
  let carbMid = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4) - buffer;
  let carbFloored = false;
  if (carbMid < NONKETO_CARB_FLOOR_G) {
    carbFloored = true;
    const essentialFat = Math.round(lbmLb * ESSENTIAL_FAT_PER_LB_LBM);
    const fatFromBalance = Math.round((targetKcal - proteinMid * 4 - NONKETO_CARB_FLOOR_G * 4) / 9);
    fatMid = Math.max(essentialFat, fatFromBalance);
    fatLo = Math.round(fatMid * 0.9);
    fatHi = Math.round(fatMid * 1.12);
    const roomForCarb = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4);
    carbMid = Math.max(0, Math.min(NONKETO_CARB_FLOOR_G, roomForCarb));
  }
  return {
    lbmLb, kcal: targetKcal, proteinLo, proteinHi, fatLo, fatHi,
    carbLo: Math.max(carbMid - 12, 0), carbMid, carbHi: carbMid + 12,
    keto: false, carbFloored,
  };
}

// ── the ruler ─────────────────────────────────────────────────────────────
function bandMiss(v, lo, hi) {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { shortPct: 0, overPct: 0, mid };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { shortPct: (lo - val) / mid, overPct: 0, mid };
  if (val > hi) return { shortPct: 0, overPct: (val - hi) / mid, mid };
  return { shortPct: 0, overPct: 0, mid };
}
const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;

/**
 * opts:
 *   fatE        - effective half-width as a fraction of the fat band MIDPOINT.
 *                 null => use the shipping rule (bandMiss + DAY_FAT_TOLERANCE_PCT).
 *                 Note mid*(1 +/- E) is ALGEBRAICALLY IDENTICAL to the shipping
 *                 rule when E = h/mid + 0.25, because the shipping pass window is
 *                 [mid-h-0.25mid, mid+h+0.25mid] -- symmetric about mid.
 *   fatFloorEnergyPct - additional floor: fat_g >= pct * targetKcal / 9   (A4)
 *   fatFloorLbm       - additional floor: fat_g >= k * lbmLb              (A4 C3)
 *   amdr        - grade all three macros as % of energy, ignoring the app bands
 */
function grade(t, totals, opts = {}) {
  const pMid = (t.proteinLo + t.proteinHi) / 2;
  const kcalDeltaPct = t.kcal > 0 ? (totals.kcal - t.kcal) / t.kcal : 1;
  const kcalOk = Math.abs(kcalDeltaPct) <= DAY_KCAL_TOLERANCE_PCT;

  if (opts.amdr) {
    const T = t.kcal;
    const fOk = totals.fat >= 0.20 * T / 9 && totals.fat <= 0.35 * T / 9;
    const cOk = totals.carb >= 0.45 * T / 4 && totals.carb <= 0.65 * T / 4;
    const pOk = totals.protein >= 0.10 * T / 4 && totals.protein <= 0.35 * T / 4;
    return { kcalOk, proteinOk: pOk, fatOk: fOk, carbOk: cOk, inBand: kcalOk && pOk && fOk && cOk };
  }

  const proteinShortPct = pMid > 0 ? Math.max(0, (pMid - totals.protein) / pMid) : 0;
  const proteinOk = proteinShortPct <= DAY_PROTEIN_TOLERANCE_PCT;

  const fatBand = hasBand(t.fatLo, t.fatHi);
  const carbBand = hasBand(t.carbLo, t.carbHi);
  const fat = fatBand ? bandMiss(totals.fat, t.fatLo, t.fatHi) : { shortPct: 0, overPct: 0, mid: null };
  const carb = carbBand ? bandMiss(totals.carb, t.carbLo, t.carbHi) : { shortPct: 0, overPct: 0, mid: null };
  const carbOverAllowance = t.keto ? 0 : DAY_CARB_TOLERANCE_PCT;

  let fatOk;
  if (!fatBand) fatOk = true;
  else if (opts.fatE == null) {
    fatOk = fat.shortPct <= DAY_FAT_TOLERANCE_PCT && fat.overPct <= DAY_FAT_TOLERANCE_PCT;
  } else {
    const mid = (t.fatLo + t.fatHi) / 2;
    fatOk = totals.fat >= mid * (1 - opts.fatE) && totals.fat <= mid * (1 + opts.fatE);
  }
  if (fatOk && opts.fatFloorEnergyPct != null) fatOk = totals.fat >= opts.fatFloorEnergyPct * t.kcal / 9;
  if (fatOk && opts.fatFloorLbm != null) fatOk = totals.fat >= opts.fatFloorLbm * t.lbmLb;

  const carbOk = !carbBand || (carb.shortPct <= DAY_CARB_TOLERANCE_PCT && carb.overPct <= carbOverAllowance);
  return { kcalOk, proteinOk, fatOk, carbOk, inBand: kcalOk && proteinOk && fatOk && carbOk };
}

// ── Wilson score interval ─────────────────────────────────────────────────
function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// ── assemble the day table ────────────────────────────────────────────────
const personas = fs.readFileSync(`${QA}/personas.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const results = fs.readFileSync(`${QA}/results.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const split = require(`${SB}/A3/A3-final-split.json`);

const pById = new Map(personas.map((p) => [p.id, p]));
const bucketById = new Map(split.map((r) => [r.id, r.bucket]));

let bandMismatch = 0, bandChecked = 0;
const mismatchIds = [];
const days = [];

for (const r of results) {
  const rec = r.target;
  const day = r.primary?.mine?.days;
  if (!rec || !Array.isArray(day) || day.length === 0) continue;
  const p = pById.get(r.id);
  if (!p) continue;

  // reconstruct the bands from bmrEngine (read-only) and VALIDATE against recorded
  const prof = p.profile;
  const e = computeEnergy(prof, prof.startWeightKg);
  const dt = deriveTarget(prof, e.tdee, e.rmr);
  const m = computeMacros(prof, prof.startWeightKg, dt.target);
  const mine = macrosWithBuffer(prof, prof.startWeightKg, dt.target, CARB_MIDPOINT_BUFFER_G);
  const m0 = macrosWithBuffer(prof, prof.startWeightKg, dt.target, 0);

  // instrument check A: my transcription == the real computeMacros
  for (const k of ['proteinLo', 'proteinHi', 'fatLo', 'fatHi', 'carbLo', 'carbHi']) {
    if (m[k] !== mine[k]) { bandMismatch++; mismatchIds.push(`${r.id}:transcribe:${k}`); break; }
  }
  // instrument check B: reconstruction == the bands the RUN recorded
  bandChecked++;
  const recMatch = ['proteinLo', 'proteinHi', 'fatLo', 'fatHi', 'carbLo', 'carbHi']
    .every((k) => rec[k] === m[k]) && !!rec.keto === !!m.keto && rec.kcal === m.kcal;
  if (!recMatch) { mismatchIds.push(`${r.id}:recorded`); }

  const bucket = bucketById.get(r.id) ?? 'unknown';
  for (let i = 0; i < day.length; i++) {
    const d = day[i];
    days.push({
      id: r.id, dayIdx: i, diet: r.dietaryStyle ?? prof.dietaryStyle, tier: r.tier,
      bucket, satisfiable: bucket !== 'structurally-impossible',
      recordedInTolerance: !!d.inTolerance,
      totals: { kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb },
      // recorded band (what the run graded on) + lbm for the floor variants
      T: { ...rec, lbmLb: m.lbmLb, keto: !!rec.keto },
      // zero-buffer band
      T0: { kcal: m0.kcal, proteinLo: m0.proteinLo, proteinHi: m0.proteinHi, fatLo: m0.fatLo, fatHi: m0.fatHi, carbLo: m0.carbLo, carbHi: m0.carbHi, keto: m0.keto, lbmLb: m0.lbmLb },
      ketoPath: !!m.keto, carbFloored: !!m.carbFloored,
    });
  }
}

// ── variants ──────────────────────────────────────────────────────────────
const VARIANTS = [
  { key: 'V0-baseline', label: 'Baseline (shipping rule)', opts: {} },
  { key: 'V1-fatE10', label: 'Fat effective +/-10% (TIGHTEN)', opts: { fatE: 0.10 } },
  { key: 'V2-fatE15', label: 'Fat effective +/-15% (TIGHTEN)', opts: { fatE: 0.15 } },
  { key: 'V3-fatE20', label: 'Fat effective +/-20% (TIGHTEN)', opts: { fatE: 0.20 } },
  { key: 'V4-fatE25', label: 'Fat effective +/-25% (TIGHTEN)', opts: { fatE: 0.25 } },
  { key: 'V5-fatE40', label: 'Fat effective +/-40% (loosen)', opts: { fatE: 0.40 } },
  { key: 'V6-fatE50', label: 'Fat effective +/-50% (loosen)', opts: { fatE: 0.50 } },
  { key: 'V7-fatFloor20E', label: 'A4: + fat floor 20% of energy (TIGHTEN)', opts: { fatFloorEnergyPct: 0.20 } },
  { key: 'V8-fatFloorEssential', label: 'A4 C3: + fat floor 0.30 g/lb LBM (TIGHTEN)', opts: { fatFloorLbm: ESSENTIAL_FAT_PER_LB_LBM } },
  { key: 'V9-carbBuffer0', label: 'C12/A12: CARB_MIDPOINT_BUFFER_G = 0', opts: { useT0: true } },
  { key: 'V10-amdr', label: 'AMDR %-of-energy for all 3 macros', opts: { amdr: true } },
];

function score(rows, v) {
  const useT0 = v.opts.useT0;
  const opts = { ...v.opts }; delete opts.useT0;
  let inBand = 0;
  const flips = { gained: [], lost: [] };
  for (const d of rows) {
    const t = useT0 ? d.T0 : d.T;
    const g = grade(t, d.totals, opts);
    if (g.inBand) inBand++;
    const base = grade(d.T, d.totals, {});
    if (g.inBand && !base.inBand) flips.gained.push(`${d.id}#${d.dayIdx}`);
    if (!g.inBand && base.inBand) flips.lost.push(`${d.id}#${d.dayIdx}`);
  }
  return { inBand, n: rows.length, flips };
}

/** McNemar paired half-width, per C14: se = sqrt((b+c) - (b-c)^2/n)/n. */
function mcnemar(b, c, n) {
  if (n === 0 || (b + c) === 0) return { b, c, sePts: 0, halfWidthPts: 0, resolved: b + c > 0 };
  const se = Math.sqrt((b + c) - Math.pow(b - c, 2) / n) / n;
  return { b, c, sePts: +(100 * se).toFixed(2), halfWidthPts: +(100 * 1.96 * se).toFixed(2) };
}

const all = days;
const sat = days.filter((d) => d.satisfiable);
const report = { generated: new Date().toISOString(), source: `${QA}/results.jsonl`, denominators: { all: all.length, satisfiable: sat.length }, instrument: {}, variants: [] };

// instrument checks
const baseAll = score(all, VARIANTS[0]), baseSat = score(sat, VARIANTS[0]);
const recAll = all.filter((d) => d.recordedInTolerance).length;
const recSat = sat.filter((d) => d.recordedInTolerance).length;
report.instrument = {
  transcriptionMismatches: bandMismatch,
  personasBandChecked: bandChecked,
  recordedBandMismatches: mismatchIds.filter((x) => x.endsWith(':recorded')).length,
  mismatchSample: mismatchIds.slice(0, 12),
  recordedInBandAll: recAll, recordedInBandSat: recSat,
  regradedInBandAll: baseAll.inBand, regradedInBandSat: baseSat.inBand,
  regradeAgreesAll: recAll === baseAll.inBand, regradeAgreesSat: recSat === baseSat.inBand,
};

for (const v of VARIANTS) {
  const a = score(all, v), s = score(sat, v);
  const wa = wilson(a.inBand, a.n), ws = wilson(s.inBand, s.n);
  report.variants.push({
    key: v.key, label: v.label,
    all: { inBand: a.inBand, n: a.n, pct: +(100 * a.inBand / a.n).toFixed(1), ciLo: +(100 * wa[0]).toFixed(1), ciHi: +(100 * wa[1]).toFixed(1), delta: +(100 * (a.inBand - baseAll.inBand) / a.n).toFixed(1) },
    sat: { inBand: s.inBand, n: s.n, pct: +(100 * s.inBand / s.n).toFixed(1), ciLo: +(100 * ws[0]).toFixed(1), ciHi: +(100 * ws[1]).toFixed(1), delta: +(100 * (s.inBand - baseSat.inBand) / s.n).toFixed(1) },
    flipsGained: s.flips.gained.length, flipsLost: s.flips.lost.length,
    mcnemarSat: mcnemar(s.flips.gained.length, s.flips.lost.length, s.n),
    oneDirectional: s.flips.gained.length === 0 || s.flips.lost.length === 0,
  });
}

// ── instrument check C: the fatE parameterization reproduces baseline exactly
// when E = h/mid + 0.25, for EVERY diet path including keto/carb-floored.
let eqMismatch = 0;
const eByPath = { default: new Set(), ketoOrCarbFloored: new Set() };
for (const d of all) {
  const mid = (d.T.fatLo + d.T.fatHi) / 2, h = (d.T.fatHi - d.T.fatLo) / 2;
  const E = h / mid + DAY_FAT_TOLERANCE_PCT;
  const a = grade(d.T, d.totals, {});
  const b = grade(d.T, d.totals, { fatE: E });
  if (a.inBand !== b.inBand) eqMismatch++;
  (d.ketoPath || d.carbFloored ? eByPath.ketoOrCarbFloored : eByPath.default).add(+E.toFixed(4));
}
const rng = (s) => { const a = [...s].sort((x, y) => x - y); return a.length ? `${(100 * a[0]).toFixed(1)}%-${(100 * a[a.length - 1]).toFixed(1)}%` : 'n/a'; };
report.instrument.fatEEquivalenceMismatches = eqMismatch;
report.instrument.baselineEffectiveFatE_default = rng(eByPath.default);
report.instrument.baselineEffectiveFatE_ketoOrCarbFloored = rng(eByPath.ketoOrCarbFloored);
report.instrument.ketoPathDays = all.filter((d) => d.ketoPath).length;
report.instrument.carbFlooredDays = all.filter((d) => d.carbFloored).length;

// ── the C3 correctness question, independent of compliance ────────────────
let passingBelowEssential = 0, passingBelowAmdrFloor = 0, allBelowEssential = 0;
let midBelowAmdrFloor = 0, personaMidBelowAmdr = new Set();
for (const d of all) {
  const base = grade(d.T, d.totals, {});
  const essential = ESSENTIAL_FAT_PER_LB_LBM * d.T.lbmLb;
  if (d.totals.fat < essential) allBelowEssential++;
  if (base.inBand && d.totals.fat < essential) passingBelowEssential++;
  if (base.inBand && d.totals.fat < 0.20 * d.T.kcal / 9) passingBelowAmdrFloor++;
  const fMid = (d.T.fatLo + d.T.fatHi) / 2;
  if (fMid * 9 < 0.20 * d.T.kcal) { midBelowAmdrFloor++; personaMidBelowAmdr.add(d.id); }
}
report.correctness = {
  daysBelowEssentialFat: allBelowEssential,
  passingDaysBelowEssentialFat: passingBelowEssential,
  passingDaysBelowAmdrFatFloor: passingBelowAmdrFloor,
  daysWhoseBandMidpointIsBelowAmdrFatFloor: midBelowAmdrFloor,
  personasWhoseBandMidpointIsBelowAmdrFatFloor: personaMidBelowAmdr.size,
};

// per-diet baseline vs the two most informative variants, satisfiable-only
const diets = [...new Set(sat.map((d) => d.diet))].sort();
report.perDiet = diets.map((dt) => {
  const rows = sat.filter((d) => d.diet === dt);
  const b = score(rows, VARIANTS[0]);
  const t20 = score(rows, VARIANTS[3]);
  const l50 = score(rows, VARIANTS[6]);
  const cb0 = score(rows, VARIANTS[9]);
  return { diet: dt, n: rows.length, base: b.inBand, basePct: +(100 * b.inBand / b.n).toFixed(1), fatE20: t20.inBand, fatE50: l50.inBand, carbBuf0: cb0.inBand };
});

fs.writeFileSync(`${OUT}/A15-variants.json`, JSON.stringify(report, null, 2));
fs.writeFileSync(`${OUT}/A15-days.jsonl`, days.map((d) => JSON.stringify(d)).join('\n'));

console.log('=== INSTRUMENT ===');
console.log(JSON.stringify(report.instrument, null, 2));
console.log('\n=== VARIANTS (inBand / n, pct, delta pts) ===');
for (const v of report.variants) {
  console.log(`${v.key.padEnd(22)} ALL ${String(v.all.inBand).padStart(3)}/${v.all.n} ${String(v.all.pct).padStart(5)}% [${v.all.ciLo}-${v.all.ciHi}] d=${v.all.delta >= 0 ? '+' : ''}${v.all.delta}   SAT ${String(v.sat.inBand).padStart(3)}/${v.sat.n} ${String(v.sat.pct).padStart(5)}% [${v.sat.ciLo}-${v.sat.ciHi}] d=${v.sat.delta >= 0 ? '+' : ''}${v.sat.delta}  (+${v.flipsGained}/-${v.flipsLost})`);
}
console.log('\n=== CORRECTNESS (C3 / AMDR) ===');
console.log(JSON.stringify(report.correctness, null, 2));
console.log('\n=== PER DIET (satisfiable only) ===');
console.table(report.perDiet);
