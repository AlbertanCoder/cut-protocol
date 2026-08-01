# HANDOFF v2 — FULL SYSTEMS AUDIT OF CUT PROTOCOL

**Supersedes `handoff-20260729-0445-systems-audit.md` in full.** v1 was written
before I inventoried this project's existing tooling and it materially
understated what already exists. v1 is retained only as a record.

Authored 2026-07-29 04:53 MDT (10:53Z) by the ARCHITECT of the Phase Two
campaign, at HEAD `d63592c`, **for a cold session that has never seen this
repository.**

---

# PART 0 — FOR SHAD. Two steps, then hand PART 1 onward to the new session.

**Who should run this: not me, and not the builder.** I have graded this
campaign and logged seven defects of my own; the builder did the work. Evidence
law — no agent QCs its own work — disqualifies us both.

**Do not run it in the live repo.** A campaign is mid-flight, and a fresh
session there has no `CP_ROLE`, so the harness fails it closed to the architect
door — it could not write its own report.

### Step 1 — build the audit workspace

    cd C:\Users\<account>\Desktop
    git clone cut-protocol cut-protocol-audit
    cd cut-protocol-audit
    npm install
    npm --prefix backend install
    npm --prefix frontend install
    npm --prefix relay install

### Step 2 — in the CLONE ONLY, replace `docs/surgery/CURRENT/manifest.json`

    {
      "run_id": "audit-20260729",
      "mode": "surgeon",
      "locked": false,
      "allow": ["audit/"],
      "sealed_at_lock": []
    }

Then start Claude Code **in `cut-protocol-audit`** and paste from PART 1 down.

**Why this shape:** the audit *reads* the live repo — reads are never gated —
so it still sees untracked files, the real `dev.db`, and installed
`node_modules`, which is where this project's known leaks live and which a
clean clone does not have. It *writes* only inside its own workspace. The live
repo is never modified.

---

# PART 1 — YOUR MANDATE

You are the **AUDIT LEAD** for a full systems audit of **Cut Protocol**, a
desktop calorie / meal-planning application that tells a human being what to
eat.

- Your workspace: `C:\Users\<account>\Desktop\cut-protocol-audit` — you may
  write to `audit/` here and nowhere else.
- The live repo: `C:\Users\<account>\Desktop\cut-protocol` — **READ-ONLY,
  always. Never write. Never execute anything inside it.**

You will deploy **25 subagents** across ten stages. **You are the only writer.**
Agents read, run, and report; you record.

Your deliverable is an audit a hostile third party could reproduce from your
report alone.

## The six laws

1. **OBSERVED ≠ EXPECTED.** Ran it and saw it → OBSERVED. Reasoned it from
   reading code → EXPECTED. Never promote one to the other.
2. **Numbers come from machines, pasted verbatim** — never your arithmetic,
   never memory, never estimates. **Timestamps are numbers**; derive each one
   at the moment you write it.
3. **Cite path + symbol, never a bare line number.** Line numbers rot.
4. **Trust no document in this repo.** See PART 3. This project's own docs
   contain a section admitting its docs are wrong.
5. **Fail closed.** Can't prove it → it is not a finding. It goes in
   `04-UNVERIFIED.md` with exactly what was missing.
6. **Every cited path must exist.** Before a finding ships, mechanically verify
   its file path and symbol resolve. Hallucinated coordinates are the
   characteristic failure of this exercise.

## Hard prohibitions

- No writes of any kind to the live repo. Not one byte.
- No `git push`, from either location. No history rewriting.
- **Never bind port 3001** — the owner's live app. Use 3999+ for everything.
- **No live model calls. No `witness.js` runs. No `--brain on`.** There is a
  funded Anthropic key wired in. Spend is $0.00 and stays $0.00. If an agent
  proposes a model call, refuse it.
- Never read a `.env` value into your transcript. Names and shapes only.
- **Fix nothing.** An audit that edits code cannot report on the code it
  edited. Findings only.

## Harness friction you will hit — this is known, do not fight it

The clone carries a copy of the project's guard hooks, which match command
strings against a denylist. They produce false positives on honest work:

