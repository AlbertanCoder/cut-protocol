import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, AlertTriangle, ShieldCheck, ExternalLink, ChevronRight } from "lucide-react";
import { C } from "../lib/theme.js";
import {
  displayWeight, parseWeight, displayHeight, parseHeight, displayRate,
  weightUnit, heightUnit, rateUnit,
} from "../lib/units.js";
import { Card, PageHead, Btn, ErrorNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import AllergySearch from "./ui/AllergySearch.jsx";
import { fetchAllergenTaxonomy, fetchExclusionDescriptions, normTerm } from "./ui/allergyTaxonomy.js";
import { api, isAbortError, isNoAnswer, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";
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
  const [metaError, setMetaError] = useState(null); // distinct from "meta is still loading"
  const [error, setError] = useState(null);
  const [bfPickerOpen, setBfPickerOpen] = useState(false);
  const abort = useAbortSignal();

  const loadMeta = useCallback(async () => {
    setMetaError(null);
    try {
      setMeta(await api.getProfileMeta({ signal: abort.signal }));
    } catch (e) {
      if (isAbortError(e)) return;
      // An empty option list would render as "you have no allergies / no
      // dietary style" — a failed load must never look like an empty one
      // (frontend-arch-4).
      setMetaError(describeError(e, "Couldn't load the diet & allergy options."));
    }
  }, [abort]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const avg7Kg = summary.avg7Kg != null ? summary.avg7Kg : profile.startWeightKg;
  const draftFromProfile = useCallback(() => ({
    height: displayHeight(profile.heightCm, pref),
    bf: profile.bodyFatPct || "",
    goal: displayWeight(profile.goalWeightKg, pref),
    age: profile.age,
    sessions: profile.sessionsPerWeek,
    minutes: profile.minutesPerSession,
    override: profile.activityOverride ?? "",
    floor: profile.floorKcal ?? "",
  }), [profile, pref]);
  const [draft, setDraft] = useState(draftFromProfile);
  // Re-sync drafts when the unit preference flips (values re-render in the
  // new unit) or the profile is refreshed underneath us.
  useEffect(() => { setDraft(draftFromProfile()); }, [draftFromProfile]);

  const [prefsDraft, setPrefsDraft] = useState({
    cuisinePreferences: (profile.cuisinePreferences || []).join(", "),
    mealPreferencesNote: profile.mealPreferencesNote || "",
  });
  const [occQuery, setOccQuery] = useState("");
  const [occOpen, setOccOpen] = useState(false);
  const [aiPrefsOpen, setAiPrefsOpen] = useState(false); // AI-recipe fields collapsed by default (de-clutter)
  const [pendingAck, setPendingAck] = useState(null); // { patch, reasons }

  // Every failed commit REVERTS the on-screen drafts to server truth. A typed
  // value that didn't save must not keep sitting in the box looking saved
  // (same class of lie as the allergy toggle below, lower stakes).
  const revertDrafts = useCallback(() => {
    setDraft(draftFromProfile());
    setPrefsDraft({
      cuisinePreferences: (profile.cuisinePreferences || []).join(", "),
      mealPreferencesNote: profile.mealPreferencesNote || "",
    });
  }, [draftFromProfile, profile]);

  const commit = async (patch) => {
    setError(null);
    try {
      await api.putProfile(patch, { signal: abort.signal });
      await refresh();
    } catch (e) {
      if (isAbortError(e)) return;
      if (e.status === 422 && e.body?.requiresAck) {
        setPendingAck({ patch, reasons: e.body.reasons });
      } else {
        setError(describeError(e));
        revertDrafts();
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
      await api.putProfile({ ...patch, rateAcknowledged: true }, { signal: abort.signal });
      await refresh();
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
      revertDrafts();
    }
  };

  // ── ALLERGY EXCLUSIONS — safety-critical, so this control has its own
  // save machinery (frontend-arch-1) ─────────────────────────────────────
  //
  // Stage-C fix (M14) kept: exclusions are held in an optimistic local copy
  // so rapid toggles compose correctly (computing each payload from the
  // profile prop dropped the earlier toggle — last write wins).
  //
  // frontend-arch-1: that optimism had NO ROLLBACK. The chip flipped, the PUT
  // failed, and the user was left believing an allergen was excluded when the
  // server had never recorded it. The rule now:
  //
  //   THE SCREEN MAY ONLY SHOW SERVER TRUTH OR AN IN-FLIGHT SAVE. It may
  //   never show an unsaved exclusion as if it were saved.
  //
  // So every failure reverts to the last server truth. Note what that means
  // in each direction — it is deliberately asymmetric in the safe way:
  //   · failed ADD    → chip returns to OFF. The allergen genuinely is not
  //                     excluded server-side; pretending otherwise is the
  //                     exact failure this finding is about.
  //   · failed REMOVE → chip stays ON. The allergen is still excluded
  //                     server-side, so reverting over-excludes — the safe
  //                     direction, and still the truth.
  // Either way a loud, non-dismissable error names the allergen and says
  // plainly which state is actually in force until it's resolved.
  const serverExcluded = useMemo(
    () => (Array.isArray(profile.excludedFoods) ? profile.excludedFoods : []),
    [profile.excludedFoods]
  );
  const [excludedLocal, setExcludedLocal] = useState(serverExcluded);
  useEffect(() => { setExcludedLocal(serverExcluded); }, [serverExcluded]);
  const excluded = excludedLocal;

  // ── Allergies 2.0: searchable taxonomy + honest match reporting ──────────
  // The taxonomy is the SEARCH vocabulary only. It is fetched separately from
  // /api/profile/meta so that a build without the taxonomy module degrades to
  // the quick-chip list instead of breaking this card — an allergy control
  // that fails to render is worse than one that offers fewer suggestions.
  const [taxonomy, setTaxonomy] = useState({ available: false, taxonomy: [], reason: null });
  const [descriptions, setDescriptions] = useState(null);
  const [describeAvailable, setDescribeAvailable] = useState(true);
  const allergyInputRef = useRef(null);
  const allergyAnchorRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetchAllergenTaxonomy({ signal: abort.signal })
      .then((t) => { if (alive) setTaxonomy(t); })
      .catch((e) => {
        if (!alive || isAbortError(e)) return;
        setTaxonomy({ available: false, taxonomy: [], reason: describeError(e, "couldn't load the allergen list") });
      });
    return () => { alive = false; };
  }, [abort]);

  // Described against SERVER TRUTH, never the optimistic copy: this panel
  // reports how the saved exclusions will actually be matched, so it must not
  // describe a term that isn't saved yet.
  useEffect(() => {
    let alive = true;
    fetchExclusionDescriptions(serverExcluded, { signal: abort.signal })
      .then((r) => { if (!alive) return; setDescriptions(r.byTerm); setDescribeAvailable(r.available); })
      .catch((e) => {
        if (!alive || isAbortError(e)) return;
        setDescriptions({}); setDescribeAvailable(false);
      });
    return () => { alive = false; };
  }, [serverExcluded, abort]);

  const jumpToAllergies = () => {
    allergyAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    allergyInputRef.current?.focus({ preventScroll: true });
  };

  const [savingKeys, setSavingKeys] = useState([]); // in-flight exclusion saves
  // { keys, want, label, kind: "refused" | "unknown", detail }
  const [exclusionFailure, setExclusionFailure] = useState(null);
  const [rechecking, setRechecking] = useState(false);

  // Ask the server what it ACTUALLY has and re-sync the chips to it.
  // "landed" | "not-landed" | "unknown" — the only three honest answers.
  const verifyIntent = async (intent) => {
    try {
      const fresh = await api.getProfile({ signal: abort.signal });
      const list = Array.isArray(fresh?.excludedFoods) ? fresh.excludedFoods : [];
      setExcludedLocal(list); // server truth wins over any local guess
      return (intent.want
        ? intent.keys.every((k) => list.includes(k))
        : intent.keys.every((k) => !list.includes(k)))
        ? "landed" : "not-landed";
    } catch (e) {
      return isAbortError(e) ? "aborted" : "unknown";
    }
  };

  // THE one save path for every exclusion change — quick chip, search result,
  // free text, or a "did you mean" swap. Nothing writes excludedFoods except
  // this function, which is what keeps the rollback contract above total.
  // `intent` = { keys, want, label } — what the user was trying to make true.
  const saveExclusions = async (next, intent) => {
    const truth = serverExcluded;
    setExcludedLocal(next); // optimistic — the next toggle composes on it
    setSavingKeys((k) => [...k, ...intent.keys]);
    setExclusionFailure(null);
    try {
      await api.putProfile({ excludedFoods: next }, { signal: abort.signal });
      await refresh();
      setExclusionFailure(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setExcludedLocal(truth); // ROLLBACK to server truth — never show unsaved as saved
      const failure = {
        ...intent,
        // "the server said no" vs "the server never answered" — different
        // facts, different copy, never collapsed into each other.
        kind: isNoAnswer(e) ? "unknown" : "refused",
        detail: describeError(e),
      };
      setExclusionFailure(failure);
      // A no-answer failure is genuinely ambiguous — the PUT may have landed.
      // Resolve it by asking, rather than by guessing in either direction.
      if (failure.kind === "unknown") {
        const verdict = await verifyIntent(intent);
        if (verdict === "landed") { setExclusionFailure(null); await refresh(); }
        else if (verdict === "not-landed") {
          setExclusionFailure({ ...failure, kind: "refused", detail: `${failure.detail} Re-checked with the server: it is NOT saved.` });
          await refresh();
        }
        // "unknown"/"aborted" → the ambiguous banner stays up, as it should
      }
    } finally {
      setSavingKeys((k) => k.filter((x) => !intent.keys.includes(x)));
    }
  };

  const applyIntent = (list, intent) =>
    intent.want
      ? [...list.filter((t) => !intent.keys.includes(t)), ...intent.keys]
      : list.filter((t) => !intent.keys.includes(t));

  const retryExclusion = () => {
    if (!exclusionFailure) return;
    const intent = { keys: exclusionFailure.keys, want: exclusionFailure.want, label: exclusionFailure.label };
    saveExclusions(applyIntent(serverExcluded, intent), intent);
  };

  // Every add/remove — quick chip, search result, or free text — goes through
  // saveExclusions(), so ALL of them keep the rollback-to-server-truth
  // contract above. There is deliberately no second, quieter save path.
  const addTerm = (term) => {
    const t = String(term ?? "").trim();
    if (!t || excludedLocal.some((x) => normTerm(x) === normTerm(t))) return;
    const intent = { keys: [t], want: true, label: t };
    saveExclusions([...excludedLocal, t], intent);
  };

  const removeTerm = (term) => {
    const intent = { keys: [term], want: false, label: term };
    saveExclusions(excludedLocal.filter((x) => x !== term), intent);
  };

  // "did you mean Dairy?" → swap a literal-only term for the real category.
  // Described by what was ADDED (the safety-critical direction); a retry after
  // failure therefore re-adds the category and leaves the old literal term in
  // place — over-excluding, which is the safe way to be wrong.
  const replaceTerm = (oldTerm, newTerm, newLabel) => {
    const next = [
      ...excludedLocal.filter((x) => normTerm(x) !== normTerm(oldTerm) && normTerm(x) !== normTerm(newTerm)),
      newTerm,
    ];
    saveExclusions(next, { keys: [newTerm], want: true, label: `${newLabel || newTerm} (replacing “${oldTerm}”)` });
  };

  // "Check what the server has" — the manual form of the same verification.
  const recheckExclusions = async () => {
    if (!exclusionFailure) return;
    setRechecking(true);
    const verdict = await verifyIntent(exclusionFailure);
    if (verdict === "landed") { setExclusionFailure(null); await refresh(); }
    else if (verdict === "not-landed") {
      setExclusionFailure((f) => f && ({ ...f, kind: "refused", detail: "Re-checked with the server: this change is NOT saved." }));
      await refresh();
    } else if (verdict === "unknown") {
      setExclusionFailure((f) => f && ({ ...f, kind: "unknown", detail: "Still no answer from the server — the setting can't be confirmed yet." }));
    }
    setRechecking(false);
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
      <PageHead title="Profile" sub="Your stats, activity, diet rules, and rate of change. Everything else in the app — including the protein floor and lean-mass estimate — derives from this tab.">
        {/* Reachability cue: on a narrow window the Diet & allergies card
            stacks third, below the fold. A safety control may not be
            something you have to go hunting for — this puts it one keystroke
            from the top of the page and states the count out loud. */}
        <button type="button" onClick={jumpToAllergies}
          className="text-xs font-bold px-3 py-2 rounded-xl inline-flex items-center gap-1.5"
          style={{ background: C.card2, border: `1px solid ${C.faintLight}`, color: C.ink }}>
          <ShieldCheck size={13} aria-hidden="true" />
          Allergies &amp; exclusions ({excluded.length})
        </button>
      </PageHead>

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error} hint="Your last edit didn't save — re-enter the value. Fields commit when you click away from them." />
        </div>
      )}

      {pendingAck && (
        // role="alert": this is the safety-rail gate on an aggressive rate —
        // it must reach a screen reader immediately, not wait for the user
        // to stumble onto it.
        <div role="alert" className="mb-4 p-4 rounded-2xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} style={{ color: C.warn }} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-sm font-extrabold mb-1" style={{ color: C.warn }}>This rate needs an explicit OK</div>
              {pendingAck.reasons.map((r, i) => (
                <div key={i} className="text-xs font-semibold mb-0.5" style={{ color: C.ink }}>· {r}</div>
              ))}
              <div className="flex gap-2 mt-2.5">
                <Btn small onClick={confirmAck}>I understand — apply anyway</Btn>
                {/* Cancel must also put the typed fields back to server truth —
                    a declined change may not sit in the box looking applied. */}
                <Btn small kind="ghost" onClick={() => { setPendingAck(null); revertDrafts(); }}>Cancel</Btn>
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
                <button key={u} onClick={() => commit({ unitPref: u })} aria-pressed={pref === u}
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
          {/* a11y: the visible "Occupation" text was a bare <label> not
              wired to the input (no for/id, no wrapping) — its accessible
              name was riding entirely on a placeholder that changes text.
              Explicit htmlFor/id + aria-label fixes that; combobox/listbox
              roles describe the search+picker pattern to screen readers. */}
          <label className="block mb-1" htmlFor="occupation-search">{label("Occupation")}</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} aria-hidden="true" />
            <input
              id="occupation-search"
              placeholder={currentOcc ? `${currentOcc.label} (×${currentOcc.multiplier})` : "Search occupations…"}
              aria-label="Occupation — search"
              role="combobox" aria-expanded={occOpen} aria-haspopup="listbox" aria-controls="occupation-options" aria-autocomplete="list"
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
            <div id="occupation-options" role="listbox" aria-label="Occupation results" className="mt-1.5 max-h-52 overflow-y-auto rounded-xl" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
              {filteredOccupations.map((o) => (
                <button key={o.key} role="option" aria-selected={o.key === profile.occupationKey}
                  onClick={() => { commit({ occupationKey: o.key }); setOccQuery(""); setOccOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm font-semibold flex justify-between gap-2 hover:opacity-80"
                  style={{ color: C.ink, fontWeight: o.key === profile.occupationKey ? 800 : 600, background: o.key === profile.occupationKey ? C.card : "transparent", borderBottom: `1px solid ${C.rule}` }}>
                  <span className="truncate">{o.label}</span>
                  <span className="mono text-xs shrink-0" style={{ color: C.faint }}>×{o.multiplier}</span>
                </button>
              ))}
              {filteredOccupations.length === 0 && <div className="px-3 py-2 text-sm font-semibold" style={{ color: C.faint }}>No match — use the manual override below.</div>}
            </div>
          )}
          {metaError && (
            <div className="text-[10.5px] font-bold mt-1.5" style={{ color: C.warn }}>
              Occupation list unavailable — your saved occupation ({profile.occupationKey || "unset"}) is unchanged. Use the multiplier override below if you need to adjust now.
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
              {/* Fallback option = the saved value, so a failed meta load shows
                  the truth instead of an empty (apparently unset) select. */}
              <select value={profile.trainingStyle} disabled={!meta} onChange={(e) => commit({ trainingStyle: e.target.value })} className={inp} style={inpStyle}>
                {(meta?.trainingStyles || [{ key: profile.trainingStyle, label: profile.trainingStyle }]).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
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
          {/* A failed meta load must never render as "no options" — an empty
              dietary-style list would read as "your restriction was cleared"
              (frontend-arch-4). */}
          {metaError && (
            <div className="mb-3">
              <ErrorNote msg="Couldn't load the diet & allergy option lists."
                hint={`${metaError} Your saved settings are unchanged — but don't edit this card until the lists load. Retry below.`} />
              <button type="button" onClick={loadMeta}
                className="text-xs font-bold mt-2 px-3 py-1.5 rounded-xl"
                style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
                Retry loading options
              </button>
            </div>
          )}
          {/* Allergies FIRST inside this card: it is the safety-critical
              control on the screen and must not sit under two other fields.
              Selection is a lightness step, never green (law a) — excluding an
              allergen is not a "success". */}
          <div ref={allergyAnchorRef} className="mb-4">
            {!meta && !metaError ? (
              <SkeletonRows rows={3} />
            ) : (
              <AllergySearch
                taxonomy={taxonomy.taxonomy}
                taxonomyReason={taxonomy.reason}
                quickOptions={meta?.allergyOptions || []}
                selected={excluded}
                descriptions={descriptions}
                describeAvailable={describeAvailable}
                busyTerms={savingKeys}
                onAdd={addTerm}
                onRemove={removeTerm}
                onReplace={replaceTerm}
                inputRef={allergyInputRef}
              />
            )}
            {metaError && (
              // Without this the quick-chip row would just be blank, which
              // reads as "no allergies set" — the exact confusion
              // frontend-arch-4 is about.
              <div className="text-xs font-bold mt-2" style={{ color: C.warn }}>
                The common-allergen shortcuts are unavailable while the option list is down. Everything already
                excluded is listed above and is still being applied, and search + free text still work.
              </div>
            )}

            {savingKeys.length > 0 && (
              <div className="text-xs font-bold mt-2" style={{ color: C.warn }}>
                Saving your exclusions — not confirmed yet.
              </div>
            )}

            {/* frontend-arch-1: the failed-save state. Non-dismissable — it clears
                only when the change is actually saved or the server confirms what
                it really has. Sits directly under the control it describes, which
                is why it lives inside this block and not further down the card. */}
            {exclusionFailure && (
              <div role="alert" className="mt-2 p-3 rounded-xl" style={{ background: C.redBg, border: `1px solid ${C.red}` }}>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: C.red }} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold" style={{ color: C.red }}>
                      NOT SAVED — “{exclusionFailure.label}” {exclusionFailure.want ? "is NOT excluded" : "is STILL excluded"}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: C.ink }}>
                      {exclusionFailure.kind === "unknown"
                        ? (exclusionFailure.want
                          ? "The server never answered, so we can't confirm the exclusion was recorded. The chip has been put back to the last state the server confirmed — treat this allergen as NOT excluded, and do not rely on a meal plan to keep it out until this is resolved."
                          : "The server never answered, so the exclusion is still in force. That is the safe direction — nothing has been un-excluded.")
                        : (exclusionFailure.want
                          ? "The server refused the change, so the allergen is NOT excluded. Nothing about your plans has changed — but nothing is protecting you from it either."
                          : "The server refused the change, so the exclusion is still in force.")}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>{exclusionFailure.detail}</div>
                    <div className="flex gap-2 mt-2">
                      <Btn small onClick={retryExclusion} disabled={savingKeys.length > 0 || rechecking}>Try again</Btn>
                      <Btn small kind="ghost" onClick={recheckExclusions} disabled={rechecking || savingKeys.length > 0}>
                        {rechecking ? "Checking…" : "Check what the server has"}
                      </Btn>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <label className="block mb-4">{label("Dietary style")}
            <select value={profile.dietaryStyle || "none"} disabled={!meta}
              onChange={(e) => commit({ dietaryStyle: e.target.value === "none" ? null : e.target.value })} className={inp} style={inpStyle}>
              {/* Fallback keeps the user's ACTUAL saved style visible even when
                  the option list didn't load — a blank select would misrepresent
                  it as unset. */}
              {(meta?.dietaryStyles || [...new Set(["none", profile.dietaryStyle].filter(Boolean))]).map((s) => (
                <option key={s} value={s}>{s === "none" ? "None (no restriction)" : s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </label>

          {/* AI-recipe fields are optional — collapsed by default so they stop
              crowding the safety-critical diet/allergy controls above. */}
          <button type="button" onClick={() => setAiPrefsOpen((o) => !o)} aria-expanded={aiPrefsOpen}
            className="flex items-center gap-1.5 mt-4 text-xs font-bold" style={{ color: C.faint }}>
            <ChevronRight size={13} style={{ transform: aiPrefsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
            AI recipe preferences (optional)
          </button>
          {aiPrefsOpen && (
            <div className="mt-3">
              <label className="block mb-3">{label("Cuisine preferences")}
                <input type="text" placeholder="e.g. mexican, thai" value={prefsDraft.cuisinePreferences}
                  onChange={(e) => setPrefsDraft((d) => ({ ...d, cuisinePreferences: e.target.value }))}
                  onBlur={() => commit({ cuisinePreferences: prefsDraft.cuisinePreferences.split(",").map((x) => x.trim()).filter(Boolean) })}
                  className={inp} style={inpStyle} />
              </label>
              <label className="block">{label("Notes")}
                <textarea rows={2} value={prefsDraft.mealPreferencesNote}
                  onChange={(e) => setPrefsDraft((d) => ({ ...d, mealPreferencesNote: e.target.value }))}
                  onBlur={() => commit({ mealPreferencesNote: prefsDraft.mealPreferencesNote || null })}
                  className={inp} style={{ ...inpStyle, resize: "vertical" }} />
              </label>
            </div>
          )}

          <div className="text-xs font-semibold mt-4" style={{ color: exclusionFailure ? C.warn : C.faint }}>
            {exclusionFailure
              ? "Anything excluded here never appears in a plan or recipe — but the change above is NOT saved, so it is not being applied."
              : "Anything excluded here never appears in a plan or recipe."}
          </div>
        </Card>

        {/* ── rate of loss ── */}
        <Card section="PRESCRIPTION" title="Rate of loss" className="xl:col-span-12">
          {/* A failed meta load would otherwise render ZERO rate buttons, which
              reads as "you have no rate set" (frontend-arch-4). Fall back to
              showing the saved rate, and say why the others are missing. */}
          {metaError && (
            <div className="text-xs font-bold mb-2" style={{ color: C.warn }}>
              Rate options couldn't be loaded — only your saved rate is shown. Your prescription is unchanged.
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(meta?.rateOptions || (profile.rateLbPerWeek ? [profile.rateLbPerWeek] : [])).map((r) => {
              const active = profile.rateLbPerWeek === r;
              return (
                <button key={r} onClick={() => commit({ rateLbPerWeek: r })} aria-pressed={active}
                  className="px-4 py-2.5 rounded-xl text-center"
                  style={{ background: active ? C.card2 : "transparent", border: `1px solid ${active ? C.faintLight : C.rule}` }}>
                  {/* Metric users get kg/wk as the bold primary — every other
                      number on this tab converts, so this one should too. */}
                  <div className="mono text-sm font-extrabold" style={{ color: active ? C.ink : C.faint }}>{pref === "metric" ? `${r1(r * 0.453592)} kg/wk` : `${r} lb/wk`}</div>
                  <div className="text-[10px] font-bold" style={{ color: C.faintLight }}>{pref === "metric" ? `${r} lb/wk` : `${r1(r * 0.453592)} kg/wk`}</div>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <div className="text-xs font-semibold" style={{ color: C.faint }}>Daily target</div>
              <div className="mono stat-hero text-3xl" style={{ color: C.ink }}>{kc(summary.target?.target ?? profile.targetKcal)}<span className="text-xs ml-1" style={{ color: C.faint, fontWeight: 600 }}>kcal</span></div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: C.faint }}>
                TDEE {kc(summary.energy?.tdee ?? 0)} − {kc(summary.target?.deficit ?? 0)} deficit
                {summary.target?.floored && (
                  <span style={{ color: C.warn }}> → held at floor · ~{summary.target.achievableRate} lb/wk actual</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold" style={{ color: C.faint }}>Projected goal date</div>
              <div className="text-lg font-extrabold" style={{ color: C.ink }}>{goalDate || "—"}</div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: C.faint }}>at {displayRate(profile.rateLbPerWeek, pref)} {rateUnit(pref)} from your current average</div>
            </div>
            <label className="block">{label(`Personal floor (kcal, min ${meta?.safeFloor?.[profile.sex] ?? 1500})`)}
              <input type="number" placeholder={`default ${meta?.safeFloor?.[profile.sex] ?? 1500}`} value={draft.floor}
                onChange={(e) => setDraft((d) => ({ ...d, floor: e.target.value }))}
                onBlur={() => commit({ floorKcal: draft.floor === "" ? null : +draft.floor })}
                className={inp} style={inpStyle} />
            </label>
            <div className="flex items-center gap-2 pb-1.5">
              {summary.rateSafety?.unsafe ? (
                <><AlertTriangle size={16} style={{ color: C.warn }} aria-hidden="true" /><span className="text-xs font-bold" style={{ color: C.warn }}>Aggressive — acknowledged</span></>
              ) : (
                <><ShieldCheck size={16} style={{ color: C.good }} aria-hidden="true" /><span className="text-xs font-bold" style={{ color: C.good }}>Within safety rails</span></>
              )}
            </div>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Rates above ~1% of body weight per week, or targets that hit your floor, need an explicit "I understand" before they apply. Changing the rate updates the target, macro ranges, projections, and meal-plan targets instantly.
          </div>
        </Card>

        {/* ── resources — genuinely opt-in, never nagged ──
            No popup, no repeated prompt, no tracking of whether it's ever
            opened. Sits quietly at the bottom of Profile — the one screen a
            user visits deliberately, not the one they see every day (Today).
            Neutral tone: not a warning, not framed around this app, no red/
            amber judgment color. */}
        <Card section="RESOURCES" title="Outside help, if you ever want it" className="xl:col-span-12">
          <div className="text-xs font-semibold" style={{ color: C.faint }}>
            NEDA (the National Eating Disorders Association) runs a free, anonymous online screening — a few minutes, entirely optional, opens in your browser. This app doesn't know whether you click it or what you answer.
          </div>
          <a
            href="https://www.nationaleatingdisorders.org/screening-tool/"
            target="_blank" rel="noopener noreferrer"
            className="text-xs font-bold inline-flex items-center gap-1.5 mt-2.5 hover:opacity-80"
            style={{ color: C.ink }}
          >
            Take NEDA's free screening <ExternalLink size={12} aria-hidden="true" />
            <span className="sr-only">(opens in a new browser window)</span>
          </a>
        </Card>
      </div>
    </div>
  );
}
