// Stage T — apply the curated taste-tier prior (prisma/seed/tasteSeed.json).
// Idempotent: only fills a NULL tasteTier, so re-running is a no-op and user/LLM
// tiers are never clobbered. Additive — the deterministic solver ignores these
// columns, so BRAIN=off output is unchanged.
//   node scripts/seedTasteTiers.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/prisma.js");

const seed = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "prisma", "seed", "tasteSeed.json"), "utf8"));
let tagged = 0;
for (const [source, tier] of Object.entries(seed.bySource || {})) {
  const r = await prisma.recipe.updateMany({ where: { source, tasteTier: null }, data: { tasteTier: tier, tasteTierSource: "curated" } });
  console.log(`bySource ${source} -> ${tier}: ${r.count}`);
  tagged += r.count;
}
for (const [name, tier] of Object.entries(seed.byName || {})) {
  const r = await prisma.recipe.updateMany({ where: { name, tasteTier: null }, data: { tasteTier: tier, tasteTierSource: "curated" } });
  tagged += r.count;
}
console.log(`tagged ${tagged} recipes`);
await prisma.$disconnect();
