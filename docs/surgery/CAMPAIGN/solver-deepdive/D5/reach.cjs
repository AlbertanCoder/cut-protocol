const fs=require('fs');
const {recipes, GATE} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const targets = JSON.parse(fs.readFileSync('targets.json','utf8'));
const personas = fs.readFileSync("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl","utf8").trim().split('\n').map(JSON.parse);
const tByID = new Map(targets.map(t=>[t.id,t]));

// exact product weighting: buildSlots + targetsForSlots
function slotTargets(meals, snacks, dayKcal, dayProteinMid){
  const w=[]; for(let i=0;i<meals;i++) w.push({type:'meal', weight: meals===1?1: i===meals-1?1.15: i===0?0.9:1});
  for(let i=0;i<snacks;i++) w.push({type:'snack', weight:0.4});
  const tot=w.reduce((s,x)=>s+x.weight,0);
  return w.map(x=>({type:x.type, kcal: dayKcal*x.weight/tot, protein: dayProteinMid*x.weight/tot}));
}
const rows=[];
let mealK=[], snackK=[];
for (const p of personas){
  const t=tByID.get(p.id); if(!t) continue;
  const st = slotTargets(p.profile.mealsPerDay, p.profile.snacksPerDay, t.kcal, t.pMid);
  for (const s of st){ (s.type==='meal'?mealK:snackK).push(s.kcal); }
  rows.push({id:p.id, style:p.dietaryStyle||'none', meals:p.profile.mealsPerDay, snacks:p.profile.snacksPerDay, horizon:p.horizon, st, kcal:t.kcal});
}
const D=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)];};
console.log('MEAL slot kcal target: n='+mealK.length+' p10='+D(mealK,.1).toFixed(0)+' med='+D(mealK,.5).toFixed(0)+' p90='+D(mealK,.9).toFixed(0)+' min='+D(mealK,0).toFixed(0)+' max='+D(mealK,1).toFixed(0));
console.log('SNACK slot kcal target: n='+snackK.length+' p10='+D(snackK,.1).toFixed(0)+' med='+D(snackK,.5).toFixed(0)+' p90='+D(snackK,.9).toFixed(0)+' min='+D(snackK,0).toFixed(0)+' max='+D(snackK,1).toFixed(0));

// reachability: recipe base kcal K serves target T iff 0.5K <= T <= 2K  =>  K in [T/2, 2T]
const mealMed=D(mealK,.5), snackMed=D(snackK,.5);
const mealPool = recipes.filter(r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory));
const snackPool = recipes.filter(r=>r.slotType==='snack'||r.slotType==='either');
const reach=(pool,T)=>pool.filter(r=>r.kcal>=T/2 && r.kcal<=2*T).length;
console.log('\nMEAL pool ('+mealPool.length+') reaching the MEDIAN meal target '+mealMed.toFixed(0)+' kcal under 0.5-2x: '+reach(mealPool,mealMed)+' ('+(100*reach(mealPool,mealMed)/mealPool.length).toFixed(1)+'%)');
console.log('  too small (base kcal < T/2): '+mealPool.filter(r=>r.kcal<mealMed/2).length+' | too big (> 2T): '+mealPool.filter(r=>r.kcal>2*mealMed).length);
console.log('SNACK pool ('+snackPool.length+') reaching the MEDIAN snack target '+snackMed.toFixed(0)+' kcal: '+reach(snackPool,snackMed)+' of '+snackPool.length);
console.log('  too small: '+snackPool.filter(r=>r.kcal<snackMed/2).length+' | too big: '+snackPool.filter(r=>r.kcal>2*snackMed).length);
// per-persona: mean % of meal pool reachable
const rr=[]; for(const r of rows){ for(const s of r.st){ if(s.type==='meal') rr.push(reach(mealPool,s.kcal)/mealPool.length); } }
console.log('\nper-MEAL-SLOT reachable fraction of the omnivore meal pool: p10='+(100*D(rr,.1)).toFixed(1)+'% med='+(100*D(rr,.5)).toFixed(1)+'% p90='+(100*D(rr,.9)).toFixed(1)+'%');
const rs=[]; for(const r of rows){ for(const s of r.st){ if(s.type==='snack') rs.push(reach(snackPool,s.kcal)/snackPool.length); } }
if (rs.length) console.log('per-SNACK-SLOT reachable fraction of the 18-recipe snack pool: p10='+(100*D(rs,.1)).toFixed(1)+'% med='+(100*D(rs,.5)).toFixed(1)+'% p90='+(100*D(rs,.9)).toFixed(1)+'%  (median = '+(D(rs,.5)*18).toFixed(1)+' recipes)');

// snack capacity vs demand, weekly, repeat cap 2
const STYLES=['none','mediterranean','halal','kosher','vegetarian','vegan','paleo','keto','carnivore'];
const snackByStyle={}; for(const s of STYLES) snackByStyle[s]=GATE.filterRecipes(recipes,{dietaryStyle:s,excludedFoods:[]}).filter(r=>r.slotType==='snack'||r.slotType==='either').length;
console.log('\n=== weekly snack capacity (pool x repeatCap 2) vs demand (7 x snacksPerDay) ===');
const cap=[];
for (const s of STYLES) for (const n of [1,2,3]) cap.push({style:s, snackPool:snackByStyle[s], weeklyCapacity:snackByStyle[s]*2, snacksPerDay:n, weeklyDemand:7*n, shortfall: Math.max(0, 7*n - snackByStyle[s]*2)});
console.table(cap.filter(c=>c.shortfall>0));
// how many WEEK-horizon personas hit a snack shortfall
let hit=0, tot=0;
for (const r of rows){ if(r.horizon!=='week'||r.snacks===0) continue; tot++; const capn=(snackByStyle[r.style]??18)*2; if (7*r.snacks>capn) hit++; }
console.log('week-horizon personas with snacks: '+tot+' | of those STRUCTURALLY unable to fill every snack slot: '+hit);
