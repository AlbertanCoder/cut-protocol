> # ⚠ VERDICT VOID — 2026-07-24
> **This report's headline "corruption: 0 — clean" is wrong. The real figure is
> 470 corrupt rows.** The number is void; the method below is kept because it is
> worth keeping and because the failure is instructive.
>
> **Why it is void — the test cannot detect this bug class, by construction.**
> The sweep defines corruption as *"a manual row with bad macros that is not
> documented and not physically exempt."* Every one of the 470 corrupt rows
> fails all three of those escape hatches in the direction that clears it:
>
> 1. **The macros are not "bad."** Each corrupt row holds a real, internally
>    consistent USDA tuple — it just belongs to a *different food*. Pepper
>    carries some other item's numbers verbatim. Fibre-adjusted Atwater passes
>    perfectly, because 4P + 4C + 9F is arithmetic about a tuple, not a claim
>    that the tuple describes the food on the label.
> 2. **They are documented.** Each carries an `exception:` string in
>    `dataQuality` — literally `exception:provenance-cleared — …these are NOT
>    this food's numbers`. The sweep counts a documented row as *honestly
>    labelled* and clears it. So the rows that announce their own breakage are
>    the ones the test exempts.
> 3. The 206 rows counted as "already-flagged (dataQuality exception/warn) —
>    honestly labelled on import" are therefore not a clean class. That bucket
>    is where the damage is filed.
>
> The sweep asserts clean on precisely the rows that are broken. A pass here
> means "no row failed arithmetic," never "no row is wrong." **Atwater
> consistency is not a correctness warrant** — do not cite this report, or the
> `"{n} foods · validated against kcal ≈ 4P + 4C + 9F"` line in `FoodsTab.jsx`,
> as evidence that a food's numbers describe that food.
>
> **What is actually needed:** a provenance check that asks whether a row's
> `fdcId`/source record matches the row's *name*, plus quarantining the 470.
> Tracked in `BATTLE-PLAN.md` (Phase 1). Re-run and replace this verdict only
> once the test can fail on a name↔record mismatch.
>
> The corpus counts, provenance table and method below are unaffected and
> still usable.

# Cut Protocol — nutrition integrity + provenance sweep (Phase 1D)

- Corpus: 14124 foods. Quarantine is REPORT-ONLY (no writes).
- Provenance mix: manual 605, usda-verified 13516, manual-placeholder 3

## Nutrition integrity (fiber-adjusted Atwater; alcohol term N/A — no column)
| class | count | note |
|---|--:|---|
| **corruption** (manual row, bad macros, not documented, not physical-exempt) | 0 | clean |
| physical-exemption (alcohol/acetic-acid/carbonate — legitimately fails Atwater) | 127 | expected, no alcohol column to model |
| formula-edge (usda-verified misses general band — food-specific factors) | 103 | expected class, not corruption |
| already-flagged (dataQuality exception/warn) | 206 | honestly labeled on import |
| kcal/g physically impossible (>9.3, no alcohol col) | 0 | clean |

## Provenance
| check | count | bar |
|---|--:|---|
| rows with no source | 0 | 0 |
| usda-verified rows missing fdcId | 0 | 0 |
| fdcId shared by community + usda rows | 0 | 0 |

_Generated 2026-07-23T02:26:51.126Z. corruption+kcal/g impossible are the only bars that gate --assert; formula-edge is an expected class._
