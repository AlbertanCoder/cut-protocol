const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const vg = new Set(GATE.filterRecipes(recipes,{dietaryStyle:'vegan',excludedFoods:[]}).map(r=>r.id));
const vt = GATE.filterRecipes(recipes,{dietaryStyle:'vegetarian',excludedFoods:[]});
const delta = vt.filter(r=>!vg.has(r.id));
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
const den=r=>r.kcal>0?100*r.protein/r.kcal:0;
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
console.log('vegetarian pool',vt.length,'| vegan pool',vg.size,'| delta (veg-only)',delta.length);
console.log('delta protein density: p10='+D(delta.map(den),.1).toFixed(2)+' med='+D(delta.map(den),.5).toFixed(2)+' p90='+D(delta.map(den),.9).toFixed(2));
const dm=delta.filter(mealOK), du=delta.filter(r=>!mealOK(r)&&!(r.slotType==='snack'||r.slotType==='either'));
console.log('  of the delta: meal-eligible='+dm.length+' (med '+D(dm.map(den),.5).toFixed(2)+') | UNSERVABLE='+du.length+' (med '+D(du.map(den),.5).toFixed(2)+')');
const cats=new Map(); for(const r of delta) cats.set(r.mealCategory||'null',(cats.get(r.mealCategory||'null')||0)+1);
console.log('  delta by mealCategory:',JSON.stringify([...cats.entries()]));
console.log('\nlowest-density delta recipes (A11 named Churros/Eton Mess/cookies):');
console.log(delta.map(r=>({n:r.name,d:den(r),c:r.mealCategory,m:mealOK(r)})).sort((a,b)=>a.d-b.d).slice(0,12).map(x=>`  ${x.d.toFixed(2)} ${x.n} [${x.c||'null'}] mealEligible=${x.m}`).join('\n'));

// AUTHORING SIM: how many new recipes at density X are needed to move the vegetarian MEAL pool median to the 8.16 target?
const base = vt.filter(mealOK).map(den).sort((a,b)=>a-b);
console.log('\n=== authoring simulation: vegetarian MEAL-eligible pool (n='+base.length+', median '+D(base,.5).toFixed(2)+') ===');
for (const dens of [10,12,15]) {
  for (const N of [10,25,50,75,100,150,200]) {
    const merged=[...base, ...Array(N).fill(dens)].sort((a,b)=>a-b);
    const med=D(merged,.5), frac=merged.filter(x=>x>=8.16).length/merged.length;
    if (med>=8.16) { console.log(`  new recipes @ ${dens} gP/100kcal: N=${N} -> median ${med.toFixed(2)} (>=target), ${(100*frac).toFixed(1)}% of pool at-or-above target`); break; }
  }
}
for (const dens of [10,12,15]) {
  const line=[];
  for (const N of [0,25,50,100,200]) { const merged=[...base,...Array(N).fill(dens)].sort((a,b)=>a-b); line.push(`N=${N}:med ${D(merged,.5).toFixed(2)}/frac ${(100*merged.filter(x=>x>=8.16).length/merged.length).toFixed(0)}%`); }
  console.log('  @'+dens+' gP/100kcal  '+line.join('  '));
}
// same for none
const bn = recipes.filter(mealOK).map(den).sort((a,b)=>a-b);
console.log('\nomnivore MEAL pool n='+bn.length+' med='+D(bn,.5).toFixed(2)+' frac>=8.16='+(100*bn.filter(x=>x>=8.16).length/bn.length).toFixed(1)+'%');
for (const dens of [12]) { const line=[]; for(const N of [0,50,100,200,400]){const m=[...bn,...Array(N).fill(dens)].sort((a,b)=>a-b); line.push(`N=${N}:med ${D(m,.5).toFixed(2)}/frac ${(100*m.filter(x=>x>=8.16).length/m.length).toFixed(0)}%`);} console.log('  @'+dens+'  '+line.join('  ')); }
