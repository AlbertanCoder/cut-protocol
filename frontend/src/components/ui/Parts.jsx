import { AlertTriangle } from "lucide-react";
import { C } from "../../lib/theme.js";

export const Eyebrow = ({ children }) => (
  <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: C.faint, letterSpacing: ".04em" }}>{children}</div>
);

// Standard tab header: big athletic title, optional subtitle, actions right.
export const PageHead = ({ title, sub, children }) => (
  <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
    <div>
      <h1 className="text-[26px] font-black uppercase tracking-tight leading-none" style={{ color: C.ink, letterSpacing: "-.01em" }}>{title}</h1>
      {sub && <div className="text-xs font-semibold mt-1.5" style={{ color: C.faint }}>{sub}</div>}
    </div>
    {children && <div className="flex gap-2 items-center flex-wrap">{children}</div>}
  </div>
);

// Spacing between cards comes from the parent grid/flex gap, not the card.
export const Card = ({ section, title, children, tint, className = "" }) => (
  <section
    className={`p-5 rounded-2xl ${className}`}
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

export const Stat = ({ label, value, unit, big }) => (
  <div className="py-1.5">
    <div className="text-xs font-semibold" style={{ color: C.faint }}>{label}</div>
    <div className={`mono stat-hero ${big ? "text-4xl" : "text-2xl"}`} style={{ color: C.ink }}>
      {value}{unit && <span className="text-xs ml-1" style={{ color: C.faint, fontWeight: 600, letterSpacing: 0 }}>{unit}</span>}
    </div>
  </div>
);

export const Btn = ({ children, onClick, kind = "ink", small, disabled }) => {
  const KIND_STYLES = {
    ink: { bg: C.accent, fg: C.accentInk, border: C.accent },
    primary: { bg: C.accent, fg: C.accentInk, border: C.accent },
    red: { bg: C.red, fg: C.paper, border: C.red },
    green: { bg: C.good, fg: C.paper, border: C.good },
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

// Status banner — verdict card's voice. Reserved status colors, never series colors.
export const Stamp = ({ v, stampStyle }) => {
  const s = stampStyle[v.tone];
  return (
    <div className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: s.bg || C.paper, border: `1px solid ${s.color}33` }}>
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: s.color }}></div>
      <div>
        <div className="text-sm font-extrabold uppercase tracking-wide" style={{ color: s.color }}>{v.tag}</div>
        <div className="text-xs mt-0.5" style={{ color: C.ink }}>{v.sub}</div>
      </div>
    </div>
  );
};

// Horizontal progress bar with target — the macro-bar language used
// throughout Today/Engine. Turns red (fill + number) past 100%.
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
      <div className="h-2.5 rounded-full relative overflow-hidden" style={{ background: C.card2 }}>
        <div className="h-full rounded-full transition-all duration-150" style={{ width: `${pct}%`, background: fillColor }}></div>
      </div>
    </div>
  );
};

// SVG circular progress — the Today-tab hero ring. pct is a 0-1 fraction;
// >1 flips fill + number red (over target).
export const Ring = ({ pct, size = 108, stroke = 10, color = C.accent, num, unit }) => {
  const over = pct > 1;
  const ringColor = over ? C.red : color;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, Math.max(0, pct)));
  const numClass = size >= 150 ? "text-4xl" : size >= 120 ? "text-3xl" : "text-2xl";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.card2} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: "stroke-dashoffset .2s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`mono stat-hero ${numClass}`} style={{ color: over ? C.red : C.ink }}>{num}</div>
        {unit && <div className="text-[10px] font-bold" style={{ color: C.faint }}>{unit}</div>}
      </div>
    </div>
  );
};

export const Chip = ({ children, color, bg }) => (
  <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ color: color || C.faint, background: bg || C.card2, border: bg ? "none" : `1px solid ${C.rule}` }}>
    {children}
  </span>
);

// Error panel — every error states what happened AND what to do about it.
// `hint` overrides the generic recovery line for context-specific advice.
export const ErrorNote = ({ msg, hint }) => (
  <div className="p-3 rounded-xl flex items-start gap-2.5" style={{ background: C.redBg, border: `1px solid ${C.red}55` }}>
    <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: C.red }} />
    <div className="min-w-0">
      <div className="text-xs font-bold" style={{ color: C.red }}>{msg}</div>
      <div className="text-xs font-semibold mt-0.5" style={{ color: C.faint }}>
        {hint || "Try the action again — if it keeps failing, restart the app and retry."}
      </div>
    </div>
  </div>
);

// Empty-state block — icon, plain statement, and what unlocks it. The
// "Projections unlock with weigh-in data" voice, everywhere.
export const EmptyNote = ({ icon: Icon, title, hint, height }) => (
  <div className="flex flex-col items-center justify-center gap-2 text-center" style={height ? { height } : { padding: "18px 0" }}>
    {Icon && <Icon size={22} style={{ color: C.faintLight }} />}
    <div className="text-sm font-semibold" style={{ color: C.faint }}>{title}</div>
    {hint && <div className="text-xs font-medium max-w-[260px]" style={{ color: C.faintLight }}>{hint}</div>}
  </div>
);
