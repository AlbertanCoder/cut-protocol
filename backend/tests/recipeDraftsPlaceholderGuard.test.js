const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  generateAndSaveSlotRecipe, placeholderAudit, placeholderRefusalReason,
  resolvedDraftViolation, MAX_PLACEHOLDER_SHARE, RECIPE_SOURCES,
} = require("../src/lib/recipeGeneration.js");

// ─────────────────────────────────────────────────────────────────────────────
// Agent 03's food-data-1 fix deleted the fuzzy ingredient matcher: an
// unresolvable ingredient now comes back as a ZERO-MACRO placeholder instead of
// a confidently-wrong real row. That is the honest failure mode — but the
// weekly solver's AI fallback (generateAndSaveSlotRecipe) has NO human in it,
// and would happily persist a recipe assembled from those rows. sumMacros()
// would then UNDER-count it, and the solver could prefer that recipe precisely
// BECAUSE its macros look conveniently small. These tests lock the refusal.
//
// Every dependency is injected (drafts, resolver, persist) — no network, no
// model call, and no Recipe/Food row is ever written.
// ─────────────────────────────────────────────────────────────────────────────

const TARGET = { slotType: "meal", kcalTarget: 600, proteinTarget: 50 };
const PROFILE = { cuisinePreferences: [], mealPreferencesNote: null };

function draft(name, ingredients) {
  return { name, description: "d", cuisine: "test", slotType: "meal", prepTimeMin: 15, servings: 1, steps: ["Cook."], ingredients };
}
const ing = (name, grams, role) => ({ name, grams, role, scalable: true });

// A resolver whose verdict per ingredient name is scripted. `real` rows carry
// macros; `placeholder` rows are the honest zero-macro kind Agent 03's ladder
// now returns for anything it cannot match safely.
function resolverFor(map) {
  return async (name) => {
    const kind = map[name] || "real";
    if (kind === "placeholder") {
      return {
        food: { id: `ph:${name}`, name, kcal: 0, protein: 0, fat: 0, carb: 0, source: "manual-placeholder" },
        matched: "placeholder", status: "needs_review", needsReview: true, confidence: null,
        candidates: [{ name: `${name} (canned)`, id: "cand1" }], reason: `no safe match for "${name}"`, extras: [],
      };
    }
    return {
      food: { id: `real:${name}`, name, kcal: 165, protein: 31, fat: 3.6, carb: 0, source: "usda" },
      matched: "existing", status: "resolved", needsReview: false, confidence: "exact",
      candidates: [], reason: "exact name match", extras: [],
    };
  };
}

// resolveDraftIngredients re-reads the resolved rows through prisma.food.findMany
// to compute macros from the DATABASE, never from the resolver's say-so. These
// tests inject fake foods, so patch that one read for the duration.
const { prisma } = require("../src/lib/prisma.js");
const realFindMany = prisma.food.findMany.bind(prisma.food);
const FAKE_ROWS = new Map();
prisma.food.findMany = async (args) => {
  const ids = args?.where?.id?.in;
  if (!ids || !ids.every((id) => FAKE_ROWS.has(id))) return realFindMany(args);
  return ids.map((id) => FAKE_ROWS.get(id));
};
function registerFakes(names, kinds) {
  FAKE_ROWS.clear();
  for (const n of names) {
    const placeholder = kinds[n] === "placeholder";
    FAKE_ROWS.set(`${placeholder ? "ph" : "real"}:${n}`, {
      id: `${placeholder ? "ph" : "real"}:${n}`, name: n,
      kcal: placeholder ? 0 : 165, protein: placeholder ? 0 : 31, fat: placeholder ? 0 : 3.6, carb: 0,
    });
  }
}
test.after(async () => {
  prisma.food.findMany = realFindMany;
  await prisma.$disconnect();
});

async function runUnattended({ drafts, kinds }) {
  const names = drafts.flatMap((d) => d.ingredients.map((i) => i.name));
  registerFakes(names, kinds);
  let persisted = null;
  const result = await generateAndSaveSlotRecipe(TARGET, PROFILE, [], {
    generateDraftsImpl: async () => ({ drafts }),
    resolveIngredientImpl: resolverFor(kinds),
    persistRecipeImpl: async (d, opts) => { persisted = { draft: d, opts }; return { id: "saved", name: d.name }; },
  });
  return { result, persisted };
}

// ── the refusal ─────────────────────────────────────────────────────────────

