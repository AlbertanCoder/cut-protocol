#!/usr/bin/env node
// Allergen-metadata COVERAGE census — and the honest answer to "can we just
// backfill it?"  (fleet TRIAGE T-1)
//
//   node scripts/auditAllergenMetadata.mjs                 # census, read-only
//   node scripts/auditAllergenMetadata.mjs --write-census  # refresh the artifact
//   node scripts/auditAllergenMetadata.mjs --derive        # + the FNDDS plan
//   node scripts/auditAllergenMetadata.mjs --apply         # refuses. see below.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT WAS MEASURED (dev.db sha256 d9037dce…, 2026-08-01)
// ═════════════════════════════════════════════════════════════════════════
// dietaryFilter.exclusionEvidence() unions FOUR probes: the row's name, its
// USDA fdcCategory, its declared allergenTags, and its mayContain traces.
// Across all 14,151 Food rows:
//
//     allergenTags non-null      0        (0.0%)
//     mayContain   non-null      0        (0.0%)
//     fdcCategory  non-null  13,516       (95.5%)
//
// So probes 3 and 4 are dead on the entire library, and probe 2 only speaks
// when the row's category is one dietaryFilter maps. Counting THAT:
//
//     category maps to an allergen family (FDC_CATEGORY_FAMILIES)   2,842
//     category maps to a diet-style family (FDC_*_CATEGORIES)       2,963
//     either                                                        5,187  (36.7%)
//     NAME-ONLY — no metadata probe can contribute anything         8,964  (63.3%)
//
// For an allergen TERM ("dairy", "whey"), which only probe 2's
// FDC_CATEGORY_FAMILIES half can serve, 11,309 rows (79.9%) are name-only.
//
// The measured consequence, on the fdcCategory "Protein and nutritional
// powders" (17 rows, none of them mapped): 13 of 17 return NOT EXCLUDED for
// the whole dairy family. `Nutritional powder mix (Isopure)` — whose USDA
// composition is 100 g of "Beverages, Whey protein powder isolate", nothing
// else — is not excluded for whey, dairy or milk, and is not excluded from a
// VEGAN pool. Those rows have no recipe references today, which is the only
// reason this is P1 and not P0.
//
// CORRECTION to the triage note: the union does NOT degrade to a name check
// for *every* row. scripts/backfillFdcCategory.mjs already landed probe 2 on
// 95.5% of the library and the taxonomy merge has grown FDC_CATEGORY_FAMILIES
// from 3 literal keys to 43 at runtime. The degradation is real but it is
// 63.3% of rows, not 100%, and the number moves whenever that map moves —
// which is why nothing here hard-codes it. The census artifact stores the raw
// per-category HISTOGRAM (a property of the data) and the derived counts are
// computed against whatever dietaryFilter exports at read time.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THERE IS NO --apply, i.e. WHY allergenTags IS NOT BACKFILLED HERE
// ═════════════════════════════════════════════════════════════════════════
// Three findings, in the order they kill the idea:
//
// 1. THERE IS NO SOURCE. src/lib/offImport.js is the only writer of
//    allergenTags/mayContain, and it needs an Open Food Facts product. Zero of
//    the 14,151 rows carry a `upc` and zero carry a `brand`, so the barcode
//    path has never run against a single one of them. The local FDC cache
//    cannot stand in: all 13,545 records in data/fdc-cache/fdc-index.json
//    carry {fdcId, description, dataType, fdcCategory, macros, micros} and
//    NOT ONE carries an ingredient list or an allergen declaration (checked,
//    not assumed). Branded Foods — the one FDC tier that publishes label text
//    — is deliberately excluded from this project's importer (see
//    scripts/lib/fdcDataset.js: "manufacturer-declared label data, not USDA
//    analysis").
//
// 2. THE COLUMN MEANS SOMETHING WE COULD NOT TRUTHFULLY CLAIM. schema.prisma
//    defines allergenTags as the product's own declaration, and
//    dietaryFilter.js renders it to the user as a fixed sentence: "the product
//    declares <family> in its allergen list". That string is not derived from
//    the row, so anything written into the column inherits the claim. Writing
//    a value we inferred would put a fabricated manufacturer declaration in
//    front of an allergic user. Constitution: provenance on every entry,
//    sources never silently mixed.
//
// 3. `[]` IS NOT A FREE DEFAULT EITHER. The schema reserves null for "no
//    declaration available" and [] for "the source explicitly declared none".
//    Filling the 14,151 nulls with [] would convert 14,151 honest absences
//    into 14,151 false negatives-of-record. It cannot clear an exclusion today
//    (the union is structurally add-only) — but it would destroy the only
//    signal that says "we do not know", which is exactly the signal this
//    census exists to publish.
//
// The safe direction is therefore to make the gap VISIBLE and MEASURED rather
// than to guess a tag. --apply prints this and exits non-zero.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT --derive DOES FIND (a real, unused, local, USDA-published source)
// ═════════════════════════════════════════════════════════════════════════
// FNDDS Survey records carry `inputFoods` — USDA's OWN decomposition of a
// prepared/branded item into the SR Legacy component foods it is made of. The
// survey zip is already on this machine (backend/data/fdc-cache/, gitignored)
// and 5,416 Food rows join to it, carrying 18,565 component rows that nothing
// in this codebase has ever read. Running the EXISTING, regression-locked
// dietaryFilter vocabulary over the component names — not over the row's own
// name, which is what the runtime already does — raises an exclusion the
// name+category union misses on 1,283 rows. `Nutritional powder mix (Isopure)`
// is one of them.
//
// That is a genuine derivation from a citable source, not a guess. It is
// deliberately NOT written to allergenTags for reason 2 above: USDA's
// composition table is not the manufacturer's label, and the user-facing
// sentence would be false. Landing it needs a column that means what it is —
// e.g. `derivedAllergens` with its own reason string — which is a schema
// change this script's owner does not have. So --derive emits the plan, with
// per-row evidence, as a reviewable artifact and writes nothing.
//
// ═════════════════════════════════════════════════════════════════════════
// DATABASE SAFETY
// ═════════════════════════════════════════════════════════════════════════
// backend/prisma/dev.db is the owner's real data and measurement baselines are
// pinned to its hash. This script NEVER opens it: it copies to
// fleet/scratch/<agent>/ first and refuses if the resolved path is the shared
// file. Same pattern as scripts/qc/dayDump.mjs, for the same reason — "we only
// read" is not a property the filesystem enforces, a copy is.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const REPO = path.resolve(BACKEND, "..");
const SHARED_DB = path.resolve(BACKEND, "prisma/dev.db");

