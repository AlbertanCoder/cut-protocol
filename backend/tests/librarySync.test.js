// Library-content sync tests — src/lib/librarySync.js.
//
// The bug: ensureDatabaseReady() copies the packaged template ONLY when no DB
// file exists, and migrations carry schema, never rows. So an install made in
// April is frozen on April's food library forever — the owner's app sat on 973
// foods / 634 recipes while the shipped template held 14,122 / 889, and every
// data repair since (the FDC import that carried micronutrients, the provenance
// repair that un-crossed 472 wrong FDC records) could never reach him.
//
// The sync that fixes it writes to a database full of the user's real data, so
// what is asserted here is mostly what it must NOT do:
//
//   · personal tables come out byte-identical (hash per table, before/after)
//   · no local row is ever deleted and no local id ever changes
//   · no local row is ever renamed
//   · a food or recipe the user created themselves is untouched, including one
//     whose name collides with a library recipe
//   · ingredients are re-pointed by NATURAL KEY — template ids are deliberately
//     unrelated to local ids in these fixtures, so an id-copying bug cannot pass
//   · a failure leaves the database exactly as it was, and boot continues
//
// Every test builds its own throwaway .db pair under the OS temp dir. Nothing
// here opens backend/prisma/dev.db or the packaged template.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const {
  ensureLibraryCurrent,
  syncLibrary,
  markLibraryFromTemplate,
  loadTableClassification,
  parseClassificationSource,
  normaliseName,
  MARKER_TABLE,
  EMBEDDED_CLASSIFICATION,
  CLASSIFICATION_SOURCE,
} = require("../src/lib/librarySync.js");

// ── schema ───────────────────────────────────────────────────────────────
// The real shapes, trimmed to the columns that carry meaning here. The
// constraints are NOT trimmed: Food.fdcId/upc UNIQUE and Recipe.name UNIQUE are
// what a careless upsert trips over, and RecipeIngredient's RESTRICT foreign
// keys are what catch a botched remap.
const SCHEMA = `
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Profile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "targetKcal" REAL NOT NULL,
  CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE TABLE "Weighin" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "date" DATETIME NOT NULL,
  "weightKg" REAL NOT NULL,
  CONSTRAINT "Weighin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE TABLE "Food" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "fdcId" INTEGER,
  "kcal" REAL NOT NULL,
  "protein" REAL NOT NULL,
  "fat" REAL NOT NULL,
  "carb" REAL NOT NULL,
  "fiber" REAL NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "brand" TEXT,
  "dataQuality" TEXT,
  "micros" JSONB,
  "upc" TEXT
);
CREATE UNIQUE INDEX "Food_fdcId_key" ON "Food"("fdcId");
CREATE UNIQUE INDEX "Food_upc_key" ON "Food"("upc");
CREATE TABLE "Recipe" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "steps" JSONB NOT NULL,
  "slotType" TEXT NOT NULL DEFAULT 'meal',
  "source" TEXT NOT NULL DEFAULT 'curated',
  "kcal" REAL NOT NULL,
  "protein" REAL NOT NULL,
  "fat" REAL NOT NULL,
  "carb" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "tasteTier" TEXT,
  "tasteTierSource" TEXT,
  "userRatingAvg" REAL,
  "userRatingCount" INTEGER,
  CONSTRAINT "Recipe_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "Recipe_name_key" ON "Recipe"("name");
CREATE TABLE "RecipeIngredient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL,
  "foodId" TEXT NOT NULL,
  "baseGrams" REAL NOT NULL,
  "scalable" BOOLEAN NOT NULL DEFAULT true,
  "role" TEXT,
  CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT,
  CONSTRAINT "RecipeIngredient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_foodId_key" ON "RecipeIngredient"("recipeId", "foodId");
CREATE TABLE "Plan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "startDate" DATETIME NOT NULL,
  CONSTRAINT "Plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE TABLE "PlanSlot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "recipeId" TEXT,
  "dayOfWeek" INTEGER NOT NULL,
  "slotIndex" INTEGER NOT NULL,
  "ingredients" JSONB NOT NULL,
  CONSTRAINT "PlanSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT,
  CONSTRAINT "PlanSlot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL
);
CREATE TABLE "CartItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CartItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE
);
CREATE TABLE "MealLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "date" DATETIME NOT NULL,
  "name" TEXT NOT NULL,
  "kcal" REAL NOT NULL,
  CONSTRAINT "MealLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);`;

