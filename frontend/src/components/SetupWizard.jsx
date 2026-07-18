import { useState } from "react";
import { TrendingDown, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { C } from "../lib/theme.js";
import { in2cm, lb2kg } from "../lib/units.js";
import { JOB, JOB_LABEL } from "../data/constants.js";
import { Btn } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const STEPS = ["Stats", "Activity", "Diet"];

// First-ever-launch setup: shown when the account has no profile row yet.
// Collects the same fields the Profile tab edits, writes them in one
// putProfile at the end. Deep profile rebuild (job picker, safety rails)
// is Phase 3 — this walks through what the backend supports today.
export default function SetupWizard({ onDone }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [d, setD] = useState({
    sex: "M", age: "", heightIn: "", startLb: "", bf: "", goalLb: "",
    job: "mixed", sessions: 3,
    dietaryStyle: "", excludedFoods: "", mealsPerDay: 3, snacksPerDay: 1,
  });
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));

  const statsValid = +d.age >= 14 && +d.age <= 100 && +d.heightIn >= 48 && +d.heightIn <= 90
    && +d.startLb >= 80 && +d.startLb <= 500 && +d.goalLb >= 80 && +d.goalLb <= 500;

  const finish = async (skipAll) => {
    setBusy(true);
    setError(null);
    try {
      if (skipAll) {
        await api.putProfile({});
      } else {
        await api.putProfile({
          sex: d.sex,
          age: +d.age,
          heightCm: in2cm(+d.heightIn),
          ...(d.bf !== "" ? { bodyFatPct: +d.bf } : {}),
          startWeightKg: lb2kg(+d.startLb),
          goalWeightKg: lb2kg(+d.goalLb),
          job: d.job,
          sessionsPerWeek: +d.sessions || 0,
          dietaryStyle: d.dietaryStyle || null,
          excludedFoods: d.excludedFoods.split(",").map((x) => x.trim()).filter(Boolean),
          mealsPerDay: +d.mealsPerDay || 3,
          snacksPerDay: +d.snacksPerDay || 0,
        });
      }
      await onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

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

        {/* step rail */}
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
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Your stats</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                Everything the engine computes flows from these. You can change any of them later on the Profile tab.
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
                <label className="block">{label("Height (inches)")}
                  <input type="number" value={d.heightIn} onChange={(e) => set({ heightIn: e.target.value })} className={inp} style={inpStyle} placeholder="70" />
                </label>
                <label className="block">{label("Current weight (lb)")}
                  <input type="number" value={d.startLb} onChange={(e) => set({ startLb: e.target.value })} className={inp} style={inpStyle} placeholder="200" />
                </label>
                <label className="block">{label("Body fat % (optional)")}
                  <input type="number" value={d.bf} onChange={(e) => set({ bf: e.target.value })} className={inp} style={inpStyle} placeholder="20" />
                </label>
                <label className="block">{label("Goal weight (lb)")}
                  <input type="number" value={d.goalLb} onChange={(e) => set({ goalLb: e.target.value })} className={inp} style={inpStyle} placeholder="180" />
                </label>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Activity</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                Job class + training frequency drive the TDEE multiplier.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">{label("Job / daily activity")}
                  <select value={d.job} onChange={(e) => set({ job: e.target.value })} className={inp} style={inpStyle}>
                    {Object.keys(JOB).map((k) => <option key={k} value={k}>{JOB_LABEL[k]}</option>)}
                  </select>
                </label>
                <label className="block">{label("Training sessions / week")}
                  <input type="number" min={0} max={14} value={d.sessions} onChange={(e) => set({ sessions: e.target.value })} className={inp} style={inpStyle} />
                </label>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Diet & meals</div>
              <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
                Dietary style and exclusions hard-filter every meal plan and AI recipe.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">{label("Dietary style")}
                  <select value={d.dietaryStyle} onChange={(e) => set({ dietaryStyle: e.target.value })} className={inp} style={inpStyle}>
                    <option value="">None (no restriction)</option>
                    <option value="vegan">Vegan</option>
                    <option value="vegetarian">Vegetarian</option>
                    <option value="paleo">Paleo</option>
                    <option value="carnivore">Carnivore</option>
                    <option value="keto">Keto</option>
                  </select>
                </label>
                <label className="block">{label("Allergies / exclusions (comma-separated)")}
                  <input type="text" value={d.excludedFoods} onChange={(e) => set({ excludedFoods: e.target.value })} className={inp} style={inpStyle} placeholder="e.g. shellfish, kiwi" />
                </label>
                <label className="block">{label("Meals / day")}
                  <input type="number" min={1} max={8} value={d.mealsPerDay} onChange={(e) => set({ mealsPerDay: e.target.value })} className={inp} style={inpStyle} />
                </label>
                <label className="block">{label("Snacks / day")}
                  <input type="number" min={0} max={8} value={d.snacksPerDay} onChange={(e) => set({ snacksPerDay: e.target.value })} className={inp} style={inpStyle} />
                </label>
              </div>
            </>
          )}

          {error && <div className="text-xs font-semibold mt-4" style={{ color: C.red }}>{error}</div>}

          <div className="flex items-center justify-between mt-6">
            <div className="flex gap-2">
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
                <Btn onClick={() => finish(false)} disabled={busy}>
                  <Check size={13} className="inline mr-1" />{busy ? "Saving…" : "Finish setup"}
                </Btn>
              )}
            </div>
          </div>
        </div>

        {step === 0 && !statsValid && (d.age || d.heightIn || d.startLb) && (
          <div className="text-[11px] font-semibold mt-3 px-1" style={{ color: C.faintLight }}>
            Age 14–100 · height 48–90 in · weights 80–500 lb — fill all four to continue.
          </div>
        )}
      </div>
    </div>
  );
}
