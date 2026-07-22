// ── Adaptive expenditure estimator ───────────────────────────────────────
//
// WHAT THIS IS NOT: it is not "plug today's weight into a BMR formula". That
// is what the pre-existing weigh-in re-derivation did — a point substitution
// into a population equation, which can only ever return what the equation
// already believed. It cannot discover that a given person burns 400 kcal more
// than the formula says.
//
// WHAT THIS IS: an energy-balance reconciliation. Over a window,
//
//     intake − expenditure = ρ · (rate of change of body mass)
//  →  expenditure = mean logged intake − ρ · (weight-trend slope)
//
// The gap between what the model PREDICTED the scale would do and what the
// scale ACTUALLY did is the expenditure signal. Everything below exists to
// extract that signal from a noisy, incompletely-logged series honestly —
// and, when the data cannot support a claim, to say so instead of returning a
// confident-looking number.
//
// Three things make this hard, handled explicitly:
//   1. WEIGHT NOISE. Water, glycogen, sodium and gut content move body mass by
//      ±1–2 kg with no change in stored energy. Handled by robust (Huber)
//      exponentially-weighted least squares on the whole window, never by
//      differencing two endpoints, plus a residual-scale-driven standard error
//      so noisy series are automatically distrusted.
//   2. INCOMPLETE LOGGING. Unlogged days are NEVER treated as zero-kcal days.
//      They are excluded from the mean, counted, and charged as an explicit
//      bias-uncertainty term that grows as coverage falls.
//   3. TOO LITTLE DATA. Early windows genuinely cannot separate a 300 kcal
//      expenditure difference from a water swing. Hard gates return
//      status "insufficient"; past the gates, the estimate is shrunk toward
//      the formula prior in proportion to its own measured precision, so a
//      weak signal moves the target a little and a strong one moves it a lot.
//
// Pure module: no database, no clock (pass `asOf`), no user-specific defaults.
// Every returned number carries the inputs it came from — see `shownMath`.
const { dayNum } = require("./dates.js");

// ── constants (all exported: the methodology doc and the tests read them) ──

const LB_PER_KG = 2.20462;
const KCAL_PER_LB = 3500; // Wishnofsky; same constant bmrEngine uses for the rate→deficit conversion
const KCAL_PER_KG = KCAL_PER_LB * LB_PER_KG; // ρ ≈ 7716 kcal per kg of body-mass change

// ρ is an assumption about the COMPOSITION of the mass being gained/lost. Pure
// fat is ~9400 kcal/kg; mixed fat+lean loss is lower. 10% relative SD is a
// deliberate, documented admission that we do not know a given person's ρ.
const RHO_RELATIVE_SD = 0.10;

const WINDOW_MAX_DAYS = 56; // longest look-back; older data is dominated by the half-life anyway
const HALF_LIFE_DAYS = 21; // exponential weighting — recent days count more, so the estimate tracks real change

// Hard gates. Below any of these the answer is "insufficient", not a number.
// These are SET BY THE SELF-BENCHMARK, not by taste. At a 14-day window the
// estimator's median error was 289 kcal against a 350 kcal static baseline — a
// marginal win — and the replayed ledger showed it whipsawing a real target by
// +651 then −460 kcal in consecutive weeks. At 21 days it lands at 218 vs 348
// and the swings stop. A number that unstable is worse than no number, so 21
// days is the floor. (backend/scripts/benchmarkAdaptiveTdee.js reproduces both.)
const MIN_SPAN_DAYS = 21;
const MIN_WEIGHINS = 14;
const MIN_INTAKE_DAYS = 14;
const MIN_EFFECTIVE_COVERAGE = 0.6;
const MAX_STALE_DAYS = 10; // days since the last weigh-in

// Promotion from "provisional" to "confident" — the 28-day mark is where the
// benchmark's median error drops to ~155 kcal, the published-reference range.
const CONFIDENT_SPAN_DAYS = 28;
const CONFIDENT_WEIGHINS = 21;
const CONFIDENT_COVERAGE = 0.8;
const CONFIDENT_SE_KCAL = 250;

