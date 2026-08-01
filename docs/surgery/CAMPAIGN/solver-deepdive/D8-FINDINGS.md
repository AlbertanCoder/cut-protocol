# D8 — the API/route layer and what the user actually SEES

Territory: `backend/src/routes/plans.js`, `cart.js`, `recipes.js`, and the frontend
that renders solver output (`PlanTab.jsx`, `TodayTab.jsx`).

Read against the **WORKING TREE** (branch `fix/audit-remediation`, HEAD `f414f8b`,
with uncommitted modifications to `plans.js`, `weeklyPlanner.js`, `mealSolver.js`,
`planContext.js` and the untracked `macroCloser.js`).

Every claim is labelled `MEASURED` (I ran it), `DERIVED` (arithmetic/logic on
something measured or read), or `INFERRED` (judgement).

Measurement harness: `docs/surgery/CAMPAIGN/solver-deepdive/D8/measure-honesty.mjs`
and `measure-ordering.mjs`. Both run against a **copy** of `dev.db` in the session
scratchpad; nothing under `backend/src/`, `frontend/src/` or `backend/prisma/` was
modified. Sample: 40 profiles × 6 seeds × 3 attempts = **234 weeks / 1,638 days /
7,602 slots** over the real 910-recipe library.

**Verification shape.** Per the brief's warning, day tolerance in both scripts is
**recomputed locally** from the published thresholds (`mealSolver.js:210-213`) —
`dayTolerance()`, `dayInTolerance()`, `dayMissLine()` and `diagnose()` are never
called to decide whether a day missed. Honesty is judged by reading the actual
response payload and the actual JSX, not by trusting a function named `diagnose`.

---

## 0. Headline

The constitution says: *"Solver declares 'unsolvable + why' — silent target misses
are forbidden."*

**On the generate response, the contract holds. After that, it decays to nothing.**

| Surface | Honest? | Why |
|---|---|---|
| `POST /plans/generate` response body | **YES** | `meta.diagnosis`, `meta.days[].miss`, `meta.matchPct` all forwarded |
| `PlanTab` immediately after generate | **YES** | `SolverNarration` renders all of it, amber, correct copy |
| `PlanTab` after a reload / tab switch | **PARTIAL** | only the per-slot `warning` column survives; it is a 2-macro gate |
| `TodayTab`, ever | **NO** | never renders `slot.warning`; only flags kcal **over**, never under; fat under-floor is untinted by design |
| After a swap / accept-day / place-recipe | **NO, and actively misleading** | narration card goes stale, still describing the pre-edit week |

- **28.0%** of solved days land out of band (458 / 1,638). `MEASURED`
- **30.6%** of those out-of-band days carry **no slot warning at all** (140 / 458) —
  after a reload they are fully silent. `MEASURED`
- **66.6%** of out-of-band days are out of band while kcal *and* protein are both
  fine (305 / 458). The per-slot gate is kcal+protein only, so on those days it
  **structurally cannot fire**. The 318 days that do warn largely warn for an
  unrelated reason. `MEASURED` / `DERIVED`

The dominant failure axis is **fat over its band** (324 of 458 out-of-band days),
then carbs over (162). Both are invisible to the current slot gate. `MEASURED`

---

## 1. Endpoint map — validation / recompute / return

All routes are behind `requireAuth` (`plans.js:16`).
`PLAN_INCLUDE` (`plans.js:18`) = `{ slots: { include: { recipe } }, groceryList }`.

