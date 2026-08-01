const {recipes, db} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const D=(a,p)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
const all = db.prepare("SELECT id,name,source,dataQuality FROM Food WHERE dataQuality IS NOT NULL").all();
const cls = f => {
  const d=f.dataQuality;
  if (/^quarantined/.test(d)) return 'QUARANTINED (macros known wrong, unrepaired)';
  if (/NEEDS A HUMAN DECISION/.test(d)) return 'NEEDS A HUMAN DECISION';
  if (/^provenance-restored/.test(d)) return 'provenance-restored (REPAIRED)';
  return 'other';
};
const m=new Map(); for(const f of all){const c=cls(f); m.set(c,(m.get(c)||0)+1);}
console.log('Food rows with a dataQuality note:', all.length);
console.table([...m.entries()].map(([k,v])=>({classification:k,foods:v})));
const BAD = new Set(all.filter(f=>cls(f).startsWith('QUARANTINED')||cls(f)==='NEEDS A HUMAN DECISION').map(f=>f.id));
console.log('\nUNTRUSTWORTHY set (quarantined + needs-human-decision):', BAD.size);
const used = db.prepare("SELECT COUNT(DISTINCT foodId) c FROM RecipeIngredient").all()[0].c;
const rows=[];
for (const r of recipes){
  const tot=r.ingredients.reduce((s,i)=>s+(i.food?i.food.kcal*i.baseGrams/100:0),0);
  const totP=r.ingredients.reduce((s,i)=>s+(i.food?i.food.protein*i.baseGrams/100:0),0);
  const b=r.ingredients.filter(i=>i.food&&BAD.has(i.food.id));
  if(!b.length) continue;
  rows.push({name:r.name, meal:mealOK(r),
    kShare: tot>0? b.reduce((s,i)=>s+i.food.kcal*i.baseGrams/100,0)/tot : 0,
    pShare: totP>0? b.reduce((s,i)=>s+i.food.protein*i.baseGrams/100,0)/totP : 0});
}
console.log('recipes touched by an UNTRUSTWORTHY food row:', rows.length, '('+(100*rows.length/910).toFixed(1)+'%) | meal-eligible:', rows.filter(x=>x.meal).length);
console.log('  kcal share: med '+(100*D(rows.map(x=>x.kShare),.5)).toFixed(1)+'% p90 '+(100*D(rows.map(x=>x.kShare),.9)).toFixed(1)+'%  | >25% of kcal: '+rows.filter(x=>x.kShare>0.25).length+' | >50%: '+rows.filter(x=>x.kShare>0.50).length);
console.log('  protein share: med '+(100*D(rows.map(x=>x.pShare),.5)).toFixed(1)+'% | >25% of protein: '+rows.filter(x=>x.pShare>0.25).length+' | >50%: '+rows.filter(x=>x.pShare>0.50).length);
console.log('\nworst meal-eligible (by kcal share):');
console.log(rows.filter(x=>x.meal).sort((a,b)=>b.kShare-a.kShare).slice(0,15).map(x=>`  ${(100*x.kShare).toFixed(0)}% kcal / ${(100*x.pShare).toFixed(0)}% protein — ${x.name}`).join('\n'));
// per-diet exposure
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {GATE}=require('./loadpool.cjs');
console.log('\nper-diet meal-pool exposure to untrustworthy rows:');
for (const s of ['none','vegetarian','vegan','paleo','keto','kosher','halal','mediterranean']){
  const pool=GATE.filterRecipes(recipes,{dietaryStyle:s,excludedFoods:[]}).filter(mealOK);
  const t=pool.filter(r=>r.ingredients.some(i=>i.food&&BAD.has(i.food.id))).length;
  console.log(`  ${s}: ${t}/${pool.length} = ${(100*t/pool.length).toFixed(1)}%`);
}