// ── harness ──────────────────────────────────────────────────────────────

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-libsync-"));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ } });
  return dir;
}

function makeDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

const food = (db, r) => db.prepare(
  `INSERT INTO "Food" (id,name,category,fdcId,kcal,protein,fat,carb,fiber,source,micros,upc)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
).run(r.id, r.name, r.category ?? "other", r.fdcId ?? null, r.kcal, r.protein ?? 0, r.fat ?? 0, r.carb ?? 0,
      r.fiber ?? 0, r.source ?? "manual", r.micros ?? null, r.upc ?? null);

const recipe = (db, r) => db.prepare(
  `INSERT INTO "Recipe" (id,name,steps,source,kcal,protein,fat,carb,createdByUserId,tasteTier,userRatingAvg,userRatingCount)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
).run(r.id, r.name, r.steps ?? "[]", r.source ?? "curated", r.kcal, r.protein ?? 0, r.fat ?? 0, r.carb ?? 0,
      r.createdByUserId ?? null, r.tasteTier ?? null, r.userRatingAvg ?? null, r.userRatingCount ?? null);

const ing = (db, r) => db.prepare(
  `INSERT INTO "RecipeIngredient" (id,recipeId,foodId,baseGrams,scalable,role) VALUES (?,?,?,?,?,?)`
).run(r.id, r.recipeId, r.foodId, r.baseGrams, r.scalable ?? 1, r.role ?? null);

/** A template as the packaging step produces it: library rows only, zero personal rows. */
function buildTemplate(file) {
  const db = makeDb(file);
  food(db, { id: "tf_chicken", name: "Chicken breast, raw", fdcId: 1001, kcal: 120, protein: 23, fat: 2.6, carb: 0, source: "usda-verified", micros: '{"iron":0.7}' });
  food(db, { id: "tf_oats",    name: "Oats",               fdcId: null, kcal: 379, protein: 13.2, fat: 6.5, carb: 67.7, source: "manual" });
  food(db, { id: "tf_onion",   name: "Onion",              fdcId: 1003, kcal: 40, protein: 1.1, fat: 0.1, carb: 9.3, source: "usda-verified", micros: '{"potassium":146}' });
  food(db, { id: "tf_walnut",  name: "Walnuts",            fdcId: 1004, kcal: 654, protein: 15.2, fat: 65.2, carb: 13.7, source: "usda-verified", micros: '{"magnesium":158}' });
  food(db, { id: "tf_rice",    name: "Rice, cooked",       fdcId: 1005, kcal: 130, protein: 2.7, fat: 0.3, carb: 28, source: "usda-verified", micros: '{"zinc":0.4}' });
  recipe(db, { id: "tr_bowl", name: "Chicken Rice Bowl", kcal: 500, protein: 45, fat: 9, carb: 60, tasteTier: "A" });
  ing(db, { id: "tri_1", recipeId: "tr_bowl", foodId: "tf_chicken", baseGrams: 200, role: "protein" });
  ing(db, { id: "tri_2", recipeId: "tr_bowl", foodId: "tf_rice", baseGrams: 180, role: "carb" });
  recipe(db, { id: "tr_porridge", name: "Walnut Porridge", kcal: 420, protein: 14, fat: 18, carb: 52, tasteTier: "B" });
  ing(db, { id: "tri_3", recipeId: "tr_porridge", foodId: "tf_oats", baseGrams: 80, role: "carb" });
  ing(db, { id: "tri_4", recipeId: "tr_porridge", foodId: "tf_walnut", baseGrams: 20, role: "fat" });
  db.close();
  return file;
}

/**
 * An installed database as the owner's actually looks: an older, smaller
 * library carrying the corruption the template has since repaired, plus a full
 * personal footprint and the user's own food and recipe.
 *
 * Local ids are deliberately NOTHING like the template's, except for the one
 * row (`tf_chicken`) that models shared seed lineage. An implementation that
 * copies template ids across, or matches on them where they do not exist,
 * fails here rather than in the owner's app.
 */
