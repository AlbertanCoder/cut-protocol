import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, AlertTriangle, ShieldCheck, ChevronRight, Info, Check } from "lucide-react";
import {
  displayWeight, parseWeight, displayHeight, parseHeight, displayRate,
  weightUnit, rateUnit, cm2ftin, ftin2cm,
} from "../lib/units.js";
import { Card, PageHead, Btn, ErrorNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import AllergySearch from "./ui/AllergySearch.jsx";
import { fetchAllergenTaxonomy, fetchExclusionDescriptions, normTerm } from "./ui/allergyTaxonomy.js";
import { api, isAbortError, isNoAnswer, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";
import BodyFatPicker from "./BodyFatPicker.jsx";
import ResourceList from "./ui/ResourceList.jsx";
import CoachSettings from "./CoachSettings.jsx";
import { WELLBEING_RESOURCES_NOTE } from "../lib/wellbeingResources.js";

const r1 = (n) => Math.round(n * 10) / 10;
const kc = (n) => Math.round(n).toLocaleString("en-CA");

// A stored key shown to a person when the server's own label isn't available.
// "desk-office" → "Desk office". Deliberately a generic transform and not a
// second copy of the occupation/training vocabulary: /api/profile/meta is the
// one source of those labels, and duplicating them here is how a list drifts.
const humanizeKey = (key) => {
  if (!key) return null;
  const words = String(key).replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
};

/** One message, under the input that caused it. Mirrors LoginScreen. */
function FieldError({ children }) {
  if (!children) return null;
  return <div className="text-[11px] font-semibold mt-1" style={{ color: "var(--warn)" }}>{children}</div>;
}

// The user-facing home of every personal input. Engine reads these and only
// shows the math. Commit-on-blur for typed fields, commit-on-change for
// pickers; every commit refreshes profile+summary so targets update
// instantly (Phase 3 spec).
export default function ProfileTab({ profile, summary, refresh, openToday }) {
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
    // imperial height is edited as ft + in (metric stays a single cm field)
    heightFt: cm2ftin(profile.heightCm).feet,
    heightIn: cm2ftin(profile.heightCm).inches,
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
  const [pendingAck, setPendingAck] = useState(null); // { patch, reasons, ack }
  // Per-input messages from the server. The PUT used to answer a bad edit with
  // one semicolon-joined string of column names and enum unions
  // ("heightCm must be a number between 100 and 250; goalWeightKg must be…"),
  // rendered raw in a red box at the top of the page — developer output that
  // escaped into the product. It now returns { field: sentence }.
  const [fieldErrors, setFieldErrors] = useState({});
  // The two refusals that are not field errors: an under-18 profile, and a
  // goal weight below the app's floor. Both explain themselves.
  const [gate, setGate] = useState(null); // { gate, error, detail[] }

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

  const clearFeedback = () => { setError(null); setFieldErrors({}); setGate(null); };

  // "idle" | "saving" | "saved" — drives the header receipt. It is set ONLY on
  // the real outcome of the request: never optimistically, so "Saved" cannot
  // appear for an edit the server refused. The failure path deliberately
  // returns it to idle rather than to a second error indicator, because
  // handleSaveError already owns the loud one.
  const [saveState, setSaveState] = useState("idle");
  const savedTimer = useRef(null);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const markSaved = () => {
    setSaveState("saved");
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
  };

  const commit = async (patch) => {
    clearFeedback();
    setSaveState("saving");
    try {
      await api.putProfile(patch, { signal: abort.signal });
      await refresh();
      markSaved();
    } catch (e) {
      if (isAbortError(e)) return;
      setSaveState("idle");
      handleSaveError(e, patch);
    }
  };

  // Every way the server can refuse a profile edit, each in its own shape.
  // Nothing here falls back to dumping a raw payload on screen.
  const handleSaveError = (e, patch) => {
    const b = e.body || {};
    // A refusal that is about the PERSON, not about a badly-typed number:
    // under 18, or a goal weight below the app's hard floor. Both come with
    // their own reasoning, and neither is something to "try again".
    if ((e.status === 403 && b.gate === "adult-only") || (e.status === 400 && b.gate === "goal-weight-floor")) {
      setGate(b);
      if (b.fields) setFieldErrors(b.fields);
      revertDrafts();
      return;
    }
    if (e.status === 422 && b.requiresAck) {
      // `ack` names WHICH confirmation is being asked for — the aggressive
      // rate and the low goal weight are different questions and both are 422.
      setPendingAck({ patch, reasons: b.reasons || [b.error], ack: b.ack || "rate" });
      return;
    }
    if (b.fields && Object.keys(b.fields).length) {
      setFieldErrors(b.fields);
      revertDrafts();
      return;
    }
    setError(describeError(e));
    revertDrafts();
  };

  const confirmAck = async () => {
    const { patch, ack } = pendingAck;
    setPendingAck(null);
    await commitWithAck(patch, ack);
  };
  const commitWithAck = async (patch, ack) => {
    clearFeedback();
    const flag = ack === "goalWeight" ? { goalWeightAcknowledged: true } : { rateAcknowledged: true };
    try {
      await api.putProfile({ ...patch, ...flag }, { signal: abort.signal });
      await refresh();
    } catch (e) {
      if (isAbortError(e)) return;
      handleSaveError(e, patch);
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
  // A label a person recognises, never the stored key. The summary endpoint
  // already carries the label the engine actually used, so it survives a
  // failed /meta load — which is exactly when this is needed.
  const savedOccupationLabel =
    currentOcc?.label
    || summary.energy?.jobLabel
    || humanizeKey(profile.occupationKey)
    || "not set";

  const inp = "text-sm px-3 py-2 rounded-xl w-full mt-1";
  const inpStyle = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };
  const badStyle = { ...inpStyle, border: `1.5px solid ${"var(--warn)"}` };
  // A field the engine is currently ignoring — same treatment as the derived
  // current-weight box above, so "you can't set this, and here's why" looks
  // the same wherever it happens rather than being invented per-field.
  const offStyle = { ...inpStyle, color: "var(--muted-foreground)", cursor: "not-allowed" };
  // No training style claimed → sessions × minutes × MET 0 is zero no matter
  // what the boxes say, so the whole additive term is off.
  const notTraining = profile.trainingStyle === "none";
  const label = (t) => <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>{t}</span>;

  // ── COMMIT-ON-BLUR, WITHOUT THE SILENT REWRITE ────────────────────────
  //
  // THE BUG: imperial height round-trips lossily. 178 cm → cm2ftin → 5'10" →
  // ftin2cm → 177.8 cm. 180 → 5'11" → 180.34. Both ft and in committed on
  // blur unconditionally, so simply TABBING THROUGH the height fields — no
  // keystroke, nothing changed on screen — rewrote the stored value. Worth up
  // to ±1.27 cm, about 8 kcal on Mifflin, and it compounded every visit.
  //
  // THE FIX, and why it is here rather than in units.js: a blur is not an
  // edit. The commit is now driven by the value in the USER'S OWN UNIT
  // actually differing from what is stored. If the boxes still read 5 ft
  // 10 in, the user has said nothing, and nothing is written. A genuine edit
  // to 5'11" still writes 180.34 cm, which is correct — that IS what they
  // said. units.js needs no change for this; see the report.
  const commitHeight = () => {
    if (pref === "metric") {
      const shown = displayHeight(profile.heightCm, "metric");
      if (+draft.height === shown) return;
      commit({ heightCm: parseHeight(+draft.height, "metric") });
      return;
    }
    const saved = cm2ftin(profile.heightCm);
    const ft = Number(draft.heightFt) || 0;
    const inches = Number(draft.heightIn) || 0;
    if (ft === Number(saved.feet) && inches === Number(saved.inches)) return;
    commit({ heightCm: ftin2cm(ft, inches) });
  };

  // Same lossy round-trip, same guard: displayWeight() rounds to 0.1, so
  // blurring an untouched goal-weight box re-wrote the stored kg by up to
  // 0.05 lb every time.
  const commitGoalWeight = () => {
    if (+draft.goal === displayWeight(profile.goalWeightKg, pref)) return;
    commit({ goalWeightKg: parseWeight(+draft.goal, pref) });
  };

  // ── PROJECTED GOAL DATE ───────────────────────────────────────────────
  //
  // This used to divide by `profile.rateLbPerWeek` — the rate the user PICKED
  // — and ignore the floor clamp entirely. So when the target was held at the
  // floor (a fact this very card states eight lines above, "→ held at floor ·
  // ~0.37 lb/wk actual"), the date underneath it was still computed at the
  // 2.0 lb/wk that is not going to happen. The screen knew and said it anyway.
  //
  // Two fixes, both about honesty rather than arithmetic:
  //   1. When the target is floored, re-derive from `achievableRate` — the
  //      rate the floored target actually delivers — and say so.
  //   2. Label the whole thing as a PLAN, not a measurement. TrendTab has this
  //      right ("At current/planned pace"); this card claimed a projection off
  //      a chosen number as though it were an observation. The trend line is
  //      where the measured answer lives, and the copy now points there.
  const goalProjection = useMemo(() => {
    const goalLb = displayWeight(profile.goalWeightKg, "imperial");
    const nowLb = displayWeight(avg7Kg, "imperial");
    const planRate = profile.rateLbPerWeek;
    const floored = !!summary.target?.floored;
    const rate = floored ? summary.target?.achievableRate : planRate;
    if (nowLb == null || goalLb == null || nowLb <= goalLb) return { date: null, floored, rate, planRate, reason: "at-or-past-goal" };
    // A floored target can deliver ~0 deficit. Dividing by that is an infinity
    // dressed up as a date.
    if (!rate || rate <= 0) return { date: null, floored, rate, planRate, reason: "no-deficit" };
    const days = ((nowLb - goalLb) / rate) * 7;
    const d = new Date(Date.now() + days * 864e5);
    return {
      date: d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }),
      floored, rate, planRate, reason: null,
    };
  }, [profile.goalWeightKg, profile.rateLbPerWeek, avg7Kg, summary.target]);

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
        {/* There is no Save button on this tab and there should not be one:
            every field commits the moment you leave it, and a failed commit
            reverts the box to server truth (see commit()/revertDrafts). What
            was missing was the other half of that contract — the tab did the
            saving silently, so from the outside it was indistinguishable from
            a form that had quietly dropped your edit. This is the receipt. */}
        <span aria-live="polite" className="text-xs font-bold inline-flex items-center gap-1.5 text-muted-foreground">
          {saveState === "saving" ? (
            <>Saving…</>
          ) : saveState === "saved" ? (
            <><Check size={13} aria-hidden="true" />Saved</>
          ) : (
            <>Changes save as you go</>
          )}
        </span>
        <button type="button" onClick={jumpToAllergies}
          className="text-xs font-bold px-3 py-2 rounded-xl inline-flex items-center gap-1.5 border border-border bg-secondary text-foreground">
          <ShieldCheck size={13} aria-hidden="true" />
          Allergies &amp; exclusions ({excluded.length})
        </button>
      </PageHead>

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error} hint="Your last edit didn't save — re-enter the value. Fields commit when you click away from them." />
        </div>
      )}

      {/* A refusal about the person rather than the typing: under 18, or a goal
          weight below the floor. Neutral surface, not red — this is not a
          crash and not a judgment (colour law b), and there is nothing to
          retry. It explains its reasoning; it does not just block. */}
      {gate && (
        <div role="alert" className="mb-4 p-5 rounded-2xl" style={{ background: "var(--card)", border: `1px solid ${"var(--muted-foreground)"}` }}>
          <div className="flex items-start gap-3">
            <Info size={20} style={{ color: "var(--muted-foreground)" }} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold" style={{ color: "var(--foreground)" }}>{gate.error}</div>
              {(gate.detail || []).map((p, i) => (
                <p key={i} className="text-xs font-semibold leading-relaxed mt-2" style={{ color: "var(--muted-foreground)" }}>{p}</p>
              ))}
              {gate.whatNow && <p className="text-xs font-bold mt-3" style={{ color: "var(--foreground)" }}>{gate.whatNow}</p>}
              <div className="mt-3">
                <Btn small kind="ghost" onClick={() => setGate(null)}>Got it</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingAck && (
        // role="alert": this is a safety rail — an aggressive rate, or a goal
        // weight under the population range. It must reach a screen reader
        // immediately, not wait for the user to stumble onto it.
        <div role="alert" className="mb-4 p-4 rounded-2xl" style={{ background: "color-mix(in srgb, var(--warn) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warn) 40%, transparent)" }}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} style={{ color: "var(--warn)" }} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-sm font-extrabold mb-1" style={{ color: "var(--warn)" }}>
                {pendingAck.ack === "goalWeight" ? "That goal weight needs an explicit OK" : "This rate needs an explicit OK"}
              </div>
              {pendingAck.reasons.map((r, i) => (
                <div key={i} className="text-xs font-semibold mb-1 leading-relaxed" style={{ color: "var(--foreground)" }}>· {r}</div>
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
                    background: pref === u ? "var(--secondary)" : "transparent", color: pref === u ? "var(--foreground)" : "var(--muted-foreground)",
                    border: `1px solid ${pref === u ? "var(--muted-foreground)" : "var(--border)"}`,
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
              <input type="number" value={draft.age} aria-invalid={!!fieldErrors.age}
                onChange={(e) => setDraft((d) => ({ ...d, age: +e.target.value || 0 }))}
                onBlur={() => commit({ age: draft.age })}
                className={inp} style={fieldErrors.age ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.age}</FieldError>
            </label>
            {pref === "metric" ? (
              <label className="block">{label("Height (cm)")}
                <input type="number" value={draft.height} aria-invalid={!!fieldErrors.heightCm}
                  onChange={(e) => setDraft((d) => ({ ...d, height: +e.target.value || 0 }))}
                  onBlur={commitHeight}
                  className={inp} style={fieldErrors.heightCm ? badStyle : inpStyle} />
                <FieldError>{fieldErrors.heightCm}</FieldError>
              </label>
            ) : (
              // a11y: this was a <div className="block"> wrapping the caption,
              // so NEITHER the feet box nor the inches box was associated with
              // the visible "Height (ft / in)" label. One caption over two
              // inputs is what fieldset/legend is for; the per-input
              // aria-labels stay for the individual boxes.
              <fieldset className="block border-0 p-0 m-0 min-w-0">
                <legend className="p-0">{label("Height (ft / in)")}</legend>
                <div className="flex gap-2 mt-1">
                  <input type="number" aria-label="Height feet" value={draft.heightFt} min="0" max="8"
                    aria-invalid={!!fieldErrors.heightCm}
                    onChange={(e) => setDraft((d) => ({ ...d, heightFt: e.target.value }))}
                    onBlur={commitHeight}
                    className="text-sm px-3 py-2.5 rounded-xl w-full" style={fieldErrors.heightCm ? badStyle : inpStyle} placeholder="ft" />
                  <input type="number" aria-label="Height inches" value={draft.heightIn} min="0" max="11"
                    aria-invalid={!!fieldErrors.heightCm}
                    onChange={(e) => setDraft((d) => ({ ...d, heightIn: e.target.value }))}
                    onBlur={commitHeight}
                    className="text-sm px-3 py-2.5 rounded-xl w-full" style={fieldErrors.heightCm ? badStyle : inpStyle} placeholder="in" />
                </div>
                <FieldError>{fieldErrors.heightCm}</FieldError>
              </fieldset>
            )}
            <label className="block">{label("Body fat % (optional)")}
              <input type="number" placeholder="unknown" value={draft.bf} aria-invalid={!!fieldErrors.bodyFatPct}
                onChange={(e) => setDraft((d) => ({ ...d, bf: e.target.value }))}
                onBlur={() => commit({ bodyFatPct: draft.bf === "" ? 0 : +draft.bf })}
                className={inp} style={fieldErrors.bodyFatPct ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.bodyFatPct}</FieldError>
              <button type="button" onClick={() => setBfPickerOpen(true)}
                className="text-[11px] font-bold underline mt-1" style={{ color: "var(--muted-foreground)" }}>
                Estimate visually
                {profile.bodyFatSource === "visual-estimate" ? " · set from silhouette" : profile.bodyFatSource === "measured" ? " · measured" : ""}
              </button>
            </label>
            <label className="block">{label(`Current weight (${weightUnit(pref)})`)}
              <input type="number" value={displayWeight(avg7Kg, pref)} readOnly aria-readonly="true"
                title="Calculated from your weigh-ins — log one on Today to change it"
                className={inp} style={{ ...inpStyle, color: "var(--muted-foreground)", cursor: "not-allowed" }} />
              {openToday && (
                <button type="button" onClick={openToday}
                  className="text-[11px] font-bold underline mt-1 hover:opacity-80" style={{ color: "var(--muted-foreground)" }}>
                  Log a weigh-in on Today →
                </button>
              )}
            </label>
            <label className="block">{label(`Goal weight (${weightUnit(pref)})`)}
              <input type="number" value={draft.goal} aria-invalid={!!fieldErrors.goalWeightKg}
                onChange={(e) => setDraft((d) => ({ ...d, goal: +e.target.value || 0 }))}
                onBlur={commitGoalWeight}
                className={inp} style={fieldErrors.goalWeightKg ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.goalWeightKg}</FieldError>
            </label>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: "var(--muted-foreground)" }}>
            Current weight is the average of your last 7 weigh-ins — it can't be typed here; log a weigh-in on Today to move it. Body fat % unlocks the two LBM-based BMR formulas.
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
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
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
            <div id="occupation-options" role="listbox" aria-label="Occupation results" className="mt-1.5 max-h-52 overflow-y-auto rounded-xl" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
              {filteredOccupations.map((o) => (
                <button key={o.key} role="option" aria-selected={o.key === profile.occupationKey}
                  onClick={() => { commit({ occupationKey: o.key }); setOccQuery(""); setOccOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm font-semibold flex justify-between gap-2 hover:opacity-80"
                  style={{ color: "var(--foreground)", fontWeight: o.key === profile.occupationKey ? 800 : 600, background: o.key === profile.occupationKey ? "var(--card)" : "transparent", borderBottom: "1px solid var(--border)" }}>
                  <span className="truncate">{o.label}</span>
                  <span className="tabular-nums text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>×{o.multiplier}</span>
                </button>
              ))}
              {filteredOccupations.length === 0 && <div className="px-3 py-2 text-sm font-semibold" style={{ color: "var(--muted-foreground)" }}>No match — use the manual override below.</div>}
            </div>
          )}
          {metaError && (
            // `profile.occupationKey` is a database key. Printed straight out
            // it read "your saved occupation (desk-office)" — the app showing
            // a person its own internals. The summary endpoint already carries
            // the real label the engine used (energy.jobLabel), so that is what
            // is shown; humanizeKey is only the last resort.
            <div className="text-[10.5px] font-bold mt-1.5" style={{ color: "var(--warn)" }}>
              Occupation list unavailable — your saved occupation ({savedOccupationLabel}) is unchanged. Use the multiplier override below if you need to adjust now.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">{label("Multiplier override")}
              <input type="number" step="0.05" placeholder={currentOcc ? `auto ×${currentOcc.multiplier}` : "e.g. 1.4"}
                value={draft.override} aria-invalid={!!fieldErrors.activityOverride}
                onChange={(e) => setDraft((d) => ({ ...d, override: e.target.value }))}
                onBlur={() => commit({ activityOverride: draft.override === "" ? null : +draft.override })}
                className={inp} style={fieldErrors.activityOverride ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.activityOverride}</FieldError>
            </label>
            <label className="block">{label("Training style")}
              {/* Fallback option = the saved value, so a failed meta load shows
                  the truth instead of an empty (apparently unset) select. It is
                  humanized rather than printed raw — the option used to render
                  the stored key verbatim ("mixed", "very-heavy"), which is the
                  same "app shows you its own column values" problem as the
                  occupation line above. */}
              <select value={profile.trainingStyle} disabled={!meta} onChange={(e) => commit({ trainingStyle: e.target.value })} className={inp} style={inpStyle}>
                {(meta?.trainingStyles || [{ key: profile.trainingStyle, label: humanizeKey(profile.trainingStyle) || "Your saved style" }])
                  .map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <FieldError>{fieldErrors.trainingStyle}</FieldError>
            </label>
            {/* Sessions and minutes multiply the style's MET, so when the
                style is "none" they multiply zero — whatever sits in these
                boxes changes nothing. Leaving them live would let someone type
                "4 × 60" and reasonably expect it to count. They go quiet and
                say why, rather than accepting input the engine discards. */}
            <label className="block">{label("Sessions / week")}
              <input type="number" min={0} max={14} value={notTraining ? "" : draft.sessions}
                disabled={notTraining} aria-invalid={!!fieldErrors.sessionsPerWeek}
                onChange={(e) => setDraft((d) => ({ ...d, sessions: +e.target.value || 0 }))}
                onBlur={() => commit({ sessionsPerWeek: draft.sessions })}
                className={inp} style={notTraining ? offStyle : fieldErrors.sessionsPerWeek ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.sessionsPerWeek}</FieldError>
            </label>
            <label className="block">{label("Minutes / session")}
              <input type="number" min={0} max={300} value={notTraining ? "" : draft.minutes}
                disabled={notTraining} aria-invalid={!!fieldErrors.minutesPerSession}
                onChange={(e) => setDraft((d) => ({ ...d, minutes: +e.target.value || 0 }))}
                onBlur={() => commit({ minutesPerSession: draft.minutes })}
                className={inp} style={notTraining ? offStyle : fieldErrors.minutesPerSession ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.minutesPerSession}</FieldError>
            </label>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: "var(--muted-foreground)" }}>
            {notTraining
              ? "Your occupation multiplier is doing all the work — no training kcal are being added. That is a normal way to run a cut, and the target below is built for it. Pick a training style above if that changes."
              : "Occupation sets the day-to-day multiplier; training adds its own kcal on top. The Engine tab shows the exact math."}
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
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
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
              <div className="text-xs font-bold mt-2" style={{ color: "var(--warn)" }}>
                The common-allergen shortcuts are unavailable while the option list is down. Everything already
                excluded is listed above and is still being applied, and search + free text still work.
              </div>
            )}

            {savingKeys.length > 0 && (
              <div className="text-xs font-bold mt-2" style={{ color: "var(--warn)" }}>
                Saving your exclusions — not confirmed yet.
              </div>
            )}

            {/* frontend-arch-1: the failed-save state. Non-dismissable — it clears
                only when the change is actually saved or the server confirms what
                it really has. Sits directly under the control it describes, which
                is why it lives inside this block and not further down the card. */}
            {exclusionFailure && (
              <div role="alert" className="mt-2 p-3 rounded-xl" style={{ background: "color-mix(in srgb, var(--destructive) 12%, transparent)", border: `1px solid ${"var(--destructive)"}` }}>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--destructive)" }} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold" style={{ color: "var(--destructive)" }}>
                      NOT SAVED — “{exclusionFailure.label}” {exclusionFailure.want ? "is NOT excluded" : "is STILL excluded"}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: "var(--foreground)" }}>
                      {exclusionFailure.kind === "unknown"
                        ? (exclusionFailure.want
                          ? "The server never answered, so we can't confirm the exclusion was recorded. The chip has been put back to the last state the server confirmed — treat this allergen as NOT excluded, and do not rely on a meal plan to keep it out until this is resolved."
                          : "The server never answered, so the exclusion is still in force. That is the safe direction — nothing has been un-excluded.")
                        : (exclusionFailure.want
                          ? "The server refused the change, so the allergen is NOT excluded. Nothing about your plans has changed — but nothing is protecting you from it either."
                          : "The server refused the change, so the exclusion is still in force.")}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: "var(--muted-foreground)" }}>{exclusionFailure.detail}</div>
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
            <FieldError>{fieldErrors.dietaryStyle}</FieldError>
          </label>

          {/* AI-recipe fields are optional — collapsed by default so they stop
              crowding the safety-critical diet/allergy controls above. */}
          <button type="button" onClick={() => setAiPrefsOpen((o) => !o)} aria-expanded={aiPrefsOpen}
            className="flex items-center gap-1.5 mt-4 text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>
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

          <div className="text-xs font-semibold mt-4" style={{ color: exclusionFailure ? "var(--warn)" : "var(--muted-foreground)" }}>
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
            <div className="text-xs font-bold mb-2" style={{ color: "var(--warn)" }}>
              Rate options couldn't be loaded — only your saved rate is shown. Your prescription is unchanged.
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(meta?.rateOptions || (profile.rateLbPerWeek ? [profile.rateLbPerWeek] : [])).map((r) => {
              const active = profile.rateLbPerWeek === r;
              return (
                <button key={r} onClick={() => commit({ rateLbPerWeek: r })} aria-pressed={active}
                  className="px-4 py-2.5 rounded-xl text-center"
                  style={{ background: active ? "var(--secondary)" : "transparent", border: `1px solid ${active ? "var(--muted-foreground)" : "var(--border)"}` }}>
                  {/* Metric users get kg/wk as the bold primary — every other
                      number on this tab converts, so this one should too. */}
                  <div className="tabular-nums text-sm font-extrabold" style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}>{r === 0 ? "Maintain" : pref === "metric" ? `${r1(r * 0.453592)} kg/wk` : `${r} lb/wk`}</div>
                  <div className="text-[10px] font-bold" style={{ color: "var(--muted-foreground)" }}>{r === 0 ? "hold steady" : pref === "metric" ? `${r} lb/wk` : `${r1(r * 0.453592)} kg/wk`}</div>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>Daily target</div>
              <div className="font-heading font-extrabold tracking-tight tabular-nums text-3xl" style={{ color: "var(--foreground)" }}>{kc(summary.target?.target ?? profile.targetKcal)}<span className="text-xs ml-1" style={{ color: "var(--muted-foreground)", fontWeight: 600 }}>kcal</span></div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                TDEE {kc(summary.energy?.tdee ?? 0)} − {kc(summary.target?.deficit ?? 0)} deficit
                {summary.target?.floored && (
                  <span style={{ color: "var(--warn)" }}> → held at floor · ~{summary.target.achievableRate} lb/wk actual</span>
                )}
              </div>
            </div>
            <div>
              {/* "If the plan holds", not "projected" — this is arithmetic on a
                  rate you CHOSE, not a reading of what your weight is doing.
                  The measured answer lives on the Trend tab and the copy says
                  so. When the target is floored the date is re-derived from the
                  rate that floor actually delivers; the old version divided by
                  the picked rate and produced a date the card itself, eight
                  lines above, had already contradicted. */}
              <div className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>Goal date, if the plan holds</div>
              <div className="text-lg font-extrabold" style={{ color: "var(--foreground)" }}>{goalProjection.date || "—"}</div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: goalProjection.floored ? "var(--warn)" : "var(--muted-foreground)" }}>
                {goalProjection.reason === "at-or-past-goal"
                  ? "You're at or past your goal weight — nothing to project."
                  : goalProjection.reason === "no-deficit"
                    ? "Your target is held at the floor and isn't producing a deficit, so there's no date to give. Going faster means adding movement, not eating less."
                    : goalProjection.floored
                      ? `Re-figured at the ${displayRate(goalProjection.rate, pref)} ${rateUnit(pref)} your floored target actually delivers — not the ${displayRate(goalProjection.planRate, pref)} you picked.`
                      : `A plan, not a measurement: ${displayRate(goalProjection.rate, pref)} ${rateUnit(pref)} from your current average, assuming it holds. Trend shows the pace you're actually on.`}
              </div>
            </div>
            <label className="block">{label(`Personal floor (kcal, min ${meta?.safeFloor?.[profile.sex] ?? 1500})`)}
              <input type="number" placeholder={`default ${meta?.safeFloor?.[profile.sex] ?? 1500}`} value={draft.floor}
                aria-invalid={!!fieldErrors.floorKcal}
                onChange={(e) => setDraft((d) => ({ ...d, floor: e.target.value }))}
                onBlur={() => commit({ floorKcal: draft.floor === "" ? null : +draft.floor })}
                className={inp} style={fieldErrors.floorKcal ? badStyle : inpStyle} />
              <FieldError>{fieldErrors.floorKcal}</FieldError>
            </label>
            <div className="pb-1.5">
              {/* NOT a clinical clearance. The old green "Within safety rails"
                  shield read as one — and WellbeingCheck says the opposite in
                  as many words ("conservative defaults, not a statement that
                  any intake is safe for you"). It also spent the accent on
                  something that is not on-target / primary-action / success
                  (colour law a). It now says exactly what it knows: the
                  numbers are inside the limits THIS APP ships with. */}
              {summary.rateSafety?.unsafe ? (
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} style={{ color: "var(--warn)" }} aria-hidden="true" />
                  <span className="text-xs font-bold" style={{ color: "var(--warn)" }}>Aggressive — acknowledged</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
                  <span className="text-xs font-bold" style={{ color: "var(--foreground)" }}>Inside this app&apos;s default limits</span>
                </div>
              )}
              <div className="text-[10.5px] font-semibold mt-1" style={{ color: "var(--muted-foreground)" }}>
                Conservative defaults — not a statement that this intake is safe for you.
              </div>
            </div>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: "var(--muted-foreground)" }}>
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
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--muted-foreground)" }}>
            If food, eating, or your body ever feels hard, these are free, confidential Alberta &amp; Canada
            services — entirely optional. You can also run the private Wellbeing check any time from the sidebar.
          </p>
          <p className="text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>{WELLBEING_RESOURCES_NOTE}</p>
          <ResourceList />
        </Card>

        {/* Connecting the coach lives on Profile for the same reason the
            resources card does: it is a screen the user visits deliberately,
            not the one they see every day. It renders identically whether or
            not a relay is configured, and on a fresh install it simply says the
            coach is off — no nag, no badge, no prompt. */}
        <CoachSettings />
      </div>
    </div>
  );
}
