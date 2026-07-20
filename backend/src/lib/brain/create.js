// create.js — Brain v3 Stage F. LLM-assisted recipe GENERATION under the
// selection/verification fence.
//
// The model proposes STRUCTURE ONLY: a name + ingredient REFERENCES (each
// foodId must resolve to a real pool Food) + rough grams + a role + steps. It
// never invents a food (LAW 2 / "no invented foods") and never emits a macro —
// any number it attaches to an ingredient is DROPPED here (LAW 1). The
// deterministic layer then owns every number: resolveStructure resolves each
// ingredient to an authoritative Food (fail-closed on unknown/excluded),
// assembleRecipe computes macros from source, scaleToTarget N-anchor scales via
// the golden-locked optimizer, and verifyGeneratedRecipe re-checks exclusions +
// macros + provenance before anything is returned. Converge or honest-fail —
// never fabricate convergence (LAW 7).
const { isExcluded } = require("./exclusions.js");
const { makeTools, macrosFromItems } = require("./tools.js");
const { solvePortions, SCALE_BOUNDS } = require("./optimizer.js");
const { isBrainEnabled, runToolLoop } = require("./llm.js");
const { TOOL_DEFS } = require("./selector.js");

const round5 = (g) => Math.max(0, Math.round((Number(g) || 0) / 5) * 5);
const macroVec = (m) => ({ kcal: m.kcal, protein: m.protein_g, fat: m.fat_g, carb: m.carb_g });
const macroFields = (m) => ({ kcal: m.kcal, protein: m.protein_g, carb: m.carb_g, fat: m.fat_g });

// ---- LLM I/O helpers (the only structure the model may return) --------------

function buildCreatePrompt({ target = {}, hints = {}, feedback = "" } = {}) {
  const lines = [
    "Design ONE recipe near this per-meal target using ONLY foods from the compliant pool.",
    `Target: ~${Math.round(target.kcal || 0)} kcal, ~${Math.round(target.protein || 0)} g protein.`,
    "Use searchFoods to find real food ids. You do NOT report macros — the app computes them from the food database.",
    'Reply with ONLY a JSON object: {"name":"...","ingredients":[{"foodId":"<id>","grams":<number>,"role":"protein|side"}],"steps":["..."]}',
  ];
  if (hints.cuisine) lines.push(`Prefer ${hints.cuisine} cuisine if the pool allows.`);
  if (feedback) lines.push(`The previous attempt was rejected: ${feedback} Fix it.`);
  return lines.join("\n");
}

// Parse the model's final answer into a STRUCTURE, keeping only foodId/grams/role
// per ingredient. Any macro the model attached is discarded here (LAW 1).
function parseStructure(content) {
  const text = (content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { name: null, ingredients: [], steps: [] };
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { name: null, ingredients: [], steps: [] };
  }
  const ingredients = (Array.isArray(obj.ingredients) ? obj.ingredients : [])
    .map((i) => ({
      foodId: typeof i.foodId === "string" ? i.foodId : i.foodId != null ? String(i.foodId) : null,
      grams: Number(i.grams),
      role: i.role === "protein" ? "protein" : "side",
    }))
    .filter((i) => i.foodId != null);
  return { name: typeof obj.name === "string" ? obj.name : null, ingredients, steps: Array.isArray(obj.steps) ? obj.steps.filter((s) => typeof s === "string") : [] };
}

// ---- Deterministic pipeline (pure; the fence the model can't cross) ---------

// resolveStructure — THE "no invented foods" gate. Resolves every ingredient
// foodId to a pool Food; fail-closed on unknown, exclusion re-checked, grams
// validated. Strips any macro the model attached. ok=false if nothing resolves.
function resolveStructure(proposal = {}, pool = {}, profile = null) {
  const foods = pool.foods instanceof Map ? pool.foods : new Map();
  const ingredients = [];
  const rejected = [];
  for (const raw of proposal.ingredients || []) {
    const food = raw.foodId != null ? foods.get(raw.foodId) : null;
    if (!food) {
      rejected.push({ foodId: raw.foodId, code: "unknown-food" }); // fail-closed: never invent
      continue;
    }
    if (isExcluded(food, profile)) {
      rejected.push({ foodId: raw.foodId, code: "excluded-food" });
      continue;
    }
    const grams = round5(raw.grams);
    if (!(grams > 0)) {
      rejected.push({ foodId: raw.foodId, code: "bad-grams" });
      continue;
    }
    // Keep ONLY structure — foodId, resolved food, grams, role. No model macros.
    ingredients.push({ foodId: food.id, food, grams, role: raw.role === "protein" ? "protein" : "side" });
  }
  return { ok: rejected.length === 0 && ingredients.length > 0, name: proposal.name || "Generated recipe", ingredients, rejected, steps: proposal.steps || [] };
}

