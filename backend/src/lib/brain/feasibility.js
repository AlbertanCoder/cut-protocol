// Brain v3 — feasibility. Cheap NECESSARY bounds run BEFORE any LLM turn (so an
// impossible ask spends zero tokens), and a place to NAME the binding constraint
// so failure is honest (LAW 7), never a silent "close enough". The dual/Farkas
// certificate after selection is a later refinement; Stage A ships the pre-flight
// necessary checks.
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function proteinMid(target) {
  if (target.proteinTarget != null) return target.proteinTarget;
  if (target.proteinLo != null && target.proteinHi != null) return (target.proteinLo + target.proteinHi) / 2;
  return target.protein || 0;
}

function result(feasible, bindingConstraint, slack, message, extra = {}) {
  return { feasible, bindingConstraint, slack, message, prov: { formulaId: "checkFeasibility", inputs: extra, value: feasible } };
}

/**
 * checkFeasibility(pool, target) -> { feasible, bindingConstraint, slack, message, prov }
 * NECESSARY conditions only (passing does not guarantee a solve; failing DOES
 * guarantee no solve within the [0.5,2] scale envelope):
 *   • non-empty pool
 *   • some recipe carries at least the protein-per-kcal density the target needs
 */
function checkFeasibility(pool, target) {
  const recipes = pool && pool.recipes instanceof Map ? [...pool.recipes.values()] : [];
  if (recipes.length === 0) {
    return result(false, "empty-pool", 1, "No compliant recipes remain after exclusions — the diet/allergy filters removed everything.");
  }

  const kcal = target.kcal || 0;
  const protein = proteinMid(target);
  const neededDensity = kcal > 0 ? protein / kcal : 0;
  if (neededDensity > 0) {
    let bestDensity = 0;
    for (const r of recipes) {
      if (r.kcal > 0) bestDensity = Math.max(bestDensity, r.protein / r.kcal);
    }
    if (bestDensity < neededDensity - 1e-9) {
      const slack = neededDensity - bestDensity;
      return result(
        false, "protein-density", round(slack, 4),
        `Protein unreachable: the target needs ~${round(neededDensity)} g protein per kcal, but the densest compliant recipe gives only ~${round(bestDensity)} g/kcal.`,
        { neededDensity: round(neededDensity), bestDensity: round(bestDensity) }
      );
    }
  }

  return result(true, null, 0, "Necessary feasibility bounds satisfied.", { recipes: recipes.length });
}

module.exports = { checkFeasibility, proteinMid };
