# Agent 01 — Wave 1: Safety Nets That Actually Fire

Branch `qc/overnight-2026-07-23`. Findings **tests-quality-1** and **tests-quality-3**.

## Files changed (all inside agent 01's ownership list)

| File | Change |
|---|---|
| `backend/scripts/runTests.mjs` | floors raised 62→63 files / 650→659 tests; last-match summary parsing; `--list` mode; scoped-run mode; `process.exitCode` instead of `process.exit()` in the close handler |
| `backend/package.json` | `qc:all` no longer shell-globs (`tests/qc/*.test.js` → `scripts/runTests.mjs tests/qc`) |
| `backend/tests/golden/goldenBaseline.test.js` | section list is now DERIVED from the golden file's own keys + a both-ways key-set assertion (this is what closes tests-quality-3's root cause) |
| `backend/tests/golden/goldenBmr.test.js` | **new** — 9 tests, the actual BMR lock |
| `.github/workflows/ci.yml` | new `Test entrypoint guard` step in the `backend` job |
| `docs/qc/handoff/agent01.md` | this file |

**Not touched:** `backend/src/lib/bmrEngine.js` (another agent's), `backend/tests/golden/fixtures.js`,
`backend/tests/bmrEngine.test.js`, and the committed `engine-baseline.golden.json` values —
the golden was *verified* against the live engine, never regenerated.

## For the orchestrator

1. **`MIN_TESTS = 659` / `MIN_TEST_FILES = 63` are set against a measurement taken while nine
   other agents were mid-edit.** Measured run: **63 files, 676 tests, 0 failures, exit 0**
   (2026-07-23, `DATABASE_URL` pointed at a scratchpad copy of `dev.db`, not the shared one).
   The floors sit ~2.5% under that. If other agents net-added test files the floors stay valid
   (they are minimums). If an agent *deletes* a test file, the file floor may trip — that is the
   tripwire working; re-measure with `npm test`, confirm the drop is intentional, and lower it
   deliberately. Do not lower a floor to make CI green.

2. **Re-run `npm test` once after the last agent lands** and reconcile the two floors against the
   final number. That is the only number that should be committed.

3. **No request for out-of-ownership edits.** Everything needed was inside the list. One thing was
   *considered and rejected*: a root-level `scripts/checkTestEntrypoint.mjs` for the CI guard. It
   is not in agent 01's ownership, so the guard was inlined into `ci.yml` instead. If you would
   rather have it as a script file later, the body is in the `Test entrypoint guard` step verbatim.

## Notes / judgement calls made autonomously

- **The CI guard is deliberately inline and deliberately outside `npm test`.** A guard that runs
  *via* the entrypoint cannot catch the entrypoint being bypassed. For the same reason it could
  not be a test file under `backend/tests/` — a top-level test file is exactly what the original
  `**` glob bug skipped.

- **Scoped runs (`runTests.mjs tests/qc`) disable the floors** and say so loudly on stdout. The
  floors are whole-suite floors; applying them to a 12-file lane would be meaningless. CI always
  invokes `npm test` with no arguments, so the enforced path is unaffected.

- **The BMR lock is exact, not tolerant.** Every locked field is an integer from pure arithmetic on
  fixed inputs — no RNG, no DB, no clock. A tolerance would only create room for a real regression
  to hide.

- **`goldenBmr.test.js` carries two tests that are about the *test*, not the engine**
  (`the lock is armed…` and `the locked values are structurally sane…`). The first proves the
  comparison still fires; it uses a synthetic clone rather than live engine output so that
  "the lock was disarmed" and "the engine drifted" stay independent signals. The second bounds what
  a careless `regenerate-until-green` can lock in.

## Still open elsewhere (NOT agent 01's files — flagging only, no action taken)

- CI triggers are `push`/`pull_request` on `master` only, so nothing in this workflow runs on the
  `qc/overnight-2026-07-23` branch until a PR is opened against `master`. That is normal, but it
  means **none of tonight's safety nets have executed on GitHub yet** — they have only been proven
  locally. Left alone deliberately: changing trigger policy mid-fleet would surprise other agents.
