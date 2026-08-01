const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const STYLES=['none','mediterranean','halal','kosher','vegetarian','vegan','paleo','keto','carnivore'];
const D=(a,p)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
const TP=8.16, TF=2.60;
const den=r=>({p:r.kcal>0?100*r.protein/r.kcal:0, f:r.kcal>0?100*r.fat/r.kcal:0, c:r.kcal>0?100*r.carb/r.kcal:0});
const rows=[];
for (const s of STYLES){
  const pool = GATE.filterRecipes(recipes, {dietaryStyle:s, excludedFoods:[]});
  const sets = {
    'ALL (A11 basis)': pool,
    'MEAL-slot eligible': pool.filter(r=>(r.slotType==='meal'||r.slotType==='either') && !NON_MEAL_CATEGORIES.has(r.mealCategory)),
    'SNACK-slot eligible': pool.filter(r=>r.slotType==='snack'||r.slotType==='either'),
    'UNSERVABLE (in neither)': pool.filter(r=>{const m=(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory); const k=(r.slotType==='snack'||r.slotType==='either'); return !m&&!k;}),
  };
  for (const [label,set] of Object.entries(sets)){
    const dd=set.map(den);
    rows.push({style:s, set:label, n:set.length,
      pP10:+D(dd.map(x=>x.p),.1).toFixed(2), pMed:+D(dd.map(x=>x.p),.5).toFixed(2), pP90:+D(dd.map(x=>x.p),.9).toFixed(2),
      fMed:+D(dd.map(x=>x.f),.5).toFixed(2), cMed:+D(dd.map(x=>x.c),.5).toFixed(2),
      nP_ge_target: dd.filter(x=>x.p>=TP).length, nF_le_target: dd.filter(x=>x.f<=TF).length,
      nBoth: dd.filter(x=>x.p>=TP&&x.f<=TF).length});
  }
}
console.table(rows.filter(r=>r.set!=='UNSERVABLE (in neither)'));
console.log('\n--- UNSERVABLE tier (recipes in the diet pool that NO slot can accept) ---');
console.table(rows.filter(r=>r.set==='UNSERVABLE (in neither)'));
require('fs').writeFileSync('slot-density.json', JSON.stringify(rows,null,1));
