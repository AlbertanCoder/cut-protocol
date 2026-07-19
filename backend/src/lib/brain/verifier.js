// Brain v3 — the VERIFIER: the gate the LLM can NEVER overrule (LAWS 1, 2, 3).
// For every slot a selector proposes it independently:
//   (a) confirms the recipe is actually in the (already-exclusion-filtered) pool
//       and re-runs isExcluded — an excluded/unknown item is rejected;
//   (b) RECOMPUTES the macros from source via the deterministic tool layer and
//       rejects any claimed number that disagrees beyond float epsilon;
//   (c) rejects any claimed number that lacks valid provenance.
// A rejection is a discard + structured feedback — never a silent "fix".
const { isExcluded } = require("./exclusions.js");

const MACRO_EPS = 0.01;

function asMacro(v) {
  return {
    kcal: v.kcal || 0,
    protein: v.protein_g ?? v.protein ?? 0,
    carb: v.carb_g ?? v.carb ?? 0,
    fat: v.fat_g ?? v.fat ?? 0,
  };
}

function macrosMatch(a, b, eps = MACRO_EPS) {
  const A = asMacro(a);
  const B = asMacro(b);
  return ["kcal", "protein", "carb", "fat"].every((k) => Math.abs(A[k] - B[k]) <= eps + 1e-9 * Math.max(Math.abs(A[k]), Math.abs(B[k])));
}

function validProv(p) {
  return !!p && typeof p === "object" && typeof p.formulaId === "string" && "inputs" in p && "value" in p;
}

/**
 * verifyPlan(proposal, ctx) -> { ok, rejections, recomputed, prov }
 * proposal.slots: [{ recipeId, kcalTarget?, proteinTarget?, macros?/value?/claimedMacros?, prov? }]
 * ctx: { pool, profile, tools } — tools from makeTools(pool, profile).
 */
function verifyPlan(proposal, ctx = {}) {
  const { pool, profile, tools } = ctx;
  const rejections = [];
  const recomputed = [];

  for (const slot of proposal?.slots || []) {
    const recipe = pool && pool.recipes instanceof Map ? pool.recipes.get(slot.recipeId) : null;
    if (!recipe) {
      rejections.push({ recipeId: slot.recipeId, code: "unknown-or-excluded-recipe" });
      continue;
    }
    // Defense in depth: the pool already excluded, but re-check against the
    // authoritative profile (it may have changed since the pool was built).
    if (isExcluded(recipe, profile)) {
      rejections.push({ recipeId: slot.recipeId, code: "excluded-item" });
      continue;
    }

    let fresh = null;
    if (tools && (slot.kcalTarget != null || slot.proteinTarget != null)) {
      try {
        fresh = tools.scaleRecipe({ recipeId: slot.recipeId, kcalTarget: slot.kcalTarget, proteinTarget: slot.proteinTarget });
        recomputed.push({ recipeId: slot.recipeId, value: fresh.value, prov: fresh.prov });
      } catch (e) {
        rejections.push({ recipeId: slot.recipeId, code: "recompute-failed", detail: String(e.message || e) });
        continue;
      }
    }

    // Any macro number carried on the slot (e.g. one the model tried to smuggle)
    // MUST equal a fresh recompute AND carry valid provenance, or it is rejected.
    const claimed = slot.macros || slot.value || slot.claimedMacros;
    if (claimed) {
      if (!fresh) {
        rejections.push({ recipeId: slot.recipeId, code: "unverifiable-number" });
        continue;
      }
      if (!macrosMatch(claimed, fresh.value)) {
        rejections.push({ recipeId: slot.recipeId, code: "macro-mismatch", claimed: asMacro(claimed), recomputed: asMacro(fresh.value) });
      }
      if (!validProv(slot.prov)) {
        rejections.push({ recipeId: slot.recipeId, code: "untraceable-number" });
      }
    }
  }

  return {
    ok: rejections.length === 0,
    rejections,
    recomputed,
    prov: { formulaId: "verifyPlan", inputs: { slots: (proposal?.slots || []).length }, value: rejections.length === 0 },
  };
}

module.exports = { verifyPlan, macrosMatch, validProv };
