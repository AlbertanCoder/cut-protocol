-- Food allergen metadata (findings dietary-safety-2 / -4 / -5).
--
-- Three nullable, additive columns. Nothing is rewritten, nothing is dropped,
-- no table is redefined: every existing Food row keeps its data and simply
-- contributes no metadata evidence to the dietary filter until an import
-- backfills it. Safe to run on a live dev.db.
--
--   fdcCategory  USDA FoodData Central's own category string, verbatim.
--                scripts/lib/fdcDataset.js has always parsed it; it had
--                nowhere to be stored, so the authoritative-category signal
--                was discarded at import (root cause of dietary-safety-2).
--   allergenTags Declared allergens as a JSON array of normalised Open Food
--                Facts tag slugs ("milk", "gluten", "crustaceans"), from the
--                barcode import's allergens_tags (dietary-safety-4).
--   mayContain   Trace / "may contain" statements, same shape, from
--                traces_tags. Kept separate from allergenTags because it is a
--                weaker claim and callers must be able to say which one fired.

-- AlterTable
ALTER TABLE "Food" ADD COLUMN "allergenTags" JSONB;
ALTER TABLE "Food" ADD COLUMN "fdcCategory" TEXT;
ALTER TABLE "Food" ADD COLUMN "mayContain" JSONB;
