const {recipes} = require('./loadpool.cjs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const WP = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/weeklyPlanner.js");
const {NON_MEAL_CATEGORIES} = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/recipeClassification.js");
const mealOK=r=>(r.slotType==='meal'||r.slotType==='either')&&!NON_MEAL_CATEGORIES.has(r.mealCategory);
const pool = recipes.filter(mealOK);
const n=pool.length;
const pShare = f => f.kcal>0 ? (4*f.protein)/f.kcal : 0;
const dead = r => r.ingredients.filter(i=>i.scalable&&i.role==='protein').length===0;

const VARIANTS = {
  'A today (no change)': r=>r,
  'B fill NULL roles only, food >=25% pE OR >=15gP/100g': r=>({...r, ingredients:r.ingredients.map(i=> (i.role==null && i.food && (pShare(i.food)>=0.25||i.food.protein>=15)) ? {...i,role:'protein'} : i)}),
  'C fill NULL roles only, food >=40% pE AND >=10gP/100g': r=>({...r, ingredients:r.ingredients.map(i=> (i.role==null && i.food && pShare(i.food)>=0.40 && i.food.protein>=10) ? {...i,role:'protein'} : i)}),
  'D DEAD-knob recipes only: promote the single largest protein contributor': r=>{
    if(!dead(r)) return r;
    const cand = r.ingredients.filter(i=>i.scalable && i.food && i.food.protein>0)
      .map(i=>({i, g: i.food.protein*i.baseGrams/100})).sort((a,b)=>b.g-a.g)[0];
    if(!cand || cand.g < 3) return r;
    return {...r, ingredients:r.ingredients.map(x=> x===cand.i?{...x,role:'protein'}:x)};
  },
  'E DEAD-knob only: promote every scalable ing >=25% pE': r=>{
    if(!dead(r)) return r;
    return {...r, ingredients:r.ingredients.map(i=> (i.scalable&&i.food&&pShare(i.food)>=0.25)?{...i,role:'protein'}:i)};
  },
  'F dairy-eggs category -> protein where role is NULL': r=>({...r, ingredients:r.ingredients.map(i=> (i.role==null && i.food && i.food.category==='dairy-eggs')?{...i,role:'protein'}:i)}),
  'G Food.category==protein -> role protein where NULL (re-run backfill, additive)': r=>({...r, ingredients:r.ingredients.map(i=> (i.role==null && i.food && i.food.category==='protein')?{...i,role:'protein'}:i)}),
};
const Ks=[300,400,512,650,800];
const res={};
for (const [name,fn] of Object.entries(VARIANTS)){
  const line=[]; let deadN=0;
  for (const r of pool) if (dead(fn(r))) deadN++;
  for (const K of Ks){ const P=K*0.0816; let ok=0;
    for (const r of pool){ const s=WP.scaleRecipe(fn(r),K,P); if(Math.abs(s.kcal-K)/K<=0.15 && Math.max(0,(P-s.protein)/P)<=0.12) ok++; }
    line.push((100*ok/n).toFixed(1)+'%'); }
  res[name]={deadKnobRecipes:deadN, ...Object.fromEntries(Ks.map((K,i)=>[K+'kcal',line[i]]))};
}
console.table(res);
