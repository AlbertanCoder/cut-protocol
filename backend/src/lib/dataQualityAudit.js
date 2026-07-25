// Runtime data-quality audit — the Phase 2 guardrail wired into server
// startup. Same rules as scripts/auditFoodData.mjs (both defer to
// foodValidation.js); this one returns a compact summary instead of a full
// report file.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { prisma } = require("./prisma.js");
const { validateFood, validateRecipe, findDuplicateGroups } = require("./foodValidation.js");
const { CATEGORY_SLUGS } = require("./foodCategories.js");
const { loadFoodOverrides } = require("./foodOverrides.js");

// ── the columns the audit actually reads ────────────────────────────────────
// This used to be `prisma.food.findMany()` and
// `prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } })`.
// Measured on the live 14,122-food / 889-recipe library: 973 ms wall, 155 ms of
// contiguous event-loop block, RSS 65 -> 320 MB with ~220 MB never returned to
// the OS — on EVERY boot, landing exactly when the renderer fires /me, /profile
// and /summary.
//
// Two causes, both fixed here:
//   1. SELECT *  pulled `micros` (a JSON blob per row) and `dataQuality` (1.19 MB
//      of prose across the table, up to 367 chars a row) for 14,122 rows that the
//      validator barely touches. These selects name only what is read.
//   2. The nested include materialised a SEPARATE full Food object for each of
//      7,245 RecipeIngredient rows — thousands of duplicate copies of the same
//      few hundred foods. Below, the ingredients are joined to the ALREADY
//      LOADED food objects by reference, so each food exists once in memory.
const AUDIT_FOOD_SELECT = {
  id: true, name: true, category: true, source: true, dataQuality: true, fdcId: true,
  kcal: true, protein: true, fat: true, carb: true, fiber: true,
};
const AUDIT_RECIPE_SELECT = {
  id: true, name: true, kcal: true, protein: true, fat: true, carb: true,
  ingredients: { select: { foodId: true, baseGrams: true } },
};

// A row whose dataQuality opens with "exception:" carries a DOCUMENTED reason
// why the generic check does not apply to it (see the Food.dataQuality comment
// in schema.prisma). The USDA bulk import writes these for the two cases where
// the generic model is wrong rather than the data:
//   * USDA computed the record's energy with food-specific Atwater factors
//     (limes 3.36/8.37/2.48, chicken 4.27/9.02/3.87 — 4,716 of 5,024 records
//     that declare factors are not 4/4/9)
//   * ethanol supplies ~7 kcal/g and is reported in no macro field
// The reason travels ON THE ROW, so an exception is auditable, greppable and
// individually reviewable — it is not a silent pass. A row with no
// dataQuality, or one that merely warns, still fails.
const DOCUMENTED_EXCEPTION = /^exception:/;
const isDocumentedException = (food) => DOCUMENTED_EXCEPTION.test(food.dataQuality || "");

