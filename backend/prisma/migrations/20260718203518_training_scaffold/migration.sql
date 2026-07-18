-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "sessionLengthMin" INTEGER NOT NULL,
    "equipment" JSONB NOT NULL,
    "templateKey" TEXT NOT NULL,
    "generator" TEXT NOT NULL DEFAULT 'v1-templates',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "TrainingWeek_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "focus" TEXT,
    CONSTRAINT "TrainingSession_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "TrainingWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" TEXT NOT NULL,
    "rpe" REAL,
    "restSec" INTEGER,
    "notes" TEXT,
    CONSTRAINT "TrainingExercise_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlan_userId_key" ON "TrainingPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingWeek_planId_weekNumber_key" ON "TrainingWeek"("planId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSession_weekId_dayIndex_key" ON "TrainingSession"("weekId", "dayIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingExercise_sessionId_order_key" ON "TrainingExercise"("sessionId", "order");
