import { C } from "../../lib/theme.js";

export const Eyebrow = ({ children }) => (
  <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: C.faint, letterSpacing: ".04em" }}>{children}</div>
);

export const Card = ({ section, title, children, tint }) => (
  <section
    className="mb-3 p-5 rounded-2xl transition-colors duration-150"
    style={{ background: tint || C.card, border: `1px solid ${C.rule}`, boxShadow: "var(--shadow)" }}
  >
    {(section || title) && (
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[15px] font-bold" style={{ color: C.ink, letterSpacing: "-.01em" }}>{title}</div>
        {section && <div className="text-[10.5px] font-semibold uppercase" style={{ color: C.faintLight, letterSpacing: ".06em" }}>{section}</div>}
      </div>
    )}
    {children}
  </section>
);

export const Stat = ({ label, value, unit }) => (
  <div className="py-1.5">
    <div className="text-xs font-semibold" style={{ color: C.faint }}>{label}</div>
    <div className="mono text-xl font-extrabold" style={{ color: C.ink, letterSpacing: "-.01em" }}>
      {value}{unit && <span className="text-xs font-semibold ml-1" style={{ color: C.faint }}>{unit}</span>}
    </div>
  </div>
);

export const Btn = ({ children, onClick, kind = "ink", small, disabled }) => {
  const KIND_STYLES = {
    ink: { bg: C.accent, fg: "#FFFFFF", border: C.accent },
    primary: { bg: C.accent, fg: "#FFFFFF", border: C.accent },
    red: { bg: C.red, fg: "#FFFFFF", border: C.red },
    green: { bg: C.good, fg: "#FFFFFF", border: C.good },
    ghost: { bg: "transparent", fg: C.ink, border: C.rule },
  };
  const s = KIND_STYLES[kind] || KIND_STYLES.ink;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-bold rounded-xl transition-all duration-150 hover:opacity-90 active:opacity-80 ${small ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2.5"}`}
      style={{ background: s.bg, color: s.fg, border: `1.5px solid ${s.border}`, opacity: disabled ? 0.45 : 1 }}
    >
      {children}
    </button>
  );
};

// Was a rotated "stamp" in v1's industrial theme — now a calm rounded
// status banner matching the rest of the card system.
export const Stamp = ({ v, stampStyle }) => {
  const s = stampStyle[v.tone];
  return (
    <div className="rounded-xl p-3.5 flex items-start gap-3 transition-colors duration-150" style={{ background: s.bg || C.paper, border: `1px solid ${s.color}33` }}>
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: s.color }}></div>
      <div>
        <div className="text-sm font-extrabold uppercase tracking-wide" style={{ color: s.color }}>{v.tag}</div>
        <div className="text-xs mt-0.5" style={{ color: C.ink }}>{v.sub}</div>
      </div>
    </div>
  );
};

// Horizontal progress bar with an optional target tick — the macro-bar
// language used throughout Today/Engine. Turns red (fill + number) past
// 100% - previously clamped silently at a full-looking bar with no visual
// difference between "right on target" and "82g over," the same gap this
// component's Ring sibling below had.
export const MacroBar = ({ label, actual, target, unit = "g", color }) => {
  const over = target > 0 && actual > target;
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const fillColor = over ? C.red : color;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline text-xs">
        <span className="font-bold flex items-center gap-1.5" style={{ color: C.ink }}>
          <span className="w-2 h-2 rounded-full" style={{ background: color }}></span>{label}
        </span>
        <span className="font-semibold" style={{ color: C.faint }}>
          <b className="mono" style={{ color: over ? C.red : C.ink }}>{Math.round(actual)}</b> / {Math.round(target)}{unit}
        </span>
      </div>
      <div className="h-2.5 rounded-full relative overflow-hidden transition-colors duration-150" style={{ background: C.rule }}>
        <div className="h-full rounded-full transition-all duration-150" style={{ width: `${pct}%`, background: fillColor }}></div>
      </div>
    </div>
  );
};

// SVG circular progress — the Today-tab hero ring. Same over-target color
// swap as MacroBar (see above) - pct is a 0-1 fraction, so >1 means over.
export const Ring = ({ pct, size = 108, stroke = 10, color = C.accent, num, unit }) => {
  const over = pct > 1;
  const ringColor = over ? C.red : color;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, Math.max(0, pct)));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.rule} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: "stroke-dashoffset .2s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="mono text-2xl font-extrabold" style={{ color: over ? C.red : C.ink, letterSpacing: "-.02em" }}>{num}</div>
        {unit && <div className="text-[10px] font-bold" style={{ color: C.faint }}>{unit}</div>}
      </div>
    </div>
  );
};

export const Chip = ({ children, color, bg }) => (
  <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ color: color || C.faint, background: bg || C.paper, border: bg ? "none" : `1px solid ${C.rule}` }}>
    {children}
  </span>
);
