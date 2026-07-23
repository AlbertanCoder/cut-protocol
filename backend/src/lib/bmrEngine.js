// Phase 3 energy engine. Everything derives from the user's Profile — no
// hardcoded personal floors, bands, or prescriptions (the pre-Phase-3 file
// carried FLOOR=2000 and a 1.4–1.9 lb/wk verdict band tuned to one person).
//
// Model, all shown transparently in the Engine tab:
//   BMR   = mean of the applicable formulas the user hasn't excluded
//   TDEE  = BMR × occupation multiplier  +  training kcal/day
//   target = TDEE − rate×500, clamped to max(sex floor, user floor)
const { OCCUPATION_BY_KEY, TRAINING_BY_KEY } = require("./activityData.js");

const kg2lb = (kg) => kg * 2.20462;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── BMR formulas ─────────────────────────────────────────────────────────
// Ten published estimators, averaged. Katch–McArdle / Cunningham / Nelson are
// LBM-based — best when body-fat% is known, hidden when it isn't (0 OR null =
// unknown). Schofield ships only the published 18–60 bands (omit rather than
// guess). FAO/WHO/UNU, Owen, Livingston are always applicable. The lean-mass
// term is single-sourced so the three LBM formulas can never diverge.
const { CITATIONS } = require("./bmrCitations.js");
const leanBodyMass = (kg, bf) => kg * (1 - bf / 100);

const FORMULAS = [
  {
    key: "mifflin", label: "Mifflin–St Jeor",
    applicable: () => true,
    fn: ({ kg, cm, a, male }) => 10 * kg + 6.25 * cm - 5 * a + (male ? 5 : -161),
  },
  {
    key: "oxford", label: "Oxford (Henry)",
    applicable: () => true,
    // Henry 2005 publishes FOUR adult bands (18-30, 30-60, 60-70, >70).
    // Stage-C fix: the old code merged the two over-60 bands into one
    // non-canonical line (13.5/514 M, 10.1/569 F) matching neither. Now the
    // real 60-70 and >70 coefficients are used.
    fn: ({ kg, a, male }) => male
      ? (a < 30 ? 16 * kg + 545 : a < 60 ? 14.2 * kg + 593 : a < 70 ? 13.0 * kg + 567 : 13.7 * kg + 481)
      : (a < 30 ? 13.1 * kg + 558 : a < 60 ? 9.74 * kg + 694 : a < 70 ? 10.2 * kg + 572 : 10.0 * kg + 577),
  },
  {
    key: "harris", label: "Harris–Benedict",
    applicable: () => true,
    fn: ({ kg, cm, a, male }) => male
      ? 88.362 + 13.397 * kg + 4.799 * cm - 5.677 * a
      : 447.593 + 9.247 * kg + 3.098 * cm - 4.33 * a,
  },
  {
    key: "schofield", label: "Schofield (WHO)",
    applicable: ({ a }) => a >= 18 && a < 60,
    fn: ({ kg, a, male }) => male
      ? (a < 30 ? 15.057 * kg + 692.2 : 11.472 * kg + 873.1)
      : (a < 30 ? 14.818 * kg + 486.6 : 8.126 * kg + 845.6),
  },
  {
    key: "katch", label: "Katch–McArdle", needsBodyFat: true,
    applicable: ({ bf }) => bf > 0,
    fn: ({ kg, bf }) => 370 + 21.6 * leanBodyMass(kg, bf),
  },
  {
    key: "cunningham", label: "Cunningham", needsBodyFat: true,
    applicable: ({ bf }) => bf > 0,
    fn: ({ kg, bf }) => 500 + 22 * leanBodyMass(kg, bf),
  },
  // ── E1 (v2): four more published estimators, DEFAULT-OFF (see DEFAULT_ENABLED)
  // so today's 6-formula mean — and every materialized target — is unchanged.
  {
    key: "whofao", label: "FAO/WHO/UNU",
    applicable: () => true,
    fn: ({ kg, a, male }) => male
      ? (a < 30 ? 15.3 * kg + 679 : a < 60 ? 11.6 * kg + 879 : 13.5 * kg + 487)
      : (a < 30 ? 14.7 * kg + 496 : a < 60 ? 8.7 * kg + 829 : 10.5 * kg + 596),
  },
  {
    key: "owen", label: "Owen",
    applicable: () => true,
    fn: ({ kg, male }) => male ? 879 + 10.2 * kg : 795 + 7.18 * kg,
  },
  {
    key: "livingston", label: "Livingston",
    applicable: () => true,
    fn: ({ kg, a, male }) => male
      ? 293 * Math.pow(kg, 0.4330) - 5.92 * a
      : 248 * Math.pow(kg, 0.4356) - 5.09 * a,
  },
  {
    key: "nelson", label: "Nelson (FFM/FM)", needsBodyFat: true,
    applicable: ({ bf }) => bf > 0,
    fn: ({ kg, bf }) => {
      const ffm = leanBodyMass(kg, bf);
      return 25.9 * ffm + 4.04 * (kg - ffm);
    },
  },
];
const FORMULA_KEYS = FORMULAS.map((f) => f.key);

