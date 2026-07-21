// Stage 6 (K) fix — PROTEIN-FORWARD draft generator. Targets the simulation's
// finding: veg/vegan days miss the protein floor. These recipes carry a big
// protein portion, a protein-rich or moderate carb, and minimal fat, so protein
// density (g/kcal) is high enough for the solver to scale to a cutting target.
// Output → genLibrary.mjs (same verifier). Heavy on vegan (the 0% gap).
import fs from "node:fs";

// dense proteins (grams tuned for ~30-45g protein per serving)
const P = {
  seitan:   { name: "seitan", g: 170, diet: "vegan" },
  tvp:      { name: "textured vegetable protein", g: 55, diet: "vegan" },
  tempeh:   { name: "tempeh", g: 160, diet: "vegan" },
  edamame:  { name: "edamame", g: 180, diet: "vegan" },
  tofu:     { name: "tofu", g: 200, diet: "vegan" },
  chicken:  { name: "chicken breast", g: 200, diet: "omni" },
  tuna:     { name: "tuna", g: 150, diet: "omni" },
  turkey:   { name: "turkey breast", g: 170, diet: "omni" },
  shrimp:   { name: "shrimp", g: 170, diet: "omni" },
  whitefish:{ name: "white fish", g: 190, diet: "omni" },
  eggwhite: { name: "egg white", g: 260, diet: "veg" },
  cottage:  { name: "cottage cheese", g: 200, diet: "veg" },
};
// carbs — the two protein pastas double the protein; others are moderate
const C = {
  lentilpasta:  { name: "lentil pasta", g: 100 },
  chickpeapasta:{ name: "chickpea pasta", g: 100 },
  rice:  { name: "white rice", g: 110 },
  quinoa:{ name: "quinoa", g: 110 },
  potato:{ name: "potato", g: 150 },
};
const V = { broccoli: { name: "broccoli", g: 110 }, peppers: { name: "bell peppers", g: 80 }, onions: { name: "onions", g: 60 }, cucumber: { name: "cucumber", g: 90 } };

// Full cross: every protein × every carb, so there are ENOUGH dense recipes to
// fill a whole week within the 2x/week variety cap (a vegan week ~ 21 slots).
const carbKeys = Object.keys(C);
const PLAN = Object.keys(P).map((pk) => [pk, carbKeys]);
const vegKeys = Object.keys(V);
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const drafts = [];
for (const [pk, carbs] of PLAN) {
  const p = P[pk];
  for (let ci = 0; ci < carbs.length; ci++) {
    const c = C[carbs[ci]];
    for (let vj = 0; vj < 2; vj++) {
    const v = V[vegKeys[(ci + vj) % vegKeys.length]];
    const pLabel = cap(p.name.replace(/textured vegetable protein/i, "TVP").replace(/ breast/i, "").trim());
    const cLabel = cap(c.name.replace(/white /i, "").trim());
    const vLabel = cap(v.name.replace(/ bell/i, "").trim());
    drafts.push({
      name: `High-Protein ${pLabel} & ${vLabel} with ${cLabel}`.replace(/\s+/g, " ").trim(),
      cuisine: null, slotType: "meal",
      ingredients: [
        { name: p.name, grams: p.g, role: "protein", scalable: true },
        { name: c.name, grams: c.g, role: "carb", scalable: true },
        { name: v.name, grams: v.g, role: "veg", scalable: true },
        { name: "olive oil", grams: 5, role: "fat", scalable: false },
      ],
      steps: [`Cook the ${pLabel.toLowerCase()}.`, `Serve over ${c.name} with ${v.name}.`],
    });
    }
  }
}
process.stdout.write(JSON.stringify(drafts, null, 1));
console.error(`generated ${drafts.length} protein-forward drafts`);