// `injected` ({ foods, recipes }) is for unit testing; at runtime it's omitted
// and the library is read from the DB.
async function runDataQualityAudit(injected) {
  const exemptions = loadFoodOverrides();
  const foods = injected?.foods ?? await prisma.food.findMany({ select: AUDIT_FOOD_SELECT });
  let recipes = injected?.recipes;
  if (!recipes) {
    const rows = await prisma.recipe.findMany({ select: AUDIT_RECIPE_SELECT });
    // Join by reference against the foods already in memory — no second copy.
    const byId = new Map(foods.map((f) => [f.id, f]));
    // An ingredient whose food row is gone gets a named placeholder rather than
    // a null: validateRecipe's macro sum would throw on null, and a crash is a
    // worse answer than "this recipe has an ingredient with no data".
    const orphan = (foodId) => ({
      id: foodId, name: `(missing food ${foodId})`, category: null,
      source: "manual-placeholder", dataQuality: null, fdcId: null,
      kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0,
    });
    recipes = rows.map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i) => ({ baseGrams: i.baseGrams, food: byId.get(i.foodId) || orphan(i.foodId) })),
    }));
  }

  const foodFailures = [];
  const exceptions = [];
  const placeholders = [];
  for (const f of foods) {
    const { ok, issues } = validateFood(f, { exemptions, validCategories: CATEGORY_SLUGS });
    if (ok) continue;
    if (isDocumentedException(f)) { exceptions.push({ name: f.name, dataQuality: f.dataQuality }); continue; }
    // A zero-macro placeholder is a row honestly announcing that nobody has
    // real data for it yet. It still counts as a failure — that is the point,
    // it must not go quiet — but it is reported separately from a row whose
    // numbers are actually wrong, because the fix is different (find real
    // data or delete the row; never invent a number for it).
    if (issues.every((i) => i.code === "placeholder")) placeholders.push({ name: f.name });
    foodFailures.push({ name: f.name, issues: issues.map((i) => i.code) });
  }

  // Duplicate detection, split by what a duplicate MEANS for each cohort:
  //  * hand-entered rows (no fdcId): two rows folding to one name key is the
  //    same food entered twice — a real bug, and what Phase 2 fixed.
  //  * USDA rows: identity is the fdcId. Thousands of legitimately distinct
  //    FDC records fold to the same loose name key ("Beef, ground" variants),
  //    so name-folding says nothing there; a repeated fdcId is the signal.
  const nonFdc = foods.filter((f) => f.fdcId == null);
  const duplicateGroups = findDuplicateGroups(nonFdc).length;

  const fdcCounts = new Map();
  for (const f of foods) {
    if (f.fdcId == null) continue;
    fdcCounts.set(f.fdcId, (fdcCounts.get(f.fdcId) || 0) + 1);
  }
  const duplicateFdcIdGroups = [...fdcCounts.values()].filter((n) => n > 1).length;

  // Provenance + data-quality breakdown, surfaced every boot so the tier mix
  // and the unvalidated remainder are never invisible.
  const bySource = {};
  for (const f of foods) bySource[f.source] = (bySource[f.source] || 0) + 1;
  const quality = { pass: 0, exception: 0, warn: 0, unvalidated: 0 };
  for (const f of foods) {
    const q = f.dataQuality;
    if (!q) quality.unvalidated++;
    else if (q.startsWith("pass")) quality.pass++;
    else if (q.startsWith("exception:")) quality.exception++;
    else quality.warn++;
  }

  const recipeFailures = [];
  for (const r of recipes) {
    const { ok, issues } = validateRecipe(r);
    if (!ok) recipeFailures.push({ name: r.name, issues: issues.map((i) => i.code) });
  }

  // Stage-C fix (#31): an EMPTY library must never read as "clean". A partial
  // template copy or a wrong-DB misconfiguration produces exactly foods:0 /
  // recipes:0 — the one guardrail that runs every boot has to be able to tell
  // "clean" apart from "uninitialized".
  const empty = foods.length === 0 || recipes.length === 0;

  // ── stop crying wolf ──────────────────────────────────────────────────
  // A zero-macro placeholder is a row honestly saying "nobody has real data for
  // me yet". It must stay VISIBLE, but it is not a defect that needs a human
  // tonight — and printing "ATTENTION NEEDED" on every single launch for one
  // known placeholder trains the reader to ignore the banner, which disarms the
  // guardrail for the day something real breaks. `clean` keeps its original
  // meaning (nothing at all outstanding, asserted by existing tests);
  // `actionable` is the narrower question the boot banner should ask.
  const placeholderNames = new Set(placeholders.map((p) => p.name));
  const realFoodFailures = foodFailures.filter((f) => !placeholderNames.has(f.name));
  const actionable = empty || realFoodFailures.length > 0 || recipeFailures.length > 0 || duplicateGroups > 0;

  return {
    foods: foods.length,
    recipes: recipes.length,
    foodFailures,
    recipeFailures,
    duplicateGroups,
    duplicateFdcIdGroups,
    exceptions,
    placeholders,
    bySource,
    quality,
    empty,
    clean: !empty && foodFailures.length === 0 && recipeFailures.length === 0 && duplicateGroups === 0,
    realFoodFailures,
    actionable,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONCE PER LIBRARY VERSION, NOT ONCE PER LAUNCH
// ═══════════════════════════════════════════════════════════════════════════
//
// The audit's output is a truth about the LIBRARY, and the library changes on
// an import or a sync — not on a restart. Re-deriving it every boot cost the
// full ~950 ms and ~220 MB of retained RSS to reprint the same sentence.
//
// So: take a cheap fingerprint of the library (five aggregate queries, single
// -digit ms), compare it to a cached verdict, and only re-run the real audit
// when the library actually moved.

/**
 * Cheap identity of the current library. Row counts plus the newest row in each
 * table: any insert, delete or re-import moves at least one of them. It cannot
 * see an in-place UPDATE of an existing row's macros — accepted deliberately,
 * because the alternative is hashing 14,122 rows, which is the cost this whole
 * mechanism exists to avoid. `librarySync` and every import path change counts
 * or timestamps; a hand-edit via PUT /foods/:id is the one case that needs
 * CUT_PROTOCOL_AUDIT=1 to force a re-run.
 */
async function libraryFingerprint() {
  const [foods, recipes, ingredients, newestFood, newestRecipe] = await Promise.all([
    prisma.food.count(),
    prisma.recipe.count(),
    prisma.recipeIngredient.count(),
    prisma.food.aggregate({ _max: { createdAt: true } }),
    prisma.recipe.aggregate({ _max: { createdAt: true } }),
  ]);
  return [
    foods, recipes, ingredients,
    newestFood._max.createdAt?.toISOString() ?? "-",
    newestRecipe._max.createdAt?.toISOString() ?? "-",
  ].join("|");
}

/**
 * Where the cached verdict lives.
 *
 * Packaged: beside the live database in the user's writable data dir, which is
 * the only directory this app may write to at runtime.
 * Dev/tests: the OS temp dir, keyed by a hash of the database URL. Deliberately
 * NOT backend/prisma/ — see CLAUDE.md's packaging section: that directory is
 * where new files get accidentally shipped, and a cache file is exactly the
 * kind of unrecognised new file the allowlist conversion exists to stop.
 */
function auditCachePath() {
  const dbPath = process.env.CUT_PROTOCOL_DB_PATH;
  if (dbPath) return `${dbPath}.data-audit.json`;
  const key = crypto.createHash("sha256").update(String(process.env.DATABASE_URL || "dev")).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `cut-protocol-data-audit-${key}.json`);
}

