import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { C } from "../../lib/theme.js";

export const Eyebrow = ({ children }) => (
  <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: C.faint, letterSpacing: ".04em" }}>{children}</div>
);

// Standard tab header: Sora display title, optional subtitle, actions right.
export const PageHead = ({ title, sub, children }) => (
  <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
    <div>
      <h1 className="text-[26px] disp uppercase tracking-tight leading-none" style={{ color: C.ink, letterSpacing: "-.01em" }}>{title}</h1>
      {sub && <div className="text-xs font-semibold mt-1.5" style={{ color: C.faint }}>{sub}</div>}
    </div>
    {children && <div className="flex gap-2 items-center flex-wrap">{children}</div>}
  </div>
);

// Glass card: translucent fill + gradient hairline (index.css .glass-card).
// Elevation is lightness, never shadows. Spacing between cards comes from
// the parent grid/flex gap, not the card.
export const Card = ({ section, title, children, tint, className = "" }) => (
  <section
    className={`p-5 rounded-2xl ${tint ? "" : "glass-card"} ${className}`}
    style={tint ? { background: tint, border: `1px solid ${C.rule}` } : undefined}
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

// Button kinds: primary/ink = the green primary action (law a), red =
// destructive confirms only (never food/body data), ghost = quiet.
export const Btn = ({ children, onClick, kind = "ink", small, disabled }) => {
  const KIND_STYLES = {
    ink: { bg: C.accent, fg: C.accentInk, border: C.accent },
    primary: { bg: C.accent, fg: C.accentInk, border: C.accent },
    red: { bg: C.red, fg: C.paper, border: C.red },
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

// Status banner — verdict card's voice. Reserved status colors, never series
// colors. Worst tone is amber (law b): a verdict about food/body data
// re-plans, it never judges in red.
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
// throughout Today/Engine. The fill keeps its macro color and caps at 100%;
// going over turns the NUMBER calm amber (law b — never red on food data).
// The letter badge (P/C/F) rides the bar everywhere macros render (law c).
export const MacroBar = ({ label, actual, target, unit = "g", color }) => {
  const over = target > 0 && actual > target;
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const letter = (label || "?")[0].toUpperCase();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline text-xs">
        <span className="font-bold flex items-center gap-1.5" style={{ color: C.ink }}>
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0" style={{ background: color, color: C.paper }}>{letter}</span>
          {label}
        </span>
        <span className="font-semibold" style={{ color: C.faint }}>
          <b className="mono" style={{ color: over ? C.warn : C.ink }}>{Math.round(actual)}</b> / {Math.round(target)}{unit}
        </span>
      </div>
      <div className="h-2.5 rounded-full relative overflow-hidden" style={{ background: C.card2 }}>
        <div className="h-full rounded-full transition-all duration-150" style={{ width: `${pct}%`, background: color }}></div>
      </div>
    </div>
  );
};

// SVG circular progress — the Today-tab hero ring. pct is a 0-1 fraction.
// Past 100% it LAPS Apple-style — a second brighter arc rides over the
// first — and the number turns calm amber. It never turns red (law b).
// The accent ring carries the brand gradient (accent → tail) and a
// breathing glow (opacity-only; frozen under reduced motion).
export const Ring = ({ pct, size = 108, stroke = 10, color = C.accent, num, unit, breathe = true }) => {
  const p = Math.max(0, pct || 0);
  const over = p > 1;
  const lap1 = Math.min(1, p);
  const lap2 = Math.min(1, Math.max(0, p - 1));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const grad = color === C.accent;
  const numClass = size >= 150 ? "text-4xl" : size >= 120 ? "text-3xl" : "text-2xl";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {breathe && (
        <div
          className="absolute -inset-3 rounded-full ring-breathe pointer-events-none"
          style={{ background: `radial-gradient(closest-side, color-mix(in srgb, ${color} 14%, transparent), transparent 74%)` }}
          aria-hidden="true"
        />
      )}
      <svg width={size} height={size} className="relative" style={{ transform: "rotate(-90deg)" }}>
        {grad && (
          <defs>
            <linearGradient id={`rg${gid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={C.accent} />
              <stop offset="100%" stopColor={C.accentTail} />
            </linearGradient>
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.card2} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={grad ? `url(#rg${gid})` : color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - lap1)} style={{ transition: "stroke-dashoffset .2s ease" }} />
        {lap2 > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={grad ? C.accentTail : color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - lap2)} style={{ transition: "stroke-dashoffset .2s ease" }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`mono stat-hero ${numClass}`} style={{ color: over ? C.warn : C.ink }}>{num}</div>
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
// Red is legal here: this is system UI, not food/body data (law b).
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