// The formulas that count toward the mean when a profile expresses no explicit
// choice. Option A (default): today's 6 → mean unchanged → byte-identical.
// (Option B — all 10 on by default — is a one-line change to [...FORMULA_KEYS]
// plus a re-baselined BMR golden; deliberately NOT taken.)
const DEFAULT_ENABLED = ["mifflin", "oxford", "harris", "schofield", "katch", "cunningham"];

// `excludedFormulas` membership means "FLIP this formula from its default state":
// a default-ON formula in the list is turned OFF (today's opt-out); a default-OFF
// formula in the list is turned ON (opt-in via the same Engine toggle). For the
// 6 legacy formulas this is byte-identical to the old `excluded.includes(key)`.
function isFormulaOn(key, excludedFormulas) {
  const flipped = excludedFormulas.includes(key);
  return DEFAULT_ENABLED.includes(key) ? !flipped : flipped;
}

function bmrRows(profile, weightKg) {
  // Dual-accept: bodyFatPct null (unset) OR 0 (legacy "unknown") both hide the
  // LBM formulas identically (null > 0 === false, 0 > 0 === false).
  const bf = profile.bodyFatPct == null ? 0 : profile.bodyFatPct;
  const ctx = { kg: weightKg, cm: profile.heightCm, a: profile.age, male: profile.sex === "M", bf };
  const excluded = Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : [];
  return FORMULAS
    .filter((f) => f.applicable(ctx))
    .map((f) => {
      const v = f.fn(ctx);
      return {
        key: f.key, label: f.label, v,
        defaultOn: DEFAULT_ENABLED.includes(f.key),
        // Flip-aware; for the 6 legacy formulas identical to excluded.includes(key).
        excluded: !isFormulaOn(f.key, excluded),
        prov: { formulaId: f.key, inputs: { kg: ctx.kg, cm: ctx.cm, age: ctx.a, male: ctx.male, bf: ctx.bf }, value: v, citation: CITATIONS[f.key] || null },
      };
    });
}

// ── activity ─────────────────────────────────────────────────────────────

function jobMultiplier(profile) {
  if (typeof profile.activityOverride === "number" && profile.activityOverride >= 1 && profile.activityOverride <= 2.2) {
    return { multiplier: profile.activityOverride, source: "override", label: "Manual override" };
  }
  const occ = OCCUPATION_BY_KEY[profile.occupationKey] || OCCUPATION_BY_KEY["desk-office"];
  return { multiplier: occ.multiplier, source: "occupation", label: occ.label };
}

// ACSM: kcal/min = MET × 3.5 × kg / 200 — averaged over the week.
function trainingKcalPerDay(profile, weightKg) {
  const style = TRAINING_BY_KEY[profile.trainingStyle] || TRAINING_BY_KEY.mixed;
  const sessions = profile.sessionsPerWeek || 0;
  const minutes = profile.minutesPerSession || 0;
  const perDay = (sessions * minutes * style.met * 3.5 * weightKg) / 200 / 7;
  return { perDay: Math.round(perDay), style };
}

/**
 * The whole energy picture in one call. `rows` includes every applicable
 * formula with its excluded flag; rmr averages the included ones (if the
 * user excluded everything, all applicable formulas count and
 * allExcludedFallback flags it — an average of nothing is not a number).
 */
