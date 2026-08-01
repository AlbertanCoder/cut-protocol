# SOLVER BRAIN — a 25-agent feasibility study

**Paste this whole file into a fresh Claude Code session at
`C:/Users/<account>/Desktop/cut-protocol/`.** It assumes no prior context. It will run
unattended for several hours while the owner sleeps. Read §1 before doing anything.

---

## 0. THE MISSION

**Determine whether Cut Protocol's meal solver can reach 85–99 % macro compliance —
theoretically and technically — and if so, by what mechanism and at what cost.**

This is a **feasibility study, not an improvement campaign.** You are not being asked to
raise the number tonight. You are being asked to answer, with measurements rather than
opinion:

1. **Where is the ceiling**, and what sets it — arithmetic, library, or algorithm?
2. **Is 85–99 % reachable at all**, and on which population?
3. **If yes, by what mechanism**, with a measured effect size for each candidate.
4. **If no, what is the highest reachable number**, and what is the binding constraint?

A well-evidenced "no, the ceiling is 82 % and here is the proof" is a **complete
success**. A vague "promising, needs more work" is a failure. **Kill hypotheses
cleanly.** The owner has explicitly said they are not asking for a yes/no opinion —
they are asking for the study that produces one.

---

## 1. RULES OF ENGAGEMENT — THE OWNER IS ASLEEP

You are running unattended. Everything here is a hard stop, not a guideline.

- **Port 3001 is the owner's live app with real personal data.** Never probe it, never
  reference it, never kill a process you did not start. Use **3900–3999** only.
- **Never write to `backend/prisma/dev.db`.** Every agent works on its own copy (§4).
  The live DB is read-only to this entire fleet.
- **`git push` is denied** in `.claude/settings.json`. Do not attempt it, do not ask for
  it to be lifted, do not look for another route to a remote.
- **Do not modify product code in `backend/src/`.** This is a research fleet. Prototypes
  live in `docs/surgery/CAMPAIGN/solver-brain/` and import product code read-only. The
  one exception is an agent explicitly told below to prototype a patch — and even then
  it works in a **copy** under its own artifact directory, never in `src/`.
- **`.claude/hooks/guard-*.js` will block acts outside the current incision manifest.
  A guard block is a stop sign, not a puzzle.** Record it in your artifact, work around
  it by staying in your own directory, and never attempt to disable, edit, or bypass a
  hook.
- **Do not delete anything you did not create.**
- **If you become genuinely blocked, write the blocker into your artifact file and
  stop that agent.** Do not burn hours retrying. A documented blocker is a finding.
- **Token budget.** 25 agents doing deep work is real spend. Set each agent a hard
  ceiling of roughly 40 tool calls for research agents and 80 for experiment agents. If
  an agent hits it, it writes what it has and stops. **Partial results on disk beat a
  perfect agent that never finishes.**

---

## 2. THE NUMBER, EXACTLY AS DEFINED

**"Days in band"** = the share of planned days whose totals satisfy **all four** macro
rules. One definition, in `backend/src/lib/mealSolver.js` → `dayTolerance()`:

| macro | rule |
|---|---|
| calories | within **±15 %** of target |
| protein | no more than **15 % short** of the band midpoint (over is never a miss) |
| fat | no further than **25 % of the band midpoint** outside `[fatLo, fatHi]` |
| carbs | same 25 % allowance, but **zero upward allowance on a keto target** |

The bands come from `bmrEngine.computeMacros()`. Note their width before forming any
view: protein is `lbm_lb × 1.14…1.25`; **fat is `lbm_lb × 0.34…0.40`, roughly ±8 %
around its own midpoint** — tighter than any published dietary guideline expresses.

**Current measured state** — 250 simulated customers / 578 planned days, `BRAIN=off`,
deterministic, run-to-run variance **±1.5 points**:

| population | days in band |
|---|---|
| all 578 days | **70.1 %** (405/578, CI 66.2–73.7) |
| satisfiable configs only | **77.8 %** (385/495) |
| no dietary style — 80 customers, the mainstream case | 90.6 % |
| keto (14) · genuine vegan · vegetarian (21) | 62.0 % · 59.3 % · 58.7 % |

**Three properties are load-bearing.** Any proposed mechanism that raises compliance
while breaking one of these is disqualified, and saying so is part of your job:

- **0 confirmed allergen leaks** across 250 customers.
- **100 % honesty-on-miss** — every out-of-band day carries a warning or diagnosis.
- **0 kcal drift** between stored slot totals and recomputation from raw `Food` rows.

---

## 3. THE DENOMINATOR PROBLEM — RESOLVE THIS BEFORE ANYTHING ELSE

**83 of the 578 days belong to customers engineered to be unsatisfiable** — vegan *plus*
soy, gluten, peanut, tree nut, sesame and legumes excluded, against an LBM-derived
protein floor. No combination of library rows satisfies them. The correct output is a
refusal, not a plan.

**That puts a hard ceiling near 88 % on the all-days figure even with a perfect
solver.** So "85–99 %" is two different questions depending on the denominator:

| denominator | 85 % | 99 % |
|---|---|---|
| all 578 days | plausible, near the ceiling | **arithmetically impossible** unless the impossible tier is mis-specified |
| satisfiable configs only (495 days) | **genuinely open — this is the real question** | open, probably hard |

**Agent A3 owns this and reports first.** Do not treat 88 % as received wisdom — audit
it. The impossible tier is defined in
`docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.mjs`. If it is
over-inclusive, the ceiling moves and every other agent's denominator changes. If it is
correct, **every downstream agent reports satisfiable-only as its primary number.**

**Any claim above 90 % on all 578 days is evidence of a broken measurement.** Treat it
as a bug in your own work and go find it.

---

## 4. INFRASTRUCTURE CONTRACT — NON-NEGOTIABLE

The machine has **20 cores**; the DB is **22 MB**. Real parallelism is available, and
these rules are what keep 25 agents from corrupting each other's results.

**Database isolation — the known failure mode on this machine.** Agents sharing
`node_modules` also share the Prisma DB unless the URL is absolute. Every agent that
runs a solve does this first:

```bash
mkdir -p docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>
cp backend/prisma/dev.db docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>/dev.db
# then, for every command that agent runs:
DATABASE_URL="file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>/dev.db"
```

**An absolute path. A relative one will silently resolve to the shared DB and quietly
poison every other agent's run.**

**The measurement tools already exist. Do not build a new harness.**

| tool | what it is | why it matters |
|---|---|---|
| `backend/scripts/qc/mc.mjs` | Monte-Carlo runner, **in-process** (no HTTP, no ports). `node scripts/qc/mc.mjs --n 10000 --seed 42 --quiet` | The overnight engine. Streams JSONL, aggregates by diet × allergy-stack corner, ranks failure patterns |
| `backend/scripts/qc/runSolve.mjs` | Uses the **exact call sequence** of `POST /plans/generate` | What it grades is the shipping product, not a reimplementation |
| `backend/scripts/qc/oracle.mjs` | **Independent verifier.** Imports *no* `src/lib` engine module; separately-curated allergen list; policy constants inlined with a drift test | This is your defence against the engine grading itself. **Use it for every headline number.** |
| `backend/scripts/qc/genProfile.mjs` | Seeded profile generator | Note: picks diet **uniformly** across 9 styles |
| `qa/qa-fleet-20260729-2032/fleet.mjs` + `stats.mjs` | The 250-persona HTTP fleet, ~80 s, $0.00, Wilson intervals | The number in §2 came from here. **This is the canonical metric** |
| `qa/.../personas.mjs` | The 250 personas — **weighted** realistic diet mix + difficulty tiers | Different population from `genProfile.mjs`. Never mix the two denominators in one table |

**Seeds.** Every run records its seed. Every claim cites the seed that produced it. A
number without a seed is not a result.

**`BRAIN=off` for everything.** The app's LLM path costs money and adds nondeterminism;
the solver work is deterministic and free. If an agent believes it needs `BRAIN=on`, it
writes down why and stops rather than spending.

**Artifacts.** Every agent writes to
`docs/surgery/CAMPAIGN/solver-brain/<AGENT-ID>/FINDINGS.md` **as it goes**, not at the
end. That directory is gitignored-adjacent and large; keep raw JSONL in the same folder.
If the session dies at 4 a.m., what is on disk is the deliverable.

**Concurrency.** Phase 4 experiment agents each spawn real solver runs. Run **at most 8
concurrently**. Phases 2 and 3 are read-only and may run wider.

---

## 5. WHAT HAS ALREADY BEEN TRIED — DO NOT REDISCOVER THIS

