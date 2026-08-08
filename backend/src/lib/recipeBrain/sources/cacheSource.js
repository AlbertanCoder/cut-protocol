// Recipe Brain — channel 2: the DURABLE CACHE. Pay once, coverage climbs.
//
// This wires the upgrade Stage 4 designed but never landed: the
// Recipe.aiFingerprint / aiVerifiedAt / aiVerifiedBy columns exist in the
// schema (migration 20260724120000) and were, until now, written and read by
// NOTHING. This channel makes them the durable index: a verified generated
// recipe is persisted with the spec fingerprint that produced it, so the same
// constraint-shaped gap is answered free forever — across restarts, which the
// in-process slotCache index never survived.
//
// SAFETY MODEL, unchanged from slotCache's: the fingerprint buckets constraints
// and decides WHERE TO LOOK, never what ships. Every durable hit is re-screened
// on serve — it must still be in the caller's wall-filtered pool (an id that no
// longer survives the filter is skipped, same eviction semantics as the
// router), and it must still pass the fit gate + matrix caps NOW. A row with a
// null aiVerifiedAt is never served from this channel, period.
//
// PRISMA POSTURE: the default lookup lazy-requires prisma INSIDE the function
// (the codebase's own seam pattern) and every test injects findByFingerprintImpl
// — this module stays keyless- and DB-less-testable.
const { matrixFromSpec, judge } = require("../matrix.js");
const { refit } = require("../tweak.js");
const { defaultSlotCache } = require("../../brain/slotCache.js");

async function defaultFindByFingerprint(fingerprint) {
  // Lazy: only a real runtime with a generated client ever reaches this.
  const { prisma } = require("../../prisma.js");
  const { RECIPE_INCLUDE } = require("../../recipeGeneration.js");
  return prisma.recipe.findMany({
    where: { aiFingerprint: fingerprint, aiVerifiedAt: { not: null } },
    include: RECIPE_INCLUDE,
    orderBy: { id: "desc" },
  });
}

/**
 * lookup({ spec, fingerprint, pool, ratings }, deps?) -> {
 *   hit: { recipe, scaled, tweak, via } | null,
 *   attempts: [...],   // every candidate considered and why it was passed over
 * }
 *
 * `pool` is the wall-filtered, slot-eligible pool for THIS request — the
 * membership screen. Durable rows are matched into it BY ID; the in-process
 * index (deps.cache) is consulted second and maintained on the way out.
 */
async function lookup({ spec, fingerprint, pool = [], ratings = null } = {}, deps = {}) {
  const {
    findByFingerprintImpl = defaultFindByFingerprint,
    cache = defaultSlotCache(),
    refitImpl = refit,
  } = deps;
  const byId = new Map(pool.map((r) => [r.id, r]));
  const matrix = matrixFromSpec(spec);
  const attempts = [];

  const consider = (row, via) => {
    const live = byId.get(row.id);
    if (!live) { attempts.push({ id: row.id, via, outcome: "not-in-filtered-pool" }); return null; }
    const j = judge(live, matrix, { ratings });
    if (!j.passes) { attempts.push({ id: row.id, via, outcome: "fails-matrix-cap", binding: j.gate.bindingConstraint }); return null; }
    const t = refitImpl(live, spec);
    const v = t && t.scaled ? t.verdicts[t.method === "repartition" ? "repartition" : "twoFactor"] : null;
    if (!v || !v.slotOk) { attempts.push({ id: row.id, via, outcome: "fails-fit" }); return null; }
    attempts.push({ id: row.id, via, outcome: "hit" });
    return { recipe: live, scaled: t.scaled, tweak: t, via };
  };

  // 1) durable index — survives restarts, the whole point of this channel.
  let durableRows = [];
  try {
    durableRows = (await findByFingerprintImpl(fingerprint)) || [];
  } catch (e) {
    // A cache that cannot be read is a MISS, never an error: the library scan
    // downstream finds the same rows the slow way. Recorded, not swallowed.
    attempts.push({ via: "durable", outcome: "lookup-failed", message: e && e.message ? e.message : String(e) });
  }
  for (const row of durableRows) {
    if (!row || row.aiVerifiedAt == null) { attempts.push({ id: row?.id ?? null, via: "durable", outcome: "unverified-row-refused" }); continue; }
    const hit = consider(row, "durable");
    if (hit) { cache.remember(fingerprint, row.id); return { hit, attempts }; }
  }

  // 2) in-process index — same semantics as the router's, kept because it also
  // indexes rows persisted before the durable column was wired.
  for (const id of cache.get(fingerprint)) {
    const row = byId.get(id);
    if (!row) { cache.forget(fingerprint, id); attempts.push({ id, via: "index", outcome: "evicted" }); continue; }
    const hit = consider(row, "index");
    if (hit) return { hit, attempts };
  }

  return { hit: null, attempts };
}

/** remember(fingerprint, recipeId, deps?) — write-through to the in-process index. */
function remember(fingerprint, recipeId, deps = {}) {
  const { cache = defaultSlotCache() } = deps;
  cache.remember(fingerprint, recipeId);
}

module.exports = { lookup, remember, defaultFindByFingerprint };
