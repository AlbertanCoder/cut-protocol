// One-time: classify cuisine (name-keyword estimate, disclosed) for every
// recipe with no cuisine set, and remap legacy AI occasion tags that are
// really cuisines (tex-mex → mexican). Hand-set cuisines are untouched.
import "dotenv/config";
import prismaPkg from "../src/lib/prisma.js";
import cuisinePkg from "../src/lib/recipeCuisine.js";

const { prisma } = prismaPkg;
const { classifyCuisine, LEGACY_REMAP } = cuisinePkg;

async function main() {
  const recipes = await prisma.recipe.findMany({ select: { id: true, name: true, cuisine: true } });
  const tally = {};
  let updated = 0;
  for (const r of recipes) {
    let next = null;
    if (LEGACY_REMAP[r.cuisine]) next = LEGACY_REMAP[r.cuisine];
    else if (!r.cuisine) next = classifyCuisine(r.name).cuisine;
    if (next && next !== r.cuisine) {
      await prisma.recipe.update({ where: { id: r.id }, data: { cuisine: next } });
      updated++;
    }
    const final = next || r.cuisine || "(none)";
    tally[final] = (tally[final] || 0) + 1;
  }
  console.log(`updated ${updated} of ${recipes.length} recipes`);
  console.log(JSON.stringify(tally, null, 1));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
