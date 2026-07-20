// Stage J — cost controls. Version-hash cache (a stale input never serves a
// wrong answer), deterministic candidate prefilter, cache-breakpoint planning,
// think-on-first-only. All pure + keyless.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BrainCache, makeCacheKey, hashInputs, prefilterCandidates, planCacheBreakpoints, thinkOnFirstOnly } = require("../../src/lib/brain/cache.js");

test("hashInputs is order-independent and value-sensitive", () => {
  assert.equal(hashInputs({ a: 1, b: 2 }), hashInputs({ b: 2, a: 1 }));
  assert.notEqual(hashInputs({ a: 1 }), hashInputs({ a: 2 }));
});

test("makeCacheKey busts on ANY version/input change", () => {
  const base = { promptVersion: "v3", profileVersion: "p1", poolVersion: "x1", target: { kcal: 2000 }, depth: "balanced" };
  const k = makeCacheKey(base);
  assert.equal(k, makeCacheKey({ ...base })); // stable
  assert.notEqual(k, makeCacheKey({ ...base, profileVersion: "p2" })); // profile changed
  assert.notEqual(k, makeCacheKey({ ...base, poolVersion: "x2" })); // pool changed
  assert.notEqual(k, makeCacheKey({ ...base, target: { kcal: 2100 } })); // target changed
  assert.notEqual(k, makeCacheKey({ ...base, depth: "thorough" })); // depth changed
});

test("BrainCache — set/get roundtrip and miss", () => {
  const c = new BrainCache();
  assert.equal(c.get("nope"), null);
  c.set("k", { a: 1 });
  assert.deepEqual(c.get("k"), { a: 1 });
  assert.equal(c.has("k"), true);
});

test("BrainCache — TTL expiry (injected clock)", () => {
  let t = 1000;
  const c = new BrainCache({ ttlMs: 100, now: () => t });
  c.set("k", "v");
  t = 1050; assert.equal(c.get("k"), "v"); // within TTL
  t = 1200; assert.equal(c.get("k"), null); // expired
});

test("BrainCache — LRU eviction past max", () => {
  const c = new BrainCache({ max: 2 });
  c.set("a", 1); c.set("b", 2); c.set("c", 3); // a is oldest -> evicted
  assert.equal(c.get("a"), null);
  assert.equal(c.get("b"), 2);
  assert.equal(c.get("c"), 3);
});

test("prefilterCandidates — top-K by proximity + protein density, deterministic", () => {
  const cands = [
    { id: "a", kcal: 500, protein: 50 },
    { id: "b", kcal: 250, protein: 40 },
    { id: "c", kcal: 500, protein: 20 },
    { id: "d", kcal: 1000, protein: 60 },
  ];
  const top = prefilterCandidates(cands, { kcal: 500 }, { k: 2 });
  assert.deepEqual(top.map((x) => x.id), ["a", "c"]); // on-target + higher protein first
  assert.deepEqual(prefilterCandidates(cands, { kcal: 500 }, { k: 2 }).map((x) => x.id), ["a", "c"]); // deterministic
  assert.equal(prefilterCandidates(cands, { kcal: 500 }, { k: 10 }).length, 4); // k>len -> all
});

test("planCacheBreakpoints — cache the static + profile prefixes, never the volatile block", () => {
  const out = planCacheBreakpoints([
    { role: "static", text: "persona" },
    { role: "static", text: "laws" },
    { role: "profile", text: "prof" },
    { role: "volatile", text: "depth" },
  ]);
  assert.equal(out[1].cache, true); // last static
  assert.equal(out[0].cache, undefined); // earlier static not a breakpoint
  assert.equal(out[2].cache, true); // profile
  assert.equal(out[3].cache, undefined); // volatile depth never cached
});

test("thinkOnFirstOnly — extended thinking only on the first proposal", () => {
  assert.equal(thinkOnFirstOnly(0), true);
  assert.equal(thinkOnFirstOnly(1), false);
  assert.equal(thinkOnFirstOnly(5), false);
});