function buildInstalled(file, { userOwnsColliding = false } = {}) {
  const db = makeDb(file);
  db.exec("PRAGMA foreign_keys=ON");

  db.prepare(`INSERT INTO "User" (id,email,passwordHash) VALUES (?,?,?)`).run("u1", "owner@local", "hash");
  db.prepare(`INSERT INTO "Profile" (id,userId,targetKcal) VALUES (?,?,?)`).run("pr1", "u1", 2384);
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO "Weighin" (id,userId,date,weightKg) VALUES (?,?,?,?)`).run(`w${i}`, "u1", 1700000000000 + i, 92 - i * 0.4);
  }

  // shared lineage with the template (same id), stale numbers
  food(db, { id: "tf_chicken", name: "Chicken breast, raw", fdcId: 1001, kcal: 118, protein: 22, fat: 2.5, carb: 0, source: "usda" });
  // THE corruption: "Oats" carrying an oil record's macros
  food(db, { id: "lf_oats", name: "Oats", fdcId: null, kcal: 884, protein: 0, fat: 100, carb: 0, source: "usda" });
  // renamed upstream: local USDA-style name, template's friendly one, same fdcId
  food(db, { id: "lf_onion", name: "Onions, raw", fdcId: 1003, kcal: 40, protein: 1.1, fat: 0.1, carb: 9.3, source: "usda" });
  // case-variant duplicates, both referenced by recipes
  food(db, { id: "lf_walnut_a", name: "Walnuts", fdcId: null, kcal: 884, protein: 0, fat: 100, carb: 0, source: "usda" });
  food(db, { id: "lf_walnut_b", name: "walnuts", fdcId: null, kcal: 884, protein: 0, fat: 100, carb: 0, source: "usda" });
  // the user's own hand-entered food
  food(db, { id: "lf_mine", name: "Shad's Homemade Shake", fdcId: null, kcal: 133, protein: 24, fat: 2.1, carb: 4.5, source: "manual" });

  recipe(db, { id: "tr_bowl", name: "Chicken Rice Bowl", kcal: 480, protein: 40, fat: 8, carb: 55, userRatingAvg: 4.5, userRatingCount: 2 });
  ing(db, { id: "lri_1", recipeId: "tr_bowl", foodId: "tf_chicken", baseGrams: 150, role: "protein" });
  // the user's own imported recipe, using their own food and a library food
  recipe(db, { id: "lr_mine", name: "Garage Gym Breakfast", kcal: 512, protein: 44, fat: 18, carb: 41, source: "imported", createdByUserId: "u1" });
  ing(db, { id: "lri_2", recipeId: "lr_mine", foodId: "lf_mine", baseGrams: 40, role: "protein" });
  ing(db, { id: "lri_3", recipeId: "lr_mine", foodId: "lf_walnut_b", baseGrams: 15, role: "fat" });
  if (userOwnsColliding) {
    // Same NAME as a template library recipe, but the user made it.
    recipe(db, { id: "lr_clash", name: "Walnut Porridge", kcal: 111, protein: 1, fat: 1, carb: 1, source: "ai-generated", createdByUserId: "u1" });
    ing(db, { id: "lri_4", recipeId: "lr_clash", foodId: "lf_walnut_a", baseGrams: 99, role: "fat" });
  }

  db.prepare(`INSERT INTO "Plan" (id,userId,startDate) VALUES (?,?,?)`).run("p1", "u1", 1700000000000);
  db.prepare(`INSERT INTO "PlanSlot" (id,planId,recipeId,dayOfWeek,slotIndex,ingredients) VALUES (?,?,?,?,?,?)`)
    .run("ps1", "p1", "tr_bowl", 0, 0, "[]");
  db.prepare(`INSERT INTO "CartItem" (id,userId,recipeId) VALUES (?,?,?)`).run("c1", "u1", "tr_bowl");
  db.prepare(`INSERT INTO "MealLog" (id,userId,date,name,kcal) VALUES (?,?,?,?,?)`).run("m1", "u1", 1700000000000, "Logged dinner", 640);
  db.close();
  return file;
}

function pair(t, opts) {
  const dir = sandbox(t);
  const dbPath = buildInstalled(path.join(dir, "cutprotocol.db"), opts);
  const templatePath = buildTemplate(path.join(dir, "dev.db.template"));
  return { dir, dbPath, templatePath };
}

/** Per-table content hash — order-independent, null-safe, every column. */
function snapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const out = {};
  for (const tbl of tables) {
    const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().map((c) => c.name);
    const rows = db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM "${tbl}"`).all();
    const lines = rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? " " : String(r[c]))).join("")).sort();
    out[tbl] = { count: rows.length, hash: crypto.createHash("sha256").update(lines.join("")).digest("hex") };
  }
  db.close();
  return out;
}

