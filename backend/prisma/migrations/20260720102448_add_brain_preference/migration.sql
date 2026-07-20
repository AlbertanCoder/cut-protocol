-- CreateTable
CREATE TABLE "BrainPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrainPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrainPreference_userId_key" ON "BrainPreference"("userId");
