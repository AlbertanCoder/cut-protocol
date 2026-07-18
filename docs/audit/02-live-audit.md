# Cut Protocol — QC Live Audit (Stage B)

**Date:** 2026-07-18 · **Baseline:** tag `pre-audit` (`48cda71`) · **Method:** drove the **actual packaged Electron app** (`release/win-unpacked/Cut Protocol.exe`, freshly rebuilt) with Playwright (`_electron`), clicking/typing/screenshotting as a user, plus authenticated in-renderer API calls for allergen scanning and value verification. Three fresh fake users on the packaged app's own database (a copy of the shipped template). No fixes applied. Screenshots in `docs/audit/screenshots/`.

**The three test users**

| | User A | User B | User C |
|---|---|---|---|
| Sex / age | F 41 | M 33 | M 27 |
| Units | **metric** (kg/cm) | **imperial** (lb/in) | imperial |
| Size | 168 cm / 78 kg / 28% BF | 72 in / 195 lb | 178 cm / 82 kg |
| Job | Nursing (on-feet) | Carpenter | Desk / office |
| Diet | **Vegan** | none | none |
| Allergies | **tree nuts** | **shellfish + kiwi** | none |
| Rate | 1 lb/wk (safe) | **2 lb/wk (aggressive)** | 1 lb/wk |

## Executive summary

**The engine is trustworthy; the safety filtering and input validation are not.** Every BMR/TDEE number I could recompute matched the app to the kilocalorie, on both a metric-female and an imperial-male profile, all six formulas. Performance is excellent (576 ms cold start, ~290 ms week solve). The unit toggles, the aggressive-rate safety gate, weigh-in validation, the vegan filter, plan locking, and hard-kill durability all pass live. **But** a shellfish-allergic user is served clams and squid in generated plans, absurd profile vitals (age −5, height 0) are accepted and silently corrupt the target, one malformed profile field 500-bricks the whole library, and full generated weeks drift up to +24% over target. AI recipe generation is dead in the packaged build (401).

**Live-confirmed severity counts: 3 CRITICAL · 4 MAJOR · 4 MINOR.** All three criticals were predicted by the Stage A code audit and are now demonstrated end-to-end in the running app.

---

## CRITICAL (live-reproduced)

### L1. Shellfish-allergic user is served clams and squid on generated plans
**Confirms code-audit C1.** User B declared `["shellfish","kiwi"]`. The filter correctly hides 47 recipes and catches prawns, shrimp, mussels, oysters, and lobster — but **cephalopods and molluscs pass**. Live evidence:
- **Library (GET /recipes):** 6 shellfish recipes shown to the allergic user — *Conch Fritters, Conch Stew, Fried calamari, Quick salt & pepper squid, Salt & pepper squid, Squid chickpea & chorizo salad*.
- **Generated meal plans (3 weeks):** *"Clam, chorizo & white bean stew"* (Clams) appeared every week; *"Quick salt & pepper squid"* (Squid) appeared on the plate.
- **Swap suggestions:** *Conch Stew* (Conchs) offered as an alternate.

Missing synonyms: `squid`, `calamari`, `octopus`, `cuttlefish`, `conch`, `clam`, `mussel`(partial), `seafood stock`. Kiwi could not be leak-tested — no kiwi ingredient exists in the DB (the filter is untested, not proven safe). **Suggested fix (not applied):** port the shellfish species from the diet-style keyword list into the allergy synonym map. *Screenshot: live-01 not applicable; leak is data-level, evidence above.*

### L2. Absurd profile vitals are accepted with no validation — target silently corrupted
**Confirms code-audit C5 + M11.** Driving the real PUT `/profile` (what the Profile tab commits):

| Input | Result | Saved? | Target after |
|---|---|---|---|
| `age: 3` | **200 OK** | yes | 2,090 |
| `age: 200` | **200 OK** | yes | 1,500 (floored) |
| `heightCm: 0` | **200 OK** | yes | 1,500 |
| `goalWeightKg: 0` | **200 OK** | yes | 1,500 |
| `age: -5` | **200 OK** | yes | 1,500 |

Age −5, height 0, and goal 0 all persist, and `recomputeTarget` runs on the garbage — height 0 alone collapses the daily target to the 1,500 floor with no error, no warning. Weigh-ins, by contrast, are validated correctly (see clean list). **Suggested fix (not applied):** add age/heightCm/goalWeightKg bounds to `validateProfilePatch` and mirror them in the ProfileTab inputs.

