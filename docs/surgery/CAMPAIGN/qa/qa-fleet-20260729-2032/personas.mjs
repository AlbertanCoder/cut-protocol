/**
 * personas.mjs — the forge. 250 unique strangers, deterministic.
 *
 * Seed = the run_id string, sha256'd to a uint32 (recorded in the output). Same
 * seed ⇒ byte-identical personas.jsonl, so every defect in the report is
 * reproducible by re-running this file.
 *
 * Each persona is sampled independently across the mission's axes and THEN
 * mapped onto the app's real profile vocabulary (PREFLIGHT.md P0.3). A wish the
 * API has no surface for is not silently dropped and is not faked: it is
 * recorded on the persona's own card as `requestedButUnsupported`, and the
 * report keeps those separate from defects.
 *
 *   node personas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, RUN_ID, seedFrom, rng, pick, weighted, intBetween, round1 } from './lib.mjs';

const N = 250;
const SEED_STR = RUN_ID;
const SEED_INT = seedFrom(SEED_STR);

// ── the app's real vocabulary, transcribed from the code in preflight ────────
const RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const DIETARY_STYLES = ['none', 'mediterranean', 'vegetarian', 'vegan', 'paleo', 'keto', 'carnivore', 'halal', 'kosher'];
const TRAINING_STYLES = ['weights', 'mixed', 'sport', 'cardio'];
// The 10 allergy keys the app's own picker offers (GET /api/profile/meta).
const PICKER_ALLERGENS = ['shellfish', 'fish', 'kiwi', 'soy', 'dairy', 'eggs', 'gluten', 'peanuts', 'tree nuts', 'sesame'];

/**
 * Life → occupationKey + training, from the 43 real occupation keys. `activity`
 * is what the persona would SAY; the key is what the app can hear.
 */
const LIVES = [
  { life: 'office worker', occ: 'desk-office', style: 'weights', min: 45, sessions: 3 },
  { life: 'software developer', occ: 'software-tech', style: 'mixed', min: 40, sessions: 3 },
  { life: 'formwork carpenter', occ: 'formwork-concrete', style: 'weights', min: 60, sessions: 4 },
  { life: 'finish carpenter', occ: 'carpenter-finish', style: 'weights', min: 50, sessions: 3 },
  { life: 'nurse on 12s', occ: 'nurse-healthcare', style: 'mixed', min: 30, sessions: 2 },
  { life: 'long-haul trucker', occ: 'driver-truck', style: 'weights', min: 30, sessions: 2 },
  { life: 'cyclist', occ: 'desk-office', style: 'cardio', min: 120, sessions: 6 },
  { life: 'triathlete', occ: 'software-tech', style: 'cardio', min: 150, sessions: 9 },
  { life: 'powerlifter', occ: 'trades-general', style: 'weights', min: 90, sessions: 5 },
  { life: 'weekend warrior', occ: 'accounting-finance', style: 'sport', min: 90, sessions: 2 },
  { life: 'postpartum', occ: 'unemployed-home', style: 'mixed', min: 25, sessions: 3 },
  { life: 'sedentary senior', occ: 'unemployed-home', style: 'cardio', min: 20, sessions: 2 },
  { life: 'student athlete', occ: 'student', style: 'sport', min: 100, sessions: 6 },
  { life: 'shift worker, 2 a.m. meals', occ: 'warehouse', style: 'weights', min: 45, sessions: 3 },
  { life: 'restaurant chef', occ: 'chef-kitchen', style: 'mixed', min: 30, sessions: 2 },
  { life: 'rideshare driver', occ: 'driver-rideshare', style: 'cardio', min: 30, sessions: 3 },
  { life: 'schoolteacher', occ: 'teacher', style: 'mixed', min: 40, sessions: 3 },
  { life: 'warehouse picker', occ: 'warehouse', style: 'mixed', min: 30, sessions: 2 },
  { life: 'electrician', occ: 'electrician', style: 'weights', min: 45, sessions: 3 },
  { life: 'landscaper', occ: 'landscaper', style: 'weights', min: 45, sessions: 3 },
  { life: 'firefighter', occ: 'firefighter', style: 'mixed', min: 75, sessions: 4 },
  { life: 'personal trainer', occ: 'personal-trainer', style: 'weights', min: 75, sessions: 5 },
  { life: 'retail cashier', occ: 'cashier', style: 'cardio', min: 25, sessions: 2 },
  { life: 'security guard', occ: 'security-guard', style: 'weights', min: 40, sessions: 3 },
  { life: 'commercial fisher', occ: 'commercial-fishing', style: 'weights', min: 30, sessions: 2 },
  { life: 'miner', occ: 'mining', style: 'weights', min: 40, sessions: 3 },
];

