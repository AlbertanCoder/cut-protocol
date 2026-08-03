// Phase 3 energy engine. Everything derives from the user's Profile — no
// hardcoded personal floors, bands, or prescriptions (the pre-Phase-3 file
// carried FLOOR=2000 and a 1.4–1.9 lb/wk verdict band tuned to one person).
//
// Model, all shown transparently in the Engine tab:
//   BMR   = mean of the applicable formulas the user hasn't excluded
//   TDEE  = BMR × occupation multiplier  +  training kcal/day
//   target = TDEE − rate×500, clamped to max(sex floor, user floor)
const { OCCUPATION_BY_KEY, TRAINING_BY_KEY } = require("./activityData.js");
// ONE definition of "what day is it" — dates.js owns it and every consumer
// imports it. The trend window below used to carry a private
// `Date.parse(d + "T12:00:00")` copy, which is the exact local-noon parse
// dates.js documents as a bug: in a zone whose DST crosses UTC+0 the constant
// offset changes with the season, so a span measured across the switch comes
// out a day short. Never re-declare these.
const { dayNum } = require("./dates.js");

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
    // Nelson 1992 (Am J Clin Nutr 56:848-56) publishes the two-compartment
    // model in kJ/day: REE = 108·FFM + 16.9·FM. The kcal form the literature
    // quotes is that divided by 4.184 kJ/kcal → 25.81·FFM + 4.04·FM.
    // The FM coefficient here is exactly 16.9/4.184 = 4.039 → 4.04, so the FFM
    // coefficient must come off the SAME conversion: 108/4.184 = 25.813 → 25.8.
    // It read 25.9, which is not 108/4.184 under any conversion constant
    // (4.1868 gives 25.796) — an arithmetic slip worth ~+7 kcal/day at 70 kg
    // FFM. Corrected to 25.8. Formula is default-off, so no shipped target
    // moves; the row it renders is now right.
    fn: ({ kg, bf }) => {
      const ffm = leanBodyMass(kg, bf);
      return 25.8 * ffm + 4.04 * (kg - ffm);
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
// Keto: a real ketogenic target holds carbs to a hard low cap and lets FAT fill
// the remaining calories — the opposite of the default (fat fixed by LBM, carbs
// as leftover). Without this a "keto" plan targeted ~150 g carbs (a QC customer
// found 32-117 g/day against a 30 g ceiling). ~25 g/day, ceiling 30, is standard
// nutritional-keto. Protein stays LBM-based (moderate protein is correct on keto).
const KETO_CARB_TARGET_G = 25;
const KETO_CARB_LO_G = 10;
const KETO_CARB_CEILING_G = 30;
// When body-fat% is unknown (null OR 0 — the same dual-accept as bmrRows), lean
// mass can't be measured, so the per-lb-LBM protein/fat would otherwise be taken
// off the FULL bodyweight (LBM = weight × (1 − 0)), inflating a 176 lb man to
// ~200 g protein. Assume a sex-typical body fat instead and DISCLOSE it
// (bfAssumed) so the UI can prompt for the real number. 21/28 % are the ACE
// adult "average/acceptable" midpoints (M/F).
const ASSUMED_BODY_FAT_PCT = { M: 21, F: 28 };
// Essential-fat floor (single-sourced; the keto branch uses it too): fat never
// drops below this per-lb-LBM amount.
const ESSENTIAL_FAT_PER_LB_LBM = 0.3;
// A NON-keto plan holds at least this many carb grams. Below ~50 g/day a diet
// drifts into ketosis, so squeezing a "none"/omnivore target to 0 g carbs (which
// a lean, heavy, aggressive-deficit profile used to do) is silently making the
// plan ketogenic. When the leftover carb falls under this floor we hold carbs
// here and pull the calories back out of fat (down to essential fat).
const NONKETO_CARB_FLOOR_G = 50;

function computeMacros(profile, weightKg, targetKcal) {
  const weightLb = kg2lb(weightKg);
  const bfKnown = profile.bodyFatPct != null && profile.bodyFatPct > 0;
  const bfForLbm = bfKnown ? profile.bodyFatPct : (profile.sex === "F" ? ASSUMED_BODY_FAT_PCT.F : ASSUMED_BODY_FAT_PCT.M);
  const lbmLb = weightLb * (1 - bfForLbm / 100);
  const proteinLo = Math.round(lbmLb * 1.14);
  const proteinHi = Math.round(lbmLb * 1.25);
  const proteinMid = (proteinLo + proteinHi) / 2;

  // Keto branch — carbs capped, fat fills the balance. Only for dietaryStyle
  // "keto", so every other profile (including the diet="none" golden fixture)
  // takes the byte-identical path below and its goldens are unaffected.
  if (profile.dietaryStyle === "keto") {
    const carbMid = KETO_CARB_TARGET_G;
    const fatFromBalance = Math.round((targetKcal - proteinMid * 4 - carbMid * 4) / 9);
    const fatMid = Math.max(Math.round(lbmLb * ESSENTIAL_FAT_PER_LB_LBM), fatFromBalance); // never below essential fat
    return {
      lbmLb, kcal: targetKcal,
      proteinLo, proteinHi,
      fatLo: Math.round(fatMid * 0.9), fatHi: Math.round(fatMid * 1.12),
      carbLo: KETO_CARB_LO_G, carbMid, carbHi: KETO_CARB_CEILING_G,
      carbBufferG: 0,
      macroKcalGap: Math.round(targetKcal - (proteinMid * 4 + fatMid * 9 + carbMid * 4)),
      keto: true,
      bfAssumed: !bfKnown, assumedBodyFatPct: bfKnown ? null : bfForLbm,
    };
  }

  let fatLo = Math.round(lbmLb * 0.34);
  let fatHi = Math.round(lbmLb * 0.4);
  let fatMid = (fatLo + fatHi) / 2;
  // Carbs are the leftover calories after LBM-based protein + fat.
  let carbMid = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4) - CARB_MIDPOINT_BUFFER_G;
  let carbFloored = false;
  if (carbMid < NONKETO_CARB_FLOOR_G) {
    // A lean/heavy/aggressive-deficit profile squeezes the leftover carb toward 0.
    // For a NON-keto plan that's wrong (it silently becomes ketogenic): hold carbs
    // at the floor and pull the calories back out of FAT, down to essential fat —
    // the mirror image of the keto branch. If protein + essential fat + floor carbs
    // STILL overshoot the target (Stage-C / #28: a lean, heavy, floor-clamped user),
    // the target is too low to be non-keto at this body composition; carbs take
    // whatever's left (never negative) and the overshoot surfaces honestly in
    // macroKcalGap rather than as negative carb grams.
    carbFloored = true;
    const essentialFat = Math.round(lbmLb * ESSENTIAL_FAT_PER_LB_LBM);
    const fatFromBalance = Math.round((targetKcal - proteinMid * 4 - NONKETO_CARB_FLOOR_G * 4) / 9);
    fatMid = Math.max(essentialFat, fatFromBalance);
    fatLo = Math.round(fatMid * 0.9);
    fatHi = Math.round(fatMid * 1.12);
    const roomForCarb = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4);
    carbMid = Math.max(0, Math.min(NONKETO_CARB_FLOOR_G, roomForCarb));
  }
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
    carbFloored,
    bfAssumed: !bfKnown, assumedBodyFatPct: bfKnown ? null : bfForLbm,
  };
}

