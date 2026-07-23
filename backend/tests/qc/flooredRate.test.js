// QC persona finding (2026-07-23): when a target is floored, the UI only said
// "not achievable" without telling the user the rate they WILL get. deriveTarget
// now exposes achievableRate. Three personas (petite low-TDEE, heavy trucker,
// ED-recovery) independently asked for this.
const test = require("node:test");
const assert = require("node:assert");
const bmr = require("../../src/lib/bmrEngine.js");

test("deriveTarget exposes the achievable rate when floored", () => {
  // TDEE 1580, aggressive rate -> raw below floor -> clamps. (petite-woman case)
  const profile = { sex: "F", rateLbPerWeek: 1.0, floorKcal: null };
  const t = bmr.deriveTarget(profile, 1580, 1263); // floor = max(1200, round(1263*0.95)=1200) = 1200
  assert.equal(t.floored, true);
  assert.equal(t.target, 1200);
  assert.equal(t.actualDeficit, 380);            // 1580 - 1200
  assert.equal(t.achievableRate, 0.76);          // 380 * 7 / 3500
  assert.ok(t.achievableRate < t.rate, "achievable must be below the chosen rate when floored");
});

test("un-floored targets report the chosen rate as achievable", () => {
  const profile = { sex: "M", rateLbPerWeek: 1.0, floorKcal: null };
  const t = bmr.deriveTarget(profile, 2800, 1800); // raw 2300 well above floor 1710
  assert.equal(t.floored, false);
  // actualDeficit == deficit, so achievableRate ~= chosen rate
  assert.ok(Math.abs(t.achievableRate - t.rate) < 0.02, `${t.achievableRate} should ~= ${t.rate}`);
});

test("the floored safety message states the real rate, not just 'not achievable'", () => {
  const s = bmr.rateSafety({ sex: "F", rateLbPerWeek: 2.0, floorKcal: null }, 55, 1580, 1263);
  assert.ok(s.unsafe);
  const floored = s.reasons.find((r) => /hold you at/.test(r));
  assert.ok(floored, "should have a floored reason");
  assert.ok(/loses about [\d.]+ lb\/wk/.test(floored), `reason must state the achievable rate: ${floored}`);
});
