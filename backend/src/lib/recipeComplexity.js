// recipeComplexity.js — Stage 3, filter #4 of five.
//
// A DETERMINISTIC complexity score for a recipe: same input -> same output,
// always. Pure function, zero DB, zero network, zero clock. It reads only what
// the recipe row already carries (ingredient rows + the ordered `steps` array),
// so both the library solver path and the AI path can call it on an unsaved
// draft exactly the same way.
//
// WHAT IT IS NOT: it is not a difficulty judgement by a model, and it is not a
// measured cook time. It is an arithmetic proxy over three observable signals,
// stated openly so a displayed number can reveal its formula (constitution:
// "Displayed numbers can reveal their formula and inputs").
//
//   1. INGREDIENT COUNT   — more distinct things to buy, prep and track.
//   2. STEP COUNT         — more discrete actions to sequence.
//   3. TECHNIQUE FLAGS    — how many *attention-demanding* techniques appear in
//                           the step text (knead, temper, emulsify, deep-fry...).
//                           Distinct flags, not occurrences: a recipe that says
//                           "sear" four times is still one searing skill.
//
// Deliberately NOT included: prep minutes. Time is its own filter (#3) and the
// two must stay independent — a 6-hour braise is *slow*, not *hard*, and a
// 12-minute laminated-dough job is *hard*, not *slow*. Folding time into
// complexity would make the two caps redundant and mask which one is binding.

// Techniques that genuinely raise the skill/attention floor. Curated to EXCLUDE
// the verbs that appear in nearly every recipe ("stir", "add", "simmer",
// "season", "bake", "chop") — a flag that fires on 90% of the pool carries no
// information and would just add a constant to every score.
const TECHNIQUE_FLAGS = [
  ["knead", ["knead"]],
  ["proof", ["proof the", "prove the", "leave to rise", "until doubled", "rising time"]],
  ["laminate", ["laminat", "roll out the dough", "fold the dough", "turn the dough"]],
  ["temper", ["temper the", "tempering", "temper eggs"]],
  ["emulsify", ["emulsif", "slowly drizzle in the oil", "whisk in the oil"]],
  ["whip", ["stiff peak", "soft peak", "whip until", "whisk until thick"]],
  ["caramelise", ["caramelis", "caramaliz", "carameliz", "until golden brown and caramel"]],
  ["deglaze", ["deglaze"]],
  ["reduce", ["reduce by half", "reduced by half", "until reduced", "reduce until thick"]],
  ["braise", ["brais"]],
  ["confit", ["confit"]],
  ["sousvide", ["sous vide", "sous-vide"]],
  ["deepfry", ["deep fry", "deep-fry", "deep frying", "180c oil", "350f oil", "oil to 180", "oil to 350"]],
  ["blanch", ["blanch"]],
  ["sear", ["sear ", "searing", "smoking hot"]],
  ["marinate", ["marinat"]],
  ["ferment", ["ferment"]],
  ["cure", ["cure the", "curing", "brine the", "brining"]],
  ["smoke", ["smoke the", "smoking chips", "cold smoke"]],
  ["pipe", ["piping bag", "pipe the"]],
  ["strain", ["strain through", "sieve through", "pass through a fine"]],
  ["restdough", ["rest the dough", "chill the dough", "refrigerate the dough"]],
];

// Anchors for the two count curves. A 3-ingredient / 2-step recipe scores the
// floor; 15 ingredients / 12 steps scores the ceiling. Chosen against the real
// 889-recipe library (median ~8 ingredients, ~5 steps) so the middle of the
// pool lands mid-scale rather than bunched at either end.
const ING_FLOOR = 3;
const ING_CEIL = 15;
const STEP_FLOOR = 2;
const STEP_CEIL = 12;
const TECH_CEIL = 4; // 4+ distinct advanced techniques = maxed

const WEIGHTS = { ingredients: 0.35, steps: 0.40, techniques: 0.25 };

