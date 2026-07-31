# PROMPT — Cut Protocol: make it actually work

*Derived from the seven-lane state-of-play review, 2026-07-31. Paste into a
fresh session with access to this machine. Work top to bottom; the order is
load-bearing.*

---

## The premise

The owner is not using this app because **it does not work correctly yet**. He
is still in build mode, not use mode. That is his own account and it overrides
any theory a reader might construct from usage data being empty.

This matters for prioritisation: **correctness work is not a detour from
adoption, it is the path to it.** Do not propose growth, packaging, marketing,
mobile ports or new features. The job is to make the numbers this app produces
trustworthy enough that its one user reaches for it instead of the tool he
currently uses.

The single sharpest illustration: his profile currently prescribes **2,979
kcal** against the **2,150** he independently verified. Whatever else is true,
the app is telling him to eat a number that is wrong by 39%.

---

## Before you touch anything

Read these, in order:

1. `docs/state-of-play-prompt.md` — the research prompt that produced the
   findings below, including its evidence standard and arm-check rule.
2. `CLAUDE.md` — the project ruleset. Note the section
   **"Superseded claims — READ THIS FIRST"**: this project's documentation is
   known to overstate its own completeness. Verify before trusting any status
   claim, including the ones in this file.
3. Every `user_*.md` and `feedback_*.md` in
   `C:\Users\<account>\.claude\projects\C--Users-<account>\memory\` —
   binding on tone and on what to propose.

**The rule that matters most here**, learned the expensive way on this codebase:

> **Never let the process that makes a change also certify it.**

Four separate automated heuristics were tried on the food-provenance problem —
head-noun matching, USDA category, weak-match detection, calorie sanity bands —
and every one produced false positives in *both* directions. What worked was two
independent passes: one to make the change, a second, separate one to check it,
which rejected 27% of the first's output. Apply that structure to every task
below that touches data or safety logic.

---

## Working agreement

- **One change at a time.** Land it, verify it, commit it, then move on. Do not
  batch. The owner has stated this explicitly and the project's history shows
  why: seven separate repair passes on one root cause, because each was declared
  done before it was checked.
- **Verify against the artifact, not the plan.** Run the app, query the
  database, read the rendered screen. `PROGRESS.md` is not evidence.
- **Every fix needs a test that could actually fail.** State, in the commit
  message, what would have to break for the test to catch it. If you cannot
  answer that, the test is decorative.
- **Arm check on every verification.** Say what you examined and what you did
  not. A pass over a near-empty scope is *inconclusive*, never *clean*. CI
  currently seeds 28 foods against a 14,151-row library — that is exactly this
  mistake, already shipped.
- **Read-only until you know the shape.** Snapshot `backend/prisma/dev.db` and
  query the copy before writing anything to it.
- Commit each task separately with a message that explains *why*, in the style
  of the existing history. Do not push without asking.

---

## Task 1 — Make the app stop lying on the two screens he uses

**Why first:** 128 recipes currently put an unmarked, confident, wrong number on
the daily ring. Everything else on this list is worthless while that is true.

The repair on 2026-07-31 quarantined 77 food rows whose macros belong to a
different food. `foodValidation.js` exposes `QUARANTINE_SOURCE`, `isQuarantined`
and `recipeDataConfidence`, and they work — `recipeDataConfidence` returns
`complete: false` and names the offending ingredient.

But the warning is wired into `FoodsTab.jsx` and `RecipesTab.jsx` only.
`PlanTab.jsx` and `TodayTab.jsx` contain **zero** references to it, and
`backend/src/lib/planContext.js` never checks a food's `source`.

**Do:** surface untrusted-ingredient state on Today and Plan. A recipe built on
a quarantined food must read as incomplete rather than showing a total. Follow
the design constitution in `CLAUDE.md` — this is not an error state, so no red;
use `--warn` amber and supportive copy.

**Verify:** find a recipe that references a quarantined food, open Today with it
in a slot, and confirm the screen says so. Then confirm a clean recipe still
shows its number normally — a warning that fires on everything is the same bug
in the other direction.

---

## Task 2 — Fix the target the app gives its user

Establish why the profile derives 2,979 kcal when the verified figure is 2,150.
Candidates, in the order worth checking: a stale `targetKcal` that was never
re-materialised after a profile change; an occupation multiplier or training
kcal/day that no longer matches reality; a body-fat value that unlocked the
LBM-based formulas and shifted the mean; or the rate-of-loss setting.

`bmrEngine.js` is sound — its ten formulas were verified against their published
coefficients. Assume the inputs or the reconciliation are wrong before assuming
the maths is.

**Do:** find the actual cause, fix it, and make the Engine screen show the
derivation so a wrong input is visible rather than inferred.

**Verify:** the number the app shows matches a hand-computed value from the
owner's real profile. Show the arithmetic in the commit message.

---

## Task 3 — Close the door that mints wrong rows

`ingredientResolver.js` `usdaCandidateAcceptable()` asks whether the candidate
description *contains* the query's words. FDC descriptions are head-noun first,
so `"Bread, potato"` matched `"Potatoes"`. Until this changes, every recipe
import can create fresh corruption and the whole repair repeats.

**Do:** require the query's principal noun to be the candidate's **head term**,
keeping the existing `DENSITY_TOKENS` ban as a secondary filter. This is the
same inversion already applied to the installer payload — a denylist over an
open set cannot stay correct, so enumerate what is allowed instead.

**Beware:** USDA descriptions often lead with a *taxonomy* word rather than the
food (`"Spices, pepper, black"`, `"Soup, stock, chicken"`, `"Nuts, coconut
meat"`). A naive head-noun rule flags all of those as mismatches. It must skip
leading category terms. This exact mistake was made during the review and caught
only by reading the output.

