# HANDOFF — FULL SYSTEMS AUDIT OF CUT PROTOCOL

Authored 2026-07-29 04:45 MDT (2026-07-29T10:45Z) by the ARCHITECT of the
Phase Two campaign, at HEAD `d63592c`, **for a cold session that has never seen
this repository.**

---

## PART 0 — FOR SHAD ONLY. Read this, then stop reading and do the two steps.

**Who should run this: not me, and not the builder.** I have spent this
campaign grading the builder's work and have logged seven defects of my own.
The builder has been doing the work. Evidence law — no agent QCs its own work —
disqualifies us both as auditors of it. This needs a session with no stake in
the record.

**Do not run this audit inside the live repo.** A campaign is mid-flight there,
the harness will fail-closed on a fresh session (see below), and 25 agents
loose in a working tree with an open surgical window is how you lose a day's
evidence.

### The two setup steps

**Step 1 — make an audit workspace.**

    cd C:\Users\<account>\Desktop
    git clone cut-protocol cut-protocol-audit
    cd cut-protocol-audit
    npm --prefix backend install
    npm --prefix frontend install

**Step 2 — in the CLONE ONLY, open the cage.** The clone carries a copy of the
harness, and a fresh session with no `CP_ROLE` fails closed to the architect
door — it could not write its own report. In `cut-protocol-audit`, replace
`docs/surgery/CURRENT/manifest.json` with:

    {
      "run_id": "audit-20260729",
      "mode": "surgeon",
      "locked": false,
      "allow": ["audit/"],
      "sealed_at_lock": []
    }

That lets the audit write only to `audit/` and nothing else, even in the clone.
Then start Claude Code in `cut-protocol-audit` and paste PART 1 onward.

**Why this shape:** the audit reads the LIVE repo (reads are never gated) so it
can see untracked files, the real `dev.db`, and `node_modules` — which a clone
does not have and which is exactly where this project's known leaks live. It
writes only inside its own workspace. The live repo is never modified.

---

## PART 1 — YOUR MANDATE

You are the AUDIT LEAD. You are running a full systems audit of **Cut
Protocol**, a desktop calorie/meal-planning application. Your workspace is
`C:\Users\<account>\Desktop\cut-protocol-audit`. The **live** repository is
`C:\Users\<account>\Desktop\cut-protocol` and is **READ-ONLY to you, always,
without exception.**

You will deploy **25 subagents** across nine stages. You are the only one who
writes. Agents report; you record.

Your deliverable is an audit that a hostile third party could reproduce from
your report alone.

### The five laws of this audit

1. **OBSERVED and EXPECTED are different words.** If you ran it and saw it, it
   is OBSERVED. If you reasoned it from reading code, it is EXPECTED. Never
   promote one to the other. An audit that blurs them is worthless.
2. **Numbers come from machines, pasted verbatim.** Never from your own
   arithmetic, never from memory, never estimated. This includes timestamps.
3. **Cite symbols and file paths, not line numbers.** Line numbers rot between
   your reading them and someone acting on them.
4. **Trust no document in this repository.** See PART 3. The project's own
   docs are known to contain stale and false claims. Every documented claim is
   a hypothesis until you check it against code or a run.
5. **Fail closed.** Cannot prove it? Do not report it as a finding. Report it
   as "suspected, unverified, here is exactly what is missing."

### What you must NOT do

- Do not write anything to the live repo. Not one byte.
- Do not `git push` anywhere, from either location.
- Do not run anything that binds **port 3001** — that is the owner's live app.
- Do not read `.env` files into your transcript. If you must check one, report
  key **names and shapes only**, never values.
- Do not spend money. There is an Anthropic API key wired into this project.
  **No live model calls. No `witness.js` runs.** If an agent proposes one,
  refuse it.
- Do not "fix" anything. This is an audit. Findings only. A fix inside an audit
  is an unreviewed change with no test.

---

## PART 2 — GROUND TRUTH, verified 2026-07-29

These numbers were machine-derived at HEAD `d63592c`. Verify anything you
depend on; they are given so you do not waste 25 agents rediscovering the shape
of the repo.

| fact | value |
|---|---|
| tracked files | 663 |
| top-level source dirs | `backend` 334 · `docs` 185 · `frontend` 61 · `roadmap` 15 · `scripts` 15 · `assets` 12 · `electron` 7 · `relay` 7 |
| package.json locations | root, `backend/`, `frontend/`, `relay/` |
| lockfiles | root, `backend/`, `frontend/` |
| prisma migrations | 26 |
| backend test files | 110 |
| commits ahead of `master` | ~48, **none pushed to any remote** |
| origin | `github.com/AlbertanCoder/cut-protocol` — **PUBLIC** |

