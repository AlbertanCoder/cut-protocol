// Brain v2 — Stage 1: the chat planner. When a user asks the coach to BUILD a
// full day, we short-circuit to the DETERMINISTIC day-solver instead of the
// language model:
//   • every macro is computed by the solver (scaleRecipe) — the coach never
//     authors a number (LAW 1);
//   • the pool is already exclusion-filtered by planContext (LAW 2), so no
//     profile and no LLM turn are needed — this is pure, cheap, and available
//     whenever the chat is open;
//   • honest failure: no feasible day → return null and let the caller fall
//     through to the conversational coach (LAW 7).
// Both dependencies are injectable so this is keyless- and DB-free-testable.
const { planContext } = require("../planContext.js");
const { generateDayCandidates } = require("../mealSolver.js");

// A "build me a full day" ask. Deliberately narrow: an explicit plan/build/
// generate verb PLUS a day/plan/menu noun. "vegan dinner ideas", "swap a fatty
// meal", or "why not fish?" do NOT match — they fall through to the coach.
const PLAN_REQUEST_RE = /\b(plan|build|generate|make|create|design|assemble|put together|map out|whip up|give me)\b[^.?!\n]{0,40}\b(day|meal ?plan|menu|full day|day of (?:meals|eating|food)|days? of eating)\b/i;

function looksLikePlanRequest(message) {
  return typeof message === "string" && PLAN_REQUEST_RE.test(message);
}

// Build ONE engine-scored day for the chat bar. Returns a display-ready object
// whose every number came from the deterministic solver, or null when no day
// can be built (missing profile, empty pool, no candidate).
async function generateDayForChat({ userId } = {}, deps = {}) {
  const _planContext = deps.planContext || planContext;
  const _generate = deps.generateDayCandidates || generateDayCandidates;

  const { dailyTarget, mealConfig, recipePool, ratings } = await _planContext(userId);
  // No `profile` passed → the LLM critic block inside generateDayCandidates is
  // skipped entirely: pure deterministic solve, zero model calls, zero spend.
  // T (v2): pass the user's soft taste ratings so chat plans re-rank too.
  const result = await _generate({ dailyTarget, mealConfig, recipePool, filters: { ratings } });
  const best = result && result.candidates && result.candidates[0];
  if (!best || !Array.isArray(best.slots) || best.slots.length === 0) return null;

  const nameById = new Map(recipePool.map((r) => [r.id, r.name]));
  const slots = best.slots.map((s) => ({
    slotType: s.slotType === "snack" ? "snack" : "meal",
    label: s.recipeId ? (nameById.get(s.recipeId) || "?") : null,
    kcal: Math.round(s.kcal),
    protein: Math.round(s.protein),
    fat: Math.round(s.fat),
    carb: Math.round(s.carb),
    warning: s.warning || null,
  }));

  // scoreDay already returns rounded day totals + an honest match %.
  const total = best.score && best.score.totals
    ? best.score.totals
    : slots.reduce((t, s) => ({ kcal: t.kcal + s.kcal, protein: t.protein + s.protein, fat: t.fat + s.fat, carb: t.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });

  return {
    slots,
    total,
    matchPct: best.score ? best.score.matchPct : null,
    target: {
      kcal: dailyTarget.kcal,
      proteinLo: dailyTarget.proteinLo, proteinHi: dailyTarget.proteinHi,
      fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi,
      carbLo: dailyTarget.carbLo, carbHi: dailyTarget.carbHi,
    },
  };
}

// The coach's short, NUMBER-FREE intro line above the plan card. The match %
// only chooses WORDS (never displayed here) — LAW 1 lives in the card's numbers,
// which are the solver's. Our own copy, so it needs no output-guard scan.
function planIntro(plan) {
  const filled = plan.slots.filter((s) => s.label).length;
  const quality = plan.matchPct == null ? "from your recipes"
    : plan.matchPct >= 90 ? "that hits your targets nicely"
    : plan.matchPct >= 75 ? "that lands close to your targets"
    : "— the closest fit from your current recipes";
  const gap = plan.matchPct != null && plan.matchPct < 75
    ? " If it's off, the swap button and more recipes on the Plan tab will tighten it."
    : "";
  return `Here's a full day I put together ${quality}. The numbers below are computed by the engine — tweak or lock meals on the Plan tab.${gap}`.replace(/\s+/g, " ").trim();
}

module.exports = { looksLikePlanRequest, generateDayForChat, planIntro, PLAN_REQUEST_RE };
