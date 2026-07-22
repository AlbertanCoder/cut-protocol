import { useState, useEffect, useMemo } from "react";
import { Search, AlertTriangle, ShieldCheck } from "lucide-react";
import { C } from "../lib/theme.js";
import {
  displayWeight, parseWeight, displayHeight, parseHeight, displayRate,
  weightUnit, heightUnit, rateUnit,
} from "../lib/units.js";
import { Card, PageHead, Btn, ErrorNote } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";
import BodyFatPicker from "./BodyFatPicker.jsx";

const r1 = (n) => Math.round(n * 10) / 10;
const kc = (n) => Math.round(n).toLocaleString("en-CA");

// The user-facing home of every personal input. Engine reads these and only
// shows the math. Commit-on-blur for typed fields, commit-on-change for
// pickers; every commit refreshes profile+summary so targets update
// instantly (Phase 3 spec).
export default function ProfileTab({ profile, summary, refresh }) {
  const pref = profile.unitPref;
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [bfPickerOpen, setBfPickerOpen] = useState(false);

  useEffect(() => {
    api.getProfileMeta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  const avg7Kg = summary.avg7Kg != null ? summary.avg7Kg : profile.startWeightKg;
  const [draft, setDraft] = useState(() => ({
    height: displayHeight(profile.heightCm, pref),
    bf: profile.bodyFatPct || "",
    goal: displayWeight(profile.goalWeightKg, pref),
    age: profile.age,
    sessions: profile.sessionsPerWeek,
    minutes: profile.minutesPerSession,
    override: profile.activityOverride ?? "",
    floor: profile.floorKcal ?? "",
  }));
  // Re-sync drafts when the unit preference flips (values re-render in the
  // new unit) or the profile is refreshed underneath us.
  useEffect(() => {
    setDraft({
      height: displayHeight(profile.heightCm, pref),
      bf: profile.bodyFatPct || "",
      goal: displayWeight(profile.goalWeightKg, pref),
      age: profile.age,
      sessions: profile.sessionsPerWeek,
      minutes: profile.minutesPerSession,
      override: profile.activityOverride ?? "",
      floor: profile.floorKcal ?? "",
    });
  }, [profile, pref]);

  const [prefsDraft, setPrefsDraft] = useState({
    cuisinePreferences: (profile.cuisinePreferences || []).join(", "),
    mealPreferencesNote: profile.mealPreferencesNote || "",
  });
  const [occQuery, setOccQuery] = useState("");
  const [occOpen, setOccOpen] = useState(false);
  const [pendingAck, setPendingAck] = useState(null); // { patch, reasons }

  const commit = async (patch) => {
    setError(null);
    try {
      await api.putProfile(patch);
      await refresh();
    } catch (e) {
      if (e.status === 422 && e.body?.requiresAck) {
        setPendingAck({ patch, reasons: e.body.reasons });
      } else {
        setError(e.message);
      }
    }
  };
  const confirmAck = async () => {
    const { patch } = pendingAck;
    setPendingAck(null);
    await commitWithAck(patch);
  };
  const commitWithAck = async (patch) => {
    setError(null);
    try {
      await api.putProfile({ ...patch, rateAcknowledged: true });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // Stage-C fix (M14): allergy exclusions are held in an OPTIMISTIC local
  // copy so rapid toggles compose correctly. Before, each toggle computed its
  // payload from the profile prop, so toggling A then B before the first
  // PUT/refresh round-trip dropped A (last write wins) — a silent loss of a
  // safety-critical exclusion. The local copy re-syncs whenever the server
  // truth changes.
  const [excludedLocal, setExcludedLocal] = useState(() => (Array.isArray(profile.excludedFoods) ? profile.excludedFoods : []));
  useEffect(() => { setExcludedLocal(Array.isArray(profile.excludedFoods) ? profile.excludedFoods : []); }, [profile.excludedFoods]);
  const excluded = excludedLocal;
  const allergyKeys = useMemo(() => (meta?.allergyOptions || []).map((a) => a.key), [meta]);
  const customExclusions = excluded.filter((t) => !allergyKeys.includes(t));
  const [customDraft, setCustomDraft] = useState(customExclusions.join(", "));
  useEffect(() => { setCustomDraft(customExclusions.join(", ")); }, [profile.excludedFoods, meta]); // eslint-disable-line

  const toggleAllergy = (key) => {
    const next = excludedLocal.includes(key) ? excludedLocal.filter((t) => t !== key) : [...excludedLocal, key];
    setExcludedLocal(next); // optimistic — the next toggle sees this
    commit({ excludedFoods: next });
  };
  const commitCustom = () => {
    const customs = customDraft.split(",").map((x) => x.trim()).filter(Boolean);
    const checked = excludedLocal.filter((t) => allergyKeys.includes(t));
    const next = [...checked, ...customs];
    setExcludedLocal(next);
    commit({ excludedFoods: next });
  };

  const filteredOccupations = useMemo(() => {
    if (!meta) return [];
    const q = occQuery.trim().toLowerCase();
    if (!q) return meta.occupations;
    return meta.occupations.filter((o) => o.label.toLowerCase().includes(q) || o.group.includes(q));
  }, [meta, occQuery]);
  const currentOcc = meta?.occupations.find((o) => o.key === profile.occupationKey);

  const inp = "text-sm px-3 py-2 rounded-xl w-full mt-1";
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const label = (t) => <span className="text-xs font-bold" style={{ color: C.faint }}>{t}</span>;

  const goalDate = useMemo(() => {
    const goalDisp = displayWeight(profile.goalWeightKg, "imperial");
    const nowDisp = displayWeight(avg7Kg, "imperial");
    const rate = profile.rateLbPerWeek;
    if (!rate || nowDisp <= goalDisp) return null;
    const days = ((nowDisp - goalDisp) / rate) * 7;
    const d = new Date(Date.now() + days * 864e5);
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  }, [profile.goalWeightKg, profile.rateLbPerWeek, avg7Kg]);

  return (
    <div>
      {bfPickerOpen && (
        <BodyFatPicker current={profile.bodyFatPct} source={profile.bodyFatSource} onDone={refresh} onClose={() => setBfPickerOpen(false)} />
      )}
      <PageHead title="Profile" sub="Your stats, activity, diet rules, and rate of change. Everything else in the app — including the protein floor and lean-mass estimate — derives from this tab." />

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error} hint="Your last edit didn't save — re-enter the value. Fields commit when you click away from them." />
        </div>
      )}

      {pendingAck && (
        <div className="mb-4 p-4 rounded-2xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} style={{ color: C.warn }} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-extrabold mb-1" style={{ color: C.warn }}>This rate needs an explicit OK</div>
              {pendingAck.reasons.map((r, i) => (
                <div key={i} className="text-xs font-semibold mb-0.5" style={{ color: C.ink }}>· {r}</div>
              ))}
              <div className="flex gap-2 mt-2.5">
                <Btn small onClick={confirmAck}>I understand — apply anyway</Btn>
                <Btn small kind="ghost" onClick={() => setPendingAck(null)}>Cancel</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* ── body ── */}
        <Card section="STATS" title="Body" className="xl:col-span-4">
          <label className="block mb-3">{label("Units")}
            <div className="flex gap-1.5 mt-1">
              {["imperial", "metric"].map((u) => (
                <button key={u} onClick={() => commit({ unitPref: u })}
                  className="flex-1 text-xs font-bold py-2 rounded-xl"
                  style={{
                    background: pref === u ? C.card2 : "transparent", color: pref === u ? C.ink : C.faint,
                    border: `1px solid ${pref === u ? C.faintLight : C.rule}`,
                  }}>
                  {u === "imperial" ? "lb / in" : "kg / cm"}
                </button>
              ))}
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">{label("Sex")}
              <select value={profile.sex} onChange={(e) => commit({ sex: e.target.value })} className={inp} style={inpStyle}>
                <option value="M">Male</option><option value="F">Female</option>
              </select>
            </label>
            <label className="block">{label("Age")}
              <input type="number" value={draft.age}
                onChange={(e) => setDraft((d) => ({ ...d, age: +e.target.value || 0 }))}
                onBlur={() => commit({ age: draft.age })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label(`Height (${heightUnit(pref)})`)}
              <input type="number" value={draft.height}
                onChange={(e) => setDraft((d) => ({ ...d, height: +e.target.value || 0 }))}
                onBlur={() => commit({ heightCm: parseHeight(draft.height, pref) })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Body fat % (optional)")}
              <input type="number" placeholder="unknown" value={draft.bf}
                onChange={(e) => setDraft((d) => ({ ...d, bf: e.target.value }))}
                onBlur={() => commit({ bodyFatPct: draft.bf === "" ? 0 : +draft.bf })}
                className={inp} style={inpStyle} />
              <button type="button" onClick={() => setBfPickerOpen(true)}
                className="text-[11px] font-bold underline mt-1" style={{ color: C.faint }}>
                Estimate visually
                {profile.bodyFatSource === "visual-estimate" ? " · set from silhouette" : profile.bodyFatSource === "measured" ? " · measured" : ""}
              </button>
            </label>
            <label className="block">{label(`Current weight (${weightUnit(pref)})`)}
              <input type="number" value={displayWeight(avg7Kg, pref)} readOnly className={inp} style={{ ...inpStyle, color: C.faint }} />
            </label>
            <label className="block">{label(`Goal weight (${weightUnit(pref)})`)}
              <input type="number" value={draft.goal}
                onChange={(e) => setDraft((d) => ({ ...d, goal: +e.target.value || 0 }))}
                onBlur={() => commit({ goalWeightKg: parseWeight(draft.goal, pref) })}
                className={inp} style={inpStyle} />
            </label>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Weight feeds from your 7-day average. Body fat % unlocks the two LBM-based BMR formulas.
          </div>
        </Card>

        {/* ── job & training ── */}
        <Card section="ACTIVITY" title="Job & training" className="xl:col-span-4">
          <label className="block mb-1">{label("Occupation")}</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
            <input
              placeholder={currentOcc ? `${currentOcc.label} (×${currentOcc.multiplier})` : "Search occupations…"}
              value={occQuery}
              onFocus={() => setOccOpen(true)}
              // Stage-C fix (#37): close on blur so clicking elsewhere dismisses
              // the list (a small delay lets an option's onClick fire first).
              onBlur={() => setTimeout(() => setOccOpen(false), 150)}
              onKeyDown={(e) => e.key === "Escape" && setOccOpen(false)}
              onChange={(e) => { setOccQuery(e.target.value); setOccOpen(true); }}
              className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle}
            />
          </div>
          {occOpen && meta && (
            <div className="mt-1.5 max-h-52 overflow-y-auto rounded-xl" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
              {filteredOccupations.map((o) => (
                <button key={o.key}
                  onClick={() => { commit({ occupationKey: o.key }); setOccQuery(""); setOccOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm font-semibold flex justify-between gap-2 hover:opacity-80"
                  style={{ color: C.ink, fontWeight: o.key === profile.occupationKey ? 800 : 600, background: o.key === profile.occupationKey ? C.card : "transparent", borderBottom: `1px solid ${C.rule}` }}>
                  <span className="truncate">{o.label}</span>
                  <span className="mono text-xs shrink-0" style={{ color: C.faintLight }}>×{o.multiplier}</span>
                </button>
              ))}
              {filteredOccupations.length === 0 && <div className="px-3 py-2 text-sm font-semibold" style={{ color: C.faint }}>No match — use the manual override below.</div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">{label("Multiplier override")}
              <input type="number" step="0.05" placeholder={currentOcc ? `auto ×${currentOcc.multiplier}` : "e.g. 1.4"}
                value={draft.override}
                onChange={(e) => setDraft((d) => ({ ...d, override: e.target.value }))}
                onBlur={() => commit({ activityOverride: draft.override === "" ? null : +draft.override })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Training style")}
              <select value={profile.trainingStyle} onChange={(e) => commit({ trainingStyle: e.target.value })} className={inp} style={inpStyle}>
                {(meta?.trainingStyles || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">{label("Sessions / week")}
              <input type="number" min={0} max={14} value={draft.sessions}
                onChange={(e) => setDraft((d) => ({ ...d, sessions: +e.target.value || 0 }))}
                onBlur={() => commit({ sessionsPerWeek: draft.sessions })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Minutes / session")}
              <input type="number" min={0} max={300} value={draft.minutes}
                onChange={(e) => setDraft((d) => ({ ...d, minutes: +e.target.value || 0 }))}
                onBlur={() => commit({ minutesPerSession: draft.minutes })}
                className={inp} style={inpStyle} />
            </label>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Occupation sets the day-to-day multiplier; training adds its own kcal on top. The Engine tab shows the exact math.
          </div>
        </Card>

        {/* ── diet & allergies ── */}
        <Card section="DIET" title="Diet & allergies" className="xl:col-span-4">
          <label className="block mb-3">{label("Dietary style")}
            <select value={profile.dietaryStyle || "none"} onChange={(e) => commit({ dietaryStyle: e.target.value === "none" ? null : e.target.value })} className={inp} style={inpStyle}>
              {(meta?.dietaryStyles || ["none"]).map((s) => (
                <option key={s} value={s}>{s === "none" ? "None (no restriction)" : s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </label>
          <div className="mb-1">{label("Allergies & exclusions")}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
            {(meta?.allergyOptions || []).map((a) => (
              <label key={a.key} className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.ink }}>
                <input type="checkbox" checked={excluded.includes(a.key)} onChange={() => toggleAllergy(a.key)}
                  className="w-4 h-4" style={{ accentColor: C.accent }} />
                {a.label}
              </label>
            ))}
          </div>
          <label className="block mb-3">{label("Custom exclusions (comma-separated)")}
            <input type="text" placeholder="e.g. cilantro, mushrooms" value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={commitCustom}
              className={inp} style={inpStyle} />
          </label>
          <label className="block mb-3">{label("Cuisine preferences for AI recipes")}
            <input type="text" placeholder="e.g. mexican, thai" value={prefsDraft.cuisinePreferences}
              onChange={(e) => setPrefsDraft((d) => ({ ...d, cuisinePreferences: e.target.value }))}
              onBlur={() => commit({ cuisinePreferences: prefsDraft.cuisinePreferences.split(",").map((x) => x.trim()).filter(Boolean) })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block">{label("Notes for AI recipes")}
            <textarea rows={2} value={prefsDraft.mealPreferencesNote}
              onChange={(e) => setPrefsDraft((d) => ({ ...d, mealPreferencesNote: e.target.value }))}
              onBlur={() => commit({ mealPreferencesNote: prefsDraft.mealPreferencesNote || null })}
              className={inp} style={{ ...inpStyle, resize: "vertical" }} />
          </label>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Style + allergies hard-filter the recipe library, the weekly solver, and AI generation. Nothing excluded is ever surfaced.
          </div>
        </Card>

        {/* ── rate of loss ── */}
        <Card section="PRESCRIPTION" title="Rate of loss" className="xl:col-span-12">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(meta?.rateOptions || []).map((r) => {
              const active = profile.rateLbPerWeek === r;
              return (
                <button key={r} onClick={() => commit({ rateLbPerWeek: r })}
                  className="px-4 py-2.5 rounded-xl text-center"
                  style={{ background: active ? C.card2 : "transparent", border: `1px solid ${active ? C.faintLight : C.rule}` }}>
                  <div className="mono text-sm font-extrabold" style={{ color: active ? C.ink : C.faint }}>{r} lb/wk</div>
                  <div className="text-[10px] font-bold" style={{ color: C.faintLight }}>{r1(r * 0.453592)} kg/wk</div>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <div className="text-xs font-semibold" style={{ color: C.faint }}>Daily target</div>
              <div className="mono stat-hero text-3xl" style={{ color: C.ink }}>{kc(summary.target?.target ?? profile.targetKcal)}<span className="text-xs ml-1" style={{ color: C.faint, fontWeight: 600 }}>kcal</span></div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: C.faintLight }}>
                TDEE {kc(summary.energy?.tdee ?? 0)} − {kc(summary.target?.deficit ?? 0)} deficit{summary.target?.floored ? " → floored" : ""}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold" style={{ color: C.faint }}>Projected goal date</div>
              <div className="text-lg font-extrabold" style={{ color: C.ink }}>{goalDate || "—"}</div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: C.faintLight }}>at {displayRate(profile.rateLbPerWeek, pref)} {rateUnit(pref)} from your current average</div>
            </div>
            <label className="block">{label(`Personal floor (kcal, min ${meta?.safeFloor?.[profile.sex] ?? 1500})`)}
              <input type="number" placeholder={`default ${meta?.safeFloor?.[profile.sex] ?? 1500}`} value={draft.floor}
                onChange={(e) => setDraft((d) => ({ ...d, floor: e.target.value }))}
                onBlur={() => commit({ floorKcal: draft.floor === "" ? null : +draft.floor })}
                className={inp} style={inpStyle} />
            </label>
            <div className="flex items-center gap-2 pb-1.5">
              {summary.rateSafety?.unsafe ? (
                <><AlertTriangle size={16} style={{ color: C.warn }} /><span className="text-xs font-bold" style={{ color: C.warn }}>Aggressive — acknowledged</span></>
              ) : (
                <><ShieldCheck size={16} style={{ color: C.good }} /><span className="text-xs font-bold" style={{ color: C.good }}>Within safety rails</span></>
              )}
            </div>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Rates above ~1% of body weight per week, or targets that hit your floor, need an explicit "I understand" before they apply. Changing the rate updates the target, macro ranges, projections, and meal-plan targets instantly.
          </div>
        </Card>
      </div>
    </div>
  );
}
