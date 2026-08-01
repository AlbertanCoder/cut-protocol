// W1-5 C — did seedGapRecipes.mjs land in the niches? + F6 rest-of-pool on meal-eligible
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "backend/src/lib/x.js"));
const { PrismaClient } = require("@prisma/client");
const { filterRecipePool } = require("../../../backend/src/lib/planContext.js");
const { RECIPE_GATE_SELECT } = require("../../../backend/src/lib/exclusionGate.js");
const { NON_MEAL_CATEGORIES } = require("../../../backend/src/lib/recipeClassification.js");
const prisma = new PrismaClient();

const SEEDED = ["Lemon Herb Chicken with Rice and Green Beans","Steamed Cod with New Potatoes and Dill","Turkey and Quinoa Stuffed Peppers","Garlic Prawn and Asparagus Rice Bowl","Cottage Cheese and Tomato Rye Toast","Poached Chicken and Barley Broth","Baked Salmon with Buttered Asparagus","Chicken Thighs with Creamed Spinach","Steak with Garlic Mushrooms","Egg and Avocado Breakfast Plate","Tuna Niçoise Salad Bowl","Crispy Tofu and Lentil Bowl","Tempeh and Chickpea Traybake","Seitan Stir-Fry with Broccoli and Rice","Red Lentil and Spinach Dhal","Black Bean and Quinoa Burrito Bowl","Roasted Chickpeas with Paprika","Edamame with Sea Salt","Apple with Almond Butter","Hummus with Carrot and Cucumber","Peanut Butter Banana Toast","Cottage Cheese with Pineapple","Hard-Boiled Eggs with Chilli Salt","Cheese and Olive Plate","Greek Yogurt with Walnuts and Honey","Smoked Mackerel on Oatcakes"];

const q=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);const i=(s.length-1)*p;const lo=Math.floor(i),hi=Math.ceil(i);return +(s[lo]+(s[hi]-s[lo])*(i-lo)).toFixed(3);};
const isTpl=(r)=>r.source==="ai-generated"&&/^high-protein\b.*\bwith\b/i.test(r.name||"");
const eligible=(pool,st)=>pool.filter((r)=>(r.slotType===st||r.slotType==="either")&&(st!=="meal"||!NON_MEAL_CATEGORIES.has(r.mealCategory)));
const dens=(rs,k)=>rs.filter(r=>r.kcal>0).map(r=>(r[k]/r.kcal)*100);
const mean=(a)=>a.length?+(a.reduce((s,x)=>s+x,0)/a.length).toFixed(3):null;

const main=async()=>{
  const rows = await prisma.recipe.findMany({ select: RECIPE_GATE_SELECT });
  const byName = new Map(rows.map(r=>[r.name,r]));
  const landed=[],missing=[];
  for(const n of SEEDED){ const r=byName.get(n); if(r) landed.push(r); else missing.push(n); }

  const out={ seeded: SEEDED.length, landed: landed.length, missing };
  out.landedDetail = landed.map(r=>({name:r.name,slotType:r.slotType,mealCategory:r.mealCategory,source:r.source,kcal:+r.kcal.toFixed(1),
    pDens:+((r.protein/r.kcal)*100).toFixed(2), fDens:+((r.fat/r.kcal)*100).toFixed(2)}));

  // vegan pool with vs without the seeded rows
  const vegProfile={dietaryStyle:"vegan",excludedFoods:[]};
  const landedIds=new Set(landed.map(r=>r.id));
  const veganAll=filterRecipePool(rows,vegProfile);
  const veganPre=veganAll.filter(r=>!landedIds.has(r.id));
  const mk=(pool)=>{const m=eligible(pool,"meal"),s=eligible(pool,"snack");const pd=dens(m,"protein");
    return {pool:pool.length,meal:m.length,snack:s.length,p25:q(pd,.25),p50:q(pd,.5),p75:q(pd,.75),p90:q(pd,.9),
      snackP50:q(dens(s,"protein"),.5), snackFatP50:q(dens(s,"fat"),.5),
      mealAbove8_16:m.filter(r=>r.kcal>0&&(r.protein/r.kcal)*100>=8.16).length,
      mealTargetBox:m.filter(r=>r.kcal>0&&(r.protein/r.kcal)*100>=8.16&&(r.fat/r.kcal)*100<=2.60).length,
      snackAbove8_16:s.filter(r=>r.kcal>0&&(r.protein/r.kcal)*100>=8.16).length,
      snackTargetBox:s.filter(r=>r.kcal>0&&(r.protein/r.kcal)*100>=8.16&&(r.fat/r.kcal)*100<=2.60).length};};
  out.veganBefore=mk(veganPre); out.veganAfter=mk(veganAll);
  out.veganSnackRows=eligible(veganAll,"snack").map(r=>({name:r.name,kcal:+r.kcal.toFixed(0),pDens:+((r.protein/r.kcal)*100).toFixed(2),fDens:+((r.fat/r.kcal)*100).toFixed(2),seeded:landedIds.has(r.id)}));

  // whole-library snack before/after
  const snackAll=rows.filter(r=>r.slotType==="snack"||r.slotType==="either");
  out.snackLibBefore=snackAll.filter(r=>!landedIds.has(r.id)).length;
  out.snackLibAfter=snackAll.length;

  // F6 rest-of-pool restricted to MEAL-ELIGIBLE (brief quotes 5.28 / 4.73)
  const mealLib=rows.filter(r=>(r.slotType==="meal"||r.slotType==="either")&&!NON_MEAL_CATEGORIES.has(r.mealCategory));
  const tpl=mealLib.filter(isTpl), rest=mealLib.filter(r=>!isTpl(r));
  out.f6_mealEligible={ templates:tpl.length, rest:rest.length,
    tpl_p_mean:mean(dens(tpl,"protein")), tpl_p_med:q(dens(tpl,"protein"),.5),
    tpl_f_mean:mean(dens(tpl,"fat")),     tpl_f_med:q(dens(tpl,"fat"),.5),
    rest_p_mean:mean(dens(rest,"protein")),rest_p_med:q(dens(rest,"protein"),.5),
    rest_f_mean:mean(dens(rest,"fat")),   rest_f_med:q(dens(rest,"fat"),.5) };
  // whole library (incl. non-meal) rest
  const rest2=rows.filter(r=>!isTpl(r));
  out.f6_wholeLibraryRest={ n:rest2.length, p_mean:mean(dens(rest2,"protein")), p_med:q(dens(rest2,"protein"),.5), f_mean:mean(dens(rest2,"fat")), f_med:q(dens(rest2,"fat"),.5) };

  fs.writeFileSync("fleet/out/W1-5/seedgap.json",JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,1));
  await prisma.$disconnect();
};
main().catch(e=>{console.error(e);process.exit(1);});
