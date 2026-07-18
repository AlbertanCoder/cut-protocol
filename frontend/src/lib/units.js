// Canonical storage is SI (kg/cm) on the backend; conversion happens only at
// this boundary. Phase 3: the display unit follows profile.unitPref
// ("imperial" | "metric") everywhere via the pref-aware helpers below.
export const lb2kg = (lb) => lb / 2.20462;
export const kg2lb = (kg) => kg * 2.20462;
export const in2cm = (inch) => inch * 2.54;
export const cm2in = (cm) => cm / 2.54;

const r1 = (n) => Math.round(n * 10) / 10;

export const weightUnit = (pref) => (pref === "metric" ? "kg" : "lb");
export const heightUnit = (pref) => (pref === "metric" ? "cm" : "in");
export const rateUnit = (pref) => (pref === "metric" ? "kg/wk" : "lb/wk");

// kg (storage) → display number in the user's unit
export const displayWeight = (kg, pref) => (kg == null ? null : r1(pref === "metric" ? kg : kg2lb(kg)));
// display number in the user's unit → kg (storage)
export const parseWeight = (val, pref) => (pref === "metric" ? val : lb2kg(val));

export const displayHeight = (cm, pref) => (cm == null ? null : r1(pref === "metric" ? cm : cm2in(cm)));
export const parseHeight = (val, pref) => (pref === "metric" ? val : in2cm(val));

// rate is stored in lb/wk (the option menu's native unit)
export const displayRate = (lbPerWk, pref) => (lbPerWk == null ? null : r1(pref === "metric" ? lbPerWk * 0.453592 : lbPerWk));

// sane weigh-in bounds in the DISPLAY unit (mirrors the backend's 35–300 kg).
// Imperial min is 78, not 77: 77 lb = 34.9 kg, which the backend's <35 kg
// guard rejects — the stated minimum must actually be accepted (Stage-C #29).
export const weightInputBounds = (pref) => (pref === "metric" ? { min: 35, max: 300 } : { min: 78, max: 660 });
