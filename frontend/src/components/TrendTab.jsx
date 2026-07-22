import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { LineChart, Dumbbell, ArrowRight } from "lucide-react";
import { C } from "../lib/theme.js";
import { mean } from "../lib/math.js";
import { todayStr, addDays, fmtDY } from "../lib/dates.js";
import { fmtD } from "../lib/dates.js";
import { displayWeight, displayRate, weightUnit, rateUnit } from "../lib/units.js";
import { TRAINING } from "../lib/flags.js";
import { api } from "../lib/api.js";
import { Card, Stat, PageHead, EmptyNote } from "./ui/Parts.jsx";

const r1 = (n) => Math.round(n * 10) / 10;

// Recomposition integration: a light, read-only pointer to the training
// scaffold. Protein-priority mode defends the floor; this is the honest
// reminder that the floor is one of two levers, not the whole story. Never
// fetches/renders when the flag hides the feature entirely.
function TrainingNudge({ openTraining }) {
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none, object = active plan
  useEffect(() => {
    if (TRAINING === "hidden") return;
    api.getTrainingPlan().then(setPlan).catch(() => setPlan(null));
  }, []);
  if (TRAINING === "hidden" || plan === undefined) return null;

  const clickable = TRAINING === "on";
  return (
    <Card section="RECOMP" title="The other lever">
      <div className="flex items-start gap-2.5">
        <Dumbbell size={16} style={{ color: C.faint }} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          {plan ? (
            <div className="text-sm font-semibold" style={{ color: C.ink }}>
              {plan.style} training active, {plan.daysPerWeek}x/week. Protein alone slows lean-mass loss — resistance training is what actually signals the body to keep it.
            </div>
          ) : (
            <div className="text-sm font-semibold" style={{ color: C.ink }}>
              No training plan yet. Protein-priority mode defends the floor, but without a training stimulus the body has less reason to hold onto the muscle it's fed.
            </div>
          )}
          {clickable && (
            <button onClick={openTraining} className="text-xs font-bold flex items-center gap-1 mt-2 hover:opacity-80" style={{ color: C.ink }}>
              {plan ? "View training plan" : "Generate a training plan"} <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function TrendTab({ profile, summary, openTraining }) {
  const pref = profile.unitPref;
  const wUnit = weightUnit(pref);
  const { avg7Kg, rate } = summary;

  const sorted = [...summary.weighins]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ d: e.date, w: displayWeight(e.weightKg, pref) }));
  const avg7 = avg7Kg != null ? displayWeight(avg7Kg, pref) : null;
  const startW = displayWeight(profile.startWeightKg, pref);
  const goalW = displayWeight(profile.goalWeightKg, pref);
  const lbm = profile.bodyFatPct > 0 ? startW * (1 - profile.bodyFatPct / 100) : null;

  // ── lean mass (estimated) ────────────────────────────────────────────────
  // Honesty constraint: the schema tracks ONE current body-fat% (Profile.
  // bodyFatPct / bodyFatSource), not a reading per weigh-in — so there is no
  // real per-date body-composition history to plot. What CAN be shown
  // honestly from real data: scale weight is a genuine time series; body-fat%
  // is a genuine (if single) measurement. Combining them gives two bounding
  // assumptions, not a measured trend:
  //   - PROPORTIONAL: today's lean fraction held constant back through the
  //     curve (lean mass moves with the scale).
  //   - HELD-CONSTANT: today's lean mass in kg held flat back through the
  //     curve (ALL of the historical change was fat — the most favorable
  //     read). Where a real reading trended fell between the two lines
  //     is unknowable without more body-fat data points; the gap between
  //     them is the very thing this mode + training exist to narrow.
  const bfFrac = profile.bodyFatPct > 0 ? profile.bodyFatPct / 100 : null;
  const leanMassNow = bfFrac != null && avg7 != null ? r1(avg7 * (1 - bfFrac)) : null;

  const chart = useMemo(() => {
    return sorted.map((e, i) => {
      const win = sorted.slice(Math.max(0, i - 6), i + 1);
      return {
        d: fmtD(e.d), w: e.w, a: r1(mean(win.map((x) => x.w))),
        l: bfFrac != null ? r1(e.w * (1 - bfFrac)) : null,
      };
    });
  }, [sorted, bfFrac]);

  const estBf = avg7 != null && lbm != null ? ((avg7 - lbm) / avg7) * 100 : null;
  const lost = avg7 != null ? startW - avg7 : null;

  // Projection at the OBSERVED rate when there is one, otherwise the chosen
  // plan rate — labeled so nobody mistakes a plan for a measurement.
  const chosenDisplayRate = displayRate(profile.rateLbPerWeek, pref);
  const effRate = rate != null && rate > 0 ? displayRate(rate, pref) : null;
  const projRate = effRate ?? chosenDisplayRate;
  const proj = avg7 != null && projRate > 0 && avg7 > goalW
    ? addDays(todayStr(), ((avg7 - goalW) / projRate) * 7)
    : null;

  const yMin = sorted.length ? Math.floor(Math.min(goalW, leanMassNow ?? goalW, ...sorted.map((e) => e.w))) - 4 : goalW - 4;
  const yMax = sorted.length ? Math.ceil(Math.max(...sorted.map((e) => e.w))) + 2 : goalW + 2;

  return (
    <div>
      <PageHead title="Trend" sub="Scale weight and estimated lean mass — recomposition means what's LOST matters as much as how much." />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Card section="CURVE" title="Weight" className="xl:col-span-8">
          {sorted.length === 0 ? (
            <EmptyNote icon={LineChart} height={380} title="No weigh-ins yet"
              hint="Log your first weight on the Today tab to start the curve." />
          ) : sorted.length < 2 ? (
            <EmptyNote icon={LineChart} height={380} title="First point logged"
              hint="The curve starts with your second weigh-in — log again tomorrow. Verdicts and projections firm up after ~10 days of data." />
          ) : (
            // a11y: same text-equivalent pattern as the Today-tab snapshot —
            // role="img" summary sentence, chart hidden from AT underneath.
            // The summary also names the lean-mass line when it is drawn, so the
            // accessible reading describes every series a sighted user can see.
            <div
              role="img"
              aria-label={`Weight trend, ${chart.length} entries: ${r1(chart[0].w)} ${wUnit} on ${chart[0].d}, most recently ${r1(chart[chart.length - 1].w)} ${wUnit} on ${chart[chart.length - 1].d}. 7-day average ${r1(chart[chart.length - 1].a)} ${wUnit}, goal ${r1(goalW)} ${wUnit}.${bfFrac != null ? ` Estimated lean mass ${r1(chart[chart.length - 1].l)} ${wUnit}, shown as an estimate derived from a single body-fat reading, not a measured trend.` : ""}`}
              style={{ width: "100%", height: 380 }}
            >
              <div aria-hidden="true" style={{ width: "100%", height: "100%" }}>
                <ResponsiveContainer>
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="d" tick={{ fontSize: 11, fill: C.faint, fontWeight: 600 }} tickLine={false}
                      axisLine={{ stroke: C.rule }} minTickGap={24} />
                    <YAxis domain={[yMin, yMax]} tick={{ fontSize: 11, fill: C.faint, fontWeight: 600 }}
                      tickLine={false} axisLine={{ stroke: C.rule }} width={52} />
                    <Tooltip
                      contentStyle={{ background: C.card2, border: `1px solid ${C.rule}`, borderRadius: 12, fontSize: 12, fontWeight: 600, color: C.ink }}
                      formatter={(val, name) => [val + " " + wUnit, name === "w" ? "daily weight" : name === "a" ? "7-day avg" : "lean mass (est.)"]}
                    />
                    <ReferenceLine y={goalW} stroke={C.faint} strokeDasharray="6 4"
                      label={{ value: "GOAL " + r1(goalW), fill: C.faint, fontSize: 10, fontWeight: 700, position: "insideBottomLeft" }} />
                    {leanMassNow != null && (
                      <ReferenceLine y={leanMassNow} stroke={C.faintLight} strokeDasharray="2 3"
                        label={{ value: "LEAN MASS (held constant) " + leanMassNow, fill: C.faintLight, fontSize: 9, fontWeight: 700, position: "insideTopLeft" }} />
                    )}
                    <Line type="monotone" dataKey="w" stroke={C.faintLight} strokeWidth={1.5}
                      dot={{ r: 2, fill: C.faintLight, strokeWidth: 0 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="a" stroke={C.accent} strokeWidth={2.5}
                      dot={false} isAnimationActive={false} />
                    {bfFrac != null && (
                      <Line type="monotone" dataKey="l" stroke={C.ink} strokeWidth={1.5} strokeDasharray="4 2"
                        dot={false} isAnimationActive={false} connectNulls />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
            thin = daily weight · heavy = 7-day average · dashed grey = goal
            {bfFrac != null && " · dashed ink = lean mass at today's body-fat% held proportional · dotted = lean mass if it had stayed flat (best case)"}
          </div>
          {bfFrac != null ? (
            <div className="text-[11px] font-semibold mt-1.5" style={{ color: C.faintLight }}>
              Estimated from a single current body-fat reading ({profile.bodyFatSource === "measured" ? "measured" : profile.bodyFatSource === "visual-estimate" ? "visual estimate" : "source unset"}) applied across your weigh-in history — not a measured trend. The two lines bracket the honest range: your real lean-mass path sits somewhere between them, and that gap is exactly what the protein floor + training are meant to narrow.
            </div>
          ) : (
            <div className="text-[11px] font-semibold mt-1.5" style={{ color: C.faintLight }}>
              Add a body-fat % on the Profile tab to see an estimated lean-mass line alongside scale weight.
            </div>
          )}
        </Card>

        <div className="xl:col-span-4 flex flex-col gap-4">
          <Card section="STATUS" title="Numbers">
            <div className="grid grid-cols-2 gap-x-4">
              <Stat label="7-day avg" value={avg7 != null ? r1(avg7) : "—"} unit={wUnit} />
              <Stat label="Lost (from start)" value={lost != null ? r1(lost) : "—"} unit={wUnit} />
              <Stat label="Rate" value={rate != null ? displayRate(rate, pref) : "—"} unit={rateUnit(pref)} />
              <Stat label="Lean mass (est.)" value={leanMassNow != null ? leanMassNow : "—"} unit={wUnit} />
            </div>
            <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
              {lbm != null
                ? <>Est. body fat {estBf != null ? r1(estBf) : "—"}% assumes lean mass held at {Math.round(lbm)} {wUnit} since your start weight — photos + tape are the real audit.</>
                : "Add a body fat % on the Profile tab to estimate lean mass and BF here."}
            </div>
          </Card>

          <Card section="PROJECTION" title="Projection">
            {proj ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.ink }}>
                    At {effRate != null ? "current" : "planned"} pace ({r1(projRate)} {rateUnit(pref)})
                  </span>
                  <span className="text-sm font-extrabold" style={{ color: C.ink }}>{fmtDY(proj)}</span>
                </div>
                <div className="text-xs font-semibold pt-1" style={{ color: C.faint }}>
                  Goal: {r1(goalW)} {wUnit}{effRate == null && " · projection uses your chosen plan rate until 8+ weigh-ins establish a measured pace"}
                </div>
              </div>
            ) : (
              <div className="text-sm font-semibold" style={{ color: C.faint }}>Projections unlock with weigh-in data.</div>
            )}
          </Card>

          <TrainingNudge openTraining={openTraining} />
        </div>
      </div>
    </div>
  );
}