const read = (file, sql, ...args) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
};
const one = (file, sql, ...args) => read(file, sql, ...args)[0];

// ── classification ───────────────────────────────────────────────────────

test("the table classification comes from buildTemplateDb.mjs, and the packaged fallback matches it", () => {
  // The script is the project's single source of truth for library-vs-personal,
  // but electron-builder excludes backend/scripts/** from the installer, so the
  // module carries an embedded copy for the packaged app. THIS is what stops the
  // copy drifting — not discipline.
  assert.ok(fs.existsSync(CLASSIFICATION_SOURCE), "buildTemplateDb.mjs should exist in the repo");
  const parsed = parseClassificationSource(fs.readFileSync(CLASSIFICATION_SOURCE, "utf8"));
  assert.ok(parsed, "the PERSONAL array and KEEP set should still be parseable from buildTemplateDb.mjs");
  assert.deepEqual(
    [...parsed.library].sort(), [...EMBEDDED_CLASSIFICATION.library].sort(),
    "librarySync's embedded library list has drifted from buildTemplateDb.mjs's KEEP set"
  );
  assert.deepEqual(
    [...parsed.personal].sort(), [...EMBEDDED_CLASSIFICATION.personal].sort(),
    "librarySync's embedded personal list has drifted from buildTemplateDb.mjs's PERSONAL array"
  );
  assert.equal(loadTableClassification().source, "buildTemplateDb.mjs");
  assert.equal(loadTableClassification("/nope/missing.mjs").source, "embedded");
});

// ── the core promise ─────────────────────────────────────────────────────

test("library tables grow while every personal table stays byte-identical", (t) => {
  const { dbPath, templatePath } = pair(t);
  const before = snapshot(dbPath);

  const result = syncLibrary({ dbPath, templatePath, integrityCheck: true });
  assert.equal(result.status, "synced");

  const after = snapshot(dbPath);
  for (const tbl of ["User", "Profile", "Weighin", "Plan", "PlanSlot", "CartItem", "MealLog"]) {
    assert.equal(after[tbl].hash, before[tbl].hash, `${tbl} was modified — personal data must never be touched`);
  }
  assert.ok(after.Food.count > before.Food.count, "the food library should have grown");
  assert.ok(after.Recipe.count > before.Recipe.count, "the recipe library should have grown");
});

test("no local row is deleted and no local id changes", (t) => {
  const { dbPath, templatePath } = pair(t, { userOwnsColliding: true });
  const foodsBefore = read(dbPath, `SELECT id FROM "Food"`).map((r) => r.id).sort();
  const recipesBefore = read(dbPath, `SELECT id FROM "Recipe"`).map((r) => r.id).sort();

  syncLibrary({ dbPath, templatePath });

  const foodsAfter = new Set(read(dbPath, `SELECT id FROM "Food"`).map((r) => r.id));
  const recipesAfter = new Set(read(dbPath, `SELECT id FROM "Recipe"`).map((r) => r.id));
  for (const id of foodsBefore) assert.ok(foodsAfter.has(id), `food ${id} disappeared`);
  for (const id of recipesBefore) assert.ok(recipesAfter.has(id), `recipe ${id} disappeared`);
});

