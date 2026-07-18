-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlanSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "slotType" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "recipeId" TEXT,
    "proteinScale" REAL NOT NULL DEFAULT 1,
    "sidesScale" REAL NOT NULL DEFAULT 1,
    "ingredients" JSONB NOT NULL,
    "kcal" REAL NOT NULL DEFAULT 0,
    "protein" REAL NOT NULL DEFAULT 0,
    "fat" REAL NOT NULL DEFAULT 0,
    "carb" REAL NOT NULL DEFAULT 0,
    "warning" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PlanSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlanSlot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlanSlot" ("dayOfWeek", "id", "locked", "planId", "recipeId", "slotIndex", "slotType") SELECT "dayOfWeek", "id", "locked", "planId", "recipeId", "slotIndex", "slotType" FROM "PlanSlot";
DROP TABLE "PlanSlot";
ALTER TABLE "new_PlanSlot" RENAME TO "PlanSlot";
CREATE UNIQUE INDEX "PlanSlot_planId_dayOfWeek_slotType_slotIndex_key" ON "PlanSlot"("planId", "dayOfWeek", "slotType", "slotIndex");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

