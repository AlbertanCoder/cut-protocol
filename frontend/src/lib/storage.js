// Sidebar collapse preference — display-only local state; everything else
// the app remembers lives on the backend against the profile.
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

// Protein-priority / recomposition mode — a solver-generation FILTER (like
// cuisine/budget/prep, sent per-request in `filters`), not a Profile field:
// there's no schema column for it (see the track's schema-caveat note), so
// this is display-only local state, exactly like sidebarPref above. It seeds
// the PlanTab toggle's default so the choice survives a reload without
// needing a backend change.
const PROTEIN_PRIORITY_KEY = "shadcut:proteinPriority";

export const proteinPriorityPref = {
  get() {
    try {
      return window.localStorage.getItem(PROTEIN_PRIORITY_KEY) === "on";
    } catch {
      return false;
    }
  },
  set(on) {
    try {
      window.localStorage.setItem(PROTEIN_PRIORITY_KEY, on ? "on" : "off");
    } catch {
      // localStorage unavailable (e.g. private mode) — the toggle still
      // works for this session, it just won't persist across reloads.
    }
  },
};
