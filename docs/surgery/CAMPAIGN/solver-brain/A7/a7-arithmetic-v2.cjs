/* A7 v2 — correct signatures: computeEnergy(profile, weightKg),
   deriveTarget(profile, tdee, rmr), computeMacros(profile, weightKg, targetKcal). */
const BMR = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/bmrEngine.js');

const CASES = [
  { label: 'M 180cm 85kg bf20', sex: 'M', age: 32, heightCm: 180, weightKg: 85, bodyFatPct: 20 },
  { label: 'M 175cm 95kg bf28', sex: 'M', age: 41, heightCm: 175, weightKg: 95, bodyFatPct: 28 },
  { label: 'M 190cm 78kg bf12', sex: 'M', age: 26, heightCm: 190, weightKg: 78, bodyFatPct: 12 },
  { label: 'F 165cm 70kg bf30', sex: 'F', age: 35, heightCm: 165, weightKg: 70, bodyFatPct: 30 },
  { label: 'F 172cm 62kg bf22', sex: 'F', age: 29, heightCm: 172, weightKg: 62, bodyFatPct: 22 },
];

console.log('case\tRMR\tTDEE\ttargetKcal\tlbmLb\tPlo\tPhi\tPmid\tPreq=.85mid\treqDens\tfatLo-fatHi');
const rows = [];
for (const c of CASES) {
  const profile = {
    sex: c.sex, age: c.age, heightCm: c.heightCm, bodyFatPct: c.bodyFatPct,
    occupationKey: 'office_worker', trainingStyle: 'weights', minutesPerSession: 45,
    rateLbPerWeek: 2, rateAcknowledged: true, excludedFormulas: [], dietaryStyle: 'vegan',
  };
  const en = BMR.computeEnergy(profile, c.weightKg);
  const rmr = en.bmr ?? en.rmr ?? en.bmrMean;
  const tdee = en.tdee;
  const tgt = BMR.deriveTarget(profile, tdee, rmr);
  const targetKcal = typeof tgt === 'number' ? tgt : (tgt.targetKcal ?? tgt.target ?? tgt.kcal);
  const m = BMR.computeMacros(profile, c.weightKg, targetKcal);
  const mid = (m.proteinLo + m.proteinHi) / 2;
  const req = 0.85 * mid;
  const reqDens = (req / targetKcal) * 100;
  rows.push({ ...c, rmr, tdee, targetKcal, m, mid, req, reqDens });
  console.log([c.label, Math.round(rmr), Math.round(tdee), targetKcal, m.lbmLb?.toFixed?.(1),
    m.proteinLo, m.proteinHi, mid.toFixed(0), req.toFixed(0), reqDens.toFixed(2),
    `${m.fatLo}-${m.fatHi}`].join('\t'));
}

console.log('\nenergy keys:', Object.keys(BMR.computeEnergy({ sex: 'M', age: 32, heightCm: 180, bodyFatPct: 20, occupationKey: 'office_worker', excludedFormulas: [] }, 85)).join(', '));

// ── the comparison ───────────────────────────────────────────────────────
// Best IN-LIBRARY, genuinely vegan, genuinely edible-in-bulk staples,
// measured in a7-survivors-v2 (g protein per 100 kcal):
const STAPLES = [
  ['Seeds, pumpkin seeds (pepitas), raw', 29.9, 515],
  ['Seeds, hemp seed, hulled', 31.6, 553],
  ['Oats', 16.9, 389],
  ['Buckwheat', 13.2, 343],
  ['Quinoa, uncooked', 14.1, 368],
  ['Seeds, sunflower seed kernels, dried', 20.8, 584],
  ['Flaxseed, ground', 18.0, 514],
  ['Chia seeds, dry, raw', 17.0, 490],
];
console.log('\n=== best in-library vegan bulk staples ===');
for (const [n, p, k] of STAPLES) console.log(`${((p / k) * 100).toFixed(2)}\t${p}g/${k}kcal\t${n}`);
const bestStaple = Math.max(...STAPLES.map(([, p, k]) => (p / k) * 100));
console.log('best staple density:', bestStaple.toFixed(2), 'g P/100 kcal');

console.log('\n=== VERDICT ARITHMETIC ===');
for (const r of rows) {
  const deliverable = bestStaple * r.targetKcal / 100;   // whole day from the single best staple
  console.log(`${r.label}: need ${r.req.toFixed(0)}g P in ${r.targetKcal} kcal (${r.reqDens.toFixed(2)} g/100kcal). ` +
    `Whole day of the densest staple (${bestStaple.toFixed(2)}) yields ${deliverable.toFixed(0)}g -> ` +
    `shortfall ${(r.req - deliverable).toFixed(0)}g (${(100 * (1 - deliverable / r.req)).toFixed(0)}% short). ` +
    `Fat from that: ${((r.targetKcal / 515) * 45.8).toFixed(0)}g vs band ${r.m.fatLo}-${r.m.fatHi}g`);
}
