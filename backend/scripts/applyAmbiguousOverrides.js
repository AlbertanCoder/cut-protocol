// One-off follow-up to curateRecipeCategories.js: applies the EXPLICITLY
// resolved calls from roadmap/03-recipe-curation.md §4.4's "Likely human
// call" column for the 35 recipes the automated classifier flagged as
// ambiguous and declined to auto-tag. Only the cases the doc's own prose
// commits to a specific verdict are included here - genuinely unresolved
// ones (Breadfruit in Butter Sauce Recipe [7.7g/335kcal], Banana den Forno,
// Dutch doughnuts, Jamaican Banana Fritters) are deliberately left
// untouched, same "don't guess" discipline the classifier itself uses.
// "Leave as proper_meal" calls need no write (proper_meal is the unset/null
// default) and are omitted from this list, not silently skipped.
//
// Usage: node scripts/applyAmbiguousOverrides.js            # dry run
//        node scripts/applyAmbiguousOverrides.js --apply --confirm
require("dotenv/config");
const { prisma } = require("../src/lib/prisma.js");

const OVERRIDES = {
  dessert: [
    "Boterkoek (Dutch Butter Cake)",
    "Cassava Cake",
    "Dundee cake",
    "Eccles Cakes",
    "Flapper Pie",
    "Jamaican Sweet Potato Pudding",
    "Kvæfjord Cake “Verdens Beste” (World’s Best Cake)",
    "Madeira Cake",
    "Mini bundt cakes",
    "Parkin Cake",
    "Saskatoon Pie",
    "Suksessterte (Norwegian almond “success cake”)",
    "Summer Pudding",
    "Macaroni Pudding",
    "Num Ansom – Sticky Rice Cake",
    "Chocolate churros with chocolate & salted caramel sauce",
    "Date squares",
    "Figgy Duff",
  ],
  breakfast_only: ["Dutch Spiced Breakfast Cake (Ontbijtkoek)"],
  bread_or_pastry_side: ["Yorkshire Puddings", "Syrian Bread", "Shawarma bread"],
  condiment_or_sauce: ["Ají de Aguacate Recipe (Colombian Spicy Avocado Sauce)"],
};

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--confirm");

  const allNames = Object.values(OVERRIDES).flat();
  const found = await prisma.recipe.findMany({ where: { name: { in: allNames } }, select: { id: true, name: true, mealCategory: true } });
  const foundNames = new Set(found.map((r) => r.name));
  const missing = allNames.filter((n) => !foundNames.has(n));

  console.log(`Resolved ${found.length} / ${allNames.length} override names against the DB.`);
  if (missing.length) {
    console.log(`\nNAME MISMATCH - these did not match any recipe exactly (check for typos/formatting differences before proceeding):`);
    missing.forEach((n) => console.log(`   - "${n}"`));
  }

  console.log(`\n=== ${apply ? "APPLY" : "DRY RUN"} ===`);
  for (const [category, names] of Object.entries(OVERRIDES)) {
    for (const name of names) {
      const rec = found.find((r) => r.name === name);
      if (!rec) continue;
      console.log(`   UPDATE Recipe SET mealCategory='${category}' WHERE name='${name}';  (currently: ${rec.mealCategory ?? "null"})`);
    }
  }

  if (!apply) {
    console.log("\nDry run complete. No writes made.");
    return;
  }
  if (!confirmed) {
    console.log("\n--apply without --confirm. Refusing to write.");
    return;
  }
  if (missing.length) {
    console.log("\nRefusing to write: unresolved name(s) above must be fixed first.");
    return;
  }

  let count = 0;
  for (const [category, names] of Object.entries(OVERRIDES)) {
    for (const name of names) {
      await prisma.recipe.update({ where: { name }, data: { mealCategory: category } });
      count++;
    }
  }
  console.log(`\nWrote mealCategory to ${count} recipes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
