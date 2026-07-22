const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseIngredientLine, isoDurationToMinutes, freeformDurationToMinutes, extractJsonLdBlocks,
  findRecipeNode, parseSteps, parseServings, isSectionHeaderLine, extractRecipeFromHtml,
  CATEGORY_ROLE, PROVIDERS,
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

// ── hardened ingredient-line parsing (Paprika-class cases) ────────────────

test("unit variants and abbreviations: Tbsp./tsp./fl oz/qt/pt/gal/metric", () => {
  assert.equal(parseIngredientLine("2 Tbsp. olive oil").unit, "tbsp");
  assert.equal(parseIngredientLine("1 tsp. smoked paprika").unit, "tsp");
  const floz = parseIngredientLine("8 fl oz heavy cream");
  assert.equal(floz.unit, "floz");
  assert.equal(floz.grams, 240, "8 fl oz = 1 cup, density-aware");
  assert.equal(parseIngredientLine("1 qt chicken broth").unit, "qt");
  assert.equal(parseIngredientLine("2 pt milk").unit, "pt");
  assert.equal(parseIngredientLine("1 gal water").unit, "gal");
  assert.equal(parseIngredientLine("500 g carrots").grams, 500);
  assert.equal(parseIngredientLine("1 kg potatoes").grams, 1000);
  assert.equal(parseIngredientLine("2 dl cream").unit, "dl");
  assert.equal(parseIngredientLine("1 cl vanilla").unit, "cl");
});

test("1 stick butter converts exactly (the classic US-recipe unit)", () => {
  const stick = parseIngredientLine("1 stick butter");
  assert.equal(stick.grams, 113);
  assert.equal(stick.estimated, true);
});

test("sized containers: '2 (14.5 oz) cans' and '2 15 oz. cans' convert exactly by count x size, never a mis-guessed flat weight", () => {
  const withParens = parseIngredientLine("2 (14.5 oz) cans diced tomatoes");
  assert.equal(withParens.unit, "can");
  assert.equal(withParens.name, "tomatoes");
  assert.ok(Math.abs(withParens.grams - 822.15) < 0.5, `expected ~822g, got ${withParens.grams}`);
  assert.equal(withParens.estimated, false);

  // Regression case: before hardening, the "15" token got swallowed into the
  // ingredient name and the line silently fell back to a wrong flat
  // piece-weight guess (240g) instead of the correct count x size (~850g).
  const bare = parseIngredientLine("2 15 oz. cans diced tomatoes");
  assert.equal(bare.unit, "can");
  assert.equal(bare.name, "tomatoes");
  assert.ok(Math.abs(bare.grams - 850.5) < 0.5, `expected ~850g (2 x 15oz), got ${bare.grams}`);
  assert.equal(bare.estimated, false);

  const single = parseIngredientLine("1 (400g) can chickpeas");
  assert.equal(single.grams, 400);
  assert.equal(single.estimated, false);
});

test("trailing-unit pieces: '2 garlic cloves' (unit AFTER the name) converts the same as '2 cloves garlic'", () => {
  const trailing = parseIngredientLine("2 garlic cloves");
  assert.equal(trailing.unit, "clove");
  assert.equal(trailing.name, "garlic");
  assert.equal(trailing.grams, 10);

  const leading = parseIngredientLine("2 cloves garlic");
  assert.equal(leading.grams, trailing.grams);

  // trailing-unit detection must not misfire on ordinary plural food names
  const onions = parseIngredientLine("2 onions, diced");
  assert.equal(onions.unit, null);
  assert.equal(onions.grams, 300);
});

test("parenthetical weight hints override generic density estimates with the author's own stated conversion", () => {
  const withHint = parseIngredientLine("1 cup chopped walnuts (150g)");
  assert.equal(withHint.grams, 150, "explicit (150g) wins over the generic walnuts cup-density guess");
  assert.equal(withHint.estimated, false);

  const noUnitPrimary = parseIngredientLine("1 block firm tofu (about 400g), cubed");
  assert.equal(noUnitPrimary.grams, 400, "parenthetical hint is the ONLY source of grams here — otherwise honestly null");
  assert.equal(noUnitPrimary.estimated, false);

  // A purely descriptive parenthetical with no amount+unit inside is left
  // alone — never treated as a hint, never fabricated.
  const descriptiveOnly = parseIngredientLine("1 lb potatoes (about 2 medium), diced");
  assert.equal(descriptiveOnly.grams, 453.6, "falls back to the primary '1 lb', not a guess from '2 medium'");

  // A sized-container match already accounts for count x size; the generic
  // paren-hint pass must not double-apply and override it with a single-unit
  // reading of the same parens.
  const sized = parseIngredientLine("2 (14.5 oz) cans diced tomatoes");
  assert.ok(Math.abs(sized.grams - 822.15) < 0.5, "sized-container math wins, not a single-can reading of the same parens");
});

