// A17-preload-v1.cjs — runtime interception of macroCloser.closeDayMacros.
//
// WHY THIS EXISTS, and why it is not a product edit.
// A17's assignment is to A/B the macro closer's GATES: the <=3 addition cap
// (macroCloser.js:128), the single host slot (:116), wouldHarm (:75-97), and a
// symmetric "trimmer" that does not exist. None of those are reachable from the
// rig's treatment contract, which can only patch INPUTS
// ({target,pool,mealConfig,filters,adjusters,solveOpts}). The candidate set IS
// reachable (it is `adjusters`); the other three are not.
//
// BRIEF.md forbids modifying backend/src. So this file changes nothing on disk.
// It is loaded with `node --require` BEFORE runRig.mjs evaluates, requires
// backend/src/lib/macroCloser.js first, and replaces the `closeDayMacros`
// property on that module's exports object. weeklyPlanner.js:32 destructures
// `closeDayMacros` at ITS require time, which happens later, so it binds the
// replacement. The file on disk is read, never written.
//
// INSTRUMENT VALIDATION (do not skip):
//   A17={"mode":"passthrough"}  -> calls the ORIGINAL function, dump only.
//   A17={"mode":"reimpl"}       -> my re-implementation at product defaults.
// Both MUST produce a JSONL byte-identical to a plain baseline run. If the
// second does not, the re-implementation is wrong and every delta below it is
// worthless.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = 'C:/Users/<account>/Desktop/cut-protocol';
const CLOSER = path.resolve(REPO, 'backend/src/lib/macroCloser.js');

const CFG = (() => {
  try { return JSON.parse(process.env.A17 || '{}'); } catch { return {}; }
})();

const MODE = CFG.mode || 'passthrough';
const ROUNDS = Number.isFinite(CFG.rounds) ? CFG.rounds : 3;      // product: 3
const HOST = CFG.host || 'first';                                  // 'first' | 'spread'
const HARM = CFG.harm || 'strict';                                 // 'strict' | 'kcalonly' | 'off'
const MAXG_MULT = Number.isFinite(CFG.maxg) ? CFG.maxg : 1;        // product: 1
const TRIM = !!CFG.trim;                                           // product: absent
const TRIM_MAX = Number.isFinite(CFG.trimMax) ? CFG.trimMax : 3;
const TRIM_FRAC = Number.isFinite(CFG.trimFrac) ? CFG.trimFrac : 0.5; // never remove more than half a component
const DUMP = CFG.dump || null;

// ── verbatim copies of the product constants (macroCloser.js:46-51) ────────
const MAX_GRAMS = { fat: 25, carb: 160, protein: 180 };
const MIN_GRAMS = 4;
const practical = (g) => (g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));

const bandMiss = (v, lo, hi) => {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { short: 0, over: 0, mid };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { short: lo - val, over: 0, mid };
  if (val > hi) return { short: 0, over: val - hi, mid };
  return { short: 0, over: 0, mid };
};

const totalsOf = (slots) => slots.reduce(
  (t, s) => ({ kcal: t.kcal + (s.kcal || 0), protein: t.protein + (s.protein || 0), fat: t.fat + (s.fat || 0), carb: t.carb + (s.carb || 0) }),
  { kcal: 0, protein: 0, fat: 0, carb: 0 }
);

// ── counters: which gate binds? ────────────────────────────────────────────
const K = {
  calls: 0, noSlots: 0, noAdjusters: 0, noTarget: 0, noHost: 0,
  noGap: 0, allCandsHarmful: 0, capReached: 0, fired: 0,
  addsTotal: 0, adds1: 0, adds2: 0, adds3plus: 0,
  roleGapProtein: 0, roleGapFat: 0, roleGapCarb: 0,
  roleNoCandidate: { protein: 0, fat: 0, carb: 0 },
  trimCalls: 0, trimFired: 0, trimAdds: 0,
};

const dumpRows = [];

