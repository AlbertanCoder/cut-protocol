# PROMPT — Cut Protocol: State of Play

*A reusable research prompt. Paste the whole thing into a fresh session with
access to this machine. It directs a multi-agent sweep of everything on record
about Cut Protocol and produces one honest position paper.*

*Re-run it whenever the picture has moved. It is written to be repeatable, not
one-shot.*

---

## Your job

Answer three questions about Cut Protocol, in this order, and do not blur them
together:

1. **Where is this project actually?** Not where the docs claim. What is built,
   working, verified, and used — established from the code and the record, not
   from status files.
2. **Where does it need to be?** For it to be a finished thing rather than a
   permanent construction site. Define "finished" explicitly; do not leave it
   implied.
3. **Where *should* it be?** The judgment call. Given the owner's actual life,
   goals and constraints, is the current direction the right one — and if not,
   say so plainly.

Question 3 is the point of the exercise. Questions 1 and 2 exist to earn the
right to answer it.

---

## Who this is for, and how to talk to them

The owner is Shad. Before writing a single word of the report, **read every
`user_*.md` and `feedback_*.md` file** in:

```
C:\Users\<account>\.claude\projects\C--Users-<account>\memory\
```

Those files are binding on tone, framing and subject matter. They contain
personal context — about how he wants to be spoken to, what he is dealing with,
and what he has explicitly asked people not to do. Honor them. If one of them
conflicts with an instruction below, the memory file wins and you should say so
in your report.

Three things that are true regardless:

- **He built this with AI assistance and is uneasy about what that means.**
  Do not oversell his work to compensate, and do not discount it either. State
  what the artifact demonstrates and let it stand. Fake encouragement reads as
  confirmation of the fear.
- **He has been burned by consultant-style reports that inflate.** Do not
  manufacture urgency, do not inflate market size, and do not invent advantages
  he supposedly has. If the honest answer is small, say small.
- **Direct question, direct answer.** No throat-clearing, no "great question",
  no hedging a finding across three paragraphs.

---

## Sources

Everything below is real and on this machine. Read the actual files; do not
reason from what you assume a project like this contains.