function readAuditCache() {
  try {
    return JSON.parse(fs.readFileSync(auditCachePath(), "utf8"));
  } catch {
    return null; // absent or unreadable: just re-run
  }
}

function writeAuditCache(entry) {
  try {
    fs.writeFileSync(auditCachePath(), JSON.stringify(entry));
  } catch {
    /* a cache that cannot be written is a slow boot, never a failed one */
  }
}

/**
 * The boot-time entry point. Returns { summary, source, fingerprint } where
 * `source` is "cache" (nothing was recomputed) or "fresh".
 *
 * `summary` from the cache is the SUMMARY LINE ONLY (counts + verdict), not the
 * full failure list — caching 14,122 rows' worth of detail to print one line
 * would recreate the memory cost in a different place. Anything that needs the
 * detail calls runDataQualityAudit() directly, which is still exactly as
 * available as it was before.
 */
async function auditIfLibraryChanged({ force = false } = {}) {
  const fingerprint = await libraryFingerprint();
  if (!force) {
    const cached = readAuditCache();
    if (cached && cached.fingerprint === fingerprint && cached.summary) {
      return { summary: cached.summary, source: "cache", fingerprint };
    }
  }
  const full = await runDataQualityAudit();
  const summary = {
    foods: full.foods,
    recipes: full.recipes,
    foodFailures: full.foodFailures.length,
    realFoodFailures: full.realFoodFailures.length,
    recipeFailures: full.recipeFailures.length,
    duplicateGroups: full.duplicateGroups,
    duplicateFdcIdGroups: full.duplicateFdcIdGroups,
    placeholders: full.placeholders.map((p) => p.name),
    bySource: full.bySource,
    quality: full.quality,
    empty: full.empty,
    clean: full.clean,
    actionable: full.actionable,
    // Enough of the detail to act on, capped so the cache file stays small.
    topFoodFailures: full.realFoodFailures.slice(0, 10),
    topRecipeFailures: full.recipeFailures.slice(0, 10),
  };
  writeAuditCache({ fingerprint, summary, at: new Date().toISOString() });
  return { summary, source: "fresh", fingerprint };
}

/** One line, safe for a log file. Same facts the old boot banner printed. */
function formatAuditSummary(s, source) {
  const status = s.empty
    ? "EMPTY — database may not have initialized"
    : s.actionable
      ? "ATTENTION NEEDED"
      : s.placeholders.length
        ? `OK (${s.placeholders.length} placeholder row(s) awaiting real data)`
        : "CLEAN";
  const lines = [
    `[data-audit] ${status} — foods ${s.foods} (${s.realFoodFailures} failing), recipes ${s.recipes} (${s.recipeFailures} failing), duplicate groups ${s.duplicateGroups} [${source}]`,
    `[data-audit]   quality: ${s.quality.pass} pass, ${s.quality.exception} documented exception, ${s.quality.warn} warn, ${s.quality.unvalidated} not yet validated`,
    `[data-audit]   provenance: ${Object.entries(s.bySource).map(([k, v]) => `${k} ${v}`).join(", ")}`,
  ];
  if (s.placeholders.length) {
    lines.push(`[data-audit]   ${s.placeholders.length} placeholder row(s) awaiting real data (no number invented): ${s.placeholders.join(", ")}`);
  }
  if (s.duplicateFdcIdGroups) {
    lines.push(`[data-audit]   ${s.duplicateFdcIdGroups} fdcId(s) claimed by more than one row — run: node scripts/auditFoodProvenance.mjs`);
  }
  for (const f of s.topFoodFailures || []) lines.push(`[data-audit]   food "${f.name}": ${f.issues.join(", ")}`);
  for (const r of s.topRecipeFailures || []) lines.push(`[data-audit]   recipe "${r.name}": ${r.issues.join(", ")}`);
  return lines.join("\n");
}

module.exports = {
  runDataQualityAudit,
  isDocumentedException,
  libraryFingerprint,
  auditIfLibraryChanged,
  formatAuditSummary,
  auditCachePath,
};
