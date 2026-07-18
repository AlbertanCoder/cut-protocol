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
    "job" TEXT NOT NULL,
    "sessionsPerWeek" INTEGER NOT NULL,
    "startWeightKg" REAL NOT NULL,
    "goalWeightKg" REAL NOT NULL,
    "startDate" TEXT NOT NULL,
    "unitPref" TEXT NOT NULL DEFAULT 'imperial',
    "targetKcal" INTEGER NOT NULL,
    "mealsPerDay" INTEGER NOT NULL DEFAULT 3,
    "snacksPerDay" INTEGER NOT NULL DEFAULT 1,
    "excludedFoods" JSONB NOT NULL DEFAULT [],
    "dietaryStyle" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("age", "bodyFatPct", "goalWeightKg", "heightCm", "id", "job", "mealsPerDay", "sessionsPerWeek", "sex", "snacksPerDay", "startDate", "startWeightKg", "targetKcal", "unitPref", "updatedAt", "userId") SELECT "age", "bodyFatPct", "goalWeightKg", "heightCm", "id", "job", "mealsPerDay", "sessionsPerWeek", "sex", "snacksPerDay", "startDate", "startWeightKg", "targetKcal", "unitPref", "updatedAt", "userId" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
