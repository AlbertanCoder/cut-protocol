// ── Wave 6 · adaptive-tdee-2: the materialized target drifts by clock alone ──
//
// THE BUG. `Profile.targetKcal` is a CACHE of the live resolver, refreshed only
// on WRITE paths (a weigh-in, a diary row, a profile edit). But the resolver's
// answer also depends on `asOf`: the estimator's look-back window slides, a
// weigh-in goes stale, the step-cap walk gains a checkpoint. So a user who
// neither weighed in nor edited anything for a week could open the Plan screen
// (reads the stored number) and the Engine screen (resolves live) and be shown
// two different calorie targets. Two numbers, one body.
//
// THE FIX, locked below: reconcile ON READ. The LIVE RESOLVER is authoritative;
// when the stored value disagrees the resolver wins, the row is refreshed, and
// the correction is LOGGED so drift is diagnosable rather than mysterious.
//
// No database is touched: src/lib/prisma.js is stubbed in the module cache
// before profileTarget.js loads, so PrismaClient is never even constructed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { addDays } = require("../src/lib/dates.js");
const { KCAL_PER_KG } = require("../src/lib/expenditureEstimator.js");

// ── prisma stub ──────────────────────────────────────────────────────────
const db = { profile: null, weighins: [], mealLogs: [], updates: [] };
const fakePrisma = {
  profile: {
    findUnique: async () => (db.profile ? { ...db.profile } : null),
    update: async ({ data }) => {
      db.updates.push(data);
      db.profile = { ...db.profile, ...data };
      return { ...db.profile };
    },
  },
  weighin: { findMany: async () => db.weighins.map((w) => ({ ...w })) },
  mealLog: { findMany: async () => db.mealLogs.map((m) => ({ ...m })) },
};
const prismaPath = require.resolve("../src/lib/prisma.js");
const stub = new Module(prismaPath);
stub.filename = prismaPath;
stub.loaded = true;
stub.exports = { prisma: fakePrisma };
require.cache[prismaPath] = stub;

const { recomputeTarget, reconcileTarget } = require("../src/lib/profileTarget.js");
const { resolveAppliedTarget } = require("../src/lib/adaptiveTarget.js");

// ── fixture ──────────────────────────────────────────────────────────────
const BASE_PROFILE = {
  userId: "u1",
  sex: "M", age: 34, heightCm: 180, bodyFatPct: 22,
  occupationKey: "desk-office", activityOverride: null,
  sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
  rateLbPerWeek: 1.0, floorKcal: null, excludedFormulas: [],
  startWeightKg: 98, startDate: "2026-05-01", targetKcal: 2150,
};

function seed({ lastDay = "2026-06-30", days = 56, startKg = 98, burn = 3300, eat = 2300, targetKcal = 2150 } = {}) {
  db.profile = { ...BASE_PROFILE, targetKcal };
  db.weighins = [];
  db.mealLogs = [];
  db.updates = [];
  let mass = startKg;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(lastDay, -i);
    mass += (eat - burn) / KCAL_PER_KG;
    db.weighins.push({ date, weightKg: mass });
    // two rows per day, to exercise the per-day summing in loadHistory
    db.mealLogs.push({ date, kcal: Math.round(eat * 0.6) });
    db.mealLogs.push({ date, kcal: eat - Math.round(eat * 0.6) });
  }
}

/** Capture console.log for the duration of `fn`. */
async function withLog(fn) {
  const lines = [];
  const real = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try { return { result: await fn(), lines }; } finally { console.log = real; }
}

const live = (asOf) => resolveAppliedTarget({
  profile: db.profile, weighins: db.weighins,
  intake: [...db.mealLogs.reduce((m, l) => m.set(l.date, (m.get(l.date) || 0) + l.kcal), new Map())]
    .map(([date, kcal]) => ({ date, kcal })).sort((a, b) => (a.date < b.date ? -1 : 1)),
  asOf,
}).target.target;

// ── the reconciler ───────────────────────────────────────────────────────

test("a stale cached target is corrected on READ — the resolver wins and the row is refreshed", async () => {
  seed({ targetKcal: 1234 }); // an obviously wrong cache
  const expected = live("2026-06-30");
  const { result, lines } = await withLog(() =>
    reconcileTarget("u1", { asOf: "2026-06-30", reason: "test:read" }));

  assert.equal(result.drift.drifted, true);
  assert.equal(result.drift.storedKcal, 1234);
  assert.equal(result.drift.liveKcal, expected);
  assert.equal(result.drift.authority, "live-resolver");
  assert.equal(result.drift.refreshed, true);
  assert.equal(result.target, expected, "the caller is handed the LIVE number, never the cached one");
  assert.equal(db.profile.targetKcal, expected, "and the row is brought into line");
  assert.equal(db.updates.length, 1);
  assert.ok(lines.some((l) => l.startsWith("[target-drift]")), lines.join("\n"));
  assert.ok(lines.some((l) => /stored=1234/.test(l) && new RegExp(`live=${expected}`).test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /trigger=test:read/.test(l)), "the log must name what triggered it");
});