// assembleRecipe — authoritative macros from the resolved foods (the ONLY macro
// source). Carries prov (LAW 3).
function assembleRecipe(resolved) {
  const macros = macrosFromItems(resolved.ingredients.map((i) => ({ food: i.food, grams: i.grams })));
  return {
    name: resolved.name,
    ingredients: resolved.ingredients,
    steps: resolved.steps,
    ...macroFields(macros),
    prov: { formulaId: "macrosFromItems", inputs: { items: resolved.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })) }, value: macroFields(macros) },
    source: "ai-generated",
  };
}

// scaleToTarget — N-anchor scale to (kcal, protein). Splits into a protein
// anchor bundle vs the rest and solves the two scales with the golden-locked
// optimizer (k=2 == legacy scaleRecipe), applies 5 g practical rounding, then
// RE-derives macros from the rounded grams so the displayed totals are always
// from-source.
function scaleToTarget(recipe, target = {}, bounds = SCALE_BOUNDS) {
  const ings = recipe.ingredients;
  let proteinSet = new Set(ings.filter((i) => i.role === "protein"));
  if (proteinSet.size === 0 && ings.length) {
    const anchor = ings.reduce((a, b) => ((b.food.protein || 0) > (a.food.protein || 0) ? b : a));
    proteinSet = new Set([anchor]);
  }
  const pIngs = ings.filter((i) => proteinSet.has(i));
  const rIngs = ings.filter((i) => !proteinSet.has(i));
  const c0 = macroVec(macrosFromItems(pIngs.map((i) => ({ food: i.food, grams: i.grams })))); // protein bundle
  const c1 = macroVec(macrosFromItems(rIngs.map((i) => ({ food: i.food, grams: i.grams })))); // the rest
  const { scales, prov: solveProv } = solvePortions([c0, c1], { kcal: target.kcal, protein: target.protein }, { bounds });
  const [x0, x1] = scales;
  const scaledIngs = ings.map((i) => ({ ...i, grams: round5(i.grams * (proteinSet.has(i) ? x0 : x1)) }));
  const macros = macrosFromItems(scaledIngs.map((i) => ({ food: i.food, grams: i.grams })));
  const scaled = { ...recipe, ingredients: scaledIngs, ...macroFields(macros), prov: { formulaId: "scaleGeneratedRecipe", inputs: { target, scales, solveProv }, value: macroFields(macros) } };
  return { recipe: scaled, scales };
}

// verifyGeneratedRecipe — the gate the model can't overrule, for a NEWLY MADE
// recipe (not a pool recipe, so verifier.verifyPlan doesn't apply). Independently
// recomputes macros from source, re-runs isExcluded over every ingredient, and
// validates provenance. A rejection is a discard + reason — never a silent fix.
function verifyGeneratedRecipe(recipe, ctx = {}) {
  const { pool = {}, profile = null } = ctx;
  const foods = pool.foods instanceof Map ? pool.foods : new Map();
  const rejections = [];
  // Re-resolve every ingredient from the POOL (not the carried i.food) so the
  // check is INDEPENDENT of the object under test — a mismatched carried food
  // object can't rubber-stamp itself.
  const resolved = [];
  for (const i of recipe.ingredients || []) {
    const poolFood = foods.get(i.foodId);
    if (!poolFood) { rejections.push({ foodId: i.foodId, code: "unknown-or-excluded-food" }); continue; }
    if (isExcluded(poolFood, profile)) { rejections.push({ foodId: i.foodId, code: "excluded-item" }); continue; }
    resolved.push({ food: poolFood, grams: i.grams });
  }
  const recomputed = macrosFromItems(resolved);
  const claimed = macroFields(recomputed); // reference
  const stated = { kcal: recipe.kcal, protein_g: recipe.protein, carb_g: recipe.carb, fat_g: recipe.fat };
  const EPS = 0.01;
  for (const [k, sk] of [["kcal", "kcal"], ["protein_g", "protein"], ["carb_g", "carb"], ["fat_g", "fat"]]) {
    if (Math.abs((recomputed[k] || 0) - (recipe[sk] || 0)) > EPS + 1e-9 * Math.abs(recomputed[k] || 0)) {
      rejections.push({ code: "macro-mismatch", macro: sk, stated: recipe[sk], recomputed: recomputed[k] });
    }
  }
  if (!recipe.prov || typeof recipe.prov.formulaId !== "string") rejections.push({ code: "untraceable-number" });
  return { ok: rejections.length === 0, rejections, recomputed: claimed, stated };
}

