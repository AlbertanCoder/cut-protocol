import { useMemo, useState } from "react";
import { displayRate, displayWeight, weightUnit } from "../lib/units.js";
import { fmtD } from "../lib/dates.js";
import { Big, Page, Panel, Stat, Tabs, Empty, Busy, Details, TrendLine } from "./parts.jsx";

// Progress — Weight · Your numbers · Engine.
//
// EVERY NUMBER ON THIS SCREEN IS THE SERVER'S. /weighins/summary already ships
// avg7Kg, rate, daysIn, the verdict, the energy block (rmr, spreadLo/Hi,
// jobMultiplier, trainingKcalPerDay, tdee) and the target block (deficit, raw,
// target, floor, floored). Nothing here recomputes any of it — re-deriving a
// TDEE or a rate on this surface would be a second implementation of a
// calculation, which rule 2 forbids outright, and two implementations
// eventually disagree.
//
// The split is the owner's call: a plain screen anyone can read, and the full
// Engine kept whole beside it rather than replacing it.

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

const ROOMS = [
  { id: "weight", label: "Weight" },
  { id: "numbers", label: "Your numbers" },
  // Display label only — "Engine" is developer vocabulary next to "Weight".
  // The id stays "engine"; nothing persisted or routed changes.
  { id: "engine", label: "The full maths" },
];

