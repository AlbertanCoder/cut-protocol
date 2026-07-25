import { useRef, useEffect } from "react";
import { Heart, ShieldCheck, LifeBuoy, Trash2, Info } from "lucide-react";
import { C } from "../lib/theme.js";
import { todayStr, fmtDY } from "../lib/dates.js";
import { displayWeight, weightUnit } from "../lib/units.js";
import { Card, PageHead } from "./ui/Parts.jsx";
import ResourceList from "./ui/ResourceList.jsx";
import { WELLBEING_RESOURCES_NOTE } from "../lib/wellbeingResources.js";
import MicronutrientsCard from "./MicronutrientsCard.jsx";

// ── Wellbeing ────────────────────────────────────────────────────────────
// One tab for the three things this app owes a user who is deliberately
// eating less than they burn:
//
//   1. an optional, non-diagnostic eating-disorder self-check (SCOFF)
//   2. the micronutrient breakdown of what they're actually planning to eat
//   3. free, confidential, verified Alberta/Canada support contacts
//
// THE RISK GATE. When the self-check comes back positive, this tab hides the
// 47-nutrient detail by DEFAULT and leads with support instead. Reasoning:
// fixation on individual daily nutrient numbers is a documented driver of
// disordered eating, so someone showing signals gets FEWER numbers, not more.
//
// The escape hatch is mandatory and non-negotiable. "Show the full breakdown
// anyway" is always one click away, the honest coverage summary stays visible
// in every state, and the screening result is deletable in one click. The app
// never traps the user, never withholds their own data, and never implies it
// knows better than they do about what they can look at. It only chooses what
// to put first.
//
// Nothing here nags. No streaks, no reminders, no notifications, no counters
// (constitutional: "Instrument, not slot machine").

/**
 * Reasons — in plain English — that it might be worth checking in. Derived
 * live from the profile and the weigh-in summary; there is no stored "concern"
 * flag and nothing accumulates over time. If the numbers change, these
 * disappear on their own.
 *
 * Exported because App uses the same list to decide whether to put a single
 * quiet marker on the sidebar item (see App.jsx) — the check used to be
 * unreachable in practice: a sidebar button was the ONLY thing that could open
 * it, so an aggressive rate, a floor-clamped target, fast measured loss, and an
 * underweight goal all passed in complete silence, while the check's own copy
 * said "it may be worth easing off any aggressive deficit".
 */
export function wellbeingSignals(profile, summary) {
  const out = [];
  if (!profile || !summary) return out;

  const pctOfBw = summary.rateSafety?.pctOfBw;
  if (typeof pctOfBw === "number" && pctOfBw > 1) {
    out.push(`You've set a pace of ${profile.rateLbPerWeek} lb a week — that's ${pctOfBw}% of your body weight every week, above the ~1% that's generally considered sustainable.`);
  }

  if (summary.target?.floored) {
    out.push("Your calorie target is being held up at your safety floor — the pace you picked would need you to eat less than is safe, so the app is refusing to go there.");
  }

  // Measured loss outrunning the plan. Derived from NUMBERS (the measured
  // 7-day rate against the verdict's own band), never from the verdict's tag
  // text: that copy is display prose and gets rewritten — it went from
  // "TOO FAST" to "Faster than planned" mid-build, which would have silently
  // killed a string match here. `band.hi + 0.4` is bmrEngine's own line
  // between "a bit quick this week" and "this is actually too fast".
  const band = summary.verdict?.band;
  const measuredRate = summary.rate; // lb/wk, positive = losing
  if (typeof measuredRate === "number" && band && measuredRate > band.hi + 0.4) {
    out.push(`You're losing about ${Math.round(measuredRate * 10) / 10} lb a week — faster than the ${band.lo}–${band.hi} lb a week your plan aims for. That isn't only fat coming off.`);
  }

  // Goal weight below a healthy BMI for the entered height. Not a judgment on
  // the number itself — plenty of reasons a person picks a low goal — just a
  // fact worth having said out loud once.
  const hM = (profile.heightCm || 0) / 100;
  if (hM > 0 && profile.goalWeightKg > 0) {
    const goalBmi = profile.goalWeightKg / (hM * hM);
    if (goalBmi < 18.5) {
      out.push(`Your goal weight (${displayWeight(profile.goalWeightKg, profile.unitPref)} ${weightUnit(profile.unitPref)}) is below the standard healthy-weight range for your height.`);
    }
  }

  return out;
}

// Calm status line for the stored screening result. No score-shaming, no
// grade — "positive" here is a prompt, never a diagnosis, and the copy says so
// every single time it renders.
function screenStatus(screen) {
  if (!screen) {
    return {
      title: "You haven't taken the check",
      body: "Five questions, about a minute. It's optional, it's not a diagnosis, and the answers never leave this computer.",
      cta: "Take the wellbeing check",
      tone: null,
    };
  }
  if (screen.positive) {
    return {
      title: "Your last check flagged something worth looking at",
      body: `You answered "yes" to ${screen.score} of 5${screen.takenOn ? ` on ${fmtDY(screen.takenOn)}` : ""}. This screen over-flags on purpose — it catches many people who don't have an eating disorder — so it is not a diagnosis. It is a reason to talk to someone, and the contacts above are free.`,
      cta: "Take it again",
      tone: C.warn,
    };
  }
  return {
    title: "Your last check didn't flag anything",
    body: `Nothing raised${screen.takenOn ? ` on ${fmtDY(screen.takenOn)}` : ""} — but five questions is a prompt, not a clean bill of health. If something feels off with food or your body, trust that over this.`,
    cta: "Take it again",
    tone: null,
  };
}

