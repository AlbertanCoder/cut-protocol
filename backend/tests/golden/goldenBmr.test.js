// Golden BMR lock — fleet finding tests-quality-3.
//
// WHY THIS FILE EXISTS (2026-07-23):
// `tests/golden/fixtures.js` has computed a `bmr` section since Stage A0 v2 and
// `engine-baseline.golden.json` has carried six committed BMR snapshots ever
// since. Nothing ever compared them. goldenBaseline.test.js walked a HAND-WRITTEN
// section list — ["solver", "grocery", "trend", "diary"] — and `bmr` was simply
// never added to it. A grep of that file for "bmr" returned zero matches. So the
// number that materializes every user's Profile.targetKcal was "locked" by a
// baseline no test read: the engine could have drifted by any amount, in any
// formula, and CI would have stayed green.
//
// Two fixes landed together:
//   1. goldenBaseline.test.js now derives its section list from the golden file's
//      OWN keys, so a newly added section can never again be silently uncompared.
//   2. this file: an explicit, per-profile, per-formula BMR lock with failure
//      messages that name the profile and the formula that moved.
//
// The lock is EXACT, not tolerant — every locked field is an integer produced by
// pure arithmetic on fixed inputs (no RNG, no DB, no clock), so "within 1 kcal"
// would only buy room for a real bug to hide. The armed-ness test below proves a
// one-unit drift in ANY locked field fails.
//
// Regenerate the committed golden ONLY on an intended engine change, and review
// the diff line by line — a BMR diff is a diff in everybody's calorie target:
//   cd backend && BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline().then(o=>require('fs').writeFileSync('tests/golden/engine-baseline.golden.json', JSON.stringify(o,null,2)+'\n'))"

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Same guard as goldenBaseline.test.js: pin the deterministic path regardless of
// the ambient shell. computeEnergy is pure, but a stray BRAIN=on must never be
// able to change what "the locked baseline" means.
process.env.BRAIN = "off";

const { computeEnergy, FORMULA_KEYS } = require("../../src/lib/bmrEngine.js");
const { BMR_FIXTURES } = require("./fixtures.js");

const GOLDEN_PATH = path.join(__dirname, "engine-baseline.golden.json");
const REGEN = `cd backend && BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline().then(o=>require('fs').writeFileSync('tests/golden/engine-baseline.golden.json', JSON.stringify(o,null,2)+'\\n'))"`;

const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
const LOCKED = golden.bmr;

// Sanity ranges for the structural check. Deliberately wide — these exist to
// catch a catastrophically broken engine being locked in by a careless
// regenerate, not to second-guess the formulas.
const RMR_MIN = 800;
const RMR_MAX = 4000;

/** The engine's answer for one fixture, reduced to the load-bearing numbers. */
function snapshot(fixture) {
  const e = computeEnergy(fixture.profile, fixture.weightKg);
  return {
    name: fixture.name,
    rmr: e.rmr,
    includedCount: e.includedCount,
    spreadLo: e.spreadLo,
    spreadHi: e.spreadHi,
    included: e.rows.filter((r) => !r.excluded).map((r) => ({ key: r.key, v: Math.round(r.v) })),
  };
}

/**
 * Assert an engine snapshot equals a locked baseline entry, EXACTLY, with a
 * message that names what moved. Shared by the real per-fixture tests and by the
 * armed-ness test, so "the check the suite runs" and "the check we prove fires"
 * are literally the same code.
 */
