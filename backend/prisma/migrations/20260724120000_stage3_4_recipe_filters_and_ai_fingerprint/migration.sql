-- Stage 3 five-filter cache (derived by scripts/backfillRecipeFilters.mjs).
ALTER TABLE "Recipe" ADD COLUMN "costPerServing" REAL;
ALTER TABLE "Recipe" ADD COLUMN "difficulty" INTEGER;
ALTER TABLE "Recipe" ADD COLUMN "filterProvenance" TEXT;

-- Stage 4 Library->Brain router: durable cache index + verification provenance.
ALTER TABLE "Recipe" ADD COLUMN "aiFingerprint" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "aiVerifiedAt" DATETIME;
ALTER TABLE "Recipe" ADD COLUMN "aiVerifiedBy" JSONB;

CREATE INDEX "Recipe_aiFingerprint_idx" ON "Recipe"("aiFingerprint");
