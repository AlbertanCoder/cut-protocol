// Authored recipe DRAFTS for review (Shad's taste: North American + Mexican/Latin,
// chicken/beef/eggs/dairy, ~15 quick + ~5 batch-cook). This script RESOLVES each
// ingredient to a real, clean food row, computes per-serving cached macros, runs
// the recipe validator, and prints a review table. It DOES NOT write to the DB —
// Shad reviews first, then a separate seed step inserts the approved set.
//
//   run:  node scripts/qc/authorRecipes.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { validateRecipe, computeRecipeMacros } = require("../../src/lib/foodValidation.js");
const prisma = new PrismaClient();

// grams are of the FOOD AS THE DB ROW DESCRIBES IT (cooked where the row says
// cooked). scalable:false = fixed aromatic/spice, not scaled with the serving.
const P = (food, g) => ({ food, g, role: "protein" });      // protein anchor
const C = (food, g) => ({ food, g, role: "carb" });         // carb anchor
const V = (food, g) => ({ food, g, role: "veg" });          // veg
const Fat = (food, g) => ({ food, g, role: "fat" });        // added fat
const S = (food, g) => ({ food, g, role: null, fixed: true }); // spice/aromatic, fixed

const RECIPES = [
  // ─────────────── NORTH AMERICAN — quick ───────────────
  { name: "Garlic Chicken & Rice", cuisine: "american", effort: "quick", prep: 20, slot: "meal",
    steps: ["Season sliced chicken breast with salt and pepper.", "Sear in olive oil over medium-high, 5–6 min, until browned.", "Add minced garlic for the last 30 sec.", "Serve over hot white rice, spooning the garlic oil over the top."],
    ing: [P("Chicken breast, cooked, skinless", 180), C("White rice, cooked", 200), Fat("Extra Virgin Olive Oil", 8), S("Garlic", 10), S("Salt", 2), S("Black Pepper", 1)] },

  { name: "Sheet-Pan Paprika Chicken & Peppers", cuisine: "american", effort: "quick", prep: 25, slot: "meal",
    steps: ["Toss chicken thigh, sliced peppers and onion with olive oil, paprika, salt and pepper.", "Spread on a sheet pan.", "Roast at 220°C / 425°F for 20 min, turning once, until the edges char."],
    ing: [P("Chicken thigh, cooked, skinless", 190), V("Bell peppers", 150), V("Onion", 80), Fat("Extra Virgin Olive Oil", 8), S("Paprika", 3), S("Salt", 2), S("Black Pepper", 1)] },

  { name: "Steak & Sweet Potato Plate", cuisine: "american", effort: "quick", prep: 25, slot: "meal",
    steps: ["Roast cubed sweet potato in olive oil at 220°C / 425°F, 20 min.", "Meanwhile sear the sirloin 3–4 min a side to medium-rare; rest 5 min.", "Rub the rested steak with a little garlic; slice against the grain."],
    ing: [P("Sirloin steak, cooked, lean", 170), C("Sweet potatoes, orange flesh, without skin, raw", 240), Fat("Extra Virgin Olive Oil", 7), S("Garlic", 6), S("Salt", 2), S("Black Pepper", 1)] },

  { name: "Chicken & Broccoli Rice Bowl", cuisine: "american", effort: "quick", prep: 20, slot: "meal",
    steps: ["Steam broccoli 4 min until bright green.", "Sear chicken breast in olive oil with garlic, 5–6 min.", "Pile chicken and broccoli over rice; season."],
    ing: [P("Chicken breast, cooked, skinless", 180), C("White rice, cooked", 180), V("Broccoli", 150), Fat("Extra Virgin Olive Oil", 7), S("Garlic", 8), S("Salt", 2)] },

  { name: "Beef & Potato Skillet", cuisine: "american", effort: "quick", prep: 25, slot: "meal",
    steps: ["Par-cook diced potato in the microwave 4 min.", "Brown ground beef with onion in a dry skillet, drain.", "Add potato and paprika; crisp everything together 5 min."],
    ing: [P("Extra-lean ground beef, cooked", 170), C("Russet Potato", 220), V("Onion", 70), S("Paprika", 3), S("Salt", 2), S("Black Pepper", 1)] },

  // ─────────────── NORTH AMERICAN — breakfast / high-protein ───────────────
  { name: "Loaded Scrambled Eggs", cuisine: "american", effort: "quick", prep: 12, slot: "meal",
    steps: ["Sauté diced pepper and onion in olive oil, 3 min.", "Beat whole eggs with the whites; add to the pan.", "Scramble soft; fold in grated cheddar off the heat."],
    ing: [P("Eggs, whole, cooked", 100), P("Eggs, Grade A, Large, egg white", 120), V("Bell peppers", 60), V("Onion", 40), Fat("Extra Virgin Olive Oil", 5), P("Cheddar Cheese", 25), S("Salt", 1)] },

  { name: "Greek Yogurt Protein Oats", cuisine: "american", effort: "quick", prep: 8, slot: "meal",
    steps: ["Cook the oats with milk until creamy, 4 min.", "Off the heat, stir in the Greek yogurt so it stays thick and cold-tangy.", "Top with a pinch of cinnamon if you like."],
    ing: [C("Porridge oats", 60), P("Greek yogurt, 0%", 170), C("Milk, 2%", 150)] },

  { name: "Cottage Cheese & Egg Power Bowl", cuisine: "american", effort: "quick", prep: 10, slot: "either",
    steps: ["Halve two hard-boiled eggs.", "Spoon cottage cheese into a bowl; add the eggs and halved cherry tomatoes.", "Crack black pepper over the top; finish with a thread of olive oil."],
    ing: [P("Cottage Cheese", 200), P("Eggs, whole, cooked", 100), V("Cherry Tomatoes", 80), Fat("Extra Virgin Olive Oil", 4), S("Black Pepper", 1)] },

  // ─────────────── MEXICAN / LATIN — quick ───────────────
  { name: "Chicken Street Tacos", cuisine: "mexican", effort: "quick", prep: 20, slot: "meal",
    steps: ["Sear diced chicken thigh with cumin and a pinch of salt until crisp at the edges.", "Warm the corn tortillas over an open flame.", "Fill with chicken, raw onion, cilantro and a squeeze of lime; add jalapeño to taste."],
    ing: [P("Chicken thigh, cooked, skinless", 170), C("Corn Tortillas", 90), V("Onion", 40), S("Cilantro", 10), S("Lime", 15), S("Jalapeno", 15), S("Cumin", 2), S("Salt", 2)] },

  { name: "Beef & Black Bean Burrito Bowl", cuisine: "mexican", effort: "quick", prep: 20, slot: "meal",
    steps: ["Brown ground beef with cumin and chili powder.", "Warm the black beans through.", "Build the bowl over rice: beef, beans, cheddar; top with fresh salsa (see note)."],
    ing: [P("Extra-lean ground beef, cooked", 150), C("White rice, cooked", 160), P("Black beans, canned, drained", 90), P("Cheddar Cheese", 25), V("Passata", 40), S("Cumin", 2), S("Chili Powder", 2), S("Salt", 2)] },

  { name: "Huevos Rancheros", cuisine: "mexican", effort: "quick", prep: 18, slot: "meal",
    steps: ["Simmer passata with jalapeño and cumin into a quick ranchero sauce, 5 min.", "Fry the eggs to your liking.", "Lay eggs over warmed corn tortillas and black beans; blanket with the sauce and a little cheese."],
    ing: [P("Eggs, whole, cooked", 150), C("Corn Tortillas", 60), P("Black beans, canned, drained", 90), V("Passata", 80), P("Cheddar Cheese", 20), S("Jalapeno", 15), S("Cumin", 2), S("Salt", 1)] },

  { name: "Chicken Fajita Bowl", cuisine: "mexican", effort: "quick", prep: 22, slot: "meal",
    steps: ["Sear strips of chicken breast hard in olive oil with cumin and chili powder.", "Add peppers and onion; blister them, keeping some bite.", "Serve over rice with lime."],
    ing: [P("Chicken breast, cooked, skinless", 185), C("White rice, cooked", 170), V("Bell peppers", 120), V("Onion", 60), Fat("Extra Virgin Olive Oil", 7), S("Cumin", 2), S("Chili Powder", 2), S("Lime", 15), S("Salt", 2)] },

  { name: "Carne Asada Bowl", cuisine: "mexican", effort: "quick", prep: 25, slot: "meal",
    steps: ["Marinate the sirloin briefly in lime, garlic and cumin; sear hot and rest.", "Slice thin against the grain.", "Plate over rice and black beans with sliced avocado and cilantro."],
    ing: [P("Sirloin steak, cooked, lean", 165), C("White rice, cooked", 150), P("Black beans, canned, drained", 80), Fat("Avocado", 50), S("Lime", 15), S("Garlic", 6), S("Cilantro", 8), S("Cumin", 2), S("Salt", 2)] },

  { name: "Ground Beef Taco Salad", cuisine: "mexican", effort: "quick", prep: 18, slot: "meal",
    steps: ["Brown ground beef with cumin, chili powder and paprika.", "Build a bed of shredded lettuce; add the beef, cheddar and cherry tomatoes.", "Top with avocado and a spoon of passata-salsa."],
    ing: [P("Extra-lean ground beef, cooked", 170), V("Lettuce", 90), P("Cheddar Cheese", 25), V("Cherry Tomatoes", 80), Fat("Avocado", 45), V("Passata", 30), S("Cumin", 2), S("Chili Powder", 2), S("Paprika", 1)] },

  { name: "Migas (Tex-Mex Eggs)", cuisine: "mexican", effort: "quick", prep: 15, slot: "meal",
    steps: ["Crisp torn corn tortillas in a little olive oil.", "Add beaten eggs, onion and jalapeño; scramble.", "Fold in Monterey cheese off the heat."],
    ing: [P("Eggs, whole, cooked", 150), C("Corn Tortillas", 50), P("Cheese, Monterey", 25), V("Onion", 40), Fat("Extra Virgin Olive Oil", 5), S("Jalapeno", 15), S("Salt", 1)] },

  // ─────────────── BATCH-COOK / INVOLVED ───────────────
  { name: "Beef & Two-Bean Chili", cuisine: "mexican", effort: "batch", prep: 55, slot: "meal",
    steps: ["Brown ground beef with onion and garlic.", "Add cumin, chili powder and paprika; bloom 1 min.", "Add chopped tomatoes and both beans; simmer 40 min until thick.", "Portions freeze well — this is a make-4 batch."],
    ing: [P("Extra-lean ground beef, cooked", 150), P("Black beans, canned, drained", 90), P("Beans, pinto, canned, sodium added, drained and rinsed", 80), V("Chopped Tomatoes", 120), V("Onion", 70), S("Garlic", 8), S("Cumin", 3), S("Chili Powder", 3), S("Paprika", 2), S("Salt", 2)] },

  { name: "Slow Chicken Tinga", cuisine: "mexican", effort: "batch", prep: 50, slot: "meal",
    steps: ["Simmer chicken breast with passata, onion, garlic, chipotle-style chili powder and cumin, 40 min.", "Shred the chicken in the sauce.", "Serve over rice; batch the rest for the week."],
    ing: [P("Chicken breast, cooked, skinless", 190), C("White rice, cooked", 170), V("Passata", 90), V("Onion", 60), S("Garlic", 8), S("Chili Powder", 3), S("Cumin", 2), S("Salt", 2)] },

  { name: "Pollo Guisado (Braised Chicken)", cuisine: "latin", effort: "batch", prep: 55, slot: "meal",
    steps: ["Brown chicken thigh; set aside.", "Soften onion, pepper and garlic; add cumin and passata.", "Return the chicken with diced potato; braise 35 min until the potato is tender and the sauce clings."],
    ing: [P("Chicken thigh, cooked, skinless", 185), C("Russet Potato", 160), V("Passata", 90), V("Onion", 60), V("Bell peppers", 70), S("Garlic", 8), S("Cumin", 2), S("Salt", 2)] },

  { name: "Beef Barbacoa Bowl", cuisine: "mexican", effort: "batch", prep: 60, slot: "meal",
    steps: ["Braise the sirloin low with lime, garlic, cumin and passata until it shreds, ~45 min.", "Shred and reduce the juices.", "Serve over rice and black beans with cilantro; batch the beef."],
    ing: [P("Sirloin steak, cooked, lean", 170), C("White rice, cooked", 150), P("Black beans, canned, drained", 80), V("Passata", 60), S("Lime", 15), S("Garlic", 8), S("Cumin", 3), S("Cilantro", 8), S("Salt", 2)] },

  { name: "Meatloaf & Roasted Potatoes", cuisine: "american", effort: "batch", prep: 60, slot: "meal",
    steps: ["Mix ground beef with grated onion, one egg and seasoning; shape into a loaf.", "Roast at 190°C / 375°F for 40 min.", "Roast quartered potatoes in olive oil alongside. Slices reheat well all week."],
    ing: [P("Extra-lean ground beef, cooked", 170), C("Russet Potato", 200), P("Eggs, whole, cooked", 50), V("Onion", 50), Fat("Extra Virgin Olive Oil", 7), S("Salt", 2), S("Black Pepper", 1)] },
];

