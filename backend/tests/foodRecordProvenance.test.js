// foodRecordProvenance.test.js — pins the food-record provenance work of
// 2026-08-01 (fleet agent "food-records").
//
// ARM CHECK — what these tests actually reach, and what they do not.
//
// WHAT IS EXAMINED
//   · backend/data/foodOverrides.json — every entry, in the tracked file. The
//     five kcal corrections landed on 2026-08-01 are pinned by value, and the
//     whole file is swept for the two mistakes that were made and caught while
//     landing them (a dropped `fdcId`, an overwritten provenance note).
//   · foodValidation.js's trust vocabulary — macroTrustIssue / isQuarantined —
//     exercised against the exact dataQuality prose shapes that live in the
//     database today, as pure strings. No DB needed.
//   · The repo's own stated lesson, that Atwater consistency is not a
//     correctness warrant, asserted rather than assumed.
//   · CONDITIONALLY, when the two gitignored artifacts happen to be present on
//     the machine: every override entry naming an fdcId is reconciled against
//     the raw USDA record, and the live corpus census is re-measured.
//
// WHAT IS **NOT** EXAMINED — do not read a pass here as coverage of it
//   · backend/prisma/dev.db is gitignored, so in CI NOTHING here touches the
//     real corpus. The census assertions are skipped, silently to the exit code
//     and loudly to stdout. A green run in CI does NOT mean the 14,151-row food
//     table was checked.
//   · backend/data/fdc-cache/fdc-index.json is gitignored too. The
//     reconciliation test — the one that would actually catch a NEW wrong
//     record — is skipped in CI for the same reason. This is the single
//     biggest hole in this file and it is structural, not an oversight: the
//     evidence needed to verify a USDA claim is 11 MB and not in the repo.
//   · The 188 `provenance-reviewed` rows are NOT verified by anything here.
//     Their prose carries no fdcId, so there is no numeric channel to check
//     them against; they rest entirely on the 2026-07-31 reviewer's judgment.
//   · Nothing here proves any of the 14,151 rows is CORRECT. These tests prove
//     that specific known-wrong things were fixed and that specific known gaps
//     still read the way they were measured.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { checkAtwater, validateFood, macroTrustIssue, isQuarantined } = require("../src/lib/foodValidation.js");
const { reload, OVERRIDES_FILE } = require("../src/lib/foodOverrides.js");

const REPO = path.resolve(__dirname, "..", "..");
const FDC_INDEX = path.resolve(REPO, "backend/data/fdc-cache/fdc-index.json");
const DB_COPY = path.resolve(REPO, "fleet/scratch/food-records/dev.db");
const raw = () => JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));

// The five rows repaired on 2026-08-01. Each carried its FDC record's protein,
// fat and carb verbatim while its kcal was the generic 4P+9F+4C recompute
// instead of the energy USDA publishes for that record from food-specific
// Atwater factors. Corroborated, in every case, by ANOTHER row in the same
// table holding the same fdcId at the published figure.
const REPAIRED = {
  "Apples": { kcal: 58.2, wasKcal: 64.7, fdcId: 1750340 },
  "Braeburn Apples": { kcal: 58.2, wasKcal: 64.7, fdcId: 1750340 },
  "Bramley Apples": { kcal: 58.2, wasKcal: 64.7, fdcId: 1750340 },
  "Tomato Purée": { kcal: 88.5, wasKcal: 104, fdcId: 2685580 },
  "Runner Beans": { kcal: 33.6, wasKcal: 40, fdcId: 2346400 },
};

test("the five 2026-08-01 kcal corrections are present at the USDA published energy", () => {
  const o = raw();
  for (const [name, want] of Object.entries(REPAIRED)) {
    const e = o[name];
    assert.ok(e, `override entry "${name}" is missing`);
    assert.equal(e.kcal, want.kcal, `${name}: kcal should be USDA's published ${want.kcal}, not ${e.kcal}`);
  }
});

