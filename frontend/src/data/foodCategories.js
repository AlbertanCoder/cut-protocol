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

// Dot/badge colors. Neutral by law: the macro triad means macros ONLY and
// green is reserved (CLAUDE.md design constitution) — category wayfinding
// is carried by the labels, not by borrowed data colors.
export const CATEGORY_COLOR = () =>
  Object.fromEntries(FOOD_CATEGORIES.map((c) => [c.slug, C.faintLight]));

export const SOURCE_LABEL = {
  "usda": "USDA-VERIFIED",
  "manual": "LABEL / MANUAL",
  "manual-placeholder": "PLACEHOLDER — NO REAL DATA",
};
