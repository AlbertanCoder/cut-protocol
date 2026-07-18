// Best-effort gram -> common kitchen-measure display, purely for grocery-list
// readability (e.g. "940g (≈4 cups)"). Keyword-matched against the ingredient
// name, same spirit as the backend's groceryYields.js/groceryPrices.js -
// returns null (never a guess) when nothing matches or the amount is too
// small to read as a sane cup measure. This is a display-only convenience;
// the real purchase quantity is always the gram figure it's shown alongside.
const GRAMS_PER_CUP = [
  ["white rice", 185], ["brown rice", 195], ["rice", 185],
  ["quinoa", 170], ["oats", 90], ["oatmeal", 90],
  ["flour", 120], ["sugar", 200], ["cornmeal", 155],
  ["butter", 227], ["milk", 240], ["cream", 240],
  ["yogurt", 245], ["yoghurt", 245], ["water", 240], ["broth", 240], ["stock", 240],
  ["almonds", 143], ["walnuts", 100], ["cashews", 137], ["peanuts", 146],
  ["berries", 145], ["blueberries", 148], ["strawberries", 152],
  ["black beans", 172], ["beans", 170], ["lentils", 198], ["chickpeas", 164],
  ["cheese", 113], ["breadcrumb", 108],
];

function matchGramsPerCup(name) {
  const n = (name || "").toLowerCase();
  for (const [kw, g] of GRAMS_PER_CUP) {
    if (n.includes(kw)) return g;
  }
  return null;
}

// Rounds to the nearest quarter-cup - a kitchen measuring cup doesn't have
// finer markings than that, so more precision would be false confidence.
function fmtFraction(n) {
  const rounded = Math.round(n * 4) / 4;
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  const fracStr = frac === 0.25 ? "¼" : frac === 0.5 ? "½" : frac === 0.75 ? "¾" : "";
  if (whole === 0) return fracStr || "0";
  return `${whole}${fracStr}`;
}

export function toHouseholdUnit(name, grams) {
  const gramsPerCup = matchGramsPerCup(name);
  if (!gramsPerCup || !Number.isFinite(grams) || grams <= 0) return null;
  const cups = grams / gramsPerCup;
  if (cups < 0.2) return null; // too little to read as a meaningful cup measure
  return `${fmtFraction(cups)} cup${cups >= 1.125 ? "s" : ""}`;
}
