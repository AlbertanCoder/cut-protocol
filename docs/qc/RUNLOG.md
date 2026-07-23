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
[2026-07-23T02:40:00Z] PHASE-0: oracle.mjs REBUILT for independence — zero src/lib engine imports; allergen check now runs against a self-authored curated derived-term list (whey<-milk, semolina/seitan<-wheat, lecithin/tvp<-soy, surimi<-fish, ...), not the app's matcher. Policy constants inlined + drift-guarded.
[2026-07-23T02:45:00Z] PHASE-0.5: self-validation gate written (tests/qc/oracle-selfcheck.test.js) — drift guard + allergen positives/false-exclusion negatives + verdict reproduction incl. an anchovy buried at ingredient 10/11. Result: 10/10 PASS -> gate cleared, Phase 1 may proceed.
[2026-07-23T02:50:00Z] PHASE-1(re-verify): 1k MC with the INDEPENDENT oracle found P0=339 where v1 (app-matcher oracle) found 0. Triage: 329 = one food (TVP -> soy), 8 + 2 = peanut-butter false positives in the oracle.
[2026-07-23T02:55:00Z] PHASE-4: **P0 CONFIRMED REAL** — matchesExclusionTerm("Textured vegetable protein, dry","soy")=false. The "soy" allergen list omitted TVP (defatted soy flour ~50% soy protein); a soy-allergic user was served TVP. v1's oracle could not catch it (asked the same broken matcher).
[2026-07-23T02:56:00Z] PHASE-4: FIX — added tvp/textured vegetable protein/soy protein forms to dietaryFilter soy list (oil deliberately still permitted). Regression test tests/qc/soyTvpLeak.test.js. Oracle false positives fixed via category-scoped plant-dairy stripping (peanut butter still flags peanuts, not dairy).
[2026-07-23T02:58:00Z] PHASE-4: RE-RUN PROOF — 1k MC seed 42: P0 339 -> 0. Full suite 626 -> all green (13 new qc tests). Network calls 0.
```

## STOP-AND-SURFACE queue (owner input needed; independent work continues around them)
1. **`mayContain` schema field absent** — cross-contact allergen sweeps are impossible without it. Add a nullable `mayContain Json?` to Food/Recipe, or accept that cross-contact is out of scope. (P0 design finding either way.)
2. **Step-cap undefined** — no cap exists on the week-over-week `changeKcal` in `adaptiveTarget.js`. The acceptance bar's "0 step-cap violations" tests nothing until you define the cap (e.g. max ±N kcal/week on the delta). Until then that bar is dropped, not passed.
3. **±7%-by-week-6 reachability** — pending the step-cap: if (cap × 6 weeks) < the 15% adaptive-thermogenesis bias, the ±7% target is mathematically impossible and the bar is wrong, not the code. Cannot precheck until (2) is decided.

## Known hard block (not owner-decidable)
- **Phase 2 (UI walkthroughs)** — the Claude Chrome extension is not connected in this environment. All six personas and the DOM-hook provenance checks are blocked until it is.