| # | Endpoint | Validates | Recomputes server-side | Returns | Honesty payload |
|---|---|---|---|---|---|
| 1 | `GET /current` (`:114`) | owner via unique key | nothing | raw Plan row + slots | **only `slot.warning`** |
| 2 | `GET /horizons` (`:126`) | — | — | preset catalogue | n/a |
| 3 | `POST /generate` (`:203`) | `resolveHorizon` 400s on junk (`:205`) | **everything** — full solve | plan + **`meta`** | **full**: `matchPct`, `score`, `days[]`, `diagnosis`, `poolCounts`, `variety`, per-week rollup |
| 4 | `POST /day-options` (`:442`) | `dayOfWeek` 0-6 else defaults 0 (`:447`) | full day solve ×N | candidates + `diagnosis` | **full** per candidate: `inTolerance`, `miss`, `hasWarnings` |
| 5 | `POST /accept-day` (`:480`) | `dayOfWeek` 0-6, non-empty slots; `rebuildSlotFromClient` | macros, names, grams band, pool membership | plan | **`warning` taken from the client** (see §7) |
| 6 | `PUT /:planId/slots/:slotId` (`:526`) | `locked` boolean, ownership | nothing | single slot | none |
| 7 | `POST /…/alternates` (`:536`) | ownership, 404 slot, **409 if locked** (`:542`), slot in current meal config | 3 alternates solved | `alternates[]` with `matchPct` | **`matchPct` is kcal+protein only** (`mealSolver.js:1417-1427`) |
| 8 | `PUT /…/apply` (`:564`) | ownership, 409 if locked (`:570`), `rebuildSlotFromClient` | macros, grams band, pool membership | **the one slot only** | **`warning` from the client; no day re-validation** |
| 9 | `POST /place-recipe` (`:589`) | dayOfWeek, scale 0.5-2 (`:596`), pool membership (`:600`), 409 locked (`:610`) | ingredients + totals from base grams | plan | **hardcoded `warning: null` (`:625`)** |
| 10 | `POST /fill-today-from-cart` (`:637`) | non-empty cart, ≥1 compliant recipe (422) | `scaleRecipe` per slot | plan + `note` | **kcal-only warning at 15% (`:670-672`)** |
| 11 | `POST /…/swap` (legacy, `:700`) | ownership, 409 locked | `regenerateOneSlot` | single slot | slot `warning` only |
| 12-14 | grocery list (`:737`, `:768`, `:776`) | ownership | list build | list | n/a |

`cart.js` is clean: no macro targets, and it **re-decides** diet/allergy compliance
at list time rather than trusting the add (`cart.js:76-83`). `recipes.js` does not
touch day targets.

**The asymmetry that matters:** every write path recomputes *macros* server-side
and refuses to trust the client (`rebuildSlotFromClient:67-112` is genuinely
strict — pool membership, ingredient ownership, a 0.5x-2x grams band, clamped
scales). **`warning` is the single field exempted from that discipline.**

---

## 2. The dropped-diagnosis bug — FIXED, verify closed

**The standing note is STALE. The diagnosis is forwarded today.** `MEASURED`

- `plans.js:412` — `diagnosis: result.diagnosis` inside the `meta` object.
- `plans.js:401` — `matchPct: result.score.avgMatch`
- `plans.js:409` — `days: result.score.days` (per-day `miss` lines)
- `plans.js:434` — `res.json({ ...written.get(weekStarts[0]), meta })`

`git diff backend/src/routes/plans.js` shows the working tree differs from HEAD by
**3 added lines only**, all of them the `adjusters` pass-through (`:206`, `:327-328`).
The diagnosis forwarding is present in **both** HEAD and the working tree. Nothing
dies at ~L160; that line is now the brain call-budget helper. `MEASURED`

**And it is correct, not just present.** Of 234 solved weeks, 100 shipped
`diagnosis === null`, and **0 of those 100 contained an out-of-band day**. `MEASURED`
The gating at `mealSolver.js:743-756` (`anyDayMissed || anyUnfilledSlot ||
floorMissed || noDaysAtAll`) holds. Do not "fix" this — it works.

---

## 3. The per-slot warning gate — exact location and predicate

### Current predicate

**Primary gate: `weeklyPlanner.js:630`**
```js
if (kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT) {
```
A candidate clearing this ships via `ship()` at **`weeklyPlanner.js:602-605`**, which
hardcodes **`warning: null`**.

