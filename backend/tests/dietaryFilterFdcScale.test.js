// Regression tests for the dietary-exclusion holes exposed when the Food table
// went from 854 hand-curated names to 14,144 USDA FoodData Central names.
//
// Every case below is a MEASURED leak from scripts/auditDietaryCoverage.mjs —
// a real FDC food name that reached a vegan or vegetarian pool unexcluded — not
// a hypothetical. The Phase 4 audit was exhaustive against the corpus it had;
// it simply never contained ratites, Alaska Native game, or USDA's organ-meat
// and processed-meat vocabulary.
//
// The paired negative assertions matter as much as the positives: the fixes
// tightened two guards that exist to keep PLANT foods in, so each one is pinned
// from both directions.

const test = require("node:test");
const assert = require("node:assert");
const { adjusterExcludedByStyle } = require("../src/lib/dietaryFilter.js");

const vegan = (name) => adjusterExcludedByStyle({ name }, "vegan");
const vegetarian = (name) => adjusterExcludedByStyle({ name }, "vegetarian");

test("FDC scale: ratites and additional game birds are excluded", () => {
  for (const n of [
    "Ostrich, inside leg, raw",
    "Emu, ground, raw",
    "Pheasant, cooked, total edible",
    "Squab, (pigeon), meat only, raw",
    "Poultry, mechanically deboned, from backs and necks with skin, raw",
  ]) {
    assert.equal(vegan(n), true, `vegan should exclude: ${n}`);
    assert.equal(vegetarian(n), true, `vegetarian should exclude: ${n}`);
  }
});

test("FDC scale: large game and marine mammals are excluded", () => {
  for (const n of [
    "Whale, bowhead, subcutaneous fat (blubber) (Alaska Native)",
    "Stew, moose (Alaska Native)",
    "Caribou, eye, raw (Alaska Native)",
    "Turtle, green, raw",
  ]) {
    assert.equal(vegan(n), true, `vegan should exclude: ${n}`);
  }
});

test("FDC scale: organ meats and processed-meat forms are excluded", () => {
  for (const n of [
    "Chitterlings",
    "Gizzard",
    "Brains",
    "Bologna",
    "Liverwurst spread",
    "Soup, shark fin, restaurant-prepared",
    "Mollusks, snail, raw",
  ]) {
    assert.equal(vegan(n), true, `vegan should exclude: ${n}`);
    assert.equal(vegetarian(n), true, `vegetarian should exclude: ${n}`);
  }
});

// ── The plant-qualifier adjacency fix ──────────────────────────────────────
// The guard that protects "coconut milk" used to match its qualifier ANYWHERE
// in the name, so any food merely containing "rice"/"oat"/"soy"/"pea"/etc.
// escaped dairy exclusion entirely.
test("dairy is excluded even when a plant word appears elsewhere in the name", () => {
  for (const n of [
    "Rice, white, cooked, made with butter",
    "Puddings, rice, dry mix, prepared with whole milk",
    "Green beans, fresh, cooked with butter or margarine",
  ]) {
    assert.equal(vegan(n), true, `vegan should exclude dairy in: ${n}`);
  }
});

test("plant milks and plant butters are still NOT treated as dairy", () => {
  for (const n of [
    "Coconut milk, raw (liquid expressed from grated meat and water)",
    "Almond milk, unsweetened, plain",
    "Soymilk, original and vanilla, with added calcium",
    "Peanut butter, smooth style, with salt",
    "Beans, butter, mature seeds, canned",
    "Coconut cream, raw (liquid expressed from grated meat)",
    "Cream of tartar",
  ]) {
    assert.equal(vegan(n), false, `vegan should ALLOW plant food: ${n}`);
  }
});

test("plural dairy forms are excluded (hasWordOrPlural, not hasWord)", () => {
  // "Ice creams, vanilla, light" is how FDC writes it; the singular-only match
  // let every plural-form dairy dessert through.
  assert.equal(vegan("Ice creams, vanilla, light"), true);
  assert.equal(vegan("Creams, half and half"), true);
});

test("vegetarian still permits eggs and dairy while excluding flesh", () => {
  assert.equal(vegetarian("Eggs, whole, cooked"), false);
  assert.equal(vegetarian("Milk, whole, 3.25% milkfat"), false);
  assert.equal(vegetarian("Cheese, cheddar"), false);
  assert.equal(vegan("Eggs, whole, cooked"), true);
  assert.equal(vegan("Cheese, cheddar"), true);
});

test("brand names containing animal words are not over-matched into exclusion", () => {
  // These were false positives in the audit DETECTOR, not the filter. Pinned so
  // nobody "fixes" the filter by adding a keyword that would break them.
  assert.equal(vegan("Sauce, barbecue, SWEET BABY RAY'S, original"), false);
  assert.equal(vegan("Palm Hearts"), false);
});
