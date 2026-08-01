/**
 * backfillIngredientMetadata.mjs — populate the three columns that were designed
 * correctly and never filled in.
 *
 * WHY THIS EXISTS
 * The 275-customer campaign (docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032)
 * scored "the meals are good" at 2.8/10 — the lowest of the owner's five criteria —
 * and traced almost every complaint about it to three unset columns rather than to
 * the solver:
 *
 *   RecipeIngredient.scalable   260 / 7,024 set   -> 99.4% of herb rows get MULTIPLIED
 *   Recipe.mealCategory         169 / 889 set     -> a condiment was served as dinner
 *   RecipeIngredient.role       35% of oil rows say "carb" -> drives protein-vs-sides scaling
 *
 * Between them they produced: 105 g of rosemary, 100 g of bay leaves, 1.1 kg of
 * spring onions, 19 g of salt in one dish, 997 kcal of achiote oil as two meals,
 * and 13 g of cabbage inside a cabbage stew.
 *
 * DESIGN
 *   · IDEMPOTENT. Re-running changes nothing. Safe to run repeatedly.
 *   · --dry-run by default in spirit: pass --apply to write. Without it, reports only.
 *   · CONSERVATIVE. Every rule is narrow and reversible, and anything ambiguous is
 *     left alone and counted rather than guessed. A row this script does not
 *     understand keeps whatever it has.
 *   · The heuristics are stated in the constants below so they can be argued with.
 *
 *   node scripts/backfillIngredientMetadata.mjs            # report only
 *   node scripts/backfillIngredientMetadata.mjs --apply    # write
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prisma } = require('../src/lib/prisma.js');

const APPLY = process.argv.includes('--apply');
const r1 = (n) => Math.round(n * 10) / 10;

// ── 1. scalable ─────────────────────────────────────────────────────────────
// A "fixed" ingredient is one whose quantity should NOT move when the dish is
// portioned up or down: seasonings, and single indivisible items.
//
// Two independent signals, deliberately both required to be cheap and safe:
//   (a) the food is a seasoning by CATEGORY (`spices`), or
//   (b) it is a named herb/spice/condiment AND is used in a small quantity.
// Small = <= SEASONING_MAX_G. Above that the recipe genuinely means it as an
// ingredient (a 200 g basil pesto base is not a garnish) and it stays scalable.
const SEASONING_MAX_G = 15;
const SEASONING_NAME = /\b(salt|pepper|peppercorn|thyme|rosemary|oregano|basil|sage|parsley|cilantro|coriander|mint|dill|bay leaf|bay leaves|chive|tarragon|marjoram|cumin|paprika|cayenne|turmeric|cinnamon|nutmeg|clove|cardamom|allspice|saffron|fennel seed|caraway|anise|chilli flake|chili flake|curry powder|garam masala|five spice|za'?atar|harissa paste|vanilla|baking powder|baking soda|yeast|food colouring|food coloring|seasoning|spice)\b/i;
// Never mark these fixed even if they match above — they are the DISH, not the seasoning.
//
// The `low salt` clause is not hypothetical: the first dry run matched
// "Turkey breast, low salt, prepackaged or deli, luncheon meat" on \bsalt\b and
// labelled 170 g of deli turkey as a suspicious herb quantity. A seasoning word
// appearing as a PRODUCT DESCRIPTOR is not a seasoning.
const SEASONING_GUARD = /\b(pesto|salsa verde|chimichurri|tabbouleh|herb salad|gremolata|low salt|reduced salt|unsalted|salted|no salt|lightly salted|salt[- ]cured)\b/i;

// ── 2. mealCategory ─────────────────────────────────────────────────────────
// Only the categories that change SLOT ELIGIBILITY are inferred here. The point
// is to stop a condiment, a drink or a bread side being served as a main.
const CONDIMENT_NAME = /\b(oil|sauce|dressing|marinade|pickle|pickled|relish|chutney|jam|preserve|syrup|glaze|rub|paste|dip|salsa|pesto|mayonnaise|aioli|vinaigrette|stock|broth|seasoning)\b/i;
// Plurals matter here. The first dry run tagged "Fasoliyyeh Bi Z-Zayt (Syrian Green
// Beans with Olive Oil)" as a condiment because it matched "oil" and the guard's
// `\bbean\b` does not match "Beans" — the \b between "n" and "s" cannot fire. Every
// noun below now takes an optional plural.
const CONDIMENT_GUARD = /\b(salads?|stews?|soups?|curr(y|ies)|pastas?|noodles?|rice|bowls?|bakes?|roasts?|casseroles?|stir[- ]?fr(y|ies)|chicken|beef|pork|lamb|fish|salmon|tuna|prawns?|shrimps?|tofu|beans?|lentils?|eggs?|greens?|vegetables?)\b/i;
const BEVERAGE_NAME = /\b(smoothie|juice|latte|coffee|tea|lemonade|milkshake|shake|cocktail|mocktail|infusion|kombucha)\b/i;
const BREAD_NAME = /\b(bread|roll|bun|baguette|focaccia|naan|pita|tortilla|flatbread|cornbread|scone|biscuit|crackers?)\b/i;
const DESSERT_NAME = /\b(cake|pie|tart|tartlet|cookie|brownie|pudding|custard|mousse|ice cream|sorbet|cheesecake|doughnut|donut|pastry|éclair|eclair|baklava|halva|fudge|truffle|candy|kransekake|æbleskiver|aebleskiver)\b/i;
// A main course is protein-bearing. A "condiment" that carries real protein is a
// dish, whatever its name says.
const MAIN_MIN_PROTEIN_PER_SERVING = 8;

// ── 3. role ─────────────────────────────────────────────────────────────────
// role decides whether an ingredient scales with proteinScale or sidesScale, so a
// mislabelled one is a portion bug. Only clear-cut cases are corrected.
// SCOPE, deliberately narrow. `role` decides whether an ingredient scales with
// proteinScale or sidesScale, so a wrong change here becomes a portion bug — the
// exact class of defect this script exists to fix. So each rule declares WHICH
// existing roles it is allowed to overwrite, and anything else is left alone.
//
// The first dry run wanted to move 91 rows from `veg` to `carb` (potatoes, mostly).
// Defensible in isolation, and NOT done: `veg` is a deliberate human classification,
// a potato genuinely is a vegetable, and I cannot verify the solver consequence of
// reclassifying 91 side-dish rows as carbohydrate. Only unambiguous errors and empty
// fields are touched.
const ROLE_RULES = [
  // Oils and fats mislabelled as carbs — 35% of oil rows said `carb`, reported by
  // three separate campaign customers ("Olive Oil, role: carb").
  { re: /\b(oils?|butter|ghee|lard|tallow|suet|margarine|mayonnaise)\b/i, to: 'fat', overwrite: ['carb', 'protein', 'veg', null] },
  // Stock and broth called protein — reported as "Chicken Stock, role=protein".
  { re: /\b(stock|broth|bouillon)\b/i, to: 'other', overwrite: ['protein', 'carb', null] },
  // Fill in blanks only; never override an existing human classification.
  { re: /\b(chicken|beef|pork|lamb|turkey|duck|salmon|tuna|cod|haddock|prawns?|shrimps?|tofu|tempeh|seitan|eggs?|jerky|steak|sausage|bacon|whey|protein powder)\b/i, to: 'protein', overwrite: [null] },
  { re: /\b(rice|pasta|noodles?|bread|potatoes?|quinoa|couscous|bulgur|oats|barley|flour|tortilla|cornmeal|polenta)\b/i, to: 'carb', overwrite: [null] },
];
// An oil or a stock is never the protein, whatever animal is in its name.
const ROLE_GUARD_PROTEIN = /\b(oils?|stock|broth|bouillon|fat|dripping)\b/i;

async function main() {
  console.log(`== backfill ingredient metadata ==  mode: ${APPLY ? 'APPLY (writing)' : 'REPORT ONLY (pass --apply to write)'}\n`);

  const ingredients = await prisma.recipeIngredient.findMany({
    include: { food: { select: { name: true, category: true, protein: true } }, recipe: { select: { name: true } } },
  });
  const recipes = await prisma.recipe.findMany({
    select: { id: true, name: true, slotType: true, mealCategory: true, protein: true, kcal: true },
  });

  // ── scalable ──────────────────────────────────────────────────────────────
  const toFix = [];
  for (const ri of ingredients) {
    if (ri.scalable === false) continue; // already fixed — idempotent
    const n = ri.food.name;
    if (SEASONING_GUARD.test(ri.recipe.name) || SEASONING_GUARD.test(n)) continue;
    const isSpiceCategory = ri.food.category === 'spices';
    const isSeasoningName = SEASONING_NAME.test(n);
    if (!isSpiceCategory && !isSeasoningName) continue;
    if (ri.baseGrams > SEASONING_MAX_G) continue; // genuinely an ingredient at this weight
    toFix.push(ri);
  }
  console.log(`scalable   : ${toFix.length} ingredient row(s) to mark FIXED (of ${ingredients.length})`);
  const bySpice = {};
  for (const ri of toFix) bySpice[ri.food.name] = (bySpice[ri.food.name] || 0) + 1;
  Object.entries(bySpice).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([k, v]) => console.log(`             ${String(v).padStart(4)} × ${k}`));

  // Report what stays scalable despite looking like a seasoning, so the judgement
  // is visible rather than buried.
  // Same guard as the fix path, or the review list fills up with deli turkey.
  const bigHerbs = ingredients.filter((ri) => SEASONING_NAME.test(ri.food.name)
    && !SEASONING_GUARD.test(ri.food.name) && !SEASONING_GUARD.test(ri.recipe.name)
    && ri.baseGrams > SEASONING_MAX_G);
  console.log(`             ${bigHerbs.length} seasoning-named row(s) LEFT scalable because they exceed ${SEASONING_MAX_G} g:`);
  bigHerbs.sort((a, b) => b.baseGrams - a.baseGrams).slice(0, 8)
    .forEach((ri) => console.log(`               ${String(ri.baseGrams).padStart(6)} g ${ri.food.name} in "${ri.recipe.name.slice(0, 40)}"  <- REVIEW: likely a bad base quantity`));

  // ── mealCategory ──────────────────────────────────────────────────────────
  const catFix = [];
  for (const r of recipes) {
    if (r.mealCategory) continue; // idempotent
    let cat = null;
    if (DESSERT_NAME.test(r.name)) cat = 'dessert';
    else if (BEVERAGE_NAME.test(r.name)) cat = 'beverage';
    else if (BREAD_NAME.test(r.name)) cat = 'bread_or_pastry_side';
    else if (CONDIMENT_NAME.test(r.name) && !CONDIMENT_GUARD.test(r.name)) cat = 'condiment_or_sauce';
    if (!cat) continue;
    // A protein-bearing dish is a meal regardless of its name.
    if (cat === 'condiment_or_sauce' && (r.protein || 0) >= MAIN_MIN_PROTEIN_PER_SERVING) continue;
    catFix.push({ r, cat });
  }
  console.log(`\nmealCategory: ${catFix.length} recipe(s) to tag (of ${recipes.length}; ${recipes.filter((r) => !r.mealCategory).length} currently null)`);
  const byCat = {};
  for (const { cat } of catFix) byCat[cat] = (byCat[cat] || 0) + 1;
  console.log(`              ${JSON.stringify(byCat)}`);
  catFix.filter((x) => x.cat === 'condiment_or_sauce').slice(0, 8)
    .forEach(({ r }) => console.log(`              condiment: "${r.name}" (${Math.round(r.kcal)} kcal, ${r1(r.protein)} g P)`));

  // ── role ──────────────────────────────────────────────────────────────────
  const roleFix = [];
  for (const ri of ingredients) {
    const n = ri.food.name;
    let want = null;
    for (const rule of ROLE_RULES) {
      if (!rule.re.test(n)) continue;
      if (rule.to === 'protein' && ROLE_GUARD_PROTEIN.test(n)) continue;
      // Only correct roles this rule is explicitly allowed to overwrite.
      if (!rule.overwrite.includes(ri.role ?? null)) continue;
      want = rule.to;
      break;
    }
    if (!want || ri.role === want) continue;
    roleFix.push({ ri, from: ri.role, to: want });
  }
  console.log(`\nrole       : ${roleFix.length} ingredient row(s) to correct`);
  const moves = {};
  for (const { from, to } of roleFix) { const k = `${from || 'null'} -> ${to}`; moves[k] = (moves[k] || 0) + 1; }
  Object.entries(moves).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([k, v]) => console.log(`             ${String(v).padStart(4)} × ${k}`));

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing written. Re-run with --apply to commit these changes.');
    await prisma.$disconnect();
    return;
  }

  console.log('\napplying…');
  let n1 = 0, n2 = 0, n3 = 0;
  const CHUNK = 200;
  for (let i = 0; i < toFix.length; i += CHUNK) {
    const ids = toFix.slice(i, i + CHUNK).map((x) => x.id);
    await prisma.recipeIngredient.updateMany({ where: { id: { in: ids } }, data: { scalable: false } });
    n1 += ids.length;
  }
  for (const { r, cat } of catFix) {
    await prisma.recipe.update({ where: { id: r.id }, data: { mealCategory: cat } });
    n2++;
  }
  for (const { ri, to } of roleFix) {
    await prisma.recipeIngredient.update({ where: { id: ri.id }, data: { role: to } });
    n3++;
  }
  console.log(`  scalable=false : ${n1}`);
  console.log(`  mealCategory   : ${n2}`);
  console.log(`  role corrected : ${n3}`);
  console.log('\ndone. Re-run without --apply to confirm it is now a no-op (idempotence check).');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('FAILED:', e && e.stack); try { await prisma.$disconnect(); } catch {} process.exitCode = 1; });
