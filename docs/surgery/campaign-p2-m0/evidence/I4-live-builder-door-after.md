# Live builder-door probe, AFTER the role gate landed

The order asks for one live probe: a real Edit tool call to a manifest-allowed
path, showing the builder door passes in practice and not only inside the
selftest harness. This file is that probe, run against the role-gated code
rather than against the pre-change code.

- **Path:** `docs/surgery/campaign-p2-m0/evidence/I4-live-builder-door-after.md`
  — on the live allow list via the `docs/surgery/campaign-p2-m0/` entry.
- **Guard in force:** `guard-edit.js` at commit `efae135`, i.e. with `roleGate`
  wired into the surgeon path.
- **Terminal role:** `CP_ROLE=builder`.

**STATE: EDITED by a real Edit tool call, accepted.** Both a real `Write` and a
real `Edit` to a manifest-allowed path passed the role-gated `guard-edit` from
a `CP_ROLE=builder` terminal. OBSERVED — the writes are on disk and in the
commit that carries this file.

## Why a second probe, when I1 already had one

The I1 probe ran against the guards as they were *before* the role gate
existed. It proved the hook fires and can read the role; it could not prove the
builder door still opens once a role gate is standing in it. Re-running the
probe after the change is the difference between "this worked" and "this still
works" — and the second is the one that matters, because I4's whole claim is
that builder behaviour did not change.

Every tool call in this mission from commit `efae135` onward is itself an
unforged instance of the same proof: the writes kept landing, so the gate
kept passing a real builder.