// Published static-formula performance: ~335 kcal MEDIAN absolute error. For a
// normal error distribution median|e| = 0.6745σ, so the implied SD of
// (true expenditure − formula TDEE) is 335/0.6745 ≈ 497 kcal. That is the
// prior width. Using the published number rather than inventing one keeps the
// shrinkage auditable.
const STATIC_FORMULA_MEDIAN_ERR_KCAL = 335;
const NORMAL_MEDIAN_ABS_FACTOR = 0.6745;
const PRIOR_SD_KCAL = Math.round(STATIC_FORMULA_MEDIAN_ERR_KCAL / NORMAL_MEDIAN_ABS_FACTOR); // 497

// A logged day below this fraction of the window's median logged intake is
// almost certainly a PARTIAL log (breakfast entered, rest forgotten), not a
// genuine fast. Counted as half a logged day rather than silently believed.
const PARTIAL_LOG_FRACTION = 0.5;

// 1-SD guess for how far an UNLOGGED day's intake sits from the logged mean.
// Charged as bias uncertainty scaled by the unlogged fraction.
const MISSING_DAY_BIAS_KCAL = 500;

// Anti-overconfidence rails.
const MIN_WEIGHT_SCALE_KG = 0.10; // no real bathroom scale + real body is quieter than this
const MIN_INTAKE_SCALE_KCAL = 50;
const MAX_DEVIATION_FRAC = 0.30; // the estimate may not claim the formula is more than 30% wrong

const HUBER_K = 1.345; // 95% efficiency at the normal, strong resistance to outliers
const IRLS_ITERATIONS = 4;

// Water/glycogen weight is not independent day to day — a salty Saturday is
// still on the scale on Sunday. Positively autocorrelated residuals mean the
// textbook regression SE is TOO NARROW, which the self-benchmark caught: the
// nominal 68% interval was covering only ~54% of cases. The lag-1
// autocorrelation φ is therefore estimated from the residuals themselves and
// the slope variance inflated by (1+φ)/(1−φ) — the standard AR(1) effective-
// sample-size correction — capped so a pathological φ cannot silently mute the
// estimator entirely.
const MAX_VARIANCE_INFLATION = 4;

// Irreducible model error. The linear energy-balance model is an approximation:
// ρ drifts as body composition changes, glycogen stores shift at the window
// boundaries, and adaptive thermogenesis moves expenditure WITHIN the window.
// None of that is captured by the four measurable terms, so a floor is added in
// quadrature. Without it the self-benchmark's nominal 68% interval covered only
// ~61% of cases; with it, ~65-71% at 28-56 days.
const MODEL_ERROR_KCAL = 75;

const VERSION = "adaptive-expenditure-1.0";

// ── small numeric helpers ────────────────────────────────────────────────

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Median absolute deviation → a normal-consistent scale estimate.
const madScale = (residuals) => {
  const m = median(residuals.map(Math.abs));
  return m == null ? null : 1.4826 * m;
};

const round = (n, dp = 0) => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * Robust, exponentially-weighted linear fit of y on x.
 *
 * Weight on observation i = 0.5^((refX − x_i)/halfLife) × huber(residual_i).
 * The exponential term makes the fit track genuine change (metabolic
 * adaptation, a new job) instead of averaging it away; the Huber term stops a
 * single sodium-loaded morning from tilting the whole line.
 *
 * SE(slope) uses the standard weighted-least-squares sandwich with the ROBUST
 * residual scale in place of the sample SD:
 *     slope = Σ cᵢyᵢ,  cᵢ = wᵢ(xᵢ − x̄_w)/Sxx  →  Var(slope) = σ²Σcᵢ²
 * Day-to-day water weight is positively autocorrelated, which would make that
 * SE too narrow, so the lag-1 autocorrelation is estimated from the residuals
 * and the variance inflated by (1+φ)/(1−φ) — see MAX_VARIANCE_INFLATION.
 * Remaining caveat: the converged Huber weights are treated as fixed, and the
 * self-benchmark shows the resulting band is still mildly optimistic at short
 * windows (documented in docs/adaptive-tdee-methodology.md §7).
 */
