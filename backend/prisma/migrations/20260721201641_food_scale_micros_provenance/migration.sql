-- DropIndex
DROP INDEX "Food_name_key";

-- AlterTable
ALTER TABLE "Food" ADD COLUMN "brand" TEXT;
ALTER TABLE "Food" ADD COLUMN "dataQuality" TEXT;
ALTER TABLE "Food" ADD COLUMN "micros" JSONB;
ALTER TABLE "Food" ADD COLUMN "upc" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Food_upc_key" ON "Food"("upc");

-- CreateIndex
CREATE INDEX "Food_name_idx" ON "Food"("name");

-- CreateIndex
CREATE INDEX "Food_source_idx" ON "Food"("source");

