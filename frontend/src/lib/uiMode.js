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
// Default: "full". Nobody who already uses this app gets moved to a different
// surface by installing this — the simple surface is opt-in, and the full UI
// keeps working exactly as it did.

const KEY = "shadcut:uiMode";
const EVENT = "shadcut:uimode-changed";

const VALID = new Set(["simple", "full"]);

export const uiMode = {
  get() {
    try {
      const v = window.localStorage.getItem(KEY);
      return VALID.has(v) ? v : "full";
    } catch {
      // Private mode / storage disabled — fall back to the surface that has
      // always existed rather than to the new one.
      return "full";
    }
  },
  set(mode) {
    const next = VALID.has(mode) ? mode : "full";
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
