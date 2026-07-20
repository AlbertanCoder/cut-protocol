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

// Brain v3 — Stage B: cost / trace / degrade spine (pure; dormant until wired).
// prismaUsageStore is deliberately NOT re-exported here so index.js stays
// Prisma-free — require it directly when wiring the live ledger.
const { MODELS, CAPS } = require("./config.js");
const { PRICING, costUsd } = require("./pricing.js");
const { needsLLM, pickModel } = require("./router.js");
const { makeLedger, memoryStore, withUsageLogging } = require("./ledger.js");
const { validProv, provenanceLint } = require("./telemetry.js");
const { buildSystemPrompt } = require("./prompts/system.js");
const { preGate } = require("./guard.js");
const { postCheck } = require("./outputGuard.js");
const { refusalText, REFUSALS } = require("./policy.js");
const { makeClassifier } = require("./classifier.js");

// Brain v3 — Stage E: the constraint model. checkFeasibility here operates on a
// ConstraintSet (aliased checkConstraintFeasibility to avoid clashing with the
// pool-level feasibility check above). satisfies is the acceptance predicate the
// planning loop converges against — the model never decides "done".
const { compileConstraints, checkFeasibility: checkConstraintFeasibility, satisfies, relaxNext, SOFT_ORDER } = require("./constraints.js");

// Brain v3 — Stage F: recipe generation (gated/dormant). The model proposes
// structure only; resolveStructure/assembleRecipe/scaleToTarget/
// verifyGeneratedRecipe own every number and gate exclusions + provenance.
const { generateRecipe, resolveStructure, assembleRecipe, scaleToTarget, verifyGeneratedRecipe, acceptRecipe } = require("./create.js");

// Brain v3 — Stage G: multi-constraint scoring. Turns the Stage-E soft
// ConstraintSet into clamped-weight penalty terms; budget/complexity with no
// per-recipe column are reported (noSignal), never scored. Soft never overrides
// hard.
const { scoreSoftConstraints, clampSoftWeights, totalCost } = require("./softScore.js");

// Brain v3 — Stage H: grocery aggregation. Reuses the app's unit/section
// classifiers; assertNoExcluded runs AFTER aggregation so an excluded item can
// never reappear via a combine step. Deterministic + offline (no LLM).
const { buildBrainGroceryList, aggregateBrainPlan, assertNoExcluded } = require("./grocery.js");

// Brain v3 — Stage I: SOFT-preference persistence. prismaPrefsStore is kept out
// of the barrel (require directly when wiring) so index.js stays Prisma-free.
// EXCLUSIONS ARE NEVER STORED — sanitizeSoft fails closed on any exclusion key.
const { assertSoftOnly, sanitizeSoft, memoryPrefsStore } = require("./prefsStore.js");

// Brain v3 — Stage J: cost controls (pure, keyless). Version-hash BrainCache
// (stale input never serves a wrong answer), deterministic candidate prefilter,
// prompt-cache breakpoint planning, think-on-first-only.
const { BrainCache, makeCacheKey, hashInputs, prefilterCandidates, planCacheBreakpoints, thinkOnFirstOnly } = require("./cache.js");

module.exports = {
  // shared single gate
  isBrainEnabled,
  // v2 (live, default-off advisory layer)
  askJSON, reviewDay, tailorRecipe, reviseDayWithCritic, DEFAULT_ROUGH_MATCH,
  // v3 (dormant foundation)
  runToolLoop, __setClient, DEPTH_PROFILES,
  isExcluded, explainExclusion, buildPool, makeTools, solvePortions,
  checkFeasibility, scorePlan, verifyPlan, proposeDay, planDay,
  // Stage B — cost / trace / degrade spine
  MODELS, CAPS, PRICING, costUsd, needsLLM, pickModel,
  makeLedger, memoryStore, withUsageLogging, validProv, provenanceLint,
  // Stage C — persona / system prompt
  buildSystemPrompt,
  // Stage D1 — domain guard (defense-in-depth) + G2 Tier-1 classifier
  preGate, postCheck, refusalText, REFUSALS, makeClassifier,
  // Stage E — constraint model
  compileConstraints, checkConstraintFeasibility, satisfies, relaxNext, SOFT_ORDER,
  // Stage F — recipe generation (gated/dormant)
  generateRecipe, resolveStructure, assembleRecipe, scaleToTarget, verifyGeneratedRecipe, acceptRecipe,
  // Stage G — multi-constraint scoring
  scoreSoftConstraints, clampSoftWeights, totalCost,
  // Stage H — grocery aggregation (post-aggregation exclusion gate)
  buildBrainGroceryList, aggregateBrainPlan, assertNoExcluded,
  // Stage I — SOFT-preference persistence (exclusions never stored)
  assertSoftOnly, sanitizeSoft, memoryPrefsStore,
  // Stage J — cost controls / caching
  BrainCache, makeCacheKey, hashInputs, prefilterCandidates, planCacheBreakpoints, thinkOnFirstOnly,
};
