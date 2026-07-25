import {
  Beef, Drumstick, Ham, Fish, Egg, EggFried, Sprout,
  Cookie, CakeSlice, CupSoda, Croissant, CookingPot, UtensilsCrossed,
} from "lucide-react";

// Pick a recognizable food icon for a recipe — the app's offline, private,
// zero-storage answer to "recipe images". No photos (no network, no uploads):
// the icon SHAPE carries the recognition (steak, chicken, fish, snack…), and it
// works for all recipes, seeded and imported alike.
//
// Ordered protein keyword → icon; first hit wins so the "main" animal protein is
// found before eggs/dairy or a plant side. Keywords mirror RecipesTab's
// PROTEIN_GROUPS display taxonomy — this is display-only, kept in sync by eye.
const PROTEIN_ICONS = [
  [["chicken", "turkey", "duck", "poultry", "quail", "hen"], Drumstick, "Chicken / poultry"],
  // Game (elk/bison/moose/venison) reads as red meat — common in Alberta.
  [["beef", "steak", "sirloin", "ribeye", "brisket", "mince", "veal", "lamb", "goat", "venison", "elk", "bison", "moose", "game"], Beef, "Beef / red meat"],
  [["pork", "bacon", "ham", "sausage", "chorizo", "prosciutto", "pancetta", "salami", "pepperoni"], Ham, "Pork"],
  [["salmon", "tuna", "cod", "fish", "shrimp", "prawn", "haddock", "sardine", "mackerel", "trout", "tilapia", "halibut", "basa", "snapper", "pollock", "bass", "squid", "seafood", "anchov"], Fish, "Fish & seafood"],
  [["egg", "cheese", "yogurt", "yoghurt", "paneer", "halloumi", "feta"], Egg, "Eggs & dairy"],
  [["tofu", "tempeh", "seitan", "lentil", "chickpea", "bean", "pea"], Sprout, "Plant protein"],
];

// A library recipe carries ingredient.food.name; a generated plan slot carries a
// bare ingredient.name. Read whichever is present so the icon works on both.
function ingredientNames(recipe) {
  return (recipe?.ingredients || [])
    .map((i) => (i.food?.name || i.name || "").toLowerCase())
    .join(" | ");
}

export function foodIconFor(recipe) {
  if (!recipe) return { Icon: UtensilsCrossed, label: "Dish" };

  // Meal-type specials win over protein: a dessert isn't its butter, a drink
  // isn't its milk. These clearly aren't "a protein dish", so short-circuit.
  switch (recipe.mealCategory) {
    case "dessert": return { Icon: CakeSlice, label: "Dessert" };
    case "beverage": return { Icon: CupSoda, label: "Drink" };
    case "bread_or_pastry_side": return { Icon: Croissant, label: "Bread / pastry" };
    case "condiment_or_sauce": return { Icon: CookingPot, label: "Sauce" };
    default: break;
  }
  if (recipe.slotType === "snack") return { Icon: Cookie, label: "Snack" };

  const names = ingredientNames(recipe);
  for (const [words, Icon, label] of PROTEIN_ICONS) {
    if (words.some((w) => names.includes(w))) return { Icon, label };
  }

  // A breakfast with no clear meat still reads as breakfast, not a generic dish.
  if (recipe.mealCategory === "breakfast_only") return { Icon: EggFried, label: "Breakfast" };
  return { Icon: UtensilsCrossed, label: "Dish" };
}
