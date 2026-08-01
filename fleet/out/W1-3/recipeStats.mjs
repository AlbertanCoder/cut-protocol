// W1-3 — dump every Recipe's cached per-serving macros so B5's a-priori
// geometry (fat density of the library vs the day's fat band) and I7's
// "above pool MAX protein density" can be computed without a re-solve.
// Read-only isolated DB copy, BRAIN=off, no network.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

process.env.BRAIN = "off";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const dbPath = path.resolve(REPO, "fleet/scratch/W1-3/dev.db");
if (!fs.existsSync(dbPath)) throw new Error("run adjusterFoods.mjs first (it makes the isolated copy)");
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;

const require_ = createRequire(import.meta.url);
const { prisma } = require_(path.join(REPO, "backend/src/lib/prisma.js"));

const rows = await prisma.recipe.findMany({
  select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, slotType: true, mealCategory: true, source: true },
});
fs.writeFileSync(path.resolve(HERE, "recipe-stats.json"), JSON.stringify({
  dbSha256: sha256(SHARED_DB), n: rows.length, recipes: rows,
}, null, 0));
console.log(`wrote ${rows.length} recipes`);
await prisma.$disconnect();
