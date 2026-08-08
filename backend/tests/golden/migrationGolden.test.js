// Light-migration Phase 1 — the judge.
//
// Compares the live engine's derived-number chain against the committed
// snapshots in MIGRATION/golden/, per profile, EXACTLY.
//
// What this guards that nothing else does: goldenBmr.test.js locks the BMR
// average; this locks everything downstream of it — the daily target, the floor
// clamp, the achievable rate, the safety verdict, and all three macro ranges.
// Between them the whole chain from body measurements to "eat this many
// calories" is pinned.
//
// The lock is exact. Every value is integer or fixed-precision arithmetic over
// fixed inputs — no RNG, no DB, no clock — so a tolerance would only create room
// for a real drift to hide inside.
//
// If this fails, DO NOT regenerate to make it pass. Read the diff: a change here
// is a change to what somebody is told to eat.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// Pure arithmetic either way, but pin the deterministic path regardless of the
// ambient shell — the same guard goldenBaseline.test.js uses.
process.env.BRAIN = "off";

const { PROFILES, capture, captureAll, goldenPathFor } = require("./migrationProfiles.js");

const REGEN = "cd backend && node tests/golden/migrationProfiles.js --write";

/**
 * Every leaf difference between two snapshots, as dotted paths. Returns [] when
 * identical. Arrays compare by index; a length change is reported as its own
 * difference so a dropped formula row can't hide behind a shifted index.
 */
function diffLeaves(actual, expected, path = "") {
  const out = [];

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      out.push({ path, expected, actual });
      return out;
    }
    if (actual.length !== expected.length) {
      out.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    }
    const n = Math.max(actual.length, expected.length);
    for (let i = 0; i < n; i++) {
      out.push(...diffLeaves(actual[i], expected[i], `${path}[${i}]`));
    }
    return out;
  }

  const bothObjects =
    expected && actual && typeof expected === "object" && typeof actual === "object";
  if (bothObjects) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      out.push(...diffLeaves(actual[k], expected[k], path ? `${path}.${k}` : k));
    }
    return out;
  }

  if (!Object.is(actual, expected)) out.push({ path, expected, actual });
  return out;
}

function describe(diffs, slug) {
  const lines = diffs.slice(0, 12).map(
    (d) => `    ${d.path}\n        committed: ${JSON.stringify(d.expected)}\n        engine now: ${JSON.stringify(d.actual)}`
  );
  const more = diffs.length > 12 ? `\n    …and ${diffs.length - 12} more` : "";
  return (
    `\n\n  ${slug} — ${diffs.length} value(s) moved:\n\n` +
    lines.join("\n") +
    more +
    `\n\n  A diff here is a diff in somebody's calorie target. Read it before you regenerate.` +
    `\n  Intended engine change? ${REGEN}\n`
  );
}

// ── the lock ──────────────────────────────────────────────────────────────

for (const fixture of PROFILES) {
  test(`golden: ${fixture.slug} — derived numbers unchanged`, () => {
    const file = goldenPathFor(fixture.slug);
    assert.ok(
      fs.existsSync(file),
      `Missing committed golden for ${fixture.slug}.\n  Expected: ${file}\n  Generate it with: ${REGEN}`
    );

    const committed = JSON.parse(fs.readFileSync(file, "utf8"));
    const live = capture(fixture);
    const diffs = diffLeaves(live, committed);

    assert.equal(diffs.length, 0, diffs.length ? describe(diffs, fixture.slug) : "");
  });
}

// ── coverage: the fixture set still covers what it claims to ──────────────

test("golden: the runbook's ten cases are all present", () => {
  const slugs = PROFILES.map((p) => p.slug);
  // Case 8 is two profiles (the accepted age band is 18–100), and 11 is the
  // stated keto addition — see the header of migrationProfiles.js.
  assert.equal(slugs.length, 12, `expected 12 profiles, found ${slugs.length}: ${slugs.join(", ")}`);
  assert.equal(new Set(slugs).size, 12, "duplicate slug — every fixture needs its own committed file");

  const committedFiles = PROFILES.filter((p) => fs.existsSync(goldenPathFor(p.slug)));
  assert.equal(
    committedFiles.length, 12,
    `${12 - committedFiles.length} profile(s) have no committed golden. ${REGEN}`
  );
});

test("golden: the fixture set exercises every branch it was built for", () => {
  const all = captureAll();

  const floored = all.filter((s) => s.target.floored);
  assert.ok(floored.length > 0, "no fixture hits the calorie floor — the clamp is unguarded");

  const unsafe = all.filter((s) => s.rateSafety.unsafe);
  assert.ok(unsafe.length > 0, "no fixture trips the rate-safety rail — the acknowledgement path is unguarded");

  const bfKnown = all.filter((s) => !s.macros.bfAssumed);
  const bfAssumed = all.filter((s) => s.macros.bfAssumed);
  assert.ok(bfKnown.length > 0, "no fixture supplies a real body fat % — the LBM formulas are unguarded");
  assert.ok(bfAssumed.length > 0, "no fixture omits body fat % — the assumed-LBM path is unguarded");

  // The keto branch inverts the macro model: carbs capped, fat takes the rest.
  const keto = all.find((s) => s.inputs.dietaryStyle === "keto");
  assert.ok(keto, "the keto fixture is gone — half of computeMacros is unguarded");
  assert.ok(
    keto.macros.carbMid <= 30,
    `keto fixture is not actually ketogenic (carbMid ${keto.macros.carbMid} g) — the branch may have stopped firing`
  );

  const noTraining = all.filter((s) => s.energy.trainingKcalPerDay === 0);
  assert.ok(noTraining.length > 0, "no fixture has training off — the zero-MET path is unguarded");
});

// ── armed-ness: prove the lock actually bites ─────────────────────────────
//
// A golden test that cannot fail is decorative. This perturbs one field by the
// smallest possible amount and asserts the comparator rejects it. If this test
// ever passes trivially, the lock above is not protecting anything.

test("golden: the lock is armed — a one-kcal drift is caught", () => {
  const snap = capture(PROFILES[0]);

  const drifted = structuredClone(snap);
  drifted.target.target += 1;
  const d1 = diffLeaves(drifted, snap);
  assert.equal(d1.length, 1, "a 1 kcal target drift produced no single clean difference");
  assert.equal(d1[0].path, "target.target");

  const macroDrift = structuredClone(snap);
  macroDrift.macros.proteinLo += 1;
  assert.equal(diffLeaves(macroDrift, snap).length, 1, "a 1 g protein drift was not caught");

  const formulaDrift = structuredClone(snap);
  formulaDrift.energy.formulas[0].kcal += 1;
  const d3 = diffLeaves(formulaDrift, snap);
  assert.equal(d3.length, 1, "a 1 kcal drift in a single BMR formula was not caught");
  assert.match(d3[0].path, /^energy\.formulas\[0\]\.kcal$/);

  // A dropped formula row must be caught as a length change, not swallowed.
  const dropped = structuredClone(snap);
  dropped.energy.formulas.pop();
  const d4 = diffLeaves(dropped, snap);
  assert.ok(
    d4.some((d) => d.path === "energy.formulas.length"),
    "dropping a BMR formula row was not reported as a length change"
  );

  // And identical input must produce zero differences, or the comparator is
  // simply always-failing, which would be just as useless.
  assert.equal(diffLeaves(capture(PROFILES[0]), snap).length, 0, "capture is not deterministic");
});
