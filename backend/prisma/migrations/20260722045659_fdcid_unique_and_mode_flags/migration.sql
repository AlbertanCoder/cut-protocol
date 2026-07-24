-- AlterTable
ALTER TABLE "Weighin" ADD COLUMN "bodyFatPct" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "heightCm" REAL NOT NULL,
    "bodyFatPct" REAL NOT NULL,
    "bodyFatSource" TEXT,
    "occupationKey" TEXT NOT NULL DEFAULT 'desk-office',
    "activityOverride" REAL,
    "sessionsPerWeek" INTEGER NOT NULL,
    "trainingStyle" TEXT NOT NULL DEFAULT 'mixed',
    "minutesPerSession" INTEGER NOT NULL DEFAULT 45,
    "startWeightKg" REAL NOT NULL,
    "goalWeightKg" REAL NOT NULL,
    "startDate" TEXT NOT NULL,
    "unitPref" TEXT NOT NULL DEFAULT 'imperial',
    "rateLbPerWeek" REAL NOT NULL DEFAULT 1.0,
    "rateAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "floorKcal" INTEGER,
    "excludedFormulas" JSONB NOT NULL,
    "targetKcal" INTEGER NOT NULL,
    "mealsPerDay" INTEGER NOT NULL DEFAULT 3,
    "snacksPerDay" INTEGER NOT NULL DEFAULT 1,
    "excludedFoods" JSONB NOT NULL,
    "dietaryStyle" TEXT,
    "cuisinePreferences" JSONB NOT NULL,
    "mealPreferencesNote" TEXT,
    "maxPrepMin" INTEGER,
    "budgetTier" TEXT,
    "allowBatch" BOOLEAN,
    "maxComplexity" INTEGER,
    "adaptiveTdee" BOOLEAN NOT NULL DEFAULT true,
    "proteinPriorityMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("activityOverride", "age", "allowBatch", "bodyFatPct", "bodyFatSource", "budgetTier", "cuisinePreferences", "dietaryStyle", "excludedFoods", "excludedFormulas", "floorKcal", "goalWeightKg", "heightCm", "id", "maxComplexity", "maxPrepMin", "mealPreferencesNote", "mealsPerDay", "minutesPerSession", "occupationKey", "rateAcknowledged", "rateLbPerWeek", "sessionsPerWeek", "sex", "snacksPerDay", "startDate", "startWeightKg", "targetKcal", "trainingStyle", "unitPref", "updatedAt", "userId") SELECT "activityOverride", "age", "allowBatch", "bodyFatPct", "bodyFatSource", "budgetTier", "cuisinePreferences", "dietaryStyle", "excludedFoods", "excludedFormulas", "floorKcal", "goalWeightKg", "heightCm", "id", "maxComplexity", "maxPrepMin", "mealPreferencesNote", "mealsPerDay", "minutesPerSession", "occupationKey", "rateAcknowledged", "rateLbPerWeek", "sessionsPerWeek", "sex", "snacksPerDay", "startDate", "startWeightKg", "targetKcal", "trainingStyle", "unitPref", "updatedAt", "userId" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Dedupe BEFORE the unique index, or this migration cannot apply to real data.
--
-- Generated as index-only, which passed on the dev machine because that database
-- happened to carry no duplicates. Every other database did: the shipped
-- template had 140 duplicate fdcId groups and an installed 1.0.0 app had 194
-- (409 excess rows). There the index threw `UNIQUE constraint failed:
-- Food.fdcId`, the migration rolled back, the runner stopped, and server.js
-- answered EVERY /api request with "Database schema update failed" — the app was
-- bricked by opening it. Four independent audit agents reproduced this.
--
-- Nulling is deliberate where deleting is not: duplicate rows are referenced by
-- RecipeIngredient, so removing them would cascade into real recipes. fdcId is
-- already nullable (606 rows legitimately carry none), so keeping the lowest
-- rowid per group and clearing the rest preserves every Food row and every
-- recipe link, and only drops a redundant USDA id that re-import can restore.
UPDATE "Food" SET "fdcId" = NULL
WHERE "fdcId" IS NOT NULL
  AND rowid NOT IN (SELECT MIN(rowid) FROM "Food" WHERE "fdcId" IS NOT NULL GROUP BY "fdcId");

-- CreateIndex
CREATE UNIQUE INDEX "Food_fdcId_key" ON "Food"("fdcId");