/** Diet patterns a real customer would name, and where each one lands. */
const DIET_WISHES = [
  { wish: 'none', style: 'none', w: 30 },
  { wish: 'keto', style: 'keto', w: 8 },
  { wish: 'vegetarian', style: 'vegetarian', w: 8 },
  { wish: 'vegan', style: 'vegan', w: 6 },
  { wish: 'mediterranean', style: 'mediterranean', w: 8 },
  { wish: 'paleo', style: 'paleo', w: 5 },
  { wish: 'halal', style: 'halal', w: 5 },
  { wish: 'kosher', style: 'kosher', w: 4 },
  { wish: 'carnivore', style: 'carnivore', w: 2 },
  // Unsupported by DIETARY_STYLES. The persona still WANTS it, so the closest
  // honest mapping is used and the gap is recorded on the card.
  { wish: 'pescatarian', style: null, w: 6, unsupported: 'pescatarian is not one of the 9 dietary styles; expressed instead as walls on pork+beef, which is not the same promise' },
  { wish: 'low-FODMAP', style: null, w: 4, unsupported: 'low-FODMAP is not a dietary style; expressed instead as free-text exclusions (onion, garlic, wheat)' },
];

/** Walls, weighted so 0–2 dominates. `key` is what goes into excludedFoods. */
const WALL_POOL = [
  { wall: 'gluten', key: 'gluten', w: 10, note: 'celiac' },
  { wall: 'soy', key: 'soy', w: 8 },
  { wall: 'shellfish', key: 'shellfish', w: 9 },
  { wall: 'peanut', key: 'peanuts', w: 8 },
  { wall: 'tree nut', key: 'tree nuts', w: 7, note: 'walnut named' },
  { wall: 'dairy', key: 'dairy', w: 10 },
  { wall: 'egg', key: 'eggs', w: 7 },
  { wall: 'fish', key: 'fish', w: 6 },
  { wall: 'sesame', key: 'sesame', w: 5 },
  // Not in the app's 10-key picker; typed as free text. The taxonomy has a
  // `nightshades` and a `red meat` row, so the terms are not inert — but the
  // customer is typing, not ticking, and that difference is worth measuring.
  { wall: 'nightshade', key: 'nightshades', w: 4, freeText: true, note: 'skin condition' },
  { wall: 'cilantro', key: 'cilantro', w: 3, freeText: true, note: 'aversion, not allergy' },
  { wall: 'pork', key: 'pork', w: 5, freeText: true },
  { wall: 'beef', key: 'beef', w: 4, freeText: true },
];

const MACRO_STYLES = ['balanced', 'high-protein', 'low-carb', 'low-fat'];
const CUISINES = ['italian', 'mexican', 'indian', 'thai', 'japanese', 'mediterranean', 'american', 'chinese'];

