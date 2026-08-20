# Resume here — product-rebuild branch

State as of 2026-08-19: repo working, tested, committed (8 local commits,
`51b65cf` → `4bb076e`, nothing pushed — pushing needs the owner's word).
Suite: 155 files · 1,852 tests · 0 failures.

## Read first, in order

1. `CUT_PROTOCOL_DIRECTIVE.md` — the mission.
2. `docs/BUILD_LOG.md` — what each phase did and measured.
3. `docs/BLOCKERS.md` — 12 decisions with chosen defaults; B11/B12 are
   owner-gated work that is READY.
4. `docs/FINAL_REPORT.md` — what works, what is fragile (the fragile list
   is the honest one).

## Rebuild the working state (the only setup step)

The isolated QA database is gitignored and must exist for the persona gates
and the report scripts (they skip loudly without it):

```
cd backend
DATABASE_URL=file:./rebuild-qa.db npx prisma migrate deploy
DATABASE_URL=file:./rebuild-qa.db node scripts/seedUser.js
DATABASE_URL=file:./rebuild-qa.db node scripts/seedRecipes.js
DATABASE_URL=file:./rebuild-qa.db node scripts/seedRecipesFromRecomp.mjs
DATABASE_URL=file:./rebuild-qa.db node scripts/seedRebuildCandidates.mjs --write
```

Then `npm test` (backend) should say 155/1,852/0, and
`node scripts/personaReport.mjs` should say 208–210/210 ok, 0 hits.

## Hard rules that bind every session here

- NEVER open/copy/hash `backend/prisma/dev.db` (both .env files point
  DATABASE_URL at it — always override with the QA DB).
- Never push (pre-push token is the owner's; a stale
  `docs/surgery/CURRENT/PUSH_APPROVED` exists — ignore it).
- Locked calcs stay locked (CLAUDE.md rule 2; goldens); new numbers are new
  files (the whole `backend/src/lib/prescription/` pattern).
- `dietaryFilter.js` has NUL bytes — `rg --text`, never trust bare grep.

## Next work, in order (from FINAL_REPORT)

1. **Owner cook-test** of `docs/P0_FOURTEEN_DAYS.md` — nothing else ranks
   above palatability evidence.
2. ~~First visual walk~~ DONE 2026-08-20 (see BUILD_LOG): Preview and the
   check-in panel verified in the browser. Walk recipe for repeats: backend
   `DATABASE_URL=file:./rebuild-qa.db PORT=3100 HOST=:: SUPABASE_URL= node
   server.js`, vite with `VITE_SUPABASE_URL=` override (frontend/.env
   carries live Supabase vars), proxy targets 3100.
3. Prescription persistence design (multi-dish slots don't fit PlanSlot's
   one-recipeId shape — schema decision, owner-gated like all schema).
4. Pool depth: vegan+GF / keto / snacks, via
   `backend/data/rebuildCandidates.mjs` + the seeder's dry-run gate.
5. Pescatarian dietary style in the lattice (P5 currently expressed as meat
   exclusions — fixtures.js documents it).
6. Owner-gated: B11 medication-gate migration · B12 training-aware floor ·
   consent screen/dashboards (docs/DEPLOY.md) · TheMealDB licence ·
   kill-list ARCHIVE moves.

## Landmines already paid for (do not rediscover)

- Bare "noodles"/"toast(s)" in recipe STEP text is gluten evidence; "No-Soy"
  in a TITLE trips the soy wall (regulated `soy-free` form only).
- Under a CEILING, less is never a miss — keto netCarb bands take lo: 0.
- The keto 10% carb-energy share makes lean low-cal snacks un-keto-able;
  don't tag them keto, don't fight the gate.
- Rows with NO gram field are the exclusion gate's fail-closed territory,
  not the sanity fence's; partial sums never judge the kcal floor.
- The §8.3 trigger must be once-per-kind-per-WINDOW (counters-since-mark
  nag-loops — measured 60 check-ins in 120 refusals before the fix).
- `runTests.mjs` points `CUT_SAFETY_EVENTS_PATH` at a temp file — keep it
  that way or route tests write into the owner's real ledger.
