# Fix 4 [MEDIUM] — same recipe can be served twice in the same day

**File:** `backend/src/lib/weeklyPlanner.js`
**Diagnosed in:** AUDIT.md §3 — "on the stored plan's Saturday, the exact
same recipe ('Black bean & meat stew - feijoada') was served for both meal 1
and meal 2 of the same day (1343 kcal + 1028 kcal)."

Root cause per AUDIT.md: `pickRecipe()` (`weeklyPlanner.js:74-89`) only
discounts recipes in `usedYesterday` (weighted `0.15x`). Nothing tracks or
discounts recipes already picked for slots resolved *earlier today*.

---

## Design reasoning

**Soft discount, not a hard exclude — matching the existing pattern.** The
codebase already solves the analogous "don't repeat yesterday" problem with a
weighted discount inside `pickRecipe()`'s random selection, not a hard
filter. A hard same-day exclude is tempting (it's a stronger guarantee) but
risks a new failure mode this app already works hard to avoid: on a thin
post-dietary-filter pool (a user with several exclusions active, or Fix 2's
new fail-closed ambiguous-ingredient handling shrinking the pool further),
hard-excluding the one already-used recipe for a slot type could turn an
"imperfect but real" slot into a "no eligible candidates" `unsolvedResult()`
where previously at least SOMETHING would have been served. A very strong
discount gets the same practical outcome (the repeat is picked only when
truly nothing better exists) while preserving the existing graceful-
degradation behavior.

**Stronger discount than yesterday's, not the same weight.** Serving the
identical dish twice in one day is a more noticeable, more annoying repeat
than serving it two days in a row — discount same-day usage harder (`0.02`)
than yesterday's (`0.15`, unchanged).

**Where the state comes from.** `generateWeekPlan()` already builds a
`todayIds` Set per day (`weeklyPlanner.js`, inside the day loop) and
populates it as each slot resolves — currently that Set is only used to seed
`prevDayRecipeIds` for the *next* day. The fix is almost entirely "thread the
Set that already exists one call earlier," not new state.

**`regenerateOneSlot()` needs the same treatment**, computed from
`existingSlots` filtered to the target's own `dayOfWeek` (excluding the slot
being regenerated itself) — otherwise swapping a single slot via the UI could
reintroduce a same-day duplicate that `generateWeekPlan()` would have avoided.

---

## Patch — `backend/src/lib/weeklyPlanner.js`

### 1. `pickRecipe()` — accept and weight a same-day-used set

**Before:**
```js
// Weighted random, biased toward recipes whose protein-per-kcal ratio is
// close to the slot's target — good matches need less extreme scaling.
function pickRecipe(candidates, targetRatio, usedYesterday, rng) {
  if (candidates.length === 0) return null;
  const weighted = candidates.map((r) => {
    const ratio = r.kcal > 0 ? r.protein / r.kcal : 0;
    const diff = Math.abs(ratio - targetRatio);
    const yesterdayDiscount = usedYesterday.has(r.id) ? 0.15 : 1;
    return { r, weight: (1 / (diff + 0.015)) * yesterdayDiscount };
  });
  const total = weighted.reduce((s, x) => s + x.weight, 0);
  let roll = rng() * total;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.r;
  }
  return weighted[weighted.length - 1].r;
}
```

**After:**
```js
// Weighted random, biased toward recipes whose protein-per-kcal ratio is
// close to the slot's target — good matches need less extreme scaling.
// usedToday gets a much heavier discount than usedYesterday: repeating the
// identical dish within the SAME day (AUDIT.md §3's "feijoada served for
// both meal 1 and meal 2 Saturday" finding) is a more noticeable, more
// avoidable repeat than a day-to-day one, and should only ever be picked
// when genuinely nothing else in the eligible pool is usable. Soft discount
// rather than a hard exclude on purpose - a thin post-filter pool (heavy
// dietary exclusions, small slotType-specific pool) should still be able to
// fall back to a repeat rather than produce an unsolved slot; see this
// patch's own Risks section.
function pickRecipe(candidates, targetRatio, usedYesterday, usedToday, rng) {
  if (candidates.length === 0) return null;
  const weighted = candidates.map((r) => {
    const ratio = r.kcal > 0 ? r.protein / r.kcal : 0;
    const diff = Math.abs(ratio - targetRatio);
    const discount = usedToday.has(r.id) ? 0.02 : usedYesterday.has(r.id) ? 0.15 : 1;
    return { r, weight: (1 / (diff + 0.015)) * discount };
  });
  const total = weighted.reduce((s, x) => s + x.weight, 0);
  let roll = rng() * total;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.r;
  }
  return weighted[weighted.length - 1].r;
}
```

### 2. `resolveSlot()` — accept and thread `usedToday` through to `pickRecipe()`

