// Brain v3 — SELECTION. The ONLY module that touches the LLM (via
// llm.runToolLoop). It proposes WHICH pool recipe fills each slot; it does NOT
// emit macros. Any number the model tries to attach to a pick is DROPPED here
// (LAW 1) — the deterministic tools compute the real macros downstream and the
// verifier gates them. The tool set handed to the model is a fixed allowlist
// that reads app data only: there is NO web/shell/file/eval/network tool (LAW 5,
// structural — enforced by what does and doesn't exist in TOOL_DEFS).
const { runToolLoop } = require("./llm.js");

const TOOL_DEFS = [
  { name: "searchRecipes", description: "Search the compliant recipe pool by name and/or slotType. Returns recipe ids + names only.", input_schema: { type: "object", properties: { query: { type: "string" }, slotType: { type: "string" }, limit: { type: "number" } } } },
  { name: "searchFoods", description: "Search the compliant food pool by name. Returns food ids + names only.", input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } } },
  { name: "scaleRecipe", description: "Scale a POOL recipe to a kcal+protein target. Returns authoritative computed macros.", input_schema: { type: "object", properties: { recipeId: { type: "string" }, kcalTarget: { type: "number" }, proteinTarget: { type: "number" } }, required: ["recipeId"] } },
  { name: "computeMacros", description: "Compute macros for [{foodId, grams}] from the pool. The only producer of food macros.", input_schema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } }, required: ["items"] } },
  { name: "dayTotals", description: "Sum a day's slot macros.", input_schema: { type: "object", properties: { slots: { type: "array", items: { type: "object" } } } } },
];

function buildPrompt(slotTargets) {
  const lines = [
    "Fill each slot below with ONE recipe from the compliant pool. Use the search and scale tools to find recipes that land near each slot's kcal and protein target.",
    "You do NOT report macros — the app computes them. Reply with ONLY a JSON object:",
    '{"slots":[{"slotType":"meal","slotIndex":0,"recipeId":"<id>"}, ...]}',
    "Slots:",
    ...slotTargets.map((s) => `- ${s.slotType} #${s.slotIndex}: ~${Math.round(s.kcalTarget)} kcal, ~${Math.round(s.proteinTarget)} g protein`),
  ];
  return lines.join("\n");
}

// Parse the model's final answer into recipe picks, KEEPING ONLY the routing +
// recipeId. Any macro/number the model attached is discarded here (LAW 1).
function parsePicks(content) {
  const text = (content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const arr = Array.isArray(obj.slots) ? obj.slots : Array.isArray(obj) ? obj : [];
  return arr
    .map((p) => ({
      slotType: typeof p.slotType === "string" ? p.slotType : null,
      slotIndex: Number.isInteger(p.slotIndex) ? p.slotIndex : null,
      recipeId: typeof p.recipeId === "string" ? p.recipeId : null,
    }))
    .filter((p) => p.recipeId);
}

/**
 * proposeDay({ slotTargets, tools, system, ... }) -> { slots, calls, stop }
 * slotTargets: [{ slotType, slotIndex, kcalTarget, proteinTarget }] (deterministic).
 * Returns intent-only slots: each carries the DETERMINISTIC target + the model's
 * chosen recipeId (or null). No macros here — ever.
 * `runLoop` is injectable so the loop can be driven by a mock client in tests.
 */
async function proposeDay({ slotTargets = [], tools = {}, system = "", toolDefs = TOOL_DEFS, maxTurns = 4, model, runLoop = runToolLoop } = {}) {
  const messages = [{ role: "user", content: buildPrompt(slotTargets) }];
  const loop = await runLoop({ system, messages, tools, toolDefs, maxTurns, model });
  const queue = parsePicks(loop.content);

  const slots = slotTargets.map((st) => {
    let idx = queue.findIndex((p) => p.slotType === st.slotType && p.slotIndex === st.slotIndex);
    if (idx === -1) idx = queue.findIndex((p) => p.slotType == null && p.slotIndex == null);
    if (idx === -1 && queue.length) idx = 0; // positional fallback
    const pick = idx >= 0 ? queue.splice(idx, 1)[0] : null;
    return {
      slotType: st.slotType,
      slotIndex: st.slotIndex,
      kcalTarget: st.kcalTarget,
      proteinTarget: st.proteinTarget,
      recipeId: pick ? pick.recipeId : null,
    };
  });

  return { slots, calls: loop.calls || [], stop: loop.stop };
}

module.exports = { proposeDay, parsePicks, buildPrompt, TOOL_DEFS };
