// Brain v3 — the cost ledger (LAW 4). Records LLM spend and enforces caps
// PRE-CALL: before a request, precheck() asks whether the projected cost would
// breach the per-request / daily / monthly cap. On breach the brain degrades to
// the deterministic path with an honest notice — never an error to the user.
// The store is INJECTED (a Prisma-backed accessor in prod, the in-memory one
// here in tests) so the cap arithmetic is pure and unit-testable with no DB.
const { CAPS } = require("./config.js");
const { costUsd } = require("./pricing.js");

function makeLedger({ store, caps = CAPS, now = () => new Date() } = {}) {
  const s = store || memoryStore();

  // ── TOCTOU: money already committed but not yet on the ledger ──────────────
  // precheck() reads the store, the call runs, record() writes. Between the read
  // and the write the spend is INVISIBLE, so N concurrent requests all read the
  // same "spent so far" and all pass — the cap is enforced per-request but not
  // in aggregate, and with no rate limit the overshoot is unbounded in
  // principle. `inFlightUsd` is the missing term: a reserved projection counts
  // as spent until its real cost lands.
  let inFlightUsd = 0;
  // Reservations are taken under a promise-chain mutex so the read-decide-reserve
  // sequence cannot interleave. Without it the reserve would land one microtask
  // after the await that precedes it, which is exactly the window being closed.
  let gate = Promise.resolve();

  async function evaluate(projectedUsd) {
    const t = now();
    const [month, day] = await Promise.all([s.sumSince(startOfMonth(t)), s.sumSince(startOfDay(t))]);
    // In-flight spend counts against BOTH windows: it is money committed today,
    // and today is inside this month.
    const spent = { month: month + inFlightUsd, day: day + inFlightUsd };
    // Fail CLOSED on an uncomputable projected cost (e.g. an unpriced model,
    // where costUsd() returned null): a non-finite/negative projection must
    // DENY, never sail past the caps as $0 (LAW 4).
    if (!Number.isFinite(projectedUsd) || projectedUsd < 0) return deny("uncomputable-cost", caps.perRequestUsd, spent);
    if (projectedUsd > caps.perRequestUsd) return deny("per-request-cap", caps.perRequestUsd, spent);
    if (spent.month + projectedUsd > caps.monthlyUsd) return deny("monthly-cap", caps.monthlyUsd, spent);
    if (spent.day + projectedUsd > caps.dailyUsd) return deny("daily-cap", caps.dailyUsd, spent);
    return { allowed: true, spent };
  }

  return {
    caps,
    _store: s,
    get _inFlightUsd() { return inFlightUsd; },

    // Call BEFORE a request. projectedUsd = a conservative estimate of the
    // upcoming call's cost. Returns { allowed, reason?, notice?, spent }.
    // READ-ONLY: it reserves nothing, so a caller that checks and then does not
    // call leaks no budget. guardedCall() uses reserve() instead.
    async precheck(projectedUsd = 0) {
      return evaluate(projectedUsd);
    },

    // Call BEFORE a request when you are actually going to make it. Same
    // decision as precheck(), but on ALLOW it also books `projectedUsd` as
    // in-flight and hands back a one-shot `release()` the caller MUST invoke
    // once the real cost is recorded (guardedCall does this in a finally).
    async reserve(projectedUsd = 0) {
      const prev = gate;
      let unlock;
      gate = new Promise((r) => { unlock = r; });
      try {
        await prev;
        const verdict = await evaluate(projectedUsd);
        if (!verdict.allowed) return { ...verdict, release: () => {} };
        inFlightUsd += projectedUsd;
        let released = false;
        return {
          ...verdict,
          release: () => {
            if (released) return;
            released = true;
            inFlightUsd = Math.max(0, inFlightUsd - projectedUsd);
          },
        };
      } finally {
        unlock();
      }
    },

    // Call AFTER a request with the ACTUAL cost + usage.
    async record(entry) {
      return s.add({ costUsd: 0, ...entry, at: now() });
    },

    async spentThisMonth() {
      return s.sumSince(startOfMonth(now()));
    },
  };
}

function deny(reason, cap, spent) {
  return {
    allowed: false,
    reason,
    notice: `Brain paused: the ${reason.replace(/-/g, " ")} ($${cap}) was reached. Using the free deterministic planner.`,
    spent,
  };
}

