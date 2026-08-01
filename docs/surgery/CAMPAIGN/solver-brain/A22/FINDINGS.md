# A22 — replay / adversarial verification

**Lead result: two ledger numbers do not reproduce, two ledger rows are defective, and one of my own predecessor's failure calls was itself wrong and is retracted here.** Everything else in scope reproduced to two decimals.

## Reproduce / fail table

| ledger row | claim | my re-run | verdict |
|---|---|---|---|
| A19 oracle upper bound, satisfiable | 87.7 / 89.0 / 86.8 % | cited script prints **85.0 % (470/553)**; judged-consistent **86.9 % (466/536)** | **FAILED** |
| A19 oracle upper bound, all-judged | 79.1 % | **78.5 % (488/622)** | **FAILED** |
| A19 no-roll-ever-landed | 83/553 = 15.0 % | 553−470 = **83, 15.0 %** | REPRODUCED — *my own prior FAIL row retracted* |
| A20 KPI-1 sound-refusal | "+0.00 pts (77.00 % both)" | Δ +0.00 reproduces; level is **72.06 %** | **FAILED (transcription)** — A20's `FINDINGS.md:17,22` is right |
| A20 P7 confusion 16/0/0/0/90/405 | sums to 578 | sums to **511**; 67 UNKNOWN-accepted days omitted | **INCOMPLETE** |
| A13 wls2 +14.74 | 3 seeds | **+14.74, b=8 c=87, CI +11.40..+18.08, 77.1→91.8 %** — from *my own* arms | REPRODUCED |
| A13 best arm floor25+wls2 | +19.96, 97.0 % | **+19.96, b=1 c=108, 520/536** | REPRODUCED |
| A17 trimmer +14.93 | | **+14.93, b=4 c=84, 77.1→92.0 %**, and **instrument 1 disagree / 1 silent-miss vs 0/0** | REPRODUCED, incl. the honesty cost |
| A3 52 d / 91.0 % / 140/386 split | | **52 / 140 / 386, rates .000/.593/.834, 405/526 = 77.0 %** | REPRODUCED (see caveat) |
| A20 repaired 16 d / 97.2 % | | **16, 562/578 = 97.2 %**; P4 +4.94, P5 +5.72, P6 +27.94 | REPRODUCED |
| C20 dead term | 0 of 14 151 rows | **max 0; neither column exists; real max 0.2751 g/kcal** | REPRODUCED (own script, own DB) |
| A15 ruler ≤4.0 of 23.0 | | **V0 405/526 = 77.0 %; V6 fatE50 426/526 = 81.0 %, Δ+4.0, b=21 c=0**; 4.0/23.0 = 17.4 % | REPRODUCED |
| A16 conc-N8 / vegan-N40 / veg-N68 | +10.45 / +9.70 / +8.02 | **identical, b/c identical** | REPRODUCED |
| A1 baseline 413/536 = 77.1 % | | fresh run on my own DB copy, **b=0 c=0** vs A1 | REPRODUCED |
| A19 dayN / dayNstrict | +2.62 / +1.68 | **+2.62 (b=15 c=29) / +1.68 (b=0 c=9)** | REPRODUCED |
| A21 headline | *no `FINDINGS.md` on disk* | replayed its raw arms: **95.0 / 95.0 / 94.8 %**, Δ +17.91 / +17.16 / +16.79, instrument 0/0 | **NOT REACHED as prose; MEASURED from arms** |

## The A19 mechanism (MEASURED)

Numerator counted on **planned** days, denominator on **judged** days. 470/536 = 87.7 % and 492/622 = 79.1 % — 470 and 492 are any-roll counts over 553 and 639 *planned* days. 17 satisfiable days are unjudged; 4 are any-roll-in-band. Judged-consistent: **466/536 = 86.9 %** (headroom **+9.9**, not +10.6) and **488/622 = 78.5 %**. Join validated: 639/639 rows, 0 `dow` mismatches. A19's deltas are unaffected.

## Retraction of my own row

My predecessor's row *"A19 no-roll-ever-landed does not reproduce"* compared A19 against histogram bucket 0 (147) — which is over all 639 planned days. The correct comparand is 553−470 = **83**. A19 is right; the row is retracted in `CLAIMS.tsv`.

## Negative control (my own arm, MEASURED)

A re-portioning objective weighted on **kcal alone**, same rig/seed/hook: **+0.00 pts (413/536 both), b=5 c=5.** The +14.74 is not an artifact of touching the portioner.

## C19 independently confirmed, with an amendment (MEASURED)

By-name test of the C13 rows through `oracle.mjs`'s own `hitsAny`: **2 caught** (`Squirrel, ground, meat`; `Seal, bearded (Oogruk), meat` — both only via the token `meat`), **9 missed** (Groundhog, Armadillo, Wild pig, Owl horned flesh, **Sea cucumber, yane**, Ceviche, Hog maws, Dove cooked, `Nutritional powder mix (Isopure)`). C19 says 1 of 13; it is 2. Conclusion unchanged. The Isopure row is missed because its stored name carries no dairy token, though `whey` is in the list.

## Caveats for A25

- **A3's split is definition-sensitive.** `A3-final-split.mjs:24` (`afterStack < distinctNeeded`) gives pool-limited 140; `A3-classify-all.mjs:90` (hardcoded `POOL_LIMIT = 60`) gives 62. Its own sensitivity table spans 25→145 days. Only 140 is in the ledger; the quantity is not stable.
- **A21's stack instrument is clean (0 disagree / 0 silent-miss) where A17's trimmer alone was 1/1.** From `A21-overlap-s424242.json`: net gains alone 79 + 56 + 80 = 215 days; the stack nets **96**. Summing parts overstates by **2.24×**.
- I never ran `checkdb.mjs`; all arms carry `dbHash e55f52e53658a086`, `foodFingerprint 423e7279ed6af641`.
- 25 rows appended to `CLAIMS.tsv` by `>>`.

CONFIRMED