The number moved **40.8 % → 70.1 %** in a prior campaign. Full detail in
`docs/surgery/CAMPAIGN/RESEARCH-BRIEF-macro-compliance.md` §4. Summary:

| change | effect |
|---|---|
| Corrected 17 `Food` rows carrying another food's macros (`Potatoes` held *bread*; `Chicken Breast` held *breaded tenders*) + backfilled three designed-but-never-populated columns | 40.8 → 49.3 % |
| Composition-aware sampling (`pickRecipe` weighted by protein-per-kcal only; fat/carb entered a step too late) | 49.3 → 53.3 % |
| Adaptive slot-attempt budget, pool-scaled `max(5, min(20, n/10))` | 53.3 → 60.4 % |
| Un-quarantined ~30 staple `Food` rows + authored 21 recipes | 60.4 → 65.9 % |
| Macro closer — adds a small allergy-filtered component when scaling alone cannot land the day | 65.9 → **70.1 %** |

**Two negative results — do not repeat them:**

1. **Search depth stops paying.** Attempts 5 → 12 → 20 → 30 gave 53.3 → 60.2 → 60.4 →
   61.8 %. Flat after ~12. A *flat* budget of 20 made thin pools **worse** (a 36-recipe
   fixture fell 6/7 → 4/7 days) because deep per-slot search exhausts a small pool and
   starves later slots.
2. **A systematic scan for bad food rows found nothing new.** The wrong-food errors are
   Atwater-consistent by construction, so **no arithmetic check can find them.** The
   ~450 remaining self-declared rows are the work list and there is no cleverer detector
   to build.

**The structural fact that motivates most of this study: 68.3 % of slots that MISSED
tolerance were pinned at a 0.5× or 2.0× scale bound**, against 39.3 % of all slots. Two
thirds of every failure was the solver **out of room**, not choosing badly. Widening the
bounds is the obvious move and it is the wrong one — customers rejected exactly what
that produces ("625 g chicken with 2 g pine nuts").

---

## 6. THE FLEET — 25 AGENTS IN SIX PHASES

Each agent gets: an **ID**, a **falsifiable question**, a **method**, and a
**deliverable**. Every deliverable ends with a one-line verdict: **CONFIRMED**,
**FALSIFIED**, or **NOT REACHED — why**.

### PHASE 1 — Instrument and anchor (3 agents, must complete before Phase 4)

**A1 · Rig.** Build the shared experiment rig: DB-copy helper, seed registry, a single
result schema every experiment writes, and a `compare.mjs` that takes two result sets
and reports the delta with a Wilson interval. *Deliverable:* the rig, plus a worked
example showing a same-seed A/B of a no-op change returning zero delta. **Everything
downstream depends on this; it ships first.**

**A2 · Failure taxonomy.** For every one of the 173 currently-missed days, classify the
binding constraint: pinned at scale bound / pool exhausted / fat out of band / protein
short / kcal out / structurally infeasible. *Deliverable:* a table with counts and
percentages, per diet. **This table is the map the whole study navigates by** — if
80 % of misses are one cause, that is the answer to the mission question.

**A3 · Ceiling audit.** Own §3. Is the 83-day impossible tier correctly specified? For
each, prove infeasibility from the library rather than asserting it — a protein floor
that no combination of surviving rows can reach. *Deliverable:* structurally impossible
vs pool-limited vs solver-limited, with counts and the arithmetic. **Report first; the
rest of the fleet inherits your denominator.**

### PHASE 2 — Theory and literature (5 agents, read-only, no DB)

**A4 · Is the fat band defensible?** `lbm×0.34–0.40` is ±8 %. Find what actual dietary
guidance says about fat-intake precision (AMDR, ISSN, ACSM, position stands). *Question:*
is a ±8 % window a nutritionally meaningful pass/fail boundary, or an arbitrary one?
*Deliverable:* cited findings, and a defensible alternative band **if the evidence
supports one** — with the explicit note that changing it is the owner's call, not yours.

**A5 · The diet problem.** Stigler onward: LP/MIP formulations of macro-constrained meal
selection. What compliance do published formulations achieve, on what constraint counts,
and what makes instances infeasible? *Deliverable:* what the literature says is
achievable, and which formulation class this app's problem actually belongs to.

**A6 · Industry convention.** How do shipping apps (MacroFactor, Eat This Much, Fitia,
Prospre, Carbon, RP) define "hit your macros"? What tolerance do they use, and do they
report a hit rate at all? *Deliverable:* a comparison of tolerance definitions.
**Relevance:** if the industry norm is ±20 % on fat and this app grades ±8 %, the
number is not comparable to anything, and that is a finding.

