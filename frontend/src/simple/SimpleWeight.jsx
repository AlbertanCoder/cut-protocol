import { useCallback, useEffect, useState } from "react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { todayStr, fmtD } from "../lib/dates.js";
import { parseWeight, displayWeight, weightUnit } from "../lib/units.js";
import { Big, Note, NumberBox, TrendLine } from "./parts.jsx";

// A box to type today's weight, and a line showing it over time.
//
// Deliberately NOT the Trend tab. No seven-day average, no rate, no projected
// goal date, no standard-error band, no lean-mass overlay, no outlier
// disclosure, no estimated body fat. All of that still exists, unchanged, on
// the full surface — TrendTab.jsx is not modified by this work.
//
// The line is a plain SVG polyline stroked with `currentColor`, so it inherits
// the theme's foreground colour and works in light and dark without a single
// colour literal (scripts/no-hardcoded-colours.js).
//
// NO CALCULATION HAPPENS HERE. The only arithmetic is fitting points into a
// viewBox — screen geometry, not body data. Weights are converted for display
// with the app's existing lib/units.js helpers and stored in kg exactly as
// TodayTab.jsx:794 stores them.

// The line itself moved to parts.jsx as TrendLine the moment Progress needed
// one too — one implementation, two callers.

export default function SimpleWeight({ profile, onSaved }) {
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
    // `dateLabel` is what TrendLine renders at each end — formatting happens
    // here so the shared component never has to know about date helpers.
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
        <NumberBox value={w} onChange={(v) => { setW(v); setSaved(false); }} unit={unit} placeholder="0" onEnter={save} />
        <Big onClick={save} disabled={busy || !w}>{busy ? "Saving…" : "Save today's weight"}</Big>
        {saved && <p className="text-base text-muted-foreground">Saved.</p>}
      </div>

      {rows === null ? null : points.length >= 2 ? (
        <TrendLine points={points} unit={unit} />
      ) : (
        <div className="rounded-2xl border border-border bg-card px-5 py-5">
          <p className="text-base text-muted-foreground leading-relaxed">
            {points.length === 1
              ? "That's your first one. The line starts with your second."
              : "Once you've weighed in a couple of times, a line shows up here."}
          </p>
        </div>
      )}
    </div>
  );
}
