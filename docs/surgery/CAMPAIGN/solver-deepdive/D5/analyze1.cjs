const {DatabaseSync} = require('node:sqlite');
const fs = require('fs');
const db = new DatabaseSync('./dev-copy.db');
const q = s => db.prepare(s).all();

const recipes = q("SELECT id,name,slotType,source,mealCategory,kcal,protein,fat,carb FROM Recipe");
const ings = q("SELECT ri.id,ri.recipeId,ri.foodId,ri.baseGrams,ri.scalable,ri.role, f.name fname, f.kcal fk, f.protein fp, f.fat ff, f.carb fc, f.category fcat, f.source fsource, f.dataQuality fdq FROM RecipeIngredient ri JOIN Food f ON f.id=ri.foodId");
const byRecipe = new Map();
for (const r of recipes) byRecipe.set(r.id, {...r, ings:[]});
let orphan = 0;
for (const i of ings) { const r = byRecipe.get(i.recipeId); if (!r) { orphan++; continue; } r.ings.push(i); }
console.log('ingredient rows joined to a Food:', ings.length, 'of', q("SELECT COUNT(*) c FROM RecipeIngredient")[0].c, '| orphan-recipe ings:', orphan);

const bundle = (list) => list.reduce((s,i)=>{const f=i.baseGrams/100; s.kcal+=i.fk*f; s.protein+=i.fp*f; s.fat+=i.ff*f; s.carb+=i.fc*f; return s;},{kcal:0,protein:0,fat:0,carb:0});

const out = [];
for (const r of byRecipe.values()) {
  const fixed = bundle(r.ings.filter(i=>!i.scalable));
  const scal  = r.ings.filter(i=>i.scalable);
  const pI = scal.filter(i=>i.role==='protein');
  const rI = scal.filter(i=>i.role!=='protein');
  const pB = bundle(pI), rB = bundle(rI);
  const all = bundle(r.ings);
  const det = pB.protein*rB.kcal - rB.protein*pB.kcal;
  out.push({
    id:r.id, name:r.name, slotType:r.slotType, source:r.source, mealCategory:r.mealCategory,
    cachedKcal:r.kcal, cachedP:r.protein, cachedF:r.fat, cachedC:r.carb,
    sumKcal:all.kcal, sumP:all.protein, sumF:all.fat, sumC:all.carb,
    fixedKcal:fixed.kcal, fixedP:fixed.protein,
    protBundleKcal:pB.kcal, protBundleP:pB.protein,
    restBundleKcal:rB.kcal, restBundleP:rB.protein,
    det, nIng:r.ings.length, nScal:scal.length, nProt:pI.length, nRest:rI.length,
  });
}
fs.writeFileSync('recipes-analysis.json', JSON.stringify(out));
const n = out.length;
const degen = out.filter(o=>o.nProt===0 || Math.abs(o.det)<1e-6);
console.log('DEGENERATE solve (falls back to uniform kcal-only scale):', degen.length, (100*degen.length/n).toFixed(1)+'%');
console.log('  of which nProt===0:', degen.filter(o=>o.nProt===0).length, '| det<1e-6 with protein ings present:', degen.filter(o=>o.nProt>0).length);
// fixed bundle share of kcal
const shares = out.map(o=> o.sumKcal>0 ? o.fixedKcal/o.sumKcal : 0).sort((a,b)=>a-b);
const pct = p => shares[Math.min(shares.length-1, Math.floor(p*shares.length))];
console.log('fixed-bundle kcal share deciles:', [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,.99].map(p=>(100*pct(p)).toFixed(1)+'%').join(' '));
console.log('recipes with fixed-kcal share >50%:', shares.filter(s=>s>0.5).length, '| >30%:', shares.filter(s=>s>0.3).length, '| =0:', shares.filter(s=>s===0).length);