const BANDS = [
  { key: "simple", maxScore: 3 },
  { key: "moderate", maxScore: 6 },
  { key: "involved", maxScore: 10 },
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// `steps` may arrive as a parsed array (Prisma Json), a JSON string (raw SQL),
// or be missing entirely on a draft. Never throw — an unreadable steps value
// means zero step evidence, which the caller sees in factors.stepCount.
function normaliseSteps(steps) {
  if (Array.isArray(steps)) return steps.filter((s) => typeof s === "string");
  if (typeof steps === "string") {
    const trimmed = steps.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
      } catch { return []; }
    }
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function detectTechniques(stepText) {
  const found = [];
  for (const [flag, needles] of TECHNIQUE_FLAGS) {
    if (needles.some((n) => stepText.includes(n))) found.push(flag);
  }
  return found;
}

/**
 * computeComplexity(recipe) -> { score, band, factors }
 *   score   integer 1..10 (1 = trivial, 10 = a project)
 *   band    "simple" | "moderate" | "involved"
 *   factors the raw inputs, so the number can always explain itself
 *
 * Pure and total: any shape of input returns a valid result. An empty recipe
 * scores the floor (1/"simple") because "no evidence of complexity" is the
 * honest reading of an empty ingredient+step list — and unlike cost, a low
 * complexity score cannot be gamed into a false bargain, it just means the row
 * is thin. `factors.evidence` is "none" in that case so callers can say so.
 */
function computeComplexity(recipe = {}) {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const steps = normaliseSteps(recipe.steps);
  const ingredientCount = ingredients.length;
  const stepCount = steps.length;
  const stepText = steps.join(" \n ").toLowerCase();
  const techniques = detectTechniques(stepText);

  const ingTerm = clamp01((ingredientCount - ING_FLOOR) / (ING_CEIL - ING_FLOOR));
  const stepTerm = clamp01((stepCount - STEP_FLOOR) / (STEP_CEIL - STEP_FLOOR));
  const techTerm = clamp01(techniques.length / TECH_CEIL);

  const raw = WEIGHTS.ingredients * ingTerm + WEIGHTS.steps * stepTerm + WEIGHTS.techniques * techTerm;
  const score = Math.round(1 + raw * 9);
  const band = BANDS.find((b) => score <= b.maxScore).key;

  return {
    score,
    band,
    factors: {
      ingredientCount,
      stepCount,
      techniques,
      techniqueCount: techniques.length,
      terms: {
        ingredients: Math.round(ingTerm * 1000) / 1000,
        steps: Math.round(stepTerm * 1000) / 1000,
        techniques: Math.round(techTerm * 1000) / 1000,
      },
      weights: WEIGHTS,
      evidence: ingredientCount === 0 && stepCount === 0 ? "none" : "row",
    },
    provenance: "estimated",
  };
}

// Pool-wide cache, mirroring recipeCost.buildCostCache so the solver can build
// all five filter caches with the same call shape.
function buildComplexityCache(pool = []) {
  const cache = new Map();
  for (const r of pool) cache.set(r.id, computeComplexity(r));
  return cache;
}

// ── prep-time ESTIMATOR (filter #3's backfill, not its score) ───────────────
// Filter #3 reads Recipe.prepTimeMin. 256 of the 889 library rows have none, so
// a time cap silently lets them all through (mealSolver.applyPrepFilter passes
// nulls). Rather than invent a column value in a migration, this derives one
// from the SAME observable signals complexity uses — and the caller is required
// to tag the result provenance "estimated" so it can never be mistaken for a
// measured cook time (constitution: provenance on every entry).
//
// It shares INPUTS with computeComplexity but is a separate output on purpose:
// a 4-hour braise is slow and easy, laminated dough is fast and hard. Feeding
// one into the other would collapse two independent caps into one.
const TECHNIQUE_MINUTES = {
  knead: 15,
  proof: 45,
  laminate: 30,
  temper: 5,
  emulsify: 5,
  whip: 5,
  caramelise: 8,
  deglaze: 3,
  reduce: 10,
  braise: 60,
  confit: 60,
  sousvide: 60,
  deepfry: 10,
  blanch: 5,
  sear: 5,
  marinate: 20,
  ferment: 60,
  cure: 30,
  smoke: 45,
  pipe: 8,
  strain: 3,
  restdough: 30,
};

// Anchors fitted against the 633 library rows that DO carry a prepTimeMin; the
// backfill script reports the resulting error distribution on that same subset
// every run, so this stays an honest, checkable fit rather than a guess.
const PREP_BASE_MIN = 5;
const PREP_PER_INGREDIENT_MIN = 1.0;
const PREP_PER_STEP_MIN = 2.5;
const PREP_MIN_FLOOR = 5;
const PREP_MIN_CEIL = 240;

function estimatePrepMin(recipe = {}) {
  const { factors } = computeComplexity(recipe);
  const techMinutes = factors.techniques.reduce((a, t) => a + (TECHNIQUE_MINUTES[t] || 0), 0);
  const raw =
    PREP_BASE_MIN +
    PREP_PER_INGREDIENT_MIN * factors.ingredientCount +
    PREP_PER_STEP_MIN * factors.stepCount +
    techMinutes;
  const rounded = Math.round(raw / 5) * 5;
  const minutes = Math.min(PREP_MIN_CEIL, Math.max(PREP_MIN_FLOOR, rounded));
  return {
    minutes,
    provenance: "estimated",
    factors: { ...factors, techMinutes, raw: Math.round(raw * 10) / 10 },
  };
}

module.exports = {
  computeComplexity,
  buildComplexityCache,
  estimatePrepMin,
  TECHNIQUE_FLAGS,
  TECHNIQUE_MINUTES,
  BANDS,
  WEIGHTS,
  normaliseSteps,
};
