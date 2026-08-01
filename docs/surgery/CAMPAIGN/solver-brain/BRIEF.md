# SOLVER BRAIN — shared agent brief (read this first, every agent)

You are one agent in a 25-agent feasibility study. Your own assignment arrives in
your prompt. This file is the shared contract. **Read it fully before acting.**

## The mission

Determine whether Cut Protocol's meal solver can reach **85–99 % macro compliance** —
theoretically and technically — and if so, by what mechanism and at what cost.
This is a **feasibility study, not an improvement campaign.** A well-evidenced
"no, the ceiling is 82 %, here is the proof" is a **complete success**. A vague
"promising, needs more work" is a **failure**.

## The number, exactly as defined

**"Days in band"** = share of planned days whose totals satisfy **all four** macro
rules, defined in one place: `backend/src/lib/mealSolver.js` → `dayTolerance()`.

| macro | rule |
|---|---|
| calories | within ±15 % of target |
| protein | no more than 15 % short of band midpoint (over is never a miss) |
| fat | no further than 25 % of band midpoint outside `[fatLo, fatHi]` |
| carbs | same 25 % allowance, but **zero upward allowance on a keto target** |

Bands come from `bmrEngine.computeMacros()`. Protein band is `lbm_lb × 1.14…1.25`;
**fat is `lbm_lb × 0.34…0.40`, roughly ±8 % around its own midpoint.**

## Current measured state

250 simulated customers / 578 planned days, `BRAIN=off`, deterministic,
run-to-run variance **±1.5 points**.

| population | days in band |
|---|---|
| all 578 days | **70.1 %** (405/578, CI 66.2–73.7) |
| satisfiable configs only | **77.8 %** (385/495) |
| no dietary style — 80 customers, mainstream case | 90.6 % |
| keto (14) · genuine vegan · vegetarian (21) | 62.0 % · 59.3 % · 58.7 % |

**Three load-bearing properties.** Any mechanism that raises compliance while
breaking one is **disqualified**, and saying so is part of your job:
- 0 confirmed allergen leaks across 250 customers
- 100 % honesty-on-miss (every out-of-band day carries a warning/diagnosis)
- 0 kcal drift between stored slot totals and recomputation from raw `Food` rows

## The denominator problem

83 of the 578 days belong to customers engineered to be **unsatisfiable** (vegan +
soy + gluten + peanut + tree nut + sesame + legumes excluded, against an LBM-derived
protein floor). Correct output is a refusal, not a plan. That puts a hard ceiling
near **88 %** on all-days.

- **all 578 days:** 85 % plausible; **99 % arithmetically impossible**
- **satisfiable-only (495 days):** 85 % genuinely open — **this is the real question**

**A3 owns the audit of this tier** (`docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.mjs`).
Unless A3's `FINDINGS.md` says otherwise, **report satisfiable-only as your primary
number, all-days as secondary.**

**Any claim above 90 % on all 578 days is evidence of a broken measurement.**
Treat it as a bug in your own work and go find it.

## RULES OF ENGAGEMENT — the owner is asleep. Hard stops, not guidelines.

- **Port 3001 is the owner's live app with real personal data.** Never probe it,
  never reference it, never kill a process you did not start. Use **3900–3999** only.
- **Never write to `backend/prisma/dev.db`.** It is read-only to this entire fleet.
- **`git push` is denied.** Do not attempt it, do not look for another route.
- **Do not modify product code in `backend/src/`.** Prototypes live in your own
  artifact directory and import product code read-only. If your assignment says to
  prototype a patch, you work on a **copy** under your own directory.
- **`.claude/hooks/guard-*.js` blocks acts outside the incision manifest. A guard
  block is a stop sign, not a puzzle.** Record it in your artifact, stay in your own
  directory, never attempt to disable, edit, or bypass a hook.
- **Do not delete anything you did not create.**
- **If genuinely blocked: write the blocker into your artifact and stop.** Do not
  burn hours retrying. A documented blocker is a finding.
- **Tool-call ceiling: ~40 for research agents, ~80 for experiment agents.** If you
  hit it, write what you have and stop. **Partial results on disk beat a perfect
  agent that never finishes.**

## Infrastructure contract — non-negotiable

