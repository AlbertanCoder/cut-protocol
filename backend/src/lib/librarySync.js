// Library content sync for installed desktop apps.
//
// ── THE BUG THIS FIXES ────────────────────────────────────────────────────
// `ensureDatabaseReady()` copies the packaged template DB into place ONLY when
// no database file exists yet. Migrations then carry SCHEMA forward on every
// update, but never a single row of CONTENT. So an install made in April is
// permanently frozen on April's food library:
//
//                       installed DB      shipped template
//     Food                     973              14,122
//     Recipe                   634                 889
//     RecipeIngredient       6,224               7,245
//
// Every data repair the project ships — the FDC import that carried
// micronutrients, the provenance repair that un-crossed 472 wrong FDC records
// (the reason the owner's "Nutmeg" reads 884 kcal / 100 g fat: it is carrying
// an OIL record) — lands in the template and stops there. The owner's
// Micronutrients card says "46 of 46 distinct foods have no micronutrient data
// at all" for exactly this reason.
//
// ── WHAT THIS MODULE DOES ─────────────────────────────────────────────────
// Runs alongside ensureSchemaCurrent() on boot and brings the LIBRARY tables
// (Food / Recipe / RecipeIngredient — recipe taste tiers are columns on Recipe,
// not a separate table) up to the shipped template, while never reading or
// writing a single personal row.
//
// Five invariants make this safe to run against a database full of the user's
// own data. They are the whole design; everything else is bookkeeping:
//
//   I1  NO LOCAL ROW IS EVER DELETED, AND NO LOCAL id EVER CHANGES.
//       Food.id and Recipe.id are pointed at by MealLog, PlanSlot, CartItem,
//       RecipeRating, UserLibraryEntry and RecipeIngredient. Rewriting an id or
//       dropping a row is what "silently corrupts every recipe" looks like, so
//       the sync only ever UPDATEs matched rows and INSERTs unmatched ones.
//       A food or recipe the user created themselves is simply never matched,
//       and therefore never touched.
//
//   I2  NO LOCAL ROW IS EVER RENAMED.
//       The name is the user-visible identity of a food inside their recipes
//       and plans. 416 of the owner's 530 fdcId-bearing foods carry a template
//       name that differs from theirs ("Onions, raw" vs "Onion") and a handful
//       of those id claims are the corrupt ones ("Almonds" holding the FDC
//       record for "Almond Flour"). Renaming on the strength of a possibly
//       corrupt key is precisely the failure this sync exists to repair, so
//       names are read-only: only nutrition and provenance flow in.
//
//   I3  RecipeIngredient IS RESOLVED BY NATURAL KEY, NEVER BY id.
//       Template Food ids do not exist in the user's DB. Every template
//       ingredient's foodId is translated through the food match table built in
//       this run; if even one ingredient cannot be resolved the whole sync
//       rolls back rather than write a dangling pointer.
//
//   I4  ONE TRANSACTION, WITH A FILE BACKUP TAKEN FIRST.
//       Foods, recipes, ingredients and the version marker commit together or
//       not at all, and `PRAGMA foreign_key_check` runs before the commit.
//
//   I5  FAILURE IS ALWAYS SURVIVABLE.
//       ensureLibraryCurrent() never rejects and never throws. A broken
//       template, an unclassified new table, a locked DB — all of them log and
//       leave the app booting on the library it already had.
//
// ── MATCHING ORDER (the part worth arguing about) ─────────────────────────
// Four passes, strongest evidence first: LINEAGE (same row id), then NAME,
// then UNIQUE KEY (fdcId/upc), then INSERT.
//
// Lineage leads because it is not an inference: a local row carrying a template
// row's own id was created from it. 832 of the owner's 973 foods and 629 of his
// 634 recipes match this way, with zero name disagreements in either table.
//
// NAME beating fdcId is the contested call. Name-first resolves the common case
// correctly — the template's friendly "Onion" (fdcId 170000) and the local
// USDA-style "Onions, raw" (also 170000) collapse onto the one local row under
// its own name instead of producing a duplicate. Key-first would too, but
// key-first ALSO propagates the corrupt claims this library was repaired to
// remove: 416 of the owner's 530 fdcId-bearing foods disagree with the
// template's name for that record, and among them sits "Almonds" holding the
// FDC record for "Almond Flour". Names are what the user's recipes mean; a
// crossed fdcId is what a fuzzy matcher guessed. So names win, and a key claim
// is trusted only as a fallback for rows the library has genuinely renamed.
//
// Ambiguity NEVER resolves to a guess. If a normalised name maps to more than
// one template row (169 such groups: three distinct USDA "Radicchio, raw"
// records), no local row is updated from it and the template rows are inserted
// as the distinct foods they are.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Marker table holding one row: which template this DB's library came from.
// Deliberately NOT a Prisma model — Prisma ignores tables it does not know, the
// same way it ignores `_prisma_migrations`, and adding a model would mean a
// migration for pure bookkeeping. The leading underscore keeps it out of the
// app's namespace; note it does NOT match buildTemplateDb.mjs's `_prisma%`
// filter (in SQLite LIKE, `_` is a single-character wildcard), so that script's
// unclassified-table guard would flag it if a synced DB were ever used as a
// template source. A synced DB never is: the sync only runs when
// CUT_PROTOCOL_DB_PATH is set, and buildTemplateDb runs against backend/prisma/dev.db.
const MARKER_TABLE = "_LibrarySync";

const MARKER_DDL = `
CREATE TABLE IF NOT EXISTS "${MARKER_TABLE}" (
  "id"              INTEGER PRIMARY KEY CHECK ("id" = 1),
  "templateHash"    TEXT    NOT NULL,
  "templateSize"    INTEGER NOT NULL,
  "templateMtimeMs" REAL    NOT NULL,
  "syncedAt"        TEXT    NOT NULL,
  "stats"           TEXT    NOT NULL
);`;

