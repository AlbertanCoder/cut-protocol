# Prescription persistence — a schema decision, prepared for the owner

2026-08-20. The prescription solver is live behind `/api/prescription/preview`
(read-only, nothing saved). Making days SAVABLE — swap/pin/repeat, the
grocery path, "cook this week" — hits one structural fact:

**`PlanSlot` holds exactly one `recipeId` per slot; a prescription slot holds
DISHES** (an OMAD day is one slot with up to four dishes — directive §3.1's
unit note, enforced and tested). Something has to give, and it's persisted
schema, which is deliberately owner-gated in this repo. Three options, one
recommendation.

## Option A — abuse `slotIndex`: one PlanSlot row per DISH

No migration. An OMAD day writes 3 rows `(meal, 0..2)`.

- ✗ Breaks the meal-structure contract everywhere that counts slots: the
  Today/Plan UIs, `zeroSlotConfig`'s 1..8 door, mealsPerDay reconciliation —
  slot count would no longer equal meal count.
- ✗ `Plan.verdictSlotSig` (contractually mirrored in the schema comment and
  in PlanTab's `planSlotSig`) treats each row as a meal; staleness detection
  silently degrades.
- ✗ Every existing consumer of PlanSlot has to learn the new meaning anyway
  — all of the migration's cost, none of its honesty.

**Rejected.**

## Option B — additive `dishIndex` on PlanSlot

`dishIndex Int @default(0)` + widen the unique to
`[planId, dayOfWeek, slotType, slotIndex, dishIndex]`.

- ✓ One table keeps serving both solvers.
- ✗ Changing a UNIQUE constraint under SQLite is a table-rebuild migration —
  exactly the `PRAGMA defer_foreign_keys` shape that already complicates the
  Postgres story (CLAUDE.md's migration-history caveat), on the most
  load-bearing table in the app.
- ✗ Existing solver code and the golden-locked engine baseline read PlanSlot
  today; even a "transparent" default forces re-verification of every
  consumer against the widened key.
- Risk concentrated where the blast radius is largest.

## Option C — new tables, prescription-owned (RECOMMENDED)

```prisma
model PrescriptionDay {
  id        String   @id @default(cuid())
  userId    String
  date      String              // ISO day; one committed day per user-day
  seed      Int
  targets   Json                // the ruler targets the day was solved under
  verdict   Json                // ruler verdict incl. read + bands
  scanLine  String              // §3.3.4 machine-written allergen line
  createdAt DateTime @default(now())
  dishes    PrescriptionDish[]
  @@unique([userId, date])
}

model PrescriptionDish {
  id          String  @id @default(cuid())
  dayId       String
  day         PrescriptionDay @relation(fields: [dayId], references: [id], onDelete: Cascade)
  slotType    String           // "meal" | "snack"
  slotIndex   Int
  dishIndex   Int
  recipeId    String?          // provenance tag, no FK (recipe may be edited/deleted)
  recipeName  String
  scales      Json
  ingredients Json             // [{foodId, name, grams, role}] — ground truth, frozen
  kcal        Float
  protein     Float
  fat         Float
  carb        Float
  fiber       Float            // net carbs derive; fiber persists (the main
                               // schema has no fiber on slots — this one does)
  @@unique([dayId, slotType, slotIndex, dishIndex])
}
```

- ✓ Purely additive: zero touch to Plan/PlanSlot, the shipped solver, the
  goldens, or any existing route. The exact pattern this whole build has
  used (new numbers are new files; here, new rows are new tables).
- ✓ Frozen `ingredients` JSON per dish is the same ground-truth discipline
  PlanSlot already follows; fiber finally persists.
- ✓ Verdict + scan line stored per day — the §3.3.4 contract travels with
  the food it certifies.
- ✗ Two plan concepts exist until the surfaces consolidate. That is
  honest: they ARE two instruments (±10% ruler vs ±50 kcal ruler), and the
  KILL_LIST consolidation decides which one survives — later, with usage
  evidence.

### The routes that follow (all additive)

- `POST /api/prescription/commit` — body: the preview payload's day (or
  `{days: N}` to solve-and-commit); upserts `[userId, date]`.
- `GET /api/prescription/current` — today + forward days.
- `POST /api/prescription/swap` — re-solve ONE dish against the day residual
  (the solver already exposes everything needed), re-verify, re-store.
- Grocery: consolidate over committed days' `ingredients` and hand the
  result to the EXISTING `groceryList.js` shapes — same section/unit/cost
  honesty, no new grocery code.

### Retention / privacy

Same posture as everything else: rows live in the user's own DB, cascade on
day delete, JSON+CSV export must include them (the export rebuild is already
on the KILL_LIST fix list).

## What this waits on

One word from the owner on Option C, then: one additive migration (the
settings deny-list on `schema.prisma`/`migrations/` is his gate, correctly),
the three routes, and the Preview room grows "Save this day". Estimated at
one focused session, tests included, with the persona harness extended to
commit-and-reload round-trips.