**Before:**
```js
async function resolveSlot(target, recipePool, usageCount, usedYesterday, rng, aiFallback = null) {
  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const tried = new Set();
  let best = null;

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    const candidates = eligibleRecipes(recipePool, target.slotType, usageCount).filter((r) => !tried.has(r.id));
    if (candidates.length === 0) break;
    const recipe = pickRecipe(candidates, targetRatio, usedYesterday, rng);
```

**After:**
```js
async function resolveSlot(target, recipePool, usageCount, usedYesterday, usedToday, rng, aiFallback = null) {
  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const tried = new Set();
  let best = null;

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    const candidates = eligibleRecipes(recipePool, target.slotType, usageCount).filter((r) => !tried.has(r.id));
    if (candidates.length === 0) break;
    const recipe = pickRecipe(candidates, targetRatio, usedYesterday, usedToday, rng);
```

*(Everything else inside `resolveSlot()` is unchanged — this only adds the
parameter and passes it through to the one call site inside the function. If
Fix 1's patch is applied to the same file, apply both `resolveSlot()` signature
changes together: `resolveSlot(target, recipePool, usageCount, usedYesterday, usedToday, rng, aiFallback = null)` is the merged signature both patches need.)*

### 3. `generateWeekPlan()` — pass the already-built `todayIds` into `resolveSlot()`

**Before:**
```js
    for (let i = 0; i < todaySlots.length; i++) {
      const target = todaySlots[i];
      // Redistribute what's left of the day's budget across this slot and
      // whatever's still unsolved today, weighted the same way the original
      // fixed shares were - then solve against THAT, not the fixed share.
      const remainingWeight = todaySlots.slice(i).reduce((s, x) => s + x.weight, 0);
      const share = remainingWeight > 0 ? target.weight / remainingWeight : 1;
      const proposedKcal = (dailyTarget.kcal - dayAchievedKcal) * share;
      const proposedProtein = (proteinTargetMid - dayAchievedProtein) * share;
      const effectiveTarget = {
        ...target,
        kcalTarget: clamp(proposedKcal, { min: target.kcalTarget * (1 - CARRY_CAP_PCT), max: target.kcalTarget * (1 + CARRY_CAP_PCT) }),
        proteinTarget: clamp(proposedProtein, { min: target.proteinTarget * (1 - CARRY_CAP_PCT), max: target.proteinTarget * (1 + CARRY_CAP_PCT) }),
      };

      const result = await resolveSlot(effectiveTarget, recipePool, usageCount, prevDayRecipeIds, rng, aiCtx);
      if (result.recipeId) todayIds.add(result.recipeId);
```

**After:**
```js
    for (let i = 0; i < todaySlots.length; i++) {
      const target = todaySlots[i];
      // Redistribute what's left of the day's budget across this slot and
      // whatever's still unsolved today, weighted the same way the original
      // fixed shares were - then solve against THAT, not the fixed share.
      const remainingWeight = todaySlots.slice(i).reduce((s, x) => s + x.weight, 0);
      const share = remainingWeight > 0 ? target.weight / remainingWeight : 1;
      const proposedKcal = (dailyTarget.kcal - dayAchievedKcal) * share;
      const proposedProtein = (proteinTargetMid - dayAchievedProtein) * share;
      const effectiveTarget = {
        ...target,
        kcalTarget: clamp(proposedKcal, { min: target.kcalTarget * (1 - CARRY_CAP_PCT), max: target.kcalTarget * (1 + CARRY_CAP_PCT) }),
        proteinTarget: clamp(proposedProtein, { min: target.proteinTarget * (1 - CARRY_CAP_PCT), max: target.proteinTarget * (1 + CARRY_CAP_PCT) }),
      };

      // todayIds reflects every slot resolved so far THIS day (built up as
      // the loop progresses, below) - passing it into resolveSlot() lets
      // pickRecipe() heavily discount a recipe already served earlier today
      // (AUDIT.md §3's same-day-repeat finding), not just yesterday's picks.
      const result = await resolveSlot(effectiveTarget, recipePool, usageCount, prevDayRecipeIds, todayIds, rng, aiCtx);
      if (result.recipeId) todayIds.add(result.recipeId);
```

### 4. `regenerateOneSlot()` — compute `usedToday` from existing same-day slots

**Before:**
```js
  const usageCount = new Map();
  for (const s of existingSlots) {
    if (s.recipeId && !(s.dayOfWeek === target.dayOfWeek && s.slotType === target.slotType && s.slotIndex === target.slotIndex)) {
      usageCount.set(s.recipeId, (usageCount.get(s.recipeId) || 0) + 1);
    }
  }
  const prevDay = target.dayOfWeek - 1;
  const usedYesterday = new Set(existingSlots.filter((s) => s.dayOfWeek === prevDay && s.recipeId).map((s) => s.recipeId));
  const aiCtx = buildAiFallbackContext({ aiFallback }, recipePool);

  const result = await resolveSlot(targeted, recipePool, usageCount, usedYesterday, rng, aiCtx);
  return toSlotRecord(targeted, result);
```