**DB isolation — the known failure mode on this machine.** Agents sharing
`node_modules` also share the Prisma DB unless the URL is **absolute**. Every agent
that runs a solve does this first:

```bash
mkdir -p docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>
cp backend/prisma/dev.db docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>/dev.db
# then on EVERY command:
DATABASE_URL="file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>/dev.db"
```

**An absolute path. A relative one silently resolves to the shared DB and quietly
poisons every other agent's run.**

**Put your agent id in EVERY filename you write.** Any shared filename in a
concurrent fleet will eventually cross two identities and manufacture a finding out
of nothing — this has already happened twice on this project.

**The measurement tools already exist. Do not build a new harness.**

| tool | what it is |
|---|---|
| `backend/scripts/qc/mc.mjs` | Monte-Carlo runner, in-process (no HTTP, no ports) |
| `backend/scripts/qc/runSolve.mjs` | Uses the exact call sequence of `POST /plans/generate` — grades the shipping product |
| `backend/scripts/qc/oracle.mjs` | **Independent verifier.** Imports *no* `src/lib` engine module. **Use it for every headline number** — it is your defence against the engine grading itself |
| `backend/scripts/qc/genProfile.mjs` | Seeded profile generator. Picks diet **uniformly** across 9 styles |
| `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/fleet.mjs` + `stats.mjs` | The 250-persona HTTP fleet, ~80 s, $0.00, Wilson intervals. **This is the canonical metric** |
| `.../personas.mjs` | The 250 personas — **weighted** realistic diet mix + difficulty tiers |

`genProfile.mjs` and `personas.mjs` are **different populations**. Never mix the two
denominators in one table.

**Seeds.** Every run records its seed. Every claim cites the seed that produced it.
A number without a seed is not a result.

**`BRAIN=off` for everything.** If you believe you need `BRAIN=on`, write down why
and stop rather than spending.

## What has already been tried — DO NOT REDISCOVER THIS

The number moved **40.8 % → 70.1 %** in a prior campaign. Detail in
`docs/surgery/CAMPAIGN/RESEARCH-BRIEF-macro-compliance.md` §4.

| change | effect |
|---|---|
| Corrected 17 `Food` rows carrying another food's macros + backfilled 3 never-populated columns | 40.8 → 49.3 % |
| Composition-aware sampling (`pickRecipe` weighted by protein-per-kcal only) | 49.3 → 53.3 % |
| Adaptive slot-attempt budget, pool-scaled `max(5, min(20, n/10))` | 53.3 → 60.4 % |
| Un-quarantined ~30 staple `Food` rows + authored 21 recipes | 60.4 → 65.9 % |
| Macro closer (adds a small allergy-filtered component) | 65.9 → **70.1 %** |

**Two negative results — do not repeat them:**
1. **Search depth stops paying.** Attempts 5 → 12 → 20 → 30 gave 53.3 → 60.2 → 60.4
   → 61.8 %. Flat after ~12. A *flat* budget of 20 made thin pools **worse**
   (36-recipe fixture fell 6/7 → 4/7 days) — deep per-slot search exhausts a small
   pool and starves later slots.
2. **A systematic scan for bad food rows found nothing new.** Wrong-food errors are
   Atwater-consistent by construction, so **no arithmetic check can find them.**

**The structural fact motivating most of this study: 68.3 % of slots that MISSED
tolerance were pinned at a 0.5× or 2.0× scale bound**, against 39.3 % of all slots.
Two thirds of every failure was the solver **out of room**, not choosing badly.
Widening the bounds is the obvious move and it is the wrong one — customers rejected
exactly what that produces ("625 g chicken with 2 g pine nuts").

## INTEGRITY RULES — the ways to cheat, named

If you find yourself reaching for one, **that is the finding** — write it up as
"the metric can be gamed thus" rather than doing it.

1. **Do not widen tolerance bands to raise a score.** Whether they are
   *nutritionally* correct is A4's job — a citation question, answered independently
   of its effect on the metric, with before/after disclosed **separately**.
2. **Do not weaken the exclusion gate.** Allergen leaks are 0. A change that raises
   compliance and leaks is an automatic fail.