function computeEnergy(profile, weightKg) {
  const rows = bmrRows(profile, weightKg);
  let included = rows.filter((r) => !r.excluded);
  const allExcludedFallback = included.length === 0;
  if (allExcludedFallback) included = rows;
  const values = included.map((r) => r.v);
  const rmr = mean(values);
  // Additive dispersion stats. sd = population standard deviation (kcal);
  // spreadPct = range as % of the mean (one decimal). Honest caveat (Engine tab):
  // this is DISPERSION, not a confidence interval — several estimators share a
  // dataset (whofao≈schofield) or the LBM-linear form (katch≈cunningham≈nelson).
  const variance = values.reduce((s, v) => s + (v - rmr) ** 2, 0) / values.length;
  const sd = Math.round(Math.sqrt(variance));
  const spreadPct = rmr > 0 ? Math.round(((Math.max(...values) - Math.min(...values)) / rmr) * 1000) / 10 : 0;
  const job = jobMultiplier(profile);
  const training = trainingKcalPerDay(profile, weightKg);
  const tdee = rmr * job.multiplier + training.perDay;
  return {
    rows,
    rmr: Math.round(rmr),
    spreadLo: Math.round(Math.min(...values)),
    spreadHi: Math.round(Math.max(...values)),
    sd,
    spreadPct,
    includedCount: included.length,
    allExcludedFallback,
    jobMultiplier: job.multiplier,
    jobSource: job.source,
    jobLabel: job.label,
    trainingKcalPerDay: training.perDay,
    trainingStyle: training.style.key,
    trainingMet: training.style.met,
    tdee: Math.round(tdee),
  };
}

// ── prescription: rate of loss → target, with safety rails ───────────────

const RATE_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]; // lb/wk
const SAFE_FLOOR = { M: 1500, F: 1200 }; // kcal/day
const KCAL_PER_LB = 3500;

// The floor is the STRICTEST (highest) of: the sex minimum (1500 M / 1200 F),
// the user's own floor, and — Stage-C fix (M1) — the constitution's
// RMR×0.95 rail. Without the RMR term a high-RMR user at an aggressive rate
// could be prescribed ~450 kcal below the documented minimum. `rmr` is the
// BMR average (resting metabolic rate); pass it from computeEnergy().rmr.
function effectiveFloor(profile, rmr) {
  const sexFloor = SAFE_FLOOR[profile.sex] ?? SAFE_FLOOR.M;
  const rmrFloor = rmr > 0 ? Math.round(rmr * 0.95) : 0;
  return Math.max(sexFloor, rmrFloor, profile.floorKcal || 0);
}

function deriveTarget(profile, tdee, rmr) {
  const rate = profile.rateLbPerWeek ?? 1.0;
  const deficit = Math.round((rate * KCAL_PER_LB) / 7);
  const raw = Math.round(tdee - deficit);
  const floor = effectiveFloor(profile, rmr);
  const target = Math.max(raw, floor);
  const floored = raw < floor;
  // When the target is clamped to the floor, the chosen rate is NOT what the
  // user will actually get. Compute and expose the rate the floored target DOES
  // deliver, so the UI can level with them ("you'll lose about X lb/wk") instead
  // of only saying "not achievable" and leaving them to guess. Additive fields;
  // `target` itself is unchanged, so meal-plan output is unaffected.
  const actualDeficit = Math.max(0, tdee - target);
  const achievableRate = Math.round((actualDeficit * 7 / KCAL_PER_LB) * 100) / 100;
  return { rate, deficit, raw, target, floor, floored, actualDeficit, achievableRate };
}

/**
 * A rate is unsafe when it exceeds ~1% of current body weight per week or
 * the derived target lands on/below the floor. Unsafe rates require an
 * explicit acknowledgement (profile.rateAcknowledged) — the route enforces it.
 */
function rateSafety(profile, weightKg, tdee, rmr) {
  const rate = profile.rateLbPerWeek ?? 1.0;
  const pctOfBw = (rate / kg2lb(weightKg)) * 100;
  const t = deriveTarget(profile, tdee, rmr);
  const reasons = [];
  if (pctOfBw > 1.0) {
    reasons.push(`${rate} lb/wk is ${pctOfBw.toFixed(2)}% of your body weight per week — above the ~1% guideline`);
  }
  if (t.floored) {
    reasons.push(`the math wants ${t.raw.toLocaleString("en-CA")} kcal, below your ${t.floor.toLocaleString("en-CA")} floor — so we hold you at ${t.target.toLocaleString("en-CA")}, which loses about ${t.achievableRate} lb/wk through diet alone (not the ${t.rate} you picked). To go faster, add movement, not less food`);
  }
  return { unsafe: reasons.length > 0, reasons, pctOfBw: Math.round(pctOfBw * 100) / 100 };
}

// ── macros (unchanged heuristics, per-lb-LBM convention) ─────────────────

const CARB_MIDPOINT_BUFFER_G = 25;

