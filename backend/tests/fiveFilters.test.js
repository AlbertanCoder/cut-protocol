// fiveFilters.test.js — Stage 3. The five filters: allergy (NOT ours — the wall
// lives in dietaryFilter.js), cost, time, complexity, taste.
//
// The statistical assertions run against a REAL recipe pool, not a hand-picked
// fixture: backend/src/lib/portedFromRecomp/recipeLibrary.mjs is the committed
// 602-recipe seed that the live 889-row library was built from. It ships in the
// repo, so these assertions run identically on this machine and in CI — no
// dev.db, no skip. A cherry-picked case can be made to prove anything; a pool
// of 602 real recipes cannot.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const {
  computeRecipeCost, priceFor, normaliseName, FALLBACKS, KEYWORDS, TIERS,
  scoreRecipe, explainPool, LIVE_PRICING_HOOK, COST_TABLE_META,
} = require("../src/lib/recipeCost.js");
const {
  computeComplexity, estimatePrepMin, TECHNIQUE_MINUTES,
} = require("../src/lib/recipeComplexity.js");
const { computeTaste, REVIEW_ENRICHMENT_HOOK } = require("../src/lib/recipeTaste.js");

const BACKEND = path.resolve(__dirname, "..");

// ── the real pool ──────────────────────────────────────────────────────────
let poolPromise = null;
async function realPool() {
  if (!poolPromise) {
    poolPromise = import("../src/lib/portedFromRecomp/recipeLibrary.mjs").then(({ RECIPES }) =>
      RECIPES.map((r) => {
        const servings = r.servings || 1;
        const base = {
          id: r.id,
          name: r.name,
          steps: r.steps,
          // The seed carries WHOLE-RECIPE grams + a servings count; the DB rows
          // carry per-serving grams. Divide so this pool is shaped like what the
          // solver actually sees.
          ingredients: (r.ingredients || []).map((i) => ({ name: i.name, baseGrams: (i.grams || 0) / servings })),
        };
        // The seed has no prepTimeMin. Fill it exactly the way the backfill
        // script does, so the TIME filter is exercised on derived-but-real data
        // rather than on invented numbers.
        return { ...base, prepTimeMin: estimatePrepMin(base).minutes };
      })
    );
  }
  return poolPromise;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (sortedAsc, p) => sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1))];

// ═══════════════════════════════════════════════════════════════════════════
// 1. DETERMINISM
// ═══════════════════════════════════════════════════════════════════════════

test("determinism: every scorer returns byte-identical output for identical input, across the real pool", async () => {
  const pool = await realPool();
  const sample = pool.filter((_, i) => i % 7 === 0); // 87 recipes, evenly spread
  assert.ok(sample.length > 50, `expected a meaningful sample, got ${sample.length}`);
  const ratings = new Map(sample.slice(0, 10).map((r, i) => [r.id, i % 2 === 0 ? 1 : -1]));

  for (const r of sample) {
    assert.deepEqual(computeRecipeCost(r), computeRecipeCost(r), `cost drifted for ${r.name}`);
    assert.deepEqual(computeComplexity(r), computeComplexity(r), `complexity drifted for ${r.name}`);
    assert.deepEqual(computeTaste(r, { ratings }), computeTaste(r, { ratings }), `taste drifted for ${r.name}`);
    assert.deepEqual(
      scoreRecipe(r, { maxCostCad: 6, maxTimeMin: 45, maxComplexity: 6, minTaste: 0.5, ratings }),
      scoreRecipe(r, { maxCostCad: 6, maxTimeMin: 45, maxComplexity: 6, minTaste: 0.5, ratings }),
      `scoreRecipe drifted for ${r.name}`
    );
  }
});

