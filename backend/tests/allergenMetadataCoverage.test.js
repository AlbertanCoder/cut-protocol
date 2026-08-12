// ALLERGEN METADATA COVERAGE — the four-probe union is not four probes.
//
// tests/allergenMetadata.test.js already asserts that the metadata probes are
// UNIONED and ADD-ONLY. Both of those are true and neither is the problem. The
// problem is that two of the four probes have nothing to read: measured on the
// real library, `allergenTags` is populated on 0 of 14,151 Food rows and
// `mayContain` on 0 of 14,151. A union of four sources where two are
// structurally empty and a third only speaks for the categories someone
// remembered to map is a NAME CHECK wearing a union's clothes, and it fails
// silently — nothing anywhere reports "this row had no metadata, so only its
// name was checked".
//
// The measured consequence, verbatim from the library: `Nutritional powder mix
// (Isopure)`, whose USDA FNDDS composition is 100 g of "Beverages, Whey protein
// powder isolate" and nothing else, is NOT EXCLUDED for whey, for dairy or for
// milk, and is NOT EXCLUDED from a vegan pool. 13 of the 17 rows in its
// fdcCategory behave the same way. Those rows have no recipe references today,
// which is the only thing keeping this off the P0 list — authoring vegan
// protein snacks walks straight into it.
//
// ── WHY THIS FILE CARRIES ITS OWN CORPUS ──────────────────────────────────
// A test for a corpus-wide property has to state its denominator, and this
// repo has already shipped the failure of not doing that: CI seeds 28 foods
// (ci.yml → `npm run seed`) and then runs a suite whose allergen gate reads as
// a P0 certification of a 14,151-row library. It certifies 0.2% of it.
//
// So the denominator here is a committed artifact —
// scripts/data/allergen-metadata-census.json, a per-category histogram of all
// 14,151 rows produced by scripts/auditAllergenMetadata.mjs — and every arm
// below either runs against those 14,151 rows or says out loud that it did
// not. The artifact stores the RAW histogram only; the coverage counts are
// derived at read time from dietaryFilter's live category maps, so extending
// FDC_CATEGORY_FAMILIES moves the numbers here without making the artifact a
// lie.
//
// ── THE ARMS (a pass has to be able to fail) ──────────────────────────────
//   ARM 1  scope floor      — the census must cover ≥ 14,000 rows, and its
//                             histogram must sum to its own total.
//   ARM 2  negative control — the scope check is fed a 28-row seed census and
//                             a census whose histogram does not sum, and must
//                             REJECT both. Without this, ARM 1 is vacuous:
//                             a checker that returns null unconditionally
//                             passes ARM 1 perfectly.
//   ARM 3  live agreement   — when a ≥14,000-row database is reachable, the
//                             census is re-derived from it and must match, so
//                             a stale artifact cannot certify a changed
//                             library. When it is not reachable (CI), the test
//                             asserts that no such database was in scope
//                             rather than passing quietly.
//   ARM 4  witnesses        — the consequence pinned on 17 real rows, verbatim.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  exclusionEvidence,
  adjusterExcludedByStyle,
  FDC_CATEGORY_FAMILIES,
  FDC_FLESH_CATEGORIES,
  FDC_ANIMAL_NONFLESH_CATEGORIES,
} = require("../src/lib/dietaryFilter.js");

// The script is ESM; the suite is CJS. Dynamic import in a before() hook keeps
// this working regardless of how require(esm) is gated on the running Node.
let audit;
before(async () => {
  audit = await import("../scripts/auditAllergenMetadata.mjs");
});

// The live category maps, resolved at read time — never copied. The taxonomy
// merge in dietaryFilter grows FDC_CATEGORY_FAMILIES from 3 literal keys to
// 43 at module load, so a duplicated table here would be wrong on arrival.
const liveSets = () => ({
  termCategories: new Set(Object.keys(FDC_CATEGORY_FAMILIES).map((k) => k.toLowerCase())),
  styleCategories: new Set([...FDC_FLESH_CATEGORIES, ...FDC_ANIMAL_NONFLESH_CATEGORIES].map((k) => k.toLowerCase())),
});