test("a corrected food keeps its local id and its local name, and takes the template's nutrition", (t) => {
  const { dbPath, templatePath } = pair(t);
  syncLibrary({ dbPath, templatePath });

  // "Oats" carried an OIL record (884 kcal / 100 g fat). The template repaired it.
  const oats = one(dbPath, `SELECT * FROM "Food" WHERE id = 'lf_oats'`);
  assert.equal(oats.name, "Oats");
  assert.equal(oats.kcal, 379);
  assert.equal(oats.fat, 6.5);

  // Renamed upstream ("Onions, raw" here, "Onion" in the library) but the same
  // FDC record. The row is refreshed; the name the user's recipes show is not.
  const onion = one(dbPath, `SELECT * FROM "Food" WHERE id = 'lf_onion'`);
  assert.equal(onion.name, "Onions, raw", "a local food must never be renamed by the sync");
  assert.equal(onion.micros, '{"potassium":146}', "micronutrients should have arrived");
  assert.equal(read(dbPath, `SELECT id FROM "Food" WHERE name = 'Onion'`).length, 0,
    "the renamed library row should have merged onto the local row, not spawned a duplicate");
});

test("same-name duplicates are all corrected, and only one of them keeps the FDC claim", (t) => {
  const { dbPath, templatePath } = pair(t);
  syncLibrary({ dbPath, templatePath });

  const a = one(dbPath, `SELECT * FROM "Food" WHERE id = 'lf_walnut_a'`);
  const b = one(dbPath, `SELECT * FROM "Food" WHERE id = 'lf_walnut_b'`);
  assert.equal(a.kcal, 654, "the primary duplicate should carry the corrected macros");
  assert.equal(b.kcal, 654, "the case-variant duplicate should be corrected too — recipes point at it");
  assert.equal(b.name, "walnuts", "the duplicate keeps its own name");
  const claims = read(dbPath, `SELECT id FROM "Food" WHERE fdcId = 1004`);
  assert.equal(claims.length, 1, "exactly one row may claim one FDC record");
});

// ── the user's own content ───────────────────────────────────────────────

test("a food and a recipe the user created themselves come through untouched", (t) => {
  const { dbPath, templatePath } = pair(t);
  const foodBefore = one(dbPath, `SELECT * FROM "Food" WHERE id = 'lf_mine'`);
  const recipeBefore = one(dbPath, `SELECT * FROM "Recipe" WHERE id = 'lr_mine'`);
  const ingBefore = read(dbPath, `SELECT * FROM "RecipeIngredient" WHERE recipeId = 'lr_mine' ORDER BY id`);

  syncLibrary({ dbPath, templatePath });

  assert.deepEqual(one(dbPath, `SELECT * FROM "Food" WHERE id = 'lf_mine'`), foodBefore);
  assert.deepEqual(one(dbPath, `SELECT * FROM "Recipe" WHERE id = 'lr_mine'`), recipeBefore);
  assert.deepEqual(read(dbPath, `SELECT * FROM "RecipeIngredient" WHERE recipeId = 'lr_mine' ORDER BY id`), ingBefore);
});

test("a user-owned recipe whose name collides with a library recipe is preserved, not overwritten", (t) => {
  const { dbPath, templatePath } = pair(t, { userOwnsColliding: true });
  const before = one(dbPath, `SELECT * FROM "Recipe" WHERE id = 'lr_clash'`);

  const result = syncLibrary({ dbPath, templatePath });
  assert.equal(result.stats.recipesPreserved, 1);

  const after = one(dbPath, `SELECT * FROM "Recipe" WHERE id = 'lr_clash'`);
  assert.deepEqual(after, before, "the library must not overwrite a recipe the user created");
  assert.equal(read(dbPath, `SELECT * FROM "RecipeIngredient" WHERE recipeId = 'lr_clash'`).length, 1,
    "its ingredients are the user's too");
});

