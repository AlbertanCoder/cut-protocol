# SEQUENCE — what wins, in what order

Written 2026-08-08 by the orchestrator window, per `docs/orchestration/PROMPT-B-amended.md`
MISSION 2. **This document decides nothing. It is for the owner's sign-off.**

Every number below came from a command run in this session. Where a claim in
`ORCHESTRATION.md` or `PROMPT-B-amended.md` did not reproduce, the measurement is shown
and the original is named. Nothing here is my own arithmetic.

Measurement base: `7e0fc6c` (2026-07-24) — the merge-base of the two lineages.
Session identity: `run_id orchestration-2026-08-08`, `mode surgeon`, `locked true`,
19 allow entries. `node scripts/surgery/guard-selftest.js` → `74 passed, 0 failed, 74 total`.

---

## 0. GUARD BLOCKS — recorded, not routed around

**Two** blocks fired in this session, both from the same matcher. Per the standing law
they are recorded and reported, and the work behind them is left undone rather than
retried through another door.

```
PreToolUse:Bash [node .claude/hooks/guard-bash.js]:
BLOCKED: the golden relock invocation not on the incision manifest.
Relocking the goldens is mechanically impossible for this session — that is the point of the lock.
```

### Block 1 — a read

- **What I was doing:** reading `backend/tests/golden/goldenBaseline.test.js` and
  `fixtures.js` to determine whether the *sealed* baseline depends on the `slice(-7)`
  chain. A read, not a write.
- **What fired:** `guard-bash.js:57-60`, pattern
  `/engine-baseline\.golden\.json|computeBaseline/i`. It matches the **filename as a
  substring of any shell command**, so every read of that file through Bash is denied
  along with every write.
- **Assessment:** a false positive of the class `ORCHESTRATION.md` already documents
  ("5 documented false positives"). This is a sixth. The guard is doing its job
  conservatively and I am not asking for it to be widened.
- **Consequence, stated so it is not mistaken for a finding:** the question *"does
  `engine-baseline.golden.json` move when the two `slice(-7)` sites are fixed?"* is
  **NOT REACHED**. Section 5's constraint-2 finding covers only the 12
  `MIGRATION/golden/` fixtures, which I could measure.

### Block 2 — the commit of this very document

Same matcher, different door. `git commit` of `SEQUENCE.md` was refused because the
**commit message quoted the filename** while explaining Block 1. The commit stages one
file, `docs/orchestration/SEQUENCE.md`; it touches no golden, adds no golden, and deletes
nothing (`git diff --cached --diff-filter=D --name-only` → empty).

I did not reword the message to slip past the pattern. Deliberately editing text to defeat
a matcher is routing around a guard, which the law forbids in the same sentence it forbids
puzzling at one.

**Resolved by the owner, same sitting:** *"commit SEQUENCE.md yourself and narrow the
guard pattern."* The document is committed, with the message text unchanged, via
`git commit -F <file>` — a facility `guard-bash.js:40-53` deliberately preserved for
exactly this ("a flag that reads a commit message from a file and forces nothing"). The
full reasoning, and why that is not the rewording I refused, is in
`docs/orchestration/GUARD-NARROWING-PROPOSAL.md`.

### Block 3 — the narrowing itself

```
PreToolUse:Edit [node .claude/hooks/guard-edit.js]:
BLOCKED: .claude/hooks/guard-bash.js not on the incision manifest — the harness is
LOCKED (orchestration-2026-08-08) and .claude/ is sealed.
The cage cannot be weakened by its occupant.
```

**This one is correct and I am not asking for it to be lifted.** `guard-edit.js:147-162`
seals `.claude/` whenever `locked: true`, and the seal list is hardcoded at
`guard-edit.js:148-153` — the manifest's `_enforcement_note` warns that `sealed_at_lock`
is descriptive only, so this cannot be fixed by editing `allow`. The manifest's stated
reason holds: *"An orchestrator that can rewrite `.claude/settings.json` can grant itself
the thing it was told to ask about."*

So the narrowing is **NOT DONE**. The exact patch, what it still blocks, what it gives up,
and the post-apply verification step are in `GUARD-NARROWING-PROPOSAL.md`, ready to paste.

### Why this matters beyond two blocked calls

`ORCHESTRATION.md` records that `guard-bash.js` has "5 documented false positives + 1
false negative. Do not extend this pattern." This is a sixth, and it has a shape the
other five do not: the pattern matches a **filename as a substring of any shell command**,
so it cannot distinguish a write from a read, or from a commit message that merely
*mentions* the file. A guard that blocks writing about a problem blocks documenting it.

