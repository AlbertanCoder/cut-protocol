const {recipes} = require('./loadpool.cjs');
const sum = r => r.ingredients.reduce((s,i)=>{if(!i.food)return s;const f=i.baseGrams/100; s.kcal+=i.food.kcal*f; s.protein+=i.food.protein*f; s.fat+=i.food.fat*f; s.carb+=i.food.carb*f; return s;},{kcal:0,protein:0,fat:0,carb:0});
let n=0, drift=[], big=[];
for (const r of recipes){ const s=sum(r); n++;
  const dk = r.kcal>0? Math.abs(s.kcal-r.kcal)/r.kcal : (s.kcal>0?1:0);
  const dp = r.protein>0? Math.abs(s.protein-r.protein)/r.protein : (s.protein>0?1:0);
  drift.push({name:r.name, dk, dp, ck:r.kcal, sk:s.kcal, cp:r.protein, sp:s.protein});
}
const gt = (a,t)=>a.filter(x=>x.dk>t).length;
console.log('recipes:',n);
console.log('cached-vs-ingredient-sum kcal drift >1%:',gt(drift,0.01),' >5%:',gt(drift,0.05),' >15%:',gt(drift,0.15));
console.log('protein drift >1%:',drift.filter(x=>x.dp>0.01).length,' >5%:',drift.filter(x=>x.dp>0.05).length,' >15%:',drift.filter(x=>x.dp>0.15).length);
console.log('\nworst 15 by kcal drift:');
console.log(drift.sort((a,b)=>b.dk-a.dk).slice(0,15).map(x=>`  ${(100*x.dk).toFixed(2)}%  ${x.name}  cached=${x.ck.toFixed(0)} sum=${x.sk.toFixed(0)}`).join('\n'));

// Atwater check on the recipe as stored (constitution rule 5)
let atw=0, atwList=[];
for (const r of recipes){ const pred = 4*r.protein+4*r.carb+9*r.fat; if (r.kcal>20 && Math.abs(pred-r.kcal)/r.kcal > 0.15){atw++; atwList.push({n:r.name, k:r.kcal, pred, off:(pred-r.kcal)/r.kcal});} }
console.log('\nrecipes failing 15% Atwater on CACHED macros:', atw, '('+(100*atw/recipes.length).toFixed(1)+'%)');
console.log(atwList.sort((a,b)=>Math.abs(b.off)-Math.abs(a.off)).slice(0,12).map(x=>`  ${(100*x.off).toFixed(0)}%  ${x.n} kcal=${x.k.toFixed(0)} atwater=${x.pred.toFixed(0)}`).join('\n'));

// implausible recipes: absurd protein or kcal
const abs = recipes.map(r=>({n:r.name, k:r.kcal, p:r.protein, pd: r.kcal>0?100*r.protein/r.kcal:0}));
console.log('\nrecipes with cached kcal > 3000:', abs.filter(x=>x.k>3000).length);
console.log(abs.filter(x=>x.k>3000).sort((a,b)=>b.k-a.k).slice(0,15).map(x=>`  ${x.k.toFixed(0)} kcal / ${x.p.toFixed(0)}g P — ${x.n}`).join('\n'));
console.log('\nrecipes with protein density > 15 g/100kcal (physically near meat/egg-white limit ~25):', abs.filter(x=>x.pd>15).length);
console.log(abs.filter(x=>x.pd>15).sort((a,b)=>b.pd-a.pd).slice(0,15).map(x=>`  ${x.pd.toFixed(1)} g/100kcal — ${x.n} (${x.k.toFixed(0)} kcal, ${x.p.toFixed(0)}g P)`).join('\n'));
console.log('\nrecipes with kcal < 100:', abs.filter(x=>x.k<100).length, '| kcal < 50:', abs.filter(x=>x.k<50).length);
