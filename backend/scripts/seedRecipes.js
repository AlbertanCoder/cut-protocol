// Idempotent: upserts by name, so re-running to add new curated recipes
// later won't touch anything Phase C's AI generation adds under different names.
require("dotenv/config");
const { prisma } = require("../src/lib/prisma.js");

// Per-100g macros. Whole cuts/staples are standard reference values;
// items flagged "manual-placeholder" are brand-variable (his actual
// turkey sausage, Angus patties, etc.) — replace with a real USDA lookup
// once Phase C's ingredient search is wired up.
const FOODS = [
  { name: "Chicken breast, cooked, skinless", category: "protein", kcal: 165, protein: 31, fat: 3.6, carb: 0, fiber: 0 },
  { name: "Chicken thigh, cooked, skinless", category: "protein", kcal: 209, protein: 26, fat: 10.9, carb: 0, fiber: 0 },
  { name: "Sirloin steak, cooked, lean", category: "protein", kcal: 201, protein: 29, fat: 8.7, carb: 0, fiber: 0 },
  { name: "Extra-lean ground beef, cooked", category: "protein", kcal: 172, protein: 26, fat: 7, carb: 0, fiber: 0 },
  { name: "Ground pack (elk/game), cooked", category: "protein", kcal: 150, protein: 26, fat: 4, carb: 0, fiber: 0 },
  { name: "Salmon, cooked", category: "protein", kcal: 206, protein: 22, fat: 12.4, carb: 0, fiber: 0 },
  { name: "Eggs, whole, cooked", category: "protein", kcal: 155, protein: 13, fat: 11, carb: 1.1, fiber: 0 },
  { name: "Beef jerky", category: "protein", kcal: 410, protein: 33, fat: 26, carb: 11, fiber: 0 },
  { name: "Turkey sausages", category: "protein", kcal: 180, protein: 16, fat: 12, carb: 2, fiber: 0, source: "manual-placeholder" },
  { name: "Elk smokies", category: "protein", kcal: 200, protein: 15, fat: 15, carb: 2, fiber: 0, source: "manual-placeholder" },
  { name: "Angus beef patty", category: "protein", kcal: 280, protein: 17, fat: 23, carb: 0, fiber: 0, source: "manual-placeholder" },
  { name: "Pork rinds", category: "protein", kcal: 544, protein: 61, fat: 31, carb: 0, fiber: 0 },
  { name: "Bacon, cooked", category: "protein", kcal: 541, protein: 37, fat: 42, carb: 1.4, fiber: 0 },
  { name: "Pepperoni", category: "protein", kcal: 504, protein: 21, fat: 44, carb: 3, fiber: 0, source: "manual-placeholder" },

  { name: "White rice, cooked", category: "carb", kcal: 130, protein: 2.7, fat: 0.3, carb: 28, fiber: 0.4 },
  { name: "Potato, baked with skin", category: "carb", kcal: 93, protein: 2.5, fat: 0.1, carb: 21, fiber: 2.2 },
  { name: "Perogies, boiled", category: "carb", kcal: 200, protein: 5, fat: 5, carb: 33, fiber: 1.5, source: "manual-placeholder" },
  { name: "Black beans, canned, drained", category: "carb", kcal: 132, protein: 8.9, fat: 0.5, carb: 24, fiber: 8.7 },

  { name: "Bell peppers", category: "veg", kcal: 31, protein: 1, fat: 0.3, carb: 6, fiber: 2.1 },
  { name: "Cucumber", category: "veg", kcal: 15, protein: 0.7, fat: 0.1, carb: 3.6, fiber: 0.5 },
  { name: "Chili aromatics & sauce", category: "veg", kcal: 35, protein: 1.5, fat: 0.3, carb: 7, fiber: 2, source: "manual-placeholder" },

  { name: "Mixed berries", category: "fruit", kcal: 57, protein: 0.7, fat: 0.3, carb: 14, fiber: 2.4 },

  { name: "Butter", category: "fat", kcal: 717, protein: 0.9, fat: 81, carb: 0.1, fiber: 0 },
  { name: "Almonds", category: "fat", kcal: 579, protein: 21, fat: 50, carb: 22, fiber: 12.5 },
  { name: "Pistachios", category: "fat", kcal: 562, protein: 20, fat: 45, carb: 28, fiber: 10.6 },
  { name: "Avocado chips", category: "fat", kcal: 500, protein: 4, fat: 33, carb: 45, fiber: 8, source: "manual-placeholder" },

  { name: "Greek yogurt, 0%", category: "dairy", kcal: 59, protein: 10, fat: 0.4, carb: 3.6, fiber: 0 },
  { name: "Milk, 2%", category: "dairy", kcal: 50, protein: 3.3, fat: 2, carb: 4.8, fiber: 0 },
];