// ── trend + verdict ──────────────────────────────────────────────────────

// A DAY window, not a ROW window.
//
// `entries.slice(-14)` took the last fourteen ROWS, whatever calendar range
// they happened to span, while the app told the user "the last 14 days" and
// "verdicts judge 7-day averages only". For anyone who does not weigh in daily
// those are different windows, and the gap is not cosmetic: eight MONTHLY
// weigh-ins, 209.4 → 196.2 lb over 213 days, produced a 0.44 lb/wk rate and a
// "slower than planned — consider a higher rate" verdict; adding six flat
// weigh-ins across the real last fortnight (true rate 0.0 lb/wk) only moved it
// to 0.40, because seven months of old history stayed in the fit and diluted
// the fortnight that was actually being judged. The same rate drives the
// goal-date projection, so the error propagates.
//
// Now: take every weigh-in inside a real TREND_WINDOW_DAYS-day calendar window,
// and refuse to speak unless enough of them landed inside it.
const TREND_WINDOW_DAYS = 14;
const TREND_MIN_POINTS = 8;
// Belt-and-braces: 8 points on distinct days already span ≥ 8 days, but a
// caller passing duplicate dates must not be able to extrapolate a weekly rate
// off a two-day cluster.
const TREND_MIN_SPAN_DAYS = 7;