// Map sizes at the moment the numbers below were measured (2026-08-01). Used
// ONLY to decide whether an exact-count assertion is still meaningful: if
// another change has moved the maps, the derived counts legitimately move with
// them and this file asserts the structural invariants instead of a stale
// number. The DATA counts (14,151 / 0 / 0 / 13,516) are not map-dependent and
// are always asserted exactly.
const MEASURED = {
  foods: 14151,
  allergenTags: 0,
  mayContain: 0,
  fdcCategory: 13516,
  termCategoryKeys: 43,
  styleCategoryKeys: 7,
  termEvidence: 2842,
  styleEvidence: 2963,
  eitherEvidence: 5187,
  nameOnly: 8964,
  termNameOnly: 11309,
};

const readCensus = () => JSON.parse(fs.readFileSync(audit.CENSUS_PATH, "utf8"));
const asCensus = (a) => ({ foods: a.foods, allergenTags: a.allergenTags, mayContain: a.mayContain, fdcCategory: a.fdcCategory, histogram: a.histogram });

// ══════════════════════════════════════════════════════════════════════════
// 0. the classifier
// ══════════════════════════════════════════════════════════════════════════

test("allergenEvidenceSources names every probe that can speak for a row", () => {
  const sets = { termCategories: new Set(["dairy and egg products"]), styleCategories: new Set(["beef products"]) };
  const s = (food) => audit.allergenEvidenceSources(food, sets);

  // The library's actual shape: a name, a category nothing maps, no metadata.
  const bare = s({ name: "Nutritional powder mix (Isopure)", fdcCategory: "Protein and nutritional powders", allergenTags: null, mayContain: null });
  assert.deepEqual(bare.sources, ["name"]);
  assert.equal(bare.nameOnly, true);
  assert.equal(bare.termNameOnly, true);

  const mapped = s({ name: "Cheddar", fdcCategory: "Dairy and Egg Products", allergenTags: null, mayContain: null });
  assert.deepEqual(mapped.sources, ["name", "fdc-category"]);
  assert.equal(mapped.nameOnly, false);
  assert.equal(mapped.termNameOnly, false);

  // A style-only category is evidence for vegan/vegetarian and evidence for
  // NOTHING about a named allergen — the distinction the two flags exist for.
  const flesh = s({ name: "Beef, ground", fdcCategory: "Beef Products", allergenTags: null, mayContain: null });
  assert.deepEqual(flesh.sources, ["name", "fdc-category-style"]);
  assert.equal(flesh.nameOnly, false);
  assert.equal(flesh.termNameOnly, true);

  // Present-but-empty is a source that SPOKE ("[] = the source explicitly
  // declared none", schema.prisma). Only null is absence.
  const declaredNone = s({ name: "Rice cake", fdcCategory: null, allergenTags: [], mayContain: null });
  assert.deepEqual(declaredNone.sources, ["name", "allergen-tag"]);
  assert.equal(declaredNone.termNameOnly, false);

  // Case and whitespace in the stored category must not decide the answer;
  // dietaryFilter lowercases before probing and so must the census.
  assert.equal(s({ name: "x", fdcCategory: "  DAIRY AND EGG PRODUCTS " }).termNameOnly, false);
});

test("censusFromRows reads only the four metadata dimensions", () => {
  const c = audit.censusFromRows([
    { name: "a", fdcCategory: "Cheese", allergenTags: null, mayContain: null },
    { name: "b", fdcCategory: "Cheese", allergenTags: '["milk"]', mayContain: null },
    { name: "c", fdcCategory: null, allergenTags: null, mayContain: '[]' },
    { name: "d", fdcCategory: "   ", allergenTags: null, mayContain: null },
  ]);
  assert.equal(c.foods, 4);
  assert.equal(c.allergenTags, 1);
  assert.equal(c.mayContain, 1);
  assert.equal(c.fdcCategory, 2);
  // Whitespace-only is a null category, and both nulls share the "" bucket.
  assert.deepEqual(c.histogram, { Cheese: 2, "": 2 });
});

