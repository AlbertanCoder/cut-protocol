-- CreateTable
CREATE TABLE "PrescriptionDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "targets" JSONB NOT NULL,
    "verdict" JSONB NOT NULL,
    "scanLine" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PrescriptionDish" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayId" TEXT NOT NULL,
    "slotType" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "dishIndex" INTEGER NOT NULL,
    "recipeId" TEXT,
    "recipeName" TEXT NOT NULL,
    "scales" JSONB NOT NULL,
    "ingredients" JSONB NOT NULL,
    "kcal" REAL NOT NULL,
    "protein" REAL NOT NULL,
    "fat" REAL NOT NULL,
    "carb" REAL NOT NULL,
    "fiber" REAL NOT NULL,
    CONSTRAINT "PrescriptionDish_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "PrescriptionDay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionDay_userId_date_key" ON "PrescriptionDay"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionDish_dayId_slotType_slotIndex_dishIndex_key" ON "PrescriptionDish"("dayId", "slotType", "slotIndex", "dishIndex");