// In-memory store for tests / no-DB. Prod passes a Prisma-backed store with the
// same { add, sumSince } shape (Stage B part 2 — LlmUsage table).
//
// sumSince's second argument is an OPTIONAL scope (Stage 4, per-user caps).
// Omitted = every row, i.e. exactly the previous behaviour — the global cap is
// unchanged. `{ userId }` sums only that user's rows, which is how the same cap
// arithmetic serves a per-user budget without a second implementation.
function memoryStore() {
  const rows = [];
  return {
    async add(e) { rows.push(e); return e; },
    async sumSince(date, scope = {}) {
      const scoped = scope && "userId" in scope ? rows.filter((r) => r.userId === scope.userId) : rows;
      return scoped.filter((r) => r.at >= date).reduce((sum, r) => sum + (r.costUsd || 0), 0);
    },
    _rows: rows,
  };
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

async function recordUsage(ledger, ctx, usage) {
  const cost = costUsd(ctx.model, usage);
  if (cost == null) {
    // Unpriced model (costUsd returned null) — precheck should have blocked
    // this. Do NOT fabricate a cost; make it LOUD (not a silent $0) so it's
    // auditable, and record 0 only because the column is non-nullable (LAW 4).
    console.warn(`[brain/ledger] unpriced model "${ctx.model}": spend is NOT counted toward caps — wire its price before enabling it`);
  }
  await ledger.record({
    userId: ctx.userId, model: ctx.model, phase: ctx.phase, intent: ctx.intent,
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    // NOTE: the LlmUsage table has no cache_creation column, so a cache WRITE is
    // not broken out per-row. costUsd() above still prices it (1.25x input), so
    // the CAP arithmetic is correct — only the column breakdown is coarse.
    cacheReadTokens: usage.cache_read_input_tokens, costUsd: cost ?? 0,
  });
}

// withUsageLogging(ledger, ctx, fn): run an LLM call, compute its ACTUAL cost
// from the response's usage block, record it to the ledger, and return the
// response. A response with no usage records nothing (a degraded/no-op call).
//
// THROW-SAFE ACCOUNTING (audit finding, 2026-07-24). This used to read
// `res.usage` after the promise resolved, which meant that when askJSON /
// askSchemaJSON threw AFTER the HTTP response — a refusal stop_reason, no text
// block, invalid or truncated JSON — Anthropic had billed the request and the
// ledger recorded nothing. runToolLoop was worse: a mid-loop throw discarded
// EVERY accumulated turn. That is a systematic under-count concentrated in
// exactly the failure modes that recur, so the caps drift furthest from reality
// precisely when something is going wrong.
//
// The fix is a collector: `fn` is called with an object it may write `usage`
// onto as soon as tokens are known (llm.js's onUsage hooks fire BEFORE any
// throw). If `fn` throws, whatever it collected is still recorded, then the
// throw propagates unchanged — callers' documented fallbacks are untouched.
async function withUsageLogging(ledger, ctx = {}, fn) {
  const collected = { usage: null };
  let res;
  try {
    res = await fn(collected);
  } catch (e) {
    if (collected.usage) await recordUsage(ledger, ctx, collected.usage);
    throw e;
  }
  // `res.usage` wins when present; runToolLoop hands the SAME object to both, so
  // this is one record, never two.
  const usage = (res && res.usage) || collected.usage;
  if (usage) await recordUsage(ledger, ctx, usage);
  return res;
}

// Enforce the cap AROUND a live model call: precheck (deny -> degrade, the call
// never happens) else run it and record the ACTUAL usage. Returns
// { allowed:true, result } or { allowed:false, notice, reason }. This is the one
// wrapper every live model path (chat, critic, and later planner/create) uses so
// LAW 4 can't be bypassed by a caller that forgets to check the cap.
async function guardedCall(ledger, { projectedUsd = 0, ...ctx } = {}, fn) {
  // Prefer reserve() — it books the projection as in-flight so N concurrent
  // requests cannot all pass a cap they would jointly breach. Ledger-shaped
  // objects that predate reserve() (or a test double) fall back to precheck(),
  // which is the previous, TOCTOU-prone behaviour rather than a hard failure.
  const canReserve = typeof ledger.reserve === "function";
  const gate = canReserve ? await ledger.reserve(projectedUsd) : await ledger.precheck(projectedUsd);
  if (!gate.allowed) return { allowed: false, notice: gate.notice, reason: gate.reason, spent: gate.spent };
  try {
    const result = await withUsageLogging(ledger, ctx, fn);
    return { allowed: true, result };
  } finally {
    // Released only AFTER the real cost is on the ledger, so the reservation and
    // the recorded row never both go missing at the same instant.
    if (typeof gate.release === "function") gate.release();
  }
}

// The production ledger: Prisma-backed so the caps survive restarts. Lazy so
// merely requiring this module needs no DB. Tests inject a memory/mock ledger
// instead — the real LlmUsage table is never touched from a test.
function defaultLedger() {
  const { prismaUsageStore } = require("./usageStore.js");
  return makeLedger({ store: prismaUsageStore() });
}

module.exports = { makeLedger, memoryStore, withUsageLogging, guardedCall, defaultLedger };
