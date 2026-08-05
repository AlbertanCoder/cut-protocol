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
//
// a11y: the title is a real <h2>, and the <section> points at it with
// aria-labelledby. It used to be a plain <div> inside an unnamed <section>, so
// a 7-card dashboard exposed exactly ONE heading (the PageHead <h1>) and a
// screen-reader user had no way to jump between cards — heading navigation is
// the primary way AT users skim a dense screen. <h2> is the right level
// everywhere: every screen's PageHead owns the single <h1>. A card with no
// title stays an unlabelled <section> rather than getting an invented name.
export const Card = ({ section, title, children, tint, className = "" }) => {
  const hid = useId();
  return (
    <section
      className={`p-5 rounded-2xl ${tint ? "" : "glass-card"} ${className}`}
      style={tint ? { background: tint, border: `1px solid ${C.rule}` } : undefined}
      aria-labelledby={title ? hid : undefined}
    >
      {(section || title) && (
        <div className="flex items-baseline justify-between mb-3">
          {title && (
            <h2 id={hid} className="text-[15px] font-bold m-0" style={{ color: C.ink, letterSpacing: "-.01em" }}>{title}</h2>
          )}
          {/* a11y contrast fix: section eyebrows read on every card app-wide —
              faint-light (38%, 3.30:1 over card) fails WCAG AA for text; faint
              (60%, 6.28:1) passes while staying the app's second-quietest tier. */}
          {section && <div className="text-[10.5px] font-semibold uppercase ml-auto" style={{ color: C.faint, letterSpacing: ".06em" }}>{section}</div>}
        </div>
      )}
      {children}
    </section>
  );
};

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
//
// TYPOGRAPHY. `v.tag` used to be re-shouted here with `uppercase
// tracking-wide`, which was correct when the verdicts WERE shouted codes
// ("SLOW", "TOO FAST", "BORDERLINE SLOW — HOLD 1 WK"). bmrEngine.verdict() has
// since rewritten every one of them into a sentence-case statement ("Slower
// than planned", "On target", "Too early to tell"), and a CSS transform that
// re-capitalises a sentence is the compressed-code label style the owner
// banned, arriving through the back door. `tracking-wide` goes with it: the
// letter-spacing existed to keep all-caps legible and reads as loose and
// unfinished on sentence case. Stamp has exactly one caller (TodayTab), so
// this needs no opt-in prop.
//
// TONE FALLBACK. `stampStyle[v.tone]` was dereferenced unguarded, so an
// unrecognised tone threw a TypeError on `s.bg` and took the dashboard down
// instead of degrading — the precise failure mode the tone rename above could
// have caused. Unknown tones now render as the neutral "wait" style.
export const Stamp = ({ v, stampStyle }) => {
  const s = stampStyle?.[v.tone] || stampStyle?.wait || { color: C.faint, bg: "transparent" };
  return (
    // role="status": verdict text updates (e.g. after a weigh-in) get
    // announced to screen readers without needing focus to be on this card.
    // Theme-aware text (light-mode fix): the tone rides the rail + border
    // tint (s.color); title/sub use semantic tokens so they read on both the
    // dark and the light card. The stampStyle[v.tone] fallback above is the
    // protected part and is untouched.
    <div role="status" className="rounded-xl p-3.5 flex items-start gap-3 bg-secondary/50" style={{ border: `1px solid color-mix(in srgb, ${s.color} 25%, transparent)` }}>
      <div className="w-1 self-stretch rounded-full shrink-0" aria-hidden="true" style={{ background: s.color }}></div>
      <div>
        <div className="text-sm font-extrabold text-foreground">{v.tag}</div>
        <div className="text-xs mt-0.5 text-muted-foreground">{v.sub}</div>
      </div>
    </div>
  );
};

