# Agent 09 — Wave 6 (Engine Number Truth) · handoff

Owned files changed:

- `backend/src/lib/expenditureEstimator.js` — intake recency/coverage gates + `confidence` block
- `backend/src/lib/adaptiveTarget.js` — ±125 kcal step cap (`applyStepCap` / `checkpointDates` / `walkTarget` / `resolveAppliedTarget`), ledger now publishes the cap
- `backend/src/lib/profileTarget.js` — `reconcileTarget()`; live resolver declared authoritative; `[target-drift]` logging
- `backend/src/routes/weighins.js` — reconcile-on-read for `GET /summary`; `confidence`/`stepCap`/`targetDrift` in the payload; `macros.lbmSource` label
- `backend/tests/profileValidation.test.js` — +3 onboarding-flow-4 tests
- NEW `backend/tests/adaptiveStepCap.test.js` (15), `backend/tests/adaptiveIntakeRecency.test.js` (13), `backend/tests/targetReconcile.test.js` (9)

`backend/src/lib/weightNow.js` — read, unchanged (no defect found; it is the
"current weight" definition `weightNowKgAt` replays, and the two agree).

---

## 1. REQUESTS OUTSIDE MY OWNERSHIP (please action)

### 1a. Finish adaptive-tdee-2 — three more `profile.targetKcal` readers

The cache→resolver reconciliation is wired into the ONE read path I own
(`GET /api/weighins/summary`). Three other places still read the stored number
straight off the row and can therefore still render a stale target. All three
need the same one-liner. `reconcileTarget` is exported from
`backend/src/lib/profileTarget.js` and returns `{ ...target, drift, ... }`.

| file:line | current | fix |
|---|---|---|
| `backend/src/lib/planContext.js:37` | `computeMacros(profile, weightNowKg, profile.targetKcal)` | `const t = await reconcileTarget(userId, { profile, reason: "planContext" }); … computeMacros(profile, weightNowKg, t.target)` |
| `backend/src/routes/recipes.js:49` | `computeMacros(profile, weightNowKg, profile.targetKcal)` | same shape, `reason: "recipes:ai-target"` |
| `backend/src/routes/profile.js:103-106` | `GET /` returns the raw row | reconcile before `res.json(profile)`; re-read the row after |

`planContext.js` is the important one — it feeds the meal solver, so a stale
number there is a whole week of meal plans built to the wrong calorie target.

### 1b. Optional: boot-time sweep

`backend/server.js` / `desktopBootstrap.js` (not mine). A single
`reconcileTarget(userId, { reason: "boot" })` per profile at startup would heal
every cache the moment the desktop app opens, rather than on first screen view.
Cheap (one walk per user, ~30 ms).

### 1c. Attribute the write paths (cosmetic, improves the drift log)

`recomputeTarget(userId, asOf, reason)` now takes a third argument that shows up
in `[target-drift]`. `weighins.js` passes `"weighin:create"` / `"weighin:delete"`.
Please pass one from `routes/profile.js:178` (`"profile:put"`) and
`routes/diary.js:15` (`"diary:write"`).

### 1d. `backend/scripts/runTests.mjs` tripwire floors (Agent 1's file)

I added **3 files / 37 new tests** (15 + 13 + 9) plus **3 tests** in an existing
file — +3 files, +40 tests. Floors are minimums so CI does not break as-is, but
if they are being kept tight: `MIN_TEST_FILES 63 → 66`, `MIN_TESTS 659 → 699`.

### 1e. Frontend (Agents 5/6/7) — new fields to surface

`GET /api/weighins/summary` now returns:

- `confidence` — `{ level, basis, measured, intakeCurrentThrough, intakeStaleDays, label }`.
  `label` is a ready-to-render sentence. **When `measured` is false the target is
  the FORMULA target and must not be presented as measured.**
