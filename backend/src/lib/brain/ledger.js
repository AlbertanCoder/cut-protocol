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
    notice: `Brain paused: the ${reason.replace("-", " ")} ($${cap}) was reached. Using the free deterministic planner.`,
    spent,
  };
}

// In-memory store for tests / no-DB. Prod passes a Prisma-backed store with the
// same { add, sumSince } shape (Stage B part 2 — LlmUsage table).
function memoryStore() {
  const rows = [];
  return {
    async add(e) { rows.push(e); return e; },
    async sumSince(date) { return rows.filter((r) => r.at >= date).reduce((sum, r) => sum + (r.costUsd || 0), 0); },
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
    await ledger.record({
      userId: ctx.userId, model: ctx.model, phase: ctx.phase, intent: ctx.intent,
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens, costUsd: cost || 0,
    });
  }
  return res;
}

module.exports = { makeLedger, memoryStore, withUsageLogging };
