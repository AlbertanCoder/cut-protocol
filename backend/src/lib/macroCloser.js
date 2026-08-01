/**
 * macroCloser.js — close a day's remaining macro gap by ADDING a real component,
 * instead of stretching one dish further than a serving should go.
 *
 * WHY THIS EXISTS
 * The 275-customer campaign (qa-fleet-20260729-2032) measured the solver's actual
 * ceiling. Portion scaling gives it two knobs — proteinScale and sidesScale — against
 * FOUR macro targets that dayTolerance() grades on, and a dish's macro RATIO is fixed
 * no matter how it is scaled. The result, measured over 2,431 shipped slots:
 *
 *     68.3% of slots that MISSED tolerance were pinned at a 0.5x or 2.0x scale bound.
 *
 * The solver had run out of room. Widening those bounds is the obvious move and it is
 * the wrong one — the campaign's own customers rejected exactly what that produces:
 * "625 g chicken with 2 g pine nuts", "13 g of cabbage inside a cabbage stew",
 * "465 g of egg white", "105 g of rosemary". Stretching a dish past a serving does not
 * make it food.
 *
 * So this adds a degree of freedom instead of abusing the one that exists: a small,
 * bounded, honestly-listed component — a spoon of olive oil, a portion of rice, some
 * Greek yogurt. It is how people actually eat, and it is the `anchor + adjusters`
 * shape this codebase already carries in groceryList.js and dietaryFilter.js
 * (adjusterExcludedByStyle) but never wired into the solver.
 *
 * SAFETY — the reason this cannot leak an allergen
 * This module never picks a food. The CALLER passes `adjusters`, already resolved and
 * already filtered through the one exclusion gate every other surface uses, against
 * that profile's diet and walls. An empty list is a no-op. There is no path here that
 * can widen what a customer is allowed to eat.
 *
 * HONESTY
 * An added component is a real ingredient with real grams. It lands in the slot's
 * ingredient list, so it shows on the plan, in the totals, and on the grocery list.
 * Nothing is added invisibly.
 *
 * PURITY
 * No DB, no clock, no randomness — same contract as weeklyPlanner's solver path, so
 * the goldens stay reproducible. With no `adjusters` supplied the day is returned
 * untouched, which is why every existing fixture and golden is byte-identical.
 */
'use strict';

// Hard ceilings per day, in grams. These are "a cook would do this" amounts, not
// whatever arithmetic would close the gap — an adjuster that dwarfs the dish is the
// same defect as a 2x portion bound, reintroduced through the back door.
const MAX_GRAMS = { fat: 25, carb: 160, protein: 180 };
// Below this there is nothing worth adding — a 2 g drizzle is noise on a plate.
const MIN_GRAMS = 4;
// Practical amounts: 5 g steps above 20 g, whole grams below. Mirrors
// weeklyPlanner.practicalGrams so an adjuster reads like something you can measure.
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

/**
 * Would adding `grams` of `food` leave every macro no worse than it is now?
 *
 * "No worse" is the whole rule. An adjuster exists to close ONE gap, and a closer that
 * fixes protein by blowing the calorie ceiling has not helped anybody — it has just
 * moved which line the day fails on, which is precisely the behaviour the campaign
 * caught the solver doing when it chased kcal and let fat run away.
 */
function wouldHarm(totals, dailyTarget, food, grams) {
  const f = grams / 100;
  const after = {
    kcal: totals.kcal + (food.kcal || 0) * f,
    protein: totals.protein + (food.protein || 0) * f,
    fat: totals.fat + (food.fat || 0) * f,
    carb: totals.carb + (food.carb || 0) * f,
  };
  // Calories: never push past the +15% ceiling the day is graded on.
  if (dailyTarget.kcal > 0 && after.kcal > dailyTarget.kcal * 1.15) return true;
  // Fat / carbs: never push a macro further past its ceiling than it already is.
  //
  // This compares the SIZE of the overage, not band membership. The membership test
  // it replaced (`isOver && !wasOver`) read "harm means crossing the line", which
  // silently exempted every macro that had already crossed it — so the one day that
  // most needed the guard was the one day without it. Measured on 639 real days: the
  // closer acted on 106 days whose fat was already over, and worsened fat on 106 of
  // them, up to +16.1 g. "No worse" is the whole rule; already-broken is not a licence.
  //
  // Neutral and improving moves stay permitted (overAfter <= overBefore), so a closer
  // that leaves an out-of-band macro untouched can still fix the macro it came for.
  const check = (lo, hi, before, now) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > 0)) return false;
    const overBefore = bandMiss(before, lo, hi).over;
    const overAfter = bandMiss(now, lo, hi).over;
    return overAfter > overBefore;
  };
  if (check(dailyTarget.fatLo, dailyTarget.fatHi, totals.fat, after.fat)) return true;
  if (check(dailyTarget.carbLo, dailyTarget.carbHi, totals.carb, after.carb)) return true;
  // Keto's carb ceiling has NO upward allowance — a diet law, same as dayTolerance.
  if (dailyTarget.keto && Number.isFinite(dailyTarget.carbHi) && after.carb > dailyTarget.carbHi) return true;
  return false;
}

/**
 * closeDayMacros({ slots, dailyTarget, adjusters }) -> { slots, added: [] }
 *
 * `adjusters`: [{ food, role }] — already diet/allergy-filtered by the caller.
 *   food: { id, name, kcal, protein, fat, carb }
 *   role: "protein" | "carb" | "fat"
 *
 * Returns the same slot array (new objects where changed) plus what was added.
 */
