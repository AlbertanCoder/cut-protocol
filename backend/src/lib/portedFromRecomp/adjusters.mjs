// Curated adjuster ("simple side") library (RECIPE_ENGINE_BRIEF.md S1,
// SOLVER_SPEC_v2.md S2). Deliberately small and hand-picked - not seeded
// from TheMealDB, per the brief's own description: "0-2 curated adjusters
// - simple sides from a curated list (plain rice/potato, lean protein like
// chicken breast or Greek-style skyr, a fat source like olive oil/nuts,
// fruit)". perGram values are real USDA FDC per-100g figures (divided by
// 100), fetched live 2026-07-12 - not fabricated. Picked the more standard/
// common variant where FDC search returned multiple candidates (e.g.
// medium-grain white rice over glutinous, salted baked potato as the
// common default).
//
// minG/maxG/stepG are palatability caps (SOLVER_SPEC_v2 S5.4/S1.5 "humans
// eat food, not numbers"), not FDC data - disclosed judgment calls, same
// spirit as this codebase's other realistic-portion ceilings
// (src/engine/solver.js's CATEGORY_CEILING_G).
export const ADJUSTERS = [
  {
    id: "white-rice-cooked",
    name: "White rice, cooked",
    state: "cooked",
    yieldFromRaw: 3.0, // matches src/data/yields.js "white rice" (cooked ÷ dry)
    fdcId: 168930,
    perGram: { kcal: 130 / 100, p: 2.38 / 100, f: 0.21 / 100, c: 28.6 / 100 },
    role: "carb",
    minG: 30, maxG: 300, stepG: 10, unitHint: "g cooked",
  },
  {
    id: "potato-baked",
    name: "Potato, baked",
    state: "cooked",
    yieldFromRaw: 0.79, // matches src/data/yields.js "potato, baked"
    fdcId: 170111,
    perGram: { kcal: 93 / 100, p: 2.5 / 100, f: 0.13 / 100, c: 21.2 / 100 },
    role: "carb",
    minG: 30, maxG: 300, stepG: 10, unitHint: "g",
  },
  {
    id: "chicken-breast-cooked",
    name: "Chicken breast, cooked, skinless",
    state: "cooked",
    yieldFromRaw: 0.71, // matches src/data/yields.js "chicken breast"
    fdcId: 171477,
    perGram: { kcal: 165 / 100, p: 31 / 100, f: 3.57 / 100, c: 0 },
    role: "protein",
    minG: 30, maxG: 250, stepG: 10, unitHint: "g cooked",
  },
  {
    id: "greek-yogurt-nonfat",
    name: "Greek yogurt, plain, nonfat (skyr-style)",
    state: "raw",
    yieldFromRaw: null,
    fdcId: 330137,
    perGram: { kcal: 61 / 100, p: 10.3 / 100, f: 0.37 / 100, c: 3.64 / 100 },
    role: "protein",
    minG: 30, maxG: 300, stepG: 10, unitHint: "g",
  },
  {
    id: "olive-oil",
    name: "Olive oil",
    state: "raw",
    yieldFromRaw: null,
    fdcId: 171413,
    perGram: { kcal: 884 / 100, p: 0, f: 100 / 100, c: 0 },
    role: "fat",
    minG: 3, maxG: 30, stepG: 1, unitHint: "g (~1 tsp = 4.5g)",
  },
  {
    id: "almonds",
    name: "Almonds",
    state: "raw",
    yieldFromRaw: null,
    fdcId: 170567,
    perGram: { kcal: 579 / 100, p: 21.2 / 100, f: 49.9 / 100, c: 21.6 / 100 },
    role: "fat",
    minG: 5, maxG: 60, stepG: 5, unitHint: "g",
  },
  {
    id: "banana",
    name: "Banana",
    state: "raw",
    yieldFromRaw: null,
    fdcId: 173944,
    perGram: { kcal: 89 / 100, p: 1.09 / 100, f: 0.33 / 100, c: 22.8 / 100 },
    role: "carb",
    minG: 50, maxG: 200, stepG: 10, unitHint: "g (~1 medium = 118g)",
  },
  {
    id: "blueberries",
    name: "Blueberries",
    state: "raw",
    yieldFromRaw: null,
    fdcId: 171711,
    perGram: { kcal: 57 / 100, p: 0.74 / 100, f: 0.33 / 100, c: 14.5 / 100 },
    role: "mixed",
    minG: 30, maxG: 200, stepG: 10, unitHint: "g",
  },
];
