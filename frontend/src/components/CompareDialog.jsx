import { useRef, useId } from "react";
import { X, Scale } from "lucide-react";
import { useFocusTrap } from "../lib/useFocusTrap.js";

// "How it compares" — an in-app view of where Cut Protocol sits against the other
// calorie / macro / meal-planning apps.
//
// EVERY CLAIM HERE IS A FACTUAL CLAIM ABOUT A NAMED COMPANY. Rules for editing:
//   1. Cite a primary source (the vendor's own docs, help centre or store
//      listing) before you write a mark. Forum sentiment is not a source for a
//      feature claim.
//   2. If the number varies across sources, cut the number. Say "large,
//      crowd-sourced", not a fake-precise figure.
//   3. Never claim a capability for Cut Protocol that another screen disclaims.
//      `WellbeingCheck.jsx` disclaims allergen guarantees — so this table may
//      not promise one. Checked 2026-07-24 against vendor documentation.
//
// DESIGN LAW (CLAUDE.md, law a — GREEN SCARCITY): --accent means on-target,
// primary action, success, the hero ring, the trend line. A comparison table is
// none of those, so there is NO green in this component. The Cut Protocol column
// is emphasised the sanctioned way: a lightness step (--card-2) plus font
// weight. Gaps are calm amber (--warn), never red.