function wouldHarm(totals, dailyTarget, food, grams, mode) {
  if (mode === 'off') return false;
  const f = grams / 100;
  const after = {
    kcal: totals.kcal + (food.kcal || 0) * f,
    protein: totals.protein + (food.protein || 0) * f,
    fat: totals.fat + (food.fat || 0) * f,
    carb: totals.carb + (food.carb || 0) * f,
  };
  if (dailyTarget.kcal > 0 && after.kcal > dailyTarget.kcal * 1.15) return true;
  if (mode === 'kcalonly') {
    // still honour the keto carb law — it is a diet law, not a tolerance
    if (dailyTarget.keto && Number.isFinite(dailyTarget.carbHi) && after.carb > dailyTarget.carbHi) return true;
    return false;
  }
  const check = (lo, hi, before, now) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > 0)) return false;
    const wasOver = bandMiss(before, lo, hi).over > 0;
    const isOver = bandMiss(now, lo, hi).over > 0;
    return isOver && !wasOver;
  };
  if (check(dailyTarget.fatLo, dailyTarget.fatHi, totals.fat, after.fat)) return true;
  if (check(dailyTarget.carbLo, dailyTarget.carbHi, totals.carb, after.carb)) return true;
  if (dailyTarget.keto && Number.isFinite(dailyTarget.carbHi) && after.carb > dailyTarget.carbHi) return true;
  return false;
}

