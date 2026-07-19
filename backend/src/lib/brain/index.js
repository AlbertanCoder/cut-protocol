// Brain v2 — LLM JUDGMENT LAYER (Phase 10). A thin, optional, always-fallback
// layer on top of the deterministic engine:
//   - llm.js       : Anthropic wrapper + isBrainEnabled() gate + askJSON()
//   - critic.js    : reviewDay() — flags incoherent/silly days, proposes re-solve constraints
//   - tailor.js    : tailorRecipe() — advisory ingredient-swap suggestions
//   - reviseDay.js : the deterministic-first day-solve loop the critic plugs into
// The deterministic solver is authoritative everywhere; the brain never sets a
// macro, and with the brain OFF (default, and in all tests) behaviour is
// byte-identical to the pre-brain build with zero LLM calls.
const { isBrainEnabled, askJSON } = require("./llm.js");
const { reviewDay } = require("./critic.js");
const { tailorRecipe } = require("./tailor.js");
const { reviseDayWithCritic, DEFAULT_ROUGH_MATCH } = require("./reviseDay.js");

module.exports = {
  isBrainEnabled,
  askJSON,
  reviewDay,
  tailorRecipe,
  reviseDayWithCritic,
  DEFAULT_ROUGH_MATCH,
};