export default function WellbeingTab({ profile, summary, screen, onOpenCheck, onClearScreen, onShowMicrosAnyway }) {
  const signals = wellbeingSignals(profile, summary);
  const status = screenStatus(screen);
  // The gate: positive screen, and the user hasn't already said "show me
  // anyway". Both halves are theirs to change at any time.
  const gated = !!screen?.positive && !screen?.showDetailAnyway;

  // a11y: "Delete my result" removes itself from the DOM, so activating it by
  // keyboard would drop focus to <body> and strand the user at the top of the
  // document. Hand focus to the take-the-check button that survives.
  const ctaRef = useRef(null);
  const focusCtaNext = useRef(false);
  useEffect(() => {
    if (focusCtaNext.current && !screen && ctaRef.current) {
      ctaRef.current.focus();
      focusCtaNext.current = false;
    }
  }, [screen]);
  const clearScreen = () => { focusCtaNext.current = true; onClearScreen?.(); };

  const quietBtn = { background: C.card2, border: `1px solid ${C.rule}`, color: C.ink };

  const supportCard = (
    <Card section="SUPPORT" title="Free, confidential help (Alberta / Canada)">
      <p className="text-xs mb-3" style={{ color: C.faint }}>{WELLBEING_RESOURCES_NOTE}</p>
      <ResourceList />
    </Card>
  );

  const checkCard = (
    <Card section="SELF-CHECK" title="Eating-disorder self-check">
      <div className="flex items-start gap-3">
        {/* Law a: green means on-target / primary action / success. A heart on
            a screening card is none of those — quiet ink tier. */}
        <Heart size={18} className="shrink-0 mt-0.5" style={{ color: status.tone || C.faint }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold" style={{ color: status.tone || C.ink }}>{status.title}</div>
          <p className="text-xs mt-1 leading-relaxed max-w-[70ch]" style={{ color: C.faint }}>{status.body}</p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" ref={ctaRef} onClick={onOpenCheck}
              className="text-xs font-bold px-3 py-2 rounded-xl" style={quietBtn}>
              {status.cta}
            </button>
            {screen && (
              <button type="button" onClick={clearScreen}
                className="text-xs font-semibold px-3 py-2 rounded-xl inline-flex items-center gap-1.5"
                style={{ color: C.faint, border: `1px solid ${C.rule}` }}>
                <Trash2 size={12} aria-hidden="true" /> Delete my result
              </button>
            )}
          </div>

          {/* Where the result lives, stated plainly, every time. */}
          <div className="flex items-start gap-2 mt-3 text-[11px] font-semibold" style={{ color: C.faint }}>
            <ShieldCheck size={13} className="shrink-0 mt-px" aria-hidden="true" />
            <span>
              Stored on this computer only — never uploaded, never sent to the app's server, never
              part of a backup or an export. Deleting it removes it completely.
            </span>
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <div>
      <PageHead
        title="Wellbeing"
        sub="Optional self-check, the nutrients behind today's plan, and where to get real help. Nothing here is a diagnosis."
      />

      {/* ── The gentle entry point ────────────────────────────────────────
          Only renders when something in the user's OWN numbers warrants it,
          disappears on its own when it doesn't, and asks exactly once. No
          badge, no counter, no repeat prompt, no dismissal to remember. */}
      {signals.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}55` }}>
          <div className="flex items-start gap-2.5">
            <Info size={17} className="shrink-0 mt-0.5" style={{ color: C.warn }} aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-extrabold" style={{ color: C.ink }}>
                A couple of things worth knowing about your current setup
              </div>
              <ul className="mt-2 space-y-1.5 list-none">
                {signals.map((s) => (
                  <li key={s} className="text-xs font-semibold leading-relaxed max-w-[80ch]" style={{ color: C.faint }}>
                    — {s}
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold mt-2.5 max-w-[80ch]" style={{ color: C.faint }}>
                None of this means anything is wrong. Easing the pace on the Profile tab is one option;
                the self-check below is another. Both are yours to ignore.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Order matters. A positive screen puts SUPPORT first — before the
          self-check, and well before 47 nutrient numbers. */}
      <div className="flex flex-col gap-4">
        {gated || screen?.positive ? (
          <>
            {supportCard}
            {checkCard}
          </>
        ) : (
          <>
            {checkCard}
            <MicronutrientsCard date={todayStr()} gated={false} className="" />
            {supportCard}
          </>
        )}

        {(gated || screen?.positive) && (
          <MicronutrientsCard date={todayStr()} gated={gated} onShowAnyway={onShowMicrosAnyway} className="" />
        )}

        {/* Health / legal disclaimer — the key line, always visible. The full
            text lives in the self-check dialog; this is the standing summary
            so the tab never implies clinical authority it doesn't have. */}
        <Card section="DISCLAIMER" title="Not medical advice">
          <div className="flex items-start gap-2.5">
            <LifeBuoy size={15} className="shrink-0 mt-0.5" style={{ color: C.faint }} aria-hidden="true" />
            <p className="text-xs leading-relaxed max-w-[80ch]" style={{ color: C.faint }}>
              Cut Protocol is a planning tool, not a medical device. Its targets, plans and estimates
              are general information from formulas — not a prescription, not personalized clinical
              guidance, and no substitute for a physician or registered dietitian. The calorie floor
              and rate warnings are <strong style={{ color: C.ink }}>conservative defaults, not a
              statement that any intake is safe for you</strong>. Very low intakes can be dangerous
              and need professional supervision. The full disclaimer is in the self-check dialog.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
