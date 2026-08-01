// D2/D2-hook.cjs — READ-ONLY instrumentation of weeklyPlanner.js's slot loop.
//
// Same mechanism as A18/a18-hook.cjs: intercept CommonJS compilation, apply
// exact string substitutions to the source TEXT in memory, compile that.
// backend/src is NEVER opened for write. Fails loud (exit 3) if any anchor is
// not present exactly once, so a silently-unpatched run cannot be mistaken for
// a measurement.
//
// The injected calls only READ locals and push to an in-process buffer. They
// change no control flow and no value. `D2_ASSERT_NOOP=1` additionally proves
// that by running with the collector disabled.

const Module = require("node:module");
const fs = require("node:fs");

// ── the collector ──────────────────────────────────────────────────────────
const REC = [];
let cur = null;
let attempt = -1;
let windowSeq = -1;
let winnerByWindow = new Map();
let dayPreTotals = null;
let dayCloseRec = [];
let daySeq = -1;

const D2 = {
  slotBegin(o) {
    if (o.pos === 0) daySeq++;
    cur = {
      persona: globalThis.__D2_PERSONA ?? null,
      windowSeq, attempt, daySeq,
      ...o,
    };
  },
  slotMeta(o) { if (cur) Object.assign(cur, o); },
  slotExit(tag, o) { if (cur && !cur.exit) { cur.exit = tag; Object.assign(cur, o); } },
  slotEnd(result) {
    if (!cur) return;
    cur.gotKcal = result.kcal; cur.gotProtein = result.protein;
    cur.gotFat = result.fat; cur.gotCarb = result.carb;
    cur.gotPS = result.proteinScale; cur.gotSS = result.sidesScale;
    cur.filled = result.recipeId != null;
    cur.warned = !!result.warning;
    REC.push(cur);
    cur = null;
  },
  dayPre(results, dailyTarget, meta) {
    const t = results.reduce((a, s) => ({
      kcal: a.kcal + (s?.kcal || 0), protein: a.protein + (s?.protein || 0),
      fat: a.fat + (s?.fat || 0), carb: a.carb + (s?.carb || 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
    dayPreTotals = { persona: globalThis.__D2_PERSONA ?? null, windowSeq, attempt, daySeq, pre: t, meta,
      dt: { kcal: dailyTarget.kcal, pLo: dailyTarget.proteinLo, pHi: dailyTarget.proteinHi,
            fLo: dailyTarget.fatLo, fHi: dailyTarget.fatHi, cLo: dailyTarget.carbLo, cHi: dailyTarget.carbHi,
            carbMid: dailyTarget.carbMid ?? null, keto: !!dailyTarget.keto } };
  },
  dayPost(slots) {
    if (!dayPreTotals) return;
    const t = slots.reduce((a, s) => ({
      kcal: a.kcal + (s?.kcal || 0), protein: a.protein + (s?.protein || 0),
      fat: a.fat + (s?.fat || 0), carb: a.carb + (s?.carb || 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
    dayPreTotals.post = t;
    dayCloseRec.push(dayPreTotals);
    dayPreTotals = null;
  },
  attemptBegin(i) { if (i === 0) windowSeq++; attempt = i; },
  attemptEnd() { },
  attemptWin(i) { winnerByWindow.set(windowSeq, i); },
  drain() {
    const slots = REC.map((r) => ({ ...r, won: winnerByWindow.get(r.windowSeq) === r.attempt }));
    const days = dayCloseRec.map((r) => ({ ...r, won: winnerByWindow.get(r.windowSeq) === r.attempt }));
    REC.length = 0; dayCloseRec.length = 0; winnerByWindow = new Map();
    windowSeq = -1; attempt = -1; daySeq = -1;
    return { slots, days };
  },
};

if (process.env.D2_ASSERT_NOOP !== "1") globalThis.__D2 = D2;
globalThis.__D2_DRAIN = () => D2.drain();

// ── the patches ────────────────────────────────────────────────────────────
const G = "globalThis.__D2";
const EDITS = [
  // ---- resolveSlot: search metadata -------------------------------------
  {
    file: "weeklyPlanner.js",
    find: `  const attemptBudget = slotAttemptBudget(recipePool.length);`,
    replace: `  const attemptBudget = slotAttemptBudget(recipePool.length);
  ${G} && ${G}.slotMeta({ attemptBudget, composed, poolLen: recipePool.length, twoPass: !!(priorUsage && priorUsage.size > 0), targetRatio });`,
  },
  // ---- resolveSlot: the five exits ---------------------------------------
  {
    file: "weeklyPlanner.js",
    find: `        if (!passUsage && !composed) return ship(recipe, scaled);`,
    replace: `        if (!passUsage && !composed) { ${G} && ${G}.slotExit("firstfit", { tried: tried.size, fitsN: fits.length, ceilingRejects, kcalOff, proteinShort, comp: null }); return ship(recipe, scaled); }`,
  },
  {
    file: "weeklyPlanner.js",
    find: `        if (!passUsage && comp <= COMPOSITION_GOOD_ENOUGH) return ship(recipe, scaled);`,
    replace: `        if (!passUsage && comp <= COMPOSITION_GOOD_ENOUGH) { ${G} && ${G}.slotExit("goodenough", { tried: tried.size, fitsN: fits.length, ceilingRejects, kcalOff, proteinShort, comp }); return ship(recipe, scaled); }`,
  },
  {
    file: "weeklyPlanner.js",
    find: `      return ship(fits[0].recipe, fits[0].scaled);`,
    replace: `      ${G} && ${G}.slotExit("fitsort", { tried: tried.size, fitsN: fits.length, ceilingRejects, comp: fits[0].comp, worstRatio: fits[0].worstRatio, compBest: Math.min.apply(null, fits.map(function (f) { return f.comp; })), compWorst: Math.max.apply(null, fits.map(function (f) { return f.comp; })) });
      return ship(fits[0].recipe, fits[0].scaled);`,
  },
  {
    file: "weeklyPlanner.js",
    find: `    if (aiResult) return aiResult;`,
    replace: `    if (aiResult) { ${G} && ${G}.slotExit("ai", { tried: tried.size, ceilingRejects }); return aiResult; }`,
  },
  {
    file: "weeklyPlanner.js",
    find: `  if (best) {`,
    replace: `  if (best) {
    ${G} && ${G}.slotExit("closestmiss", { tried: tried.size, ceilingRejects, kcalOff: best.kcalOff, proteinShort: best.proteinShort, worstRatio: best.worstRatio });`,
  },
  {
    file: "weeklyPlanner.js",
    find: `  return unsolvedResult(ceilingRejects > 0`,
    replace: `  ${G} && ${G}.slotExit("unsolved", { tried: tried.size, ceilingRejects });
  return unsolvedResult(ceilingRejects > 0`,
  },
  // ---- solveDay: budget propagation + carry clamp ------------------------
  {
    file: "weeklyPlanner.js",
    find: `    const result = await resolveSlot(effectiveTarget, recipePool, usageCount, prevDayRecipeIds, todayIds, rng, aiCtx, bias, repeatCap, priorUsage);`,
    replace: `    ${G} && ${G}.slotBegin({ pos: i, nOpen: nominal.length, slotType: target.slotType, slotIndex: target.slotIndex, weight: target.weight,
      nomKcal: target.kcalTarget, nomProtein: target.proteinTarget, propKcal: proposedKcal, propProtein: proposedProtein,
      effKcal: effectiveTarget.kcalTarget, effProtein: effectiveTarget.proteinTarget,
      fatShare: target.fatShare == null ? null : target.fatShare, carbShare: target.carbShare == null ? null : target.carbShare,
      fatTarget: effectiveTarget.fatTarget == null ? null : effectiveTarget.fatTarget,
      carbTarget: effectiveTarget.carbTarget == null ? null : effectiveTarget.carbTarget,
      budgetKcal, budgetProtein, budgetFat, budgetCarb, share, remainingWeight,
      achKcal: dayAchievedKcal, achProtein: dayAchievedProtein, achFat: dayAchievedFat, achCarb: dayAchievedCarb });
    const result = await resolveSlot(effectiveTarget, recipePool, usageCount, prevDayRecipeIds, todayIds, rng, aiCtx, bias, repeatCap, priorUsage);
    ${G} && ${G}.slotEnd(result);`,
  },
  {
    file: "weeklyPlanner.js",
    find: `  const closed = closeDayMacros({ slots: results, dailyTarget, adjusters });`,
    replace: `  ${G} && ${G}.dayPre(results, dailyTarget, { lockedKcal, lockedProtein, lockedFat, lockedCarb, budgetKcal, budgetProtein, budgetFat, budgetCarb, nSlots: dayTargets.length, nOpen: openIdx.length });
  const closed = closeDayMacros({ slots: results, dailyTarget, adjusters });
  ${G} && ${G}.dayPost(closed.slots);`,
  },
  // ---- mealSolver: which week attempt won --------------------------------
  {
    file: "mealSolver.js",
    find: `    const slots = await generateWeekPlan(dailyTarget, mealConfig, recipePool, { ...options, aiFallback: undefined });`,
    replace: `    ${G} && ${G}.attemptBegin(i);
    const slots = await generateWeekPlan(dailyTarget, mealConfig, recipePool, { ...options, aiFallback: undefined });
    ${G} && ${G}.attemptEnd();`,
  },
  {
    file: "mealSolver.js",
    find: `    if (better) best = { slots, score };`,
    replace: `    if (better) { best = { slots, score }; ${G} && ${G}.attemptWin(i); }`,
  },
];

// Extra, NON-instrumentation edits (the actual treatments), supplied as JSON in
// D2_EDITS. Same fail-loud contract. Kept separate from the telemetry edits so a
// probe run and the baseline carry identical instrumentation.
if (process.env.D2_EDITS) {
  let extra;
  try { extra = JSON.parse(process.env.D2_EDITS); } catch (e) {
    console.error("[D2-hook] D2_EDITS is not valid JSON: " + e.message); process.exit(3);
  }
  if (!Array.isArray(extra)) { console.error("[D2-hook] D2_EDITS must be an array"); process.exit(3); }
  for (const e of extra) {
    EDITS.push(e);
    console.error(`[D2-hook] TREATMENT  ${e.file}\n[D2-hook]   -  ${e.find}\n[D2-hook]   +  ${e.replace}`);
  }
}

const applied = new Set();
const origJs = Module._extensions[".js"];

Module._extensions[".js"] = function (mod, filename) {
  const norm = filename.replace(/\\/g, "/");
  const mine = EDITS.filter((e) => norm.endsWith("/backend/src/lib/" + e.file));
  if (!mine.length) return origJs(mod, filename);
  let src = fs.readFileSync(filename, "utf8");
  for (const e of mine) {
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error(`[D2-hook] FATAL: anchor occurs ${n} times (need exactly 1) in ${e.file}\n  find: ${e.find}`);
      process.exit(3);
    }
    src = src.split(e.find).join(e.replace);
    applied.add(e.file + "::" + e.find.slice(0, 70));
  }
  console.error(`[D2-hook] instrumented ${norm.split("/").slice(-1)[0]} (${mine.length} anchors)`);
  mod._compile(src, filename);
};

process.on("exit", () => {
  if (applied.size !== EDITS.length) {
    console.error(`[D2-hook] FATAL: ${EDITS.length} anchor(s) requested, ${applied.size} applied — a target module never loaded. RUN INVALID.`);
    process.exitCode = 3;
  }
});
