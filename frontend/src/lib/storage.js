import { todayStr } from "./dates.js";

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

// Micronutrient detail — collapsed by default. The full breakdown is 47 rows,
// and while the food library's micronutrient coverage is thin most of them read
// "no data logged today", so opening it by default buries the Wellbeing tab
// under noise. The summary line stays visible when collapsed, so the honest
// coverage number is never hidden — only the row-by-row detail is. Display-only
// local state, same as the two prefs above.
const MICROS_EXPANDED_KEY = "shadcut:microsExpanded";

export const microsExpandedPref = {
  get() {
    try {
      return window.localStorage.getItem(MICROS_EXPANDED_KEY) === "open";
    } catch {
      return false;
    }
  },
  set(open) {
    try {
      window.localStorage.setItem(MICROS_EXPANDED_KEY, open ? "open" : "collapsed");
    } catch {
      // localStorage unavailable — the toggle still works for this session.
    }
  },
};

// ── Wellbeing screening result (SCOFF) ───────────────────────────────────
//
// DELIBERATELY LOCAL-ONLY. This is a mental-health screening result: the most
// sensitive thing this app can hold. It is stored in this browser profile's
// localStorage and NEVER sent to the backend — there is no column for it, no
// route that accepts it, and there should not be. Reasons, in order:
//
//   1. The backend DB ships inside the installer today (see CLAUDE.md's
//      packaging caveat). A persisted ED screen would ride along with it.
//   2. Nothing downstream needs it server-side. Its only job is to decide
//      whether THIS screen leads with 47 nutrient numbers or with support —
//      a rendering decision, made in the renderer.
//   3. It must be trivially destroyable by the user. `clear()` is wired to a
//      one-click "Delete my result" button on the Wellbeing tab; a backend
//      record would need an endpoint, a migration, and trust.
//
// Shape: { score: 0..5, positive: boolean, takenOn: "yyyy-mm-dd",
//          showDetailAnyway: boolean }. `showDetailAnyway` is the user's
// standing "I want to see the numbers regardless" override — it lives in the
// same record so clearing the result clears the override with it.
//
// takenOn is a LOCAL calendar date via dates.js#todayStr, not an ISO
// timestamp. An ISO string is UTC, and telling someone in Edmonton that they
// took the check "tomorrow" because it is past 6pm is the same off-by-one-day
// class of bug dates.js exists to stamp out.
const WELLBEING_SCREEN_KEY = "shadcut:wellbeingScreen";

function readScreen() {
  try {
    const raw = window.localStorage.getItem(WELLBEING_SCREEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || typeof v.score !== "number") return null;
    return {
      score: v.score,
      positive: v.positive === true,
      takenOn: typeof v.takenOn === "string" ? v.takenOn : null,
      showDetailAnyway: v.showDetailAnyway === true,
    };
  } catch {
    // Unreadable or corrupt — treat as "never screened" rather than throwing.
    return null;
  }
}

function writeScreen(next) {
  try {
    window.localStorage.setItem(WELLBEING_SCREEN_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — the result still applies for this session.
  }
  return next;
}

export const wellbeingScreenPref = {
  /** null = never screened. */
  get: readScreen,
  /** Record a completed screen. Overwrites any previous result. */
  set({ score, positive }) {
    return writeScreen({
      score,
      positive: positive === true,
      takenOn: todayStr(),
      showDetailAnyway: false,
    });
  },
  /** The "show me the numbers anyway" escape hatch, remembered so the user
   *  is never made to re-argue for it on every visit. */
  setShowDetailAnyway(on) {
    const cur = readScreen();
    if (!cur) return null;
    return writeScreen({ ...cur, showDetailAnyway: on === true });
  },
  /** One-click delete. Nothing about the result survives this. */
  clear() {
    try {
      window.localStorage.removeItem(WELLBEING_SCREEN_KEY);
    } catch {
      // Nothing to do — there was nothing readable to clear either.
    }
    return null;
  },
};