/** The committed census artifact. Read by tests/allergenMetadataCoverage.test.js. */
export const CENSUS_PATH = path.resolve(BACKEND, "scripts/data/allergen-metadata-census.json");

/**
 * The scope floor. A census that covers fewer rows than this is not a census
 * of THIS library — it is a census of a seed. CI seeds 28 foods, and a green
 * check over 28 of 14,151 rows certifies 0.2% of the corpus while reading as
 * clean. Every consumer of the artifact must reject it below this line.
 */
export const CORPUS_FLOOR = 14000;

// ── the classifier ────────────────────────────────────────────────────────
/**
 * Which of exclusionEvidence()'s four probes can contribute ANY evidence for
 * this row, given the category maps dietaryFilter exports right now.
 *
 * `sets` is injected rather than imported so the test can drive the classifier
 * with a mutated map (the negative control) and so this file never duplicates
 * a table that another module owns:
 *   { termCategories: Set<string>, styleCategories: Set<string> }
 *
 * Returns { sources: string[], nameOnly: boolean, termNameOnly: boolean }.
 * `nameOnly` means no metadata probe can speak at all for any question.
 * `termNameOnly` is the narrower and more important one: no metadata probe can
 * speak about a named ALLERGEN, which is the Isopure failure.
 */
export function allergenEvidenceSources(food, sets) {
  const sources = ["name"];
  const cat = typeof food?.fdcCategory === "string" ? food.fdcCategory.trim().toLowerCase() : null;
  const termCat = !!cat && sets.termCategories.has(cat);
  const styleCat = !!cat && sets.styleCategories.has(cat);
  if (termCat) sources.push("fdc-category");
  if (styleCat) sources.push("fdc-category-style");
  // Present-but-empty is still a source that SPOKE — "[] = the source
  // explicitly declared none" per schema.prisma. Null is the absence.
  if (food?.allergenTags != null) sources.push("allergen-tag");
  if (food?.mayContain != null) sources.push("may-contain");
  return {
    sources,
    nameOnly: sources.length === 1,
    termNameOnly: !termCat && food?.allergenTags == null && food?.mayContain == null,
  };
}

