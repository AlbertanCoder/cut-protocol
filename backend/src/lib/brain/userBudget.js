// Stage 4 — the PER-USER budget, composed with the global one.
//
// THE GAP THIS CLOSES. ledger.js already enforces daily/monthly/per-request caps
// PRE-call, and that protects the owner's bill in total. It does not protect it
// from ONE account: a user (or a retry loop, or a script) can consume the entire
// monthly budget alone, and every other user then degrades to closest-fit for
// the rest of the month with nothing in the UI explaining why. A per-user cap
// turns "the app is out of budget" into "you are out of budget", which is both
// fairer and diagnosable.
//
// HOW: not a second cap system. The same makeLedger() arithmetic, over the same
// LlmUsage rows, through a store view that filters by userId. Composed so the
// STRICTER of the two denies first, and so exactly ONE row is written per call
// (the per-user view reads the very rows the global ledger writes — double
// recording would double-count spend and trip caps at half the real usage).
const { makeLedger } = require("./ledger.js");
const { CAPS, USER_CAPS } = require("./config.js");

// A read view of `store` restricted to one user. `add` still delegates (with the
// userId forced on, so a row can never land unattributed through this view), but
// the composite below never calls it — see the single-write note above.
function userScopedStore(store, userId) {
  return {
    async add(entry) { return store.add({ ...entry, userId }); },
    async sumSince(date) { return store.sumSince(date, { userId }); },
  };
}

/**
 * makeBudget({ store, userId, caps, userCaps, now }) -> a ledger-shaped object
 * ({ precheck, record, spentThisMonth }) that governedModelCall accepts as
 * ctx.ledger with no special-casing.
 *
 * With no userId (an unattributed/system call) this is exactly the global
 * ledger — an anonymous call cannot be attributed, and inventing a bucket for it
 * would silently exempt it from the per-user cap or wrongly charge someone else.
 * The global cap still binds it.
 */
function makeBudget({ store, userId = null, caps = CAPS, userCaps = USER_CAPS, now } = {}) {
  const globalLedger = makeLedger({ store, caps, now });
  if (!userId) return globalLedger;

  const perUser = makeLedger({ store: userScopedStore(store, userId), caps: userCaps, now });

  return {
    caps,
    userCaps,
    userId,
    _store: store,
    _global: globalLedger,
    _perUser: perUser,

    // PRE-call. Global first (it is the owner's hard stop), then the per-user
    // cap. The denial that comes back names WHICH budget ran out, because
    // "everyone is paused" and "you are paused" need different copy.
    async precheck(projectedUsd = 0) {
      const g = await globalLedger.precheck(projectedUsd);
      if (!g.allowed) return { ...g, scope: "global" };
      const u = await perUser.precheck(projectedUsd);
      if (!u.allowed) {
        return {
          ...u,
          scope: "user",
          reason: `user-${u.reason}`,
          notice: `AI generation paused for this account: your ${u.reason.replace(/-/g, " ")} was reached. Using the free deterministic planner.`,
        };
      }
      return { allowed: true, spent: { global: g.spent, user: u.spent } };
    },

    // ONE row, written through the global ledger. The per-user view reads it
    // back on the next precheck because it is the same store.
    async record(entry) { return globalLedger.record({ userId, ...entry }); },

    async spentThisMonth() { return globalLedger.spentThisMonth(); },
    async userSpentThisMonth() { return perUser.spentThisMonth(); },
  };
}

// The production budget: Prisma-backed, so both caps survive restarts. Lazy for
// the same reason defaultLedger() is — requiring this module must not need a DB.
function defaultBudget({ userId = null } = {}) {
  const { prismaUsageStore } = require("./usageStore.js");
  return makeBudget({ store: prismaUsageStore(), userId });
}

module.exports = { makeBudget, defaultBudget, userScopedStore };
