// cache.js — Brain v3 Stage J. Cost controls, all pure + keyless (inert with the
// brain off):
//   • a content-addressed BrainCache keyed on VERSION HASHES, so a stale
//     profile / pool / prompt can never serve a wrong cached answer;
//   • a deterministic candidate PRE-FILTER — hand the model ~K best options, not
//     the whole pool (fewer input tokens);
//   • prompt-cache BREAKPOINT planning — the static persona/laws prefix is cached
//     across turns; the volatile depth block never is;
//   • a think-on-first-proposal-only policy (later turns are cheap corrections).
const crypto = require("crypto");

// Stable JSON (sorted keys) so equal inputs hash identically regardless of
// property order — cache keys must be order-independent.
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",")}}`;
}

function hashInputs(obj) {
  return crypto.createHash("sha256").update(stableStringify(obj)).digest("hex").slice(0, 32);
}

// A cache key binds every input that could change the answer. If ANY version
// part differs it's a different key — a stale entry is never served (LAW 1: a
// cached number is only reused when its exact inputs recur).
function makeCacheKey({ promptVersion = "v3", profileVersion, poolVersion, target, depth = "balanced" } = {}) {
  return hashInputs({ promptVersion, profileVersion, poolVersion, target, depth });
}

// Small LRU + TTL cache. Deterministic: no wall-clock in the KEY (only in TTL,
// via an injectable clock so tests are deterministic too).
class BrainCache {
  constructor({ max = 200, ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (this.now() - e.t > this.ttlMs) { this.map.delete(key); return null; }
    this.map.delete(key); this.map.set(key, e); // LRU bump
    return e.v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { v: value, t: this.now() });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); // evict oldest
    return value;
  }
  has(key) { return this.get(key) !== null; }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

// Deterministic candidate pre-filter: keep the K best by a CHEAP heuristic (kcal
// proximity to target + protein density) so the model reasons over ~K, not the
// whole pool. Pure, stable ordering (ties break on original index).
function prefilterCandidates(candidates = [], target = {}, { k = 30 } = {}) {
  const tgtK = target.kcal || 0;
  const scored = candidates.map((c, i) => {
    const kcal = c.kcal || 0;
    const prox = tgtK > 0 ? Math.abs(kcal - tgtK) / tgtK : 0; // 0 = on target
    const density = kcal > 0 ? (c.protein || 0) / kcal : 0; // higher = better
    return { c, i, key: prox - density }; // lower = better
  });
  scored.sort((a, b) => a.key - b.key || a.i - b.i);
  return scored.slice(0, Math.max(0, k)).map((s) => s.c);
}

// Prompt-cache breakpoints on the ordered system blocks. Cache is PREFIX-based,
// so we mark a breakpoint after the last static block (persona/scope/laws) and
// after the profile block (≤3 total); the volatile depth block is never cached.
// blocks: [{ role:'static'|'profile'|'volatile', text }] -> same, some { cache:true }.
function planCacheBreakpoints(blocks = []) {
  const out = blocks.map((b) => ({ ...b }));
  const roles = out.map((b) => b.role);
  const lastStatic = roles.lastIndexOf("static");
  const lastProfile = roles.lastIndexOf("profile");
  if (lastStatic >= 0) out[lastStatic].cache = true;
  if (lastProfile >= 0) out[lastProfile].cache = true;
  return out;
}

// Extended thinking only on the FIRST proposal (iter 0). Later refinement turns
// are cheap tool-driven corrections where thinking mostly burns tokens.
function thinkOnFirstOnly(iter) {
  return iter === 0;
}

module.exports = { BrainCache, makeCacheKey, hashInputs, stableStringify, prefilterCandidates, planCacheBreakpoints, thinkOnFirstOnly };
