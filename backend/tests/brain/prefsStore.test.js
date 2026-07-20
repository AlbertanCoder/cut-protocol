// Stage I — brain persistence. The load-bearing invariant: the store CANNOT
// hold an exclusion (LAW 2). Everything goes through sanitizeSoft, which throws
// on any exclusion-like key and keeps only known soft signals.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertSoftOnly, sanitizeSoft, memoryPrefsStore } = require("../../src/lib/brain/prefsStore.js");

test("assertSoftOnly — soft prefs (and null) pass", () => {
  assert.doesNotThrow(() => assertSoftOnly({ likedRecipeIds: ["r1"], notes: "more fish" }));
  assert.doesNotThrow(() => assertSoftOnly(null));
});

test("assertSoftOnly — throws on exclusion-like keys in any casing/spacing (LAW 2)", () => {
  for (const bad of ["excludedFoods", "excluded_foods", "Dietary Style", "ALLERGENS", "allergies", "avoid", "intolerances"]) {
    assert.throws(() => assertSoftOnly({ [bad]: ["x"] }), /exclusion-like|LAW 2/, `expected throw for "${bad}"`);
  }
});

test("sanitizeSoft — keeps soft signals, drops unknown keys", () => {
  const out = sanitizeSoft({ likedRecipeIds: ["r1"], dislikedRecipeIds: ["r2"], cuisineNudge: { thai: 1 }, notes: "n", foo: 99, bar: "x" });
  assert.deepEqual(Object.keys(out).sort(), ["cuisineNudge", "dislikedRecipeIds", "likedRecipeIds", "notes"]);
  assert.equal("foo" in out, false);
});

test("sanitizeSoft — throws before storing if an exclusion key is present", () => {
  assert.throws(() => sanitizeSoft({ likedRecipeIds: ["r1"], excludedFoods: ["pork"] }), /exclusion-like/);
});

test("memoryPrefsStore — set/get roundtrip, sanitized to soft-only", async () => {
  const store = memoryPrefsStore();
  assert.equal(await store.get("u1"), null);
  const saved = await store.set("u1", { likedRecipeIds: ["r1"], foo: 1 });
  assert.deepEqual(saved, { likedRecipeIds: ["r1"] });
  assert.deepEqual(await store.get("u1"), { likedRecipeIds: ["r1"] });
});

test("memoryPrefsStore — refuses to store an exclusion; nothing is written", async () => {
  const store = memoryPrefsStore();
  await assert.rejects(() => store.set("u1", { dietaryStyle: "vegan" }), /exclusion-like/);
  assert.equal(await store.get("u1"), null); // never persisted
});
