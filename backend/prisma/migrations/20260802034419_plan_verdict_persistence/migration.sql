-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "diagnosis" JSONB;
ALTER TABLE "Plan" ADD COLUMN "verdict" JSONB;
ALTER TABLE "Plan" ADD COLUMN "verdictAt" DATETIME;
ALTER TABLE "Plan" ADD COLUMN "verdictSlotSig" TEXT;

