import { useState, useEffect, useCallback, useMemo, useRef, useId } from "react";
import { Sprout, CalendarDays, ChevronDown, ChevronRight, RotateCw, LifeBuoy } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, EmptyNote, ErrorNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import { api, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";
import { microsExpandedPref } from "../lib/storage.js";

// ── Micronutrients ──────────────────────────────────────────────────────
// Lives on the Wellbeing tab (it used to sit on Today). Calm, factual,
// neutral treatment (constitutional — see CLAUDE.md's ETHIC): no red, no
// amber, no good/bad grading of a food or a day. A gap in iron reads the same
// visual weight as a surplus of vitamin C — both are just numbers. Where the
// underlying data is incomplete, this SAYS SO in plain language rather than
// presenting a partial sum as if it were the whole truth (see
// backend/src/lib/microAggregation.js for the null-vs-zero and coverage math
// this view surfaces).
//
// Data source is the day's SOLVED PLAN (real per-food grams), not the food
// diary — see routes/micronutrients.js for why the diary can't honestly
// support this yet. That means this reads "planned today," same framing
// TodayTab uses for the macro ring.
//
// TWO THINGS THIS SCREEN IS DELIBERATELY CAREFUL ABOUT:
//
//  1. COLLAPSE. 47 rows of numbers is a lot to hand someone every day. The
//     detail is collapsed by default and the choice persists
//     (storage.js#microsExpandedPref). The honest coverage summary NEVER
//     collapses — folding away detail is fine, folding away the admission
//     that the data is incomplete is not.
//  2. THE GATE. When the wellbeing self-check comes back positive, the caller
//     passes `gated` and this card leads with support instead of the 47
//     numbers. That is a default, never a lock: "Show the full breakdown
//     anyway" is always present, always one click, and the summary line is
//     visible either way. Nothing is ever deleted from the user.

const GROUPS = [
  { group: "vitamin", label: "Vitamins", defaultOpen: true },
  { group: "mineral", label: "Minerals", defaultOpen: true },
  { group: "fiber", label: "Fiber", defaultOpen: true },
  { group: "fattyAcid", label: "Fatty acids", defaultOpen: false },
  { group: "aminoAcid", label: "Amino acids", defaultOpen: false },
  { group: "other", label: "Other tracked", defaultOpen: false },
];

function fmtAmount(n, unit) {
  if (n == null) return null;
  const dp = unit === "g" ? 1 : n >= 10 ? 0 : 1;
  return n.toLocaleString("en-CA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function targetText(n) {
  const t = n.target;
  if (!t || t.amount == null) return t?.note || "No established daily reference — informational only.";
  if (n.amount == null) {
    return `Reference: ${fmtAmount(t.amount, t.unit)}${t.unit}${t.type === "maximum" ? " limit" : ""}`;
  }
  const pct = n.targetPct != null ? Math.round(n.targetPct) : null;
  const pctStr = pct != null ? `${pct}%` : "—";
  return t.type === "maximum" ? `${pctStr} of the daily limit` : `${pctStr} of target`;
}

function coverageNote(n) {
  if (n.amount == null || n.complete) return null;
  const pct = Math.round(n.coverageFraction * 100);
  const items = n.missingPortions;
  return `Based on ${pct}% of today's food weight — ${items} item${items === 1 ? "" : "s"} logged with no data for this nutrient.`;
}

// ── Meters ───────────────────────────────────────────────────────────────
// Three different facts need three different shapes. The old single bar said
// all three with one filled rail, and got two of them wrong:
//
//   * A nutrient with NO established reference (trans fat, EPA, cysteine…)
//     rendered a FULL bar whenever any amount was known — visually identical
//     to "you hit your target". It was measuring nothing at all.
//   * A `type: "maximum"` nutrient (sodium, saturated fat, cholesterol) filled
//     toward its CEILING using the same language that means "goal reached"
//     everywhere else in the app — so a full sodium bar read as an
//     achievement instead of "you are at the limit".
//
// Fixed by shape, not colour: the palette stays deliberately colourless here
// (no red, no amber, no green — nothing on this card grades a food).
// Every meter is aria-hidden; the sentence beside it carries the same facts
// in words, so screen readers get the meaning and never a decorative bar.

const TRACK = "h-1.5 rounded-full mt-1";

// A goal you are working TOWARD. Solid fill, capped at 100% visually while
// the text beside it keeps the true number — the "lap, don't alarm" spirit
// of the calorie ring, minus any colour signal.
function TargetMeter({ pct }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className={`${TRACK} overflow-hidden`} style={{ background: C.card2 }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: C.faintLight }} />
    </div>
  );
}

