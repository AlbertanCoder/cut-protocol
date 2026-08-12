import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { displayWeight, parseWeight, displayHeight, parseHeight, weightUnit, cm2ftin, ftin2cm } from "../lib/units.js";
import { normTerm, fetchAllergenTaxonomy, fetchExclusionDescriptions } from "../components/ui/allergyTaxonomy.js";
import ResourceList from "../components/ui/ResourceList.jsx";
import { Page, Panel, Row, Pill, Search, Stat, Note, Busy, Quiet, Details, NumberBox } from "./parts.jsx";

// You › Your details — 32 capabilities (Profile 28 + the body-fat picker's 4).
//
// SAVE-AS-YOU-GO, like the full tab: each field commits on blur, and the
// receipt says so out loud. There is no Save button to forget to press.
//
// THE BLUR GUARD IS LOAD-BEARING, not an optimisation. Every commit converts
// through lib/units.js, and a round-trip through kg and back can shift the
// last decimal — so writing on every blur regardless would send a "change"
// the user never made, and on the rate/goal fields that can trip the server's
// acknowledgement gates for no reason. We compare in the unit the user typed
// in, and only write when that changed. Same rule as ProfileTab's own guard.
//
// FAILURE REVERTS TO SERVER TRUTH. If a write is refused, the box goes back to
// what the server actually holds rather than keeping an optimistic value that
// was never saved. An input showing a number nobody stored is the worst
// outcome on this screen.
//
// NOTHING IS DELETED. The occupation multiplier override, the AI recipe
// preference block, the coach-connect card, the "check what the server has"
// re-verification, and the per-formula exclusions all still live in
// ProfileTab.jsx and EngineTab.jsx, behind the link at the bottom.

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

// The eight the wizard offers, in plain words. The full tab keeps the
// searchable 36-occupation table.
const COMMON_JOBS = [
  { key: "desk-office", label: "Mostly sitting" },
  { key: "light-active", label: "On my feet some" },
  { key: "retail-service", label: "On my feet all day" },
  { key: "trades-general", label: "Physical work" },
];

