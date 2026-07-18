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

// Sidebar collapse preference — display-only, same local-only rationale.
const SIDEBAR_KEY = "shadcut:sidebar";

export const sidebarPref = {
  get() {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  },
  set(collapsed) {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open");
  },
};