/**
 * The weigh-ins a trend may be fitted to: those inside the trailing
 * `windowDays` calendar days, anchored on `asOf` (default: the newest entry, so
 * the function stays pure and clock-free — pass `asOf: todayStr()` to judge
 * against today instead).
 */
function trendWindow(entries, { asOf = null, windowDays = TREND_WINDOW_DAYS } = {}) {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && Number.isFinite(e.weightLb) && Number.isFinite(dayNum(e.date)))
    .map((e) => ({ day: dayNum(e.date), weightLb: e.weightLb, date: e.date }))
    .sort((a, b) => a.day - b.day);
  const empty = { points: [], anchorDay: null, firstDay: null, windowDays, spanDays: 0, dropped: 0 };
  if (!rows.length) return empty;
  const anchorDay = Number.isFinite(dayNum(asOf)) ? dayNum(asOf) : rows[rows.length - 1].day;
  const firstDay = anchorDay - (windowDays - 1);
  const points = rows.filter((r) => r.day >= firstDay && r.day <= anchorDay);
  const spanDays = points.length ? points[points.length - 1].day - points[0].day + 1 : 0;
  return { points, anchorDay, firstDay, windowDays, spanDays, dropped: rows.length - points.length };
}

/**
 * lb/wk lost (positive = losing) from a least-squares fit over the trend
 * window. null — never a guess — when the window is too thin to carry a slope.
 * @param {{date:string, weightLb:number}[]} entries any order
 */
function trendRate(entries, opts = {}) {
  const minPoints = opts.minPoints ?? TREND_MIN_POINTS;
  const minSpanDays = opts.minSpanDays ?? TREND_MIN_SPAN_DAYS;
  const w = trendWindow(entries, opts);
  const pts = w.points;
  if (pts.length < minPoints) return null;
  if (w.spanDays < minSpanDays) return null;
  const x0 = pts[0].day;
  const xs = pts.map((p) => p.day - x0);
  const ys = pts.map((p) => p.weightLb);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  if (den === 0) return null;
  return -(num / den) * 7; // lb/wk lost (positive = losing)
}

// ── "7-day average" must also mean SEVEN DAYS ─────────────────────────────
//
// The same row-vs-day confusion runs through the app's headline weight: the
// "7-day avg" on Today/Trend, ProfileTab's current weight, and the weight that
// feeds every BMR formula are all `slice(-7)` — the last seven ROWS. Someone
// weighing 3×/week gets a "7-day average" spanning ~16 days, which at 1 lb/wk
// lags the truth by ~1.2 lb while the label promises 7 days.
//
// This is the correct primitive. It reports what it actually averaged
// (`count`, `fromDate`→`toDate`) and, when the window is EMPTY, falls back to
// the single most recent weigh-in and says so (`stale`, `staleDays`) rather
// than returning null and sending callers back to the start weight.
const TRAILING_AVG_DAYS = 7;

function trailingAverage(entries, valueOf = (e) => e.weightLb, { asOf = null, days = TRAILING_AVG_DAYS } = {}) {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && Number.isFinite(dayNum(e.date)) && Number.isFinite(valueOf(e)))
    .map((e) => ({ day: dayNum(e.date), v: valueOf(e), date: e.date }))
    .sort((a, b) => a.day - b.day);
  if (!rows.length) return null;
  const anchorDay = Number.isFinite(dayNum(asOf)) ? dayNum(asOf) : rows[rows.length - 1].day;
  const upto = rows.filter((r) => r.day <= anchorDay);
  if (!upto.length) return null;
  const firstDay = anchorDay - (days - 1);
  const inWindow = upto.filter((r) => r.day >= firstDay);
  const stale = inWindow.length === 0;
  const src = stale ? [upto[upto.length - 1]] : inWindow;
  const newest = upto[upto.length - 1];
  return {
    avg: src.reduce((s, r) => s + r.v, 0) / src.length,
    count: src.length,
    windowDays: days,
    fromDate: src[0].date,
    toDate: src[src.length - 1].date,
    staleDays: anchorDay - newest.day,
    stale,
  };
}

