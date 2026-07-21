// Stage 6 (K) — combinatorial DRAFT generator. Composes varied, cuisine-flavoured
// recipe drafts from curated real-food building blocks and writes them as a
// drafts JSON for genLibrary.mjs to VALIDATE + persist (same verifier: real
// foods only, sane macros, dedup). This is the efficient bulk path — the harness
// still gates every one, so nothing unverified reaches the pool.
//
//   node scripts/genComboDrafts.mjs > drafts.json   (then run genLibrary.mjs)
import fs from "node:fs";

// Ingredient names are matched token-subset against the real 858-food library by
// the harness; these are all confirmed to resolve.
const P = {
  chicken: { name: "chicken breast", g: 170, vegan: false },
  beef: { name: "ground beef", g: 140, vegan: false },
  salmon: { name: "salmon", g: 150, vegan: false },
  tuna: { name: "tuna", g: 120, vegan: false },
  eggs: { name: "eggs", g: 150, vegan: false },
  tofu: { name: "tofu", g: 190, vegan: true },
  chickpeas: { name: "chickpeas", g: 190, vegan: true },
  blackbeans: { name: "black beans", g: 190, vegan: true },
  lentils: { name: "lentils", g: 180, vegan: true },
};
const C = {
  rice: { name: "white rice", g: 160 },
  quinoa: { name: "quinoa", g: 150 },
  pasta: { name: "pasta", g: 150 },
  couscous: { name: "couscous", g: 150 },
  bulgur: { name: "bulgur", g: 130 },
  potato: { name: "potato", g: 180 },
  noodles: { name: "noodles", g: 150 },
};
const V = {
  broccoli: { name: "broccoli", g: 110 },
  peppers: { name: "bell peppers", g: 80 },
  onion: { name: "onions", g: 60 },
  cucumber: { name: "cucumber", g: 80 },
};
const F = {
  olive: { name: "olive oil", g: 10 },
  sesame: { name: "sesame oil", g: 8 },
  almonds: { name: "almonds", g: 18 },
  cashews: { name: "cashew nuts", g: 18 },
  peanut: { name: "peanut butter", g: 18 },
};

// cuisine → { proteins, carbs, veg, fat, adj, verb }
const CUISINES = [
  { key: "asian", proteins: ["chicken", "beef", "tofu", "eggs"], carbs: ["rice", "noodles"], veg: ["broccoli", "peppers"], fat: ["sesame", "cashews"], adj: "Stir-Fried", tail: "Stir-Fry" },
  { key: "mexican", proteins: ["chicken", "beef", "blackbeans"], carbs: ["rice"], veg: ["peppers", "onion"], fat: ["olive"], adj: "Fiesta", tail: "Burrito Bowl" },
  { key: "indian", proteins: ["chicken", "chickpeas", "lentils"], carbs: ["rice", "potato"], veg: ["onion", "peppers"], fat: ["olive"], adj: "Spiced", tail: "Curry Bowl" },
  { key: "mediterranean", proteins: ["chicken", "salmon", "tuna", "chickpeas"], carbs: ["bulgur", "couscous"], veg: ["cucumber", "onion"], fat: ["olive", "almonds"], adj: "Mediterranean", tail: "Bowl" },
  { key: "italian", proteins: ["chicken", "beef", "lentils"], carbs: ["pasta"], veg: ["onion", "broccoli"], fat: ["olive"], adj: "Rustic", tail: "Pasta" },
  { key: "american", proteins: ["chicken", "beef", "salmon", "eggs"], carbs: ["rice", "potato"], veg: ["broccoli", "peppers"], fat: ["olive"], adj: "Classic", tail: "Plate" },
  { key: "thai", proteins: ["chicken", "tofu"], carbs: ["noodles", "rice"], veg: ["broccoli", "peppers"], fat: ["peanut", "sesame"], adj: "Thai", tail: "Noodles" },
];

const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const drafts = [];
for (const cz of CUISINES) {
  for (const pk of cz.proteins) {
    for (const ck of cz.carbs) {
      for (let vi = 0; vi < Math.min(2, cz.veg.length); vi++) {
        const p = P[pk], c = C[ck], v = V[cz.veg[vi]], f = F[cz.fat[vi % cz.fat.length]];
        const proteinLabel = cap(p.name.replace(/ breast| nuts/i, "").trim());
        const carbLabel = cap(c.name.replace(/white /i, "").trim());
        const vegLabel = cap(v.name.replace(/ bell| raw/i, "").trim());
        const name = `${cz.adj} ${proteinLabel} & ${vegLabel} with ${carbLabel}`.replace(/\s+/g, " ").trim();
        drafts.push({
          name,
          cuisine: cz.key,
          slotType: "meal",
          ingredients: [
            { name: p.name, grams: p.g, role: "protein", scalable: true },
            { name: c.name, grams: c.g, role: "carb", scalable: true },
            { name: v.name, grams: v.g, role: "veg", scalable: true },
            { name: f.name, grams: f.g, role: "fat", scalable: false },
          ],
          steps: [`Cook the ${proteinLabel.toLowerCase()}.`, `Serve with ${c.name} and ${v.name}.`],
        });
      }
    }
  }
}

process.stdout.write(JSON.stringify(drafts, null, 1));
console.error(`generated ${drafts.length} combo drafts`);