function computeMacros(profile, weightKg, targetKcal) {
  const weightLb = kg2lb(weightKg);
  const lbmLb = weightLb * (1 - profile.bodyFatPct / 100);
  const proteinLo = Math.round(lbmLb * 1.14);
  const proteinHi = Math.round(lbmLb * 1.25);
  const fatLo = Math.round(lbmLb * 0.34);
  const fatHi = Math.round(lbmLb * 0.4);
  const proteinMid = (proteinLo + proteinHi) / 2;
  const fatMid = (fatLo + fatHi) / 2;
  // Stage-C fix (#28): clamp carbs at 0. For a lean, heavy, floor-clamped
  // target, protein+fat alone can exceed the calorie budget, which used to
  // render nonsensical negative carb grams ("~0–-131 g") and a broken macro
  // bar. Carbs simply floor at zero (protein+fat already meet the target).
  const carbMid = Math.max(0, Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4) - CARB_MIDPOINT_BUFFER_G);
  const macroKcalGap = Math.round(targetKcal - (proteinMid * 4 + fatMid * 9 + carbMid * 4));
  return {
    lbmLb,
    kcal: targetKcal,
    proteinLo, proteinHi,
    fatLo, fatHi,
    carbLo: Math.max(carbMid - 12, 0),
    carbMid,
    carbHi: carbMid + 12,
    carbBufferG: CARB_MIDPOINT_BUFFER_G,
    macroKcalGap,
  };
}

// ── trend + verdict ──────────────────────────────────────────────────────

function trendRate(entries) {
  // entries: [{ date: "yyyy-mm-dd", weightLb }], most recent last
  const pts = entries.slice(-14);
  if (pts.length < 8) return null;
  const dayNum = (d) => Math.round(Date.parse(d + "T12:00:00") / 864e5);
  const x0 = dayNum(pts[0].date);
  const xs = pts.map((p) => dayNum(p.date) - x0);
  const ys = pts.map((p) => p.weightLb);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  if (den === 0) return null;
  return -(num / den) * 7; // lb/wk lost (positive = losing)
}

/**
 * Verdict bands derive from the user's CHOSEN rate — nobody's personal
 * 1.4–1.9 band. In-band = chosen ± max(0.25, 20%). Advisory only: the fix
 * for a wrong pace is the rate selector on the Profile tab (or adherence),
 * so there are no one-tap target mutations here anymore.
 */
function verdict({ rate, chosenRate, daysIn, atFloor }) {
  const r1 = (n) => Math.round(n * 10) / 10;
  if (daysIn < 10) {
    return { tone: "wait", tag: "WEEK 1 — WATER NOISE", sub: "Early weigh-ins are mostly water shifting. Log daily; judge nothing before day 10." };
  }
  if (rate == null) {
    return { tone: "wait", tag: "INSUFFICIENT DATA", sub: "Need 8+ weigh-ins across the last 14 days for a verdict." };
  }
  const bandWidth = Math.max(0.25, chosenRate * 0.2);
  const lo = Math.round((chosenRate - bandWidth) * 100) / 100;
  const hi = Math.round((chosenRate + bandWidth) * 100) / 100;
  const band = { lo, hi };
  if (rate > hi + 0.4) {
    return { band, tone: "warn", tag: "TOO FAST", sub: `Losing ${r1(rate)} lb/wk against a ${r1(chosenRate)} lb/wk plan. Sustained, that costs muscle — pick a lower rate on the Profile tab.` };
  }
  if (rate > hi) {
    return { band, tone: "warn", tag: "FAST — HOLD", sub: `${r1(rate)} lb/wk vs the ${r1(chosenRate)} plan. Acceptable short-term; watch next week.` };
  }
  if (rate >= lo) {
    return { band, tone: "good", tag: "ON TARGET", sub: `${r1(rate)} lb/wk — inside your ${r1(lo)}–${r1(hi)} band. Touch nothing.` };
  }
  if (rate >= lo - 0.15) {
    return { band, tone: "warn", tag: "BORDERLINE SLOW — HOLD 1 WK", sub: `${r1(rate)} lb/wk vs the ${r1(chosenRate)} plan. If it repeats next week, tighten adherence or raise the rate.` };
  }
  if (atFloor) {
    return { band, tone: "bad", tag: "SLOW — AT YOUR FLOOR", sub: `${r1(rate)} lb/wk and intake is already at the floor. The lever left is movement, not food.` };
  }
  return { band, tone: "bad", tag: "SLOW", sub: `${r1(rate)} lb/wk vs the ${r1(chosenRate)} plan. Check logging accuracy first; then consider a higher rate on the Profile tab.` };
}

module.exports = {
  kg2lb, mean, median, leanBodyMass,
  FORMULAS, FORMULA_KEYS, DEFAULT_ENABLED, isFormulaOn, bmrRows, computeEnergy,
  RATE_OPTIONS, SAFE_FLOOR, effectiveFloor, deriveTarget, rateSafety,
  computeMacros, trendRate, verdict,
};