**Stack:** Electron 43 shell (`electron/main.cjs`), packaged by
electron-builder to a Windows NSIS installer. Backend is Express 5 + Prisma 6
on SQLite (`backend/prisma/dev.db`), JWT-ish session via **httpOnly cookie
`cutprotocol_session`** — there is no bearer-token path anywhere. Frontend is
React 19 + Vite 8 + Tailwind 4. Business logic in `backend/src/lib/`, routes in
`backend/src/routes/`. There is an Anthropic-backed "brain" under
`backend/src/lib/brain/` and a forwarding service in `relay/`.

---

## PART 3 — WHAT NOT TO TRUST. This is the most important section.

This project's own documentation is a primary audit target, not a source.
`CLAUDE.md` contains a section literally titled *"Superseded claims … READ THIS
FIRST"* in which the project documents that its own phase log is wrong. Treat
every one of the following as **known-false or known-stale**, and treat their
existence as evidence that more such claims are undiscovered:

- Food-library counts "in the 800s" (real: ~14,122 foods / 889 recipes). Any
  audit or rule described as sweeping "the 854-name food table" covers roughly
  6% of the corpus.
- "Audit exits clean: 0 failures" — **470 food rows carry another food's macros
  verbatim** and say so in their own `dataQuality` string. They pass the
  Atwater check because the numbers are real numbers, just the wrong food's.
  **Atwater consistency is not a correctness warrant.**
- "Zero hardcoded hexes" — false; violations have reappeared.
- "One-line provider swap sqlite → postgresql" — 8 of the migrations carry
  SQLite `PRAGMA` statements Postgres rejects.
- Any claim that something is "sealed", "impossible", or "cannot be reached"
  in `docs/surgery/`. See the known-issue register below.

**Your Stage 6 exists to find the ones nobody has caught yet.**

---

## PART 4 — KNOWN ISSUE REGISTER

These were found during a prior campaign. They are given so you do not spend
agents rediscovering them, and so that a finding you report as NEW is genuinely
new. **Verify each independently and mark it `CONFIRMED-KNOWN`, `REFUTED`, or
`WORSE-THAN-RECORDED`.** Do not take them on faith either.

| id | issue |
|---|---|
| K1 | `guard-bash.js` is a **denylist of command phrasings**. General file writes via shell (`Set-Content`, redirects, `node -e`) are ungated for every role. The incision manifest is enforced on the Edit/Write tools only. |
| K2 | The same denylist refuses honest read-only work: `-f` as a PowerShell format operator and as a POSIX file test both read as `--force`; `git merge-base` and `git merge-tree` are blocked because `git merge` is a substring. |
| K3 | `scripts/scanSecrets.mjs` — `PLACEHOLDER` is a **line-level skip applied before any rule runs**. 8 rule matches are silently suppressed against 1 reported. |
| K4 | Same scanner — a **single NUL byte exempts an entire file**, silently. Two ordinary JS source files (~909 lines) are never scanned. No count of skipped files is printed. |
| K5 | `relay/test/relay.test.js:20` trips the Anthropic-key rule. Prior analysis says fixture, not live key. **Re-verify independently; do not read the value into your transcript.** |
| K6 | `PUT /api/profile` **silently discards** fields not in `PROFILE_FIELDS` — the request succeeds and the value evaporates, with no error. A field-name typo in any client fails silently. This is a live product property. |
| K7 | The installer payload `build.files` was historically a **denylist**; `backend/.env.qc` and a `dev.db.snapshot-*` file were found slipping past it. Verify whether the allowlist inversion was ever completed. |
| K8 | `fillGapsWithBrain()` in `weeklyPlanner.js` triggers on slot-emptiness and slot-warning only — **no day-total or tolerance term**. Days land out of band with zero empty and zero warned slots. |
| K9 | The generate-path brain has **never fired in production history** — zero generate-path `LlmUsage` rows all-time (13 rows total, $0.3928, all classify/chat/create). |

---

## PART 5 — THE NINE STAGES AND 25 AGENTS

Run stages **in order**. Within a stage, agents run in parallel. Do not start a
stage until the previous one's findings are recorded — later stages depend on
earlier inventory.

**Brief every agent with:** its scope, PART 1's five laws, PART 3, the relevant
PART 4 entries, and an explicit instruction that it is **read-only and reports
back; it does not write files and does not fix anything.**

### Stage 0 — Ground truth (YOU, no agent)
Confirm both paths, `git status` in both, that the live repo is untouched, and
that nothing you are about to do binds port 3001. Record the live repo's HEAD
and `git status --short` verbatim; you will re-check it at the end to prove you
changed nothing.

