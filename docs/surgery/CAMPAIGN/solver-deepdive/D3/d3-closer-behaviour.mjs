// D3 part 3 — behavioural proof of macroCloser.js. Pure module, no DB.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { closeDayMacros, MAX_GRAMS, MIN_GRAMS } = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/macroCloser.js");
const out = []; const P = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };

const F = {
  oliveOil: { id: "oil", name: "Olive Oil", kcal: 900, protein: 0, fat: 100, carb: 0 },
  rice: { id: "rice", name: "White rice, cooked", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 },
  chicken: { id: "chk", name: "Chicken breast, cooked, skinless", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  yogurt: { id: "yog", name: "Greek Yogurt", kcal: 59, protein: 10.3, fat: 0.39, carb: 3.6 },
};
const ADJ = [
  { role: "fat", food: F.oliveOil }, { role: "carb", food: F.rice },
  { role: "protein", food: F.chicken }, { role: "protein", food: F.yogurt },
];
const totals = (s) => s.reduce((t, x) => ({ kcal: t.kcal + x.kcal, protein: t.protein + x.protein, fat: t.fat + x.fat, carb: t.carb + x.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
const show = (label, t) => P(`    ${label.padEnd(9)} kcal=${t.kcal.toFixed(0).padStart(5)} P=${t.protein.toFixed(1).padStart(6)} F=${t.fat.toFixed(1).padStart(6)} C=${t.carb.toFixed(1).padStart(6)}`);
const slot = (o) => ({ recipeId: "r1", locked: false, ingredients: [{ foodId: "x", name: "base", grams: 200 }], warning: null, ...o });

function run(name, slots, target, adjusters = ADJ) {
  P(`\n── ${name}`);
  const before = totals(slots);
  const r = closeDayMacros({ slots, dailyTarget: target, adjusters });
  const after = totals(r.slots);
  show("before", before); show("after", after);
  P(`    added: ${r.added.length ? r.added.map((a) => `${a.grams}g ${a.name} [${a.role}]`).join(" + ") : "(nothing)"}`);
  P(`    delta: kcal=${(after.kcal - before.kcal).toFixed(0)} P=${(after.protein - before.protein).toFixed(1)} F=${(after.fat - before.fat).toFixed(1)} C=${(after.carb - before.carb).toFixed(1)}`);
  return { before, after, r };
}

const T = { kcal: 2000, proteinLo: 140, proteinHi: 170, fatLo: 55, fatHi: 70, carbLo: 180, carbHi: 210 };

P("=== CONSTANTS ==="); P(`MAX_GRAMS=${JSON.stringify(MAX_GRAMS)} MIN_GRAMS=${MIN_GRAMS}`);

P("\n=== 1. CAN THE CLOSER EVER REDUCE A MACRO? (fuzz: 4000 random days) ===");
let reduced = 0, changedSlots = 0, cases = 0, maxAdds = 0;
let rngState = 12345;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
for (let i = 0; i < 4000; i++) {
  const n = 2 + Math.floor(rnd() * 3);
  const slots = Array.from({ length: n }, () => slot({
    kcal: rnd() * 900, protein: rnd() * 60, fat: rnd() * 45, carb: rnd() * 90,
  }));
  const tgt = { kcal: 1200 + rnd() * 1800, proteinLo: 80 + rnd() * 80, proteinHi: 0, fatLo: 30 + rnd() * 40, fatHi: 0, carbLo: 100 + rnd() * 150, carbHi: 0 };
  tgt.proteinHi = tgt.proteinLo + 30; tgt.fatHi = tgt.fatLo + 15; tgt.carbHi = tgt.carbLo + 30;
  const b = totals(slots);
  const res = closeDayMacros({ slots, dailyTarget: tgt, adjusters: ADJ });
  const a = totals(res.slots);
  cases++;
  maxAdds = Math.max(maxAdds, res.added.length);
  if (res.added.length) changedSlots++;
  for (const k of ["kcal", "protein", "fat", "carb"]) if (a[k] < b[k] - 1e-9) reduced++;
  // slot COUNT and non-host slots must be untouched
  if (res.slots.length !== slots.length) P("    !! slot count changed");
}
P(`  ran ${cases} random days; days where something was added: ${changedSlots}; max additions on any day: ${maxAdds}`);
P(`  macro-reduction events across all four macros: ${reduced}   <-- 0 means add-only holds empirically`);

P("\n=== 2. THE DOMINANT FAILURE MODE: DAY OVER BAND ===");
run("2a. fat OVER band, everything else fine", [
  slot({ kcal: 2000, protein: 155, fat: 95, carb: 195 }),
  slot({ kcal: 0, protein: 0, fat: 0, carb: 0, recipeId: "r2" }),
], T);
run("2b. kcal 25% OVER target", [slot({ kcal: 2500, protein: 120, fat: 90, carb: 250 })], T);
run("2c. carb OVER band", [slot({ kcal: 2000, protein: 155, fat: 62, carb: 300 })], T);

P("\n=== 3. CAN THE CLOSER PUSH AN ALREADY-OVER MACRO FURTHER OVER? ===");
P("  wouldHarm()'s check() returns `isOver && !wasOver` (macroCloser.js:90) — a macro");
P("  ALREADY outside its band is not protected. Test: protein short, fat already over.");
const r3 = run("3a. protein short 40 g, fat already 25 g over its band", [
  slot({ kcal: 1500, protein: 110, fat: 95, carb: 195 }),
], T);
P(`    fat before=${r3.before.fat.toFixed(1)}  after=${r3.after.fat.toFixed(1)}  -> ${r3.after.fat > r3.before.fat ? "FAT PUSHED FURTHER OVER" : "fat unchanged"}`);

P("\n=== 4. THE HOST SLOT — where do the adjusters land? ===");
const hostSlots = [
  slot({ kcal: 300, protein: 15, fat: 8, carb: 40, recipeId: "breakfast" }),
  slot({ kcal: 500, protein: 30, fat: 15, carb: 50, recipeId: "lunch" }),
  slot({ kcal: 400, protein: 25, fat: 12, carb: 40, recipeId: "dinner" }),
];
const r4 = closeDayMacros({ slots: hostSlots, dailyTarget: T, adjusters: ADJ });
r4.slots.forEach((s, i) => P(`    slot ${i} (${s.recipeId}): kcal=${s.kcal.toFixed(0)} ingredients=${s.ingredients.length} adjusters=${s.ingredients.filter((x) => x.adjuster).map((x) => `${x.grams}g ${x.name}`).join(", ") || "-"}`));

P("\n=== 5. STALE SLOT WARNING (honesty ordering) ===");
const warned = [slot({ kcal: 900, protein: 40, fat: 20, carb: 80, recipeId: "d1", warning: "Tried 20 recipe(s) for this slot, none fit within tolerance — closest was \"X\" (landed 900 kcal vs a 1200 target)." })];
const r5 = closeDayMacros({ slots: warned, dailyTarget: T, adjusters: ADJ });
P(`    slot kcal BEFORE closer: 900`);
P(`    slot kcal AFTER  closer: ${r5.slots[0].kcal.toFixed(0)}`);
P(`    slot.warning AFTER closer: ${JSON.stringify(r5.slots[0].warning)}`);
P(`    -> the warning still names 900 kcal. It is carried verbatim by the {...host} spread (macroCloser.js:121) and never recomputed.`);

P("\n=== 6. LOCKED / EMPTY SLOT HANDLING ===");
const r6a = closeDayMacros({ slots: [slot({ kcal: 800, protein: 40, fat: 20, carb: 60, locked: true })], dailyTarget: T, adjusters: ADJ });
P(`    all-locked day -> added ${r6a.added.length} (expect 0)`);
const r6b = closeDayMacros({ slots: [{ recipeId: null, locked: false, ingredients: [], kcal: 0, protein: 0, fat: 0, carb: 0 }], dailyTarget: T, adjusters: ADJ });
P(`    all-empty day  -> added ${r6b.added.length} (expect 0)`);
const r6c = closeDayMacros({ slots: [slot({ kcal: 800, protein: 40, fat: 20, carb: 60 })], dailyTarget: T, adjusters: [] });
P(`    no adjusters   -> added ${r6c.added.length} (expect 0, and slots array identity preserved: ${r6c.slots.length === 1})`);

P("\n=== 7. KETO CARB CEILING ===");
const KT = { kcal: 1800, proteinLo: 130, proteinHi: 160, fatLo: 110, fatHi: 130, carbLo: 0, carbHi: 30, keto: true };
run("7a. keto day, protein short — does the closer respect the carb ceiling?", [slot({ kcal: 1500, protein: 90, fat: 115, carb: 28 })], KT, ADJ);

P("\n=== 8. GRAM CEILING vs A REAL GAP — how big a protein gap can chicken close? ===");
for (const shortG of [10, 20, 40, 60, 80]) {
  const s = [slot({ kcal: 1400, protein: 155 - shortG, fat: 60, carb: 195 })];
  const res = closeDayMacros({ slots: s, dailyTarget: T, adjusters: ADJ });
  const gained = totals(res.slots).protein - (155 - shortG);
  P(`    gap ${String(shortG).padStart(2)} g -> added ${res.added.map((a) => `${a.grams}g ${a.name}`).join(" + ") || "(nothing)"} -> +${gained.toFixed(1)} g protein (${gained >= shortG * 0.95 ? "CLOSED" : "STILL SHORT"})`);
}

require("node:fs").writeFileSync("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3-closer-behaviour.out.txt", out.join("\n"));
