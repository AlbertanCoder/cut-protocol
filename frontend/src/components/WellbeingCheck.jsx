import { useState, useRef, useId } from "react";
import { X, Heart } from "lucide-react";
import { C } from "../lib/theme.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import ResourceList from "./ui/ResourceList.jsx";
import { WELLBEING_RESOURCES_NOTE } from "../lib/wellbeingResources.js";

// Wellbeing check — an OPTIONAL, non-diagnostic eating-disorder self-screen
// (SCOFF) plus the health/legal disclaimer and support resources. Calorie and
// weight-loss tools can worsen disordered eating for some people; a repeatedly
// cited survey found ~73% of people with an ED who used a calorie app felt it
// contributed to their disorder. This is the app's honest answer to that.
//
// Design law: NO red on this screen. A positive screen is calm amber, never
// alarming. SCOFF over-flags in community samples (sensitivity ~0.54 there), so
// the copy is deliberately "a reason to check in," never "you have a disorder."

// The five SCOFF items (Morgan, Reid & Lacey, 1999). One point per "yes";
// two or more = a positive screen. The letters spell SCOFF.
const SCOFF = [
  { id: "sick", q: "Do you make yourself Sick (vomit) because you feel uncomfortably full?" },
  { id: "control", q: "Do you worry you have lost Control over how much you eat?" },
  { id: "onestone", q: "Have you recently lost more than One stone (about 6.3 kg / 14 lb) in a 3-month period?" },
  { id: "fat", q: "Do you believe yourself to be Fat when others say you are too thin?" },
  { id: "food", q: "Would you say that Food dominates your life?" },
];

// Support resources moved to lib/wellbeingResources.js (single source of truth,
// shared with the Profile "Outside help" card) so a verified number can never
// drift between the two places it's shown.

export default function WellbeingCheck({ open, onClose }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const panelRef = useRef(null);
  const titleId = useId();
  useFocusTrap(panelRef, { active: open, onClose });

  if (!open) return null;

  const answered = SCOFF.filter((s) => answers[s.id] !== undefined).length;
  const score = SCOFF.reduce((n, s) => n + (answers[s.id] === true ? 1 : 0), 0);
  const positive = score >= 2;
  const set = (id, val) => { setAnswers((a) => ({ ...a, [id]: val })); setSubmitted(false); };
  const reset = () => { setAnswers({}); setSubmitted(false); };

  const card = { background: C.card, border: `1px solid ${C.rule}` };
  const yesNoBtn = (active) => ({
    background: active ? C.card2 : "transparent",
    color: active ? C.ink : C.faint,
    border: `1px solid ${active ? C.faintLight : C.rule}`,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={panelRef} tabIndex={-1} className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl p-6" style={card}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Heart size={18} aria-hidden="true" style={{ color: C.accent }} />
            <h2 id={titleId} className="text-lg font-extrabold" style={{ color: C.ink }}>Wellbeing check</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:opacity-80" style={{ color: C.faint }}>
            <X size={18} />
          </button>
        </div>

        <p className="text-xs mb-4" style={{ color: C.faint }}>
          A short, private self-check. It is <strong>not a diagnosis</strong> and nothing here leaves
          your computer. Cutting can be hard on your relationship with food — if any of this rings
          true, that alone is worth taking seriously.
        </p>

        {/* SCOFF questions */}
        <div className="space-y-2.5">
          {SCOFF.map((s, i) => (
            <div key={s.id} className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
              <div className="text-sm mb-2" style={{ color: C.ink }}>
                <span style={{ color: C.faint }}>{i + 1}. </span>{s.q}
              </div>
              <div className="flex gap-2">
                <button onClick={() => set(s.id, true)} className="text-xs font-bold px-4 py-1.5 rounded-lg" style={yesNoBtn(answers[s.id] === true)}>Yes</button>
                <button onClick={() => set(s.id, false)} className="text-xs font-bold px-4 py-1.5 rounded-lg" style={yesNoBtn(answers[s.id] === false)}>No</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setSubmitted(true)}
            disabled={answered < SCOFF.length}
            className="text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-40"
            style={{ background: C.accent, color: "#04150b" }}>
            See my result
          </button>
          {answered > 0 && (
            <button onClick={reset} className="text-xs font-semibold px-3 py-2 rounded-xl" style={{ color: C.faint, border: `1px solid ${C.rule}` }}>Reset</button>
          )}
          {answered < SCOFF.length && <span className="text-xs" style={{ color: C.faintLight }}>{answered} of {SCOFF.length} answered</span>}
        </div>

        {/* Result — calm amber for a positive screen, never red. */}
        {submitted && (
          <div className="mt-4 rounded-xl p-4" style={{ background: C.card2, border: `1px solid ${positive ? C.warn : C.rule}` }}>
            {positive ? (
              <>
                <div className="text-sm font-bold mb-1" style={{ color: C.warn }}>This might be worth checking in on.</div>
                <p className="text-xs" style={{ color: C.faint }}>
                  You answered “yes” to {score} of 5. This is a rough screening prompt — it flags many
                  people who do not have an eating disorder, so it is <strong>not a diagnosis</strong>.
                  But if food, eating, or body image feels hard right now, talking to a professional is
                  a good next step, and there is no downside to reaching out. It may also be worth
                  easing off any aggressive deficit for a while. The resources below are free and
                  confidential.
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-bold mb-1" style={{ color: C.ink }}>Nothing flagged today.</div>
                <p className="text-xs" style={{ color: C.faint }}>
                  This quick check didn’t raise anything — but it’s just a prompt, not a clean bill of
                  health. If something feels off with food or your body, trust that over a five-question
                  screen, and the resources below are always here.
                </p>
              </>
            )}
          </div>
        )}

        {/* Resources — always visible, not gated behind a positive result.
            Shared with the Profile "Outside help" card via ResourceList. */}
        <div className="mt-5">
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Support (Alberta / Canada)</div>
          <p className="text-[11px] mb-2" style={{ color: C.faintLight }}>{WELLBEING_RESOURCES_NOTE}</p>
          <ResourceList />
        </div>

        {/* Health / legal disclaimer — collapsible; the key line is always shown. */}
        <div className="mt-5 rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
          <div className="text-xs" style={{ color: C.faint }}>
            <strong style={{ color: C.ink }}>Not medical advice.</strong> Cut Protocol is a planning
            tool, not a medical device. Its targets, plans and estimates are general information from
            formulas — not a prescription or personalized clinical guidance, and no substitute for a
            physician or registered dietitian. It cannot guarantee any plan is free of a given
            allergen; always read labels.
          </div>
          <button onClick={() => setShowDisclaimer((v) => !v)} className="text-xs font-semibold mt-2 hover:opacity-80" style={{ color: C.accent }}>
            {showDisclaimer ? "Hide full disclaimer" : "Read the full disclaimer"}
          </button>
          {showDisclaimer && (
            <div className="text-xs mt-2 space-y-2" style={{ color: C.faint }}>
              <p>Consult a qualified professional before starting any diet, deficit, supplement or
              exercise program — especially if you are pregnant, under 18, have or have had an eating
              disorder, or have any chronic condition or medication whose dosing depends on intake or
              weight.</p>
              <p>The calorie floor and rate warnings are conservative defaults, not a statement that any
              intake is safe for you. Very low intakes can be dangerous and need professional
              supervision.</p>
              <p>Provided “as is”, without warranty of any kind. To the maximum extent permitted by law
              the author is not liable for any injury, loss or damage from your use of, or reliance on,
              this app. You use it at your own risk.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
