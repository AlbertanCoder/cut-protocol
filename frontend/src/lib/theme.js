// Single source of truth for color lives in index.css as CSS custom
// properties on :root (one mode: AURORA RINGLIGHT dark). This module mirrors
// those into a plain object because recharts/inline-style consumers need
// literal values, not var() refs — the values are read live off the DOM,
// never hand-typed here, so color literals exist in exactly one place.
const CSS_VAR = {
  paper: "--paper", card: "--card", card2: "--card-2", cardGlass: "--card-glass", rule: "--rule",
  ink: "--ink", faint: "--faint", faintLight: "--faint-light",
  accent: "--accent", accentTail: "--accent-tail", accentInk: "--accent-ink", accentBg: "--accent-bg",
  protein: "--protein", carb: "--carb", fat: "--fat",
  proteinText: "--protein-text", carbText: "--carb-text", fatText: "--fat-text",
  good: "--good", goodBg: "--good-bg", warn: "--warn", warnBg: "--warn-bg",
  red: "--red", redBg: "--red-bg",
};

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const out = {};
  for (const [key, cssVar] of Object.entries(CSS_VAR)) {
    out[key] = styles.getPropertyValue(cssVar).trim();
  }
  return out;
}

export const C = typeof document !== "undefined"
  ? readPalette()
  : {
    // SSR/non-DOM fallback (not expected at runtime for this app, but keeps
    // the module import-safe outside a browser) — mirrors :root above.
    paper: "#0B0D0C", card: "#161A18", card2: "#1D2320", cardGlass: "rgba(22, 26, 24, 0.82)", rule: "rgba(255, 255, 255, 0.06)",
    ink: "rgba(237, 242, 239, 0.87)", faint: "rgba(237, 242, 239, 0.60)", faintLight: "rgba(237, 242, 239, 0.38)",
    accent: "#2FD576", accentTail: "#7EFFB2", accentInk: "#05130B", accentBg: "#103322",
    protein: "#56B4E9", carb: "#E69F00", fat: "#CC79A7",
    proteinText: "#7CC5EE", carbText: "#F0B23E", fatText: "#DC96BB",
    good: "#2FD576", goodBg: "#103322", warn: "#E5A83B", warnBg: "#2E2310",
    red: "#EA6A62", redBg: "#331A18",
  };

// Verdict palette. Law b: verdicts describe food/body data, so the worst
// tone is calm amber, never red — over target is a re-plan, not a judgment.
export function getStampStyle() {
  return {
    wait: { color: C.faint, bg: "transparent" },
    good: { color: C.good, bg: C.goodBg },
    warn: { color: C.warn, bg: C.warnBg },
    bad: { color: C.warn, bg: C.warnBg },
  };
}
