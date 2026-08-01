/* A7 — the decisive query. Botany wall vs library gap turns entirely on
   whether a LEGAL plant protein concentrate (survives vegan + soy + gluten +
   peanut + tree nut + sesame + legume) exists as a Food row.
   Read-only. A7's OWN db copy. */
const { DatabaseSync } = require('node:sqlite');
const DF = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/dietaryFilter.js');
const db = new DatabaseSync('C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A7/dev.db', { readOnly: true });

const KILL = ['soy', 'gluten', 'peanuts', 'tree nuts', 'sesame', 'legumes'];
const foods = db.prepare('select * from Food').all();
const rows = foods.map((f) => {
  const reasons = [];
  if (DF.adjusterExcludedByStyle(f, 'vegan')) reasons.push('style:vegan');
  for (const t of KILL) if (DF.foodMatchesExclusionTerm(f, t)) reasons.push(t);
  const kcal = Number(f.kcal), pro = Number(f.protein);
  return { name: f.name || '', kcal, pro, dens: kcal > 0 ? (pro / kcal) * 100 : null, reasons, src: f.source, dq: f.dataQuality };
});

console.log('=== A. Any row matching protein-concentrate vocabulary ===');
const RE = /\b(protein (powder|isolate|concentrate)|isolate|rice protein|potato protein|hemp protein|pea protein|whey|casein|textured|vital wheat)\b/i;
const conc = rows.filter((r) => RE.test(r.name));
console.log('rows matching:', conc.length);
conc.sort((a, b) => (b.dens || 0) - (a.dens || 0));
for (const r of conc.slice(0, 30)) {
  console.log(`${(r.dens ?? 0).toFixed(2)}\t${r.pro}g/${r.kcal}kcal\t${r.reasons.length ? 'DEAD[' + r.reasons.join(',') + ']' : 'ALIVE'}\t${r.name}`);
}

console.log('\n=== B. Named absent-or-present concentrates ===');
for (const c of ['rice protein', 'brown rice protein', 'potato protein', 'hemp protein',
  'sunflower protein', 'nutritional yeast', 'yeast, nutritional', 'torula', 'inactive yeast',
  'pumpkin seed protein', 'chlorella', 'spirulina powder']) {
  const re = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const hits = rows.filter((r) => re.test(r.name));
  console.log(`${c}: rows=${hits.length}` + (hits.length ? ' -> ' + hits.slice(0, 3).map((h) => `"${h.name}" ${h.pro}g/${h.kcal}kcal ${h.reasons.length ? 'DEAD' : 'ALIVE'}`).join(' ; ') : ''));
}

console.log('\n=== C. ALIVE plant rows with dens>=8 AND kcal/100g>=150 (deliverable, not leafy water) ===');
const deliverable = rows.filter((r) => !r.reasons.length && r.dens !== null && r.dens >= 8 && r.kcal >= 150);
deliverable.sort((a, b) => b.dens - a.dens);
console.log('count:', deliverable.length);
for (const r of deliverable.slice(0, 30)) {
  console.log(`${r.dens.toFixed(2)}\t${r.pro}g/${r.kcal}kcal\tsrc=${r.src}\t${r.name}`);
}

console.log('\n=== D. Style-gate leak probe: obscure animal rows surviving "vegan" ===');
for (const n of ['Squirrel', 'Groundhog', 'Armadillo', 'Wild pig', 'Heart', 'Owl, horned, flesh, raw (Alaska Native)',
  'Sea cucumber, yane (Alaska Native)', 'Jellyfish, dried, salted', 'Ceviche', 'Nutritional powder mix (Isopure)',
  'Nutritional powder mix, protein, NFS', 'Egg Plants']) {
  const r = rows.find((x) => x.name === n);
  if (!r) { console.log(`  ${n}: NOT FOUND`); continue; }
  console.log(`  ${r.reasons.length ? 'excluded[' + r.reasons.join(',') + ']' : '*** SURVIVES VEGAN ***'}  ${r.pro}g/${r.kcal}kcal  ${n}`);
}
