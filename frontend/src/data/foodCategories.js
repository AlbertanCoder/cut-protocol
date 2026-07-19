import { C } from "../lib/theme.js";

// Grocery-store food categories — client mirror of
// backend/src/lib/foodCategories.js (slugs and labels must stay in sync;
// the backend side is pinned by tests). Order = display order.
export const FOOD_CATEGORIES = [
  { slug: "protein", label: "Protein" },
  { slug: "dairy-eggs", label: "Dairy & Eggs" },
  { slug: "fruit-veg", label: "Fruit & Veg" },
  { slug: "grains", label: "Grains & Carbs" },
  { slug: "fats-nuts-oils", label: "Fats, Nuts & Oils" },
  { slug: "pantry", label: "Pantry, Spices & Sauces" },
  { slug: "drinks", label: "Drinks" },
];

export const CATEGORY_LABEL = Object.fromEntries(FOOD_CATEGORIES.map((c) => [c.slug, c.label]));

// Category dots — NEUTRAL by law: the macro triad means macros ONLY and green
// is reserved (CLAUDE.md design constitution), so a category dot can borrow
// neither. Wayfinding is carried by a quiet LIGHTNESS ramp of the single
// off-white ink (the app's "elevation is lightness" language), brightest at
// the top of the shopping order down to the dimmest — never a hue. The label
// still carries the exact meaning; the tier is an ordering cue. color-mix on
// var(--ink) keeps this to one token (no new color literal), matching the
// color-mix pattern already used in ui/Parts.jsx.
const CATEGORY_TIER = {
  protein: 82, "dairy-eggs": 70, "fruit-veg": 60, grains: 50,
  "fats-nuts-oils": 42, pantry: 34, drinks: 27,
};
export const CATEGORY_DOT = (slug) =>
  `color-mix(in srgb, ${C.ink} ${CATEGORY_TIER[slug] ?? 38}%, transparent)`;

export const SOURCE_LABEL = {
  "usda": "USDA-VERIFIED",
  "manual": "LABEL / MANUAL",
  "manual-placeholder": "PLACEHOLDER — NO REAL DATA",
};
