const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  generatePlan, validateInputs, pickTemplate, resolveVariant, prescription,
  trimSlots, exerciseCap, GENERATOR_VERSION, WEEKS,
} = require("../src/lib/training/generator.js");
const { TEMPLATES } = require("../src/lib/training/templates.js");

const BASE = { daysPerWeek: 3, sessionLengthMin: 60, style: "hypertrophy", experience: "intermediate", equipment: ["full-gym"] };

test("validation: rejects out-of-range days, bad lengths, unknown styles, empty equipment", () => {
  assert.equal(validateInputs({ ...BASE, daysPerWeek: 1 }).ok, false);
  assert.equal(validateInputs({ ...BASE, daysPerWeek: 7 }).ok, false);
  assert.equal(validateInputs({ ...BASE, sessionLengthMin: 50 }).ok, false);
  assert.equal(validateInputs({ ...BASE, style: "crossfit" }).ok, false);
  assert.equal(validateInputs({ ...BASE, equipment: [] }).ok, false);
  assert.equal(validateInputs({ ...BASE, equipment: ["jetpack"] }).ok, false, "unknown equipment filtered then rejected as empty");
  assert.equal(validateInputs(BASE).ok, true);
});

test("template matching: days pick the split, conditioning style overrides", () => {
  assert.equal(pickTemplate({ style: "strength", daysPerWeek: 2 }), "fullbody-2day");
  assert.equal(pickTemplate({ style: "hypertrophy", daysPerWeek: 3 }), "fullbody-3day");
  assert.equal(pickTemplate({ style: "general", daysPerWeek: 4 }), "upper-lower-4day");
  assert.equal(pickTemplate({ style: "strength", daysPerWeek: 6 }), "upper-lower-4day");
  assert.equal(pickTemplate({ style: "conditioning", daysPerWeek: 4 }), "conditioning-3day");
});

test("equipment resolution: best tier wins; full-gym implies barbell; bodyweight is the floor", () => {
  const v = { barbell: "Back Squat", dumbbells: "Goblet Squat", bands: "Banded Squat", bodyweight: "Tempo Squat (3s down)" };
  assert.equal(resolveVariant(v, ["full-gym"]), "Back Squat");
  assert.equal(resolveVariant(v, ["barbell", "bands"]), "Back Squat");
  assert.equal(resolveVariant(v, ["dumbbells", "bands"]), "Goblet Squat");
  assert.equal(resolveVariant(v, ["bands"]), "Banded Squat");
  assert.equal(resolveVariant(v, ["bodyweight"]), "Tempo Squat (3s down)");
});

test("prescriptions: style drives rep ranges, experience nudges sets/RPE, conditioning has null RPE", () => {
  assert.equal(prescription("strength", "advanced", "main").sets, 5);
  assert.equal(prescription("strength", "beginner", "main").sets, 3);
  assert.equal(prescription("strength", "intermediate", "main").reps, "4-6");
  assert.equal(prescription("hypertrophy", "intermediate", "main").reps, "8-12");
  assert.equal(prescription("general", "beginner", "main").rpe, 6.5);
  const cond = prescription("conditioning", "intermediate", "main");
  assert.equal(cond.rpe, null, "circuits do not prescribe RPE");
  assert.match(cond.reps, /40s work/);
});

test("session-length trimming drops accessories from the end, never mains", () => {
  const slots = [
    { role: "main", variants: {} }, { role: "main", variants: {} }, { role: "main", variants: {} },
    { role: "accessory", variants: {}, tag: "a1" }, { role: "accessory", variants: {}, tag: "a2" },
    { role: "accessory", variants: {}, tag: "a3" }, { role: "accessory", variants: {}, tag: "a4" },
  ];
  assert.equal(exerciseCap(30), 4);
  const trimmed = trimSlots(slots, 4);
  assert.equal(trimmed.length, 4);
  assert.equal(trimmed.filter((s) => s.role === "main").length, 3, "all mains survive");
  assert.equal(trimmed[3].tag, "a1", "first accessory survives, later ones trimmed");
  assert.equal(trimSlots(slots, 8).length, 7, "no padding past the template");
});

test("generatePlan: full tree shape — 4 weeks, sessions capped by days, ordered exercises, v1 provenance", () => {
  const r = generatePlan(BASE);
  assert.equal(r.ok, true);
  const p = r.plan;
  assert.equal(p.generator, GENERATOR_VERSION);
  assert.equal(p.templateKey, "fullbody-3day");
  assert.equal(p.weeks.length, WEEKS);
  for (const w of p.weeks) {
    assert.ok(w.note, "every week carries a coaching note");
    assert.equal(w.sessions.length, 3);
    for (const s of w.sessions) {
      assert.ok(s.exercises.length >= 4);
      s.exercises.forEach((e, i) => {
        assert.equal(e.order, i);
        assert.ok(e.name && e.sets > 0 && e.reps, "every exercise has name/sets/reps");
      });
    }
  }
});

test("generatePlan: 6 available days still programs 4 sessions and says so honestly", () => {
  const r = generatePlan({ ...BASE, daysPerWeek: 6, style: "strength" });
  assert.equal(r.ok, true);
  assert.equal(r.plan.templateKey, "upper-lower-4day");
  assert.equal(r.plan.weeks[0].sessions.length, 4);
  assert.ok(r.plan.planNotes.some((n) => n.includes("v1 programs 4 sessions")), "extra days are addressed, not silently ignored");
});

test("generatePlan: bodyweight-only strength never prescribes barbell movements", () => {
  const r = generatePlan({ ...BASE, style: "strength", equipment: ["bodyweight"] });
  assert.equal(r.ok, true);
  const names = r.plan.weeks[0].sessions.flatMap((s) => s.exercises.map((e) => e.name)).join(" | ");
  assert.ok(!/barbell|bench press|back squat|deadlift\b/i.test(names), `no barbell movements, got: ${names}`);
});

test("generatePlan: 30-minute sessions cut accessories, 90-minute keeps the full list", () => {
  const short = generatePlan({ ...BASE, sessionLengthMin: 30 });
  const long = generatePlan({ ...BASE, sessionLengthMin: 90 });
  assert.equal(short.plan.weeks[0].sessions[0].exercises.length, 4);
  assert.equal(long.plan.weeks[0].sessions[0].exercises.length, TEMPLATES["fullbody-3day"].sessions[0].slots.length);
});

test("every template session slot has all four equipment variants", () => {
  for (const [key, t] of Object.entries(TEMPLATES)) {
    for (const s of t.sessions) {
      for (const slot of s.slots) {
        for (const tier of ["barbell", "dumbbells", "bands", "bodyweight"]) {
          assert.ok(slot.variants[tier], `${key} / ${s.name}: slot missing ${tier} variant`);
        }
      }
    }
  }
});