/**
 * Reduce raw Food rows to the census. Only the four metadata dimensions are
 * read, so the artifact carries no macros, no ids and no user data — it is a
 * histogram of USDA category strings plus three counters.
 */
export function censusFromRows(rows) {
  const histogram = Object.create(null);
  let allergenTags = 0, mayContain = 0, fdcCategory = 0;
  for (const r of rows) {
    if (r.allergenTags != null) allergenTags++;
    if (r.mayContain != null) mayContain++;
    const raw = typeof r.fdcCategory === "string" && r.fdcCategory.trim() ? r.fdcCategory.trim() : null;
    if (raw) fdcCategory++;
    const key = raw ?? "";           // "" is the explicit null bucket
    histogram[key] = (histogram[key] || 0) + 1;
  }
  // Spread to a plain object: the null-prototype map is only there to stop a
  // category literally named "__proto__" or "constructor" from colliding with
  // Object.prototype, and a null-prototype value fails deepStrictEqual against
  // the JSON.parse'd artifact for a reason that has nothing to do with the data.
  return { foods: rows.length, allergenTags, mayContain, fdcCategory, histogram: { ...histogram } };
}

/**
 * Derive the coverage counts from a census + the live category maps. Kept
 * separate from censusFromRows() on purpose: the histogram is a fact about the
 * DATA and never goes stale, while these counts move every time someone edits
 * FDC_CATEGORY_FAMILIES or the allergen taxonomy. Storing the derived numbers
 * in the artifact would have them lying within the week.
 */
export function coverageFromCensus(census, sets) {
  let termEvidence = 0, styleEvidence = 0, eitherEvidence = 0, nullCategory = 0, unmappedCategory = 0;
  for (const [name, count] of Object.entries(census.histogram)) {
    if (!name) { nullCategory += count; continue; }
    const c = name.trim().toLowerCase();
    const t = sets.termCategories.has(c);
    const s = sets.styleCategories.has(c);
    if (t) termEvidence += count;
    if (s) styleEvidence += count;
    if (t || s) eitherEvidence += count; else unmappedCategory += count;
  }
  const nameOnly = nullCategory + unmappedCategory;
  return {
    foods: census.foods,
    withAllergenTags: census.allergenTags,
    withMayContain: census.mayContain,
    withFdcCategory: census.fdcCategory,
    nullCategory,
    unmappedCategory,
    termEvidence,
    styleEvidence,
    eitherEvidence,
    // No metadata probe of any kind can contribute for these rows.
    nameOnly,
    // No metadata probe can contribute for a named ALLERGEN. Strictly larger:
    // a "Beef Products" row has style evidence but nothing to say about dairy.
    termNameOnly: census.allergenTags === 0 && census.mayContain === 0
      ? census.foods - termEvidence
      : null,
  };
}

/**
 * Is this census usable as evidence about the real library, or is it a seed?
 * Returns null when fine, otherwise { code, detail } — the same shape
 * foodValidation.macroTrustIssue() uses for "this number may not be presented
 * as fact", and for the same reason.
 */
