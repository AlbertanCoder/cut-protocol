// TASK B — the per-user spend cap protected nothing user-facing, and two
// amplifiers made the global cap leakier than it looked.
//
//   B-wiring   config.js has defined per-user caps ($0.50 / $1 day / $5 month)
//              since Stage 4, and userBudget.js's own header says this is the
//              gap it closes — but it was wired into mealRouter ONLY. chat.js
//              used defaultLedger(), i.e. global-only, so one authenticated
//              account could consume the entire budget.
//   B-TOCTOU   precheck -> call -> record is async, so N concurrent requests all
//              read the same "spent so far" and all pass a cap they jointly
//              breach.
//   B-unledgered  withUsageLogging read res.usage AFTER the promise resolved, so
//              a throw that happens after the HTTP response (refusal, no text
//              block, invalid/truncated JSON) recorded NOTHING even though
//              Anthropic had billed it. runToolLoop lost every accumulated turn.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeLedger, memoryStore, guardedCall, withUsageLogging } = require("../../src/lib/brain/ledger.js");
const { makeBudget } = require("../../src/lib/brain/userBudget.js");

const SRC = path.join(__dirname, "..", "..", "src");
// Strip comments before scanning source: this file's own subject matter
// guarantees the words it forbids appear in prose right next to the code that
// no longer does them (same idiom as tests/aiGovernanceStructure.test.js).
const read = (...p) =>
  fs.readFileSync(path.join(SRC, ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CAPS = { monthlyUsd: 15, dailyUsd: 5, perRequestUsd: 0.5 };
const USER_CAPS = { monthlyUsd: 5, dailyUsd: 1, perRequestUsd: 0.5 };

// ── B-wiring: chat.js must use the per-user budget, not the global ledger ─────

test("B1 chat.js builds a PER-USER budget, not the global-only ledger", () => {
  const src = read("lib", "brain", "chat.js");
  assert.ok(/defaultBudget\(\s*\{\s*userId\s*\}\s*\)/.test(src), "chat.js must construct defaultBudget({ userId })");
  assert.ok(!/\bdefaultLedger\s*\(/.test(src), "chat.js must no longer fall back to the global-only defaultLedger()");
});

test("B2 the per-user cap denies a single account while the GLOBAL budget still has room", async () => {
  const store = memoryStore();
  const now = () => new Date("2026-07-24T12:00:00");
  const budget = makeBudget({ store, userId: "greedy", caps: CAPS, userCaps: USER_CAPS, now });

  // $0.90 spent by this one account: under the $5 global daily cap, but the
  // per-user daily cap is $1.
  await budget.record({ model: "claude-sonnet-5", costUsd: 0.9 });

  const verdict = await budget.precheck(0.2);
  assert.equal(verdict.allowed, false, "the stricter of the two budgets must deny");
  assert.equal(verdict.scope, "user", "the denial names WHICH budget ran out");
  assert.match(verdict.reason, /^user-/);
  assert.match(verdict.notice, /this account/i, '"you are paused" reads differently from "everyone is paused"');

  // A different account is untouched — that is the whole point.
  const other = makeBudget({ store, userId: "polite", caps: CAPS, userCaps: USER_CAPS, now });
  assert.equal((await other.precheck(0.2)).allowed, true);
});

test("B3 exactly ONE ledger row per call — the per-user view reads the rows the global ledger writes", async () => {
  const store = memoryStore();
  const budget = makeBudget({ store, userId: "u", caps: CAPS, userCaps: USER_CAPS });
  await guardedCall(budget, { projectedUsd: 0.01, model: "claude-sonnet-5", phase: "chat" },
    async () => ({ usage: { input_tokens: 1000, output_tokens: 100 } }));
  assert.equal(store._rows.length, 1, "double-recording would double-count spend and trip caps at half the real usage");
  assert.equal(store._rows[0].userId, "u", "the row is attributed, or the per-user cap can never see it");
});

// ── B-TOCTOU: concurrent requests must not all pass one cap ───────────────────

test("B4 TOCTOU: N concurrent calls cannot all pass a cap they jointly breach", async () => {
  const store = memoryStore();
  // $1 daily cap, each call projected at $0.30 -> at most 3 may run.
  const ledger = makeLedger({ store, caps: { monthlyUsd: 100, dailyUsd: 1, perRequestUsd: 1 } });

  let concurrent = 0;
  const run = () => guardedCall(ledger, { projectedUsd: 0.3, model: "claude-sonnet-5", phase: "chat" }, async () => {
    concurrent++;
    // Hold every in-flight call open together: this is exactly the window where
    // the spend is invisible to the store.
    await new Promise((r) => setTimeout(r, 20));
    return { usage: { input_tokens: 100_000, output_tokens: 1000 } };
  });

  const outcomes = await Promise.all(Array.from({ length: 10 }, run));
  const allowed = outcomes.filter((o) => o.allowed).length;

  assert.ok(allowed <= 3, `at most 3 x $0.30 fits under a $1 cap; ${allowed} were allowed`);
  assert.ok(allowed >= 1, "the cap must not deadlock — someone gets through");
  assert.equal(concurrent, allowed, "only allowed calls reach the model");
});

test("B5 a reservation is RELEASED after the real cost lands, so the cap does not creep shut", async () => {
  const ledger = makeLedger({ store: memoryStore(), caps: { monthlyUsd: 100, dailyUsd: 1, perRequestUsd: 1 } });
  // Projected high, actual ~free. Sequentially, the projection must not
  // accumulate — otherwise 4 near-free calls would wrongly exhaust the cap.
  for (let i = 0; i < 4; i++) {
    const out = await guardedCall(ledger, { projectedUsd: 0.3, model: "claude-sonnet-5", phase: "chat" },
      async () => ({ usage: { input_tokens: 10, output_tokens: 1 } }));
    assert.equal(out.allowed, true, `call ${i + 1} should be allowed — the previous projections were released`);
  }
  assert.equal(ledger._inFlightUsd, 0, "no reservation may outlive its call");
});

test("B6 a reservation is released even when the model call THROWS", async () => {
  const ledger = makeLedger({ store: memoryStore(), caps: { monthlyUsd: 100, dailyUsd: 1, perRequestUsd: 1 } });
  await assert.rejects(() => guardedCall(ledger, { projectedUsd: 0.4, model: "claude-sonnet-5", phase: "chat" },
    async () => { throw new Error("model exploded"); }));
  assert.equal(ledger._inFlightUsd, 0, "a throw must not leak budget — that would silently shrink the cap");
});

test("B7 precheck() stays READ-ONLY: checking without calling reserves nothing", async () => {
  const ledger = makeLedger({ store: memoryStore(), caps: CAPS });
  for (let i = 0; i < 5; i++) await ledger.precheck(0.4);
  assert.equal(ledger._inFlightUsd, 0);
});

// ── B-unledgered: spend that was billed but never recorded ────────────────────

test("B8 usage collected BEFORE a post-response throw is still recorded (refusal / bad JSON)", async () => {
  const store = memoryStore();
  const ledger = makeLedger({ store });
  // Mirrors askJSON: onUsage fires, THEN the refusal/parse check throws.
  await assert.rejects(() => withUsageLogging(ledger, { model: "claude-sonnet-5", phase: "chat" }, async (collect) => {
    collect.usage = { input_tokens: 1_000_000, output_tokens: 5000 };
    throw new Error("brain: model declined the request");
  }));
  assert.equal(store._rows.length, 1, "Anthropic billed it; the cap must see it");
  assert.ok(store._rows[0].costUsd > 0);
});

test("B9 a tool loop that dies mid-way still books the turns already billed", async () => {
  const store = memoryStore();
  const ledger = makeLedger({ store });
  // Mirrors runToolLoop: onUsage fires per turn with the running total, then
  // turn 3 throws. Previously all three turns were lost.
  await assert.rejects(() => withUsageLogging(ledger, { model: "claude-sonnet-5", phase: "chat" }, async (collect) => {
    for (let turn = 1; turn <= 3; turn++) {
      collect.usage = { input_tokens: 100_000 * turn, output_tokens: 500 * turn };
      if (turn === 3) throw new Error("timeout on turn 3");
    }
  }));
  assert.equal(store._rows.length, 1);
  assert.equal(store._rows[0].inputTokens, 300_000, "the running total at the moment of failure, not zero");
});

test("B10 a successful call still records exactly once (no double-count from the collector)", async () => {
  const store = memoryStore();
  const ledger = makeLedger({ store });
  const usage = { input_tokens: 1000, output_tokens: 100 };
  await withUsageLogging(ledger, { model: "claude-sonnet-5" }, async (collect) => { collect.usage = usage; return { usage }; });
  assert.equal(store._rows.length, 1, "res.usage and collect.usage are the same call — one row");
});

test("B11 runToolLoop surfaces its running usage through onUsage (the channel B9 relies on)", () => {
  const src = read("lib", "brain", "llm.js");
  assert.ok(/onUsage\s*\}?\s*=\s*\{\s*\}\s*\)|onUsage\b/.test(src), "runToolLoop must accept onUsage");
  assert.ok(/if \(typeof onUsage === "function"\) onUsage\(usage\);/.test(src),
    "onUsage must fire per-turn with the accumulated total, inside the loop");
  assert.ok(/cache_creation_input_tokens/.test(src),
    "cache WRITES bill at 1.25x input — summing them is required once prompt caching is on");
});

// ── rate limiting on the route ────────────────────────────────────────────────

test("B12 POST /api/brain/chat is rate limited and bounds the history array", () => {
  const src = read("routes", "brain.js");
  assert.ok(/createAttemptThrottle/.test(src), "the chat route must carry a rate limit — there was none anywhere in src/");
  assert.ok(/chatThrottle\.check\(/.test(src) && /chatThrottle\.record\(/.test(src), "the throttle must actually be consulted AND recorded");
  assert.ok(/status\(429\)/.test(src), "a throttled caller gets 429, not a silent success");
  assert.ok(/Retry-After/.test(src), "429 without Retry-After tells the client nothing");
  assert.ok(/req\.userId/.test(src), "the limit is keyed on the authenticated account — the cost it protects is per-account");
  assert.ok(/history\.length >/.test(src), "an unbounded history array is free CPU for the sender");
});

test("B13 the configured chat limit actually refuses a burst", () => {
  const { __chatThrottle } = require("../../src/routes/brain.js");
  __chatThrottle.reset();
  const key = "chat:burst-user";
  let allowed = 0;
  for (let i = 0; i < 200; i++) {
    if (!__chatThrottle.check(key).allowed) break;
    __chatThrottle.record(key);
    allowed++;
  }
  assert.ok(allowed > 0 && allowed <= 60, `a burst must be cut off well before 200 turns; got ${allowed}`);
  const denied = __chatThrottle.check(key);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSec > 0, "the client is told how long to wait");
  __chatThrottle.reset();
});
