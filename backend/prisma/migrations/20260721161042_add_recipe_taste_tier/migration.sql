-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN "tasteTier" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "tasteTierSource" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "userRatingAvg" REAL;
ALTER TABLE "Recipe" ADD COLUMN "userRatingCount" INTEGER;
