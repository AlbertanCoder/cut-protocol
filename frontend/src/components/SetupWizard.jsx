import { useState, useEffect, useMemo } from "react";
import { TrendingDown, ArrowRight, ArrowLeft, Check, Search, AlertTriangle } from "lucide-react";
import { C } from "../lib/theme.js";
import { parseWeight, parseHeight, weightUnit, heightUnit } from "../lib/units.js";
import { Btn } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const STEPS = ["Units & Stats", "Activity", "Diet", "Rate"];

// First-ever-launch setup. Collects the same fields the Profile tab edits,
// writes them in one putProfile at the end. Unsafe rates surface the same
// "I understand" contract the Profile tab enforces (422 → ack → resend).
export default function SetupWizard({ onDone }) {
  const [meta, setMeta] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ackReasons, setAckReasons] = useState(null);
  const [acked, setAcked] = useState(false);
  const [occQuery, setOccQuery] = useState("");

  const [d, setD] = useState({
    unitPref: "imperial",
    sex: "M", age: "", height: "", weight: "", bf: "", goal: "",
    occupationKey: "desk-office", sessions: 3, trainingStyle: "mixed", minutes: 45,
    dietaryStyle: "none", allergies: [], custom: "",
    mealsPerDay: 3, snacksPerDay: 1,
    rate: 1.0,
  });
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    api.getProfileMeta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  const pref = d.unitPref;
  const statsValid = +d.age >= 14 && +d.age <= 100 && +d.height > 0 && +d.weight > 0 && +d.goal > 0;

  // Client-side taste of the safety rail: rate vs ~1% of entered body weight.
  // The server re-checks properly (including the floor) on submit.
  const ratePctOfBw = useMemo(() => {
    if (!+d.weight) return null;
    const weightLb = pref === "metric" ? +d.weight * 2.20462 : +d.weight;
    return (d.rate / weightLb) * 100;
  }, [d.weight, d.rate, pref]);
  const rateLooksAggressive = ratePctOfBw != null && ratePctOfBw > 1.0;

  const buildPatch = () => ({
    unitPref: d.unitPref,
    sex: d.sex,
    age: +d.age,
    heightCm: parseHeight(+d.height, pref),
    ...(d.bf !== "" ? { bodyFatPct: +d.bf } : { bodyFatPct: 0 }),
    startWeightKg: parseWeight(+d.weight, pref),
    goalWeightKg: parseWeight(+d.goal, pref),
    occupationKey: d.occupationKey,
    sessionsPerWeek: +d.sessions || 0,
    trainingStyle: d.trainingStyle,
    minutesPerSession: +d.minutes || 0,
    dietaryStyle: d.dietaryStyle === "none" ? null : d.dietaryStyle,
    excludedFoods: [...d.allergies, ...d.custom.split(",").map((x) => x.trim()).filter(Boolean)],
    mealsPerDay: +d.mealsPerDay || 3,
    snacksPerDay: +d.snacksPerDay || 0,
    rateLbPerWeek: d.rate,
  });

  const finish = async (skipAll) => {
    setBusy(true);
    setError(null);
    try {
      if (skipAll) {
        await api.putProfile({});
      } else {
        await api.putProfile({ ...buildPatch(), ...(acked ? { rateAcknowledged: true } : {}) });
      }
      await onDone();
      return;
    } catch (e) {
      if (e.status === 422 && e.body?.requiresAck) {
        setAckReasons(e.body.reasons);
      } else {
        setError(e.message);
      }
      setBusy(false);
    }
  };

  const filteredOcc = useMemo(() => {
    if (!meta) return [];
    const q = occQuery.trim().toLowerCase();
    return q ? meta.occupations.filter((o) => o.label.toLowerCase().includes(q)) : meta.occupations;
  }, [meta, occQuery]);

  const inp = "text-sm px-3 py-2.5 rounded-xl w-full mt-1";
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const label = (t) => <span className="text-xs font-bold" style={{ color: C.faint }}>{t}</span>;

  return (
    <div className="min-h-svh flex items-center justify-center px-6 py-10" style={{ background: C.paper }}>
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: C.accent }}>
            <TrendingDown size={22} strokeWidth={2.8} style={{ color: C.accentInk }} />
          </div>
          <div className="leading-none">
            <div className="font-black text-lg uppercase" style={{ color: C.ink }}>Cut Protocol</div>
            <div className="text-[11px] font-bold uppercase mt-1" style={{ color: C.faintLight, letterSpacing: ".08em" }}>First-run setup</div>
          </div>
        </div>

        <div className="flex gap-2 mb-5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className="h-1.5 rounded-full mb-1.5" style={{ background: i <= step ? C.accent : C.card2 }}></div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: i === step ? C.accent : C.faintLight }}>{s}</div>
            </div>
          ))}
        </div>

        <div className="p-6 rounded-2xl" style={{ background: C.card, border: `1px solid ${C.rule}`, boxShadow: "var(--shadow)" }}>
          {step === 0 && (
            <>
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Units & stats</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                Everything the engine computes flows from these — all editable later on the Profile tab.
              </div>
              <div className="flex gap-1.5 mb-4 max-w-xs">
                {["imperial", "metric"].map((u) => (
                  <button key={u} onClick={() => set({ unitPref: u })}
                    className="flex-1 text-xs font-bold py-2 rounded-xl"
                    style={{ background: pref === u ? C.accent : C.card2, color: pref === u ? C.accentInk : C.faint, border: `1px solid ${pref === u ? C.accent : C.rule}` }}>
                    {u === "imperial" ? "lb / in" : "kg / cm"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="block">{label("Sex")}
                  <select value={d.sex} onChange={(e) => set({ sex: e.target.value })} className={inp} style={inpStyle}>
                    <option value="M">Male</option><option value="F">Female</option>
                  </select>
                </label>
                <label className="block">{label("Age")}
                  <input type="number" value={d.age} onChange={(e) => set({ age: e.target.value })} className={inp} style={inpStyle} placeholder="30" />
                </label>
                <label className="block">{label(`Height (${heightUnit(pref)})`)}
                  <input type="number" value={d.height} onChange={(e) => set({ height: e.target.value })} className={inp} style={inpStyle} placeholder={pref === "metric" ? "178" : "70"} />
                </label>
                <label className="block">{label(`Current weight (${weightUnit(pref)})`)}
                  <input type="number" value={d.weight} onChange={(e) => set({ weight: e.target.value })} className={inp} style={inpStyle} placeholder={pref === "metric" ? "90" : "200"} />
                </label>
                <label className="block">{label("Body fat % (optional)")}
                  <input type="number" value={d.bf} onChange={(e) => set({ bf: e.target.value })} className={inp} style={inpStyle} placeholder="unknown" />
                </label>
                <label className="block">{label(`Goal weight (${weightUnit(pref)})`)}
                  <input type="number" value={d.goal} onChange={(e) => set({ goal: e.target.value })} className={inp} style={inpStyle} placeholder={pref === "metric" ? "82" : "180"} />
                </label>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Activity</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                Your job drives the daily multiplier; training adds its own energy on top.
              </div>
              <label className="block mb-1">{label("Occupation")}</label>
              <div className="relative mb-1.5">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
                <input placeholder="Search occupations…" value={occQuery} onChange={(e) => setOccQuery(e.target.value)}
                  className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle} />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-xl mb-4" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
                {filteredOcc.map((o) => (
                  <button key={o.key} onClick={() => set({ occupationKey: o.key })}
                    className="w-full text-left px-3 py-2 text-sm font-semibold flex justify-between gap-2"
                    style={{ color: d.occupationKey === o.key ? C.accent : C.ink, background: d.occupationKey === o.key ? C.accentBg : "transparent", borderBottom: `1px solid ${C.rule}` }}>
                    <span className="truncate">{o.label}</span>
                    <span className="mono text-xs shrink-0" style={{ color: C.faintLight }}>×{o.multiplier}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">{label("Training style")}
                  <select value={d.trainingStyle} onChange={(e) => set({ trainingStyle: e.target.value })} className={inp} style={inpStyle}>
                    {(meta?.trainingStyles || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <label className="block">{label("Sessions / week")}
                  <input type="number" min={0} max={14} value={d.sessions} onChange={(e) => set({ sessions: e.target.value })} className={inp} style={inpStyle} />
                </label>
                <label className="block">{label("Minutes / session")}
                  <input type="number" min={0} max={300} value={d.minutes} onChange={(e) => set({ minutes: e.target.value })} className={inp} style={inpStyle} />
                </label>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Diet & allergies</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                These hard-filter every meal plan, the recipe library, and AI generation.
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <label className="block">{label("Dietary style")}
                  <select value={d.dietaryStyle} onChange={(e) => set({ dietaryStyle: e.target.value })} className={inp} style={inpStyle}>
                    {(meta?.dietaryStyles || ["none"]).map((s) => (
                      <option key={s} value={s}>{s === "none" ? "None (no restriction)" : s[0].toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">{label("Custom exclusions (comma-separated)")}
                  <input type="text" value={d.custom} onChange={(e) => set({ custom: e.target.value })} className={inp} style={inpStyle} placeholder="e.g. cilantro" />
                </label>
              </div>
              <div className="mb-1">{label("Allergies")}</div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1.5 mb-4">
                {(meta?.allergyOptions || []).map((a) => (
                  <label key={a.key} className="flex items-center gap-2 text-sm font-semibold cursor-pointer" style={{ color: C.ink }}>
                    <input type="checkbox" checked={d.allergies.includes(a.key)}
                      onChange={() => set({ allergies: d.allergies.includes(a.key) ? d.allergies.filter((k) => k !== a.key) : [...d.allergies, a.key] })}
                      className="w-4 h-4" style={{ accentColor: C.accent }} />
                    {a.label}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-xs">
                <label className="block">{label("Meals / day")}
                  <input type="number" min={1} max={8} value={d.mealsPerDay} onChange={(e) => set({ mealsPerDay: e.target.value })} className={inp} style={inpStyle} />
                </label>
                <label className="block">{label("Snacks / day")}
                  <input type="number" min={0} max={8} value={d.snacksPerDay} onChange={(e) => set({ snacksPerDay: e.target.value })} className={inp} style={inpStyle} />
                </label>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Rate of loss</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                Your calorie target derives from this: TDEE minus the deficit this rate needs, never below the safety floor.
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(meta?.rateOptions || []).map((r) => (
                  <button key={r} onClick={() => { set({ rate: r }); setAcked(false); setAckReasons(null); }}
                    className="px-4 py-2.5 rounded-xl text-center"
                    style={{ background: d.rate === r ? C.accent : C.card2, border: `1px solid ${d.rate === r ? C.accent : C.rule}` }}>
                    <div className="mono text-sm font-extrabold" style={{ color: d.rate === r ? C.accentInk : C.ink }}>{r} lb/wk</div>
                    <div className="text-[10px] font-bold" style={{ color: d.rate === r ? C.accentInk : C.faintLight }}>{Math.round(r * 45.3592) / 100} kg/wk</div>
                  </button>
                ))}
              </div>
              {(rateLooksAggressive || ackReasons) && (
                <div className="p-3.5 rounded-xl mb-2" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} style={{ color: C.warn }} className="mt-0.5 shrink-0" />
                    <div>
                      {ackReasons ? (
                        ackReasons.map((r, i) => <div key={i} className="text-xs font-semibold mb-0.5" style={{ color: C.ink }}>· {r}</div>)
                      ) : (
                        <div className="text-xs font-semibold" style={{ color: C.ink }}>
                          {d.rate} lb/wk is {ratePctOfBw.toFixed(2)}% of your body weight per week — above the ~1% guideline.
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-xs font-bold mt-2 cursor-pointer" style={{ color: C.warn }}>
                        <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} style={{ accentColor: C.warn }} />
                        I understand the risks of this rate
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <div className="text-xs font-semibold mt-4" style={{ color: C.red }}>{error}</div>}

          <div className="flex items-center justify-between mt-6">
            <div>
              {step > 0 && (
                <Btn kind="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                  <ArrowLeft size={13} className="inline mr-1" />Back
                </Btn>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={() => finish(true)} disabled={busy}
                className="text-xs font-semibold hover:opacity-80" style={{ color: C.faintLight }}>
                Skip — use defaults
              </button>
              {step < STEPS.length - 1 ? (
                <Btn onClick={() => setStep(step + 1)} disabled={busy || (step === 0 && !statsValid)}>
                  Next<ArrowRight size={13} className="inline ml-1" />
                </Btn>
              ) : (
                <Btn onClick={() => finish(false)} disabled={busy || ((rateLooksAggressive || ackReasons) && !acked)}>
                  <Check size={13} className="inline mr-1" />{busy ? "Saving…" : "Finish setup"}
                </Btn>
              )}
            </div>
          </div>
        </div>

        {step === 0 && !statsValid && (d.age || d.height || d.weight) && (
          <div className="text-[11px] font-semibold mt-3 px-1" style={{ color: C.faintLight }}>
            Age 14–100, and height / current weight / goal weight all filled to continue.
          </div>
        )}
      </div>
    </div>
  );
}
