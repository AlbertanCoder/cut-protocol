-- Ingredient dedupe + the indexes this schema shipped without, and the
-- structured half of Food.dataQuality. See schema.prisma for the full
-- reasoning on each; the measurements are in the review report.
--
-- SAFETY NOTES FOR THE IN-PROCESS RUNNER (src/lib/desktopBootstrap.js):
--   * Every statement below is legal inside a transaction. The runner wraps
--     each migration in BEGIN/COMMIT, so anything that cannot run in one
--     (notably PRAGMA journal_mode) must NOT appear here — and does not.
--   * No table is created, dropped or rebuilt, so this migration behaves
--     identically with foreign keys ON or OFF. The runner disables them; a
--     plain `prisma migrate deploy` leaves them on. Both are fine here.
--   * No foreign key is added, removed or repointed, so the runner's
--     pre-commit `PRAGMA foreign_key_check` cannot newly fail because of it.
--   * The runner splits statements on lines ending in ";" — every statement
--     below therefore ends its final line with ";" and contains no ";" inside
--     a string literal.

-- ── 1. Collapse duplicate (recipeId, foodId) rows ────────────────────────
-- Measured before this ran: dev.db 208 duplicate pairs / 429 rows / 125
-- recipes; the owner's installed DB 204 pairs / 420 rows / 125 recipes.
-- The surviving row is the lowest rowid in each group and absorbs the whole
-- group: grams SUMMED (this is what keeps cached recipe macros identical --
-- computeRecipeMacros already summed every duplicate row, so total grams per
-- food must not change), `scalable` OR-ed (if any part of the merged
-- quantity scaled with the recipe, the merged row scales), and `role` taking
-- the earliest non-null so a labelled row is never demoted to null by an
-- unlabelled sibling. Measured in both databases: zero groups disagree on
-- scalable or role, so today these two aggregates are no-ops -- they are here
-- so the merge is correct on any database, not just these two.
UPDATE "RecipeIngredient" SET
  "baseGrams" = (SELECT sum(d."baseGrams") FROM "RecipeIngredient" d
                 WHERE d."recipeId" = "RecipeIngredient"."recipeId" AND d."foodId" = "RecipeIngredient"."foodId"),
  "scalable" = (SELECT max(d."scalable") FROM "RecipeIngredient" d
                WHERE d."recipeId" = "RecipeIngredient"."recipeId" AND d."foodId" = "RecipeIngredient"."foodId"),
  "role" = (SELECT d."role" FROM "RecipeIngredient" d
            WHERE d."recipeId" = "RecipeIngredient"."recipeId" AND d."foodId" = "RecipeIngredient"."foodId"
              AND d."role" IS NOT NULL ORDER BY d."rowid" LIMIT 1)
WHERE "rowid" IN (
  SELECT min("rowid") FROM "RecipeIngredient" GROUP BY "recipeId", "foodId" HAVING count(*) > 1
);

DELETE FROM "RecipeIngredient" WHERE "rowid" NOT IN (
  SELECT min("rowid") FROM "RecipeIngredient" GROUP BY "recipeId", "foodId"
);

-- ── 2. The constraint the dedupe just made appliable ─────────────────────
-- Order is load-bearing: created before step 1 this fails outright on 208
-- violating groups.
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_foodId_key" ON "RecipeIngredient"("recipeId", "foodId");

-- ── 3. The missing foreign-key index ─────────────────────────────────────
-- `recipeId` needs no separate index: the unique index above is
-- (recipeId, foodId) and SQLite uses its leading-column prefix. Measured as
-- indistinguishable from a standalone one (34.12 vs 33.95 ms).
CREATE INDEX "RecipeIngredient_foodId_idx" ON "RecipeIngredient"("foodId");

-- ── 4. Foods list: order-by in index order + category filter ─────────────
CREATE INDEX "Food_category_name_idx" ON "Food"("category", "name");

-- ── 5. Structured projection of Food.dataQuality ─────────────────────────
-- Additive and nullable, so every existing row and every existing query keeps
-- working untouched. Backfill is derived purely from the prose prefix already
-- in the column -- it invents nothing, and a row whose prose matches no known
-- prefix stays NULL rather than being guessed into a bucket.
ALTER TABLE "Food" ADD COLUMN "dataQualityFlag" TEXT;

UPDATE "Food" SET "dataQualityFlag" = CASE
  WHEN "dataQuality" LIKE 'pass%' THEN 'pass'
  WHEN "dataQuality" LIKE 'warn%' THEN 'warn'
  WHEN "dataQuality" LIKE 'exception%' THEN 'exception'
  ELSE NULL
END WHERE "dataQuality" IS NOT NULL;

-- ── 6. Give the planner statistics ───────────────────────────────────────
-- This database has never been ANALYZEd (no sqlite_stat1 table), so every
-- plan above is chosen from hardcoded guesses. Cheap here (~14k + ~7k rows)
-- and it is what stops the new indexes from being ignored as the tables grow.
ANALYZE;
