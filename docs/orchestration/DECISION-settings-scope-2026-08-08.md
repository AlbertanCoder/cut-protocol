# DECISION — the `.claude/settings.json` scope conflict (ORCHESTRATION.md MISSION 1 item 3)

Status: **analysed and recommended, NOT applied.** The change is two deleted lines in
`.claude/settings.json`. A session cannot make it — the auto-mode classifier blocks
writes to that file, which is correct and should stay that way: a session that can
rewrite its own permission config can grant itself anything. Owner's hand, like the
manifest.

## The conflict

`.claude/settings.json` denies `Edit`/`Write` on `backend/src/lib/**`. That was written
for the UI/light-migration work. It now blocks:

- V2-DELTA P0 items 1–4 — `entitlement.js` and `lemonSqueezy.js`
- the two remaining `slice(-7)` sites — `adaptiveTarget.js:144`, `weightNow.js:10`

`settings.json` deny beats allow, and it is evaluated by Claude Code independently of
the hooks, so neither an allow rule nor a manifest grant can override it. The pattern
itself has to change.

## Only one of the ten deny rules is actually in conflict

| deny rule | also enforced by | verdict |
|---|---|---|
| `backend/prisma/migrations/**` | manifest excludes all of `backend/prisma/` | redundant, consistent — KEEP |
| `backend/prisma/schema.prisma` | manifest excludes all of `backend/prisma/` | redundant, consistent — KEEP |
| `backend/tests/golden/**` | `guard-edit.js:138`, hard-denied above every allow list, mode and role | redundant, consistent — KEEP |
| `MIGRATION/baseline/**` | narrower than the manifest's `MIGRATION/` grant | protective — KEEP |
| **`backend/src/lib/**`** | manifest GRANTS `backend/src/` | **THE CONFLICT** |

## Recommendation: delete the two `backend/src/lib/**` lines

```diff
     "deny": [
       ...
-      "Edit(backend/src/lib/**)",
       "Edit(backend/prisma/migrations/**)",
       "Edit(backend/prisma/schema.prisma)",
       "Edit(backend/tests/golden/**)",
       "Edit(MIGRATION/baseline/**)",
-      "Write(backend/src/lib/**)",
       "Write(backend/prisma/migrations/**)",
       "Write(backend/prisma/schema.prisma)",
       "Write(backend/tests/golden/**)",
       "Write(MIGRATION/baseline/**)"
     ]
```

Nothing else changes. Eight of the ten deny rules stay.

## Why this does not expose the calculations

The obvious objection is that `backend/src/lib/` holds the math, and CLAUDE.md's
constitution opens with "wrong math = product death". Three reasons the protection
survives without this rule, in descending order of strength:

1. **The goldens cannot be relocked.** `backend/tests/golden/` is hard-denied at
   `guard-edit.js:138` — above every allow list, every mode and every role. Probed
   2026-08-08: BLOCK for builder, architect and unset alike. `b90b5b7`'s 11 fixtures
   lock the whole derived-number chain, and the window-9 handoff records that changing
   `adaptiveTarget.js:144` or `weightNow.js:10` fails them. So a math change is caught
   by a mechanism nobody can edit — and caught *wherever it happens*, including in a
   file a path denylist never listed.
2. **A denylist over an active directory cannot stay correct.** This is CLAUDE.md's own
   lesson, learned expensively in the packaging section: `!backend/.env` and
   `!dev.db.backup-*` did not stop `backend/.env.qc` or `dev.db.snapshot-agentcontam-*`,
   because "every new file defaults to SHIPPED". `backend/src/lib/**` has the inverse
   failure — every new file defaults to BLOCKED, so the rule silently widens as the
   directory grows and eventually blocks work nobody intended to block. It already does.
3. **The rule is scoped to a branch it is no longer on.** CLAUDE.md's first line reads
   "LIGHT-MIGRATION — Active on branch `light-migration` only", and
   `MIGRATION/CONTRACT.md`'s rule 2 is where the no-calculation-changes constraint
   actually lives. `settings.json` is one file across every branch, so a
   light-migration-only rule is currently binding `recipe-brain`, `master` and
   `claude/apps-editing`, where that migration is not running.

## What stays protected afterwards, and by what

| | protected by |
|---|---|
| `backend/prisma/` (schema + migrations) | manifest exclusion AND settings deny |
| `backend/tests/golden/` | `guard-edit.js:138` hard deny AND settings deny |
| `MIGRATION/baseline/` | settings deny |
| the derived-number chain | golden fixtures, which cannot be relocked |
| changing a calculation at all | `MIGRATION/CONTRACT.md` rule 2, and ORCHESTRATION.md's ESCALATE-NEVER-DECIDE list |

## The consequence to accept, stated plainly

After this change, `adaptiveTarget.js:144` and `weightNow.js:10` become *editable*. They
should still not be edited casually: fixing them moves every derived number and fails 11
golden fixtures by design. That failure is the escalation working, not a bug — per
ORCHESTRATION.md, "a golden fixture that fails — stop everything, that means the math
moved." Here the math moving is the point, and the re-base is legitimate, but it needs
the owner's explicit sign-off in the same sitting.

If that is too loose, the stricter variant is to keep the deny and narrow it by name
(`bmrEngine.js`, `adaptiveTarget.js`, `weightNow.js`, `profileTarget.js`,
`expenditureEstimator.js`, `mealSolver.js`, `weeklyPlanner.js`, `macroCloser.js`).
Recommended against, for reason 2 above: that is a denylist over a directory agents keep
adding files to, and it will rot exactly the way the packaging one did.

## Verification note

The recommendation was reasoned from the file contents and from hook probes. It could
not be empirically tested end-to-end: `settings.json` permissions are evaluated by
Claude Code itself, not by the hooks, so a script cannot exercise them the way
`guard-edit.js` can be exercised. The hook-layer claims in this document WERE probed
directly; the settings-layer claims are read from the file.
