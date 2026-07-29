# TRUTH — what the cage guarantees, and what it does not

Builder · 2026-07-28 19:59 MDT (2026-07-29T01:59Z) · HEAD `ca0163c`
Written under owner ruling G4. **This document overrides any stronger claim
made anywhere else in this repository's surgery record.**

## The one-paragraph version

The harness enforces the incision manifest on the **Edit / Write / MultiEdit**
tools, and nothing enforces it on the **shell**. Any session in this cage —
builder, architect, or one with no role set at all — can write any file in the
repository through `Set-Content`, a redirect, or `node -e`. Every claim in this
record that a thing is *sealed*, *impossible*, or *cannot be reached* is true of
the tool door it was tested against and silent about the shell door beside it.

## Two doors, measured

| act | Edit/Write tool | shell |
|---|---|---|
| write `backend/src/lib/bmrEngine.js` (off-manifest) | BLOCK | **ALLOW** |
| write `docs/surgery/CURRENT/manifest.json` | BLOCK | **ALLOW** |
| write either charter | BLOCK | **ALLOW** |
| write into `backend/tests/golden/` | BLOCK | **ALLOW** |
| delete a git hook | n/a | **ALLOW** |

OBSERVED, both sessions independently, hooks invoked directly. `guard-edit`
consults the manifest. `guard-bash` matches command strings against a denylist
of phrasings — `git push`, `rm -rf`, `--force`, the golden baseline *by
filename*. It has no path-write rule and never reads the manifest.

## Corrections to the record, by name

- **`guard-edit.js`: "Relocking the goldens is mechanically impossible."**
  True of the Edit door. False of the shell. `guard-bash` protects the goldens
  by *filename*, so a write addressed to the directory trips no rule.
- **VERDICT M0.1, criteria A5, A6, A11 (DENY results).** All probed with the
  Edit tool. They stand for that tool only and were written unqualified.
- **Any earlier claim that "the cage bites."** It bit the door that was tested.
  No session tested the other one until 2026-07-28.
- **This is not new damage.** The harness has had this shape since
  `surgery-20260727-1010`. It surfaced only when a question finally depended on
  *how* a write was made.

## What the harness does deliver — and it is worth having

1. **It stops the accident.** A wrong path in a tool call is refused, every
   time. That was a live risk and it is now closed.
2. **It stops the casual path.** The obvious phrasing of a forbidden act is
   refused.
3. **It makes a deliberate breach deliberate.** A session that breaches has to
   choose a different mechanism on purpose, which means a breach cannot be
   mistaken for a slip.
4. **Role is real and fails closed.** `CP_ROLE` binds in-process, cannot be
   changed from inside a tool call, and an absent value lands on the tighter
   door rather than minting an unbound builder.

## What it does not deliver

Containment of a session that intends to breach. It never did.

**The evidentiary value of this campaign rests on the committed record, the
owner's review, and the push gate — not on the guards.** Every mission's work
is small, committed, and readable in `git log`; nothing reaches the public
remote without the owner's hand. Those are the real controls. The guards are
seatbelts: they make the ordinary case safe and they are honest about not being
a roll cage.

## Why the denylist is not repaired by adding rules

`guard-bash` is a denylist of command phrasings over an infinite space of
phrasings. The repository already wrote this lesson into its own constitution,
for packaging: *"a denylist over a directory that agents and scripts keep
writing new files into is structurally unable to stay correct … Never add a new
`!pattern` as the fix for a leak — that is re-committing the original error."*

The evidence that widening fails is in this campaign's own record. Three
refusals of honest, read-only work, none of them attempting anything forbidden:

- a `Get-FileHash` sweep, refused because PowerShell's `-f` format operator
  read as a force flag;
- a goldens probe, refused for naming the baseline file;
- a commit message, refused for quoting the guard rule it was explaining.

Every rule added buys one phrasing, misses the rest, and taxes honest work. The
structurally correct fix — removing `node:*` and `npm:*` from the permission
allowlist and permitting specific script invocations instead — would break the
test runner, the surgery scripts and the witness. It is named here so that
nobody believes the cheap fixes achieved it. It was not attempted.

## Standing rule for future sessions

When writing that something is blocked, sealed, or impossible, **name the door**:
"refused by the Edit-tool guard" or "refused by the pattern guard". An
unqualified "impossible" in this record is now a defect, not a claim.