// acceptRecipe — the deterministic acceptance predicate for a single recipe.
function acceptRecipe(recipe, target = {}) {
  const kcalTol = Math.max(50, (target.kcal || 0) * 0.07);
  const proteinTol = Math.max(8, (target.protein || 0) * 0.1);
  const dK = (recipe.kcal || 0) - (target.kcal || 0);
  const dP = (recipe.protein || 0) - (target.protein || 0);
  const ok = Math.abs(dK) <= kcalTol && dP >= -proteinTol;
  return { ok, gap: { kcal: Math.round(dK), protein: Math.round(dP) }, tol: { kcal: Math.round(kcalTol), protein: Math.round(proteinTol) } };
}

// ---- Gated orchestrator (dormant; injectable for keyless mock tests) --------

/**
 * generateRecipe({ profile, pool, target, hints, maxIters }, deps) -> result.
 * deps: { enabled?, runLoop?, tools?, system?, model? } — all injectable so the
 * loop can be driven by a mock client with ZERO real API calls. Gated: returns
 * { status:'unavailable' } unless the brain is enabled (dormant by default).
 */
async function generateRecipe({ profile, pool, target = {}, hints = {}, maxIters = 2 } = {}, deps = {}) {
  const enabled = deps.enabled ?? isBrainEnabled();
  if (!enabled) return { status: "unavailable" };

  const runLoop = deps.runLoop || runToolLoop;
  const tools = deps.tools || makeTools(pool, profile);
  const system = deps.system || "";
  let feedback = "";
  let best = null;

  for (let iter = 0; iter < Math.max(1, maxIters); iter++) {
    const messages = [{ role: "user", content: buildCreatePrompt({ target, hints, feedback }) }];
    const loop = await runLoop({ system, messages, tools, toolDefs: TOOL_DEFS, maxTurns: 4, model: deps.model });
    const proposal = parseStructure(loop.content);

    const resolved = resolveStructure(proposal, pool, profile);
    if (!resolved.ok) { feedback = `${resolved.rejected.length} ingredient(s) did not resolve (${resolved.rejected.map((r) => r.code).join(", ")}). Use only searchFoods ids.`; continue; }

    const scaled = scaleToTarget(assembleRecipe(resolved), target);
    const verdict = verifyGeneratedRecipe(scaled.recipe, { pool, profile });
    if (!verdict.ok) { feedback = `verification rejected: ${verdict.rejections.map((r) => r.code).join(", ")}.`; continue; }

    const acc = acceptRecipe(scaled.recipe, target);
    if (acc.ok) return { status: "ok", recipe: scaled.recipe, prov: scaled.recipe.prov, iters: iter + 1, calls: loop.calls || [] };
    best = { recipe: scaled.recipe, gap: acc.gap, tol: acc.tol };
    feedback = `off target by ${acc.gap.kcal} kcal / ${acc.gap.protein} g protein. Adjust ingredients or grams.`;
  }

  if (best) return { status: "partial", recipe: best.recipe, gap: best.gap, binding: "target", fixes: ["Widen the calorie/protein target, or allow more ingredients."] };
  return { status: "failed", reason: "no resolvable structure", fixes: ["Broaden the food pool or relax the exclusions."] };
}

module.exports = { generateRecipe, resolveStructure, assembleRecipe, scaleToTarget, verifyGeneratedRecipe, acceptRecipe, parseStructure, buildCreatePrompt };