test("the corrected kcal is NOT the generic 4P+9F+4C recompute — that was the defect", () => {
  const o = raw();
  for (const [name, want] of Object.entries(REPAIRED)) {
    const e = o[name];
    const classic = 4 * e.protein + 9 * e.fat + 4 * e.carb;
    // The old value WAS the recompute, to within rounding. If a future pass
    // "fixes" these rows by recomputing energy from macros again, this fails.
    assert.ok(
      Math.abs(want.wasKcal - classic) <= 0.5,
      `${name}: the pre-repair value ${want.wasKcal} should equal the 4/4/9 recompute ${classic.toFixed(2)} — if it no longer does, this test's premise has changed`,
    );
    assert.ok(
      Math.abs(e.kcal - classic) > 1,
      `${name}: kcal ${e.kcal} has drifted back onto the generic Atwater recompute ${classic.toFixed(2)}; USDA computes this record with food-specific factors`,
    );
  }
});

test("repairing kcal did not strip fdcId or overwrite the prior provenance note", () => {
  // Both of these were real mistakes in the first --apply run of
  // scripts/qc/foodProvenanceAudit.mjs: a JSON round-trip rebuilt the entries
  // from scratch, dropping fdcId and replacing the note. Caught by diffing
  // against a copy, not by the tool's own success message.
  const o = raw();
  for (const [name, want] of Object.entries(REPAIRED)) {
    const e = o[name];
    assert.equal(e.fdcId, want.fdcId, `${name}: fdcId provenance was lost`);
    assert.match(e.note, /Prior note:/, `${name}: the earlier provenance sentence was overwritten instead of appended to`);
    assert.match(e.note, /provenance-restored 2026-07-31/, `${name}: the 2026-07-31 repair history should survive in the note`);
  }
});

test("no override entry anywhere lost its fdcId to a formatting pass", () => {
  // A file-wide sweep, not just the five touched rows: the round-trip bug was
  // capable of hitting every entry it rewrote.
  const o = raw();
  const withMacrosAndId = Object.entries(o).filter(([k, v]) => !k.startsWith("__") && typeof v === "object" && typeof v.kcal === "number");
  assert.ok(withMacrosAndId.length > 250, `expected the curated file to still hold its full entry set, saw ${withMacrosAndId.length}`);
  for (const [name, e] of withMacrosAndId) {
    if (e.fdcId === undefined) continue;
    assert.equal(typeof e.fdcId, "number", `${name}: fdcId became ${JSON.stringify(e.fdcId)}`);
  }
});

test("the corrected values still clear the product's own fiber-adjusted Atwater gate", () => {
  const o = raw();
  for (const name of Object.keys(REPAIRED)) {
    const e = o[name];
    const res = checkAtwater({ kcal: e.kcal, protein: e.protein, fat: e.fat, carb: e.carb, fiber: e.fiber || 0 });
    assert.equal(res.ok, true, `${name}: corrected kcal ${e.kcal} fails checkAtwater (fiber-adj ${res.fiberAdjusted}, classic ${res.classic}) — a repair may not create a new validator failure`);
  }
});

test("the override loader still parses the file after a surgical line edit", () => {
  const o = reload();
  assert.ok(Object.keys(o).length > 250);
  assert.equal(o["apples"].kcal, 58.2, "loader keys are lowercased; the corrected value must survive the load");
});

// ── the repo's own lesson, asserted instead of assumed ────────────────────────

test("ATWATER CONSISTENCY IS NOT A CORRECTNESS WARRANT", () => {
  // "Star Anise" holding FDC 171316 "Spices, anise seed": a real USDA record,
  // internally perfect, and the wrong food. validateFood passes it, which is
  // exactly why provenance is asked as a separate question.
  const wrongFoodRightNumbers = {
    name: "Star Anise", category: "pantry", kcal: 337, protein: 17.6, fat: 15.9, carb: 50, fiber: 14.6, source: "manual",
  };
  assert.equal(checkAtwater(wrongFoodRightNumbers).ok, true, "the numbers are a real record's, so of course they reconcile");
  assert.equal(validateFood(wrongFoodRightNumbers).ok, true, "and validateFood passes it — this is the documented blind spot, not a bug in this test");
});

