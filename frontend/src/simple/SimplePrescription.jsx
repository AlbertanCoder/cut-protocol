import { useCallback, useEffect, useState } from "react";
import { api, describeError, isAbortError, isPremiumRequired } from "../lib/api.js";
import { Page, Panel, Big, Quiet, Busy, Note } from "./parts.jsx";

// Food › Preview — the prescription solver's first visible surface.
//
// Previewing is READ-ONLY; "Save this day" (Option C, 2026-08-21) commits
// it — the server RE-SOLVES with the preview's own seed, so what was read
// is exactly what is stored (no client-asserted macro ever reaches the
// database). The day is verified after rounding against the prescription
// ruler (±50 kcal / ±7 g protein / ±7 g fat / ±10 g net carbs), which is
// deliberately tighter than the Plan tab's verdict — the two rulers are
// different instruments and this screen never pretends otherwise.
// Same-day previews are stable (the server seeds by calendar day); the
// re-roll button asks for a fresh seed on purpose.

const r0 = (n) => Math.round(n);

function BandLine({ label, read, band, unit = "g" }) {
  const inBand = read >= band.lo - 1e-9 && read <= band.hi + 1e-9;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">
        {r0(read)} {unit}
        <span className="opacity-60 font-normal"> of {r0(band.lo)}–{r0(band.hi)}</span>
        {!inBand && <span style={{ color: "var(--warn)" }}> · outside</span>}
      </span>
    </div>
  );
}

export default function SimplePrescription() {
  const [feas, setFeas] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedDate, setSavedDate] = useState(null);

  useEffect(() => {
    let alive = true;
    api.prescriptionFeasibility()
      .then((f) => { if (alive) setFeas(f); })
      .catch((e) => {
        if (!alive || isAbortError(e)) return;
        if (isPremiumRequired(e)) setLocked(true);
        else setError(describeError(e));
      });
    return () => { alive = false; };
  }, []);

  const build = useCallback(async (seed) => {
    setBusy(true);
    setError(null);
    setSavedDate(null);
    try {
      const out = await api.prescriptionPreview(1, seed);
      setPreview(out);
    } catch (e) {
      if (isAbortError(e)) return;
      if (isPremiumRequired(e)) setLocked(true);
      else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // "Save this day": the server RE-SOLVES with the same seed the preview
  // used — deterministic, so what was read is exactly what is stored.
  const save = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const out = await api.prescriptionCommit(1, preview.seed);
      setSavedDate(out.committed?.[0] || null);
    } catch (e) {
      if (isAbortError(e)) return;
      if (isPremiumRequired(e)) setLocked(true);
      else setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }, [preview]);

  if (locked) {
    return (
      <Page title="Your day" sub="A day of food, solved to your numbers.">
        <Note>The day builder is part of the paid plan tools.</Note>
      </Page>
    );
  }

  const day = preview?.days?.[0] || null;
  const v = day?.verdict;

  return (
    <Page title="Your day" sub="A day of food, solved to your numbers and verified after rounding. Save it and it's yours for the day.">
      {error && <Panel tone="warn"><p className="text-sm">{error}</p></Panel>}

      {feas && feas.feasibility?.feasible === false && (
        <Panel tone="warn">
          <p className="text-sm leading-relaxed">{feas.feasibility.suggestion?.note}</p>
        </Panel>
      )}

      {!day && (
        <div className="flex flex-col gap-3">
          <Big onClick={() => build()} disabled={busy}>{busy ? "Solving…" : "Build my day"}</Big>
          <Note>
            Verified to ±50 kcal, ±7 g protein, ±7 g fat and ±10 g net carbs — tighter than the
            Plan tab&apos;s ruler, and checked again after every gram is rounded.
          </Note>
        </div>
      )}

      {busy && day && <Busy>Solving…</Busy>}

      {day && v && (
        <div className="flex flex-col gap-4">
          <Panel>
            <div className="flex flex-col gap-1.5">
              <BandLine label="Calories" read={v.read.kcal} band={v.bands.kcal} unit="kcal" />
              <BandLine label="Protein" read={v.read.proteinG} band={v.bands.proteinG} />
              <BandLine label="Fat" read={v.read.fatG} band={v.bands.fatG} />
              <BandLine label="Net carbs" read={v.read.netCarbG} band={v.bands.netCarbG} />
            </div>
            <p className="text-xs mt-3 opacity-70 break-words">{day.scanLine}</p>
            {!day.ok && (day.banner || day.diagnosis) && (
              <p className="text-sm mt-2" style={{ color: "var(--warn)" }}>{day.banner || day.diagnosis}</p>
            )}
          </Panel>

          {day.slots.map((s) => (
            <Panel key={`${s.slotType}-${s.slotIndex}`}>
              <p className="text-xs uppercase tracking-wide opacity-60 mb-2">
                {s.slotType === "meal" ? `Meal ${s.slotIndex + 1}` : `Snack ${s.slotIndex + 1}`}
              </p>
              {s.dishes.length === 0 && <p className="text-sm opacity-70">No eligible recipe for this slot.</p>}
              {s.dishes.map((dish) => (
                <div key={dish.recipeId} className="mb-3 last:mb-0">
                  <p className="text-sm font-semibold">
                    {dish.recipeName}
                    <span className="opacity-60 font-normal"> — {r0(dish.totals.kcal)} kcal · {r0(dish.totals.protein)} g protein</span>
                  </p>
                  <ul className="mt-1 text-sm opacity-80">
                    {dish.ingredients.map((i) => (
                      <li key={`${dish.recipeId}-${i.foodId}`} className="tabular-nums">{i.grams} g {i.name}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </Panel>
          ))}

          <div className="flex gap-2">
            <Big onClick={save} disabled={busy || saving || !!savedDate}>
              {saving ? "Saving…" : savedDate ? "Saved" : "Save this day"}
            </Big>
            <Quiet onClick={() => build(Math.floor(Math.random() * 2 ** 31))} disabled={busy || saving}>
              Solve a different day
            </Quiet>
          </div>
          {savedDate && (
            <Note>
              Saved for {savedDate}. It stays exactly as shown — grams, verdict and allergen
              scan all stored with it. Saving the same day again replaces it.
            </Note>
          )}
          <Note>
            The grams are the prescription — weigh them. A $15 kitchen scale is the difference
            between guessing and knowing.
          </Note>
        </div>
      )}
    </Page>
  );
}