**This is also the first positive evidence in the whole census that the harness binds.**
All five prior windows self-reported as ungoverned (cwd outside the repo root ⇒ no hook
ran). This window is governed — twice over, demonstrably.

---

## 1. The shape nobody had measured: two lineages, not ten peers

`git merge-base --is-ancestor` over every branch, run pairwise:

```
LINEAGE A   fleet/measure-2026-08 → ui-restyle → saas-launch → light-migration → recipe-brain
LINEAGE B   fix/audit-remediation → campaign-2026-07 → ┬ ux/simplify-2026-08
                                                       └ backup/pre-scrub-2026-08-04
STANDALONE  master · claude/apps-editing-claude-02aba7 · fix/profile-non-trainer-option
            · ux/plan-week-board-declutter · cp-prefix-baseline (detached worktree)
```

`recipe-brain` **already contains** ui-restyle, fleet/measure, saas-launch and
light-migration in full. Four of the survey's "ten workstreams sharing files" are not in
contention with each other at all — they are one line of descent, already merged by
being committed on top of one another. The real contest is **A vs B**, plus three small
standalones.

Commits ahead of `master` (`git rev-list --count master..<b>`):

| recipe-brain | light-migration | saas-launch | ui-restyle | fleet/measure | ux/simplify | pre-scrub | fleet/measure | campaign | fix/audit | fix/profile | declutter | apps-editing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 200 | 180 | 176 | 155 | 122 | 106 | 120 | 122 | 69 | 68 | 122 | 122 | 6 |

Do not sum these. `recipe-brain`'s 200 contains the 180, the 176 and the 155.

### The contention, measured

Files each tip changed since the divergence point, and the overlap:

| Pair | Overlap |
|---|---|
| `recipe-brain` ∩ `ux/simplify-2026-08` | **81 of ux/simplify's 81 code files** — 100% |
| `recipe-brain` ∩ `backup/pre-scrub` | **95 of pre-scrub's 95 code files** — 100% |
| `ux/simplify` ∩ `pre-scrub` | 20 of 20 — 100% (shared ancestor) |
| `recipe-brain` ∩ `fix/profile-non-trainer-option` | 4 of 4 — 100% |
| `recipe-brain` ∩ `ux/plan-week-board-declutter` | 1 of 1 — 100% |

**94 of 165 distinct code files are claimed by two or more independent tips.** Seven are
claimed by four:

| File | A (recipe-brain) | B1 (ux/simplify) | B2 (pre-scrub) |
|---|---|---|---|
| `frontend/src/components/PlanTab.jsx` | +685/−304 | +384/−210 | +565/−215 |
| `frontend/src/index.css` | +282/−164 | +61/−6 | +61/−6 |
| `frontend/src/components/SetupWizard.jsx` | +200/−90 | +93/−6 | +93/−6 |
| `frontend/src/components/ui/Parts.jsx` | +197/−70 | +156/−36 | +156/−36 |
| `frontend/src/App.jsx` | +176/−24 | +59/−6 | +59/−6 |
| `frontend/src/components/ProfileTab.jsx` | +118/−64 | +8/−0 | +8/−0 |
| `backend/src/routes/profile.js` | +79/−2 | +73/−1 | +73/−1 |
| `frontend/src/components/Sidebar.jsx` | +42/−35 | +31/−18 | +31/−18 |

There is no file-level merge available on any of these. Every one is a re-implementation
decision.

---

## 2. Corrections to the inputs — measured, with the command

The verdicts below depend on these. Each replaces a claim I was handed.

**a) `ux/simplify-2026-08` does not rewrite every frontend screen.**
`ORCHESTRATION.md:10` says it "rewrites every frontend screen (+14,619 lines)".
`PROMPT-B-amended.md`'s hard constraint 1 repeats it as "rewrites every frontend screen
including `TrendTab.jsx`".

Measured — its own 37 commits (`campaign-2026-07..ux/simplify-2026-08`):
```
288 files changed, 242785 insertions(+), 60 deletions(-)     <- all paths
 20 files changed,   2388 insertions(+), 41 deletions(-)     <- frontend/src backend/src backend/tests
```
Of those 20, **exactly one is a frontend file: `TodayTab.jsx`, +60 lines.** The other 19
are backend allergen/solver correctness fixes and their tests. The 242,785 insertions are
`fleet/` measurement data and `docs/`.

