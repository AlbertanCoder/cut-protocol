// Example/demo data for the admin-gated personal views (fridge inventory,
// dinner rotation, supplement schedule, milestone targets). Illustrative
// content only — a real multi-user product would source this per-profile
// rather than hardcode it globally.

export const FLOOR = 1800;
export const RX = 2000;
export const FORK_DATE = "2026-10-10";
export const GOAL_WINDOW = "early Nov 2026 – early Dec 2026";
export const MILESTONES = [210, 200, 190];
export const MAINT_ZONE_LOW = 183;
export const MAINT_ZONE_HIGH = 186;
export const MAINT_KCAL = 2200;
export const JOB = { desk: 1.2, light: 1.28, mixed: 1.35, heavy: 1.5 };
export const JOB_LABEL = {
  desk: "Desk", light: "Light / on feet",
  mixed: "Mixed physical (trades / warehouse)", heavy: "Heavy labour",
};

export const FRIDGE = [
  { id: "chicken", name: "Chicken breast", portion: "200 g", rule: "Go-to lean protein" },
  { id: "turkeyslices", name: "Turkey slices", portion: "4–6", rule: "Lunch or dinner protein" },
  { id: "groundbeef", name: "Extra-lean ground beef", portion: "250 g raw", rule: "Dinner main" },
  { id: "salmon", name: "Salmon fillets", portion: "2 max", rule: "No added fat that night" },
  { id: "patties", name: "Beef patties (18 g fat ea.)", portion: "ONE max, 2 nights/wk", rule: "Pair with a starch · no butter or nuts that day" },
  { id: "rice", name: "Pre-cooked rice cups", portion: "1 cup", rule: "Dinner starch slot" },
  { id: "bacon", name: "Turkey bacon", portion: "2 slices", rule: "Weekend garnish only" },
  { id: "jerky", name: "Beef jerky", portion: "30 g", rule: "Snack slot" },
  { id: "cottage", name: "Cottage cheese", portion: "150 g", rule: "Protein-dense snack" },
  { id: "almonds", name: "Almonds", portion: "30 g weighed", rule: "Weighed. Not eyeballed." },
  { id: "popcorn", name: "Air-popped popcorn", portion: "25 g", rule: "Weekends" },
];

export const EXCLUDED = [
  "Shrimp dumplings — shellfish allergy example. Excluded.",
  "Trail mix — peanut cross-contamination example. Excluded.",
];

export const ROTATION = [
  { main: "Sirloin steak", amt: "250 g", butter: "+10 g butter", note: "" },
  { main: "Skinless chicken thighs", amt: "300 g", butter: "+8 g butter", note: "" },
  { main: "Extra-lean ground turkey", amt: "250 g", butter: "+10 g butter", note: "" },
  { main: "Salmon", amt: "230 g", butter: "NO butter", note: "Runs ~10P light — fine" },
  { main: "Veggie chili", amt: "2 servings", butter: "—", note: "+ rice" },
];

export const BATCH = [
  "1.5 kg chicken → 5 lunch boxes",
  "750 g dry rice → 10 portions",
  "Bake 4 sweet potatoes",
  "Chop peppers / cucumbers / greens",
  "Boil 12 eggs",
];

export const SUPPS = [
  { t: "Morning", s: "Multivitamin · Vitamin C" },
  { t: "Midday", s: "Omega-3 · Vitamin D" },
  { t: "Evening", s: "Zinc + copper" },
  { t: "Bed", s: "Magnesium" },
];

export const SUPP_RULES = [
  "Multivitamin and zinc ~8 h apart",
  "Fat-solubles taken with a meal that has fat in it",
  "Example rules — shows the app's constraint-rule display",
];

export const CHILI = {
  ing: "1 lb ground turkey · yellow onion · 3 garlic cloves · 1 bell pepper · black beans · diced tomatoes · 2 tbsp tomato paste · 1 tbsp chili powder · 1 tsp cumin · 1 tsp smoked paprika · salt to taste · lime · cilantro",
  steps: "Brown turkey → aromatics → toast spices → tomatoes/beans → simmer low & slow → lime + cilantro. 6 servings, ~40 min.",
};
