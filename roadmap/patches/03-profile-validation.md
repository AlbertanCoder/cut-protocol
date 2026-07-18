# Fix 3 [MAJOR] — no server-side validation on `PUT /api/profile`

**File:** `backend/src/routes/profile.js`
**Crash site (unchanged by this patch, see Risks):** `backend/src/lib/weeklyPlanner.js:241`
**Diagnosed in:** AUDIT.md §6 — full repro and traceback:

```
PUT /api/profile {"mealsPerDay":0,"snacksPerDay":0}   -> 200 OK
POST /api/plans/generate                               -> 500
    {"error":"Cannot read properties of undefined (reading 'length')"}
```

Root cause per AUDIT.md: `buildSlots()` returns `[]` for `meals:0, snacks:0`,
so `byDay` (a `Map`) never gets an entry for any day, and
`generateWeekPlan()`'s `byDay.get(day).length` (line 241 at the time of the
audit) dereferences `.length` on `undefined`.

---

## Design reasoning

**Why `mealsPerDay >= 1` is the load-bearing rule.** `buildSlots()`
(`weeklyPlanner.js:41-53`) always pushes `mealConfig.meals` meal slots before
`mealConfig.snacks` snack slots for a given day. As long as `meals >= 1`,
every day gets at least one slot and `byDay.get(day)` is always defined. So
the single validation rule that actually prevents the crash is `mealsPerDay
>= 1`; `snacksPerDay >= 0` (snacks are allowed to be zero — a day with meals
only is a completely normal, already-supported configuration) is validated
alongside it mostly for basic sanity/type-safety, not because `0` snacks
crashes anything.

**Upper bounds are a product judgment call, not a crash-prevention
requirement.** Nothing crashes at `mealsPerDay: 50`, but a day with 50 meal
slots is nonsense the solver would grind through pointlessly (350 slots/week,
each one running the full `MAX_SLOT_ATTEMPTS` retry loop against the pool) and
no real UI flow could produce. Picked `8` as a generous sanity ceiling for
both fields — flag this for review; it's arbitrary and should be whatever the
product owner considers a plausible upper bound for a real eating pattern
(this app's own fixture user, `CLAUDE.md` §7, uses "3 feedings" — 8 is
already 2.5x that).

**Where the fix goes.** `PUT /api/profile/target` (`routes/profile.js:33-39`)
already validates its one field and returns `400` on failure — that's the
established pattern in this exact file. `PUT /api/profile` (`routes/profile.js:20-31`)
is the only route touching `mealsPerDay`/`snacksPerDay` with zero validation.
Adding a small validator function ahead of the existing patch-building loop,
following the same `400 + {error}` response shape already used two routes
below it, is the minimal, in-pattern fix.

---

## Patch — `backend/src/routes/profile.js`

**Before:**
```js
const PROFILE_FIELDS = [
  "sex", "age", "heightCm", "bodyFatPct", "job", "sessionsPerWeek",
  "startWeightKg", "goalWeightKg", "startDate", "unitPref", "targetKcal",
  "mealsPerDay", "snacksPerDay", "excludedFoods", "dietaryStyle",
  "cuisinePreferences", "mealPreferencesNote",
];

router.get("/", async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  res.json(profile);
});

router.put("/", async (req, res) => {
  const patch = {};
  for (const key of PROFILE_FIELDS) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  const profile = await prisma.profile.upsert({
    where: { userId: req.userId },
    update: patch,
    create: { userId: req.userId, ...defaultProfile(), ...patch },
  });
  res.json(profile);
});
```

