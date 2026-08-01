// A10 — size the k=2 parity hole. solve2's degenerate fallback divides
// target.kcal by the SCALABLE bundle sum; scaleRecipe divides kcalTarget by
// recipe.kcal (which INCLUDES fixed ingredients). They agree only when
// fixed kcal == 0 — exactly what optimizer.golden.test.js pins.
import { createRequire } from "node:module";
const require = createRequire("file:///C:/Users/<account>/Desktop/cut-protocol/backend/package.json");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const q = (s) => prisma.$queryRawUnsafe(s);
const j = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? Number(v) : v));

const out = {};
out.recipesWithAnyFixedIng = await q(`
  SELECT COUNT(DISTINCT recipeId) n FROM RecipeIngredient WHERE scalable = 0`);
out.recipesWithFixedKcalGt0 = await q(`
  SELECT COUNT(*) n FROM (
    SELECT ri.recipeId FROM RecipeIngredient ri JOIN Food f ON f.id = ri.foodId
    WHERE ri.scalable = 0 GROUP BY ri.recipeId
    HAVING SUM(f.kcal * ri.baseGrams / 100.0) > 0)`);
// the exact divergence set: fixed kcal > 0 AND no scalable protein-role ing
// (=> scaleRecipe takes its uniform branch, solve2 takes noProteinBundle)
out.divergenceSet = await q(`
  SELECT COUNT(*) n FROM (
    SELECT r.id FROM Recipe r
    JOIN RecipeIngredient ri ON ri.recipeId = r.id
    JOIN Food f ON f.id = ri.foodId
    GROUP BY r.id
    HAVING SUM(CASE WHEN ri.scalable = 0 THEN f.kcal * ri.baseGrams / 100.0 ELSE 0 END) > 0
       AND SUM(CASE WHEN ri.scalable = 1 AND ri.role = 'protein' THEN 1 ELSE 0 END) = 0)`);
// median share of a recipe's kcal that sits in FIXED ingredients, where >0
out.fixedKcalShare = await q(`
  SELECT bucket, COUNT(*) recipes FROM (
    SELECT ri.recipeId,
      CASE WHEN SUM(CASE WHEN ri.scalable=0 THEN f.kcal*ri.baseGrams/100.0 ELSE 0 END)
              / NULLIF(SUM(f.kcal*ri.baseGrams/100.0),0) = 0 THEN 'a_zero'
           WHEN SUM(CASE WHEN ri.scalable=0 THEN f.kcal*ri.baseGrams/100.0 ELSE 0 END)
              / NULLIF(SUM(f.kcal*ri.baseGrams/100.0),0) < 0.05 THEN 'b_under5pct'
           WHEN SUM(CASE WHEN ri.scalable=0 THEN f.kcal*ri.baseGrams/100.0 ELSE 0 END)
              / NULLIF(SUM(f.kcal*ri.baseGrams/100.0),0) < 0.20 THEN 'c_5to20pct'
           ELSE 'd_over20pct' END bucket
    FROM RecipeIngredient ri JOIN Food f ON f.id = ri.foodId GROUP BY ri.recipeId
  ) GROUP BY bucket ORDER BY bucket`);
for (const [k, v] of Object.entries(out)) console.log(k + "\t" + j(v));
await prisma.$disconnect();