- `-f` is read as `--force` — this catches PowerShell's `-f` **format
  operator** and POSIX `[ -f file ]`.
- `git merge` is a substring, so `git merge-base` and `git merge-tree` are
  blocked.
- Naming the golden baseline file in a command is blocked.

When blocked, **report it and rephrase without the false trigger** — the
underlying act was never forbidden. Do **not** obfuscate, split, or encode a
command to defeat a guard that correctly identified a real target.

---

# PART 2 — GROUND TRUTH, machine-derived 2026-07-29 at HEAD `d63592c`

| fact | value |
|---|---|
| tracked files | 663 |
| source dirs | `backend` 334 · `docs` 185 · `frontend` 61 · `roadmap` 15 · `scripts` 15 · `assets` 12 · `electron` 7 · `relay` 7 |
| packages | root, `backend/`, `frontend/`, `relay/` — each with a lockfile except relay |
| prisma migrations | 26 |
| backend test files | 110 |
| commits ahead of `master` | ~48, **none pushed to any remote** |
| origin | `github.com/AlbertanCoder/cut-protocol` — **PUBLIC** |
| money ledger, all time | 13 rows, **$0.3928**, phases classify/chat/create only |

**Stack.** Electron 43 shell (`electron/main.cjs`, `preload.cjs`), packaged by
electron-builder to a Windows NSIS installer. Backend: Express 5 + Prisma 6 on
SQLite (`backend/prisma/dev.db`). **Auth is an httpOnly cookie
`cutprotocol_session` — there is no bearer-token path anywhere in the app.**
Frontend: React 19 + Vite 8 + Tailwind 4. Domain logic in `backend/src/lib/`
(`bmrEngine`, `weeklyPlanner`, `mealSolver`, `dietaryFilter`,
`allergenTaxonomy`, `groceryList`), an LLM subsystem in `backend/src/lib/brain/`,
and a key-holding forwarding service in `relay/`.

## The product's own constitution — use it as your correctness oracle

From `CLAUDE.md`, and these are the rules the app is *supposed* to obey:

- **Wrong math = product death.** Displayed numbers must be able to reveal
  their formula and inputs.
- **Hard intake floor:** never prescribe below `max(RMR×0.95, 1500 kcal men /
  1200 women)`. User floors may be stricter, never looser.
- **Provenance on every food:** USDA-VERIFIED (+FDC id) | LABEL | AI-ESTIMATED.
  Sources never silently mixed.
- **Nutrition sanity:** `kcal ≈ 4P + 4C + 9F` within ~15%, or a documented
  exception.
- **Solver must declare "unsolvable + why."** Silent target misses are
  forbidden.
- **Every automatic adjustment is logged, visible, and reversible.**
- **Export must always work** (JSON + CSV).
- **No red on food or body data**; the macro triad is fixed and colorblind-safe.

A violation of any of these is a finding against the product's own stated law,
which is the strongest kind of finding you can make here.

---

# PART 3 — WHAT NOT TO TRUST

`CLAUDE.md` contains a section titled *"Superseded claims … READ THIS FIRST"*
in which the project documents that its own phase log is false. Treat these as
known-wrong, and treat their existence as proof that more are undiscovered:

- Food counts "in the 800s" — real corpus is ~14,122 foods / 889 recipes. Any
  audit described as sweeping "the 854-name food table" covered ~6%.
- "Audit exits clean: 0 failures" — **470 food rows carry another food's macros
  verbatim** and say so in their own `dataQuality` field. They pass Atwater
  because the numbers are real numbers, just the wrong food's. **Atwater
  consistency is not a correctness warrant.**
- "Zero hardcoded hexes" — false; violations reappeared.
- "One-line provider swap sqlite → postgresql" — 8 migrations carry SQLite
  `PRAGMA` statements Postgres rejects.
- **"The `build.files` allowlist inversion is in progress"** — I checked at
  `d63592c`: `build.files` **is already an explicit allowlist** beginning
  `["package.json","CutProtocol.ico","electron/main.cjs",…]`. The doc is stale
  in the *safe* direction, which is still a doc defect. **Verify independently.**