### L3. One malformed profile field 500-bricks the entire recipe library and plan generation
**Confirms code-audit M11 (self-DoS).** `PUT /profile { excludedFoods: [5] }` is **accepted (200)**. Immediately afterward, on the running app:
- `GET /recipes` → **500** (library dead)
- `POST /plans/generate` → **500** (planning dead)

The number `5` reaches `matchesExclusionTerm` where `.trim()` throws, and every recipe-facing screen 500s until the profile is repaired. A user who fat-fingers a custom exclusion, or any client bug, disables the core of the app persistently. Restoring `excludedFoods: []` fixed it instantly. **Suggested fix (not applied):** validate `excludedFoods` as an array of non-empty strings; harden the matcher with `String(term ?? "")`.

---

## MAJOR (live-reproduced)

### L4. Generated weeks drift progressively over target — only 4 of 7 days within 10%
User C (no restrictions, 2,011 kcal target, 4 meals + 2 snacks): a single `POST /plans/generate` produced 42 slots that drift upward through the week:

| Day | kcal | Off target |
|---|---|---|
| Mon | 2,151 | +7.0% |
| Tue | 2,013 | +0.1% |
| Wed | 2,083 | +3.6% |
| Thu | 2,186 | +8.7% |
| Fri | 2,354 | **+17.1%** |
| Sat | 2,387 | **+18.7%** |
| Sun | 2,499 | **+24.3%** |

Only **4/7 days within 10%**; the worst is +488 kcal, which would erase most of a day's intended deficit. No warning is shown for over-target days (the diagnosis path only fires when days land *short* or candidates are rough). The drift is monotonic, consistent with variety caps exhausting the best-fitting recipes as the week fills. The single-day solver is honest (day-options scored 89/85/84% for User B, best-first, tracking kcal error) — it is the **full-week** assembly that degrades. *Screenshot: live-04-week-plan-drift.* **Suggested fix (not applied):** carry the running weekly surplus into later-day scoring, or reject and re-solve days above a tolerance as the per-week generator already claims to.

### L5. AI recipe generation is dead in the packaged build (401)
`POST /recipes/generate-drafts` returns **401** in the installed app — the shipped Anthropic key is rejected. The whole "Generate 3 options" feature and the URL-import macro fallback that leans on it produce nothing; the frontend surfaces the generic "request failed." (The data-validator *gate* on saving drafts could therefore not be exercised through generation — it was verified structurally in Stage A.) **Suggested fix (not applied):** treat a dead key as a first-class state — disable the Generate button with "AI unavailable (no API key)" rather than 401-ing; and don't ship a key that fails.

### L6. New build on an existing install = broken Training (no migration path)
**Confirms code-audit M2, verified against the real artifact.** Launching the freshly-built app against the pre-existing `%AppData%\Cut Protocol\cutprotocol.db` (created from the pre-Training template): the app boots and looks healthy, but `GET /training` returns **500** and the Training tab is dead, because the shipped template predates the Training tables and nothing migrates an existing DB. Every future schema change breaks every existing install the same silent way. **Suggested fix (not applied):** stamp a schema version and run the bundled migrations (or refuse with an actionable message + backup) on version mismatch.

### L7. Grocery practical units cover under half the list; est. total is over a partial set
User B's whole-week list: **108 items, 60 of them show grams only** (no pack/can/count) and roughly 30 carry no price, yet an "Est. total: $172.09" is displayed over that partial coverage. Packaged/canned goods do get sensible units (Chicken Stock → "1 carton", Greek yogurt → "1 tub"), and raw proteins shown by weight (720 g Goat Meat, 345 g Sardines) are defensible at a butcher counter — but the feature is advertised as practical-units-primary and lands closer to half. **Suggested fix (not applied):** widen the purchase-unit table, and either label the total "partial — N items unpriced" or compute it only when coverage is high.

---

## MINOR (live-reproduced)

### L8. Protocol "Day" counts from profile creation, so historical weigh-ins never engage the verdict
User B: 12 weigh-ins spanning 12 days, a fully populated trend, `avg7Kg` and a rate both computed — yet `daysIn: 1` and the verdict is stuck on "WEEK 1 — WATER NOISE, judge nothing." `daysIn` is measured from profile-creation date, not weigh-in history, so anyone importing or backlogging data (or re-setting up) sees "Day 1, wait" indefinitely against a full dataset. *Screenshot: live-05-trend-populated shows the populated trend the verdict ignores.*

### L9. Locked slots survive a diet change even when they now violate it
A slot locked before the profile was switched to vegan (a goat dish) persisted through regeneration into the vegan plan. Locks correctly survive regeneration (a feature), but a diet change should re-validate them. Narrow trigger, but a locked non-compliant meal is a silent diet leak.