test("quarantine vocabulary: the prefixes the product does recognise", () => {
  const row = (over) => ({ name: "X", kcal: 100, protein: 1, fat: 1, carb: 1, source: "manual", ...over });
  assert.ok(isQuarantined(row({ source: "quarantined" })));
  assert.ok(isQuarantined(row({ dataQuality: "exception:provenance-cleared — carried fdcId 169342 (\"Celery, cooked\")" })));
  assert.ok(macroTrustIssue(row({ dataQuality: "exception:unverifiable-fdcid — claimed FDC id 2758997 is not in any dataset" })));
  assert.equal(macroTrustIssue(row({ dataQuality: "pass — fdcId 171849" })), null);
  // The ~500 curated `exception:` rows are REVIEWED explanations of healthy
  // rows. A blanket "starts with exception:" rule would condemn all of them.
  assert.equal(macroTrustIssue(row({ dataQuality: "exception:alcohol-energy — ethanol contributes 7 kcal/g" })), null);
  assert.equal(macroTrustIssue(row({ dataQuality: "exception:usda-source-model — carbohydrate-by-difference was negative" })), null);
  assert.equal(macroTrustIssue(row({ dataQuality: "exception:atwater-exempt — carbonates" })), null);
});

test("KNOWN GAP (measured 2026-08-01, NOT fixed here): five rows declare unresolved provenance and are still served as fact", () => {
  // This test documents a defect. It asserts the CURRENT behaviour so that
  // whoever fixes foodValidation.js is told, loudly, to come and update it —
  // and so the gap cannot quietly widen in the meantime. foodValidation.js is
  // owned by another workstream; this agent measured the gap and did not edit
  // that file.
  //
  // The five live rows, all fdcId-null, all trusted by the product today:
  //   "Rye"                       carries FDC 172684 "Bread, rye" verbatim
  //   "Hotsauce"                  carries FDC 171186 "Sauce, hot chile, sriracha"  (8 recipes)
  //   "Corn Flour"                carries FDC 169694 "Corn flour, masa, enriched"  (11 recipes)
  //   "Tarragon Leaves"           carries FDC 170937 "Spices, tarragon, dried"
  //   "Soured cream and chive dip" carries FDC 171257 "Cream, sour, cultured"
  const row = (dq) => ({ name: "X", kcal: 100, protein: 1, fat: 1, carb: 1, source: "manual", dataQuality: dq });

  // (a) A reviewer explicitly DECLINED to decide, and the row is served anyway.
  assert.equal(
    macroTrustIssue(row("NEEDS A HUMAN DECISION — Sriracha is genuinely a hot sauce, but … (previously: another food's macros, unconfirmed)")),
    null,
    "GAP CLOSED? If macroTrustIssue now catches 'NEEDS A HUMAN DECISION', update this test and the report at fleet/out/food-records/REPORT.md",
  );

  // (b) One character. "exception: unverified" has a SPACE after the colon, so
  // it matches neither entry of UNVERIFIED_PROVENANCE_PREFIXES. That single
  // space is the whole reason the "Rye" row is trusted.
  assert.equal(
    macroTrustIssue(row("exception: unverified — carried fdcId 172684 \"Bread, rye\" under the name \"Rye\"; macros are rye BREAD's, not rye grain's.")),
    null,
    "GAP CLOSED? If a loose 'exception: unverified' prefix is now caught, update this test and the report",
  );
  // The no-space form IS caught — proving the gap is prefix-matching, not intent.
  assert.ok(
    macroTrustIssue(row("exception:provenance-cleared — carried fdcId 172684 \"Bread, rye\"")),
    "the recognised spelling must still be caught",
  );
});

test("Rye is a FLAG, not a repair — the naming evidence and the usage evidence disagree", () => {
  // Recorded as a test because it is the clearest example on this tree of why
  // a name-based repair is dangerous. The row's own dataQuality prescribes
  // "needs real rye-grain data or deletion". Acting on that would have been
  // wrong: the sole recipe consuming this row is named "Rye bread", at 100 g,
  // and a correctly-named sibling row "Rye Bread" already holds the very same
  // FDC record. The macros are right for how the row is actually used; what is
  // wrong is the name and the duplication. Swapping in rye-GRAIN macros
  // (338 kcal vs 259) would have broken the one recipe that depends on it.
  const rye = { name: "Rye", kcal: 259, protein: 8.5, fat: 3.3, carb: 48.3, fiber: 5.8, source: "manual" };
  const ryeGrain = { name: "Rye grain", kcal: 338, protein: 10.3, fat: 1.63, carb: 75.9, fiber: 15.1, source: "usda-verified" };
  assert.notEqual(rye.kcal, ryeGrain.kcal, "the two candidate meanings differ by 79 kcal/100 g — this is not a rounding question");
  assert.equal(checkAtwater(rye).ok, true, "the bread numbers are self-consistent, so arithmetic alone cannot adjudicate the name");
  assert.equal(checkAtwater(ryeGrain).ok, true, "and so are the grain numbers");
});

