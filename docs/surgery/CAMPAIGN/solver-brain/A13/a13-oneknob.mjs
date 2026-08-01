// A13 — how much of the SERVED plate lands on the one-knob degenerate branch.
//
// A9 and A10 both flag it; neither measured it on the real solve path. The
// branch test in weeklyPlanner.js:407 is
//     proteinIngs.length === 0 || Math.abs(det) < 1e-6
// and BOTH operands are functions of the recipe alone -- no target, no slot.
// So the branch is a per-recipe property, and served-slot coverage is an exact
// join of the baseline rig output against a per-recipe classification.
//
//   node a13-oneknob.mjs <baseline.jsonl>

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const DB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A13/dev.db";
process.env.DATABASE_URL = `file:${DB}`;
const require = createRequire(import.meta.url);
const { prisma } = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/prisma.js");

const jsonl = process.argv[2];
const rows = fs.readFileSync(jsonl, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const bundle = (ings) => ings.reduce((s, i) => {
  const f = i.baseGrams / 100;
  s.kcal += i.food.kcal * f; s.protein += i.food.protein * f; return s;
}, { kcal: 0, protein: 0 });

const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
const cls = new Map();
let oneKnobRecipes = 0;
for (const r of recipes) {
  const scalable = r.ingredients.filter((i) => i.scalable);
  const pI = scalable.filter((i) => i.role === "protein");
  const pB = bundle(pI), rB = bundle(scalable.filter((i) => i.role !== "protein"));
  const det = pB.protein * rB.kcal - rB.protein * pB.kcal;
  const one = pI.length === 0 || Math.abs(det) < 1e-6;
  const noProteinRole = pI.length === 0;
  cls.set(r.id, { one, noProteinRole, detDegenerate: one && !noProteinRole, nScalable: scalable.length });
  if (one) oneKnobRecipes++;
}

// ── served slots ──
let served = 0, servedOne = 0, servedNoRole = 0, servedDet = 0, unknown = 0;
// per-day: does the day contain >=1 one-knob slot, and is that day in band?
let dInBandAll = 0, dAll = 0;
const cell = { withOne_in: 0, withOne_out: 0, noOne_in: 0, noOne_out: 0 };
let satServed = 0, satServedOne = 0;

for (const r of rows) {
  if (!r.judged) continue;
  const sat = r.satisfiable !== false;
  let dayHasOne = false;
  for (const s of r.slots || []) {
    if (!s.recipeId) continue;
    const c = cls.get(s.recipeId);
    if (!c) { unknown++; continue; }
    served++;
    if (sat) satServed++;
    if (c.one) {
      servedOne++; dayHasOne = true;
      if (sat) satServedOne++;
      if (c.noProteinRole) servedNoRole++; else servedDet++;
    }
  }
  if (!sat) continue;
  dAll++;
  const inb = !!r.verdict?.inBand;
  if (inb) dInBandAll++;
  if (dayHasOne) { if (inb) cell.withOne_in++; else cell.withOne_out++; }
  else { if (inb) cell.noOne_in++; else cell.noOne_out++; }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");
const out = {
  jsonl: path.basename(jsonl),
  recipesTotal: recipes.length,
  oneKnobRecipes, oneKnobRecipesPct: pct(oneKnobRecipes, recipes.length),
  servedSlots: served, unknownRecipeIds: unknown,
  servedOneKnob: servedOne, servedOneKnobPct: pct(servedOne, served),
  servedOneKnob_noProteinRole: servedNoRole,
  servedOneKnob_detDegenerate: servedDet,
  satisfiableServedSlots: satServed, satisfiableServedOneKnob: satServedOne,
  satisfiableServedOneKnobPct: pct(satServedOne, satServed),
  satisfiableDays: dAll, satisfiableInBand: dInBandAll,
  daysWithAnyOneKnobSlot: cell.withOne_in + cell.withOne_out,
  inBandRate_daysWithOneKnob: pct(cell.withOne_in, cell.withOne_in + cell.withOne_out),
  inBandRate_daysWithoutOneKnob: pct(cell.noOne_in, cell.noOne_in + cell.noOne_out),
  cell,
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(path.dirname(jsonl), "A13-oneknob-coverage.json"), JSON.stringify(out, null, 2));
await prisma.$disconnect();
