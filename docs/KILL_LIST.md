# Kill list — verdicts recorded; archiving happens with the surface work

Per CUT_PROTOCOL_DIRECTIVE.md §10 and standing order 6 (archive, never
delete) — reconciled with this repo's own rule 1 (deletions are candidates
in `MIGRATION/DELETE-CANDIDATES.md`, never `rm`) and BLOCKERS B10 (the full
app stays reachable as the power surface while the simple surface becomes
the five-surface product). So: every verdict below is RECORDED with its
evidence; the `/legacy` moves execute during the Phase 5/6 surface work,
owner-reviewable, one commit per move.

Judgement standard (§10): would a tired person at 9 pm, phone in one hand,
find dinner in under 15 seconds?

## FOLD — logic lives, its extra UI dies

| Feature | Evidence | Where the logic lives on |
|---|---|---|
| The "ten calculators" | Already ONE engine + one screen (AUDIT §2) | `bmrEngine.js` + Settings → "Recalculate targets" |
| Meal structure inputs on the Plan tab | A profile setting living on Plan (`PlanTab.jsx:1458-1478`) | Settings |
| Second "Food database" entry on Engine (`EngineTab.jsx:132`) | Duplicate of the Recipes entry | one entry, Settings-side |
| Two of the three grocery exporter triads | Grocery Copy/SMS/Email exists ×3 (Plan, Recipes cart, SimpleShopping) | ONE Groceries surface |

## ARCHIVE — move to /legacy behind a dead flag (burial notes ready)

| Feature | Burial note |
|---|---|
| `CompareDialog.jsx` + its sidebar button | 174 lines of competitor marketing inside a tool; its verified claims were harvested into docs/POSITIONING.md. |
| Training tab (+ TrendTab nudge) | Self-declared v1 scaffold, zero integration with the meal engine; not on the prescribe→cook→hit-numbers path. Flag already supports "hidden". |
| TodayTab "Micronutrients — MOVED" card (`TodayTab.jsx:1011-1024`) | A card whose only content is a forwarding address. |
| 4-week photo/tape reminder (`TodayTab.jsx:1077-1081`) | A nag with no feature behind it — no photo capture exists anywhere. |
| `?penny=1` dev checkout route (`App.jsx:118-128`) | QA-only; the Stage-6 self-test that needed it is scripted. |
| Barcode WEBCAM scan path (`BarcodeLookup.jsx:266-275`) | `BarcodeDetector` does not exist in Windows Chromium — dead on the target platform. Manual UPC entry stays. |
| 12 unimported shadcn primitives (`components/ui/{checkbox,dialog,label,progress,radio-group,select,separator,sheet,switch,table,textarea,tooltip}.jsx`) | Installed, never imported (verified zero references). → MIGRATION/DELETE-CANDIDATES.md. |
| `api.swapSlot` (`lib/api.js:387`) | Zero call sites; superseded by getSlotAlternates/applySlotAlternate. |

## FIX, not kill (broken but load-bearing)

| Feature | Defect |
|---|---|
| JSON/CSV export | `EngineTab.jsx:362-370` is a `<pre>`, not an export; CSV does not exist — violates "data is never trapped". Build `GET /api/export` + a real download. |
| FoodsTab "Log today" button | Permanently disabled with copy claiming the diary isn't built. The diary shipped. Wire it or remove it — pick one. |
| `searchDiaryFoods` fetch fork (`TodayTab.jsx:53-73`) | Bypasses the global 401 seam by its own admission. |
| `stripSourcePaths` band-aid (`PlanTab.jsx:79-83`) | Fix the backend leak it scrubs (`costCoverageNote` carrying a source path). |

## KEEP — everything else

The whole prescribe→cook→hit-numbers spine: onboarding wizard(s), Today,
Plan board + day options + swaps + locks, grocery generation + checkboxes,
recipe browse/import/AI drafts with the loud allergen override, Foods
browse + UPC lookup, Engine math walk, Profile with ack gates, Wellbeing
(safety-pinned: the entry is never hidden — DO-NOT-TOUCH law), trend charts,
bug report, the paywall plumbing.
