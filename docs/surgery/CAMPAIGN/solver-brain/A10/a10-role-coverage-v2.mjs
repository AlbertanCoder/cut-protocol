// A10 — role coverage recon (v2; v1 could not resolve @prisma/client from this
// dir and docs/surgery/CAMPAIGN is CREATE-ONLY, so this is a new file).
// READ-ONLY against A10's own dev.db copy.
import { createRequire } from "node:module";
const require = createRequire("file:///C:/Users/<account>/Desktop/cut-protocol/backend/package.json");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const q = (sql) => prisma.$queryRawUnsafe(sql);
const j = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? Number(v) : v));

const out = {};

out.totalRecipes = await q(`SELECT COUNT(*) n FROM Recipe`);
out.totalIngRows = await q(`SELECT COUNT(*) n FROM RecipeIngredient`);

out.roleHistAll = await q(`
  SELECT COALESCE(role,'<NULL>') role, COUNT(*) n
  FROM RecipeIngredient GROUP BY 1 ORDER BY n DESC`);

out.roleHistScalable = await q(`
  SELECT COALESCE(role,'<NULL>') role, COUNT(*) n
  FROM RecipeIngredient WHERE scalable = 1 GROUP BY 1 ORDER BY n DESC`);

// distinct NON-NULL roles per recipe (scalable rows only) -> the k a per-role
// optimizer would actually get.
out.distinctRolesPerRecipe = await q(`
  SELECT k, COUNT(*) recipes FROM (
    SELECT recipeId, COUNT(DISTINCT role) k
    FROM RecipeIngredient WHERE scalable = 1 AND role IS NOT NULL
    GROUP BY recipeId
  ) GROUP BY k ORDER BY k`);

// same, collapsed to the 4 macro roles the mechanism proposes
out.distinctMacroRolesPerRecipe = await q(`
  SELECT k, COUNT(*) recipes FROM (
    SELECT recipeId, COUNT(DISTINCT CASE
      WHEN role IN ('protein','carb','fat','veg') THEN role ELSE 'other' END) k
    FROM RecipeIngredient WHERE scalable = 1 AND role IS NOT NULL
    GROUP BY recipeId
  ) GROUP BY k ORDER BY k`);

out.recipesWithNullRoleScalable = await q(`
  SELECT COUNT(DISTINCT recipeId) n FROM RecipeIngredient
  WHERE scalable = 1 AND role IS NULL`);

out.nullShareBuckets = await q(`
  SELECT bucket, COUNT(*) recipes FROM (
    SELECT recipeId,
      CASE
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) = 0 THEN 'a_0pct'
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) < 0.25 THEN 'b_under25'
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) < 0.5 THEN 'c_25to50'
        WHEN SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END)*1.0/COUNT(*) < 1 THEN 'd_50to99'
        ELSE 'e_100pct' END bucket
    FROM RecipeIngredient WHERE scalable = 1 GROUP BY recipeId
  ) GROUP BY bucket ORDER BY bucket`);

// today's actual DoF: does the 2-knob Cramer branch even fire?
out.twoKnobEligible = await q(`
  SELECT
    SUM(CASE WHEN p > 0 AND r > 0 THEN 1 ELSE 0 END) two_knob,
    SUM(CASE WHEN p = 0 THEN 1 ELSE 0 END) one_knob_no_protein,
    SUM(CASE WHEN p > 0 AND r = 0 THEN 1 ELSE 0 END) protein_only,
    COUNT(*) total
  FROM (
    SELECT recipeId,
      SUM(CASE WHEN role = 'protein' THEN 1 ELSE 0 END) p,
      SUM(CASE WHEN role IS NULL OR role <> 'protein' THEN 1 ELSE 0 END) r
    FROM RecipeIngredient WHERE scalable = 1 GROUP BY recipeId
  )`);

out.scalableCountBuckets = await q(`
  SELECT n_scalable, COUNT(*) recipes FROM (
    SELECT recipeId, COUNT(*) n_scalable
    FROM RecipeIngredient WHERE scalable = 1 GROUP BY recipeId
  ) GROUP BY n_scalable ORDER BY n_scalable`);

for (const [k, v] of Object.entries(out)) console.log(k + "\t" + j(v));
await prisma.$disconnect();
