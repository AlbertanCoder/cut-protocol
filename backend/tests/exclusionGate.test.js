// The exclusion gate — one authority for "may this user see this recipe?".
//
// Background: five surfaces answered that question and four of them answered
// it with ingredient NAMES only. Measured against the real 889-recipe library
// that was 210 recipe/allergy pairs the solver correctly hid and the library
// browse, the cart and the brain pool still showed:
//
//   dairy 30 · gluten 62 · eggs 33 · soy 24 · peanuts 1 · tree nuts 10 ·
//   fish 39 · shellfish 6 · sesame 5   = 210
//
// These tests pin the three mechanisms that make that unrepresentable rather
// than merely fixed: the gate owns the evidence, a degraded recipe fails
// closed, and no new surface may import the weak primitives.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  RECIPE_GATE_SELECT, FOOD_GATE_SELECT,
  explainRecipeExclusion, explainExclusion, isExcluded, recipeAllowed,
  partitionRecipes, filterRecipes, collectEvidence, isCheckableName,
} = require("../src/lib/exclusionGate.js");
const { filterRecipePool } = require("../src/lib/planContext.js");
const brain = require("../src/lib/brain/exclusions.js");

const SRC = path.join(__dirname, "..", "src");

// ── fixtures ──────────────────────────────────────────────────────────────
// Shaped like the DB rows every gated surface loads: ingredients carry the
// WHOLE Food row, and the recipe carries its steps.
function food(name, over = {}) {
  return { id: `f-${name}`, name, category: "other", kcal: 100, protein: 5, fat: 2, carb: 10, fiber: 0, ...over };
}
function recipe(name, foods, over = {}) {
  return {
    id: `r-${name}`, name, slotType: "meal", mealCategory: null, cuisine: null,
    kcal: 500, protein: 30, fat: 15, carb: 40, steps: [],
    ingredients: foods.map((f) => ({ id: `i-${f.id}`, foodId: f.id, baseGrams: 100, scalable: true, role: null, food: f })),
    ...over,
  };
}

const RICE = food("White Rice", { category: "carb", carb: 28 });
const BEEF = food("Ground Beef", { category: "protein", protein: 26, carb: 0 });
const CHICKEN = food("Chicken Breast", { category: "protein", protein: 31, carb: 0 });
const NO_RULES = { dietaryStyle: null, excludedFoods: [] };

// ═══════════════════════════════════════════════════════════════════════
// 1 · the four evidence sources — the 210-pair leak, one test per shape
// ═══════════════════════════════════════════════════════════════════════

test("evidence 1/4 — ingredient rows are read WITH their persisted metadata, not just their names", () => {
  // The name is innocent; only the USDA category and the declared allergen tag
  // say shellfish. A name-only check (what the library, cart and brain pool all
  // used) cannot see either.
  const paste = food("Thai Red Curry Paste", { fdcCategory: "Finfish and Shellfish Products", allergenTags: ["crustaceans"] });
  const r = recipe("Red Curry", [CHICKEN, paste, RICE]);
  assert.equal(isExcluded(r, { excludedFoods: ["shellfish"] }), true, "metadata probes must be consulted");
  assert.equal(explainRecipeExclusion(r, { excludedFoods: ["shellfish"] }).reason, "excluded-food:shellfish");
});

test("evidence 2/4 — the importer's \"Add'l ingredients:\" step prose is evidence (the Banh Mi case)", () => {
  // Real library row: "Beef Banh Mi Bowls with Sriracha Mayo…" declares its mayo
  // in step 1 and has no mayonnaise ingredient row at all → it reached an
  // egg-allergic user in the library, the cart and the chat.
  const r = recipe("Beef Banh Mi Bowls", [BEEF, RICE], {
    steps: ["Add'l ingredients: mayonnaise, siracha", "Sear the beef."],
  });
  assert.equal(r.ingredients.some((i) => /mayo/i.test(i.food.name)), false, "the fixture must have no mayo ROW, or this is vacuous");
  assert.equal(isExcluded(r, { excludedFoods: ["eggs"] }), true);
  assert.equal(isExcluded(r, NO_RULES), false, "and it is kept when nothing is excluded");
});

test("evidence 3/4 — the recipe TITLE is evidence (the tahini case)", () => {
  // Real library row: "Roasted Eggplant With Tahini, Pine Nuts, and Lentils" —
  // tahini appears in the title only, with no tahini ingredient row.
  const r = recipe("Roasted Eggplant With Tahini, Pine Nuts, and Lentils", [food("Eggplant"), food("Lentils")]);
  assert.equal(isExcluded(r, { excludedFoods: ["sesame"] }), true, "the title names an allergen the rows omit");
  assert.equal(isExcluded(r, { excludedFoods: ["shellfish"] }), false, "and it stays add-only — an unrelated allergy is unaffected");
});

