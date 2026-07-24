import { useRef, useId } from "react";
import { X, Scale } from "lucide-react";
import { C } from "../lib/theme.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

// "How it compares" — an in-app view of where Cut Protocol sits against the other
// calorie / macro / meal-planning apps, drawn from the 2026-07-24 forum + review
// research (docs/research/forums-2026-07-24/). Design law: green (accent) only for
// Cut Protocol's own strengths; competitor marks are neutral ink; gaps are calm
// amber, never red.

const APPS = ["Cut", "MFP", "MacroF.", "Cron.", "Lose It", "Carbon"];
// each row: [feature, why, [Cut, MFP, MacroFactor, Cronometer, LoseIt, Carbon]]
// mark values: "y" yes/strong · "p" partial · "n" no · "$" paid
const ROWS = [
  ["Builds a compliant meal plan to your target", "A solver, not a tracker — the core difference", ["y", "n", "n", "n", "n", "n"]],
  ["Adaptive TDEE from your weigh-ins", "Answers the “is my deficit real?” plateau anxiety", ["y", "n", "y", "n", "n", "y"]],
  ["Zero-tolerance allergy exclusion", "Removes unsafe food, not just “tagged” filtering", ["y", "n", "n", "n", "n", "n"]],
  ["Micronutrients", "Cronometer leads; Cut Protocol rolls them up from the plan", ["y", "p", "p", "y", "p", "n"]],
  ["Cost / time / complexity / taste filters", "Steer the plan to your life, not just macros", ["y", "n", "n", "n", "n", "n"]],
  ["Offline · data stays on your device", "No account, no cloud, no data sold", ["y", "n", "n", "p", "n", "n"]],
  ["Price model", "The #1 reason people left MyFitnessPal", ["y", "$", "$", "$", "$", "$"]],
  ["No ads", "", ["y", "n", "y", "y", "p", "y"]],
  ["Deterministic, not AI-guess", "Two big communities banned/rejected AI logging", ["y", "p", "p", "y", "p", "p"]],
  ["Barcode / photo quick-logging", "Where Cut Protocol is behind", ["n", "p", "y", "y", "y", "p"]],
  ["Mobile app", "Cut Protocol is desktop-first", ["n", "y", "y", "y", "y", "y"]],
  ["Food database size", "Curated & validated vs. huge & crowd-sourced", ["p", "y", "y", "y", "y", "p"]],
];
const WINS = [
  ["It plans, it doesn’t nag", "Users of the big trackers hand-build meal plans their apps can’t make. Cut Protocol solves the whole day to your target."],
  ["Allergies are a wall, not a tag", "True zero-tolerance exclusion — majors, species depth, rares, and allergens hidden in recipe steps."],
  ["Own it, offline, private", "No subscription, no ads, no account — the exact pains that pushed people off MyFitnessPal."],
  ["Honest by design", "No red on food, a hard calorie floor, no streak-shaming, and an optional wellbeing check."],
];
const GAPS = [
  ["No quick-logging", "It plans what to eat; it doesn’t yet capture what you actually ate by barcode or photo."],
  ["Desktop only", "Most logging happens on a phone; a companion mobile-log is the realistic bridge."],
  ["Household & cross-contamination", "Solves for one eater today; “may-contain” flags and multi-person plans are top requests."],
];

export default function CompareDialog({ open, onClose }) {
  const panelRef = useRef(null);
  const titleId = useId();
  useFocusTrap(panelRef, { active: open, onClose });
  if (!open) return null;

  const mark = (v, isCut) => {
    if (v === "y") return <span style={{ color: isCut ? C.accent : C.ink, fontWeight: 800 }}>●</span>;
    if (v === "p") return <span style={{ color: C.warn, fontWeight: 800 }}>◐</span>;
    if (v === "$") return <span style={{ color: C.warn, fontWeight: 800 }}>$</span>;
    return <span style={{ color: C.faintLight, fontWeight: 800 }}>—</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={panelRef} tabIndex={-1} className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl p-6"
        style={{ background: C.card, border: `1px solid ${C.rule}` }}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Scale size={18} aria-hidden="true" style={{ color: C.accent }} />
            <h2 id={titleId} className="text-lg font-extrabold" style={{ color: C.ink }}>How it compares</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:opacity-80" style={{ color: C.faint }}><X size={18} /></button>
        </div>
        <p className="text-sm mb-4" style={{ color: C.faint }}>
          A solver in a market of trackers. MyFitnessPal, MacroFactor, Cronometer, Lose It and Carbon
          <b style={{ color: C.ink }}> log what you ate</b>; Cut Protocol <b style={{ color: C.ink }}>builds the plan</b>.
          <span style={{ color: C.faintLight }}> (From public reviews &amp; forums, 2026-07. Others’ features change — this isn’t affiliated with any of them.)</span>
        </p>

        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${C.rule}` }}>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th className="text-left p-2" style={{ color: C.faint, borderBottom: `1px solid ${C.rule}` }}>Feature</th>
                {APPS.map((a, i) => (
                  <th key={a} className="p-2 text-center" style={{ color: i === 0 ? C.accent : C.faint, fontWeight: i === 0 ? 800 : 600, borderBottom: `1px solid ${C.rule}` }}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([feat, why, marks]) => (
                <tr key={feat}>
                  <td className="p-2" style={{ color: C.ink, borderBottom: `1px solid ${C.rule}` }}>
                    {feat}{why && <span className="block" style={{ color: C.faintLight, fontSize: 11 }}>{why}</span>}
                  </td>
                  {marks.map((m, i) => (
                    <td key={i} className="p-2 text-center" style={{ borderBottom: `1px solid ${C.rule}`, background: i === 0 ? "rgba(47,213,118,0.05)" : "transparent" }}>{mark(m, i === 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 flex-wrap mt-2 text-xs" style={{ color: C.faint }}>
          <span><b style={{ color: C.accent }}>●</b> yes</span>
          <span><b style={{ color: C.warn }}>◐</b> partial</span>
          <span><b style={{ color: C.warn }}>$</b> paid</span>
          <span><b style={{ color: C.faintLight }}>—</b> no</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          {WINS.map(([h, p]) => (
            <div key={h} className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
              <div className="text-sm font-bold mb-1" style={{ color: C.accent }}>{h}</div>
              <p className="text-xs" style={{ color: C.faint }}>{p}</p>
            </div>
          ))}
        </div>
        <div className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: C.faint }}>Where it’s behind (honestly)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GAPS.map(([h, p]) => (
            <div key={h} className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
              <div className="text-sm font-bold mb-1" style={{ color: C.warn }}>{h}</div>
              <p className="text-xs" style={{ color: C.faint }}>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
