// A7 — read-only probe of the Food/Recipe tables in A7's OWN db copy.
import Database from 'better-sqlite3';

const DB = 'C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A7/dev.db';
const db = new Database(DB, { readonly: true });

const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
console.log('TABLES:', tables.join(','));
for (const t of ['Food', 'Recipe', 'RecipeIngredient']) {
  if (!tables.includes(t)) { console.log(t, 'MISSING'); continue; }
  console.log(`\n${t} COLS:`, db.prepare(`pragma table_info(${t})`).all().map((r) => r.name).join(' | '));
  console.log(`${t} COUNT:`, db.prepare(`select count(*) c from ${t}`).get().c);
}