test("evidence 4/4 — the FULL step prose is evidence (the Sushi / Singapore Noodles / Challah cases)", () => {
  const sushi = recipe("Sushi", [RICE, food("Nori")], {
    steps: ["Season the rice.", "Top each piece with half a prawn or a small piece of smoked salmon."],
  });
  assert.equal(isExcluded(sushi, { excludedFoods: ["shellfish"] }), true, "prawn is cooked in via the steps");

  const noodles = recipe("Singapore Noodles with Shrimp", [food("Rice Noodles"), food("Shrimp")], {
    steps: ["Heat 1 tablespoon of the peanut or canola oil."],
  });
  assert.equal(isExcluded(noodles, { excludedFoods: ["peanuts"] }), true);

  const challah = recipe("Challah", [food("Bread Flour"), food("Yeast")], {
    steps: ["Braid the loaves.", "Brush with egg wash and sprinkle with the poppy or sesame seeds."],
  });
  assert.equal(isExcluded(challah, { excludedFoods: ["sesame"] }), true);
});

test("all four sources feed the STYLE check too, not only the allergy check", () => {
  const r = recipe("Dashi Broth", [food("Kombu"), food("Water")], {
    steps: ["Steep the kombu, then add a handful of bonito flakes."],
  });
  assert.equal(isExcluded(r, { dietaryStyle: "vegan" }), true, "bonito (fish) is only in the prose");
  assert.equal(explainRecipeExclusion(r, { dietaryStyle: "vegan" }).reason, "dietary-style");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · one authority — every surface agrees BY CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════

test("planContext, the brain adapter and the gate are literally the same decision", () => {
  const leaky = [
    recipe("Tahini Eggplant", [food("Eggplant")]),
    recipe("Prawn Sushi", [RICE], { steps: ["Top with half a prawn."] }),
    recipe("Mayo Bowl", [BEEF], { steps: ["Add'l ingredients: mayonnaise"] }),
    recipe("Plain Chicken & Rice", [CHICKEN, RICE]),
  ];
  for (const profile of [
    { excludedFoods: ["sesame"] }, { excludedFoods: ["shellfish"] },
    { excludedFoods: ["eggs"] }, { dietaryStyle: "vegan" }, NO_RULES,
  ]) {
    const viaGate = filterRecipes(leaky, profile).map((r) => r.id).sort();
    const viaPlan = filterRecipePool(leaky, profile).map((r) => r.id).sort();
    const viaBrain = leaky.filter((r) => !brain.isExcluded(r, profile)).map((r) => r.id).sort();
    assert.deepEqual(viaPlan, viaGate, `plan pool diverged for ${JSON.stringify(profile)}`);
    assert.deepEqual(viaBrain, viaGate, `brain pool diverged for ${JSON.stringify(profile)}`);
  }
});

test("the brain adapter re-exports the gate's own functions — one function object, two names", () => {
  assert.equal(brain.isExcluded, isExcluded, "brain.isExcluded must BE the gate's, not a copy that can drift");
  assert.equal(brain.explainExclusion, explainExclusion);
  assert.equal(brain.isCheckableName, isCheckableName);
});

test("the gate takes a RECIPE, never a caller-prepared list of names", () => {
  // Mechanism 1. There is no parameter through which a surface can hand in a
  // weaker view — the four sources are collected in the gate, every time. If
  // this signature ever grows an "ingredients"/"names" escape hatch, the whole
  // design is back to five implementations.
  assert.equal(explainRecipeExclusion.length, 2, "explainRecipeExclusion(recipe, profile) — nothing else");
  assert.equal(recipeAllowed.length, 2);
  assert.equal(partitionRecipes.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · mechanism 2 — a degraded recipe FAILS CLOSED
// ═══════════════════════════════════════════════════════════════════════

test("stripping ingredient metadata now OVER-blocks loudly instead of under-blocking silently", () => {
  // This is the exact shape the old brain pool built: keep foodId, drop the
  // Food row. A name-only checker sails through it and never notices that the
  // fdcCategory / allergenTags / mayContain probes came back empty.
  const stripped = recipe("Red Curry", [CHICKEN, RICE]);
  for (const ing of stripped.ingredients) { ing.name = ing.food.name; ing.food = null; }
  const v = explainRecipeExclusion(stripped, NO_RULES);
  assert.equal(v.excluded, true, "a query that dropped the Food rows must not be answerable");
  assert.equal(v.failClosed, true);
  assert.equal(v.reason, "ingredient-metadata-not-loaded");
});

test("a recipe with no ingredients at all is unprovable, therefore excluded", () => {
  const v = explainRecipeExclusion(recipe("Ghost Dish", []), { excludedFoods: ["shellfish"] });
  assert.equal(v.excluded, true);
  assert.equal(v.failClosed, true);
  assert.equal(v.reason, "unresolvable-ingredient");
});

test("a nameless ingredient reports the honest reason, not the narrower metadata one", () => {
  const r = recipe("Mystery Dish", [CHICKEN]);
  r.ingredients.push({ foodId: "x", baseGrams: 50, scalable: true, role: null, food: null });
  const v = explainRecipeExclusion(r, NO_RULES);
  assert.equal(v.reason, "unresolvable-ingredient", "namelessness is checked before metadata-completeness");
  assert.equal(v.failClosed, true);
});

test("fail-closed does not depend on whether the eater has rules — that is what keeps surfaces in step", () => {
  const ghost = recipe("Ghost Dish", []);
  for (const profile of [NO_RULES, {}, { dietaryStyle: "none", excludedFoods: [] }, { excludedFoods: ["dairy"] }]) {
    assert.equal(isExcluded(ghost, profile), true, `unreadable must stay unreadable for ${JSON.stringify(profile)}`);
    assert.equal(filterRecipePool([ghost], profile).length, 0, "…including through the plan pool");
  }
});

test("a draft shape with names but no foodId is legitimately checkable (AI/imported drafts)", () => {
  // The metadata refusal keys on foodId, not on the absence of `.food`: a draft
  // that has not been resolved to Food rows yet genuinely has no metadata to
  // load, and refusing it would make the gate unusable on the draft paths.
  const draft = {
    name: "Draft Bowl", steps: ["Cook it."],
    ingredients: [{ name: "Chicken Breast", grams: 200 }, { name: "White Rice", grams: 150 }],
  };
  assert.equal(isExcluded(draft, NO_RULES), false);
  assert.equal(isExcluded(draft, { dietaryStyle: "vegan" }), true, "…and is still checked, by name");
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · reporting — silent shrinkage stays banned
// ═══════════════════════════════════════════════════════════════════════

test("partitionRecipes hands back WHY, so a surface can report without re-running the check", () => {
  const pool = [
    recipe("Plain Chicken & Rice", [CHICKEN, RICE]),
    recipe("Tahini Eggplant", [food("Eggplant")]),
    recipe("Ghost Dish", []),
  ];
  const { allowed, blocked } = partitionRecipes(pool, { excludedFoods: ["sesame"] });
  assert.equal(allowed.length, 1);
  assert.equal(blocked.length, 2);
  assert.deepEqual(blocked.map((b) => b.reason).sort(), ["excluded-food:sesame", "unresolvable-ingredient"]);
  // A data bug (fail-closed) must be distinguishable from a diet decision, or a
  // broken import masquerades as an allergy in the UI's hidden count.
  assert.equal(blocked.filter((b) => b.failClosed).length, 1);
});

test("flat foods keep their own verdicts and reasons", () => {
  assert.equal(explainExclusion(food("Kiwi"), { excludedFoods: ["kiwi"] }).reason, "food-filtered");
  assert.equal(explainExclusion(food("White Rice"), { excludedFoods: ["kiwi"] }).excluded, false);
  assert.equal(explainExclusion({ id: "f", name: "" }, {}).reason, "unresolvable-food");
  assert.equal(explainExclusion({ id: "f", name: 42 }, {}).failClosed, true);
  assert.equal(isCheckableName("  "), false);
  assert.equal(isCheckableName("Chicken"), true);
});

test("collectEvidence carries whole Food rows, not { name } copies", () => {
  const tagged = food("Cheeseburger Patty", { allergenTags: ["milk"] });
  const { rows, gap } = collectEvidence(recipe("Burger", [tagged], { steps: ["Grill it."] }));
  assert.equal(gap, null);
  assert.equal(rows[0], tagged, "the ingredient row must be the Food OBJECT — a { name } copy is the original bug");
  // …plus the title and the step prose as synthesised name-only rows.
  assert.ok(rows.some((r) => r.name === "Burger"), "title is evidence");
  assert.ok(rows.some((r) => /Grill it/.test(r.name)), "step prose is evidence");
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · mechanism 3 — the weak path is unreachable for NEW code
// ═══════════════════════════════════════════════════════════════════════

// The recipe-level primitives. Each one, used directly on a recipe, produces a
// check weaker than the gate's — that is the whole 210-pair story. Food-level
// helpers (foodMatchesExclusionTerm, applyDietaryFilters, excludedByList) are
// deliberately NOT listed: they are correct at the level they operate on.
const WEAK_RECIPE_PRIMITIVES = ["recipeExcludedByStyle", "recipeExceedsKetoCeiling", "additionalIngredientNames", "matchesExclusionTerm"];

// FROZEN known offenders. Every entry is a PRE-PERSIST draft screen that runs
// before Food rows exist, so it genuinely cannot use the gate's metadata
// probes — except the last one, which is a real outstanding gap.
const ALLOWED_DIRECT_USERS = new Set([
  // the vocabulary itself
  "src/lib/dietaryFilter.js",
  // the gate — the one place that composes the primitives into full strength
  "src/lib/exclusionGate.js",
  // screens the NAMES an LLM wrote, before any resolution or persistence
  "src/lib/aiRecipeClient.js",
  // re-screens the RESOLVED draft before persistRecipe; resolution can land an
  // ingredient on a differently-named Food row, so this second pass is
  // load-bearing even though it is name-level
  "src/lib/recipeGeneration.js",
  // RESOLVED, but still listed — and the reason changed, so read this before
  // deleting the entry. aiRecipeCompliant() now delegates to the gate, so the
  // AI-swap fallback is no longer a weak surface.
  //
  // weeklyPlanner still references recipeExceedsKetoCeiling, legitimately, in
  // enforceScaledCarbCeiling(): that runs AFTER portioning, on {carb, kcal}
  // scalars, to check whether a *scaled serving* breaches the keto ceiling.
  // It is arithmetic on a portion, not an exclusion verdict on a recipe, so it
  // has no ingredient evidence to consult and nothing to route through the gate.
  // The scan matches on identifier name and cannot tell those two uses apart.
  //
  // So: this entry stays, but if a future change makes weeklyPlanner call
  // recipeExcludedByStyle / matchesExclusionTerm / additionalIngredientNames,
  // that IS a regression and the scan will no longer catch it. If you touch the
  // exclusion path in that file, re-check by hand.
  "src/lib/weeklyPlanner.js",
]);

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("no NEW surface may reach around the gate for the recipe-level primitives", () => {
  const offenders = [];
  for (const file of walkJs(SRC)) {
    const rel = path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/");
    if (ALLOWED_DIRECT_USERS.has(rel)) continue;
    const src = fs.readFileSync(file, "utf8");
    // Only count real usage, not the word appearing inside a comment line.
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const hits = WEAK_RECIPE_PRIMITIVES.filter((p) => new RegExp(`\\b${p}\\b`).test(code));
    if (hits.length) offenders.push(`${rel} -> ${hits.join(", ")}`);
  }
  assert.deepEqual(offenders, [],
    "these files check recipes with a weaker vocabulary than the gate.\n" +
    "Route them through src/lib/exclusionGate.js (explainRecipeExclusion / partitionRecipes / filterRecipes).\n" +
    "If a file genuinely operates on an unresolved DRAFT, add it to ALLOWED_DIRECT_USERS with the reason:\n  " +
    offenders.join("\n  "));
});

test("the known-offenders list may not grow, and every entry must still exist", () => {
  // A frozen list only works if adding to it is a deliberate, reviewed act.
  assert.equal(ALLOWED_DIRECT_USERS.size, 5, "ALLOWED_DIRECT_USERS grew — a new file is checking recipes weakly");
  for (const rel of ALLOWED_DIRECT_USERS) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", rel)), `${rel} is listed but no longer exists — prune it`);
  }
});

test("every gated recipe surface imports the gate", () => {
  // The positive half of the scan: these four files decide what a user sees.
  for (const rel of [
    "src/lib/planContext.js",
    "src/routes/recipes.js",
    "src/routes/cart.js",
    "src/lib/brain/exclusions.js",
  ]) {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    assert.match(src, /require\(["'][^"']*exclusionGate\.js["']\)/, `${rel} must route through the gate`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · the load contract
// ═══════════════════════════════════════════════════════════════════════

test("RECIPE_GATE_SELECT carries every column the gate probes", () => {
  // steps and name are EVIDENCE, not display copy — a select that drops either
  // silently re-opens the title/prose half of the 210-pair leak, and unlike a
  // stripped Food row there is no shape signal to fail closed on.
  assert.equal(RECIPE_GATE_SELECT.name, true, "the title is evidence");
  assert.equal(RECIPE_GATE_SELECT.steps, true, "the step prose is evidence");
  assert.equal(RECIPE_GATE_SELECT.carb, true, "the keto ceiling reads cached macros");
  assert.equal(RECIPE_GATE_SELECT.kcal, true);
  const foodSel = RECIPE_GATE_SELECT.ingredients.select.food.select;
  assert.equal(foodSel, FOOD_GATE_SELECT);
  for (const probe of ["name", "fdcCategory", "allergenTags", "mayContain"]) {
    assert.equal(foodSel[probe], true, `the ${probe} probe must survive the select`);
  }
  // and the solver's own needs, so a gated load can also feed a solve
  for (const macro of ["kcal", "protein", "fat", "carb", "fiber"]) {
    assert.equal(foodSel[macro], true, `${macro} is needed to scale a portion`);
  }
  assert.equal(foodSel.micros, undefined, "micros is ~1.8 MB of pool payload nothing on this path reads");
});
