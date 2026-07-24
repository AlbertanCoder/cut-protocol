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

  return {
    caps,
    _store: s,

    // Call BEFORE a request. projectedUsd = a conservative estimate of the
    // upcoming call's cost. Returns { allowed, reason?, notice?, spent }.
    async precheck(projectedUsd = 0) {
      const t = now();
      const [month, day] = await Promise.all([s.sumSince(startOfMonth(t)), s.sumSince(startOfDay(t))]);
      // Fail CLOSED on an uncomputable projected cost (e.g. an unpriced model,
      // where costUsd() returned null): a non-finite/negative projection must
      // DENY, never sail past the caps as $0 (LAW 4).
      if (!Number.isFinite(projectedUsd) || projectedUsd < 0) return deny("uncomputable-cost", caps.perRequestUsd, { month, day });
      if (projectedUsd > caps.perRequestUsd) return deny("per-request-cap", caps.perRequestUsd, { month, day });
      if (month + projectedUsd > caps.monthlyUsd) return deny("monthly-cap", caps.monthlyUsd, { month, day });
      if (day + projectedUsd > caps.dailyUsd) return deny("daily-cap", caps.dailyUsd, { month, day });
      return { allowed: true, spent: { month, day } };
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

// withUsageLogging(ledger, ctx, fn): run an LLM call, compute its ACTUAL cost
// from the response's usage block, record it to the ledger, and return the
// response. A response with no usage records nothing (a degraded/no-op call).
async function withUsageLogging(ledger, ctx = {}, fn) {
  const res = await fn();
  const usage = res && res.usage ? res.usage : null;
  if (usage) {
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
      cacheReadTokens: usage.cache_read_input_tokens, costUsd: cost ?? 0,
    });
  }
  return res;
}

// Enforce the cap AROUND a live model call: precheck (deny -> degrade, the call
// never happens) else run it and record the ACTUAL usage. Returns
// { allowed:true, result } or { allowed:false, notice, reason }. This is the one
// wrapper every live model path (chat, critic, and later planner/create) uses so
// LAW 4 can't be bypassed by a caller that forgets to check the cap.
async function guardedCall(ledger, { projectedUsd = 0, ...ctx } = {}, fn) {
  const gate = await ledger.precheck(projectedUsd);
  if (!gate.allowed) return { allowed: false, notice: gate.notice, reason: gate.reason, spent: gate.spent };
  const result = await withUsageLogging(ledger, ctx, fn);
  return { allowed: true, result };
}

// The production ledger: Prisma-backed so the caps survive restarts. Lazy so
// merely requiring this module needs no DB. Tests inject a memory/mock ledger
// instead — the real LlmUsage table is never touched from a test.
function defaultLedger() {
  const { prismaUsageStore } = require("./usageStore.js");
  return makeLedger({ store: prismaUsageStore() });
}

module.exports = { makeLedger, memoryStore, withUsageLogging, guardedCall, defaultLedger };