3. **Do not degrade honesty-on-miss.** Suppressing a warning is not a fix.
4. **Do not exclude hard customers from a denominator.** Slice freely; hide nothing.
5. **Do not invent nutrition data.** Every value traces to a real record.
6. **Do not fabricate a measurement.** Every number carries its seed and its command.
7. **Beware your own tooling.** Read
   `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/HARNESS-INCIDENT.md` — a
   confident, false finding manufactured by the previous campaign's own harness.
   **A 5× discrepancy is a bug in your instrument until proven otherwise.**
8. **Determinism is not validity.** Reproducing your own number twice proves
   reproducibility. Use `oracle.mjs` for anything load-bearing.
9. **Distinguish measured from estimated in every sentence carrying a number.**
10. **Report negative results with the same prominence as positive ones.**

## ANTI-SLOP — how not to produce confident nonsense

**The failure mode of a 25-agent fleet is not being wrong. It is producing a large,
fluent, beautifully-formatted document that nobody can check.**

### The claims ledger — the enforcement mechanism

Every agent that produces a number appends one **tab-separated** line to
`docs/surgery/CAMPAIGN/solver-brain/CLAIMS.tsv`:

```
agent_id <TAB> claim <TAB> value <TAB> exact_command <TAB> seed <TAB> artifact_path
```

Append with a shell redirect (`>>`), never by rewriting the file — other agents are
appending concurrently. **A number that is not in `CLAIMS.tsv` may not appear in
`REPORT.md`.** A22 re-runs the ledger top to bottom.

### The rules

1. **No number without the command and seed that produced it.**
2. **No file, function, or line citation you have not opened. Quote 3–10 words of
   the actual text. If you cannot quote it, you did not read it — do not cite it.**
3. **No external citation without title, author/organisation, year, and URL.** A23
   verifies every one. A plausible-sounding study that does not exist is the single
   most damaging thing Phase 2 can produce.
4. **A25 may not introduce any number that does not already appear in an agent's
   `FINDINGS.md`.**
5. **No agent summarises another agent's work from its title or filename.** Read the
   artifact, or write "not read".
6. **"NOT REACHED" is a first-class result.** Blocked by a guard, out of budget, tool
   failed, question malformed — write that, with the reason. **An agent that invents
   a plausible finding to avoid an empty section has destroyed more value than it
   could ever add.**
7. **Banned words in findings:** *robust, comprehensive, significant* (unless you
   computed an interval), *promising, clearly, obviously, as expected,
   industry-standard, best practice, deep dive, leverage.*
8. **Lead with the null result** when you have one.
9. **Do not restate this prompt back.** Findings open with what you found.
10. **Length discipline: `FINDINGS.md` ≤ 400 words plus tables and data.** Padding is
    the tell.
11. **Tag every claim** — **MEASURED** (command + seed), **DERIVED** (arithmetic on
    measured values; show the arithmetic), or **ESTIMATED** (judgment; say what would
    test it). An untagged claim is treated as ESTIMATED by A24.
12. **Contradiction beats consensus.** If your result disagrees with another agent,
    the research brief, or this brief — **say so loudly and show your evidence.**
    This brief contains at least one number that will not survive contact with the
    data. Finding it is a result, not an embarrassment.
13. **Never re-run a surprising result until it looks normal.** Record the surprise
    and its seed, then investigate the instrument.

### The worked example — learn from this exact failure

A parallel cloud investigation reported a **6.3 %** baseline for this app and framed
it as "the true floor." The desktop had measured **40.8 %** on the same code. The gap
was not a discovery — it was four confounded differences in its own harness (a
626-recipe library against the real 910, absent food corrections, a substituted data
layer, and a uniform diet mix against a weighted one). It was reported confidently,
with a reproducibility claim ("bit-identical replay verified") standing in for a
validity claim.

**That is the shape to avoid: a real measurement of the wrong thing, delivered with
conviction.**

## YOUR DELIVERABLE

`docs/surgery/CAMPAIGN/solver-brain/<YOUR-ID>/FINDINGS.md`, written **as you go**,
not at the end. If the session dies at 4 a.m., what is on disk is the deliverable.
Keep raw JSONL/CSV in the same folder.

**It must end with a one-line verdict: `CONFIRMED`, `FALSIFIED`, or
`NOT REACHED — <why>`.**