**A7 · Vegan feasibility.** Under the killer allergen stack (soy, gluten, peanut, tree
nut, sesame, legumes excluded), what plant protein sources remain, and what is the
theoretical maximum protein density achievable? *Deliverable:* is the vegan floor a
library problem or a botany problem?

**A8 · Infeasibility detection.** How do SAT/MIP practitioners separate *solver quality
on feasible instances* from *infeasibility detection*? What are the standard metrics?
*Deliverable:* a proposed KPI split for this app, with precision/recall definitions for
the refusal path.

### PHASE 3 — Code recon (4 agents, read-only)

**A9 · Solve loop anatomy.** Trace `generateBestWeekPlan` → slot loop → `pickRecipe` →
`scaleRecipe` → `dayTolerance`. Where does the search actually have freedom, and where
is it structurally constrained? *Deliverable:* the degrees of freedom, enumerated.

**A10 · The dormant optimizer.** `backend/src/lib/brain/optimizer.js` is a built,
golden-locked, **unwired** portioning solver. At k=2 it is byte-identical to the legacy
`scaleRecipe`; at k≠2 it runs a deterministic projected-gradient box least-squares
across **all four macros**. Meanwhile `weeklyPlanner.js` ~L437 asserts *"the only way to
steer fat and carbs is WHICH dish gets picked"* — which is true for two knobs and
questionable for n. *Question:* would a scale-per-role portioning path reduce bound
pinning? *Deliverable:* a feasibility assessment and the exact wiring surface
(`applyScales` at L334 hard-codes the two-way branch). **This is the highest-prior
mechanism in the study — A13 tests it.**

**A11 · Pool density.** From the real DB (910 recipes, 14,151 foods): for each diet ×
allergen-stack corner, how many recipes survive filtering, and what is the distribution
of fat-per-kcal among survivors? *Deliverable:* seven-plus CSVs and the answer to "is
this pool-limited or solver-limited, per diet?"

**A12 · Ruler coherence.** Do `dayTolerance()` and `computeMacros()` agree with each
other and with what the UI tells the customer? Is there any target a solver could hit
that the grader would still fail, or vice versa? *Deliverable:* coherence verdict.

### PHASE 4 — Live experiments (9 agents, ≤8 concurrent, each same-seed A/B via A1's rig)

Every one of these reports: **baseline, treatment, delta, Wilson CI, seed.** A delta
inside ±1.5 points is **noise, not a result** — say so.

**A13 · n-knob portioning.** Prototype A10's mechanism in a copy: bundle by `role`,
scale per role, feed `solvePortions` a four-macro target. *Primary metric:* the
**pinning rate** (currently 68.3 % of misses), not the headline rate. *Kill condition:*
pinning does not fall → the mechanism is dead, report it.

**A14 · Search budget re-sweep.** Re-run the attempts sweep under **current** code — the
5→30 curve was measured before the closer and staple fixes landed and may have moved.