test("determinism: scorers do not mutate the recipe they are handed", async () => {
  const pool = await realPool();
  const r = pool[0];
  const before = JSON.stringify(r);
  computeRecipeCost(r);
  computeComplexity(r);
  computeTaste(r, { ratings: new Map([[r.id, 1]]) });
  scoreRecipe(r, { maxCostCad: 1, maxTimeMin: 1, maxComplexity: 1, minTaste: 1 });
  assert.equal(JSON.stringify(r), before, "a scorer mutated its input");
});

test("determinism: both enrichment hooks are OFF — this build makes zero network calls", () => {
  assert.equal(LIVE_PRICING_HOOK.enabled, false);
  assert.equal(LIVE_PRICING_HOOK.provider, null);
  assert.equal(REVIEW_ENRICHMENT_HOOK.enabled, false);
  assert.equal(REVIEW_ENRICHMENT_HOOK.provider, null);
  const TRANSPORTS = ["fetch(", "node:http", "require(\"https\")", "require(\"http\")", "axios", "undici", "XMLHttpRequest"];
  for (const f of ["recipeCost.js", "recipeComplexity.js", "recipeTaste.js"]) {
    const src = fs.readFileSync(path.join(BACKEND, "src", "lib", f), "utf8");
    for (const probe of TRANSPORTS) {
      assert.ok(!src.includes(probe), `${f} references a transport (${probe}) — the five filters must stay offline`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. COST — the unknown-ingredient fallback
// ═══════════════════════════════════════════════════════════════════════════

test("cost fallback: an unknown ingredient is never free, and is priced above the middle of the table", () => {
  const unknown = priceFor("Zorblat Fruit");
  assert.equal(unknown.matched, false);
  assert.equal(unknown.basis, "table-p75");
  assert.ok(unknown.pricePer100g > 0, "an unknown ingredient priced at 0 would make ignorance look like a bargain");
  assert.equal(unknown.pricePer100g, FALLBACKS.global);

  // Documented as the 75th percentile: it must sit ABOVE the table median.
  const prices = KEYWORDS.map((k) => k.cad).sort((a, b) => a - b);
  const median = pct(prices, 0.5);
  assert.ok(FALLBACKS.global > median, `global fallback ${FALLBACKS.global} must exceed the table median ${median}`);
  assert.equal(FALLBACKS.global, pct(prices, 0.75), "global fallback must equal the table's p75, as documented");
});

test("cost fallback: a known CATEGORY narrows the guess, and every category fallback is > 0", () => {
  const p = priceFor("Qorlex Loin", "protein");
  assert.equal(p.matched, false);
  assert.equal(p.basis, "category-p75");
  assert.equal(p.pricePer100g, FALLBACKS.categories.protein);
  for (const [cat, price] of Object.entries(FALLBACKS.categories)) {
    assert.ok(price > 0, `category fallback for ${cat} is ${price} — no category may default to free`);
  }
});

test("cost fallback: water is the ONE sanctioned zero, and it is a MATCH, not a fallback", () => {
  const w = priceFor("Water");
  assert.equal(w.matched, true, "water is priced by a real table entry, not by the unknown fallback");
  assert.equal(w.pricePer100g, 0);
  assert.equal(w.basis, "keyword");
  assert.ok(COST_TABLE_META.sanctionedZero.length > 0, "the zero must be documented in the table itself");
  assert.equal(priceFor("Boiling Water").pricePer100g, 0, "a real water variant still matches");

  // A zero entry may ONLY match on a word boundary. A bare substring match
  // prices "Watermelon" at $0.00 and hands a free melon the top of every
  // cost-ranked sort — the exact failure the unknown fallback exists to stop.
  const melon = priceFor("Zorblat Waterish Fruitthing");
  assert.ok(melon.pricePer100g > 0, "a name merely CONTAINING 'water' must not inherit water's zero");
  assert.equal(melon.matched, false);
  assert.ok(priceFor("Water Chestnut").pricePer100g > 0);
  assert.ok(priceFor("Watermelon").pricePer100g > 0);

  // Only the documented zero may be zero.
  const zeros = KEYWORDS.filter((k) => k.cad === 0).map((k) => k.kw);
  assert.ok(zeros.every((k) => k.includes("water")), `unexpected free ingredient(s): ${zeros.join(", ")}`);
  assert.ok(KEYWORDS.every((k) => k.cad >= 0), "no negative price may enter the table");
});

test("cost fallback: an all-unknown recipe costs REAL money, reports tier 'unknown', and does not rank cheap", async () => {
  const pool = await realPool();
  const unknownRecipe = {
    id: "unknown-1",
    name: "Zorblat Medley",
    steps: ["Combine.", "Serve."],
    ingredients: [{ name: "Zorblat Fruit", baseGrams: 200 }, { name: "Qorlex Root", baseGrams: 200 }],
  };
  const c = computeRecipeCost(unknownRecipe);
  assert.ok(c.costCad > 0, "an unpriced recipe must not cost 0");
  assert.equal(c.coverage, 0, "coverage counts only REAL matches, so a fallback-only recipe reports 0 coverage");
  assert.equal(c.tier, "unknown", "below the coverage floor the tier degrades — a guess is never sold as a measurement");
  assert.equal(c.costMatchedCad, 0);
  assert.equal(c.costFallbackCad, c.costCad);
  assert.deepEqual(c.unpricedNames, ["Zorblat Fruit", "Qorlex Root"]);

  // THE FAILURE THIS GUARDS: with a $0 default the unknown recipe is the
  // cheapest thing in the library and wins any cost-ranked sort. Assert it
  // lands in the EXPENSIVE half of the real pool instead.
  const poolCosts = pool.map((r) => computeRecipeCost(r).costCad).sort((a, b) => a - b);
  const below = poolCosts.filter((x) => x < c.costCad).length / poolCosts.length;
  assert.ok(below > 0.5, `unknown recipe sits at the ${(below * 100).toFixed(1)}th percentile of real pool cost — must be above the 50th`);
});

test("cost: longest keyword wins, so specific entries beat the generic ones they contain", () => {
  assert.equal(priceFor("Peanut Butter").keyword, "peanut butter");
  assert.notEqual(priceFor("Peanut Butter").pricePer100g, priceFor("Peanuts").pricePer100g);
  assert.equal(priceFor("Extra Virgin Olive Oil").keyword, "extra virgin olive oil");
  assert.equal(priceFor("Chicken Breast").keyword, "chicken breast");
  assert.equal(priceFor("Water Chestnut").keyword, "water chestnut");
  assert.ok(priceFor("Water Chestnut").pricePer100g > 0, "'Water Chestnut' must not inherit water's zero");
  assert.equal(normaliseName("  Chicken   BREAST "), "chicken breast");
});

test("cost: the real pool is overwhelmingly priced by real matches, not by fallbacks", async () => {
  const pool = await realPool();
  const costs = pool.map((r) => computeRecipeCost(r));
  const unknownTier = costs.filter((c) => c.tier === "unknown").length;
  assert.ok(unknownTier / pool.length < 0.05, `${unknownTier}/${pool.length} recipes fall below the coverage floor — the table has decayed`);
  assert.ok(mean(costs.map((c) => c.coverage)) > 0.9, "mean gram-coverage across the real pool must stay above 90%");
  assert.ok(costs.every((c) => c.provenance === "estimated"), "every cost carries 'estimated' provenance");
  assert.deepEqual(TIERS.map((t) => t.key), ["cheap", "moderate", "premium"], "tier bands are load-bearing for mealSolver.buildBias");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. COMPLEXITY + TIME
// ═══════════════════════════════════════════════════════════════════════════

test("complexity: score rises monotonically with ingredients, steps and techniques", () => {
  const bare = { id: "a", name: "Boiled Egg", ingredients: [{ name: "Egg", baseGrams: 50 }], steps: ["Boil the egg."] };
  const mid = { id: "b", name: "Stir Fry", ingredients: Array.from({ length: 8 }, (_, i) => ({ name: `Thing ${i}`, baseGrams: 50 })), steps: ["Chop.", "Heat.", "Fry.", "Season.", "Serve."] };
  const hard = { id: "c", name: "Croissants", ingredients: Array.from({ length: 16 }, (_, i) => ({ name: `Thing ${i}`, baseGrams: 50 })), steps: ["Knead the dough.", "Leave to rise until doubled.", "Roll out the dough.", "Chill the dough.", "Laminate.", "Shape.", "Proof the pieces.", "Egg wash.", "Bake.", "Cool.", "Deep fry a test piece.", "Marinate nothing, obviously."] };
  const s = [bare, mid, hard].map((r) => computeComplexity(r).score);
  assert.ok(s[0] < s[1] && s[1] < s[2], `expected strictly increasing scores, got ${s.join(" < ")}`);
  assert.equal(computeComplexity(bare).band, "simple");
  assert.equal(computeComplexity(hard).band, "involved");
  assert.ok(computeComplexity(hard).factors.techniques.includes("knead"));
  assert.equal(computeComplexity({}).factors.evidence, "none", "an empty row reports NO evidence rather than implying simplicity");
});

test("complexity: steps parse from an array, a JSON string, or nothing at all", () => {
  const asArray = { ingredients: [], steps: ["One.", "Two.", "Three."] };
  const asJson = { ingredients: [], steps: JSON.stringify(["One.", "Two.", "Three."]) };
  assert.deepEqual(computeComplexity(asArray), computeComplexity(asJson), "a JSON-string steps column must parse identically to a parsed array");
  assert.equal(computeComplexity({ ingredients: [], steps: "not json at all" }).factors.stepCount, 1);
  assert.equal(computeComplexity({ ingredients: [], steps: null }).factors.stepCount, 0);
});

test("time: estimatePrepMin is deterministic, floored, and tags itself 'estimated'", async () => {
  const pool = await realPool();
  for (const r of pool.slice(0, 40)) {
    const a = estimatePrepMin(r);
    assert.deepEqual(a, estimatePrepMin(r));
    assert.equal(a.provenance, "estimated", "a derived cook time must never claim to be measured");
    assert.ok(a.minutes >= 5 && a.minutes <= 240);
    assert.equal(a.minutes % 5, 0, "estimates round to 5 min — false precision on a guess is a lie");
  }
  // A slow-but-easy technique must add time WITHOUT being folded into difficulty.
  const quick = { ingredients: [{ name: "Beef", baseGrams: 200 }], steps: ["Slice.", "Serve."] };
  const slow = { ingredients: [{ name: "Beef", baseGrams: 200 }], steps: ["Slice.", "Braise for hours.", "Serve."] };
  assert.ok(estimatePrepMin(slow).minutes - estimatePrepMin(quick).minutes >= TECHNIQUE_MINUTES.braise, "braising must cost real minutes");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. TASTE — the user's own ratings win
// ═══════════════════════════════════════════════════════════════════════════

test("taste: a user's own rating dominates every weaker evidence tier", () => {
  const base = { id: "r1", name: "Garlic Butter Chicken", ingredients: [{ name: "Chicken Breast", baseGrams: 150 }, { name: "Butter", baseGrams: 10 }, { name: "Garlic", baseGrams: 5 }, { name: "Lemon", baseGrams: 10 }], steps: ["Cook."] };
  const neutral = computeTaste(base);
  const liked = computeTaste(base, { ratings: new Map([["r1", 1]]) });
  const disliked = computeTaste(base, { ratings: new Map([["r1", -1]]) });

  assert.equal(neutral.source, "ingredient_signal");
  assert.equal(liked.source, "user_rating");
  assert.equal(disliked.source, "user_rating");
  assert.ok(liked.score > neutral.score, "a like must raise the score");
  assert.ok(disliked.score < neutral.score, "a dislike must lower it");
  assert.ok(disliked.score > 0, "a dislike DAMPENS — it must never hard-exclude. Only allergies exclude.");

  // Own verdict beats a curated tier pointing the other way.
  const exceptionalButHated = computeTaste({ ...base, tasteTier: "exceptional" }, { ratings: new Map([["r1", -1]]) });
  const decentAndLoved = computeTaste({ ...base, tasteTier: "decent" }, { ratings: new Map([["r1", 1]]) });
  assert.ok(decentAndLoved.score > exceptionalButHated.score, "the owner's observed opinion beats the library's label");
});

test("taste: evidence tiers stack in the documented precedence, each naming its source", () => {
  const base = { id: "r2", name: "Plain Rice", ingredients: [{ name: "White rice, cooked", baseGrams: 200 }], steps: ["Boil."] };
  assert.equal(computeTaste(base).source, "ingredient_signal");
  assert.equal(computeTaste({ ...base, tasteTier: "really_good" }).source, "curated_tier");
  assert.equal(computeTaste({ ...base, userRatingAvg: 0.9, userRatingCount: 12 }).source, "community_aggregate");
  assert.equal(computeTaste({ ...base, userRatingAvg: 0.9, userRatingCount: 12 }, { ratings: new Map([["r2", -1]]) }).source, "user_rating");
  // A cached aggregate with ZERO ratings behind it is not evidence.
  assert.equal(computeTaste({ ...base, userRatingAvg: 0.9, userRatingCount: 0 }).source, "ingredient_signal");
  assert.ok(computeTaste({ ...base, tasteTier: "exceptional" }).score > computeTaste({ ...base, tasteTier: "decent" }).score);
});

test("taste: ratings measurably re-rank a real pool, not just a single recipe", async () => {
  const pool = await realPool();
  const disliked = pool.filter((_, i) => i % 5 === 0).map((r) => r.id); // 121 recipes
  const ratings = new Map(disliked.map((id) => [id, -1]));

  const rank = (opts) => pool.map((r) => ({ id: r.id, rank: scoreRecipe(r, opts).rank })).sort((a, b) => b.rank - a.rank);
  const before = rank({});
  const after = rank({ ratings });

  const share = (list) => list.slice(0, 100).filter((x) => disliked.includes(x.id)).length / 100;
  assert.ok(share(after) < share(before), `disliked share of the top 100 must fall (before ${share(before)}, after ${share(after)})`);
  assert.ok(share(after) < 0.05, `disliked recipes should be largely pushed out of the top 100, got ${share(after)}`);
  // ...but never removed from the pool entirely.
  assert.equal(after.length, pool.length, "a dislike re-ranks; it never shrinks the pool");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. EACH FILTER PROVABLY SHIFTS SELECTION (statistical, over the real pool)
// ═══════════════════════════════════════════════════════════════════════════

test("selection: each of the four optional caps cuts a real slice of the pool and improves its own metric", async () => {
  const pool = await realPool();
  const metrics = pool.map((r) => ({
    id: r.id,
    cost: computeRecipeCost(r).costCad,
    time: r.prepTimeMin,
    complexity: computeComplexity(r).score,
    taste: computeTaste(r).score,
  }));

  const cases = [
    { key: "cost", prefs: (m) => ({ maxCostCad: pct(m, 0.5) }), better: "lower" },
    { key: "time", prefs: (m) => ({ maxTimeMin: pct(m, 0.5) }), better: "lower" },
    { key: "complexity", prefs: (m) => ({ maxComplexity: pct(m, 0.5) }), better: "lower" },
    { key: "taste", prefs: (m) => ({ minTaste: pct(m, 0.5) }), better: "higher" },
  ];

  for (const c of cases) {
    const values = metrics.map((m) => m[c.key]).sort((a, b) => a - b);
    const res = explainPool(pool, c.prefs(values));
    assert.ok(res.survivorCount > 0, `${c.key} cap at the pool median wiped the pool`);
    assert.ok(res.survivorCount < pool.length, `${c.key} cap at the pool median removed NOTHING — the filter is inert`);

    const survivorIds = new Set(res.survivors.map((r) => r.id));
    const survivorMean = mean(metrics.filter((m) => survivorIds.has(m.id)).map((m) => m[c.key]));
    const poolMean = mean(metrics.map((m) => m[c.key]));
    if (c.better === "lower") assert.ok(survivorMean < poolMean, `${c.key}: survivors' mean ${survivorMean} should beat pool mean ${poolMean}`);
    else assert.ok(survivorMean > poolMean, `${c.key}: survivors' mean ${survivorMean} should beat pool mean ${poolMean}`);
  }
});

test("selection: the four ranking weights pick genuinely different recipes (top-40 overlap is low)", async () => {
  const pool = await realPool();
  const only = (k) => ({ cost: 0, time: 0, complexity: 0, taste: 0, [k]: 1 });
  const top = (k) => new Set(
    pool.map((r) => ({ id: r.id, rank: scoreRecipe(r, { weights: only(k) }).rank }))
      .sort((a, b) => b.rank - a.rank).slice(0, 40).map((x) => x.id)
  );
  const keys = ["cost", "time", "complexity", "taste"];
  const tops = Object.fromEntries(keys.map((k) => [k, top(k)]));
  const jaccards = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = tops[keys[i]], b = tops[keys[j]];
      const inter = [...a].filter((x) => b.has(x)).length;
      const jac = inter / (a.size + b.size - inter);
      jaccards.push(jac);
      assert.ok(jac < 0.6, `${keys[i]} vs ${keys[j]} top-40 overlap ${jac.toFixed(3)} — these two weights are not selecting differently`);
    }
  }
  // time and complexity legitimately correlate (both read step/ingredient count),
  // so the bar is on the AVERAGE across all six pairs, not on each in isolation.
  assert.ok(mean(jaccards) < 0.30, `mean pairwise top-40 Jaccard ${mean(jaccards).toFixed(3)} — the four filters are collapsing into one`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. COMPOSITION LAW + HONEST FAILURE
// ═══════════════════════════════════════════════════════════════════════════

test("composition: no cap set means no filtering — the optional four are opt-in only", async () => {
  const pool = await realPool();
  const res = explainPool(pool, {});
  assert.deepEqual(res.activeCaps, []);
  assert.equal(res.survivorCount, pool.length, "with no caps set, nothing may be removed");
  assert.equal(res.ok, true);
  assert.equal(res.bindingConstraint, null);
});

test("composition: the five-filter module never re-implements or re-checks the allergy wall", () => {
  const src = fs.readFileSync(path.join(BACKEND, "src", "lib", "recipeCost.js"), "utf8");
  for (const forbidden of ["dietaryFilter", "allergenTaxonomy", "recipeExcludedByStyle", "foodMatchesExclusionTerm"]) {
    assert.ok(!src.includes(`require("./${forbidden}`), `recipeCost.js imports ${forbidden} — allergy is a HARD upstream gate and must have exactly one implementation`);
  }
  assert.ok(src.includes("ALLERGY + DIET + MACRO TARGETS gate the pool"), "the composition law must stay documented at the call site");
});

test("honest failure: an impossible single cap is NAMED, with the measured recipe count behind the claim", async () => {
  const pool = await realPool();
  const res = explainPool(pool, { maxCostCad: 0.05, maxTimeMin: 300, maxComplexity: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.survivorCount, 0);
  assert.equal(res.bindingConstraint, "cost");
  assert.match(res.message, /binding constraint is COST/);
  assert.equal(res.liftGain.cost, pool.length, "lifting the only impossible cap must return the whole pool");
  assert.equal(res.liftGain.time, 0);
  assert.equal(res.liftGain.complexity, 0);
});

test("honest failure: when no single lift is enough, it says 'combined' and shows every cap's damage", async () => {
  const pool = await realPool();
  const res = explainPool(pool, { maxCostCad: 0.30, maxTimeMin: 8, maxComplexity: 1, minTaste: 0.95 });
  assert.equal(res.ok, false);
  assert.equal(res.bindingConstraint, "combined");
  assert.match(res.message, /binding in combination/);
  for (const k of ["cost", "time", "complexity", "taste"]) {
    assert.ok(res.message.includes(`${k} removes`), `the message must quantify ${k}, not hand-wave`);
    assert.ok(res.perCap[k].failed > 0);
  }
});

test("honest failure: an empty pool blames UPSTREAM, never one of these four filters", () => {
  const res = explainPool([], {});
  assert.equal(res.ok, false);
  assert.equal(res.bindingConstraint, "pool");
  assert.match(res.message, /upstream/);
  assert.match(res.message, /diet, allergies or the macro targets/);
  assert.ok(!/loosen your allergies/i.test(res.message), "the honesty layer must never suggest relaxing an allergy");
});

test("honest failure: ok is NEVER true on an under-filled pool, across many random stacks", async () => {
  const pool = await realPool();
  // Deterministic sweep, not RNG — a flaky honesty test is worse than none.
  const grid = [];
  for (const cost of [0.5, 2, 5, 20]) {
    for (const time of [10, 25, 45, 200]) {
      for (const cx of [1, 3, 6, 10]) grid.push({ maxCostCad: cost, maxTimeMin: time, maxComplexity: cx, minSurvivors: 3 });
    }
  }
  let failures = 0;
  for (const prefs of grid) {
    const res = explainPool(pool, prefs);
    assert.equal(res.ok, res.survivorCount >= 3, `ok disagreed with the survivor count for ${JSON.stringify(prefs)}`);
    if (!res.ok) {
      failures++;
      assert.ok(res.bindingConstraint != null, `a failing stack must name a constraint: ${JSON.stringify(prefs)}`);
      assert.ok(res.message.length > 20);
    } else {
      assert.equal(res.bindingConstraint, null);
    }
  }
  assert.ok(failures > 0, "the sweep never over-constrained — it is not testing the honest-fail path");
  assert.ok(failures < grid.length, "the sweep never SUCCEEDED — the caps are miscalibrated");
});

test("composition: an unknown prep time is REPORTED, never silently treated as a pass or a fail", () => {
  const noTime = { id: "nt", name: "Mystery", ingredients: [{ name: "Egg", baseGrams: 50 }], steps: ["Cook."] };
  const lenient = scoreRecipe(noTime, { maxTimeMin: 10 });
  assert.equal(lenient.time.known, false);
  assert.ok(lenient.unevaluable.includes("time:unknown"), "an unevaluable cap must be declared");
  assert.equal(lenient.passesHardCaps, true, "default policy matches mealSolver.applyPrepFilter: a null prep time is not removed");

  const strict = scoreRecipe(noTime, { maxTimeMin: 10, unknownTimePolicy: "fail" });
  assert.equal(strict.passesHardCaps, false);
  assert.equal(strict.bindingConstraint, "time");
  assert.ok(strict.unevaluable.includes("time:unknown"));
});

test("composition: scoreRecipe reports every cap it failed, in a stable priority order", () => {
  const bad = { id: "bad", name: "Saffron Lobster Extravaganza", prepTimeMin: 200, ingredients: [{ name: "Lobster", baseGrams: 400 }, { name: "Saffron", baseGrams: 5 }, ...Array.from({ length: 14 }, (_, i) => ({ name: `Thing ${i}`, baseGrams: 20 }))], steps: Array.from({ length: 14 }, (_, i) => `Step ${i}: knead, braise, laminate and marinate.`) };
  const s = scoreRecipe(bad, { maxCostCad: 3, maxTimeMin: 30, maxComplexity: 4, minTaste: 0.95 });
  assert.equal(s.passesHardCaps, false);
  assert.deepEqual(s.violations, ["cost", "time", "complexity", "taste"], "all four must be reported — a filter is never silently dropped");
  assert.equal(s.bindingConstraint, "cost", "per-recipe binding constraint is the first cap in the fixed order");
  assert.ok(s.rank >= 0 && s.rank <= 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE BACKFILL SCRIPT'S SAFETY CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "five-filters-"));
  const file = path.join(dir, "test.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE Food (id TEXT PRIMARY KEY, name TEXT, category TEXT);
    CREATE TABLE Recipe (id TEXT PRIMARY KEY, name TEXT, steps TEXT, prepTimeMin INTEGER,
      tasteTier TEXT, userRatingAvg REAL, userRatingCount INTEGER,
      costPerServing REAL, difficulty INTEGER, filterProvenance TEXT);
    CREATE TABLE RecipeIngredient (id TEXT PRIMARY KEY, recipeId TEXT, foodId TEXT, baseGrams REAL);
    INSERT INTO Food VALUES ('f1','Chicken Breast','protein'),('f2','White rice, cooked','grains'),('f3','Zorblat Root','fruit-veg');
    INSERT INTO Recipe (id,name,steps,prepTimeMin) VALUES
      ('r1','Measured Dish','["Chop.","Cook.","Serve."]',22),
      ('r2','Unmeasured Dish','["Knead the dough.","Leave to rise until doubled.","Bake."]',NULL);
    INSERT INTO RecipeIngredient VALUES
      ('i1','r1','f1',150),('i2','r1','f2',200),
      ('i3','r2','f2',120),('i4','r2','f3',60);
  `);
  db.close();
  return { dir, file };
}

function runBackfill(args) {
  return spawnSync(process.execPath, ["scripts/backfillRecipeFilters.mjs", ...args], { cwd: BACKEND, encoding: "utf8" });
}

test("backfill: DRY RUN is the default and writes absolutely nothing", () => {
  const { dir, file } = makeTempDb();
  try {
    const before = fs.readFileSync(file);
    const out = runBackfill([`--db=${file}`]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /DRY RUN/);
    assert.match(out.stdout, /nothing written/);
    assert.ok(fs.readFileSync(file).equals(before), "a dry run modified the database file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backfill: --apply writes derived values, stamps 'estimated' provenance, and never overwrites a measured time", () => {
  const { dir, file } = makeTempDb();
  try {
    const out = runBackfill([`--db=${file}`, "--apply"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /APPLIED — 2 rows updated in one transaction/);

    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT * FROM Recipe ORDER BY id").all();
    db.close();

    const [r1, r2] = rows;
    assert.equal(r1.prepTimeMin, 22, "a MEASURED prepTimeMin must survive the backfill untouched");
    assert.equal(JSON.parse(r1.filterProvenance).prepTimeMin, "measured");
    assert.ok(r2.prepTimeMin > 0, "a NULL prepTimeMin must be filled");
    assert.equal(JSON.parse(r2.filterProvenance).prepTimeMin, "estimated", "a derived time must be labelled derived");

    for (const r of rows) {
      assert.ok(r.costPerServing > 0, "cost must be written and must never be 0");
      assert.ok(r.difficulty >= 1 && r.difficulty <= 10);
      const prov = JSON.parse(r.filterProvenance);
      assert.equal(prov.costPerServing, "estimated");
      assert.equal(prov.difficulty, "estimated");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backfill: refuses a missing database path rather than creating an empty one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "five-filters-missing-"));
  const ghost = path.join(dir, "does-not-exist.db");
  try {
    const out = runBackfill([`--db=${ghost}`]);
    assert.notEqual(out.status, 0, "it must exit non-zero");
    assert.match(out.stderr, /Refusing to continue/);
    assert.equal(fs.existsSync(ghost), false, "the script CREATED a database at a path that had none — that is the silent-data-loss bug");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
