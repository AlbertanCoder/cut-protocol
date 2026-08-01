/** A15 — decomposition: which rule binds, and the p135 transcription check. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = 'C:/Users/<account>/Desktop/cut-protocol';
const SB = `${ROOT}/docs/surgery/CAMPAIGN/solver-brain`;
const QA = `${ROOT}/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032`;
const { computeEnergy, deriveTarget, computeMacros } = require(`${ROOT}/backend/src/lib/bmrEngine.js`);

const days = fs.readFileSync(`${SB}/A15/A15-days.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// ---- p135 transcription mismatch ----
const personas = fs.readFileSync(`${QA}/personas.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const p135 = personas.find((p) => p.id === 'p135');
if (p135) {
  const e = computeEnergy(p135.profile, p135.profile.startWeightKg);
  const dt = deriveTarget(p135.profile, e.tdee, e.rmr);
  const m = computeMacros(p135.profile, p135.profile.startWeightKg, dt.target);
  const lbm = m.lbmLb;
  console.log('p135 lbmLb', lbm, 'lbm*1.14 =', lbm * 1.14, '-> real proteinLo', m.proteinLo);
  console.log('  (a Math.round .5 tie; affects protein band by 1 g on 1 of 212 personas)');
}

const F = 0.25, C = 0.25, K = 0.15, P = 0.15;
function parts(t, x) {
  const pMid = (t.proteinLo + t.proteinHi) / 2;
  const fMid = (t.fatLo + t.fatHi) / 2, cMid = (t.carbLo + t.carbHi) / 2;
  const kcalOk = Math.abs((x.kcal - t.kcal) / t.kcal) <= K;
  const proteinOk = Math.max(0, (pMid - x.protein) / pMid) <= P;
  const fatShort = x.fat < t.fatLo ? (t.fatLo - x.fat) / fMid : 0;
  const fatOver = x.fat > t.fatHi ? (x.fat - t.fatHi) / fMid : 0;
  const carbShort = x.carb < t.carbLo ? (t.carbLo - x.carb) / cMid : 0;
  const carbOver = x.carb > t.carbHi ? (x.carb - t.carbHi) / cMid : 0;
  const fatOk = fatShort <= F && fatOver <= F;
  const carbOk = carbShort <= C && carbOver <= (t.keto ? 0 : C);
  return { kcalOk, proteinOk, fatOk, carbOk, fatShort, fatOver, carbShort, carbOver,
           inBand: kcalOk && proteinOk && fatOk && carbOk };
}

const sat = days.filter((d) => d.satisfiable);
const misses = sat.filter((d) => !parts(d.T, d.totals).inBand);
console.log(`\nsatisfiable ${sat.length}, misses ${misses.length}`);

// which rules fail, and how many fail on FAT ALONE (the ruler-recoverable set)
const tally = { kcal: 0, protein: 0, fat: 0, carb: 0 };
const solo = { kcal: 0, protein: 0, fat: 0, carb: 0 };
let fatOverOnly = 0, fatShortOnly = 0;
for (const d of misses) {
  const p = parts(d.T, d.totals);
  const bad = [];
  if (!p.kcalOk) { tally.kcal++; bad.push('kcal'); }
  if (!p.proteinOk) { tally.protein++; bad.push('protein'); }
  if (!p.fatOk) { tally.fat++; bad.push('fat'); }
  if (!p.carbOk) { tally.carb++; bad.push('carb'); }
  if (bad.length === 1) solo[bad[0]]++;
  if (bad.length === 1 && bad[0] === 'fat') { if (p.fatOver > 0) fatOverOnly++; else fatShortOnly++; }
}
console.log('\nrules failed (satisfiable misses, non-exclusive):', tally);
console.log('failed on EXACTLY ONE rule:', solo, `(fat-only: over ${fatOverOnly}, short ${fatShortOnly})`);

// how far out are the fat-only misses? -> what E would rescue them
const need = misses.map((d) => {
  const p = parts(d.T, d.totals);
  const fMid = (d.T.fatLo + d.T.fatHi) / 2;
  const h = (d.T.fatHi - d.T.fatLo) / 2;
  const excess = Math.max(p.fatShort, p.fatOver);   // fraction of mid beyond the band
  return excess > 0 ? h / fMid + excess : null;      // effective E needed to pass fat
}).filter((x) => x != null).sort((a, b) => a - b);
console.log(`\nfat-failing satisfiable misses: ${need.length}`);
console.log('effective fat E needed to rescue, deciles:',
  [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => `p${q * 100}=${(100 * need[Math.floor(q * (need.length - 1))]).toFixed(0)}%`).join(' '));

// AMDR per-macro decomposition
let aF = 0, aC = 0, aP = 0, aK = 0;
for (const d of sat) {
  const T = d.T.kcal, x = d.totals;
  if (!(x.fat >= 0.20 * T / 9 && x.fat <= 0.35 * T / 9)) aF++;
  if (!(x.carb >= 0.45 * T / 4 && x.carb <= 0.65 * T / 4)) aC++;
  if (!(x.protein >= 0.10 * T / 4 && x.protein <= 0.35 * T / 4)) aP++;
  if (!(Math.abs((x.kcal - T) / T) <= K)) aK++;
}
console.log(`\nAMDR failures among ${sat.length} satisfiable days: fat ${aF}, carb ${aC}, protein ${aP}, kcal ${aK}`);

// how many days' PRESCRIBED protein band exceeds the AMDR 35%-of-energy ceiling
let pBandOverAmdr = 0, fBandBelowAmdr = 0, cBandBelowAmdr = 0;
for (const d of sat) {
  const T = d.T.kcal, pMid = (d.T.proteinLo + d.T.proteinHi) / 2;
  const fMid = (d.T.fatLo + d.T.fatHi) / 2, cMid = (d.T.carbLo + d.T.carbHi) / 2;
  if (pMid * 4 > 0.35 * T) pBandOverAmdr++;
  if (fMid * 9 < 0.20 * T) fBandBelowAmdr++;
  if (cMid * 4 < 0.45 * T) cBandBelowAmdr++;
}
console.log(`prescribed midpoints vs AMDR (satisfiable ${sat.length} days): protein ABOVE 35%E ${pBandOverAmdr}, fat BELOW 20%E ${fBandBelowAmdr}, carb BELOW 45%E ${cBandBelowAmdr}`);

// essential-fat: the 18 sub-essential days -- do they already fail?
const sub = days.filter((d) => d.totals.fat < 0.3 * d.T.lbmLb);
console.log(`\ndays below ESSENTIAL_FAT_PER_LB_LBM (0.30*lbm): ${sub.length}`);
const subFail = sub.map((d) => { const p = parts(d.T, d.totals); return p.inBand; });
console.log(`  of those, already FAILING baseline: ${subFail.filter((x) => !x).length}, passing: ${subFail.filter(Boolean).length}`);
console.log('  sample:', sub.slice(0, 6).map((d) => `${d.id}#${d.dayIdx} fat=${d.totals.fat}g floor=${(0.3 * d.T.lbmLb).toFixed(1)}g fatLo=${d.T.fatLo}`).join('\n           '));
