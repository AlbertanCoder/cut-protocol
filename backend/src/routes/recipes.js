const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { computeMacros } = require("../lib/bmrEngine.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { estimateSlotTarget } = require("../lib/weeklyPlanner.js");
const { generateRecipeDrafts } = require("../lib/aiRecipeClient.js");
const { llmAvailability } = require("../lib/brain/governance.js");
const { sumMacros, resolveDraftIngredients, persistRecipe, resolvedDraftViolation, RECIPE_INCLUDE } = require("../lib/recipeGeneration.js");

const router = express.Router();
router.use(requireAuth);

// One authority for "may this user see this recipe?" — see exclusionGate.js.
// This route used to carry its own copy of the check reading ingredient NAMES
// only, and against the real library that copy showed 210 recipe/allergy pairs
// the solver hides — a sesame-allergic user browsing "Roasted Eggplant With
// Tahini, Pine Nuts, and Lentils" (tahini in the title, no tahini row), an
// egg-allergic user browsing a Banh Mi whose mayo lives in the step prose.
const { partitionRecipes, explainRecipeExclusion } = require("../lib/exclusionGate.js");
const { invalidateRecipeLibrary } = require("../lib/planContext.js");

// Phase 3: the library never surfaces a recipe containing an excluded
// ingredient — the same hard filter the solver pool uses. `hiddenCount`
// keeps the filtering visible (silent shrinkage is banned); ?all=1 is the
// explicit escape hatch (used nowhere by default).
router.get("/", async (req, res) => {
  const recipes = await prisma.recipe.findMany({ include: RECIPE_INCLUDE, orderBy: { name: "asc" } });
  if (req.query.all === "1") return res.json({ recipes, hiddenCount: 0 });

  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  // No short-circuit on "this profile has no rules": the gate's fail-closed
  // screen (a recipe whose ingredients cannot be read at all) is a property of
  // the RECIPE, not of the eater, and letting it depend on the caller is how
  // surfaces drifted apart in the first place. It hides nothing on the real
  // library — 0 of 889 recipes have an empty ingredient list, a null food or a
  // blank food name.
  const { allowed, blocked } = partitionRecipes(recipes, profile);
  // hiddenBecauseUnreadable is reported separately because it is a DATA bug on
  // our side, not a diet decision about the user — conflating the two would
  // let a broken import masquerade as an allergy.
  const unreadable = blocked.filter((b) => b.failClosed);
  res.json({
    recipes: allowed,
    hiddenCount: blocked.length,
    hiddenBecauseUnreadable: unreadable.length,
  });
});

// GET /api/recipes/ai-status — lets a client ask whether AI drafting is armed
// in THIS build before offering the button, the same way /api/brain/status
// gates the chat bar. With the feature off the honest answer is "off", not a
// broken button that 503s on click.
router.get("/ai-status", (req, res) => {
  const availability = llmAvailability("recipeDrafts");
  res.json({ enabled: availability.enabled, reason: availability.reason || null });
});

// ── allergen-override audit trail ─────────────────────────────────────────
// "ALLOW MY ALLERGENS" is a real, legitimate escape hatch (the user knows
// their own tolerance better than a keyword table does) but it was leaving NO
// trace anywhere: aiRecipeClient labelled each overridden draft with exactly
// what it violates, this route returned that label, and then it evaporated —
// nothing on the server, and a frontend that never rendered it, so a violating
// draft arrived visually identical to a safe one. If someone later has a
// reaction, "which drafts did we knowingly hand over, and what did we say they
// contained?" has to be answerable. One line per overridden draft, tagged for
// grep, machine-parseable, and carrying the rules that were overridden rather
// than just the fact that they were.
//
// This is a LOG, not a table: adding a Prisma model would need a migration,
// and the value here is forensic (an operator reading server output), not
// queryable-in-app. If an in-app audit view is ever wanted, this is the shape
// to persist.
function auditAllergenOverride({ userId, recipeName, violation, stage, dietaryStyle, excludedFoods }) {
  console.warn(`[allergen-override] ${JSON.stringify({
    at: new Date().toISOString(),
    userId: userId || null,
    recipe: recipeName || "(unnamed)",
    violates: violation,
    stage, // "model-output" | "post-resolution"
    profileRules: { dietaryStyle: dietaryStyle || null, excludedFoods: excludedFoods || [] },
    note: "user ticked ALLOW MY ALLERGENS; draft was NOT dropped",
  })}`);
}

// POST /api/recipes/generate-drafts — the ONE LLM-calling route outside
// /api/brain. Governed by src/lib/brain/governance.js (fleet finding
// brain-stack-1): the gate, the keyless 503, the injection guard, the pre-call
// cost cap, the ledger row, the timeout and the output guard all live in
// generateRecipeDrafts()'s governed wrapper — this handler adds no LLM policy
// of its own, it only renders the outcome. NOTHING is written before the model
// call returns: a refusal at any control leaves zero rows behind.
// saas-launch Stage 2: premium — every generation burns server-side Anthropic
// tokens, so it cannot sit on the free tier of the hosted product.
router.post("/generate-drafts", require("../lib/entitlement.js").requirePremium, async (req, res) => {
  const { slotType, protein, cuisine, prepTimeMin, freeText, batchStyle, allowAllergens } = req.body || {};
  if (!["meal", "snack"].includes(slotType)) return res.status(400).json({ error: "slotType must be 'meal' or 'snack'" });

  try {
    const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: "no profile set up yet" });
    const weightNowKg = await getWeightNowKg(req.userId, profile);
    const dailyTarget = computeMacros(profile, weightNowKg, profile.targetKcal);
    const mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay };
    const target = estimateSlotTarget(dailyTarget, mealConfig, slotType);
    const existingRecipeNames = (await prisma.recipe.findMany({ select: { name: true } })).map((r) => r.name);

    const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
    const dietaryStyle = profile.dietaryStyle || null;

    const { drafts, droppedForAllergies, droppedForShape, allergenOverrides } = await generateRecipeDrafts({
      slotType, protein, cuisine, prepTimeMin, freeText, batchStyle,
      allowAllergens: !!allowAllergens,
      targetKcal: target.kcalTarget, targetProtein: target.proteinTarget,
      existingRecipeNames,
      // Stage-C fix (C2): the generator enforces THIS user's profile.
      excludedFoods,
      dietaryStyle,
      userId: req.userId, // ledger attribution
    });

    // The allergen filter above screened the names the MODEL wrote. Resolution
    // can land an ingredient on a differently-named Food row ("chickpea pasta"
    // -> a wheat pasta row), so the same filter runs again on the RESOLVED
    // names — otherwise resolution is an allergen-erasure path. The override
    // still applies (it is the user's explicit, per-generation choice), but a
    // violation is always reported, never silent.
    const resolved = [];
    for (const draft of drafts) {
      const r = await resolveDraftIngredients(draft);
      const violation = resolvedDraftViolation(r, { excludedFoods, dietaryStyle });
      if (violation) {
        if (!allowAllergens) { droppedForAllergies.push({ name: r.name, reason: `${violation} (found after ingredient resolution)` }); continue; }
        allergenOverrides.push({ name: r.name, reason: `${violation} (found after ingredient resolution)` });
      }
      resolved.push(r);
    }

    // AUDIT every override, from BOTH screens (aiRecipeClient filled
    // allergenOverrides for the model's own names; the loop above added the
    // post-resolution ones). Logged before the response so a crash mid-send
    // still leaves the trace.
    for (const o of allergenOverrides) {
      auditAllergenOverride({
        userId: req.userId, recipeName: o.name, violation: o.reason,
        stage: /after ingredient resolution/.test(o.reason || "") ? "post-resolution" : "model-output",
        dietaryStyle, excludedFoods,
      });
    }

    // Make the override UNMISSABLE in the payload instead of leaving it as an
    // easily-ignored sidecar array. `overriddenByName` lets a renderer answer
    // "is THIS card unsafe?" with a lookup instead of a scan, and each draft
    // now carries its own verdict, so a client cannot render a violating draft
    // identically to a safe one without actively discarding the field. The
    // sidecar array stays for existing consumers.
    const overriddenByName = {};
    for (const o of allergenOverrides) overriddenByName[o.name] = o.reason;
    const draftsOut = resolved.map((d) => (
      overriddenByName[d.name]
        ? { ...d, allergenViolation: overriddenByName[d.name], allergenOverridden: true }
        : { ...d, allergenViolation: null, allergenOverridden: false }
    ));

    res.json({
      drafts: draftsOut,
      droppedForAllergies,
      droppedForShape,
      allergenOverrides,
      // Top-level flags so a client cannot miss the state by only reading
      // `drafts`. allergenOverrideActive is true whenever the user ASKED for
      // the override, even if nothing ended up violating — that is the state
      // the warning banner should reflect.
      allergenOverrideActive: !!allowAllergens,
      allergenOverrideCount: allergenOverrides.length,
      overriddenByName,
    });
  } catch (e) {
    // A governance refusal is a DECIDED outcome with an honest status
    // (503 off/keyless · 400 input refused · 429 cost cap · 504 timeout),
    // never a stack trace and never a 500.
    if (e && e.isGovernance) return res.status(e.status || 503).json({ error: e.message, code: e.code });
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 5: every save goes through the Phase 2 data validator — a recipe
// built on a zero-macro placeholder or an invalid food row is rejected with
// directions, never silently persisted. Cuisine is auto-classified when the
// draft doesn't carry one; source is whitelisted (ai-generated | imported).
const { validateFood } = require("../lib/foodValidation.js");
const { loadFoodOverrides } = require("../lib/foodOverrides.js");
const { classifyCuisine, CUISINES } = require("../lib/recipeCuisine.js");
const { importRecipeFromUrl } = require("../lib/recipeImporter.js");

function validateDraftFoods(ingredients, foodById) {
  const problems = [];
  const exemptions = loadFoodOverrides();
  for (const ing of ingredients) {
    const food = foodById.get(ing.foodId);
    const { ok, issues } = validateFood(food, { exemptions });
    if (!ok) {
      const placeholder = issues.some((i) => i.code === "placeholder");
      problems.push({
        foodId: food.id, name: food.name,
        reason: placeholder
          ? "zero-macro placeholder — open it in the Food database and enter real values first"
          : issues.map((i) => i.detail).join("; "),
      });
    }
    if (!(Number(ing.grams) > 0)) {
      problems.push({ foodId: food.id, name: food.name, reason: "amount must be above 0 g" });
    }
  }
  return problems;
}

// Shape a draft (AI or imported) as the gate expects a recipe, so a
// never-persisted draft is judged by exactly the same evidence a saved recipe
// is: whole Food rows for the metadata probes, plus the title and the step
// prose. Building this here rather than checking names is the difference
// between catching a Banh Mi whose mayo only exists in step 1 and not.
function draftAsRecipe({ name, steps, ingredients }, foodById) {
  return {
    name,
    steps,
    // The gate's keto ceiling reads cached recipe totals; a draft has none yet,
    // so it is left undefined and the ceiling correctly declines to judge. The
    // per-ingredient style rules still apply.
    ingredients: (ingredients || []).map((i) => ({
      foodId: i.foodId,
      baseGrams: i.grams,
      food: foodById ? foodById.get(i.foodId) : i.food,
      name: i.name,
    })),
  };
}

router.post("/save-draft", async (req, res) => {
  const { name, description, cuisine, slotType, prepTimeMin, ingredients, steps, source, allowAllergens } = req.body || {};
  if (!name || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: "name and at least one ingredient are required" });
  }

  const foods = await prisma.food.findMany({ where: { id: { in: ingredients.map((i) => i.foodId) } } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  if (foods.length !== new Set(ingredients.map((i) => i.foodId)).size) {
    return res.status(400).json({ error: "one or more ingredient foodIds don't exist" });
  }

  const problems = validateDraftFoods(ingredients, foodById);
  if (problems.length) {
    return res.status(422).json({ error: "recipe fails the data validator", invalidIngredients: problems });
  }

  // ALLERGEN GATE. This route ran validateDraftFoods() and NOTHING else — it
  // was the one write path into the shared recipe library with no allergen
  // check at all. Both of its callers (the AI draft editor and the URL
  // importer) let the user EDIT ingredients before saving, so whatever
  // generate-drafts or the importer screened is not what necessarily arrives
  // here; and a saved recipe is permanent, shared, and immediately eligible
  // for every other user's plan pool. Checked against the saver's own profile,
  // with the same explicit per-request override the generator offers — the
  // override stops the REFUSAL, never the check, and is always audited.
  const saverProfile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  const verdict = explainRecipeExclusion(draftAsRecipe({ name, steps, ingredients }, foodById), saverProfile);
  if (verdict.excluded) {
    if (!allowAllergens) {
      return res.status(422).json({
        error: "this recipe violates your own diet & allergy settings",
        reason: verdict.reason,
        failClosed: verdict.failClosed,
        hint: verdict.failClosed
          ? "one or more ingredients can't be read — fix the ingredient rows and try again"
          : "edit the ingredients, or re-send with allowAllergens:true if you know this is safe for you",
      });
    }
    auditAllergenOverride({
      userId: req.userId, recipeName: name, violation: verdict.reason, stage: "save-draft",
      dietaryStyle: saverProfile?.dietaryStyle, excludedFoods: saverProfile?.excludedFoods,
    });
  }

  const macros = sumMacros(ingredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams })));
  const finalCuisine = cuisine && CUISINES.some((c) => c.key === cuisine)
    ? cuisine
    : classifyCuisine(name).cuisine;

  try {
    const recipe = await persistRecipe(
      { name, description, cuisine: finalCuisine, slotType, prepTimeMin, steps, ingredients, ...macros },
      { source: source === "imported" ? "imported" : "ai-generated" }
    );
    // plan-perf-1: a new recipe changes the shared library the plan pool is
    // cached from.
    invalidateRecipeLibrary();
    res.status(201).json({ ...recipe, allergenViolation: verdict.excluded ? verdict.reason : null });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a recipe named "${name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

// Phase 5 importer: URL → reviewable draft (same shape as AI drafts — the
// frontend reuses the draft editor).
//
// ── correction: this route DOES write. ────────────────────────────────────
// The comment here used to read "Nothing is saved here" and that was false.
// importRecipeFromUrl() calls resolveIngredient() once per ingredient line,
// and resolveIngredient() creates a Food row for every line it cannot match
// locally — a USDA-backed row when the lookup succeeds, a zero-macro
// `manual-placeholder` row when it doesn't (ingredientResolver.js:533 and
// :559). So PREVIEWING an import — a page the user may glance at and close —
// permanently adds rows to the shared Food library. Paste five URLs, save
// none, and the food table still grew; on a bad page ("2 15 oz. cans" style
// lines) the growth is placeholder junk that then shows up in the Foods
// browser and in ingredient pickers.
//
// It should NOT write. A preview is a read. The correct fix is a dry-run seam
// in the resolver — importRecipeFromUrl(url, { resolveIngredientImpl }) with a
// non-persisting implementation that returns the same
// { food, matched } shape from an in-memory candidate instead of a created
// row — and it belongs in recipeImporter.js / ingredientResolver.js, which
// this route does not own. Two reasons not to bodge it from here: deleting the
// rows afterwards races every other request that may already have referenced
// them, and doing the write-then-delete inside a transaction is impossible
// because the resolver writes through the shared client, not a tx handle.
// Until that seam exists, the honest thing is to say what happens rather than
// claim it doesn't. TODO(recipe-import-dryrun).
router.post("/import", async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== "string" || !url.trim()) return res.status(400).json({ error: "url required" });
  try {
    const draft = await importRecipeFromUrl(url.trim());
    // …and because the line above may have created Food rows, the cached plan
    // pool is no longer provably current.
    invalidateRecipeLibrary();

    // The returned draft used to be UNFILTERED — an imported page could put a
    // sesame or shellfish recipe straight into the review editor of a user who
    // excludes it, with nothing marking it. Run the same gate the library and
    // the solver use and LABEL the draft; the import is not refused (the user
    // asked for this specific URL and may be cooking for someone else), but it
    // can no longer arrive looking safe.
    // The draft carries foodIds but not the Food ROWS, and the gate refuses to
    // judge a recipe whose metadata was not loaded (that refusal is the point —
    // it is what makes a stripped query impossible to under-check with). So
    // load them.
    const draftFoodIds = [...new Set((draft.ingredients || []).map((i) => i.foodId).filter(Boolean))];
    const draftFoods = draftFoodIds.length
      ? await prisma.food.findMany({ where: { id: { in: draftFoodIds } } })
      : [];
    const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
    const verdict = explainRecipeExclusion(
      draftAsRecipe(draft, new Map(draftFoods.map((f) => [f.id, f]))),
      profile
    );
    res.json({
      draft: {
        ...draft,
        allergenViolation: verdict.excluded ? verdict.reason : null,
        allergenFailClosed: verdict.failClosed,
      },
      allergenViolation: verdict.excluded ? verdict.reason : null,
      // Naming what the preview changed on the server, because "preview" reads
      // as read-only and it is not.
      sideEffects: ["unmatched ingredient lines were added to the food library as USDA or placeholder rows"],
    });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

// roadmap/05-data-isolation-audit.md and roadmap/04-multi-tenancy-auth.md
// both independently found the same gap: Recipe has no owner column, and
// these two routes had zero ownership check - any authenticated user could
// edit/delete ANY recipe (the whole shared library, or another user's own
// creation), cascading to silently wipe other users' carts (CartItem.recipeId
// -> Recipe is onDelete:Cascade) and null out slots in other users' active
// plans (PlanSlot.recipeId -> Recipe is onDelete:SetNull). Harmless today
// (one seeded account), armed the moment self-registration ships. A recipe
// with createdByUserId:null is pre-multi-tenancy shared/curated content -
// only an admin may mutate it; a recipe with a creator may only be mutated
// by that creator or an admin.
async function assertCanMutateRecipe(recipe, userId, res) {
  if (recipe.createdByUserId === userId) return true;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.role === "admin") return true;
  res.status(403).json({ error: "you don't have permission to modify this recipe" });
  return false;
}

router.put("/:id", async (req, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "recipe not found" });
  if (!(await assertCanMutateRecipe(recipe, req.userId, res))) return;

  const { name, description, cuisine, slotType, prepTimeMin, steps, ingredients } = req.body || {};
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (cuisine !== undefined) patch.cuisine = cuisine;
  if (slotType !== undefined) patch.slotType = slotType;
  if (prepTimeMin !== undefined) patch.prepTimeMin = prepTimeMin;
  if (steps !== undefined) patch.steps = steps;

  if (ingredients !== undefined) {
    const foods = await prisma.food.findMany({ where: { id: { in: ingredients.map((i) => i.foodId) } } });
    const foodById = new Map(foods.map((f) => [f.id, f]));
    if (foods.length !== new Set(ingredients.map((i) => i.foodId)).size) {
      return res.status(400).json({ error: "one or more ingredient foodIds don't exist" });
    }
    const problems = validateDraftFoods(ingredients, foodById);
    if (problems.length) {
      return res.status(422).json({ error: "recipe fails the data validator", invalidIngredients: problems });
    }
    Object.assign(patch, sumMacros(ingredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams }))));
  }

  try {
    // Stage-C fix (M5): the ingredient replacement and the recipe update run
    // in ONE transaction. Before, a P2002 name collision on the update (a
    // handled 409) left the ingredients already replaced under the old cached
    // macros — wrong nutrition data the solver then consumes; a crash between
    // the delete and create left the recipe with zero ingredients.
    const updated = await prisma.$transaction(async (tx) => {
      if (ingredients !== undefined) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
        await tx.recipeIngredient.createMany({
          data: ingredients.map((i) => ({
            recipeId: recipe.id, foodId: i.foodId, baseGrams: i.grams, scalable: i.scalable ?? true, role: i.role || null,
          })),
        });
      }
      return tx.recipe.update({ where: { id: recipe.id }, data: patch, include: RECIPE_INCLUDE });
    });
    // plan-perf-1: edited ingredients/macros/steps change what the cached plan
    // pool would decide about this recipe.
    invalidateRecipeLibrary();
    res.json(updated);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a recipe named "${name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "recipe not found" });
  if (!(await assertCanMutateRecipe(recipe, req.userId, res))) return;
  // RecipeIngredient -> Recipe is ON DELETE RESTRICT; clear it first.
  // PlanSlot -> Recipe is ON DELETE SET NULL, so old plans survive intact.
  await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
  await prisma.recipe.delete({ where: { id: recipe.id } });
  invalidateRecipeLibrary(); // plan-perf-1
  res.status(204).end();
});

module.exports = router;