const APPS = ["Cut", "MFP", "MacroF.", "Cron.", "Lose It", "Carbon"];
// each row: [feature, why, [Cut, MFP, MacroFactor, Cronometer, LoseIt, Carbon]]
// a mark is "y" yes/strong · "p" partial · "n" no · "$" paid,
// optionally as [mark, "footnote"] to qualify it.
const ROWS = [
  ["Solves a full day to your target",
    "Others suggest recipes from a fixed library; this scales portions to hit the number — or says it can't and why",
    [["y", "portion-scaled"], ["p", "Premium+ planner"], "n", "n", ["p", "Premium, pre-log"], "n"]],
  ["Adaptive TDEE from your weigh-ins", "Answers the “is my deficit real?” plateau anxiety", ["y", "n", "y", "n", "n", "y"]],
  ["Allergen exclusion",
    "Filters ingredients, recipe titles and step text — see the caveat below",
    [["p", "not a guarantee"], ["p", "foods-to-avoid"], "n", "n", "n", "n"]],
  ["Micronutrients", "Cronometer leads; Cut Protocol rolls them up from the plan", ["y", "p", "p", ["y", "84 nutrients"], "p", "n"]],
  ["Cost / time / complexity / taste filters", "Steer the plan to your life, not just macros", ["y", "n", "n", "n", "n", "n"]],
  ["Runs offline · data stays on your device", "A local account on your machine — no cloud, no data sold", [["y", "local account"], "n", "n", ["p", "cloud, some offline"], "n", "n"]],
  ["Price model", "The #1 reason people left MyFitnessPal", ["y", "$", "$", ["$", "free tier + Gold"], "$", "$"]],
  ["No ads", "", ["y", ["n", "ads on free tier"], "y", ["p", "ad-free on Gold"], "p", "y"]],
  ["Deterministic, not AI-guess", "Two big communities banned/rejected AI logging", ["y", "p", "p", "y", "p", "p"]],
  ["Barcode / photo quick-logging", "Where Cut Protocol is behind", [["n", "barcode imports to the library, not to a log"], ["p", "barcode paywalled"], "y", "y", "y", "p"]],
  ["Mobile app", "Cut Protocol is desktop-first", ["n", "y", "y", "y", "y", "y"]],
  ["Food database size", "Curated & validated vs. huge & crowd-sourced", [["p", "small, validated"], ["y", "~20M, error-prone"], "y", ["y", "~1.1M USDA-verified"], ["y", "large, crowd-sourced"], "p"]],
];
const WINS = [
  ["It plans, it doesn’t just log", "The big trackers log what you ate. Cut Protocol solves the whole day to your target, scales the portions, and tells you when it can’t hit the number instead of quietly missing it."],
  ["Allergies are a filter, not a tag", "Exclusions are matched across ingredients, recipe titles and step text — not just a diet label. It is a filter, not a safety guarantee; read the caveat below."],
  ["Own it, offline, private", "One-time, no ads, no cloud. Your account and your data live on your machine."],
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

  // Marks are neutral ink for every app including Cut Protocol (law a). The Cut
  // column reads as ours from its lightness step and weight, not from hue.
  const mark = (cell) => {
    const [v, note] = Array.isArray(cell) ? cell : [cell, null];
    const glyph =
      v === "y" ? <span style={{ color: "var(--foreground)", fontWeight: 800 }}>●</span>
        : v === "p" ? <span style={{ color: "var(--warn)", fontWeight: 800 }}>◐</span>
          : v === "$" ? <span style={{ color: "var(--warn)", fontWeight: 800 }}>$</span>
            : <span style={{ color: "var(--muted-foreground)", fontWeight: 800 }}>—</span>;
    return (
      <>
        {glyph}
        {note && <span className="block" style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 400, marginTop: 2, lineHeight: 1.2 }}>{note}</span>}
      </>
    );
  };

  return (
    // NOTE: this scrim alpha is the shared value used by BodyFatPicker and
    // WellbeingCheck too. It wants a --scrim token in index.css; changing it
    // here alone would fragment the three dialogs, so it stays until the token
    // lands.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--scrim)" }}
      role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={panelRef} tabIndex={-1} className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl p-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Scale size={18} aria-hidden="true" style={{ color: "var(--muted-foreground)" }} />
            <h2 id={titleId} className="text-lg font-extrabold" style={{ color: "var(--foreground)" }}>How it compares</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:opacity-80" style={{ color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
          A solver in a market of trackers. MyFitnessPal, MacroFactor, Cronometer, Lose It and Carbon
          are built to <b style={{ color: "var(--foreground)" }}>log what you ate</b>; Cut Protocol is built to
          <b style={{ color: "var(--foreground)" }}> build the plan</b>. MyFitnessPal and Lose It do ship meal
          planners on their paid tiers — the difference is that they suggest recipes from a fixed
          library, while this solves portions against your exact target.
        </p>

        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th className="text-left p-2" style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>Feature</th>
                {APPS.map((a, i) => (
                  <th key={a} className="p-2 text-center" style={{ color: i === 0 ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: i === 0 ? 800 : 600, background: i === 0 ? "var(--secondary)" : "transparent", borderBottom: "1px solid var(--border)" }}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([feat, why, marks]) => (
                <tr key={feat}>
                  <td className="p-2" style={{ color: "var(--foreground)", borderBottom: "1px solid var(--border)" }}>
                    {feat}{why && <span className="block" style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{why}</span>}
                  </td>
                  {marks.map((m, i) => (
                    <td key={i} className="p-2 text-center align-top" style={{ borderBottom: "1px solid var(--border)", background: i === 0 ? "var(--secondary)" : "transparent" }}>{mark(m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 flex-wrap mt-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
          <span><b style={{ color: "var(--foreground)" }}>●</b> yes</span>
          <span><b style={{ color: "var(--warn)" }}>◐</b> partial</span>
          <span><b style={{ color: "var(--warn)" }}>$</b> paid</span>
          <span><b style={{ color: "var(--muted-foreground)" }}>—</b> no equivalent found</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          {WINS.map(([h, p]) => (
            <div key={h} className="rounded-xl p-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
              <div className="text-sm font-bold mb-1" style={{ color: "var(--foreground)" }}>{h}</div>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{p}</p>
            </div>
          ))}
        </div>
        <div className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: "var(--muted-foreground)" }}>Where it’s behind (honestly)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GAPS.map(([h, p]) => (
            <div key={h} className="rounded-xl p-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
              <div className="text-sm font-bold mb-1" style={{ color: "var(--warn)" }}>{h}</div>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{p}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-3 mt-5 text-xs" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          <b style={{ color: "var(--warn)" }}>Allergen caveat.</b>{" "}
          <span style={{ color: "var(--muted-foreground)" }}>
            Cut Protocol’s exclusion filter is thorough, but it is <b style={{ color: "var(--foreground)" }}>not a
            guarantee</b>. It cannot see cross-contamination, “may contain” warnings, or an
            ingredient a recipe never named. Always read labels, and treat the plan as a starting
            point rather than a clearance.
          </span>
          <div className="mt-2">
            <b style={{ color: "var(--foreground)" }}>About this comparison.</b> Checked 2026-07-24 against each
            vendor’s own documentation and store listing. Feature sets and pricing change often —
            verify with the app itself before relying on a row. “—” means no equivalent feature was
            found in public documentation on that date, not that one can never exist. Cut Protocol is
            an independent project, <b style={{ color: "var(--foreground)" }}>not affiliated with, endorsed by, or
            partnered with</b> any app named here; all product names belong to their owners.
          </div>
        </div>
      </div>
    </div>
  );
}
