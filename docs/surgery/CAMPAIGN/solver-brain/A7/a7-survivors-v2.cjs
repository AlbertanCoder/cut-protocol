/* A7 v2 — corrected gate. v1 used styleExcludedByMetadata (metadata arm ONLY)
   and let seal/whale/whey/cheese through a "vegan" filter on rows whose
   fdcCategory is NULL. v2 uses adjusterExcludedByStyle, the exported
   single-food equivalent of the internal excludedByStyle() union.
   Read-only. A7's OWN db copy. */
const { DatabaseSync } = require('node:sqlite');
const DF = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/dietaryFilter.js');

const DB = 'C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A7/dev.db';
const db = new DatabaseSync(DB, { readOnly: true });

const KILL = ['soy', 'gluten', 'peanuts', 'tree nuts', 'sesame', 'legumes'];
const STYLE = 'vegan';

const foods = db.prepare('select * from Food').all();

function reasonsFor(food) {
  const out = [];
  try { if (DF.adjusterExcludedByStyle(food, STYLE)) out.push('style:vegan'); } catch (e) { out.push('styleERR'); }
  for (const t of KILL) {
    try { if (DF.foodMatchesExclusionTerm(food, t)) out.push(t); } catch (e) { out.push('err:' + t); }
  }
  return out;
}

const rows = foods.map((f) => {
  const kcal = Number(f.kcal), pro = Number(f.protein);
  return {
    id: f.id, name: f.name || '', kcal, pro,
    dens: kcal > 0 ? (pro / kcal) * 100 : null,   // g protein per 100 kcal
    reasons: reasonsFor(f),
  };
});

const alive = rows.filter((r) => r.reasons.length === 0);
console.log('=== GATE (corrected) ===');
console.log('total Food rows        :', rows.length);
console.log('survive vegan+6 walls  :', alive.length);
const aliveScored = alive.filter((r) => r.dens !== null && r.kcal >= 20);
console.log('  ...with kcal>=20     :', aliveScored.length);

// sanity probe: the v1 bug must be gone
const SANITY = ['Chicken breast, cooked, skinless', 'Seal, bearded (Oogruk), meat, raw (Alaska Native)',
  'Beverages, Protein powder whey based', 'Cheese, Swiss, nonfat or fat free', 'Jumbo Shrimp'];
console.log('\n=== SANITY: these MUST be excluded under vegan ===');
for (const s of SANITY) {
  const r = rows.find((x) => x.name === s);
  console.log(`  ${r ? (r.reasons.length ? 'EXCLUDED [' + r.reasons.join(',') + ']' : '*** STILL LEAKS ***') : 'not found'}  ${s}`);
}

aliveScored.sort((a, b) => b.dens - a.dens);
console.log('\n=== TOP 45 SURVIVING FOODS BY PROTEIN g /100 kcal ===');
console.log('dens\tP/100g\tkcal/100g\tname');
for (const r of aliveScored.slice(0, 45)) {
  console.log(`${r.dens.toFixed(2)}\t${r.pro.toFixed(1)}\t${r.kcal.toFixed(0)}\t${r.name}`);
}

// ── named botany candidates, word-boundary matched ───────────────────────
const CAND = ['quinoa', 'amaranth', 'buckwheat', 'hemp', 'sunflower', 'pumpkin seed', 'pepita',
  'chia seed', 'spirulina', 'nutritional yeast', 'yeast extract', 'potato protein', 'oats',
  'flaxseed', 'mushroom', 'seitan', 'pea protein', 'mycoprotein', 'quorn', 'chlorella', 'moringa'];
console.log('\n=== NAMED CANDIDATES (word-boundary) ===');
for (const c of CAND) {
  const re = new RegExp('\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const hits = rows.filter((r) => re.test(r.name));
  const ok = hits.filter((h) => h.reasons.length === 0 && h.dens !== null);
  ok.sort((a, b) => b.dens - a.dens);
  const best = ok[0];
  let line = `${c}: rows=${hits.length} surviving=${ok.length}`;
  if (best) line += ` | best ${best.dens.toFixed(2)} g/100kcal (${best.pro}g P /${best.kcal} kcal) "${best.name}"`;
  if (hits.length && !ok.length) line += ` | ALL EXCLUDED [${[...new Set(hits.flatMap((h) => h.reasons))].join(',')}]`;
  console.log(line);
}

// ── recipe coverage ──────────────────────────────────────────────────────
const rcols = db.prepare('pragma table_info(RecipeIngredient)').all().map((r) => r.name);
console.log('\nRecipeIngredient COLS:', rcols.join(' | '));
const recipes = db.prepare('select * from Recipe').all();
console.log('Recipe rows:', recipes.length);
const ings = db.prepare('select * from RecipeIngredient').all();
const byRecipe = new Map();
for (const i of ings) {
  const k = i.recipeId;
  if (!byRecipe.has(k)) byRecipe.set(k, []);
  byRecipe.get(k).push(i);
}
const deadFoodIds = new Set(rows.filter((r) => r.reasons.length).map((r) => r.id));
let cleanRecipes = 0;
const cleanList = [];
for (const rec of recipes) {
  const list = byRecipe.get(rec.id) || [];
  if (!list.length) continue;
  const bad = list.some((i) => i.foodId && deadFoodIds.has(i.foodId));
  if (!bad) {
    cleanRecipes++;
    const kc = Number(rec.kcal), pr = Number(rec.protein);
    if (kc > 0) cleanList.push({ name: rec.name, kcal: kc, pro: pr, dens: (pr / kc) * 100 });
  }
}
console.log('recipes with >=1 ingredient row:', [...byRecipe.keys()].length);
console.log('recipes whose every ingredient survives the stack:', cleanRecipes);
cleanList.sort((a, b) => b.dens - a.dens);
console.log('\n=== TOP 20 SURVIVING RECIPES BY PROTEIN g /100 kcal ===');
for (const r of cleanList.slice(0, 20)) {
  console.log(`${r.dens.toFixed(2)}\t${r.pro.toFixed(1)}g P\t${r.kcal.toFixed(0)} kcal\t${r.name}`);
}