const UNICODE_NAMES = ['Zoë Ünderscore', '田中 健一', 'Ólafur Þórðarson', 'Mihàľ Ćwiąt', 'Ayşe Gülşen', 'Иван Петров', '🏋️ Max Lift', 'José Ñuñez-O’Brien'];
const LONG_NOTE = 'I react badly to a long list of things and my dietitian told me to write it all out so here it is: no onion, no garlic, no leek, no shallot, no wheat, no barley, no rye, no cow dairy but sheep is fine, no lentils, no chickpeas, and absolutely nothing with cilantro because it tastes like dish soap to me.';

function tierFor(r) {
  return weighted(r, [['EASY', 60], ['HARD', 25], ['IMPOSSIBLE', 10], ['ROBUSTNESS', 5]]);
}

function makePersona(i, r) {
  const tier = tierFor(r);
  const sex = weighted(r, [['M', 55], ['F', 45]]);
  const life = pick(r, LIVES);

  // Age. Under-18s exist ONLY as a parent-managed flag on an adult account —
  // and the app has no such flag (adultGate refuses <18 outright), so the
  // adult account is what is created and the wish is recorded.
  let age = intBetween(r, 19, 78);
  let parentManaged = null;
  if (r() < 0.05) {
    const kidAge = intBetween(r, 12, 17);
    age = intBetween(r, 34, 52);
    parentManaged = { kidAge, note: `managing meals for a ${kidAge}-year-old` };
  }

  // Body. Height then a weight chosen to land on a target BMI in 17-45.
  const heightCm = sex === 'M' ? intBetween(r, 160, 199) : intBetween(r, 148, 184);
  const bmiWant = 17 + r() * 28;
  const weightKg = round1(bmiWant * (heightCm / 100) ** 2);
  const bmi = round1(weightKg / (heightCm / 100) ** 2);
  const bodyFatPct = r() < 0.45 ? intBetween(r, sex === 'M' ? 8 : 16, sex === 'M' ? 34 : 46) : null;

  // Goal.
  const goalKind = weighted(r, [['cut', 62], ['maintain', 12], ['lean bulk', 14], ['recomp', 12]]);
  let rateLbPerWeek;
  if (goalKind === 'cut') rateLbPerWeek = weighted(r, [[0.5, 30], [1, 35], [1.5, 20], [2, 15]]);
  else if (goalKind === 'maintain') rateLbPerWeek = 0.25;
  else rateLbPerWeek = pick(r, [0.25, 0.5]);
  // Goal weight, kept clear of the BMI-16 hard refusal unless the tier wants a
  // gate exercised — a refusal we ASKED for is not a defect.
  const goalBmiWant = goalKind === 'cut' ? Math.max(16.6, bmi - (2 + r() * 6))
    : goalKind === 'lean bulk' ? bmi + (1 + r() * 3) : bmi;
  const goalWeightKg = round1(Math.min(400, Math.max(30, goalBmiWant * (heightCm / 100) ** 2)));

  // Diet.
  const dw = weighted(r, DIET_WISHES.map((d) => [d, d.w]));

  // Walls: 0-4, weighted to 0-2, plus tier pressure.
  let wallCount = weighted(r, [[0, 34], [1, 30], [2, 22], [3, 10], [4, 4]]);
  if (tier === 'HARD') wallCount = Math.max(wallCount, intBetween(r, 2, 4));
  const chosen = [];
  const seen = new Set();
  let guard = 0;
  while (chosen.length < wallCount && guard++ < 60) {
    const w = weighted(r, WALL_POOL.map((x) => [x, x.w]));
    if (seen.has(w.wall)) continue;
    seen.add(w.wall); chosen.push(w);
  }
  // A pescatarian/low-FODMAP wish becomes walls, because that is the only
  // vocabulary available for it.
  const extraWalls = [];
  if (dw.wish === 'pescatarian') for (const k of ['pork', 'beef']) if (!seen.has(k)) { const w = WALL_POOL.find((x) => x.wall === k); seen.add(k); extraWalls.push(w); }
  const allWalls = [...chosen, ...extraWalls];

  const macroStyle = pick(r, MACRO_STYLES);
  const horizon = r() < 0.70 ? 'day' : 'week';
  const mealsPerDay = weighted(r, [[2, 12], [3, 55], [4, 22], [5, 11]]);
  const snacksPerDay = weighted(r, [[0, 24], [1, 42], [2, 26], [3, 8]]);

  const p = {
    idx: i,
    id: `p${String(i).padStart(3, '0')}`,
    tier,
    displayName: `${life.life}, ${age}`,
    story: null,
    // ── what goes over the wire (PUT /api/profile) ─────────────────────────
    profile: {
      sex, age, heightCm,
      startWeightKg: weightKg,
      goalWeightKg,
      occupationKey: life.occ,
      trainingStyle: life.style,
      minutesPerSession: life.min,
      sessionsPerWeek: life.sessions,
      rateLbPerWeek,
      dietaryStyle: dw.style,
      excludedFoods: allWalls.map((w) => w.key),
      mealsPerDay, snacksPerDay,
      unitPref: weighted(r, [['imperial', 62], ['metric', 38]]),
      ...(bodyFatPct != null ? { bodyFatPct, bodyFatSource: pick(r, ['visual-estimate', 'measured']) } : {}),
      ...(r() < 0.30 ? { cuisinePreferences: [pick(r, CUISINES), pick(r, CUISINES)].filter((v, k, a) => a.indexOf(v) === k) } : {}),
    },
    filters: {},
    horizon,
    // ── what the fleet judges against (my vocabulary, not the app's) ───────
    walls: allWalls.map((w) => w.wall),
    freeTextExclusions: [],
    dietaryStyle: dw.style,
    bmi,
    goalKind,
    macroStyle,
    requestedButUnsupported: [],
  };

  if (dw.unsupported) p.requestedButUnsupported.push(dw.unsupported);
  if (parentManaged) {
    p.parentManaged = parentManaged;
    p.requestedButUnsupported.push(`${parentManaged.note}; the app has no parent-managed or dependent flag (adultGate refuses under-18 outright), so only the adult's own plan can be built`);
  }

  // Macro style. The app derives targetKcal and the protein band from stats —
  // there is no client-set macro target — so a macro STYLE is expressed with
  // the only levers that exist, and the shortfall is recorded.
  if (macroStyle === 'high-protein') {
    p.filters.proteinPriority = true;
    p.requestedButUnsupported.push('wanted protein set explicitly in g/lb; the API derives the protein band from LBM (1.14-1.25 g/lb) and accepts no client protein target — only the per-request proteinPriority filter');
  }
  if (macroStyle === 'low-carb' && dw.style !== 'keto') {
    p.requestedButUnsupported.push('wanted a low-carb split without full keto; carbs are the leftover after LBM-derived protein and fat, and only dietaryStyle:"keto" changes that');
  }
  if (macroStyle === 'low-fat') {
    p.requestedButUnsupported.push('wanted a low-fat split; the fat band is fixed at LBM x0.34-0.40 and is not client-settable');
  }

  // Free-text walls: anything outside the app's 10-key picker is TYPED.
  for (const w of allWalls) if (w.freeText) p.freeTextExclusions.push(w.wall === 'nightshade' ? 'nightshades' : w.wall);

  // Soft per-request filters some customers would set.
  if (r() < 0.28) p.filters.maxPrepMin = pick(r, [15, 20, 30, 45]);
  if (r() < 0.22) p.filters.budget = pick(r, ['cheap', 'moderate', 'premium']);
  if (r() < 0.12) p.filters.maxComplexity = intBetween(r, 2, 5);
  if (r() < 0.10) p.filters.maxCostCad = pick(r, [3, 5, 8]);
  if (p.profile.cuisinePreferences) p.filters.cuisines = p.profile.cuisinePreferences;

  // ── tier engineering ───────────────────────────────────────────────────
  if (tier === 'HARD') {
    // Stacked walls + an aggressive rate + a tight prep cap: the family the
    // day-tolerance trigger was built for.
    p.profile.rateLbPerWeek = pick(r, [1.5, 2]);
    p.filters.proteinPriority = true;
    if (r() < 0.5) p.filters.maxPrepMin = pick(r, [15, 20]);
    if (!p.walls.includes('gluten') && r() < 0.5) { p.walls.push('gluten'); p.profile.excludedFoods.push('gluten'); }
    if (!p.walls.includes('soy') && r() < 0.5) { p.walls.push('soy'); p.profile.excludedFoods.push('soy'); }
  }

  if (tier === 'IMPOSSIBLE') {
    p.impossibleKind = weighted(r, [['every-protein-walled', 55], ['floor-vs-rate', 45]]);
    if (p.impossibleKind === 'every-protein-walled') {
      // Wall off every major protein source at once AND go vegan. There is no
      // combination of library rows that can hit an LBM-derived protein band
      // here; a confident "plan" would be a lie.
      p.profile.dietaryStyle = 'vegan';
      p.dietaryStyle = 'vegan';
      const kill = ['soy', 'gluten', 'peanuts', 'tree nuts', 'sesame'];
      p.profile.excludedFoods = [...new Set([...p.profile.excludedFoods, ...kill, 'legumes'])];
      p.walls = [...new Set([...p.walls, 'soy', 'gluten', 'peanut', 'tree nut', 'sesame'])];
      p.freeTextExclusions = [...new Set([...p.freeTextExclusions, 'legumes'])];
      p.profile.rateLbPerWeek = 2;
      p.filters.proteinPriority = true;
      p.story = 'vegan, celiac, and allergic to soy, peanuts, tree nuts and sesame, cutting at 2 lb/wk on a protein-priority plan';
    } else {
      // A floor-clamped target at the most aggressive rate the menu offers,
      // with a stricter user floor on top: the deficit the app cannot honour
      // without breaking its own floor. `rateAcknowledged` is sent because the
      // app 422s otherwise, and the fleet must reach the PLAN to grade it.
      p.profile.rateLbPerWeek = 2;
      p.profile.rateAcknowledged = true;
      p.profile.floorKcal = sex === 'M' ? 1500 : 1200;
      p.filters.proteinPriority = true;
      p.filters.maxPrepMin = 15;
      p.profile.excludedFoods = [...new Set([...p.profile.excludedFoods, 'gluten', 'dairy', 'soy'])];
      p.walls = [...new Set([...p.walls, 'gluten', 'dairy', 'soy'])];
      p.story = 'wants 2 lb/wk off a small frame at the calorie floor, with gluten, dairy and soy all walled off and nothing over 15 minutes to cook';
    }
    p.requestedButUnsupported.push('this request is mathematically unsatisfiable by design — a clear, fast, honest refusal is the pass condition, and a confident plan is a critical honesty defect');
  }

  if (tier === 'ROBUSTNESS') {
    p.robustKind = weighted(r, [['unicode-name', 25], ['long-allergy-note', 25], ['keto-with-carb-target', 20], ['zero-meals', 15], ['nine-meals', 15]]);
    switch (p.robustKind) {
      case 'unicode-name':
        p.unicodeName = pick(r, UNICODE_NAMES);
        p.profile.mealPreferencesNote = `${p.unicodeName} — ${pick(r, ['no 🥜 please', 'зимой люблю супы', '辛いものが好き'])}`;
        break;
      case 'long-allergy-note':
        p.profile.mealPreferencesNote = LONG_NOTE;
        // 300+ characters typed into the ONE freeform field, plus a wall entry
        // deliberately at the 60-char limit.
        p.longExclusion = 'no cow dairy but sheep and goat cheese are completely fine'.slice(0, 60);
        p.profile.excludedFoods = [...p.profile.excludedFoods, p.longExclusion];
        p.requestedButUnsupported.push('typed a 300-character allergy narrative; mealPreferencesNote is freeform text that no filter reads, so none of it constrains the plan');
        break;
      case 'keto-with-carb-target':
        p.profile.dietaryStyle = 'keto';
        p.dietaryStyle = 'keto';
        p.filters.proteinPriority = true;
        p.contradictionNote = 'keto flag set while asking for a high-carb day';
        break;
      case 'zero-meals':
        // mealsPerDay bottoms out at 1 in validation; 0 is the illegal ask, and
        // the pass condition is a named field error, not a 500.
        p.profile.mealsPerDay = 0;
        p.expectRejection = { field: 'mealsPerDay', why: 'validator requires 1-8' };
        break;
      case 'nine-meals':
        p.profile.mealsPerDay = 9;
        p.expectRejection = { field: 'mealsPerDay', why: 'validator requires 1-8' };
        break;
    }
  }

  // The app 422s an unsafe rate unless the tick is in the SAME request. A real
  // customer would tick it; the fleet ticks it too, so the measurement is of the
  // plan and not of a dialog the fleet declined to answer.
  if (p.profile.rateLbPerWeek >= 1.5) p.profile.rateAcknowledged = true;
  // A goal in the 16-18.5 BMI grey zone needs its own ack, and it is a
  // per-REQUEST field (never persisted).
  const goalBmi = goalWeightKg / (heightCm / 100) ** 2;
  if (goalBmi < 18.5) { p.profile.goalWeightAcknowledged = true; p.goalBmi = round1(goalBmi); }

  if (!p.story) {
    p.story = `${life.life}, ${age}${parentManaged ? ` (${parentManaged.note})` : ''}, ${sex === 'M' ? 'male' : 'female'}, ${heightCm} cm / ${weightKg} kg (BMI ${bmi}), ${goalKind}${goalKind === 'cut' || goalKind === 'lean bulk' ? ` at ${p.profile.rateLbPerWeek} lb/wk` : ''}, ${dw.wish} diet, ${p.walls.length ? `avoiding ${p.walls.join(', ')}` : 'no exclusions'}, ${macroStyle}, ${mealsPerDay} meals + ${snacksPerDay} snacks, wants a ${horizon === 'day' ? 'single day' : 'full week'}`;
  }

  // The uniqueness key: the full constraint tuple.
  p.tupleKey = JSON.stringify([
    tier, sex, age, heightCm, weightKg, goalWeightKg, life.occ, life.style,
    p.profile.rateLbPerWeek, p.profile.dietaryStyle, [...p.profile.excludedFoods].sort(),
    p.profile.mealsPerDay, p.profile.snacksPerDay, macroStyle, horizon,
    p.filters.maxPrepMin ?? null, p.filters.budget ?? null, p.filters.proteinPriority ?? null,
    p.robustKind ?? null, p.impossibleKind ?? null,
  ]);
  return p;
}

