-- CreateTable
CREATE TABLE "BrainConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BrainMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrainMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BrainConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedRecipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GeneratedPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GeneratedPlanItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "slotType" TEXT NOT NULL,
    "recipeId" TEXT,
    "data" JSONB NOT NULL,
    CONSTRAINT "GeneratedPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GeneratedPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrainSolveRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "intent" TEXT,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserLibraryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BrainConversation_userId_idx" ON "BrainConversation"("userId");

-- CreateIndex
CREATE INDEX "BrainMessage_conversationId_idx" ON "BrainMessage"("conversationId");

-- CreateIndex
CREATE INDEX "GeneratedRecipe_userId_idx" ON "GeneratedRecipe"("userId");

-- CreateIndex
CREATE INDEX "GeneratedPlan_userId_idx" ON "GeneratedPlan"("userId");

-- CreateIndex
CREATE INDEX "GeneratedPlanItem_planId_idx" ON "GeneratedPlanItem"("planId");

-- CreateIndex
CREATE INDEX "BrainSolveRun_userId_idx" ON "BrainSolveRun"("userId");

-- CreateIndex
CREATE INDEX "UserLibraryEntry_userId_idx" ON "UserLibraryEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserLibraryEntry_userId_recipeId_key" ON "UserLibraryEntry"("userId", "recipeId");