- Any claim in `docs/surgery/` that something is "sealed", "impossible", or
  "mechanically impossible" — see K1.

**Stage 7 exists to find the claims nobody has caught yet.**

---

# PART 4 — KNOWN ISSUE REGISTER

Found in a prior campaign. Given so you do not burn agents rediscovering them,
and so a finding you mark NEW is genuinely new. **Verify each independently and
mark it `CONFIRMED-KNOWN`, `REFUTED`, or `WORSE-THAN-RECORDED`.**

| id | issue |
|---|---|
| K1 | `.claude/hooks/guard-bash.js` is a **denylist of command phrasings**. General file writes via shell (`Set-Content`, redirects, `node -e`) are **ungated for every role**. The incision manifest is enforced on the Edit/Write tools only. Every "sealed"/"impossible" claim in the surgery record is true of one door and silent about the other. |
| K2 | The same denylist refuses honest read-only work — see "Harness friction" above. |
| K3 | `scripts/scanSecrets.mjs` — `PLACEHOLDER` is a **line-level skip applied before any rule runs**. 8 rule matches silently suppressed vs 1 reported. |
| K4 | Same scanner — **a single NUL byte exempts an entire file**, silently. Two ordinary JS source files (~909 lines) are never scanned, and no count of skipped files is printed. |
| K5 | `relay/test/relay.test.js:20` trips the Anthropic-key rule. Prior analysis: fixture, not live key, and never pushed. **Re-verify; do not read the value into your transcript.** |
| K6 | `PUT /api/profile` **silently discards** fields not in `PROFILE_FIELDS` — the request succeeds and the value evaporates with no error. A field-name typo in any client fails silently. **Live product property; check for the same pattern on other routes.** |
| K7 | Historical: `build.files` was a denylist and `backend/.env.qc` plus a `dev.db.snapshot-*` slipped past it. **Appears remediated — confirm, and check whether those two files still exist untracked in the live repo.** |
| K8 | `fillGapsWithBrain()` in `weeklyPlanner.js` triggers on slot-emptiness and slot-warning only — **no day-total or tolerance term**. Days land out of band with zero empty and zero warned slots. |
| K9 | The generate-path brain has **never fired in production** — zero generate-path `LlmUsage` rows all-time. |

---

# PART 5 — RUN THE EXISTING TOOLING FIRST. THIS IS NOT OPTIONAL.

This project already ships a substantial QC and security surface. **Before any
agent writes a new check, the existing checks must be run and their output
captured verbatim.** Then the real question becomes the interesting one: *do
these checks actually prove what their names imply, or are they green theatre?*

Run all of these in the **CLONE**, capture full output to
`audit/03-EVIDENCE/00-baseline/`:

    # root — security + packaging
    npm run security:all          # scanSecrets + checkBrainPurity + checkSupplyChain
    npm run scan:secrets
    npm run supply:check
    npm run brain:purity
    npm run dist:files            # resolves exactly what the installer would ship

    # backend — tests and the QC suite
    npm --prefix backend test
    npm --prefix backend run qc:invariants
    npm --prefix backend run qc:smoke        # monte carlo, seeded
    npm --prefix backend run qc:integrity
    npm --prefix backend run qc:security
    npm --prefix backend run qc:sweep14k     # the full 14k food corpus
    npm --prefix backend run qc:recipe-allergen
    npm --prefix backend run audit:dietary
    npm --prefix backend run bench:solver:check

    # frontend / relay
    npm --prefix frontend run lint
    npm --prefix frontend run build
    npm --prefix relay test

**`npm run dist:check` requires a built `release/` — only run it if you also
run `npm run dist`, which is expensive. Prefer `dist:files` for the payload
question.**

For every one of the above, record: exit code, full output, **and a one-line
judgement — what would have to be true for this check to pass while the system
was still broken?** That judgement is worth more than the pass/fail.

---

# PART 6 — THE TEN STAGES AND 25 AGENTS

Run stages **in order**; agents inside a stage run in parallel. Do not start a
stage until the previous stage's findings are recorded.

