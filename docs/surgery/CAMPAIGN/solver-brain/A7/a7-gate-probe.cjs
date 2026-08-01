/* A7 — is the "squirrel survives vegan" result reachable through the SHIPPING
   gate (exclusionGate.isExcluded), or only through adjusterExcludedByStyle,
   which macroCloser.js:23 says was "never wired into the solver"? */
const { DatabaseSync } = require('node:sqlite');
const GATE = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/exclusionGate.js');
const DF = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/dietaryFilter.js');
const db = new DatabaseSync('C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A7/dev.db', { readOnly: true });

console.log('exclusionGate exports:', Object.keys(GATE).join(', '));

// the persona profile, exactly as personas.mjs builds every-protein-walled
const profile = {
  dietaryStyle: 'vegan',
  excludedFoods: ['soy', 'gluten', 'peanuts', 'tree nuts', 'sesame', 'legumes'],
};

const PROBE = ['Squirrel', 'Groundhog', 'Armadillo', 'Wild pig', 'Heart',
  'Owl, horned, flesh, raw (Alaska Native)', 'Sea cucumber, yane (Alaska Native)',
  'Jellyfish, dried, salted', 'Ceviche', 'Nutritional powder mix (Isopure)',
  'Nutritional powder mix, protein, NFS', 'Egg Plants',
  'Chicken breast, cooked, skinless', 'Seeds, hemp seed, hulled'];

const foods = db.prepare('select * from Food').all();
console.log('\nname\tshippingGate.isExcluded\tadjusterExcludedByStyle');
for (const n of PROBE) {
  const f = foods.find((x) => x.name === n);
  if (!f) { console.log(`${n}\tNOT FOUND`); continue; }
  let ship = 'ERR', adj = 'ERR';
  try { ship = String(GATE.isExcluded(f, profile)); } catch (e) { ship = 'ERR:' + e.message.slice(0, 40); }
  try { adj = String(DF.adjusterExcludedByStyle(f, 'vegan')); } catch (e) { adj = 'ERR'; }
  console.log(`${n}\t${ship}\t${adj}`);
}

// full recount through the shipping gate
let alive = 0, aliveHiDens = [];
for (const f of foods) {
  let ex = true;
  try { ex = GATE.isExcluded(f, profile); } catch (e) { ex = true; }
  if (!ex) {
    alive++;
    const kcal = Number(f.kcal), pro = Number(f.protein);
    if (kcal >= 150 && pro / kcal * 100 >= 8) aliveHiDens.push({ n: f.name, d: pro / kcal * 100, pro, kcal });
  }
}
console.log(`\nSHIPPING GATE: ${alive} of ${foods.length} Food rows survive vegan + 6 walls`);
aliveHiDens.sort((a, b) => b.d - a.d);
console.log(`deliverable (kcal/100g>=150, dens>=8): ${aliveHiDens.length}`);
for (const r of aliveHiDens.slice(0, 25)) console.log(`  ${r.d.toFixed(2)}\t${r.pro}g/${r.kcal}kcal\t${r.n}`);
