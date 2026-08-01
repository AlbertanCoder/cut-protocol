const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('./dev-copy.db');
const q = s => db.prepare(s).all();
const ings = q("SELECT ri.recipeId, ri.baseGrams, ri.scalable, ri.role, f.id fid, f.name fname, f.kcal fk, f.protein fp, f.fat ff, f.carb fc, f.category fcat FROM RecipeIngredient ri JOIN Food f ON f.id=ri.foodId");
// numeric property: protein energy share = 4*P / kcal ; and grams of protein per 100g
const pShare = i => i.fk>0 ? (4*i.fp)/i.fk : 0;

// FALSE POSITIVES: tagged protein but low protein density
const fp = ings.filter(i=>i.role==='protein');
const fpBad = fp.filter(i=> pShare(i) < 0.20);
console.log('=== tagged role=protein:', fp.length, ' | with protein-energy-share <20%:', fpBad.length, (100*fpBad.length/fp.length).toFixed(1)+'%');
const agg = new Map();
for (const i of fpBad) { const k=i.fname; agg.set(k,(agg.get(k)||0)+1); }
console.log([...agg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([n,c])=>`  ${c}x ${n}`).join('\n'));
console.log('\n-- worst 20 by protein share --');
console.log(fpBad.sort((a,b)=>pShare(a)-pShare(b)).slice(0,20).map(i=>`  ${i.fname} | ${i.fp}gP/100g ${i.fk}kcal/100g share=${(100*pShare(i)).toFixed(1)}%`).join('\n'));

// FALSE NEGATIVES: high-protein foods NOT tagged protein
const fn = ings.filter(i=>i.role!=='protein');
const fnBad = fn.filter(i=> pShare(i) >= 0.40 && i.fp >= 10);
console.log('\n=== NOT tagged protein:', fn.length, ' | with protein-energy-share>=40% AND >=10gP/100g:', fnBad.length, (100*fnBad.length/fn.length).toFixed(1)+'%');
const agg2 = new Map();
for (const i of fnBad) { const k=i.fname+' ['+(i.role||'NULL')+']'; agg2.set(k,(agg2.get(k)||0)+1); }
console.log([...agg2.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([n,c])=>`  ${c}x ${n}`).join('\n'));
// by role
const byRole = new Map();
for (const i of fnBad) byRole.set(i.role||'NULL',(byRole.get(i.role||'NULL')||0)+1);
console.log('\nmis-roled high-protein ingredients by current role:', JSON.stringify([...byRole.entries()]));
