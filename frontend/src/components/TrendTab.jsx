import { useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { LineChart } from "lucide-react";
import { C } from "../lib/theme.js";
import { mean } from "../lib/math.js";
import { todayStr, addDays, fmtDY } from "../lib/dates.js";
import { fmtD } from "../lib/dates.js";
import { displayWeight, displayRate, weightUnit, rateUnit } from "../lib/units.js";
import { Card, Stat, PageHead, EmptyNote } from "./ui/Parts.jsx";

const r1 = (n) => Math.round(n * 10) / 10;

export default function TrendTab({ profile, summary }) {
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

  const chart = useMemo(() => {
    return sorted.map((e, i) => {
      const win = sorted.slice(Math.max(0, i - 6), i + 1);
      return { d: fmtD(e.d), w: e.w, a: r1(mean(win.map((x) => x.w))) };
    });
  }, [sorted]);

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

  const yMin = sorted.length ? Math.floor(Math.min(goalW, ...sorted.map((e) => e.w))) - 4 : goalW - 4;
  const yMax = sorted.length ? Math.ceil(Math.max(...sorted.map((e) => e.w))) + 2 : goalW + 2;

  return (
    <div>
      <PageHead title="Trend" sub="Daily weight, 7-day average, and where the current pace lands you." />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Card section="CURVE" title="Weight" className="xl:col-span-8">
          {sorted.length === 0 ? (
            <EmptyNote icon={LineChart} height={380} title="No weigh-ins yet"
              hint="Log your first weight on the Today tab to start the curve." />
          ) : sorted.length < 2 ? (
            <EmptyNote icon={LineChart} height={380} title="First point logged"
              hint="The curve starts with your second weigh-in — log again tomorrow. Verdicts and projections firm up after ~10 days of data." />
          ) : (
            <div style={{ width: "100%", height: 380 }}>
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: 11, fill: C.faint, fontWeight: 600 }} tickLine={false}
                    axisLine={{ stroke: C.rule }} minTickGap={24} />
                  <YAxis domain={[yMin, yMax]} tick={{ fontSize: 11, fill: C.faint, fontWeight: 600 }}
                    tickLine={false} axisLine={{ stroke: C.rule }} width={52} />
                  <Tooltip
                    contentStyle={{ background: C.card2, border: `1px solid ${C.rule}`, borderRadius: 12, fontSize: 12, fontWeight: 600, color: C.ink }}
                    formatter={(val, name) => [val + " " + wUnit, name === "w" ? "daily" : "7-day avg"]}
                  />
                  <ReferenceLine y={goalW} stroke={C.faint} strokeDasharray="6 4"
                    label={{ value: "GOAL " + r1(goalW), fill: C.faint, fontSize: 10, fontWeight: 700, position: "insideBottomLeft" }} />
                  <Line type="monotone" dataKey="w" stroke={C.faintLight} strokeWidth={1.5}
                    dot={{ r: 2, fill: C.faintLight, strokeWidth: 0 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="a" stroke={C.accent} strokeWidth={2.5}
                    dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
            thin = daily · heavy = 7-day average · dashed = goal
          </div>
        </Card>

        <div className="xl:col-span-4 flex flex-col gap-4">
          <Card section="STATUS" title="Numbers">
            <div className="grid grid-cols-2 gap-x-4">
              <Stat label="7-day avg" value={avg7 != null ? r1(avg7) : "—"} unit={wUnit} />
              <Stat label="Lost (from start)" value={lost != null ? r1(lost) : "—"} unit={wUnit} />
              <Stat label="Rate" value={rate != null ? displayRate(rate, pref) : "—"} unit={rateUnit(pref)} />
              <Stat label="Est. body fat" value={estBf != null ? r1(estBf) : "—"} unit="%" />
            </div>
            <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
              {lbm != null
                ? <>BF% assumes LBM held at {Math.round(lbm)} {wUnit} — photos + tape are the real audit.</>
                : "Add a body fat % on the Profile tab to estimate BF here."}
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
        </div>
      </div>
    </div>
  );
}
