const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseIngredientLine, isoDurationToMinutes, extractJsonLdBlocks,
  findRecipeNode, parseSteps, parseServings, CATEGORY_ROLE, PROVIDERS,
} = require("../src/lib/recipeImporter.js");

// ── ingredient-line parsing ──────────────────────────────────────────────

test("quantities: decimals, fractions, unicode, mixed, ranges", () => {
  assert.equal(parseIngredientLine("2 cups flour").qty, 2);
  assert.equal(parseIngredientLine("1/2 cup sugar").qty, 0.5);
  assert.equal(parseIngredientLine("1 1/2 cups milk").qty, 1.5);
  assert.equal(parseIngredientLine("½ cup yogurt").qty, 0.5);
  assert.equal(parseIngredientLine("1½ cups rice").qty, 1.5);
  assert.equal(parseIngredientLine("2.5 lbs chicken breast").qty, 2.5);
  assert.equal(parseIngredientLine("1-2 tbsp olive oil").qty, 1.5, "ranges use the midpoint");
});

test("weight units convert exactly; volume converts via density with the estimate flag", () => {
  const g = parseIngredientLine("250 g chickpeas");
  assert.equal(g.grams, 250);
  assert.equal(g.estimated, false);

  const lb = parseIngredientLine("1 lb ground beef");
  assert.equal(lb.grams, 453.6);

  const cup = parseIngredientLine("2 cups flour");
  assert.equal(cup.grams, 240, "flour density 120 g/cup");
  assert.equal(cup.estimated, false);

  const unknownCup = parseIngredientLine("1 cup zorblat powder");
  assert.equal(unknownCup.grams, 240, "unknown density falls back to water-ish");
  assert.equal(unknownCup.estimated, true);

  const tbsp = parseIngredientLine("2 tbsp olive oil");
  assert.ok(Math.abs(tbsp.grams - 27.3) < 0.5, `tbsp oil ≈ 27 g, got ${tbsp.grams}`);
});

test("piece units: cloves, cans, bare counts; honest null when unconvertible", () => {
  assert.equal(parseIngredientLine("2 cloves garlic, minced").grams, 10);
  assert.equal(parseIngredientLine("1 can chickpeas, drained").grams, 240);
  assert.equal(parseIngredientLine("3 eggs").grams, 150);
  assert.equal(parseIngredientLine("2 onions, diced").grams, 300);
  const un = parseIngredientLine("some mystery essence");
  assert.equal(un.grams, null, "no amount + no rule → null, never invented");
});

test("names are cleaned of prep words and parentheticals", () => {
  assert.equal(parseIngredientLine("2 cups finely chopped onion").name, "onion");
  assert.equal(parseIngredientLine("1 lb chicken breast (boneless, skinless)").name, "chicken breast");
  assert.equal(parseIngredientLine("3 large ripe tomatoes, diced").name, "tomatoes");
});

// ── schema.org extraction ────────────────────────────────────────────────

const FIXTURE_HTML = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Some Site"},
  {"@type":"Recipe","name":"Chickpea Curry",
   "description":"A cozy curry.",
   "recipeYield":"4 servings",
   "totalTime":"PT45M",
   "recipeCuisine":["Indian"],
   "recipeIngredient":["1 can chickpeas, drained","1 cup coconut milk","2 cloves garlic"],
   "recipeInstructions":[
     {"@type":"HowToStep","text":"Saute the garlic."},
     {"@type":"HowToStep","text":"Add chickpeas and coconut milk; simmer."}
   ]}
]}
</script>
</head><body></body></html>`;

test("JSON-LD: finds the Recipe node inside @graph, parses yield/time/steps", () => {
  const blocks = extractJsonLdBlocks(FIXTURE_HTML);
  assert.equal(blocks.length, 1);
  const node = findRecipeNode(blocks);
  assert.ok(node, "Recipe node found");
  assert.equal(node.name, "Chickpea Curry");
  assert.equal(parseServings(node.recipeYield), 4);
  assert.equal(isoDurationToMinutes(node.totalTime), 45);
  const steps = parseSteps(node.recipeInstructions);
  assert.equal(steps.length, 2);
  assert.equal(steps[0], "Saute the garlic.");
});

test("ISO durations: hours+minutes, days, garbage → null", () => {
  assert.equal(isoDurationToMinutes("PT1H30M"), 90);
  assert.equal(isoDurationToMinutes("PT20M"), 20);
  assert.equal(isoDurationToMinutes("P1DT2H"), 1560);
  assert.equal(isoDurationToMinutes("whenever"), null);
  assert.equal(isoDurationToMinutes(null), null);
});

test("malformed JSON-LD blocks are skipped, not fatal", () => {
  const html = `<script type="application/ld+json">{broken json</script>` + FIXTURE_HTML;
  const blocks = extractJsonLdBlocks(html);
  assert.equal(blocks.length, 1, "only the valid block survives");
  assert.ok(findRecipeNode(blocks));
});

// ── plumbing ─────────────────────────────────────────────────────────────

test("category→role mapping covers every grocery category", () => {
  for (const cat of ["protein", "dairy-eggs", "fruit-veg", "grains", "fats-nuts-oils", "pantry", "drinks"]) {
    assert.ok(CATEGORY_ROLE[cat] !== undefined, `role mapping missing for ${cat}`);
  }
});

test("provider seam: schema.org registered and structured for paid add-ons", () => {
  assert.equal(PROVIDERS[0].name, "schema.org");
  assert.equal(typeof PROVIDERS[0].canHandle, "function");
  assert.equal(typeof PROVIDERS[0].extract, "function");
});
