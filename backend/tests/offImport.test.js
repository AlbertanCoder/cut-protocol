const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assessImport, candidateFromOffProduct, HARD_REJECT_CODES } = require("../src/lib/offImport.js");

// Deliberately a name with no keyword the shared name-shape heuristic reacts
// to (no "peanut"/"nut"/oil/meat words) — this fixture exists to prove the
// happy path cleanly; a real branded name tripping name-shape is covered
// separately below (it's a genuine, expected false-positive class for
// generic community product names, not a bug).
const product = (over) => ({
  upc: "737628064502",
  name: "Stir Fry Noodle Kit",
  brand: "Simply Asia",
  per100g: { kcal: 385, protein: 9.62, fat: 7.69, carb: 71.15, fiber: 1.9 },
  ...over,
});

// ── candidateFromOffProduct ───────────────────────────────────────────────

test("candidateFromOffProduct maps OFF fields and hard-pins source to community", () => {
  const c = candidateFromOffProduct(product());
  assert.equal(c.name, "Stir Fry Noodle Kit");
  assert.equal(c.upc, "737628064502");
  assert.equal(c.brand, "Simply Asia");
  assert.equal(c.kcal, 385);
  assert.equal(c.source, "community");
  assert.ok(c.category, "category is classified, never left blank");
});

test("candidateFromOffProduct carries micros through untouched, defaulting honestly to null", () => {
  const withMicros = candidateFromOffProduct(product({ micros: { iron: 2, calcium: 158.2 } }));
  assert.deepEqual(withMicros.micros, { iron: 2, calcium: 158.2 });

  const withoutMicros = candidateFromOffProduct(product({ micros: null }));
  assert.equal(withoutMicros.micros, null);

  const undeclaredMicros = candidateFromOffProduct(product());
  assert.equal(undeclaredMicros.micros, null, "a product() with no micros field defaults to null, never omitted or invented");
});

test("candidateFromOffProduct classifies category from the name via the shared classifier", () => {
  const c = candidateFromOffProduct(product({ name: "Cheddar Cheese Crackers" }));
  assert.equal(c.category, "dairy-eggs", "cheese keyword wins over the grain word per foodCategories.js's rule order — same classifier every other import path uses");
});

// ── assessImport: the reconciliation guard ───────────────────────────────

test("a clean, reconciling row passes cleanly", () => {
  const c = candidateFromOffProduct(product());
  const a = assessImport(c);
  assert.equal(a.verdict, "pass");
  assert.equal(a.dataQuality, "pass");
  assert.equal(a.issues.length, 0);
});

test("real Nutella-shaped data: kcal does not reconcile with 4P+4C+9F — flagged, not silently passed, not rejected", () => {
  // Real OFF figures for Nutella (protein 6.3, carbs 57.5, fat 30.9 → naive
  // Atwater ≈ 4*6.3+4*57.5+9*30.9=529 vs declared 539 kcal, which DOES
  // reconcile within 15% — use a case that genuinely drifts instead:
  const c = candidateFromOffProduct(product({ per100g: { kcal: 539, protein: 6.3, fat: 30.9, carb: 57.5, fiber: 0 } }));
  const a = assessImport(c);
  assert.equal(a.verdict, "pass", "this one actually does reconcile — sanity check on the fixture");

  const bad = candidateFromOffProduct(product({ per100g: { kcal: 900, protein: 6.3, fat: 30.9, carb: 57.5, fiber: 0 } }));
  const badAssessment = assessImport(bad);
  assert.equal(badAssessment.verdict, "warn");
  assert.equal(badAssessment.dataQuality, "warn:atwater");
  assert.ok(badAssessment.softIssues.some((i) => i.code === "atwater"));
  assert.equal(badAssessment.hardIssues.length, 0);
});

test("branded names can trip the shared name-shape heuristic even with correct macros — flagged, still importable", () => {
  // Real product name from a live OFF lookup during this track's build
  // (barcode 737628064502): correct, reconciling macros, but "Peanut ...Kit"
  // matches the nut-name pattern (expects ~550-650 kcal fat-dominant) —
  // exactly the kind of generic-branded-name false positive this crowd
  // source produces that a curated USDA name almost never would.
  const c = candidateFromOffProduct(product({ name: "Peanut Noodle Kit" }));
  const a = assessImport(c);
  assert.equal(a.verdict, "warn");
  assert.ok(a.softIssues.some((i) => i.code === "name-shape"));
  assert.equal(a.hardIssues.length, 0, "a name-shape false positive never blocks the import — it's surfaced, not silently swallowed or refused");
});

test("missing macro (incomplete crowd panel) is hard-rejected, not saved with an invented 0", () => {
  const c = candidateFromOffProduct(product({ per100g: { kcal: 400, protein: null, fat: null, carb: null, fiber: 0 } }));
  const a = assessImport(c);
  assert.equal(a.verdict, "reject");
  assert.equal(a.dataQuality, null);
  assert.ok(a.hardIssues.some((i) => i.code === "missing"));
});

test("kcal 0 with real macros present (broken community record) is hard-rejected", () => {
  const c = candidateFromOffProduct(product({ per100g: { kcal: 0, protein: 10, fat: 5, carb: 20, fiber: 0 } }));
  const a = assessImport(c);
  assert.equal(a.verdict, "reject");
  assert.ok(a.hardIssues.some((i) => i.code === "zero-kcal"));
});

test("absurd macros (sum over 105g/100g) are hard-rejected", () => {
  const c = candidateFromOffProduct(product({ per100g: { kcal: 900, protein: 60, fat: 40, carb: 20, fiber: 0 } }));
  const a = assessImport(c);
  assert.equal(a.verdict, "reject");
  assert.ok(a.hardIssues.some((i) => i.code === "absurd"));
});

test("negative macros (junk sign) are hard-rejected", () => {
  const c = candidateFromOffProduct(product({ per100g: { kcal: 100, protein: 5, fat: 2, carb: -3, fiber: 0 } }));
  const a = assessImport(c);
  assert.equal(a.verdict, "reject");
  assert.ok(a.hardIssues.some((i) => i.code === "negative"));
});

test("hard-reject set covers exactly the physically-broken codes, not the reconciliation ones", () => {
  assert.ok(HARD_REJECT_CODES.has("missing"));
  assert.ok(HARD_REJECT_CODES.has("negative"));
  assert.ok(HARD_REJECT_CODES.has("absurd"));
  assert.ok(HARD_REJECT_CODES.has("zero-kcal"));
  assert.ok(!HARD_REJECT_CODES.has("atwater"), "atwater mismatches are flagged and imported, per CLAUDE.md's 'reject or flag'");
  assert.ok(!HARD_REJECT_CODES.has("name-shape"));
});
