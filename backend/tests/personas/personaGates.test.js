// personaGates.test.js — the §7 gates, EXECUTED (P0–P6; P7 joins at Phase 7).
//
// Maps the directive's Python names onto this stack (BLOCKERS B1):
//   test_allergen_zero            → "GATE: zero allergen violations…"
//   test_dietary_hard_constraints → "GATE: zero dietary-pattern violations…"
//   test_solver_tolerance         → "GATE: macro tolerance…"
//   test_variety_and_batch (½)    → "GATE: variety…"
//   test_solver_latency           → "GATE: latency…"
//   test_meal_structure           → "GATE: meal structure…"
//
// Needs the rebuild QA database; skips loudly with build instructions when
// absent (never opens dev.db — harness.js enforces that).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { qaDbPath, SKIP_NOTE, loadPoolRows, runPersona, biasFor } = require("./harness.js");
const { PERSONAS } = require("./fixtures.js");

const DB = qaDbPath();
const DAYS = 30;
const runs = new Map();
if (DB) {
  const rows = loadPoolRows(DB);
  for (const p of PERSONAS) runs.set(p.id, runPersona(p, rows, { days: DAYS, seed: 1 }));
}
const skip = DB ? false : SKIP_NOTE;
const allDays = () => [...runs.values()].flatMap((r) => r.days);

test("GATE: ≥200 person-days generated across the persona fleet", { skip }, () => {
  assert.ok(allDays().length >= 200, `only ${allDays().length} person-days`);
});

test("GATE: zero allergen violations — one hit fails the build (test_allergen_zero)", { skip }, () => {
  const hits = allDays().flatMap((d) => d.scan.hits);
  assert.deepEqual(hits, [], `allergen hits reached plates: ${hits.join("; ")}`);
});

test("GATE: zero dietary-pattern violations (test_dietary_hard_constraints)", { skip }, () => {
  for (const p of PERSONAS) {
    if (!p.forbiddenIngredientWords) continue;
    for (const d of runs.get(p.id).days) {
      for (const s of d.slots) {
        for (const dish of s.dishes) {
          assert.ok(!p.forbiddenIngredientWords.test(dish.recipeName),
            `${p.id} day ${d.day}: dish "${dish.recipeName}" violates the pattern`);
          for (const i of dish.ingredients) {
            assert.ok(!p.forbiddenIngredientWords.test(i.name || ""),
              `${p.id} day ${d.day}: ingredient "${i.name}" violates the pattern`);
          }
        }
      }
    }
  }
  // keto's ceiling is absolute — never crossed on any of P3's days
  for (const d of runs.get("p3").days) {
    assert.ok(d.totals.netCarb <= 25 + 1e-9, `p3 day ${d.day}: ${d.totals.netCarb} g net carbs over the 25 g ceiling`);
  }
});

test("GATE: macro tolerance met on ≥95% of generated days, post-rounding (test_solver_tolerance)", { skip }, () => {
  const days = allDays();
  const ok = days.filter((d) => d.ok).length;
  const rate = ok / days.length;
  assert.ok(rate >= 0.95, `${ok}/${days.length} = ${(rate * 100).toFixed(1)}% — below the 95% gate`);
});

test("GATE: variety — no recipe repeats within 3 days, none within a day (test_variety_and_batch)", { skip }, () => {
  for (const p of PERSONAS) {
    const seq = runs.get(p.id).days.map((d) => d.slots.flatMap((s) => s.dishes.map((x) => x.recipeId)));
    for (let i = 0; i < seq.length; i++) {
      assert.equal(new Set(seq[i]).size, seq[i].length, `${p.id} day ${i + 1}: a recipe repeats within the day`);
      for (const id of seq[i]) {
        if (i >= 1) assert.ok(!seq[i - 1].includes(id), `${p.id}: repeat across days ${i} and ${i + 1}`);
        if (i >= 2) assert.ok(!seq[i - 2].includes(id), `${p.id}: repeat across days ${i - 1} and ${i + 1}`);
      }
    }
  }
});

test("GATE: latency P50 < 2 s and P95 < 8 s per day (test_solver_latency)", { skip }, () => {
  const lat = allDays().map((d) => d.latencyMs).sort((a, b) => a - b);
  const p50 = lat[Math.floor(lat.length * 0.5)];
  const p95 = lat[Math.floor(lat.length * 0.95)];
  assert.ok(p50 < 2000, `P50 ${p50.toFixed(1)} ms`);
  assert.ok(p95 < 8000, `P95 ${p95.toFixed(1)} ms`);
});

test("GATE: meal structure is hard — OMAD is one slot every day; 4+2 is six (test_meal_structure)", { skip }, () => {
  for (const d of runs.get("p3").days) assert.equal(d.slots.length, 1, `p3 day ${d.day}`);
  for (const d of runs.get("p6").days) assert.equal(d.slots.length, 6, `p6 day ${d.day}`);
});

test("hard exclusion vs soft dislike are DIFFERENT mechanisms (p6)", { skip }, () => {
  // Hard: the lactose wall removes dairy from the pool entirely.
  const p6 = PERSONAS.find((p) => p.id === "p6");
  for (const d of runs.get("p6").days) {
    for (const s of d.slots) for (const dish of s.dishes) for (const i of dish.ingredients) {
      const name = i.name || "";
      // Plant-qualified "milks"/"butters" are NOT dairy — same qualifier rule
      // the real filter applies (Almond Milk, Coconut Milk, Peanut Butter).
      if (/\b(coconut|almond|soya?|oat|rice|peanut|cashew)\s+(milk|cream|butter)\b/i.test(name)) continue;
      assert.ok(!/\b(yogurt|cheese|milk|cream|butter)\b/i.test(name), `dairy reached p6: ${name}`);
    }
  }
  // Soft: the dislike is a DOWN-WEIGHT in the draw, not a wall — the bias
  // hook returns a multiplier < 1, never 0 and never an exclusion.
  const bias = biasFor(p6);
  const disliked = { name: "Cottage Cheese Bowl", cuisine: null, ingredients: [{ food: { name: "Cottage Cheese" } }], costPerServing: null };
  const neutral = { name: "Chicken Plate", cuisine: null, ingredients: [{ food: { name: "Chicken breast" } }], costPerServing: null };
  assert.ok(bias(disliked) < bias(neutral), "a dislike must bend the draw");
  assert.ok(bias(disliked) > 0, "a dislike must never become a wall");
});