// ── table classification ──────────────────────────────────────────────────
// buildTemplateDb.mjs is the project's single source of truth for which of the
// 25 tables are shared library and which are personal. It is an ESM script with
// top-level await that DELETES rows on import, so it cannot be required; and
// electron-builder excludes `backend/scripts/**` from the package, so it is not
// even present at runtime in the installed app.
//
// So: parse it when it is on disk (dev, CI, tests) and fall back to the
// embedded copy when it is not (packaged app). tests/librarySync.test.js
// asserts the two agree, which is what actually prevents drift — a second list
// nobody checks is the thing worth avoiding, not a second list at all.
const CLASSIFICATION_SOURCE = path.join(__dirname, "..", "..", "scripts", "buildTemplateDb.mjs");

const EMBEDDED_CLASSIFICATION = Object.freeze({
  library: Object.freeze(["Food", "Recipe", "RecipeIngredient"]),
  personal: Object.freeze([
    "BrainMessage", "BrainConversation", "BrainPreference", "BrainSolveRun",
    "GeneratedPlanItem", "GeneratedPlan", "GeneratedRecipe", "UserLibraryEntry",
    "RecipeRating", "LlmUsage", "MealLog", "CartItem", "GroceryList",
    "PlanSlot", "Plan", "Weighin", "Profile",
    "TrainingExercise", "TrainingSession", "TrainingWeek", "TrainingPlan",
    "Subscription", // saas-launch: billing state is personal — never ships
    "User",
  ]),
});

function parseClassificationSource(src) {
  const personal = src.match(/const\s+PERSONAL\s*=\s*\[([\s\S]*?)\]\s*;/);
  const keep = src.match(/const\s+KEEP\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)\s*;/);
  if (!personal || !keep) return null;
  const names = (body) => [...body.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']/g)].map((m) => m[1]);
  const library = names(keep[1]);
  const personalTables = names(personal[1]);
  if (library.length === 0 || personalTables.length === 0) return null;
  return { library, personal: personalTables };
}

/**
 * Which tables are library (synced) and which are personal (never touched).
 * `source` is "buildTemplateDb.mjs" when the real script was read, "embedded"
 * when the packaged fallback was used.
 */
function loadTableClassification(sourcePath = CLASSIFICATION_SOURCE) {
  try {
    if (fs.existsSync(sourcePath)) {
      const parsed = parseClassificationSource(fs.readFileSync(sourcePath, "utf8"));
      if (parsed) return { ...parsed, source: "buildTemplateDb.mjs" };
    }
  } catch { /* fall through to the embedded copy */ }
  return {
    library: [...EMBEDDED_CLASSIFICATION.library],
    personal: [...EMBEDDED_CLASSIFICATION.personal],
    source: "embedded",
  };
}

// ── column policy ─────────────────────────────────────────────────────────
// Columns the sync must never write on a MATCHED local row, per invariants
// I1/I2 plus one more rule: anything derived from the user's own personal rows
// stays local. Recipe.userRatingAvg / userRatingCount are aggregates of the
// user's RecipeRating rows — the template's values are null, and overwriting
// would wipe ratings the sync is otherwise forbidden to read.
const PROTECTED_COLUMNS = Object.freeze({
  Food: Object.freeze(["id", "name", "createdAt"]),
  Recipe: Object.freeze(["id", "name", "createdAt", "createdByUserId", "userRatingAvg", "userRatingCount"]),
});

// Same-name duplicate rows (the owner's DB has 101 such groups — "Olive Oil" /
// "Olive oil" / "olive oil", all three referenced by different recipes) get the
// primary's NUTRITION only. Their provenance labels stay theirs; their unique
// keys are released so exactly one row can claim one USDA record, which is the
// invariant Food.fdcId's @unique constraint exists to enforce.
const DUPLICATE_SYNC_COLUMNS = Object.freeze([
  "category", "kcal", "protein", "fat", "carb", "fiber",
  "micros", "allergenTags", "fdcCategory", "mayContain", "dataQuality",
]);

// ── small helpers ─────────────────────────────────────────────────────────

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

/** NFKC + case + whitespace only. Punctuation is meaning here: "Onions, raw"
 *  and "Onions raw" are not asserted to be the same food. */
