import { useState, useEffect, useMemo, useId } from "react";
import { WeightTrendChart } from "./charts/weight-trend-chart.jsx";
import { LineChart, Dumbbell, ArrowRight, Table2, ChevronUp } from "lucide-react";
import { C } from "../lib/theme.js";
import { todayStr, addDays, fmtDY, fmtD, dayNum } from "../lib/dates.js";
import { displayRate, weightUnit, rateUnit, kg2lb } from "../lib/units.js";
import { TRAINING } from "../lib/flags.js";
import { api, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";
import { Card, Stat, PageHead, EmptyNote } from "./ui/Parts.jsx";

const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// Storage is kg; the chart does its arithmetic in the DISPLAY unit. This is
// deliberately NOT units.displayWeight — that helper rounds to 1 dp, which is
// right for a printed number and wrong for a slope, a fitted value or an axis
// bound (rounding every point to 0.1 lb before fitting a line through them
// quantises the very quantity the chart exists to show).
const convKg = (kg, pref) => (kg == null || !Number.isFinite(kg) ? null : pref === "metric" ? kg : kg2lb(kg));

// Epoch-day number → calendar date string, through the audited helper. The
// x-axis is a NUMBER (see below), so every tick has to travel back the other
// way to be labelled.
const dayToDate = (n) => addDays("1970-01-01", Math.round(n));

// The chart's "7-day average" window, in DAYS. Mirrors bmrEngine's
// TRAILING_AVG_DAYS / trailingAverage() semantics: seven calendar days, not
// seven rows. See the comment on `rows` below for why that distinction is the
// whole point.
const AVG_DAYS = 7;

// Above this many weigh-ins the per-point dots stop being data and start being
// a solid smear, so they turn off and the line carries the series. The endpoint
// stays marked either way (label the endpoint, not every point).
const DOT_LIMIT = 60;

const median = (sorted) =>
  !sorted.length ? null
    : sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

// Recomposition integration: a light, read-only pointer to the training
// scaffold. Protein-priority mode defends the floor; this is the honest
// reminder that the floor is one of two levers, not the whole story. Never
// fetches/renders when the flag hides the feature entirely.
function TrainingNudge({ openTraining }) {
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none, object = active plan
  const [loadError, setLoadError] = useState(null); // never collapsed into "no plan"
  const abort = useAbortSignal();
  useEffect(() => {
    if (TRAINING === "hidden") return;
    // frontend-arch-4: this used to `.catch(() => setPlan(null))`, so a failed
    // fetch rendered the "No training plan yet" copy — telling a user with an
    // active plan that they have none. A failure now says it failed.
    api.getTrainingPlan({ signal: abort.signal })
      .then((p) => { setPlan(p); setLoadError(null); })
      .catch((e) => {
        if (isAbortError(e)) return;
        setLoadError(describeError(e, "Couldn't load your training plan."));
        setPlan(null);
      });
  }, [abort]);
  if (TRAINING === "hidden" || (plan === undefined && !loadError)) return null;

  const clickable = TRAINING === "on";
  return (
    <Card section="RECOMP" title="The other lever">
      <div className="flex items-start gap-2.5">
        <Dumbbell size={16} style={{ color: C.faint }} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          {loadError ? (
            <div className="text-sm font-semibold" style={{ color: C.warn }}>
              Couldn't check your training plan — {loadError} This says nothing about whether you have one.
            </div>
          ) : plan ? (
            <div className="text-sm font-semibold" style={{ color: C.ink }}>
              {plan.style} training active, {plan.daysPerWeek}x/week. Protein alone slows lean-mass loss — resistance training is what actually signals the body to keep it.
            </div>
          ) : (
            <div className="text-sm font-semibold" style={{ color: C.ink }}>
              No training plan yet. Protein-priority mode defends the floor, but without a training stimulus the body has less reason to hold onto the muscle it's fed.
            </div>
          )}
          {clickable && !loadError && (
            <button onClick={openTraining} className="text-xs font-bold flex items-center gap-1 mt-2 hover:opacity-80" style={{ color: C.ink }}>
              {plan ? "View training plan" : "Generate a training plan"} <ArrowRight size={12} aria-hidden="true" />
            </button>
          )}
          {clickable && loadError && (
            <button onClick={openTraining} className="text-xs font-bold flex items-center gap-1 mt-2 hover:opacity-80" style={{ color: C.ink }}>
              Open the Training tab <ArrowRight size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── legend ────────────────────────────────────────────────────────────────
// A legend is present because the chart carries 2+ series, and it is TEXT
// beside a drawn sample of the mark — never a colour the reader has to match
// from memory. It replaces the old prose caption ("thin = daily weight · heavy
// = 7-day average · dashed grey = goal"), which asked the reader to decode two
// separate DASHED lines that differed only in ink tier.
function LegendKey({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 list-none p-0 m-0">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <svg width="18" height="10" aria-hidden="true" className="shrink-0">
            {it.kind === "dot" ? (
              <>
                <line x1="0" y1="5" x2="18" y2="5" stroke={it.color} strokeWidth={1.5} />
                <circle cx="9" cy="5" r="2.5" fill={it.color} />
              </>
            ) : (
              <line x1="0" y1="5" x2="18" y2="5" stroke={it.color} strokeWidth={it.width || 2}
                strokeDasharray={it.dash} strokeLinecap="round" />
            )}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

// ── tooltip ───────────────────────────────────────────────────────────────
// Written by hand rather than configured, because the default one would print
// the uncertainty band as a raw "[177.2, 179.4]" tuple and label every series
// by its data key. Hover is an ENHANCEMENT here, not the only way to read a
// value — the table view below the chart carries every number for keyboard and
// screen-reader users.
function ChartTip({ active, payload, wUnit, avgDays }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const line = (label, val, extra) =>
    val == null ? null : (
      <div key={label} className="flex justify-between gap-4">
        <span style={{ color: C.faint }}>{label}</span>
        <span className="mono font-bold" style={{ color: C.ink }}>{r1(val)} {wUnit}{extra}</span>
      </div>
    );
  return (
    <div className="text-xs font-semibold rounded-xl px-3 py-2 space-y-0.5"
      style={{ background: C.card2, border: `1px solid ${C.rule}`, minWidth: 190 }}>
      <div className="font-bold mb-1" style={{ color: C.ink }}>{fmtDY(row.date)}</div>
      {line("Weighed", row.w)}
      {line(`Average of ${avgDays} days`, row.avg, row.avgCount ? ` · ${row.avgCount} weigh-in${row.avgCount === 1 ? "" : "s"}` : "")}
      {line("Trend", row.fit)}
      {line("Lean mass (est.)", row.lean)}
    </div>
  );
}

export default function TrendTab({ profile, summary, openTraining }) {
  const pref = profile.unitPref;
  const wUnit = weightUnit(pref);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const startW = convKg(profile.startWeightKg, pref);
  const goalW = convKg(profile.goalWeightKg, pref);
  const bfFrac = profile.bodyFatPct > 0 ? profile.bodyFatPct / 100 : null;

  // ── the series ───────────────────────────────────────────────────────────
  // Memoised. This used to be built inline in the render body, which meant the
  // `useMemo` on the chart data took a brand-new array identity every single
  // render and never once hit its cache.
  const series = useMemo(() => (
    [...(summary.weighins || [])]
      .filter((e) => e && typeof e.date === "string" && Number.isFinite(e.weightKg) && Number.isFinite(dayNum(e.date)))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ date: e.date, x: dayNum(e.date), w: convKg(e.weightKg, pref) }))
  ), [summary.weighins, pref]);

  // ── outliers ─────────────────────────────────────────────────────────────
  // One fat-fingered 250 kg entry passes the backend's 35–300 guard and, on a
  // y-domain built from raw min/max, squashes a real 200 lb curve into a 4 lb
  // band at the floor of the chart — while the backend runs Huber IRLS on the
  // very same rows. Median + MAD (the same robust scale the estimator uses)
  // identifies them. They are excluded from the DOMAIN and from the trailing
  // AVERAGE — leaving them in the average is how a typo silently moves the
  // headline number, the lean-mass line and the projection all at once — and
  // they are named out loud beneath the chart and kept in the table. Nothing is
  // deleted or hidden; it is disclosed.
  //
  // The extra 12 %-of-median condition keeps a genuine water swing — which can
  // easily exceed 6 MADs on a tight series — from being called an outlier;
  // nothing short of a mis-keyed entry moves body weight 12 %.
  const outliers = useMemo(() => {
    if (series.length < 4) return new Set();
    const ws = series.map((r) => r.w).sort((a, b) => a - b);
    const med = median(ws);
    const mad = 1.4826 * median(series.map((r) => Math.abs(r.w - med)).sort((a, b) => a - b));
    const cut = Math.max(6 * mad, 0.12 * Math.abs(med));
    if (!(cut > 0)) return new Set();
    return new Set(series.filter((r) => Math.abs(r.w - med) > cut).map((r) => r.date));
  }, [series]);

  // ── "7-day average" that actually means SEVEN DAYS ───────────────────────
  // This was `sorted.slice(i - 6, i + 1)` — the last seven ROWS. Someone
  // weighing three times a week got a "7-day average" spanning about sixteen
  // days, which at 1 lb/wk lags the truth by ~1.2 lb while the label promises
  // seven. Same definition as bmrEngine.trailingAverage(): a calendar window,
  // and it reports how many weigh-ins actually fell inside it so a sparse
  // weigher can see that the average is thin rather than being told a number.
  const rows = useMemo(() => series.map((e, i) => {
    const firstDay = e.x - (AVG_DAYS - 1);
    let sum = 0, n = 0, skipped = 0;
    for (let j = i; j >= 0 && series[j].x >= firstDay; j--) {
      if (outliers.has(series[j].date)) { skipped++; continue; }
      sum += series[j].w; n++;
    }
    // A window containing NOTHING but an outlier still has to report something
    // — fall back to the raw reading rather than dividing by zero.
    return n > 0
      ? { ...e, avg: sum / n, avgCount: n, avgSkipped: skipped }
      : { ...e, avg: e.w, avgCount: 1, avgSkipped: skipped };
  }), [series, outliers]);

  const lastRow = rows.length ? rows[rows.length - 1] : null;
  // The headline average is the DAY-windowed one, not summary.avg7Kg — the
  // server's field is still the last seven rows.
  const avg7 = lastRow ? lastRow.avg : null;
  const leanNow = bfFrac != null && avg7 != null ? avg7 * (1 - bfFrac) : null;
  const staleDays = lastRow ? dayNum(todayStr()) - lastRow.x : null;

  // ── the honest trend line ────────────────────────────────────────────────
  // expenditureEstimator.robustWeightedFit() already computes a Huber-robust,
  // exponentially-weighted, AR(1)-corrected fit of weight on time, WITH a real
  // standard error on the slope, and /weighins/summary ships it on every load
  // from three weigh-ins onward. The chart used to ignore all of it and draw a
  // naive moving average instead. It is the heavy line now. Its window is the
  // estimator's own (at most the last 56 days), so it is drawn over exactly
  // that span and no further — a fit is not evidence about data it never saw.
  const fit = useMemo(() => {
    const w = summary.adaptive?.weight;
    if (!w || !Number.isFinite(w.slopeKgPerDay) || !Number.isFinite(w.trendEndKg) || !rows.length) return null;
    const endX = dayNum(summary.adaptive?.window?.endDate || todayStr());
    if (!Number.isFinite(endX)) return null;
    const rawStart = dayNum(summary.adaptive?.window?.startDate);
    const startX = Math.max(series[0].x, Number.isFinite(rawStart) ? rawStart : endX - 55);
    if (!(endX > startX)) return null;
    const slope = convKg(w.slopeKgPerDay, pref);      // display units per day (negative = losing)
    const endVal = convKg(w.trendEndKg, pref);
    const se = Number.isFinite(w.seSlopeKgPerDay) ? Math.abs(convKg(w.seSlopeKgPerDay, pref)) : null;
    // The fit is computed "as of today", but it is only DRAWN as far as the
    // last weigh-in. Otherwise someone who logged three times in January and
    // then stopped gets a trend line ruled confidently across six months of
    // nothing — a fit is not evidence about days it never saw, and the stale
    // gap is stated in words below instead.
    const drawEndX = Math.min(endX, series[series.length - 1].x);
    if (!(drawEndX > startX)) return null; // nothing left to draw it over
    // Sanity rail. Every number above comes off the wire, and the heavy line is
    // the one thing on this screen a user will read a decision off. A robust,
    // smoothed fit cannot legitimately land 8 lb (or 6 % of body weight) away
    // from the smoothed weight at the same date; if it does, something upstream
    // is stale or mismatched, and the honest move is to fall back to the
    // average and say so rather than draw a confident wrong line. The reference
    // is the OUTLIER-EXCLUDED average, not the last raw reading — otherwise a
    // mis-keyed final weigh-in would disqualify the one line on the chart that
    // is already immune to it.
    const ref = rows[rows.length - 1].avg;
    const drawn = endVal + slope * (drawEndX - endX);
    if (Math.abs(drawn - ref) > Math.max(8, 0.06 * Math.abs(ref))) return null;
    return {
      startX, endX, drawEndX, slope, se, endVal,
      midX: (startX + endX) / 2,
      at: (x) => endVal + slope * (x - endX),
      lbPerWeek: w.slopeLbPerWeek,
      nEff: w.nEff,
      residualSd: convKg(w.residualSdKg, pref),
    };
  }, [summary.adaptive, series, rows, pref]);

  // ── chart rows ───────────────────────────────────────────────────────────
  // Lean mass is derived from the SMOOTHED series, not from each raw weigh-in.
  // `e.w * (1 - bfFrac)` inherited ~78 % of daily water noise, so the line
  // visibly dropped a pound and a half overnight — physiologically impossible,
  // and precisely the number this card exists to reassure someone about.
  const chart = useMemo(() => rows.map((r) => {
    const inFit = fit && r.x >= fit.startX && r.x <= fit.drawEndX;
    const f = inFit ? fit.at(r.x) : null;
    // The cone of the fitted slope: ±1 SE, hinged at the middle of the
    // window where the fit is most certain and widening toward both ends.
    const half = inFit && fit.se != null ? fit.se * Math.abs(r.x - fit.midX) : null;
    return {
      x: r.x, date: r.date, w: r.w, avg: r.avg, avgCount: r.avgCount,
      fit: f,
      band: f != null && half != null ? [f - half, f + half] : null,
      lean: bfFrac != null ? r.avg * (1 - bfFrac) : null,
    };
  }), [rows, fit, bfFrac]);

  // ── y domain ─────────────────────────────────────────────────────────────
  // Built from the robust core plus every line actually drawn. The old version
  // put goalW in yMin but NOT in yMax, so a goal above the highest logged
  // weight (a bulk, a reverse diet, a maintenance goal set after a rebound)
  // silently clipped its own reference line off the top of the chart.
  const yDomain = useMemo(() => {
    const vals = [];
    for (const r of rows) {
      if (outliers.has(r.date)) continue;
      vals.push(r.w);
      if (bfFrac != null) vals.push(r.avg * (1 - bfFrac));
    }
    if (fit) vals.push(fit.at(fit.startX), fit.at(fit.drawEndX));
    if (!vals.length) vals.push(goalW ?? 0);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // Every weigh-in identical → a zero-height plot. Give it real air.
    if (!(hi - lo > 0.5)) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
    const span = hi - lo;
    // How far out of the plotted range the goal may pull the domain. The span
    // term alone is not enough: after two weeks of a reverse diet the span is
    // ~1 lb, so 1.5 × span would exclude a goal 14 lb up — reproducing, with a
    // better excuse, the exact clipping this is here to fix. A goal within
    // ~10 % of body weight is an ordinary cut or gain and gets drawn; a goal
    // 100 lb away would flatten a month of real movement into a few pixels, so
    // it is left off the plot and reported in words under the chart instead —
    // never silently dropped, which is what the old yMax did.
    const anchor = Math.abs(avg7 ?? goalW ?? 0);
    const allow = Math.max(1.5 * span, 0.10 * anchor);
    const goalInView = Number.isFinite(goalW) && goalW >= lo - allow && goalW <= hi + allow;
    if (goalInView) { lo = Math.min(lo, goalW); hi = Math.max(hi, goalW); }
    if (leanNow != null && leanNow >= lo - allow && leanNow <= hi + allow) lo = Math.min(lo, leanNow);
    const pad = Math.max(1, (hi - lo) * 0.08);
    return { lo: Math.floor(lo - pad), hi: Math.ceil(hi + pad), goalInView };
  }, [rows, outliers, fit, bfFrac, goalW, leanNow, avg7]);

  // ── x domain + ticks ─────────────────────────────────────────────────────
  // The axis is `type="number"` over epoch-day numbers. It used to be
  // categorical (`dataKey="d"` with no type, which Recharts defaults to
  // "category"), so every weigh-in was drawn at the same horizontal spacing no
  // matter how far apart in time it was. A Friday→Monday step — three days,
  // the ordinary weekend-rebound shape — occupied the same width as a one-day
  // step and therefore read as a slope three times steeper than reality; a
  // three-month break rendered as a single step; and `fmtD` prints no year, so
  // a year-long gap was invisible. On a chart whose only job is rate of
  // change, the slope IS the message.
  const xAxis = useMemo(() => {
    if (!chart.length) return null;
    const lo = chart[0].x, hi = chart[chart.length - 1].x;
    const span = Math.max(1, hi - lo);
    const n = Math.min(7, Math.max(2, Math.round(span / 7) + 1));
    const ticks = [...new Set(Array.from({ length: n }, (_, i) => Math.round(lo + (span * i) / (n - 1))))];
    const withYear = span > 300 || dayToDate(lo).slice(0, 4) !== dayToDate(hi).slice(0, 4);
    return { lo, hi: lo === hi ? hi + 1 : hi, ticks, fmt: (x) => (withYear ? fmtDY : fmtD)(dayToDate(x)) };
  }, [chart]);

  const showDots = rows.length <= DOT_LIMIT;
  const outlierRows = rows.filter((r) => outliers.has(r.date));

  // ── projection ───────────────────────────────────────────────────────────
  // A single hard date, extrapolated from a 14-row OLS and potentially a year
  // out, on a screen whose neighbour card publishes a five-term uncertainty
  // budget in quadrature. It is a cone now: the same fit's slope ± its own
  // standard error, so the answer is a window with an honest middle. The
  // planned-rate fallback is still labelled as a plan, never a measurement.
  const chosenDisplayRate = displayRate(profile.rateLbPerWeek, pref);
  const proj = useMemo(() => {
    const from = todayStr();
    if (!Number.isFinite(goalW)) return null;
    // Direction-agnostic. The old arithmetic assumed a cut in both the guard
    // (`current > goalW`) and the sign, so a user whose goal is ABOVE their
    // current weight — a reverse diet, a gaining phase, a maintenance goal set
    // after a cut — was told "You're at or past your goal weight" on day one.
    const build = (current, ratePerWeek, sePerWeek) => {
      const toGo = current - goalW;                       // >0 = weight to lose
      const atGoal = Math.abs(toGo) < 0.5;
      const towardGoal = toGo > 0 ? ratePerWeek : -ratePerWeek; // >0 = heading to the goal
      const dateAt = (r) => {
        if (atGoal || !(r > 0)) return null;
        const days = (Math.abs(toGo) / r) * 7;
        return days > 3650 ? null : addDays(from, days);
      };
      return {
        toGo, atGoal,
        direction: toGo > 0 ? "down" : "up",
        rate: Math.abs(ratePerWeek),
        movingAway: !atGoal && !(towardGoal > 0),
        mid: dateAt(towardGoal),
        fast: sePerWeek == null ? null : dateAt(towardGoal + sePerWeek),
        slow: sePerWeek == null ? null : dateAt(towardGoal - sePerWeek),
        slowStalls: sePerWeek != null && !(towardGoal - sePerWeek > 0),
      };
    };
    if (fit && fit.se != null) {
      // Start from the trend at the LAST WEIGH-IN, not at fit.endX. The
      // estimator's window always ends "as of today" (expenditureEstimator sets
      // window.endDate = asOf), so fit.at(fit.endX) is the line extrapolated
      // forward across however many days have passed since the user last stood
      // on the scale. Someone who logged three weeks ago while losing 0.5 kg/wk
      // was silently credited with 1.5 kg they never weighed, pulling the goal
      // date three weeks early — while the Numbers card beside this one says
      // "every number here describes that day, not today" and the chart refuses
      // to DRAW the line past drawEndX for exactly this reason. Same rule for
      // the projection: a fit is not evidence about days it never saw.
      return { kind: "measured", ...build(fit.at(fit.drawEndX), -fit.slope * 7, fit.se * 7) };
    }
    if (avg7 == null) return null;
    return { kind: "planned", ...build(avg7, chosenDisplayRate, null) };
  }, [fit, avg7, goalW, chosenDisplayRate]);

  // ── numbers card ─────────────────────────────────────────────────────────
  const lbmAtStart = bfFrac != null && startW != null ? startW * (1 - bfFrac) : null;
  const estBf = avg7 != null && lbmAtStart != null ? ((avg7 - lbmAtStart) / avg7) * 100 : null;
  const lost = avg7 != null && startW != null ? startW - avg7 : null;
  const shownRate = fit ? -fit.slope * 7 : (summary.rate != null ? displayRate(summary.rate, pref) : null);

  const legend = [
    { label: "Each weigh-in", color: "var(--muted-foreground)", kind: "dot", width: 1.5 },
    fit
      ? { label: "Trend line, with its ±1 standard-error band", color: "var(--chart-1)", width: 2.5 }
      : { label: `Average of the last ${AVG_DAYS} days`, color: "var(--chart-1)", width: 2.5 },
    bfFrac != null && { label: "Lean mass (estimated)", color: "var(--chart-2)", width: 2 },
    yDomain.goalInView && { label: `Goal ${r1(goalW)} ${wUnit}`, color: "var(--muted-foreground)", width: 1.5, dash: "6 4" },
  ].filter(Boolean);

  const a11ySummary = rows.length >= 2
    ? `Weight trend, ${rows.length} weigh-ins from ${fmtDY(rows[0].date)} to ${fmtDY(lastRow.date)}. `
      + `Started ${r1(rows[0].w)} ${wUnit}, most recently ${r1(lastRow.w)} ${wUnit}. `
      + `Average of the last ${AVG_DAYS} days ${r1(avg7)} ${wUnit}. `
      + (fit ? `Trend line ${r1(Math.abs(fit.slope * 7))} ${wUnit} per week ${fit.slope < 0 ? "down" : "up"}. ` : "")
      + `Goal ${r1(goalW)} ${wUnit}.`
      + (bfFrac != null ? ` Estimated lean mass ${r1(leanNow)} ${wUnit}, derived from a single body-fat reading, not a measured trend.` : "")
      + " The same figures are in the table below the chart."
    : "";

  return (
    <div>
      <PageHead title="Trend" sub="Scale weight and estimated lean mass — recomposition means what's LOST matters as much as how much." />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Card section="CURVE" title={`Weight (${wUnit})`} className="xl:col-span-8">
          {rows.length === 0 ? (
            <EmptyNote icon={LineChart} height={380} title="No weigh-ins yet"
              hint="Log your first weight on the Today tab to start the curve." />
          ) : rows.length < 2 ? (
            <EmptyNote icon={LineChart} height={380} title="First point logged"
              hint="The curve starts with your second weigh-in — log again tomorrow. Verdicts and projections firm up after ~10 days of data." />
          ) : (
            <>
              {/* a11y: role="img" carries a one-sentence reading of the whole
                  graphic and the chart itself is hidden from AT underneath —
                  but a summary is not the data. The TABLE below is: every
                  intermediate value, reachable by keyboard, which the
                  mouse-only Recharts tooltip never was. */}
              <div role="img" aria-label={a11ySummary} style={{ width: "100%", height: 380 }}>
                <div aria-hidden="true" style={{ width: "100%", height: "100%" }}>
                  <WeightTrendChart
                    data={chart} xAxis={xAxis} yDomain={yDomain} fit={fit}
                    goalW={goalW} leanNow={leanNow} bfFrac={bfFrac} showDots={showDots}
                    tooltip={<ChartTip wUnit={wUnit} avgDays={AVG_DAYS} />}
                  />
                </div>
              </div>

              <LegendKey items={legend} />

              <div className="text-[11px] font-semibold mt-2 leading-relaxed" style={{ color: C.faint }}>
                {fit ? (
                  <>
                    The heavy line is the same fit the Engine runs on: a Huber-robust, exponentially-weighted
                    least-squares line through your weigh-ins, corrected for the fact that consecutive days of water
                    weight move together. The shaded band is one standard error on its slope, hinged in the middle of
                    the window where the fit is most certain. It is drawn from {fmtDY(dayToDate(fit.startX))} to {fmtDY(dayToDate(fit.drawEndX))} —
                    the estimator looks back at most 56 days, and the line stops at your last weigh-in rather than being
                    ruled across days it never saw.
                  </>
                ) : (
                  <>
                    The heavy line is the average of the last {AVG_DAYS} calendar days at each point — not the last
                    {" "}{AVG_DAYS} weigh-ins. The robust fit the Engine uses needs three weigh-ins and adaptive
                    targeting switched on; until then this average is the honest smoothing.
                  </>
                )}
              </div>

              {!yDomain.goalInView && Number.isFinite(goalW) && (
                <div className="text-[11px] font-semibold mt-1.5" style={{ color: C.faint }}>
                  Your goal of {r1(goalW)} {wUnit} sits {r1(Math.abs((avg7 ?? goalW) - goalW))} {wUnit} {goalW < (avg7 ?? goalW) ? "below" : "above"} this
                  view and is not drawn — at a scale that fit both, a month of real movement would be a few pixels tall.
                </div>
              )}

              {outlierRows.length > 0 && (
                <div className="text-[11px] font-semibold mt-1.5" style={{ color: C.warn }}>
                  {outlierRows.length} weigh-in{outlierRows.length === 1 ? "" : "s"} sit{outlierRows.length === 1 ? "s" : ""} far
                  outside the rest ({outlierRows.map((r) => `${r1(r.w)} ${wUnit} on ${fmtDY(r.date)}`).join(", ")}) and
                  {outlierRows.length === 1 ? " is" : " are"} off the edge of this view, so one mis-keyed entry can't flatten the
                  real curve. Nothing was deleted — {outlierRows.length === 1 ? "it is" : "they are"} still in the table below and
                  still in your data. Fix or delete {outlierRows.length === 1 ? "it" : "them"} on the Today tab if {outlierRows.length === 1 ? "it was" : "they were"} a typo.
                </div>
              )}

              {bfFrac != null ? (
                <div className="text-[11px] font-semibold mt-1.5" style={{ color: C.faint }}>
                  Lean mass is estimated from a single current body-fat reading ({profile.bodyFatSource === "measured" ? "measured" : profile.bodyFatSource === "visual-estimate" ? "visual estimate" : "source unset"})
                  applied across your weigh-in history — not a measured trend. It is drawn off the smoothed weight, not
                  the raw scale readings, because raw readings are mostly water and lean mass cannot drop a pound
                  overnight. The flat reference line is the other bound: your lean mass if it had never moved at all
                  (the most favourable read). Your real path sits between the two, and narrowing that gap is exactly
                  what the protein floor and training are for.
                </div>
              ) : (
                <div className="text-[11px] font-semibold mt-1.5" style={{ color: C.faint }}>
                  Add a body-fat % on the Profile tab to see an estimated lean-mass line alongside scale weight.
                </div>
              )}

              {/* ── table view ────────────────────────────────────────────────
                  The chart is aria-hidden and the Recharts tooltip is
                  mouse-only, so before this existed every intermediate value on
                  the app's most consequential chart was unreachable by keyboard
                  or assistive tech. A tooltip may enhance; it may never gate. */}
              <button type="button" onClick={() => setShowTable((v) => !v)}
                aria-expanded={showTable} aria-controls={tableId}
                className="text-xs font-bold flex items-center gap-1.5 mt-3 hover:opacity-80" style={{ color: C.ink }}>
                {showTable ? <ChevronUp size={13} aria-hidden="true" /> : <Table2 size={13} aria-hidden="true" />}
                {showTable ? "Hide the numbers" : `Show all ${rows.length} weigh-ins as a table`}
              </button>
              <div id={tableId} hidden={!showTable}>
                <div className="mt-2 overflow-auto rounded-xl" style={{ maxHeight: 320, border: `1px solid ${C.rule}` }}>
                  <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                    <caption className="sr-only">
                      Every weigh-in, newest first, with the {AVG_DAYS}-day average, the fitted trend and the estimated lean mass at each date.
                    </caption>
                    <thead>
                      <tr>
                        {["Date", `Weighed (${wUnit})`, `${AVG_DAYS}-day avg (${wUnit})`, `Trend (${wUnit})`, bfFrac != null ? `Lean mass (${wUnit})` : null]
                          .filter(Boolean)
                          .map((h) => (
                            <th key={h} scope="col" className="text-left font-bold px-3 py-2 sticky top-0"
                              style={{ color: C.faint, background: C.card2, borderBottom: `1px solid ${C.rule}` }}>{h}</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...chart].filter((r) => r.w != null).reverse().map((r) => (
                        <tr key={r.date} style={{ borderBottom: `1px solid ${C.rule}` }}>
                          <th scope="row" className="text-left font-semibold px-3 py-1.5 whitespace-nowrap" style={{ color: C.ink }}>
                            {fmtDY(r.date)}
                            {outliers.has(r.date) && <span className="ml-1.5 font-bold" style={{ color: C.warn }}>· off-chart</span>}
                          </th>
                          <td className="mono px-3 py-1.5" style={{ color: C.ink }}>{r1(r.w)}</td>
                          <td className="mono px-3 py-1.5" style={{ color: C.faint }}>{r1(r.avg)}</td>
                          <td className="mono px-3 py-1.5" style={{ color: C.faint }}>{r.fit == null ? "—" : r1(r.fit)}</td>
                          {bfFrac != null && <td className="mono px-3 py-1.5" style={{ color: C.faint }}>{r1(r.lean)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </Card>

        <div className="xl:col-span-4 flex flex-col gap-4">
          <Card section="STATUS" title="Numbers">
            <div className="grid grid-cols-2 gap-x-4">
              <Stat label={`Average, last ${AVG_DAYS} days`} value={avg7 != null ? r1(avg7) : "—"} unit={wUnit} />
              <Stat label="Lost (from start)" value={lost != null ? r1(lost) : "—"} unit={wUnit} />
              <Stat label={fit ? "Rate (fitted)" : "Rate"} value={shownRate != null ? r1(shownRate) : "—"} unit={rateUnit(pref)} />
              <Stat label="Lean mass (est.)" value={leanNow != null ? r1(leanNow) : "—"} unit={wUnit} />
            </div>
            <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
              {lastRow && lastRow.avgCount < 3 && (
                <div className="mb-1">
                  That average covers {lastRow.avgCount} weigh-in{lastRow.avgCount === 1 ? "" : "s"} in the last {AVG_DAYS} days — it is a
                  short window, not a smooth one. Weighing more often narrows it.
                </div>
              )}
              {lastRow?.avgSkipped > 0 && (
                <div className="mb-1" style={{ color: C.warn }}>
                  {lastRow.avgSkipped} reading{lastRow.avgSkipped === 1 ? "" : "s"} in that window looked mis-keyed and
                  {lastRow.avgSkipped === 1 ? " was" : " were"} left out of the average — see the note under the chart. Still in your data, nothing deleted.
                </div>
              )}
              {staleDays != null && staleDays > 3 && (
                <div className="mb-1">
                  Last weigh-in was {staleDays} days ago, so every number here describes that day, not today.
                </div>
              )}
              {lbmAtStart != null
                ? <>Est. body fat {estBf != null ? r1(estBf) : "—"}% assumes lean mass held at {Math.round(lbmAtStart)} {wUnit} since your start weight — photos + tape are the real audit.</>
                : "Add a body fat % on the Profile tab to estimate lean mass and BF here."}
            </div>
          </Card>

          <Card section="PROJECTION" title="Projection">
            {!proj ? (
              <div className="text-sm font-semibold" style={{ color: C.faint }}>Projections unlock with weigh-in data.</div>
            ) : proj.atGoal ? (
              <div className="text-sm font-semibold" style={{ color: C.ink }}>
                You&apos;re at your goal weight of {r1(goalW)} {wUnit}.
              </div>
            ) : proj.movingAway ? (
              <div className="space-y-1.5">
                <div className="text-sm font-semibold" style={{ color: C.ink }}>
                  No date yet — the trend is currently moving away from your goal.
                </div>
                <div className="text-xs font-semibold" style={{ color: C.faint }}>
                  {r1(Math.abs(proj.toGo))} {wUnit} to go, {proj.direction === "down" ? "downward" : "upward"}, and the measured
                  pace is {r1(proj.rate)} {rateUnit(pref)} the other way. One fortnight is not a verdict; Profile is where the plan changes.
                </div>
              </div>
            ) : proj.kind === "measured" ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline py-1.5 gap-3" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.ink }}>Most likely</span>
                  <span className="text-sm font-extrabold text-right" style={{ color: C.ink }}>{proj.mid ? fmtDY(proj.mid) : "further out than 10 years"}</span>
                </div>
                <div className="flex justify-between items-baseline py-1.5 gap-3" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.faint }}>If your pace holds at the fast edge</span>
                  <span className="text-sm font-bold text-right" style={{ color: C.faint }}>{proj.fast ? fmtDY(proj.fast) : "further out than 10 years"}</span>
                </div>
                <div className="flex justify-between items-baseline py-1.5 gap-3" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.faint }}>…and at the slow edge</span>
                  <span className="text-sm font-bold text-right" style={{ color: C.faint }}>
                    {proj.slowStalls ? "doesn't get there" : proj.slow ? fmtDY(proj.slow) : "further out than 10 years"}
                  </span>
                </div>
                <div className="text-xs font-semibold pt-1.5" style={{ color: C.faint }}>
                  Goal {r1(goalW)} {wUnit} — {r1(Math.abs(proj.toGo))} {wUnit} {proj.direction === "down" ? "to lose" : "to gain"} at a
                  measured {r1(proj.rate)} {rateUnit(pref)}. The two edges are that pace ± one standard error on it, the same
                  uncertainty the Engine publishes — not a rounding of the middle number.
                  {proj.slowStalls && " At the slow edge the trend is flat, so there is no date on that side yet. That is what a wide band means, not a bad week."}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline py-1.5 gap-3" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.ink }}>
                    At your planned pace ({r1(proj.rate)} {rateUnit(pref)})
                  </span>
                  <span className="text-sm font-extrabold text-right" style={{ color: C.ink }}>{proj.mid ? fmtDY(proj.mid) : "further out than 10 years"}</span>
                </div>
                <div className="text-xs font-semibold pt-1" style={{ color: C.faint }}>
                  Goal {r1(goalW)} {wUnit}. This is your CHOSEN rate, not a measured one — there is no fitted trend yet, so
                  there is no honest range to put around it. It gets a range once the fit has data.
                </div>
              </div>
            )}
          </Card>

          <TrainingNudge openTraining={openTraining} />
        </div>
      </div>
    </div>
  );
}
