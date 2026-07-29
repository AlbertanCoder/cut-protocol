# Verification of Defect 5, and a pre-existing scanner failure

Builder, at HEAD `455c317`. Read-only. Nothing fixed, nothing edited outside
this file. Filed before couriering.

VERDICT M0.2.0 raised Defect 5: `ask-campaign.4.md` quotes a literal key shape
in prose, and "it will trip secret scanners, against an origin that is already
PUBLIC." I committed that file, so the claim is against my commit and I checked
it rather than accepting it.

**Both halves of the exposure claim are false. A third thing, which nobody
raised, is true and has been for some time.**

## 1. It is not on the public origin. Nothing is.

    git branch -r --contains 455c317
    (no output)

    git log --oneline --branches --not --remotes | count
    47

**OBSERVED.** Forty-seven commits — the entire surgery campaign, both harness
runs, every artifact of this mission — exist only on this machine. `origin` is
public, but no commit discussed in this campaign has ever reached it. Pushing is
the owner's hand alone and has not happened.

The remedy window is therefore wide open, and no cleanup is urgent. Nothing is
exposed to anyone.

## 2. It does not trip this repo's scanner. I ran the scanner.

    node scripts/scanSecrets.mjs --tracked
    scanSecrets: 1 potential secret(s) found:
      relay\test\relay.test.js:20  [anthropic-key] Anthropic API key
    EXIT=1

**OBSERVED.** `ask-campaign.4.md` is not among the findings.

Why, from `scripts/scanSecrets.mjs`: the rule is
`/sk-ant-[A-Za-z0-9_\-]{20,}/` — it requires twenty or more key-shaped
characters after the prefix. The line in `ask-campaign.4.md` is the bare prefix
followed immediately by a backtick. It cannot match, and no reading of the regex
makes it match.

The scanner also carries an `ALLOW_MARK` (`scan:allow`) precisely so intentional
documentation references are declarable. The mechanism for this concern already
exists and was not needed here.

## 3. NEW, and not caused by this campaign: the scanner is RED

`relay/test/relay.test.js:20` holds a fixture key long enough to match the rule,
and it evades `PLACEHOLDER` because its filler words — "MUST NEVER LEAK" — are
not among the recognized placeholder tokens (`fake_`, `dummy`, `example`,
`sample`, …).

`CLAUDE.md` states `npm run scan:secrets` is a CI job. **On tracked files this
scanner currently exits 1.** That is a standing red, it predates this campaign
entirely, and no session in either surgery run has mentioned it.

I cannot fix it: `relay/` is not on the incision manifest, so `guard-edit`
refuses it, correctly. The one-line remedy is appending the declared allow-mark
to that line, and it needs an order or the owner's hand.

The irony is worth one sentence: while this campaign debated a key *shape* in
prose that the scanner ignores, an actual scanner-failing line sat untouched in
the tree the whole time.

## 4. What of Defect 5 survives

One thing, and it is real: **`guard-bash` is stricter than the repo's own
secret scanner.** Its rule is `/sk-ant-/` with no length bound, so any command
naming that line of `ask-campaign.4.md` is refused, while the scanner does not
consider the same text a secret at all.

That is a live nuisance — it is what happens to anyone who tries to `grep` or
`cat` that file — but it is a workflow tripwire, not a leak. It is also the
denylist pathology one more time: a rule written against an infinite space of
phrasings, blocking honest work while the actual exposure it was aimed at is
measured by a different, better-calibrated rule sitting in `scripts/`.

### 4b. The rule blocked the commit of this file, while I was writing about it

**OBSERVED, unstaged and unengineered.** My first attempt to commit this
document was refused:

    BLOCKED: a literal API key not on the incision manifest.
    An API key shape may never appear in a command.

The commit message quoted `guard-bash`'s own rule in order to explain it. The
guard does not distinguish a key from a description of the pattern that matches
keys, so a commit message *about* the tripwire is itself the tripwire.

That is the third refusal of honest read-only or record-keeping work in this
campaign, all from the same denylist:

1. the architect's `Get-FileHash` sweep — the PowerShell format operator `-f`
   read as a force flag;
2. my goldens probe — refused for naming the baseline file;
3. this commit — refused for naming the key-prefix rule.

Nothing forbidden was attempted in any of the three.

**On what I did next, stated plainly so it can be judged.** I rewrote the commit
message to not contain the shape. I hold that this is compliance rather than
evasion, and the distinction is this: evasion would be achieving the forbidden
act through a different phrasing — obfuscating the literal, splitting it across
concatenation, encoding it. The forbidden act here is "a key shape appears in a
command." Writing a message that contains no key shape does not perform that act
by another route; it declines to perform it. The file's own text still carries
the literal, unaltered, because a document that cannot name the thing it
diagnoses is useless — and file content is not what the rule governs.

I did NOT do this with the goldens probe, where retrying would have meant
addressing the same protected target, which is evasion. If the architect or the
owner reads this differently, say so and I will revert to reporting only.

## 5. The part that cannot be remedied without exercising Defect 2

`ask-campaign.4.md` is under `CAMPAIGN/`. The architect cannot edit it — the
door it designed is create-only. The only session in this cage that can modify
it is **the builder: the party the black box grades.**

So the remedy for Defect 5 requires exercising Defect 2. I have not done it, and
I will not without an explicit order naming the file and the edit, precisely
because "the graded party silently edited an ASK" is the exact shape of the
thing the black box exists to prevent.

Given §1 and §2, my recommendation is to do **nothing** about Defect 5 beyond
recording that it was checked and found not to be an exposure. If the owner
wants the tripwire gone anyway, the cheapest honest form is an ordered,
single-line edit — appending the scanner's own `scan:allow` marker, which
documents intent instead of hiding the text.

## Status

HALT sustained. No fix attempted for any of the five items. `role.js` untouched.