export default function SimpleDetails({ profile, summary, refresh, onShowFull, onOpenToday }) {
  const pref = profile?.unitPref || "imperial";
  const wUnit = weightUnit(pref);

  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState(null);   // "saving" | "saved" | null
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState({});
  const [ack, setAck] = useState(null);         // { kind, text, patch }

  // Drafts mirror the server. They re-seed whenever the profile changes, so a
  // refresh after any commit pulls every box back to truth.
  const [d, setD] = useState({});
  useEffect(() => {
    if (!profile) return;
    const { feet, inches } = cm2ftin(profile.heightCm ?? 0);
    setD({
      age: profile.age ?? "",
      heightCm: profile.heightCm == null ? "" : String(displayHeight(profile.heightCm, "metric")),
      heightFt: feet === "" ? "" : String(feet),
      heightIn: inches === "" ? "" : String(inches),
      goal: profile.goalWeightKg == null ? "" : String(displayWeight(profile.goalWeightKg, pref)),
      bf: profile.bodyFatPct ? String(profile.bodyFatPct) : "",
    });
  }, [profile, pref]);

  useEffect(() => {
    api.getProfileMeta().then(setMeta).catch(() => setMeta("error"));
  }, []);

  // ── Allergies ──────────────────────────────────────────────────────────
  const [taxonomy, setTaxonomy] = useState({ available: false, taxonomy: [] });
  const [descriptions, setDescriptions] = useState({});
  const [q, setQ] = useState("");
  const [exBusy, setExBusy] = useState(false);
  // Memoised on the profile, not rebuilt inline. `profile?.excludedFoods || []`
  // hands back a fresh array identity on every render, which makes the describe
  // effect below fire on every render — a network request per keystroke
  // anywhere on the screen. Same trap as SimpleRecipes' filter memo.
  const exclusions = useMemo(() => profile?.excludedFoods || [], [profile]);

  useEffect(() => {
    let alive = true;
    fetchAllergenTaxonomy()
      .then((t) => { if (alive) setTaxonomy(t); })
      .catch(() => { if (alive) setTaxonomy({ available: false, taxonomy: [] }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchExclusionDescriptions(exclusions)
      .then((r) => { if (alive) setDescriptions(r.byTerm || {}); })
      .catch(() => { if (alive) setDescriptions({}); });
    return () => { alive = false; };
  }, [exclusions]);

  // ── The one write path ─────────────────────────────────────────────────
  const commit = useCallback(async (patch, opts = {}) => {
    setStatus("saving");
    setError(null);
    setFieldError({});
    try {
      await api.putProfile({ ...patch, ...(opts.acks || {}) });
      await refresh();
      setStatus("saved");
      setAck(null);
      setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 2500);
      return true;
    } catch (e) {
      if (isAbortError(e)) { setStatus(null); return false; }
      const b = e.body || {};
      // The server's three refusals, each answered in its own shape — the same
      // contract SetupWizard.jsx:516-540 handles.
      if (e.status === 403 && b.gate === "adult-only") {
        setError(b.error || "This app is for adults only.");
      } else if (e.status === 400 && b.gate === "goal-weight-floor") {
        setError(b.error || "That goal weight is below what's safe for your height.");
      } else if (e.status === 422 && b.requiresAck) {
        setAck({
          kind: b.ack === "goalWeight" ? "goalWeight" : "rate",
          text: b.ack === "goalWeight" ? b.error : (b.reasons || []).join(" "),
          patch,
        });
      } else if (b.fields && Object.keys(b.fields).length) {
        setFieldError(b.fields);
      } else {
        setError(describeError(e));
      }
      setStatus(null);
      // Refusal means the draft is not what the server holds. Pull it back.
      await refresh();
      return false;
    }
  }, [refresh]);

  // Blur guard: compare in the unit the user typed in, not in kg.
  const lastSent = useRef({});
  const commitIfChanged = (key, typed, build) => {
    const v = String(typed ?? "").trim();
    if (v === "" || lastSent.current[key] === v) return;
    lastSent.current[key] = v;
    commit(build(Number(v)));
  };

  const toggleExclusion = async (term) => {
    const has = exclusions.some((x) => normTerm(x) === normTerm(term));
    const next = has
      ? exclusions.filter((x) => normTerm(x) !== normTerm(term))
      : [...exclusions, term];
    setExBusy(true);
    await commit({ excludedFoods: next });
    setExBusy(false);
    setQ("");
  };

  if (!profile) return <Busy>Getting your details…</Busy>;

  const suggestions = q.trim() && taxonomy.available
    ? (taxonomy.taxonomy || [])
        .filter((t) => (t.label || t.term || "").toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  const rateOptions = (meta && meta !== "error" && Array.isArray(meta.rateOptions)) ? meta.rateOptions : [];
  const heldAtFloor = Number.isFinite(profile.targetKcal) && Number.isFinite(profile.floorKcal)
    && profile.targetKcal <= profile.floorKcal;

  return (
    <Page
      title="Your details"
      sub={status === "saving" ? "Saving…" : status === "saved" ? "Saved." : "Changes save as you go."}
    >
      {error && <Note>{error}</Note>}

      {/* An acknowledgement the server asked for. Cancel puts the boxes back
          rather than leaving a value that was never stored. */}
      {ack && (
        <Panel tone="warn">
          <div className="flex flex-col gap-4">
            <p className="text-base leading-relaxed">{ack.text}</p>
            <div className="flex gap-2 flex-wrap">
              <Pill
                on
                onClick={() =>
                  commit(ack.patch, {
                    acks: ack.kind === "goalWeight"
                      ? { goalWeightAcknowledged: true }
                      : { rateAcknowledged: true },
                  })
                }
              >
                I understand — go ahead
              </Pill>
              <Quiet onClick={() => { setAck(null); refresh(); }}>Cancel</Quiet>
            </div>
          </div>
        </Panel>
      )}

      {/* ── What you're eating ─────────────────────────────────────── */}
      <Panel>
        <Stat label="Eat each day" value={`${kc(profile.targetKcal)} calories`} />
        {Number.isFinite(profile.floorKcal) && <Stat label="Never below" value={`${kc(profile.floorKcal)} calories`} />}
      </Panel>
      {heldAtFloor && (
        <p className="text-base text-warn leading-relaxed">
          You&rsquo;re being held at your floor. Losing faster would mean eating less than is safe,
          so the app won&rsquo;t plan it — add movement instead.
        </p>
      )}

      {/* ── How fast ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">How fast do you want to lose?</h2>
        <div className="flex gap-2 flex-wrap">
          {rateOptions.map((r) => (
            <Pill key={r} on={r === profile.rateLbPerWeek} onClick={() => commit({ rateLbPerWeek: r })}>
              {r} lb a week
            </Pill>
          ))}
        </div>
        {fieldError.rateLbPerWeek && <p className="text-base text-warn">{fieldError.rateLbPerWeek}</p>}
      </div>

      {/* ── Your body ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Your body</h2>

        <Row
          label="Weight now"
          lead={`${displayWeight(summary?.avg7Kg ?? profile.startWeightKg, pref) ?? "—"} ${wUnit}`}
          meta="This comes from your weigh-ins"
          action={<Quiet onClick={onOpenToday}>Log one</Quiet>}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-base text-muted-foreground">Age</span>
            <NumberBox
              value={d.age ?? ""}
              onChange={(v) => setD((c) => ({ ...c, age: v }))}
              unit="years"
              onEnter={() => commitIfChanged("age", d.age, (n) => ({ age: n }))}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-base text-muted-foreground">Goal weight</span>
            <NumberBox
              value={d.goal ?? ""}
              onChange={(v) => setD((c) => ({ ...c, goal: v }))}
              unit={wUnit}
              onEnter={() => commitIfChanged("goal", d.goal, (n) => ({ goalWeightKg: parseWeight(n, pref) }))}
            />
          </label>
        </div>
        {fieldError.goalWeightKg && <p className="text-base text-warn">{fieldError.goalWeightKg}</p>}

        <div className="flex flex-col gap-2">
          <span className="text-base text-muted-foreground">Height</span>
          {pref === "metric" ? (
            <NumberBox
              value={d.heightCm ?? ""}
              onChange={(v) => setD((c) => ({ ...c, heightCm: v }))}
              unit="cm"
              onEnter={() => commitIfChanged("h", d.heightCm, (n) => ({ heightCm: parseHeight(n, "metric") }))}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <NumberBox
                value={d.heightFt ?? ""}
                onChange={(v) => setD((c) => ({ ...c, heightFt: v }))}
                unit="ft"
                onEnter={() => commitIfChanged("h", `${d.heightFt}-${d.heightIn}`, () => ({ heightCm: ftin2cm(d.heightFt, d.heightIn) }))}
              />
              <NumberBox
                value={d.heightIn ?? ""}
                onChange={(v) => setD((c) => ({ ...c, heightIn: v }))}
                unit="in"
                onEnter={() => commitIfChanged("h", `${d.heightFt}-${d.heightIn}`, () => ({ heightCm: ftin2cm(d.heightFt, d.heightIn) }))}
              />
            </div>
          )}
        </div>

        <Quiet
          onClick={() => commit({ unitPref: pref === "metric" ? "imperial" : "metric" })}
        >
          {pref === "metric" ? "Use feet and pounds instead" : "Use centimetres and kilograms instead"}
        </Quiet>
      </div>

      {/* ── Your day ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Your day</h2>
        <p className="text-base text-muted-foreground">
          Roughly how much you move at work. It changes how much you get to eat.
        </p>
        <div className="flex gap-2 flex-wrap">
          {COMMON_JOBS.map((j) => (
            <Pill key={j.key} on={j.key === profile.occupationKey} onClick={() => commit({ occupationKey: j.key })}>
              {j.label}
            </Pill>
          ))}
        </div>
        {meta === "error" && (
          <p className="text-base text-muted-foreground">
            Couldn&rsquo;t load the full job list. Yours is saved as {profile.occupationKey}.
          </p>
        )}
        <Details onClick={onShowFull} label="The full job list, training sessions, and the multiplier" />
      </div>

      {/* ── Foods you avoid ────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          Foods you avoid{exclusions.length ? ` (${exclusions.length})` : ""}
        </h2>
        <p className="text-base text-muted-foreground">
          These filter every meal the app builds. Removing one takes effect on your next plan.
        </p>

        <Search value={q} onChange={setQ} placeholder="Add something you can't eat" />

        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {suggestions.map((s) => (
              <Pill key={s.term || s.label} onClick={() => toggleExclusion(s.label || s.term)}>
                {s.label || s.term}
              </Pill>
            ))}
          </div>
        )}

        {q.trim() && suggestions.length === 0 && (
          <Quiet onClick={() => toggleExclusion(q.trim())}>Add &ldquo;{q.trim()}&rdquo; as typed</Quiet>
        )}

        {exclusions.length === 0 ? (
          <Panel>Nothing set. Every recipe is on the table.</Panel>
        ) : (
          <div className="flex flex-col gap-2">
            {exclusions.map((t) => {
              const dsc = descriptions[normTerm(t)];
              return (
                <Row
                  key={t}
                  lead={t}
                  meta={
                    dsc?.kind === "category"
                      ? `Matched as a group — covers ${dsc.matchCount ?? "several"} foods`
                      : dsc
                        ? "Matched on the name only"
                        : undefined
                  }
                  action={<Quiet onClick={() => toggleExclusion(t)}>{exBusy ? "…" : "Remove"}</Quiet>}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Outside help. Never hidden, never greyed out — a standing safety
             rule that survives any visual direction. ─────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Outside help, if you ever want it</h2>
        <ResourceList />
      </div>

      <Details onClick={onShowFull} label="Everything else — body fat, formulas, the coach, your account" />
    </Page>
  );
}