function robustWeightedFit(points, { refX, halfLife, minScale = 0 }) {
  const n = points.length;
  if (n < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const base = xs.map((x) => Math.pow(0.5, (refX - x) / halfLife));

  let w = base.slice();
  let slope = 0, xbar = 0, ybar = 0, scale = null, resid = null;

  for (let iter = 0; iter < IRLS_ITERATIONS; iter++) {
    const Sw = w.reduce((s, v) => s + v, 0);
    if (!(Sw > 0)) return null;
    xbar = xs.reduce((s, x, i) => s + w[i] * x, 0) / Sw;
    ybar = ys.reduce((s, y, i) => s + w[i] * y, 0) / Sw;
    let Sxx = 0, Sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xbar;
      Sxx += w[i] * dx * dx;
      Sxy += w[i] * dx * (ys[i] - ybar);
    }
    if (!(Sxx > 0)) return null; // every weigh-in on the same day — no slope exists
    slope = Sxy / Sxx;
    resid = ys.map((y, i) => y - (ybar + slope * (xs[i] - xbar)));
    scale = Math.max(madScale(resid) ?? 0, minScale);
    if (iter === IRLS_ITERATIONS - 1) break;
    if (!(scale > 0)) break; // a perfect fit needs no reweighting
    w = base.map((b, i) => {
      const r = Math.abs(resid[i]) / scale;
      return b * (r <= HUBER_K ? 1 : HUBER_K / r);
    });
  }

  const Sw = w.reduce((s, v) => s + v, 0);
  xbar = xs.reduce((s, x, i) => s + w[i] * x, 0) / Sw;
  let Sxx = 0, Sc2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xbar;
    Sxx += w[i] * dx * dx;
  }
  if (!(Sxx > 0)) return null;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xbar;
    Sc2 += (w[i] * dx / Sxx) ** 2;
  }
  const sumW2 = w.reduce((s, v) => s + v * v, 0);
  const nEff = sumW2 > 0 ? (Sw * Sw) / sumW2 : n;
  const effScale = Math.max(scale ?? 0, minScale);

  // AR(1) correction — see MAX_VARIANCE_INFLATION. φ is measured only on pairs
  // of CONSECUTIVE calendar days (a 5-day gap carries no meaningful lag-1
  // information), and only negative-free: anti-persistent residuals get no
  // credit, because that direction would make the estimator over-confident.
  const lag1 = lag1Autocorr(points.map((p) => p.x), resid || []);
  const phi = Math.max(0, Math.min(0.9, lag1 ?? 0));
  const varInflation = Math.min(MAX_VARIANCE_INFLATION, (1 + phi) / (1 - phi));

  const seSlope = effScale * Math.sqrt(Sc2) * Math.sqrt(varInflation);
  const outliers = resid ? resid.filter((r) => effScale > 0 && Math.abs(r) > HUBER_K * effScale).length : 0;

  // Fitted value at any x: ȳ_w is recomputed against the converged weights so
  // the reported trend line is the line the SE belongs to.
  const ybarW = ys.reduce((s, y, i) => s + w[i] * y, 0) / Sw;
  const at = (x) => ybarW + slope * (x - xbar);

  return { slope, seSlope, scale: effScale, nEff, outliers, at, xbar, lag1: phi, varInflation };
}

/** Lag-1 autocorrelation over consecutive-CALENDAR-DAY residual pairs only. */
function lag1Autocorr(xs, resid) {
  if (!resid.length) return null;
  const byDay = new Map();
  xs.forEach((x, i) => byDay.set(x, resid[i]));
  let num = 0, pairs = 0, sq = 0;
  for (const [x, r] of byDay) {
    sq += r * r;
    const next = byDay.get(x + 1);
    if (next !== undefined) { num += r * next; pairs++; }
  }
  if (pairs < 5 || sq <= 0) return null; // too few adjacent days to say anything
  const variance = sq / byDay.size;
  const lag1Cov = num / pairs;
  // Small-sample bias correction (Marriott-Pope/Kendall): the sample lag-1
  // autocorrelation is biased LOW by ~1/n, and biased-low φ means an
  // under-inflated — i.e. over-confident — standard error. Correct toward
  // caution rather than accept the optimistic estimate.
  return lag1Cov / variance + 1 / pairs;
}

/**
 * Exponentially-weighted, Huber-robust mean + the SE of that mean.
 * Robust because one mis-keyed 12,000 kcal entry must not become the week's
 * expenditure estimate. (Systematically incomplete days are caught earlier, by
 * the partial-log detector — this is the backstop for one-off junk.)
 */
