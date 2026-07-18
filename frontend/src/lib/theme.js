// Single source of truth for color lives in index.css as CSS custom
// properties on :root (one mode: dark athletic). This module mirrors those
// into a plain object because recharts/inline-style consumers need literal
// values, not var() refs — the values are read live off the DOM, never
// hand-typed here, so hex codes exist in exactly one place.
const CSS_VAR = {
  paper: "--paper", card: "--card", card2: "--card-2", rule: "--rule",
  ink: "--ink", faint: "--faint", faintLight: "--faint-light",
  accent: "--accent", accentInk: "--accent-ink", accentBg: "--accent-bg",
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
    paper: "#0B0D0C", card: "#131715", card2: "#1A201C", rule: "#242B27",
    ink: "#EDF2EF", faint: "#9AABA1", faintLight: "#5F6E66",
    accent: "#2FD576", accentInk: "#05130B", accentBg: "#103322",
    protein: "#17A87A", carb: "#3F86DB", fat: "#D06F2B",
    proteinText: "#2FC793", carbText: "#74A9EE", fatText: "#EC9550",
    good: "#55C476", goodBg: "#112B1B", warn: "#E3AB42", warnBg: "#2E2310",
    red: "#EA6A62", redBg: "#331A18",
  };

export function getStampStyle() {
  return {
    wait: { color: C.faint, bg: "transparent" },
    good: { color: C.good, bg: C.goodBg },
    warn: { color: C.warn, bg: C.warnBg },
    bad: { color: C.red, bg: C.redBg },
  };
}