test("a user's ratings on a library recipe survive the library refreshing it", (t) => {
  const { dbPath, templatePath } = pair(t);
  syncLibrary({ dbPath, templatePath });
  const bowl = one(dbPath, `SELECT * FROM "Recipe" WHERE id = 'tr_bowl'`);
  assert.equal(bowl.kcal, 500, "library content should be refreshed");
  assert.equal(bowl.tasteTier, "A", "taste tiers ride along with the library row");
  assert.equal(bowl.userRatingAvg, 4.5, "the user's own rating aggregate must not be overwritten");
  assert.equal(bowl.userRatingCount, 2);
});

// ── referential safety ───────────────────────────────────────────────────

test("ingredients are resolved by natural key, never by template id", (t) => {
  const { dbPath, templatePath } = pair(t);
  syncLibrary({ dbPath, templatePath });

  // The template's Walnut Porridge points at tf_oats / tf_walnut. Neither id
  // exists locally: the local rows are lf_oats and the two walnut duplicates.
  // Copying ids across would leave a dangling pointer; resolving by name lands
  // here. Of the two same-name walnut rows the sync canonicalises the one the
  // user's own recipe already references (lf_walnut_b), so the library's recipe
  // and the user's recipe agree on which row "walnuts" means.
  const rows = read(dbPath, `
    SELECT i."foodId", f."name" FROM "RecipeIngredient" i
    JOIN "Recipe" r ON r.id = i."recipeId" JOIN "Food" f ON f.id = i."foodId"
    WHERE r."name" = 'Walnut Porridge' ORDER BY f."name"`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.foodId).sort(), ["lf_oats", "lf_walnut_b"]);
  assert.ok(rows.every((r) => !r.foodId.startsWith("tf_")), "no template id may survive into the local database");
});

