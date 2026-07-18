-- Phase 3: profile + TDEE engine.
-- Drops the 4-bucket `job` column in favour of occupationKey (mapped below),
-- adds training detail, rate-of-loss prescription fields, optional stricter
-- floor, unit-aware profile, and per-user BMR-formula exclusions.
-- Hand-edited from `prisma migrate diff` output: the generated INSERT was
-- missing excludedFormulas (NOT NULL, no default -> would fail on existing
-- rows) and the job->occupationKey data mapping.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "heightCm" REAL NOT NULL,
    "bodyFatPct" REAL NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("age", "bodyFatPct", "cuisinePreferences", "dietaryStyle", "excludedFoods", "excludedFormulas", "goalWeightKg", "heightCm", "id", "mealPreferencesNote", "mealsPerDay", "occupationKey", "sessionsPerWeek", "sex", "snacksPerDay", "startDate", "startWeightKg", "targetKcal", "unitPref", "updatedAt", "userId")
SELECT "age", "bodyFatPct", "cuisinePreferences", "dietaryStyle", "excludedFoods", '[]',
       "goalWeightKg", "heightCm", "id", "mealPreferencesNote", "mealsPerDay",
       CASE "job"
         WHEN 'desk' THEN 'desk-office'
         WHEN 'light' THEN 'retail-sales'
         WHEN 'mixed' THEN 'trades-general'
         WHEN 'heavy' THEN 'construction-labourer'
         ELSE 'desk-office'
       END,
       "sessionsPerWeek", "sex", "snacksPerDay", "startDate", "startWeightKg", "targetKcal", "unitPref", "updatedAt", "userId"
FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
