import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check } from "lucide-react";
import { api, describeError, isAbortError, isPremiumRequired } from "../lib/api.js";
import { todayStr } from "../lib/dates.js";
import { Big, Quiet, Note, Row, RowAction, Empty, Busy } from "./parts.jsx";
import SwapSheet from "./SwapSheet.jsx";

// "Here's what to eat today." The home screen of the simple surface.
//
// It is a day of food. Not a dashboard: no ring, no macro rails, no verdict
// band, no seven-day average, no percentages. Those all still exist, unchanged,
// on the full surface behind "Show me the details".
//
// EVERY NUMBER AND EVERY ACTION COMES FROM THE EXISTING API. Nothing here
// computes a calorie, a portion, or a target — it reads what the solver already
// decided and renders it larger and with fewer words. The three calls are the
// same three the full Plan and Today tabs make:
//   api.getCurrentPlan()                     — the week the solver built
//   api.getSlotAlternates / applySlotAlternate — the same swap PlanTab.jsx:723-737 uses
//   api.logPlannedDiary(date)                — the same write TodayTab.jsx:433 makes
//
// dayOfWeek in the plan model is 0=Monday..6=Sunday; JS getDay() is 0=Sunday.
// Same conversion as TodayTab.jsx:35-38 — kept identical on purpose.
function isoWeekday() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