test("unattended path REFUSES a draft whose main ingredient resolved to a zero-macro placeholder", async () => {
  const d = draft("Mystery Bowl", [
    ing("Frobnicated tempeh", 180, "protein"), // unresolvable -> placeholder, and it is the SCALED ingredient
    ing("White rice", 150, "carb"),
    ing("Broccoli", 100, "veg"),
  ]);
  await assert.rejects(
    () => runUnattended({ drafts: [d], kinds: { "Frobnicated tempeh": "placeholder" } }),
    (e) => {
      assert.match(e.message, /No AI draft was safe to save/);
      assert.match(e.message, /Frobnicated tempeh/, "the reason must NAME the ingredient — the solver prints this verbatim");
      assert.match(e.message, /Food database/, "the reason must say what the user can do about it");
      return true;
    }
  );
});

test("unattended path REFUSES a draft that is mostly placeholders even when the protein resolved", async () => {
  const d = draft("Half-known Bowl", [
    ing("Chicken breast", 180, "protein"),
    ing("Frobnicated grain", 150, "other"),
    ing("Zizzle root", 100, "veg"),
    ing("Mystery sauce", 30, "other"),
  ]);
  // 3 of 4 = 75% placeholders, none of them load-bearing roles.
  await assert.rejects(
    () => runUnattended({ drafts: [d], kinds: { "Frobnicated grain": "placeholder", "Zizzle root": "placeholder", "Mystery sauce": "placeholder" } }),
    (e) => {
      assert.match(e.message, /3 of its 4 ingredients/);
      assert.match(e.message, /no macro data/);
      return true;
    }
  );
});

test("unattended path SAVES a clean draft (the guard is not a blanket refusal)", async () => {
  const d = draft("Chicken & Rice", [ing("Chicken breast", 180, "protein"), ing("White rice", 150, "carb")]);
  const { persisted } = await runUnattended({ drafts: [d], kinds: {} });
  assert.ok(persisted, "a fully-resolved draft must still save");
  assert.equal(persisted.draft.name, "Chicken & Rice");
  assert.equal(persisted.opts.source, "ai-generated", "the saved row must carry the AI provenance marker");
  assert.ok(persisted.draft.kcal > 0, "and real macros, computed from the resolved rows");
});

test("unattended path tolerates ONE thin garnish among several resolved ingredients", async () => {
  // 1 of 4 = 25%, under the one-third line, and it is not a scaled role. This
  // is the case a hard 'zero placeholders' rule would have wrongly refused.
  const d = draft("Garnished Bowl", [
    ing("Chicken breast", 180, "protein"),
    ing("White rice", 150, "carb"),
    ing("Broccoli", 100, "veg"),
    ing("Zizzle flakes", 2, "other"),
  ]);
  const { persisted } = await runUnattended({ drafts: [d], kinds: { "Zizzle flakes": "placeholder" } });
  assert.ok(persisted, "a single trace garnish must not disqualify an otherwise-resolved recipe");
});

test("unattended path picks the CLEAN draft when a placeholder-heavy one is offered alongside it", async () => {
  const bad = draft("Mystery Bowl", [ing("Frobnicated tempeh", 180, "protein"), ing("Zizzle root", 150, "carb")]);
  const good = draft("Chicken & Rice", [ing("Chicken breast", 180, "protein"), ing("White rice", 150, "carb")]);
  const { persisted } = await runUnattended({
    drafts: [bad, good],
    kinds: { "Frobnicated tempeh": "placeholder", "Zizzle root": "placeholder" },
  });
  assert.equal(persisted.draft.name, "Chicken & Rice");
});

// ── the audit helpers, unit level ───────────────────────────────────────────

test("placeholderAudit counts share and flags load-bearing gaps", () => {
  const a = placeholderAudit({
    name: "x",
    ingredients: [
      { name: "a", role: "protein", placeholderMacros: true, requestedName: "a" },
      { name: "b", role: "carb", placeholderMacros: false },
      { name: "c", role: "veg", placeholderMacros: false },
      { name: "d", role: "other", placeholderMacros: false },
    ],
  });
  assert.equal(a.total, 4);
  assert.equal(a.placeholders, 1);
  assert.equal(a.share, 0.25);
  assert.equal(a.tooMany, false, "25% is under the threshold");
  assert.equal(a.loadBearingMissing, true, "but the protein has no macros — that is disqualifying on its own");
  assert.deepEqual(a.loadBearingNames, ["a"]);
  assert.ok(MAX_PLACEHOLDER_SHARE > 0 && MAX_PLACEHOLDER_SHARE < 1, "the threshold must be a real share, not 0 or 1");
});

test("placeholderRefusalReason returns null for a clean draft (no false alarm)", () => {
  const reason = placeholderRefusalReason({
    name: "Clean",
    ingredients: [
      { name: "a", role: "protein", placeholderMacros: false },
      { name: "b", role: "carb", placeholderMacros: false },
    ],
  });
  assert.equal(reason, null);
});

