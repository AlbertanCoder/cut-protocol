// Schema/index/constraint guarantees — the ones that are invisible when they
// break, which is why they need a test rather than a code review.
//
// Everything here runs against a throwaway database under the OS temp dir, or
// against the schema/migration TEXT. Nothing opens backend/prisma/dev.db and
// nothing opens the installed app database.
//
// What is actually being defended:
//   * RecipeIngredient shipped with no index on either FK column, so every
//     ingredient lookup was a 7,245-row scan, and with no unique constraint,
//     so 208 duplicate (recipeId, foodId) pairs accumulated across 125 recipes
//     (14% of the library). Both are silent failures — the app returns correct
//     answers slowly, and duplicate lines look like a UI bug, not a schema bug.
//   * The dedupe MUST run before the unique index in the same migration.
//     Reordered, the migration fails on the first install that has duplicates.
//   * The migration must stay legal inside a transaction, because the
//     in-process runner (src/lib/desktopBootstrap.js) wraps each one in
//     BEGIN/COMMIT. A statement SQLite silently no-ops inside a transaction
//     (PRAGMA journal_mode) or hard-fails (VACUUM) would either do nothing or
//     brick an upgrade — and the "silently no-ops" half is exactly the bug
//     class that made the FK-enforcement finding a P0.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchemaCurrent, splitSqlStatements, DEFAULT_MIGRATIONS_DIR } = require("../src/lib/desktopBootstrap.js");

const BACKEND = path.join(__dirname, "..");
const SCHEMA_PATH = path.join(BACKEND, "prisma", "schema.prisma");
const MIGRATION = "20260724203000_ingredient_dedupe_indexes_and_dq_flag";
const MIGRATION_SQL_PATH = path.join(DEFAULT_MIGRATIONS_DIR, MIGRATION, "migration.sql");

const schema = () => fs.readFileSync(SCHEMA_PATH, "utf8");
const migrationSql = () => fs.readFileSync(MIGRATION_SQL_PATH, "utf8");

// Pull one `model X { ... }` block out of the schema so an assertion about
// RecipeIngredient can't be satisfied by a line in some other model.
function modelBlock(name) {
  const src = schema();
  const start = src.indexOf(`model ${name} {`);
  assert.notEqual(start, -1, `model ${name} not found in schema.prisma`);
  const end = src.indexOf("\n}", start);
  assert.notEqual(end, -1, `model ${name} block not terminated`);
  return src.slice(start, end);
}

// This schema is ~40% prose, and that prose quotes the very declarations these
// tests assert about ("there is deliberately NO @@index([recipeId])"). A check
// that a comment can satisfy — or trip — is not checking the schema.
const declarationsOnly = (block) => block.replace(/\/\/.*$/gm, "");

// ── schema declarations ──────────────────────────────────────────────────

test("RecipeIngredient declares the unique pair constraint", () => {
  assert.match(declarationsOnly(modelBlock("RecipeIngredient")), /@@unique\(\[recipeId,\s*foodId\]\)/);
});

test("RecipeIngredient declares an index on foodId", () => {
  assert.match(declarationsOnly(modelBlock("RecipeIngredient")), /@@index\(\[foodId\]\)/);
});

test("RecipeIngredient does NOT carry a redundant standalone recipeId index", () => {
  // The @@unique above is an index on (recipeId, foodId); SQLite serves
  // `WHERE recipeId = ?` from its leading column. Measured as indistinguishable
  // from a dedicated index (34.12 ms vs 33.95 ms over the 889-recipe fetch) for
  // 0.23 MB. If someone adds one, they should have a number showing it helps.
  assert.doesNotMatch(declarationsOnly(modelBlock("RecipeIngredient")), /@@index\(\[recipeId\]\)/);
});

test("Food declares the (category, name) composite index in that column order", () => {
  const block = declarationsOnly(modelBlock("Food"));
  assert.match(block, /@@index\(\[category,\s*name\]\)/);
  // (name, category) would serve neither the list's ORDER BY nor the category
  // filter — the order is the whole point.
  assert.doesNotMatch(block, /@@index\(\[name,\s*category\]\)/);
});