function closeDayMacros({ slots, dailyTarget, adjusters }) {
  const added = [];
  if (!Array.isArray(slots) || !slots.length) return { slots, added };
  if (!Array.isArray(adjusters) || !adjusters.length) return { slots, added };
  if (!dailyTarget || !(dailyTarget.kcal > 0)) return { slots, added };

  // Only ever attach to a real, unlocked, filled slot. An empty slot has no dish for
  // a side to belong to, and a locked slot is the user's explicit choice.
  const out = slots.slice();
  const hosts = [];
  out.forEach((s, i) => {
    if (s.recipeId && !s.locked && Array.isArray(s.ingredients) && s.ingredients.length) hosts.push(i);
  });
  if (!hosts.length) return { slots, added };

  // Adjusters go on DIFFERENT plates. The round cap below is a per-plate limit —
  // "the most a plate can absorb" — but `slots.find` picked one host up front and
  // every round appended to that same object, so the cap could never bind and one
  // plate absorbed the entire day's correction. Measured over the 250-persona
  // fleet: 250/250 days put every adjuster on slot 0, worst case 123 -> 685 kcal
  // (x5.56) and 375 g of added food on a single dish.
  //
  // Least-loaded-first, ties to the earliest slot. On a one-slot day this reduces
  // to the old behaviour exactly, which is the only case where piling up is not a
  // choice.
  const workingBy = new Map();
  const placedBy = new Map();
  const workingAt = (i) => {
    if (!workingBy.has(i)) workingBy.set(i, { ...out[i], ingredients: out[i].ingredients.slice() });
    return workingBy.get(i);
  };
  const nextHost = () => hosts.reduce((best, i) => ((placedBy.get(i) || 0) < (placedBy.get(best) || 0) ? i : best), hosts[0]);

  let totals = totalsOf(out);

  const proteinMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;

  // One pass per macro, largest real gap first. Three additions is the most a DAY
  // takes before a plate stops being the dish it is named after — and they are now
  // spread across plates, so with 3+ eligible slots no dish takes more than one.
  for (let round = 0; round < 3; round++) {
    const gaps = [];
    const pShort = proteinMid > 0 ? Math.max(0, proteinMid - totals.protein) : 0;
    if (pShort > 0) gaps.push({ role: 'protein', need: pShort, rel: pShort / proteinMid });
    const fat = bandMiss(totals.fat, dailyTarget.fatLo, dailyTarget.fatHi);
    if (fat.short > 0 && fat.mid > 0) gaps.push({ role: 'fat', need: fat.short, rel: fat.short / fat.mid });
    const carb = bandMiss(totals.carb, dailyTarget.carbLo, dailyTarget.carbHi);
    if (carb.short > 0 && carb.mid > 0) gaps.push({ role: 'carb', need: carb.short, rel: carb.short / carb.mid });
    if (!gaps.length) break;
    gaps.sort((a, b) => b.rel - a.rel);

    let placed = false;
    for (const gap of gaps) {
      const cands = adjusters.filter((a) => a.role === gap.role && !added.some((x) => x.foodId === a.food.id));
      for (const cand of cands) {
        const per100 = cand.food[gap.role] || 0;
        if (per100 <= 0) continue;
        let grams = (gap.need / per100) * 100;
        grams = Math.min(grams, MAX_GRAMS[gap.role] ?? 100);
        grams = practical(grams);
        if (grams < MIN_GRAMS) continue;
        // Back off rather than harm: try the full amount, then smaller ones.
        let use = 0;
        for (const g of [grams, practical(grams * 0.6), practical(grams * 0.3)]) {
          if (g >= MIN_GRAMS && !wouldHarm(totals, dailyTarget, cand.food, g)) { use = g; break; }
        }
        if (!use) continue;
        const f = use / 100;
        const hostIdx = nextHost();
        const working = workingAt(hostIdx);
        placedBy.set(hostIdx, (placedBy.get(hostIdx) || 0) + 1);
        working.ingredients.push({
          foodId: cand.food.id, name: cand.food.name, role: gap.role, grams: use, adjuster: true,
        });
        working.kcal = (working.kcal || 0) + (cand.food.kcal || 0) * f;
        working.protein = (working.protein || 0) + (cand.food.protein || 0) * f;
        working.fat = (working.fat || 0) + (cand.food.fat || 0) * f;
        working.carb = (working.carb || 0) + (cand.food.carb || 0) * f;
        totals = {
          kcal: totals.kcal + (cand.food.kcal || 0) * f,
          protein: totals.protein + (cand.food.protein || 0) * f,
          fat: totals.fat + (cand.food.fat || 0) * f,
          carb: totals.carb + (cand.food.carb || 0) * f,
        };
        // slotIndex is reported so the caller can re-derive anything it had already
        // written about this slot. A slot's warning is built from the recipe as
        // scaled and frozen ~290 lines upstream; without knowing WHICH slot moved,
        // the caller cannot tell that its own narration has gone stale (E4).
        added.push({ foodId: cand.food.id, name: cand.food.name, grams: use, role: gap.role, slotIndex: hostIdx });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) break;
  }

  if (!added.length) return { slots, added };
  for (const [i, w] of workingBy) out[i] = w;
  return { slots: out, added };
}

module.exports = { closeDayMacros, MAX_GRAMS, MIN_GRAMS };