test("REGRESSION (adaptive-tdee-2): the cache goes stale BY CLOCK ALONE, and the read heals it", async () => {
  // Nothing is written. Nothing changes but the date. The stored target was
  // correct for 2026-06-30 and is wrong for 2026-07-14 — which is exactly the
  // gap the planner used to render while the Engine screen showed the truth.
  seed();
  await reconcileTarget("u1", { asOf: "2026-06-30", reason: "test:seed" });
  const settled = db.profile.targetKcal;
  assert.equal(settled, live("2026-06-30"));

  const later = "2026-07-14";
  const liveLater = live(later);
  assert.notEqual(liveLater, settled,
    "fixture must actually drift by clock alone, or this test proves nothing");

  db.updates = [];
  const { result, lines } = await withLog(() =>
    reconcileTarget("u1", { asOf: later, reason: "planner:read" }));
  assert.equal(result.drift.drifted, true);
  assert.equal(result.drift.storedKcal, settled);
  assert.equal(result.drift.liveKcal, liveLater);
  assert.equal(db.profile.targetKcal, liveLater);
  assert.ok(lines.some((l) => /\[target-drift\].*trigger=planner:read/.test(l)), lines.join("\n"));
});

test("when cache and resolver already agree, nothing is written and nothing is logged", async () => {
  seed();
  await reconcileTarget("u1", { asOf: "2026-06-30", reason: "test:seed" });
  db.updates = [];
  const { result, lines } = await withLog(() =>
    reconcileTarget("u1", { asOf: "2026-06-30", reason: "test:again" }));
  assert.equal(result.drift.drifted, false);
  assert.equal(result.drift.deltaKcal, 0);
  assert.equal(db.updates.length, 0, "an agreeing read must not write");
  assert.equal(lines.length, 0, "and must not spam the drift log");
});

test("reading repeatedly never walks the target (step cap + reconcile must not compound)", async () => {
  seed({ targetKcal: 1234 });
  const values = [];
  for (let i = 0; i < 5; i++) {
    const r = await reconcileTarget("u1", { asOf: "2026-06-30", reason: `read${i}` });
    values.push(r.target);
  }
  assert.equal(new Set(values).size, 1, `five reads produced ${JSON.stringify(values)}`);
  assert.equal(db.updates.length, 1, "only the first read had anything to correct");
});

test("write:false diagnoses drift without touching the row", async () => {
  seed({ targetKcal: 1234 });
  const { result, lines } = await withLog(() =>
    reconcileTarget("u1", { asOf: "2026-06-30", reason: "audit", write: false }));
  assert.equal(result.drift.drifted, true);
  assert.equal(result.drift.refreshed, false);
  assert.equal(db.profile.targetKcal, 1234, "diagnose-only must leave the cache alone");
  assert.equal(db.updates.length, 0);
  assert.equal(lines.length, 0);
});

test("an already-resolved context is reused rather than re-resolved to a second answer", async () => {
  seed({ targetKcal: 1234 });
  const ctx = resolveAppliedTarget({
    profile: db.profile,
    weighins: db.weighins,
    intake: [...db.mealLogs.reduce((m, l) => m.set(l.date, (m.get(l.date) || 0) + l.kcal), new Map())]
      .map(([date, kcal]) => ({ date, kcal })).sort((a, b) => (a.date < b.date ? -1 : 1)),
    asOf: "2026-06-30",
  });
  const r = await reconcileTarget("u1", { asOf: "2026-06-30", reason: "summary", profile: db.profile, resolved: ctx });
  assert.equal(r.drift.liveKcal, ctx.target.target);
  assert.equal(db.profile.targetKcal, ctx.target.target);
});

test("recomputeTarget still honours its old contract, and carries the reason through", async () => {
  seed({ targetKcal: 1234 });
  const { result, lines } = await withLog(() => recomputeTarget("u1", "2026-06-30", "weighin:create"));
  // the pre-existing shape every caller destructures
  for (const k of ["target", "floor", "floored", "rate", "deficit", "raw", "tdee", "formulaTdee", "tdeeSource", "adaptiveStatus", "safety", "weightKg"]) {
    assert.ok(k in result, `recomputeTarget() must still return ${k}`);
  }
  assert.equal(result.target, live("2026-06-30"));
  assert.ok(lines.some((l) => /trigger=weighin:create/.test(l)), lines.join("\n"));
});

test("no profile → null, not a crash and not a phantom write", async () => {
  db.profile = null; db.weighins = []; db.mealLogs = []; db.updates = [];
  assert.equal(await reconcileTarget("nobody", { asOf: "2026-06-30" }), null);
  assert.equal(db.updates.length, 0);
});

test("the reconciled report exposes WHY the number is what it is", async () => {
  seed({ targetKcal: 1234 });
  const r = await reconcileTarget("u1", { asOf: "2026-06-30", reason: "test" });
  assert.ok(r.confidence, "confidence block must ride along");
  assert.ok(["insufficient", "provisional", "confident", "off"].includes(r.confidence.level));
  assert.ok(r.stepCap && typeof r.stepCap.capKcal === "number", "step-cap state must ride along");
  assert.equal(r.drift.asOf, "2026-06-30");
});
