// Brain v3 — the ONE pure, deterministic scoring objective. Protein + kcal are
// load-bearing; fat is a floor; carb is a wide band; variety + palatability are
// light nudges. LLM-proposed weights are CLAMPED to [wMin,wMax] then applied by
// pure arithmetic — raw model weights are never used unclamped. `coherence` is a
// number the LLM writes onto a candidate UPSTREAM; the scorer only READS stored
// numbers, it never calls the model.
const { proteinMid } = require("./feasibility.js");

const { effectiveTasteScore } = require("./taste.js");

// Protein-priority mode (additive, gated behind opts.mode — see scorePlan):
// shares its weights + floor-honesty check with the live deterministic
// solver (mealSolver.js) via proteinFloor.js, so "the floor" means the same
// number and the same reporting contract in both places.
const { PROTEIN_PRIORITY_WEIGHTS, checkProteinFloor } = require("./proteinFloor.js");

// taste (0.03) is deliberately well below protein/kcal (0.35) — it reorders,
// never dominates. It contributes 0 unless a slot carries a taste signal.
const DEFAULT_WEIGHTS = { protein: 0.35, kcal: 0.35, fat: 0.1, carb: 0.1, variety: 0.05, palatability: 0.05, taste: 0.03 };
const WEIGHT_BOUNDS = { min: 0, max: 1 };

const cap = (x) => Math.min(1, Math.max(0, x));

// base defaults to DEFAULT_WEIGHTS as before (backward compatible); scorePlan
// passes PROTEIN_PRIORITY_WEIGHTS as the base when opts.mode === "proteinPriority"
// so an LLM-proposed override still clamps against a sane starting point.
function clampWeights(proposed, base = DEFAULT_WEIGHTS) {
  const w = { ...base };
  if (proposed && typeof proposed === "object") {
    for (const k of Object.keys(base)) {
      const v = Number(proposed[k]);
      if (Number.isFinite(v)) w[k] = Math.min(WEIGHT_BOUNDS.max, Math.max(WEIGHT_BOUNDS.min, v));
    }
  }
  return w;
}

function sumSlots(slots) {
  return (slots || []).reduce(
    (s, x) => {
      const v = x.value || x;
      return {
        kcal: s.kcal + (v.kcal || 0),
        protein: s.protein + (v.protein_g ?? v.protein ?? 0),
        fat: s.fat + (v.fat_g ?? v.fat ?? 0),
        carb: s.carb + (v.carb_g ?? v.carb ?? 0),
      };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

const dev = (v, t) => (t > 0 ? Math.abs(v - t) / t : 0);
const rangeMiss = (v, lo, hi) => (lo != null && v < lo ? (lo - v) / Math.max(hi ?? lo, 1) : hi != null && v > hi ? (v - hi) / Math.max(hi, 1) : 0);

function varietyPenalty(slots) {
  const ids = (slots || []).map((s) => s.recipeId).filter(Boolean);
  if (ids.length === 0) return 0;
  const unique = new Set(ids).size;
  return 1 - unique / ids.length; // 0 = all distinct, →1 = all identical
}

function avgCoherence(slots) {
  const vals = (slots || []).map((s) => Number(s.coherence)).filter((x) => Number.isFinite(x));
  if (vals.length === 0) return 1; // no signal → assume coherent (no penalty)
  return cap(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// T (v2): mean effectiveTasteScore across slots that carry a taste signal
// (tasteTier or ratings). null → NO taste signal at all → the taste term is
// skipped, so a plan of untagged recipes scores exactly as before.
function avgEffectiveTaste(slots) {
  const vals = (slots || []).filter((s) => s && (s.tasteTier != null || s.userRatingCount)).map((s) => effectiveTasteScore(s));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * scorePlan(day, target, opts) -> { cost, score, breakdown, proteinFloor, prov }
 * day: { slots:[{kcal,protein,carb,fat, recipeId?, coherence?}], totals? }.
 * Lower cost = better; score = 1 - cost for convenience. opts.weights are clamped.
 * opts.mode === "proteinPriority": protein-priority weights become the base
 * (protein now dominant over kcal, was the reverse) AND the return carries a
 * `proteinFloor` honesty check ({met, shortG, reason}) against
 * target.proteinFloor ?? target.proteinLo — never a silent miss (LAW 7).
 * Additive: omitting opts.mode reproduces today's behaviour byte-for-byte.
 */
function scorePlan(day, target, opts = {}) {
  // variety/palatability/taste have no protein-priority-specific value —
  // merge onto DEFAULT_WEIGHTS's so clampWeights always has a complete base.
  const base = opts.mode === "proteinPriority" ? { ...DEFAULT_WEIGHTS, ...PROTEIN_PRIORITY_WEIGHTS } : DEFAULT_WEIGHTS;
  const w = clampWeights(opts.weights, base);
  // Accept either a `_g`-suffixed MacroVector (dayTotals) or bare keys (sumSlots)
  // — reading the wrong shape here NaN'd the score and killed best-of-N selection.
  const raw = day.totals || sumSlots(day.slots);
  const totals = { kcal: raw.kcal || 0, protein: raw.protein_g ?? raw.protein ?? 0, carb: raw.carb_g ?? raw.carb ?? 0, fat: raw.fat_g ?? raw.fat ?? 0 };
  const pMid = proteinMid(target);

  const proteinShort = pMid > 0 ? Math.max(0, (pMid - totals.protein) / pMid) : 0; // asymmetric: only a shortfall hurts
  const kcalDev = dev(totals.kcal, target.kcal);
  const fatFloor = target.fatLo != null ? Math.max(0, (target.fatLo - totals.fat) / Math.max(target.fatLo, 1)) : 0;
  const carbBand = rangeMiss(totals.carb, target.carbLo, target.carbHi);
  const variety = varietyPenalty(day.slots);
  const palatability = 1 - avgCoherence(day.slots);
  const eff = avgEffectiveTaste(day.slots); // null → no taste signal → term is 0
  const tastePenalty = eff == null ? 0 : 1 - eff;

  const terms = {
    protein: w.protein * cap(proteinShort),
    kcal: w.kcal * cap(kcalDev),
    fat: w.fat * cap(fatFloor),
    carb: w.carb * cap(carbBand),
    variety: w.variety * cap(variety),
    palatability: w.palatability * cap(palatability),
    taste: w.taste * cap(tastePenalty),
  };
  const cost = Object.values(terms).reduce((a, b) => a + b, 0);
  // Only computed in protein-priority mode — a plain scorePlan() call stays
  // byte-identical to before (no proteinFloor key at all, not even null),
  // matching the "additive, no restructure" contract for this file.
  const proteinFloor = opts.mode === "proteinPriority"
    ? checkProteinFloor(totals.protein, target.proteinFloor ?? target.proteinLo ?? pMid)
    : undefined;
  return {
    cost,
    score: Math.max(0, 1 - cost),
    breakdown: { totals, terms, weights: w },
    ...(proteinFloor !== undefined ? { proteinFloor } : {}),
    prov: { formulaId: "scorePlan", inputs: { target, weights: w, mode: opts.mode || null }, value: cost },
  };
}

module.exports = { scorePlan, clampWeights, DEFAULT_WEIGHTS, WEIGHT_BOUNDS, sumSlots, PROTEIN_PRIORITY_WEIGHTS };
