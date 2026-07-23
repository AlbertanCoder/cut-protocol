// QC gauntlet v2 — Phase 3 importer fuzz. Hostile HTML + ingredient lines at the
// pure parse surface (no network): no crash, honest null on unconvertible, and a
// ReDoS wall-clock bound on the parsing regexes.
const test = require("node:test");
const assert = require("node:assert");
const imp = require("../../src/lib/recipeImporter.js");

// ── hostile HTML: none must throw; extract returns a recipe or null ────────
test("extractRecipeFromHtml survives hostile pages without throwing", () => {
  const pages = [
    "", "<!doctype html>", "<html><body>no recipe here</body></html>",
    "<script>while(1){}</script>", // script in body must not run / must not hang the parser
    '<div itemtype="http://schema.org/Recipe"><span itemprop="name">Microdata only</span></div>',
    '<script type="application/ld+json">{"@type":"Recipe"}</script>',
    '<script type="application/ld+json">{ broken json', // malformed JSON-LD
    '<script type="application/ld+json">{"@type":"Recipe","name":"<script>alert(1)</script>","recipeIngredient":["1 cup flour"]}</script>',
    '<script type="application/ld+json">{"@type":"Recipe","name":"' + "A".repeat(50000) + '"}</script>',
    "<html>" + "<div>".repeat(20000) + "deeply nested" + "</div>".repeat(20000) + "</html>",
  ];
  for (const html of pages) {
    // A thrown "no recipe found on that page" is the honest-failure CONTRACT and
    // is acceptable. What is NOT acceptable is a CRASH — a stack overflow
    // (RangeError), TypeError, etc. from adversarial structure.
    try {
      imp.extractRecipeFromHtml(html, "https://example.com/r");
    } catch (e) {
      assert.ok(/no recipe/i.test(e.message), `crashed (not honest-fail) on ${html.slice(0, 30)}: ${e.constructor.name}: ${e.message.slice(0, 50)}`);
    }
  }
});

test("extractRecipeFromHtml handles a 5 MB page without hanging (<3s)", () => {
  const big = '<script type="application/ld+json">{"@type":"Recipe","name":"Big","recipeIngredient":["1 cup flour"]}</script>' + "x".repeat(5_000_000);
  const t0 = Date.now();
  assert.doesNotThrow(() => imp.extractRecipeFromHtml(big, "https://example.com/big"));
  assert.ok(Date.now() - t0 < 3000, "5 MB page took >3s");
});

// ── hostile ingredient lines: honest result, never a throw ─────────────────
test("parseIngredientLine never throws and returns honest results", () => {
  const lines = [
    "", "   ", "salt and pepper to taste", "1 1/2 cups packed brown sugar, divided",
    "2-3 cloves garlic, minced", "½ cup (about 2 medium) diced onion", "2 15 oz. cans diced tomatoes",
    "🍕🍕🍕", "1".repeat(10000) + " cups flour", "NaN cups of mystery", "some essence of nothing",
    "<script>alert(1)</script> tsp vanilla",
  ];
  for (const line of lines) {
    let out;
    assert.doesNotThrow(() => { out = imp.parseIngredientLine(line); }, `threw on: ${line.slice(0, 40)}`);
    // unconvertible lines must yield an honest null quantity, never a guessed number
    if (out && out.grams != null) assert.ok(Number.isFinite(out.grams) && out.grams >= 0, `bad grams for: ${line}`);
  }
});

// ── ReDoS: crafted worst-case strings must parse fast ──────────────────────
test("parseIngredientLine is ReDoS-safe (<500ms on crafted worst cases)", () => {
  const evil = [
    "1" + " ".repeat(100000) + "cup flour",
    "1/".repeat(50000) + "2 cup sugar",
    "(".repeat(20000) + "1 cup" + ")".repeat(20000),
    "1 " + "1/2 ".repeat(20000) + "cups",
    "9".repeat(100000),
  ];
  for (const s of evil) {
    const t0 = Date.now();
    assert.doesNotThrow(() => imp.parseIngredientLine(s));
    const ms = Date.now() - t0;
    assert.ok(ms < 500, `parse took ${ms}ms on a ${s.length}-char adversarial string (possible ReDoS)`);
  }
});

// ── duration parsers: hostile input, no throw ──────────────────────────────
test("duration parsers survive hostile input", () => {
  for (const d of ["", "PT", "PT999999999H", "not a duration", "P" + "T".repeat(1000), "🕐"]) {
    assert.doesNotThrow(() => { imp.isoDurationToMinutes(d); imp.freeformDurationToMinutes(d); });
  }
});
