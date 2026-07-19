// Brain v2 — the day-solve integration loop. This is the seam that wires the
// critic into the deterministic day-solve path WITHOUT the deterministic solver
// ever depending on the brain. Everything it needs is injected (solve, scoreDay,
// reviewDay, enabled), which keeps it pure and unit-testable with no Prisma and
// no network, and guarantees:
//   - brain OFF  -> exactly one deterministic solve, ZERO critic/LLM calls,
//                   the deterministic day returned unchanged (byte-identical).
//   - brain ON   -> if (and only if) the deterministic day scores below the
//                   "rough" threshold, ONE critic review; if it returns issues,
//                   ONE re-solve with the critic's constraints; the
//                   better-scoring of the two days is kept. Cap: 1 re-solve.
// The deterministic solver stays authoritative — the critic only supplies
// constraints (exclude ids / a protein-target nudge), never macros.
const { isBrainEnabled } = require("./llm.js");
const critic = require("./critic.js");

// A day whose honest match % is at/above this is considered fine and is never
// sent to the critic (saves an LLM call on already-good days).
const DEFAULT_ROUGH_MATCH = 70;

/**
 * @param {object} o
 * @param {(constraints:object|null)=>Promise<{slots:any[]}>} o.solve  fresh deterministic solve; null = unconstrained, object = re-solve with critic constraints
 * @param {(slots:any[])=>{matchPct:number,totals?:object}} o.scoreDay  pure day scorer
 * @param {object} [o.targets]   daily targets passed to the critic for context
 * @param {object} [o.profile]   the user's profile (dietary context for the critic)
 * @param {(input:object)=>Promise<object>} [o.reviewDay]  injectable critic (defaults to the real one)
 * @param {boolean} [o.enabled]  injectable gate (defaults to isBrainEnabled())
 * @param {number}  [o.roughMatch]  threshold below which a day is reviewed
 * @returns {Promise<{slots:any[], score:object, revised:boolean}>}
 */
async function reviseDayWithCritic({
  solve,
  scoreDay,
  targets = {},
  profile = null,
  reviewDay = critic.reviewDay,
  enabled = undefined,
  roughMatch = DEFAULT_ROUGH_MATCH,
}) {
  const brainOn = enabled === undefined ? isBrainEnabled() : enabled;

  // 1. Deterministic solve — always, and always the authority.
  const base = await solve(null);
  const baseScore = scoreDay(base.slots);

  // 2. Brain off, or the day is already good enough → return it untouched.
  //    (`!(x < t)` also short-circuits safely if matchPct is NaN.)
  if (!brainOn || !(baseScore.matchPct < roughMatch)) {
    return { slots: base.slots, score: baseScore, revised: false };
  }

  // 3. Rough day + brain on → one critic pass, then at most one re-solve.
  //    ANY error anywhere in the brain path degrades to the deterministic day.
  try {
    const review = await reviewDay({ slots: base.slots, totals: baseScore.totals, targets, profile });
    if (!review || review.ok || !Array.isArray(review.issues) || review.issues.length === 0) {
      return { slots: base.slots, score: baseScore, revised: false };
    }
    const revised = await solve(review.constraints || {});
    const revisedScore = scoreDay(revised.slots);
    // 4. Keep the better-scoring day (ties keep the deterministic original).
    if (revisedScore.matchPct > baseScore.matchPct) {
      return { slots: revised.slots, score: revisedScore, revised: true };
    }
    return { slots: base.slots, score: baseScore, revised: false };
  } catch {
    return { slots: base.slots, score: baseScore, revised: false };
  }
}

module.exports = { reviseDayWithCritic, DEFAULT_ROUGH_MATCH };
