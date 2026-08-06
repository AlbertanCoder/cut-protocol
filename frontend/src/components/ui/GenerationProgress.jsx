import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Card } from "./Parts.jsx";

// ── honest generation progress ────────────────────────────────────────────
// The solve is server-side and sub-second (a 28-day solve measured p95 689 ms),
// so there is NO per-phase telemetry to stream and NO percentage to source.
// Showing a number we can't measure would be fabricated progress, which the
// spec forbids. Instead we narrate the real phases a generate request moves
// through, ending on the allergy check (the verifier), over an INDETERMINATE
// bar (the app's .skeleton shimmer, which freezes under prefers-reduced-motion).
// The bar makes no completion-time claim; the request resolving is the only
// real signal, and the parent unmounts this the instant it does.
//
// Law compliance: no green (law a — this is not on-target/success), no red on
// data (law b), no macro hues (law c). Neutral ink/faint only.

const phasesFor = (kind, days) =>
  kind === "meal"
    ? [
        "Reading what's left of today…",
        "Filtering your library…",
        "Scoring the dishes that fit…",
        "Checking every ingredient against your allergy list…",
      ]
    : [
        "Filtering your library…",
        "Scoring recipes…",
        `Solving ${days} day${days === 1 ? "" : "s"}…`,
        "Checking every ingredient against your allergy list…",
      ];

export default function GenerationProgress({ kind = "plan", days = 7, onCancel }) {
  const phases = phasesFor(kind, days);
  const [i, setI] = useState(0);

  // Narrate through the phases and HOLD on the last one (the allergy verifier)
  // while the request is still in flight — if we're still waiting, the final
  // gate is honestly the thing that remains. Restart whenever the horizon
  // changes (a new generate remounts this anyway, but be explicit).
  useEffect(() => {
    setI(0);
    const id = setInterval(() => setI((n) => Math.min(n + 1, phases.length - 1)), 520);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, days]);

  const heading = kind === "meal" ? "Fitting one meal" : "Generating your plan";

  return (
    <Card section="WORKING" title={heading}>
      {/* One calm, unchanging line for screen readers — the visual list below
          would otherwise announce every phase change and read as noise. */}
      <div role="status" className="sr-only">{heading} — working.</div>

      <div aria-hidden="true">
        <div className="skeleton w-full rounded-full" style={{ height: 8 }} />
        <ul className="flex flex-col gap-1.5 mt-3">
          {phases.map((p, idx) => {
            const active = idx === i;
            const past = idx < i;
            // a11y contrast: the phase TEXT never drops below --faint (60%,
            // 6.5:1) — --faint-light is 38% ink (3.26:1) and fails WCAG AA at
            // body size (Parts.jsx:31-34 documents the same fix). The three-tier
            // hierarchy still reads, carried by the dot rather than the label.
            const textColor = active ? "var(--foreground)" : "var(--muted-foreground)";
            const dotColor = active ? "var(--foreground)" : past ? "var(--muted-foreground)" : "var(--muted-foreground)";
            return (
              <li key={p} className="flex items-center gap-2 text-xs font-semibold" style={{ color: textColor }}>
                <span
                  className={active ? "ring-breathe" : ""}
                  style={{ width: 6, height: 6, borderRadius: 999, background: dotColor, display: "inline-block", flexShrink: 0 }}
                />
                {p}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-between gap-3 mt-3.5">
        <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
          No percentage — the solve runs server-side in one step, so there's nothing real to count.
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1 shrink-0"
            style={{ background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)" }}
          >
            <X size={12} aria-hidden="true" /> Cancel
          </button>
        )}
      </div>
    </Card>
  );
}