test("ml/l/dl/cl now convert through the same food-specific density table as cup/tbsp/tsp, not a flat 1ml=1g guess", () => {
  const wine = parseIngredientLine("250 ml red wine");
  assert.ok(Math.abs(wine.grams - 253.6) < 0.5, `expected density-aware ~253.6g, got ${wine.grams}`);
  assert.equal(wine.estimated, false, "wine matched a known density, so it's not flagged estimated");

  const unknownMl = parseIngredientLine("100 ml zorblat extract");
  assert.equal(unknownMl.estimated, true, "unmatched density still honestly flagged estimated");
});

test("EU decimal-comma quantities parse: '1,5 kg' == 1.5 kg", () => {
  const r = parseIngredientLine("1,5 kg flour");
  assert.equal(r.qty, 1.5);
  assert.equal(r.grams, 1500);
});

test("isSectionHeaderLine: recognizes group-header lines, not real ingredients", () => {
  assert.equal(isSectionHeaderLine("For the sauce:"), true);
  assert.equal(isSectionHeaderLine("For the Crust"), true);
  assert.equal(isSectionHeaderLine("Dressing:"), true);
  assert.equal(isSectionHeaderLine("Optional:"), true);
  assert.equal(isSectionHeaderLine("2 tbsp olive oil"), false);
  assert.equal(isSectionHeaderLine("Salt and pepper, to taste"), false);
});

// ── multi-stage extraction: JSON-LD -> microdata -> RDFa -> heuristic ────

const FIXTURES_DIR = path.join(__dirname, "fixtures", "recipes");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");

test("microdata: extracts a Recipe itemscope, ignores itemprops outside its scope, meta/content values", () => {
  const r = extractRecipeFromHtml(readFixture("microdata-basic.html"), "https://x.test/a");
  assert.equal(r.extractionMethod, "microdata");
  assert.equal(r.name, "Classic Beef Chili", "must not pick up the nested author's name");
  assert.equal(r.servings, 6);
  assert.equal(r.prepTimeMin, 90, "cookTime meta content parsed");
  assert.equal(r.cuisine, "Tex-Mex");
  assert.equal(r.ingredients.length, 6);
  assert.equal(r.steps.length, 3);
});

test("microdata: itemtype with a trailing slash, meta content, single instructions block", () => {
  const r = extractRecipeFromHtml(readFixture("microdata-meta-content.html"), "https://x.test/b");
  assert.equal(r.name, "Overnight Oats");
  assert.equal(r.servings, 2);
  assert.equal(r.prepTimeMin, 5);
  assert.equal(r.ingredients.length, 5);
  assert.ok(r.steps.length >= 1);
});

test("RDFa: vocab/typeof/property Recipe, repeated property nodes as steps", () => {
  const r = extractRecipeFromHtml(readFixture("rdfa-basic.html"), "https://x.test/c");
  assert.equal(r.extractionMethod, "rdfa");
  assert.equal(r.name, "Garlic Butter Shrimp");
  assert.equal(r.servings, 4);
  assert.equal(r.ingredients.length, 6);
  assert.equal(r.steps.length, 4);
});

test("RDFa: nested typeof=Person for author doesn't leak its 'name' into the recipe's name", () => {
  const r = extractRecipeFromHtml(readFixture("rdfa-with-nested-author.html"), "https://x.test/d");
  assert.equal(r.name, "Herb Roasted Potatoes");
  assert.notEqual(r.name, "Not The Recipe Name");
});

test("heuristic fallback: WPRM-style class names, no structured data at all", () => {
  const r = extractRecipeFromHtml(readFixture("heuristic-wprm-style.html"), "https://x.test/e");
  assert.equal(r.extractionMethod, "heuristic");
  assert.equal(r.name, "Honey Garlic Salmon");
  assert.equal(r.ingredients.length, 5);
  assert.ok(r.ingredients[0].includes("salmon"));
});

test("heuristic fallback: Tasty-Recipes-style, title falls back from missing h1 to a recipe-title-classed element", () => {
  const r = extractRecipeFromHtml(readFixture("heuristic-tasty-style.html"), "https://x.test/f");
  assert.equal(r.name, "Creamy Mushroom Pasta");
  assert.equal(r.ingredients.length, 7);
});