// ══════════════════════════════════════════════════════════════════════════
// ARM 2 — the negative control. Runs FIRST because ARM 1 means nothing until
// the checker is shown to reject something.
// ══════════════════════════════════════════════════════════════════════════

test("ARM 2 (negative control): the scope check rejects a seed corpus and bad arithmetic", () => {
  // The exact shape CI would produce: 28 seeded foods. This is the mistake
  // this file exists not to repeat, so it is asserted as a rejection.
  const seed = audit.censusFromRows(Array.from({ length: 28 }, (_, i) => ({ name: `seed ${i}`, fdcCategory: null, allergenTags: null, mayContain: null })));
  const seedIssue = audit.censusScopeIssue(seed);
  assert.ok(seedIssue, "a 28-row census MUST be rejected — it certifies 0.2% of the library");
  assert.equal(seedIssue.code, "seed-scope");
  assert.match(seedIssue.detail, /INCONCLUSIVE/);

  // One row short of the floor still fails: the floor is a floor.
  assert.equal(audit.censusScopeIssue({ foods: audit.CORPUS_FLOOR - 1, histogram: { "": audit.CORPUS_FLOOR - 1 } }).code, "seed-scope");

  // A census whose histogram disagrees with its own total is not evidence of
  // anything, at any size — that is how a partial sweep would sneak a full-
  // sized denominator past the floor.
  assert.equal(audit.censusScopeIssue({ foods: 14151, histogram: { "Beef Products": 969 } }).code, "histogram-mismatch");
  assert.equal(audit.censusScopeIssue(null).code, "missing-census");

  // And it accepts a genuinely full-sized one, so the checker is not simply
  // rejecting everything (the opposite vacuity).
  assert.equal(audit.censusScopeIssue({ foods: 14151, histogram: { "Beef Products": 969, "": 13182 } }), null);
});

// ══════════════════════════════════════════════════════════════════════════
// ARM 1 — the denominator
// ══════════════════════════════════════════════════════════════════════════

test("ARM 1 (scope): the committed census covers the whole library", () => {
  assert.ok(fs.existsSync(audit.CENSUS_PATH), `no census artifact at ${audit.CENSUS_PATH} — regenerate with \`node scripts/auditAllergenMetadata.mjs --write-census\``);
  const census = asCensus(readCensus());
  const issue = audit.censusScopeIssue(census);
  assert.equal(issue, null, issue ? `census is not usable as evidence: ${issue.detail}` : "");
  assert.ok(census.foods >= audit.CORPUS_FLOOR, `census covers ${census.foods} rows, floor ${audit.CORPUS_FLOOR}`);
  assert.equal(census.foods, MEASURED.foods, `library size moved ${MEASURED.foods} → ${census.foods}; re-run --write-census and re-read the numbers below`);
});

// ══════════════════════════════════════════════════════════════════════════
// THE PROPERTY, over all 14,151 rows
// ══════════════════════════════════════════════════════════════════════════

test("probes 3 and 4 are dead on every row in the library", () => {
  const census = asCensus(readCensus());
  assert.equal(census.allergenTags, MEASURED.allergenTags,
    `allergenTags is populated on ${census.allergenTags} of ${census.foods} rows. If this is now > 0 the defect is being closed — `
    + "update MEASURED and check src/lib/offImport.js is the writer, because nothing else may write that column (see "
    + "scripts/auditAllergenMetadata.mjs, 'WHY THERE IS NO --apply').");
  assert.equal(census.mayContain, MEASURED.mayContain,
    `mayContain is populated on ${census.mayContain} of ${census.foods} rows.`);
  assert.equal(census.fdcCategory, MEASURED.fdcCategory,
    `fdcCategory is populated on ${census.fdcCategory} of ${census.foods} rows (scripts/backfillFdcCategory.mjs landed this one).`);
});

