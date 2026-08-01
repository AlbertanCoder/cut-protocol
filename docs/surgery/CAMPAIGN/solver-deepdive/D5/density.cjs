const {recipes, GATE} = require('./loadpool.cjs');
const fs=require('fs');
const STYLES=['none','mediterranean','halal','kosher','vegetarian','vegan','paleo','keto','carnivore'];
const sum = r => r.ingredients.reduce((s,i)=>{const f=(i.food?i.baseGrams/100:0); if(!i.food) return s; s.kcal+=i.food.kcal*f; s.protein+=i.food.protein*f; s.fat+=i.food.fat*f; s.carb+=i.food.carb*f; return s;},{kcal:0,protein:0,fat:0,carb:0});
for (const r of recipes) r._sum = sum(r);
const den = (r,basis) => { const o = basis==='cached'? r : r._sum; return o.kcal>0 ? {p:100*o.protein/o.kcal, f:100*o.fat/o.kcal, c:100*o.carb/o.kcal} : null; };
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y); return s[Math.round((s.length-1)*p)];};
const decs = a => [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(p=>D(a,p).toFixed(2)).join(' ');
const TP=8.16, TF=2.60, TC=9.27;

const rows=[];
for (const basis of ['cached','recomputed']) {
  console.log('\n############ BASIS: '+basis+' ############');
  for (const s of STYLES) {
    const pool = GATE.filterRecipes(recipes, {dietaryStyle:s, excludedFoods:[]}).map(r=>den(r,basis)).filter(Boolean);
    const P=pool.map(x=>x.p), F=pool.map(x=>x.f), C=pool.map(x=>x.c);
    const pOK = P.filter(x=>x>=TP).length, fOK=F.filter(x=>x<=TF).length;
    const joint = pool.filter(x=>x.p>=TP && x.f<=TF).length;
    console.log(`\n-- ${s} (n=${pool.length}) --`);
    console.log('  protein g/100kcal deciles: '+decs(P));
    console.log('  fat     g/100kcal deciles: '+decs(F));
    console.log('  carb    g/100kcal deciles: '+decs(C));
    console.log(`  >= target-median protein ${TP}: ${pOK} (${(100*pOK/pool.length).toFixed(1)}%) | <= target-median fat ${TF}: ${fOK} (${(100*fOK/pool.length).toFixed(1)}%) | BOTH: ${joint} (${(100*joint/pool.length).toFixed(1)}%)`);
    rows.push({basis,style:s,n:pool.length,pMed:+D(P,.5).toFixed(2),fMed:+D(F,.5).toFixed(2),cMed:+D(C,.5).toFixed(2),pOK,fOK,joint});
  }
}
fs.writeFileSync('density-summary.json', JSON.stringify(rows,null,1));
