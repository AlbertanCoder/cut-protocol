const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
console.log('NON_MEAL_CATEGORIES =', [...NON_MEAL_CATEGORIES]);
const STYLES=['none','mediterranean','halal','kosher','vegetarian','vegan','paleo','keto','carnivore'];
console.log('\n=== eligible pool by slotType, per diet (product rule: slotType match + NON_MEAL_CATEGORIES excluded from meal slots) ===');
const tbl=[];
for (const s of STYLES){
  const pool = GATE.filterRecipes(recipes, {dietaryStyle:s, excludedFoods:[]});
  const meal = pool.filter(r=>(r.slotType==='meal'||r.slotType==='either') && !NON_MEAL_CATEGORIES.has(r.mealCategory));
  const snack = pool.filter(r=>(r.slotType==='snack'||r.slotType==='either'));
  tbl.push({style:s, pool:pool.length, mealSlot:meal.length, snackSlot:snack.length});
}
console.table(tbl);
// snack recipes listed
const sn = recipes.filter(r=>r.slotType==='snack'||r.slotType==='either');
console.log('\nALL snack-eligible recipes ('+sn.length+'):');
const den=r=>r.kcal>0?100*r.protein/r.kcal:0;
console.log(sn.map(r=>`  ${r.name} | slotType=${r.slotType} | ${r.kcal.toFixed(0)} kcal | ${den(r).toFixed(1)} gP/100kcal | ${r.source}`).join('\n'));
// recipes rejected from meal slots by mealCategory
const rej = recipes.filter(r=>NON_MEAL_CATEGORIES.has(r.mealCategory));
console.log('\nrecipes barred from MEAL slots by mealCategory:', rej.length);
const m=new Map(); for(const r of rej) m.set(r.mealCategory,(m.get(r.mealCategory)||0)+1);
console.log(JSON.stringify([...m.entries()]));
console.log('\nUSABLE-IN-ANY-SLOT pool = meal-eligible only. Recipes usable in NEITHER slot type:', recipes.filter(r=>{
  const mealOK=(r.slotType==='meal'||r.slotType==='either') && !NON_MEAL_CATEGORIES.has(r.mealCategory);
  const snackOK=(r.slotType==='snack'||r.slotType==='either');
  return !mealOK && !snackOK;}).length);