test("heuristic fallback: plain blog with zero classes/microdata — Ingredients heading + next <ul>", () => {
  const r = extractRecipeFromHtml(readFixture("heuristic-plain-blog.html"), "https://x.test/g");
  assert.equal(r.name, "My Grandmother's Banana Bread");
  assert.equal(r.ingredients.length, 8);
  assert.equal(r.steps.length, 6);
});

test("heuristic fallback: freeform 'Yield: 12 pancakes' / 'Prep: 5 min' text parses servings and time", () => {
  const r = extractRecipeFromHtml(readFixture("heuristic-recipeyield-text.html"), "https://x.test/h");
  assert.equal(r.servings, 12);
  assert.equal(r.ingredients.length, 7);
});

test("resilience: malformed JSON-LD on a page that also ships microdata falls through instead of failing", () => {
  const r = extractRecipeFromHtml(readFixture("jsonld-broken-then-microdata.html"), "https://x.test/i");
  assert.equal(r.extractionMethod, "microdata");
  assert.equal(r.name, "Simple Tomato Soup");
  assert.equal(r.ingredients.length, 5);
});

test("resilience: a stub JSON-LD Recipe with an empty ingredient list falls through to microdata on the same page", () => {
  const r = extractRecipeFromHtml(readFixture("empty-ingredients-jsonld-falls-back.html"), "https://x.test/j");
  assert.equal(r.extractionMethod, "microdata");
  assert.equal(r.name, "Real Recipe Name");
  assert.equal(r.ingredients.length, 3);
});

test("section headers inside a real ingredient list are dropped, not surfaced as fake unconvertible ingredients", () => {
  const r = extractRecipeFromHtml(readFixture("ingredient-stress-sections.html"), "https://x.test/k");
  assert.equal(r.ingredients.length, 7, "3 'For the X:' header lines removed from 10 raw lines");
  assert.ok(!r.ingredients.some((i) => /^for the/i.test(i)));
});

test("JSON-LD text with literal HTML entities ('&frac12;', '&#8217;') decodes correctly — a real bug found live on a public recipe site whose schema generator never decoded entities before embedding them as JSON string text", () => {
  const r = extractRecipeFromHtml(readFixture("jsonld-html-entities.html"), "https://x.test/m");
  assert.equal(r.ingredients[1], "½ cup finely chopped white onion");
  assert.equal(r.ingredients[2], "¼ cup finely chopped fresh cilantro");
  assert.ok(r.steps[1].includes("doesn’t sing"), "numeric entity &#8217; decoded to a real apostrophe");
  const parsed = parseIngredientLine(r.ingredients[1]);
  assert.equal(parsed.qty, 0.5);
  assert.ok(parsed.grams != null, "the decoded unicode fraction converts instead of silently failing");
});

test("honest failure: a page with no structured data AND no recognizable ingredient list throws, never fabricates a recipe", () => {
  assert.throws(() => extractRecipeFromHtml(readFixture("genuinely-unparseable.html"), "https://x.test/l"), /no recipe data found/);
});

test("freeformDurationToMinutes: 'Total Time: 25 minutes' style text, hours+minutes combined", () => {
  assert.equal(freeformDurationToMinutes("25 minutes"), 25);
  assert.equal(freeformDurationToMinutes("1 hour 30 minutes"), 90);
  assert.equal(freeformDurationToMinutes("2 hrs"), 120);
  assert.equal(freeformDurationToMinutes("whenever"), null);
});

// ── fixture-set regression floor ──────────────────────────────────────────
// Guards the measured before/after improvement: every fixture except the
// deliberately-unparseable one must keep parsing. If a future change drops
// this, it's a real regression, not a fixture quirk.

test("fixture set: every real-recipe fixture parses; the genuinely-unparseable one still fails honestly", () => {
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".html"));
  assert.ok(files.length >= 15, "fixture set should stay substantial");
  let passed = 0;
  const failures = [];
  for (const file of files) {
    try {
      const r = extractRecipeFromHtml(readFixture(file), `https://x.test/${file}`);
      if (r.ingredients.length > 0) passed++;
    } catch (e) {
      failures.push({ file, error: e.message });
    }
  }
  assert.equal(failures.length, 1, `expected only genuinely-unparseable.html to fail, got: ${JSON.stringify(failures)}`);
  assert.equal(failures[0].file, "genuinely-unparseable.html");
  const rate = passed / files.length;
  assert.ok(rate >= 0.9, `pass rate regressed: ${(rate * 100).toFixed(1)}% (${passed}/${files.length})`);
});