// Horizontal macro meter — the macro-bar language used throughout Today/Engine.
// The fill keeps its macro color; the letter badge (P/C/F) rides it everywhere
// macros render (law c). Over the top of a RANGE turns the number calm amber
// (law b — never red on food data). Over a FLOOR is not a fault at all.
//
// WHAT THIS COMPONENT USED TO GET WRONG. It took a single scalar `target` and
// drew `actual / target`, and its callers passed the TOP of a range
// (proteinHi / carbHi / fatHi) as that target. The Engine's own model is
// different and says so in one line: "calories and protein are load-bearing
// walls · fat is a floor · carbs flex." So the old bar contradicted the engine
// twice over —
//   · a user sitting exactly at the BOTTOM of the protein range saw an
//     85 %-filled bar and read it as a miss, and
//   · fat, which only has a minimum to clear, rendered as "Fat 117 / 65 g" at
//     180 % with the fill overflowing its own track, on a plan the solver had
//     scored as near-perfect.
// So a floor is now drawn as a floor and a range as a range, the numbers say
// which is which in words, and the rail's scale grows to fit whatever was
// actually eaten — nothing can overflow its track.
//
// PROPS. Preferred: `lo` + `kind="floor"` (a minimum to clear), or `lo` + `hi`
// + `kind="range"` (a band to land inside). The legacy single `target` prop is
// still accepted and is treated as a range whose floor and ceiling are the same
// number, so existing callers keep rendering — but it is the shape that caused
// the bug, and callers should move to lo/hi.
export const MacroBar = ({ label, letter, actual, target, lo, hi, kind, unit = "g", color }) => {
  const eaten = Number.isFinite(actual) ? actual : 0;
  const legacy = !Number.isFinite(lo) && Number.isFinite(target);
  const mode = kind || (legacy ? "range" : Number.isFinite(hi) ? "range" : "floor");
  const floor = Number.isFinite(lo) ? lo : Number.isFinite(target) ? target : 0;
  const ceil = mode === "range" ? (Number.isFinite(hi) ? hi : Number.isFinite(target) ? target : null) : null;
  const over = ceil != null && eaten > ceil;
  const g = (n) => Math.round(n);

  // The rail spans whatever is largest — the top of the target zone or what was
  // actually eaten — so the fill is always inside its own track.
  const span = Math.max(ceil ?? floor, eaten, 1);
  const pct = (v) => `${Math.max(0, Math.min(100, (v / span) * 100))}%`;

  const badge = (letter || (label || "?")[0]).toString().toUpperCase();
  const targetText = mode === "floor"
    ? `min ${g(floor)}${unit}`
    : ceil != null && ceil !== floor ? `${g(floor)}–${g(ceil)}${unit}` : `${g(floor)}${unit}`;
  const a11yLabel = mode === "floor"
    ? `${label}: ${g(eaten)}${unit}, minimum ${g(floor)}${unit}${eaten >= floor ? ", met" : ""}`
    : `${label}: ${g(eaten)}${unit}, target ${targetText}${over ? ", above the range" : ""}`;

  return (
    // role="group" + aria-label give screen readers ONE clean sentence for
    // the whole meter; the letter badge and fill bar are then hidden from
    // AT so the number isn't announced twice (it's already visible text).
    <div className="flex flex-col gap-1.5" role="group" aria-label={a11yLabel}>
      <div className="flex justify-between items-baseline text-xs">
        <span className="font-bold flex items-center gap-1.5" style={{ color: C.ink }}>
          <span aria-hidden="true" className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0" style={{ background: color, color: C.paper }}>{badge}</span>
          {label}
        </span>
        <span className="font-semibold" style={{ color: C.faint }}>
          <b className="mono" style={{ color: over ? C.warn : C.ink }}>{g(eaten)}</b> / {targetText}
        </span>
      </div>
      <div aria-hidden="true" className="h-2.5 rounded-full relative overflow-hidden" style={{ background: C.card2 }}>
        {/* the acceptable zone, drawn behind the fill: floor→ceiling for a
            range, floor→end of the rail when the floor is all there is */}
        <div className="absolute inset-y-0" style={{ left: pct(floor), right: ceil != null ? `calc(100% - ${pct(ceil)})` : 0, background: C.rule }} />
        <div className="h-full rounded-full transition-all duration-150 relative" style={{ width: pct(eaten), background: color }}></div>
        {/* the floor tick — the number that actually has to be reached */}
        <div className="absolute inset-y-0 w-px" style={{ left: pct(floor), background: C.faint }} />
      </div>
    </div>
  );
};

