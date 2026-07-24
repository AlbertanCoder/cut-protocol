// Stage 4 — the CONSTRAINT FINGERPRINT and the index that makes an AI-designed
// recipe a one-time cost instead of a per-request one.
//
// WHAT THE CACHE ACTUALLY IS. The durable cache is the RECIPE LIBRARY itself: a
// verified AI recipe is persisted as an ordinary Recipe row (source
// "ai-generated"), so it survives restarts, appears in the normal library
// listing, and is re-screened by the same pool filter as every curated row on
// every future request. This module is the INDEX over that library — a map from
// "the constraints that produced it" to "the row it produced" — so the next
// matching request finds it in O(1) instead of re-scanning, and so the router
// can honestly report how often a request that WOULD have cost money didn't.
//
// The index is in-process and rebuildable; the recipe is not. That ordering
// matters: losing the index on restart costs a pool scan, never a duplicate
// generation, because the library-first scan runs regardless and finds the same
// row. (A persistent fingerprint column is the obvious upgrade and is written up
// as an exact diff in docs/qc/stage4-handoff.md — it needs a Prisma migration,
// which this stage does not own.)
//
// WHY BUCKETING IS SAFE. Two requests for 612 kcal and 618 kcal are the same
// request; keying on the raw float would make the cache miss ~always and the
// economics collapse. So the key buckets the targets. A bucket is NOT a promise
// that the cached recipe fits — the router re-runs the deterministic scale + the
// tolerance check on EVERY cache hit, and a hit that fails it is discarded and
// treated as a miss. The bucket only decides where to LOOK; the engine decides
// what is served (LAW: the deterministic engine owns all numbers).
const { hashInputs } = require("./cache.js");

// Bump when the fingerprint's INPUTS change meaning — an old key must never be
// reinterpreted under new semantics.
const FINGERPRINT_VERSION = "slot-v1";

// Deliberately coarser than nothing and much finer than the solver's accept
// tolerance (15% kcal / 12% protein). At a 600 kcal slot, 15% is ±90 kcal and a
// bucket is 25 — so a bucket neighbour is comfortably inside the band the fit
// check will re-verify anyway.
const KCAL_BUCKET = 25;
const PROTEIN_BUCKET = 5;

const bucket = (v, size) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n / size) * size : null;
};

// Exclusion terms are identity, not decoration: ["Peanuts"] and ["peanuts "] are
// the same constraint and must key identically, while ["peanuts","dairy"] must
// NOT collide with ["peanuts"]. Normalise + dedupe + sort.
function normTerms(list) {
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    if (typeof t !== "string") continue;
    const v = t.trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen].sort();
}

/**
 * slotFingerprint(constraints) -> hex string.
 *
 * Binds every input that changes what a valid recipe for this slot looks like.
 * Anything NOT bound here must be re-checked at serve time — which the router
 * does unconditionally, because the pool filter and the fit check run on the
 * cached row exactly as they do on a curated one.
 */
function slotFingerprint({
  slotType, kcalTarget, proteinTarget,
  dietaryStyle = null, excludedFoods = [], cuisine = null,
  version = FINGERPRINT_VERSION,
} = {}) {
  return hashInputs({
    v: version,
    slotType: slotType === "snack" ? "snack" : "meal",
    kcal: bucket(kcalTarget, KCAL_BUCKET),
    protein: bucket(proteinTarget, PROTEIN_BUCKET),
    // Null and "none" are the same statement ("no style"); collapse so they key
    // together instead of generating twice for one user.
    dietaryStyle: dietaryStyle && dietaryStyle !== "none" ? String(dietaryStyle).toLowerCase() : null,
    excluded: normTerms(excludedFoods),
    cuisine: cuisine ? String(cuisine).trim().toLowerCase() : null,
  });
}

/**
 * makeSlotCache() — fingerprint -> recipe ids, newest first.
 *
 * Multi-valued on purpose: one fingerprint can legitimately have produced
 * several recipes over time (variety), and a single-valued map would go
 * permanently cold the moment its one recipe was deleted or filtered out.
 * `remember` is idempotent; `forget` is how the router evicts an id that no
 * longer survives the pool filter (a deleted recipe, or a profile whose
 * exclusions changed) — eviction is a correctness path, not housekeeping.
 */
function makeSlotCache({ index = new Map(), maxPerKey = 8 } = {}) {
  return {
    _index: index,

    get(fp) {
      return index.get(fp) ? [...index.get(fp)] : [];
    },

    remember(fp, recipeId) {
      if (!fp || !recipeId) return;
      const ids = index.get(fp) || [];
      const next = [recipeId, ...ids.filter((x) => x !== recipeId)].slice(0, maxPerKey);
      index.set(fp, next);
    },

    forget(fp, recipeId) {
      const ids = index.get(fp);
      if (!ids) return;
      const next = ids.filter((x) => x !== recipeId);
      if (next.length) index.set(fp, next);
      else index.delete(fp);
    },

    clear() { index.clear(); },
    get size() { return index.size; },
  };
}

// Process-wide default. A module singleton is right here: the index is a pure
// accelerator over the shared library, it holds no user data beyond ids, and
// rebuilding it costs one pool scan.
let _default = null;
function defaultSlotCache() {
  if (!_default) _default = makeSlotCache();
  return _default;
}

module.exports = {
  slotFingerprint, makeSlotCache, defaultSlotCache,
  FINGERPRINT_VERSION, KCAL_BUCKET, PROTEIN_BUCKET, normTerms,
};
