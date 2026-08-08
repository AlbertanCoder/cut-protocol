// Recipe Brain — the barrel. One import surface for routes, the solver seam,
// tests, and the brain chat.
//
// WHAT THE RECIPE BRAIN IS (one paragraph, for the next session): the third
// brain. The TDEE/target engine says what a day must add up to; the solver +
// portion brains arrange and scale what exists; the RECIPE BRAIN changes what
// exists — it specs the gap (spec.js), judges candidates against the user's
// matrix of dials (matrix.js), fits them to macros with a guarded two-move
// tweak engine (tweak.js), and sources through four channels ordered by cost:
// durable cache → matrix-ranked library → owner-enabled web import → governed
// AI generation, with the same verify gate on every proposal and cache-forever
// on every success (orchestrator.js). fillDayGaps/solveDayWithGapFill close
// the loop with the solver: miss → spec → source → re-solve → keep the
// honestly-better day.
module.exports = {
  ...require("./spec.js"),
  ...require("./matrix.js"),
  ...require("./tweak.js"),
  ...require("./orchestrator.js"),
  sources: {
    library: require("./sources/librarySource.js"),
    cache: require("./sources/cacheSource.js"),
    web: require("./sources/webSource.js"),
    ai: require("./sources/aiSource.js"),
  },
};