test("schema header corrects the Postgres-portability claim with measurements", () => {
  // Asserted positively. The header is all comment, so "the old claim is
  // absent" cannot be tested by absence of a phrase — the correction quotes
  // the phrase it is correcting.
  const header = schema().slice(0, 3000);
  assert.match(header, /FALSE: that the swap costs one line/);
  assert.match(header, /21 of 25/, "the measured count of SQLite-flavoured migrations");
  assert.match(header, /migration_lock\.toml/, "the provider pin that blocks the swap");
});

test("documented enum vocabularies match what the database actually holds", () => {
  // These drifted silently: the comments described the values someone intended,
  // and imports invented more. A comment that is wrong about data is worse than
  // no comment, because it gets trusted.
  const recipeSource = modelBlock("Recipe").match(/source\s+String\s+@default\("curated"\).*/)[0];
  for (const v of ["curated", "ai-generated", "imported", "themealdb-import"]) {
    assert.ok(recipeSource.includes(v), `Recipe.source comment is missing the live value "${v}"`);
  }
  const role = modelBlock("RecipeIngredient").match(/role\s+String\?.*/)[0];
  for (const v of ["protein", "carb", "veg", "fat", "dairy", "fruit", "other"]) {
    assert.ok(role.includes(v), `RecipeIngredient.role comment is missing the live value "${v}"`);
  }
});

test("User documents what deleting an account is supposed to do", () => {
  // No delete path exists yet; the decision is recorded so it doesn't have to
  // be re-derived under pressure when one is written.
  assert.match(modelBlock("User"), /DELETING A USER IS CURRENTLY IMPOSSIBLE/);
});

// ── migration safety ─────────────────────────────────────────────────────

test("migration contains nothing illegal or inert inside a transaction", () => {
  // Assert on what the runner will EXECUTE, not on the file text — the file
  // discusses these pragmas in its comments, and a check that can be tripped by
  // a comment is a check that will be silenced by deleting the comment.
  const sql = splitSqlStatements(migrationSql())
    .map((s) => s.replace(/--.*$/gm, ""))
    .join("\n");
  // journal_mode: silently ignored in a transaction (must live in prisma.js).
  assert.doesNotMatch(sql, /PRAGMA\s+journal_mode/i);
  // VACUUM: hard error inside a transaction.
  assert.doesNotMatch(sql, /\bVACUUM\b/i);
  // foreign_keys: the runner strips these, and one landing would be dangerous.
  assert.doesNotMatch(sql, /PRAGMA\s+foreign_keys/i);
});

test("migration splits into whole statements the runner can execute", () => {
  const stmts = splitSqlStatements(migrationSql());
  assert.ok(stmts.length > 0);
  for (const s of stmts) {
    assert.match(
      s.trim(),
      /^(UPDATE|DELETE|CREATE|ALTER|ANALYZE)\b/i,
      `splitter produced a fragment that is not a statement: ${JSON.stringify(s.slice(0, 90))}`
    );
  }
});

test("the dedupe runs BEFORE the unique index is created", () => {
  const stmts = splitSqlStatements(migrationSql()).map((s) => s.replace(/\s+/g, " "));
  const dedupe = stmts.findIndex((s) => /^DELETE FROM "RecipeIngredient"/i.test(s));
  const unique = stmts.findIndex((s) => /CREATE UNIQUE INDEX "RecipeIngredient_recipeId_foodId_key"/i.test(s));
  assert.ok(dedupe !== -1, "dedupe DELETE not found");
  assert.ok(unique !== -1, "unique index creation not found");
  assert.ok(dedupe < unique, "the unique index would fail: it is created before the duplicates are merged");
});

// ── functional: apply the real migration to a throwaway database ─────────

