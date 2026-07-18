import { useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { LineChart } from "lucide-react";
import { C } from "../lib/theme.js";
import { mean } from "../lib/math.js";
import { kg2lb } from "../lib/units.js";
import { todayStr, dayNum, addDays, fmtD, fmtDY } from "../lib/dates.js";
import { FORK_DATE, MILESTONES, RX, FLOOR, GOAL_WINDOW } from "../data/constants.js";
import { Card, Stat } from "./ui/Parts.jsx";

const r1 = (n) => Math.round(n * 10) / 10;

export default function TrendTab({ profile, summary, isAdmin }) {
  const { avg7Kg, rate } = summary;
  const sorted = [...summary.weighins]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ d: e.date, w: r1(kg2lb(e.weightKg)) }));
  const avg7 = avg7Kg != null ? kg2lb(avg7Kg) : null;
  const startWeightLb = kg2lb(profile.startWeightKg);
  const goalLb = kg2lb(profile.goalWeightKg);
  const lbm = startWeightLb * (1 - profile.bodyFatPct / 100);

  const chart = useMemo(() => {
    return sorted.map((e, i) => {
      const win = sorted.slice(Math.max(0, i - 6), i + 1);
      return { d: fmtD(e.d), w: e.w, a: r1(mean(win.map((x) => x.w))) };
    });
  }, [sorted]);

  const estBf = avg7 != null ? ((avg7 - lbm) / avg7) * 100 : null;
  const lost = avg7 != null ? startWeightLb - avg7 : null;
  const effRate = rate != null && rate > 0 ? rate : 1.49;

  // FORK_DATE and the RX/FLOOR fork projections below are this specific
  // account's own fixed numbers (see data/constants.js), not derived from a
  // generic profile - gated to isAdmin. `proj` (the main "at current rate"
  // projection) stays for every account since it's computed purely from
  // this account's own avg7/goalLb/rate, not a hardcoded personal constant.
  let proj = null, forkHold = null, forkStep = null;
  if (avg7 != null) {
    proj = addDays(todayStr(), ((avg7 - goalLb) / effRate) * 7);
    if (isAdmin) {
      const today = todayStr();
      if (dayNum(today) < dayNum(FORK_DATE)) {
        const wksToFork = (dayNum(FORK_DATE) - dayNum(today)) / 7;
        const atFork = avg7 - effRate * wksToFork;
        forkHold = addDays(FORK_DATE, ((atFork - goalLb) / 1.49) * 7);
        forkStep = addDays(FORK_DATE, ((atFork - goalLb) / 1.79) * 7);
      }
    }
  }

  const yMin = sorted.length ? Math.floor(Math.min(goalLb, ...sorted.map((e) => e.w))) - 4 : goalLb - 4;
  const yMax = sorted.length ? Math.ceil(Math.max(...sorted.map((e) => e.w))) + 2 : goalLb + 2;
  const nextM = isAdmin ? MILESTONES.find((m) => avg7 != null && avg7 > m) : null;

  return (
    <div>
      <Card section="CURVE" title="Weight">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height: 250 }}>
            <LineChart size={22} style={{ color: C.faintLight }} />
            <div className="text-sm font-semibold" style={{ color: C.faint }}>No weigh-ins yet</div>
            <div className="text-xs font-medium max-w-[220px]" style={{ color: C.faintLight }}>
              Log your first weight on the Today tab to start the curve.
            </div>
          </div>
        ) : (
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={C.rule} strokeDasharray="2 4" />
                <XAxis dataKey="d" tick={{ fontSize: 10, fill: C.faint, fontWeight: 600 }} tickLine={false}
                  axisLine={{ stroke: C.rule }} minTickGap={24} />
                <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: C.faint, fontWeight: 600 }}
                  tickLine={false} axisLine={{ stroke: C.rule }} width={52} />
                <Tooltip
                  contentStyle={{ background: C.card, border: `1px solid ${C.rule}`, borderRadius: 12, fontSize: 12, fontWeight: 600 }}
                  formatter={(val, name) => [val + " lb", name === "w" ? "daily" : "7-day avg"]}
                />
                <ReferenceLine y={goalLb} stroke={C.red} strokeDasharray="6 4"
                  label={{ value: "GOAL " + r1(goalLb), fill: C.red, fontSize: 10, fontWeight: 700, position: "insideBottomLeft" }} />
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

      <Card section="STATUS" title="Numbers">
        <div className="grid grid-cols-2 gap-x-4">
          <Stat label="7-day avg" value={avg7 != null ? r1(avg7) : "—"} unit="lb" />
          <Stat label="Lost (from start)" value={lost != null ? r1(lost) : "—"} unit="lb" />
          <Stat label="Rate" value={rate != null ? r1(rate) : "—"} unit="lb/wk" />
          <Stat label="Est. body fat" value={estBf != null ? r1(estBf) : "—"} unit="%" />
        </div>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          BF% assumes LBM held at {Math.round(lbm)} lb — photos + tape are the real audit.
          {nextM && <> Next checkpoint: {nextM} lb.</>}
        </div>
      </Card>

      <Card section="§3" title="Projection">
        {proj ? (
          <div className="space-y-1.5">
            <div className="flex justify-between items-baseline py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span className="text-sm font-semibold" style={{ color: C.ink }}>At current rate ({r1(effRate)} lb/wk)</span>
              <span className="text-sm font-extrabold" style={{ color: C.ink }}>{fmtDY(proj)}</span>
            </div>
            {forkHold && (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide pt-1" style={{ color: C.faintLight }}>
                  Week-10 fork — {fmtD(FORK_DATE)}
                </div>
                <div className="flex justify-between items-baseline py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.ink }}>Hold {RX.toLocaleString()}</span>
                  <span className="text-sm font-bold" style={{ color: C.ink }}>{fmtDY(forkHold)}</span>
                </div>
                <div className="flex justify-between items-baseline py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <span className="text-sm font-semibold" style={{ color: C.ink }}>Step to {FLOOR.toLocaleString()}–{(FLOOR + 50).toLocaleString()}</span>
                  <span className="text-sm font-bold" style={{ color: C.ink }}>{fmtDY(forkStep)}</span>
                </div>
              </>
            )}
            <div className="text-xs font-semibold pt-1" style={{ color: C.faint }}>
              Goal: {r1(goalLb)} lb · deadline window {GOAL_WINDOW}
            </div>
          </div>
        ) : (
          <div className="text-sm font-semibold" style={{ color: C.faint }}>Projections unlock with weigh-in data.</div>
        )}
      </Card>
    </div>
  );
}