function normaliseName(name) {
  return String(name ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function hashFile(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function openDb(file, options) {
  // Lazily required so a dev boot (which returns before ever reaching here)
  // never loads it or prints node:sqlite's ExperimentalWarning.
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(file, options);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${q(table)})`).all().map((c) => c.name);
}

function tableExists(db, table) {
  return db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table) != null;
}

function userTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name")
    .all()
    .map((r) => r.name);
}

/** Reuse the template's id when it is free locally — it keeps ids stable across
 *  future syncs — otherwise derive a deterministic, collision-checked one. */
function mintId(preferred, used) {
  if (preferred && !used.has(preferred)) { used.add(preferred); return preferred; }
  const base = preferred || crypto.randomUUID();
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-lib${i}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  const fallback = `lib-${crypto.randomUUID()}`;
  used.add(fallback);
  return fallback;
}

// ── marker ────────────────────────────────────────────────────────────────

function readMarker(db) {
  if (!tableExists(db, MARKER_TABLE)) return null;
  try {
    return db.prepare(`SELECT * FROM ${q(MARKER_TABLE)} WHERE id = 1`).get() || null;
  } catch {
    return null;
  }
}

function writeMarker(db, fingerprint, stats) {
  db.exec(MARKER_DDL);
  db.prepare(
    `INSERT INTO ${q(MARKER_TABLE)} (id, templateHash, templateSize, templateMtimeMs, syncedAt, stats)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       templateHash = excluded.templateHash,
       templateSize = excluded.templateSize,
       templateMtimeMs = excluded.templateMtimeMs,
       syncedAt = excluded.syncedAt,
       stats = excluded.stats`
  ).run(fingerprint.hash, fingerprint.size, fingerprint.mtimeMs, new Date().toISOString(), JSON.stringify(stats));
}

/**
 * Cheap identity for the packaged template. size+mtime is the fast path (the
 * template is a read-only packaged resource, so both are stable for the life of
 * an install and both change on update); the sha256 is only computed when that
 * fast path misses, and is what the decision actually rests on.
 */
function templateFingerprint(templatePath, { hash = true } = {}) {
  const st = fs.statSync(templatePath);
  return { size: st.size, mtimeMs: st.mtimeMs, hash: hash ? hashFile(templatePath) : null };
}

/**
 * Record "this DB's library is exactly this template" without doing any work.
 * Called right after a fresh install copies the template into place, so the
 * very first boot skips a full 14k-row comparison that could only ever be a
 * no-op. Best effort: a failure here costs one slow boot, nothing more.
 */
function markLibraryFromTemplate(dbPath, templatePath) {
  let db = null;
  try {
    const fingerprint = templateFingerprint(templatePath);
    db = openDb(dbPath, { timeout: 15000 });
    db.exec("BEGIN");
    try {
      writeMarker(db, fingerprint, { origin: "template-copy" });
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* nothing open */ }
      throw e;
    }
    return true;
  } catch (e) {
    console.warn(`[librarySync] could not record the template version after first-run copy: ${e.message}`);
    return false;
  } finally {
    try { if (db) db.close(); } catch { /* already closed */ }
  }
}

// ── planning: foods ───────────────────────────────────────────────────────

function planFoods(localFoods, templateFoods, refCounts, warnings) {
  const localById = new Map(localFoods.map((r) => [r.id, r]));
  const fdcOwner = new Map();
  const upcOwner = new Map();
  const localByName = new Map();
  for (const r of localFoods) {
    if (r.fdcId != null) fdcOwner.set(r.fdcId, r.id);
    if (r.upc != null) upcOwner.set(r.upc, r.id);
    const k = normaliseName(r.name);
    if (!localByName.has(k)) localByName.set(k, []);
    localByName.get(k).push(r);
  }
  const templateByName = new Map();
  for (const r of templateFoods) {
    const k = normaliseName(r.name);
    templateByName.set(k, (templateByName.get(k) || 0) + 1);
  }

  // Deterministic order so two runs on the same inputs plan identically.
  const ordered = [...templateFoods].sort((a, b) => {
    const an = normaliseName(a.name), bn = normaliseName(b.name);
    if (an !== bn) return an < bn ? -1 : 1;
    const af = a.fdcId ?? Number.MAX_SAFE_INTEGER, bf = b.fdcId ?? Number.MAX_SAFE_INTEGER;
    if (af !== bf) return af - bf;
    return String(a.id) < String(b.id) ? -1 : 1;
  });

  const claimed = new Set();
  const idMap = new Map();      // template Food id -> local Food id
  const updates = [];           // { localId, template, mode }
  const inserts = [];           // { id, template }

  const releaseKeys = (row) => {
    if (row.fdcId != null && fdcOwner.get(row.fdcId) === row.id) fdcOwner.delete(row.fdcId);
    if (row.upc != null && upcOwner.get(row.upc) === row.id) upcOwner.delete(row.upc);
  };

  // A row may only take t's unique keys if nobody outside `allowed` holds them.
  const keysAreFree = (t, allowed) =>
    !(t.fdcId != null && fdcOwner.has(t.fdcId) && !allowed.has(fdcOwner.get(t.fdcId))) &&
    !(t.upc != null && upcOwner.has(t.upc) && !allowed.has(upcOwner.get(t.upc)));

  const claim = (localRow, t, mode) => {
    claimed.add(localRow.id);
    releaseKeys(localRow);
    if (t.fdcId != null) fdcOwner.set(t.fdcId, localRow.id);
    if (t.upc != null) upcOwner.set(t.upc, localRow.id);
    updates.push({
      localId: localRow.id,
      template: t,
      mode,
      // Whether this row's unique keys have to be cleared before ANY row is
      // written. See applyPlan's phase 0 — the final state is collision-free,
      // but the path to it is not.
      releasesKeys: (localRow.fdcId ?? null) !== (t.fdcId ?? null) || (localRow.upc ?? null) !== (t.upc ?? null),
    });
    idMap.set(t.id, localRow.id);
  };

  // ── PASS 0 — LINEAGE. A local row carrying a template row's own id was
  // created from that template row: either both databases descend from the same
  // seed (832 of the owner's 973 foods do, with zero name disagreements) or an
  // earlier run of this very sync inserted it, since inserts reuse the template
  // id whenever it is free.
  //
  // This pass is what makes the sync CONVERGENT. Without it, a template row
  // with no unique key whose name is ambiguous on the template side (two
  // "Vinegar" rows, one manual and one USDA-verified) can never be matched by
  // anything, so every full re-scan inserts another copy of it and every recipe
  // that uses it gets re-pointed at the new copy. Measured before this pass
  // existed: a second pass over an already-synced DB re-inserted 6 foods and
  // rewrote 52 ingredient sets. After it: zero, zero.
  for (const t of ordered) {
    const local = localById.get(t.id);
    if (!local || claimed.has(local.id)) continue;
    if (!keysAreFree(t, new Set([local.id]))) continue;
    claim(local, t, "id");
  }

  // ── PASS A — NAME. Only from an unambiguous template name, onto the single
  // best unclaimed local row of that name. Same-name stragglers are handled by
  // pass D, which runs after every mapping is known.
  for (const t of ordered) {
    if (idMap.has(t.id)) continue;
    const key = normaliseName(t.name);
    if (templateByName.get(key) !== 1) continue;                 // template-side ambiguity
    const candidates = (localByName.get(key) || []).filter((r) => !claimed.has(r.id));
    if (candidates.length === 0) continue;
    if (!keysAreFree(t, new Set(candidates.map((r) => r.id)))) continue;

    // Primary = the row the user's recipes lean on hardest, tie-broken by an
    // exact-case name match and then by id, so the choice never depends on
    // row order.
    const primary = candidates.slice().sort((a, b) => {
      const ra = refCounts.get(a.id) || 0, rb = refCounts.get(b.id) || 0;
      if (ra !== rb) return rb - ra;
      const ea = a.name === t.name ? 0 : 1, eb = b.name === t.name ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return String(a.id) < String(b.id) ? -1 : 1;
    })[0];
    claim(primary, t, "name");
  }

  // ── PASS B — UNIQUE KEY. Reached only by template rows whose id and name
  // both failed, i.e. rows the library has since renamed away from what this
  // install still calls them ("Onion" here, "Onions, raw" there).
  for (const t of ordered) {
    if (idMap.has(t.id)) continue;
    const ownerId = (t.fdcId != null && fdcOwner.get(t.fdcId)) || (t.upc != null && upcOwner.get(t.upc)) || null;
    if (!ownerId) continue;
    if (claimed.has(ownerId)) {
      // Unreachable as the planner stands: a claim releases the claimed row's
      // old keys, so a row still holding t's key can only have been claimed by
      // t itself, which is not in this loop. Kept as an alias rather than an
      // assertion — mapping to the row that already carries this record's
      // content keeps ingredients resolvable, where throwing would abandon the
      // whole sync over a bookkeeping surprise.
      idMap.set(t.id, ownerId);
      continue;
    }
    if (!keysAreFree(t, new Set([ownerId]))) continue;
    claim(localById.get(ownerId), t, "key");
  }

  // ── PASS C — INSERT. A template row nothing local represents.
  const usedIds = new Set(localById.keys());
  for (const t of ordered) {
    if (idMap.has(t.id)) continue;
    const row = { ...t };
    if (row.fdcId != null && fdcOwner.has(row.fdcId)) {
      warnings.push(`food "${t.name}": fdcId ${row.fdcId} still held locally; inserted without it`);
      row.fdcId = null;
    }
    if (row.upc != null && upcOwner.has(row.upc)) {
      warnings.push(`food "${t.name}": upc ${row.upc} still held locally; inserted without it`);
      row.upc = null;
    }
    const id = mintId(t.id, usedIds);
    if (row.fdcId != null) fdcOwner.set(row.fdcId, id);
    if (row.upc != null) upcOwner.set(row.upc, id);
    inserts.push({ id, template: row });
    idMap.set(t.id, id);
  }

  // ── PASS D — SAME-NAME STRAGGLERS. The owner's DB holds 101 groups of
  // case-variant duplicates ("Olive Oil" / "Olive oil" / "olive oil", all three
  // referenced by different recipes). Fixing only the one row the library
  // matched would leave the recipes pointing at the other two just as stale, so
  // every unclaimed row sharing an unambiguous template name gets that row's
  // NUTRITION. It does NOT get its provenance: source stays local, and the
  // unique keys are released so exactly one row can claim one USDA record —
  // which is the invariant Food.fdcId's @unique constraint exists to enforce.
  for (const t of ordered) {
    const key = normaliseName(t.name);
    if (templateByName.get(key) !== 1) continue;
    if (!idMap.has(t.id)) continue;
    for (const c of localByName.get(key) || []) {
      if (claimed.has(c.id)) continue;
      claimed.add(c.id);
      releaseKeys(c);
      updates.push({
        localId: c.id,
        template: t,
        mode: "name-duplicate",
        releasesKeys: c.fdcId != null || c.upc != null,
      });
    }
  }

  return { idMap, updates, inserts, untouchedLocal: localFoods.length - claimed.size };
}

// ── planning: recipes ─────────────────────────────────────────────────────

function planRecipes(localRecipes, templateRecipes, warnings) {
  const byExact = new Map();
  const byNorm = new Map();
  for (const r of localRecipes) {
    byExact.set(r.name, r);
    const k = normaliseName(r.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(r);
  }
  const templateNormCount = new Map();
  for (const r of templateRecipes) {
    const k = normaliseName(r.name);
    templateNormCount.set(k, (templateNormCount.get(k) || 0) + 1);
  }

  const ordered = [...templateRecipes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const claimed = new Set();
  const idMap = new Map();
  const updates = [];
  const inserts = [];
  const preserved = [];   // matched but user-owned: content and ingredients left alone

  const take = (local, t) => {
    claimed.add(local.id);
    idMap.set(t.id, local.id);
    // A recipe the user created is theirs. The library may share its name
    // (Recipe.name is UNIQUE, so a collision is the only way this happens) but
    // it may not overwrite it.
    if (local.createdByUserId != null) preserved.push({ localId: local.id, name: local.name });
    else updates.push({ localId: local.id, template: t });
  };

  // Lineage first, for the same convergence reason as foods (629 of the
  // owner's 634 recipes share an id with their template row, all with matching
  // names; the other 5 are his own).
  const byId = new Map(localRecipes.map((r) => [r.id, r]));
  for (const t of ordered) {
    const local = byId.get(t.id);
    if (local && !claimed.has(local.id)) take(local, t);
  }
  for (const t of ordered) {
    if (idMap.has(t.id)) continue;
    const exact = byExact.get(t.name);
    if (exact && !claimed.has(exact.id)) { take(exact, t); }
  }
  for (const t of ordered) {
    if (idMap.has(t.id)) continue;
    const k = normaliseName(t.name);
    if (templateNormCount.get(k) !== 1) continue;
    const candidates = (byNorm.get(k) || []).filter((r) => !claimed.has(r.id));
    if (candidates.length !== 1) continue;    // ambiguous locally -> insert instead
    take(candidates[0], t);
  }

  const usedIds = new Set(localRecipes.map((r) => r.id));
  const usedNames = new Set(localRecipes.map((r) => r.name));
  for (const t of ordered) {
    if (idMap.has(t.id)) continue;
    if (usedNames.has(t.name)) {
      // Recipe.name is UNIQUE — an exact-name row must have matched above, so
      // this is unreachable. Skip rather than take a UNIQUE violation.
      warnings.push(`recipe "${t.name}": name already present locally but unmatched; not inserted`);
      continue;
    }
    const id = mintId(t.id, usedIds);
    usedNames.add(t.name);
    inserts.push({ id, template: t });
    idMap.set(t.id, id);
  }

  return { idMap, updates, inserts, preserved, untouchedLocal: localRecipes.length - claimed.size };
}

// ── planning: ingredients ─────────────────────────────────────────────────

const ingredientKey = (r) =>
  `${r.foodId}|${Number(r.baseGrams).toFixed(6)}|${r.scalable ? 1 : 0}|${r.role ?? ""}`;

/**
 * Translate the template's ingredient rows onto local food ids, and decide
 * which recipes actually need rewriting. Recipes whose resolved ingredient set
 * already matches are left alone — that is what makes a second run a no-op at
 * the row level, not just at the version-marker level.
 */
function planIngredients(localIngredients, templateIngredients, foodIdMap, recipePlan) {
  const localByRecipe = new Map();
  for (const r of localIngredients) {
    if (!localByRecipe.has(r.recipeId)) localByRecipe.set(r.recipeId, []);
    localByRecipe.get(r.recipeId).push(r);
  }
  const templateByRecipe = new Map();
  for (const r of templateIngredients) {
    if (!templateByRecipe.has(r.recipeId)) templateByRecipe.set(r.recipeId, []);
    templateByRecipe.get(r.recipeId).push(r);
  }

  // Only recipes whose content this run owns. User-owned recipes (recipePlan
  // .preserved) are deliberately absent: their ingredients are theirs.
  const syncable = new Map();
  for (const u of recipePlan.updates) syncable.set(u.template.id, u.localId);
  for (const i of recipePlan.inserts) syncable.set(i.template.id, i.id);

  const rewrites = [];
  const unresolved = [];
  for (const [templateRecipeId, localRecipeId] of syncable) {
    const rows = templateByRecipe.get(templateRecipeId) || [];
    // Merge on (recipeId, foodId).
    //
    // The reason it is needed: migration 20260724203000 added
    // UNIQUE(recipeId, foodId), and a template built before that migration
    // still carries duplicate pairs. Found by booting the real sequence against
    // a copy of the owner's database — the sync failed with "UNIQUE constraint
    // failed: RecipeIngredient.recipeId, RecipeIngredient.foodId". It failed
    // SAFELY (rolled back, app booted on the old library) but it would never
    // have succeeded, which is the bug this module exists to end.
    //
    // It also covers the case where two template foods resolve to one local
    // row. Nothing in the current planner produces that — each template food
    // claims a distinct local row and pass B's alias branch is unreachable
    // while claims release their keys — but the merge costs nothing and the
    // alternative failure is a constraint violation at 3 a.m. on a user's
    // machine rather than here.
    // The aggregation deliberately matches that migration's, so a merge here
    // and a merge there produce the same row: grams SUMMED (cached recipe
    // macros already summed every duplicate line, so total grams per food must
    // not change), `scalable` OR-ed, `role` the earliest non-null.
    const merged = new Map();
    for (const r of rows) {
      const localFoodId = foodIdMap.get(r.foodId);
      if (!localFoodId) { unresolved.push({ templateRecipeId, templateFoodId: r.foodId }); continue; }
      const existing = merged.get(localFoodId);
      if (existing) {
        existing.baseGrams += r.baseGrams;
        existing.scalable = Math.max(Number(existing.scalable ? 1 : 0), Number(r.scalable ? 1 : 0));
        if (existing.role == null) existing.role = r.role ?? null;
      } else {
        merged.set(localFoodId, { id: r.id, recipeId: localRecipeId, foodId: localFoodId, baseGrams: r.baseGrams, scalable: r.scalable, role: r.role ?? null });
      }
    }
    const desired = [...merged.values()];
    const current = localByRecipe.get(localRecipeId) || [];
    const a = current.map(ingredientKey).sort();
    const b = desired.map(ingredientKey).sort();
    if (a.length === b.length && a.every((v, i) => v === b[i])) continue;   // already identical
    rewrites.push({ localRecipeId, desired });
  }
  return { rewrites, unresolved };
}

// ── honesty: recipes this sync leaves holding a stale number ──────────────
// Correcting a food's macros (the whole point — the owner's "Oats" reads
// 884 kcal / 100 g fat because it carries an OIL record) invalidates the cached
// kcal/protein/fat/carb of every recipe that uses it. Library recipes are
// re-cached from the template in the same transaction, so they stay consistent.
// The user's OWN recipes are not, and this sync may not rewrite them — but
// "wrong math = product death", so a number this sync knowingly invalidated is
// reported rather than left to be discovered.
function findStaleCaches(localFoods, localIngredients, foodPlan, recipePlan) {
  const NUTRITION = ["kcal", "protein", "fat", "carb", "fiber"];
  const byId = new Map(localFoods.map((r) => [r.id, r]));
  const changed = new Set();
  for (const u of foodPlan.updates) {
    const before = byId.get(u.localId);
    if (!before) continue;
    if (NUTRITION.some((c) => c in u.template && Number(before[c] ?? 0) !== Number(u.template[c] ?? 0))) changed.add(u.localId);
  }
  if (changed.size === 0) return [];

  const resynced = new Set(recipePlan.updates.map((u) => u.localId));
  for (const i of recipePlan.inserts) resynced.add(i.id);
  const affected = new Set();
  for (const ri of localIngredients) {
    if (!resynced.has(ri.recipeId) && changed.has(ri.foodId)) affected.add(ri.recipeId);
  }
  return [...affected];
}

// ── apply ─────────────────────────────────────────────────────────────────

function applyPlan(db, ctx) {
  const { foodCols, recipeCols, ingredientCols, foodPlan, recipePlan, ingredientPlan } = ctx;

  const stats = {
    foodsUpdated: 0, foodsDuplicateUpdated: 0, foodsInserted: 0,
    recipesUpdated: 0, recipesInserted: 0, recipesPreserved: recipePlan.preserved.length,
    recipesIngredientsRewritten: 0, ingredientRowsWritten: 0,
    foodsUntouched: foodPlan.untouchedLocal, recipesUntouched: recipePlan.untouchedLocal,
  };

  // ── foods, phase 0: release unique keys that are about to move.
  // The planned END state is collision-free by construction, but the PATH to it
  // is not: when the library hands a food's fdcId to its same-name sibling, the
  // two rows both hold it for the instant between the two UPDATEs and SQLite
  // rejects the first one ("UNIQUE constraint failed: Food.fdcId"). Statement
  // order can be made to work, but only by reasoning that has to be redone
  // every time the planner changes. Clearing every key that is going to move —
  // before anything is written — makes the apply order irrelevant instead.
  const keyCols = ["fdcId", "upc"].filter((c) => foodCols.includes(c));
  if (keyCols.length) {
    const release = db.prepare(
      `UPDATE ${q("Food")} SET ${keyCols.map((c) => `${q(c)} = NULL`).join(", ")} WHERE ${q("id")} = ?`
    );
    for (const u of foodPlan.updates) if (u.releasesKeys) release.run(u.localId);
  }

  // ── foods: full update (matched primary / key match)
  const foodUpdateCols = foodCols.filter((c) => !PROTECTED_COLUMNS.Food.includes(c));
  const foodUpdate = db.prepare(
    `UPDATE ${q("Food")} SET ${foodUpdateCols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${q("id")} = ?`
  );
  const dupCols = foodCols.filter((c) => DUPLICATE_SYNC_COLUMNS.includes(c));
  const dupExtra = ["fdcId", "upc"].filter((c) => foodCols.includes(c));
  const foodDupUpdate = db.prepare(
    `UPDATE ${q("Food")} SET ${dupCols.map((c) => `${q(c)} = ?`).join(", ")}` +
    `${dupExtra.length ? ", " + dupExtra.map((c) => `${q(c)} = NULL`).join(", ") : ""} WHERE ${q("id")} = ?`
  );
  for (const u of foodPlan.updates) {
    if (u.mode === "name-duplicate") {
      foodDupUpdate.run(...dupCols.map((c) => u.template[c] ?? null), u.localId);
      stats.foodsDuplicateUpdated++;
    } else {
      foodUpdate.run(...foodUpdateCols.map((c) => u.template[c] ?? null), u.localId);
      stats.foodsUpdated++;
    }
  }

  const foodInsert = db.prepare(
    `INSERT INTO ${q("Food")} (${foodCols.map(q).join(", ")}) VALUES (${foodCols.map(() => "?").join(", ")})`
  );
  for (const ins of foodPlan.inserts) {
    foodInsert.run(...foodCols.map((c) => (c === "id" ? ins.id : ins.template[c] ?? null)));
    stats.foodsInserted++;
  }

  // ── recipes
  const recipeUpdateCols = recipeCols.filter((c) => !PROTECTED_COLUMNS.Recipe.includes(c));
  const recipeUpdate = db.prepare(
    `UPDATE ${q("Recipe")} SET ${recipeUpdateCols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${q("id")} = ?`
  );
  for (const u of recipePlan.updates) {
    recipeUpdate.run(...recipeUpdateCols.map((c) => u.template[c] ?? null), u.localId);
    stats.recipesUpdated++;
  }
  const recipeInsert = db.prepare(
    `INSERT INTO ${q("Recipe")} (${recipeCols.map(q).join(", ")}) VALUES (${recipeCols.map(() => "?").join(", ")})`
  );
  for (const ins of recipePlan.inserts) {
    recipeInsert.run(...recipeCols.map((c) => {
      if (c === "id") return ins.id;
      // A library recipe belongs to no user; never import the template's value.
      if (c === "createdByUserId") return null;
      return ins.template[c] ?? null;
    }));
    stats.recipesInserted++;
  }

  // ── ingredients: whole-set replacement per recipe, resolved by natural key
  const riDelete = db.prepare(`DELETE FROM ${q("RecipeIngredient")} WHERE ${q("recipeId")} = ?`);
  const riInsert = db.prepare(
    `INSERT INTO ${q("RecipeIngredient")} (${ingredientCols.map(q).join(", ")}) VALUES (${ingredientCols.map(() => "?").join(", ")})`
  );
  const usedRiIds = new Set(db.prepare(`SELECT id FROM ${q("RecipeIngredient")}`).all().map((r) => r.id));
  for (const rw of ingredientPlan.rewrites) {
    riDelete.run(rw.localRecipeId);
    for (const row of rw.desired) {
      const id = mintId(row.id, usedRiIds);
      riInsert.run(...ingredientCols.map((c) => (c === "id" ? id : row[c] ?? null)));
      stats.ingredientRowsWritten++;
    }
    stats.recipesIngredientsRewritten++;
  }

  return stats;
}

// ── entry points ──────────────────────────────────────────────────────────

/**
 * Bring the library tables at `dbPath` up to the library in `templatePath`.
 * Throws on any problem, having rolled back; the caller decides what that
 * means. Use ensureLibraryCurrent() for the boot path.
 *
 * @param {object} options
 * @param {string} options.dbPath
 * @param {string} options.templatePath
 * @param {boolean} [options.force]        run even when the version marker matches
 * @param {boolean} [options.integrityCheck]  run PRAGMA integrity_check after commit
 * @returns {{status: string, stats?: object, warnings?: string[], backupPath?: string|null, reason?: string}}
 */
function syncLibrary(options) {
  const { dbPath, templatePath, force = false, integrityCheck = false } = options;
  if (!dbPath || !fs.existsSync(dbPath)) return { status: "skipped", reason: "no database file" };
  if (!templatePath || !fs.existsSync(templatePath)) return { status: "skipped", reason: "no packaged template" };

  const classification = loadTableClassification();
  const warnings = [];
  let db = null;
  let template = null;
  let backupPath = null;
  let open = false;

  try {
    // ── fast path. stat only; no hashing, no template open, no row scan.
    const st = fs.statSync(templatePath);
    db = openDb(dbPath, { timeout: 15000 });
    const marker = readMarker(db);
    if (!force && marker && marker.templateSize === st.size && Number(marker.templateMtimeMs) === st.mtimeMs) {
      return { status: "current", reason: "fingerprint" };
    }

    // ── slow path. The hash is the real decision; size+mtime only short-circuit it.
    const fingerprint = { size: st.size, mtimeMs: st.mtimeMs, hash: hashFile(templatePath) };
    if (!force && marker && marker.templateHash === fingerprint.hash) {
      db.exec("BEGIN");
      try { writeMarker(db, fingerprint, JSON.parse(marker.stats || "{}")); db.exec("COMMIT"); }
      catch (e) { try { db.exec("ROLLBACK"); } catch { /* nothing open */ } throw e; }
      return { status: "current", reason: "hash" };
    }

    // ── guard: every table must be classified, exactly as buildTemplateDb.mjs
    // refuses to ship a table nobody has decided about. A new personal table
    // this sync has never heard of is a reason to do nothing, loudly.
    const known = new Set([...classification.library, ...classification.personal]);
    const unclassified = userTables(db).filter((t) => !known.has(t));
    if (unclassified.length) {
      return {
        status: "skipped",
        reason: `unclassified table(s) ${unclassified.join(", ")} — classify them in scripts/buildTemplateDb.mjs (and src/lib/librarySync.js's embedded copy) before the library can sync`,
      };
    }
    for (const t of classification.library) {
      if (!tableExists(db, t)) return { status: "skipped", reason: `library table ${t} missing from the database` };
    }

    template = openDb(templatePath, { readOnly: true });
    for (const t of classification.library) {
      if (!tableExists(template, t)) return { status: "skipped", reason: `library table ${t} missing from the template` };
    }
    const templateFoodCount = template.prepare(`SELECT COUNT(*) AS c FROM ${q("Food")}`).get().c;
    if (!templateFoodCount) return { status: "skipped", reason: "template carries no foods — refusing to sync from it" };

    // Only columns BOTH sides have. If the template were built from a newer
    // schema than this install has migrated to, its extra columns are ignored
    // rather than crashing the boot.
    const shared = (t) => {
      const l = tableColumns(db, t), r = new Set(tableColumns(template, t));
      const cols = l.filter((c) => r.has(c));
      const missing = l.filter((c) => !r.has(c));
      if (missing.length) warnings.push(`${t}: template has no ${missing.join(", ")} — left at local values`);
      return cols;
    };
    const foodCols = shared("Food");
    const recipeCols = shared("Recipe");
    const ingredientCols = shared("RecipeIngredient");

    // The planner needs the local matching keys even if the template lacks the
    // column (then it simply never writes it) — hence the union, intersected
    // back against what the local table actually has.
    const sel = (conn, t, cols) => conn.prepare(`SELECT ${cols.map(q).join(", ")} FROM ${q(t)}`).all();
    const localFoodCols = new Set(tableColumns(db, "Food"));
    const localRecipeCols = new Set(tableColumns(db, "Recipe"));
    const localFoods = sel(db, "Food", [...new Set([...foodCols, "id", "name", "fdcId", "upc"])].filter((c) => localFoodCols.has(c)));
    const templateFoods = sel(template, "Food", foodCols);
    const localRecipes = sel(db, "Recipe", [...new Set([...recipeCols, "id", "name", "createdByUserId"])].filter((c) => localRecipeCols.has(c)));
    const templateRecipes = sel(template, "Recipe", recipeCols);
    const localIngredients = sel(db, "RecipeIngredient", ingredientCols);
    const templateIngredients = sel(template, "RecipeIngredient", ingredientCols);
    const refCounts = new Map(
      db.prepare(`SELECT ${q("foodId")} AS foodId, COUNT(*) AS c FROM ${q("RecipeIngredient")} GROUP BY 1`).all().map((r) => [r.foodId, Number(r.c)])
    );

    const foodPlan = planFoods(localFoods, templateFoods, refCounts, warnings);
    const recipePlan = planRecipes(localRecipes, templateRecipes, warnings);
    const staleRecipes = findStaleCaches(localFoods, localIngredients, foodPlan, recipePlan);
    const ingredientPlan = planIngredients(localIngredients, templateIngredients, foodPlan.idMap, recipePlan);
    if (ingredientPlan.unresolved.length) {
      // I3. Every template food is matched or inserted, so this is unreachable;
      // if it ever fires, the alternative is writing a dangling foodId.
      throw new Error(
        `${ingredientPlan.unresolved.length} template ingredient(s) could not be resolved to a local food — refusing to write dangling references`
      );
    }

    const nothingToDo =
      foodPlan.updates.length === 0 && foodPlan.inserts.length === 0 &&
      recipePlan.updates.length === 0 && recipePlan.inserts.length === 0 &&
      ingredientPlan.rewrites.length === 0;

    if (!nothingToDo) {
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* not in WAL mode */ }
      const { backupDatabaseFile } = require("./desktopBootstrap.js");
      backupPath = backupDatabaseFile(dbPath);
    }

    // Foreign keys stay ON here, unlike the migration runner two doors down
    // (which must turn them OFF because migration 20260717183855 does a
    // RedefineTables DROP TABLE "Recipe" that would cascade-delete real rows
    // with enforcement live). Nothing here drops or rebuilds a table: it only
    // inserts, updates non-key columns, and replaces a recipe's own ingredient
    // rows. With enforcement ON, RecipeIngredient's RESTRICT foreign keys
    // become a live tripwire on exactly the remap this module could get wrong.
    db.exec("PRAGMA foreign_keys=ON");
    const fkOn = Number(db.prepare("SELECT foreign_keys AS v FROM pragma_foreign_keys").get().v);
    if (fkOn !== 1) throw new Error("could not enable foreign-key enforcement — refusing to rewrite ingredients unchecked");

    db.exec("BEGIN");
    open = true;
    let stats;
    try {
      stats = applyPlan(db, { foodCols, recipeCols, ingredientCols, foodPlan, recipePlan, ingredientPlan });
      stats.recipesWithStaleCache = staleRecipes.length;
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length) {
        const sample = violations.slice(0, 5).map((v) => `${v.table} rowid=${v.rowid} -> ${v.parent}`).join("; ");
        throw new Error(`library sync would orphan ${violations.length} row(s) — rolled back. First: ${sample}`);
      }
      writeMarker(db, fingerprint, { ...stats, warnings: warnings.length });
      db.exec("COMMIT");
      open = false;
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* nothing open */ }
      open = false;
      throw e;
    }

    if (integrityCheck) {
      const rows = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check);
      if (rows.length !== 1 || rows[0] !== "ok") throw new Error(`integrity_check after sync: ${rows.join("; ")}`);
    }

    return { status: nothingToDo ? "current" : "synced", stats, warnings, backupPath, classification: classification.source };
  } finally {
    if (open && db) { try { db.exec("ROLLBACK"); } catch { /* nothing open */ } }
    try { if (template) template.close(); } catch { /* already closed */ }
    try { if (db) db.close(); } catch { /* already closed */ }
  }
}

