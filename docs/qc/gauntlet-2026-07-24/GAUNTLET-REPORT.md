# Cut Protocol — QC Gauntlet, 2026-07-24 (owner-facing)

Ten independent verification agents, read-only, run against the live app + copies
of your real database. Zero live model calls across the whole fleet
(`LlmUsage` row count 12 before and after every run). Every number below is from
a real command; the per-agent detail is in `qc01.md` … `qc10-verify.md`.

## Bottom line

**Real allergen leak count across the entire gauntlet: 0** — after three genuine
defects were found, fixed, and independently re-verified by a *different* agent.
The whole product was exercised in one call (allergy + cost cap + month horizon)
and came back clean.

## Scorecard

| # | Agent | Verdict |
|---|---|---|
| 1 | Single-allergen leak hunt | **FAIL → fixed → re-verified** (sweetcorn P0) |
| 2 | Combinations, styles, free-text | **leak → fixed → re-verified** (step-prose) |
| 3 | Router / AI / cache | **PASS** — cache-poisoning prevented, 0 live calls |
| 4 | Monte-Carlo (1,000 seeds, 8,694 days) | **PASS** — 0 floor/portion/drift/silent-miss/net-calls |
| 5 | The five filters | **PASS** + 1 honesty bug → **fixed → re-verified** |
| 6 | Any-horizon (1 meal → 1 month) | **PASS** — 0 leaks across all 28 days |
| 7 | Migration / upgrade safety | **PASS** — 0 row loss on 8 real databases |
| 8 | UI reachability (Chrome) | **BLOCKED at auth** — not a bug (see below) |
| 9 | Determinism / governance / full suite | **PASS** — byte-identical, 0 live calls |
| 10 | Verify-the-verifiers | **PASS** — every report reproduced raw, no rubber-stamping |

Suite at close: **84 files, 1,035 tests, 0 failures** (started the session at 926).

## The three defects that were real — found, fixed, re-verified

1. **`Sweetcorn` escaped a corn allergy (P0).** The British glued spelling was in 7
   recipes and not excluded — the taxonomy had `popcorn`/`cornbread` as their own
   glued entries but omitted `sweetcorn`. One-line fix; `Corned Beef` and `Acorn`
   correctly stay allowed. Regression-locked.

2. **Allergens cooked in via free-form step text reached the plate (P1).** The
   filter read ingredient rows + recipe title + "Add'l ingredients:" prose, but
   not the method steps — so *"stir in 1 TBSP butter"*, *"heat the ghee"*, an egg
   added to a soup, or raw fish named only in a Sushi step slipped through. A
   sweep found **20 step-only dairy leaks alone**. The full step prose is now
   matched, add-only. Negation parsing was deliberately rejected — *"add butter,
   or omit for a dairy-free version"* carries a negation word yet cooks butter in,
   so a negation-aware scan would re-open the leak. Over-exclusion is the
   constitution's only sanctioned failure direction for an allergy. **20 → 0**,
   modest pool cost (dairy 578→550).

3. **A binding-constraint headline lied (MEDIUM, mine).** When a cost/complexity/
   taste cap emptied the pool, the diagnosis blamed the *prep* cap ("removes all
   889"). Never a fake-green plan — the correct reason was always in the message
   body — but the headline was wrong. `afterPrep` is now prep-only, and the
   diagnosis names the actual binding cap.

All three were reproduced independently before being touched, and agent 10
re-verified each fix landed (it even caught the mid-run patch in real time when a
value flipped between its runs).

## What passed cleanly, and matters most

- **Router / cache safety (agent 3):** an AI recipe whose *resolved* ingredients
  carry an excluded allergen is discarded even when the model claims it's
  compliant; a recipe cached under one profile is re-screened on retrieval, so a
  differently-allergic profile is never served it. No leak through the AI or
  cache path.
- **Upgrade safety (agent 7):** your actual packaged install plus 7 backups all
  migrated to version 25 with **zero row loss**; the fdcId dedupe nulls rather
  than deletes; crash-safe and idempotent.
- **Determinism / governance (agent 9):** same seed → byte-identical plan;
  BRAIN=off is byte-identical to the library-only app (goldens locked before the
  Living-App work and held); no second model-transport path.
- **Integration reality check (agent 10):** `POST /api/plans/generate` with a real
  session, a shellfish + peanut allergy, `maxCostCad:4`, month horizon → HTTP 200,
  124/140 slots, **0 allergy leaks, 0 cost-cap leaks.**

## Honest caveats (not defects, worth knowing)

- **Match % reads rosier than day-level reality.** Headline "92–95% match", but
  only ~28–39% of days land inside the strict 4-macro tolerance — the fat/carb
  bands are narrow and 1-dish and long horizons are hardest. **Every** off-target
  day is declared (0 silent misses across 8,694 days), so it is honest, just
  optimistic-sounding. Pre-existing solver behaviour, not a Living-App regression.
- **Two of the four allergen probes carry no data yet.** `allergenTags` /
  `mayContain` are null on all foods (they only arrive via barcode import), so the
  live union is name + `fdcCategory`. `fdcCategory` is now populated on 13,516
  foods and does real work (316 gluten / 64 dairy / 120 fish foods excluded by
  category with no name token).
- **A few recipes carry whole-batch grams in a per-serving column** (e.g. 10,000 g
  peas), which inflates both their cost and their cached macros. Flagged by the
  backfill every run; a data-repair follow-up, deliberately not silently clamped.
- **UI reachability is unverified visually.** Agent 8 could not get past the login
  screen — Chrome is a separate browser from the Electron app and has no session,
  and registration is gated because your DB already has users. It confirmed the
  earlier boot dead-end is *gone* and the login renders clean. A fresh-install
  self-driven walk is the way to close this.

## How to re-run this gauntlet

The functional agents are reproducible from `backend/scripts/qc/` (Monte-Carlo
harness + independent oracle) and the committed test suite (`cd backend && npm
test`). The allergen sweep (`tests/allergySweep.test.js`) and the new
step-prose / sweetcorn regressions (`tests/qc/proseAllergen.test.js`,
`tests/allergenTaxonomy.test.js`) are the permanent guards for the leaks closed
here.