**Verify with a corpus, not an example.** Build a fixture from known cases in
both directions — must ACCEPT: `Aubergine→Eggplant, raw`, `Courgettes→Squash,
zucchini`, `Passata→Tomato, puree`, `Peppercorns→Spices, pepper, black`,
`Soya Bean→Soybeans`, `Natural Yoghurt→Yogurt, plain`. Must REJECT:
`Potatoes→Bread, potato`, `Rice→Rice crackers`, `Plum Tomatoes→Plums, raw`,
`Harissa Spice→Spices, basil`, `Vegetable Stock Cube→chicken broth`,
`Melted Butter→Yogurt Melts`. The test asserts the full matrix.

---

## Task 4 — Make the safety net cover something

Three findings, one theme: the checks in place cannot fail.

- **CI seeds 28 foods and 26 recipes** (`ci.yml`, `seedRecipes.js`), so the
  "Monte-Carlo P0 gate" certifies 0.2% of the library. Seed the real template
  database, or state honestly in the job name what fraction is covered.
- **`qc:all` is not in CI at all**, and no test asserts anything about the real
  food table. Add a provenance test that fails on a name↔record mismatch — with
  an **arm check that fails the suite when too few rows fall in scope.**
- **`scanSecrets.test.js:50`** writes a file containing a key-shaped string plus
  a NUL byte and asserts the scanner finds nothing. Combined with
  `dietaryFilter.js` carrying NUL bytes, that permanently exempts ~115 KB of the
  most safety-critical source from the secret scan, with a passing test
  defending it. Strip the NUL bytes; change the test to assert the scanner
  *reports* an unscannable file rather than silently skipping it.
- Minor, while in there: `relay/test/relay.test.js:20` holds an obvious fixture
  key that trips the scanner. Append `// scan:allow` per the scanner's own
  documented mechanism.

---

## Task 5 — Stop the app contradicting itself

- `FoodsTab.jsx:355` tells the user the food diary is "not built yet." It
  shipped — 528 route lines, wired into Today.
- `README.md` carries three stale numbers.
- `BATTLE-PLAN.md` has 64 checkboxes and zero ticked, though Phase 0 is
  verifiably done.
- `CLAUDE.md`'s superseded-claims table is itself now stale on two rows: the
  packaging inversion is finished, and both named hardcoded-hex violations are
  fixed.
- `CLAUDE.md` cites `dietaryFilter.js` at 1,779 lines; it is 1,974.

Fix the text to match reality. Where a doc records history, date the entry
rather than editing the past.

---

## Task 6 — Reduce the surface that has to stay correct

Only two features have real use: the TDEE/profile engine and the meal solver.
Verify that independently before acting on it — then propose (do not
unilaterally delete) what to cut. Candidates by measured use: barcode import
(0 UPCs in 14,151 foods), the URL importer (1 recipe of 910), training (1 plan,
created by a QA account), cart and ratings (empty), and roughly 31% of the
brain, which is self-declared dormant with 8 Prisma tables at zero rows.

Present this as a list with evidence and let the owner decide. Deleting working
code is his call, not yours.

Separately, and safe to do without asking: `.qc-scratch-agent*` directories
(378 MB), 33 database backups (404 MB), and 12 full `dev.db` copies under
`solver-brain/` (261 MB) are disposable. Roughly 1.9 GB of 3.8 GB. Confirm each
is reproducible before removing it, and leave the most recent backup of each
kind.

---

## What is deliberately NOT on this list

- **No new features.** Nothing here adds capability.
- **No mobile port, no hosting, no packaging work.** The review floated a phone
  theory; the owner has corrected it. The blocker is correctness.
- **No refactoring of the god-files** (`dietaryFilter.js` at 1,974 lines,
  `mealSolver.js`, `PlanTab.jsx`). They are large but they work and they are
  tested. Rewriting them now trades a known-good component for an unknown one
  while the actual defects sit elsewhere.
- **No pushing to origin without asking.** `master` has been frozen at `8796f5f`
  since 2026-07-24 and HEAD is 66 commits ahead on `fix/audit-remediation`. That
  is a real data-loss exposure — 41 of those commits are in no bundle either —
  but it is the owner's call how and when the public repo moves.

---

## Done means

For each task: the change is committed with a message explaining why; a test
exists that would fail if the fix regressed, and the commit says what that test
would catch; and the verification states what was examined and what was not.

For the set: the owner can open the app, see a target that matches his own
arithmetic, and be told plainly when a number cannot be trusted.

That is the bar. Not "phase complete."