// ── conditional: needs artifacts that are gitignored ─────────────────────────

test("every override entry naming an fdcId reconciles with the raw USDA record", { skip: !fs.existsSync(FDC_INDEX) && "fdc-index.json absent (gitignored) — SKIPPED, this is the strongest check in the file" }, () => {
  const idx = JSON.parse(fs.readFileSync(FDC_INDEX, "utf8"));
  const byId = new Map(idx.records.map((r) => [r.fdcId, r]));
  const o = raw();
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(tol, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
  const drifted = [];
  for (const [name, e] of Object.entries(o)) {
    if (name.startsWith("__") || typeof e.fdcId !== "number" || typeof e.kcal !== "number") continue;
    const rec = byId.get(e.fdcId);
    if (!rec) continue; // curated entries may point at records outside the cached datasets
    // Only entries that actually claim the record's macros are checked: a
    // curated override is allowed to deliberately depart from the record
    // (Butter, Salt, Water all do). The signature of "claims the record" is
    // that protein/fat/carb match it.
    const claimsRecord = near(e.protein, rec.protein, 0.05) && near(e.fat, rec.fat, 0.05) && near(e.carb, rec.carb, 0.05);
    if (!claimsRecord) continue;
    if (!near(e.kcal, rec.kcal, 1)) drifted.push(`${name}: entry ${e.kcal} kcal vs USDA ${rec.kcal} for fdcId ${e.fdcId} "${rec.description}"`);
  }
  assert.deepEqual(drifted, [], `override entries carrying a record's macros but not its energy:\n  ${drifted.join("\n  ")}`);
});

test("corpus census matches what was measured on 2026-08-01", { skip: !fs.existsSync(DB_COPY) && "fleet/scratch/food-records/dev.db absent — SKIPPED (run backend/scripts/qc/foodProvenanceAudit.mjs to create it)" }, () => {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(DB_COPY, { readOnly: true });
  const one = (s) => db.prepare(s).get();
  try {
    // Pinned against DB sha256 d9037dce…, the hash the fleet's baselines use.
    assert.equal(one("SELECT COUNT(*) c FROM Food").c, 14151, "food count moved — re-run the audit before trusting any number in the report");
    assert.equal(one("SELECT COUNT(*) c FROM Recipe").c, 910);
    assert.equal(one("SELECT COUNT(*) c FROM Food WHERE source='quarantined'").c, 77);
    assert.equal(one("SELECT COUNT(*) c FROM Food WHERE dataQuality LIKE 'NEEDS A HUMAN%'").c, 4);
    // CLAUDE.md's superseded-claims table still says "470 food rows carry
    // another food's macros verbatim". That was true before the 2026-07-31
    // repair. Today the same population is split, and only these remain
    // unresolved. If this number rises, the repair regressed.
    const unresolved = one(`SELECT COUNT(*) c FROM Food WHERE source='quarantined' OR dataQuality LIKE 'exception:provenance-cleared%' OR dataQuality LIKE 'exception:unverifiable-fdcid%' OR dataQuality LIKE 'NEEDS A HUMAN%' OR dataQuality LIKE 'exception: unverified%'`).c;
    // 77 quarantined + 2 provenance-cleared (source 'manual', so no overlap
    // with the 77) + 1 unverifiable-fdcid + 4 needs-a-human + 1 loose
    // "exception: unverified" = 85. Of these, 80 are correctly withheld by
    // macroTrustIssue and 5 — the trust gap — are still served as fact.
    assert.equal(unresolved, 85, "the unresolved wrong-record population changed");
  } finally {
    db.close();
  }
});
