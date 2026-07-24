#!/usr/bin/env node
// Backfill Food.fdcCategory from the local FDC cache.
//
// WHY THIS EXISTS. Migration 20260724030630_food_allergen_metadata added
// fdcCategory / allergenTags / mayContain, and dietaryFilter's exclusion logic
// unions four probes over them. Nothing ever populated the columns, so two of
// those four probes read NULL on all 14,122 foods — the allergen defence looked
// like a four-signal union and behaved like a one-signal name check. An audit
// measured the cost: ~117 foods whose NAME carries no allergen token but whose
// USDA category does, including `Cake, angelfood`, `Pie, Dutch Apple`,
// `Rolls, hard (includes kaiser)` and `Stove Top Stuffing Mix` served to a
// coeliac, plus hidden-casein rows like `Reddi Wip Fat Free`. Worse, two rows
// were renamed in a way that DESTROYS the only name evidence there was:
// "Bread, cinnamon" -> "Cinnamon" and "Bread, oatmeal" -> "Oatmeal". For those,
// the category is the only recoverable signal.
//
// The data is entirely local (backend/data/fdc-cache/fdc-index.json, 13,545
// records) — no API key, no network. Join is on fdcId, which is unique after
// migration 20260722045659.
//
//   node scripts/backfillFdcCategory.mjs [--apply] [--db <path>]
//
// Dry-run by default: prints what WOULD change and exits without writing.
// Only fills NULLs; never overwrites a category that is already set.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const dbFlag = argv.indexOf("--db");
const BACKEND = path.resolve(path.join(import.meta.dirname, ".."));
const DB = dbFlag !== -1 ? argv[dbFlag + 1] : path.join(BACKEND, "prisma", "dev.db");
const INDEX = path.join(BACKEND, "data", "fdc-cache", "fdc-index.json");

if (!fs.existsSync(DB)) { console.error(`no database at ${DB}`); process.exit(1); }
if (!fs.existsSync(INDEX)) { console.error(`no FDC cache at ${INDEX}`); process.exit(1); }

const parsed = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const records = Array.isArray(parsed) ? parsed : parsed.records;
const byId = new Map();
for (const r of records) {
  if (r && r.fdcId != null && r.fdcCategory) byId.set(String(r.fdcId), r.fdcCategory);
}
console.log(`FDC cache: ${records.length} records, ${byId.size} carry a category`);

const db = new DatabaseSync(DB);
const total = db.prepare("SELECT COUNT(*) c FROM Food").get().c;
const before = db.prepare("SELECT COUNT(*) c FROM Food WHERE fdcCategory IS NOT NULL").get().c;

// Only rows that HAVE an fdcId and are still missing a category.
const targets = db.prepare("SELECT id, fdcId, name FROM Food WHERE fdcId IS NOT NULL AND fdcCategory IS NULL").all();
let matched = 0;
const misses = [];
const plan = [];
for (const row of targets) {
  const cat = byId.get(String(row.fdcId));
  if (cat) { matched++; plan.push([cat, row.id]); }
  else misses.push(row);
}

console.log(`Food rows: ${total} | with category before: ${before}`);
console.log(`candidates (fdcId set, category null): ${targets.length}`);
console.log(`  matched in cache: ${matched}`);
console.log(`  no cache entry:   ${misses.length}`);
if (misses.length) console.log(`  e.g. ${misses.slice(0, 3).map((m) => `${m.fdcId} ${m.name}`).join(" | ")}`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
  db.close();
  process.exit(0);
}

// One transaction: a partial backfill is harder to reason about than none.
db.exec("BEGIN");
try {
  const upd = db.prepare("UPDATE Food SET fdcCategory = ? WHERE id = ? AND fdcCategory IS NULL");
  for (const [cat, id] of plan) upd.run(cat, id);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("backfill failed, rolled back:", err.message);
  db.close();
  process.exit(1);
}

const after = db.prepare("SELECT COUNT(*) c FROM Food WHERE fdcCategory IS NOT NULL").get().c;
const fk = db.prepare("PRAGMA foreign_key_check").all().length;
console.log(`\nAPPLIED. with category: ${before} -> ${after} (of ${total}); FK violations: ${fk}`);
const top = db.prepare("SELECT fdcCategory, COUNT(*) n FROM Food WHERE fdcCategory IS NOT NULL GROUP BY fdcCategory ORDER BY n DESC LIMIT 5").all();
for (const t of top) console.log(`  ${String(t.n).padStart(5)}  ${t.fdcCategory}`);
db.close();