function compareSnapshot(actual, expected) {
  const who = expected.name;
  const fix = `\nIf this change is intentional, regenerate the baseline and review the diff:\n  ${REGEN}`;

  assert.equal(
    actual.rmr, expected.rmr,
    `BMR drift — "${who}": the mean RMR moved ${expected.rmr} → ${actual.rmr} kcal. ` +
    `This number materializes Profile.targetKcal for every user.${fix}`
  );
  assert.equal(
    actual.includedCount, expected.includedCount,
    `BMR drift — "${who}": ${expected.includedCount} formulas used to count toward the mean, now ${actual.includedCount}. ` +
    `A formula was added to / removed from DEFAULT_ENABLED, or an applicability gate moved.${fix}`
  );
  assert.equal(
    actual.spreadLo, expected.spreadLo,
    `BMR drift — "${who}": spreadLo moved ${expected.spreadLo} → ${actual.spreadLo} kcal.${fix}`
  );
  assert.equal(
    actual.spreadHi, expected.spreadHi,
    `BMR drift — "${who}": spreadHi moved ${expected.spreadHi} → ${actual.spreadHi} kcal.${fix}`
  );

  assert.deepEqual(
    actual.included.map((r) => r.key), expected.included.map((r) => r.key),
    `BMR drift — "${who}": the INCLUDED formula set (or its order) changed.${fix}`
  );

  for (let i = 0; i < expected.included.length; i++) {
    assert.equal(
      actual.included[i].v, expected.included[i].v,
      `BMR drift — "${who}": formula "${expected.included[i].key}" moved ` +
      `${expected.included[i].v} → ${actual.included[i].v} kcal. A published constant changed.${fix}`
    );
  }
}

test("golden BMR: the locked baseline covers every BMR fixture, in order", () => {
  assert.ok(Array.isArray(LOCKED), `engine-baseline.golden.json has no "bmr" array.${"\n"}Regenerate:\n  ${REGEN}`);
  assert.equal(
    LOCKED.length, BMR_FIXTURES.length,
    `${BMR_FIXTURES.length} BMR fixtures but ${LOCKED.length} locked baseline entries — ` +
    `a fixture was added or removed without regenerating the golden, which would leave it unlocked.\n  ${REGEN}`
  );
  assert.deepEqual(
    LOCKED.map((e) => e.name), BMR_FIXTURES.map((f) => f.name),
    `fixture names/order drifted from the locked baseline — the per-fixture comparisons below would be checking the wrong profiles.\n  ${REGEN}`
  );
});

// One test per profile so a failure names the profile in the test title, not
// just in the diff. These are the assertions tests-quality-3 was missing.
for (let i = 0; i < BMR_FIXTURES.length; i++) {
  const fixture = BMR_FIXTURES[i];
  test(`golden BMR: "${fixture.name}" — bmrEngine matches the locked baseline exactly`, () => {
    compareSnapshot(snapshot(fixture), LOCKED[i]);
  });
}

test("golden BMR: the lock is armed — a one-unit drift in any locked field fails the comparison", () => {
  // A golden test that cannot fail is worse than no test: it is a green light
  // wired to nothing. Rather than trust that the assertions above would fire,
  // prove it — feed compareSnapshot a deliberately wrong baseline and require a
  // throw for every locked field. This runs on every CI run, forever, so the lock
  // can never be quietly disarmed (e.g. by softening compareSnapshot to a
  // no-op or a tolerance wide enough to swallow real drift).
  //
  // Deliberately SYNTHETIC: `actual` is a clone of the locked entry, not the
  // engine's output. "Is the comparison armed?" and "did the engine drift?" must
  // be independent signals — if this test used the live engine it would also go
  // red on real drift, and a genuinely disarmed comparison would be impossible to
  // distinguish from a genuinely moved constant.
  const locked = LOCKED[0];
  const actual = JSON.parse(JSON.stringify(locked));

  // Control: an identical pair must pass, or the drift checks below prove nothing.
  compareSnapshot(actual, locked);

  for (const field of ["rmr", "includedCount", "spreadLo", "spreadHi"]) {
    assert.throws(
      () => compareSnapshot(actual, { ...locked, [field]: locked[field] + 1 }),
      assert.AssertionError,
      `compareSnapshot accepted a +1 drift in "${field}" — the BMR lock is NOT armed for that field.`
    );
  }

  // A single published constant shifting by 1 kcal (e.g. Mifflin's +5/-161 term).
  assert.throws(
    () => compareSnapshot(actual, {
      ...locked,
      included: locked.included.map((r, j) => (j === 0 ? { ...r, v: r.v + 1 } : r)),
    }),
    assert.AssertionError,
    "compareSnapshot accepted a +1 kcal drift in a single formula value — the per-formula lock is NOT armed."
  );

  // A formula silently dropping out of the mean.
  assert.throws(
    () => compareSnapshot(actual, { ...locked, included: locked.included.slice(1) }),
    assert.AssertionError,
    "compareSnapshot accepted a formula disappearing from the included set — the lock is NOT armed."
  );

  // A formula being swapped for a different one (same count, same values).
  assert.throws(
    () => compareSnapshot(actual, {
      ...locked,
      included: locked.included.map((r, j) => (j === 0 ? { ...r, key: `${r.key}-swapped` } : r)),
    }),
    assert.AssertionError,
    "compareSnapshot accepted a renamed/swapped formula key — the lock is NOT armed."
  );
});

