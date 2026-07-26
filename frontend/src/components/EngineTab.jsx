import { useState, useEffect } from "react";
import { Database, ArrowRight, Check, Info } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, Stat, Btn, PageHead, ErrorNote } from "./ui/Parts.jsx";
import AdaptiveTdeeCard from "./AdaptiveTdeeCard.jsx";
import { api, isAbortError, isNoAnswer, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";

// Guarded: an undefined/NaN kcal used to render the literal string "NaN" into
// a sentence ("From the formula alone this would be NaN"). A number we don't
// have is an em dash, never a fake one.
const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-CA") : "—");
const signed = (n) => (Number.isFinite(n) ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("en-CA")}` : "—");

// One shown-math row: plain-English label left, tabular number right.
const Line = ({ label, value, tone, strong }) => (
  <div className="flex justify-between items-baseline gap-4 py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
    <span className="text-sm font-semibold" style={{ color: tone || C.ink }}>{label}</span>
    <span className={`mono text-sm shrink-0 ${strong ? "font-extrabold" : "font-bold"}`} style={{ color: tone || C.ink }}>{value}</span>
  </div>
);

// Formula include/exclude checkbox. Law a: green is reserved for
// on-target/primary-action/success — six bright green ticks were the loudest
// thing on this tab. Selection is a LIGHTNESS step (--card-2 fill +
// --faint-light border) with an ink tick, per the design constitution. The
// real <input> is still the control (keyboard, screen readers); only its
// painting is ours.
const FormulaCheck = ({ checked, disabled, onChange, label }) => (
  <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: 15, height: 15 }}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      style={{
        appearance: "none", WebkitAppearance: "none", margin: 0,
        width: 15, height: 15, borderRadius: 4,
        background: checked ? C.card2 : "transparent",
        border: `1px solid ${checked ? C.faintLight : C.rule}`,
        cursor: disabled ? "default" : "pointer",
      }}
    />
    {checked && <Check size={11} strokeWidth={3.25} className="absolute pointer-events-none" style={{ color: C.ink }} aria-hidden="true" />}
  </span>
);

// The brain: BMR formulas (with per-formula include toggles), the TDEE
// component math, and the rate-derived target — pure display + the formula
// toggles. All inputs live on the Profile tab.
export default function EngineTab({ profile, summary, refresh, openFoods, openProfile }) {
  const { energy, target, macros } = summary;
  // Which expenditure the target was actually built from — the adaptive
  // reconciliation when it had enough data, the formula otherwise.
  const adaptiveOn = Boolean(summary.adaptive?.inEffect);
  const effectiveTdee = summary.adaptive?.effectiveTdee ?? energy.tdee;
  // The ±125 kcal/cycle step cap. The server has always computed and shipped
  // this (stepCap.reason, ledger[].capped/capReason/remainingKcal) and the
  // screen rendered none of it — so the Engine printed "3,400 − 500 · floor
  // 1,800 → Daily target 2,425", arithmetic that does not produce its own
  // answer. Every intermediate below is now on screen.
  const cap = summary.stepCap || null;
  const capped = Boolean(cap?.capped);
  const indicated = Number.isFinite(cap?.indicatedKcal) ? cap.indicatedKcal : target.indicatedTargetKcal;
  // Body fat unknown means null OR 0 — the engine treats them identically
  // (bmrEngine bmrRows/computeMacros), and `bfAssumed` is that same fact
  // computed server-side. Gating on `bodyFatPct === 0` alone left a null-BF
  // profile with neither the assumption note nor the Katch–McArdle hint.
  const bfAssumed = macros.bfAssumed ?? (profile.bodyFatPct == null || profile.bodyFatPct === 0);
  const noData = (summary.weighins?.length ?? 0) === 0;
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null); // used here only for the protein-floor citation
  const [savingKey, setSavingKey] = useState(null);
  const abort = useAbortSignal();
  // Citation text only — a failed fetch hides one paragraph and nothing else,
  // so it stays silent by design (no data is misrepresented by its absence).
  useEffect(() => {
    api.getProfileMeta({ signal: abort.signal }).then(setMeta).catch(() => {});
  }, [abort]);
  // Optimistic local copy so rapid formula toggles compose (same race as the
  // allergy toggles — M14). Re-syncs when the server truth changes.
  const [excludedLocal, setExcludedLocal] = useState(() => (Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : []));
  useEffect(() => { setExcludedLocal(Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : []); }, [profile.excludedFormulas]);

  const toggleFormula = async (key) => {
    const truth = Array.isArray(profile.excludedFormulas) ? profile.excludedFormulas : [];
    const next = excludedLocal.includes(key) ? excludedLocal.filter((k) => k !== key) : [...excludedLocal, key];
    setExcludedLocal(next);
    setError(null);
    setSavingKey(key);
    try {
      await api.putProfile({ excludedFormulas: next }, { signal: abort.signal });
      await refresh();
    } catch (e) {
      if (isAbortError(e)) return;
      // Stage-C fix (M15): a failed toggle used to be a silent unhandled
      // rejection. Surface it and roll the optimistic state back — and say
      // whether the server refused it or never answered (they are not the
      // same fact).
      setExcludedLocal(truth);
      setError(isNoAnswer(e)
        ? `${describeError(e)} The checkbox has been put back to the last confirmed setting.`
        : describeError(e));
    } finally {
      setSavingKey(null);
    }
  };

  // Macro strip widths. The old bar divided each range's HIGH end by the target
  // — protein 200g + fat 64g + carb 276g on a 2,400 kcal target is 2,480 kcal,
  // 103% of the whole — and flexbox silently shrank all three to fit, collapsing
  // the "rest" segment to zero. So the bar ALWAYS looked exactly full, with
  // quietly renormalised ratios. Widths now come off the MIDPOINTS (the numbers
  // the target is actually budgeted from) over a denominator that can never be
  // smaller than their sum, and the leftover segment gets an explicit width so
  // "no room left" can render as no room left.
  const midG = {
    p: (macros.proteinLo + macros.proteinHi) / 2,
    f: (macros.fatLo + macros.fatHi) / 2,
    c: macros.carbMid ?? (macros.carbLo + macros.carbHi) / 2,
  };
  const midKcal = { p: midG.p * 4, c: midG.c * 4, f: midG.f * 9 };
  const macroSum = midKcal.p + midKcal.c + midKcal.f;
  const barDenom = Math.max(macros.kcal || 0, macroSum) || 1;
  const w = (k) => `${(midKcal[k] / barDenom) * 100}%`;
  const restPct = Math.max(0, 100 - ((macroSum / barDenom) * 100));

  return (
    <div>
      <PageHead title="Engine" sub="The math. Every number derives from your Profile — change inputs there, watch it update here.">
        <Btn small kind="ghost" onClick={openFoods}>
          <Database size={12} className="inline mr-1" />Food database
        </Btn>
      </PageHead>

      {error && <div className="mb-3"><ErrorNote msg={error} hint="Your formula change didn't save — toggle it again." /></div>}

      {/* Empty state. A brand-new user used to land on four sections of numbers
          with nothing telling them what the screen is for or that it needs
          nothing from them. */}
      {noData && (
        <div className="mb-4 p-3.5 rounded-xl flex items-start gap-2.5" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
          <Info size={15} className="mt-0.5 shrink-0" style={{ color: C.faint }} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs font-bold" style={{ color: C.ink }}>There is nothing to do on this screen.</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: C.faint }}>
              It shows, step by step, how your daily calorie target was worked out from what you entered on
              Profile — the formulas, your job and training, your rate, and your floor. Change an input on
              Profile and every number here moves with it. Once you have weigh-ins and a food log, this screen
              also shows how your own data adjusts the estimate.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Card section="Step 1" title="BMR — the formula panel" className="xl:col-span-4">
          {/* "BMR" was used as a bare acronym on every row of this card, in the
              card title, and again in Step 2, and was never once expanded. Step
              2 glosses TDEE ("total daily burn") in its Stat label; this is the
              same courtesy for the term the whole tab is built on. */}
          <div className="text-xs font-semibold mb-2" style={{ color: C.faint }}>
            BMR — basal metabolic rate: the energy you&apos;d burn in a day at complete rest, before your job,
            your training or digestion. Averaging {energy.includedCount} of {energy.rows.length} applicable
            formulas — untick any you distrust.
          </div>
          {energy.rows.map((r) => {
            // Flip-aware (E1): excludedFormulas membership FLIPS a formula from its
            // default. Legacy 6 are default-on (present → off); the 4 added are
            // default-off (absent → off, present → on). Optimistic: reflects the click.
            const inList = excludedLocal.includes(r.key);
            const off = r.defaultOn ? inList : !inList;
            const cite = r.prov?.citation;
            return (
            <div key={r.key} style={{ borderBottom: `1px solid ${C.rule}`, opacity: off ? 0.45 : 1 }}>
              <label className="flex items-center justify-between pt-1.5">
                <span className="flex items-center gap-2.5 text-sm font-semibold" style={{ color: C.ink }}>
                  <FormulaCheck checked={!off} disabled={savingKey === r.key} label={`Include ${r.label} in the average`}
                    onChange={() => toggleFormula(r.key)} />
                  {r.label}
                  {savingKey === r.key && <span className="text-[10px] font-bold" style={{ color: C.warn }}>saving…</span>}
                </span>
                <span className="mono text-sm font-bold" style={{ color: C.ink, textDecoration: off ? "line-through" : "none" }}>{kc(r.v)}</span>
              </label>
              {cite && (
                // Provenance (Law 3): journal + year, and the honest independence
                // note where one exists — the "show the math" trust signal.
                <div className="text-[10px] font-medium pb-1.5 pl-[26px]" style={{ color: C.faint }}>
                  {[cite.journal, cite.year].filter(Boolean).join(" · ")}{cite.note ? ` — ${cite.note}` : ""}
                </div>
              )}
            </div>
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
          {energy.spreadPct > 0 && (
            <div className="text-[11px] font-semibold mt-1" style={{ color: C.faint }}>
              ±{energy.sd} kcal across formulas ({energy.spreadPct}% range). Dispersion, not a confidence interval — some estimators share a dataset or body-composition form.
            </div>
          )}
          {bfAssumed && (
            <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
              Add body fat % on the Profile tab to unlock Katch–McArdle and Cunningham (the best two when BF is known).
            </div>
          )}
        </Card>

        <Card section="Step 2" title="TDEE — component build" className="xl:col-span-4">
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
          {/* The formula printed "MET" as a bare symbol and the row above it
              printed "MET 6" as a bare number. It is the one term on this card a
              reader cannot look up from context. */}
          <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
            Training kcal/day = sessions × minutes × MET × 3.5 × kg ÷ 200 ÷ 7. A MET (metabolic equivalent of
            task) is how many times harder than sitting still an activity is — MET 6 burns six times resting
            rate, so heavier training styles score higher.
          </div>
          {adaptiveOn && (
            <div className="text-xs font-semibold mt-1" style={{ color: C.warn }}>
              This is the population estimate. Your own intake and scale put it nearer {kc(effectiveTdee)} — that is
              what your target uses. The reconciliation is in Step 2 detail, below.
            </div>
          )}
        </Card>

        <Card section="Step 3" title="Target — derived from your rate" className="xl:col-span-4">
          <div className="flex flex-col gap-2" style={{ color: C.ink }}>
            <Line
              label={adaptiveOn ? "Best estimate of your burn (Step 2 detail)" : "TDEE (formula)"}
              value={kc(effectiveTdee)}
            />
            <Line label={`− deficit for ${target.rate} lb/wk`} value={`−${kc(target.deficit)}`} />
            <Line label="= what the deficit math comes to" value={kc(target.raw)} strong />
            <Line label="your floor (never below)" value={kc(target.floor)} />
            {target.floored && <Line label="= lifted to your floor" value={kc(target.floor)} strong />}
            {capped && (
              <>
                <Line label="= what your data asks for this week" value={kc(indicated)} strong />
                <Line label="last week's target" value={kc(cap.previousKcal)} />
                <Line label={`most it may move in one week (±${kc(cap.capKcal)})`} value={signed(cap.appliedChangeKcal)} tone={C.warn} />
              </>
            )}
          </div>
          <div className="mt-3">
            <Stat label="Daily target" value={kc(target.target)} unit="kcal" big />
          </div>
          {capped && (
            // The explanation the server has always computed and the screen
            // never showed. Constitution: every automatic adjustment is logged,
            // visible and reversible.
            <div className="text-xs font-bold mt-1" style={{ color: C.warn }}>
              {cap.reason
                ? cap.reason[0].toUpperCase() + cap.reason.slice(1)
                : `Held to ±${kc(cap.capKcal)} kcal a week.`}
              {Number.isFinite(cap.remainingKcal) && cap.remainingKcal !== 0 && (
                <> Still to come: {kc(Math.abs(cap.remainingKcal))} kcal, over about {cap.cyclesToConverge} more weekly update{cap.cyclesToConverge === 1 ? "" : "s"}.</>
              )}
            </div>
          )}
          {target.floored && (
            <div className="text-xs font-bold mt-1" style={{ color: C.warn }}>
              The raw math wanted {kc(target.raw)} — clamped to your floor. At {kc(target.target)} you'll lose
              about {target.achievableRate} lb/wk through food alone, not the {target.rate} you picked. To go
              faster, add movement — not less food.
            </div>
          )}
          {adaptiveOn && Number.isFinite(summary.adaptive.formulaTarget?.target) && (
            <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
              From the formula alone this would be {kc(summary.adaptive.formulaTarget.target)} — every
              adjustment is listed in Step 2 detail and reverses if you correct the entries behind it.
            </div>
          )}
          <button onClick={openProfile} className="text-xs font-bold flex items-center gap-1 mt-3 hover:opacity-80" style={{ color: C.ink }}>
            Change rate on Profile <ArrowRight size={12} />
          </button>
        </Card>

        <AdaptiveTdeeCard profile={profile} summary={summary} target={target} />

        <Card section="Step 4" title="Macro engine" className="xl:col-span-12">
          {/* Decorative — the same three macro values are already stated as
              text in the Stat grid + legend right below, so the bar itself
              is hidden from screen readers rather than read as unlabeled
              colored slices. Order is the P/C/F macro-triad doc order, matching
              the legend and every other screen. */}
          <div className="flex rounded-full overflow-hidden h-2.5 mb-1.5 gap-[2px] max-w-3xl" aria-hidden="true">
            <div style={{ width: w("p"), background: C.protein }}></div>
            <div style={{ width: w("c"), background: C.carb }}></div>
            <div style={{ width: w("f"), background: C.fat }}></div>
            <div style={{ width: `${restPct}%`, background: C.card2 }}></div>
          </div>
          <div className="flex items-center gap-4 mb-3 text-[10px] font-extrabold uppercase">
            <span style={{ color: C.proteinText }}>P · protein</span>
            <span style={{ color: C.carbText }}>C · carbs</span>
            <span style={{ color: C.fatText }}>F · fat</span>
            <span style={{ color: C.faint }}>rest · flex</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4">
            <Stat label="Protein range" value={`${macros.proteinLo}–${macros.proteinHi}`} unit="g" />
            <Stat label="Fat range" value={`${macros.fatLo}–${macros.fatHi}`} unit="g" />
            <Stat label="Carb range" value={`~${macros.carbLo}–${macros.carbHi}`} unit="g" />
            <Stat label="Fiber" value="25+" unit="g" />
          </div>
          <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
            For target {kc(macros.kcal)} · protein and calories are load-bearing walls · fat is a floor · carbs flex.
            {/* The old line said "ranges assume LBM = body weight until you add a
                body fat %", which is not what the engine does: it assumes a
                sex-typical 21% (M) / 28% (F). For a 200 lb man that is 158 lb of
                lean mass, not 200 — the stated formula was wrong by 21%. The
                correct sentence is computed server-side as lbmSourceNote. */}
            {bfAssumed && ` ${macros.lbmSourceNote || `Estimated: body fat % isn't set, so lean mass assumes a typical ${macros.assumedBodyFatPct ?? ""}% for your sex. Enter a real measurement to sharpen the protein target.`}`}
          </div>
          {macros.macroKcalGap > 0 && (
            <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
              Ranges sum ~{kc(macros.kcal - macros.macroKcalGap)} kcal at midpoint ({macros.macroKcalGap} under target) — {macros.carbBufferG}g deliberately trimmed off the carb midpoint as a conservatism margin.
            </div>
          )}
          {macros.macroKcalGap < 0 && (
            // The overshoot case (lean + heavy + floor-clamped): say it out loud
            // rather than let the bar quietly renormalise it away.
            <div className="text-xs font-semibold mt-1" style={{ color: C.warn }}>
              Ranges sum ~{kc(macros.kcal - macros.macroKcalGap)} kcal at midpoint — {kc(Math.abs(macros.macroKcalGap))} OVER the target. At this body composition the protein and essential-fat floors do not fit inside {kc(macros.kcal)} kcal; carbs are already as low as they go.
            </div>
          )}
          {meta?.proteinFloorSource && (
            <div className="text-[11px] font-semibold mt-2 pt-2" style={{ color: C.faint, borderTop: `1px solid ${C.rule}` }}>
              Protein range basis: {meta.proteinFloorSource.label} — {meta.proteinFloorSource.detail} This app's {macros.proteinLo}–{macros.proteinHi}g range sits inside that band. Recomposition (not just weight loss) is the reason it's this heavily weighted — see Protein-priority mode on the Plan tab to have the solver defend the low end of it directly.
            </div>
          )}
        </Card>
      </div>

      {/* TODO (export): this raw JSON dump is a developer escape hatch wearing a
          user-facing label. A real `GET /api/export` (JSON + CSV) is being built
          — when it lands, replace this <details> with a download button that
          calls it. Do NOT delete this block before then: the constitution says
          data is never trapped, and today this is the only way out. */}
      <details className="px-1 mt-4">
        <summary className="text-xs font-semibold" style={{ color: C.faint }}>
          Copy your data as JSON (raw backup)
        </summary>
        <pre className="text-xs mt-2 p-3 rounded-xl overflow-x-auto"
          style={{ background: C.card, border: `1px solid ${C.rule}`, color: C.ink }}>
          {JSON.stringify({ profile, summary }, null, 1)}
        </pre>
      </details>
    </div>
  );
}
