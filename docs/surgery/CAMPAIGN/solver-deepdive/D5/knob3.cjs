const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const WP = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/weeklyPlanner.js");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const pShare = f => f.kcal>0 ? (4*f.protein)/f.kcal : 0;
const dead = r => r.ingredients.filter(i=>i.scalable&&i.role==='protein').length===0;
const retagB = r=>({...r, ingredients:r.ingredients.map(i=> (i.role==null && i.food && (pShare(i.food)>=0.25||i.food.protein>=15)) ? {...i,role:'protein'} : i)});
const STYLES=['none','vegetarian','vegan','paleo','keto','kosher','halal','mediterranean'];
const K=512, P=K*0.0816;
const rows=[];
for (const s of STYLES){
  const pool = GATE.filterRecipes(recipes,{dietaryStyle:s,excludedFoods:[]}).filter(mealOK);
  const n=pool.length; if(!n) continue;
  const deadN = pool.filter(dead).length;
  let a=0,b=0, aP=0,bP=0;
  for (const r of pool){
    let x=WP.scaleRecipe(r,K,P); if(Math.abs(x.kcal-K)/K<=0.15 && Math.max(0,(P-x.protein)/P)<=0.12) a++;
    if (Math.max(0,(P-x.protein)/P)<=0.12) aP++;
    let y=WP.scaleRecipe(retagB(r),K,P); if(Math.abs(y.kcal-K)/K<=0.15 && Math.max(0,(P-y.protein)/P)<=0.12) b++;
    if (Math.max(0,(P-y.protein)/P)<=0.12) bP++;
  }
  rows.push({style:s, mealPool:n, deadKnob:deadN, deadPct:+(100*deadN/n).toFixed(1),
    bothOK_today:+(100*a/n).toFixed(1), bothOK_retag:+(100*b/n).toFixed(1),
    proteinOK_today:+(100*aP/n).toFixed(1), proteinOK_retag:+(100*bP/n).toFixed(1)});
}
console.table(rows);
