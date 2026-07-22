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

-- CreateIndex
CREATE UNIQUE INDEX "Food_fdcId_key" ON "Food"("fdcId");