**Warning text: `weeklyPlanner.js:661-671`**, fired only when no candidate cleared
the gate. `misses[]` is built from exactly two clauses:
```js
if (best.kcalOff  > KCAL_TOLERANCE_PCT)    misses.push(`landed … kcal vs a … target`);   // :664
if (best.proteinShort > PROTEIN_TOLERANCE_PCT) misses.push(`delivered …g protein vs …`); // :665
```

So the effective predicate is:
```
warn(slot)  ⟺  kcalOff > 0.15  ∨  proteinShort > 0.12
```
Constants at `weeklyPlanner.js:67` (`KCAL_TOLERANCE_PCT = 0.15`) and `:74`
(`PROTEIN_TOLERANCE_PCT = 0.12`). **Fat and carb appear nowhere.**

The same 2-macro shape is repeated in three more places:
- `weeklyPlanner.js:511-516` — the AI-fallback slot's warning
- `mealSolver.js:1417-1427` — `solveOneMeal`'s `fits` / `miss`
- `mealSolver.js:1421-1427` + `:855-858` — `alternatesForSlot`'s `matchPct`

Meanwhile the **day** is graded on four macros: `mealSolver.js:256`
`dayInTolerance = (t) => t.kcalOk && t.proteinOk && t.fatOk && t.carbOk`.

**That mismatch is the defect.** The day verdict and the slot warning disagree about
what "wrong" means.

### What it must become

The prior finding's framing — "make the slot gate 4-macro, warned slots go
341→405" — is the **wrong fix**, and the measurement says so.

A day-scoped 4-macro gate (warn every slot on an out-of-band day) takes warned slots
from **1,093 → 2,728**, i.e. **14.4% → 35.9% of all slots**. `MEASURED` That is a 2.5x
flood of amber, and it is *not* informative: a slot is rarely individually to blame
for a day's fat overshoot.

The reason a naive per-slot 4-macro gate is also wrong: a slot has no fat/carb
*target* of its own that means anything. `solveDay` computes `fatShare`/`carbShare`
(`weeklyPlanner.js:898-899, 930-931`) but explicitly does **not** cap them
(`:923-929`: "these two numbers size nothing; they only rank candidates that already
passed the gate"). Warning against a share that was never a commitment invents a
miss.

**Required design — put the four-macro verdict at the DAY, keep the slot gate at two:**

1. **Keep** `weeklyPlanner.js:630` / `:661-671` as-is (kcal+protein). A slot warning
   should keep meaning *"this dish could not be portioned to its own calorie/protein
   share"* — a statement about **this dish**, actionable by the swap button sitting
   right next to it.
2. **Add a persisted day-level verdict.** This is the missing structure, not a
   louder slot gate. One amber line per day —
   *"Thursday: 118 g fat vs a 62–74 g range — 44 g over"* — which is exactly the
   string `dayMissLine()` already produces (`mealSolver.js:265-285`) and which
   `meta.days[].miss` already carries.
3. **Net effect:** warned *slots* stay at 1,093 (no new noise), and out-of-band days
   with a visible signal go from **318/458 (69.4%) to 458/458 (100%)**.
   The 100% is `DERIVED` by construction of the proposal, not measured.
4. Give the day line **its own affordance** ("Re-solve this day" → `POST /day-options`
   for that `dayOfWeek`), because no single slot swap reliably fixes a whole-day
   composition miss.

---

## 4. Silent misses — the definitive answer

**Yes, silent misses reach the user today.** Two distinct paths.

### Path A — the honesty payload is never persisted (the structural one)

`Plan` (`schema.prisma:493-504`) and `PlanSlot` (`:506-527`) have **no column** for a
day/week diagnosis, match %, or day verdict. The only honesty field on disk is
`PlanSlot.warning`. `MEASURED`

`GET /plans/current` (`plans.js:114-121`) returns the raw Plan row. **No `meta`.**

On the client, `genMeta` is plain component state — `PlanTab.jsx:750`
(`const [genMeta, setGenMeta] = useState(null); // narration from the last generate`).
It is written **only** at `:890` and cleared at `:877`. `loadPlan()` (`:788-795`) never
touches it.

**Therefore:** the moment the user switches tabs, restarts the app, or reloads,
`meta.diagnosis` and every `meta.days[].miss` are **gone forever**. The plan is still
on disk, still out of band, and the only thing left to say so is a 2-macro slot
warning that on 66.6% of out-of-band days was never allowed to fire. `DERIVED`

**140 of 458 out-of-band days (30.6%) have no slot warning on any slot** — after a
reload these are 100% silent. `MEASURED`

### Path B — `TodayTab` never surfaces a miss at all

`TodayTab.jsx` is where the constitution's promise matters most (memory:
*"lives in Today"*), and it is the weakest surface.

