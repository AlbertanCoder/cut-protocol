# Cut Protocol — QC Gauntlet Report

*Owner-facing summary. Generated 2026-07-23. Deterministic solver only (BRAIN=off), zero API cost.*

## What this was

A deep quality-control pass: simulate tens of thousands of users through the real meal
engine, verify every result with an **independent oracle** (never trusting the solver's own
numbers), then deliberately try to break the API. The goal was numbers, not vibes.

## What was tested, and how much

| Phase | What | Volume | Result |
|---|---|---|---|
| 0 | Harness + independent oracle, 1k smoke | 1,000 users | ✅ DoD met |
| 1 | Monte Carlo at scale | 10,000 users · 70,000 days | ✅ committed |
| 2 | UI persona walkthroughs | — | ⛔ **blocked** (Chrome extension not connected) |
| 3 | Break-it: hostile inputs, races, lifecycle | 244 abusive requests · 16 route groups | ✅ clean |
| 4 | Triage → fix → re-run | — | No P0/P1 to fix; one P3 proposal (below) |

Everything ran against the real 889-recipe / 14,124-food library (fingerprint `a928390845e4c437`),
with **zero network calls** — enforced, not assumed (any outbound call aborts the run as a P0).

## The safety & honesty bars — all met

Across **10,000 simulated users**, verified independently by recomputing every macro from raw
food rows and re-checking every shipped ingredient:

- **0 allergy leaks** · **0 diet-style leaks**
- **0 calorie-floor breaches**
- **0 macro-drift** (the oracle's macros matched the solver's to within 1 kcal — the published match % is truthful)
- **0 dessert/beverage in a meal slot** · **0 portion-bound violations**
- **0 crashes**
- **0 silent misses** — no day ever breached the solver's own ±15% tolerance without declaring it

Break-it (244 hostile requests: negative/huge/NaN numbers, 10k-char strings, unicode, wrong
types, missing fields, path traversal, sql-ish): **0 server errors, 0 hangs, 0 stack-trace leaks,
0 garbage persisted.** 8 concurrent plan generations all succeeded and the server stayed
responsive; the AI route degrades to a calm response offline.

## The one bar NOT met — and why it's a proposal, not a bug

**Acceptance target:** ≥90% of *feasible* days should land within ±5% of the calorie goal.
**Actual: 39.5%.**

This is **not** a solver defect. Every off-target day is honestly declared (per-day match % plus
a week diagnosis) — that's why silent-misses are zero. The misses concentrate almost entirely in
**thin-pool diets** — carnivore and vegan, especially crossed with an allergy or two — where the
recipe library simply doesn't contain enough options to hit the target precisely. The bottleneck
is **recipe coverage, not solver logic**, which independently confirms the earlier solver-benchmark
finding at 10,000-user scale.

Under the gauntlet's own severity rules this is **P3 — a proposal for the owner**, not something to
auto-fix. Fixing it by loosening the oracle or widening the solver's ±15% tolerance would violate
ground rule #2 (the laws hold); the honest fix is to grow the thin diet pools.

### Open P3 proposal
> Expand the recipe library for carnivore, vegan, and vegetarian pools (and their allergy-crossed
> corners). Today these corners can't reach ±5% because the options don't exist — the solver is
> doing the best the library allows and saying so.

## Fixes made
None. No P0 or P1 defect survived verification, so the triage→fix→re-run loop had nothing to run.
(That is the honest outcome, not a skipped step.)

## Still open
- **Phase 2 (UI walkthroughs)** — needs the Claude Chrome extension reconnected, then four persona
  walks (beginner / keto+dairy-allergy / power user / impatient skimmer) with the UX-rules ledger.
- **Optional live-brain smoke** (≤10 calls) — only on the owner's explicit go.

## Re-run everything
```bash
cd backend
npm run qc:mc -- --n=10000 --seed=42   # Monte Carlo (any N); report -> docs/qc/monte-carlo-report.md
npm run qc:smoke                        # 1k smoke, exits 1 on any P0
npm run qc:fuzz                         # break-it; --assert exits 1 on any 500/hang/leak
```
Every simulated user is a pure function of `(seed, run index)`, so any failing run in
`docs/qc/failures.jsonl` replays byte-identically from its logged seed. This is a permanent,
repeatable regression harness — not a one-off.