/**
 * Verdict bands derive from the user's CHOSEN rate — nobody's personal
 * 1.4–1.9 band. In-band = chosen ± max(0.25, 20%). Advisory only: the fix
 * for a wrong pace is the rate selector on the Profile tab, so there are no
 * one-tap target mutations here anymore.
 *
 * VOICE. These are the highest-emotion strings in the app and they render every
 * day on the dashboard, so they state a FACT, number first, cause second — not
 * a one-word ALL-CAPS grade. What they used to say and why it changed:
 *   · "SLOW" + "Check logging accuracy first" blamed the user before it helped;
 *     a slow week is far more often a real week than a dishonest one.
 *   · "BORDERLINE SLOW — HOLD 1 WK" is the compressed-code label style the
 *     owner has explicitly banned, and "adherence" is jargon that reads as an
 *     accusation of non-compliance.
 *   · The two slow branches carried tone "bad" — a moral word attached to body
 *     data. They are now "warn", which renders identically (getStampStyle maps
 *     both to calm amber, law b) without the payload calling a person bad.
 * The lean-mass caution on the too-fast branch stays: it is clinically right.
 */
function verdict({ rate, chosenRate, daysIn, atFloor }) {
  const r1 = (n) => Math.round(n * 10) / 10;
  const chosen = Number.isFinite(chosenRate) ? chosenRate : 1.0;
  if (daysIn < 10) {
    return { tone: "wait", tag: "Too early to tell", sub: "Early weigh-ins are mostly water moving, not fat. Keep logging — the first honest read on your pace lands around day 10." };
  }
  if (rate == null) {
    return { tone: "wait", tag: "Not enough weigh-ins yet", sub: `A pace needs at least ${TREND_MIN_POINTS} weigh-ins inside the last ${TREND_WINDOW_DAYS} days. Older weigh-ins still show on the trend chart — they just can't describe this fortnight.` };
  }
  const bandWidth = Math.max(0.25, chosen * 0.2);
  const lo = Math.round((chosen - bandWidth) * 100) / 100;
  const hi = Math.round((chosen + bandWidth) * 100) / 100;
  const band = { lo, hi };
  if (rate > hi + 0.4) {
    return { band, tone: "warn", tag: "Faster than planned", sub: `${r1(rate)} lb/wk against your ${r1(chosen)} lb/wk plan. Held at this pace, part of what comes off is lean mass rather than fat — Profile is where you slow it down.` };
  }
  if (rate > hi) {
    return { band, tone: "warn", tag: "A little faster than planned", sub: `${r1(rate)} lb/wk against your ${r1(chosen)} lb/wk plan. Fine for a week — worth another look at this time next week.` };
  }
  if (rate >= lo) {
    return { band, tone: "good", tag: "On target", sub: `${r1(rate)} lb/wk, inside your ${r1(lo)}–${r1(hi)} lb/wk band. Nothing to change.` };
  }
  if (rate >= lo - 0.15) {
    return { band, tone: "warn", tag: "Slightly slower than planned", sub: `${r1(rate)} lb/wk against your ${r1(chosen)} lb/wk plan. One week isn't a signal — if it repeats, Profile is where you change pace.` };
  }
  if (atFloor) {
    return { band, tone: "warn", tag: "Slower than planned, and at your calorie floor", sub: `${r1(rate)} lb/wk against your ${r1(chosen)} lb/wk plan, with intake already at your floor. The lever left is movement, not less food.` };
  }
  return { band, tone: "warn", tag: "Slower than planned", sub: `${r1(rate)} lb/wk against your ${r1(chosen)} lb/wk plan. Portion sizes drifting upward is the usual reason; if the number repeats next week, Profile is where you change pace.` };
}

module.exports = {
  kg2lb, mean, median, leanBodyMass,
  FORMULAS, FORMULA_KEYS, DEFAULT_ENABLED, isFormulaOn, bmrRows, computeEnergy,
  RATE_OPTIONS, SAFE_FLOOR, effectiveFloor, deriveTarget, rateSafety,
  computeMacros, trendRate, trendWindow, trailingAverage, verdict,
  TREND_WINDOW_DAYS, TREND_MIN_POINTS, TREND_MIN_SPAN_DAYS, TRAILING_AVG_DAYS,
  ASSUMED_BODY_FAT_PCT,
};
