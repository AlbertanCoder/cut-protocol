# QC Gauntlet v2 — RUNLOG

Timestamped, append-only. Format: `[ISO8601] PHASE-N: action — result`.

```
[2026-07-23T02:05:00Z] PHASE-0: branch qc/overnight-2026-07-23 created from master (has the v1 qc harness).
[2026-07-23T02:05:00Z] PHASE-0: owner-decision preconditions VERIFIED against source (not trusted from prose):
    - mayContain / cross-contact field: ABSENT in schema.prisma  -> STOP-AND-SURFACE (P0 design gap).
    - step-cap on adaptiveTarget.changeKcal: NONE (delta reported, never clamped) -> STOP-AND-SURFACE (owner must define).
    - .env carries a live sk- ANTHROPIC key AND every script does dotenv/config -> file-level lockdown required.
    - phase3MigrateProfiles.mjs L30 writes floorKcal directly (bypasses effectiveFloor) -> ED-safety write-path target for Phase 3.
    - disk: 292 GB free on C: -> infra OK.
[2026-07-23T02:05:00Z] PHASE-0: cost lockdown — backend/.env.qc written (ANTHROPIC_API_KEY blank, ANTHROPIC_BASE_URL=http://127.0.0.1:1 unroutable); gitignored (carries other .env secrets).
[2026-07-23T02:05:00Z] PHASE-0: RUNLOG + FINAL REPORT skeleton created.
```

## STOP-AND-SURFACE queue (owner input needed; independent work continues around them)
1. **`mayContain` schema field absent** — cross-contact allergen sweeps are impossible without it. Add a nullable `mayContain Json?` to Food/Recipe, or accept that cross-contact is out of scope. (P0 design finding either way.)
2. **Step-cap undefined** — no cap exists on the week-over-week `changeKcal` in `adaptiveTarget.js`. The acceptance bar's "0 step-cap violations" tests nothing until you define the cap (e.g. max ±N kcal/week on the delta). Until then that bar is dropped, not passed.
3. **±7%-by-week-6 reachability** — pending the step-cap: if (cap × 6 weeks) < the 15% adaptive-thermogenesis bias, the ±7% target is mathematically impossible and the bar is wrong, not the code. Cannot precheck until (2) is decided.

## Known hard block (not owner-decidable)
- **Phase 2 (UI walkthroughs)** — the Claude Chrome extension is not connected in this environment. All six personas and the DOM-hook provenance checks are blocked until it is.
