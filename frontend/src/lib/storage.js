// Local-only UI dismissal state (milestone acks, fridge burn-down
// checklist) — non-critical, doesn't need cross-device sync, so it stays
// in localStorage rather than round-tripping through the backend.
const KEY = "shadcut:ui";

function read() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY)) || { acks: {}, fridgeDone: {} };
  } catch {
    return { acks: {}, fridgeDone: {} };
  }
}

function write(state) {
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export const uiState = {
  get: read,
  setAck(key, value) {
    const s = read();
    s.acks[key] = value;
    write(s);
    return s;
  },
  setFridgeDone(id, value) {
    const s = read();
    s.fridgeDone[id] = value;
    write(s);
    return s;
  },
};

// Display preference only (light/dark) — same local-only rationale as
// uiState above, kept as a separate key since it's unrelated data.
const THEME_KEY = "shadcut:theme";

export const themePref = {
  get() {
    try {
      const v = window.localStorage.getItem(THEME_KEY);
      return v === "light" || v === "dark" ? v : "dark";
    } catch {
      return "dark";
    }
  },
  set(mode) {
    window.localStorage.setItem(THEME_KEY, mode);
  },
};