// Faithful enough shape for the columns this migration touches, with real FKs
// so `PRAGMA foreign_key_check` means something.
const SEED_DDL = `
CREATE TABLE "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "Food" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "category" TEXT NOT NULL,
  "kcal" REAL NOT NULL, "protein" REAL NOT NULL, "fat" REAL NOT NULL, "carb" REAL NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual', "dataQuality" TEXT
);
CREATE TABLE "Recipe" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL);
CREATE TABLE "RecipeIngredient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL, "foodId" TEXT NOT NULL,
  "baseGrams" REAL NOT NULL, "scalable" BOOLEAN NOT NULL DEFAULT true, "role" TEXT,
  CONSTRAINT "ri_recipe_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id"),
  CONSTRAINT "ri_food_fkey" FOREIGN KEY ("foodId") REFERENCES "Food" ("id")
);
INSERT INTO "Recipe" ("id","name") VALUES ('r1','Patties'), ('r2','Clean');
INSERT INTO "Food" ("id","name","category","kcal","protein","fat","carb","source","dataQuality") VALUES
  ('water','Water','drinks',0,0,0,0,'usda-verified','pass — fdcId 1 "Water"'),
  ('flour','Flour','grains',364,10,1,76,'usda-verified','warn:atwater-mismatch,low-confidence'),
  ('beef','Beef','protein',250,26,17,0,'usda-verified','exception:provenance-cleared — carried fdcId 9'),
  ('salt','Salt','pantry',0,0,0,0,'manual',NULL);
-- r1 duplicates Water 4x (the real "Jamaican Beef Patties" shape) and Flour 2x
-- with a role/scalable disagreement the merge has to resolve deterministically.
INSERT INTO "RecipeIngredient" ("id","recipeId","foodId","baseGrams","scalable","role") VALUES
  ('i1','r1','water',59.25,1,NULL),
  ('i2','r1','water',118.5,1,NULL),
  ('i3','r1','water',3.7,1,NULL),
  ('i4','r1','water',14.825,1,NULL),
  ('i5','r1','flour',100,0,NULL),
  ('i6','r1','flour',50,1,'carb'),
  ('i7','r1','beef',200,1,'protein'),
  ('i8','r2','salt',5,0,NULL);
`;

// The migration runs ANALYZE, and a correct planner will scan a 4-row table no
// matter what indexes exist — a "the index is used" assertion against a toy
// table asserts nothing. So the plan tests get a realistically-sized body of
// clean (non-duplicate) rows on top of the hand-built fixture above: 400
// recipes x 4 foods = 1,600 rows, the same order of magnitude as the real
// 7,245, which is where an index lookup actually beats a scan.
function seedBulk(db) {
  const recipe = db.prepare(`INSERT INTO "Recipe" ("id","name") VALUES (?, ?)`);
  const ing = db.prepare(`INSERT INTO "RecipeIngredient" ("id","recipeId","foodId","baseGrams","scalable","role") VALUES (?,?,?,?,1,NULL)`);
  const food = db.prepare(`INSERT INTO "Food" ("id","name","category","kcal","protein","fat","carb","source","dataQuality") VALUES (?,?,?,100,5,5,10,'usda-verified',NULL)`);
  const cats = ["protein", "grains", "fruit-veg", "fats-nuts-oils", "dairy-eggs", "pantry", "drinks"];
  const foods = ["water", "flour", "beef", "salt"];
  db.exec("BEGIN");
  // 2,000 foods so `ORDER BY category, name` is a sort worth avoiding.
  for (let i = 0; i < 2000; i++) food.run(`bf${i}`, `Bulk Food ${String(i).padStart(5, "0")}`, cats[i % cats.length]);
  for (let i = 0; i < 400; i++) {
    recipe.run(`b${i}`, `Bulk ${i}`);
    for (const f of foods) ing.run(`b${i}-${f}`, `b${i}`, f, 10 + i);
  }
  db.exec("COMMIT");
}