// A ceiling you are staying UNDER. Deliberately NOT the solid fill above:
// hatched, and with a hard end-stop tick drawn at the limit, so a full rail
// reads as "at the limit" rather than "target met". Same ink, different
// language.
function LimitMeter({ pct }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className={`${TRACK} relative overflow-hidden`} style={{ background: C.card2 }} aria-hidden="true">
      <div
        className="h-full"
        style={{
          width: `${width}%`,
          backgroundImage: `repeating-linear-gradient(115deg, ${C.faintLight} 0 2px, transparent 2px 5px)`,
        }}
      />
      {/* the ceiling itself, always drawn, always at the far end */}
      <div className="absolute top-0 right-0 h-full" style={{ width: 2, background: C.faint }} />
    </div>
  );
}

// No reference value exists for this nutrient, so there is no scale to be a
// fraction of. An empty dashed rail — visibly not a progress bar. The old
// code drew this as 100% full.
function NoReferenceMeter() {
  return (
    <div
      className={TRACK}
      style={{ background: "transparent", border: `1px dashed ${C.rule}` }}
      aria-hidden="true"
    />
  );
}

function NutrientRow({ n }) {
  const known = n.amount != null;
  const ref = n.target && n.target.amount != null ? n.target : null;
  const isLimit = ref?.type === "maximum";
  const note = coverageNote(n);
  return (
    <div className="py-2" style={{ borderBottom: `1px solid ${C.rule}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold flex items-baseline gap-1.5" style={{ color: C.ink }}>
          {n.name}
          {/* Plain-English tag, not a jargon code: this nutrient is one to
              stay under, and that must be legible without decoding a bar. */}
          {isLimit && (
            <span className="text-[9px] font-extrabold uppercase px-1 py-px rounded shrink-0"
              style={{ color: C.faint, border: `1px solid ${C.rule}`, letterSpacing: ".04em" }}>
              stay under
            </span>
          )}
        </span>
        <span className="text-xs font-semibold text-right shrink-0" style={{ color: C.faint }}>
          {known ? (
            <>
              <b className="mono" style={{ color: C.ink }}>{fmtAmount(n.amount, n.unit)}</b>{n.unit}
              {/* Only a real percentage rides inline. A "no established
                  reference" explanation is a sentence, not a stat — inline it
                  squeezed long nutrient names down to one word per line. */}
              {ref && <> · {targetText(n)}</>}
            </>
          ) : (
            "no data logged today"
          )}
        </span>
      </div>
      {!ref ? <NoReferenceMeter />
        : isLimit ? <LimitMeter pct={known ? n.targetPct : 0} />
          : <TargetMeter pct={known ? n.targetPct : 0} />}
      {!ref && <div className="text-[10.5px] font-medium mt-1" style={{ color: C.faint }}>{targetText(n)}</div>}
      {/* a11y contrast: this is the honesty note about partial coverage —
          real readable content, so --faint (60%), not --faint-light (38%,
          ~3.3:1, fails AA). */}
      {note && <div className="text-[10.5px] font-medium mt-1" style={{ color: C.faint }}>{note}</div>}
    </div>
  );
}

function Section({ label, rows, defaultOpen }) {
  if (rows.length === 0) return null;
  const knownCount = rows.filter((r) => r.amount != null).length;
  return (
    <details className="mb-1" open={defaultOpen}>
      <summary className="text-xs font-extrabold uppercase tracking-wide py-2 cursor-pointer select-none flex items-center justify-between"
        style={{ color: C.faint, letterSpacing: ".04em" }}>
        <span>{label}</span>
        <span className="font-semibold normal-case tracking-normal" style={{ color: C.faint }}>
          {knownCount}/{rows.length} with data
        </span>
      </summary>
      <div>{rows.map((n) => <NutrientRow key={n.key} n={n} />)}</div>
    </details>
  );
}

// The one honest sentence that never collapses and is never gated away.
function CoverageLine({ coverage }) {
  return (
    <div className="flex items-start gap-2 text-[11px] font-semibold" style={{ color: C.faint }}>
      <Sprout size={13} className="shrink-0 mt-px" aria-hidden="true" />
      <span>
        {coverage.fullyKnown} of {coverage.totalNutrients} nutrients fully known today, {coverage.partial} partial,{" "}
        {coverage.noData} with no data yet — reference amounts are general adult figures, not personalized to you.
      </span>
    </div>
  );
}

/**
 * @param {string}   date          yyyy-mm-dd to report on
 * @param {boolean}  gated         lead with support instead of the 47 numbers
 * @param {Function} onShowAnyway  user overrode the gate (caller persists it)
 * @param {string}   className     grid placement, decided by the parent.
 *   Defaults to the 12-column span TodayTab has always given it, so that
 *   file keeps rendering correctly until the owner applies the one-line
 *   swap to a pointer (this card's home is now the Wellbeing tab, which
 *   passes "" and lays it out full-width itself).
 */
export default function MicronutrientsCard({ date, gated = false, onShowAnyway, className = "xl:col-span-12" }) {
  const [data, setData] = useState(undefined); // undefined=loading | object | "error"
  const [errorText, setErrorText] = useState(null);
  const [expanded, setExpanded] = useState(() => microsExpandedPref.get());
  const abort = useAbortSignal();
  const detailId = useId();

  // Stale-response guard. The fetch is keyed on `date`, and an in-flight
  // request for an OLD date (or an old manual refresh) could previously land
  // after a newer one and overwrite fresh state — the mount-scoped abort
  // signal only cancels on unmount, never on supersession. Latent while
  // `date` is today-only, but a refresh button and a future date picker both
  // make it reachable, so the sequence number closes it now: only the newest
  // request is allowed to write.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setData(undefined);
    setErrorText(null);
    try {
      const res = await api.getMicronutrientsToday(date, { signal: abort.signal });
      if (seq !== reqSeq.current) return; // superseded — a newer load owns state
      setData(res);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      if (isAbortError(e)) return; // component gone / superseded — say nothing
      setErrorText(describeError(e, "Couldn't load today's micronutrient breakdown."));
      setData("error");
    }
  }, [date, abort]);
  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    if (!data || data === "error") return null;
    const rows = Object.values(data.nutrients || {});
    return GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.group) }));
  }, [data]);

  const toggleExpanded = () => {
    const next = !expanded;
    microsExpandedPref.set(next);
    setExpanded(next);
  };

  // a11y: "Show the full breakdown anyway" UNMOUNTS itself — the gate panel is
  // replaced by the collapse toggle. Without this, a keyboard user presses
  // Enter and focus falls to <body>: their place in the page is gone and they
  // have to Tab in from the top of the document to reach what they just asked
  // for. Move focus to the control that took its place instead.
  const toggleRef = useRef(null);
  const focusToggleNext = useRef(false);
  useEffect(() => {
    if (focusToggleNext.current && !gated && toggleRef.current) {
      toggleRef.current.focus();
      focusToggleNext.current = false;
    }
  }, [gated]);

  const showAnyway = () => {
    // Asking to see it IS asking to see it — open the detail in the same
    // click rather than making the user find a second control.
    microsExpandedPref.set(true);
    setExpanded(true);
    focusToggleNext.current = true;
    onShowAnyway?.();
  };

  // "N of M foods" — distinctFoods* are per-FOOD counts from the route.
  // wholeFoodsWith/WithoutMicros count PORTIONS (chicken in two meals is 2),
  // so the old copy calling them "distinct foods" was simply wrong. Fall back
  // to the portion counts with honest wording if an older backend answers.
  const sourceLine = (d) => {
    const ingredients = `From ${d.portionCount} logged ingredient${d.portionCount === 1 ? "" : "s"} (${Math.round(d.totalGrams)}g) across today's plan.`;
    if (d.distinctFoods != null) {
      return d.distinctFoodsWithoutMicros > 0
        ? `${ingredients} ${d.distinctFoodsWithoutMicros} of ${d.distinctFoods} different food${d.distinctFoods === 1 ? "" : "s"} used today ${d.distinctFoodsWithoutMicros === 1 ? "has" : "have"} no micronutrient data at all yet — every total below is the honest sum of what IS known, never padded to look complete.`
        : `${ingredients} Every food used today carries micronutrient data.`;
    }
    return d.wholeFoodsWithoutMicros > 0
      ? `${ingredients} ${d.wholeFoodsWithoutMicros} of those ${d.wholeFoodsWithMicros + d.wholeFoodsWithoutMicros} ingredient entries have no micronutrient data at all yet — every total below is the honest sum of what IS known, never padded to look complete.`
      : `${ingredients} Every food used today carries micronutrient data.`;
  };

  const quietBtn = {
    background: C.card2,
    border: `1px solid ${C.rule}`,
    color: C.ink,
  };

  return (
    <Card section="MICRONUTRIENTS" title="Micronutrients — today's plan" className={className}>
      {data === undefined ? (
        <SkeletonRows rows={4} />
      ) : data === "error" ? (
        // Explicitly a LOAD FAILURE, never the "no plan yet" empty state below
        // — a blank micronutrient card would read as "you ate nothing".
        <>
          <ErrorNote msg={`Couldn't load today's micronutrient breakdown — ${errorText}`}
            hint="This is a load failure, not an empty day. Retry below; if it keeps failing, restart the app." />
          <button type="button" onClick={load}
            className="text-xs font-bold mt-3 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5"
            style={quietBtn}>
            <RotateCw size={12} aria-hidden="true" /> Retry
          </button>
        </>
      ) : !data.hasPlan ? (
        <>
          <EmptyNote icon={CalendarDays} title="No plan generated for this day yet"
            hint="Micronutrients are rolled up from today's planned meals (real per-ingredient grams) — head to the Plan tab to generate one." />
          {/* This card reads a plan it does not own. It refetches whenever the
              Wellbeing tab is opened (App mounts tabs on demand), but if a plan
              is generated in another window/tab while this one sits open, this
              button is the way to pull it in without reloading the app. */}
          <div className="flex justify-center mt-1">
            <button type="button" onClick={load}
              className="text-xs font-bold px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5"
              style={quietBtn}>
              <RotateCw size={12} aria-hidden="true" /> Check again
            </button>
          </div>
        </>
      ) : (
        <>
          {/* ── ALWAYS VISIBLE: where the numbers came from, and how complete
              they are. Neither the collapse nor the gate may hide these. ── */}
          <div className="text-xs font-semibold mb-3" style={{ color: C.faint }}>
            {sourceLine(data)}
          </div>
          <CoverageLine coverage={data.coverage} />

          {gated ? (
            /* ── The gate ──────────────────────────────────────────────────
               Calm amber at most (law b: never red on food or body data), and
               framed as a default the user can overturn, not a restriction
               placed on them. */
            <div className="mt-4 rounded-xl p-4" style={{ background: C.card2, border: `1px solid ${C.warn}55` }}>
              <div className="flex items-start gap-2.5">
                <LifeBuoy size={16} className="shrink-0 mt-0.5" style={{ color: C.warn }} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-sm font-bold" style={{ color: C.ink }}>
                    Leading with support instead of 47 numbers
                  </div>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: C.faint }}>
                    Your wellbeing check flagged something, and daily fixation on individual nutrient
                    numbers is one of the things that can make a hard relationship with food harder.
                    So this tab is holding the row-by-row detail back <em>by default</em> — the coverage
                    summary above stays exactly as it was, nothing has been deleted, and the support
                    contacts at the top of this tab are free and confidential.
                  </p>
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: C.faint }}>
                    This is your data. If you want the numbers, take them.
                  </p>
                  <button type="button" onClick={showAnyway}
                    className="text-xs font-bold mt-3 px-3 py-2 rounded-xl"
                    style={quietBtn}>
                    Show the full breakdown anyway
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ── The collapse ── */}
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  ref={toggleRef}
                  onClick={toggleExpanded}
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  className="text-xs font-bold px-3 py-2 rounded-xl inline-flex items-center gap-1.5"
                  style={quietBtn}
                >
                  {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                  {expanded
                    ? `Hide the ${data.coverage.totalNutrients}-nutrient breakdown`
                    : `Show the ${data.coverage.totalNutrients}-nutrient breakdown`}
                </button>
                <button type="button" onClick={load}
                  className="text-xs font-semibold px-3 py-2 rounded-xl inline-flex items-center gap-1.5"
                  style={{ color: C.faint, border: `1px solid ${C.rule}` }}>
                  <RotateCw size={12} aria-hidden="true" /> Refresh
                </button>
              </div>

              {/* hidden, not unmounted-with-a-dangling-aria-controls: the
                  container is always present so aria-controls always resolves. */}
              <div id={detailId} hidden={!expanded}>
                {expanded && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-8 mt-3">
                    {grouped.map((g) => <Section key={g.group} label={g.label} rows={g.rows} defaultOpen={g.defaultOpen} />)}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