/**
 * The boot entry point. Resolves — always. A library that fails to update is a
 * stale library; a boot path that throws is a bricked app, and the whole reason
 * this module exists is that the owner's app was already stuck once.
 *
 * Call it after ensureSchemaCurrent() has resolved: the sync writes through the
 * live schema and must never race a table rebuild.
 */
async function ensureLibraryCurrent(options = {}) {
  const dbPath = options.dbPath || process.env.CUT_PROTOCOL_DB_PATH;
  if (!dbPath) return { status: "skipped", reason: "dev mode" };

  let templatePath = options.templatePath;
  if (!templatePath) {
    const { getTemplateDbPath } = require("./desktopBootstrap.js");
    templatePath = getTemplateDbPath();
  }
  if (!templatePath || !fs.existsSync(templatePath)) {
    return { status: "skipped", reason: "no packaged template" };
  }

  try {
    const t0 = Date.now();
    const result = syncLibrary({ ...options, dbPath, templatePath });
    if (result.status === "synced") {
      const s = result.stats;
      console.log(
        `[librarySync] library updated in ${Date.now() - t0} ms — foods +${s.foodsInserted} new / ${s.foodsUpdated} refreshed` +
        ` (${s.foodsDuplicateUpdated} same-name duplicates), recipes +${s.recipesInserted} new / ${s.recipesUpdated} refreshed,` +
        ` ${s.recipesIngredientsRewritten} ingredient sets rebuilt. Untouched: ${s.foodsUntouched} local foods,` +
        ` ${s.recipesUntouched} local recipes, ${s.recipesPreserved} user-owned recipes. Backup: ${result.backupPath}`
      );
      if (s.recipesWithStaleCache) {
        console.warn(
          `[librarySync] ${s.recipesWithStaleCache} recipe(s) not owned by the library use a food whose macros were just corrected;` +
          ` their cached totals are now stale and were left alone rather than rewritten. Re-save them to refresh.`
        );
      }
      for (const w of result.warnings.slice(0, 10)) console.warn(`[librarySync] ${w}`);
    } else if (result.status === "skipped") {
      console.warn(`[librarySync] skipped — ${result.reason}`);
    }
    return result;
  } catch (e) {
    // I5. Log where the backup is and boot on the library already in place.
    console.error(`[librarySync] library update failed, existing library left intact: ${e.message}`);
    try {
      fs.writeFileSync(`${dbPath}.library-sync-error.log`, `${new Date().toISOString()}\n${e.stack || e.message}\n`);
    } catch { /* best effort */ }
    return { status: "failed", reason: e.message };
  }
}

module.exports = {
  ensureLibraryCurrent,
  syncLibrary,
  markLibraryFromTemplate,
  loadTableClassification,
  parseClassificationSource,
  templateFingerprint,
  normaliseName,
  planFoods,
  planRecipes,
  planIngredients,
  MARKER_TABLE,
  EMBEDDED_CLASSIFICATION,
  CLASSIFICATION_SOURCE,
  PROTECTED_COLUMNS,
  DUPLICATE_SYNC_COLUMNS,
};
