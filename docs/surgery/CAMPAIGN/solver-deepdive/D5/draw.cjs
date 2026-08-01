const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const WP = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/weeklyPlanner.js");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const den=r=>r.kcal>0?100*r.protein/r.kcal:0, fden=r=>r.kcal>0?100*r.fat/r.kcal:0;
// pickRecipe weight, with only the factors that are pool properties (no usage/prior/bias/comp)
const targetRatio = 0.0816; // g protein per kcal
const W = r => (1/(Math.abs((r.kcal>0?r.protein/r.kcal:0)-targetRatio)+0.015)) * (WP.isGeneratedTemplate(r)?WP.GENERATED_TEMPLATE_WEIGHT:1);
console.log('DRAW-PROBABILITY MASS on the target corner (protein>=8.16 AND fat<=2.60 g/100kcal),');
console.log('computed with the product pickRecipe weight for a fresh slot (no usage/prior/bias/composition terms):\n');
const rows=[];
for (const s of ['none','vegetarian','vegan','paleo','keto','kosher','halal','mediterranean']){
  const pool=GATE.filterRecipes(recipes,{dietaryStyle:s,excludedFoods:[]}).filter(mealOK);
  const tot=pool.reduce((a,r)=>a+W(r),0);
  const corner=pool.filter(r=>den(r)>=8.16&&fden(r)<=2.60);
  const cw=corner.reduce((a,r)=>a+W(r),0);
  // counterfactual: down-weight removed
  const W2 = r => (1/(Math.abs((r.kcal>0?r.protein/r.kcal:0)-targetRatio)+0.015));
  const tot2=pool.reduce((a,r)=>a+W2(r),0), cw2=corner.reduce((a,r)=>a+W2(r),0);
  rows.push({style:s, pool:pool.length, cornerN:corner.length,
    cornerCountPct:+(100*corner.length/pool.length).toFixed(1),
    drawMassPct_shipping:+(100*cw/tot).toFixed(1),
    drawMassPct_ifDownweightRemoved:+(100*cw2/tot2).toFixed(1),
    pDrawIn5_shipping:+(100*(1-Math.pow(1-cw/tot,5))).toFixed(1),
    pDrawIn5_noDownweight:+(100*(1-Math.pow(1-cw2/tot2,5))).toFixed(1)});
}
console.table(rows);
console.log('(MAX_SLOT_ATTEMPTS draws 5 candidates per slot — pDrawIn5 = chance at least one of the 5 is in the target corner, treating draws as independent.)');