async function resolve(name) {
  const row = await prisma.food.findFirst({ where: { name }, select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, source: true } });
  return row;
}

(async () => {
  const rows = [];
  const missing = new Set();
  for (const r of RECIPES) {
    const ingredients = [];
    for (const it of r.ing) {
      const food = await resolve(it.food);
      if (!food) { missing.add(it.food); continue; }
      ingredients.push({ baseGrams: it.g, scalable: !it.fixed, role: it.role, food });
    }
    const m = computeRecipeMacros(ingredients);
    const recipe = { name: r.name, kcal: m.kcal, protein: m.protein, fat: m.fat, carb: m.carb, ingredients };
    const v = validateRecipe(recipe);
    rows.push({ ...r, m, v, nIng: ingredients.length });
  }

  const money = (n) => Math.round(n);
  const pd = (m) => (m.protein / (m.kcal / 100)).toFixed(1); // g protein per 100 kcal
  console.log("\n#  RECIPE                              CUIS     EFF    KCAL  P    C    F    P/100k  VALID");
  console.log("── ─────────────────────────────────── ──────── ────── ───── ──── ──── ──── ─────── ─────");
  let i = 1, fails = 0;
  for (const r of rows) {
    const ok = r.v.ok && r.nIng === r.ing.length;
    if (!ok) fails++;
    console.log(
      String(i++).padStart(2) + " " +
      r.name.padEnd(35).slice(0, 35) + " " +
      r.cuisine.padEnd(8) + " " +
      r.effort.padEnd(6) + " " +
      String(money(r.m.kcal)).padStart(5) + " " +
      String(money(r.m.protein)).padStart(4) + " " +
      String(money(r.m.carb)).padStart(4) + " " +
      String(money(r.m.fat)).padStart(4) + " " +
      pd(r.m).padStart(7) + "  " +
      (ok ? "ok" : "FAIL " + (r.v.issues.map((x) => x.code).join(",") || `missing ${r.ing.length - r.nIng} ing`))
    );
  }
  const avg = (f) => (rows.reduce((s, r) => s + f(r.m), 0) / rows.length);
  console.log("── ─────────────────────────────────── ──────── ────── ───── ──── ──── ──── ─────── ─────");
  console.log(`   ${rows.length} recipes · avg ${money(avg((m) => m.kcal))} kcal · ${money(avg((m) => m.protein))} g protein · avg P/100k ${(avg((m) => m.protein) / (avg((m) => m.kcal) / 100)).toFixed(1)}`);
  const byC = {}; const byE = {};
  rows.forEach((r) => { byC[r.cuisine] = (byC[r.cuisine] || 0) + 1; byE[r.effort] = (byE[r.effort] || 0) + 1; });
  console.log("   cuisines: " + JSON.stringify(byC) + "   effort: " + JSON.stringify(byE));
  if (missing.size) console.log("\n⚠ UNRESOLVED FOODS: " + [...missing].join(" | "));
  console.log(fails ? `\n✗ ${fails} recipe(s) need attention` : "\n✓ all recipes validate (macros reconstruct, no placeholders, all ingredients resolve)");

  // Emit the validated review data (built from the real food rows, not re-typed).
  const review = rows.map((r) => ({
    name: r.name, cuisine: r.cuisine, effort: r.effort, prep: r.prep, slot: r.slot,
    kcal: Math.round(r.m.kcal), protein: Math.round(r.m.protein), carb: Math.round(r.m.carb), fat: Math.round(r.m.fat),
    pPer100k: +(r.m.protein / (r.m.kcal / 100)).toFixed(1),
    steps: r.steps,
    ingredients: r.ing.map((it) => ({ name: it.food, grams: it.g, role: it.role, fixed: !!it.fixed })),
    valid: r.v.ok && r.nIng === r.ing.length,
  }));
  const fs = require("node:fs");
  const outPath = process.env.REVIEW_OUT || "../docs/qc/authored-recipes-review.json";
  fs.writeFileSync(outPath, JSON.stringify(review, null, 2) + "\n");
  console.log("→ review data: " + outPath);
  await prisma.$disconnect();
})();