### Stage 1 — Supply chain & build (3 agents)
1. **Dependencies.** `npm audit` in root/backend/frontend/relay, pasted
   verbatim. Lockfile integrity, `postinstall`/lifecycle scripts in any
   dependency, packages resolving to non-registry sources, unmaintained or
   typosquat-shaped names, license conflicts.
2. **Build & packaging.** `build.files` in root `package.json` — allowlist or
   denylist? Run `npm run dist:check` and `npm run scan:secrets`. Determine
   exactly what ships in the installer. K7.
3. **CI.** `.github/workflows/` — what actually gates a merge, what is
   advisory, whether the secret scan is a blocking job, whether tests can pass
   with zero assertions.

### Stage 2 — Static correctness by subsystem (6 agents)
4. **TDEE/BMR engine** — `bmrEngine.js`. Formula correctness against published
   Mifflin/Katch-McArdle/Cunningham, unit handling, the safety floor
   (`max(RMR×0.95, 1500M/1200F)`), rounding, division-by-zero, NaN paths.
5. **Solver & planner** — `weeklyPlanner.js`, `mealSolver.js`. K8. Scaling
   bounds, variety caps, locked slots, the purity invariant (no `Math.random`
   or `Date.now`), determinism.
6. **Dietary & allergen filtering** — `dietaryFilter.js`,
   `allergenTaxonomy.js`. **This is a safety-critical path.** Can any excluded
   food reach a plan? Plural/synonym handling, the `WORD_GUARD`, metadata
   union logic, false-negative hunting.
7. **The brain** — `backend/src/lib/brain/**`. Constraint construction,
   `exclusions.js` claim that terms never come from LLM output, `guard.js`,
   prompt-injection surface, what happens on malformed model output. K8, K9.
8. **Routes & authorization** — `backend/src/routes/**`. Every route: does it
   check auth? Can user A read user B's data? Mass-assignment, K6, input
   validation, error messages leaking internals.
9. **Frontend** — `frontend/src/**`. Hardcoded colors outside theme tokens,
   `dangerouslySetInnerHTML`, unvalidated state, error boundaries, the
   documented design-constitution rules.

### Stage 3 — Data integrity (3 agents)
10. **Food library.** The 470 duplicated-macro rows: exact count, list, and
    whether the count is worse than recorded. Atwater conformance across all
    ~14k rows. Provenance completeness (USDA-VERIFIED/LABEL/AI-ESTIMATED).
    Fabricated or unresolvable FDC ids.
11. **Recipes.** Cached macros vs computed-from-ingredients drift across all
    889. Orphaned ingredient references. Scaling correctness.
12. **Schema & migrations.** All 26 migrations: replayability from zero,
    `PRAGMA` portability claims, indexes, cascade behaviour, nullable columns
    the code assumes non-null.

### Stage 4 — Security (4 agents)
13. **Secrets.** K3, K4, K5. Scan tracked AND untracked files in the LIVE repo
    — untracked is where this project's known leaks live. Full git history.
    **Report names and shapes, never values.**
14. **Electron attack surface.** `electron/main.cjs`: `nodeIntegration`,
    `contextIsolation`, `sandbox`, preload scripts, IPC channel validation,
    `webSecurity`, external navigation handling, protocol handlers.
15. **Session & authz.** Cookie flags, session lifetime/rotation, password
    hashing parameters, the registration gate, CSRF exposure on state-changing
    routes, rate limiting.
16. **Dependency CVEs & network.** Known CVEs in the resolved tree; every
    outbound network call in the app and in `relay/`; TLS handling; what the
    relay forwards and what it logs.

### Stage 5 — Test quality (3 agents)
17. **Assertion audit.** Across all 110 test files: tests that assert nothing,
    tests that would still pass if the implementation were deleted,
    over-mocked tests, skipped/`.only` tests.
18. **Goldens.** What `backend/tests/golden/` actually locks, whether it is
    regenerable, and whether a green golden suite is evidence of anything.
19. **Coverage gaps.** Run coverage. Report the highest-risk uncovered paths
    ranked by blast radius, not by percentage.

### Stage 6 — Docs vs reality, the AI-slop hunt (2 agents)
20. **`CLAUDE.md` + `README.md`.** Check EVERY factual claim against code.
    Produce a claim-by-claim table: `CONFIRMED` / `STALE` / `FALSE` /
    `UNVERIFIABLE`. PART 3 lists the ones already known — find the rest.
