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
