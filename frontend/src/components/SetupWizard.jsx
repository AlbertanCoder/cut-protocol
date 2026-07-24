import { useState, useEffect, useMemo, useRef } from "react";
import { ArrowRight, ArrowLeft, Check, Search, AlertTriangle } from "lucide-react";
import CutMark from "./ui/CutMark.jsx";
import { C } from "../lib/theme.js";
import { parseWeight, parseHeight, weightUnit, heightUnit, displayWeight, displayHeight } from "../lib/units.js";
import { Btn } from "./ui/Parts.jsx";
import AllergySearch from "./ui/AllergySearch.jsx";
import { fetchAllergenTaxonomy, fetchExclusionDescriptions, normTerm } from "./ui/allergyTaxonomy.js";
import { api } from "../lib/api.js";

const STEPS = ["Units & Stats", "Activity", "Diet", "Rate"];

// ── Provisional-profile ledger (onboarding-flow-3) ─────────────────────────
//
// THE BUG THIS CLOSES: the old "Skip — use defaults" button called
// putProfile({}), which made the SERVER fill in a whole person — 30 years old,
// 178 cm, 90 kg, goal 85 kg, desk job, 3 sessions a week — and then derive a
// BMR, a TDEE, a calorie target and a week of meals from it. The app then
// showed all of that as "your target", indistinguishable from numbers a real
// user had entered. That is the single most dangerous thing a body-composition
// app can do: it is a made-up prescription wearing the costume of a personal
// one, and the constitution in CLAUDE.md is explicit — "wrong math = product
// death", "nothing user-specific hardcoded".
//
// It is now impossible to reach that state silently. The estimate path exists
// (people genuinely do want to look around before measuring themselves), but
// it: names every assumption on screen before it is applied, requires an
// explicit acknowledgement, and leaves a marker that makes the entire app
// label those numbers as ESTIMATES until real ones replace them.
//
// The marker lives in localStorage rather than the DB because the profile
// schema is shared and a column can't be added from here. It self-heals: the
// snapshot of what was assumed is stored alongside, so as soon as ANY of those
// values differs from the live profile, the user has entered real data and the
// marker clears itself. No stale "finish your profile" nag, no way to be stuck.
const PROVISIONAL_KEY = "cutprotocol.profile.provisional";

// Mirrors backend/src/routes/profile.js → defaultProfile(). If that ever
// changes, this display text goes stale — which is precisely why the snapshot
// is recorded from the profile the SERVER returns, not from this constant.
export const DEFAULT_ASSUMPTIONS = {
  sex: "M", age: 30, heightCm: 178, startWeightKg: 90, goalWeightKg: 85,
  occupationKey: "desk-office", sessionsPerWeek: 3, trainingStyle: "mixed",
  minutesPerSession: 45, rateLbPerWeek: 1.0,
};

// The fields that make a profile PERSONAL. If any one of these no longer
// matches what was assumed, the user has told us something real.
const IDENTITY_FIELDS = ["sex", "age", "heightCm", "startWeightKg", "goalWeightKg"];

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

/** Record that this profile was created from defaults, plus what they were. */
export function markProfileProvisional(profile) {
  const s = safeStorage();
  if (!s || !profile) return;
  const snapshot = {};
  for (const f of IDENTITY_FIELDS) snapshot[f] = profile[f];
  try {
    s.setItem(PROVISIONAL_KEY, JSON.stringify({ at: new Date().toISOString(), snapshot }));
  } catch { /* private mode / quota — the labelling degrades, nothing breaks */ }
}

export function clearProfileProvisional() {
  const s = safeStorage();
  try { s?.removeItem(PROVISIONAL_KEY); } catch { /* ignore */ }
}

/**
 * Is the profile currently on screen still made of assumed numbers?
 * Returns the record ({at, snapshot}) if so, else null — and clears the marker
 * the moment real values appear, so this can be called on every render.
 */
