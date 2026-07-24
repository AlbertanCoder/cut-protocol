import { C } from "../../lib/theme.js";

// ── Stage 3 — the optional caps ───────────────────────────────────────────
// maxCostCad / maxComplexity / minTaste. Each is OFF by default and each has an
// EXPLICIT off state that is NOT its minimum value — an optional filter with no
// off state is a mandatory filter wearing a disguise (off ≠ 0). null = off.
//
// Constitution:
//  • Cost is NOT a macro — never --protein/--carb/--fat, and never --accent
//    (green scarcity, law a). Values read in --ink, context in --faint.
//  • Selection/active is a LIGHTNESS step (--card-2 + a --faint-light hairline),
//    never green — same language the horizon/cuisine chips already use.

const capPill = (on) => ({
  background: on ? C.card2 : "transparent",
  color: on ? C.ink : C.faint,
  border: `1px solid ${on ? C.faintLight : C.rule}`,
});

// A single optional numeric cap on a slider with a real OFF state. Turning it on
// seeds `enableAt` (the pool median), never the slider minimum, so "on at its
// lowest" and "off" can never be confused. The range thumb uses neutral --ink
// (accent-color), so this borrows no reserved series/status hue.
export function RangeCap({ label, value, onChange, min, max, step, enableAt, format, help }) {
  const on = value != null;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-bold" style={{ color: C.ink }}>{label}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="mono text-xs font-bold" style={{ color: on ? C.ink : C.faintLight }}>
            {on ? format(value) : "Off"}
          </span>
          <button
            type="button"
            onClick={() => onChange(on ? null : enableAt)}
            aria-pressed={on}
            className="text-[10px] font-bold px-2 py-1 rounded-full"
            style={capPill(on)}
          >
            {on ? "Turn off" : "Set cap"}
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={on ? value : min}
        disabled={!on}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label}${on ? "" : " (off)"}`}
        className="w-full"
        style={{ accentColor: C.ink, opacity: on ? 1 : 0.35 }}
      />
      {help && <div className="text-[10px] font-semibold mt-1" style={{ color: C.faint }}>{help}</div>}
    </div>
  );
}

// Complexity is inherently three named tiers, so its control is a segmented
// pick with OFF as a first-class fourth option — not "0", not "Simple".
export function ComplexityCap({ value, onChange }) {
  const OPTS = [
    { v: null, l: "Off" },
    { v: 3, l: "Simple" },
    { v: 6, l: "Moderate" },
    { v: 10, l: "Involved" },
  ];
  return (
    <div className="min-w-0">
      <div className="text-xs font-bold mb-1.5" style={{ color: C.ink }}>Max complexity</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Max complexity">
        {OPTS.map((o) => {
          const on = value === o.v;
          return (
            <button
              key={o.l}
              type="button"
              onClick={() => onChange(o.v)}
              aria-pressed={on}
              className="text-xs font-bold px-2.5 py-1.5 rounded-full"
              style={capPill(on)}
            >
              {o.l}{o.v != null ? ` ≤${o.v}` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
