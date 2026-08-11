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
export const NumberBox = ({ value, onChange, unit, placeholder, autoFocus, onEnter }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 min-h-20">
    <input
      type="number"
      inputMode="decimal"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
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