// ── resolver fields forwarded (Agent 03 request #1) ─────────────────────────

test("resolved ingredients carry the resolver's status/needsReview/candidates/reason for the UI", async () => {
  const d = draft("Mystery Bowl", [ing("Chicken breast", 180, "protein"), ing("Zizzle root", 100, "veg")]);
  registerFakes(["Chicken breast", "Zizzle root"], { "Zizzle root": "placeholder" });
  const { resolveDraftIngredients } = require("../src/lib/recipeGeneration.js");
  const resolved = await resolveDraftIngredients(d, resolverFor({ "Zizzle root": "placeholder" }));

  const [chicken, zizzle] = resolved.ingredients;
  assert.equal(chicken.status, "resolved");
  assert.equal(chicken.needsReview, false);
  assert.equal(chicken.confidence, "exact");

  assert.equal(zizzle.status, "needs_review");
  assert.equal(zizzle.needsReview, true);
  assert.equal(zizzle.placeholderMacros, true, "the pre-existing flag still works — nothing downstream breaks");
  assert.equal(zizzle.requestedName, "Zizzle root", "the name the draft asked for is kept beside the row it landed on");
  assert.deepEqual(zizzle.candidates, [{ name: "Zizzle root (canned)", id: "cand1" }], "the shortlist is forwarded so a UI can offer 'did you mean…'");
  assert.match(zizzle.reason, /no safe match/);
});

// ── post-resolution allergen re-check ───────────────────────────────────────

test("post-resolution re-check catches an allergen that only appears in the RESOLVED name", () => {
  // The model wrote "chickpea pasta"; resolution landed on a wheat row. The
  // pre-call filter screened the model's word, so only a post-resolution check
  // can see this. Without it, ingredient resolution is an allergen-erasure path.
  const violation = resolvedDraftViolation(
    { name: "Pasta Bowl", steps: [], kcal: 500, carb: 60, ingredients: [{ name: "Wheat pasta, dry" }, { name: "Tomato" }] },
    { excludedFoods: ["gluten"], dietaryStyle: null }
  );
  assert.equal(violation, "gluten");
});

test("post-resolution re-check passes a compliant recipe", () => {
  assert.equal(
    resolvedDraftViolation(
      { name: "Rice Bowl", steps: [], kcal: 500, carb: 60, ingredients: [{ name: "White rice" }, { name: "Chicken breast" }] },
      { excludedFoods: ["gluten"], dietaryStyle: null }
    ),
    null
  );
});

test("unattended path drops a draft whose RESOLVED ingredients violate the profile", async () => {
  const d = draft("Satay Bowl", [ing("Peanut butter", 40, "fat"), ing("Chicken breast", 180, "protein")]);
  registerFakes(["Peanut butter", "Chicken breast"], {});
  await assert.rejects(
    () => generateAndSaveSlotRecipe(
      TARGET,
      { ...PROFILE, excludedFoods: ["peanuts"] },
      [],
      {
        generateDraftsImpl: async () => ({ drafts: [d] }),
        resolveIngredientImpl: resolverFor({}),
        persistRecipeImpl: async () => { assert.fail("a profile-violating recipe must never be persisted"); },
      }
    ),
    (e) => { assert.match(e.message, /peanuts after ingredient resolution/); return true; }
  );
});

test("the unattended path now forwards the user's exclusions to the generator (it used to send none)", async () => {
  let captured = null;
  const d = draft("Chicken & Rice", [ing("Chicken breast", 180, "protein")]);
  registerFakes(["Chicken breast"], {});
  await generateAndSaveSlotRecipe(
    TARGET,
    { ...PROFILE, excludedFoods: ["shellfish"], dietaryStyle: "halal" },
    [],
    {
      generateDraftsImpl: async (p) => { captured = p; return { drafts: [d] }; },
      resolveIngredientImpl: resolverFor({}),
      persistRecipeImpl: async (x) => ({ id: "s", name: x.name }),
    }
  );
  assert.deepEqual(captured.excludedFoods, ["shellfish"], "without this the unattended generator screened against an EMPTY exclusion list");
  assert.equal(captured.dietaryStyle, "halal");
  assert.equal(captured.allowAllergens, false);
});

// ── provenance ──────────────────────────────────────────────────────────────

test("persistRecipe's source is whitelisted — an AI recipe can never be labelled 'curated' by a caller typo", () => {
  assert.ok(RECIPE_SOURCES.has("ai-generated"));
  assert.ok(RECIPE_SOURCES.has("imported"));
  assert.ok(RECIPE_SOURCES.has("curated"));
  assert.equal(RECIPE_SOURCES.has("verified"), false);
  assert.equal(RECIPE_SOURCES.has(""), false);
});