// Windows will not delete a directory that still holds an open file handle, and
// node:test runs `after` hooks in REGISTRATION order — so the sandbox cannot
// register its own rm first and hope each test's `db.close()` lands before it.
// One hook, owned here, closes every database this sandbox handed out and then
// removes the directory.
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-idx-"));
  const opened = [];
  t.after(() => {
    for (const d of opened) { try { d.close(); } catch { /* already closed */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const dbPath = path.join(dir, "test.db");
  const open = () => { const d = new DatabaseSync(dbPath); opened.push(d); return d; };
  const db = open();
  db.exec(SEED_DDL);
  // Mark every shipped migration EXCEPT the one under test as already applied,
  // so the runner has exactly one thing to do.
  const shipped = fs.readdirSync(DEFAULT_MIGRATIONS_DIR)
    .filter((n) => fs.existsSync(path.join(DEFAULT_MIGRATIONS_DIR, n, "migration.sql")));
  assert.ok(shipped.includes(MIGRATION), `${MIGRATION} is not in the shipped migration set`);
  const ins = db.prepare(
    "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, 'x', ?, ?, ?, 1)"
  );
  const now = new Date().toISOString();
  for (const n of shipped) if (n !== MIGRATION) ins.run(n, now, n, now);
  db.close();
  return { dbPath, open };
}

test("dedupe merges duplicate pairs without changing total grams per food", async (t) => {
  const { dbPath, open } = sandbox(t);
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });

  const db = open();

  const rows = db.prepare(`SELECT "recipeId","foodId","baseGrams","scalable","role" FROM "RecipeIngredient" ORDER BY "recipeId","foodId"`).all();
  assert.equal(rows.length, 4, "8 rows with 2 duplicate groups should collapse to 4");

  const water = rows.find((r) => r.foodId === "water");
  // 59.25 + 118.5 + 3.7 + 14.825 — the sum is what keeps cached recipe macros
  // identical, because computeRecipeMacros already summed all four rows.
  assert.equal(Math.round(water.baseGrams * 1000), 196275);

  const flour = rows.find((r) => r.foodId === "flour");
  assert.equal(flour.baseGrams, 150, "grams summed across the merged rows");
  assert.equal(flour.scalable, 1, "scalable is OR-ed: if any merged part scaled, the survivor scales");
  assert.equal(flour.role, "carb", "role takes the earliest non-null rather than being lost");

  // untouched rows stay untouched
  const salt = rows.find((r) => r.foodId === "salt");
  assert.equal(salt.baseGrams, 5);
  assert.equal(salt.scalable, 0);
});

test("the unique constraint then makes a duplicate line unrepresentable", async (t) => {
  const { dbPath, open } = sandbox(t);
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });
  const db = open();

  assert.throws(
    () => db.exec(`INSERT INTO "RecipeIngredient" ("id","recipeId","foodId","baseGrams") VALUES ('dup','r1','water',10)`),
    /UNIQUE constraint failed/,
    "a second line for the same food in the same recipe must be rejected by the DB, not by convention"
  );
});

test("migration leaves the database structurally clean", async (t) => {
  const { dbPath, open } = sandbox(t);
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });
  const db = open();

  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    db.prepare("SELECT count(*) c FROM _prisma_migrations WHERE migration_name=? AND finished_at IS NOT NULL").get(MIGRATION).c,
    1,
    "the migration must record itself"
  );
});

