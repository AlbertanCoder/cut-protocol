// Which surface the app opens in — the simple one, or the full one.
//
// WHY THIS FILE EXISTS AND NOT A FLAG IN flags.js: `lib/flags.js` is on
// DO-NOT-TOUCH.md's never-modify list (line 91). This is the same idea in a
// new file rather than an edit to a protected one.
//
// It is also NOT a build-time flag like TRAINING/WELLBEING. Those are
// hand-toggled by a developer and ship in one state. This is a per-person
// preference the user flips at runtime with "Show me the details", so it needs
// storage and a way to re-render when it changes.
//
// Storage: a NEW key. Nothing existing is renamed or reshaped. The prefix
// matches the convention already used in lib/storage.js ("shadcut:").
//
// Default: "simple" — the OWNER'S CALL, 2026-08-22 ("this is the new one
// from now on; work on ONLY this"). The simple surface is the product; the
// full app remains reachable ("Open the full app" / `?simple=0`) as the
// power escape hatch, never deleted. Anyone who explicitly chose a surface
// keeps their choice — localStorage still wins over this default.

const KEY = "shadcut:uiMode";
const EVENT = "shadcut:uimode-changed";

const VALID = new Set(["simple", "full"]);

export const uiMode = {
  get() {
    try {
      const v = window.localStorage.getItem(KEY);
      return VALID.has(v) ? v : "simple";
    } catch {
      // Private mode / storage disabled — fall back to the product surface.
      return "simple";
    }
  },
  set(mode) {
    const next = VALID.has(mode) ? mode : "simple";
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Can't persist it; still fire the event so the current session honours
      // the choice. It just won't survive a reload.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
    return next;
  },
};

// ── URL switch ───────────────────────────────────────────────────────────
// `?simple=1` opens the simple surface, `?simple=0` the full one, so neither
// needs a console. Same one-shot pattern the app already uses for `?upgraded=1`
// and `?penny=1` (App.jsx:65-70, 108-114): read it, act on it, then strip it
// from the address bar so a reload doesn't re-force a choice the user has since
// changed with the in-app link.
//
// The choice still persists — this writes through `set`, so it lands in
// localStorage exactly as clicking would. The param is a way in, not a mode.
//
// Runs at MODULE LOAD, deliberately, and not in a useState initializer like
// App.jsx's version: React StrictMode double-invokes those in development, and
// `history.replaceState` is a side effect that should happen once. Module load
// also guarantees the value is settled before any component reads it.
function consumeUrlOverride() {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("simple")) return;
    const raw = params.get("simple");
    // Anything but an explicit off means on — `?simple` alone should work.
    const next = raw === "0" || raw === "false" ? "full" : "simple";
    params.delete("simple");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    uiMode.set(next);
  } catch {
    // A malformed URL must never stop the app booting.
  }
}

consumeUrlOverride();

// Subscribe to changes. Returns an unsubscribe function.
//
// Listens for `storage` too, so flipping the mode in one tab moves the other
// tab with it — the desktop shell is one window, but the dev server is not.
export function onUiModeChange(handler) {
  const local = (e) => handler(e.detail);
  const cross = (e) => { if (e.key === KEY) handler(uiMode.get()); };
  window.addEventListener(EVENT, local);
  window.addEventListener("storage", cross);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener("storage", cross);
  };
}
