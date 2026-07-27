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

---

## Resume session — 2026-07-27, rooted inside the repository

Claims C16 onward were produced by a session whose `git rev-parse
--show-toplevel` resolved to `C:/Users/<account>/Desktop/cut-protocol`, i.e.
the condition C6 identified as missing. Same discipline: falsifiable sentence,
artifacts by path, certified by nobody.

**C16.** Eight forbidden acts, issued as real tool calls by the model rather
than as script invocations, were each refused by a PreToolUse hook with the
hook's own text: a `Write` to `backend/src/lib/__guardprobe__.js`, a `Bash`
carrying the literal `sk-ant-` shape, `git push --dry-run`, a `require()` of
`engine-baseline.golden.json`, an HTTP probe of `localhost:3001`, a shell
redirect creating `docs/surgery/CURRENT/PUSH_APPROVED`, an `Edit` to
`.claude/hooks/guard-bash.js`, and an `Edit` flipping `"locked"` to `false` in
`docs/surgery/CURRENT/manifest.json`. Zero FAILED-OPEN.
· `evidence/E7-binding-proof.txt`

**C17.** C4 and C5 remain TRUE as records of the mis-rooted session and are
FALSE as descriptions of the guards under correct binding: the identical `Write`
and the identical `Bash` command, re-issued verbatim here, were both refused.
The scripts never changed between the two sessions — only the project root did,
which is exactly what C6 predicted.
· `evidence/E7-binding-proof.txt` (PROBE 1, PROBE 2) · `evidence/E4-binding-failed-open.txt`

**C18.** After the binding probes, `backend/src/lib/__guardprobe__.js` does not
exist, `docs/surgery/CURRENT/` contains only `manifest.json`, and `git status
--short` reports no change other than the pre-existing untracked
`docs/surgery/surgery-20260727-0217/verify/`.
· `evidence/E7-binding-proof.txt` § POST-PROBE DISK STATE

**C19.** `node scripts/surgery/guard-selftest.js` and `node
scripts/surgery/lock-proof.js` re-run at head `2ffc7a7` print `26 passed, 0
failed, 26 total` and `13 passed, 0 failed` respectively, both exit 0,
reproducing E0 and E6 with no regression.
· `evidence/E0-guard-logic.txt` · `evidence/E6-lock-proof.txt`

**C20 (the instrument is defective).** `scripts/surgery/witness.js` cannot
complete its authenticated path against ANY database, not merely against a
populated one, because its `api()` helper authenticates with an
`authorization: Bearer <token>` header while `requireAuth` and `optionalAuth`
in `backend/src/lib/auth.js` read the session exclusively from the httpOnly
cookie `cutprotocol_session` and no bearer path exists anywhere in the app.
· `evidence/E8-witness-dryrun.txt` · `backend/src/lib/auth.js` (`requireAuth`,
`optionalAuth`) · `scripts/surgery/witness.js` (`api`)

**C21.** Independently of C20, `POST /api/auth/register` responds
`{ id, email, role }` and issues its session via `setSessionCookie`, returning
no `token` and no `accessToken` in the body — so witness.js's `if (!token)
throw` fires even on a zero-user first-run install where the registration gate
would have opened.
· `backend/src/routes/auth.js` (the `res.status(201).json(user)` after
`setSessionCookie`) · `scripts/surgery/witness.js` (the token extraction after
register)

**C22.** The failure observed in practice was neither of the above but the
registration gate: `POST /api/auth/register` returned 403 `"This machine
already has an account."`, because the route permits registration only when the
install has zero users or the caller already holds a live session, and the
witness hard-asserts its target is the owner's populated
`backend/prisma/dev.db` and sends no session.
· `evidence/E8-witness-dryrun.txt` (RUN 2) · `backend/src/routes/auth.js`
(the `isFirstRun` / `caller` gate)

**C23.** witness.js's failure path exits **127** with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c,
line 76`, not the documented 1, because `main().catch()` disconnects Prisma
while the registered `process.on('exit', shutdown)` handler kills the spawned
server — so a crashed witness and a cap-breached witness are distinguishable
only by reading the text, never by the exit code.
· `evidence/E8-witness-dryrun.txt` (DEFECT 2) · `scripts/surgery/witness.js`
(the `catch` handler and the `exit` listener)

**C24.** Everything witness.js does BEFORE authentication worked on first
execution: the four dev-DB refusal branches, the pre-flight backup (written to
`backend/prisma/dev.db.backup-witness-20260727-104453`, 17,629,184 bytes), the
month-to-date cap correction arming `monthly<=$0.8928` from `$0.3928` already
spent, the boot on `127.0.0.1:3999`, and a ledger pre-snapshot naming
`cmrzu1bcd0051wlo08nakbblp` — the same newest row C9 reports, re-derived by a
different code path.
· `evidence/E8-witness-dryrun.txt` (RUN 2) · `evidence/E2-ledger-baseline.txt`

**C25.** C14 is superseded: `scripts/surgery/witness.js` HAS now been executed,
and `backend/prisma/dev.db.backup-witness-20260727-104453` exists. No witness
account was created, because registration was refused before any write, so
`dev.db` itself is unmutated.
· `evidence/E8-witness-dryrun.txt` § SIDE EFFECTS LEFT ON DISK

**C26.** No manifest edit can authorize a session inside this cage to repair
witness.js: in `.claude/hooks/guard-edit.js` the `locked` block testing
`lower.startsWith('scripts/surgery/')` executes and calls `die()` BEFORE the
`manifest.allow` list is read, so adding `"scripts/surgery/witness.js"` to
`allow` is inert. The only manifest edit that opens that path is `"locked":
false`, which simultaneously unseals `.claude/`, both manifests, and every
harness script.
· `.claude/hooks/guard-edit.js` (the locked block above the allow-list block) ·
`evidence/E6-lock-proof.txt` (cases "the harness scripts", "this proof script")

**C27 (null result).** M1–M6 were not attempted in this session for two
independent reasons, either sufficient: R3's gate closed on C20–C23, and the
body of PROMPT S2 — which R4 states is "pasted below this file" and from which
M1–M6 are to be read "exactly as written" — was not present in the session
input. No file under `backend/src/` was modified; `git status --short` shows
only this run's own docs.
· `REPORT.md` § "RESUME SESSION — R3 GATE CLOSED"
