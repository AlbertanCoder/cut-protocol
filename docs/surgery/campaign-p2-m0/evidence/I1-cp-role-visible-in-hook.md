# I1 — Is `CP_ROLE` visible inside a PreToolUse hook child process?

**VERDICT: TRUE. OBSERVED, not assumed. Order M0.1 is not void; M0 may proceed.**

Mission M0.1 · run_id `campaign-p2-m0` · HEAD at test `b82d577` · role terminal
`CP_ROLE=builder`.

## Why this needed an experiment

The whole M0 design rests on one assumption: a hook, spawned by Claude Code as
a child process, can read the env var of the terminal that launched the
session. It looks obvious. It had never been tested in this repo, and the
previous run's failure — hooks that existed on disk but never fired because the
session was rooted in the wrong directory — is precisely the class of mistake
that looks obvious right up until it is false.

## Method

A temporary probe was added to the top of **both** already-registered hooks,
`.claude/hooks/guard-edit.js` and `.claude/hooks/guard-bash.js`, appending one
JSON line per invocation to `I1-hook-env-probe.jsonl`. The probe is wrapped in
`try/catch` so that a probe failure can never alter a guard verdict.

Two details of method worth recording:

- The probe went into the **existing** hooks rather than a new one. Claude Code
  snapshots hook registration at session start, so a hook newly registered in
  `settings.json` mid-session would never fire — that exact effect is on the
  record from run surgery-20260727-1010. Editing a script that is already
  registered takes effect immediately, because the command re-reads the file on
  every invocation.
- The probe was driven by **real tool calls** — a real `Write`, a real `Edit`,
  a real shell call — not by a harness spawning the hooks itself. A harness
  spawn would only have proved that the harness passes its own environment
  down, which is not the question.

## Result — verbatim from `I1-hook-env-probe.jsonl`

    {"hook":"guard-edit","present":true,"raw":"builder","typeof_raw":"string","pid":32740,"ppid":27688,"at":"2026-07-28T11:07:50.765Z"}
    {"hook":"guard-edit","present":true,"raw":"builder","typeof_raw":"string","pid":4936,"ppid":35952,"at":"2026-07-28T11:08:03.380Z"}
    {"hook":"guard-edit","present":true,"raw":"builder","typeof_raw":"string","pid":26792,"ppid":24948,"at":"2026-07-28T11:08:08.074Z"}
    {"hook":"guard-bash","present":true,"raw":"builder","typeof_raw":"string","pid":3940,"ppid":30124,"at":"2026-07-28T11:08:10.837Z"}

`present:true`, `raw:"builder"`, `typeof_raw:"string"` — in **both** hooks. The
shell gate was proved separately rather than by analogy from the edit gate.

The live door probe that drove the third and fourth lines is
`I1-live-door-probe.txt`: created by a real `Write`, then modified by a real
`Edit`, both to a manifest-allowed path, both accepted.

## Unordered extra: can a session promote itself?

Not asked for by the order. Worth knowing, because if a session could rewrite
its own `CP_ROLE` from inside a tool call, the wall would be decorative.

    call 1:  $env:CP_ROLE = 'architect'; Write-Output "shell now claims: [$env:CP_ROLE]"
             OBSERVED -> shell now claims: [architect]

    call 2:  Write-Output "next call, shell sees: [$env:CP_ROLE]"
             OBSERVED -> next call, shell sees: [builder]
             hook child on that same call, OBSERVED -> "raw":"builder"

**The self-promotion did not take, by two independent mechanisms.** Shell state
does not persist between tool calls, so the mutation died with call 1; and the
hook is spawned by the Claude Code process rather than by the shell, so even a
persistent shell mutation would not have been in the hook's parent chain. Role
is fixed at terminal launch and is not writable by its occupant.

## The honest limit of this proof

This proves the mechanism **works**, not that it **cannot be defeated**. Anyone
who can launch the terminal chooses the role — the env var is set outside the
cage, by the owner's hand, which is the intended trust model and the same one
the manifest already relies on. What is now excluded is the accident and the
in-session shortcut: a session cannot silently widen itself mid-flight, and a
terminal launched without the var fails closed to the architect door (I2)
rather than minting an unbound builder.

## Disposition of the probe

The probe is temporary and is removed within this same mission. It is committed
in place first, so the evidence above and the code that produced it are
inspectable at one commit rather than reconstructed from a description.