- **It never renders `slot.warning`.** `grep -n "\.warning" TodayTab.jsx` → **no
  matches.** A slot the solver explicitly flagged shows on Today as an ordinary
  meal. `MEASURED`
- **It only flags kcal OVER.** `TodayTab.jsx:860` — `{kcalPct > 1 && (…)}`. A day
  **under** target — including >15% under, which the solver calls out of tolerance —
  renders with no copy at all. `MEASURED`
- **Fat under-floor is untinted by design.** `MacroRail` computes
  `over = ceil != null && eaten > ceil` (`:93`) and tints only on `over` (`:110`).
  Fat is passed `kind="floor"` (`:137`), so `ceil` is `null` and `over` is **always
  false** — a fat rail can never turn amber. The comment at `:87-88` says this is
  deliberate for *over* a floor; the side effect is that **under** a floor is also
  never tinted. `MEASURED` / `DERIVED`
- There is **no day-level verdict** on Today. `planned` is summed at `:773` and
  compared to `macros.kcal` only.

Net: the single most common miss mode (fat outside band, 324/458 days) produces
**zero** visible signal on the Today tab under any circumstance. `DERIVED`

### Path C — write endpoints that mint `warning: null`

- `POST /place-recipe` writes **`warning: null` hardcoded** (`plans.js:625`),
  whatever the fit. Placing a 900 kcal dish into a 300 kcal snack slot is stored
  clean.
- `POST /accept-day` and `PUT /…/apply` take the warning **from the client**
  (`plans.js:110`, via `rebuildSlotFromClient`). The honest client does forward it
  (`PlanTab.jsx:60`, `warning: s.warning || undefined`), but the server recomputes
  every other field and trusts this one. Omitting the key stores `null`.
- `POST /fill-today-from-cart` at least labels its miss, but on **kcal only** at a
  15% threshold (`plans.js:670-672`).

### Path D — the narration card goes stale after any edit (UI verdict-disagreement)

`setGenMeta` is called at exactly two places (`:877` clear, `:890` set). Every other
mutation — `applyAlternate` (`:594-607`, ends in `reloadPlan()`), `acceptDay`
(`:951`), `place-recipe`, `fill-today-from-cart`, lock toggle — **changes the plan
without clearing the narration.** `MEASURED`

So after swapping a meal to fix Thursday, the "What the meal planner did" card still
shows the *old* week's per-day matches and diagnosis, presented as current. The user
can be looking at "7 of 7 days close enough" over a plan that no longer is.

---

## 5. The honesty ordering hazard — live, with numbers

**The prototype trimmer is not a prototype. `closeDayMacros` is wired into the
live solve path in the working tree.**

`weeklyPlanner.js:32` requires it; `weeklyPlanner.js:951` calls it inside `solveDay`;
`plans.js:206` + `:328` feed it real `adjusters` from `planContext.js:234`.

### The exact ordering, as it stands