test("the coverage arithmetic holds over the full corpus, and names the name-only rows", () => {
  const census = asCensus(readCensus());
  const sets = liveSets();
  const cov = audit.coverageFromCensus(census, sets);

  // Structural — true for any library and any category map.
  assert.equal(cov.foods, census.foods);
  assert.equal(cov.nullCategory + cov.unmappedCategory + cov.eitherEvidence, census.foods,
    "every row is exactly one of: no category / a category no map covers / a category some map covers");
  assert.equal(cov.nullCategory + cov.unmappedCategory, cov.nameOnly);
  assert.ok(cov.eitherEvidence <= cov.withFdcCategory, "a row cannot have category evidence without a category");
  assert.equal(cov.nullCategory, census.histogram[""] ?? 0);
  // With probes 3 and 4 empty, every row outside the allergen-mapped
  // categories is name-only for a named allergen. This is the number the
  // Isopure failure lives in.
  assert.equal(cov.termNameOnly, census.foods - cov.termEvidence);

  // THE PROPERTY. Not "some rows are thin" — a majority of the library has no
  // metadata evidence available for a named allergen, and the count is
  // reportable rather than silent.
  assert.ok(cov.termNameOnly > 0, "no row is name-only for an allergen — the defect would be closed; re-baseline this file");
  assert.ok(cov.termNameOnly > census.foods / 2,
    `${cov.termNameOnly} of ${census.foods} rows are name-only for a named allergen (${((100 * cov.termNameOnly) / census.foods).toFixed(1)}%). `
    + "If this has dropped below half, the gap is being closed — good — re-baseline MEASURED.");

  // Exact counts, but only while the maps they are derived from are the ones
  // they were measured against. dietaryFilter's tables are actively worked on;
  // pinning a derived number to a table someone else owns would make this file
  // fail for their reasons instead of its own.
  const mapsUnchanged = sets.termCategories.size === MEASURED.termCategoryKeys
    && sets.styleCategories.size === MEASURED.styleCategoryKeys;
  if (mapsUnchanged) {
    assert.deepEqual(
      { termEvidence: cov.termEvidence, styleEvidence: cov.styleEvidence, eitherEvidence: cov.eitherEvidence, nameOnly: cov.nameOnly, termNameOnly: cov.termNameOnly },
      { termEvidence: MEASURED.termEvidence, styleEvidence: MEASURED.styleEvidence, eitherEvidence: MEASURED.eitherEvidence, nameOnly: MEASURED.nameOnly, termNameOnly: MEASURED.termNameOnly },
      "the category maps are unchanged, so these counts must be too — a change here means the LIBRARY moved",
    );
  } else {
    assert.ok(sets.termCategories.size >= 3, "FDC_CATEGORY_FAMILIES lost its literal entries");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ARM 3 — the artifact must agree with a real database when one is reachable
// ══════════════════════════════════════════════════════════════════════════

// Never opens the shared file. backend/prisma/dev.db is the owner's real data
// and measurement baselines are pinned to its bytes; Prisma and node:sqlite
// both open SQLite read-write by default and WAL sidecars mutate the file on
// nothing more than a connection. A copy is the only guarantee, so the copy is
// what is read — same rule as scripts/qc/dayDump.mjs.
function copyReachableDb() {
  const url = process.env.DATABASE_URL || "";
  const candidates = [
    process.env.CUT_PROTOCOL_DB_PATH,
    // A relative `file:` DATABASE_URL is resolved by Prisma against the
    // directory of schema.prisma — backend/prisma/ — NOT against backend/.
    // This line resolved against backend/ from 2026-08-02 until 2026-08-12,
    // which on CI (DATABASE_URL=file:./ci.db) pointed at a file that does not
    // exist, fell through to the dev.db candidate below (also absent on CI),
    // and failed ARM 3 with "no database file was reachable at all" — this
    // test never once ran green on CI. Locally the bug was invisible because
    // the dev.db fallback caught it.
    url.startsWith("file:") ? path.resolve(__dirname, "..", "prisma", url.slice(5)) : null,
    path.resolve(__dirname, "..", "prisma", "dev.db"),
  ].filter(Boolean);
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-allergen-census-"));
  const dst = path.join(dir, "copy.db");
  const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
  assert.notEqual(norm(dst), norm(src), "refusing to read the shared database in place");
  fs.copyFileSync(src, dst);
  for (const ext of ["-wal", "-shm"]) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, dst + ext);
  return { src, dst, dir, sha256: crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex") };
}

test("ARM 3 (live agreement): the census matches the database, or no full database was in scope", () => {
  let sqlite;
  try { sqlite = require("node:sqlite"); } catch { sqlite = null; }
  assert.ok(sqlite, "node:sqlite is required from Node 22.13/24 (see package.json engines)");

  const copy = copyReachableDb();
  assert.ok(copy, "no database file was reachable at all — DATABASE_URL, CUT_PROTOCOL_DB_PATH and prisma/dev.db were all absent");

  let rows;
  const db = new sqlite.DatabaseSync(copy.dst, { readOnly: true });
  try {
    rows = db.prepare("SELECT fdcCategory, allergenTags, mayContain FROM Food").all();
  } finally {
    db.close();
    fs.rmSync(copy.dir, { recursive: true, force: true });
  }

  const live = audit.censusFromRows(rows);
  const issue = audit.censusScopeIssue(live);
  if (issue) {
    // The seeded-CI path. It is NOT a pass for the coverage property — it is a
    // statement that the arm did not run, and it asserts WHY, so a real
    // database can never be skipped by accident.
    assert.equal(issue.code, "seed-scope",
      `the reachable database at ${copy.src} is unusable for a different reason: ${issue.detail}`);
    assert.ok(live.foods < audit.CORPUS_FLOOR);
    console.log(`  [ARM 3 NOT RUN] reachable corpus is ${live.foods} Food rows (< ${audit.CORPUS_FLOOR}). `
      + "The committed census still supplies the 14,151-row denominator for every other arm; "
      + "this arm's staleness check is INCONCLUSIVE on this machine.");
    return;
  }

  const artifact = asCensus(readCensus());
  assert.equal(live.foods, artifact.foods, "the census artifact is stale — re-run `node scripts/auditAllergenMetadata.mjs --write-census`");
  assert.equal(live.allergenTags, artifact.allergenTags);
  assert.equal(live.mayContain, artifact.mayContain);
  assert.equal(live.fdcCategory, artifact.fdcCategory);
  assert.deepEqual(live.histogram, artifact.histogram, "the category histogram moved — re-run --write-census");
});

// ══════════════════════════════════════════════════════════════════════════
// ARM 4 — the consequence, on real rows
// ══════════════════════════════════════════════════════════════════════════

// Verbatim from dev.db, 2026-08-01: every row whose fdcCategory is "Protein
// and nutritional powders" — a category no map covers — with the metadata it
// actually carries (none). Copied as data rather than queried so the
// consequence stays asserted on a machine with no library at all.
const POWDER_CATEGORY = "Protein and nutritional powders";
const POWDERS = [
  "Nutritional powder mix (Carnation Instant Breakfast)",
  "Nutritional powder mix (EAS Soy Protein Powder)",
  "Nutritional powder mix (EAS Whey Protein Powder)",
  "Nutritional powder mix (Isopure)",
  "Nutritional powder mix (Muscle Milk)",
  "Nutritional powder mix (Slim Fast)",
  "Nutritional powder mix, NFS",
  "Nutritional powder mix, high protein (Herbalife)",
  "Nutritional powder mix, high protein (Slim Fast)",
  "Nutritional powder mix, high protein, NFS",
  "Nutritional powder mix, light (Muscle Milk)",
  "Nutritional powder mix, protein, NFS",
  "Nutritional powder mix, protein, light, NFS",
  "Nutritional powder mix, protein, soy based, NFS",
  "Nutritional powder mix, sugar free (Carnation Instant Breakfast)",
  "Nutritional powder mix, sugar free (Slim Fast)",
  "Nutritional powder mix, whey based, NFS",
].map((name) => ({ name, fdcCategory: POWDER_CATEGORY, allergenTags: null, mayContain: null }));

const DAIRY_FAMILY = ["dairy", "milk", "whey"];

test("ARM 4 (witness): the powder rows carry no metadata evidence at all", () => {
  assert.equal(POWDERS.length, 17);
  for (const row of POWDERS) {
    const ev = audit.allergenEvidenceSources(row, liveSets());
    assert.deepEqual(ev.sources, ["name"],
      `"${row.name}" now has metadata evidence (${ev.sources.join(", ")}) — if "${POWDER_CATEGORY}" was mapped or the rows were tagged, `
      + "the defect is closing; re-run scripts/auditAllergenMetadata.mjs and re-baseline this file.");
    assert.equal(ev.termNameOnly, true);
  }
});

test("ARM 4 (witness): a whey isolate is not excluded for whey, dairy or milk", () => {
  // The single row this whole file is about. Its USDA FNDDS composition is one
  // component — "Beverages, Whey protein powder isolate", 100 g — and nothing
  // in the running system reads it.
  const isopure = POWDERS.find((p) => p.name.includes("Isopure"));
  for (const term of DAIRY_FAMILY) {
    const ev = exclusionEvidence(isopure, term);
    assert.equal(ev.excluded, false,
      `"${isopure.name}" is now excluded for "${term}" via ${ev.reasons.map((r) => r.source).join("+")} — GOOD NEWS. `
      + "This assertion pins a known P1 defect; delete it and update MEASURED once the fix is real.");
    assert.deepEqual(ev.reasons, [], "no probe should have produced evidence — that is the defect");
  }
  assert.equal(adjusterExcludedByStyle(isopure, "vegan"), false,
    "a whey isolate is now correctly kept out of a vegan pool — re-baseline this file");
});

test("ARM 4 (witness): 13 of the 17 powder rows miss the whole dairy family", () => {
  const missed = POWDERS.filter((row) => !DAIRY_FAMILY.some((t) => exclusionEvidence(row, t).excluded));
  const caught = POWDERS.filter((row) => DAIRY_FAMILY.some((t) => exclusionEvidence(row, t).excluded));
  // The four that ARE caught are caught by their NAME alone ("Whey", "Muscle
  // Milk") — which is the point: the name is doing 100% of the work and the
  // rows whose brand name happens not to say "milk" are the ones that leak.
  assert.equal(caught.length, 4, `caught: ${caught.map((c) => c.name).join(" | ")}`);
  assert.equal(missed.length, 13,
    `${missed.length} of 17 rows in "${POWDER_CATEGORY}" return NOT EXCLUDED for dairy/milk/whey.\n`
    + `  ${missed.map((m) => m.name).join("\n  ")}\n`
    + "  If this count dropped, the gap is closing — re-run scripts/auditAllergenMetadata.mjs and re-baseline.");
  // Two of the misses are genuinely soy-based, which is exactly why the
  // category cannot simply be added to FDC_CATEGORY_FAMILIES as "dairy": a
  // blanket mapping would be WRONG for them, not merely over-exclusive.
  assert.ok(missed.some((m) => /soy/i.test(m.name)), "the soy-based powders must stay in the missed set — they are the reason the category is not mappable");
});
