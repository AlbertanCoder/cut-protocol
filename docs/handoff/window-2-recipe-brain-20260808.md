# WINDOW 2 — handoff, 2026-08-08

**Path used: `docs/handoff/` (preferred).** No guard block was encountered. See item 4
— that is NOT evidence I was permitted, and the distinction matters.

**Branch-name caveat.** The filename carries `recipe-brain` because that is what is
checked out. This session never worked *on* recipe-brain. Its subject matter was
`saas-launch` (the payment build) and, latterly, the orchestration survey itself.

---

## IDENTITY

**1.**
```
git rev-parse --show-toplevel   (home)/Desktop/cut-protocol
git branch --show-current       recipe-brain
git rev-parse --short HEAD      2de33be
```

**2. `git status --porcelain` — verbatim:**
```
(empty — working tree clean)
```
Nothing modified, nothing untracked. Earlier in this session's lifetime the tree was
dirty with recipe-brain work (`aiRecipeClient.js`, `recipeGeneration.js`,
`exclusionGate.test.js`, plus untracked `backend/src/lib/recipeBrain/`,
`backend/tests/recipeBrain/`, `docs/recipe-brain.md`, `backend/data/recipeSources.json`,
`docs/surgery/PROMPT-{S,V}-recipe-brain.md`). **None of that was mine** — another window
owned it, and it has since been committed. I observed it; I did not touch it.

**3.** `origin/saas-launch` does not exist. Last 10 commits:
```
2de33be docs(orchestration): amend PROMPT B — missions 0 and 1 are already done
e547224 docs: neutralise the branch-deletion instruction, reconcile CLAUDE.md
ae7df6d chore(permissions): drop the backend/src/lib/** denies — MISSION 1 item 3 closed
9dba8d0 docs(orchestration): resolve MISSION 1 item 3 — analysis, not the edit
d0dd279 docs(handoff): fix the redaction placeholder rendering
6b4bf3a docs(handoff): sweep in the handoff that was stranded outside the repo
66ca6f1 docs(orchestration): amend PROMPT A so it survives an architect window
a8011f1 harness(surgery): grant docs/qc/ — the escalation from 5c2645f, resolved
f8d5995 harness(surgery): install the orchestration-2026-08-08 window, selftest green
22989f7 docs(orchestration): draft the MISSION 0 manifest, with the CURRENT carve-out
```

**4. CP_ROLE and whether the guards bound — read this one carefully.**

`CP_ROLE` is **UNSET** in this terminal. But that is not the operative fact.

**This session's working directory is `(home)` — the home directory, not
the repo root.** Every repo operation I performed was via absolute path or `git -C`.

Per the amendment's own table, that puts me in row 3: *no hooks (launched outside repo
root) → ALLOW / ALLOW / ALLOW.* `.claude/settings.json` invokes
`node .claude/hooks/guard-edit.js` by **relative** path, so from `(home)`
node exits non-zero and the guard is not a block — it is absent.

**Honest answer to "did a write get refused": no write of mine was ever refused, and
that is evidence of being UNGOVERNED, not of being permitted.** Every file this session
wrote into the repo bypassed `guard-edit.js` entirely. This is precisely the ambiguity
question 4 was inserted to catch, and I am the case it catches.

Consequence for whoever sweeps: **`V2-DELTA.md` was written by an ungoverned session.**
It was never checked against the incision manifest. Treat its provenance accordingly.

---

## WHAT I WAS DOING