test("after a sync the database passes integrity_check and foreign_key_check with no orphans", (t) => {
  const { dbPath, templatePath } = pair(t, { userOwnsColliding: true });
  syncLibrary({ dbPath, templatePath, integrityCheck: true });

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check), ["ok"]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM "RecipeIngredient" i LEFT JOIN "Food" f ON f.id = i."foodId" WHERE f.id IS NULL`).get().c, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM "RecipeIngredient" i LEFT JOIN "Recipe" r ON r.id = i."recipeId" WHERE r.id IS NULL`).get().c, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM "PlanSlot" p WHERE p."recipeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Recipe" r WHERE r.id = p."recipeId")`).get().c, 0);
  } finally { db.close(); }
});

test("every recipe the sync owns ends up with the library's ingredient set", (t) => {
  const { dbPath, templatePath } = pair(t);
  syncLibrary({ dbPath, templatePath });
  const bowl = read(dbPath, `
    SELECT f."name", i."baseGrams" FROM "RecipeIngredient" i
    JOIN "Recipe" r ON r.id = i."recipeId" JOIN "Food" f ON f.id = i."foodId"
    WHERE r."name" = 'Chicken Rice Bowl' ORDER BY f."name"`);
  assert.equal(bowl.length, 2, "the library added rice to a recipe that only had chicken");
  assert.deepEqual(bowl.map((r) => r.baseGrams), [200, 180].sort((a, b) => a - b).reverse());
});

test("duplicate ingredient lines are merged, not inserted twice, and grams are summed", (t) => {
  const { dbPath, templatePath } = pair(t);
  // A template built BEFORE migration 20260724203000 still carries duplicate
  // (recipeId, foodId) rows. Found by booting the real thing: against the
  // owner's migrated database the sync failed with "UNIQUE constraint failed:
  // RecipeIngredient.recipeId, RecipeIngredient.foodId" — safely rolled back,
  // but the library would never have updated again.
  const tpl = new DatabaseSync(templatePath);
  tpl.exec(`DROP INDEX "RecipeIngredient_recipeId_foodId_key"`);
  ing(tpl, { id: "tri_dup", recipeId: "tr_bowl", foodId: "tf_chicken", baseGrams: 50, role: null });
  tpl.close();

  const result = syncLibrary({ dbPath, templatePath });
  assert.equal(result.status, "synced");

  const rows = read(dbPath, `
    SELECT i."baseGrams", i."role" FROM "RecipeIngredient" i
    JOIN "Recipe" r ON r.id = i."recipeId" JOIN "Food" f ON f.id = i."foodId"
    WHERE r."name" = 'Chicken Rice Bowl' AND f."name" = 'Chicken breast, raw'`);
  assert.equal(rows.length, 1, "one row per (recipe, food) pair");
  assert.equal(rows[0].baseGrams, 250, "200 + 50 — total grams per food must not change");
  assert.equal(rows[0].role, "protein", "the labelled row must not be demoted by an unlabelled sibling");
});

// ── idempotency ──────────────────────────────────────────────────────────

test("a second run is a no-op, and a forced full re-scan still changes nothing", (t) => {
  const { dbPath, templatePath } = pair(t, { userOwnsColliding: true });
  syncLibrary({ dbPath, templatePath });
  const after1 = snapshot(dbPath);

  const second = syncLibrary({ dbPath, templatePath });
  assert.equal(second.status, "current");
  assert.equal(second.reason, "fingerprint", "the version marker should short-circuit before any row is read");
  assert.deepEqual(snapshot(dbPath), after1);

  // force: skip the marker and re-plan from scratch. A planner that is not
  // convergent re-inserts rows here and re-points recipes at the copies.
  const third = syncLibrary({ dbPath, templatePath, force: true });
  assert.equal(third.stats.foodsInserted, 0, "a re-scan must not insert a second copy of anything");
  assert.equal(third.stats.recipesInserted, 0);
  assert.equal(third.stats.recipesIngredientsRewritten, 0, "ingredient sets must already match");
  const after3 = snapshot(dbPath);
  for (const tbl of Object.keys(after1)) {
    if (tbl === MARKER_TABLE) continue;
    assert.equal(after3[tbl].hash, after1[tbl].hash, `${tbl} changed on a forced re-scan — the sync is not convergent`);
  }
});

test("a template whose bytes changed is detected even when size and mtime are restored", (t) => {
  const { dbPath, templatePath } = pair(t);
  syncLibrary({ dbPath, templatePath });
  const st = fs.statSync(templatePath);

  // Same size, same mtime, different content: the fast path says "current", the
  // hash must then disagree and the sync must run.
  const db = new DatabaseSync(templatePath);
  db.prepare(`UPDATE "Food" SET kcal = 999 WHERE id = 'tf_rice'`).run();
  db.close();
  fs.truncateSync(templatePath, st.size);
  fs.utimesSync(templatePath, st.atime, st.mtime);

  const result = syncLibrary({ dbPath, templatePath });
  assert.notEqual(result.status, "current", "a content change must beat a matching size+mtime");
});

test("markLibraryFromTemplate makes the first boot of a fresh install a no-op", (t) => {
  const dir = sandbox(t);
  const templatePath = buildTemplate(path.join(dir, "dev.db.template"));
  const dbPath = path.join(dir, "cutprotocol.db");
  fs.copyFileSync(templatePath, dbPath);           // what ensureDatabaseReady() does

  assert.equal(markLibraryFromTemplate(dbPath, templatePath), true);
  const result = syncLibrary({ dbPath, templatePath });
  assert.equal(result.status, "current");
  assert.equal(result.reason, "fingerprint");
});

// ── fail safe ────────────────────────────────────────────────────────────

test("a file-level backup is taken before anything is written, and restoring it undoes the sync", (t) => {
  const { dir, dbPath, templatePath } = pair(t);
  const before = snapshot(dbPath);

  const result = syncLibrary({ dbPath, templatePath });
  assert.ok(result.backupPath && fs.existsSync(result.backupPath), "a backup should exist");
  assert.ok(fs.readdirSync(dir).some((f) => f.includes("backup-pre-migrate")));

  fs.copyFileSync(result.backupPath, dbPath);
  assert.deepEqual(snapshot(dbPath), before, "copying the backup back should restore the pre-sync database exactly");
});

test("an unclassified table stops the sync instead of guessing what it holds", (t) => {
  const { dbPath, templatePath } = pair(t);
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE "SomethingNobodyClassified" ("id" TEXT PRIMARY KEY)`);
  db.close();
  const before = snapshot(dbPath);

  const result = syncLibrary({ dbPath, templatePath });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /unclassified table/);
  assert.deepEqual(snapshot(dbPath), before, "nothing may be written when the classification is incomplete");
});