test("the new indexes are actually chosen by the planner", async (t) => {
  const { dbPath, open } = sandbox(t);
  const pre = open();
  seedBulk(pre); // realistic row counts — see seedBulk
  pre.close();
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });
  const db = open();
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(" | ");

  // A declared index that the planner ignores is decoration. Assert the plan,
  // not the presence of the index.
  assert.match(plan(`SELECT * FROM "RecipeIngredient" WHERE "recipeId"='r1'`), /SEARCH .*USING INDEX/);
  assert.match(plan(`SELECT * FROM "RecipeIngredient" WHERE "foodId"='water'`), /USING INDEX "?RecipeIngredient_foodId_idx/);
  // routes/foods.js's "which recipes use this food?" ripple.
  assert.match(
    plan(`SELECT * FROM "Recipe" WHERE "id" IN (SELECT "recipeId" FROM "RecipeIngredient" WHERE "foodId"='water')`),
    /USING INDEX "?RecipeIngredient_foodId_idx/
  );
  // The Foods list ORDER BY must no longer build a temp b-tree over the table.
  const listPlan = plan(`SELECT "id" FROM "Food" ORDER BY "category", "name"`);
  assert.match(listPlan, /USING INDEX "?Food_category_name_idx/);
  assert.doesNotMatch(listPlan, /TEMP B-TREE/);
});

test("ANALYZE has run, so the planner has real statistics", async (t) => {
  const { dbPath, open } = sandbox(t);
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });
  const db = open();
  assert.equal(db.prepare("SELECT count(*) c FROM sqlite_master WHERE name='sqlite_stat1'").get().c, 1);
});

test("dataQualityFlag is derived from the prose and never guessed", async (t) => {
  const { dbPath, open } = sandbox(t);
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });
  const db = open();

  const byId = Object.fromEntries(
    db.prepare(`SELECT "id","dataQuality","dataQualityFlag" FROM "Food"`).all().map((r) => [r.id, r])
  );
  assert.equal(byId.water.dataQualityFlag, "pass");
  assert.equal(byId.flour.dataQualityFlag, "warn");
  assert.equal(byId.beef.dataQualityFlag, "exception");
  // No prose => no flag. "not yet classified" must not be laundered into "clean".
  assert.equal(byId.salt.dataQualityFlag, null);
  // The prose itself is the audit trail and must survive untouched.
  assert.match(byId.beef.dataQuality, /provenance-cleared/);
});

test("re-running the runner on an already-migrated database is a no-op", async (t) => {
  const { dbPath, open } = sandbox(t);
  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });
  const before = fs.readFileSync(dbPath).length;
  const rowsBefore = (() => {
    const d = new DatabaseSync(dbPath);
    const n = d.prepare(`SELECT count(*) c FROM "RecipeIngredient"`).get().c;
    d.close();
    return n;
  })();

  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });

  const db = open();
  assert.equal(db.prepare(`SELECT count(*) c FROM "RecipeIngredient"`).get().c, rowsBefore);
  assert.equal(
    db.prepare("SELECT count(*) c FROM _prisma_migrations WHERE migration_name=?").get(MIGRATION).c,
    1,
    "a second run must not record the migration twice"
  );
  assert.equal(fs.readFileSync(dbPath).length, before);
});

// ── WAL ──────────────────────────────────────────────────────────────────

test("lib/prisma.js puts the database into WAL journal mode", (t) => {
  // Runs in a CHILD process against a throwaway DATABASE_URL. Requiring
  // src/lib/prisma.js in-process would connect this test run to the real
  // backend/prisma/dev.db and change its journal mode as a side effect.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-wal-"));
  const opened = [];
  t.after(() => {
    for (const d of opened) { try { d.close(); } catch { /* already closed */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const dbPath = path.join(dir, "wal.db");
  const seed = new DatabaseSync(dbPath);
  seed.exec(`CREATE TABLE "t" ("id" INTEGER PRIMARY KEY)`);
  assert.equal(seed.prepare("PRAGMA journal_mode").get().journal_mode, "delete", "precondition: starts in delete mode");
  seed.close();

  const out = execFileSync(
    process.execPath,
    ["-e", `require("./src/lib/prisma.js").walReady.then(m => { console.log("MODE:" + m); process.exit(0); });`],
    { cwd: BACKEND, encoding: "utf8", timeout: 60_000, env: { ...process.env, DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}` } }
  );
  assert.match(out, /MODE:wal/, `expected WAL to be enabled, got: ${out}`);

  const db = new DatabaseSync(dbPath);
  opened.push(db);
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal", "WAL must persist in the file header, not just on that connection");
});
