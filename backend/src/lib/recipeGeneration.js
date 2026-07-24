// Shared draft-resolution/persistence logic, extracted from routes/recipes.js
// so both the interactive generate-drafts/save-draft flow and the automated
// weekly-solver fallback (weeklyPlanner.js, via generateAndSaveSlotRecipe()
// below) go through the exact same "never fabricate a Food row, never skip
// the real macro computation" path — one implementation, not two that can
// silently drift apart.
const { prisma } = require("./prisma.js");
const { resolveIngredient } = require("./ingredientResolver.js");
const { generateRecipeDrafts } = require("./aiRecipeClient.js");
const { recipeExcludedByStyle, matchesExclusionTerm, recipeExceedsKetoCeiling, additionalIngredientNames } = require("./dietaryFilter.js");

const RECIPE_INCLUDE = { ingredients: { include: { food: true } } };

function sumMacros(ingredients) {
  // ingredients: [{ food: {kcal,protein,fat,carb}, grams }]
  return ingredients.reduce(
    (t, i) => {
      const factor = i.grams / 100;
      return {
        kcal: t.kcal + i.food.kcal * factor,
        protein: t.protein + i.food.protein * factor,
        fat: t.fat + i.food.fat * factor,
        carb: t.carb + i.food.carb * factor,
      };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

// draft: {name, description, cuisine, slotType, prepTimeMin, servings, steps,
//         ingredients:[{name,grams,role,scalable}]} — as returned by
// generateRecipeDrafts(). Resolves every ingredient name to a real Food row
// (existing match, live USDA lookup, or an honestly-flagged placeholder —
// resolveIngredient() never fabricates macros) and computes real totals from
// those resolved rows, never from the AI's own say-so.
// The Food re-fetch is INJECTABLE (Stage 4, additive — omit it and nothing
// changes). Two callers need that: the router's verification step, which must
// screen the resolved rows against the pool filter and would otherwise re-query
// the same ids a second time; and any test that wants to run this path without
// borrowing rows from a real database.
const defaultLoadFoods = (ids) => prisma.food.findMany({ where: { id: { in: ids } } });

async function resolveDraftIngredients(draft, resolveIngredientImpl = resolveIngredient, loadFoodsImpl = defaultLoadFoods) {
  const resolvedIngredients = [];
  for (const ing of draft.ingredients) {
    const r = await resolveIngredientImpl(ing.name);
    const { food, matched } = r;
    resolvedIngredients.push({
      foodId: food.id, name: food.name, grams: ing.grams,
      role: ing.role, scalable: ing.scalable, matched,
      placeholderMacros: matched === "placeholder",
      // The name the DRAFT asked for, kept beside the name it resolved TO.
      // Resolution can legitimately land on a differently-worded row, and the
      // allergen re-check downstream needs both to explain itself.
      requestedName: ing.name,
      // Forwarded from the deterministic resolver ladder (Agent 03,
      // food-data-1) — additive, so an unresolved ingredient can explain WHY
      // and offer a shortlist instead of just showing a zero-macro row.
      status: r.status ?? (matched === "placeholder" ? "needs_review" : "resolved"),
      needsReview: r.needsReview ?? (matched === "placeholder"),
      confidence: r.confidence ?? null,
      candidates: r.candidates ?? [],
      reason: r.reason ?? null,
      extras: r.extras ?? [],
    });
  }
  const foods = await loadFoodsImpl(resolvedIngredients.map((i) => i.foodId));
  const foodById = new Map((foods || []).map((f) => [f.id, f]));
  // FAIL LOUD, not with a TypeError three lines down. A row the resolver
  // returned but the re-fetch could not find means the macro sum would be
  // computed from an incomplete food set — i.e. a silently under-counted recipe,
  // which is the one failure this project's constitution puts first.
  const unloadable = resolvedIngredients.filter((i) => !foodById.has(i.foodId));
  if (unloadable.length) {
    throw new Error(`resolveDraftIngredients: ${unloadable.length} resolved food row(s) could not be loaded (${unloadable.map((i) => i.requestedName || i.name).join(", ")}) — refusing to compute macros from an incomplete food set`);
  }
  const macros = sumMacros(resolvedIngredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams })));

  return {
    name: draft.name, description: draft.description, cuisine: draft.cuisine,
    slotType: draft.slotType, prepTimeMin: draft.prepTimeMin, servings: draft.servings,
    steps: draft.steps, ingredients: resolvedIngredients, ...macros,
    // AI provenance travels with the draft (set by aiRecipeClient's
    // AI_PROVENANCE); preserved here so nothing downstream can mistake an
    // LLM-authored draft for curated content. Absent for non-AI callers.
    ...(draft.aiAuthored ? { aiAuthored: true, verified: false, provenance: draft.provenance || "ai-generated-unverified" } : {}),
  };
}

