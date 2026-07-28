# ASK M0.1-c — the shell is an ungated write door for every role

**To:** the owner, architect to advise. **From:** the builder, at HEAD `bf1288c`.
**Status:** OPEN. Filed to disk before couriering.
**Relationship to ASK campaign.3:** confirms its Defect 2, extends it, and
reports that its proposed fix closes one door of two.

---

## 1. The architect's Defect 2 — CONFIRMED, reproduced independently

I did not take it on report. Hook invoked directly, both roles, real targets:

    builder=ALLOW  architect=BLOCK   docs/surgery/CAMPAIGN/verdicts/verdict-M0.1.md
    builder=ALLOW  architect=BLOCK   docs/surgery/CAMPAIGN/orders/order-M0.1.md
    builder=ALLOW  architect=ALLOW   docs/surgery/CAMPAIGN/ledger.md
    builder=ALLOW  architect=ALLOW   docs/surgery/CAMPAIGN/asks/brand-new-file.md

**OBSERVED.** The finding is correct exactly as stated. The graded party can
rewrite its own grades; the author cannot amend them.

## 2. It reaches further than the finding says — it reaches the LAW

`ask-campaign.3` enumerates "every order, verdict, receipt, sitrep and
checkpoint." The enumeration is incomplete. Both charters live in the same
directory:

    builder=ALLOW  architect=BLOCK   docs/surgery/CAMPAIGN/charter-builder.md
    builder=ALLOW  architect=BLOCK   docs/surgery/CAMPAIGN/charter-architect.md

**OBSERVED.** The builder can rewrite the charter that binds the builder, and
the charter that binds the architect. The campaign's own constitution — the
document stating that no block may amend a charter and that only the owner's
typed words can — is writable by the party it governs, and is not writable by
anyone else in the cage.

That is the sharpest form of the defect and it should be the headline of it.

## 3. My share of it, named plainly

`guard-selftest` has 66 green cases and **not one** of them probes builder
access under `CAMPAIGN/`. I wrote the role matrix from the acceptance list
(A2–A12) and the acceptance list asked what the *architect* could reach. Nobody
asked the mirror question, and I did not ask it either.

This is the same defect class as C3, one turn later and mine this time: coverage
that does not cover, staying green because nothing looked. A 66-green run is
worth exactly what its case list is worth.

## 4. NEW — and larger than either black-box defect

**`guard-edit` gates the Edit / Write / MultiEdit / NotebookEdit tools. Nothing
gates a file write issued through the shell.**

`guard-bash` matches command strings against a pattern list. That list contains
no path-write rule, so it does not consult the incision manifest at all.

    OBSERVED, guard-bash invoked directly:
    builder=ALLOW  architect=ALLOW   Set-Content -Path docs/surgery/CAMPAIGN/verdicts/verdict-M0.1.md ...
    builder=ALLOW  architect=ALLOW   Set-Content -Path backend/src/lib/bmrEngine.js -Value tampered
    builder=ALLOW  architect=ALLOW   echo tampered > docs/surgery/CAMPAIGN/orders/order-M0.1.md

The second line is the one that matters most. `backend/src/lib/bmrEngine.js` is
**off-manifest product code**. The Edit-tool door refuses it — that is selftest
case "EDIT OFF-manifest bmrEngine.js", green since before this mission. The
shell door waves it through, for every role.

So the incision manifest, the mechanism the whole cage rests on, is enforced on
one door and absent on the other. A5 and A8 of ORDER M0.1 — "builder Write
`backend/src/` → DENY" — are true of the Edit tool and false of the shell.

**This is not new damage from M0.1.** It has been the harness's shape since
`surgery-20260727-1010`. M0.1 neither caused it nor worsened it. It surfaced now
because ASK campaign.3 asked who can write to a directory, and that is the first
question in this campaign whose answer depended on *how* the write is made.

### Why this specifically breaks the proposed fix

`ask-campaign.3` recommends denying the builder write access under `CAMPAIGN/`
and notes: *"Guard hooks gate the Edit/Write tools, not git — so a builder that
cannot write there can still commit there."* The first half of that sentence is
the problem. Hooks gate the Edit/Write tools **and not the shell either**. A
builder denied `CAMPAIGN/` in `guard-edit` retains an unguarded `Set-Content`.

This repo has already learned this lesson once, in the opposite direction. From
run `surgery-20260727-1010`: `backend/tests/` was on the allow list and
swallowed `backend/tests/golden/`, so a plain `Write` could have relocked the
goldens *"while guard-bash was busy watching the shell."* The conclusion drawn
then was **"relocking has to be impossible through every door, not just the
expected one."** This is that same finding with the doors swapped.

## 5. A probe I did not complete, and did not route around

I attempted to test whether the goldens are reachable through the shell door.
`guard-bash` blocked my own read-only probe, because the command string named
`engine-baseline.golden.json`:

    BLOCKED: the golden relock invocation not on the incision manifest.

**Reported, not rephrased around**, per the standing rule that a guard block is
a stop sign and not a puzzle. Shape-based rules cost exactly this, by design,
and the same cost is on the record from the parent run.

What I can say without another probe, from reading `guard-bash.js`: the golden
rule matches `/engine-baseline\.golden\.json|computeBaseline/i`. Any shell
command naming the baseline file is therefore blocked. `backend/tests/golden/
fixtures.js` matches that pattern nowhere, and no other rule covers it.

**EXPECTED, from code read, NOT OBSERVED:** the goldens' *fixtures* are shell-
reachable even though the baseline JSON is name-blocked. I did not verify it and
I am not asserting it as fact. It wants a probe under an explicit order.

## 6. What I recommend

**On the black box (defects 1 and 2): adopt `ask-campaign.3`'s fix, and I say so
as the party who loses access by it.** Denying the builder write under
`CAMPAIGN/` is right. It costs me nothing real — claims, asks and evidence
belong in my run directory, which is where they now are.

**But do not stop there, because it only closes the tool door.** The thing that
actually needs protecting is the *record*, and a write only enters the record
when it is committed. So put the guarantee where it is enforceable:

**A `pre-commit` hook that refuses any commit modifying an existing tracked file
under `docs/surgery/CAMPAIGN/`, `ledger.md` excepted.**

- It is code, not regex over a shell string, so it cannot be talked around.
- It catches the shell door and the tool door with one rule, because both must
  pass through a commit to matter.
- It binds every role identically, including whoever forgot to set `CP_ROLE`.
- A tampered-but-uncommitted file stays loudly visible in `git status`.

Caveat, named not hidden: `.git/hooks/` is machine-local and does not survive a
clone — the same limitation already on record for `pre-push`, with the same
remedy of a copy under `scripts/surgery/` installed by hand.

**On the shell door generally: state the true boundary rather than widening the
regex.** You cannot pattern-match your way to write-gating a general-purpose
shell; every rule added buys one phrasing and misses the rest, while making
honest probes fail as mine just did. The cage's real guarantee — and it is a
worthwhile one — is that it stops the *accident* and the *casual* path. That is
what it has demonstrably done all mission. It should be written down as that,
in the charter, instead of being believed to be more.

## 7. What I have not done

Nothing. The hold stands: M1 unopened, `role.js` untouched, no fix attempted for
any defect in this file. Every probe above was read-only — the guards were asked
for verdicts, not obeyed into action, and no file was modified by any of them.
