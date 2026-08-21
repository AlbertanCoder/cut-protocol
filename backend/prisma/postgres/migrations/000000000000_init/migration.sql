-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "supabaseUserId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lsCustomerId" TEXT,
    "lsSubscriptionId" TEXT,
    "plan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'none',
    "renewsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "usedWinback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "heightCm" DOUBLE PRECISION NOT NULL,
    "bodyFatPct" DOUBLE PRECISION NOT NULL,
    "bodyFatSource" TEXT,
    "occupationKey" TEXT NOT NULL DEFAULT 'desk-office',
    "activityOverride" DOUBLE PRECISION,
    "sessionsPerWeek" INTEGER NOT NULL,
    "trainingStyle" TEXT NOT NULL DEFAULT 'mixed',
    "minutesPerSession" INTEGER NOT NULL DEFAULT 45,
    "startWeightKg" DOUBLE PRECISION NOT NULL,
    "goalWeightKg" DOUBLE PRECISION NOT NULL,
    "startDate" TEXT NOT NULL,
    "unitPref" TEXT NOT NULL DEFAULT 'imperial',
    "rateLbPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weighin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "bodyFatPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Weighin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Food" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fdcId" INTEGER,
    "upc" TEXT,
    "brand" TEXT,
    "kcal" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "carb" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "dataQuality" TEXT,
    "dataQualityFlag" TEXT,
    "micros" JSONB,
    "fdcCategory" TEXT,
    "allergenTags" JSONB,
    "mayContain" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Food_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "slotType" TEXT NOT NULL DEFAULT 'meal',
    "cuisine" TEXT,
    "prepTimeMin" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'curated',
    "mealCategory" TEXT,
    "kcal" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "carb" DOUBLE PRECISION NOT NULL,
    "tasteTier" TEXT,
    "tasteTierSource" TEXT,
    "userRatingAvg" DOUBLE PRECISION,
    "userRatingCount" INTEGER,
    "costPerServing" DOUBLE PRECISION,
    "difficulty" INTEGER,
    "filterProvenance" TEXT,
    "aiFingerprint" TEXT,
    "aiVerifiedAt" TIMESTAMP(3),
    "aiVerifiedBy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "baseGrams" DOUBLE PRECISION NOT NULL,
    "scalable" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" JSONB,
    "diagnosis" JSONB,
    "verdictAt" TIMESTAMP(3),
    "verdictSlotSig" TEXT,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSlot" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "slotType" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "recipeId" TEXT,
    "proteinScale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sidesScale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ingredients" JSONB NOT NULL,
    "kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "protein" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "warning" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlanSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroceryList" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroceryList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "recipeId" TEXT,
    "name" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL,
    "carbG" DOUBLE PRECISION NOT NULL,
    "fatG" DOUBLE PRECISION NOT NULL,
    "slotType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "model" TEXT NOT NULL,
    "phase" TEXT,
    "intent" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedRecipe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "slotType" TEXT NOT NULL,
    "recipeId" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "GeneratedPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainSolveRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intent" TEXT,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainSolveRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLibraryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "sessionLengthMin" INTEGER NOT NULL,
    "equipment" JSONB NOT NULL,
    "templateKey" TEXT NOT NULL,
    "generator" TEXT NOT NULL DEFAULT 'v1-templates',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingWeek" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "TrainingWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "focus" TEXT,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingExercise" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" TEXT NOT NULL,
    "rpe" DOUBLE PRECISION,
    "restSec" INTEGER,
    "notes" TEXT,

    CONSTRAINT "TrainingExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "targets" JSONB NOT NULL,
    "verdict" JSONB NOT NULL,
    "scanLine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionDish" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "slotType" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "dishIndex" INTEGER NOT NULL,
    "recipeId" TEXT,
    "recipeName" TEXT NOT NULL,
    "scales" JSONB NOT NULL,
    "ingredients" JSONB NOT NULL,
    "kcal" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "carb" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PrescriptionDish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_lsSubscriptionId_key" ON "Subscription"("lsSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Weighin_userId_date_key" ON "Weighin"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Food_fdcId_key" ON "Food"("fdcId");

-- CreateIndex
CREATE UNIQUE INDEX "Food_upc_key" ON "Food"("upc");

-- CreateIndex
CREATE INDEX "Food_name_idx" ON "Food"("name");

-- CreateIndex
CREATE INDEX "Food_source_idx" ON "Food"("source");

-- CreateIndex
CREATE INDEX "Food_category_name_idx" ON "Food"("category", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_name_key" ON "Recipe"("name");

-- CreateIndex
CREATE INDEX "Recipe_aiFingerprint_idx" ON "Recipe"("aiFingerprint");

-- CreateIndex
CREATE INDEX "RecipeIngredient_foodId_idx" ON "RecipeIngredient"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_foodId_key" ON "RecipeIngredient"("recipeId", "foodId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_userId_startDate_key" ON "Plan"("userId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSlot_planId_dayOfWeek_slotType_slotIndex_key" ON "PlanSlot"("planId", "dayOfWeek", "slotType", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "GroceryList_planId_key" ON "GroceryList"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_userId_recipeId_key" ON "CartItem"("userId", "recipeId");

-- CreateIndex
CREATE INDEX "RecipeRating_userId_idx" ON "RecipeRating"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeRating_userId_recipeId_key" ON "RecipeRating"("userId", "recipeId");

-- CreateIndex
CREATE INDEX "MealLog_userId_date_idx" ON "MealLog"("userId", "date");

-- CreateIndex
CREATE INDEX "LlmUsage_createdAt_idx" ON "LlmUsage"("createdAt");

-- CreateIndex
CREATE INDEX "LlmUsage_userId_createdAt_idx" ON "LlmUsage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainPreference_userId_key" ON "BrainPreference"("userId");

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

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlan_userId_key" ON "TrainingPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingWeek_planId_weekNumber_key" ON "TrainingWeek"("planId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSession_weekId_dayIndex_key" ON "TrainingSession"("weekId", "dayIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingExercise_sessionId_order_key" ON "TrainingExercise"("sessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionDay_userId_date_key" ON "PrescriptionDay"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionDish_dayId_slotType_slotIndex_dishIndex_key" ON "PrescriptionDish"("dayId", "slotType", "slotIndex", "dishIndex");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weighin" ADD CONSTRAINT "Weighin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlot" ADD CONSTRAINT "PlanSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlot" ADD CONSTRAINT "PlanSlot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroceryList" ADD CONSTRAINT "GroceryList_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealLog" ADD CONSTRAINT "MealLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainPreference" ADD CONSTRAINT "BrainPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainMessage" ADD CONSTRAINT "BrainMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BrainConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPlanItem" ADD CONSTRAINT "GeneratedPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GeneratedPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingWeek" ADD CONSTRAINT "TrainingWeek_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "TrainingWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingExercise" ADD CONSTRAINT "TrainingExercise_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionDish" ADD CONSTRAINT "PrescriptionDish_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "PrescriptionDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