function Weight({ profile, summary, onOpenToday }) {
  const pref = profile?.unitPref || "imperial";
  const unit = weightUnit(pref);

  const points = useMemo(() => {
    const rows = (summary?.weighins || [])
      .filter((w) => w && typeof w.date === "string" && Number.isFinite(w.weightKg))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    return rows.map((w, i) => ({
      x: i,
      y: w.weightKg,
      w: displayWeight(w.weightKg, pref),
      dateLabel: fmtD(w.date),
    }));
  }, [summary, pref]);

  if (summary === "error") {
    return <Panel tone="warn">Couldn&rsquo;t load your weigh-ins just now. Try again in a moment.</Panel>;
  }
  if (!summary) return <Busy>Getting your weight…</Busy>;

  const avg = summary.avg7Kg;
  const meta = summary.avg7Meta;
  const rate = summary.rate;
  const verdict = summary.verdict;

  if (points.length === 0) {
    // The weigh-in box lives on the Today door — the button goes there.
    // Rendered only when the shell passes the navigation, never as a dead door.
    return (
      <Empty action={onOpenToday ? <Big onClick={onOpenToday}>Log your first weight</Big> : undefined}>
        Nothing to show yet — log your first weight and the line starts here.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {points.length === 1 ? (
        // At exactly one reading TrendLine returns null (it needs two points to
        // draw a line), and this screen used to show a hole with no explanation.
        <Empty>First point logged — the line starts with your second weigh-in.</Empty>
      ) : (
        <>
          <TrendLine points={points} unit={unit} />
          {/* TrendLine auto-fits its vertical scale, so a 1 lb water swing can
              draw a cliff. Said plainly, once. The chart itself is untouched. */}
          <p className="text-base text-muted-foreground leading-relaxed">
            The line is scaled to fit, so small day-to-day changes look big.
          </p>
        </>
      )}

      <Panel>
        <Stat
          label="Where you are"
          value={avg == null ? "—" : `${displayWeight(avg, pref)} ${unit}`}
        />
        <Stat
          label="Which way it's going"
          value={
            rate == null
              ? "Too early to say"
              : `${r1(Math.abs(rate * (pref === "metric" ? 0.453592 : 1)))} ${unit} a week ${rate < 0 ? "down" : "up"}`
          }
        />
        <Stat label="Days since you started" value={summary.daysIn ?? "—"} />
      </Panel>

      {/* Provenance, because the constitution says a displayed number can
          reveal its inputs. A thin or stale average must say so rather than
          look as confident as a full one. */}
      {meta && (
        <p className="text-base text-muted-foreground leading-relaxed">
          {meta.stale
            ? `That's your most recent reading — you haven't weighed in for ${meta.staleDays} days, so there's no fresh average to take.`
            : `Averaged from ${meta.count} weigh-in${meta.count === 1 ? "" : "s"} over the last ${meta.windowDays} days.`}
        </p>
      )}

      {/* The engine's own verdict sentence, rendered as written. Never red —
          this is body data, and the law holds on every surface. */}
      {verdict?.tag && (
        <Panel tone={verdict.tone === "bad" || verdict.tone === "warn" ? "warn" : undefined}>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-semibold">{verdict.tag}</span>
            {verdict.sub && <span className="text-base leading-relaxed">{verdict.sub}</span>}
            {/* The engine's sentence can name "Profile" — a door this surface
                doesn't have. One plain line under it says where the pace
                control actually lives here. The sentence above stays verbatim. */}
            <span className="text-base leading-relaxed text-muted-foreground">
              You can change your pace under You → How fast do you want to lose?
            </span>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Numbers({ profile, summary, onShowFull }) {
  if (summary === "error") {
    return <Panel tone="warn">Couldn&rsquo;t load your numbers just now. Try again in a moment.</Panel>;
  }
  if (!summary) return <Busy>Working out your numbers…</Busy>;

  const pref = profile?.unitPref || "imperial";
  const e = summary.energy || {};
  const t = summary.target || {};
  const spread =
    Number.isFinite(e.spreadHi) && Number.isFinite(e.spreadLo) ? Math.round(e.spreadHi - e.spreadLo) : null;

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <div className="text-lg leading-relaxed">
          You burn about <b>{kc(e.tdee)}</b> calories a day.<br />
          Eat <b>{kc(t.target)}</b> to lose about {displayRate(t.rate, pref)} {weightUnit(pref)} a week.
        </div>
      </Panel>

      {t.floored && (
        <Panel tone="warn">
          That pace would mean {kc(t.raw)} calories, which is under your floor of {kc(t.floor)} calories.
          You&rsquo;re held at the floor — losing faster would mean eating less than is safe. Add
          movement instead.
        </Panel>
      )}

      {!t.floored && Number.isFinite(t.floor) && (
        <p className="text-base text-muted-foreground">
          Your floor is {kc(t.floor)} calories. The app never plans below it, whatever you type.
        </p>
      )}

      <Panel>
        <div className="text-base leading-relaxed text-muted-foreground">
          That burn figure is built in three steps: what your body uses at rest
          (<b>{kc(e.rmr)}</b>), multiplied for how much you move at work
          {e.jobLabel ? ` (${e.jobLabel})` : ""}
          {Number.isFinite(e.trainingKcalPerDay) && e.trainingKcalPerDay > 0
            ? `, plus about ${kc(e.trainingKcalPerDay)} a day for training`
            : ""}
          .
        </div>
      </Panel>

      {spread != null && (
        <p className="text-base text-muted-foreground leading-relaxed">
          The resting figure is an average of several published methods. They disagree by about{" "}
          {spread} calories — that spread is how much they differ, not how wrong they are.
        </p>
      )}

      <Details onClick={onShowFull} label="Show me the full breakdown → Engine" />
    </div>
  );
}

export default function SimpleProgress({ profile, summary, onShowFull, onOpenToday }) {
  const [room, setRoom] = useState("weight");

  return (
    <Page title="Progress">
      <Tabs tabs={ROOMS} active={room} onSelect={setRoom} />

      {room === "weight" && <Weight profile={profile} summary={summary} onOpenToday={onOpenToday} />}
      {room === "numbers" && <Numbers profile={profile} summary={summary} onShowFull={onShowFull} />}

      {/* ENGINE IS NOT REBUILT HERE, and this says so rather than pretending.
          EngineTab carries 15 capabilities that are mostly a proof: five
          formulas with per-formula include/exclude, journal citations, the
          adaptive-burn ledger, the macro engine with its midpoint gaps, and
          the only data-export path in the app. Restyling it is its own pass,
          and a half-drawn version of a screen whose whole job is showing the
          working would be worse than the real one. */}
      {room === "engine" && (
        <div className="flex flex-col gap-5">
          <Empty>
            The Engine shows every step of the maths — all five resting-rate formulas with
            their sources, how your job and training are added, how the target is worked out,
            and your macro ranges. It hasn&rsquo;t been redrawn in this simpler style yet, so
            it opens in the full app.
          </Empty>
          <Details onClick={onShowFull} label="Open the full maths" />
        </div>
      )}
    </Page>
  );
}
