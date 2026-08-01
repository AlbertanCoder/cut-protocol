// E-V6 — VERIFIER's OWN derivation of the two load-bearing M6 findings.
// Written from scratch by the verifier; it shares no code with the surgeon's
// scratchpad probes. $0: the ONLY model-calling step is stubbed, and the stub
// fails the check if it is ever reached in part A.
//
//   A. THE SWALLOW — does mealRouter's free library scan preempt generation?
//   B. THE BLIND SPOT — can the brain pass see a day that misses tolerance
//      while every slot is filled and unwarned?
process.env.BRAIN = "on";

const ROOT = "C:/Users/<account>/Desktop/cut-protocol/backend";
const { prisma } = require(ROOT + "/src/lib/prisma.js");
const { planContext } = require(ROOT + "/src/lib/planContext.js");
const { routeMealSlot } = require(ROOT + "/src/lib/mealRouter.js");
const { fillGapsWithBrain } = require(ROOT + "/src/lib/weeklyPlanner.js");

const EMAIL = "surgery.witness@example.com";

(async () => {
  // ─────────────────────────── A. THE SWALLOW ───────────────────────────
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) { console.log("A: SKIPPED — witness user absent"); }
  else {
    const { profile, recipePool } = await planContext(user.id);
    console.log("A. THE SWALLOW");
    console.log("   pool size handed to the router :", recipePool.length);

    let generationReached = 0;
    const res = await routeMealSlot(
      {
        target: { slotType: "meal", kcalTarget: 1116, proteinTarget: 87, dayOfWeek: 0, slotIndex: 0 },
        profile, recipePool, existingRecipeNames: [], timeoutMs: 35000,
      },
      {
        generateDraftsImpl: async () => {
          generationReached++;
          throw new Error("VERIFIER: generation was reached — the library did NOT preempt it");
        },
      }
    );

    console.log("   generation rung reached        :", generationReached, "(0 = library preempted it)");
    console.log("   status / via / ok / modelCalls :", res.status, "/", res.via, "/", res.ok, "/", res.modelCalls);
    console.log("   attempts (model tries)         :", JSON.stringify(res.attempts));
    if (res.recipe) {
      console.log("   recipe                         :", JSON.stringify({ name: res.recipe.name, source: res.recipe.source }));
      console.log("   scaled kcal / protein          :", res.scaled && res.scaled.kcal, "/", res.scaled && res.scaled.protein);
      console.log("   target was                     : 1116 kcal / 87 g protein");
    }
  }

  // ────────────────────────── B. THE BLIND SPOT ──────────────────────────
  // Every slot FILLED, every slot UNWARNED — but the day is far outside its
  // macro bands. If the pass is day-blind, it attempts nothing at all.
  console.log("");
  console.log("B. THE BLIND SPOT");
  const DAILY = { kcal: 2000, proteinLo: 150, proteinHi: 180, fatLo: 56, fatHi: 66, carbLo: 263, carbHi: 287 };
  const CONFIG = { meals: 2, snacks: 0 };
  const filledButWrong = [
    { dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: "r1", kcal: 1000, protein: 90, fat: 78, carb: 50, warning: null },
    { dayOfWeek: 0, slotType: "meal", slotIndex: 1, recipeId: "r2", kcal: 1000, protein: 90, fat: 77, carb: 52, warning: null },
  ];
  const dayFat = filledButWrong.reduce((a, s) => a + s.fat, 0);
  const dayCarb = filledButWrong.reduce((a, s) => a + s.carb, 0);

  let routerCalls = 0;
  const out = await fillGapsWithBrain(filledButWrong, {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [],
    aiFallback: {
      enabled: true, maxCalls: 5, profile: { dietaryStyle: null },
      budgetMs: 75000, slotTimeoutMs: 35000, now: () => Date.now(),
      routeMealSlotImpl: async () => { routerCalls++; return { ok: false, recipe: null }; },
    },
  });

  console.log("   day fat  :", dayFat, "g  vs band", DAILY.fatLo + "-" + DAILY.fatHi, "->", (dayFat > DAILY.fatHi ? "OUT OF TOLERANCE" : "ok"));
  console.log("   day carb :", dayCarb, "g  vs band", DAILY.carbLo + "-" + DAILY.carbHi, "->", (dayCarb < DAILY.carbLo ? "OUT OF TOLERANCE" : "ok"));
  console.log("   empty slots / warned slots     :", filledButWrong.filter((s) => !s.recipeId).length, "/", filledButWrong.filter((s) => s.warning).length);
  console.log("   pass attempted                 :", out.attempted);
  console.log("   router calls made              :", routerCalls);
  console.log("   -> if attempted === 0 while the day is out of tolerance,");
  console.log("      the brain pass is structurally day-blind.");

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("SWALLOW CHECK ERROR:", e && e.stack ? e.stack : e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
