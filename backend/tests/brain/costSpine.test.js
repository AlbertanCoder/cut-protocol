const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MODELS, CAPS } = require("../../src/lib/brain/config.js");
const { costUsd } = require("../../src/lib/brain/pricing.js");
const { needsLLM, pickModel } = require("../../src/lib/brain/router.js");
const { makeLedger } = require("../../src/lib/brain/ledger.js");
const { validProv, provenanceLint } = require("../../src/lib/brain/telemetry.js");

// ── config ──
test("config: three model tiers + USD caps present", () => {
  assert.equal(MODELS.classifier, "claude-haiku-4-5");
  assert.equal(MODELS.workhorse, "claude-sonnet-5");
  assert.equal(MODELS.escalation, "claude-opus-4-8");
  assert.ok(CAPS.monthlyUsd > 0 && CAPS.dailyUsd > 0 && CAPS.perRequestUsd > 0);
});

// ── pricing ──
test("pricing: costUsd computes per-1M rates; unknown model → null (fail loud)", () => {
  assert.equal(costUsd("claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 18);
  assert.equal(costUsd("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }), 0.1);
  assert.equal(costUsd("gpt-4", { input_tokens: 100 }), null);
});

test("ledger precheck: an uncomputable (non-finite/negative) projected cost fails CLOSED", async () => {
  const led = makeLedger();
  assert.equal((await led.precheck(null)).allowed, false, "null projected cost must deny");
  assert.equal((await led.precheck(NaN)).allowed, false, "NaN projected cost must deny");
  assert.equal((await led.precheck(-1)).allowed, false, "negative projected cost must deny");
  assert.equal((await led.precheck(0.001)).allowed, true, "a normal small cost is still allowed");
});

// ── router ──
test("router: deterministic intents never call the LLM; open-ended intents do", () => {
  for (const intent of ["regen", "scale", "swap", "grocery", "weigh-in", "export", "trend"]) {
    assert.equal(needsLLM({ intent }), false, `${intent} must stay deterministic`);
  }
  assert.equal(needsLLM({ intent: "plan" }), true);
  assert.equal(needsLLM({ intent: "chat" }), true);
});

test("router: pickModel routes classify→haiku, normal→sonnet, hard/escalate→opus", () => {
  assert.equal(pickModel("classify"), "claude-haiku-4-5");
  assert.equal(pickModel("guard"), "claude-haiku-4-5");
  assert.equal(pickModel("plan", "normal"), "claude-sonnet-5");
  assert.equal(pickModel("plan", "hard"), "claude-opus-4-8");
  assert.equal(pickModel("escalate"), "claude-opus-4-8");
});

// ── ledger (pre-call cap → degrade) ──
const FIXED = new Date("2026-07-19T12:00:00");
function ledger() {
  return makeLedger({ caps: { monthlyUsd: 10, dailyUsd: 3, perRequestUsd: 0.5 }, now: () => FIXED });
}

test("ledger: precheck allows spend under the caps", async () => {
  const p = await ledger().precheck(0.1);
  assert.equal(p.allowed, true);
  assert.deepEqual(p.spent, { month: 0, day: 0 });
});

test("ledger: a single request over the per-request cap is denied with an honest notice", async () => {
  const p = await ledger().precheck(0.6);
  assert.equal(p.allowed, false);
  assert.equal(p.reason, "per-request-cap");
  assert.match(p.notice, /deterministic planner/);
});

test("ledger: recorded spend accumulates and trips the daily then monthly cap", async () => {
  const l = ledger();
  await l.record({ costUsd: 2.9, model: "claude-sonnet-5" });
  const day = await l.precheck(0.2); // 2.9 + 0.2 > 3 daily cap
  assert.equal(day.allowed, false);
  assert.equal(day.reason, "daily-cap");

  const l2 = ledger();
  await l2.record({ costUsd: 9.9, model: "claude-opus-4-8" });
  const month = await l2.precheck(0.2); // 9.9 + 0.2 > 10 monthly (day cap 3 checked after; monthly trips first)
  assert.equal(month.allowed, false);
  assert.equal(month.reason, "monthly-cap");
  assert.equal(await l2.spentThisMonth(), 9.9);
});

// ── telemetry / provenance-lint ──
test("telemetry: validProv + provenanceLint flag an untraceable number, pass a traceable one", () => {
  assert.equal(validProv({ formulaId: "x", inputs: {}, value: 1 }), true);
  assert.equal(validProv({ value: 1 }), false);

  const clean = { day: { value: { kcal: 500 }, prov: { formulaId: "scaleRecipe", inputs: {}, value: { kcal: 500 } } } };
  assert.deepEqual(provenanceLint(clean), []);

  const dirty = { slots: [{ value: { kcal: 500 } /* no prov */ }] };
  assert.deepEqual(provenanceLint(dirty), ["$.slots[0]"]);
});
