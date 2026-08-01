const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const WP = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/weeklyPlanner.js");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const den=r=>r.kcal>0?100*r.protein/r.kcal:0, fden=r=>r.kcal>0?100*r.fat/r.kcal:0;
// Full shipping weight for a FRESH slot: protein-diff x template x composition.
// Representative slot from the persona medians: 512 kcal, P 41.8 g (8.16/100kcal),
// fat 13.3 g (2.60/100kcal), carb 47.5 g (9.27/100kcal).
const T={kcalTarget:512, fatTarget:512*0.0260, carbTarget:512*0.0927};
const K=4;
const comp = r => { const wf=(T.fatTarget*9)/T.kcalTarget, gf=r.kcal>0?(r.fat*9)/r.kcal:0;
  const wc=(T.carbTarget*4)/T.kcalTarget, gc=r.kcal>0?(r.carb*4)/r.kcal:0;
  return 1/(1+K*((Math.abs(gf-wf)+Math.abs(gc-wc))/2)); };
const pd = r => 1/(Math.abs((r.kcal>0?r.protein/r.kcal:0)-0.0816)+0.015);
const Wship = r => pd(r)*(WP.isGeneratedTemplate(r)?WP.GENERATED_TEMPLATE_WEIGHT:1)*comp(r);
const Wno   = r => pd(r)*comp(r);
console.log('FULL shipping draw weight (protein-diff x template-downweight x compositionWeight),');
console.log('representative slot 512 kcal / 41.8 gP / 13.3 gF / 47.5 gC:\n');
const rows=[];
for (const s of ['none','vegetarian','vegan','paleo','keto','kosher','halal','mediterranean']){
  const pool=GATE.filterRecipes(recipes,{dietaryStyle:s,excludedFoods:[]}).filter(mealOK);
  const corner=pool.filter(r=>den(r)>=8.16&&fden(r)<=2.60);
  const t1=pool.reduce((a,r)=>a+Wship(r),0), c1=corner.reduce((a,r)=>a+Wship(r),0);
  const t2=pool.reduce((a,r)=>a+Wno(r),0),   c2=corner.reduce((a,r)=>a+Wno(r),0);
  rows.push({style:s, pool:pool.length, corner:corner.length,
    mass_shipping:+(100*c1/t1).toFixed(1), mass_noDownweight:+(100*c2/t2).toFixed(1),
    in5_shipping:+(100*(1-Math.pow(1-c1/t1,5))).toFixed(1), in5_noDownweight:+(100*(1-Math.pow(1-c2/t2,5))).toFixed(1)});
}
console.table(rows);