// ── the ADD phase: product logic, with rounds/host/harm/maxg parameterised ──
function addPhase({ slots, dailyTarget, adjusters }) {
  const added = [];
  if (!Array.isArray(slots) || !slots.length) { K.noSlots++; return { slots, added }; }
  if (!Array.isArray(adjusters) || !adjusters.length) { K.noAdjusters++; return { slots, added }; }
  if (!dailyTarget || !(dailyTarget.kcal > 0)) { K.noTarget++; return { slots, added }; }

  const hostable = slots.filter((s) => s.recipeId && !s.locked && Array.isArray(s.ingredients) && s.ingredients.length);
  if (!hostable.length) { K.noHost++; return { slots, added }; }

  const out = slots.slice();
  // working copies, keyed by index, created lazily
  const workByIdx = new Map();
  const getWork = (n) => {
    const target = HOST === 'spread' ? hostable[n % hostable.length] : hostable[0];
    const idx = out.indexOf(target);
    if (!workByIdx.has(idx)) workByIdx.set(idx, { ...target, ingredients: target.ingredients.slice() });
    return { idx, w: workByIdx.get(idx) };
  };

  let totals = totalsOf(out);
  const proteinMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  let stoppedBy = null;

  for (let round = 0; round < ROUNDS; round++) {
    const gaps = [];
    const pShort = proteinMid > 0 ? Math.max(0, proteinMid - totals.protein) : 0;
    if (pShort > 0) gaps.push({ role: 'protein', need: pShort, rel: pShort / proteinMid });
    const fat = bandMiss(totals.fat, dailyTarget.fatLo, dailyTarget.fatHi);
    if (fat.short > 0 && fat.mid > 0) gaps.push({ role: 'fat', need: fat.short, rel: fat.short / fat.mid });
    const carb = bandMiss(totals.carb, dailyTarget.carbLo, dailyTarget.carbHi);
    if (carb.short > 0 && carb.mid > 0) gaps.push({ role: 'carb', need: carb.short, rel: carb.short / carb.mid });
    if (!gaps.length) { stoppedBy = stoppedBy || 'noGap'; break; }
    if (round === 0) for (const g of gaps) K[`roleGap${g.role[0].toUpperCase()}${g.role.slice(1)}`]++;
    gaps.sort((a, b) => b.rel - a.rel);

    let placed = false;
    for (const gap of gaps) {
      const cands = adjusters.filter((a) => a.role === gap.role && !added.some((x) => x.foodId === a.food.id));
      if (!cands.length && round === 0) K.roleNoCandidate[gap.role]++;
      for (const cand of cands) {
        const per100 = cand.food[gap.role] || 0;
        if (per100 <= 0) continue;
        let grams = (gap.need / per100) * 100;
        grams = Math.min(grams, (MAX_GRAMS[gap.role] ?? 100) * MAXG_MULT);
        grams = practical(grams);
        if (grams < MIN_GRAMS) continue;
        let use = 0;
        for (const g of [grams, practical(grams * 0.6), practical(grams * 0.3)]) {
          if (g >= MIN_GRAMS && !wouldHarm(totals, dailyTarget, cand.food, g, HARM)) { use = g; break; }
        }
        if (!use) continue;
        const f = use / 100;
        const { idx, w } = getWork(added.length);
        w.ingredients.push({ foodId: cand.food.id, name: cand.food.name, role: gap.role, grams: use, adjuster: true });
        w.kcal = (w.kcal || 0) + (cand.food.kcal || 0) * f;
        w.protein = (w.protein || 0) + (cand.food.protein || 0) * f;
        w.fat = (w.fat || 0) + (cand.food.fat || 0) * f;
        w.carb = (w.carb || 0) + (cand.food.carb || 0) * f;
        out[idx] = w;
        totals = {
          kcal: totals.kcal + (cand.food.kcal || 0) * f,
          protein: totals.protein + (cand.food.protein || 0) * f,
          fat: totals.fat + (cand.food.fat || 0) * f,
          carb: totals.carb + (cand.food.carb || 0) * f,
        };
        added.push({ foodId: cand.food.id, name: cand.food.name, grams: use, role: gap.role });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) { stoppedBy = stoppedBy || 'allCandsHarmful'; break; }
    if (round === ROUNDS - 1) stoppedBy = stoppedBy || 'cap';
  }

  if (stoppedBy === 'noGap') K.noGap++;
  else if (stoppedBy === 'allCandsHarmful') K.allCandsHarmful++;
  else if (stoppedBy === 'cap') K.capReached++;

  if (!added.length) return { slots, added };
  return { slots: out, added };
}

// ── the TRIM phase: the symmetric mechanism A9/C9 says does not exist ──────
// Reduces (never removes a whole dish) up to TRIM_MAX ingredients when the day
// is OVER a ceiling. Mirror image of wouldHarm: never push a macro that is
// currently inside its band BELOW it, and never break the kcal floor.
function trimPhase({ slots, dailyTarget, foodById }) {
  const removed = [];
  if (!foodById || !Array.isArray(slots) || !slots.length) return { slots, removed };
  K.trimCalls++;
  const out = slots.slice();
  const workByIdx = new Map();
  let totals = totalsOf(out);

  const fatMid = (dailyTarget.fatLo + dailyTarget.fatHi) / 2;
  const carbMid = (dailyTarget.carbLo + dailyTarget.carbHi) / 2;
  const TOL = 0.25;

  // How far past each ceiling is the day? (matching dayTolerance's rules)
  const excess = () => {
    const e = [];
    if (dailyTarget.kcal > 0) {
      const over = totals.kcal - dailyTarget.kcal * 1.15;
      if (over > 0) e.push({ macro: 'kcal', need: over, rel: over / dailyTarget.kcal });
    }
    if (Number.isFinite(dailyTarget.fatHi) && fatMid > 0) {
      const over = totals.fat - (dailyTarget.fatHi + TOL * fatMid);
      if (over > 0) e.push({ macro: 'fat', need: over, rel: over / fatMid });
    }
    if (Number.isFinite(dailyTarget.carbHi) && carbMid > 0) {
      const ceil = dailyTarget.keto ? dailyTarget.carbHi : dailyTarget.carbHi + TOL * carbMid;
      const over = totals.carb - ceil;
      if (over > 0) e.push({ macro: 'carb', need: over, rel: over / carbMid });
    }
    return e.sort((a, b) => b.rel - a.rel);
  };

  const wouldHarmDown = (after) => {
    if (dailyTarget.kcal > 0 && after.kcal < dailyTarget.kcal * 0.85) return true;
    const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
    if (pMid > 0 && totals.protein >= pMid * 0.85 && after.protein < pMid * 0.85) return true;
    const belowNow = (v, lo, mid) => Number.isFinite(lo) && mid > 0 && v < lo - TOL * mid;
    if (!belowNow(totals.fat, dailyTarget.fatLo, fatMid) && belowNow(after.fat, dailyTarget.fatLo, fatMid)) return true;
    if (!belowNow(totals.carb, dailyTarget.carbLo, carbMid) && belowNow(after.carb, dailyTarget.carbLo, carbMid)) return true;
    return false;
  };

  for (let round = 0; round < TRIM_MAX; round++) {
    const ex = excess();
    if (!ex.length) break;
    const worst = ex[0];
    let best = null;
    for (let si = 0; si < out.length; si++) {
      const s = out[si];
      if (!s.recipeId || s.locked || !Array.isArray(s.ingredients)) continue;
      const ings = workByIdx.has(si) ? workByIdx.get(si).ingredients : s.ingredients;
      for (let ii = 0; ii < ings.length; ii++) {
        const ing = ings[ii];
        if (removed.some((r) => r.si === si && r.ii === ii)) continue;
        const food = foodById.get(ing.foodId);
        if (!food) continue;
        const per100 = worst.macro === 'kcal' ? food.kcal : food[worst.macro];
        if (!(per100 > 0)) continue;
        // grams to remove: enough to clear the excess, capped at half the component
        let g = (worst.need / per100) * 100;
        g = Math.min(g, ing.grams * TRIM_FRAC);
        const keep = practical(Math.max(0, ing.grams - g));
        const cut = ing.grams - keep;
        if (cut < MIN_GRAMS) continue;
        const f = cut / 100;
        const after = {
          kcal: totals.kcal - food.kcal * f, protein: totals.protein - food.protein * f,
          fat: totals.fat - food.fat * f, carb: totals.carb - food.carb * f,
        };
        if (wouldHarmDown(after)) continue;
        const gain = (worst.macro === 'kcal' ? food.kcal : food[worst.macro]) * f;
        if (!best || gain > best.gain) best = { si, ii, cut, keep, food, after, gain };
      }
    }
    if (!best) break;
    if (!workByIdx.has(best.si)) workByIdx.set(best.si, { ...out[best.si], ingredients: out[best.si].ingredients.slice() });
    const w = workByIdx.get(best.si);
    const f = best.cut / 100;
    w.ingredients[best.ii] = { ...w.ingredients[best.ii], grams: best.keep, trimmed: true };
    w.kcal = (w.kcal || 0) - best.food.kcal * f;
    w.protein = (w.protein || 0) - best.food.protein * f;
    w.fat = (w.fat || 0) - best.food.fat * f;
    w.carb = (w.carb || 0) - best.food.carb * f;
    out[best.si] = w;
    totals = best.after;
    removed.push({ si: best.si, ii: best.ii, foodId: w.ingredients[best.ii].foodId, name: w.ingredients[best.ii].name, cut: best.cut, keep: best.keep });
  }
  if (removed.length) { K.trimFired++; K.trimAdds += removed.length; }
  return { slots: removed.length ? out : slots, removed };
}

// ── install ────────────────────────────────────────────────────────────────
const mod = require(CLOSER);
const ORIGINAL = mod.closeDayMacros;

mod.closeDayMacros = function closeDayMacrosA17(args) {
  K.calls++;
  const g = globalThis.__A17 || {};
  let res;
  if (MODE === 'passthrough') {
    res = ORIGINAL(args);
    if (res.added && res.added.length) { K.fired++; K.addsTotal += res.added.length; }
  } else {
    res = addPhase(args);
    if (res.added.length) { K.fired++; K.addsTotal += res.added.length; }
    if (TRIM) {
      const t = trimPhase({ slots: res.slots, dailyTarget: args.dailyTarget, foodById: g.foodById });
      res = { slots: t.slots, added: res.added, removed: t.removed };
    }
  }
  if (res.added) {
    if (res.added.length === 1) K.adds1++;
    else if (res.added.length === 2) K.adds2++;
    else if (res.added.length >= 3) K.adds3plus++;
  }
  if (DUMP) {
    const dt = args.dailyTarget || {};
    dumpRows.push(JSON.stringify({
      c: g.customer || null,
      t: { kcal: dt.kcal, pLo: dt.proteinLo, pHi: dt.proteinHi, fLo: dt.fatLo, fHi: dt.fatHi, cLo: dt.carbLo, cHi: dt.carbHi, keto: !!dt.keto },
      nAdj: (args.adjusters || []).length,
      adj: (args.adjusters || []).map((a) => `${a.role}:${a.food.name}`),
      added: res.added || [],
      removed: res.removed || [],
      slots: (res.slots || []).map((s) => ({
        r: s.recipeId || null, ps: s.proteinScale ?? null, ss: s.sidesScale ?? null,
        locked: !!s.locked,
        k: s.kcal ?? null, p: s.protein ?? null,
        ings: (s.ingredients || []).map((i) => [i.foodId, i.grams, i.adjuster ? 1 : 0]),
      })),
    }));
  }
  return res;
};

process.on('exit', () => {
  try {
    const tag = process.env.A17_TAG || 'run';
    fs.writeFileSync(path.resolve(REPO, `docs/surgery/CAMPAIGN/solver-brain/A17/A17-gatecount-${tag}.json`),
      JSON.stringify({ tag, cfg: CFG, counters: K }, null, 2));
    if (DUMP && dumpRows.length) fs.writeFileSync(DUMP, dumpRows.join('\n') + '\n');
  } catch (e) { console.error('[A17 preload] flush failed:', e.message); }
});

console.error(`[A17 preload] installed  mode=${MODE} rounds=${ROUNDS} host=${HOST} harm=${HARM} maxg=${MAXG_MULT} trim=${TRIM ? TRIM_MAX : 0}`);