// ── forge, enforcing tuple uniqueness programmatically ──────────────────────
const r = rng(SEED_INT);
const personas = [];
const keys = new Set();
let attempts = 0;
while (personas.length < N) {
  if (++attempts > N * 200) throw new Error(`could not reach ${N} unique tuples after ${attempts} attempts`);
  const p = makePersona(personas.length, r);
  if (keys.has(p.tupleKey)) continue;
  keys.add(p.tupleKey);
  personas.push(p);
}

fs.writeFileSync(path.join(HOME, 'personas.jsonl'), `${personas.map((p) => JSON.stringify(p)).join('\n')}\n`);

// ── the distribution report ─────────────────────────────────────────────────
const tally = (fn) => personas.reduce((m, p) => { const k = fn(p); if (k == null) return m; (Array.isArray(k) ? k : [k]).forEach((x) => { m[x] = (m[x] || 0) + 1; }); return m; }, {});
const table = (title, obj, denom = N) => {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return `### ${title}\n\n| value | n | % |\n|---|---:|---:|\n${rows.map(([k, v]) => `| ${k} | ${v} | ${(100 * v / denom).toFixed(1)}% |`).join('\n')}\n`;
};

const wallCounts = tally((p) => `${p.walls.length} wall(s)`);
const md = `# Persona distribution — ${N} strangers

- **run_id** \`${RUN_ID}\`
- **seed string** \`${SEED_STR}\` → **seed int** \`${SEED_INT}\` (sha256 → uint32LE, mulberry32)
- **unique constraint tuples** ${keys.size}/${N} — enforced programmatically; ${attempts} draws to fill ${N} slots
- re-running \`node personas.mjs\` reproduces \`personas.jsonl\` byte-for-byte

${table('Difficulty tier', tally((p) => p.tier))}
${table('Horizon requested', tally((p) => p.horizon))}
${table('Goal', tally((p) => p.goalKind))}
${table('Dietary style sent to the API', tally((p) => String(p.profile.dietaryStyle)))}
${table('Walls per persona', wallCounts)}
${table('Wall type (persona-count, multi-count)', tally((p) => p.walls))}
${table('Rate (lb/wk)', tally((p) => String(p.profile.rateLbPerWeek)))}
${table('Macro style', tally((p) => p.macroStyle))}
${table('Sex', tally((p) => p.profile.sex))}
${table('Meals per day', tally((p) => String(p.profile.mealsPerDay)))}
${table('Occupation key', tally((p) => p.profile.occupationKey))}
${table('Robustness sub-kind', tally((p) => p.robustKind))}
${table('Impossible sub-kind', tally((p) => p.impossibleKind))}

### Body spread

| stat | min | median | max |
|---|---:|---:|---:|
| age | ${Math.min(...personas.map((p) => p.profile.age))} | ${personas.map((p) => p.profile.age).sort((a, b) => a - b)[Math.floor(N / 2)]} | ${Math.max(...personas.map((p) => p.profile.age))} |
| BMI | ${Math.min(...personas.map((p) => p.bmi))} | ${personas.map((p) => p.bmi).sort((a, b) => a - b)[Math.floor(N / 2)]} | ${Math.max(...personas.map((p) => p.bmi))} |
| weight kg | ${Math.min(...personas.map((p) => p.profile.startWeightKg))} | ${personas.map((p) => p.profile.startWeightKg).sort((a, b) => a - b)[Math.floor(N / 2)]} | ${Math.max(...personas.map((p) => p.profile.startWeightKg))} |
| height cm | ${Math.min(...personas.map((p) => p.profile.heightCm))} | ${personas.map((p) => p.profile.heightCm).sort((a, b) => a - b)[Math.floor(N / 2)]} | ${Math.max(...personas.map((p) => p.profile.heightCm))} |

### Requested-but-unsupported (product gaps, carried on the persona cards)

${Object.entries(personas.reduce((m, p) => { for (const u of p.requestedButUnsupported) { const k = u.split(';')[0]; m[k] = (m[k] || 0) + 1; } return m; }, {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- **${v} persona(s)** — ${k}`).join('\n')}

- personas carrying at least one unsupported wish: **${personas.filter((p) => p.requestedButUnsupported.length).length}/${N}**
- personas with a parent-managed dependent: **${personas.filter((p) => p.parentManaged).length}** (no API surface exists for this)
- personas typing a free-text wall outside the app's 10-key picker: **${personas.filter((p) => p.freeTextExclusions.length).length}**
`;
fs.writeFileSync(path.join(HOME, 'persona-distribution.md'), md);

console.log(`forged ${personas.length} personas · unique tuples ${keys.size} · seed ${SEED_INT} · ${attempts} draws`);
console.log(`tiers: ${JSON.stringify(tally((p) => p.tier))}`);
console.log(`walls: ${JSON.stringify(wallCounts)}`);
console.log('wrote personas.jsonl + persona-distribution.md');
