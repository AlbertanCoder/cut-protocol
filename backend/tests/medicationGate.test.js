// Guards for the medication gate. The load-bearing case is the first one:
// an SGLT2 inhibitor plus a ketogenic plan must be REFUSED, not warned, and
// must be caught from a brand name alone — which is what a person types.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyMedication,
  classifyAll,
  assessPlanSafety,
} = require("../src/lib/medicationGate");

const codes = (list) => list.map((r) => r.code);

// ── the reason the module exists ───────────────────────────────────────────

test("SGLT2 brand name + keto is refused, not merely warned", () => {
  const v = assessPlanSafety({ medications: ["Jardiance"], dietaryStyle: "keto" });
  assert.equal(v.allowed, false);
  assert.ok(codes(v.refusals).includes("sglt2_ketogenic"));
  const r = v.refusals.find((x) => x.code === "sglt2_ketogenic");
  assert.equal(r.severity, "critical");
  assert.match(r.source, /FDA label/);
});

test("combination products are caught — their names reveal no component", () => {
  // Synjardy is empagliflozin + metformin. Nothing in the string says so.
  for (const brand of ["Synjardy", "Trijardy XR", "Xigduo", "Invokamet", "Glyxambi"]) {
    const v = assessPlanSafety({ medications: [brand], dietaryStyle: "keto" });
    assert.equal(v.allowed, false, `${brand} should have been refused`);
    assert.ok(codes(v.refusals).includes("sglt2_ketogenic"), `${brand} missed`);
  }
});

test("generic names are caught as well as brands", () => {
  const v = assessPlanSafety({ medications: ["empagliflozin 10mg"], dietaryStyle: "keto" });
  assert.equal(v.allowed, false);
  assert.ok(codes(v.refusals).includes("sglt2_ketogenic"));
});

test("SGLT2 without keto warns but does not block — a deficit alone is a listed trigger", () => {
  const v = assessPlanSafety({ medications: ["Farxiga"], dietaryStyle: "omnivore" });
  assert.equal(v.allowed, true);
  assert.equal(v.refusals.length, 0);
  assert.ok(codes(v.warnings).includes("sglt2_deficit"));
});

test("the same drug on a non-keto plan and on keto reach DIFFERENT verdicts", () => {
  // Non-vacuity: proves the dietaryStyle arm is actually consulted, rather
  // than the drug alone driving the outcome.
  const keto = assessPlanSafety({ medications: ["Jardiance"], dietaryStyle: "keto" });
  const omni = assessPlanSafety({ medications: ["Jardiance"], dietaryStyle: "omnivore" });
  assert.equal(keto.allowed, false);
  assert.equal(omni.allowed, true);
});

// ── matching discipline ────────────────────────────────────────────────────

test("matching is case- and punctuation-insensitive", () => {
  for (const s of ["JARDIANCE", "jardiance®", "Jardiance (empagliflozin) 25 mg", " jardiance "]) {
    assert.equal(classifyMedication(s)?.id, "sglt2", `failed on ${JSON.stringify(s)}`);
  }
});

test("word-boundary matching — unrelated drugs do not match", () => {
  for (const s of ["metformin", "lisinopril", "atorvastatin", "vitamin D", "ibuprofen"]) {
    assert.equal(classifyMedication(s), null, `${s} should not classify`);
  }
});

test("unrecognised medications are echoed back, never silently dropped", () => {
  const v = assessPlanSafety({ medications: ["Jardiance", "Blorbizol", ""] });
  assert.deepEqual(v.unrecognised, ["Blorbizol"]);
  assert.equal(v.recognised.length, 1);
  assert.equal(v.recognised[0].id, "sglt2");
});

test("empty input is allowed and fires nothing", () => {
  const v = assessPlanSafety({});
  assert.equal(v.allowed, true);
  assert.deepEqual(v.refusals, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.unrecognised, []);
});

// ── hypoglycaemia arm ──────────────────────────────────────────────────────

test("insulin warns about dose review at a normal target", () => {
  const v = assessPlanSafety({ medications: ["Lantus"], targetKcal: 1800 });
  assert.equal(v.allowed, true);
  assert.ok(codes(v.warnings).includes("hypoglycaemia_dose_review"));
});

