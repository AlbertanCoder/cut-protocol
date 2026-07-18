import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Camera, Trash2, CalendarDays, ArrowRight, LineChart } from "lucide-react";
import { C, getStampStyle } from "../lib/theme.js";
import { todayStr, dayNum, addDays, fmtD } from "../lib/dates.js";
import { displayWeight, parseWeight, weightUnit, rateUnit, displayRate, weightInputBounds } from "../lib/units.js";
import { Card, Stat, Btn, Stamp, Ring, MacroBar, PageHead } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const r1 = (n) => Math.round(n * 10) / 10;

// dayOfWeek in the plan model is 0=Monday..6=Sunday; JS getDay() is 0=Sunday.
function isoWeekday() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export default function TodayTab({ profile, summary, refresh, openTrend }) {
  const pref = profile.unitPref;
  const wUnit = weightUnit(pref);
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [wIn, setWIn] = useState("");
  const [dIn, setDIn] = useState(todayStr());
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none

  useEffect(() => {
    api.getCurrentPlan().then(setPlan).catch(() => setPlan(null));
  }, []);

  const { weighins, avg7Kg, rate, daysIn, verdict: v, macros, target } = summary;
  const sorted = [...weighins].sort((a, b) => a.date.localeCompare(b.date));

  const add = async () => {
    const w = parseFloat(wIn);
    const bounds = weightInputBounds(pref);
    if (!w || w < bounds.min || w > bounds.max) return;
    await api.postWeighin(dIn, parseWeight(w, pref));
    setWIn("");
    await refresh();
  };
  const del = async (date) => {
    await api.deleteWeighin(date);
    await refresh();
  };

  const daysSince = dayNum(todayStr()) - dayNum(profile.startDate);
  const photoDue = daysSince >= 28 && daysSince % 28 <= 2;
  const nextPhoto = addDays(profile.startDate, 28 * Math.ceil((daysSince + 0.1) / 28));

  const todaySlots = plan ? plan.slots.filter((s) => s.dayOfWeek === isoWeekday()) : [];
  const planned = todaySlots.reduce((t, s) => ({ kcal: t.kcal + s.kcal, protein: t.protein + s.protein, fat: t.fat + s.fat, carb: t.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
  const kcalPct = macros?.kcal ? planned.kcal / macros.kcal : 0;

  // Compact trend snapshot — same series the Trend tab draws in full.
  const goalDisplay = displayWeight(profile.goalWeightKg, pref);
  const snapshot = useMemo(() => {
    const s = sorted.map((e) => ({ d: e.date, w: displayWeight(e.weightKg, pref) }));
    return s.map((e, i) => {
      const win = s.slice(Math.max(0, i - 6), i + 1);
      return { d: fmtD(e.d), w: e.w, a: r1(win.reduce((t, x) => t + x.w, 0) / win.length) };
    });
  }, [sorted, pref]);
  const yMin = sorted.length ? Math.floor(Math.min(goalDisplay, ...snapshot.map((e) => e.w))) - 3 : goalDisplay - 3;
  const yMax = sorted.length ? Math.ceil(Math.max(...snapshot.map((e) => e.w))) + 2 : goalDisplay + 2;

  return (
    <div>
      <PageHead title="Today" sub={`Day ${daysIn} of protocol · target ${kc(target?.target ?? profile.targetKcal)} kcal · plan: ${profile.rateLbPerWeek} lb/wk`} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* ── planned vs target ── */}
        <Card section="TODAY" title="Planned vs. target" className="xl:col-span-5">
          {plan === undefined ? (
            <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
          ) : todaySlots.length === 0 ? (
            <div className="flex items-start gap-2">
              <CalendarDays size={18} style={{ color: C.faintLight }} className="mt-0.5 shrink-0" />
              <div className="text-sm font-semibold" style={{ color: C.faint }}>
                No plan generated for this week yet — head to the Plan tab. This reflects what's <em>planned</em>, not what you've actually eaten (there's no food diary yet).
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-6 mb-5">
                <Ring pct={kcalPct} size={156} stroke={13} color={C.accent} num={kc(planned.kcal)} unit="planned kcal" />
                <div className="flex-1 flex flex-col gap-1.5 text-xs font-semibold">
                  <div className="flex justify-between"><span style={{ color: C.faint }}>Target</span><span className="mono text-sm" style={{ color: C.ink }}>{kc(macros.kcal)} kcal</span></div>
                  <div className="flex justify-between"><span style={{ color: C.faint }}>Planned today</span><span className="mono text-sm" style={{ color: C.ink }}>{kc(planned.kcal)} kcal</span></div>
                  <div className="flex justify-between"><span style={{ color: C.faint }}>Meals + snacks</span><span className="mono text-sm" style={{ color: C.ink }}>{todaySlots.length}</span></div>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <MacroBar label="Protein" actual={planned.protein} target={macros.proteinHi} color={C.protein} />
                <MacroBar label="Fat" actual={planned.fat} target={macros.fatHi} color={C.fat} />
                <MacroBar label="Carb" actual={planned.carb} target={macros.carbHi} color={C.carb} />
              </div>
            </>
          )}
        </Card>

        {/* ── verdict ── */}
        <Card section="VERDICT" title="Verdict" className="xl:col-span-4">
          <Stamp v={v} stampStyle={getStampStyle()} />
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Stat label="7-day avg" value={avg7Kg != null ? displayWeight(avg7Kg, pref) : "—"} unit={wUnit} />
            <Stat label="Rate" value={rate != null ? displayRate(rate, pref) : "—"} unit={rateUnit(pref)} />
            <Stat label="Target" value={kc(target?.target ?? profile.targetKcal)} unit="kcal" />
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            {v.band
              ? <>Your band: {displayRate(v.band.lo, pref)}–{displayRate(v.band.hi, pref)} {rateUnit(pref)}, from your chosen {profile.rateLbPerWeek} lb/wk. Verdicts judge 7-day averages only; the fix for a wrong pace lives on the Profile tab.</>
              : "Verdicts judge 7-day averages only."}
          </div>
        </Card>

        {/* ── weigh-in ── */}
        <Card section="DAILY" title="Weigh-in" className="xl:col-span-3">
          <div className="text-xs font-semibold mb-3" style={{ color: C.faint }}>
            Fasted · post-bathroom · pre-water. Same conditions every day.
          </div>
          <div className="flex flex-col gap-2">
            <input
              type="date" value={dIn} onChange={(e) => setDIn(e.target.value)}
              className="text-sm px-3 py-2.5 rounded-xl w-full"
              style={inpStyle}
            />
            <div className="flex gap-2">
              <input
                type="number" inputMode="decimal" step="0.1" placeholder={wUnit}
                value={wIn} onChange={(e) => setWIn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                className="text-sm px-3 py-2.5 rounded-xl flex-1 min-w-0"
                style={inpStyle}
              />
              <Btn onClick={add}>Log</Btn>
            </div>
          </div>
        </Card>

        {/* ── trend snapshot ── */}
        <Card section="CURVE" title="Trend snapshot" className="xl:col-span-7">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height: 200 }}>
              <LineChart size={22} style={{ color: C.faintLight }} />
              <div className="text-sm font-semibold" style={{ color: C.faint }}>No weigh-ins yet</div>
              <div className="text-xs font-medium max-w-[240px]" style={{ color: C.faintLight }}>
                Log your first weight above to start the curve.
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <ComposedChart data={snapshot} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: 10, fill: C.faint, fontWeight: 600 }} tickLine={false}
                    axisLine={{ stroke: C.rule }} minTickGap={28} />
                  <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: C.faint, fontWeight: 600 }}
                    tickLine={false} axisLine={{ stroke: C.rule }} width={52} />
                  <Tooltip
                    contentStyle={{ background: C.card2, border: `1px solid ${C.rule}`, borderRadius: 12, fontSize: 12, fontWeight: 600, color: C.ink }}
                    formatter={(val, name) => [val + " " + wUnit, name === "w" ? "daily" : "7-day avg"]}
                  />
                  <ReferenceLine y={goalDisplay} stroke={C.red} strokeDasharray="6 4" />
                  <Line type="monotone" dataKey="w" stroke={C.faintLight} strokeWidth={1.5}
                    dot={{ r: 2, fill: C.faintLight, strokeWidth: 0 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="a" stroke={C.accent} strokeWidth={2.5}
                    dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="text-xs font-semibold" style={{ color: C.faint }}>
              thin = daily · heavy = 7-day average · dashed = goal
            </div>
            <button onClick={openTrend} className="text-xs font-bold flex items-center gap-1 hover:opacity-80" style={{ color: C.accent }}>
              Full trend <ArrowRight size={12} />
            </button>
          </div>
        </Card>

        {/* ── recent entries ── */}
        <Card section="LOG" title="Recent entries" className="xl:col-span-5">
          {sorted.length === 0 && (
            <div className="text-sm font-semibold" style={{ color: C.faint }}>No entries. Log Day 1.</div>
          )}
          {[...sorted].reverse().slice(0, 8).map((e) => (
            <div key={e.date} className="flex items-center justify-between py-2"
              style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span className="text-sm font-semibold" style={{ color: C.faint }}>{fmtD(e.date)}</span>
              <span className="mono text-sm font-bold" style={{ color: C.ink }}>{displayWeight(e.weightKg, pref)} {wUnit}</span>
              <button onClick={() => del(e.date)} aria-label={`Delete ${e.date}`} style={{ color: C.faintLight }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </Card>
      </div>

      {/* footer notes */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 px-1">
        <div className="text-xs font-semibold flex items-center gap-2" style={{ color: photoDue ? C.warn : C.faint }}>
          <Camera size={13} /> {photoDue ? "4-week photo + tape audit due — same light, same poses." : `Next photo + tape audit: ${fmtD(nextPhoto)}`}
        </div>
      </div>
    </div>
  );
}
