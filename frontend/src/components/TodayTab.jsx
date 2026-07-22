import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Camera, Trash2, CalendarDays, ArrowRight, LineChart, NotebookPen, ClipboardCheck, Plus } from "lucide-react";
import { C, getStampStyle } from "../lib/theme.js";
import { todayStr, dayNum, addDays, fmtD } from "../lib/dates.js";
import { displayWeight, parseWeight, weightUnit, rateUnit, displayRate, weightInputBounds } from "../lib/units.js";
import { Card, Stat, Btn, Chip, Stamp, Ring, MacroBar, PageHead, EmptyNote, ErrorNote } from "./ui/Parts.jsx";
import { Skeleton, SkeletonRows } from "./ui/Skeleton.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const r1 = (n) => Math.round(n * 10) / 10;

// Diary source → a short, neutral label. Provenance is text, not color
// (green is reserved; the macro triad means macros only).
const DIARY_SOURCE_LABEL = { planned: "from plan", "log-planned": "from plan", recipe: "recipe", manual: "logged" };

// dayOfWeek in the plan model is 0=Monday..6=Sunday; JS getDay() is 0=Sunday.
function isoWeekday() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

// ── Food diary ("ate as planned") ─────────────────────────────────────────
// Planned vs. actually-eaten. The backend contract is being built in parallel,
// so every path degrades gracefully: a 404 (route not shipped) or a missing
// field yields a calm empty state and inline notes — it never throws. Entries
// carry proteinG/carbG/fatG; the totals block carries protein/carb/fat.
function DiaryCard({ date, macros, hasPlan }) {
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [diary, setDiary] = useState(undefined); // undefined=loading | {entries,totals} | "error"
  const [soon, setSoon] = useState(false);       // GET 404 → route not live yet
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", kcal: "", proteinG: "", carbG: "", fatG: "" });
  const [note, setNote] = useState(null);        // calm inline note (never red — law b)

  const load = useCallback(async () => {
    try {
      const res = await api.getDiary(date);
      setDiary({ entries: res?.entries ?? [], totals: res?.totals ?? null });
      setSoon(false);
    } catch (e) {
      if (e.status === 404) { setDiary({ entries: [], totals: null }); setSoon(true); }
      else setDiary("error");
    }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const entries = (diary && diary !== "error") ? (diary.entries || []) : [];
  const totals = useMemo(() => {
    const d = (diary && diary !== "error") ? diary : null;
    const t = d ? d.totals : null;
    if (t) return { kcal: t.kcal ?? 0, protein: t.protein ?? 0, carb: t.carb ?? 0, fat: t.fat ?? 0 };
    // No server totals (or after an optimistic delete): sum the entries.
    return (d ? d.entries || [] : []).reduce((a, e) => ({
      kcal: a.kcal + (e.kcal || 0), protein: a.protein + (e.proteinG || 0),
      carb: a.carb + (e.carbG || 0), fat: a.fat + (e.fatG || 0),
    }), { kcal: 0, protein: 0, carb: 0, fat: 0 });
  }, [diary]);

  // A 404 on any action means the route isn't live yet — say so calmly.
  const friendly = (e, fallback) =>
    e.status === 404 ? "Food logging isn't live yet — it activates when the diary update ships." : (e.message || fallback);

  const logPlanned = async () => {
    setBusy(true); setNote(null);
    try {
      const res = await api.logPlannedDiary(date);
      setDiary({ entries: res?.entries ?? [], totals: res?.totals ?? null });
      setSoon(false);
    } catch (e) { setNote(friendly(e, "Couldn't copy your plan — try again.")); if (e.status === 404) setSoon(true); }
    finally { setBusy(false); }
  };

  const submitEntry = async () => {
    const kcal = +form.kcal;
    if (!form.name.trim() || !kcal) { setNote("Give the item a name and its calories."); return; }
    setBusy(true); setNote(null);
    try {
      await api.addDiaryEntry({
        date, name: form.name.trim(), kcal,
        proteinG: +form.proteinG || 0, carbG: +form.carbG || 0, fatG: +form.fatG || 0,
      });
      setForm({ name: "", kcal: "", proteinG: "", carbG: "", fatG: "" });
      setAdding(false);
      await load(); // re-fetch for authoritative ids + totals
    } catch (e) { setNote(friendly(e, "Couldn't save that entry — try again.")); if (e.status === 404) setSoon(true); }
    finally { setBusy(false); }
  };

  // Optimistic delete: drop the row now, restore it if the server rejects.
  const removeEntry = async (id) => {
    const prev = diary;
    setNote(null);
    setDiary((d) => ({ entries: (d.entries || []).filter((e) => e.id !== id), totals: null }));
    try {
      await api.deleteDiaryEntry(id);
    } catch (e) {
      setDiary(prev); // rollback to the pre-delete truth
      setNote(friendly(e, "Couldn't remove that entry — try again."));
    }
  };

  const over = macros?.kcal ? totals.kcal > macros.kcal : false;

  return (
    <Card section="DIARY" title="Food diary — what you actually ate" className="xl:col-span-12">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn small onClick={logPlanned} disabled={busy || !hasPlan}>
          <ClipboardCheck size={12} className="inline mr-1" />{busy ? "Working…" : "Ate as planned"}
        </Btn>
        <Btn small kind="ghost" onClick={() => { setAdding((a) => !a); setNote(null); }}>
          <Plus size={12} className="inline mr-1" />Add item
        </Btn>
        {!hasPlan && (
          <span className="text-[10.5px] font-semibold" style={{ color: C.faint }}>
            Generate a plan to enable "Ate as planned".
          </span>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-xl" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
          <input className="text-sm px-3 py-2 rounded-lg flex-1 min-w-[160px]" style={inpStyle} placeholder="Item name" aria-label="Item name"
            value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          {[["kcal", "kcal", "Calories"], ["proteinG", "P (g)", "Protein grams"], ["carbG", "C (g)", "Carb grams"], ["fatG", "F (g)", "Fat grams"]].map(([k, ph, name]) => (
            <input key={k} type="number" inputMode="decimal" className="text-sm px-2 py-2 rounded-lg w-20" style={inpStyle} placeholder={ph} aria-label={name}
              value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && !busy && submitEntry()} />
          ))}
          <Btn small onClick={submitEntry} disabled={busy}>{busy ? "…" : "Save"}</Btn>
        </div>
      )}

      {/* role="alert": food-logging feedback (save failures, validation) —
          ED-safety relevant that this reaches screen-reader users reliably. */}
      {note && <div role="alert" className="text-xs font-semibold mb-3" style={{ color: C.warn }}>{note}</div>}

      {diary === undefined ? (
        <SkeletonRows rows={3} />
      ) : diary === "error" ? (
        <ErrorNote msg="Couldn't load today's diary." hint="Switch tabs and back to retry; if it keeps failing, restart the app." />
      ) : entries.length === 0 ? (
        <EmptyNote icon={NotebookPen} title="Nothing logged today yet"
          hint={soon
            ? "Logging activates when the diary update ships — your plan and targets work as normal until then."
            : "Use “Ate as planned” to copy today’s plan, or add items as you eat."} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* eaten vs target */}
          <div className="lg:col-span-5">
            <div className="text-xs font-semibold" style={{ color: C.faint }}>Eaten today</div>
            <div className="mono stat-hero text-3xl" style={{ color: over ? C.warn : C.ink }}>
              {kc(totals.kcal)}
              <span className="text-xs ml-1" style={{ color: C.faint, fontWeight: 600, letterSpacing: 0 }}>/ {kc(macros?.kcal ?? 0)} kcal</span>
            </div>
            {over && (
              <div className="text-xs font-semibold mt-1 mb-2" style={{ color: C.warn }}>
                Over by {kc(totals.kcal - macros.kcal)} kcal — tomorrow&apos;s target already adjusts to your data.
              </div>
            )}
            <div className="flex flex-col gap-3 mt-3">
              <MacroBar label="Protein" actual={totals.protein} target={macros?.proteinHi ?? 0} color={C.protein} />
              <MacroBar label="Carb" actual={totals.carb} target={macros?.carbHi ?? 0} color={C.carb} />
              <MacroBar label="Fat" actual={totals.fat} target={macros?.fatHi ?? 0} color={C.fat} />
            </div>
          </div>
          {/* entries */}
          <div className="lg:col-span-7">
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-1" style={{ color: C.faint }}>
              {entries.length} item{entries.length === 1 ? "" : "s"} logged
            </div>
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2 row-host" style={{ borderBottom: `1px solid ${C.rule}` }}>
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: C.ink }}>{e.name}</div>
                  <div className="text-[10.5px] font-semibold" style={{ color: C.faint }}>
                    {[e.slotType, DIARY_SOURCE_LABEL[e.source] || e.source].filter(Boolean).join(" · ") || "logged"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="mono text-sm font-extrabold" style={{ color: C.ink }}>{kc(e.kcal || 0)}</span>
                  <span className="hidden md:flex gap-1">
                    <Chip color={C.proteinText} bg={`${C.protein}1F`}>{r1(e.proteinG || 0)}P</Chip>
                    <Chip color={C.fatText} bg={`${C.fat}1F`}>{r1(e.fatG || 0)}F</Chip>
                    <Chip color={C.carbText} bg={`${C.carb}1F`}>{r1(e.carbG || 0)}C</Chip>
                  </span>
                  <button onClick={() => removeEntry(e.id)} className="row-reveal" aria-label={`Remove ${e.name}`} style={{ color: C.faintLight }}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function TodayTab({ profile, summary, refresh, openTrend }) {
  const pref = profile.unitPref;
  const wUnit = weightUnit(pref);
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [wIn, setWIn] = useState("");
  const [dIn, setDIn] = useState(todayStr());
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none, "error" = fetch failed
  const [logBusy, setLogBusy] = useState(false);
  const [logMsg, setLogMsg] = useState(null);

  useEffect(() => {
    // Stage-C fix: distinguish a fetch error from "no plan yet" so a 500
    // doesn't render the misleading "no plan generated" empty state.
    api.getCurrentPlan().then(setPlan).catch(() => setPlan("error"));
  }, []);

  const { weighins, avg7Kg, rate, daysIn, verdict: v, macros, target } = summary;
  const sorted = [...weighins].sort((a, b) => a.date.localeCompare(b.date));

  const add = async () => {
    const w = parseFloat(wIn);
    const bounds = weightInputBounds(pref);
    // Stage-C fix: invalid input now says WHY instead of doing nothing silently.
    if (!w || w < bounds.min || w > bounds.max) {
      setLogMsg(`Enter a weight between ${bounds.min} and ${bounds.max} ${wUnit}.`);
      return;
    }
    setLogBusy(true); // Stage-C fix (M15): busy guard prevents a double-submit
    setLogMsg(null);
    try {
      await api.postWeighin(dIn, parseWeight(w, pref));
      setWIn("");
      await refresh();
    } catch (e) {
      setLogMsg(e.message || "Couldn't save that weigh-in — try again.");
    } finally {
      setLogBusy(false);
    }
  };
  const del = async (date) => {
    try {
      await api.deleteWeighin(date);
      await refresh();
    } catch (e) {
      setLogMsg(e.message || "Couldn't delete that entry — try again.");
    }
  };

  const daysSince = dayNum(todayStr()) - dayNum(profile.startDate);
  const photoDue = daysSince >= 28 && daysSince % 28 <= 2;
  const nextPhoto = addDays(profile.startDate, 28 * Math.ceil((daysSince + 0.1) / 28));

  const todaySlots = (plan && typeof plan === "object") ? plan.slots.filter((s) => s.dayOfWeek === isoWeekday()) : [];
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
            <div className="flex items-center gap-6">
              <Skeleton className="rounded-full shrink-0" style={{ width: 156, height: 156 }} />
              <div className="flex-1 flex flex-col gap-2.5">
                <Skeleton className="h-3" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          ) : plan === "error" ? (
            <div className="flex items-start gap-2">
              <CalendarDays size={18} style={{ color: C.red }} className="mt-0.5 shrink-0" />
              <div className="text-sm font-semibold" style={{ color: C.faint }}>
                Couldn't load this week's plan. Switch tabs and back to retry; if it keeps failing, restart the app.
              </div>
            </div>
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
              {kcalPct > 1 && (
                <div className="text-xs font-semibold mb-3" style={{ color: C.warn }}>
                  Over by {kc(planned.kcal - macros.kcal)} kcal — swap a slot on the Plan tab, and tomorrow's target already adjusts to your data.
                </div>
              )}
              <div className="flex flex-col gap-3">
                <MacroBar label="Protein" actual={planned.protein} target={macros.proteinHi} color={C.protein} />
                <MacroBar label="Carb" actual={planned.carb} target={macros.carbHi} color={C.carb} />
                <MacroBar label="Fat" actual={planned.fat} target={macros.fatHi} color={C.fat} />
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
              aria-label="Weigh-in date"
              className="text-sm px-3 py-2.5 rounded-xl w-full"
              style={inpStyle}
            />
            <div className="flex gap-2">
              <input
                type="number" inputMode="decimal" step="0.1" placeholder={wUnit}
                aria-label={`Weight (${wUnit})`}
                value={wIn} onChange={(e) => { setWIn(e.target.value); if (logMsg) setLogMsg(null); }}
                onKeyDown={(e) => e.key === "Enter" && !logBusy && add()}
                className="text-sm px-3 py-2.5 rounded-xl flex-1 min-w-0"
                style={inpStyle}
              />
              <Btn onClick={add} disabled={logBusy}>{logBusy ? "…" : "Log"}</Btn>
            </div>
            {/* role="alert": invalid-range / save-failure feedback for the
                weigh-in — must reach screen readers without hunting for it. */}
            {logMsg && <div role="alert" className="text-xs font-semibold" style={{ color: C.warn }}>{logMsg}</div>}
          </div>
        </Card>

        {/* ── food diary (planned vs. actually-eaten) ── */}
        <DiaryCard date={todayStr()} macros={macros} hasPlan={todaySlots.length > 0} />

        {/* ── trend snapshot ── */}
        <Card section="CURVE" title="Trend snapshot" className="xl:col-span-7">
          {sorted.length === 0 ? (
            <EmptyNote icon={LineChart} height={200} title="No weigh-ins yet"
              hint="Log your first weight above to start the curve." />
          ) : sorted.length < 2 ? (
            <EmptyNote icon={LineChart} height={200} title="First point logged"
              hint="The curve starts with your second weigh-in — log again tomorrow." />
          ) : (
            // a11y: Recharts' SVG has no built-in screen-reader semantics.
            // role="img" + a computed summary sentence on the wrapper give
            // AT users the same facts a sighted user reads off the curve;
            // the chart itself is then hidden so nothing is announced twice.
            <div
              role="img"
              aria-label={`Weight trend, last ${snapshot.length} entries: ${r1(snapshot[0].w)} ${wUnit} on ${snapshot[0].d}, most recently ${r1(snapshot[snapshot.length - 1].w)} ${wUnit} on ${snapshot[snapshot.length - 1].d}. 7-day average ${r1(snapshot[snapshot.length - 1].a)} ${wUnit}, goal ${r1(goalDisplay)} ${wUnit}.`}
              style={{ width: "100%", height: 200 }}
            >
              <div aria-hidden="true" style={{ width: "100%", height: "100%" }}>
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
                    <ReferenceLine y={goalDisplay} stroke={C.faint} strokeDasharray="6 4" />
                    <Line type="monotone" dataKey="w" stroke={C.faintLight} strokeWidth={1.5}
                      dot={{ r: 2, fill: C.faintLight, strokeWidth: 0 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="a" stroke={C.accent} strokeWidth={2.5}
                      dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="text-xs font-semibold" style={{ color: C.faint }}>
              thin = daily · heavy = 7-day average · dashed = goal
            </div>
            <button onClick={openTrend} className="text-xs font-bold flex items-center gap-1 hover:opacity-80" style={{ color: C.ink }}>
              Full trend <ArrowRight size={12} />
            </button>
          </div>
        </Card>

        {/* ── recent entries ── */}
        <Card section="LOG" title="Recent entries" className="xl:col-span-5">
          {sorted.length === 0 && (
            <EmptyNote title="No weigh-ins yet" hint="Log Day 1 above to start the log." />
          )}
          {[...sorted].reverse().slice(0, 8).map((e) => (
            <div key={e.date} className="flex items-center justify-between py-2"
              style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span className="text-sm font-semibold" style={{ color: C.faint }}>{fmtD(e.date)}</span>
              <span className="mono text-sm font-bold" style={{ color: C.ink }}>{displayWeight(e.weightKg, pref)} {wUnit}</span>
              <button onClick={() => del(e.date)} aria-label={`Delete weigh-in from ${fmtD(e.date)}`} style={{ color: C.faintLight }}>
                <Trash2 size={15} aria-hidden="true" />
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