**After:**
```js
const PROFILE_FIELDS = [
  "sex", "age", "heightCm", "bodyFatPct", "job", "sessionsPerWeek",
  "startWeightKg", "goalWeightKg", "startDate", "unitPref", "targetKcal",
  "mealsPerDay", "snacksPerDay", "excludedFoods", "dietaryStyle",
  "cuisinePreferences", "mealPreferencesNote",
];

// mealsPerDay/snacksPerDay flow straight into weeklyPlanner.js's
// buildSlots(), which always emits `meals` slots before `snacks` slots for
// every day. As long as mealsPerDay >= 1, every day has at least one slot
// and generateWeekPlan()'s byDay.get(day) is always defined - that's the
// one rule that actually prevents the crash AUDIT.md §6 reproduced
// (mealsPerDay:0 -> buildSlots() returns [] -> byDay never populated ->
// "Cannot read properties of undefined (reading 'length')"). Upper bounds
// (8) are a sanity ceiling, not a crash-prevention requirement - flag for
// product review, arbitrary pick (this app's own fixture user eats 3
// feedings/day per CLAUDE.md §7; 8 is a generous multiple of that).
function validateProfilePatch(body) {
  const errors = [];
  if (body.mealsPerDay !== undefined) {
    if (!Number.isInteger(body.mealsPerDay) || body.mealsPerDay < 1 || body.mealsPerDay > 8) {
      errors.push("mealsPerDay must be a whole number between 1 and 8");
    }
  }
  if (body.snacksPerDay !== undefined) {
    if (!Number.isInteger(body.snacksPerDay) || body.snacksPerDay < 0 || body.snacksPerDay > 8) {
      errors.push("snacksPerDay must be a whole number between 0 and 8");
    }
  }
  return errors;
}

router.get("/", async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  res.json(profile);
});

router.put("/", async (req, res) => {
  const errors = validateProfilePatch(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const patch = {};
  for (const key of PROFILE_FIELDS) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  const profile = await prisma.profile.upsert({
    where: { userId: req.userId },
    update: patch,
    create: { userId: req.userId, ...defaultProfile(), ...patch },
  });
  res.json(profile);
});
```

---

## Optional secondary hardening (flagged, not part of the primary patch)

AUDIT.md's own root-cause classification calls this "(e) missing error
handling," and the task scoping for this fix is specifically the
`routes/profile.js` validation gap — the primary patch above is that, and
it's sufficient to close the reported crash (a validated `PUT /api/profile`
can no longer produce `mealsPerDay:0`/`snacksPerDay:0` for any profile going
through the API). Two things are deliberately **not** included in the
primary patch and are flagged for the reviewer's judgment instead:

1. **Defense-in-depth inside `weeklyPlanner.js` itself.** `generateWeekPlan()`'s
   `byDay.get(day)` (around line 277 as currently read) could be hardened to
   `byDay.get(day) || []` as a one-line, low-risk belt-and-suspenders change,
   so the function never crashes on a malformed `mealConfig` regardless of
   which caller produced it (not just the one route this patch fixes — e.g.
   a future direct script/import that bypasses the route entirely). This
   file is one of the ones under active concurrent editing per this task's
   instructions, so it's called out here rather than bundled as a forced
   change — apply at the same time as this patch if convenient, or as its
   own tiny follow-up.
2. **Existing profiles that already have `mealsPerDay:0`/`snacksPerDay:0`
   stored** (if AUDIT.md's repro against the live account wasn't fully
   reverted, or if any other path ever wrote one) will still crash plan
   generation until they're corrected — this patch only stops *new* bad
   writes via this one route, it doesn't backfill/repair existing data. Not
   a concern for the audited account specifically (AUDIT.md §6 confirms it
   was restored to `mealsPerDay: 4, snacksPerDay: 1` immediately after the
   repro), but worth a quick `SELECT` check on whatever the current real
   data looks like before considering this fully closed.

---

## Risks / things to double-check before applying

1. **The `8` upper bound is a guess, not a requirement** — confirm with the
   product owner before shipping, or drop the upper bound entirely and only
   enforce the lower bound (`mealsPerDay >= 1`) if there's no appetite for an
   arbitrary product ceiling.
2. **No test file update included.** There's no existing `profile.test.js`
   in this repo to extend (only `dietaryFilter.test.js`, `groceryList.test.js`,
   `recipeGeneration.test.js`, `weeklyPlanner.test.js` exist under
   `backend/tests/`) — adding a new `profile.test.js` would require spinning
   up the Express route + Prisma test fixture pattern this repo doesn't
   currently have an established convention for (the other test files all
   test pure `lib/` functions directly, not routes). Recommend a manual
   `curl`/Postman repro of the AUDIT.md §6 sequence post-patch (expect `400`
   instead of a `200` that later 500s) rather than inventing a new
   route-testing pattern as a side effect of this fix — flag as a gap for
   whoever applies this to decide whether it's worth the added test
   infrastructure.
