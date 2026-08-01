// W1-5 E/F12 — recipes that can never serve any slot the solver builds, at 0.5-2x.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const { NON_MEAL_CATEGORIES } = require("../../../backend/src/lib/recipeClassification.js");
const prisma = new PrismaClient();

const LO = 0.5, HI = 2.0;
const practicalGrams = (raw) => { if (!(raw > 0)) return 0; if (raw >= 20) return Math.round(raw / 5) * 5; return Math.max(1, Math.round(raw)); };

const main = async () => {
  const recipes = await prisma.recipe.findMany({
    select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, slotType: true, mealCategory: true, source: true,
      ingredients: { select: { baseGrams: true, scalable: true, role: true, food: { select: { name: true, kcal: true, protein: true, fat: true, carb: true } } } } },
  });
  const T = JSON.parse(fs.readFileSync("fleet/out/W1-5/targets.json", "utf8")).personas;

  // ── the slot kcal targets the solver actually builds, over the 250 personas ──
  const slotTargets = [];
  const personas = fs.readFileSync("docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl", "utf8").trim().split("\n").map(JSON.parse);
  const byId = new Map(T.map((t) => [t.id, t]));
  for (const p of personas) {
    const t = byId.get(p.id); if (!t) continue;
    const meals = p.profile.mealsPerDay, snacks = p.profile.snacksPerDay;
    const ws = [];
    for (let i = 0; i < meals; i++) ws.push({ type: "meal", w: meals === 1 ? 1 : i === meals - 1 ? 1.15 : i === 0 ? 0.9 : 1 });
    for (let i = 0; i < snacks; i++) ws.push({ type: "snack", w: 0.4 });
    const tot = ws.reduce((s, x) => s + x.w, 0);
    for (const w of ws) slotTargets.push({ type: w.type, kcal: t.targetKcal * (w.w / tot) });
  }
  const mealT = slotTargets.filter((s) => s.type === "meal").map((s) => s.kcal);
  const snackT = slotTargets.filter((s) => s.type === "snack").map((s) => s.kcal);
  const range = (a) => ({ min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1), n: a.length });

  // ── achievable kcal range per recipe under the real two-factor scaling ──
  const rows = [];
  for (const r of recipes) {
    const ings = r.ingredients || [];
    const at = (ps, ss) => ings.reduce((s, i) => {
      const sc = !i.scalable ? 1 : i.role === "protein" ? ps : ss;
      const g = practicalGrams(i.baseGrams * sc);
      return s + (i.food ? (i.food.kcal * g) / 100 : 0);
    }, 0);
    const lo = at(LO, LO), hi = at(HI, HI);
    const gramsAt1 = ings.reduce((s, i) => s + i.baseGrams, 0);
    rows.push({ id: r.id, name: r.name, storedKcal: +r.kcal.toFixed(1), storedGrams: +gramsAt1.toFixed(1),
      minKcal: +lo.toFixed(1), maxKcal: +hi.toFixed(1),
      slotType: r.slotType, mealCategory: r.mealCategory, source: r.source, ingCount: ings.length });
  }

  const mealEligible = (r) => (r.slotType === "meal" || r.slotType === "either") && !NON_MEAL_CATEGORIES.has(r.mealCategory);
  const snackEligible = (r) => r.slotType === "snack" || r.slotType === "either";
  const overlaps = (r, ts) => ts.length && r.minKcal <= Math.max(...ts) && r.maxKcal >= Math.min(...ts);

  const unservableMeal = rows.filter((r) => mealEligible(r) && !overlaps(r, mealT));
  const unservableSnack = rows.filter((r) => snackEligible(r) && !overlaps(r, snackT));
  const unservableAny = rows.filter((r) => {
    const m = mealEligible(r) ? overlaps(r, mealT) : false;
    const s = snackEligible(r) ? overlaps(r, snackT) : false;
    return !m && !s;
  });
  // barred by category on top
  const barred = rows.filter((r) => !mealEligible(r) && !snackEligible(r));

  const out = {
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    recipes: rows.length,
    slotTargetRange: { meal: range(mealT), snack: range(snackT) },
    mealEligible: rows.filter(mealEligible).length,
    snackEligible: rows.filter(snackEligible).length,
    unservableMealEligible: unservableMeal.length,
    unservableSnackEligible: unservableSnack.length,
    unservableInAnySlotType: unservableAny.length,
    barredByCategoryOnly: barred.length,
    totalPlaceableNowhere: new Set([...unservableAny.map((r) => r.id), ...barred.map((r) => r.id)]).size,
    tooBig: unservableMeal.filter((r) => r.minKcal > Math.max(...mealT)).length,
    tooSmall: unservableMeal.filter((r) => r.maxKcal < Math.min(...mealT)).length,
    worstTooBig: unservableMeal.filter((r) => r.minKcal > Math.max(...mealT)).sort((a, b) => b.storedKcal - a.storedKcal).slice(0, 15),
    worstTooSmall: unservableMeal.filter((r) => r.maxKcal < Math.min(...mealT)).sort((a, b) => a.storedKcal - b.storedKcal).slice(0, 15),
    unservableSnackList: unservableSnack,
  };
  fs.writeFileSync("fleet/out/W1-5/f12-unservable.json", JSON.stringify({ ...out, allUnservable: unservableAny }, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
