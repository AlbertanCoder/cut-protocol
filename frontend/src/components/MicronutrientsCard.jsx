import { useState, useEffect, useCallback, useMemo } from "react";
import { Sprout, CalendarDays } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, EmptyNote, ErrorNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import { api, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";

// ── Micronutrients — Today ──────────────────────────────────────────────
// Calm, factual, neutral treatment (constitutional — see CLAUDE.md's ETHIC):
// no red, no amber, no good/bad grading of a food or a day. A gap in iron
// reads the same visual weight as a surplus of vitamin C — both are just
// numbers. Where the underlying data is incomplete, this SAYS SO in plain
// language rather than presenting a partial sum as if it were the whole
// truth (see backend/src/lib/microAggregation.js for the null-vs-zero and
// coverage math this view surfaces).
//
// Data source is today's SOLVED PLAN (real per-food grams), not the food
// diary — see routes/micronutrients.js for why the diary can't honestly
// support this yet. That means this reads "planned today," same framing
// TodayTab already uses for the macro ring above.

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

// Neutral progress bar — deliberately colorless (a single ink tone at
// reduced opacity) so nothing here reads as "good" or "bad." Caps its fill
// at 100% visually even when the factual number (in the text beside it)
// goes higher, same "lap, don't alarm" spirit as the calorie ring, minus
// any color signal at all.
function NeutralBar({ pct }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: C.card2 }}>
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: C.faintLight }} />
    </div>
  );
}

function NutrientRow({ n }) {
  const known = n.amount != null;
  const barPct = known && n.target?.amount ? Math.min(100, n.targetPct || 0) : known ? 100 : 0;
  const note = coverageNote(n);
  return (
    <div className="py-2" style={{ borderBottom: `1px solid ${C.rule}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold" style={{ color: C.ink }}>{n.name}</span>
        <span className="text-xs font-semibold text-right shrink-0" style={{ color: C.faint }}>
          {known ? (
            <><b className="mono" style={{ color: C.ink }}>{fmtAmount(n.amount, n.unit)}</b>{n.unit} · {targetText(n)}</>
          ) : (
            "no data logged today"
          )}
        </span>
      </div>
      <NeutralBar pct={barPct} />
      {note && <div className="text-[10.5px] font-medium mt-1" style={{ color: C.faintLight }}>{note}</div>}
    </div>
  );
}

function Section({ label, rows, defaultOpen }) {
  if (rows.length === 0) return null;
  const knownCount = rows.filter((r) => r.amount != null).length;
  return (
    <details className="mb-1" open={defaultOpen}>
      <summary className="text-xs font-extrabold uppercase tracking-wide py-2 cursor-pointer select-none flex items-center justify-between"
        style={{ color: C.faintLight, letterSpacing: ".04em" }}>
        <span>{label}</span>
        <span className="font-semibold normal-case tracking-normal" style={{ color: C.faintLight }}>
          {knownCount}/{rows.length} with data
        </span>
      </summary>
      <div>{rows.map((n) => <NutrientRow key={n.key} n={n} />)}</div>
    </details>
  );
}

export default function MicronutrientsCard({ date }) {
  const [data, setData] = useState(undefined); // undefined=loading | object | "error"
  const [errorText, setErrorText] = useState(null);
  const abort = useAbortSignal();

  const load = useCallback(async () => {
    setData(undefined);
    setErrorText(null);
    try {
      const res = await api.getMicronutrientsToday(date, { signal: abort.signal });
      setData(res);
    } catch (e) {
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

  return (
    <Card section="MICRONUTRIENTS" title="Micronutrients — today's plan" className="xl:col-span-12">
      {data === undefined ? (
        <SkeletonRows rows={4} />
      ) : data === "error" ? (
        // Explicitly a LOAD FAILURE, never the "no plan yet" empty state below
        // — a blank micronutrient card would read as "you ate nothing".
        <>
          <ErrorNote msg={`Couldn't load today's micronutrient breakdown — ${errorText}`}
            hint="This is a load failure, not an empty day. Retry below; if it keeps failing, restart the app." />
          <button type="button" onClick={load}
            className="text-xs font-bold mt-3 px-3 py-1.5 rounded-xl"
            style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
            Retry
          </button>
        </>
      ) : !data.hasPlan ? (
        <EmptyNote icon={CalendarDays} title="No plan generated for this day yet"
          hint="Micronutrients are rolled up from today's planned meals (real per-ingredient grams) — head to the Plan tab to generate one." />
      ) : (
        <>
          <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
            From {data.portionCount} logged ingredient{data.portionCount === 1 ? "" : "s"} ({Math.round(data.totalGrams)}g) across today's
            plan. {data.wholeFoodsWithoutMicros > 0
              ? `${data.wholeFoodsWithoutMicros} of ${data.wholeFoodsWithMicros + data.wholeFoodsWithoutMicros} distinct foods have no micronutrient data at all yet — every total below is the honest sum of what IS known, never padded to look complete.`
              : "Every food used today carries micronutrient data."}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">
            {grouped.map((g) => <Section key={g.group} label={g.label} rows={g.rows} defaultOpen={g.defaultOpen} />)}
          </div>
          <div className="flex items-center gap-2 mt-3 text-[10.5px] font-semibold" style={{ color: C.faintLight }}>
            <Sprout size={12} />
            {data.coverage.fullyKnown} of {data.coverage.totalNutrients} nutrients fully known today, {data.coverage.partial} partial,{" "}
            {data.coverage.noData} with no data yet — reference amounts are general adult figures, not personalized to you.
          </div>
        </>
      )}
    </Card>
  );
}
