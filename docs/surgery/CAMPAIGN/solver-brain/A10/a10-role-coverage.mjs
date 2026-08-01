// A10 — role coverage recon. READ-ONLY against A10's own dev.db copy.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const q = (sql) => prisma.$queryRawUnsafe(sql);
const j = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? Number(v) : v));

const out = {};

out.totalRecipes = await q(`SELECT COUNT(*) n FROM Recipe`);
out.totalIngRows = await q(`SELECT COUNT(*) n FROM RecipeIngredient`);

// 1. role histogram, all rows
out.roleHistAll = await q(`
  SELECT COALESCE(role,'<NULL>') role, COUNT(*) n
  FROM RecipeIngredient GROUP BY 1 ORDER BY n DESC`);

// 2. role histogram, SCALABLE rows only (fixed rows never move)
out.roleHistScalable = await q(`
  SELECT COALESCE(role,'<NULL>') role, COUNT(*) n
  FROM RecipeIngredient WHERE scalable = 1 GROUP BY 1 ORDER BY n DESC`);

// 3. distinct NON-NULL roles per recipe (scalable rows only) -> the k a
//    per-role optimizer would actually get.
out.distinctRolesPerRecipe = await q(`
  SELECT k, COUNT(*) recipes FROM (
    SELECT recipeId, COUNT(DISTINCT role) k
    FROM RecipeIngredient WHERE scalable = 1 AND role IS NOT NULL
    GROUP BY recipeId
  ) GROUP BY k ORDER BY k`);

// 3b. same, but collapsing the 7-value vocabulary to the 4 MACRO roles the
//     mechanism proposes (protein/carb/fat/veg); dairy+fruit+other -> 'other'
out.distinctMacroRolesPerRecipe = await q(`
  SELECT k, COUNT(*) recipes FROM (
    SELECT recipeId, COUNT(DISTINCT CASE
      WHEN role IN ('protein','carb','fat','veg') THEN role ELSE 'other' END) k
    FROM RecipeIngredient WHERE scalable = 1 AND role IS NOT NULL
    GROUP BY recipeId
  ) GROUP BY k ORDER BY k`);

// 4. recipes with ANY null-role scalable ingredient (unbundlable by role)
out.recipesWithNullRoleScalable = await q(`
  SELECT COUNT(DISTINCT recipeId) n FROM RecipeIngredient
  WHERE scalable = 1 AND role IS NULL`);

// 5. per-recipe share of scalable rows that are null-role
out.nullShareBuckets = await q(`
  SELECT bucket, COUNT(*) recipes FROM (
    SELECT recipeId,
      CASE
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) = 0 THEN '0%'
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) < 0.25 THEN '<25%'
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) < 0.5 THEN '25-50%'
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) < 1 THEN '50-99%'
        ELSE '100%' END bucket
    FROM RecipeIngredient WHERE scalable = 1 GROUP BY recipeId
  ) GROUP BY bucket ORDER BY recipes DESC`);

// 6. today's ACTUAL degrees of freedom: recipes that have >=1 scalable
//    protein-role ingredient AND >=1 scalable non-protein ingredient (i.e. the
//    2-knob Cramer branch fires) vs those that fall to the uniform 1-knob branch
out.twoKnobEligible = await q(`
  SELECT
    SUM(CASE WHEN p > 0 AND r > 0 THEN 1 ELSE 0 END) two_knob,
    SUM(CASE WHEN p = 0 THEN 1 ELSE 0 END) one_knob_no_protein,
    SUM(CASE WHEN p > 0 AND r = 0 THEN 1 ELSE 0 END) protein_only,
    COUNT(*) total
  FROM (
    SELECT recipeId,
      SUM(CASE WHEN role = 'protein' THEN 1 ELSE 0 END) p,
      SUM(CASE WHEN role IS NOT DISTINCT FROM role AND role <> 'protein' THEN 1 ELSE 0 END)
        + SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END) r
    FROM RecipeIngredient WHERE scalable = 1 GROUP BY recipeId
  )`);

// 7. scalable-ingredient count per recipe (upper bound on per-INGREDIENT knobs)
out.scalableCountBuckets = await q(`
  SELECT n_scalable, COUNT(*) recipes FROM (
    SELECT recipeId, COUNT(*) n_scalable
    FROM RecipeIngredient WHERE scalable = 1 GROUP BY recipeId
  ) GROUP BY n_scalable ORDER BY n_scalable`);

for (const [k, v] of Object.entries(out)) console.log(k + "\t" + j(v));
await prisma.$disconnect();
