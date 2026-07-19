// Brain v3 — the ONE pure, deterministic scoring objective. Protein + kcal are
// load-bearing; fat is a floor; carb is a wide band; variety + palatability are
// light nudges. LLM-proposed weights are CLAMPED to [wMin,wMax] then applied by
// pure arithmetic — raw model weights are never used unclamped. `coherence` is a
// number the LLM writes onto a candidate UPSTREAM; the scorer only READS stored
// numbers, it never calls the model.
const { proteinMid } = require("./feasibility.js");

const DEFAULT_WEIGHTS = { protein: 0.35, kcal: 0.35, fat: 0.1, carb: 0.1, variety: 0.05, palatability: 0.05 };
const WEIGHT_BOUNDS = { min: 0, max: 1 };

const cap = (x) => Math.min(1, Math.max(0, x));

function clampWeights(proposed) {
  const w = { ...DEFAULT_WEIGHTS };
  if (proposed && typeof proposed === "object") {
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
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

/**
 * scorePlan(day, target, opts) -> { cost, score, breakdown, prov }
 * day: { slots:[{kcal,protein,carb,fat, recipeId?, coherence?}], totals? }.
 * Lower cost = better; score = 1 - cost for convenience. opts.weights are clamped.
 */
function scorePlan(day, target, opts = {}) {
  const w = clampWeights(opts.weights);
  const totals = day.totals || sumSlots(day.slots);
  const pMid = proteinMid(target);

  const proteinShort = pMid > 0 ? Math.max(0, (pMid - totals.protein) / pMid) : 0; // asymmetric: only a shortfall hurts
  const kcalDev = dev(totals.kcal, target.kcal);
  const fatFloor = target.fatLo != null ? Math.max(0, (target.fatLo - totals.fat) / Math.max(target.fatLo, 1)) : 0;
  const carbBand = rangeMiss(totals.carb, target.carbLo, target.carbHi);
  const variety = varietyPenalty(day.slots);
  const palatability = 1 - avgCoherence(day.slots);

  const terms = {
    protein: w.protein * cap(proteinShort),
    kcal: w.kcal * cap(kcalDev),
    fat: w.fat * cap(fatFloor),
    carb: w.carb * cap(carbBand),
    variety: w.variety * cap(variety),
    palatability: w.palatability * cap(palatability),
  };
  const cost = Object.values(terms).reduce((a, b) => a + b, 0);
  return {
    cost,
    score: Math.max(0, 1 - cost),
    breakdown: { totals, terms, weights: w },
    prov: { formulaId: "scorePlan", inputs: { target, weights: w }, value: cost },
  };
}

module.exports = { scorePlan, clampWeights, DEFAULT_WEIGHTS, WEIGHT_BOUNDS, sumSlots };
