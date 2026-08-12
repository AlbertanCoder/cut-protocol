# CI seed fix — how to apply

`ci-seed-fix.patch` adds one line to `.github/workflows/ci.yml`'s Seed step —
`npm run seed:recipes:recomp` — so CI seeds the real 626-recipe library instead
of the 24 curated recipes, which is what `horizonGeneration.test.js:73`
(`RAW.length >= 100`) requires. `.github/` is sealed to agent sessions, so this
ships as a patch for the owner's hand: from the repo root, on a checkout whose
`ci.yml` still lacks the line (e.g. `master` — pre-image blob `374bd58`
verified), run `git apply docs/deploy/ci-seed-fix.patch`, then commit. Note the
`recipe-brain` branch **already carries this exact change** (owner commit
`4297210`, 2026-08-11), so applying it there fails loudly with "patch does not
apply" — that failure means it is already in place, confirmable with
`git apply --reverse --check docs/deploy/ci-seed-fix.patch` succeeding. The
line alone does NOT green CI: it only works together with the two fixes landed
alongside this file — the fdcId-collision and duplicate-ingredient-line fixes
in `backend/scripts/seedRecipesFromRecomp.mjs`, and the DB path-resolution fix
in `backend/tests/allergenMetadataCoverage.test.js` (see
`docs/qc/session-findings-2026-08-10.md`, the CORRECTED block above Defect 1).
