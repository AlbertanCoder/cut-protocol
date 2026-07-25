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
function makeCacheKey({ promptVersion = "v3", profileVersion, poolVersion, target, depth = "balanced", model } = {}) {
  // Fail CLOSED on missing identity: a key built from an incomplete identity can
  // collide two different profiles/pools/targets onto one entry and serve a
  // stale WRONG answer. Better to skip the cache than to serve wrong (LAW 1). The
  // model id is part of identity too — a different model can propose differently.
  if (profileVersion == null || poolVersion == null || target == null) {
    throw new Error("makeCacheKey: profileVersion, poolVersion, and target are required (refusing to key on an incomplete identity)");
  }
  return hashInputs({ promptVersion, profileVersion, poolVersion, target, depth, model: model ?? null });
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
// so we mark a breakpoint after the last static block (persona/scope/laws/
// narration) and after the profile block (≤2 total, well under the API's limit
// of 4); the volatile depth block is never cached.
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

// The wire form. Turns planned blocks into the `system` parameter the Messages
// API takes: an ordered array of text blocks, each marked breakpoint carrying
// `cache_control: {type:"ephemeral"}` (the 5-minute TTL — cache WRITE bills at
// 1.25x input, READ at 0.1x, so break-even is 2 requests inside the window).
//
// THIS IS THE STEP THAT WAS MISSING. planCacheBreakpoints() was fully
// implemented and unit-tested since Stage J and called by NOTHING — the system
// prompt went to the wire as a plain string, so `cache_control` appeared in zero
// request bodies and the ~1.2k-token static prefix was re-billed at full input
// price on every single turn.
//
// ⚠️ MEASURE BEFORE YOU BELIEVE THE SAVING. The minimum cacheable prefix is
// MODEL-DEPENDENT and failing it is SILENT: a prefix shorter than the minimum
// simply does not cache — no error, `cache_creation_input_tokens: 0`. The
// minimum is 1024 tokens on claude-sonnet-5 (today's workhorse) and 512 on
// claude-opus-5.
//
// Measured 2026-07-24 (character count / 3.7, the usual English ratio — an
// ESTIMATE; an exact figure needs the count_tokens endpoint, i.e. a live call):
//
//   chat tool definitions (render BEFORE system) ~128 tok
//   static block  (persona+scope+laws+narration) ~651 tok
//   profile block (<user_data>)                   ~48 tok
//   -> prefix at the static breakpoint  ~779 tok
//   -> prefix at the profile breakpoint ~827 tok
//
// So on claude-sonnet-5 BOTH breakpoints currently sit UNDER the 1024 minimum
// and will not cache; on claude-opus-5 (512) both would. The wiring is still
// correct and still worth having: a below-minimum breakpoint costs nothing, and
// it starts paying the moment the prefix grows (more tools, a longer profile
// note, added laws) or the workhorse tier moves. What is NOT true today is the
// headline "~89% off the prefix" — that number is real arithmetic (see
// tests/brain/promptCacheWiring.test.js C9) but it only lands once the prefix
// clears the model's minimum. Do not quote it as a current saving.
// tests/brain/promptCacheWiring.test.js C10 pins this measurement so the day the
// prefix crosses 1024 is visible rather than discovered by accident.
function toSystemParam(blocks = []) {
  return blocks.map((b) => ({
    type: "text",
    text: b.text,
    ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
  }));
}

// One call: ordered blocks -> the cache-marked `system` request parameter.
const cachedSystemParam = (blocks) => toSystemParam(planCacheBreakpoints(blocks));

// Extended thinking only on the FIRST proposal (iter 0). Later refinement turns
// are cheap tool-driven corrections where thinking mostly burns tokens.
function thinkOnFirstOnly(iter) {
  return iter === 0;
}

module.exports = {
  BrainCache, makeCacheKey, hashInputs, stableStringify, prefilterCandidates,
  planCacheBreakpoints, toSystemParam, cachedSystemParam, thinkOnFirstOnly,
};
