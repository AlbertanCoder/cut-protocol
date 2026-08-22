// Shared pieces for the simple surface.
//
// Everything here is presentation. No calculation, no API call, no storage.
// Colours come from the semantic Tailwind tokens defined in index.css — no
// literals, so scripts/no-hardcoded-colours.js stays green.
//
// House style for this surface, different from the full UI on purpose:
//   - one decision per screen
//   - big type, big targets (min 48px tall, comfortably above the 44pt floor)
//   - no eyebrow labels, no uppercase micro-caps, no section codes
//   - no percentages that were not measured, no rings, no macro rails

import { useId, useRef } from "react";
import { useFocusTrap } from "../lib/useFocusTrap.js";

// A full-bleed screen: one question or one job, vertically centred, capped so
// the line length stays readable on a wide desktop window.
export const Screen = ({ children }) => (
  <div className="min-h-svh flex flex-col items-center justify-center px-6 py-12 bg-background text-foreground">
    <div className="w-full max-w-xl">{children}</div>
  </div>
);

// The question itself. `hint` is the one line of plain-English help allowed
// per screen — if a screen needs two, the screen is doing too much.
export const Ask = ({ title, hint, children }) => (
  <div className="flex flex-col gap-8">
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight">{title}</h1>
      {hint && <p className="text-base text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
    {children}
  </div>
);

// Primary action. One per screen, always the same place.
export const Big = ({ children, onClick, disabled, type = "button" }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className="w-full min-h-14 px-6 rounded-2xl text-lg font-semibold bg-primary text-primary-foreground
               disabled:opacity-40 transition-opacity"
  >
    {children}
  </button>
);

// Secondary action — back, skip, "show me the details". Never competes.
export const Quiet = ({ children, onClick, type = "button" }) => (
  <button
    type={type}
    onClick={onClick}
    className="min-h-11 px-3 rounded-xl text-base text-muted-foreground hover:text-foreground transition-colors"
  >
    {children}
  </button>
);

// A pick-one row of large targets (sex, and the yes/no on the food screen).
export const Choice = ({ options, value, onChange }) => (
  <div className="grid grid-cols-2 gap-3">
    {options.map((o) => {
      const on = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={on}
          className={`min-h-16 px-4 rounded-2xl text-lg font-semibold border transition-colors ${
            on
              ? "bg-secondary border-foreground text-foreground"
              : "bg-card border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

// One big number box. `unit` renders as a suffix so the label never becomes a
// separate line of chrome.
//
// inputMode/type are deliberate: they pick the right phone keyboard and they
// match what the full UI already sends for the same fields.
// `onBlur` is a SEPARATE prop from `onEnter`, deliberately. Aliasing the two
// would make Next skip screens in the six questions (blurring to click Next
// would fire the advance twice) and would POST a weigh-in on click-away. Only
// Your details passes it, because only Your details claims to save as you go.
// `label` is the accessible name. When a call site doesn't pass one, a
// fallback is derived from `unit`/`placeholder` so no box ever announces as
// just "spin button, blank".
export const NumberBox = ({ value, onChange, unit, placeholder, autoFocus, onEnter, onBlur, label }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 min-h-20">
    <input
      type="number"
      inputMode="decimal"
      value={value}
      aria-label={label || (unit ? `Number in ${unit}` : placeholder || "Number")}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      className="flex-1 min-w-0 bg-transparent text-4xl font-bold tabular-nums outline-none
                 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
    />
    {unit && <span className="text-xl text-muted-foreground shrink-0">{unit}</span>}
  </div>
);

// Progress through the questions. Dots, not a percentage — a fabricated
// percentage is exactly what the constitution forbids, and "4 of 7" is more
// useful anyway.
export const Dots = ({ total, index }) => (
  <div className="flex items-center gap-2" role="presentation">
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className={`h-1.5 rounded-full transition-all ${
          i === index ? "w-6 bg-foreground" : i < index ? "w-1.5 bg-foreground/40" : "w-1.5 bg-border"
        }`}
      />
    ))}
    <span className="sr-only">{`Question ${index + 1} of ${total}`}</span>
  </div>
);

// Something went wrong, said plainly. Never red on anything to do with food or
// the body — that law holds on this surface too — so this is the calm amber.
export const Note = ({ children }) => (
  <div className="rounded-2xl border border-warn/40 bg-card px-5 py-4 text-base leading-relaxed text-warn">
    {children}
  </div>
);

// The escape hatch, present on every screen of the surface. The full app is
// never removed — it stops being the front door.
export const Details = ({ onClick, label = "Show me the details" }) => (
  <button
    type="button"
    onClick={onClick}
    className="min-h-11 text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
  >
    {label}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────
// ROOM VOCABULARY
//
// Everything above serves the six questions — one decision per screen. What
// follows serves the rooms (Plan, Recipes, Shopping, Your details), which are
// browsing surfaces rather than questions.
//
// RESPONSIVE, one component set. Standing rule 1 says desktop first and no
// phone-width centred columns; the simple surface is also going to be the
// mobile app. Both are satisfied by components that stack under `sm` and
// spread above it, rather than by two sets of screens.
//
// Still presentation only. No API calls, no calculations, no storage.
// ─────────────────────────────────────────────────────────────────────────

// A room. Content stays one readable column on a phone and gains room — not
// extra columns of chrome — on a desktop window.
export const Page = ({ title, sub, actions, children }) => (
  <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
    {(title || actions) && (
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="flex flex-col gap-2">
          {title && <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{title}</h1>}
          {sub && <p className="text-base text-muted-foreground">{sub}</p>}
        </div>
        {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
      </div>
    )}
    {children}
  </div>
);

// Sub-navigation inside a room (Plan / Recipes / Shopping). Selection is a
// weight-and-underline change, never a colour — the accent stays scarce.
//
// Real tab semantics, not just the roles: roving tabindex (only the active
// tab is in the Tab order) and Left/Right both moves focus and activates,
// because roles that announce "tab, 2 of 3" and then ignore arrow keys are
// worse than plain buttons.
export const Tabs = ({ tabs, active, onSelect }) => {
  const btnRefs = useRef([]);
  const activeIdx = Math.max(0, tabs.findIndex((t) => t.id === active));
  const onArrow = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = (activeIdx + step + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    btnRefs.current[next]?.focus();
  };
  return (
    // flex-wrap: a fourth room made the row clip on narrow columns and the
    // newest tab quietly scrolled out of sight — wrapping beats hiding.
    <div className="flex flex-wrap gap-1 border-b border-border overflow-x-auto" role="tablist">
      {tabs.map((t, i) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => { btnRefs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={i === activeIdx ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={onArrow}
            className={`min-h-12 px-4 text-base whitespace-nowrap border-b-2 -mb-px transition-colors ${
              on
                ? "font-semibold text-foreground border-foreground"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

// A plain surface. `tone="warn"` is the ONE alert treatment on this surface —
// calm amber, never red. Red is reserved for system errors and destructive
// confirms, and never appears on food or body data.
export const Panel = ({ tone, children, className = "" }) => (
  <div
    className={`rounded-2xl border px-5 py-4 ${
      tone === "warn" ? "border-warn/40 bg-card text-warn" : "border-border bg-card"
    } ${className}`}
  >
    {children}
  </div>
);

// One item in a list — a meal, a recipe, a food. `lead` is the name, `meta` the
// one supporting fact, `action` the single thing you can do to it from here.
export const Row = ({ label, lead, meta, action, onClick }) => {
  const body = (
    <>
      <div className="min-w-0 flex flex-col gap-0.5">
        {label && <div className="text-sm text-muted-foreground">{label}</div>}
        <div className="text-lg font-semibold leading-snug break-words">{lead}</div>
        {meta && <div className="text-base text-muted-foreground tabular-nums">{meta}</div>}
      </div>
      {action}
    </>
  );
  const cls =
    "w-full text-left rounded-2xl border border-border bg-card px-5 py-4 flex items-start justify-between gap-4 transition-colors";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:border-foreground`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

// The small button that sits at the right of a Row. Deliberately not `Big` —
// a row action must never outweigh the screen's own primary action.
//
// `disabled` is aria-disabled + an early return, NOT the native attribute:
// natively disabling the control someone just pressed drops keyboard focus
// to the top of the page. The button stays focusable, announces as dimmed,
// and simply does nothing while disabled.
export const RowAction = ({ children, onClick, disabled, label }) => (
  <button
    type="button"
    onClick={(e) => { if (disabled) return; onClick?.(e); }}
    aria-disabled={disabled || undefined}
    aria-label={label}
    className="shrink-0 min-h-12 min-w-12 px-4 rounded-2xl border border-border bg-background
               text-sm font-medium text-muted-foreground hover:text-foreground
               aria-disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
  >
    {children}
  </button>
);

// Free-text search. One per screen; the results are the screen.
export const Search = ({ value, onChange, placeholder, autoFocus }) => (
  <input
    type="search"
    value={value}
    autoFocus={autoFocus}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    className="w-full min-h-14 px-5 rounded-2xl border border-border bg-card text-base
               outline-none focus:border-foreground transition-colors"
  />
);

// A filter or a tag. Selection is a lightness step plus a border, never green.
export const Pill = ({ children, on, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    aria-label={label}
    className={`min-h-12 px-4 rounded-2xl text-base font-medium border transition-colors ${
      on
        ? "bg-secondary border-foreground text-foreground"
        : "bg-card border-border text-muted-foreground hover:text-foreground"
    }`}
  >
    {children}
  </button>
);

// A labelled number. Tabular figures, because these sit in columns and change.
export const Stat = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-2 border-b border-border last:border-b-0">
    <span className="text-base text-muted-foreground">{label}</span>
    <span className="text-base font-semibold tabular-nums">{value}</span>
  </div>
);

// Bottom sheet on a phone, centred dialog on a desktop. Same component.
//
// Focus containment comes from lib/useFocusTrap.js — the app's existing
// accessibility hook, already used by the full surface's dialogs — never a
// second implementation here. It also brings Escape-to-close and focus
// return to the trigger. `onClose` reaches the hook through a ref because
// useFocusTrap keys its effect on the handler's identity (see App.jsx's
// stable-identities note) and the rooms pass inline arrows.
//
// The backdrop dismiss is guarded on e.target === e.currentTarget because
// the panel is a child of the backdrop — unguarded, every click inside the
// sheet would close it.
export const Sheet = ({ title, sub, onClose, children }) => {
  const panelRef = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const stableClose = useRef(() => closeRef.current?.()).current;
  // Sheets only exist in the DOM while open (the rooms conditionally render
  // them), so `active` is always true here — same as BodyFatPicker.
  useFocusTrap(panelRef, { active: true, onClose: stableClose });
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-xl rounded-3xl border border-border bg-background p-6
                    flex flex-col gap-5 max-h-[85svh] overflow-y-auto"
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-2xl font-bold">{title}</h2>
          {sub && <p className="text-base text-muted-foreground">{sub}</p>}
        </div>
        {children}
        <Quiet onClick={onClose}>Never mind</Quiet>
      </div>
    </div>
  );
};

// Nothing here yet. Always names the next action — an empty state that only
// says "nothing here" is a dead end.
export const Empty = ({ children, action }) => (
  <div className="rounded-2xl border border-border bg-card px-5 py-6 flex flex-col gap-4">
    <p className="text-lg leading-relaxed">{children}</p>
    {action}
  </div>
);

// Waiting. Says what it is waiting for, because "Loading…" tells nobody
// anything and the solver can legitimately take seconds. role="status" so
// the wait is announced, not just painted.
export const Busy = ({ children }) => (
  <p role="status" className="text-lg text-muted-foreground">{children}</p>
);

// A weight line. Points come in already converted for display; this only maps
// them into a viewBox, which is screen geometry, not body data.
//
// NOT the Trend chart. TrendTab's ComposedChart carries a fitted regression, a
// standard-error band, a smoothed lean-mass overlay, outlier flags and a goal
// projection — all of it computed by protected memos in that file. Re-deriving
// any of that here would be a second implementation of a calculation, which
// rule 2 forbids. This draws the readings and nothing else.
//
// Stroked with `currentColor`, so it inherits the theme and needs no colour
// literal in either theme.
export const TrendLine = ({ points, unit, label }) => {
  if (!points || points.length < 2) return null;

  const PAD = 6;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const coords = points.map((p) => {
    const cx = PAD + ((p.x - minX) / spanX) * (100 - PAD * 2);
    // SVG y grows downward; a falling weight should read as a falling line.
    const cy = PAD + ((maxY - p.y) / spanY) * (40 - PAD * 2);
    return `${cx.toFixed(2)},${cy.toFixed(2)}`;
  });

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-5 flex flex-col gap-3">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="w-full h-32 text-foreground"
        role="img"
        aria-label={label || `Weight from ${first.w} to ${last.w} ${unit}.`}
      >
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
        <span>first · {first.dateLabel} — {first.w} {unit}</span>
        <span>latest · {last.dateLabel} — {last.w} {unit}</span>
      </div>
    </div>
  );
};
