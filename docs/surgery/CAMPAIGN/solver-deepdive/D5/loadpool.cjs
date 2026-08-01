// Loads recipes from the D5 DB COPY into the exact object shape the product
// exclusion gate expects, then runs the PRODUCT gate (read-only import).
const {DatabaseSync} = require('node:sqlite');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const GATE = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/exclusionGate.js");

const db = new DatabaseSync(__dirname + '/dev-copy.db');
const q = s => db.prepare(s).all();
const J = v => { if (v == null) return null; if (typeof v !== 'string') { try { return JSON.parse(Buffer.from(v).toString('utf8')); } catch { return null; } } try { return JSON.parse(v); } catch { return v; } };

const foods = new Map();
for (const f of q("SELECT * FROM Food")) {
  foods.set(f.id, {...f, micros: J(f.micros), allergenTags: J(f.allergenTags), mayContain: J(f.mayContain)});
}
const recipes = new Map();
for (const r of q("SELECT * FROM Recipe")) {
  recipes.set(r.id, {...r, steps: J(r.steps) ?? [], aiVerifiedBy: J(r.aiVerifiedBy), ingredients: []});
}
for (const ri of q("SELECT * FROM RecipeIngredient")) {
  const r = recipes.get(ri.recipeId); if (!r) continue;
  r.ingredients.push({ id: ri.id, recipeId: ri.recipeId, foodId: ri.foodId, baseGrams: ri.baseGrams, scalable: !!ri.scalable, role: ri.role, food: foods.get(ri.foodId) || null });
}
module.exports = { db, q, foods, recipes: [...recipes.values()], GATE };
