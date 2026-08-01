/* A7 — required protein density vs achievable, using the app's OWN engine
   for the bands. Representative every-protein-walled personas. */
const BMR = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/bmrEngine.js');
console.log('bmrEngine exports:', Object.keys(BMR).join(', '));

// personas.mjs IMPOSSIBLE/every-protein-walled: rate 2 lb/wk, proteinPriority,
// body from BMI 17-45 over height 160-199 (M) / 148-184 (F), bodyFat ~45% of time.
const CASES = [
  { label: 'M 180cm 85kg bf20', sex: 'M', age: 32, heightCm: 180, weightKg: 85, bodyFatPct: 20 },
  { label: 'M 175cm 95kg bf28', sex: 'M', age: 41, heightCm: 175, weightKg: 95, bodyFatPct: 28 },
  { label: 'M 190cm 78kg bf12', sex: 'M', age: 26, heightCm: 190, weightKg: 78, bodyFatPct: 12 },
  { label: 'F 165cm 70kg bf30', sex: 'F', age: 35, heightCm: 165, weightKg: 70, bodyFatPct: 30 },
  { label: 'F 172cm 62kg bf22', sex: 'F', age: 29, heightCm: 172, weightKg: 62, bodyFatPct: 22 },
];

const LB = 2.20462262;
console.log('\ncase\tLBM_lb\ttargetKcal\tPband_lo-hi\tPmid\tPrequired(0.85*mid)\treqDens g/100kcal');
const out = [];
for (const c of CASES) {
  const profile = {
    ...c, occupationKey: 'office_worker', trainingStyle: 'weights', minutesPerSession: 45,
    rateLbPerWeek: 2, rateAcknowledged: true, unitPref: 'metric', excludedFormulas: [],
    dietaryStyle: 'vegan',
  };
  let res = null;
  for (const fn of ['computeAll', 'computeEngine', 'computeMacros', 'compute']) {
    if (typeof BMR[fn] === 'function') {
      try { res = { fn, v: BMR[fn](profile) }; break; } catch (e) { res = { fn, err: e.message }; }
    }
  }
  console.log(`\n--- ${c.label} via ${res && res.fn} ---`);
  if (res && res.err) { console.log('  ERR', res.err); continue; }
  const v = res && res.v;
  console.log('  keys:', v ? Object.keys(v).join(', ') : 'none');
  console.log('  ', JSON.stringify(v).slice(0, 900));
  const lbmLb = (c.weightKg * (1 - c.bodyFatPct / 100)) * LB;
  const mid = lbmLb * 1.195;          // BRIEF: protein band lbm_lb x 1.14..1.25
  const req = 0.85 * mid;             // BRIEF: no more than 15% short of midpoint
  out.push({ label: c.label, lbmLb, mid, req, v });
}

console.log('\n=== DERIVED: required protein density ===');
console.log('case\tLBM_lb\tPmid_g\tPreq_g\ttargetKcal\treqDens(g P/100kcal)');
for (const o of out) {
  const tk = o.v && (o.v.targetKcal ?? o.v.target ?? (o.v.macros && o.v.macros.targetKcal));
  const dens = tk ? (o.req / tk) * 100 : null;
  console.log(`${o.label}\t${o.lbmLb.toFixed(1)}\t${o.mid.toFixed(0)}\t${o.req.toFixed(0)}\t${tk ?? '?'}\t${dens ? dens.toFixed(2) : '?'}`);
}
