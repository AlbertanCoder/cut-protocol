// Doc 2 Stage 1 — build the clean DISTRIBUTION template database. Copies dev.db,
// then deletes EVERY personal row (all 22 user-data tables), keeping only the
// shared library (Food, Recipe, RecipeIngredient — incl. the 889-recipe library
// + taste tiers). The shipped installer copies THIS on first run; the new user
// registers their own local account. Zero personal rows, zero real accounts.
//   node scripts/buildTemplateDb.mjs [outPath]   (default prisma/dev.db.template)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);

const BACKEND = path.resolve(import.meta.dirname, ".."); // scripts/ -> backend/
const SRC = path.join(BACKEND, "prisma", "dev.db");
const OUT = path.resolve(process.argv[2] || path.join(BACKEND, "prisma", "dev.db.template"));
if (!fs.existsSync(SRC)) { console.error(`no source DB at ${SRC}`); process.exit(1); }
fs.copyFileSync(SRC, OUT);

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: "file:" + OUT.replace(/\\/g, "/") } } });

// Children before parents (belt-and-suspenders; we also disable FK enforcement).
const PERSONAL = [
  "BrainMessage", "BrainConversation", "BrainPreference", "BrainSolveRun",
  "GeneratedPlanItem", "GeneratedPlan", "GeneratedRecipe", "UserLibraryEntry",
  "RecipeRating", "LlmUsage", "MealLog", "CartItem", "GroceryList",
  "PlanSlot", "Plan", "Weighin", "Profile",
  "TrainingExercise", "TrainingSession", "TrainingWeek", "TrainingPlan",
  "User",
];
const KEEP = new Set(["Food", "Recipe", "RecipeIngredient"]);

// Sanity: make sure we account for every table (fail if a new personal table
// appeared and wasn't classified — never silently ship it).
const all = (await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'")).map((r) => r.name);
const unclassified = all.filter((t) => !KEEP.has(t) && !PERSONAL.includes(t));
if (unclassified.length) { console.error(`UNCLASSIFIED table(s) — refusing to ship: ${unclassified.join(", ")}`); await prisma.$disconnect(); process.exit(1); }

await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
await prisma.$executeRawUnsafe('UPDATE "Recipe" SET "createdByUserId" = NULL'); // detach library from any user
for (const t of PERSONAL) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
await prisma.$executeRawUnsafe("VACUUM");

const count = async (t) => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "${t}"`))[0].c);
const [users, profiles, weighins, plans, foods, recipes] = await Promise.all(["User", "Profile", "Weighin", "Plan", "Food", "Recipe"].map(count));
await prisma.$disconnect();

console.log(`template built: ${OUT}`);
console.log(`  PERSONAL (must all be 0): users ${users}, profiles ${profiles}, weighins ${weighins}, plans ${plans}`);
console.log(`  LIBRARY (kept): foods ${foods}, recipes ${recipes}`);
if (users || profiles || weighins || plans) { console.error("FAIL: personal rows remain in the template"); process.exit(1); }