- `stepCap` — `{ capKcal, capped, remainingKcal, cyclesToConverge, reason, indicatedKcal, appliedKcal, … }`.
  When `capped` is true, show `reason` (it already reads as UI copy:
  *"capped — your data indicates +400 kcal, so we are applying +125 now and the
  remaining 275 over the next 3 weekly updates…"*). Without this the engine looks
  like it is ignoring the user's data.
- `target.indicatedTargetKcal` / `target.stepCapped` — uncapped vs in-force.
- `macros.lbmSource` (`"assumed-bodyfat-estimate"` | `"user-bodyfat"`) and
  `macros.lbmSourceNote` — the protein range is built on ESTIMATED lean mass
  whenever body fat % is unset. It is currently labelled in the API and rendered
  nowhere. That is the last open half of onboarding-flow-4 (see §2 below).
- `targetDrift` — `{ storedKcal, liveKcal, deltaKcal, drifted, refreshed }`.
  Diagnostic; no UI needed unless you want a dev panel.
- `adaptive.ledger[]` rows gained `indicatedTargetKcal`, `indicatedChangeKcal`,
  `capped`, `capReason`, `remainingKcal`, `intakeStaleDays`.

### 1f. `backend/src/lib/bmrEngine.js` (Agent 1) — optional

`computeMacros` discloses the assumed-BF fallback as `bfAssumed` /
`assumedBodyFatPct`. The Wave 6 finding text expected an `lbmSource:
"boer-estimate"`-style string. I added `lbmSource` **in the route** rather than
touch a golden-locked file. If you would rather it live at source, it is one
line next to the two existing disclosure fields. **Do not change the numbers** —
see §2, the arithmetic is verified and correct as it stands.

### 1g. `docs/adaptive-tdee-methodology.md` (not mine)

`method.doc` still points at it and it now under-describes the estimator: it does
not mention the intake-recency gates or the step cap. Numbers to fold in are in
§3 below.

---

## 2. onboarding-flow-4 — VERIFIED **CLOSED** (with one naming correction)

`backend/src/lib/bmrEngine.js:280-282`:

```js
const bfKnown = profile.bodyFatPct != null && profile.bodyFatPct > 0;
const bfForLbm = bfKnown ? profile.bodyFatPct : (profile.sex === "F" ? 28 : 21);
const lbmLb = weightLb * (1 - bfForLbm / 100);
```

Protein is **not** computed on total weight. It is computed on an
**assumed-body-fat** LBM (ACE adult midpoints, `ASSUMED_BODY_FAT_PCT` at
`bmrEngine.js:267`), disclosed at `bmrEngine.js:302` (keto branch) and
`bmrEngine.js:342` (default branch).

**Correction to the finding text: it is NOT the Boer formula and there is no
`lbmSource` field in the engine.** Both branches are covered; there is no
unlabelled side door.

Hand-check, male, 232.00 lb (105.2336 kg), 185.42 cm, `bodyFatPct: 0`:

| derivation | lean mass | protein (×1.14 – ×1.25) |
|---|---|---|
| **A** total weight as LBM (the old bug) | 232.00 lb | 264 – 290 g |
| **B** assumed 21 % BF → `232.00 × 0.79` | **183.28 lb** | **209 – 229 g** ← what the code returns |
| **C** Boer `0.407×105.2336 + 0.267×185.42 − 19.2` | 73.137 kg = 161.24 lb | 184 – 202 g (implies 30.5 % BF) |

Verified by running `computeMacros`: `lbmLb 183.2800`, `proteinLo 209`,
`proteinHi 229`, `bfAssumed true`, `assumedBodyFatPct 21`. Female control
(70 kg, `bodyFatPct: null`) → `lbmLb 111.1128` = `154.32 × 0.72`,
`assumedBodyFatPct 28`. Known-BF control (24 %) → `lbmLb 176.32`,
`bfAssumed false`. Locked by 3 tests in `backend/tests/profileValidation.test.js`.

Remaining gap is **presentation, not arithmetic**: `bfAssumed` has zero
consumers in `frontend/` (grep). See §1e.

---

## 3. Numbers chosen (for the methodology doc)

**Intake recency (adaptive-tdee-1), `expenditureEstimator.js`:**

| constant | value | reasoning |
|---|---|---|
| `RECENT_WINDOW_DAYS` | 14 | one week is too brittle (a sick week blanks the estimate); a month is long enough for a dead log to hide inside |
| `MIN_RECENT_INTAKE_DAYS` | 8 | majority of the last 14 (57 %), a shade under the 60 % whole-window bar — catches "stopped logging", not ordinary gaps (both weekends off + 2 still passes) |
| `MAX_INTAKE_STALE_DAYS` | 4 | at `HALF_LIFE_DAYS = 21` a 4-day-old log still carries `0.5^(4/21) = 0.88` of full weight. Weight is a STOCK (an old reading still constrains today); intake is a FLOW (an old reading says nothing about today) — hence tighter than the 10-day weigh-in bar |
| `CONFIDENT_INTAKE_STALE_DAYS` | 2 | "confident" must mean current |
| `CONFIDENT_RECENT_INTAKE_DAYS` | 11 | `floor(CONFIDENT_COVERAGE 0.8 × 14)` — the same 80 % bar applied to the trailing fortnight |

**Step cap, `adaptiveTarget.js`:** `STEP_CAP_KCAL = 125` (owner-approved),
`STEP_WALK_MAX_WEEKS = 52`. The cap is applied by REPLAYING a weekly checkpoint
grid anchored on `profile.startDate` — not by clamping against the stored value,
which would let every page refresh walk the target another 125 kcal. 52 weeks is
justified: the widest plausible target range (~1,200–5,000 kcal) needs at most
`ceil(3800/125) = 31` steps to traverse, so where the anchor starts is
unrecoverable from today's answer.