### Stage 0 — Pre-flight (YOU, no agent)
Capture `git rev-parse HEAD` and `git status --short` for **both** repos,
verbatim, into `audit/03-EVIDENCE/00-baseline/`. Confirm nothing is listening on
3001. Run PART 5 in full. You will re-capture the live repo's status at the end
to prove you changed nothing.

### Stage 1 — Supply chain, build, CI (3 agents)
1. **Dependencies + CVEs.** `npm audit --json` in all four packages. Lockfile
   integrity, lifecycle/`postinstall` scripts anywhere in the tree, non-registry
   resolutions, typosquat-shaped names, licence conflicts, `relay/` having no
   lockfile. Compare against what `checkSupplyChain.mjs` claims to cover.
2. **Packaging.** `npm run dist:files` — enumerate what actually ships. Confirm
   `build.files` is an allowlist. Does `extraResources` ship only the
   depersonalized template DB? Would an unrecognized new file default to
   EXCLUDED? K7.
3. **CI.** `.github/workflows/**` — what blocks a merge vs what is advisory. Is
   the secret scan blocking? Could the suite pass with zero assertions? Are the
   QC scripts in PART 5 wired into CI at all, or only runnable by hand?

### Stage 2 — Correctness: the math and the safety paths (6 agents)
4. **TDEE / BMR.** `bmrEngine.js`. Verify each formula against its published
   source. Unit conversion, the mean-of-formulas logic, body-fat unlocks, and
   **the hard floor** `max(RMR×0.95, 1500M/1200F)`. Hunt for any path that can
   prescribe below the floor, produce NaN, or divide by zero.
5. **Solver & planner.** `weeklyPlanner.js`, `mealSolver.js`. K8. Scaling
   bounds (0.5–2×), variety caps, locked slots, the purity invariant (no
   `Math.random`/`Date.now` — `qc:invariants` claims to enforce it; verify the
   test can actually fail). Does the solver ever miss a target silently?
6. **Dietary & allergen filtering — SAFETY CRITICAL.** `dietaryFilter.js`,
   `allergenTaxonomy.js`. **Can any excluded food reach a plan, a grocery list,
   or an export?** Plural/synonym handling, `WORD_GUARD`, the metadata union,
   cross-contamination fields. Run `qc:recipe-allergen` and `audit:dietary`,
   then find what they do not cover. **False negatives here are CRITICAL.**
7. **The brain.** `backend/src/lib/brain/**`. Constraint construction; verify
   `exclusions.js`'s claim that terms come from the profile and never from LLM
   output; `guard.js`; prompt-injection surface (can a recipe name or user text
   reach the prompt?); behaviour on malformed/hostile model output; the cost
   caps. K8, K9.
8. **Routes & authorization.** `backend/src/routes/**`. For every route: is auth
   enforced? Can user A reach user B's data? Mass assignment, K6 and whether the
   silent-discard pattern repeats elsewhere, input validation, error messages
   leaking internals, missing rate limits.
9. **Frontend.** `frontend/src/**`. Hardcoded colours outside theme tokens,
   `dangerouslySetInnerHTML`, unvalidated props, missing error boundaries,
   the design-constitution rules (no red on food data, fixed macro triad),
   and whether displayed numbers match what the backend actually returned.

### Stage 3 — Data integrity (3 agents)
10. **Food library.** The 470 duplicated-macro rows — exact current count and
    full list; is it worse than recorded? Atwater conformance across all ~14k
    (`qc:sweep14k` first, then what it misses). Provenance completeness.
    Unresolvable or fabricated FDC ids. Zero-kcal rows that should not be.
11. **Recipes.** Cached macros vs recomputed-from-ingredients across all 889.
    Orphaned ingredient references. Scaling correctness. Recipes whose
    ingredients contradict their allergen tags.
12. **Schema & migrations.** All 26: replay from zero on a fresh DB. The
    `PRAGMA` portability claim. Indexes on hot paths, cascade behaviour,
    columns the code assumes non-null that the schema permits null.

