// ── planContext · the adjuster cache and what the checksum covers (G5) ────
//
// `loadAdjusterFoods()` held the ten ADJUSTER_CANDIDATES rows behind a bare
// `if (_adjusterFoods) return _adjusterFoods;` for the life of the process, and
// `invalidateRecipeLibrary()` — which every mutation route calls — cleared
// `_library` and `_pools` but never mentioned it. So a Food row edited or
// quarantined was correctly dropped from the library and every pool while the
// adjuster map kept handing out the pre-edit object. The `macroTrustIssue()`
// re-check in `loadAdjusters()` reads that same cached object, so it could not
// catch it either: a row quarantined for carrying another food's macros kept
// being added to real users' days, with the bad macros, until restart.
//
// Fixing the invalidator alone is not enough, and this is the part the original
// finding missed. `isQuarantined()` reads `food.source` and `food.dataQuality`,
// and NEITHER was in the version checksum — which is the only mechanism that
// covers the out-of-process paths (the 2026-07-31 provenance repair quarantined
// 77 rows from a maintenance script). A quarantine was invisible on both paths.
//
// What this test would catch: dropping `source` or `dataQuality` back out of the
// Food checksum, which would let a bulk quarantine land without moving the
// version — leaving every version-keyed cache below serving rows the app has
// already decided it cannot stand behind.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { LIBRARY_VERSION_SQL } = require("../src/lib/planContext.js");

// The three tables the checksum reads, with only the columns it touches.
function seedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE Recipe (id TEXT PRIMARY KEY, name TEXT, steps TEXT, kcal REAL, protein REAL, fat REAL, carb REAL);
    CREATE TABLE RecipeIngredient (id TEXT PRIMARY KEY, baseGrams REAL);
    CREATE TABLE Food (
      id TEXT PRIMARY KEY, name TEXT, allergenTags TEXT, fdcCategory TEXT, mayContain TEXT,
      source TEXT, dataQuality TEXT,
      kcal REAL, protein REAL, fat REAL, carb REAL, fiber REAL
    );
    INSERT INTO Recipe VALUES ('r1','Chicken and rice','Cook it.',520,40,12,60);
    INSERT INTO RecipeIngredient VALUES ('ri1',150);
    INSERT INTO Food VALUES ('f1','Chicken breast','','Poultry Products','','usda','',165,31,3.6,0,0);
  `);
  return db;
}

const checksum = (db) => JSON.stringify(db.prepare(LIBRARY_VERSION_SQL).get());

test("G5: quarantining a food MOVES the library checksum", () => {
  const db = seedDb();
  const before = checksum(db);

  // Exactly what the provenance repair does: mark the row's stored macros as
  // another food's numbers. The macros themselves are untouched — that is the
  // whole point, and it is why a macro-only checksum could not see this.
  db.exec("UPDATE Food SET source = 'quarantined' WHERE id = 'f1'");
  const after = checksum(db);

  assert.notEqual(after, before, "a quarantine must move the checksum, or every version-keyed cache serves it stale");
  db.close();
});

test("G5: the dataQuality provenance-cleared marker also moves the checksum", () => {
  const db = seedDb();
  const before = checksum(db);

  // isQuarantined() treats this prefix as quarantined even BEFORE the migration
  // runs, so the checksum has to see it on the same terms.
  db.exec("UPDATE Food SET dataQuality = 'exception:provenance-cleared' WHERE id = 'f1'");
  const after = checksum(db);

  assert.notEqual(after, before, "a dataQuality quarantine marker must move the checksum too");
  db.close();
});

test("G5: an untouched library keeps a stable checksum — the cache is not disabled", () => {
  // A checksum that moved on every read would make the caches useless rather
  // than correct, which is the obvious wrong way to make the tests above pass.
  const db = seedDb();
  assert.equal(checksum(db), checksum(db), "reading twice without a write must produce the same version");
  db.close();
});

test("G5: the macro and allergen columns the gate reads are still covered", () => {
  // Guards the pre-existing coverage while the new columns are added alongside.
  for (const [label, sql] of [
    ["a macro edit", "UPDATE Food SET fat = 9.9 WHERE id = 'f1'"],
    ["an allergen-tag edit", "UPDATE Food SET allergenTags = 'dairy' WHERE id = 'f1'"],
    ["a rename", "UPDATE Food SET name = 'Chicken breast, skinless' WHERE id = 'f1'"],
    ["a portion change", "UPDATE RecipeIngredient SET baseGrams = 200 WHERE id = 'ri1'"],
  ]) {
    const db = seedDb();
    const before = checksum(db);
    db.exec(sql);
    assert.notEqual(checksum(db), before, `${label} must move the checksum`);
    db.close();
  }
});
