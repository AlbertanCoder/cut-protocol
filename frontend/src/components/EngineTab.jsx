import { useState, useEffect } from "react";
import { Database, ArrowRight } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, Stat, Btn, PageHead, ErrorNote } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");

// The brain: BMR formulas (with per-formula include toggles), the TDEE
// component math, and the rate-derived target — pure display + the formula
// toggles. All inputs live on the Profile tab.
export default function EngineTab({ profile, summary, refresh, openFoods, openProfile }) {
  const { energy, target, macros } = summary;
  const [error, setError] = useState(null);
  // Optimistic local copy so rapid formula toggles compose (same race as the
  // allergy toggles — M14). Re-syncs when the server truth changes.
  const [excludedLocal, setExcludedLocal] = useState(() => (Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : []));
  useEffect(() => { setExcludedLocal(Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : []); }, [profile.excludedFormulas]);

  const toggleFormula = async (key) => {
    const next = excludedLocal.includes(key) ? excludedLocal.filter((k) => k !== key) : [...excludedLocal, key];
    setExcludedLocal(next);
    setError(null);
    try {
      await api.putProfile({ excludedFormulas: next });
      await refresh();
    } catch (e) {
      // Stage-C fix (M15): a failed toggle used to be a silent unhandled
      // rejection. Surface it and roll the optimistic state back.
      setExcludedLocal(Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : []);
      setError(e.message);
    }
  };

  return (
    <div>
      <PageHead title="Engine" sub="The math. Every number derives from your Profile — change inputs there, watch it update here.">
        <Btn small kind="ghost" onClick={openFoods}>
          <Database size={12} className="inline mr-1" />Food database
        </Btn>
      </PageHead>

      {error && <div className="mb-3"><ErrorNote msg={error} hint="Your formula change didn't save — toggle it again." /></div>}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Card section="§1" title="BMR — the formula panel" className="xl:col-span-4">
          <div className="text-xs font-semibold mb-2" style={{ color: C.faint }}>
            Averaging {energy.includedCount} of {energy.rows.length} applicable formulas — untick any you distrust.
          </div>
          {energy.rows.map((r) => {
            const off = excludedLocal.includes(r.key); // optimistic; reflects the click immediately
            return (
            <label key={r.key} className="flex items-center justify-between py-1.5 cursor-pointer" style={{ borderBottom: `1px solid ${C.rule}`, opacity: off ? 0.45 : 1 }}>
              <span className="flex items-center gap-2.5 text-sm font-semibold" style={{ color: C.ink }}>
                <input type="checkbox" checked={!off} onChange={() => toggleFormula(r.key)} style={{ accentColor: C.accent }} />
                {r.label}
              </span>
              <span className="mono text-sm font-bold" style={{ color: C.ink, textDecoration: off ? "line-through" : "none" }}>{kc(r.v)}</span>
            </label>
            );
          })}
          {energy.allExcludedFallback && (
            <div className="text-xs font-bold mt-2" style={{ color: C.warn }}>
              Everything was excluded — falling back to all applicable formulas (an average needs members).
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 mt-2">
            <Stat label="BMR (average)" value={kc(energy.rmr)} unit="kcal" />
            <Stat label="Spread" value={`${kc(energy.spreadLo)}–${kc(energy.spreadHi)}`} unit="kcal" />
          </div>
          {profile.bodyFatPct === 0 && (
            <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
              Add body fat % on the Profile tab to unlock Katch–McArdle and Cunningham (the best two when BF is known).
            </div>
          )}
        </Card>

        <Card section="§2" title="TDEE — component build" className="xl:col-span-4">
          <div className="flex flex-col gap-2 text-sm font-semibold" style={{ color: C.ink }}>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span>BMR average</span><span className="mono font-extrabold">{kc(energy.rmr)}</span>
            </div>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span>× {energy.jobSource === "override" ? "manual multiplier" : energy.jobLabel}</span>
              <span className="mono font-extrabold">×{energy.jobMultiplier}</span>
            </div>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span>+ training ({profile.sessionsPerWeek}×{profile.minutesPerSession} min, {energy.trainingStyle}, MET {energy.trainingMet})</span>
              <span className="mono font-extrabold">+{kc(energy.trainingKcalPerDay)}</span>
            </div>
          </div>
          <div className="mt-3">
            <Stat label="TDEE — total daily burn" value={kc(energy.tdee)} unit="kcal" big />
          </div>
          <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
            Training kcal/day = sessions × minutes × MET × 3.5 × kg ÷ 200 ÷ 7.
          </div>
        </Card>

        <Card section="§3" title="Target — derived from your rate" className="xl:col-span-4">
          <div className="flex flex-col gap-2 text-sm font-semibold" style={{ color: C.ink }}>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span>TDEE</span><span className="mono font-extrabold">{kc(energy.tdee)}</span>
            </div>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span>− deficit for {target.rate} lb/wk</span><span className="mono font-extrabold">−{kc(target.deficit)}</span>
            </div>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span>floor (never below)</span><span className="mono font-extrabold">{kc(target.floor)}</span>
            </div>
          </div>
          <div className="mt-3">
            <Stat label="Daily target" value={kc(target.target)} unit="kcal" big />
          </div>
          {target.floored && (
            <div className="text-xs font-bold mt-1" style={{ color: C.warn }}>
              The raw math wanted {kc(target.raw)} — clamped to your floor. The chosen rate won't be fully reached through diet alone.
            </div>
          )}
          <button onClick={openProfile} className="text-xs font-bold flex items-center gap-1 mt-3 hover:opacity-80" style={{ color: C.accent }}>
            Change rate on Profile <ArrowRight size={12} />
          </button>
        </Card>

        <Card section="§4" title="Macro engine" className="xl:col-span-12">
          <div className="flex rounded-full overflow-hidden h-2.5 mb-3 gap-[2px] max-w-3xl">
            <div style={{ width: `${(macros.proteinHi * 4 / macros.kcal) * 100}%`, background: C.protein }}></div>
            <div style={{ width: `${(macros.fatHi * 9 / macros.kcal) * 100}%`, background: C.fat }}></div>
            <div style={{ width: `${(macros.carbHi * 4 / macros.kcal) * 100}%`, background: C.carb }}></div>
            <div className="flex-1" style={{ background: C.card2 }}></div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4">
            <Stat label="Protein range" value={`${macros.proteinLo}–${macros.proteinHi}`} unit="g" />
            <Stat label="Fat range" value={`${macros.fatLo}–${macros.fatHi}`} unit="g" />
            <Stat label="Carb range" value={`~${macros.carbLo}–${macros.carbHi}`} unit="g" />
            <Stat label="Fiber" value="25+" unit="g" />
          </div>
          <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
            For target {kc(macros.kcal)} · protein and calories are load-bearing walls · fat is a floor · carbs flex.
            {profile.bodyFatPct === 0 && " Protein/fat ranges assume LBM = body weight until you add a body fat %."}
          </div>
          {macros.macroKcalGap > 0 && (
            <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
              Ranges sum ~{kc(macros.kcal - macros.macroKcalGap)} kcal at midpoint ({macros.macroKcalGap} under target) — {macros.carbBufferG}g deliberately trimmed off the carb midpoint as a conservatism margin.
            </div>
          )}
        </Card>
      </div>

      <details className="px-1 mt-4">
        <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer" style={{ color: C.faintLight }}>
          Data backup (copy this JSON)
        </summary>
        <pre className="text-xs mt-2 p-3 rounded-xl overflow-x-auto"
          style={{ background: C.card, border: `1px solid ${C.rule}`, color: C.ink }}>
          {JSON.stringify({ profile, summary }, null, 1)}
        </pre>
      </details>
    </div>
  );
}
