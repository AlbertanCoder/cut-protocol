# DELETE CANDIDATES

Nothing is deleted before Phase 10, and Phase 10 may only delete what is listed
here. Constraint 1 of `MIGRATION/CONTRACT.md`: if something looks obsolete,
append its path and one line of reasoning **here** and move on.

Format: `- path/to/file — one line of reasoning — noticed in Phase N`

## Candidates

*(none yet — Phase 0 is recon and deleted nothing)*

## Noticed in Phase 0 but deliberately NOT listed

These look like deletion candidates and are not. Recording them so a later
session does not "discover" them and add them without the context.

- **`frontend/src/lib/theme.js`** — reads as a legacy mirror of `index.css`, but
  it is load-bearing: Recharts and inline-style call sites need literal values,
  not `var()` refs, and it is named in `DO-NOT-TOUCH.md` as protected. It is also
  deliberately theme-INVARIANT (snapshot once at boot, never re-read on a theme
  flip) — see `index.css:169-175`. Removing it silently breaks every chart colour.
- **`frontend/src/lib/math.js`** — one line long, which looks like a stub. Not
  read in full during Phase 0; do not touch it under constraint 2 until it has
  been.
- **`EngineTab.jsx:362-370`** — the raw-JSON `<details>` block is explicitly
  marked "do NOT delete this block" in its own comment, because the constitution
  says data is never trapped and this is currently the only export path.
- **`frontend/src/components/ui/Parts.jsx`** — the legacy `Card` / `Btn` /
  `PageHead` / `Stat` vocabulary. Still consumed by Engine, Profile, Plan,
  Recipes, Foods, Training, Wellbeing and Barcode. It becomes a real candidate
  only after Phase 8 has rehoused every one of those, and not before.
- **`frontend/src/components/charts/*.jsx`** — thin Recharts wrappers, still the
  only chart renderers (`TodayTab.jsx:1032`, `TrendTab.jsx:457`).
- **The `.dark` block in `frontend/src/index.css:105-143`** — will look redundant
  the moment the app is light-first. It is not: the theme toggle (F-023) is a
  shipped capability and dark must keep working. Removing it deletes a feature.