**5.** This session reviewed an externally-produced planning document ("Subscription
Build Prompt v2") against the actual `saas-launch` code and produced `V2-DELTA.md` — the
list of 8 confirmed payment defects. It then did the same job on `ORCHESTRATION.md`:
verifying its survey claims against the repo by command.

**6. DONE and verified — command and result.**

| Claim | Command | Result |
|---|---|---|
| Branch counts understated | `git rev-list --count master..<b>` | ux/simplify **97** (doc said 83) · pre-scrub **120** (106) · campaign-2026-07 **69** (55) · fix/audit-remediation **68** (54) |
| Contention worse than stated | `git diff --name-only master...<b>` per branch | **8** branches touch `PlanTab.jsx`, **8** touch `App.jsx` — doc said 5 and 4 |
| No launcher exists | `Get-ChildItem -Include *.bat,*.cmd,*.ps1 -Recurse` (excl. node_modules/.git) | **zero hits** — claim holds |
| All 5 hooks exist | `ls .claude/hooks` | role.js, guard-bash.js, guard-edit.js, guard-migration.js, pre-push-check.js — all present |
| Manifest stale | read `docs/surgery/CURRENT/manifest.json` | issued **2026-07-28**, allow-list omits `MIGRATION/`, `frontend/src/`, `backend/src/`, `CLAUDE.md` — claim holds |
| settings.json blocked payment work | `git show recipe-brain:.claude/settings.json` | denied `Edit/Write(backend/src/lib/**)` + `schema.prisma`. **NOW RESOLVED** by `ae7df6d` |

**7. Half-finished:** nothing. No code was written by this session at any point.

**8. Next action I would have taken:** write the falsification in item 11.1 into
`ORCHESTRATION.md` as a dated correction, because it is still live and wrong on disk.

---

## WHAT I OWN

**9. Files modified or created by this session — complete list:**

| Path | State |
|---|---|
| `V2-DELTA.md` (repo root) | Created 2026-08-06, reconstructed 2026-08-08. **Since superseded** by another window's merge of the recovered original — see item 11.5. Not mine any more. |
| `docs/handoff/window-2-recipe-brain-20260808.md` | This file. |
| `(home)\Desktop\V2-DELTA-BACKUP.md` | **OUTSIDE THE REPO.** See item 11.6. |
| `~/.claude/.../memory/project_cut_protocol_saas_launch.md` | Outside the repo. Session memory, not project state. |

**10. Contested files — `backend/src/lib/`, `backend/prisma/`, `frontend/src/index.css`,
`App.jsx`, `Sidebar.jsx`, `CLAUDE.md`:**

**NONE. Zero lines.** This session only ever read them. It holds no claim on any
contested file and blocks no other stream.

---

## WHAT I KNOW THAT ISN'T WRITTEN DOWN

### 11.1 — `ORCHESTRATION.md:236-237` is FALSE, and it is marked URGENT

The line reads:

> *packaging allowlist inversion … (URGENT: the built installer in release/ leaks a JWT
> secret, a USDA key, a cleartext seed password and 10 users' health data)*

**I tested all four claims. None is substantiated.**

| Claim | Test | Result |
|---|---|---|
| `.env` in the payload | `Get-ChildItem release/ -Recurse -Force \| ? Name -like ".env*"` | **NONE FOUND** |
| Anthropic key | ASCII scan of `app.asar` for `sk-ant-` | 2 hits, **both placeholder text** (`sk-ant-` + `...` + backtick). Regex `looksLikeRealKey=False` on both |
| USDA / Anthropic literals | unquoted `KEY=value` scan of `app.asar` | **no literal assignment** for either |
| cleartext seed password | `SEED_PASSWORD` / `SEED_EMAIL` in `app.asar` | **0 occurrences each** |
| 10 users' health data | `dev.db.template` scanned for bcrypt + emails | **0 bcrypt hashes.** 4 "email-shaped" strings, all binary noise (`@P.fffff`) — not addresses |

`release/win-unpacked/resources/` contains exactly: `app.asar` (32.62 MB),
`dev.db.template` (15.57 MB) + its `-shm`/`-wal`, `app-update.yml`, `elevate.exe`,
`app.asar.unpacked/`. **The safe-share split described in `CLAUDE.md`'s Packaging
section is working as documented.**

**Limits of my check, stated honestly:** ASCII decode only (UTF-16 strings would be
missed), and I did not fully unpack `app.asar`. But each of the four specific claims has
direct negative evidence, not merely absent positive evidence.

**Why this matters more than anything else in this file:** it currently sits at the top
of MISSION 2's parallel-slice list, flagged URGENT. Acting on it would spend the first
and best agent slot on a non-problem. **Nobody should treat it as urgent until someone
re-derives it.** It is not corrected anywhere on disk — I checked `docs/` and
`ORCHESTRATION.md` before writing this.

### 11.2 — a real finding the survey missed

`app.asar` contains an **unquoted 6-character `JWT_SECRET=` literal**. Far too short to
be the owner's real 32-byte secret, so almost certainly a **fallback default signing key
in code**. That is its own (small, real) problem — a predictable default — and it is in
no document. Worth someone's eyes; not urgent.

### 11.3 — the "~300 unmerged commits" figure is a summing error

`ORCHESTRATION.md`'s header sums per-branch counts that overlap heavily
(`backup/pre-scrub-2026-08-04` is largely a superset of the others). That is the
document violating its own standing law — *"Never sum two agents' deltas"* — in its own
opening paragraph. The distinct-commit count is materially lower. The **direction** of
the claim is right and the fan-out-is-premature conclusion still stands on the contention
evidence alone; only the number is wrong.

### 11.4 — contention is worse than documented, which strengthens the plan

8 branches touch `PlanTab.jsx` and 8 touch `App.jsx`, not 5 and 4:
`ux/simplify-2026-08`, `light-migration`, `recipe-brain`, `saas-launch`,
`campaign-2026-07`, `fix/audit-remediation`, `ui-restyle`,
`ux/plan-week-board-declutter`. The sequence-before-parallelise decision is more
justified than its own evidence claimed.

### 11.5 — I got something wrong, and it cost a merge

I told the owner `V2-DELTA.md` had been "wiped by a `git clean` or a parallel session,"
and reconstructed it from conversation context. **That diagnosis was wrong.** The file
was in a stash — `stash@{0}: On saas-launch: pre-light-migration parking` — and was
recoverable intact. I did not run `git stash list` before concluding it was lost.

The cost: my reconstruction diverged from the original, and another window had to merge
the two (reconstruction at `fa8f9f0`, recovered original at `0cbd24b`). That merge was
avoidable work created by my misdiagnosis.

**The transferable lesson: on this repo, "the file is gone" is not a conclusion until
`git stash list`, `git fsck --lost-found` and the worktrees have been checked.** Multiple
windows park work in stashes here.

### 11.6 — there is a copy of V2-DELTA outside the repo that nobody knows about

`(home)\Desktop\V2-DELTA-BACKUP.md`. I wrote it as insurance after the
believed-wipe. It is a **snapshot of my reconstruction**, not of the merged current file,
so **it is now stale and outranked by the tree.** Recorded here only so that finding it
later does not start a fresh "which copy is authoritative" investigation. It can be
deleted; the tree wins.

### 11.7 — the guard architecture has a hole this session walked through

Running Claude Code from anywhere other than the repo root disables every hook, silently,
because `.claude/settings.json` invokes them by relative path and a failed `node` exit is
not treated as a block. This is documented in `ORCHESTRATION.md`'s PowerShell preamble as
advice to the operator. **It is not enforced anywhere.** An operator who opens a terminal
in the wrong directory gets a fully ungoverned session with no warning, and — as item 4
shows — the session cannot distinguish "allowed" from "ungoverned" without checking its
own `pwd`. Suggest a startup assertion rather than a note in a prompt.

### 12 — verbal-only instructions given to this session

All four product decisions below were made **in conversation** and are now captured in
`V2-DELTA.md`'s "Decisions locked" table, so they are on disk — listed for completeness:
USD locked · build the 7-day trial · grace 7→14 days · patch the existing build rather
than restart.

**Not on disk:** the owner was told not to paste `V2-DELTA` BLOCK 1 until off
`recipe-brain` and onto `saas-launch`. That advice was mine, verbal, and is now partly
obsolete — `ae7df6d` dropped the `backend/src/lib/**` denies that were the blocker.
**The branch requirement still stands.** BLOCK 1 rewrites `schema.prisma` and
`entitlement.js`; running it on `recipe-brain` would put the payment migration on the
wrong branch.

### 13 — what I was blocked on

Nothing, which is itself the finding — see item 4. A correctly-launched window would have
been blocked writing `V2-DELTA.md` to the repo root; I was not, because no guard ran.

### 14 — files I referenced that did not exist

- **`ORCHESTRATION.md`** — `PROMPT B` instructs the orchestrator to read it first, and it
  was absent from disk when I checked. It **exists now**.
- **`V2-DELTA.md`** — appeared deleted; see item 11.5. It was stashed, not gone.

---

## Assessment of my own reliability, for whoever reads this

Verified by command and safe to rely on: items 11.1, 11.2, 11.3, 11.4, and the item 6
table. Every number there came from a command, not from arithmetic.

Not verified: whether my `release/` scan would survive a UTF-16 encoded secret or a
fully-unpacked `app.asar`. **Re-derive 11.1 before deleting the URGENT flag** — I am
confident it is wrong, but a second, differently-built check is the right standard for
removing a security claim, and this repo has already paid once for verifier monoculture.

---

`docs/handoff/window-2-recipe-brain-20260808.md`

**HANDOFF WRITTEN — recipe-brain — SAFE TO CLOSE**
