const Anthropic = require("@anthropic-ai/sdk");
const { recipeExcludedByStyle, matchesExclusionTerm } = require("./dietaryFilter.js");

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// Stage-C fix (C2): the generator now enforces THIS user's profile, not one
// hardcoded person's three allergies. The hard filter (a system prompt is not
// a safety mechanism for a real allergy) reuses the same dietaryFilter the
// solver and library use, driven by the caller's excludedFoods + dietaryStyle.
// draft: { ingredients:[{name}] }; returns the violating term/style or null.
function violatesRules(draft, { excludedFoods = [], dietaryStyle = null } = {}) {
  const flat = (draft.ingredients || []).map((i) => ({ name: i.name }));
  if (dietaryStyle && recipeExcludedByStyle({ ingredients: flat }, dietaryStyle)) return dietaryStyle;
  for (const ing of flat) {
    for (const term of excludedFoods) {
      if (matchesExclusionTerm(ing.name, term)) return term;
    }
  }
  return null;
}

const RECIPES_SCHEMA = {
  type: "object",
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          cuisine: { type: "string" },
          slotType: { type: "string", enum: ["meal", "snack", "either"] },
          prepTimeMin: { type: "integer" },
          servings: { type: "integer" },
          steps: { type: "array", items: { type: "string" } },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                grams: { type: "number" },
                role: { type: "string", enum: ["protein", "carb", "veg", "fat", "dairy", "other"] },
                scalable: { type: "boolean" },
              },
              required: ["name", "grams", "role", "scalable"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "description", "cuisine", "slotType", "prepTimeMin", "servings", "steps", "ingredients"],
        additionalProperties: false,
      },
    },
  },
  required: ["recipes"],
  additionalProperties: false,
};

function buildPrompt({ slotType, protein, cuisine, prepTimeMin, freeText, batchStyle, allowAllergens, targetKcal, targetProtein, existingRecipeNames, excludedFoods = [], dietaryStyle = null }) {
  const lines = [
    `Generate exactly 3 distinct ${slotType} recipe options for a cut-phase meal plan.`,
    `Target per serving: ~${Math.round(targetKcal)} kcal, ~${Math.round(targetProtein)}g protein. Protein is the load-bearing constraint — hit it closely; calories should land close too.`,
    `Ingredient grams should be realistic cooked-weight portions for a single serving (the app scales servings automatically later — don't pre-scale for a household).`,
  ];
  if (protein) lines.push(`Primary protein source: ${protein}.`);
  if (cuisine) lines.push(`Cuisine style: ${cuisine}.`);
  if (prepTimeMin) lines.push(`Keep prep time under ${prepTimeMin} minutes.`);
  if (batchStyle === "batch") lines.push(`This should be a batch-cook recipe meant to be made once and eaten across multiple servings (like a chili or a tray bake) — set "servings" accordingly (e.g. 4-6) and size ingredient grams for the whole batch.`);
  else lines.push(`Single serving — set "servings" to 1.`);
  if (freeText) lines.push(`Additional request from the user: ${freeText}`);
  // Stage-C fix (C2): exclusions come from THIS user's profile, not a fixed
  // list. The post-generation hard filter re-checks these regardless.
  if (!allowAllergens) {
    if (dietaryStyle && dietaryStyle !== "none") {
      lines.push(`The user follows a ${dietaryStyle} diet — every recipe must comply with it.`);
    }
    if (excludedFoods.length) {
      lines.push(`Hard exclusions — the user is allergic to / must avoid: ${excludedFoods.join(", ")}. Do not use any of these or dishes containing them. These are real restrictions.`);
    }
  }
  if (existingRecipeNames?.length) {
    lines.push(`Avoid near-duplicates of recipes already in the library: ${existingRecipeNames.join(", ")}.`);
  }
  lines.push(`Write cook steps in a terse, direct style — 3-6 short imperative sentences, no fluff, no filler ("first, we will..."). Match: "Sear steak 3-4 min per side for medium-rare." not "Begin by searing the steak on each side for approximately 3 to 4 minutes until it reaches your desired level of doneness."`);
  lines.push(`Tag each ingredient's "role" (protein/carb/veg/fat/dairy/other) and whether it's "scalable" (true for the main protein/carb/veg components, false for fixed items like a single egg or a pinch of spice).`);
  return lines.join("\n");
}

async function generateRecipeDrafts(params) {
  const prompt = buildPrompt(params);

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: RECIPES_SCHEMA }, effort: "high" },
    system: "You are a recipe developer for a personal cut-phase meal planning app. Recipes must be real, cookable dishes with accurate-sounding ingredient lists — not vague placeholders.",
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Recipe generation was declined — try rephrasing the request.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text content in recipe generation response");
  const parsed = JSON.parse(textBlock.text);

  const allDrafts = parsed.recipes || [];
  const violations = [];
  const rules = { excludedFoods: params.excludedFoods || [], dietaryStyle: params.dietaryStyle || null };
  const drafts = params.allowAllergens
    ? allDrafts
    : allDrafts.filter((d) => {
        const violation = violatesRules(d, rules);
        if (violation) { violations.push({ name: d.name, reason: violation }); return false; }
        return true;
      });

  return { drafts, droppedForAllergies: violations };
}

module.exports = { generateRecipeDrafts, violatesRules };