**After:**
```js
  const usageCount = new Map();
  for (const s of existingSlots) {
    if (s.recipeId && !(s.dayOfWeek === target.dayOfWeek && s.slotType === target.slotType && s.slotIndex === target.slotIndex)) {
      usageCount.set(s.recipeId, (usageCount.get(s.recipeId) || 0) + 1);
    }
  }
  const prevDay = target.dayOfWeek - 1;
  const usedYesterday = new Set(existingSlots.filter((s) => s.dayOfWeek === prevDay && s.recipeId).map((s) => s.recipeId));
  // Same-day slots other than the one being regenerated - so swapping meal 2
  // doesn't reintroduce whatever meal 1 or 3 already served today.
  const usedToday = new Set(
    existingSlots
      .filter((s) => s.dayOfWeek === target.dayOfWeek && s.recipeId && !(s.slotType === target.slotType && s.slotIndex === target.slotIndex))
      .map((s) => s.recipeId)
  );
  const aiCtx = buildAiFallbackContext({ aiFallback }, recipePool);

  const result = await resolveSlot(targeted, recipePool, usageCount, usedYesterday, usedToday, rng, aiCtx);
  return toSlotRecord(targeted, result);
```

---

## Companion test (optional but recommended) — `backend/tests/weeklyPlanner.test.js`

```js
test("generateWeekPlan: does not serve the same recipe twice in one day when a same-slot-type alternative exists (AUDIT.md §3 feijoada finding)", async () => {
  // Two meal slots (meals:2, snacks:0) with THREE eligible "meal" recipes in
  // the pool - if the fix works, pickRecipe()'s 0.02x same-day discount
  // should push slot 2 onto one of the other two rather than repeating
  // whatever slot 1 picked, even though all three recipes have an identical
  // protein ratio (so nothing about ratio-fit alone would explain variety).
  const dailyTarget = { kcal: 2000, proteinLo: 180, proteinHi: 200 };
  const mealConfig = { meals: 2, snacks: 0 };
  const pool = [flexibleRecipe("r1"), flexibleRecipe("r2"), flexibleRecipe("r3")];
  const plan = await generateWeekPlan(dailyTarget, mealConfig, pool, { rng: () => 0.5 });
  const day0 = plan.filter((s) => s.dayOfWeek === 0 && s.recipeId);
  const ids = day0.map((s) => s.recipeId);
  assert.equal(new Set(ids).size, ids.length, `day0's slots (${ids.join(", ")}) should all be distinct recipes when alternatives exist`);
});
```

Note: with `rng: () => 0.5` (a fixed midpoint roll) and three recipes of
identical ratio, the *pre-fix* code would very likely pick the same recipe
for both slots (the weighted roll is deterministic and undiscounted across
slots), which is exactly what makes this a meaningful regression test rather
than a coin-flip assertion — but double-check it actually fails against the
current (pre-patch) code before relying on it, since the exact recipe chosen
by a `0.5` roll across 3 equal-weight candidates depends on `pickRecipe()`'s
iteration order, which this comment hasn't hand-verified against the live
code.

---

## Risks / things to double-check before applying

1. **`0.02` same-day discount is a judgment call**, not derived from
   anything — chosen to be "much stronger than yesterday's `0.15`" without
   being a hard `0` (hard `0` would functionally become a hard exclude for
   any pool where the repeat candidate's ratio-fit weight is otherwise
   dominant, defeating the "soft, graceful degradation" reasoning above).
   Sanity-check against the real pool the same way Fix 1 recommends
   re-running the fresh in-memory probe.
2. **This does not prevent a same-day repeat when it's the ONLY eligible
   candidate left** (e.g. `mealsPerDay: 5` against a 1-recipe post-filter
   pool) — by design, per the "soft discount, not hard exclude" reasoning.
   If the product expectation is actually "never repeat within a day, full
   stop, even if it means an unsolved slot," this needs a different
   (hard-exclude) implementation instead — flag this design choice for the
   product owner to confirm before applying.
3. **Signature changes to `pickRecipe()` and `resolveSlot()` overlap with
   Fix 1's patch to the same functions.** If both are applied, merge the
   signatures rather than applying either patch's "Before" block against a
   file the other has already changed — Fix 1 changes `resolveSlot()`'s
   internal accept-condition body but not its parameter list; this patch
   changes the parameter list but not the accept-condition body, so they
   should compose cleanly, but apply and re-read the merged function once
   before trusting it.
