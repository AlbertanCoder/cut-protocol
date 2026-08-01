const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const bad = f => f && (f.source==='quarantined' || f.source==='manual-placeholder');
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
let aff=[], affMeal=0;
for (const r of recipes){
  const tot = r.ingredients.reduce((s,i)=>s+(i.food?i.food.kcal*i.baseGrams/100:0),0);
  const q = r.ingredients.filter(i=>bad(i.food));
  if (!q.length) continue;
  const qk = q.reduce((s,i)=>s+i.food.kcal*i.baseGrams/100,0);
  const qp = q.reduce((s,i)=>s+i.food.protein*i.baseGrams/100,0);
  aff.push({name:r.name, n:q.length, share: tot>0?qk/tot:0, pShare: r.protein>0?qp/r.protein:0, meal:mealOK(r), foods:q.map(i=>i.food.name)});
  if (mealOK(r)) affMeal++;
}
console.log('recipes containing a QUARANTINED / placeholder food:', aff.length, '('+(100*aff.length/recipes.length).toFixed(1)+'% of 910) | of which meal-eligible:', affMeal);
console.log('their quarantined-kcal share: med='+(100*D(aff.map(x=>x.share),.5)).toFixed(1)+'% p90='+(100*D(aff.map(x=>x.share),.9)).toFixed(1)+'% max='+(100*D(aff.map(x=>x.share),1)).toFixed(1)+'%');
console.log('recipes where >20% of kcal comes from a quarantined row:', aff.filter(x=>x.share>0.20).length, '| >50%:', aff.filter(x=>x.share>0.50).length);
console.log('\ntop 15 by quarantined-kcal share:');
console.log(aff.sort((a,b)=>b.share-a.share).slice(0,15).map(x=>`  ${(100*x.share).toFixed(0)}% kcal  ${x.name} [meal=${x.meal}] <- ${x.foods.join(', ')}`).join('\n'));
// distinct quarantined foods used, with macros
const {db}=require('./loadpool.cjs');
const rows=db.prepare("SELECT f.name, f.kcal, f.protein, f.fat, f.carb, COUNT(*) uses, COUNT(DISTINCT ri.recipeId) recipes FROM RecipeIngredient ri JOIN Food f ON f.id=ri.foodId WHERE f.source IN ('quarantined','manual-placeholder') GROUP BY f.id ORDER BY uses DESC LIMIT 25").all();
console.log('\nmost-used quarantined foods:');
console.log(rows.map(r=>`  ${r.uses} uses / ${r.recipes} recipes — ${r.name} (${r.kcal} kcal, ${r.protein}gP, ${r.fat}gF, ${r.carb}gC per 100g)`).join('\n'));
