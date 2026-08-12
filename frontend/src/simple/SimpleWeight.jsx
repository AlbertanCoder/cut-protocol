import { useCallback, useEffect, useState } from "react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { todayStr, fmtD } from "../lib/dates.js";
import { parseWeight, displayWeight, weightUnit } from "../lib/units.js";
import { Note, NumberBox, RowAction, Details } from "./parts.jsx";

// A box to type today's weight.
//
// Deliberately NOT the Trend tab. No seven-day average, no rate, no projected
// goal date, no standard-error band, no lean-mass overlay, no outlier
// disclosure, no estimated body fat. All of that still exists, unchanged, on
// the full surface — TrendTab.jsx is not modified by this work.
//
// The weight-over-time line lives on Progress › Weight, where SimpleProgress
// renders the shared TrendLine (parts.jsx) with "Where you are", the rate and
// the days count beside it. This screen used to draw an identical second copy
// from a second network read of the same readings; now it links there instead.
// TrendLine itself is untouched.
//
// NO CALCULATION HAPPENS HERE. Weights are converted for display with the
// app's existing lib/units.js helpers and stored in kg exactly as
// TodayTab.jsx:794 stores them.

export default function SimpleWeight({ profile, onSaved, onOpenProgress }) {
  const pref = profile?.unitPref || "imperial";
  const unit = weightUnit(pref);

  const [w, setW] = useState("");
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.getWeighins();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      if (!isAbortError(e)) setError(describeError(e));
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const n = Number(w);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.postWeighin(todayStr(), parseWeight(n, pref));
      setW("");
      setSaved(true);
      await load();
      // The daily number is re-derived from weigh-ins server-side, so the rest
      // of the app needs to hear about this.
      if (onSaved) await onSaved();
    } catch (e) {
      if (!isAbortError(e)) setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const points = (rows || [])
    .filter((r) => r && typeof r.date === "string" && Number.isFinite(r.weightKg))
    .sort((a, b) => a.date.localeCompare(b.date))
    // TrendLine's point shape, kept intact even though Progress draws the line
    // now — here the count decides between the link and the not-enough copy.
    .map((r, i) => ({ date: r.date, dateLabel: fmtD(r.date), x: i, y: r.weightKg, w: displayWeight(r.weightKg, pref) }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* h2, not h1 — this sits below the day of food on one continuous
            page, and that page already has its heading. */}
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Your weight</h2>
        <p className="text-base text-muted-foreground">
          Weigh yourself in the morning, before eating. Same time each day is more useful than being exact.
        </p>
      </div>

      {error && <Note>{error}</Note>}

      <div className="flex flex-col gap-3">
        {/* One primary action per screen (parts.jsx:33), and on this page that
            is "I ate this". Saving a weigh-in is the small button at the right
            of the weight row — the same shape as Swap. Enter still saves. */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <NumberBox value={w} onChange={(v) => { setW(v); setSaved(false); }} unit={unit} placeholder="0" onEnter={save} />
          </div>
          <RowAction onClick={save} disabled={busy || !w} label="Save today's weight">
            {busy ? "Saving…" : "Save"}
          </RowAction>
        </div>
        {saved && <p className="text-base text-muted-foreground">Saved.</p>}
      </div>

      {rows === null ? null : points.length >= 2 ? (
        // The chart lives on Progress › Weight — the identical line from the
        // same readings, with the numbers beside it. Here it is one line and
        // one tap, not a second copy. `onOpenProgress` is the shell's own
        // door-switch; until the shell passes it, the sentence still names
        // the door so it is never a dead control.
        onOpenProgress ? (
          <Details onClick={onOpenProgress} label="See your weight over time" />
        ) : (
          <p className="text-base text-muted-foreground">See your weight over time under Progress.</p>
        )
      ) : (
        <div className="rounded-2xl border border-border bg-card px-5 py-5">
          <p className="text-base text-muted-foreground leading-relaxed">
            {/* Both sentences are word-for-word the ones Progress › Weight
                shows (SimpleProgress.jsx:62 and :72), so the two doors answer
                the same moment the same way. Duplication is fine for now. */}
            {points.length === 1
              ? "First point logged — the line starts with your second weigh-in."
              : "Nothing to show yet — log your first weight and the line starts here."}
          </p>
        </div>
      )}
    </div>
  );
}
