// Uses the PRODUCT scaleRecipe (read-only import) against the D5 DB copy.
const fs=require('fs');
const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const WP = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/weeklyPlanner.js");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const pool = recipes.filter(mealOK);
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};

// Representative slot: median meal target 512 kcal, protein target at the target
// median density 8.16 g/100kcal => 41.8 g.
const KT=512, PT=512*0.0816;
console.log(`representative meal slot: ${KT} kcal / ${PT.toFixed(1)} g protein (target median density 8.16)`);

let hitBoth=0, kcalOnly=0, protOnly=0, neither=0, pinned=0;
const shortfalls=[];
for (const r of pool){
  const s = WP.scaleRecipe(r, KT, PT);
  const kOff = Math.abs(s.kcal-KT)/KT;
  const pShort = Math.max(0,(PT-s.protein)/PT);
  const ok = kOff<=0.15 && pShort<=0.12;
  if (ok) hitBoth++; else if (kOff<=0.15) kcalOnly++; else if (pShort<=0.12) protOnly++; else neither++;
  if (s.proteinScale<=0.5001||s.proteinScale>=1.9999||s.sidesScale<=0.5001||s.sidesScale>=1.9999) pinned++;
  shortfalls.push({name:r.name, ok, kOff, pShort, ps:s.proteinScale, ss:s.sidesScale, dead: r.ingredients.filter(i=>i.scalable&&i.role==='protein').length===0});
}
const n=pool.length;
console.log(`meal pool n=${n}: BOTH ok ${hitBoth} (${(100*hitBoth/n).toFixed(1)}%) | kcal-only ${kcalOnly} | protein-only ${protOnly} | neither ${neither}`);
console.log(`slots landing PINNED at a 0.5x/2x scale bound: ${pinned} (${(100*pinned/n).toFixed(1)}%)`);
const dead = shortfalls.filter(x=>x.dead), live = shortfalls.filter(x=>!x.dead);
console.log(`\nsplit by protein-knob liveness (this is the D5 headline):`);
console.log(`  LIVE knob  n=${live.length}: ${(100*live.filter(x=>x.ok).length/live.length).toFixed(1)}% hit both tolerances | median protein shortfall ${(100*D(live.map(x=>x.pShort),.5)).toFixed(1)}%`);
console.log(`  DEAD knob  n=${dead.length}: ${(100*dead.filter(x=>x.ok).length/dead.length).toFixed(1)}% hit both tolerances | median protein shortfall ${(100*D(dead.map(x=>x.pShort),.5)).toFixed(1)}%`);
console.log(`  pinned-at-bound: LIVE ${(100*live.filter(x=>x.ps<=0.5001||x.ps>=1.9999||x.ss<=0.5001||x.ss>=1.9999).length/live.length).toFixed(1)}% | DEAD ${(100*dead.filter(x=>x.ps<=0.5001||x.ps>=1.9999||x.ss<=0.5001||x.ss>=1.9999).length/dead.length).toFixed(1)}%`);

// COUNTERFACTUAL: retag with the numeric rule and re-run the SAME product scaleRecipe
const pShare = f => f.kcal>0 ? (4*f.protein)/f.kcal : 0;
const retag = r => ({...r, ingredients: r.ingredients.map(i => {
  const isP = i.food && (pShare(i.food)>=0.25 || i.food.protein>=15);
  return isP ? {...i, role:'protein'} : i;
})});
let h2=0, p2=0;
const sf2=[];
for (const r of pool){ const s = WP.scaleRecipe(retag(r), KT, PT);
  const kOff=Math.abs(s.kcal-KT)/KT, pShort=Math.max(0,(PT-s.protein)/PT);
  if (kOff<=0.15 && pShort<=0.12) h2++;
  sf2.push({pShort, ok:kOff<=0.15&&pShort<=0.12});
}
console.log(`\nCOUNTERFACTUAL — retag role='protein' where the FOOD is >=25% protein-energy OR >=15 g P/100 g,`);
console.log(`  same product scaleRecipe, same slot: BOTH ok ${h2} (${(100*h2/n).toFixed(1)}%)  [was ${hitBoth} = ${(100*hitBoth/n).toFixed(1)}%]  delta ${(100*(h2-hitBoth)/n).toFixed(2)} pts`);
console.log(`  median protein shortfall: ${(100*D(sf2.map(x=>x.pShort),.5)).toFixed(1)}%  [was ${(100*D(shortfalls.map(x=>x.pShort),.5)).toFixed(1)}%]`);

// sweep slot targets to check the counterfactual is not a single-point artifact
console.log('\nsweep over slot targets (kcal, protein at 8.16 g/100kcal):');
for (const K of [300,400,512,650,800]) {
  const P=K*0.0816;
  let a=0,b=0;
  for (const r of pool){ let s=WP.scaleRecipe(r,K,P); if(Math.abs(s.kcal-K)/K<=0.15 && Math.max(0,(P-s.protein)/P)<=0.12) a++;
                          s=WP.scaleRecipe(retag(r),K,P); if(Math.abs(s.kcal-K)/K<=0.15 && Math.max(0,(P-s.protein)/P)<=0.12) b++; }
  console.log(`  ${K} kcal: today ${a} (${(100*a/n).toFixed(1)}%) -> retagged ${b} (${(100*b/n).toFixed(1)}%)  delta ${(100*(b-a)/n).toFixed(2)} pts`);
}