**Repo** — `C:\Users\<account>\Desktop\cut-protocol\`
- `CLAUDE.md` (33 KB) — the ruleset **and** a table of its own superseded claims
- `BATTLE-PLAN.md` (22 KB) — remediation plan, phased
- `AUDIT.md` (33 KB), `PABLO_REVIEW.md` (27 KB) — external-style critiques
- `PROGRESS.md` (24 KB), `TODO.md` (15 KB), `HANDOFF.md` (8 KB)
- `docs/` — including `docs/qc/` (sweep reports, several with VOID headers) and
  `docs/surgery/CAMPAIGN/` (an adversarial architect/builder audit with its own
  ledger, orders and verdicts)
- `roadmap/`, `backend/tests/` (~1,491 tests), `frontend/src/`
- Git history: ~250 commits from 2026-07-17

**Memory** — 43 files at the path above. Five are Cut Protocol specific:
`project_cut_protocol`, `_audit_2026-07`, `_food_corruption`,
`_product_prefs`, `_solver_brain`.

**Conversation transcripts** — ~60 sessions, ~32 MB:
```
C:\Users\<account>\.claude\projects\C--Users-<account>-Desktop-cut-protocol\*.jsonl
C:\Users\<account>\.claude\projects\C--Users-<account>-Desktop-cut-protocol-backend\*.jsonl
```
These are large JSONL transcripts. **Do not read them whole into context** —
grep for markers, sample by date, and extract. Assign them across agents by
date range so no one agent drowns.

**Worktrees** — 10 parallel branches at `C:\Users\<account>\worktrees\`
(`cp-*`, `cut-protocol-*`). Each represents a workstream that was started.
Determine which ones landed and which are abandoned.

---

## The central trap: this project's documentation lies about itself

This is the single most important instruction in the prompt.

`CLAUDE.md` contains a section titled **"Superseded claims in the phase log
below — READ THIS FIRST"**. It is a table of things the project confidently
recorded as done that later turned out to be false — food counts off by 16×,
"zero hardcoded hexes confirmed" that had since regressed, an installer leak
described as fixed that had merely moved, a "one-line provider swap" that is
eight migrations of work.

The same pattern recurs in the QC reports. `docs/qc/integrity-sweep.md` opens
with **"⚠ VERDICT VOID — this report's headline 'corruption: 0 — clean' is
wrong."** A test passed because it was structurally incapable of detecting the
bug class it claimed to cover.

**Therefore:**

- Treat every status document as a **claim with a date**, never as current fact.
- Where a doc asserts something is done, **verify against the code or the
  database** before repeating it. If you cannot verify it, label it
  `UNVERIFIED` in the report. Do not quietly drop it and do not quietly assert it.
- Actively look for more instances of this pattern. It is the project's
  characteristic failure mode and it is probably not exhausted.
- Apply the same standard to yourself. See "Arm check" below.

---

## Research lanes

Fan these out in parallel. Each lane returns a written finding with citations
(`file:line`, transcript date, commit SHA, or memory filename). A claim with no
citation does not go in the report.

**Lane 1 — Origin and arc.**
How did this start, what was it originally for, and how has that changed? Track
the goal as it moved: personal cutting tool → 9-phase overhaul → public repo →
design system → AI brain → …. Where did each pivot come from, and was it
finished or abandoned mid-flight? Sources: earliest transcripts, `CLAUDE.md`
phase tracker, `CLAUDE_RECOMP_ARCHIVE.md`, git history.

**Lane 2 — What actually works.**
Walk the real feature surface and verify it. For each area (profile/TDEE engine,
meal solver, recipes, importer, food library, training, trend, brain, Electron
packaging): is it complete, half-built, or scaffolding? Prove it from code and
tests, not from `PROGRESS.md`. Note what has actually been *used* versus merely
built.

**Lane 3 — Rot, debt and abandonment.**
The 10 worktrees: which merged, which are stale, which are forgotten? Dead
branches, `TODO.md` items that have gone stale, god-files
(`dietaryFilter.js` 1,779 lines, `mealSolver.js` 1,459, `PlanTab.jsx` 1,356),
the absence of frontend tests, the untyped 141 kLOC. Quantify; don't editorialize.

**Lane 4 — Trustworthiness of the data and the tests.**
The food library has been repaired repeatedly and audited repeatedly, and
several audits were later voided. Establish the *current* honest state: how many
rows are verified, quarantined, or unexamined; which tests are load-bearing and
which are vacuous; whether the CI gates would actually catch a regression.
Sources: `docs/qc/`, `backend/tests/`, `.github/workflows/ci.yml`, the live
`dev.db`, `project_cut_protocol_food_corruption` memory.

**Lane 5 — The product and its user.**
There is exactly one user. Read `project_cut_protocol_product_prefs` and the
interview transcripts behind it. What does he actually use day to day, and what
has he never touched? Then place it honestly against real alternatives
(MacroFactor, Cronometer, MyFitnessPal): what does this genuinely do better, what
is nowhere close, and what is a solved problem being re-solved? Be specific and
resist inflating differentiation.

**Lane 6 — What it has cost.**
Estimate real effort: session count, dates, working hours, how much of it landed
in evenings and weekends alongside a full-time job. Identify what was displaced.
Look for pace signals in the transcripts — overnight sessions, parallel agent
fleets, work resumed immediately after a "this is done" declaration. Report this
factually and without judgment; the interpretation belongs in the synthesis.

**Lane 7 — Decisions, reversals and recurring loops.**
What has been decided, undone, and decided again? Which problems keep coming
back under new names? Which "final" declarations were followed by more work on
the same thing? This lane is looking for the shape of the loop, if there is one.

---

## Evidence standard

- **Cite or cut.** Every factual claim carries a source. No citation, no claim.
- **Separate the layers.** "The docs say X" / "the code does Y" / "the database
  contains Z" are three different statements. Never merge them.
- **Numbers get provenance and a date.** A count without both is a rumour.
- **Contradictions are findings.** When a doc, a memory and the code disagree,
  report the disagreement — that is more valuable than picking a winner.
- **No invented advantages.** Do not attribute skills, market position, network
  or opportunity to the owner that the record does not support.
- **Say "I don't know."** An honest gap beats a confident guess, and the owner
  can act on it.

---

## Arm check (mandatory)

This project's history is full of clean verdicts produced by checks that
examined almost nothing. Do not add to that record.

Every lane must close with an explicit statement of:
- what it examined (file counts, transcript date ranges, tables queried)
- what it could **not** examine, and why
- what a reader must therefore not conclude from its findings

If a lane returns "no problems found," it must demonstrate it had enough in
scope to have found one. A finding of zero over a scope of nearly nothing is
reported as **inconclusive**, never as clean.

---

## Synthesis: the three answers

Once the lanes are in, write the position paper yourself. Do not staple the
lane reports together.

**1. Where it is.** The honest state in plain language — what exists, what
works, what is trustworthy. Include a "what the docs claim vs what is true"
table if the gap is material.

**2. Where it needs to be.** Define "finished" concretely. If finished means
shippable to strangers, state the specific gap list. If it means good enough for
one user, say that and state what is still missing for *him*. Give a realistic
effort estimate in hours, and justify it with the observed rate of progress
rather than an optimistic guess.

**3. Where it should be.** The judgment. You are authorized to reach any of
these conclusions, and to say so directly:

- Ship the narrow version and delete the rest
- Keep going as-is, and here is the next thing
- This is a learning project and should stop being treated as a product
- Park it
- Something else the evidence supports

Whatever you conclude, **argue it from evidence** and give the strongest
counter-argument to your own position before closing.

Cover all four dimensions the owner asked for:

| Dimension | The question to answer |
|---|---|
| **Product and code** | What to build, fix, or delete next — and in what order |
| **Business** | Could this earn? What would it take? Is the honest answer no? |
| **Cost** | What it takes in time and attention, and whether that is sustainable |
| **Worth regardless** | What it is worth as capability, portfolio and proof — independent of money |

On the last two: report what the record shows and what follows from it. Do not
moralize, do not prescribe how he should feel, and do not push any income
narrative the memory files tell you to avoid. Lay out the trade-offs and let him
decide.

---

## Output

Two deliverables, same content, different lifespans.

**1. `docs/STATE-OF-PLAY.md`** — in the repo, alongside `BATTLE-PLAN.md`.
Plain markdown, fully cited, structured by the three questions. This is the
version that gets version-controlled and updated on the next run. Date it, and
list what changed since the previous run if one exists.

**2. A published artifact** — the read-it-once version.
Build it on the project's own AURORA RINGLIGHT design system (defined in
`CLAUDE.md` — the color laws are constitutional: green means on-target and
nothing else, no red on food or body data, elevation is lightness not shadow).
Load the `artifact-design` skill before writing it. It must be honest at a
glance: if the news is mixed, the page should look mixed, not celebratory.

Do not soften the artifact relative to the markdown. Same conclusions, same
numbers, better typography.

---

## Ground rules

- **Read-only until the report exists.** Change no code, no data, no config.
  Snapshot the database rather than querying it live if anything is running.
- **Never read a `.jsonl` transcript whole.** Grep, sample, extract.
- **Do not repeat a status claim you have not verified.** This is the whole
  point of the exercise.
- **Length follows substance.** If the honest report is four pages, write four
  pages. Do not pad to look thorough.
- **The last section of the report is titled "What I could not determine."**
  It is mandatory and it is not allowed to be empty.