test("insulin under 1000 kcal escalates from warning to refusal", () => {
  const v = assessPlanSafety({ medications: ["Lantus"], targetKcal: 900 });
  assert.equal(v.allowed, false);
  assert.ok(codes(v.refusals).includes("diabetes_vlcd"));
});

test("sulfonylureas and glinides are treated as hypoglycaemia risks too", () => {
  for (const d of ["glipizide", "Amaryl", "Diamicron", "repaglinide", "Starlix"]) {
    const v = assessPlanSafety({ medications: [d], targetKcal: 1800 });
    assert.ok(codes(v.warnings).includes("hypoglycaemia_dose_review"), `${d} missed`);
  }
});

// ── the remaining arms ─────────────────────────────────────────────────────

test("GLP-1 raises lean-mass and micronutrient flags without blocking", () => {
  const v = assessPlanSafety({ medications: ["Ozempic"], targetKcal: 1100 });
  assert.equal(v.allowed, true);
  assert.ok(codes(v.warnings).includes("glp1_lean_mass"));
  assert.ok(codes(v.warnings).includes("glp1_micronutrient"));
});

test("levothyroxine surfaces the meal-timing interaction", () => {
  const v = assessPlanSafety({ medications: ["Synthroid"] });
  assert.equal(v.allowed, true);
  const w = v.warnings.find((x) => x.code === "levothyroxine_timing");
  assert.ok(w);
  assert.match(w.message, /60 minutes before breakfast/);
});

test("pregnancy refuses a deficit outright", () => {
  const v = assessPlanSafety({ conditions: ["pregnant"] });
  assert.equal(v.allowed, false);
  assert.ok(codes(v.refusals).includes("pregnancy_deficit"));
});

test("breastfeeding raises the floor to 1500 and blocks the first three weeks", () => {
  const early = assessPlanSafety({ conditions: ["breastfeeding"], weeksPostPartum: 1 });
  assert.equal(early.allowed, false);
  assert.ok(codes(early.refusals).includes("postpartum_too_early"));

  const later = assessPlanSafety({ conditions: ["breastfeeding"], weeksPostPartum: 10 });
  assert.equal(later.allowed, true);
  assert.equal(later.floors.kcalMin, 1500);
  assert.ok(codes(later.warnings).includes("lactation_floor"));
});

test("CKD refuses the app's protein target and hands back a ceiling", () => {
  const v = assessPlanSafety({ conditions: ["ckd"] });
  assert.equal(v.allowed, false);
  assert.ok(codes(v.refusals).includes("ckd_protein"));
  assert.equal(v.floors.proteinMaxGPerKg, 0.8);
});

test("bariatric surgery: refused under six months, warned after", () => {
  const early = assessPlanSafety({ conditions: ["bariatric"], monthsPostOp: 2 });
  assert.equal(early.allowed, false);
  assert.ok(codes(early.refusals).includes("bariatric_early"));

  const later = assessPlanSafety({ conditions: ["bariatric"], monthsPostOp: 14 });
  assert.equal(later.allowed, true);
  assert.ok(codes(later.warnings).includes("bariatric_no_added_deficit"));
});

test("every refusal carries a citable source", () => {
  const v = assessPlanSafety({
    medications: ["Jardiance", "Lantus"],
    conditions: ["pregnant", "ckd"],
    dietaryStyle: "keto",
    targetKcal: 900,
  });
  assert.equal(v.allowed, false);
  assert.ok(v.refusals.length >= 4);
  for (const r of v.refusals) {
    assert.ok(typeof r.source === "string" && r.source.length > 10,
      `refusal ${r.code} has no usable source`);
  }
});

test("classifyAll deduplicates a class seen twice", () => {
  const { classes } = classifyAll(["Jardiance", "empagliflozin"]);
  assert.equal(classes.size, 1);
});

test("the gate never mutates its input", () => {
  const meds = ["Jardiance"];
  const conds = ["pregnant"];
  assessPlanSafety({ medications: meds, conditions: conds, dietaryStyle: "keto" });
  assert.deepEqual(meds, ["Jardiance"]);
  assert.deepEqual(conds, ["pregnant"]);
});