export function readProfileProvisional(profile) {
  const s = safeStorage();
  if (!s || !profile) return null;
  let rec = null;
  try { rec = JSON.parse(s.getItem(PROVISIONAL_KEY) || "null"); } catch { return null; }
  if (!rec || !rec.snapshot) return null;
  const stillAssumed = IDENTITY_FIELDS.every((f) => {
    const a = rec.snapshot[f];
    const b = profile[f];
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
    return a === b;
  });
  if (!stillAssumed) { clearProfileProvisional(); return null; }
  return rec;
}

/** Human-readable list of what the defaults assume, in the user's units. */
export function describeAssumptions(pref = "imperial") {
  const a = DEFAULT_ASSUMPTIONS;
  return [
    ["Sex", a.sex === "M" ? "male" : "female"],
    ["Age", `${a.age}`],
    ["Height", `${displayHeight(a.heightCm, pref)} ${heightUnit(pref)}`],
    ["Current weight", `${displayWeight(a.startWeightKg, pref)} ${weightUnit(pref)}`],
    ["Goal weight", `${displayWeight(a.goalWeightKg, pref)} ${weightUnit(pref)}`],
    ["Job", "desk / office"],
    ["Training", `${a.sessionsPerWeek}×/week, ${a.minutesPerSession} min, mixed`],
    ["Rate of loss", `${a.rateLbPerWeek} lb/wk`],
  ];
}

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
  // onboarding-flow-3: the estimate path is now a two-stage, explicit choice.
  const [showEstimatePanel, setShowEstimatePanel] = useState(false);
  const [estimateAcked, setEstimateAcked] = useState(false);

  const [d, setD] = useState({
    unitPref: "imperial",
    sex: "M", age: "", height: "", weight: "", bf: "", goal: "",
    occupationKey: "desk-office", sessions: 3, trainingStyle: "mixed", minutes: 45,
    // One flat list of exclusion terms — the same shape the profile stores.
    // The old split (fixed checkbox keys + a comma-separated "custom" string)
    // made a typed allergen a second-class citizen; it isn't one.
    dietaryStyle: "none", exclusions: [],
    mealsPerDay: 3, snacksPerDay: 1,
    rate: 1.0,
  });
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    api.getProfileMeta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  // ── Allergies 2.0 (same picker as the Profile tab) ───────────────────────
  // A new user gets the searchable taxonomy on day one, not the short fixed
  // checkbox list. Degrades to the common-allergen quick chips if the
  // taxonomy module isn't on this build — never blocks setup.
  const [taxonomy, setTaxonomy] = useState({ available: false, taxonomy: [], reason: null });
  const [descriptions, setDescriptions] = useState(null);
  const [describeAvailable, setDescribeAvailable] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAllergenTaxonomy()
      .then((t) => { if (alive) setTaxonomy(t); })
      .catch(() => { if (alive) setTaxonomy({ available: false, taxonomy: [], reason: "couldn't reach the server" }); });
    return () => { alive = false; };
  }, []);

  // Nothing is saved yet in the wizard, so this describes the pending list —
  // the user finds out how a term will be matched BEFORE they commit to it.
  useEffect(() => {
    let alive = true;
    fetchExclusionDescriptions(d.exclusions)
      .then((r) => { if (!alive) return; setDescriptions(r.byTerm); setDescribeAvailable(r.available); })
      .catch(() => { if (!alive) return; setDescriptions({}); setDescribeAvailable(false); });
    return () => { alive = false; };
  }, [d.exclusions]);

  const addExclusion = (term) => {
    const t = String(term ?? "").trim();
    if (!t) return;
    setD((cur) => (cur.exclusions.some((x) => normTerm(x) === normTerm(t))
      ? cur
      : { ...cur, exclusions: [...cur.exclusions, t] }));
  };
  const removeExclusion = (term) =>
    setD((cur) => ({ ...cur, exclusions: cur.exclusions.filter((x) => x !== term) }));
  const replaceExclusion = (oldTerm, newTerm) =>
    setD((cur) => ({
      ...cur,
      exclusions: [
        ...cur.exclusions.filter((x) => normTerm(x) !== normTerm(oldTerm) && normTerm(x) !== normTerm(newTerm)),
        newTerm,
      ],
    }));

  // a11y: Next/Back swaps the whole step's content in place with no route
  // change, so nothing tells a keyboard/screen-reader user to look there.
  // Move focus to the new step's panel (skipping the very first render).
  const panelRef = useRef(null);
  const skipFirstFocus = useRef(true);
  useEffect(() => {
    if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
    panelRef.current?.focus({ preventScroll: false });
  }, [step]);

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
    excludedFoods: d.exclusions,
    mealsPerDay: +d.mealsPerDay || 3,
    snacksPerDay: +d.snacksPerDay || 0,
    rateLbPerWeek: d.rate,
  });

  const finish = async (skipAll) => {
    setBusy(true);
    setError(null);
    try {
      if (skipAll) {
        // Estimate path. The profile the server returns IS the assumed one —
        // snapshot it so every screen can label those numbers honestly, and
        // so the label disappears by itself once real values are entered.
        const created = await api.putProfile({ unitPref: d.unitPref });
        markProfileProvisional(created);
      } else {
        await api.putProfile({ ...buildPatch(), ...(acked ? { rateAcknowledged: true } : {}) });
        // A fully-entered profile is real by definition — drop any marker left
        // from an earlier estimate run.
        clearProfileProvisional();
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
    <div className="min-h-svh flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center justify-center">
            <CutMark size={44} />
          </div>
          <div className="leading-none">
            <div className="disp text-lg uppercase" style={{ color: C.ink }}>Cut Protocol</div>
            <div className="text-[11px] font-bold uppercase mt-1" style={{ color: C.faint, letterSpacing: ".08em" }}>First-run setup</div>
          </div>
        </div>

        {/* aria-current marks the active step for screen readers; the bar
            fill is decorative (the step label + card heading already say
            which step this is in text). */}
        <div className="flex gap-2 mb-5" role="list" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1" role="listitem" aria-current={i === step ? "step" : undefined}>
              <div className="h-1.5 rounded-full mb-1.5" aria-hidden="true" style={{ background: i <= step ? C.accent : C.card2 }}></div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: i === step ? C.ink : C.faint }}>{s}</div>
            </div>
          ))}
        </div>

        <div className="p-6 rounded-2xl glass-card" ref={panelRef} tabIndex={-1}>
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
                    style={{ background: pref === u ? C.card2 : "transparent", color: pref === u ? C.ink : C.faint, border: `1px solid ${pref === u ? C.faintLight : C.rule}` }}>
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
                    style={{ color: C.ink, fontWeight: d.occupationKey === o.key ? 800 : 600, background: d.occupationKey === o.key ? C.card2 : "transparent", borderBottom: `1px solid ${C.rule}` }}>
                    <span className="truncate">{o.label}</span>
                    <span className="mono text-xs shrink-0" style={{ color: C.faint }}>×{o.multiplier}</span>
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
              {/* Allergies first, and searchable — the same control the
                  Profile tab uses, so nothing has to be re-learned later.
                  None is a valid answer; this step is skippable by leaving it
                  empty. */}
              <div className="mb-4">
                <AllergySearch
                  taxonomy={taxonomy.taxonomy}
                  taxonomyReason={taxonomy.reason}
                  quickOptions={meta?.allergyOptions || []}
                  selected={d.exclusions}
                  descriptions={descriptions}
                  describeAvailable={describeAvailable}
                  onAdd={addExclusion}
                  onRemove={removeExclusion}
                  onReplace={replaceExclusion}
                />
              </div>
              <label className="block mb-4 max-w-xs">{label("Dietary style")}
                <select value={d.dietaryStyle} onChange={(e) => set({ dietaryStyle: e.target.value })} className={inp} style={inpStyle}>
                  {(meta?.dietaryStyles || ["none"]).map((s) => (
                    <option key={s} value={s}>{s === "none" ? "None (no restriction)" : s[0].toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </label>
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
                    style={{ background: d.rate === r ? C.card2 : "transparent", border: `1px solid ${d.rate === r ? C.faintLight : C.rule}` }}>
                    <div className="mono text-sm font-extrabold" style={{ color: d.rate === r ? C.ink : C.faint }}>{r} lb/wk</div>
                    <div className="text-[10px] font-bold" style={{ color: C.faintLight }}>{Math.round(r * 45.3592) / 100} kg/wk</div>
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
                      <label className="flex items-center gap-2 text-xs font-bold mt-2" style={{ color: C.warn }}>
                        <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} style={{ accentColor: C.warn }} />
                        I understand the risks of this rate
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <div role="alert" className="text-xs font-semibold mt-4" style={{ color: C.red }}>{error}</div>}

          <div className="flex items-center justify-between mt-6">
            <div>
              {step > 0 && (
                <Btn kind="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                  <ArrowLeft size={13} className="inline mr-1" aria-hidden="true" />Back
                </Btn>
              )}
            </div>
            <div className="flex gap-2 items-center">
              {/* onboarding-flow-3: this used to say "Skip — use defaults" and
                  silently fabricate a person. It now opens a panel that names
                  every assumption BEFORE any of it is applied. */}
              <button onClick={() => { setShowEstimatePanel((v) => !v); setEstimateAcked(false); }} disabled={busy}
                aria-expanded={showEstimatePanel}
                className="text-xs font-semibold hover:opacity-80 underline decoration-dotted underline-offset-4" style={{ color: C.faint }}>
                Don&apos;t know your numbers yet?
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

        {/* ── ESTIMATE PATH (onboarding-flow-3) ─────────────────────────────
            Shown only on request. Every assumed value is listed in the user's
            own units, the consequences are stated plainly, and it cannot be
            applied without an explicit tick. Nothing here is presented as the
            user's own data at any point. */}
        {showEstimatePanel && (
          <div className="mt-4 p-5 rounded-2xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} style={{ color: C.warn }} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold" style={{ color: C.ink }}>
                  This starts you on ESTIMATES FROM DEFAULTS — not your numbers
                </div>
                <div className="text-xs font-semibold mt-1.5 leading-relaxed" style={{ color: C.faint }}>
                  Nothing about you is known yet, so the app has to assume a person. Your calorie
                  target, macros and meal plan would all be derived from the assumptions below —
                  they are a demo of the engine, not a prescription for you.
                </div>

                <div className="grid grid-cols-2 gap-x-5 gap-y-1 mt-3.5 mb-3">
                  {describeAssumptions(pref).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 text-xs font-semibold py-0.5"
                      style={{ borderBottom: `1px solid ${C.rule}` }}>
                      <span style={{ color: C.faint }}>{k}</span>
                      <span className="mono" style={{ color: C.ink }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div className="text-xs font-semibold leading-relaxed" style={{ color: C.faint }}>
                  Every screen will keep these numbers flagged as estimates, and keep asking you to
                  finish your profile, until you enter your real height and weight. Take two
                  minutes and fill the four steps instead — it is the whole point of the app.
                </div>

                <label className="flex items-start gap-2 text-xs font-bold mt-3" style={{ color: C.warn }}>
                  <input type="checkbox" checked={estimateAcked} onChange={(e) => setEstimateAcked(e.target.checked)}
                    className="mt-0.5" style={{ accentColor: C.warn }} />
                  I understand these are assumed numbers, not mine, and any target shown is an estimate.
                </label>

                <div className="flex flex-wrap gap-2 mt-3.5">
                  <Btn kind="ghost" onClick={() => finish(true)} disabled={busy || !estimateAcked}>
                    {busy ? "Saving…" : "Continue with estimates"}
                  </Btn>
                  <Btn onClick={() => setShowEstimatePanel(false)} disabled={busy}>
                    Enter my real numbers
                  </Btn>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 0 && !statsValid && (d.age || d.height || d.weight) && (
          <div role="alert" className="text-[11px] font-semibold mt-3 px-1" style={{ color: C.faint }}>
            Age 14–100, and height / current weight / goal weight all filled to continue.
          </div>
        )}
      </div>
    </div>
  );
}