function robustWeightedMean(points, { refX, halfLife, minScale = 0 }) {
  const n = points.length;
  if (!n) return null;
  const base = points.map((p) => Math.pow(0.5, (refX - p.x) / halfLife));
  let w = base.slice();
  let mean = 0, scale = 0;

  for (let iter = 0; iter < IRLS_ITERATIONS; iter++) {
    const Sw = w.reduce((s, v) => s + v, 0);
    if (!(Sw > 0)) return null;
    mean = points.reduce((s, p, i) => s + w[i] * p.y, 0) / Sw;
    const resid = points.map((p) => p.y - mean);
    scale = Math.max(madScale(resid) ?? 0, minScale);
    if (iter === IRLS_ITERATIONS - 1 || !(scale > 0)) break;
    w = base.map((b, i) => {
      const r = Math.abs(resid[i]) / scale;
      return b * (r <= HUBER_K ? 1 : HUBER_K / r);
    });
  }

  const Sw = w.reduce((s, v) => s + v, 0);
  const sumW2 = w.reduce((s, v) => s + v * v, 0);
  const nEff = (Sw * Sw) / sumW2;
  const se = scale * Math.sqrt(sumW2) / Sw;
  return { mean, se, scale, nEff };
}

// ── the estimator ────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {{date:string, weightKg:number}[]} input.weighins  any order
 * @param {{date:string, kcal:number}[]}     input.intake    ONE ROW PER DAY, already summed
 * @param {string} input.asOf        yyyy-mm-dd — the day the estimate is "as of"
 * @param {number} input.priorTdee   the formula TDEE (kcal/day)
 * @param {number} [input.priorSd]   prior width; defaults to PRIOR_SD_KCAL
 * @returns {object} always a full object — never throws on thin data; check `.status`
 */