The frontend rewrite is real but belongs to **`fix/audit-remediation`** — 34 frontend
files, +4,684/−885 — which `ux/simplify`, `campaign-2026-07` and `pre-scrub` all inherit
unchanged. **The abandon/port decision is about `fix/audit-remediation`, not about
`ux/simplify`.** Naming the wrong branch would have thrown away 37 commits of backend
allergen work to solve a frontend problem it did not cause.

**b) Hard constraint 1 survives, on different evidence.** `d47316b` ancestry, verified
branch by branch:
```
HAS      recipe-brain · saas-launch · light-migration
MISSING  ux/simplify-2026-08 · campaign-2026-07 · backup/pre-scrub-2026-08-04 ·
         fix/audit-remediation · master · ui-restyle · claude/apps-editing ·
         fix/profile-non-trainer-option · ux/plan-week-board-declutter · fleet/measure
```
Ten branches lack the 401 kcal/day fix. But `TrendTab.jsx` is the wrong file to worry
about — `d47316b` changed only a **comment** there. The functional revert risk is
`backend/src/routes/weighins.js`, which lineage B touches at exactly one place:
```
-  const macros = computeMacros(profile, weightNowKg, target.target);
+  const macros = computeMacros(profile, weightNowKg, target.target, target.floor);
```
That is `backup/pre-scrub`'s only edit to the file, on a base that predates `d47316b`.
**Landing it by file replacement reverts the fix.** It is also a change to a calculation's
inputs — escalation item, section 6.

**c) Hard constraint 2 does not reproduce.** `PROMPT-B-amended.md` says fixing
`adaptiveTarget.js:144` and `weightNow.js:10` "WILL fail those fixtures", and that
`guard-edit.js:138` makes the re-base impossible for any role.

Measured:
- `MIGRATION/golden/` holds **12** fixtures, not 11 (`ls | wc -l` → 12;
  `migrationGolden.test.js:106` asserts `slugs.length === 12`).
- `backend/tests/golden/migrationProfiles.js:33-35` requires **only** `bmrEngine.js`
  (`computeEnergy, deriveTarget, computeMacros, rateSafety, effectiveFloor`).
- `grep -c "adaptiveTarget\|weightNow" backend/src/lib/bmrEngine.js` → **0**.
- The profiles are static objects carrying a scalar `weightKg`. No weigh-in array is ever
  constructed, so `weightNow()` and `adaptiveTarget()` are never on the path.

**Those two fixes cannot fail the 12 `MIGRATION/golden/` fixtures.** They are not in the
dependency chain.

- The hard deny at `guard-edit.js:138` is `lower.startsWith('backend/tests/golden/')` —
  **that directory only**. `MIGRATION/golden/` is reachable through the `MIGRATION/` allow
  entry. A governed surgeon *can* re-base the 12 baselines; the regenerator
  (`node tests/golden/migrationProfiles.js --write`) writes to
  `GOLDEN_DIR = <repo>/MIGRATION/golden`.

**Caveat, and it is why this is a correction and not an all-clear:** the *sealed* baseline
`backend/tests/golden/engine-baseline.golden.json` is a different file with a different
dependency chain, and section 0's guard block stopped me measuring it. If the halt risk is
real it lives there, and there it genuinely does need the owner's hand.

**d) The URGENT `release/` claim is dead, and the reason is not "dist:check passed".**
`package.json > build.files` is **28 entries: 19 positive allow patterns and 9 negations,
every negation scoped inside `backend/node_modules/`**. The inversion `CLAUDE.md` calls
"in progress" has landed; no `!backend/.env`-style name-blocking remains. That is a
structural argument, not a scanner result.

Two things it does not close, both already known: `release/win-unpacked/Cut Protocol.exe`
is dated **2026-07-26 11:29**, so any scan vouches for a 13-day-old artifact; and
`grep -c DISCLAIMER package.json` → **0**, so `docs/DISCLAIMER.md` still ships nowhere.

**e) The four branches carrying 2026-08-08 work carry the *same* work.** `master` has 15
commits `recipe-brain` lacks. Content check on six of the files
(`git rev-parse <branch>:<file>` blob comparison): `ORCHESTRATION.md`, `V2-DELTA.md`,
`TEARDOWN-2026-08-06.md`, `.claude/settings.json`, `docs/surgery/CURRENT/manifest.json`
and a handoff file are **byte-identical** between `master` and `recipe-brain`. Only
`ux/simplify`'s manifest differs, and that is deliberate (its own run window).

