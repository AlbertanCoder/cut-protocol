/**
 * seedGapRecipes.mjs — author real recipes into the macro niches the fleet proved
 * are empty.
 *
 * WHY, WITH NUMBERS (campaign qa-fleet-20260729-2032, 250 personas / 578 days):
 *   · SNACKS: the whole library holds 9 snack recipes and 0 survive a vegan filter.
 *     Snack slots ship EMPTY across every cohort and `alternates` returns [] because
 *     there is genuinely nothing to offer.
 *   · KETO: 12 of 34 failing keto days had NO FOOD AT ALL — the keto-eligible pool
 *     cannot fill a day.
 *   · `none` (the mainstream customer, 80 personas): 51 lost days, 61% of them
 *     failing on FAT being OVER the band. The library's median dish is 29-37% fat
 *     calories against targets of 16-33%; it is short of genuinely LEAN mains.
 *   · VEGAN (excluding the deliberately-impossible personas): 92% of failing days
 *     fail on PROTEIN, median 75% below the band midpoint.
 *
 * RULES THIS SCRIPT HOLDS ITSELF TO
 *   1. NO INVENTED NUTRITION. Every ingredient resolves to an existing Food row that
 *      passes foodValidation.macroTrustIssue() — no placeholders, no quarantined
 *      rows, no unverified provenance. Macros are COMPUTED from those rows, never
 *      typed in. A recipe whose ingredients cannot all be resolved is skipped, loudly.
 *   2. REAL DISHES, NOT TEMPLATES. The campaign's customers specifically rejected the
 *      "High-Protein X & Y with Z" filler ("every meal is the identical
 *      fill-in-the-blank template"), and the solver already discounts those at 0.35×.
 *      Every recipe below has a real name and real method steps.
 *   3. `scalable: false` on seasonings and `role` set correctly — the two columns the
 *      campaign found 96% and 35% wrong, so new rows do not re-create the defect.
 *   4. IDEMPOTENT. A recipe whose name already exists is skipped.
 *   5. REPORT ONLY unless --apply.
 *
 *   node scripts/seedGapRecipes.mjs            # report
 *   node scripts/seedGapRecipes.mjs --apply    # write
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prisma } = require('../src/lib/prisma.js');
const { macroTrustIssue, computeRecipeMacros } = require('../src/lib/foodValidation.js');

const APPLY = process.argv.includes('--apply');

// grams, role, scalable(optional, default true)
const g = (name, grams, role, scalable = true) => ({ name, grams, role, scalable });

const RECIPES = [
  // ── LEAN MAINS ─ the biggest single loss bucket: `none` days failing on fat OVER
  {
    name: 'Lemon Herb Chicken with Rice and Green Beans', cuisine: 'mediterranean', prep: 25, difficulty: 2,
    ing: [g('Chicken breast, cooked, skinless', 170, 'protein'), g('White rice, cooked', 180, 'carb'),
      g('Green Beans', 120, 'veg'), g('Olive Oil', 6, 'fat'), g('Lemon', 15, 'veg'), g('Garlic', 4, 'veg', false), g('Thyme', 1, 'other', false)],
    steps: ['Season the chicken with garlic, thyme, salt and pepper.', 'Sear 5-6 minutes a side until cooked through, then rest and slice.',
      'Steam the green beans until just tender, 4 minutes.', 'Serve over the rice with the pan juices and a squeeze of lemon.'],
  },
  {
    name: 'Steamed Cod with New Potatoes and Dill', cuisine: 'nordic', prep: 25, difficulty: 2,
    ing: [g('Cod', 200, 'protein'), g('Potatoes', 220, 'carb'), g('Broccoli', 110, 'veg'),
      g('Olive Oil', 5, 'fat'), g('Lemon', 15, 'veg'), g('Dill', 2, 'other', false)],
    steps: ['Boil the potatoes until a knife slides in, about 15 minutes.', 'Set the cod over the pan on a steamer rack for the last 8 minutes.',
      'Steam the broccoli alongside for 4 minutes.', 'Dress with olive oil, lemon and chopped dill.'],
  },
  {
    name: 'Turkey and Quinoa Stuffed Peppers', cuisine: 'mediterranean', prep: 40, difficulty: 3,
    ing: [g('Turkey Mince', 165, 'protein'), g('Quinoa', 160, 'carb'), g('Bell peppers', 200, 'veg'),
      g('Onion', 45, 'veg'), g('Tinned Tomatos', 80, 'veg'), g('Olive Oil', 6, 'fat'), g('Paprika', 2, 'other', false)],
    steps: ['Heat the oven to 190C.', 'Soften the onion, add the turkey and brown it, then stir through the quinoa, tomatoes and paprika.',
      'Halve and seed the peppers and fill them.', 'Bake 25 minutes until the peppers are tender at the edges.'],
  },
  {
    name: 'Garlic Prawn and Asparagus Rice Bowl', cuisine: 'asian', prep: 20, difficulty: 2,
    ing: [g('Shrimp', 180, 'protein'), g('White rice, cooked', 190, 'carb'), g('Asparagus', 120, 'veg'),
      g('Garlic', 6, 'veg', false), g('Olive Oil', 6, 'fat'), g('Lemon Juice', 8, 'other', false)],
    steps: ['Get a pan very hot.', 'Sear the prawns 90 seconds a side with the garlic — they are done the moment they turn opaque.',
      'Add the asparagus and toss for 2 minutes so it keeps its bite.', 'Pile onto the rice and finish with lemon juice.'],
  },
  {
    name: 'Cottage Cheese and Tomato Rye Toast', cuisine: 'nordic', prep: 8, difficulty: 1,
    ing: [g('Cottage Cheese', 200, 'protein'), g('Bread, rye', 80, 'carb'),
      g('Tomatoes', 90, 'veg'), g('Chives', 3, 'other', false), g('Black Pepper', 1, 'other', false)],
    steps: ['Toast the rye until it holds its shape under a load.', 'Spoon over the cottage cheese.',
      'Top with sliced tomato, chives and a good grind of black pepper.'],
  },
  {
    name: 'Poached Chicken and Barley Broth', cuisine: 'western-comfort', prep: 35, difficulty: 2,
    ing: [g('Chicken breast, cooked, skinless', 150, 'protein'), g('Pearl Barley', 170, 'carb'),
      g('Carrots', 90, 'veg'), g('Celery', 60, 'veg'), g('Onion', 50, 'veg'), g('Chicken Stock', 300, 'other'), g('Bay Leaf', 1, 'other', false)],
    steps: ['Simmer the stock with the bay leaf, carrot, celery and onion until the vegetables soften.',
      'Add the barley and warm through.', 'Poach the chicken gently in the broth for 10 minutes, then shred it back in.'],
  },

  // ── KETO MAINS ─ 12 of 34 failing keto days had no food at all
  {
    name: 'Baked Salmon with Buttered Asparagus', cuisine: 'nordic', prep: 22, difficulty: 2, keto: true,
    ing: [g('Salmon, cooked', 190, 'protein'), g('Asparagus', 160, 'veg'), g('Butter', 18, 'fat'),
      g('Lemon', 15, 'veg'), g('Black Pepper', 1, 'other', false)],
    steps: ['Heat the oven to 200C.', 'Bake the salmon 12-14 minutes — it should just flake.',
      'Turn the asparagus in melted butter in a hot pan for 3 minutes.', 'Squeeze lemon over both.'],
  },
  {
    name: 'Chicken Thighs with Creamed Spinach', cuisine: 'french', prep: 30, difficulty: 2, keto: true,
    ing: [g('Chicken Thighs', 200, 'protein'), g('Spinach', 200, 'veg'), g('Double Cream', 60, 'fat'),
      g('Garlic', 5, 'veg', false), g('Butter', 10, 'fat'), g('Nutmeg', 1, 'other', false)],
    steps: ['Brown the thighs skin-side down until the skin renders and crisps, then finish them through.',
      'Wilt the spinach in butter with the garlic and squeeze out the water.', 'Stir in the cream and a scrape of nutmeg, reduce for 2 minutes.'],
  },
  {
    name: 'Steak with Garlic Mushrooms', cuisine: 'western-comfort', prep: 20, difficulty: 2, keto: true,
    ing: [g('Sirloin steak, cooked, lean', 180, 'protein'), g('Mushrooms', 150, 'veg'),
      g('Butter', 16, 'fat'), g('Garlic', 5, 'veg', false), g('Parsley', 3, 'other', false)],
    steps: ['Get the pan smoking. Sear the steak 3 minutes a side for medium-rare, then REST it 5 minutes.',
      'In the same pan, fry the mushrooms hard in butter until they colour, adding the garlic at the end.', 'Spoon over the rested steak with parsley.'],
  },
  {
    name: 'Egg and Avocado Breakfast Plate', cuisine: 'american', prep: 12, difficulty: 1, keto: true,
    ing: [g('Eggs, whole, cooked', 150, 'protein'), g('Avocado', 100, 'fat'),
      g('Spinach', 80, 'veg'), g('Olive Oil', 8, 'fat'), g('Black Pepper', 1, 'other', false)],
    steps: ['Fry or scramble the eggs to your liking in a little of the oil.',
      'Wilt the spinach in the same pan for 1 minute.', 'Slice the avocado alongside and season well.'],
  },
  {
    name: 'Tuna Niçoise Salad Bowl', cuisine: 'french', prep: 15, difficulty: 1, keto: true,
    ing: [g('Tuna', 150, 'protein'), g('Eggs, whole, cooked', 100, 'protein'), g('Green Beans', 100, 'veg'),
      g('Olives', 40, 'fat'), g('Olive Oil', 12, 'fat'), g('Lemon Juice', 10, 'other', false)],
    steps: ['Blanch the green beans 3 minutes and cool them under the tap so they stay green.',
      'Flake the drained tuna over the beans with quartered eggs and olives.', 'Dress with olive oil and lemon.'],
  },

  // ── VEGAN PROTEIN MAINS ─ 92% of vegan failing days fail on protein
  {
    name: 'Crispy Tofu and Lentil Bowl', cuisine: 'asian', prep: 30, difficulty: 2, vegan: true,
    ing: [g('Tofu', 200, 'protein'), g('Lentils', 180, 'protein'), g('Broccoli', 120, 'veg'),
      g('Olive Oil', 10, 'fat'), g('Garlic', 5, 'veg', false), g('Ginger', 4, 'other', false)],
    steps: ['Press the tofu 10 minutes — this is the whole difference between crisp and soggy.',
      'Cube it and fry hard in the oil until golden on at least three sides.',
      'Warm the lentils with the garlic and ginger.', 'Steam the broccoli 4 minutes and combine.'],
  },
  {
    name: 'Tempeh and Chickpea Traybake', cuisine: 'mediterranean', prep: 35, difficulty: 2, vegan: true,
    ing: [g('Tempeh', 160, 'protein'), g('Chickpeas', 180, 'protein'), g('Bell peppers', 150, 'veg'),
      g('Red Onion', 70, 'veg'), g('Olive Oil', 12, 'fat'), g('Paprika', 2, 'other', false), g('Cumin', 1, 'other', false)],
    steps: ['Heat the oven to 200C.', 'Cube the tempeh and toss everything with the oil, paprika and cumin.',
      'Roast 25 minutes, turning once, until the chickpeas start to crackle.'],
  },
  {
    name: 'Seitan Stir-Fry with Broccoli and Rice', cuisine: 'asian', prep: 20, difficulty: 2, vegan: true,
    ing: [g('Seitan', 180, 'protein'), g('White rice, cooked', 180, 'carb'), g('Broccoli', 140, 'veg'),
      g('Garlic', 5, 'veg', false), g('Ginger', 4, 'other', false), g('Olive Oil', 10, 'fat')],
    steps: ['Slice the seitan thin.', 'Stir-fry it in a very hot pan for 3 minutes until the edges catch.',
      'Add the broccoli, garlic and ginger with a splash of water and cover for 2 minutes to steam through.', 'Serve on the rice.'],
  },
  {
    name: 'Red Lentil and Spinach Dhal', cuisine: 'indian', prep: 30, difficulty: 1, vegan: true,
    ing: [g('Lentils, pink or red, raw', 110, 'protein'), g('Spinach', 150, 'veg'), g('Onion', 60, 'veg'),
      g('Tinned Tomatos', 120, 'veg'), g('Olive Oil', 10, 'fat'), g('Cumin', 2, 'other', false), g('Turmeric', 1, 'other', false), g('Garlic', 5, 'veg', false)],
    steps: ['Soften the onion and garlic in the oil, then bloom the cumin and turmeric for 30 seconds.',
      'Add the lentils, tomatoes and 500 ml water. Simmer 20-25 minutes until the lentils collapse.',
      'Stir the spinach through at the end until it just wilts.'],
  },
  {
    name: 'Black Bean and Quinoa Burrito Bowl', cuisine: 'mexican', prep: 20, difficulty: 1, vegan: true,
    ing: [g('Black Beans', 200, 'protein'), g('Quinoa', 170, 'carb'), g('Bell peppers', 120, 'veg'),
      g('Red Onion', 50, 'veg'), g('Avocado', 60, 'fat'), g('Lime juice', 10, 'other', false), g('Cumin', 2, 'other', false)],
    steps: ['Warm the beans with the cumin and a splash of their liquid so they stay creamy.',
      'Char the peppers and onion in a dry pan until they blacken at the edges.',
      'Build over the quinoa and finish with avocado and lime.'],
  },

  // ── SNACKS ─ the library has NINE, and none survive a vegan filter
  { name: 'Roasted Chickpeas with Paprika', cuisine: 'mediterranean', prep: 30, difficulty: 1, snack: true, vegan: true,
    ing: [g('Chickpeas', 120, 'protein'), g('Olive Oil', 7, 'fat'), g('Paprika', 2, 'other', false)],
    steps: ['Dry the chickpeas thoroughly — wet ones steam instead of crisping.', 'Toss with oil and paprika and roast at 200C for 25 minutes, shaking once.'] },
  { name: 'Edamame with Sea Salt', cuisine: 'japanese', prep: 6, difficulty: 1, snack: true, vegan: true,
    ing: [g('Edamame', 150, 'protein'), g('Salt', 1, 'other', false)],
    steps: ['Boil the pods 4 minutes in well-salted water.', 'Drain and salt again while hot. Eat from the pod.'] },
  { name: 'Apple with Almond Butter', cuisine: 'american', prep: 3, difficulty: 1, snack: true, vegan: true,
    ing: [g('Apple', 150, 'carb'), g('Almond Butter', 30, 'fat')],
    steps: ['Slice the apple.', 'Serve with the almond butter for dipping.'] },
  { name: 'Hummus with Carrot and Cucumber', cuisine: 'mediterranean', prep: 5, difficulty: 1, snack: true, vegan: true,
    ing: [g('Hummus', 90, 'protein'), g('Carrots', 90, 'veg'), g('Cucumber', 90, 'veg')],
    steps: ['Cut the carrot and cucumber into batons.', 'Serve with the hummus.'] },
  { name: 'Peanut Butter Banana Toast', cuisine: 'american', prep: 5, difficulty: 1, snack: true, vegan: true,
    ing: [g('Bread, whole-wheat', 60, 'carb'), g('Peanut Butter', 28, 'fat'), g('Banana', 90, 'carb')],
    steps: ['Toast the bread.', 'Spread the peanut butter while it is warm so it melts in, then top with sliced banana.'] },
  { name: 'Cottage Cheese with Pineapple', cuisine: 'american', prep: 3, difficulty: 1, snack: true,
    ing: [g('Cottage Cheese', 180, 'protein'), g('Pineapple', 100, 'carb')],
    steps: ['Spoon the cottage cheese into a bowl.', 'Top with diced pineapple.'] },
  { name: 'Hard-Boiled Eggs with Chilli Salt', cuisine: 'american', prep: 12, difficulty: 1, snack: true, keto: true,
    ing: [g('Eggs, whole, cooked', 120, 'protein'), g('Salt', 1, 'other', false), g('Chilli Powder', 1, 'other', false)],
    steps: ['Boil 8 minutes for a set yolk, then straight into cold water.', 'Peel and dip in chilli salt.'] },
  { name: 'Cheese and Olive Plate', cuisine: 'mediterranean', prep: 4, difficulty: 1, snack: true, keto: true,
    ing: [g('Cheddar Cheese', 60, 'protein'), g('Olives', 50, 'fat'), g('Cucumber', 80, 'veg')],
    steps: ['Cube the cheese.', 'Plate with olives and cucumber.'] },
  { name: 'Greek Yogurt with Walnuts and Honey', cuisine: 'mediterranean', prep: 3, difficulty: 1, snack: true,
    ing: [g('Greek Yogurt', 170, 'protein'), g('Walnuts', 20, 'fat'), g('Honey', 12, 'carb')],
    steps: ['Spoon the yogurt into a bowl.', 'Scatter the walnuts and trickle honey over.'] },
  { name: 'Smoked Mackerel on Oatcakes', cuisine: 'nordic', prep: 5, difficulty: 1, snack: true,
    ing: [g('Mackerel', 80, 'protein'), g('Oatcakes', 40, 'carb'), g('Lemon Juice', 5, 'other', false)],
    steps: ['Flake the mackerel.', 'Pile onto the oatcakes and squeeze lemon over.'] },
];

async function main() {
  console.log(`== seed gap recipes ==  ${APPLY ? 'APPLY' : 'REPORT ONLY (pass --apply to write)'}\n`);
  const foods = await prisma.food.findMany({
    select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, category: true, source: true, dataQuality: true, dataQualityFlag: true },
  });
  const byLower = new Map();
  for (const f of foods) {
    const k = f.name.trim().toLowerCase();
    if (!byLower.has(k)) byLower.set(k, f);
  }
  // Fall back to an exact-prefix match so "Cod" finds "Cod" but never "Cod liver oil".
  const resolve = (name) => {
    const exact = byLower.get(name.trim().toLowerCase());
    if (exact) return exact;
    const n = name.trim().toLowerCase();
    const cands = foods.filter((f) => f.name.toLowerCase() === n || f.name.toLowerCase().startsWith(`${n},`));
    return cands.find((f) => !macroTrustIssue(f)) || cands[0] || null;
  };

  const existing = new Set((await prisma.recipe.findMany({ select: { name: true } })).map((r) => r.name.toLowerCase()));
  const ready = [];
  const skipped = [];

  for (const r of RECIPES) {
    if (existing.has(r.name.toLowerCase())) { skipped.push(`${r.name} — already exists`); continue; }
    const resolved = [];
    let bad = null;
    for (const i of r.ing) {
      const f = resolve(i.name);
      if (!f) { bad = `no Food row for "${i.name}"`; break; }
      const issue = macroTrustIssue(f);
      if (issue) { bad = `"${f.name}" is ${issue.code}`; break; }
      resolved.push({ ...i, food: f });
    }
    if (bad) { skipped.push(`${r.name} — ${bad}`); continue; }
    const macros = computeRecipeMacros(resolved.map((x) => ({ baseGrams: x.grams, food: x.food })));
    ready.push({ ...r, resolved, macros });
  }

  console.log(`ready to insert: ${ready.length} of ${RECIPES.length}`);
  for (const r of ready) {
    const m = r.macros;
    const fatShare = m.kcal > 0 ? (m.fat * 9) / m.kcal : 0;
    console.log(`  ${r.snack ? 'SNACK' : 'meal '} ${r.name.padEnd(46)} ${String(Math.round(m.kcal)).padStart(4)} kcal  P${String(Math.round(m.protein)).padStart(3)} F${String(Math.round(m.fat)).padStart(3)} C${String(Math.round(m.carb)).padStart(3)}  fat ${(100 * fatShare).toFixed(0)}% of kcal`);
  }
  if (skipped.length) {
    console.log(`\nskipped: ${skipped.length}`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  if (!APPLY) { console.log('\nREPORT ONLY — nothing written.'); await prisma.$disconnect(); return; }

  let n = 0;
  for (const r of ready) {
    await prisma.recipe.create({
      data: {
        name: r.name,
        description: null,
        steps: r.steps,
        slotType: r.snack ? 'snack' : 'meal',
        cuisine: r.cuisine ?? null,
        prepTimeMin: r.prep ?? null,
        difficulty: r.difficulty ?? null,
        mealCategory: null,
        source: 'curated',
        kcal: r.macros.kcal, protein: r.macros.protein, fat: r.macros.fat, carb: r.macros.carb,
        ingredients: {
          create: r.resolved.map((x) => ({ foodId: x.food.id, baseGrams: x.grams, role: x.role, scalable: x.scalable })),
        },
      },
    });
    n++;
  }
  console.log(`\ninserted ${n} recipe(s)`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('FAILED:', e && e.stack); try { await prisma.$disconnect(); } catch {} process.exitCode = 1; });