```
solveDay()  (weeklyPlanner.js:852-953)
  :934   result = await resolveSlot(...)      ← WARNING TEXT IS FORMED HERE
                                                (from pre-adjuster macros, :661-671)
  :936   results[i] = toSlotRecord(target, result)   ← warning stored verbatim
  :951   closed = closeDayMacros({slots: results, dailyTarget, adjusters})
                                              ← MUTATES kcal/protein/fat/carb
                                                (macroCloser.js:159-162)
                                                NEVER touches `warning`
  :952   return { slots: closed.slots }
```

`macroCloser.js:156-168` writes `working.kcal`, `.protein`, `.fat`, `.carb` and
pushes an ingredient. There is **no `working.warning`** assignment anywhere in the
file. `MEASURED`

### Measured consequence

Of **621 slots that received an adjuster**, **33 carry a warning quoting a calorie
figure the slot no longer has**; **31 of those are off by ≥50 kcal**; worst drift
**684 kcal**. `MEASURED`

Real examples from the run:

```
stored kcal = 638 :: "…closest was "Beef stroganoff" (landed 481 kcal vs a 329 target)."   drift 157
stored kcal = 565 :: "…closest was "Matambre a la Pizza" (landed 450 kcal vs a 329 target)." drift 115
stored kcal = 511 :: "…closest was "Bistek" (landed 421 kcal vs a 329 target)."             drift  90
```

The warning **understates the overshoot** — it tells the user 481 while the plan,
the totals and the grocery list all say 638. That is a number on screen that exists
nowhere in the data. It violates *"Wrong math = product death. Displayed numbers can
reveal their formula and inputs."*

### What is ordered correctly (do not break it)

- `scoreWeek` runs **after** `solveDay` returns (`mealSolver.js:679-680`), so the
  **day verdict is computed on post-closer totals**. Correct.
- The brain gap-fill is explicitly ordered **before** the diagnosis
  (`mealSolver.js:723-741`), and **rescores** when it changes anything (`:740`). The
  comment at `:717-719` states the rule exactly right. That is the model to copy.
- Net closer effect: **54 days rescued, 9 days broken** (a day in band pre-closer,
  out of band post-closer). Both are caught by the day verdict because of the
  ordering above. `MEASURED`

### Required ordering for any trimmer/closer fix

> **Nothing that mutates a stored macro may run after the text that describes it.**

Concretely, in `solveDay`:

1. Solve slots (`:906-944`) — but **do not** finalise warning text yet; carry the
   structured miss (`{kcalOff, proteinShort, triedCount, bestName, targetKcal}`)
   instead of a rendered string.
2. Run `closeDayMacros` (`:951`).
3. **Re-derive** each touched slot's kcal/protein miss against its own target from
   the **post-closer** macros, and render the warning string *then*. A slot the
   closer rescued must come back `warning: null`; a slot it worsened must say so.
4. Only then compute the day verdict (already correct — `scoreWeek` after
   `generateWeekPlan`).
5. Only then compute `diagnosis` (already correct — `mealSolver.js:754`).

If step 3 is skipped, the closer will keep manufacturing verdict-disagreements at
the ~5% rate measured above (33/621), and each one is a wrong number shown to the
user.

---

## 6. Amber semantics and the design constitution

Read from the project's own `CLAUDE.md` § *Design constitution — AURORA RINGLIGHT
color laws (binding, no session may violate)*.

**Current mapping (correct — a fix must not regress it):**

| State | Token | Where |
|---|---|---|
| day/week on target | `--ink` #E-off-white, **not** accent | `PlanTab.jsx:408`, `:413` |
| day out of band | `--warn` #E5A83B | `PlanTab.jsx:449, 452, 459` |
| slot warning | `--warn` | `PlanTab.jsx:662` |
| candidate on target | `--accent` #2FD576 | `PlanTab.jsx:516` (gated on `inTolerance === true`, `:503`) |
| verdict `bad` | **`--warn`**, not red | `theme.js:49` |
| system error | `--red` #EA6A62 | `Parts.jsx:309-312` (`ErrorNote`) |

**Binding constraints on a fix:**