// SVG circular progress — the Today-tab hero ring. pct is a 0-1 fraction.
// Past 100% it LAPS Apple-style — a second brighter arc rides over the
// first — and the number turns calm amber. It never turns red (law b).
// The accent ring carries the brand gradient (accent → tail) and a
// breathing glow (opacity-only; frozen under reduced motion).
//
// LAPPING PAST 200%. The second arc used to be `min(1, p - 1)`, which SATURATES:
// 200 %, 300 % and 1000 % all painted a full first ring plus a full second ring
// and were indistinguishable, with only the aria-label carrying the true figure
// — a graphic that stops telling the truth exactly where the truth starts to
// matter. Apple's rings lap and keep a visible lap COUNT, so that is what this
// does now: arc 2 shows the progress through the CURRENT lap, and once two or
// more laps are complete a small "×3" counter rides the ring. 300 % and 1000 %
// are now different graphics, not the same one twice.
//
// THE 100.5% CASE. `strokeLinecap="round"` means arc 2's starting cap is painted
// directly over arc 1's finishing cap, so a hair over target looked identical to
// exactly on target. A short arc in the surface color is drawn UNDER arc 2 — the
// same "2px surface ring separates overlapping marks" rule the charts use — so
// the second lap always begins against a visible gap.
export const Ring = ({ pct, size = 108, stroke = 10, color = C.accent, num, unit, breathe = true }) => {
  const p = Math.max(0, pct || 0);
  const over = p > 1;
  const lap1 = Math.min(1, p);
  // Progress through the lap currently in flight (NOT clamped-and-saturated).
  //
  // THE EXACT-MULTIPLE CASE. `p - floor(p)` is 0 at exactly 200 % / 300 %, which
  // drew an EMPTY overlay arc: 200 % rendered with less ink than 199 % and, but
  // for the ×N badge, was the same graphic as a plain 100 %. The ring appeared to
  // snap backwards every time it completed a lap. An exact multiple is a lap that
  // just FINISHED, so it renders full.
  const whole = Math.floor(p);
  const exact = over && p === whole;
  const lapsDone = whole;
  const lap2 = over ? (exact ? 1 : p - whole) : 0;
  // Which lap is in flight: 1 = second lap, 2 = third, … Each lap past the first
  // is drawn a step further toward the over-target amber, because arc 2 used to
  // be one fixed color at every depth — 150 %, 250 % and 350 % all painted the
  // identical half-arc and only the small ×N badge told them apart.
  const lapIndex = over ? (exact ? whole - 1 : whole) : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  // ~2px of arc, expressed as a fraction of the circumference.
  const gapFrac = Math.min(0.12, 2 / circ + stroke / circ);
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const grad = color === C.accent;
  const numClass = size >= 150 ? "text-4xl" : size >= 120 ? "text-3xl" : "text-2xl";
  // Text equivalent for the graphic (a ring alone is invisible to a screen
  // reader): "82% — 1,850 planned kcal" / "112% — 2,530 planned kcal, over
  // target, laps past 100%". role="img" + aria-label reads as one sentence;
  // every visual child below is aria-hidden so the number isn't announced
  // twice (the same digits are already the visible face of the ring).
  const pctLabel = `${Math.round(p * 100)}%`;
  const a11yLabel = `${pctLabel}${num != null ? ` — ${num}${unit ? " " + unit : ""}` : ""}${over ? `, over target, ${lapsDone === 1 ? "laps past 100%" : `${lapsDone} full laps past 100%`}` : ""}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={a11yLabel}>
      {breathe && (
        <div
          className="absolute -inset-3 rounded-full ring-breathe pointer-events-none"
          style={{ background: `radial-gradient(closest-side, color-mix(in srgb, ${color} 14%, transparent), transparent 74%)` }}
          aria-hidden="true"
        />
      )}
      <svg width={size} height={size} className="relative" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        {grad && (
          <defs>
            <linearGradient id={`rg${gid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={C.accent} />
              <stop offset="100%" stopColor={C.accentTail} />
            </linearGradient>
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={grad ? `url(#rg${gid})` : color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - lap1)} style={{ transition: "stroke-dashoffset .2s ease" }} />
        {over && (
          <>
            {/* surface-colored separator so lap 2's round cap never lands on
                lap 1's — 100.0% and 100.5% have to look different */}
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card)" strokeWidth={stroke}
              strokeLinecap="butt" strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(1, lap2 + gapFrac))} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={grad ? C.accentTail : color} strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - lap2)} style={{ transition: "stroke-dashoffset .2s ease" }} />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <div className={`mono stat-hero ${numClass} ${over ? "text-warn" : "text-foreground"}`}>{num}</div>
        {unit && <div className="text-[10px] font-bold text-muted-foreground">{unit}</div>}
      </div>
      {/* Lap counter — the only thing that can tell 200% from 1000% apart at a
          glance once both have a full ring plus a partial one. */}
      {lapsDone >= 2 && (
        <div aria-hidden="true"
          className="absolute bottom-0 right-0 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-warn/40 bg-warn/10 text-warn">
          ×{lapsDone}
        </div>
      )}
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
  // role="alert": announced immediately to screen readers the moment it
  // mounts, without the user needing to have focus anywhere near it — used
  // app-wide for failed saves, failed logs, failed generations, etc.
  <div role="alert" className="p-3 rounded-xl flex items-start gap-2.5 border border-destructive/40 bg-destructive/10">
    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
    <div className="min-w-0">
      <div className="text-xs font-bold text-destructive">{msg}</div>
      <div className="text-xs font-semibold mt-0.5 text-muted-foreground">
        {hint || "Try the action again — if it keeps failing, restart the app and retry."}
      </div>
    </div>
  </div>
);

// Empty-state block — icon, plain statement, and what unlocks it. The
// "Projections unlock with weigh-in data" voice, everywhere.
export const EmptyNote = ({ icon: Icon, title, hint, height }) => (
  <div className="flex flex-col items-center justify-center gap-2 text-center" style={height ? { height } : { padding: "18px 0" }}>
    {Icon && <Icon size={22} className="text-muted-foreground" aria-hidden="true" />}
    <div className="text-sm font-semibold text-foreground">{title}</div>
    {/* a11y contrast fix: this hint is the actual "what to do next" guidance
        (e.g. "Log your first weight above") — must clear AA, not faint-light. */}
    {hint && <div className="text-xs font-medium max-w-[260px] text-muted-foreground">{hint}</div>}
  </div>
);