// ── Post-resolution allergen / diet re-check ───────────────────────────────
// The allergen filter in aiRecipeClient screens the names the MODEL wrote.
// Resolution can point an ingredient at a differently-named Food row, so the
// SAME filter has to run again on what the recipe will actually contain —
// otherwise ingredient resolution is an allergen-erasure path. Returns the
// violating term/style, or null.
// resolvedDraft: { ingredients:[{name}], steps, kcal, carb } (the shape
// resolveDraftIngredients returns, and the shape persistRecipe consumes).
function resolvedDraftViolation(resolvedDraft, { excludedFoods = [], dietaryStyle = null } = {}) {
  const flat = (resolvedDraft.ingredients || []).map((i) => ({ name: i.name }));
  for (const extra of additionalIngredientNames(resolvedDraft.steps)) flat.push({ name: extra });
  if (dietaryStyle && recipeExcludedByStyle({ ingredients: flat }, dietaryStyle)) return dietaryStyle;
  if (dietaryStyle && recipeExceedsKetoCeiling(resolvedDraft, dietaryStyle)) return `${dietaryStyle} carb ceiling`;
  for (const ing of flat) {
    for (const term of excludedFoods) {
      if (matchesExclusionTerm(ing.name, term)) return term;
    }
  }
  return null;
}

// ── Placeholder-share guard (unattended path only) ─────────────────────────
// Agent 03's food-data-1 fix deleted the fuzzy matcher that used to rename an
// unknown ingredient into a confidently-wrong real row. The honest replacement
// returns a ZERO-MACRO placeholder instead. That is right for a human-reviewed
// flow (the DraftCard shows a red warning), but the weekly solver's AI fallback
// has no human in it at all: it would persist a recipe assembled mostly from
// zero-macro rows, sumMacros() would UNDER-count it, and the solver could then
// prefer that recipe precisely BECAUSE its macros look conveniently small. A
// silently-wrong number reaching a real meal plan is the failure this project's
// constitution puts first ("Wrong math = product death"; "silent target misses
// are forbidden").
//
// THRESHOLD — refuse above ONE THIRD of the ingredient list by count, and
// refuse any draft where a placeholder carries a SCALABLE role (protein/carb),
// because that is the ingredient the solver will scale to hit the target:
// zero macros there means the target can never be hit and the miss is
// invisible. One third is chosen, not tuned: a real recipe carries a handful of
// spices/aromatics that legitimately resolve thin, so a hard "zero placeholders"
// rule would refuse nearly everything and effectively disable the fallback; but
// once a third of the list has no macro data the computed total is fiction, not
// an estimate. Deliberately NOT applied to the interactive route — a human is
// looking at that draft and the UI already flags every placeholder row.
const MAX_PLACEHOLDER_SHARE = 1 / 3;
const SCALABLE_ROLES = new Set(["protein", "carb"]);

function placeholderAudit(resolvedDraft) {
  const ings = resolvedDraft.ingredients || [];
  const placeholders = ings.filter((i) => i.placeholderMacros);
  const share = ings.length ? placeholders.length / ings.length : 0;
  const loadBearing = placeholders.filter((i) => SCALABLE_ROLES.has(i.role));
  return {
    total: ings.length,
    placeholders: placeholders.length,
    share,
    names: placeholders.map((i) => i.requestedName || i.name),
    loadBearingNames: loadBearing.map((i) => i.requestedName || i.name),
    tooMany: share > MAX_PLACEHOLDER_SHARE,
    loadBearingMissing: loadBearing.length > 0,
  };
}

