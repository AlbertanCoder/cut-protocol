// W1-3 — dump the 10 ADJUSTER_CANDIDATES rows (per-100g macros) so the
// closer's contribution to a slot can be SUBTRACTED, recovering pre-closer
// slot macros for the carry-forward replay (B9 / B8 / I7 / B6).
//
// Read-only: operates on an isolated copy of dev.db, exactly like dayDump.mjs.
// BRAIN=off. No network.
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
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

const dir = path.resolve(REPO, "fleet/scratch", "W1-3");
const dbPath = path.resolve(dir, "dev.db");
if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — resolved to the SHARED dev.db");
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(dbPath)) {
  fs.copyFileSync(SHARED_DB, dbPath);
  for (const ext of ["-wal", "-shm"]) {
    const src = SHARED_DB + ext;
    if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + ext);
  }
}
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;

const require_ = createRequire(import.meta.url);
const { prisma } = require_(path.join(REPO, "backend/src/lib/prisma.js"));

const NAMES = [
  "Olive Oil", "Butter", "Avocado",
  "White rice, cooked", "Potatoes", "Oats",
  "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils",
];

const rows = await prisma.food.findMany({
  where: { name: { in: NAMES } },
  select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true },
});
const out = {
  dbSha256: sha256(SHARED_DB),
  dbCopySha256: sha256(dbPath),
  note: "macros are per 100 g, matching macroCloser.js:145-168 (`use/100` scaling)",
  foods: Object.fromEntries(rows.map((f) => [f.id, f])),
  byName: Object.fromEntries(rows.map((f) => [f.name, f])),
};
fs.writeFileSync(path.resolve(HERE, "adjuster-foods.json"), JSON.stringify(out, null, 2));
console.log(`wrote ${rows.length} adjuster food rows`);
await prisma.$disconnect();
