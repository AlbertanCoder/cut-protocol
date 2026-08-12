import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check } from "lucide-react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { todayStr } from "../lib/dates.js";
import { Big, Quiet, Note, Row, RowAction, Sheet, Empty, Busy, Panel } from "./parts.jsx";

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
const WORD = { meal: "Meal", snack: "Snack", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const slotWord = (s, i) => (s && WORD[s]) || (s ? s[0].toUpperCase() + s.slice(1) : `Meal ${i + 1}`);

// A planned meal. Row/RowAction come from the shared vocabulary — this screen
// deliberately does not carry its own card markup, so that Plan, Recipes and
// Shopping all render a list item the same way.
function Meal({ slot, index, onSwap, swapping }) {
  const name = slot.recipe?.name || "No meal chosen yet";
  return (
    <Row
      label={slotWord(slot.slotType, index)}
      lead={name}
      meta={`${kc(slot.kcal)} calories`}
      action={
        <RowAction onClick={() => onSwap(slot)} disabled={swapping} label={`Swap ${name} for something else`}>
          <RefreshCw size={16} aria-hidden="true" className={swapping ? "animate-spin" : ""} />
          Swap
        </RowAction>
      }
    />
  );
}

// The swap sheet. Three or four alternatives, plain names and calories only.
function SwapSheet({ alts, busy, applyingId, onApply, onClose, error }) {
  return (
    <Sheet
      title="Something else instead"
      sub="These all fit the same day. Pick one and the rest of the day stays where it is."
      onClose={onClose}
    >
      {error && <Note>{error}</Note>}

      {busy && <Busy>Finding other options…</Busy>}

      {!busy && alts && alts.length === 0 && (
        <Panel>
          Nothing else fits this slot today. The plan you have is the closest one available.
        </Panel>
      )}

      {!busy && alts && alts.map((a) => (
        <Row
          key={a.recipeId}
          lead={a.name || a.recipeName}
          meta={applyingId === a.recipeId ? "Swapping…" : `${kc(a.kcal)} calories`}
          onClick={applyingId == null ? () => onApply(a) : undefined}
        />
      ))}
    </Sheet>
  );
}

export default function SimpleToday({ profile }) {
  const date = todayStr();

  const [plan, setPlan] = useState(null);        // null = loading
  const [planError, setPlanError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const [diary, setDiary] = useState(null);
  const [logging, setLogging] = useState(false);

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

  useEffect(() => { loadPlan(); loadDiary(); }, [loadPlan, loadDiary]);

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
      if (!isAbortError(e)) setPlanError(describeError(e));
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
      if (!isAbortError(e)) setSwapError(describeError(e));
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
      if (!isAbortError(e)) setSwapError(describeError(e));
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

  if (plan === null) return <Busy>Getting today&rsquo;s food…</Busy>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Here's what to eat today</h1>
        {slots.length > 0 && (
          <p className="text-base text-muted-foreground tabular-nums">
            {kc(total)} calories
            {Number.isFinite(target) ? ` — you're aiming at about ${kc(target)}` : ""}
          </p>
        )}
      </div>

      {planError && <Note>{planError}</Note>}

      {slots.length === 0 ? (
        <Empty
          action={
            <Big onClick={generate} disabled={generating}>
              {generating ? "Building your day…" : "Build my day"}
            </Big>
          }
        >
          No food planned for today yet. Building a day takes a few seconds.
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {slots.map((s, i) => (
              <Meal key={s.id} slot={s} index={i} onSwap={openSwap} swapping={swapSlot?.id === s.id && altBusy} />
            ))}
          </div>

          {alreadyLogged ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-5 flex items-center justify-between gap-4">
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
