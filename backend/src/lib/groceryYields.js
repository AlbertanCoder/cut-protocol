// Seed yield factors - approximate, cooked/raw or cooked/dry weight ratios.
// Ported verbatim (CommonJS syntax only) from recomp-v2/src/data/yields.js.
// yieldFromRaw = cooked grams / raw grams for weight-losing proteins; for
// grains it's cooked grams / dry grams (grains are logged/portioned in
// cooked grams, purchased in dry grams, both through this same factor).
const YIELD_FROM_RAW = {
  "chicken breast": 0.71,
  "lean ground beef": 0.74,
  "white fish (cod)": 0.80,
  "salmon": 0.83,
  "white rice": 3.0, // cooked ÷ dry
  "quinoa": 2.75, // cooked ÷ dry
  "potato, baked": 0.79,
};

// Best-effort keyword match against an ingredient/recipe name. Returns null
// (not 1.0) when nothing matches, so callers can tell "no data" apart from
// "confirmed 1:1 yield" - never silently assume no weight change.
function lookupYieldFromRaw(name) {
  const n = (name || "").toLowerCase();
  for (const [key, factor] of Object.entries(YIELD_FROM_RAW)) {
    if (n.includes(key)) return factor;
  }
  return null;
}

module.exports = { YIELD_FROM_RAW, lookupYieldFromRaw };
