// D6 — the closer's adjuster path. planContext.loadAdjusters runs THREE gates:
// (a) the hardcoded ADJUSTER_CANDIDATES list, (b) macroTrustIssue, (c) the
// exclusion gate. Which one actually binds?
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const { PrismaClient } = require(path.join(ROOT, "backend/node_modules/@prisma/client"));
const gate = require(path.join(ROOT, "backend/src/lib/exclusionGate.js"));
const { macroTrustIssue } = require(path.join(ROOT, "backend/src/lib/foodValidation.js"));
const prisma = new PrismaClient({
  datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D6/dev-copy.db" } },
});
const CAND = [
  { name: "Olive Oil", role: "fat" }, { name: "Butter", role: "fat" }, { name: "Avocado", role: "fat" },
  { name: "White rice, cooked", role: "carb" }, { name: "Potatoes", role: "carb" }, { name: "Oats", role: "carb" },
  { name: "Chicken breast, cooked, skinless", role: "protein" }, { name: "Greek Yogurt", role: "protein" },
  { name: "Tofu", role: "protein" }, { name: "Lentils", role: "protein" },
];
const rows = await prisma.food.findMany({ where: { name: { in: CAND.map((c) => c.name) } }, select: gate.FOOD_GATE_SELECT });
const byLower = new Map();
for (const f of rows) { const k = f.name.trim().toLowerCase(); if (!byLower.has(k)) byLower.set(k, f); }
console.log("=== STAGE A: does the row EXIST, and is its macro data trusted? ===");
for (const c of CAND) {
  const f = byLower.get(c.name.trim().toLowerCase());
  const issue = f ? macroTrustIssue(f) : null;
  console.log(`${c.role.padEnd(8)} ${c.name.padEnd(34)} ${f ? "found" : "MISSING"}   ${f ? (issue ? "UNTRUSTED: " + JSON.stringify(issue).slice(0, 90) : "trusted") : ""}`);
}
const profiles = await prisma.profile.findMany({ select: { dietaryStyle: true, excludedFoods: true } });
console.log("\n=== STAGE B: across the 259 real profiles, how many adjusters survive? ===");
const hist = new Map(); const roleZero = { fat: 0, carb: 0, protein: 0 }; let allZero = 0;
for (const p of profiles) {
  const kept = [];
  for (const c of CAND) {
    const f = byLower.get(c.name.trim().toLowerCase());
    if (!f) continue;
    if (macroTrustIssue(f)) continue;
    if (gate.isExcluded(f, p)) continue;
    kept.push(c.role);
  }
  hist.set(kept.length, (hist.get(kept.length) || 0) + 1);
  for (const r of ["fat", "carb", "protein"]) if (!kept.includes(r)) roleZero[r]++;
  if (!kept.length) allZero++;
}
for (const k of [...hist.keys()].sort((a, b) => a - b)) console.log(`  ${k} adjusters available: ${hist.get(k)} profiles`);
console.log(`\nprofiles with NO fat adjuster:     ${roleZero.fat}/${profiles.length}`);
console.log(`profiles with NO carb adjuster:    ${roleZero.carb}/${profiles.length}`);
console.log(`profiles with NO protein adjuster: ${roleZero.protein}/${profiles.length}`);
console.log(`profiles with NO adjusters at all: ${allZero}/${profiles.length}`);
console.log("\n=== STAGE C: which candidate is lost most often, and to what? ===");
for (const c of CAND) {
  const f = byLower.get(c.name.trim().toLowerCase());
  if (!f) { console.log(`${c.name.padEnd(34)} MISSING FROM DB — lost for 100% of profiles`); continue; }
  if (macroTrustIssue(f)) { console.log(`${c.name.padEnd(34)} UNTRUSTED MACROS — lost for 100% of profiles`); continue; }
  let lost = 0; const reasons = new Map();
  for (const p of profiles) {
    const v = gate.explainFoodExclusion(f, p);
    if (v.excluded) { lost++; reasons.set(v.reason, (reasons.get(v.reason) || 0) + 1); }
  }
  console.log(`${c.name.padEnd(34)} excluded for ${String(lost).padStart(3)}/${profiles.length} profiles  ${JSON.stringify([...reasons])}`);
}
await prisma.$disconnect();
