const {recipes} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
const pool = recipes.filter(mealOK);
const K = pool.map(r=>r.kcal);
console.log('MEAL-eligible recipe base kcal (per stored serving): deciles '+[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(p=>D(K,p).toFixed(0)).join(' '));
console.log('  <150 kcal:', K.filter(x=>x<150).length, '| >1200 kcal:', K.filter(x=>x>1200).length, '| >2000:', K.filter(x=>x>2000).length);
// reachable band under 0.5-2x vs the full observed meal-target range 143..2359 (p10 290, p90 878)
const cover = (lo,hi) => pool.filter(r=>2*r.kcal>=lo && 0.5*r.kcal<=hi).length;
console.log('\nrecipes whose 0.5-2x kcal band overlaps the CENTRAL meal-target range 290-878 kcal:', cover(290,878), '('+(100*cover(290,878)/pool.length).toFixed(1)+'%)');
console.log('recipes that can NEVER serve a 290-878 kcal slot:', pool.length-cover(290,878));
const outs = pool.filter(r=>!(2*r.kcal>=290 && 0.5*r.kcal<=878)).map(r=>({n:r.name,k:r.kcal,ing:r.ingredients.length,g:r.ingredients.reduce((s,i)=>s+i.baseGrams,0)}));
console.log('  too SMALL (2x < 290 kcal):', outs.filter(x=>2*x.k<290).length, '| too BIG (0.5x > 878 kcal):', outs.filter(x=>0.5*x.k>878).length);
console.log('\nlargest 15 (whole-pot rows the solver can never portion down):');
console.log(outs.filter(x=>0.5*x.k>878).sort((a,b)=>b.k-a.k).slice(0,15).map(x=>`  ${x.k.toFixed(0)} kcal / ${x.g.toFixed(0)} g total / ${x.ing} ingredients — ${x.n}`).join('\n'));
console.log('\nsmallest 10:');
console.log(outs.filter(x=>2*x.k<290).sort((a,b)=>a.k-b.k).slice(0,10).map(x=>`  ${x.k.toFixed(0)} kcal / ${x.g.toFixed(0)} g — ${x.n}`).join('\n'));
// total grams per recipe
const G = pool.map(r=>r.ingredients.reduce((s,i)=>s+i.baseGrams,0));
console.log('\ntotal base grams per meal recipe: deciles '+[0,.1,.25,.5,.75,.9,1].map(p=>D(G,p).toFixed(0)).join(' '));
console.log('recipes >1500 g total (a pot, not a plate):', G.filter(x=>x>1500).length, '| >2500 g:', G.filter(x=>x>2500).length);
