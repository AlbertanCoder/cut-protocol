// The verdict's slot signature is implemented THREE times — as prose in
// backend/prisma/schema.prisma (model Plan, verdictSlotSig), as code in
// backend/src/routes/plans.js (the writer), and as code in
// frontend/src/components/PlanTab.jsx (the reader) — and all three must agree.
//
// They fail in a specific and quiet way if they don't. The reader compares the
// signature it computes against the one the writer stored; unequal means "this
// verdict describes a week that no longer exists, don't show it as current". So
// a writer and reader that disagree do not throw, do not log, and do not lose
// data — they just make EVERY verdict look permanently stale, and the feature
// silently reverts to the behaviour it was built to replace.
//
// That is worth a test that reads the other implementation rather than trusting
// a comment, because a comment saying "these must agree" has no way to notice
// when they stop.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { planSlotSig } = require("../src/routes/plans.js");

// A deliberately awkward fixture: out of natural order, a null recipeId, scales
// that need rounding, and a locked row.
const PLAN = {
  slots: [
    { id: "z9", dayOfWeek: 2, slotType: "dinner", slotIndex: 0, recipeId: "r2", proteinScale: 1.25,     sidesScale: 0.5,  locked: false },
    { id: "a1", dayOfWeek: 0, slotType: "breakfast", slotIndex: 0, recipeId: "r1", proteinScale: 1,     sidesScale: 1,    locked: true },
    { id: "m5", dayOfWeek: 1, slotType: "snack", slotIndex: 1, recipeId: null,     proteinScale: 1.0004, sidesScale: 2.9999, locked: false },
  ],
};

test("the signature is the documented recipe, exactly", () => {
  assert.equal(
    planSlotSig(PLAN),
    "0:breakfast:0:r1:1:1|1:snack:1::1:3|2:dinner:0:r2:1.25:0.5",
    "sorted, colon-joined, pipe-separated; null recipeId is an empty string; scales round to 3dp",
  );
});

test("id churn does not stale a verdict — a regenerate recreates rows with new ids", () => {
  const reIded = { slots: PLAN.slots.map((s, i) => ({ ...s, id: `fresh-${i}` })) };
  assert.equal(planSlotSig(reIded), planSlotSig(PLAN));
});

test("a lock toggle does not stale a verdict — it moves no macro", () => {
  const relocked = { slots: PLAN.slots.map((s) => ({ ...s, locked: !s.locked })) };
  assert.equal(planSlotSig(relocked), planSlotSig(PLAN));
});

test("slot order does not matter, but slot CONTENT does", () => {
  const shuffled = { slots: [...PLAN.slots].reverse() };
  assert.equal(planSlotSig(shuffled), planSlotSig(PLAN));

  const swapped = { slots: PLAN.slots.map((s, i) => (i === 0 ? { ...s, recipeId: "DIFFERENT" } : s)) };
  assert.notEqual(planSlotSig(swapped), planSlotSig(PLAN), "swapping a meal MUST stale the verdict");

  const rescaled = { slots: PLAN.slots.map((s, i) => (i === 0 ? { ...s, proteinScale: 1.5 } : s)) };
  assert.notEqual(planSlotSig(rescaled), planSlotSig(PLAN), "re-portioning MUST stale the verdict");
});

test("a plan with no slots array signs as null rather than throwing", () => {
  assert.equal(planSlotSig(null), null);
  assert.equal(planSlotSig({}), null);
  assert.equal(planSlotSig({ slots: "not an array" }), null);
});

// ── the cross-implementation check ───────────────────────────────────────────
// Extracts the FRONTEND's implementation from PlanTab.jsx and runs it against
// the same fixture. Not a text comparison — the two are allowed to be written
// differently, they are not allowed to DISAGREE.
test("the frontend reader computes the identical signature", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "PlanTab.jsx"),
    "utf8",
  );
  const round3Src = src.match(/const round3 = [^\n]+/);
  const sigSrc = src.match(/function planSlotSig\(plan\) \{[\s\S]*?\n\}/);

  // A failure to extract is itself the finding: the reader has been renamed,
  // moved or restructured, and whoever did that needs to re-establish that the
  // two still agree rather than have this test quietly pass on nothing.
  assert.ok(round3Src, "could not find round3 in PlanTab.jsx — has the reader moved?");
  assert.ok(sigSrc, "could not find planSlotSig in PlanTab.jsx — has the reader moved?");

  // eslint-disable-next-line no-new-func
  const frontendSig = new Function(`${round3Src[0]}\n${sigSrc[0]}\nreturn planSlotSig;`)();

  assert.equal(
    frontendSig(PLAN),
    planSlotSig(PLAN),
    "backend writer and frontend reader disagree — every verdict would read as permanently stale",
  );
  // and on the shapes most likely to drift
  for (const p of [
    { slots: [] },
    { slots: [{ dayOfWeek: 6, slotType: "lunch", slotIndex: 0, recipeId: null, proteinScale: 0, sidesScale: 0 }] },
    { slots: [{ dayOfWeek: 3, slotType: "snack", slotIndex: 2, recipeId: "r", proteinScale: 0.12345, sidesScale: 1.98765 }] },
  ]) {
    assert.equal(frontendSig(p), planSlotSig(p), `disagreement on ${JSON.stringify(p)}`);
  }
});