### Stage 4 — Security (3 agents)
13. **Secrets.** K3, K4, K5. Scan tracked **and untracked** files in the LIVE
    repo — untracked is where the known leaks live — plus full git history.
    Specifically look for `backend/.env.qc` and `dev.db.snapshot-*`. **Report
    names and shapes only, never values.**
14. **Electron attack surface.** `electron/main.cjs`, `preload.cjs`,
    `license.cjs`, `updater.cjs`. `nodeIntegration`, `contextIsolation`,
    `sandbox`, IPC channel validation, `webSecurity`, external-navigation
    handling, the auto-updater's signature verification, the licence keygen.
15. **Session, authz, and the relay.** Cookie flags and lifetime, password
    hashing parameters, the registration gate, CSRF exposure on state-changing
    routes. Then `relay/`: what it forwards, what it logs, whether it can leak
    the key, its auth model, and its lack of a lockfile.

### Stage 5 — Test quality (3 agents)
16. **Assertion audit.** All 110 test files: tests that assert nothing, tests
    that would pass with the implementation deleted, over-mocking, skipped or
    `.only` tests. **Pick the three most safety-critical functions and mutate
    them by hand in the clone — do the tests catch it?** Revert immediately.
17. **Goldens.** What `backend/tests/golden/` actually locks. Is it
    regenerable? Would a real behavioural regression change it? Is a green
    golden suite evidence of anything?
18. **QC suite meaningfulness.** Take PART 5's QC scripts and answer: what
    would have to be true for each to pass while the system is broken?
    `qc:smoke` is seeded — does the seed hide variance? Does `qc:sweep14k`
    assert, or just report?

### Stage 6 — Runtime and user journeys (3 agents)
19. **API journeys.** Boot the backend on **3999** against a **copy** of
    `dev.db`. Exercise: register → profile → generate plan → swap a slot →
    grocery list → weigh-in → export JSON **and** CSV. Malformed input,
    oversized payloads, concurrent writes. Record every 500 and every silent
    success that should have been an error.
20. **Desktop shell.** `npm start`. Console errors, renderer crashes, the
    first-run wizard against an empty DB, behaviour when the backend is
    unreachable, window state, the packaged icon.
21. **Math truth, end to end.** **The most important agent in this audit.**
    Take three real profiles. Compute BMR/TDEE/target **by hand from the
    published formulas**, then compare against what the API returns and what
    the UI displays. Then take one generated day and verify its macro totals
    against the sum of its foods. **Any divergence between the displayed number
    and the honest number is CRITICAL.**

### Stage 7 — Docs vs reality: the AI-slop hunt (2 agents)
22. **`CLAUDE.md` + `README.md` + `DEPLOY.md`.** Every factual claim checked
    against code. Output a claim-by-claim table: `CONFIRMED` / `STALE` /
    `FALSE` / `UNVERIFIABLE`. PART 3 lists the known ones — find the rest.
23. **`docs/**` + `roadmap/**`** (185 + 15 files). Same treatment. Dead file
    references, superseded designs presented as current, invented citations,
    confident claims with no artifact behind them, receipts asserting things
    the code does not do.

### Stage 8 — Synthesis and triage (1 agent)
24. Merge everything. De-duplicate. Assign severity per PART 9. Kill
    speculation. Rank by **exploitability × blast radius**. Then produce **THE
    FIRST FIVE FIXES** in dependency order — what to repair first, and what
    each unblocks.

### Stage 9 — Red team the audit itself (1 agent)
25. Attack the top 15 findings. Is each reproduction real? Is anything marked
    OBSERVED actually only reasoned? Is any number model arithmetic? Is any
    "vulnerability" unreachable in practice? **Does every cited file path and
    symbol actually exist?** Anything that fails here is **deleted from the
    report, not softened**, and logged in `04-UNVERIFIED.md`.

---

