import { Scale } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, Stat, Chip, EmptyNote } from "./ui/Parts.jsx";
import { displayWeight, weightUnit } from "../lib/units.js";
import { fmtD } from "../lib/dates.js";

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-CA") : "—");
const signed = (n) => (Number.isFinite(n) ? (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("en-CA") : "—");
const r1 = (n) => (n == null ? "—" : Math.round(n * 10) / 10);

// One shown-math row: plain-English label left, tabular number right.
const Row = ({ label, value, strong, tone }) => (
  <div className="flex justify-between items-baseline gap-4 py-1.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
    <span className="text-sm font-semibold" style={{ color: tone || C.ink }}>{label}</span>
    <span className={`mono text-sm shrink-0 ${strong ? "font-extrabold" : "font-bold"}`} style={{ color: tone || C.ink }}>{value}</span>
  </div>
);

// Sentence case, and honest: the number is a BLEND of your data and the
// formula, shrunk by how precise your data actually is. "MEASURED FROM YOUR
// DATA" in caps claimed more than the arithmetic does.
const STATUS_LABEL = {
  confident: "Measured from your data",
  provisional: "Early read — still leaning on the formula",
  insufficient: "Not enough data yet",
  off: "Switched off",
};

/**
 * The adaptive expenditure reconciliation, in the Engine's shown-math voice.
 * Shows PREDICTED vs ACTUAL vs the ADJUSTMENT that came out of the gap, every
 * uncertainty term that fed it, the ±125 kcal/week step cap that decides how
 * much of it lands this week, and the full weekly adjustment log.
 *
 * Colour discipline: this is body data, so nothing here goes red (law b) and
 * nothing borrows the accent (law a) — an expenditure estimate is not a
 * success state. Caution copy is calm amber; everything else is the ink tiers.
 * Small print sits on --faint (60%, passes AA), never --faint-light (38%,
 * 3.26:1 — fails).
 */
export default function AdaptiveTdeeCard({ profile, summary, target }) {
  const a = summary.adaptive;
  if (!a) return null;
  const pref = profile.unitPref;
  const wUnit = weightUnit(pref);
  const wSigned = (kg) => {
    if (kg == null) return "—";
    const v = displayWeight(kg, pref);
    return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(r1(v))} ${wUnit}`;
  };

  const win = a.window;
  const rec = a.reconciliation;
  const est = a.estimate;
  const ledger = a.ledger || [];
  // The step cap: what the data asked for vs what is actually in force. The
  // server has always shipped this; nothing rendered it, so the target column
  // below could show a number the rows above it did not add up to.
  const cap = summary.stepCap || a.stepCap || null;
  const capped = Boolean(cap?.capped);

  return (
    <Card section="Step 2 detail" title="Adaptive burn — what your intake and your scale say" className="xl:col-span-12">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Chip>{STATUS_LABEL[a.status] || a.status}</Chip>
        <span className="text-xs font-semibold" style={{ color: C.faint }}>
          {a.inEffect
            ? "Your target is being set from this measurement, not from the formula alone."
            : "Your target is coming straight from the formula until this has enough to say."}
        </span>
      </div>

      {!a.inEffect ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
              What it still needs
            </div>
            {(a.reasons || []).length ? (
              <ul className="flex flex-col gap-1.5">
                {a.reasons.map((rsn, i) => (
                  <li key={i} className="text-sm font-semibold flex gap-2" style={{ color: C.ink }}>
                    <span style={{ color: C.warn }}>·</span>{rsn}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote icon={Scale} title="Waiting on data" hint="Weigh in most days and log what you eat — the reconciliation starts once both series overlap." />
            )}
            <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
              This is deliberate. Over a short window a 300 kcal difference in burn looks identical to a
              glass of water, so the engine says nothing rather than moving your target on noise.
            </div>
          </div>
          {win && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
                What it has so far
              </div>
              {/* This row used to be labelled "Days of overlapping data" while
                  counting the span from the FIRST entry of EITHER series — so a
                  user with food logs and no weigh-ins read "Days of overlapping
                  weight + intake data: 2" directly above "Weigh-ins in that
                  window: 0", which cannot both be true. It counts calendar days
                  of data; that is now what it says. */}
              <Row label="Days of data so far (weigh-ins or food log)" value={win.spanDays} />
              <Row label="Weigh-ins in that window" value={win.weighinCount} />
              <Row label="Days of food logged" value={`${win.completeIntakeDays ?? win.intakeDays} of ${win.spanDays}`} />
              <Row label="Days since your last weigh-in" value={win.staleDays == null ? "—" : win.staleDays} />
              {win.weighinCount === 0 && (
                <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
                  No weigh-ins yet. This measurement compares what you ate against what the scale did, so it
                  cannot start on the food log alone.
                </div>
              )}
              {a.method && (
                <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
                  Needs {a.method.gates.minSpanDays} days, {a.method.gates.minWeighins} weigh-ins,
                  {" "}{a.method.gates.minIntakeDays} logged days, {a.method.gates.minCoveragePct}% coverage,
                  and a weigh-in inside {a.method.gates.maxStaleDays} days.
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-x-6 gap-y-4 items-start">
          {/* ── predicted vs actual ── */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
              Predicted vs actual · {win.startDate ? fmtD(win.startDate) : "—"} → {fmtD(win.endDate)}
            </div>
            <Row label="Average day you logged" value={`${kc(rec.meanIntakeKcal)} kcal`} />
            <Row label="Burn the formula assumed" value={`${kc(rec.formulaTdeeKcal)} kcal`} />
            <Row label={`So the formula expected, over ${win.spanDays} days`} value={wSigned(rec.predictedDeltaKg)} />
            <Row label="What the scale trend actually did" value={wSigned(rec.observedDeltaKg)} strong />
            <Row
              label="Difference"
              value={`${wSigned(rec.gapKg)} · ${signed(rec.gapKcalPerDay)} kcal/day`}
              strong
              tone={C.warn}
            />
            <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
              The scale moved {rec.gapKcalPerDay > 0 ? "further than" : "less than"} the formula predicted.
              That gap, spread over the window, is worth {signed(rec.gapKcalPerDay)} kcal a day — which means
              you actually burn about that much {rec.gapKcalPerDay > 0 ? "more" : "less"} than the formula thought.
            </div>
          </div>

          {/* ── the arithmetic ── */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
              The arithmetic
            </div>
            <Row label="Average logged intake" value={kc(rec.meanIntakeKcal)} />
            <Row
              label={`− weight trend (${r1(a.weight.slopeLbPerWeek)} lb/wk) × ${kc(a.method.rhoKcalPerKg)} kcal/kg`}
              value={signed(-(a.weight.slopeKgPerDay * a.method.rhoKcalPerKg))}
            />
            <Row label="= burn your data implies" value={kc(est.dataKcal)} strong />
            <Row label={`blended with the formula (${est.dataWeightPct}% weight on your data)`} value={kc(est.expenditureKcal)} strong />
            <div className="mt-2">
              {/* "Your burn, as measured" overstated it — this is a blend,
                  shrunk toward the formula by dataWeightPct and clamped to
                  ±30%. "Best estimate" is what it is. */}
              <Stat label="Your burn — best estimate" value={kc(est.expenditureKcal)} unit="kcal" big />
            </div>
            <div className="text-xs font-semibold" style={{ color: C.faint }}>
              {signed(est.deltaVsFormulaKcal)} kcal/day vs the formula&apos;s {kc(rec.formulaTdeeKcal)}.
              Give or take {kc(est.seKcal)} ({kc(est.ci68[0])}–{kc(est.ci68[1])}).
            </div>
            {est.clamped && (
              <div className="text-xs font-bold mt-1" style={{ color: C.warn }}>
                Pinned to ±{a.method.maxDeviationPct}% of the formula. A gap that big is usually a logging
                or scale problem, not a metabolism that far off — check both before trusting it.
              </div>
            )}
          </div>

          {/* ── what feeds the target, + honesty ── */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
              What it does to your target
            </div>
            <Row label="Measured burn" value={kc(a.effectiveTdee)} />
            <Row label={`− deficit for ${target.rate} lb/wk`} value={`−${kc(target.deficit)}`} />
            <Row label="= what the deficit math comes to" value={kc(target.raw)} />
            <Row label="floor (never below)" value={kc(target.floor)} />
            {/* Without these three rows the column read "burn − deficit · floor
                → daily target" and the daily target was none of those numbers:
                the step cap had walked it from last week's value. */}
            {capped && (
              <>
                <Row label="= what your data asks for" value={kc(cap.indicatedKcal)} strong />
                <Row label="last week's target" value={kc(cap.previousKcal)} />
                <Row label={`most it may move in a week (±${kc(cap.capKcal)})`} value={signed(cap.appliedChangeKcal)} tone={C.warn} />
              </>
            )}
            <Row label="Daily target" value={kc(target.target)} strong />
            <Row
              label="Same target from the formula alone"
              value={kc(a.formulaTarget?.target)}
              tone={C.faint}
            />
            {capped && (
              <div className="text-xs font-bold mt-1" style={{ color: C.warn }}>
                {cap.reason ? cap.reason[0].toUpperCase() + cap.reason.slice(1) : `Held to ±${kc(cap.capKcal)} kcal a week.`}
              </div>
            )}
            {target.floored && (
              <div className="text-xs font-bold mt-1" style={{ color: C.warn }}>
                Clamped to your floor — the measured burn wanted {kc(target.raw)}.
              </div>
            )}
            {(a.notes || []).map((n, i) => (
              <div key={i} className="text-xs font-semibold mt-1.5" style={{ color: C.faint }}>{n}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── the uncertainty budget ── */}
      {a.inEffect && (
        <details className="mt-4">
          <summary className="text-xs font-semibold uppercase tracking-wide cursor-default" style={{ color: C.faint }}>
            Where the ±{kc(est.dataSeKcal)} kcal of uncertainty comes from
          </summary>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-4 mt-2">
            <Stat label="Scale noise" value={`±${kc(est.seBudget.weightTrendKcal)}`} unit="kcal" />
            <Stat label="Day-to-day eating" value={`±${kc(est.seBudget.intakeMeanKcal)}`} unit="kcal" />
            <Stat label="Days you didn't log" value={`±${kc(est.seBudget.unloggedDaysKcal)}`} unit="kcal" />
            <Stat label="Fat vs muscle lost" value={`±${kc(est.seBudget.tissueCompositionKcal)}`} unit="kcal" />
            <Stat label="Model itself" value={`±${kc(est.seBudget.modelErrorKcal)}`} unit="kcal" />
          </div>
          <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
            Added in quadrature. Water weight carries day to day, so the trend&apos;s error bar is widened by
            the measured stickiness of your weigh-ins (lag-1 {a.weight.lag1Autocorr ?? "—"}, ×{a.weight.varianceInflation ?? "—"} on the variance).
            Tested against simulated users, this band still comes out a little narrow — treat it as roughly
            right, not exact.
          </div>
        </details>
      )}

      {/* ── the adjustment log ── */}
      {ledger.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
            Every adjustment, week by week
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 640 }}>
              <thead>
                {/* --faint-light on header text is 3.26:1 — fails WCAG AA.
                    --faint (60%) is the quietest tier that passes. */}
                <tr style={{ color: C.faint }}>
                  <th className="text-left font-bold py-1.5 pr-3">Week of</th>
                  <th className="text-left font-bold py-1.5 pr-3">What the engine did</th>
                  <th className="text-right font-bold py-1.5 pr-3">Burn used</th>
                  <th className="text-right font-bold py-1.5 pr-3">Daily target</th>
                  <th className="text-right font-bold py-1.5">Change</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.date} style={{ borderTop: `1px solid ${C.rule}` }}>
                    <td className="py-1.5 pr-3 font-semibold mono align-top" style={{ color: C.ink }}>{fmtD(row.date)}</td>
                    <td className="py-1.5 pr-3 font-semibold align-top" style={{ color: row.source === "adaptive" ? C.ink : C.faint }}>
                      {row.source === "adaptive"
                        ? `Used your measured burn (${signed(row.deltaVsFormulaKcal)} vs formula)`
                        : `Used the formula — ${row.reason || "not enough data"}`}
                      {/* capped / capReason / remainingKcal shipped in every
                          ledger row from day one and were rendered nowhere, so
                          a week whose target moved less than the data asked for
                          looked like an engine ignoring itself. */}
                      {row.capped && (
                        <div className="font-semibold mt-0.5" style={{ color: C.warn }}>
                          Your data asked for {signed(row.indicatedChangeKcal)} — held to {signed(row.changeKcal)} by the weekly move limit
                          {Number.isFinite(row.remainingKcal) && row.remainingKcal !== 0
                            ? `, ${kc(Math.abs(row.remainingKcal))} kcal still to come.`
                            : "."}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right mono font-bold align-top" style={{ color: C.ink }}>
                      {kc(row.expenditureKcal ?? row.formulaTdeeKcal)}
                    </td>
                    <td className="py-1.5 pr-3 text-right mono font-extrabold align-top" style={{ color: C.ink }}>{kc(row.targetKcal)}</td>
                    <td className="py-1.5 text-right mono font-bold align-top" style={{ color: row.changeKcal ? C.warn : C.faint }}>
                      {row.changeKcal == null ? "—" : row.changeKcal === 0 ? "no change" : signed(row.changeKcal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
            Your target never moves more than {kc(cap?.capKcal ?? 125)} kcal in one weekly update. A bigger
            change arrives over consecutive weeks, and whatever is still outstanding is shown above — one odd
            week cannot swing what you eat.
          </div>
        </div>
      )}

      {/* ── reversibility ── */}
      {a.reversible && (
        <div className="text-xs font-semibold mt-3 pt-3" style={{ color: C.faint, borderTop: `1px solid ${C.rule}` }}>
          <b style={{ color: C.ink }}>Undoing this.</b> {a.reversible.how} Nothing above is stored — it is
          recalculated from your entries every time you open this screen, so the log can never drift from
          what actually happened.
          {a.reversible.perUserSwitchPersisted === false && (
            <> There is no per-account off switch yet. Adaptive targeting can only be turned off for the whole
              installation, which sends every target straight back to the formula — ask for it and it can be
              switched.</>
          )}
        </div>
      )}
    </Card>
  );
}
