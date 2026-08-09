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

---

## 2026-08-08 — 37 database backups, QUARANTINED not deleted

`backend/prisma/` held 487 MB, of which 448 MB was historical copies of the
database. Moved out of the repo working tree to
`Desktop\Backups\prisma-pruned-2026-08-08\`, per the never-delete rule — they
are off the tree but nothing has been destroyed, and the move is reversible with
a single `mv` back.

**Deliberately KEPT in `backend/prisma/`, do not sweep these:**

- `dev.db` — the live database.
- `dev.db.template`, `dev.db.template-shm`, `dev.db.template-wal` — the
  depersonalised seed DB. `package.json` `build.extraResources` ships
  `dev.db.template` into every installer. Deleting it breaks packaging.

**Quarantined (37 files):** every `dev.db.backup-*`, the
`dev.db.pre-verdict-migration-backup` trio, `dev.db.template.backup-prefix1-*`,
and `dev.db.snapshot-agentcontam-20260721-212858`.

**Checked before moving, not after:**

- Only `dev.db.template` is referenced by packaging config.
- `scripts/surgery/witness.js:90` writes `dev.db.backup-witness-<stamp>` at
  runtime — it generates that name, it does not read existing ones.
- `backend/tests/distSafety.test.js:226` names the agentcontam snapshot, but
  guards with `fs.existsSync` and its own comment says "if they have since been
  deleted there is nothing to prove and nothing to leak". Re-ran after the move:
  **9/9 pass.**
- Live `dev.db` sha256 identical before and after the move.

**Note on the agentcontam snapshot.** `CLAUDE.md`'s packaging section names it as
the 3.2 MB real-user database that slipped past the old `!`-pattern denylist.
Moving it out of the tree removes that hazard from the working directory. The
lesson it documents stands on its own in `CLAUDE.md`; the file was only ever
evidence.

To make this permanent once satisfied nothing is missing:
`rm -rf "C:\Users\SHADHUNTER\Desktop\Backups\prisma-pruned-2026-08-08"`
