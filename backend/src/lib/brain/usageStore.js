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
    async sumSince(date) {
      const r = await db.llmUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: date } } });
      return r._sum.costUsd || 0;
    },
  };
}

module.exports = { prismaUsageStore };
