// Brain v2 Stage I — persistence accessor layer over the additive brain tables
// (BrainConversation/Message, GeneratedRecipe, GeneratedPlan/Item, BrainSolveRun,
// UserLibraryEntry). Thin + injectable (takes a prisma client, so it is testable
// with a stub and never hard-couples the barrel to Prisma). DORMANT: no route
// wires it yet, and with BRAIN=off nothing constructs it.
//
// LAW 2: this layer stores SOFT signals + history ONLY. Allergy/diet exclusions
// live in the authoritative Profile + the tool layer and NEVER here. The
// belt-and-suspenders `assertNoExclusions` rejects any exclusion-like key that
// tries to ride in through a generic `data` JSON blob.
const EXCLUSION_KEYS = /excluded|exclude|allerg|forbidden|banned|blocklist|blacklist|denylist/i;

function assertNoExclusions(data, where = "data") {
  const seen = new Set();
  const scan = (obj) => {
    if (!obj || typeof obj !== "object" || seen.has(obj)) return;
    seen.add(obj);
    for (const k of Object.keys(obj)) {
      if (EXCLUSION_KEYS.test(k)) throw new Error(`store: exclusion-like key "${k}" rejected in ${where} (Law 2 — exclusions live in the profile only)`);
      scan(obj[k]);
    }
  };
  scan(data);
}

function makeStore(prisma) {
  return {
    // ── conversations + messages (server-side chat history) ──
    async createConversation(userId, title = null) {
      return prisma.brainConversation.create({ data: { userId, title } });
    },
    async appendMessage(conversationId, role, content) {
      if (role !== "user" && role !== "assistant") throw new Error(`store: invalid message role "${role}"`);
      const msg = await prisma.brainMessage.create({ data: { conversationId, role, content: String(content ?? "").slice(0, 8000) } });
      await prisma.brainConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return msg;
    },
    async getConversation(id) {
      return prisma.brainConversation.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    },
    async listConversations(userId) {
      return prisma.brainConversation.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    },

    // ── generated recipes / plans (saved AI creations) ──
    async saveGeneratedRecipe(userId, { name, data, recipeId = null }) {
      assertNoExclusions(data, "generatedRecipe");
      return prisma.generatedRecipe.create({ data: { userId, name, recipeId, data } });
    },
    async saveGeneratedPlan(userId, { label = null, data, items = [] }) {
      assertNoExclusions(data, "generatedPlan");
      return prisma.generatedPlan.create({
        data: {
          userId, label, data,
          items: { create: items.map((it) => ({ slotType: it.slotType === "snack" ? "snack" : "meal", recipeId: it.recipeId || null, data: it.data || {} })) },
        },
        include: { items: true },
      });
    },
    async listGeneratedRecipes(userId) { return prisma.generatedRecipe.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }); },
    async listGeneratedPlans(userId) { return prisma.generatedPlan.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { items: true } }); },

    // ── solve-run audit ──
    async recordSolveRun(userId, { intent = null, status, data }) {
      if (!["converged", "partial", "failed"].includes(status)) throw new Error(`store: invalid solve status "${status}"`);
      assertNoExclusions(data, "solveRun");
      return prisma.brainSolveRun.create({ data: { userId, intent, status, data } });
    },

    // ── saved library (user's kept recipes) ──
    async addLibraryEntry(userId, recipeId) {
      return prisma.userLibraryEntry.upsert({ where: { userId_recipeId: { userId, recipeId } }, update: {}, create: { userId, recipeId } });
    },
    async removeLibraryEntry(userId, recipeId) {
      return prisma.userLibraryEntry.deleteMany({ where: { userId, recipeId } });
    },
    async listLibrary(userId) { return prisma.userLibraryEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }); },
  };
}

// Kept out of the barrel (require directly when wiring) so index.js stays Prisma-free.
function defaultStore() {
  const { prisma } = require("../prisma.js");
  return makeStore(prisma);
}

module.exports = { makeStore, defaultStore, assertNoExclusions };