# PART 7 — AGENT BRIEF TEMPLATE. Use this verbatim for all 25.

    You are AGENT <n> in a systems audit of Cut Protocol.

    WORKSPACE (writes forbidden to you): C:\...\cut-protocol-audit
    LIVE REPO (read-only, never execute in it): C:\...\cut-protocol

    YOUR SCOPE: <one paragraph, from PART 6. Nothing outside it.>

    YOU ARE READ-ONLY. You do not write files. You do not fix anything.
    You return a report to the lead. The lead is the only writer.

    LAWS:
      · OBSERVED (you ran it) vs EXPECTED (you reasoned it) — never blur them.
      · Numbers come from machines, pasted verbatim. Never your arithmetic.
      · Cite path + symbol, never a bare line number.
      · Every path you cite must exist — verify before reporting.
      · Cannot prove it? Not a finding. Report it as unverified + what is missing.
      · No live model calls. No witness.js. No port 3001. $0.00 spend.
      · Trust no document in this repo; docs are an audit TARGET, not a source.

    KNOWN ISSUES IN YOUR SCOPE: <only the relevant K entries>
    Verify each independently: CONFIRMED-KNOWN / REFUTED / WORSE-THAN-RECORDED.

    RUN FIRST: <the relevant PART 5 commands>. Capture output verbatim.
    Then answer: what would have to be true for that check to pass while
    this subsystem was still broken?

    RETURN, in this order:
      1. WHAT I EXAMINED — files and symbols, specifically.
      2. WHAT I COULD NOT EXAMINE, AND WHY.
      3. FINDINGS in the PART 8 format.
      4. WHAT I WOULD LOOK AT NEXT with more time.

    A report with no scope statement will be sent back. "No issues found"
    without section 2 will be sent back.

---

