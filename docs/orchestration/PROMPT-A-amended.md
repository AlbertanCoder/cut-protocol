# PROMPT A (amended 2026-08-08) — session handoff

You were pointed here by a one-line paste. Read this whole file, then do it.

## Amendment — why this file exists

ORCHESTRATION.md's PROMPT A tells you to write `docs/handoff/window-<N>-...md`.
That path is now on the incision manifest, but the manifest is not the only
gate. `guard-edit.js` intersects it with a **role door**, and `CP_ROLE` cannot
be set from inside a running session — so whichever role your terminal was
launched with is the one you have.

Measured on this repo, 2026-08-08:

| | `docs/handoff/` | `docs/surgery/CAMPAIGN/handoffs/` | `git commit` |
|---|---|---|---|
| `CP_ROLE=builder` | ALLOW | BLOCK | ALLOW |
| `CP_ROLE` unset → architect | BLOCK | ALLOW (create-only) | BLOCK |
| no hooks (launched outside repo root) | ALLOW | ALLOW | ALLOW |

Most terminals open right now were launched before the harness existed on
their branch, so they are architect and **cannot** write `docs/handoff/`.

**Therefore: try `docs/handoff/` first. If the guard blocks you, write to
`docs/surgery/CAMPAIGN/handoffs/` instead and say which one you used.**
A guard block is a stop sign — report it, take the other path, do not try to
route around it any other way.

**Do NOT commit.** Some of you cannot, and it does not matter: the file on disk
is the deliverable. One session will sweep and commit them all afterwards.

---

## The prompt

```
You are WINDOW <N>.

STOP whatever you are doing. Do not start new work. Do not commit anything.

You are one of several Claude Code sessions running against this repo, and we are
consolidating into a single orchestrated terminal. Your only job now is to write
down everything you know that is not already on disk, so the next session does not
have to rediscover it.

WRITE IT TO A FILE FIRST, then show it to me. The file is the original; the paste is
a copy.

  Preferred path: docs/handoff/window-<N>-<branch-name>-20260808.md
  If that write is BLOCKED by the guard, use instead:
                  docs/surgery/CAMPAIGN/handoffs/window-<N>-<branch-name>-20260808.md
  Say plainly which path you used and quote the block message if you got one.

Other sessions are writing their own files in those directories at the same time — if
the name you were going to use already exists, do not overwrite it; add your short
HEAD sha to the name and say so. Window 9 is already taken; do not reuse it.

Answer all of these. "I don't know" is a valid and useful answer — guessing is not.

IDENTITY
1. `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse --short HEAD`.
2. `git status --porcelain` — verbatim. For every modified or untracked file, one line
   on what the change is and whether it is finished.
3. `git log --oneline origin/saas-launch..HEAD` if that ref exists, else the last 10 commits.
4. Say whether CP_ROLE was set in this terminal, and whether the guards actually bound —
   the honest answer to "did a write get refused" is the only reliable evidence.

WHAT YOU WERE DOING
5. In two sentences: what was this session for?
6. What is DONE and verified? Name the command you ran and its result. If you did not
   run it, say so — "lint and build are green" is only true if you ran them.
7. What is half-finished? Be specific about which file and which function.
8. What is the very next action you would have taken?

WHAT YOU OWN
9. List every file you have modified or intend to modify. This is the collision list —
   another stream may be in the same file, so completeness matters more than brevity.
10. Did you modify anything under `backend/src/lib/`, `backend/prisma/`,
    `frontend/src/index.css`, `App.jsx`, `Sidebar.jsx`, or `CLAUDE.md`? These are the
    contested files. Name the exact lines if so.

WHAT YOU KNOW THAT ISN'T WRITTEN DOWN
11. Any trap, gotcha, or dead end you hit and worked around. Especially: anything you
    discovered was already broken before you touched it.
12. Any instruction you were given in conversation that is not in a committed file.
    This is the highest-value item here — verbal-only rules die with your window.
13. Anything you were BLOCKED on, and by what: a guard hook, a permission prompt, a
    missing credential, a decision you needed from the owner.
14. Any file you referenced that turned out not to exist.

HONESTY REQUIREMENTS
- Do not describe intended work as completed work.
- Do not restate a plan document back to me; I have those. Tell me what you know that
  the documents do not.
- If you have been running a long time and are unsure whether something landed, say
  "unverified" rather than picking the flattering answer.
- If you made a change you now think was wrong, say so plainly. That is the single most
  useful sentence you can write.

Finish by printing the file path and `HANDOFF WRITTEN — <branch> — SAFE TO CLOSE`.
Then stop. Do not do anything else.
```

---

## What changed from the ORCHESTRATION.md original

1. **Fallback path added**, because architect-role windows cannot write `docs/handoff/`.
2. **New question 4** — asks whether the guards actually bound. A window that wrote
   successfully proves nothing on its own: it is ambiguous between "allowed" and
   "ungoverned", and that ambiguity is what produced a half-finished extraction last time.
3. **"Do not commit" made load-bearing** rather than incidental. Architect windows cannot
   commit; requiring it would strand them.
4. **Window 9 named as taken** — `docs/handoff/window-9-saas-launch-20260808.md` already
   exists and is committed.
5. Original item numbering shifted by one from the insertion at 4; nothing was removed.
