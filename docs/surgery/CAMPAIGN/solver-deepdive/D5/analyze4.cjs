const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('./dev-copy.db'); const q=s=>db.prepare(s).all();
const recipes = q("SELECT id,name,source,mealCategory,kcal,protein FROM Recipe");
const ings = q("SELECT ri.recipeId, ri.baseGrams, ri.scalable, ri.role, f.name fname, f.category fcat, f.kcal fk, f.protein fp FROM RecipeIngredient ri JOIN Food f ON f.id=ri.foodId");
const byR=new Map(); for(const r of recipes) byR.set(r.id,{...r,ings:[]});
for(const i of ings) byR.get(i.recipeId).ings.push(i);

const MAP_BACKFILL = {protein:'protein',carb:'carb',veg:'veg',fat:'fat', 'fruit-veg':'veg','grains':'carb','fats-nuts-oils':'fat'};
const MAP_IMPORTER = {protein:'protein','dairy-eggs':'protein',grains:'carb','fruit-veg':'veg','fats-nuts-oils':'fat',pantry:'other',drinks:'other'};
const pShare = i => i.fk>0 ? (4*i.fp)/i.fk : 0;
const MAP_NUMERIC = i => (pShare(i)>=0.30 && i.fp>=8) ? 'protein' : null;

function deadCount(roleFn){
  let dead=0;
  for (const r of byR.values()) {
    const has = r.ings.some(i=>i.scalable && roleFn(i)==='protein');
    if (!has) dead++;
  }
  return dead;
}
console.log('TODAY dead-protein-knob recipes:', deadCount(i=>i.role));
console.log('re-run existing backfill map (category->role, protein/grains/fruit-veg/fats only):', deadCount(i=> MAP_BACKFILL[i.fcat] ?? i.role));
console.log('  strict (overwrite even non-null):', deadCount(i=> MAP_BACKFILL[i.fcat] ?? null));
console.log('importer map incl dairy-eggs->protein (fill nulls only):', deadCount(i=> i.role ?? MAP_IMPORTER[i.fcat] ?? null));
console.log('importer map (overwrite all):', deadCount(i=> MAP_IMPORTER[i.fcat] ?? null));
console.log('NUMERIC rule: protein iff >=30% protein-energy AND >=8gP/100g (else keep existing role):', deadCount(i=> MAP_NUMERIC(i) ?? i.role));
console.log('NUMERIC rule alone (replaces role entirely):', deadCount(i=> MAP_NUMERIC(i)));
console.log('NUMERIC loose: >=25% share OR >=15gP/100g, else keep:', deadCount(i=> ((pShare(i)>=0.25||i.fp>=15)?'protein':null) ?? i.role));

// role vs category drift
let drift=0, driftProt=0;
for (const i of ings){ const want = MAP_BACKFILL[i.fcat] ?? null; if (want!==null && i.role!==want) { drift++; if (want==='protein') driftProt++; } }
console.log('\nrows whose role disagrees with the backfill script\'s own category map:', drift, '(of which should be protein:', driftProt+')');

// tagged protein but food category is not protein/dairy
const oddProt = ings.filter(i=>i.role==='protein' && !['protein','dairy-eggs'].includes(i.fcat));
console.log('rows tagged protein whose Food.category is neither protein nor dairy-eggs:', oddProt.length);
const m=new Map(); for(const i of oddProt) m.set(i.fcat+' | '+i.fname,(m.get(i.fcat+' | '+i.fname)||0)+1);
console.log([...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,c])=>'  '+c+'x '+k).join('\n'));
