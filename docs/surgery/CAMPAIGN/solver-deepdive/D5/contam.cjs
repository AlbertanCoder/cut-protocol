const {recipes, db} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
const BAD = new Set(db.prepare("SELECT id FROM Food WHERE dataQuality LIKE '%belong to a different food%' OR dataQuality LIKE '%another food''s macros%'").all().map(r=>r.id));
console.log('food rows self-declaring wrong macros:', BAD.size);
console.log('  by source:'); console.table(db.prepare("SELECT source, COUNT(*) c FROM Food WHERE dataQuality LIKE '%belong to a different food%' OR dataQuality LIKE '%another food''s macros%' GROUP BY source").all());
console.log('  used in >=1 recipe:', db.prepare("SELECT COUNT(DISTINCT f.id) c FROM Food f JOIN RecipeIngredient ri ON ri.foodId=f.id WHERE f.dataQuality LIKE '%belong to a different food%' OR f.dataQuality LIKE '%another food''s macros%'").all()[0].c);
const rows=[];
for (const r of recipes){
  const tot=r.ingredients.reduce((s,i)=>s+(i.food?i.food.kcal*i.baseGrams/100:0),0);
  const totP=r.ingredients.reduce((s,i)=>s+(i.food?i.food.protein*i.baseGrams/100:0),0);
  const b=r.ingredients.filter(i=>i.food&&BAD.has(i.food.id));
  if(!b.length) continue;
  const bk=b.reduce((s,i)=>s+i.food.kcal*i.baseGrams/100,0);
  const bp=b.reduce((s,i)=>s+i.food.protein*i.baseGrams/100,0);
  rows.push({name:r.name, meal:mealOK(r), kShare: tot>0?bk/tot:0, pShare: totP>0?bp/totP:0});
}
console.log('\nrecipes touched:', rows.length, '('+(100*rows.length/910).toFixed(1)+'%) | meal-eligible:', rows.filter(x=>x.meal).length);
console.log('kcal share from wrong-macro rows: med '+(100*D(rows.map(x=>x.kShare),.5)).toFixed(1)+'%  p90 '+(100*D(rows.map(x=>x.kShare),.9)).toFixed(1)+'%');
console.log('  >10% of kcal:', rows.filter(x=>x.kShare>0.10).length, '| >25%:', rows.filter(x=>x.kShare>0.25).length, '| >50%:', rows.filter(x=>x.kShare>0.50).length);
console.log('PROTEIN share from wrong-macro rows: med '+(100*D(rows.map(x=>x.pShare),.5)).toFixed(1)+'%  p90 '+(100*D(rows.map(x=>x.pShare),.9)).toFixed(1)+'%');
console.log('  >25% of the recipe\'s protein:', rows.filter(x=>x.pShare>0.25).length, '| >50%:', rows.filter(x=>x.pShare>0.50).length);
console.log('\nmeal-eligible recipes with >25% of their PROTEIN from a wrong-macro row (top 20):');
console.log(rows.filter(x=>x.meal&&x.pShare>0.25).sort((a,b)=>b.pShare-a.pShare).slice(0,20).map(x=>`  ${(100*x.pShare).toFixed(0)}% of protein / ${(100*x.kShare).toFixed(0)}% of kcal — ${x.name}`).join('\n'));
