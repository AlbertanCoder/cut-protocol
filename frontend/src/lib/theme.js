// Validated against dataviz's palette checker (categorical CVD/contrast
// checks all pass for protein/carb/fat as a set) — see the design-preview
// artifact this was approved from. Mirrors the CSS custom properties in
// index.css; kept as a JS object too since recharts/inline-style consumers
// need literal values, not var() refs.
export const C = {
  paper: "#F6F7F5", // page background
  card: "#FFFFFF", // card surface
  ink: "#16211C",
  faint: "#5C6B62",
  faintLight: "#93A79C",
  rule: "#E4E7E2", // borders/dividers

  accent: "#0E7C5C",
  accentBg: "#DCEFE7",

  protein: "#12805F",
  carb: "#2E6FA8",
  fat: "#BC5B3A",

  good: "#3F8F4F",
  goodBg: "#E4F2E6",
  warn: "#C7891F",
  warnBg: "#F5E9D3",
  red: "#C33B3B",
  redBg: "#F6E1DF",
};

export const STAMP_STYLE = {
  wait: { color: C.faint, bg: "transparent" },
  good: { color: C.good, bg: C.goodBg },
  warn: { color: C.warn, bg: C.warnBg },
  bad: { color: C.red, bg: C.redBg },
};