function estimateExpenditure({ weighins = [], intake = [], asOf, priorTdee, priorSd = PRIOR_SD_KCAL, options = {} }) {
  const cfg = {
    windowMaxDays: WINDOW_MAX_DAYS,
    halfLifeDays: HALF_LIFE_DAYS,
    rhoKcalPerKg: KCAL_PER_KG,
    ...options,
  };
  const asOfDay = dayNum(asOf);
  const prior = Number.isFinite(priorTdee) ? priorTdee : null;

  const blocked = [];
  const notes = [];

  // ── window ──────────────────────────────────────────────────────────────
  const wAll = weighins
    .filter((w) => w && typeof w.date === "string" && Number.isFinite(w.weightKg))
    .map((w) => ({ x: dayNum(w.date), y: w.weightKg, date: w.date }))
    .filter((p) => p.x <= asOfDay)
    .sort((a, b) => a.x - b.x);
  const iAll = intake
    .filter((r) => r && typeof r.date === "string" && Number.isFinite(r.kcal) && r.kcal > 0)
    .map((r) => ({ x: dayNum(r.date), y: r.kcal, date: r.date }))
    .filter((p) => p.x <= asOfDay)
    .sort((a, b) => a.x - b.x);

  const earliest = Math.max(
    asOfDay - cfg.windowMaxDays + 1,
    wAll.length ? wAll[0].x : -Infinity,
    iAll.length ? iAll[0].x : -Infinity
  );
  const windowStartDay = Number.isFinite(earliest) ? earliest : asOfDay;
  const inWindow = (p) => p.x >= windowStartDay && p.x <= asOfDay;
  const wPts = wAll.filter(inWindow);
  const iPts = iAll.filter(inWindow);

  const spanDays = asOfDay - windowStartDay + 1;
  const lastWeighinDay = wPts.length ? wPts[wPts.length - 1].x : null;
  const staleDays = lastWeighinDay == null ? null : asOfDay - lastWeighinDay;

  // ── logging quality ─────────────────────────────────────────────────────
  // A day logged below half the window's typical intake is almost always a
  // PARTIAL log, not a genuine near-fast. Believing it would drag the intake
  // mean down and hand back a falsely LOW expenditure — the single most
  // dangerous failure mode this estimator has, because a low expenditure means
  // a low target. Such days are therefore treated as UNKNOWN: dropped from the
  // mean and counted as unlogged, which widens the error bar instead of
  // corrupting the point estimate.
  const loggedDays = new Set(iPts.map((p) => p.x)).size;
  const medLogged = median(iPts.map((p) => p.y));
  const isPartial = (p) => medLogged != null && p.y < PARTIAL_LOG_FRACTION * medLogged;
  const partialPts = iPts.filter(isPartial);
  const usableIntakePts = iPts.filter((p) => !isPartial(p));
  const partialDays = partialPts.length;
  const completeDays = Math.max(0, loggedDays - partialDays);
  const rawCoverage = spanDays > 0 ? loggedDays / spanDays : 0;
  const effectiveCoverage = spanDays > 0 ? Math.max(0, Math.min(1, completeDays / spanDays)) : 0;

  // ── gates ───────────────────────────────────────────────────────────────
  if (prior == null) blocked.push("no formula TDEE to reconcile against");
  if (spanDays < MIN_SPAN_DAYS) {
    blocked.push(`only ${spanDays} day${spanDays === 1 ? "" : "s"} of overlapping weight + intake data — needs ${MIN_SPAN_DAYS}`);
  }
  if (wPts.length < MIN_WEIGHINS) {
    blocked.push(`${wPts.length} weigh-in${wPts.length === 1 ? "" : "s"} in the window — needs ${MIN_WEIGHINS}`);
  }
  if (completeDays < MIN_INTAKE_DAYS) {
    blocked.push(`${completeDays} day${completeDays === 1 ? "" : "s"} of food logged — needs ${MIN_INTAKE_DAYS}`);
  }
  if (spanDays >= MIN_SPAN_DAYS && effectiveCoverage < MIN_EFFECTIVE_COVERAGE) {
    blocked.push(`food logged on ${Math.round(effectiveCoverage * 100)}% of the window — needs ${Math.round(MIN_EFFECTIVE_COVERAGE * 100)}%`);
  }
  if (staleDays != null && staleDays > MAX_STALE_DAYS) {
    blocked.push(`last weigh-in was ${staleDays} days ago — needs one within ${MAX_STALE_DAYS}`);
  }
  if (partialDays > 0) {
    notes.push(`${partialDays} day${partialDays === 1 ? "" : "s"} logged under half the window's typical intake — read as a part-logged day, dropped from the average rather than believed`);
  }

  // ── fits ────────────────────────────────────────────────────────────────
  const fit = wPts.length >= 3
    ? robustWeightedFit(wPts, { refX: asOfDay, halfLife: cfg.halfLifeDays, minScale: MIN_WEIGHT_SCALE_KG })
    : null;
  const intakeFit = usableIntakePts.length
    ? robustWeightedMean(usableIntakePts, { refX: asOfDay, halfLife: cfg.halfLifeDays, minScale: MIN_INTAKE_SCALE_KCAL })
    : null;

  if (wPts.length >= MIN_WEIGHINS && !fit) blocked.push("weigh-ins carry no time spread — a trend needs weigh-ins on different days");
  if (fit && fit.outliers > 0) {
    notes.push(`${fit.outliers} weigh-in${fit.outliers === 1 ? "" : "s"} sat far off the trend (water/sodium swing) — down-weighted, not deleted`);
  }

  const window = {
    startDate: null, endDate: asOf, spanDays,
    weighinCount: wPts.length,
    intakeDays: loggedDays,
    completeIntakeDays: completeDays,
    partialDays,
    rawCoveragePct: round(rawCoverage * 100, 0),
    effectiveCoveragePct: round(effectiveCoverage * 100, 0),
    staleDays,
  };
  if (wPts.length || iPts.length) {
    const startPt = [...wPts, ...iPts].reduce((m, p) => (p.x < m ? p.x : m), asOfDay);
    window.startDate = (wPts.find((p) => p.x === startPt) || iPts.find((p) => p.x === startPt) || {}).date || null;
  }

  const insufficient = (extra = {}) => ({
    version: VERSION,
    status: "insufficient",
    applied: false,
    reasons: blocked,
    notes,
    window,
    prior: { tdeeKcal: prior == null ? null : round(prior), sdKcal: round(priorSd) },
    intake: intakeFit
      ? { meanKcal: round(intakeFit.mean), seKcal: round(intakeFit.se), daySdKcal: round(intakeFit.scale), nEff: round(intakeFit.nEff, 1) }
      : null,
    weight: fit
      ? {
        slopeKgPerDay: round(fit.slope, 5),
        slopeLbPerWeek: round(-fit.slope * LB_PER_KG * 7, 2),
        seSlopeKgPerDay: round(fit.seSlope, 5),
        residualSdKg: round(fit.scale, 3),
        trendStartKg: round(fit.at(windowStartDay), 2),
        trendEndKg: round(fit.at(asOfDay), 2),
        nEff: round(fit.nEff, 1),
        lag1Autocorr: round(fit.lag1, 2),
        varianceInflation: round(fit.varInflation, 2),
      }
      : null,
    reconciliation: null,
    estimate: null,
    method: methodBlock(cfg, priorSd),
    ...extra,
  });

  if (blocked.length || !fit || !intakeFit) {
    if (!blocked.length) blocked.push("not enough data to fit a weight trend and an intake mean");
    return insufficient();
  }

  // ── reconciliation: predicted vs actual ─────────────────────────────────
  const rho = cfg.rhoKcalPerKg;
  const intakeMean = intakeFit.mean;

  // What the FORMULA said should have happened over this window.
  const predictedSlopeKgPerDay = (intakeMean - prior) / rho;
  const predictedDeltaKg = predictedSlopeKgPerDay * (spanDays - 1);
  // What the SCALE actually did (trend line, not raw endpoints).
  const observedSlopeKgPerDay = fit.slope;
  const observedDeltaKg = observedSlopeKgPerDay * (spanDays - 1);
  const gapKg = observedDeltaKg - predictedDeltaKg;
  // The whole point: that gap, expressed as kcal/day, IS the correction.
  const gapKcalPerDay = -(observedSlopeKgPerDay - predictedSlopeKgPerDay) * rho;

  // Direct estimate from energy balance.
  const dataKcal = intakeMean - rho * observedSlopeKgPerDay;

  // Uncertainty budget — four independent contributions, added in quadrature.
  const seFromWeight = rho * fit.seSlope;
  const seFromIntake = intakeFit.se;
  const seFromMissing = MISSING_DAY_BIAS_KCAL * (1 - effectiveCoverage);
  const seFromRho = RHO_RELATIVE_SD * rho * Math.abs(observedSlopeKgPerDay);
  const dataSe = Math.sqrt(seFromWeight ** 2 + seFromIntake ** 2 + seFromMissing ** 2 + seFromRho ** 2 + MODEL_ERROR_KCAL ** 2);

  // ── shrink toward the formula prior by measured precision ───────────────
  const precPrior = 1 / (priorSd * priorSd);
  const precData = 1 / (dataSe * dataSe);
  const posterior = (prior * precPrior + dataKcal * precData) / (precPrior + precData);
  const posteriorSe = Math.sqrt(1 / (precPrior + precData));
  const dataWeight = precData / (precPrior + precData);

  // Rail: the estimator may not claim the formula is wildly wrong. A >30%
  // deviation is far more likely to be a broken scale or a broken food log.
  const lo = prior * (1 - MAX_DEVIATION_FRAC);
  const hi = prior * (1 + MAX_DEVIATION_FRAC);
  const clamped = posterior < lo || posterior > hi;
  const expenditure = Math.min(hi, Math.max(lo, posterior));
  if (clamped) {
    notes.push(`estimate pinned to ±${Math.round(MAX_DEVIATION_FRAC * 100)}% of the formula TDEE — a bigger gap than that usually means a logging or scale problem, not a metabolism problem`);
  }

  const isConfident =
    spanDays >= CONFIDENT_SPAN_DAYS &&
    wPts.length >= CONFIDENT_WEIGHINS &&
    effectiveCoverage >= CONFIDENT_COVERAGE &&
    dataSe <= CONFIDENT_SE_KCAL;
  const status = isConfident ? "confident" : "provisional";
  if (!isConfident) {
    notes.push("provisional — the data supports a direction, not a precise number; the estimate stays pulled toward the formula until the window widens");
  }

  return {
    version: VERSION,
    status,
    applied: true,
    reasons: [],
    notes,
    window,
    prior: { tdeeKcal: round(prior), sdKcal: round(priorSd) },
    intake: {
      meanKcal: round(intakeMean),
      seKcal: round(intakeFit.se),
      daySdKcal: round(intakeFit.scale),
      nEff: round(intakeFit.nEff, 1),
    },
    weight: {
      slopeKgPerDay: round(observedSlopeKgPerDay, 5),
      slopeLbPerWeek: round(-observedSlopeKgPerDay * LB_PER_KG * 7, 2),
      seSlopeKgPerDay: round(fit.seSlope, 5),
      residualSdKg: round(fit.scale, 3),
      trendStartKg: round(fit.at(windowStartDay), 2),
      trendEndKg: round(fit.at(asOfDay), 2),
      nEff: round(fit.nEff, 1),
      lag1Autocorr: round(fit.lag1, 2),
      varianceInflation: round(fit.varInflation, 2),
    },
    reconciliation: {
      formulaTdeeKcal: round(prior),
      meanIntakeKcal: round(intakeMean),
      predictedSlopeKgPerDay: round(predictedSlopeKgPerDay, 5),
      predictedDeltaKg: round(predictedDeltaKg, 2),
      predictedDeltaLb: round(predictedDeltaKg * LB_PER_KG, 2),
      observedDeltaKg: round(observedDeltaKg, 2),
      observedDeltaLb: round(observedDeltaKg * LB_PER_KG, 2),
      gapKg: round(gapKg, 2),
      gapLb: round(gapKg * LB_PER_KG, 2),
      gapKcalPerDay: round(gapKcalPerDay),
    },
    estimate: {
      dataKcal: round(dataKcal),
      dataSeKcal: round(dataSe),
      seBudget: {
        weightTrendKcal: round(seFromWeight),
        intakeMeanKcal: round(seFromIntake),
        unloggedDaysKcal: round(seFromMissing),
        tissueCompositionKcal: round(seFromRho),
        modelErrorKcal: MODEL_ERROR_KCAL,
      },
      priorKcal: round(prior),
      priorSdKcal: round(priorSd),
      dataWeightPct: round(dataWeight * 100),
      expenditureKcal: Math.round(expenditure),
      seKcal: round(posteriorSe),
      ci68: [Math.round(expenditure - posteriorSe), Math.round(expenditure + posteriorSe)],
      deltaVsFormulaKcal: Math.round(expenditure - prior),
      clamped,
    },
    method: methodBlock(cfg, priorSd),
  };
}

