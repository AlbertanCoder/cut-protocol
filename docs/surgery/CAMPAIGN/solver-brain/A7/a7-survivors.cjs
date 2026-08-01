/* A7 — what survives the killer allergen stack, measured with the product's own gate.
   Read-only. Uses A7's OWN db copy. Never touches backend/prisma/dev.db. */
const { DatabaseSync } = require('node:sqlite');
const DF = require('C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/dietaryFilter.js');

const DB = 'C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A7/dev.db';
const db = new DatabaseSync(DB, { readOnly: true });

// ── schema ────────────────────────────────────────────────────────────────
const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
console.log('TABLES:', tables.join(','));
const cols = db.prepare('pragma table_info(Food)').all().map((r) => r.name);
console.log('FOOD COLS:', cols.join(' | '));

const foods = db.prepare('select * from Food').all();
console.log('FOOD ROWS:', foods.length);
console.log('SAMPLE:', JSON.stringify(foods[0]).slice(0, 600));

// generic column detection
const nameCol = cols.find((c) => /^name$/i.test(c)) || cols.find((c) => /name/i.test(c));
const kcalCol = cols.find((c) => /^(kcal|calories|caloriesPer100g|kcalPer100g)$/i.test(c)) || cols.find((c) => /kcal|calor/i.test(c));
const proCol = cols.find((c) => /^(protein|proteinG|proteinPer100g)$/i.test(c)) || cols.find((c) => /protein/i.test(c));
console.log('USING COLS:', { nameCol, kcalCol, proCol });

// ── the killer stack, exactly as personas.mjs builds it ───────────────────
const KILL = ['soy', 'gluten', 'peanuts', 'tree nuts', 'sesame', 'legumes'];
const STYLE = 'vegan';

function excluded(food) {
  const reasons = [];
  try { if (DF.styleExcludedByMetadata(food, STYLE)) reasons.push('style:vegan'); } catch (e) { reasons.push('styleERR:' + e.message); }
  for (const t of KILL) {
    try { if (DF.foodMatchesExclusionTerm(food, t)) reasons.push(t); } catch (e) { reasons.push('err:' + t); }
  }
  return reasons;
}

const rows = foods.map((f) => {
  const kcal = Number(f[kcalCol]);
  const pro = Number(f[proCol]);
  const dens = kcal > 0 ? (pro / kcal) * 100 : null; // g protein per 100 kcal
  return { name: f[nameCol], kcal, pro, dens, reasons: excluded(f) };
});

const survivors = rows.filter((r) => r.reasons.length === 0 && r.dens !== null && r.kcal >= 20);
console.log('\nSURVIVORS (vegan + 6 walls, kcal>=20):', survivors.length, 'of', foods.length);

survivors.sort((a, b) => b.dens - a.dens);
console.log('\n=== TOP 40 SURVIVORS BY PROTEIN g /100 kcal ===');
for (const r of survivors.slice(0, 40)) {
  console.log(`${r.dens.toFixed(2)}\t${r.pro.toFixed(1)}g P\t${r.kcal.toFixed(0)} kcal\t${r.name}`);
}

// ── the named botany candidates ───────────────────────────────────────────
const CAND = ['quinoa', 'amaranth', 'buckwheat', 'hemp', 'sunflower', 'pumpkin seed', 'pepita',
  'chia', 'spirulina', 'nutritional yeast', 'potato protein', 'oat', 'flax', 'mushroom', 'seitan', 'pea protein'];
console.log('\n=== NAMED CANDIDATES: exists? excluded? ===');
for (const c of CAND) {
  const hits = rows.filter((r) => String(r.name || '').toLowerCase().includes(c));
  const alive = hits.filter((h) => h.reasons.length === 0);
  const best = alive.slice().sort((a, b) => (b.dens || 0) - (a.dens || 0))[0];
  console.log(`${c}: rows=${hits.length} surviving=${alive.length}` +
    (best ? ` bestDens=${best.dens.toFixed(2)} (${best.name})` : '') +
    (hits.length && !alive.length ? ` ALL EXCLUDED by [${[...new Set(hits.flatMap((h) => h.reasons))].join(',')}]` : ''));
}