// Honest, quotable reason or null. The solver's diagnosis layer surfaces this
// verbatim, so it names the ingredients rather than saying "generation failed".
function placeholderRefusalReason(resolvedDraft) {
  const a = placeholderAudit(resolvedDraft);
  if (a.loadBearingMissing) {
    return `"${resolvedDraft.name}" was refused: its main ${a.loadBearingNames.length > 1 ? "ingredients" : "ingredient"} (${a.loadBearingNames.join(", ")}) could not be matched to a food with real macros, so the recipe's calories and protein would be fiction. Add ${a.loadBearingNames.length > 1 ? "those foods" : "that food"} to the Food database, then regenerate.`;
  }
  if (a.tooMany) {
    return `"${resolvedDraft.name}" was refused: ${a.placeholders} of its ${a.total} ingredients (${a.names.join(", ")}) have no macro data, so its totals would under-count. Add them to the Food database, then regenerate.`;
  }
  return null;
}

// resolvedDraft: the shape resolveDraftIngredients() returns, OR an
// equivalent shape built from already-resolved ingredients (foodId already
// known) — the interactive /save-draft route takes ingredients a human
// already reviewed, which already carry foodId, so it builds this shape
// itself rather than re-resolving names.
//
// `source` is the row's PROVENANCE marker and is whitelisted here: an
// AI-authored recipe can never be written to the library labelled "curated".
// `tasteTier`/`tasteTierSource` are OPTIONAL and additive (Stage 4). They are a
// SOFT ranking prior read only by the brain scorer — never a displayed number,
// never a filter — so writing them cannot change a deterministic result. An
// LLM-authored row may only ever be tagged source "llm", and taste.js caps what
// that source can claim (it can never mint "exceptional"). Omit both and the
// columns stay null, which taste.js already treats as the neutral "decent"
// prior: the default path is unchanged.
const RECIPE_SOURCES = new Set(["curated", "ai-generated", "imported"]);
async function persistRecipe(resolvedDraft, { source = "ai-generated", tasteTier = null, tasteTierSource = null } = {}) {
  const provenance = RECIPE_SOURCES.has(source) ? source : "ai-generated";
  return prisma.recipe.create({
    data: {
      name: resolvedDraft.name, description: resolvedDraft.description || null, cuisine: resolvedDraft.cuisine || null,
      slotType: resolvedDraft.slotType || "meal", prepTimeMin: resolvedDraft.prepTimeMin || null,
      steps: resolvedDraft.steps || [], source: provenance,
      ...(tasteTier ? { tasteTier, tasteTierSource: tasteTierSource || "llm" } : {}),
      kcal: resolvedDraft.kcal, protein: resolvedDraft.protein, fat: resolvedDraft.fat, carb: resolvedDraft.carb,
      ingredients: {
        create: resolvedDraft.ingredients.map((i) => ({
          foodId: i.foodId, baseGrams: i.grams, scalable: i.scalable ?? true, role: i.role || null,
        })),
      },
    },
    include: RECIPE_INCLUDE,
  });
}

// Same protein/kcal-ratio-closeness scoring weeklyPlanner.js's pickRecipe()
// already uses to pick among pool candidates — reused here so "pick the
// best of the 3 AI drafts" isn't a second, different notion of "best fit".
function scoreDraftFit(resolvedDraft, targetRatio) {
  const ratio = resolvedDraft.kcal > 0 ? resolvedDraft.protein / resolvedDraft.kcal : 0;
  return Math.abs(ratio - targetRatio);
}

