// W4-2 — does the CURRENT tree still leak each candidate the sweep found?
// This DOES call the product gate. That is legitimate here: the oracle was
// built independently (oracleVocab.mjs); this step only asks the gate what
// answer it gives, so a leak can be reported as open or closed.
//   node fleet/out/W4-2/reachability.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const require = createRequire(path.join(ROOT, "backend/package.json"));
const df = require(path.join(ROOT, "backend/src/lib/dietaryFilter.js"));

const dbPath = path.join(ROOT, "backend/prisma/dev.db");
const db = new DatabaseSync(dbPath, { readOnly: true });
const dbSha = crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex").slice(0, 8);

const foods = db.prepare("SELECT id,name,category,fdcCategory,allergenTags,mayContain,source FROM Food").all();
const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
const recipes = db.prepare("SELECT id,name,steps FROM Recipe").all();
const ings = db.prepare("SELECT recipeId,foodId FROM RecipeIngredient").all();
const ingByRecipe = new Map();
for (const r of ings) {
  if (!ingByRecipe.has(r.recipeId)) ingByRecipe.set(r.recipeId, []);
  ingByRecipe.get(r.recipeId).push(r.foodId);
}
const foodById = new Map(foods.map((f) => [f.id, f]));

// candidate (foodName, exclusion term) pairs the independent sweep raised
const CASES = [
  ["Scotch Bonnet", "nightshades", "chili pepper, Capsicum chinense"],
  ["Enchilada sauce", "nightshades", "tomato + chili base"],
  ["Banana Pepper", "nightshades", "Capsicum annuum"],
  ["Oyster Sauce", "gluten", "commercial oyster sauce is wheat-thickened"],
  ["Oyster Sauce", "shellfish", "made from oyster extract"],
  ["Coriander", "cilantro", "the leaf ships under the bare name (T-2 L1)"],
  ["Pico De Gallo Sauce", "cilantro", "cilantro is a defining ingredient"],
  ["Chimichurri sauce", "cilantro", "cilantro in many recipes"],
  ["Harissa Spice", "nightshades", "T-2 known"],
  ["Passata", "nightshades", "T-2 known"],
  ["Wonton Skin", "eggs", "T-2 known"],
  ["Tomato Puree", "nightshades", "control: should be excluded"],
  ["Red Chilli", "nightshades", "control: should be excluded"],
  ["Cheddar Cheese", "dairy", "control: should be excluded"],
  ["Lupini Beans", "peanuts", "T-3 cross-reaction; row may not exist"],
];

const out = [];
for (const [name, term, why] of CASES) {
  const f = byName.get(name.toLowerCase()) || foods.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
  if (!f) { out.push({ food: name, term, present: false }); continue; }
  let matched = null, err = null;
  try { matched = df.foodMatchesExclusionTerm(f, term); } catch (e) { err = e.message; }
  out.push({ food: f.name, foodId: f.id, fdcCategory: f.fdcCategory, allergenTags: f.allergenTags, term, why, gateExcludes: matched, err });
}

// recipe-level: for each recipe that contains a leaking food, does the gate
// exclude the whole recipe for a persona carrying that term?
const RECIPE_CASES = [
  ["Mango chow", "nightshades"],
  ["Chicken Enchilada Casserole", "nightshades"],
  ["Porotos Granados (Chilean Bean Stew)", "nightshades"],
  ["Thai beef stir-fry", "gluten"],
  ["Thai beef stir-fry", "shellfish"],
  ["Vietnamese caramel trout", "cilantro"],
  ["Arepa Pabellón", "cilantro"],
];
const recOut = [];
for (const [rname, term] of RECIPE_CASES) {
  const r = recipes.find((x) => x.name === rname);
  if (!r) { recOut.push({ recipe: rname, term, present: false }); continue; }
  const ingFoods = (ingByRecipe.get(r.id) || []).map((id) => foodById.get(id)).filter(Boolean);
  const anyFoodMatches = ingFoods.some((f) => { try { return df.foodMatchesExclusionTerm(f, term); } catch { return false; } });
  // traceRecipeExclusions is the recipe-level gate (applyDietaryFilters takes
  // a FOOD pool, not recipes — calling it with recipes silently returns them).
  let recipeHidden = null;
  try {
    const counts = df.traceRecipeExclusions(
      [{ ...r, ingredients: ingFoods.map((f) => ({ name: f.name, food: f })) }],
      [term]
    );
    recipeHidden = counts[term] > 0;
  } catch (e) { recipeHidden = "ERR:" + e.message; }
  recOut.push({ recipe: r.name, term, ingredients: ingFoods.map((f) => f.name), anyIngredientMatches: anyFoodMatches, recipeExcludedByGate: recipeHidden });
}

// the p101 case: an exclusion the user typed that the gate cannot parse
const P101 = "no cow dairy but sheep and goat cheese are completely fine";
const p101 = {
  term: P101,
  resolve: (() => { try { return df.resolveExclusionTerm(P101); } catch (e) { return "ERR:" + e.message; } })(),
  describe: (() => { try { return df.describeExclusionTerms([P101]); } catch (e) { return "ERR:" + e.message; } })(),
  candidates: (() => { try { return df.exclusionTermCandidates ? df.exclusionTermCandidates(P101) : null; } catch (e) { return "ERR:" + e.message; } })(),
  matchesCheddar: (() => { const f = byName.get("cheddar cheese"); try { return f ? df.foodMatchesExclusionTerm(f, P101) : null; } catch (e) { return "ERR:" + e.message; } })(),
  matchesMilk: (() => { const f = foods.find((x) => /^milk$/i.test(x.name)) || foods.find((x) => /^milk,/i.test(x.name)); try { return f ? { food: f.name, matched: df.foodMatchesExclusionTerm(f, P101) } : null; } catch (e) { return "ERR:" + e.message; } })(),
  matchesFeta: (() => { const f = foods.find((x) => /feta/i.test(x.name)); try { return f ? { food: f.name, matched: df.foodMatchesExclusionTerm(f, P101) } : null; } catch (e) { return "ERR:" + e.message; } })(),
};

const report = { generatedAt: new Date().toISOString(), dbSha8: dbSha, gitHead: process.env.W42_HEAD || null, foodCases: out, recipeCases: recOut, unparseableExclusion: p101 };
fs.writeFileSync(path.join(ROOT, "fleet/out/W4-2/reachability.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