### L10. There is no "add a food" feature at all
Step-7's "add a food with bad macros" can't be performed: `POST /foods` returns **404** — the route only has GET and admin PUT. The nutrition validator guards *edits*, not additions, because additions aren't a feature. Worth stating so the capability isn't assumed.

### L11. Crashed/mid-generation exits leave Electron processes holding port 3001
Several times an interrupted run left 4 `Cut Protocol.exe` processes alive, holding port 3001. Combined with the code-audit's M3 (no single-instance lock; a busy 3001 makes a new instance read a *foreign* backend), this is the mechanism by which the installed app can silently attach to the dev database. Reproduced here as orphaned processes after non-clean exits.

---

## What's solid (verified live, with evidence)

- **Engine math is exact — both unit systems, all six formulas.**
  - User B (M, imperial, 195 lb/72 in/33 y): displayed Mifflin **1,868** / Oxford **1,849** / Harris **1,964** / Schofield **1,888** = avg **1,892**; TDEE **3,008** (×1.45 carpenter + 265 training); target **2,008**. My independent recompute matched every figure to the kcal. *(live-03 shows the metric equivalent.)*
  - User A (F, metric, 78 kg/168 cm/41 y/28% BF): displayed Mifflin **1,464** / Katch **1,583** / Cunningham **1,736** — all three matched my hand calc exactly; BF-known correctly unlocked all six formulas; TDEE **2,394** = 1,538 × 1.45 + 164 training; target **1,894**. *Screenshot: live-03-engine-exact.*
  - Training MET kcal, occupation multipliers, `TDEE − rate×500`, and the floor clamp all reproduced.
- **Aggressive-rate safety gate works.** Selecting 2 lb/wk for a 195-lb user showed "2 lb/wk is 1.03% of your body weight per week — above the ~1% guideline"; the Finish button was **correctly disabled** until "I understand the risks" was ticked (verified by reading the button's disabled state), and only then did it save `rateAcknowledged: true`. *Screenshot: live-01-safety-gate.*
- **Both unit toggles work.** Imperial and metric wizards relabel and store correctly (72 in → 182.88 cm; 78 kg preserved). *Screenshot: live-02-metric-units.*
- **Vegan filter is airtight.** User A: 66 recipes shown / 564 hidden, **zero animal products and zero tree nuts** across all shown recipes and three generated weeks. *Screenshot: live-07-vegan-plan.*
- **Weigh-in validation is solid.** 900 lb, negative, zero, and 15 lb all rejected with 400.
- **Plan locking works.** Two locked slots survived regeneration intact.
- **Double-click safety.** Rapid double-click on the weigh-in Log button produced one upsert, not a duplicate.
- **Weigh-in → verdict → trend → projection** all compute and render correctly once data exists (rate, 7-day average, goal projection line, populated chart). *Screenshot: live-05-trend-populated.*
- **Performance is excellent.** Cold start **576–599 ms** to interactive; full-week solve **270–303 ms**; tab switches instant (~20 ms under the harness's settle wait). Well inside the "a few seconds" target.
- **Durability.** Hard-killing the app mid-`generate` left the SQLite DB fully intact on relaunch (42-slot plan, profile, all readable) — the rollback journal did its job.
- **First-launch template copy works.** A true first launch created a 2.8 MB `cutprotocol.db` from the bundled template.
- **Small-window resize is safe.** At 500×400 there is **no horizontal overflow** (content stacks). *Screenshot: live-06-tiny-window.*

## Method notes & limitations

- Playwright `_electron` drove the real installer output; API calls ran inside the app's authenticated renderer (same cookies as the UI).
- Two apparent issues were **my harness's fault, not the app's**, and are excluded from findings: an ambiguous `has-text("Log")` selector once clicked "Log out" instead of the weigh-in Log; and a first automation pass caught the aggressive-rate Finish button in the render frame before its disabled state committed (a Playwright actionability race) — the controlled re-test proved the gate works.
- Some wizard steps (occupation typeahead) were flaky to automate; where automation stalled I set the profile through the same PUT the wizard uses and reloaded, and said so. The wizard's own inputs (units, stats, rate gate) were verified by direct UI driving.
- AI generation could not be exercised (401/no valid key), so the generated-draft validator gate was not live-tested end to end.

**Reproduction:** harness and per-step scripts in the session scratchpad (`liveaudit/harness.mjs`, `s0*_*.mjs`, `allergenScan.mjs`). The packaged DB is a copy of the shipped template; the real desktop DB was moved aside and restored.
