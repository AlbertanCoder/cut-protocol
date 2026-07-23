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
[2026-07-23T03:20:00Z] PHASE-1D: allergen sweep built (scripts/qc/sweep14k.mjs) — app matcher vs independent oracle list across all 14,124 foods + recipe ingredients. First run: 31 leak candidates. Triage:
    - MY oracle over-claimed gluten via bare "bran"/"flour" (oat/rice/corn/sorghum bran are GF). Narrowed the oracle list -> 31->23. Verifier precision restored (0.5 gate still 10/10).
    - REACHABLE leak (1 recipe): "Braised stuffed cabbage" ships "Cooked Chestnut"; the nuts list missed chestnut/nutella/praline. FIX: added them + a per-word chestnut guard (water chestnut, an aquatic veg, is NOT swept up — same guard shape as milk/cream/butter). Regression tests added.
    - Non-reachable real gaps closed too: gelato->dairy, natto->soy, triticale/matzo/matzah/graham->gluten.
    - After fixes: sweep 23->11, ALL 11 remaining are 0-recipe USDA edge foods (infant formula, "X as ingredient in omelet" composites). Not solver-reachable; deferred with rationale.
    - False-exclusions (3): rice flour / corn tortilla excluded as gluten via "flour"/"tortilla"; over-exclusion in the SAFE direction — NOT narrowed (narrowing gluten matching would reduce allergen safety). Documented, not fixed.
[2026-07-23T03:25:00Z] PHASE-1D: PROOF — full suite 626 -> 628 green; 1k MC seed 42 P0 still 0; network 0.
[2026-07-23T03:45:00Z] PHASE-1C: invariants (tests/qc/invariants.test.js, 9 green). Floor dominance 0/2000; unit invariance; monotonic pool safety + no cross-talk; byte-identical determinism; scaling clamp; solver-path purity (no stray Math.random/Date.now). Suite 628->637.
[2026-07-23T03:55:00Z] PHASE-1D-integrity: nutrition + provenance sweep. First run 12 "corruption" = all alcohol/acetic-acid/carbonate physical exemptions (over-claim; my sweep has no alcohol column). Added the exemption class -> corruption 0, formula-edge 103 (expected), impossible-kcal/g 0. Provenance FULLY CLEAN: 0 no-source, 0 usda-missing-fdcId, 0 community/usda fdcId collisions (proves the fdcId UNIQUE holds).
[2026-07-23T04:10:00Z] PHASE-3(sec): IDOR/injection/ED-safety harness (2 accounts). FINDING P1 — POST /api/auth/login 500 on a non-string email (.trim before type-check; Prisma-operator object). NOT a bypass (0 P0). FIX: type-check strings up front. Re-run 0/0. Regression tests/qc/authInjection.test.js. Suite 637->639.
[2026-07-23T04:20:00Z] PHASE-3(sec): SSRF — importer validated protocol but not host; would fetch loopback/link-local/private. FIX: isBlockedHost() guard before fetch. Regression tests/qc/importerSsrf.test.js. Suite 639->641.
[2026-07-23T04:25:00Z] PHASE-1A: 10k re-run with the independent oracle + all allergen/injection/SSRF fixes IN PROGRESS (background).
```

## Findings ledger (v2 so far)
| # | sev | finding | status |
|---|---|---|---|
| 1 | P0 | `soy` allergen omitted TVP -> served to soy-allergic users | FIXED + regression + re-run proof |
| 2 | P0 | `nuts` omitted chestnut/nutella/praline -> "Cooked Chestnut" shipped in a recipe | FIXED + water-chestnut guard + regression |
| 3 | P1 | gelato/natto/triticale/matzo/graham allergen gaps (non-reachable) | FIXED |
| 4 | P1 | login 500 on non-string email (Prisma-operator object) | FIXED + regression |
| 5 | P2 | recipe importer SSRF to internal/private hosts | FIXED + regression |

Clean (verified, no finding): floor dominance (0/2000), plan determinism, monotonic pool safety, IDOR (B cannot touch A), ED-safety (no sub-floor via any write path), provenance (0 collisions), nutrition corruption (0).

## STOP-AND-SURFACE queue (owner input needed; independent work continues around them)
1. **`mayContain` schema field absent** — cross-contact allergen sweeps are impossible without it. Add a nullable `mayContain Json?` to Food/Recipe, or accept that cross-contact is out of scope. (P0 design finding either way.)
2. **Step-cap undefined** — no cap exists on the week-over-week `changeKcal` in `adaptiveTarget.js`. The acceptance bar's "0 step-cap violations" tests nothing until you define the cap (e.g. max ±N kcal/week on the delta). Until then that bar is dropped, not passed.
3. **±7%-by-week-6 reachability** — pending the step-cap: if (cap × 6 weeks) < the 15% adaptive-thermogenesis bias, the ±7% target is mathematically impossible and the bar is wrong, not the code. Cannot precheck until (2) is decided.

## Known hard block (not owner-decidable)
- **Phase 2 (UI walkthroughs)** — the Claude Chrome extension is not connected in this environment. All six personas and the DOM-hook provenance checks are blocked until it is.