export function censusScopeIssue(census, floor = CORPUS_FLOOR) {
  if (!census || typeof census.foods !== "number") {
    return { code: "missing-census", detail: "no census artifact" };
  }
  const summed = Object.values(census.histogram || {}).reduce((a, b) => a + b, 0);
  if (summed !== census.foods) {
    return {
      code: "histogram-mismatch",
      detail: `histogram sums to ${summed} but the census claims ${census.foods} foods — one of them is wrong, so neither can be trusted`,
    };
  }
  if (census.foods < floor) {
    return {
      code: "seed-scope",
      detail: `INCONCLUSIVE: ${census.foods} rows is below the ${floor}-row floor. `
        + `A pass over a seed corpus certifies nothing about the ${floor}+ row library.`,
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Everything below is the CLI. Nothing above it touches the filesystem, so the
// test imports this module without a database, a dataset or a copy step.
// ═══════════════════════════════════════════════════════════════════════════

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
  const AGENT = val("--agent", "T1-allergen");

  if (has("--apply")) {
    console.error(
      "REFUSED. This script does not write allergenTags/mayContain, and the reason is\n"
      + "structural rather than caution:\n\n"
      + "  1. No source exists. 0 of 14,151 rows carry a upc or a brand, so the Open\n"
      + "     Food Facts importer (the only writer) has never touched one, and the local\n"
      + "     FDC cache carries no ingredient or allergen text on ANY of its 13,545\n"
      + "     records.\n"
      + "  2. The column claims a manufacturer declaration. dietaryFilter renders it as\n"
      + "     \"the product declares <family> in its allergen list\" — a sentence that is\n"
      + "     not derived from the row, so an inferred value becomes a fabricated claim\n"
      + "     shown to an allergic user.\n"
      + "  3. Writing [] instead would convert 14,151 honest absences into 14,151\n"
      + "     \"the source declared none\" records.\n\n"
      + "Run with --derive for the one source-backed derivation that does exist\n"
      + "(USDA FNDDS inputFoods), emitted as a reviewable plan. Landing it needs a\n"
      + "column whose meaning matches its provenance; allergenTags is not that column.\n"
    );
    process.exit(2);
  }

  const { dbPath, sourceSha } = prepareDb(AGENT);
  const require_ = createRequire(path.join(BACKEND, "package.json"));
  const df = require_("./src/lib/dietaryFilter.js");
  const sets = {
    termCategories: new Set(Object.keys(df.FDC_CATEGORY_FAMILIES).map((k) => k.toLowerCase())),
    styleCategories: new Set([...df.FDC_FLESH_CATEGORIES, ...df.FDC_ANIMAL_NONFLESH_CATEGORIES].map((k) => k.toLowerCase())),
  };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT id, name, fdcId, fdcCategory, allergenTags, mayContain FROM Food").all();
  const census = censusFromRows(rows);
  const cov = coverageFromCensus(census, sets);

  const pct = (n) => `${((100 * n) / (census.foods || 1)).toFixed(1)}%`;
  console.log(`\nALLERGEN METADATA COVERAGE — ${census.foods} Food rows (dev.db ${sourceSha.slice(0, 8)}…)`);
  console.log("─".repeat(72));
  console.log(`  probe 1  name                              ${String(census.foods).padStart(6)}  ${pct(census.foods)}   always available`);
  console.log(`  probe 2  fdcCategory present               ${String(cov.withFdcCategory).padStart(6)}  ${pct(cov.withFdcCategory)}`);
  console.log(`             …mapped to an allergen family   ${String(cov.termEvidence).padStart(6)}  ${pct(cov.termEvidence)}   ${sets.termCategories.size} mapped categories`);
  console.log(`             …mapped to a diet-style family  ${String(cov.styleEvidence).padStart(6)}  ${pct(cov.styleEvidence)}   ${sets.styleCategories.size} mapped categories`);
  console.log(`  probe 3  allergenTags                      ${String(cov.withAllergenTags).padStart(6)}  ${pct(cov.withAllergenTags)}`);
  console.log(`  probe 4  mayContain                        ${String(cov.withMayContain).padStart(6)}  ${pct(cov.withMayContain)}`);
  console.log("─".repeat(72));
  console.log(`  NAME-ONLY (no metadata probe can speak)    ${String(cov.nameOnly).padStart(6)}  ${pct(cov.nameOnly)}`);
  console.log(`  NAME-ONLY for a named ALLERGEN            ${String(cov.termNameOnly).padStart(7)}  ${pct(cov.termNameOnly)}`);
  console.log(`  distinct fdcCategory values in the library ${String(Object.keys(census.histogram).filter(Boolean).length).padStart(6)}`);

  // The worked example, recomputed rather than quoted.
  const powders = rows.filter((r) => (r.fdcCategory || "").toLowerCase() === "protein and nutritional powders");
  if (powders.length) {
    const missed = powders.filter((r) => !["dairy", "milk", "whey"].some((t) => df.exclusionEvidence(r, t).excluded));
    console.log(`\n  worked example — fdcCategory "Protein and nutritional powders" (${powders.length} rows,`);
    console.log(`  a category no map covers): ${missed.length} return NOT EXCLUDED for the whole dairy family.`);
    for (const m of missed.slice(0, 5)) console.log(`      · ${m.name}`);
    if (missed.length > 5) console.log(`      · …and ${missed.length - 5} more`);
  }

  const scope = censusScopeIssue(census);
  console.log(scope
    ? `\n  SCOPE: ${scope.code} — ${scope.detail}`
    : `\n  SCOPE: full library (${census.foods} rows ≥ ${CORPUS_FLOOR} floor).`);

  if (has("--write-census")) {
    if (scope) { console.error(`\nREFUSED to write the artifact: ${scope.detail}`); process.exit(1); }
    fs.mkdirSync(path.dirname(CENSUS_PATH), { recursive: true });
    const artifact = {
      _: "Metadata-coverage census of the Food library. Regenerate with "
        + "`node scripts/auditAllergenMetadata.mjs --write-census`. Stores the RAW "
        + "per-category histogram only — derived coverage counts are computed at read "
        + "time against dietaryFilter's live category maps, so this file cannot go "
        + "stale when those maps change, only when the LIBRARY changes.",
      generatedAt: new Date().toISOString(),
      generatedBy: "backend/scripts/auditAllergenMetadata.mjs",
      source: { db: "backend/prisma/dev.db", sha256: sourceSha },
      foods: census.foods,
      allergenTags: census.allergenTags,
      mayContain: census.mayContain,
      fdcCategory: census.fdcCategory,
      histogram: Object.fromEntries(Object.entries(census.histogram).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    };
    fs.writeFileSync(CENSUS_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`\n  census written → ${path.relative(REPO, CENSUS_PATH)}`);
  }

  if (has("--derive")) await derive(rows, df, val("--plan-out", path.resolve(REPO, `fleet/out/${AGENT}/fndds-allergen-derivation.json`)));

  db.close();
  console.log("\nDRY RUN — no database was written. There is no --apply; run it to see why.\n");
}

// ── the FNDDS inputFoods derivation (evidence, not a write) ───────────────
async function derive(rows, df, outPath) {
  const require_ = createRequire(path.join(BACKEND, "package.json"));
  const { DATASETS, datasetPath, iterateFdcRecords } = require_("./scripts/lib/fdcDataset.js");
  const survey = DATASETS.find((d) => d.key === "survey");
  const file = datasetPath(survey);
  if (!fs.existsSync(file)) {
    console.log(`\n  --derive skipped: ${path.relative(REPO, file)} is absent (data/fdc-cache/ is gitignored).`);
    console.log("  Fetch it with scripts/downloadFdcDatasets.mjs to reproduce the plan.");
    return;
  }

  // Stream — the survey JSON is 66 MB inflated and nothing here holds it.
  const components = new Map();
  for await (const rec of iterateFdcRecords(file)) {
    const list = (rec.inputFoods || [])
      .map((i) => i.foodDescription || i.ingredientDescription)
      .filter((s) => typeof s === "string" && s.trim());
    if (list.length) components.set(String(rec.fdcId), [...new Set(list)]);
  }

  const TERMS = ["dairy", "egg", "gluten", "peanut", "tree nuts", "soy", "fish", "shellfish", "sesame"];
  const plan = [];
  let joined = 0;
  for (const r of rows) {
    if (r.fdcId == null) continue;
    const comps = components.get(String(r.fdcId));
    if (!comps) continue;
    joined++;
    const adds = [];
    for (const term of TERMS) {
      // The runtime already runs this vocabulary over r.name and r.fdcCategory.
      // Only a term it MISSES there and HITS on a USDA-declared component is
      // new information — everything else is already covered and adding it
      // would overstate the gain.
      if (df.exclusionEvidence(r, term).excluded) continue;
      const witness = comps.find((c) => df.exclusionEvidence({ name: c }, term).excluded);
      if (witness) adds.push({ term, usdaComponent: witness });
    }
    if (adds.length) plan.push({ foodId: r.id, name: r.name, fdcId: r.fdcId, fdcCategory: r.fdcCategory, components: comps, adds });
  }

  const byTerm = {};
  for (const p of plan) for (const a of p.adds) byTerm[a.term] = (byTerm[a.term] || 0) + 1;
  console.log(`\n  FNDDS inputFoods derivation — ${components.size} survey records carry a composition;`);
  console.log(`  ${joined} Food rows join to one. ${plan.length} rows would gain an exclusion the`);
  console.log(`  name+category union misses: ${Object.entries(byTerm).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log("  This is EVIDENCE, not a migration — see the header, reason 2.");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({
    _: "PROPOSAL ONLY — nothing was written to any database. Each entry is a Food "
      + "row whose USDA FNDDS composition names a component carrying an allergen that "
      + "the row's own name and category do not. Deriving from a USDA composition "
      + "table is not the same claim as a manufacturer's allergen declaration, so "
      + "this may not be written to Food.allergenTags; it needs a column that means "
      + "\"derived\". Over-exclusion is inherited from the component names and is the "
      + "documented safe direction, but it IS present — e.g. \"Creamed Corn\" picks up "
      + "dairy from \"corn, … cream style\".",
    generatedAt: new Date().toISOString(),
    dataset: survey.file,
    surveyRecordsWithComposition: components.size,
    foodRowsJoined: joined,
    rowsGainingEvidence: plan.length,
    byTerm,
    plan,
  }, null, 1)}\n`);
  console.log(`  plan written → ${path.relative(REPO, outPath)}`);
}

// ── DB isolation (scripts/qc/dayDump.mjs pattern) ─────────────────────────
function prepareDb(agentId) {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error(`bad agent id ${JSON.stringify(agentId)}`);
  if (!fs.existsSync(SHARED_DB)) throw new Error(`shared DB not found at ${SHARED_DB}`);
  const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
  const dir = path.resolve(REPO, "fleet/scratch", agentId);
  const dbPath = path.resolve(dir, "dev.db");
  if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — resolved to the SHARED dev.db");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SHARED_DB, dbPath);
  for (const ext of ["-wal", "-shm"]) {
    const src = SHARED_DB + ext;
    if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + ext);
    else if (fs.existsSync(dbPath + ext)) fs.rmSync(dbPath + ext);
  }
  const sha = crypto.createHash("sha256").update(fs.readFileSync(SHARED_DB)).digest("hex");
  return { dbPath, sourceSha: sha };
}
