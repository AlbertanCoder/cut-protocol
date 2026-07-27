# claims — surgery-20260727-1010

One falsifiable sentence per claim, artifacts by path. A claim without
artifacts is dead on arrival. I certify none of these; a stranger judges.

Symbols are cited, not line numbers, except where a line number was re-derived
at the moment of writing and is labelled as such in `evidence/E5-m0-orient.txt`.

---

**C1.** Running `node scripts/surgery/guard-selftest.js` at head
`1f16996` or later exits 0 and prints `26 passed, 0 failed, 26 total`, with
every forbidden act attempted against the real hook scripts and refused.
· `evidence/E0-guard-logic.txt` · `scripts/surgery/guard-selftest.js` ·
`.claude/hooks/guard-edit.js` · `.claude/hooks/guard-bash.js`

**C2.** Before the fix in this run, `guard-edit` ALLOWED a write to
`backend/tests/golden/engine-baseline.golden.json`, because `backend/tests/` is
on the manifest allow list and no rule sat above it; after the fix the same
path is refused with the message naming `backend/tests/golden/` as sealed to
every mode.
· `evidence/E0-guard-logic.txt` (case "EDIT SEALED golden baseline") ·
`evidence/E6-lock-proof.txt` · `.claude/hooks/guard-edit.js` (the hard-deny
block above the allow list)

**C3.** Invoking `.git/hooks/pre-push` directly, with no
`docs/surgery/CURRENT/PUSH_APPROVED` present, exits 1 and refuses the push by
name of the missing approval file.
· `evidence/E3-prepush.txt` · `.git/hooks/pre-push` ·
`.claude/hooks/pre-push-check.js`

**C4.** A `Write` tool call targeting `backend/src/lib/__guardprobe__.js` — a
path not on the manifest allow list — SUCCEEDED in this session, and the file
was observed on disk at 187 bytes before being deleted.
· `evidence/E4-binding-failed-open.txt` (PROBE 1)

**C5.** A `Bash` tool call whose command contained the literal shape
`sk-ant-` EXECUTED in this session and printed its argument, though
`guard-bash` refuses that exact shape when invoked directly.
· `evidence/E4-binding-failed-open.txt` (PROBE 2) ·
`evidence/E0-guard-logic.txt` (case "BASH literal key shape")

**C6.** This session's project root is `C:\Users\<account>` and not the
repository, and `C:\Users\<account>\.claude\settings.json` contains no `hooks`
key — so the hooks authored into the repo's `.claude/settings.json` were never
on this session's settings chain. C4 and C5 follow from this, not from a defect
in the hook scripts.
· `evidence/E4-binding-failed-open.txt` (ROOT CAUSE) ·
`.claude/settings.json` (the registration that was never loaded)

**C7.** With `locked:true` in `docs/surgery/CURRENT/manifest.json`,
`guard-edit` refuses writes to `.claude/hooks/guard-edit.js`, to
`docs/surgery/surgery-20260727-1010/manifest.json`, to
`docs/surgery/CURRENT/manifest.json`, to `scripts/surgery/`, and to
`backend/tests/golden/`, while still allowing all four incision sites, new
files under `backend/tests/`, and the run's own docs directory — 13 cases,
0 failures.
· `evidence/E6-lock-proof.txt` · `scripts/surgery/lock-proof.js` ·
`docs/surgery/CURRENT/manifest.json`

**C8.** `node scripts/surgery/goldens-verify.js` exits 0 and prints
`GOLDENS INTACT`: `backend/tests/golden/` has no working-tree drift from HEAD,
no untracked strays, and the golden suite passes 10/10 under `BRAIN=off`.
· `evidence/E1-goldens-baseline.txt` · `scripts/surgery/goldens-verify.js`

**C9.** `node scripts/surgery/ledger-delta.js` reports 13 rows and \$0.3928
all-time, split classify 8 / \$0.0026, chat 4 / \$0.1983, create 1 / \$0.1919,
with the newest row `cmrzu1bcd0051wlo08nakbblp` dated 2026-07-25T03:51:39.182Z
— reproducing receipt v3's `== MONEY ==` block through a query written for this
run, via the repo's own Prisma client rather than the verifier's path.
· `evidence/E2-ledger-baseline.txt` · `scripts/surgery/ledger-delta.js`

**C10.** No `LlmUsage` row exists whose `phase` corresponds to the generate
path, at any time up to and including this run; the ledger delta for this run's
window is zero rows and \$0.0000, because no model call was made.
· `evidence/E2-ledger-baseline.txt` (all 13 rows are classify / chat / create)

**C11.** This run modified no file under `backend/src/`; `git show --stat` for
its commits lists only `.claude/`, `scripts/surgery/`, and
`docs/surgery/`.
· `git show --stat 1f16996` and the lock commit · `git diff e86c15c..HEAD --stat -- backend/src/`
(expected: empty)

**C12.** In `fillGapsWithBrain()` in `backend/src/lib/weeklyPlanner.js`, the
candidate-collection predicate tests only `!s.recipeId` and `s.warning`, and
contains no day-total or tolerance term — so a day whose slots are all filled
and none warned nominates zero candidates however far its totals sit outside
the prescription's bands. Unchanged by this run.
· `evidence/E5-m0-orient.txt` (M1) · `backend/src/lib/weeklyPlanner.js`

**C13.** In `brainRelayConfig.js`, the reason string `"relay-unreachable"` is
returned by `probeRelay()` on both its not-ok and its throw path and is
documented in the `status()` doc comment, but `status()` itself never returns
it. Unchanged by this run.
· `evidence/E5-m0-orient.txt` (M4) · `backend/src/lib/brainRelayConfig.js`

**C14.** `scripts/surgery/witness.js` has never been executed — no
`dev.db.backup-witness-*` file exists in `backend/prisma/`, and no evidence
file matching `witness-*-response.json` exists in this run's `evidence/`
directory.
· `backend/prisma/` listing · `docs/surgery/surgery-20260727-1010/evidence/`

**C15 (null result, pre-authorized).** The Phase Two mission — a day OUT of
tolerance under BRAIN=off landing IN tolerance under BRAIN=on, with a nonzero
timestamped `LlmUsage` delta — was not attempted, produced no evidence, and is
neither supported nor refuted by anything in this run.
· `REPORT.md` § "M1–M6 — NOT ATTEMPTED"
