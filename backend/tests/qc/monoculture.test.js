// QC customers #2/#3/#5/#11/#12 — the ~158 protein-forward GENERATED templates
// ("High-Protein {protein} & {veg} with {carb}", source ai-generated) out-competed
// real recipes on macro fit, so a week was near-identical clones and a meat-eater
// got TVP/seitan. pickRecipe now down-weights them (GENERATED_TEMPLATE_WEIGHT) so
// real recipes win when they fit — while still being usable in thin pools where
// only they fit (every candidate penalised equally). These pin the classifier.
const test = require("node:test");
const assert = require("node:assert");
const planner = require("../../src/lib/weeklyPlanner.js");
const { isGeneratedTemplate, GENERATED_TEMPLATE_WEIGHT } = planner;

test("the generated protein-forward templates are identified", () => {
  for (const name of ["High-Protein TVP & Onions with Rice", "High-Protein Seitan & Broccoli with Lentil Pasta", "High-Protein Cottage Cheese & Bell Peppers with Potato"]) {
    assert.equal(isGeneratedTemplate({ source: "ai-generated", name }), true, `"${name}" should be flagged`);
  }
});

test("real recipes are NOT flagged (curated/imported/themealdb + AI recipes off-template)", () => {
  const reals = [
    { source: "curated", name: "Beef & Broccoli" },
    { source: "themealdb-import", name: "Kung Po Prawns" },
    { source: "imported", name: "Grandma's Chili" },
    // an AI recipe that is NOT the protein-forward template must not be caught
    { source: "ai-generated", name: "Spiced Chickpea Stew" },
    // 'with' but not the High-Protein template
    { source: "curated", name: "Salmon with Asparagus" },
  ];
  for (const r of reals) assert.equal(isGeneratedTemplate(r), false, `"${r.name}" (${r.source}) should NOT be flagged`);
});

test("the penalty is a soft down-weight, not an exclusion", () => {
  // < 1 so real recipes are preferred; > 0 so generated stay usable when they're
  // the only thing that fits a thin-diet pool (the protein floor they rescue).
  assert.ok(GENERATED_TEMPLATE_WEIGHT > 0 && GENERATED_TEMPLATE_WEIGHT < 1, `weight ${GENERATED_TEMPLATE_WEIGHT} must be in (0,1)`);
});
