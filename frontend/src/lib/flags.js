// Feature flags — one place, hand-toggled.
//
// TRAINING controls the Phase 8 training scaffold:
//   "on"     → Training appears in the sidebar and the tab works
//   "soon"   → Training appears greyed out with a SOON chip (not clickable)
//   "hidden" → no trace in the nav
// Flip the string and the UI follows; nothing else needs touching.
export const TRAINING = "on";

// WELLBEING controls the Wellbeing tab (ED self-check + micronutrient detail
// + Alberta/Canada support resources):
//   "on"     → the tab appears below Trend and works
//   "hidden" → no tab; the sidebar's Wellbeing button and the Profile tab's
//              "Outside help" card still carry the support resources, so
//              hiding the tab never hides the phone numbers.
// No "soon" state here on purpose — a greyed-out, unclickable wellbeing item
// would be the one place in the app where a user in trouble is shown a door
// they cannot open.
export const WELLBEING = "on";
