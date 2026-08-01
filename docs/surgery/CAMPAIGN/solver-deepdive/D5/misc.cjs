const fs=require('fs');
const {recipes, db} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
// 1. dead SIDES knob
const deadSides = recipes.filter(r=>r.ingredients.filter(i=>i.scalable && i.role!=='protein').length===0);
console.log('recipes with a DEAD SIDES knob (no scalable non-protein ingredient):', deadSides.length);
console.log(deadSides.map(r=>`  ${r.name} — ${r.ingredients.map(i=>i.food.name+'['+(i.role||'NULL')+(i.scalable?'':',FIXED')+']').join(', ')}`).join('\n'));
// 2. protein knob AUTHORITY in grams: how much protein the protein bundle can add/shed within 0.5-2x
const pool = recipes.filter(mealOK);
const auth = pool.map(r=>{
  const pI=r.ingredients.filter(i=>i.scalable&&i.role==='protein');
  const pg = pI.reduce((s,i)=>s+i.food.protein*i.baseGrams/100,0);
  const tot = r.ingredients.reduce((s,i)=>s+i.food.protein*i.baseGrams/100,0);
  return {n:r.name, pg, tot, share: tot>0?pg/tot:0, upside: pg /*2x-1x*/};
});
console.log('\nprotein carried by the SCALABLE PROTEIN-ROLE bundle, as a share of the recipe\'s total protein (meal pool n='+pool.length+'):');
console.log('  deciles: '+[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(p=>(100*D(auth.map(x=>x.share),p)).toFixed(0)+'%').join(' '));
console.log('  recipes where the protein knob controls <25% of the recipe\'s protein:', auth.filter(x=>x.share<0.25).length, '('+(100*auth.filter(x=>x.share<0.25).length/pool.length).toFixed(1)+'%)');
console.log('  extra grams of protein the knob can add going 1x->2x: deciles '+[0,.1,.25,.5,.75,.9,1].map(p=>D(auth.map(x=>x.upside),p).toFixed(1)).join(' '));
console.log('  (a 512 kcal slot at the 8.16 target asks for 41.8 g)');
console.log('  recipes whose knob can add <10 g:', auth.filter(x=>x.upside<10).length, '| <5 g:', auth.filter(x=>x.upside<5).length);
// 3. foodOverrides status
const ov = JSON.parse(fs.readFileSync("C:/Users/<account>/Desktop/cut-protocol/backend/data/foodOverrides.json",'utf8'));
const keys = Array.isArray(ov)?ov.length:Object.keys(ov).length;
console.log('\nfoodOverrides.json entries:', keys, '| shape:', Array.isArray(ov)?'array':'object');
const sample = Array.isArray(ov)?ov[0]:ov[Object.keys(ov)[0]];
console.log('sample:', JSON.stringify(sample).slice(0,240));
// still-wrong rows self-declaring
const stillWrong = db.prepare("SELECT COUNT(*) c FROM Food WHERE dataQuality LIKE '%belong to a different food%' OR dataQuality LIKE '%another food''s macros%'").all()[0].c;
console.log('Food rows whose own dataQuality string still says the macros belong to another food:', stillWrong);
const usedWrong = db.prepare("SELECT COUNT(DISTINCT ri.recipeId) c FROM RecipeIngredient ri JOIN Food f ON f.id=ri.foodId WHERE f.dataQuality LIKE '%belong to a different food%' OR f.dataQuality LIKE '%another food''s macros%'").all()[0].c;
console.log('  recipes that use at least one such row:', usedWrong);
const restored = db.prepare("SELECT COUNT(*) c FROM Food WHERE dataQuality LIKE 'provenance-restored%'").all()[0].c;
console.log('Food rows marked provenance-restored:', restored);
