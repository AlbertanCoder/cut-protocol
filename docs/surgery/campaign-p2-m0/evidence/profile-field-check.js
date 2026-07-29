#!/usr/bin/env node
/**
 * profile-field-check — run the witness's forcing profile through the APP'S OWN
 * validator, field by field, and do the same for the proposed translation.
 *
 * READ-ONLY. No server boot, no HTTP, no database write, no spend. It requires
 * `backend/src/routes/profile.js` and calls the `validateProfileFields` function
 * that module already exports for its unit tests — the same function the live
 * PUT /api/profile runs. Inference is what authored the original mismatch; this
 * asks the code instead.
 *
 * Checks THREE things, because a field can fail in three different ways:
 *   1. VALIDATOR   — does validateProfileFields() name it?
 *   2. WHITELIST   — is it in PROFILE_FIELDS? A field that is not on that list
 *                    is not rejected, it is SILENTLY DROPPED. That is the worse
 *                    failure: the request succeeds and the value vanishes.
 *   3. VOCABULARY  — for the enum-ish fields, is the value a real key?
 *
 * Run:  node docs/surgery/campaign-p2-m0/evidence/profile-field-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTE = path.join(REPO, 'backend', 'src', 'routes', 'profile.js');

const route = require(ROUTE);
const { validateProfileFields } = route;
const { OCCUPATION_BY_KEY, TRAINING_BY_KEY } = require(
  path.join(REPO, 'backend', 'src', 'lib', 'activityData.js')
);
const { DIETARY_STYLES } = require(path.join(REPO, 'backend', 'src', 'lib', 'dietaryFilter.js'));

// PROFILE_FIELDS is not exported; read it out of the source rather than
// retyping it, so this check cannot drift from the file it is checking.
const src = fs.readFileSync(ROUTE, 'utf8');
const listMatch = /const PROFILE_FIELDS = \[([\s\S]*?)\];/.exec(src);
if (!listMatch) {
  console.error('could not locate PROFILE_FIELDS in the route source — aborting rather than guessing');
  process.exit(2);
}
const PROFILE_FIELDS = listMatch[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ''));

// ---- the two candidates ----------------------------------------------------

// EXACTLY as it stands in scripts/surgery/witness.js today. Frozen Tier A.
const FROZEN = {
  sex: 'male',
  age: 34,
  heightCm: 180,
  weightKg: 88,
  occupationKey: 'carpenter',
  trainingStyle: 'hypertrophy',
  minutesPerSession: 60,
  rateLbPerWeek: 1.0,
  dietaryStyle: 'omnivore',
  allergies: ['gluten', 'soy'],
  unitPref: 'metric',
};

// The translation proposed in ASK M1.1-a / ASK campaign.6. Same meaning, the
// app's vocabulary. NOT applied to witness.js — this script only measures it.
const PROPOSED = {
  sex: 'M',
  age: 34,
  heightCm: 180,
  startWeightKg: 88,
  occupationKey: 'carpenter-finish',
  trainingStyle: 'weights',
  minutesPerSession: 60,
  rateLbPerWeek: 1.0,
  // 'omnivore' is NOT in DIETARY_STYLES — the sixth mismatch, and the one the
  // five-field proposal in ASK M1.1-a / campaign.6 would have missed. The app's
  // vocabulary is none|mediterranean|vegetarian|vegan|paleo|keto|carnivore|
  // halal|kosher, and "eats everything, no style restriction" is 'none'. Same
  // meaning as omnivore, and it keeps the profile non-keto as the order requires.
  dietaryStyle: 'none',
  excludedFoods: ['gluten', 'soy'],
  unitPref: 'metric',
};

function report(label, obj) {
  console.log(`\n=== ${label} ===`);
  const errs = validateProfileFields(obj) || {};
  const keys = Object.keys(obj);
  let rejected = 0;
  let dropped = 0;
  let ok = 0;

  for (const k of keys) {
    const onList = PROFILE_FIELDS.includes(k);
    const err = errs[k];
    let verdict;
    if (err) {
      verdict = 'REJECTED   ';
      rejected++;
    } else if (!onList) {
      verdict = 'DROPPED    ';
      dropped++;
    } else {
      verdict = 'ok         ';
      ok++;
    }
    const note = err ? ` — ${String(err).slice(0, 62)}` : onList ? '' : ' — not in PROFILE_FIELDS; silently discarded';
    console.log(`  ${verdict} ${k.padEnd(18)} ${JSON.stringify(obj[k])}${note}`);
  }

  // Errors the validator raised for fields we did not send at all.
  for (const k of Object.keys(errs)) {
    if (!keys.includes(k)) console.log(`  REJECTED    ${k.padEnd(18)} (not sent) — ${String(errs[k]).slice(0, 62)}`);
  }

  console.log(`  --> ${ok} ok, ${rejected} rejected, ${dropped} silently dropped, of ${keys.length} sent`);
  return { ok, rejected, dropped };
}

console.log('vocabulary probes (the app\'s own lookup tables):');
console.log(`  OCCUPATION_BY_KEY["carpenter"]        ${OCCUPATION_BY_KEY.carpenter ? 'FOUND' : 'NOT A KEY'}`);
console.log(`  OCCUPATION_BY_KEY["carpenter-finish"] ${OCCUPATION_BY_KEY['carpenter-finish'] ? 'FOUND' : 'NOT A KEY'}`);
console.log(`  TRAINING_BY_KEY["hypertrophy"]        ${TRAINING_BY_KEY.hypertrophy ? 'FOUND' : 'NOT A KEY'}`);
console.log(`  TRAINING_BY_KEY["weights"]            ${TRAINING_BY_KEY.weights ? 'FOUND' : 'NOT A KEY'}`);
console.log(`  valid trainingStyle keys             ${Object.keys(TRAINING_BY_KEY).join(' | ')}`);
console.log(`  DIETARY_STYLES includes "omnivore"   ${JSON.stringify(DIETARY_STYLES).includes('omnivore') ? 'YES' : 'NO'}`);
console.log(`  PROFILE_FIELDS (${PROFILE_FIELDS.length}): ${PROFILE_FIELDS.join(', ')}`);

const a = report('FROZEN — witness.js as it stands today', FROZEN);
const b = report('PROPOSED — the translation, measured not applied', PROPOSED);

console.log('\n=== SUMMARY ===');
console.log(`  frozen   : ${a.ok} ok, ${a.rejected} rejected, ${a.dropped} silently dropped`);
console.log(`  proposed : ${b.ok} ok, ${b.rejected} rejected, ${b.dropped} silently dropped`);
console.log(
  b.rejected === 0 && b.dropped === 0
    ? '  the proposed translation is accepted whole by the app\'s own validator.'
    : '  the proposed translation is NOT yet clean — see above.'
);
