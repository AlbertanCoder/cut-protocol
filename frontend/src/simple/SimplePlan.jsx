import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { Page, Row, RowAction, Panel, Big, Quiet, Empty, Busy, Note, Details, Sheet } from "./parts.jsx";
import SwapSheet from "./SwapSheet.jsx";

// Food › Plan — the week.
//
// The full PlanTab carries 37 capabilities. This screen carries the ones a
// person uses weekly: see the week, see a day, swap a meal, build it again,
// and be told honestly when a day did not fit. NOTHING IS DELETED — the
// horizon picker, cuisine and budget filters, protein-priority mode, locks,
// the solver narration, the verdict and its three-layer persistence, and the
// multi-week summary all still live in PlanTab, unmodified, one link away.
//
// Every number here comes from the solver. This screen computes nothing except
// a per-day sum for display, which is addition over values the server already
// decided.
//
// dayOfWeek is 0=Monday..6=Sunday in the plan model; JS getDay() is 0=Sunday.
// Same conversion as TodayTab.jsx:35-38 and SimpleToday — kept identical.
function isoWeekday() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

// The solver only ever emits "meal" and "snack" (weeklyPlanner.js:150,153), so
// a bare "Meal" would label three rows identically. "meal" falls through to the
// ordinal; the other four keys stay and still win if they ever arrive.
const WORD = { meal: "Meal", snack: "Snack", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const slotWord = (s, i) =>
  s === "meal" ? `Meal ${i + 1}` : (s && WORD[s]) || (s ? s[0].toUpperCase() + s.slice(1) : `Meal ${i + 1}`);

// The seven days. Scrolls sideways on a phone, sits in one row on a desktop —
// the responsive rule, no second component.
function Week({ days, selected, onSelect }) {
  return (
    <div className="grid grid-cols-7 gap-1.5" role="tablist" aria-label="Days of the week">
      {days.map((d) => {
        const on = d.index === selected;
        return (
          <button
            key={d.index}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={
              d.flagged > 0
                ? `${LONG[d.index]}, ${kc(d.kcal)} calories — ${d.flagged} meal${d.flagged === 1 ? "" : "s"} didn't fit your target`
                : undefined
            }
            onClick={() => onSelect(d.index)}
            className={`rounded-xl border px-1 py-2.5 min-h-16 flex flex-col items-center justify-center gap-0.5
                        transition-colors ${
              on ? "bg-secondary border-foreground" : "bg-card border-border hover:border-foreground"
            }`}
          >
            <span className="text-xs text-muted-foreground">{DAYS[d.index]}</span>
            <span className="text-sm font-semibold tabular-nums">{d.slots.length ? kc(d.kcal) : "—"}</span>
            {d.flagged > 0 && (
              <span className="text-xs text-warn">{d.flagged} didn&rsquo;t fit</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function SimplePlan({ profile, onShowFull }) {
  const [plan, setPlan] = useState("loading");     // "loading" | null (no plan) | "error" | plan
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [day, setDay] = useState(isoWeekday());

  const [swapSlot, setSwapSlot] = useState(null);
  const [alts, setAlts] = useState(null);
  const [altBusy, setAltBusy] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [swapError, setSwapError] = useState(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlan(await api.getCurrentPlan());
      setError(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
      setPlan("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const slots = (plan && typeof plan === "object" && Array.isArray(plan.slots)) ? plan.slots : [];

  // Per-day rollup. `warning` is the solver's own plain-English reason string
  // (PlanSlot.warning) — the one honesty signal it writes when a slot could not
  // be solved to target. We surface it, never summarise it away.
  const days = DAYS.map((_, index) => {
    const mine = slots.filter((s) => s.dayOfWeek === index);
    return {
      index,
      slots: mine,
      kcal: mine.reduce((t, s) => t + (s.kcal || 0), 0),
      flagged: mine.filter((s) => typeof s.warning === "string" && s.warning.trim()).length,
    };
  });

  const today = days[day] || { slots: [], kcal: 0, flagged: 0 };
  const target = profile?.targetKcal;
  const flaggedSlots = today.slots.filter((s) => typeof s.warning === "string" && s.warning.trim());

  // Two counts for the subtitle, both read straight off the rollup above: a day
  // is "ready" when it has meals and none of them carry a solver warning, and
  // "not planned yet" when it has no meals at all. A blank day is never
  // silently counted as a miss.
  const readyDays = days.filter((d) => d.slots.length && d.flagged === 0).length;
  const unplannedDays = days.filter((d) => !d.slots.length).length;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.generatePlan({});
      await load();
    } catch (e) {
      if (!isAbortError(e)) setError(describeError(e));
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

  // Same payload shape PlanTab builds (toApplyPayload, PlanTab.jsx:56-61). The
  // server rebuilds names and calories itself; we only nominate ids and grams.
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
        ingredients: (alt.ingredients || []).map((i) => ({ foodId: i.foodId, grams: i.grams })),
        warning: alt.warning || undefined,
      });
      setSwapSlot(null);
      setAlts(null);
      await load();
    } catch (e) {
      if (!isAbortError(e)) setSwapError(describeError(e));
    } finally {
      setApplyingId(null);
    }
  };

  if (plan === "loading") return <Busy>Getting your week…</Busy>;

  return (
    <Page
      title="Your week"
      sub={slots.length
        ? `${readyDays} day${readyDays === 1 ? "" : "s"} ready${
            unplannedDays > 0
              ? ` · ${unplannedDays} day${unplannedDays === 1 ? "" : "s"} not planned yet`
              : ""
          }`
        : undefined}
      actions={slots.length ? (
        <Quiet onClick={() => { if (!generating) setConfirmRebuild(true); }}>
          {generating ? "Building…" : "Build it again"}
        </Quiet>
      ) : undefined}
    >
      {error && <Note>{error}</Note>}

      {slots.length === 0 ? (
        <Empty
          action={
            <Big onClick={generate} disabled={generating}>
              {generating ? "Building your week…" : "Build my week"}
            </Big>
          }
        >
          No week planned yet. Building one takes a few seconds — it picks meals that
          add up to what you should eat each day.
        </Empty>
      ) : (
        <>
          <Week days={days} selected={day} onSelect={setDay} />

          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold tracking-tight">{LONG[day]}</h2>
            <p className="text-base text-muted-foreground tabular-nums">
              {kc(today.kcal)} calories
              {Number.isFinite(target) ? ` — you're aiming at about ${kc(target)}` : ""}
            </p>
          </div>

          {/* The solver's own words, unabridged. It is the only thing that
              knows why a slot did not fit, and paraphrasing it would be
              inventing a reason. The meal's name in front is ours; everything
              after the colon is the solver's, verbatim. */}
          {flaggedSlots.length > 0 && (
            <Panel tone="warn">
              <div className="flex flex-col gap-2 text-base leading-relaxed">
                {flaggedSlots.map((s) => (
                  <p key={s.id}>
                    <span className="font-semibold">
                      {slotWord(s.slotType, today.slots.indexOf(s))}
                      {s.recipe?.name ? ` — ${s.recipe.name}` : ""}:
                    </span>{" "}
                    {s.warning}
                  </p>
                ))}
                <p>Swapping it usually helps.</p>
              </div>
            </Panel>
          )}

          <div className="flex flex-col gap-3">
            {today.slots.length === 0 ? (
              <Empty>Nothing planned for {LONG[day]}.</Empty>
            ) : today.slots.map((s, i) => {
              // An unfilled slot is the solver's failure, not the person's —
              // "swap" is the wrong verb for nothing, so an empty slot says
              // "Pick one" instead.
              const name = s.recipe?.name;
              const flagged = typeof s.warning === "string" && !!s.warning.trim();
              return (
                <Row
                  key={s.id}
                  label={slotWord(s.slotType, i)}
                  lead={name || "Nothing picked for this one yet"}
                  meta={
                    flagged ? (
                      <>
                        {kc(s.kcal)} calories
                        <span className="block text-sm text-warn">Didn&rsquo;t fit your target</span>
                      </>
                    ) : (
                      `${kc(s.kcal)} calories`
                    )
                  }
                  action={
                    <RowAction
                      onClick={() => openSwap(s)}
                      disabled={swapSlot?.id === s.id && altBusy}
                      label={name ? `Swap ${name} for something else` : "Pick a meal for this one"}
                    >
                      <RefreshCw size={16} aria-hidden="true" className={swapSlot?.id === s.id && altBusy ? "motion-safe:animate-spin" : ""} />
                      {name ? "Swap" : "Pick one"}
                    </RowAction>
                  }
                />
              );
            })}
          </div>

          <div className="pt-2">
            <Details onClick={onShowFull} label="Change the kinds of food, or plan further ahead — in the full app" />
          </div>
        </>
      )}

      {/* "Build it again" names what is lost before it runs: only locked slots
          survive a regenerate, this surface has no lock control, and the swap
          sheet just promised the rest of the day stays put. */}
      {confirmRebuild && (
        <Sheet
          title="Start the whole week over?"
          sub="This replaces every meal, including the ones you swapped."
          onClose={() => setConfirmRebuild(false)}
        >
          <Big onClick={() => { setConfirmRebuild(false); generate(); }}>Build it again</Big>
        </Sheet>
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
    </Page>
  );
}
