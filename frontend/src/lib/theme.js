// Single source of truth for color lives in index.css as CSS custom
// properties (:root = light, .dark = dark). This module mirrors those into
// a plain object because recharts/inline-style consumers need literal
// values, not var() refs — but the values themselves are read live off the
// DOM, never hand-typed here, so there's exactly one place hex codes exist.
const KEYS = [
  "paper", "card", "ink", "faint", "faintLight", "rule",
  "accent", "accentBg",
  "protein", "carb", "fat",
  "good", "goodBg", "warn", "warnBg", "red", "redBg",
];

const CSS_VAR = {
  paper: "--paper", card: "--card", ink: "--ink", faint: "--faint",
  faintLight: "--faint-light", rule: "--rule",
  accent: "--accent", accentBg: "--accent-bg",
  protein: "--protein", carb: "--carb", fat: "--fat",
  good: "--good", goodBg: "--good-bg", warn: "--warn", warnBg: "--warn-bg",
  red: "--red", redBg: "--red-bg",
};

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const out = {};
  for (const key of KEYS) {
    out[key] = styles.getPropertyValue(CSS_VAR[key]).trim();
  }
  return out;
}

// Mutated in place by applyTheme() so every existing `import { C }` consumer
// picks up new values without needing to re-import anything.
export const C = typeof document !== "undefined"
  ? readPalette()
  : {
    // SSR/non-DOM fallback (not expected at runtime for this app, but keeps
    // the module import-safe outside a browser) — mirrors :root above.
    paper: "#F6F7F5", card: "#FFFFFF", ink: "#16211C", faint: "#5C6B62",
    faintLight: "#93A79C", rule: "#E4E7E2", accent: "#0E7C5C",
    accentBg: "#DCEFE7", protein: "#12805F", carb: "#2E6FA8", fat: "#BC5B3A",
    good: "#3F8F4F", goodBg: "#E4F2E6", warn: "#C7891F", warnBg: "#F5E9D3",
    red: "#C33B3B", redBg: "#F6E1DF",
  };

export function applyTheme(mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  Object.assign(C, readPalette());
}

// Was a frozen module-level const; now built fresh from the live C each call
// so it re-themes on toggle instead of sticking to whichever theme loaded
// first. Call at render time, not module scope.
export function getStampStyle() {
  return {
    wait: { color: C.faint, bg: "transparent" },
    good: { color: C.good, bg: C.goodBg },
    warn: { color: C.warn, bg: C.warnBg },
    bad: { color: C.red, bg: C.redBg },
  };
}
