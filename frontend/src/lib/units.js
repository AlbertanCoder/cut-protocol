// UI stays imperial (matching v1) — canonical storage is SI (kg/cm) on the
// backend per the v2 plan, so conversion happens only at this boundary.
export const lb2kg = (lb) => lb / 2.20462;
export const kg2lb = (kg) => kg * 2.20462;
export const in2cm = (inch) => inch * 2.54;
export const cm2in = (cm) => cm / 2.54;