test("a corrupt template leaves the database exactly as it was", (t) => {
  const { dir, dbPath } = pair(t);
  const templatePath = path.join(dir, "garbage.template");
  fs.writeFileSync(templatePath, "this is not a SQLite database, not even close");
  const before = snapshot(dbPath);

  assert.throws(() => syncLibrary({ dbPath, templatePath }));
  assert.deepEqual(snapshot(dbPath), before);
});

test("an empty template is refused rather than treated as an empty library", (t) => {
  const { dir, dbPath } = pair(t);
  const templatePath = path.join(dir, "empty.template");
  makeDb(templatePath).close();      // correct schema, zero rows
  const before = snapshot(dbPath);

  const result = syncLibrary({ dbPath, templatePath });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /no foods/);
  assert.deepEqual(snapshot(dbPath), before);
});

test("ensureLibraryCurrent never throws — a failed library update must not stop the app booting", async (t) => {
  const { dir, dbPath } = pair(t);
  const before = snapshot(dbPath);

  const garbage = path.join(dir, "garbage.template");
  fs.writeFileSync(garbage, "not a database");
  const failed = await ensureLibraryCurrent({ dbPath, templatePath: garbage });
  assert.equal(failed.status, "failed");
  assert.deepEqual(snapshot(dbPath), before, "the existing library must survive a failed update");
  assert.ok(fs.existsSync(`${dbPath}.library-sync-error.log`), "the failure should be written down somewhere findable");

  const missing = await ensureLibraryCurrent({ dbPath, templatePath: path.join(dir, "nope.template") });
  assert.equal(missing.status, "skipped");

  // Dev mode: no CUT_PROTOCOL_DB_PATH, no dbPath — must not touch anything.
  const saved = process.env.CUT_PROTOCOL_DB_PATH;
  delete process.env.CUT_PROTOCOL_DB_PATH;
  t.after(() => { if (saved !== undefined) process.env.CUT_PROTOCOL_DB_PATH = saved; });
  assert.equal((await ensureLibraryCurrent()).status, "skipped");
});

test("a sync that fails midway commits nothing", (t) => {
  const { dbPath, templatePath } = pair(t);
  const before = snapshot(dbPath);

  // A template row that violates the live schema: kcal NOT NULL. The insert
  // throws deep inside the transaction, after other rows have already been
  // written — exactly the half-synced state the transaction exists to prevent.
  const tpl = new DatabaseSync(templatePath);
  tpl.exec(`PRAGMA writable_schema=ON`);
  tpl.exec(`UPDATE sqlite_master SET sql = replace(sql, '"kcal" REAL NOT NULL', '"kcal" REAL') WHERE name='Food'`);
  tpl.exec(`PRAGMA writable_schema=OFF`);
  tpl.close();
  const tpl2 = new DatabaseSync(templatePath);
  tpl2.prepare(`INSERT INTO "Food" (id,name,category,kcal,protein,fat,carb) VALUES ('tf_bad','Broken Row','other',NULL,0,0,0)`).run();
  tpl2.close();

  assert.throws(() => syncLibrary({ dbPath, templatePath }), /NOT NULL|constraint/i);
  assert.deepEqual(snapshot(dbPath), before, "a failed sync must leave zero partial writes");
});

// ── honesty ──────────────────────────────────────────────────────────────

test("recipes left holding a stale cached total are counted, not hidden", (t) => {
  const { dbPath, templatePath } = pair(t);
  // lr_mine uses lf_walnut_b, whose macros the sync is about to correct from
  // 884 kcal to 654. The sync may not rewrite a user's recipe, so its cached
  // total is now wrong — and says so.
  const result = syncLibrary({ dbPath, templatePath });
  assert.equal(result.stats.recipesWithStaleCache, 1);
});

test("normaliseName folds case and whitespace but not punctuation", () => {
  assert.equal(normaliseName("  Olive   OIL "), "olive oil");
  assert.equal(normaliseName("Olive Oil"), normaliseName("olive oil"));
  assert.notEqual(normaliseName("Onions, raw"), normaliseName("Onions raw"));
});
