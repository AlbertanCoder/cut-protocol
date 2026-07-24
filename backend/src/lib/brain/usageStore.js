// Brain v3 — Prisma-backed LLM usage store: the persistence behind ledger.js's
// injected store, so the pre-call cost caps survive restarts. Thin and
// injectable (the ledger's cap arithmetic stays pure; the in-memory store still
// serves the keyless tests). `db` is injectable so this file's own logic can be
// tested against a fake client with no real database.
const { prisma } = require("../prisma.js");

function prismaUsageStore(db = prisma) {
  return {
    async add(entry) {
      return db.llmUsage.create({
        data: {
          userId: entry.userId ?? null,
          model: entry.model || "unknown",
          phase: entry.phase ?? null,
          intent: entry.intent ?? null,
          inputTokens: Math.round(entry.inputTokens || 0),
          outputTokens: Math.round(entry.outputTokens || 0),
          cacheReadTokens: Math.round(entry.cacheReadTokens || 0),
          costUsd: entry.costUsd || 0,
        },
      });
    },
    // Second argument is an OPTIONAL scope (Stage 4). Omitted = every row (the
    // global cap, unchanged). `{ userId }` restricts the sum to one account, so
    // the per-user budget reuses this store and the [userId, createdAt] index
    // the schema already declares — no second table, no second code path.
    async sumSince(date, scope = {}) {
      const where = { createdAt: { gte: date } };
      if (scope && "userId" in scope) where.userId = scope.userId;
      const r = await db.llmUsage.aggregate({ _sum: { costUsd: true }, where });
      return r._sum.costUsd || 0;
    },
  };
}

module.exports = { prismaUsageStore };