// target: {slotType, kcalTarget, proteinTarget} (weeklyPlanner.js's slot
// target shape). profile: needs excludedFoods/dietaryStyle (safety, always
// enforced via allowAllergens:false plus the post-resolution re-check below)
// and the cuisinePreferences/mealPreferencesNote fields.
// existingRecipeNames: passed straight to generateRecipeDrafts() to reduce
// near-duplicates, same as the interactive route already does.
//
// Generates 3 drafts (generateRecipeDrafts()'s prompt always asks for
// exactly 3 — not worth touching that contract just to ask for 1), picks the
// best-fitting one, resolves + persists it as source:"ai-generated" — from
// then on it's a normal, reusable pool recipe, same organic-growth property
// ingredientResolver.js already has for Food rows.
//
// UNATTENDED PATH. Nothing here is reviewed by a human before it lands in a
// real meal plan, so it refuses more than the interactive route does:
//   • a governance refusal (feature off / no key / cost cap / timeout) throws
//     an LlmRefusal straight through — weeklyPlanner's catch turns it into an
//     honest unsolved slot rather than a crash;
//   • a draft whose resolved ingredients violate the profile is dropped;
//   • a draft built mostly on zero-macro placeholders is REFUSED with the
//     reason named (see placeholderRefusalReason).
// Last param is dependency injection for tests only (real callers never
// pass it — defaults are the real Claude/USDA/DB-backed implementations).
// Matches this codebase's existing fdcClient.js-style `fetchImpl` pattern
// rather than mocking require()'d modules.
async function generateAndSaveSlotRecipe(target, profile, existingRecipeNames, deps = {}) {
  const { generateDraftsImpl = generateRecipeDrafts, resolveIngredientImpl = resolveIngredient, persistRecipeImpl = persistRecipe } = deps;

  const cuisine = profile.cuisinePreferences?.length
    ? profile.cuisinePreferences[Math.floor(Math.random() * profile.cuisinePreferences.length)]
    : undefined;

  const rules = {
    excludedFoods: Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [],
    dietaryStyle: profile.dietaryStyle || null,
  };

  const { drafts } = await generateDraftsImpl({
    slotType: target.slotType === "snack" ? "snack" : "meal",
    cuisine,
    freeText: profile.mealPreferencesNote || undefined,
    allowAllergens: false, // always safety-first for this unattended path
    targetKcal: target.kcalTarget,
    targetProtein: target.proteinTarget,
    existingRecipeNames,
    excludedFoods: rules.excludedFoods,
    dietaryStyle: rules.dietaryStyle,
    userId: profile.userId ?? null,
  });

  if (!drafts.length) {
    throw new Error("Claude generated no usable drafts (all 3 may have been dropped for allergy-rule violations)");
  }

  // Resolve every draft, then screen each one on what it ACTUALLY contains.
  // Rejections are collected with their reasons so a total wipe-out can be
  // reported honestly instead of as a bare "nothing came back".
  const resolvedDrafts = [];
  const rejected = [];
  for (const draft of drafts) {
    const resolved = await resolveDraftIngredients(draft, resolveIngredientImpl);

    const violation = resolvedDraftViolation(resolved, rules);
    if (violation) {
      rejected.push(`"${resolved.name}" contains ${violation} after ingredient resolution`);
      continue;
    }
    const placeholderReason = placeholderRefusalReason(resolved);
    if (placeholderReason) {
      rejected.push(placeholderReason);
      continue;
    }
    resolvedDrafts.push(resolved);
  }

  if (!resolvedDrafts.length) {
    // LOUD and specific: the solver's diagnosis layer prints this, so it must
    // say which ingredients failed and what the user can do about it.
    throw new Error(`No AI draft was safe to save. ${rejected.join(" ")}`);
  }

  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const best = resolvedDrafts.reduce((a, b) => (scoreDraftFit(a, targetRatio) <= scoreDraftFit(b, targetRatio) ? a : b));

  return persistRecipeImpl(best, { source: "ai-generated" });
}

module.exports = {
  sumMacros, resolveDraftIngredients, persistRecipe, generateAndSaveSlotRecipe,
  resolvedDraftViolation, placeholderAudit, placeholderRefusalReason,
  MAX_PLACEHOLDER_SHARE, RECIPE_SOURCES, RECIPE_INCLUDE, defaultLoadFoods,
};