// The plan stores "meal" | "snack" plus the named meals. Say the word.
// The solver only ever emits "meal" and "snack" (weeklyPlanner.js:150,153), so
// a bare "Meal" label made every row read identically — "meal" falls through
// to the ordinal instead: Meal 1 / Meal 2 / Meal 3 / Snack. All five keys stay.
const WORD = { meal: "Meal", snack: "Snack", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const slotWord = (s, i) =>
  s === "meal" ? `Meal ${i + 1}` : (s && WORD[s]) || (s ? s[0].toUpperCase() + s.slice(1) : `Meal ${i + 1}`);

// A planned meal. Row/RowAction come from the shared vocabulary — this screen
// deliberately does not carry its own card markup, so that Plan, Recipes and
// Shopping all render a list item the same way.
function Meal({ slot, index, onSwap, swapping }) {
  // An unfilled slot is the solver's failure, not the person's — the row says
  // what happened plainly, and the button offers "Pick one" rather than asking
  // them to "swap" a nothing.
  const name = slot.recipe?.name;
  return (
    <Row
      label={slotWord(slot.slotType, index)}
      lead={name || "Nothing picked for this one yet"}
      meta={`${kc(slot.kcal)} calories`}
      action={
        <RowAction
          onClick={() => onSwap(slot)}
          disabled={swapping}
          label={name ? `Swap ${name} for something else` : "Pick a meal for this one"}
        >
          <RefreshCw size={16} aria-hidden="true" className={swapping ? "motion-safe:animate-spin" : ""} />
          {name ? "Swap" : "Pick one"}
        </RowAction>
      }
    />
  );
}

// The swap sheet moved to ./SwapSheet.jsx the moment Plan needed it too —
// one implementation, two callers.

export default function SimpleToday({ profile }) {
  const date = todayStr();

  const [plan, setPlan] = useState("loading");   // "loading" | null (no plan) | "error" | "locked" (free tier) | plan
  const [planError, setPlanError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const [diary, setDiary] = useState(null);
  const [logging, setLogging] = useState(false);

  // A day SAVED in the day builder (Food › Day) is the most specific promise
  // that exists for today — stored grams, verdict and allergen scan travel
  // with it. Additive: the week plan below is untouched, and a failure to
  // load this simply shows nothing (the week is still correct and useful).
  const [savedDay, setSavedDay] = useState(null);

  const [swapSlot, setSwapSlot] = useState(null);
  const [alts, setAlts] = useState(null);
  const [altBusy, setAltBusy] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [swapError, setSwapError] = useState(null);

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await api.getCurrentPlan());
      setPlanError(null);
    } catch (e) {
      if (isAbortError(e)) return;
      // A free account's 403 is a gate, not a failure — the same distinction
      // the full TodayTab draws (0230f91). It gets the calm locked state
      // below, never the "something broke" copy.
      if (isPremiumRequired(e)) { setPlanError(null); setPlan("locked"); return; }
      setPlanError(describeError(e));
      setPlan("error");
    }
  }, []);

  const loadDiary = useCallback(async () => {
    try {
      setDiary(await api.getDiary(date));
    } catch {
      // A diary that will not load is not worth a screen of its own here —
      // the day of food is still correct and still useful.
      setDiary(null);
    }
  }, [date]);

  const loadSavedDay = useCallback(async () => {
    try {
      const cur = await api.prescriptionCurrent();
      setSavedDay((cur?.days || []).find((d) => d.date === date) || null);
    } catch {
      setSavedDay(null);
    }
  }, [date]);

  useEffect(() => { loadPlan(); loadDiary(); loadSavedDay(); }, [loadPlan, loadDiary, loadSavedDay]);

  const slots = (plan && typeof plan === "object" && Array.isArray(plan.slots))
    ? plan.slots.filter((s) => s.dayOfWeek === isoWeekday())
    : [];

  const total = slots.reduce((t, s) => t + (s.kcal || 0), 0);
  const target = profile?.targetKcal;

  const entries = diary?.entries || [];
  const loggedFromPlan = entries.filter((e) => e.source === "log-planned" || e.source === "planned");
  const alreadyLogged = loggedFromPlan.length > 0;

  const generate = async () => {
    setGenerating(true);
    setPlanError(null);
    try {
      await api.generatePlan({});
      await loadPlan();
    } catch (e) {
      if (isAbortError(e)) return;
      if (isPremiumRequired(e)) { setPlan("locked"); return; }
      setPlanError(describeError(e));
    } finally {
      setGenerating(false);
    }
  };

  const openSwap = async (slot) => {
    setSwapSlot(slot);
    setAlts(null);
    setSwapError(null);
    setAltBusy(true);
    try {
      const res = await api.getSlotAlternates(plan.id, slot.id, {});
      setAlts(res.alternates || []);
    } catch (e) {
      if (isPremiumRequired(e)) {
        // Gated, not broken: close the sheet and let the calm locked state
        // say so once, rather than erroring inside the sheet.
        setSwapSlot(null);
        setPlan("locked");
      } else if (!isAbortError(e)) {
        setSwapError(describeError(e));
      }
      setAlts([]);
    } finally {
      setAltBusy(false);
    }
  };

  // Same payload shape PlanTab builds (toApplyPayload, PlanTab.jsx:56-61) —
  // the server rebuilds names and calories itself; we only nominate ids and
  // grams. Sending anything else here would be inventing numbers.
  const applyAlt = async (alt) => {
    setApplyingId(alt.recipeId);
    setSwapError(null);
    try {
      await api.applySlotAlternate(plan.id, swapSlot.id, {
        slotType: swapSlot.slotType,
        slotIndex: swapSlot.slotIndex,
        recipeId: alt.recipeId,
        proteinScale: alt.proteinScale,
        sidesScale: alt.sidesScale,
        ingredients: (alt.ingredients || []).map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
        warning: alt.warning || undefined,
      });
      setSwapSlot(null);
      setAlts(null);
      await loadPlan();
    } catch (e) {
      if (isPremiumRequired(e)) {
        setSwapSlot(null);
        setAlts(null);
        setPlan("locked");
      } else if (!isAbortError(e)) {
        setSwapError(describeError(e));
      }
    } finally {
      setApplyingId(null);
    }
  };

  const logIt = async () => {
    setLogging(true);
    try {
      await api.logPlannedDiary(date);
      await loadDiary();
    } catch (e) {
      if (!isAbortError(e)) setPlanError(describeError(e));
    } finally {
      setLogging(false);
    }
  };

  const undoLog = async () => {
    setLogging(true);
    try {
      for (const e of loggedFromPlan) await api.deleteDiaryEntry(e.id);
      await loadDiary();
    } catch (e) {
      if (!isAbortError(e)) setPlanError(describeError(e));
    } finally {
      setLogging(false);
    }
  };

  if (plan === "loading") return <Busy>Getting today&rsquo;s food…</Busy>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The headline only promises food when there is food — it used to sit
            two lines above "no food planned yet" and promise a meal anyway. */}
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {slots.length > 0
            ? "Here's what to eat today"
            : plan === "locked"
              ? "Today's food"
              : "Let's build today's food"}
        </h1>
        {slots.length > 0 && (
          <p className="text-base text-muted-foreground tabular-nums">
            {kc(total)} calories
            {Number.isFinite(target) ? ` — you're aiming at about ${kc(target)}` : ""}
          </p>
        )}
      </div>

      {planError && <Note>{planError}</Note>}

      {savedDay && (
        <section aria-label="Your saved day" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">Your saved day</h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {kc(savedDay.slots?.reduce((t, s) => t + s.dishes.reduce((x, d) => x + (d.totals?.kcal || 0), 0), 0))} calories, weighed to the gram
            </p>
          </div>
          {savedDay.banner && <Note>{savedDay.banner}</Note>}
          <div className="flex flex-col gap-3">
            {(savedDay.slots || []).flatMap((s) =>
              (s.dishes || []).map((d, di) => (
                <Row
                  key={`${s.slotType}-${s.slotIndex}-${di}`}
                  label={slotWord(s.slotType, s.slotIndex)}
                  lead={d.recipeName}
                  meta={`${kc(d.totals?.kcal)} calories — ${(d.ingredients || []).map((i) => `${i.grams} g ${i.name}`).join(", ")}`}
                />
              ))
            )}
          </div>
          <Note>
            Saved in Food › Day — grams, verdict and allergen check stored with it. Swap or
            replace it there any time.
          </Note>
        </section>
      )}

      {plan === "locked" ? (
        // The calm locked state. Never the error Note — a gate is not a
        // failure, and "broken" copy on a working app teaches people not to
        // trust the real errors. The upgrade flow lives on the full surface;
        // the "Open the full app" link renders just below on this door.
        <Empty>
          Meal planning is part of the paid version, and your account doesn't
          include it yet. Nothing is broken — you can upgrade in the full app.
        </Empty>
      ) : slots.length === 0 ? (
        <Empty
          action={
            <Big onClick={generate} disabled={generating}>
              {/* The same api.generatePlan({}) call SimplePlan makes — an
                  absent horizon builds a WEEK (plans.js: "Absent = week"), so
                  the button says so. Label only; the request body is
                  untouched. */}
              {generating ? "Building your week…" : "Build my week"}
            </Big>
          }
        >
          No food planned yet. Building the week takes a few seconds — today's meals come out of it.
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {slots.map((s, i) => (
              <Meal key={s.id} slot={s} index={i} onSwap={openSwap} swapping={swapSlot?.id === s.id && altBusy} />
            ))}
          </div>

          {alreadyLogged ? (
            // role="status" makes the confirmation a polite live region, so a
            // screen reader hears "You ate this today." when it appears
            // instead of silence after the press.
            <div
              role="status"
              className="rounded-2xl border border-border bg-card px-5 py-5 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 text-lg">
                <Check size={20} aria-hidden="true" />
                <span>You ate this today.</span>
              </div>
              <Quiet onClick={undoLog}>{logging ? "…" : "Undo"}</Quiet>
            </div>
          ) : (
            <Big onClick={logIt} disabled={logging}>
              {logging ? "Saving…" : "I ate this"}
            </Big>
          )}
        </>
      )}

      {swapSlot && (
        <SwapSheet
          alts={alts}
          busy={altBusy}
          applyingId={applyingId}
          error={swapError}
          onApply={applyAlt}
          onClose={() => { setSwapSlot(null); setAlts(null); setSwapError(null); }}
        />
      )}
    </div>
  );
}