So the "four branches, nothing pushed" state is one body of work replicated four times,
not four bodies of work. Identical blobs merge without conflict. **This is the one place
the sequencing is easier than it looks.**

**f) The launcher spec exists.** `docs/surgery/CAMPAIGN/solver-brain/STATUS.md:735-741`
names `solver-brain-fleet.bat` and its completion-footer contract. Already carried into
`PROMPT-B-amended.md`; restated because it changes "write new" into "rebuild from spec".

---

## 3. THE VERDICT TABLE

Verdicts are **recommendations**. Every ABANDON and every PORT FORWARD is an owner
decision under the escalation law and is not executed by this document.

| # | Workstream | Files owned (own delta) | Also claimed by | Verdict |
|---|---|---|---|---|
| 1 | **`recipe-brain`** — tip of A, main checkout, 200 ahead | 20 commits / 59 files over light-migration: `backend/src/lib/recipeBrain/**` (10 new), `aiRecipeClient.js`, `recipeGeneration.js`, `exclusionGate.test.js`, `runTests.mjs`, `docs/handoff/**`, `docs/orchestration/**` | recipeBrain/** collides with nobody (nothing imports it); the rest via lineage | **LAND NOW.** It is the trunk. Contains d47316b, the migration, the restyle and the payment base. Everything else rebases onto it or is re-implemented into it. |
| 2 | `light-migration` (in #1) | `MIGRATION/**`, `index.css`, `App.jsx:452`, `frontend/index.html`, `MIGRATION/golden/*` ×12, `parity-check.js`, `no-hardcoded-colours.js`, `CLAUDE.md` | `index.css` +282/−164 vs B's +61/−6 | **LAND NOW — with a gate.** Already in the trunk. But Phase 4 has **never been looked at by a human** (window 5 item 7). Automated gates ≠ visual verification. |
| 3 | `saas-launch` (in #1) | `d47316b`: `routes/weighins.js`, new test, `TrendTab.jsx` (comment) | `weighins.js` also touched by pre-scrub (1 line) | **LAND NOW.** Already in the trunk. Its *future* work (V2-DELTA blocks) is sequenced in §4. |
| 4 | `ui-restyle` (in #1) | 33 commits / 69 files | via lineage | **LAND NOW.** Already in the trunk. |
| 5 | `fleet/measure-2026-08` (in #1) | 122 commits, base of A | via lineage | **LAND NOW.** Already in the trunk. |
| 6 | **`fix/audit-remediation`** — real owner of the frontend rewrite | 179 files, +20,678/−1,330; **34 frontend files +4,684/−885** | **all 34 also changed on `recipe-brain`**; 7 of them 4-way contested | **PORT FORWARD — ESCALATE.** Cannot be merged. Must be re-implemented finding by finding onto the trunk. §5 names what is lost. |
| 7 | `campaign-2026-07` | 1 commit, 1,385 files, 10,153,913 insertions. Code subset: 13 files incl. `allergenTaxonomy.js` +122, `macroCloser.js` +183, `weeklyPlanner.js` +112, `planContext.js` +67, **`backend/tests/golden/engine-baseline.golden.json` 578 lines rewritten** | the archive collides with nothing; the 13 code files collide with A | **SPLIT — ESCALATE.** The `docs/surgery/CAMPAIGN/` archive is inert evidence and can land alone. The golden rewrite inside the **sealed** directory cannot land through any governed door. |
| 8 | **`ux/simplify-2026-08`** (worktree) | own 37 commits: 19 backend files (lupin↔peanut cross-reactivity, gluten-free visibility for celiacs, coriander leaf-vs-seed, free-text over-exclusion, closer/planner fixes, 9 new test files) + `TodayTab.jsx` +60 + 268 fleet/docs files | 81/81 with A, but **its own 20 are mostly backend and mostly additive** | **REBASE FIRST.** Do not abandon. Its own work is small, safety-critical and cherry-pickable. It is *not* the 14,619-line screen rewrite it was described as. |
| 9 | `backup/pre-scrub-2026-08-04` | 51 commits / 397 files; 14 code files incl. `PlanTab.jsx` +192, `weeklyPlanner.js` +92, `routes/plans.js` +168, `weighins.js` +1/−1 | 95/95 with A | **ESCALATE before any verdict.** The `weighins.js` line is a **calculation input change** (`computeMacros(..., target.floor)`) on a base missing `d47316b`. Name says "backup"; 51 commits say otherwise. Owner must say which it is. |
| 10 | **`claude/apps-editing`** (worktree) | 6 commits = byte-identical duplicates of master's doc/harness work. **UNCOMMITTED: `App.jsx`, `Sidebar.jsx`, `ui/Parts.jsx` modified; `frontend/src/lib/nav.js` and `docs/qc/handoff/nav-4door-simplification.md` untracked** | all three modified files are 4-way contested | **COMMIT IT TODAY, then PORT FORWARD.** The committed half is redundant. The uncommitted half is the single most fragile asset in this census — it exists in one working tree and nowhere else. |
| 11 | `fix/profile-non-trainer-option` | `activityData.js`, `routes/profile.js`, `ProfileTab.jsx`, `SetupWizard.jsx` | **all 4 changed on `recipe-brain`** | **PORT FORWARD.** Small and self-describing ("the app had no way to say 'I don't train'"). Re-implement onto the trunk; the diff is 4 files. |
| 12 | `ux/plan-week-board-declutter` | `PlanTab.jsx` only | the most contested file in the repo (4 tips) | **PORT FORWARD.** One file, one idea ("four recipe names never fit a 100px column"). Re-implement; merging is impossible. |
| 13 | `cp-prefix-baseline` (detached worktree, `962ac88`) | untracked `fleet/out/P0prefix/`, `fleet/out/W4-1/` — nothing else | nothing | **LAND NOW.** Read-only measurement pin. Commit the outputs and release the worktree. |
| 14 | **dev.db herb repair** (no branch) | `backend/prisma/dev.db` — 98 `RecipeIngredient.baseGrams` reduced, 108 `Recipe` caches recomputed, 28 reverted | invisible to git (`backend/.gitignore:5`) | **ESCALATE.** 63 rows deliberately unfinished pending an owner decision, itemised in a CSV **outside the repo, unbacked-up**. The per-serving-vs-per-recipe import bug may be wider than herbs — unverified. |

---

## 4. THE SERIAL SPINE

Ordered because each step's files are claimed by the next. Nothing here may run in
parallel with anything else here.

**S1 — Commit the `apps-editing` worktree's uncommitted nav work.**
*Why first:* it is the only work in the census that exists nowhere but a working tree.
Everything else survives a machine reboot; this does not. `App.jsx`, `Sidebar.jsx`,
`Parts.jsx` are each claimed by four tips, so the longer it sits uncommitted the more
expensive its port becomes. Cost: one commit. Risk of deferring: total loss.

**S2 — Land `recipe-brain` → `master`.**
*Why second:* §2(e) proves the 2026-08-08 doc/harness commits are byte-identical across
both branches, so this merge is unusually cheap *right now*. Every hour of further
divergence makes it less so. Also establishes the trunk that S4–S6 port onto, and carries
`d47316b` to `master` for the first time.
*Blocked by:* nothing. *Blocks:* everything downstream.

**S3 — Human visual verification of Phase 4 (light default), all screens, both themes.**
*Why here:* it gates every frontend port after it. Porting B's screen work onto a light
default nobody has ever looked at means debugging two unknowns at once. Window 5 is
explicit: "Treat 'Phase 4 complete' as 'Phase 4 passes its automated gates', which is not
the same claim." `MIGRATION/baseline/` screenshots do not exist, so this is eyes, not
diffing.
*Blocked by:* S2. *Blocks:* S4, S5.

**S4 — Port `fix/audit-remediation`'s 34 frontend files, one screen per commit.**
*Why after S3:* it is the same 34 files the light default just changed.
*Why serial within itself:* seven of them are claimed by four tips; two sessions in
`PlanTab.jsx` at once is the collision this whole exercise exists to prevent.
*Ordering inside S4* — least to most contested, so the cheap ones establish the pattern:
`ProfileTab.jsx` (+8) → `App.jsx` (+59) → `Sidebar.jsx` (+31) → `SetupWizard.jsx` (+93) →
`ui/Parts.jsx` (+156) → `PlanTab.jsx` (+384). Requires the owner's abandon/port ruling
(§5) before it starts.

**S5 — Port `fix/profile-non-trainer-option` (4 files) and `ux/plan-week-board-declutter`
(`PlanTab.jsx`).**
*Why after S4:* `ProfileTab.jsx`, `SetupWizard.jsx` and `PlanTab.jsx` are the same files
S4 rewrites. Doing these first means porting them twice.

**S6 — Cherry-pick `ux/simplify-2026-08`'s 19 backend correctness commits.**
*Why serial, not parallel:* they touch `dietaryFilter.js`, `allergenTaxonomy.js`,
`macroCloser.js`, `planContext.js`, `weeklyPlanner.js`, `routes/plans.js` — all six also
changed on the trunk. *Why last:* they are allergen-safety changes; they deserve a stable
base and a full suite, not a moving one. `dietaryFilter.js` carries 3 NUL bytes and is
exempt from the secret scan — review it with `grep -a` / the Read tool, never plain grep.

**S7 — V2-DELTA BLOCK 1 (the payment migration), on `saas-launch`.**
*Why last and why on that branch:* it rewrites `schema.prisma` and `entitlement.js`.
Window 2's verbal-only rule stands — running it on `recipe-brain` puts the payment
migration on the wrong branch. It is also a persistence migration, so it is an escalation
in its own right (§6).

---

## 5. THE PARALLEL SLICES — verified, with the candidates that failed verification

Provably touching no file another slice touches. File lists re-derived, not inherited.

| Slice | Writes | Verified independent? |
|---|---|---|
| **P1 · fleet W5-2** | `fleet/NEXT-IMPLEMENT-PROMPT.md` (confirmed absent), `fleet/state.json`, `fleet/PROGRESS.md` | **YES.** `state.json:13` → `"currentWave": "W5 (W5-1 done, W5-2 pending)"`. No other stream writes `fleet/`. |
| **P2 · cp-prefix-baseline** | `fleet/out/P0prefix/`, `fleet/out/W4-1/` | **YES**, with one caveat: it shares the `fleet/` tree with P1. Different subdirectories, no file overlap — but do not run them in the same worktree. |
| **P3 · `docs/surgery/CAMPAIGN/` archive from `campaign-2026-07`** | 1,372 archive files, zero source | **YES** — *only* if split from that commit's 13 code files. See §6. |
| **P4 · Launcher rebuild** | a new `.bat` + `docs/surgery/CAMPAIGN/solver-brain/` notes | **YES.** No `.bat`/`.cmd`/`.ps1` exists in the tree (two windows confirmed independently). Rebuild from `STATUS.md:735-741`. |

### Candidates that did NOT verify — do not spawn agents on these

**✗ Packaging allowlist inversion.** Already done. `build.files` is 28 entries: 19
positive allows, 9 negations all scoped inside `backend/node_modules/`. There is no
inversion left to perform. What remains is two small chores, and neither is a slice:
rebuild `release/` (binary is 2026-07-26) and add `docs/DISCLAIMER.md` to the allowlist
(`grep -c DISCLAIMER package.json` → 0).

**✗ V2-DELTA BLOCK 4 — "backend only, no frontend file".** True about frontend, wrong
about independence. Its item 1 requires **"A WebhookEvent table"** — a new Prisma model
and a migration. `backend/prisma/` is deliberately off the manifest so exactly this must
be escalated. It is a serial, owner-gated item, not a parallel slice.

**✗ V2-DELTA BLOCK 5 — "legal/copy, `frontend/public/*.html` only".** The file list is
right (`terms.html`, `privacy.html`, 5 bracketed placeholders each; `recipe-brain` is the
only branch that has touched `frontend/public/` since the divergence). But the block
itself is not independently executable: item 2 says *"Ask me for my name"*, item 6 says
*"Ask me for the values you need; do not invent them"*, item 8 requires a footer on every
page (frontend components), and it closes with *"Show me the final wording for approval
BEFORE committing."* It is blocked on the owner from its first line.

**✗ light-migration Phases 5 and 6.** They *are* file-independent — `PHASES.md:60-61`
allows only new directories (`frontend/src/onboarding/`, `frontend/src/swipe/`,
`frontend/public/assets/food/`, `scripts/photo-pipeline/`). **But window 5 records a
verbal owner agreement to cut the runbook from 12 sessions to 3: "Phases 5, 6, 7, 8, 9,
10 of the runbook were deliberately deferred as product decisions, not migration steps.
Nothing on disk records this."** `MIGRATION/PHASES.md` still lists all ten as if planned,
which is why they reached the candidate list. **Spawning agents on Phases 5 and 6 would
execute work the owner cancelled.** Ruling needed — §6.

---

## 6. WHAT IS LOST — the abandon-and-port calls, for the owner to make

The mission requires naming the loss. These are the four decisions I will not make.

### D1 · `fix/audit-remediation`'s 34 frontend files (+4,684/−885)

**What it is:** the remediation of the 2026-07-29 systems audit and the
`docs/audit/ux-review-2026-08-02/` review — 13 lanes of findings across every screen.

**Why it cannot be merged:** all 34 files were independently rewritten on the trunk, seven
of them heavily (`PlanTab.jsx` +685/−304 on A against +384/−210 on B). A 384-line rewrite
of a file the trunk added 685 lines to has no merge; it has a re-implementation.

**What is lost if the owner says abandon:** the specific findings. They are not lost as
*knowledge* — `docs/audit/ux-review-2026-08-02/` (13 files) and
`docs/audit/systems-2026-07-29/` are both on the trunk already, so the findings survive as
documents. What is lost is the *implementation*: someone re-reads the findings and rebuilds
them against today's screens.

**My recommendation:** PORT FORWARD, one screen per commit, in the S4 order. Do not
abandon — but recognise this is the largest single line item in the plan and price it
honestly. The alternative — declaring the audit remediation done because it was once
committed somewhere — is the failure mode this repo has already paid for twice ("built
correctly, never wired up").

### D2 · `backup/pre-scrub-2026-08-04` — 51 commits, and nobody knows if it is a backup

**What it is:** 51 commits over `campaign-2026-07`, 397 files, including `PlanTab.jsx`
+192, `weeklyPlanner.js` +92, `routes/plans.js` +168, and a one-line change to
`computeMacros`'s arguments.

**The problem:** the branch name says "backup", the commit at its tip
(`fix(macros): stop failing people daily against a body fat nobody measured`) says active
development, and its `weighins.js` edit sits on a base missing `d47316b`. Landing it by
file replacement reverts the 401 kcal/day fix; landing its `computeMacros(..., target.floor)`
change at all is a change to a calculation's inputs, which is an escalation regardless.

**What is lost either way:** if abandoned, 51 commits including a body-fat handling fix
that reads as real. If landed carelessly, the 401 kcal/day error returns.

**My recommendation:** the owner tells me what this branch *is* before anyone reads it as
either. I have not opened its diff beyond the file census.

### D3 · `campaign-2026-07`'s sealed-golden rewrite

Its single rescue commit rewrites **578 lines of
`backend/tests/golden/engine-baseline.golden.json`** — inside the directory
`guard-edit.js:138` seals against every mode and every allow list, with the message
"proof you can edit is not proof."

**What is lost if the archive lands without it:** nothing, provided the split is done. The
1,372 archive files are inert evidence and carry no source.

**What is lost if the whole branch is abandoned:** `docs/surgery/CAMPAIGN/` — 1,388 files
that `PROMPT-B-amended.md` notes were "deliberately not copied" to `master` and
`claude/apps-editing`, which is exactly why guard-selftest is 72/74 on those branches
instead of 74/74.

**My recommendation:** land the archive as slice P3; escalate the golden rewrite
separately. It is the one artifact in the census that a governed session structurally
cannot land, by design.

### D4 · `ux/simplify-2026-08` — the branch the survey mis-scoped

`ORCHESTRATION.md` framed this as the 83-commit (later 97, actually 106) monster that
"collides with all nine others". Measured, its own work is 37 commits whose code footprint
is 20 files, 19 of them backend, +2,388/−41 — including a peanut/lupin cross-reactivity
fix, gluten-free visibility for celiacs, coriander leaf-vs-seed, and nine new test files.

**What would have been lost:** if the owner had ruled "abandon" on the description they
were given, they would have thrown away allergen-safety fixes to solve a frontend-rewrite
problem that lives on a different branch.

**My recommendation:** REBASE FIRST, cherry-pick the 19 backend commits in S6. This is the
correction I most want acknowledged before any ruling is made.

---

## 7. ESCALATIONS — surfaced, never decided

Standing items I am carrying forward without relitigating, per the prompt:

1. **Pricing.** `BUILD_PLAN.md` locks $24.99/mo + $125/yr; the teardown recommends $14.99
   + $119 + 14-day trial. Nobody may create Lemon Squeezy variants until ruled.
2. **Supabase project + Google OAuth client + Railway deploy.** Owed since 2026-08-06.
   Nothing downstream moves.
3. **`recipe-brain` vs the 2026-08-03 decision to park the AI/brain layer.** ~~Asked twice,
   never answered.~~ **ANSWERED 2026-08-09 by the owner: UNPARKED — the brain layer is
   meant to ship.** This reverses the verbal park of 2026-08-03 recorded at
   `docs/handoff/window-1-recipe-brain-20260808.md:200`; do not re-raise the park question.
   The branch is the trunk of everything in §4.

   Measured the same day, before the ruling: `backend/src/lib/recipeBrain/` (landed
   2026-08-08 in `794e914`) is called by **nothing** outside its own directory — the only
   mention elsewhere in `backend/src/` is a comment at `aiRecipeClient.js:143`. So
   "wired to nothing" in that commit subject is accurate, and wiring it up is real work
   inside PLAN.md step 5, not a checkbox. Two things to settle before it is switched on
   for real users: the per-user budget and the relay's bill-bounding (`961ee48`, `8ec23cd`)
   need to be verified working rather than assumed from their commit subjects, because
   the AI channel is the one that costs money per call.
4. **The two `slice(-7)` sites.** Now editable, and — per §2(c) — **not** gated on the
   `MIGRATION/golden/` re-base, which they cannot break. Still a calculation change, so
   still owner-approved before it runs. The `engine-baseline.golden.json` question is
   NOT REACHED (§0).

New escalations this document raises:

5. **Phases 5 and 6 were cancelled verbally and the cancellation is on no disk.** Rule
   them in or out, and either way write the answer into `MIGRATION/PHASES.md`.
6. **`campaign-2026-07`'s sealed-golden rewrite** (D3) — needs the owner's hand or a
   deliberate decision to drop that hunk.
7. **`backup/pre-scrub`'s `computeMacros(..., target.floor)`** — a calculation-input change
   on a base missing `d47316b` (D2).
8. **V2-DELTA BLOCK 4 needs a Prisma migration** (`WebhookEvent` table). Off the manifest
   by design.
9. **`guard-bash.js:57-60` false-positives on reads and on commit messages** (§0). It
   matches the sealed filename as a substring of any shell command, so it cannot tell a
   write from a read from a mention. It blocked the commit of this document.
   **OWNER RULED 2026-08-08: narrow it.** The session cannot — `.claude/` is sealed at
   lock (§0 block 3), correctly. Patch ready to paste, with its verification step, in
   `docs/orchestration/GUARD-NARROWING-PROPOSAL.md`. **Still open: it needs your hand.**
10. **`stash@{0}` still exists** — "On saas-launch: pre-light-migration parking". Window 5
    confirms its 17 files were rescued into commits. It should be dropped *deliberately*
    by the owner after a last look, not discovered in a month. I will not touch it.
11. **The dev.db herb repair** (#14) — 63 rows pending an owner decision, listed only in a
    CSV outside the repo on the same physical drive as the DB it describes.

---

## 8. WHAT I DID NOT LOOK AT

Stated so the gaps are not mistaken for clean bills of health.

- The **content** of any diff on `fix/audit-remediation`, `backup/pre-scrub` or
  `campaign-2026-07`. This is a file-level census and a line-count census. I have not read
  what those changes *do*.
- `backend/tests/golden/engine-baseline.golden.json`'s dependency chain — blocked, §0.
- Whether `ux/simplify`'s 19 backend commits still apply cleanly to the trunk. Measured as
  cherry-pickable by file overlap; not test-verified.
- The 14 branches I did not census (`track/*`, `competitive-gap-integration`,
  `food-schema-base`, `allergy-tier1`, `qc/overnight-2026-07-23`, `wip/agent-run-raw`,
  `backup/pre-overhaul`, `gh-pages`, …). `PROMPT-B-amended.md` reports **28 local branches
  and 14 with unmerged work**. I covered the 13 the handoffs and worktrees pointed at.
  **Do not read this document as saying the rest are inactive** — that is precisely the
  inference the prompt warns against.
- The app itself. I have not run it. No claim here rests on observed behaviour.

---

## SIGN-OFF REQUESTED

Per MISSION 2 this stops here. To proceed I need, at minimum:

- **D1** — port or abandon `fix/audit-remediation`'s 34 frontend files
- **D2** — what `backup/pre-scrub-2026-08-04` is
- **D4** — confirmation that `ux/simplify-2026-08` is rebased, not abandoned, now that its
  actual footprint is measured
- **Escalation 5** — are migration Phases 5 and 6 cancelled or live
- Approval of the **S1–S7 spine order** and of slices **P1–P4**
- **Paste the guard patch** in `GUARD-NARROWING-PROPOSAL.md` and re-run
  `node scripts/surgery/guard-selftest.js` (74/74 now; revert if it drops). Ruled, but it
  needs your hand — the session is sealed out of `.claude/`, correctly.

MISSION 3 does not begin until those are answered.