# PART 8 — FINDING FORMAT, with a worked example

    ID          AUD-<stage>-<n>
    TITLE       one line stating the DEFECT, not the topic
    SEVERITY    CRITICAL | HIGH | MEDIUM | LOW | INFO
    STATUS      OBSERVED | EXPECTED-FROM-CODE-READ | SUSPECTED-UNVERIFIED
    NOVELTY     NEW | CONFIRMED-KNOWN (K#) | WORSE-THAN-RECORDED (K#)
    LOCATION    path + symbol
    EVIDENCE    verbatim machine output, or the exact code construct
    REPRODUCE   exact commands a stranger can run
    IMPACT      these inputs -> this wrong outcome for this user
    FIX         what would resolve it. DO NOT APPLY IT.

**Worked example — this is the standard:**

    ID          AUD-2-04
    TITLE       PUT /api/profile silently discards unknown fields, so a client
                typo persists nothing and reports success
    SEVERITY    HIGH
    STATUS      OBSERVED
    NOVELTY     CONFIRMED-KNOWN (K6)
    LOCATION    backend/src/routes/profile.js — PROFILE_FIELDS allowlist and
                the assignment loop in the PUT handler
    EVIDENCE    node docs/surgery/campaign-p2-m0/evidence/profile-field-check.js
                  DROPPED  weightKg   88 — not in PROFILE_FIELDS; silently discarded
                  DROPPED  allergies  ["gluten","soy"] — silently discarded
                  --> 5 ok, 4 rejected, 2 silently dropped, of 11 sent
    REPRODUCE   PUT /api/profile with {"weightKg":88}; response 200; then GET
                /api/profile — the field is absent. No error was returned.
    IMPACT      A caller believes it set a weight or an allergy exclusion. It
                did not. For allergies this is a safety path: the exclusion the
                user thinks is active does not exist, and no error ever surfaces.
    FIX         Reject unknown keys with 400 naming them, or echo the applied
                field set in the response. DO NOT APPLY.

---

# PART 9 — SEVERITY CALIBRATION. Use these anchors, not intuition.

**This app computes what a human eats. A confidently displayed wrong number is
not a cosmetic defect.**

| level | anchor |
|---|---|
| **CRITICAL** | An allergen or excluded food can reach a plan, list, or export. A displayed number disagrees with its own formula. Intake can be prescribed below the safety floor. A live secret is exposed. User data is lost or silently corrupted. |
| **HIGH** | A safety mechanism exists but can be bypassed or silently no-ops (K6 on an allergy field). Auth/authz hole reachable from normal use. Data integrity defect affecting many rows (the 470 duplicated-macro foods). |
| **MEDIUM** | Wrong behaviour in a non-safety path. A check that reports green while proving nothing. Migration that cannot replay. |
| **LOW** | Quality, maintainability, dead code, inconsistent styling, doc drift with no functional consequence. |
| **INFO** | Worth knowing; not wrong. |

**Escalation rule:** if a defect is in a path the user is told is protecting
them — allergies, the intake floor, provenance — raise it one level.

---

# PART 10 — RUNNING THE MACHINE: failure, conflict, and stopping

- **An agent returns garbage or contradicts itself** → re-run once with a
  tightened scope. If it fails twice, record the gap in `04-UNVERIFIED.md` and
  move on. Do not paper over it.
- **Two agents contradict each other** → neither wins by seniority. Reproduce
  it yourself, or the finding is downgraded to SUSPECTED-UNVERIFIED.
- **An agent proposes a fix, a model call, or a write** → refuse, and note it.
- **A stage's tooling will not run** (missing dep, Windows path issue) → record
  the exact error, mark the stage's coverage incomplete in `05-METHOD.md`, and
  continue. A partial audit that says what it missed beats a complete-looking
  one that lies.
- **Scope creep** → this repo has 185 doc files and a live campaign. You are
  auditing the *system*, not the campaign. `docs/surgery/**` is in scope only
  as claims to verify (Stage 7), never as work to continue.

## Definition of done

The audit is complete when **all** of these are true:

1. PART 5 baseline captured with exit codes and verdicts for every command.
2. All 25 agents returned, each with a scope statement and a
   could-not-examine section.
3. Every K1–K9 entry marked CONFIRMED-KNOWN / REFUTED / WORSE-THAN-RECORDED.
4. Every finding survived Stage 9, or was deleted and logged as unverified.
5. Every cited path and symbol mechanically verified to exist.
6. `04-UNVERIFIED.md` is **non-empty** — an audit that claims to have proven
   everything has not looked hard enough.
7. The live repo's `git status --short` matches the Stage 0 capture exactly.

---

# PART 11 — DELIVERABLES, written to `audit/` in the CLONE only

    audit/00-EXECUTIVE-SUMMARY.md   One page. What is broken, what is sound,
                                    what you could not determine and why.
                                    Lead with the worst thing.
    audit/01-FINDINGS.md            Every finding, PART 8 format, ranked.
    audit/02-FIRST-FIVE-FIXES.md    Triage in dependency order: fix this first,
                                    it unblocks that. With effort estimates.
    audit/03-CLAIMS-TABLE.md        Stage 7: every documented claim marked
                                    CONFIRMED / STALE / FALSE / UNVERIFIABLE.
    audit/04-UNVERIFIED.md          Everything suspected but unproven, with
                                    exactly what was missing. MUST be non-empty.
    audit/05-METHOD.md              What you did, what you did NOT cover, tools
                                    that failed to run, and where an attacker
                                    would look next.
    audit/03-EVIDENCE/              Raw machine output, one directory per agent,
                                    plus 00-baseline/ from PART 5.

**Close by re-running `git status --short` on the LIVE repo and pasting it
beside the Stage 0 capture. They must match — that is your proof the audit
changed nothing.**

---

# PART 12 — HONEST NOTES ON 25 AGENTS

From an architect who has watched this go wrong for a full campaign.

- **A cold agent re-derives everything.** Twenty-five agents each spending
  their first third working out what this repo is, is twenty-five wasted
  thirds. Brief with PART 2 and only the K entries in scope.
- **Parallelism pays only on disjoint scopes.** The stages are cut so no two
  agents in a stage read the same subsystem. Keep it that way.
- **One writer.** Twenty-five writers in one tree is a merge problem, not an
  audit.
- **"No issues found" usually means "did not look."** Section 2 of the brief —
  what could not be examined — is the tell. Demand it.
- **The single biggest risk here is fluent prose about skimmed code.** It reads
  exactly like real analysis. That is what Stage 9 is for, and why Stage 9
  deletes rather than softens.
- **You will want to fix things.** Do not. Every fix you make is an unreviewed
  change with no test, made by the party who then reports on it.