function methodBlock(cfg, priorSd) {
  return {
    version: VERSION,
    rhoKcalPerKg: round(cfg.rhoKcalPerKg),
    rhoRelativeSd: RHO_RELATIVE_SD,
    halfLifeDays: cfg.halfLifeDays,
    windowMaxDays: cfg.windowMaxDays,
    priorSdKcal: round(priorSd),
    maxDeviationPct: Math.round(MAX_DEVIATION_FRAC * 100),
    gates: {
      minSpanDays: MIN_SPAN_DAYS,
      minWeighins: MIN_WEIGHINS,
      minIntakeDays: MIN_INTAKE_DAYS,
      minCoveragePct: Math.round(MIN_EFFECTIVE_COVERAGE * 100),
      maxStaleDays: MAX_STALE_DAYS,
    },
    doc: "docs/adaptive-tdee-methodology.md",
  };
}

module.exports = {
  estimateExpenditure,
  robustWeightedFit,
  robustWeightedMean,
  median,
  madScale,
  LB_PER_KG, KCAL_PER_LB, KCAL_PER_KG, RHO_RELATIVE_SD,
  WINDOW_MAX_DAYS, HALF_LIFE_DAYS,
  MIN_SPAN_DAYS, MIN_WEIGHINS, MIN_INTAKE_DAYS, MIN_EFFECTIVE_COVERAGE, MAX_STALE_DAYS,
  CONFIDENT_SPAN_DAYS, CONFIDENT_WEIGHINS, CONFIDENT_COVERAGE, CONFIDENT_SE_KCAL,
  PRIOR_SD_KCAL, STATIC_FORMULA_MEDIAN_ERR_KCAL,
  PARTIAL_LOG_FRACTION, MISSING_DAY_BIAS_KCAL,
  MIN_WEIGHT_SCALE_KG, MIN_INTAKE_SCALE_KCAL, MAX_DEVIATION_FRAC, MAX_VARIANCE_INFLATION, MODEL_ERROR_KCAL,
  lag1Autocorr,
  VERSION,
};
