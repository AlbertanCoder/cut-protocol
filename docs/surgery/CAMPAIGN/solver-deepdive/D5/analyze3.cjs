const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('./dev-copy.db');
const q = s => db.prepare(s).all();
const recipes = q("SELECT id,name,slotType,source,mealCategory,kcal,protein FROM Recipe");
const ings = q("SELECT ri.recipeId, ri.baseGrams, ri.scalable, ri.role, f.name fname, f.kcal fk, f.protein fp, f.fat ff, f.carb fc, f.category fcat FROM RecipeIngredient ri JOIN Food f ON f.id=ri.foodId");
const byR = new Map(); for (const r of recipes) byR.set(r.id,{...r,ings:[]});
for (const i of ings) byR.get(i.recipeId).ings.push(i);
const pShare = i => i.fk>0 ? (4*i.fp)/i.fk : 0;

const dead = [...byR.values()].filter(r => r.ings.filter(i=>i.scalable && i.role==='protein').length === 0);
console.log('dead-protein-knob recipes:', dead.length);
// how much protein does the recipe actually carry (from ingredients)?
const gP = i => i.fp * i.baseGrams/100;
let rescuable=0, trulyNone=0;
const examples=[];
for (const r of dead) {
  const cands = r.ings.filter(i=>i.scalable && pShare(i)>=0.30 && i.fp>=8);
  const totP = r.ings.reduce((s,i)=>s+gP(i),0);
  if (cands.length>0) { rescuable++; if (examples.length<25) examples.push(`  ${r.name} [${r.source}] totP=${totP.toFixed(0)}g -> untagged proteins: `+cands.map(c=>`${c.fname}(${gP(c).toFixed(0)}gP, role=${c.role||'NULL'})`).join(', ')); }
  else trulyNone++;
}
console.log('  RESCUABLE (contains a scalable ingredient with >=30% protein energy & >=8gP/100g that is not tagged protein):', rescuable);
console.log('  genuinely protein-less:', trulyNone);
console.log(examples.join('\n'));

console.log('\n--- dead-knob recipes by source ---');
const bs=new Map(); for(const r of dead) bs.set(r.source,(bs.get(r.source)||0)+1);
console.log(JSON.stringify([...bs.entries()]));
console.log('--- dead-knob recipes by mealCategory ---');
const bc=new Map(); for(const r of dead) bc.set(r.mealCategory||'null',(bc.get(r.mealCategory||'null')||0)+1);
console.log(JSON.stringify([...bc.entries()]));
console.log('--- all recipes by source w/ dead-knob rate ---');
const tot=new Map(); for(const r of byR.values()) tot.set(r.source,(tot.get(r.source)||0)+1);
for (const [s,t] of tot) console.log(`  ${s}: ${bs.get(s)||0}/${t} = ${(100*(bs.get(s)||0)/t).toFixed(1)}%`);
console.log('--- all recipes by mealCategory w/ dead-knob rate ---');
const totc=new Map(); for(const r of byR.values()) totc.set(r.mealCategory||'null',(totc.get(r.mealCategory||'null')||0)+1);
for (const [s,t] of totc) console.log(`  ${s}: ${bc.get(s)||0}/${t} = ${(100*(bc.get(s)||0)/t).toFixed(1)}%`);
// protein density of dead-knob recipes vs live
const dens = r => { const k=r.ings.reduce((s,i)=>s+i.fk*i.baseGrams/100,0); const p=r.ings.reduce((s,i)=>s+gP(i),0); return k>0? 100*p/k : 0; };
const med = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
const live=[...byR.values()].filter(r=>r.ings.filter(i=>i.scalable&&i.role==='protein').length>0);
console.log('\nmedian protein density gP/100kcal: dead-knob='+med(dead.map(dens)).toFixed(2)+'  live-knob='+med(live.map(dens)).toFixed(2));
