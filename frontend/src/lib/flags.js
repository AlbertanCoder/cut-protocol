// Feature flags — one place, hand-toggled.
//
// TRAINING controls the Phase 8 training scaffold:
//   "on"     → Training appears in the sidebar and the tab works
//   "soon"   → Training appears greyed out with a SOON chip (not clickable)
//   "hidden" → no trace in the nav
// Flip the string and the UI follows; nothing else needs touching.
export const TRAINING = "on";
