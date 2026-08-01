const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const WP = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/weeklyPlanner.js");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const D=(a,p)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
const den=r=>r.kcal>0?100*r.protein/r.kcal:0; const fden=r=>r.kcal>0?100*r.fat/r.kcal:0;
const tmpl = recipes.filter(WP.isGeneratedTemplate);
console.log('generated protein-forward templates (down-weighted 0.35x at draw time):', tmpl.length, 'of 910');
console.log('  protein density: med '+D(tmpl.map(den),.5).toFixed(2)+' | fat density med '+D(tmpl.map(fden),.5).toFixed(2));
const rest = recipes.filter(r=>!WP.isGeneratedTemplate(r) && mealOK(r));
console.log('  non-template meal pool: protein med '+D(rest.map(den),.5).toFixed(2)+' | fat med '+D(rest.map(fden),.5).toFixed(2));
console.log('\nper-diet: how much of the AT-OR-ABOVE-TARGET (>=8.16 gP/100kcal) meal supply is these templates?');
for (const s of ['none','vegetarian','vegan','paleo','keto','kosher','halal','mediterranean']){
  const pool=GATE.filterRecipes(recipes,{dietaryStyle:s,excludedFoods:[]}).filter(mealOK);
  const hi=pool.filter(r=>den(r)>=8.16);
  const hiT=hi.filter(WP.isGeneratedTemplate).length;
  const lean=pool.filter(r=>den(r)>=8.16 && fden(r)<=2.60);
  const leanT=lean.filter(WP.isGeneratedTemplate).length;
  console.log(`  ${s}: high-protein ${hi.length} (templates ${hiT} = ${hi.length?(100*hiT/hi.length).toFixed(0):0}%) | high-protein AND lean ${lean.length} (templates ${leanT} = ${lean.length?(100*leanT/lean.length).toFixed(0):0}%)`);
}
// AI-generated overall
console.log('\nsource composition of the omnivore MEAL pool:');
const pool=recipes.filter(mealOK); const m=new Map(); for(const r of pool) m.set(r.source,(m.get(r.source)||0)+1);
console.log(JSON.stringify([...m.entries()]));
const hi=pool.filter(r=>den(r)>=8.16); const m2=new Map(); for(const r of hi) m2.set(r.source,(m2.get(r.source)||0)+1);
console.log('source composition of the >=8.16 gP/100kcal SUBSET ('+hi.length+'):', JSON.stringify([...m2.entries()]));
const lean=pool.filter(r=>den(r)>=8.16&&fden(r)<=2.60); const m3=new Map(); for(const r of lean) m3.set(r.source,(m3.get(r.source)||0)+1);
console.log('source composition of the high-protein AND lean subset ('+lean.length+'):', JSON.stringify([...m3.entries()]));