**A15 · Ruler variants, re-scored without re-solving.** Take the existing per-day
records and re-grade them under 6+ alternative band definitions (fat ±10 %, ±15 %, ±20 %,
floor-based, AMDR-based, A4's recommendation). **This isolates how much of the gap is
ruler versus solver and it costs no solve time.** *This is the single most informative
cheap experiment in the fleet.*

**A16 · Pool enrichment curve.** Simulate adding N recipes targeted at the weak corners.
*Question:* how many recipes buy how many points, and where does the curve flatten?
*Deliverable:* the volume required to reach 85 % per diet — a number the owner can cost.

**A17 · Closer expansion.** The macro closer fires on only 240 of 2,432 slots (9.9 %) and
bought 4.2 points. *Question:* what gates its use, and what happens as that gate widens?

**A18 · Objective weights.** `solveGeneral` optimises at `{kcal:1, protein:1, fat:0.1,
carb:0.1}` — narrower than what `dayTolerance()` grades. Sweep the weights toward the
grading rule. **This is legitimate: the weights are the objective, not the ruler.**

**A19 · Joint vs greedy.** The solver fills slots sequentially and greedily. Prototype a
day-level joint solve. *Question:* how many points does sequential greediness cost?

**A20 · Refusal path.** Prototype up-front infeasibility detection using A8's metrics.
*Question:* can the app tell a customer "this cannot be planned" *before* solving, with
what precision and recall on the 83 known-impossible personas and **zero** false
refusals on satisfiable ones?

**A21 · Best stack.** Combine every lever that measured a real gain and run it. *This is
the closest thing to an empirical answer to the mission question.* Report against both
denominators, and **do not sum individual deltas — measure the combination**, because
levers that fix the same failure mode do not add.

### PHASE 5 — Adversarial verification (3 agents, after Phase 4)

**A22 · Replay.** Independently re-run every headline number from its recorded seed,
using `oracle.mjs` rather than the engine's own verdict. **Numbers that do not reproduce
do not ship.** *Deliverable:* a reproduce/fail table.

**A23 · Citation check.** Verify every claim Phase 2 attributes to a source. Flag
anything the source does not actually say. *The prior campaign's most valuable output
was a list of its own refuted claims.*

**A24 · Red team.** Attack the study. Which levers did the desktop campaign **already
apply** (closer, adaptive attempts, staple un-quarantine, composition-aware sampling) so
a lab gain on them is double-counting? Did any agent raise a number by widening a band,
dropping hard customers from a denominator, or grading with the engine that produced the
answer? *Deliverable:* every inflated claim, named.

### PHASE 6 — Synthesis (1 agent)

**A25 · The report.** Write
`docs/surgery/CAMPAIGN/solver-brain/REPORT.md`, in this order:

1. **The answer, in one paragraph.** Is 85–99 % feasible? On which denominator? By what
   mechanism? If not, what is the real ceiling?
2. **The ceiling decomposition** — structurally impossible / pool-limited /
   solver-limited, with counts. **This is the core scientific contribution.**
3. **Ranked lever table** — measured delta, Wilson CI, effort, confidence, what it
   would break. Discounted per A24. Speculative gains marked as such.
4. **Per hypothesis: verdict and evidence**, including everything falsified.
5. **What could not be determined, and what it would take.**
6. **What this study got wrong mid-flight and how it was caught.**

---

## 7. INTEGRITY RULES — THE WAYS TO CHEAT, NAMED

Every one of these raises the number and improves nothing. If you find yourself
reaching for one, **that is the finding** — write it up as "the metric can be gamed
thus" rather than doing it.

1. **Do not widen the tolerance bands to raise a score.** Investigating whether they are
   *nutritionally* correct is A4's job — a citation question, answered independently of
   its effect on the metric, with the before/after disclosed **separately**.
2. **Do not weaken the exclusion gate.** Allergen leaks are 0. A change that raises
   compliance and leaks is an automatic fail.
3. **Do not degrade honesty-on-miss.** Suppressing a warning is not a fix.
4. **Do not exclude hard customers from a denominator.** Slice freely; hide nothing.
5. **Do not invent nutrition data.** Every value traces to a real record.
6. **Do not fabricate a measurement.** Every number carries its seed and its command.
7. **Beware your own tooling.** Read
   `qa/qa-fleet-20260729-2032/HARNESS-INCIDENT.md` — a confident, false finding
   manufactured by the previous campaign's own harness. **Verify surprising results
   against raw DB rows before believing them.** A 5× discrepancy is not a discovery, it
   is a bug in your instrument until proven otherwise.
8. **Determinism is not validity.** Reproducing your own number twice proves
   reproducibility. Use `oracle.mjs` — an independent grader — for anything load-bearing.
9. **Distinguish measured from estimated in every sentence carrying a number.**
10. **Report negative results with the same prominence as positive ones.** A killed
    lever saves the owner a month.

---

## 7.1 ANTI-SLOP — HOW NOT TO PRODUCE CONFIDENT NONSENSE

**The failure mode of a 25-agent fleet is not being wrong. It is producing a large,
fluent, beautifully-formatted document that nobody can check.** That document is worse
than no document, because it stops someone from doing the real work. These rules exist
to make it structurally difficult.

### The claims ledger — the mechanism

Every agent that produces a number appends one tab-separated line to
`docs/surgery/CAMPAIGN/solver-brain/CLAIMS.tsv`:

```
agent_id <TAB> claim <TAB> value <TAB> exact_command <TAB> seed <TAB> artifact_path
```

**A number that is not in `CLAIMS.tsv` may not appear in `REPORT.md`.** A22 re-runs the
ledger top to bottom. Everything below is habit; this is the enforcement.

### The rules

1. **No number without the command and seed that produced it.** "Roughly", "around",
   "on the order of" are permitted only on a number you then bound.
2. **No file, function, or line citation you have not opened.** Quote 3–10 words of the
   actual text. **If you cannot quote it, you did not read it — do not cite it.**
3. **No external citation without title, author or organisation, year, and URL.** A23
   verifies every one. A plausible-sounding study that does not exist is the single
   most damaging thing Phase 2 can produce.
4. **A25 may not introduce any number that does not already appear in an agent's
   `FINDINGS.md`.** Synthesis summarises; it does not compute. If a needed number is
   missing, A25 writes "not measured" and names the agent that should have produced it.
5. **No agent summarises another agent's work from its title or filename.** Read the
   artifact, or write "not read".
6. **"NOT REACHED" is a first-class result.** Blocked by a guard, out of budget, tool
   failed, question turned out to be malformed — write that, with the reason. **An
   agent that invents a plausible finding to avoid an empty section has destroyed more
   value than it could ever add.**
7. **Banned words in findings:** *robust, comprehensive, significant* (unless you
   computed an interval), *promising, clearly, obviously, as expected, industry-standard,
   best practice, deep dive, leverage.* Each one is where a missing measurement hides.
8. **Lead with the null result** when you have one.
9. **Do not restate this prompt back.** Findings open with what you found.
10. **Length discipline: `FINDINGS.md` is ≤ 400 words plus tables and data.** Padding is
    the tell. A one-line finding with a seed beats three pages of context.
11. **Tag every claim** — **MEASURED** (command + seed), **DERIVED** (arithmetic on
    measured values; show the arithmetic), or **ESTIMATED** (judgment; say what would
    test it). An untagged claim is treated as ESTIMATED by A24.
12. **Contradiction beats consensus.** If your result disagrees with another agent, with
    the research brief, or with this prompt, **say so loudly and show your evidence.**
    This prompt contains at least one number that will not survive contact with the
    data. Finding it is a result, not an embarrassment.
13. **Never re-run a surprising result until it looks normal.** Record the surprise and
    its seed, then investigate the instrument.

### The worked example — learn from this exact failure

A parallel cloud investigation reported a **6.3 %** baseline for this app and framed it
as "the true floor." The desktop had measured **40.8 %** on the same code. The gap was
not a discovery — it was four confounded differences in its own harness (a 626-recipe
library against the real 910, absent food corrections, a substituted data layer, and a
uniform diet mix against a weighted one). It was reported confidently, with a
reproducibility claim ("bit-identical replay verified") standing in for a validity
claim.

**That is the shape to avoid: a real measurement of the wrong thing, delivered with
conviction.** Read `qa/qa-fleet-20260729-2032/HARNESS-INCIDENT.md` for the previous
instance of the same failure. **A 5× discrepancy is a bug in your instrument until you
have proven otherwise.**

---

## 8. DEFINITION OF DONE

- Every agent has a `FINDINGS.md` ending in **CONFIRMED / FALSIFIED / NOT REACHED**.
- `CLAIMS.tsv` exists, and **every number in `REPORT.md` appears in it** with a command
  and a seed. A22 has re-run the ledger and marked each row reproduced or failed.
- Every claim in every artifact is tagged **MEASURED / DERIVED / ESTIMATED**.
- `REPORT.md` exists and answers the mission question on a **named denominator**.
- Every headline number is reproducible from a stated seed and command, and was
  re-verified by A22 through `oracle.mjs`.
- The ceiling decomposition has counts that sum to 578.
- A24's inflation list is incorporated, not appended.
- The three load-bearing properties were never traded away in any proposed mechanism —
  and any mechanism that would trade one is labelled as such.
- **The live `dev.db` is byte-identical to how it started.** Verify this explicitly and
  say so in the report.

---

## 9. START HERE

1. Read `RESEARCH-BRIEF-macro-compliance.md` and `HARNESS-INCIDENT.md`.
2. Launch **A1, A2, A3** and wait for A3's denominator ruling.
3. Launch Phases 2 and 3 (9 agents, read-only, wide parallelism).
4. On A1's rig landing, launch Phase 4 at ≤8 concurrent.
5. On Phase 4 completion, launch Phase 5, then A25.
6. Leave a running status line in
   `docs/surgery/CAMPAIGN/solver-brain/STATUS.md` — updated as each agent lands, so the
   owner can see progress at a glance on waking.
