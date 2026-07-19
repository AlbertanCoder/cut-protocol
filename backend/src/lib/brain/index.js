// Brain v2 — advisory critic/tailor judgment layer, wired into exactly one spot
// (mealSolver.generateDayCandidates) and gated by isBrainEnabled(). Untouched by
// v3. The deterministic solver stays authoritative; the brain never sets a macro,
// and with the brain OFF (default, all tests) behaviour is byte-identical.
const { isBrainEnabled, askJSON, runToolLoop, __setClient, DEPTH_PROFILES } = require("./llm.js");
const { reviewDay } = require("./critic.js");
const { tailorRecipe } = require("./tailor.js");
const { reviseDayWithCritic, DEFAULT_ROUGH_MATCH } = require("./reviseDay.js");

// Brain v3 — the deterministic-gated planning spine. DORMANT in Stage A: built
// and fully tested alongside v2, but wired into no route. SELECTION (selector,
// the only LLM-toucher) is fenced from PORTIONING (optimizer) + scoring +
// VERIFICATION (verifier, the gate the model can't overrule). With the brain
// gated OFF, none of it runs and behaviour is byte-identical to today.
const { isExcluded, explainExclusion } = require("./exclusions.js");
const { buildPool } = require("./pool.js");
const { makeTools } = require("./tools.js");
const { solvePortions } = require("./optimizer.js");
const { checkFeasibility } = require("./feasibility.js");
const { scorePlan } = require("./scorer.js");
const { verifyPlan } = require("./verifier.js");
const { proposeDay } = require("./selector.js");
const { planDay } = require("./planner.js");

module.exports = {
  // shared single gate
  isBrainEnabled,
  // v2 (live, default-off advisory layer)
  askJSON, reviewDay, tailorRecipe, reviseDayWithCritic, DEFAULT_ROUGH_MATCH,
  // v3 (dormant foundation)
  runToolLoop, __setClient, DEPTH_PROFILES,
  isExcluded, explainExclusion, buildPool, makeTools, solvePortions,
  checkFeasibility, scorePlan, verifyPlan, proposeDay, planDay,
};