1. **Never route a solver miss through `ErrorNote`.** `ErrorNote`
   (`ui/Parts.jsx:309-312`) is `C.red` on `C.redBg` with `role="alert"`. It is
   legitimately red because it reports *system* failures ("Couldn't load this
   week's plan"). A missed macro band is **food data** — law (b) forbids red on it.
   The day-level miss line must use inline `C.warn`, exactly as the slot warning
   already does at `PlanTab.jsx:662`.
2. **Green stays scarce.** Do not paint a day green for being in band in a list
   context. `PlanTab.jsx:452` uses `C.ink` for an on-target day and reserves
   `C.accent` for the single hero candidate card. Keep that.
3. **Copy tone is supportive re-planning, never judgment.** The existing strings are
   the standard to match: `TodayTab.jsx:862` — *"Over by 340 — swap a slot on the
   Plan tab if you want it closer. Nothing to undo…"*; `PlanTab.jsx:664` —
   *"→ Fix it with the swap button (3 other options), or regenerate with looser
   filters."* Every new miss line needs a *what you can do* clause.
4. **No jargon labels** (per `feedback_plain_english_labels`). `dayMissLine()`
   (`mealSolver.js:265-285`) already produces plain English —
   *"118 g fat vs a 62–74 g range — 44 g over"*. Reuse that string; do not invent
   "fat band violation" or a `T2` badge.
5. **No hardcoded hex** (standing rule 8). Use `C.warn` / `--warn`, never
   `#E5A83B`.
6. **Fat rail asymmetry is a real gap, and the fix is not simply "tint it".**
   `MacroRail` deliberately does not tint *over* a floor (`:87-88`) — correct. But
   *under* a floor also never tints, which is the fat miss the solver actually
   grades. A fix should tint **under-floor** amber while leaving over-floor
   untinted, and keep the `a11y` string in sync (`:98-100`).

---

## 7. What the user can do about a miss — recovery affordances

| Affordance | Re-validates server-side? | Adequate? |
|---|---|---|
| **Swap** (alternates → apply) | Macros **yes**, pool membership **yes**, lock **409 yes**. `warning` **no** (client-supplied). Day verdict **never recomputed** | **Partially.** Ranks alternates on kcal+protein only (`mealSolver.js:1417-1427`), so a 100%-match alternate can worsen the day's fat. Returns one slot; nothing tells the user whether the day now lands |
| **Regenerate** (`/generate`) | Full solve, full honesty payload | **Yes** — the only genuinely honest path. But it discards the whole week to fix one day |
| **Lock** (`PUT /…/slots/:slotId`) | ownership only | **Yes** for its job. Locks are real solve constraints (`plans.js:294-298`, `weeklyPlanner.js:867-882`), and compliance-gated on diet change (`slotIdsToKeep:38-44`) — well built |
| **Accept-day** (`/day-options` → `/accept-day`) | Macros yes; candidates carry `inTolerance` + `miss` | **Yes at the moment of choice** — this is the best surface in the app. But the verdict is not persisted, so it evaporates on reload |
| **Accept-anyway** | — | **Does not exist as an explicit act.** A user who keeps an out-of-band day has no way to acknowledge it, so the app cannot distinguish "unseen" from "accepted" |

**The gap:** there is **no per-day re-solve from the week board.** `POST /day-options`
takes a `dayOfWeek` and already exists (`plans.js:442-475`) — the affordance is one
button away and is the natural target for a day-level miss line.

**Missing server-side re-validation, precisely:** `PUT /…/apply` (`plans.js:564-584`)
recomputes the slot and returns `res.json(full)` — a single `PlanSlot`. It never
re-scores the day it just changed. Adding a day verdict to that response is the
cheapest honesty win in the whole route file.

---

## 8. What I could NOT determine

1. **Whether the 341→405 figure from the prior fleet is reproducible.** I could not
   find its harness or its gate definition. My counterfactual (day-scoped, warn every
   slot on an out-of-band day) gives 1,093→2,728 on a different sample. The two
   numbers are not comparable and I am not asserting the prior one is wrong — only
   that I could not reproduce it, and that under *my* reading of a 4-macro gate the
   noise increase is far worse than 341→405 implies.
2. **Absolute day-miss rates in production.** My harness calls `computeMacros` with
   `profile.targetKcal` directly rather than going through `reconcileTarget`
   (`planContext.js:227`), because that path writes to the DB and I was read-only.
   It also applies no prep/cost/taste filters. The 28.0% out-of-band rate is
   therefore approximate. **The structural findings do not depend on it** — the
   fraction of out-of-band days the 2-macro gate *cannot* describe (66.6%) is a
   property of the predicate, not of the sample.
3. **Whether the frontend renders correctly at runtime.** I read JSX; I did not boot
   Electron or drive a browser. Claims about what is on screen are `DERIVED` from
   source. In particular I did not visually confirm the fat rail's untinted
   under-floor state.
4. **The one-meal surface (`horizon.kind === "meal"`).** `plans.js:235-270` returns
   `oneMeal` with a `miss` line that `PlanTab.jsx:186-187` renders in amber. It
   looked correct on read, but it writes nothing and I did not measure it.
5. **`regenerateOneSlot`'s honesty** (legacy swap, `plans.js:700-719`). The UI has
   moved off it (`:698-699`); I did not trace it.
6. **Multi-week horizons.** All measurement was single-week. `meta.horizon.weekPlans`
   (`plans.js:422-429`) publishes a per-week rollup that looks right, and
   `SolverNarration` handles `d.windowIndex` (`:447`, `:460`), but I did not exercise
   a 28-day generate.
7. **Whether `PlanSlot.warning` has a length limit in practice.** A day-level miss
   line concatenating four macros could be long; I did not check SQLite/Prisma
   behaviour on that column.

---

## 9. For the build prompt — the ordered fix list

1. **Persist the day verdict.** Add `inTolerance` + `miss` (and ideally `matchPct`)
   to the day, either as a `PlanDay` row or as columns on `Plan` keyed by
   `dayOfWeek`. Without this, everything else is a band-aid: the honesty payload
   dies at reload no matter how good it is at generate time. *This is the root
   cause.*
2. **Re-derive slot warnings AFTER `closeDayMacros`** (`weeklyPlanner.js:951`).
   Carry a structured miss through the solve; render the string last. Fixes 33/621
   wrong numbers.
3. **Render the day verdict on `TodayTab`** — it currently shows nothing for an
   out-of-band day unless the day is over on kcal. Amber, `C.warn`, plain English
   from `dayMissLine()`, with a "Re-solve this day" action.
4. **Surface `slot.warning` on `TodayTab`** at all (currently zero references).
5. **Clear or recompute `genMeta` on every plan mutation** (`PlanTab.jsx` — after
   `applyAlternate`, `acceptDay`, `placeRecipe`, `fillFromCart`). Cheapest fix:
   `setGenMeta(null)` in `reloadPlan()`. Better: have `/apply` and `/accept-day`
   return a fresh day verdict and patch it in.
6. **Stop trusting the client's `warning`** (`plans.js:110`) — recompute it from the
   rebuilt macros against the slot's target, the same way every other field on that
   path is recomputed.
7. **Stop writing `warning: null` unconditionally** in `/place-recipe`
   (`plans.js:625`) — compute the miss like `/fill-today-from-cart` does, but on
   four macros.
8. **Do NOT widen the per-slot gate to 4 macros.** It floods the UI (14.4%→35.9%)
   and blames individual dishes for a day-level composition outcome. Put the
   4-macro verdict on the day, where it already correctly lives.

---

*D8, 2026-07-31. Scratch scripts: `docs/surgery/CAMPAIGN/solver-deepdive/D8/`.
No file under `backend/src/`, `frontend/src/` or `backend/prisma/` was modified.*
