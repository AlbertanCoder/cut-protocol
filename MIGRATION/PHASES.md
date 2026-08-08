# PHASES

Every F-ID in `MIGRATION/INVENTORY.md` is assigned to exactly one phase. The
assignment is also carried in the inventory's own `Phase` column and mirrored
into `MIGRATION/PROGRESS.md`; `scripts/parity-check.js` keeps the three in step.

| Phase | Name | F-IDs | Count |
|---|---|---|---|
| 1 | Golden fixtures | *(none — test-only, no UI capability)* | 0 |
| 2 | Token layer | *(none — no screen imports it yet)* | 0 |
| 3 | Convert screens to tokens | *(none — zero visual change by definition)* | 0 |
| 4 | Flip to light + primitives | F-023 | 1 |
| 5 | Onboarding wizard | F-034 … F-048, F-103 … F-106 | 19 |
| 6 | Swipe deck and photos | *(none — new capability, nothing to preserve)* | 0 |
| 7 | Profile mapping | F-007 | 1 |
| 8 | New home shell | F-008, F-011, F-013 … F-022, F-049 … F-102, F-107 … F-155, F-157 … F-158, F-159 … F-282 | 254 |
| 9 | Routing | F-001 … F-006, F-009, F-010, F-012, F-024 … F-033, F-052, F-156, F-283 … F-287 | 12 |
| 10 | Delete legacy | *(none — deletion only, governed by DELETE-CANDIDATES.md)* | 0 |

**287 total.** Phases 2, 3, 6 and 10 legitimately carry zero F-IDs: two of them
are defined as producing no visual change, one is entirely new capability, and
one only removes code. That is not a gap in the inventory — a phase that adds no
user-reachable capability has no capability to account for.

## Why the weight sits in Phase 8

254 of 287 rows are Phase 8 because this app's whole surface is the seven tabs
plus their dialogs, and the new home shell is where those get rebuilt. **This is
the phase where features silently die.** The runbook's own instruction applies
with force here: before Phase 8 is declared done, `MIGRATION/INVENTORY.md` must
be re-read end to end and every Phase-8 ID accounted for **out loud** — name the
ID, say where it now lives.

254 IDs is too many to account for in one sitting. Phase 8 should be split by
screen, one session each, in this order (least to most entangled):

1. Wellbeing + self-check — F-248 … F-263 (16)
2. Training — F-239 … F-247 (9)
3. Trend — F-223 … F-238 (16)
4. Engine — F-107 … F-121 (15)
5. Foods + barcode — F-195 … F-222 (28)
6. Today — F-049 … F-074 (26)
7. Profile + body-fat picker — F-075 … F-102 (28)
8. Recipes — F-159 … F-194 (36)
9. Plan — F-122 … F-155, F-157, F-158 (36)
10. Shell, sidebar, header, global dialogs — F-008, F-011, F-013 … F-022,
    F-264 … F-282 (32)

## Phase-by-phase allowed files

Written here so a future session cannot widen its own scope by claiming the
boundary was never stated.

| Phase | Allowed files |
|---|---|
| 1 | test directories only — `backend/tests/**`, `MIGRATION/golden/**`. No source changes at all. |
| 2 | a new `frontend/src/theme/` directory only |
| 3 | one screen file + its own components, named explicitly in the session prompt |
| 4 | `frontend/src/index.css` (the `:root` light block), `frontend/src/App.jsx` (the ThemeProvider default), `frontend/index.html` (the boot class + `theme-color`) — **adapted, see below** |
| 5 | a new `frontend/src/onboarding/` directory and a new onboarding store file |
| 6 | a new `frontend/src/swipe/` directory, `frontend/public/assets/food/`, `scripts/photo-pipeline/` |
| 7 | one new adapter file, plus the existing profile store **only** to add new optional fields |
| 8 | a new `frontend/src/home/` directory only; every existing screen stays read-only |
| 9 | `frontend/src/App.jsx` (the tab state machine) and `frontend/src/components/Sidebar.jsx` (the `NAV` array) |
| 10 | only files listed in `MIGRATION/DELETE-CANDIDATES.md`, one screen per commit |

## Phase 4 is adapted, and here is exactly how

The runbook's Phase 4 says: build a new `theme` directory, then build eight
primitives (`Screen`, `Card`, `Button`, `Input`, `OptionRow`, `Chip`, `Slider`,
`StatTile`). Neither applies here, and doing them anyway would break constraint 6.

**No new `theme` directory.** The token layer already exists and every screen
already consumes it — `frontend/src/index.css` carries `:root` (light) and `.dark`
(dark) with the full shadcn semantic role set, and `no-hardcoded-colours.js` comes
back clean across all 79 source files. Creating a second token home would leave two
live systems, which is the exact condition that produces drift.

**No new primitives directory.** `frontend/src/components/ui/` already holds
`button.jsx`, `card.jsx`, `input.jsx`, `badge.jsx`, `select.jsx`, `slider`-adjacent
controls and the rest, all built against those tokens. Building a parallel set
would duplicate working components — constraint 1 forbids removing the originals,
so the app would carry both.

**So Phase 4 here is the part that actually remains:** swap the `:root` light values
to the chosen palette, flip the shipped default from dark to light, and walk every
screen looking for what a light ground exposes. The runbook is right that light
backgrounds surface spacing and hairline bugs dark was hiding — that part transfers
intact.

**Dark is not deleted.** The `.dark` block stays and the Light/Dark/System toggle
(F-023) keeps working. It is a shipped capability; removing it would be a
constraint-1 deletion, not a migration.

## Phase 9 is not "the router"

There is no router library in this app (see `MIGRATION/CONTRACT.md` → Stack).
Routing *is* `App.jsx:43`'s `tab` state and `Sidebar.jsx:10-25`'s `NAV` array.
The runbook's Phase-9 rules translate as:

- **Gate declaratively** — conditionally include the entry in `NAV` / the tab
  switch, exactly as `TRAINING` and `WELLBEING` already do (`Sidebar.jsx:17,23`).
  Never call a setter imperatively to shove someone into onboarding.
- **Hold the first paint until the flag resolves** — App already has the right
  shape (`authStatus === "checking"` renders a skeleton, `App.jsx:311`). The
  onboarding flag must resolve inside that same gate, or an existing subscriber
  gets a flash of the wizard on every cold launch.
- **Resolve each feature flag exactly once**, at `lib/flags.js` or the tab
  registry — never inside a component. `lib/flags.js` is already this shape;
  keep it.
- Deep links here are the `?upgraded=1` and `?penny=1` query params
  (`App.jsx:65-70,108-114`). Both must keep working unchanged.

## Prerequisite that is NOT yet met

Phases 3 and 8 are checked against `MIGRATION/baseline/` screenshots, and Phase 7
needs an archived pre-migration build to install over. **Neither exists.** Both
are owner tasks from the runbook's Step 0 and are still outstanding as of
2026-08-07. Phase 1 and 2 can proceed without them; Phase 3 cannot be verified
without them.