const RECIPES = [
  {
    name: "Cast-Iron Sirloin, Rice & Peppers",
    description: "His rotation sirloin main, seared hard and sliced.",
    slotType: "meal", cuisine: "steakhouse", prepTimeMin: 20,
    ingredients: [
      { foodName: "Sirloin steak, cooked, lean", baseGrams: 250, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
      { foodName: "Butter", baseGrams: 10, role: "fat" },
    ],
    steps: [
      "Pat the sirloin dry and season heavy with salt and pepper.",
      "Get a cast iron pan smoking hot, sear 3-4 min per side for medium-rare.",
      "Rest 5 minutes, then slice against the grain.",
      "Toss sliced peppers in the same pan 2-3 min until blistered.",
      "Plate over rice, melt the butter over the steak.",
    ],
  },
  {
    name: "Cast-Iron Sirloin, Potato & Cucumber",
    description: "Same sear, starch swapped to potato.",
    slotType: "meal", cuisine: "steakhouse", prepTimeMin: 25,
    ingredients: [
      { foodName: "Sirloin steak, cooked, lean", baseGrams: 250, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Cucumber", baseGrams: 150, role: "veg" },
      { foodName: "Butter", baseGrams: 10, role: "fat" },
    ],
    steps: [
      "Sear the sirloin as above; rest and slice.",
      "Bake the potato at 425°F ~45 min, or halve and pan-crisp cut-side down 15 min.",
      "Serve cucumber raw and cold as a cooling side.",
      "Butter goes on the steak, not the potato.",
    ],
  },
  {
    name: "Skillet Chicken Thighs, Rice & Peppers",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 25,
    ingredients: [
      { foodName: "Chicken thigh, cooked, skinless", baseGrams: 300, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
      { foodName: "Butter", baseGrams: 8, role: "fat" },
    ],
    steps: [
      "Season thighs well, sear skin-side down until crisp, ~6 min.",
      "Flip, cover, finish 8-10 min until cooked through.",
      "Sauté peppers in the drippings 2-3 min.",
      "Serve over rice with butter stirred through.",
    ],
  },
  {
    name: "Skillet Chicken Thighs, Potato & Cucumber",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 30,
    ingredients: [
      { foodName: "Chicken thigh, cooked, skinless", baseGrams: 300, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Cucumber", baseGrams: 150, role: "veg" },
      { foodName: "Butter", baseGrams: 8, role: "fat" },
    ],
    steps: [
      "Sear and finish thighs as above.",
      "Bake or pan-crisp the potato.",
      "Serve cucumber cold on the side.",
    ],
  },
  {
    name: "Ground Beef & Rice Skillet",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 20,
    ingredients: [
      { foodName: "Extra-lean ground beef, cooked", baseGrams: 250, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
      { foodName: "Butter", baseGrams: 10, role: "fat" },
    ],
    steps: [
      "Brown the beef in a hot skillet, breaking it up as it cooks.",
      "Drain excess fat if needed.",
      "Toss in peppers for the last 2 minutes.",
      "Serve over rice, butter stirred through.",
    ],
  },
  {
    name: "Ground Beef & Potato Hash",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 25,
    ingredients: [
      { foodName: "Extra-lean ground beef, cooked", baseGrams: 250, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Dice and pan-crisp the potato first, set aside.",
      "Brown the beef with peppers in the same pan.",
      "Fold the potato back in, crisp another 2-3 minutes.",
    ],
  },
  {
    name: "Pan-Seared Salmon, Rice & Peppers",
    description: "No butter — the fish carries its own fat.",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 15,
    ingredients: [
      { foodName: "Salmon, cooked", baseGrams: 230, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Pat salmon dry, season, sear skin-side down 4-5 min until crisp.",
      "Flip, cook 2 more minutes.",
      "Serve over rice with peppers on the side.",
    ],
  },
  {
    name: "Pan-Seared Salmon & Potato",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 20,
    ingredients: [
      { foodName: "Salmon, cooked", baseGrams: 230, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Cucumber", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Sear salmon as above.",
      "Serve with baked potato and cold cucumber.",
    ],
  },
  {
    name: "Street Chili",
    description: "The batch-cook chili — 6 servings, freezes well.",
    slotType: "meal", cuisine: "tex-mex", prepTimeMin: 45,
    ingredients: [
      { foodName: "Extra-lean ground beef, cooked", baseGrams: 454, role: "protein" },
      { foodName: "Black beans, canned, drained", baseGrams: 400, role: "carb" },
      { foodName: "Chili aromatics & sauce", baseGrams: 500, role: "veg" },
    ],
    steps: [
      "Brown the beef, breaking it up.",
      "Add onion, garlic, jalapeño — cook until soft.",
      "Toast cumin, chili powder, smoked paprika 30 seconds.",
      "Stir in diced tomatoes, tomato paste, chipotle + adobo sauce, beans.",
      "Simmer low and slow, 30+ minutes.",
      "Finish with lime juice and cilantro.",
    ],
  },
  {
    name: "Grilled Chicken Breast, Rice & Peppers",
    description: "The site-lunch template.",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 15,
    ingredients: [
      { foodName: "Chicken breast, cooked, skinless", baseGrams: 250, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Grill or pan-sear seasoned chicken breast until 165°F internal.",
      "Rest, slice.",
      "Serve over rice with peppers — packs well for a lunch box.",
    ],
  },
  {
    name: "Grilled Chicken Breast & Perogies",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 15,
    ingredients: [
      { foodName: "Chicken breast, cooked, skinless", baseGrams: 200, role: "protein" },
      { foodName: "Perogies, boiled", baseGrams: 300, role: "carb" },
    ],
    steps: [
      "Grill or pan-sear chicken breast.",
      "Boil perogies 4-5 min until they float, or pan-fry in a little butter for crisp edges.",
    ],
  },
  {
    name: "Turkey Sausage, Rice & Peppers",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 15,
    ingredients: [
      { foodName: "Turkey sausages", baseGrams: 200, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Pan-fry sausages until browned and cooked through, ~10 min.",
      "Sauté peppers in the same pan.",
      "Serve over rice.",
    ],
  },
  {
    name: "Turkey Sausage & Potato",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 20,
    ingredients: [
      { foodName: "Turkey sausages", baseGrams: 200, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Cucumber", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Pan-fry sausages until browned.",
      "Serve with baked potato and cold cucumber.",
    ],
  },
  {
    name: "Ground Elk, Rice & Peppers",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 20,
    ingredients: [
      { foodName: "Ground pack (elk/game), cooked", baseGrams: 250, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
      { foodName: "Bell peppers", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Elk is very lean — cook hot and fast, don't overdo it or it dries out.",
      "Brown with peppers, season well.",
      "Serve over rice.",
    ],
  },
  {
    name: "Ground Elk & Potato",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 25,
    ingredients: [
      { foodName: "Ground pack (elk/game), cooked", baseGrams: 250, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Cucumber", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Brown the elk quickly over high heat.",
      "Serve with baked potato and cold cucumber.",
    ],
  },
  {
    name: "Elk Smokies & Potato",
    description: "No butter that night — the rule.",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 20,
    ingredients: [
      { foodName: "Elk smokies", baseGrams: 160, role: "protein" },
      { foodName: "Potato, baked with skin", baseGrams: 250, role: "carb" },
      { foodName: "Cucumber", baseGrams: 150, role: "veg" },
    ],
    steps: [
      "Pan-fry or grill smokies until browned, 2 max.",
      "Serve with baked potato and cold cucumber — skip the butter tonight.",
    ],
  },
  {
    name: "Angus Patty & Turkey Sausage Plate",
    description: "Pairing rule: one patty max, paired with turkey sausage, no butter or nuts that day.",
    slotType: "meal", cuisine: "weeknight", prepTimeMin: 15,
    ingredients: [
      { foodName: "Angus beef patty", baseGrams: 150, role: "protein" },
      { foodName: "Turkey sausages", baseGrams: 100, role: "protein" },
      { foodName: "White rice, cooked", baseGrams: 200, role: "carb" },
    ],
    steps: [
      "Grill or pan-sear the patty to preference.",
      "Pan-fry the turkey sausage alongside.",
      "Serve over rice — no butter, no nuts today.",
    ],
  },
  {
    name: "Perogies & Bacon",
    description: "Weekend garnish plate.",
    slotType: "meal", cuisine: "weekend", prepTimeMin: 15,
    ingredients: [
      { foodName: "Perogies, boiled", baseGrams: 300, role: "carb" },
      { foodName: "Bacon, cooked", baseGrams: 60, role: "protein" },
    ],
    steps: [
      "Boil perogies until they float, then pan-fry in the bacon fat for crisp edges.",
      "Crumble bacon over top.",
    ],
  },
  {
    name: "Bacon & Eggs",
    description: "Weekend breakfast-style plate.",
    slotType: "either", cuisine: "breakfast", prepTimeMin: 15,
    ingredients: [
      { foodName: "Bacon, cooked", baseGrams: 60, role: "protein" },
      { foodName: "Eggs, whole, cooked", baseGrams: 150, role: "protein" },
    ],
    steps: [
      "Cook bacon until crisp, set aside.",
      "Fry or scramble eggs in the bacon fat.",
    ],
  },
  {
    name: "Jerky & Pork Rinds Snack Plate",
    description: "Closer / site valve — his words.",
    slotType: "snack", prepTimeMin: 0,
    ingredients: [
      { foodName: "Beef jerky", baseGrams: 60, role: "protein" },
      { foodName: "Pork rinds", baseGrams: 30, role: "protein" },
    ],
    steps: ["No cooking — portion and eat."],
  },
  {
    name: "Greek Yogurt, Almonds & Berries",
    description: "The Closer from the day template.",
    slotType: "snack", prepTimeMin: 5,
    ingredients: [
      { foodName: "Greek yogurt, 0%", baseGrams: 350, role: "protein" },
      { foodName: "Almonds", baseGrams: 40, role: "fat" },
      { foodName: "Mixed berries", baseGrams: 100, role: "veg" },
    ],
    steps: ["Stir almonds and berries into the yogurt."],
  },
  {
    name: "Pistachios & Jerky",
    slotType: "snack", prepTimeMin: 0,
    ingredients: [
      { foodName: "Pistachios", baseGrams: 30, role: "fat" },
      { foodName: "Beef jerky", baseGrams: 40, role: "protein" },
    ],
    steps: ["No cooking — pistachios weighed, not eyeballed."],
  },
  {
    name: "Pepperoni & Pistachios Plate",
    slotType: "snack", prepTimeMin: 0,
    ingredients: [
      { foodName: "Pepperoni", baseGrams: 30, role: "protein" },
      { foodName: "Pistachios", baseGrams: 30, role: "fat" },
    ],
    steps: ["No cooking — portion and eat."],
  },
  {
    name: "Avocado Chips & Jerky",
    description: "Weekends only.",
    slotType: "snack", prepTimeMin: 0,
    ingredients: [
      { foodName: "Avocado chips", baseGrams: 25, role: "fat" },
      { foodName: "Beef jerky", baseGrams: 40, role: "protein" },
    ],
    steps: ["No cooking — portion and eat."],
  },
];

async function main() {
  const foodIdByName = {};
  for (const f of FOODS) {
    const row = await prisma.food.upsert({
      where: { name: f.name },
      update: { ...f, source: f.source || "manual" },
      create: { ...f, source: f.source || "manual" },
    });
    foodIdByName[f.name] = row.id;
  }
  console.log(`Upserted ${FOODS.length} foods.`);

  for (const r of RECIPES) {
    let kcal = 0, protein = 0, fat = 0, carb = 0;
    for (const ing of r.ingredients) {
      const food = FOODS.find((f) => f.name === ing.foodName);
      if (!food) throw new Error(`Recipe "${r.name}" references unknown food "${ing.foodName}"`);
      const factor = ing.baseGrams / 100;
      kcal += food.kcal * factor;
      protein += food.protein * factor;
      fat += food.fat * factor;
      carb += food.carb * factor;
    }

    const recipe = await prisma.recipe.upsert({
      where: { name: r.name },
      update: {
        description: r.description, steps: r.steps, slotType: r.slotType,
        cuisine: r.cuisine, prepTimeMin: r.prepTimeMin, kcal, protein, fat, carb,
      },
      create: {
        name: r.name, description: r.description, steps: r.steps, slotType: r.slotType,
        cuisine: r.cuisine, prepTimeMin: r.prepTimeMin, kcal, protein, fat, carb,
      },
    });

    await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    for (const ing of r.ingredients) {
      await prisma.recipeIngredient.create({
        data: {
          recipeId: recipe.id,
          foodId: foodIdByName[ing.foodName],
          baseGrams: ing.baseGrams,
          scalable: ing.scalable ?? true,
          role: ing.role ?? null,
        },
      });
    }
  }
  console.log(`Upserted ${RECIPES.length} recipes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