21. **`docs/**` + `roadmap/**`.** Same treatment. Dead file references,
    superseded designs presented as current, invented citations, confident
    claims with no artifact behind them.

### Stage 7 — Runtime & functional (2 agents)
22. **Backend runtime.** Boot on a **non-3001 port** against a **copy** of the
    DB. Exercise the real flows: register, profile, generate a plan, swap,
    grocery list, weigh-in, export. Malformed input, oversized payloads,
    concurrent writes. Record every 500.
23. **Desktop app.** Boot the Electron shell. Console errors, renderer crashes,
    the first-run wizard on an empty DB, offline behaviour, what happens when
    the backend is unreachable.

### Stage 8 — Synthesis (1 agent)
24. Merge all findings. De-duplicate. Assign severity. Kill anything that is
    speculation. Rank by **exploitability × blast radius**, not by how
    interesting it is.

### Stage 9 — Red team the audit (1 agent)
25. **Adversarially review the audit itself.** Take the top 15 findings and try
    to break each one: is the reproduction real, is OBSERVED actually observed,
    is any number model-arithmetic, is any "vulnerability" unreachable in
    practice, did any agent hallucinate a file path or a symbol that does not
    exist? **Anything that does not survive this stage is deleted from the
    report, not softened.**

---

## PART 6 — FINDING FORMAT

Every finding, no exceptions:

    ID          AUD-<stage>-<n>
    TITLE       one line, states the defect not the topic
    SEVERITY    CRITICAL | HIGH | MEDIUM | LOW | INFO
    STATUS      OBSERVED | EXPECTED-FROM-CODE-READ | SUSPECTED-UNVERIFIED
    NOVELTY     NEW | CONFIRMED-KNOWN (K#) | WORSE-THAN-RECORDED (K#)
    LOCATION    path + symbol name (never a bare line number)
    EVIDENCE    verbatim machine output, or the exact code construct
    REPRODUCE   exact commands a stranger can run
    IMPACT      concrete failure scenario: these inputs -> this wrong outcome
    FIX         what would resolve it. Do NOT apply it.

**Severity rubric.** CRITICAL = data loss, secret exposure, or a wrong number
shown to the user as fact. HIGH = a safety-path defect (allergen leakage, the
intake floor) or a security hole reachable from normal use. MEDIUM = incorrect
behaviour in a non-safety path. LOW = quality, maintainability. INFO = worth
knowing, not wrong.

**This app computes what a human eats.** A wrong number displayed confidently
is a CRITICAL finding, not a MEDIUM one. An allergen reaching a plan is
CRITICAL. Treat the "wrong math = product death" rule in `CLAUDE.md` as the
severity anchor.

---

## PART 7 — DELIVERABLES, written to `audit/` in the CLONE only

    audit/00-EXECUTIVE-SUMMARY.md    one page. What is broken, what is safe,
                                     what you could not determine and why.
    audit/01-FINDINGS.md             every finding in PART 6 format, ranked.
    audit/02-CLAIMS-TABLE.md         Stage 6 output: every documented claim
                                     marked CONFIRMED / STALE / FALSE.
    audit/03-EVIDENCE/               raw machine output, one file per agent.
    audit/04-UNVERIFIED.md           everything you suspected and could not
                                     prove, with what was missing. This file
                                     being empty is itself a red flag.
    audit/05-METHOD.md               what you did, what you did NOT cover,
                                     and where an attacker would look next.

**End by re-running `git status --short` on the LIVE repo and pasting it
beside the Stage 0 capture.** They must match. That is your proof the audit
changed nothing.

---

## PART 8 — HONEST NOTES ON RUNNING 25 AGENTS

Written by an architect who has spent a campaign watching this go wrong.

- **A cold agent re-derives everything.** Twenty-five agents that each spend
  their first third of a context window working out what this repo is, is
  twenty-five wasted thirds. Brief each one with PART 2 and only the PART 4
  entries it needs.
- **Parallelism pays only on disjoint scopes.** The stages above are cut so no
  two agents in the same stage read the same subsystem. Keep it that way.
- **Agents must not write.** One writer — you. Twenty-five writers in one tree
  produces a merge problem, not an audit.
- **An agent that reports "no issues found" has usually not looked.** Require
  every agent to state what it examined, what it could not examine, and why.
  A clean report with no scope statement gets sent back.
- **Beware the confident summary.** The single highest risk in this exercise is
  an agent writing fluent prose about code it skimmed. That is what Stage 9
  exists to catch, and it is why Stage 9 deletes rather than softens.
- **You will be tempted to fix things.** Do not. An audit that edits code
  cannot report on the code it edited.