test("golden BMR: the locked values are structurally sane (a careless regenerate can't lock in nonsense)", () => {
  // Regenerating a golden always makes it pass — that is the one structural
  // weakness of every golden test. These bounds are the backstop: nonsense
  // (zero, negative, NaN-stringified, a formula counted twice, a spread that
  // doesn't bracket the mean) can never become the new "correct" answer silently.
  const seenCounts = new Set();

  for (const e of LOCKED) {
    const who = e.name;
    assert.equal(typeof who, "string", "a locked BMR entry has no name");
    assert.ok(Number.isInteger(e.rmr), `"${who}": rmr ${e.rmr} is not an integer`);
    assert.ok(e.rmr >= RMR_MIN && e.rmr <= RMR_MAX, `"${who}": rmr ${e.rmr} kcal is outside the plausible ${RMR_MIN}–${RMR_MAX} band`);
    assert.ok(Number.isInteger(e.spreadLo) && Number.isInteger(e.spreadHi), `"${who}": spread bounds are not integers`);
    assert.ok(e.spreadLo <= e.rmr && e.rmr <= e.spreadHi, `"${who}": spread ${e.spreadLo}–${e.spreadHi} does not bracket the mean ${e.rmr}`);

    assert.ok(Array.isArray(e.included), `"${who}": included is not an array`);
    assert.equal(e.included.length, e.includedCount, `"${who}": includedCount ${e.includedCount} disagrees with ${e.included.length} listed formulas`);
    assert.ok(e.includedCount >= 3, `"${who}": only ${e.includedCount} formulas in the mean — a single-estimator "average" is not the documented model`);

    const keys = e.included.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, `"${who}": a formula is counted twice: ${keys.join(", ")}`);
    for (const r of e.included) {
      assert.ok(FORMULA_KEYS.includes(r.key), `"${who}": "${r.key}" is not a formula bmrEngine knows about`);
      assert.ok(Number.isInteger(r.v) && r.v > 0, `"${who}": formula "${r.key}" locked at a non-positive/non-integer ${r.v}`);
      assert.ok(r.v >= e.spreadLo && r.v <= e.spreadHi, `"${who}": formula "${r.key}" value ${r.v} falls outside the locked spread ${e.spreadLo}–${e.spreadHi}`);
    }

    // rmr is the mean of the UNROUNDED formula values, then rounded, so it can
    // differ from the mean of the rounded values by at most 1.0 kcal. Anything
    // larger means rmr was not derived from this formula set at all.
    const meanOfRounded = e.included.reduce((s, r) => s + r.v, 0) / e.included.length;
    assert.ok(
      Math.abs(meanOfRounded - e.rmr) <= 1.0,
      `"${who}": locked rmr ${e.rmr} is not the mean of its locked formulas (${meanOfRounded.toFixed(2)}) — the snapshot is internally inconsistent`
    );

    seenCounts.add(e.includedCount);
  }

  // Coverage the fixture set is supposed to provide: at least one profile where
  // body fat is unknown (LBM formulas hidden) and one where it is known (they
  // apply). Without both, the bodyFatPct gate — the branch that silently
  // inflated protein targets before Phase 3 — would be locked by nothing.
  assert.ok([...seenCounts].some((n) => n <= 4), "no locked profile has the LBM formulas hidden (bodyFatPct unknown) — that gate is unlocked");
  assert.ok([...seenCounts].some((n) => n >= 6), "no locked profile has the LBM formulas applied (bodyFatPct known) — that gate is unlocked");
});
