# W4-2 — WORKING-TREE INTEGRITY

**Question asked:** `fleet/PROMPT.md:9` says product source (`backend/src/**`, `frontend/src/**`) stays **byte-identical** and `git status` shows only `fleet/` plus sanctioned instrumentation. It does not. Was the rule suspended **by decision** or **by drift**?

**Verdict: BY DRIFT.** The rule was never amended, `fleet/DECISIONS.md` — the file this run itself designates for exactly this kind of call — records nothing about product edits and has not been written to since it was created, and the only authorizing sentence lives in a file that did not exist until the first product fix created it. The *work* is largely disciplined (10 of 11 product commits ship a test and cite a measured number). The *process record* is not, and four concrete hazards follow from that. This is a process-integrity finding, not a quality indictment.

**HEAD `748c524` at start and at end** — unchanged throughout. `git status` gained two untracked dirs mid-sweep (`fleet/out/W4-1/`, `fleet/out/W4-3/`): other sessions are live in this tree. Nothing of anyone's was modified, staged, committed or discarded by W4-2.

---

## 1 · The rule, stated in four places, amended in none

| Where | Text |
|---|---|
| `fleet/PROMPT.md:9` | *"You do NOT modify product behavior. Product source … stays byte-identical on the working tree."* |
| `fleet/PROMPT.md:18` (ground rule 4) | *"Probes … are NOT ship-ready patches. The deliverable is the plan + evidence."* |
| `fleet/00-rescue.md:74` | *"Product source is byte-identical to the rescue commit and stays that way."* |
| `fleet/TRIAGE.md:5` | *"Nothing in this file is fixed by this fleet — this fleet measures. These are handoffs."* |

`git log -- fleet/PROMPT.md fleet/00-rescue.md` returns **only `750e2ae`** (creation). Neither was ever revised.

## 2 · What actually changed — committed

**28 commits after the rescue base `75baddd`. 11 touch product source: 8 distinct files, +446 / −41 lines.** Gross per-commit sum equals the net branch diff, so nothing was added and reverted.

| sha | subject | product file(s) | evidence cited in body | test in same commit |
|---|---|---|---|---|
| `f56a155` | closer no-worse guard (G4) | macroCloser +14/−4 | "106 of 106 days, worst +16.1 g" | ✅ macroCloser.test.js |
| `602f06c` | spread adjusters off slot 0 (G6) | macroCloser +31/−8 | "250 of 250 days, 123→685 kcal (×5.56)" | ✅ |
| `d368acd` | quarantined food served until restart (G5) | planContext +29/−5 | "9.1 ms → 9.9 ms, median of 7" | ✅ |
| `e50c10a` | stale slot warning (E4) | macroCloser +5/−1, weeklyPlanner +40/−1 | "15 of 250 slots, worst 701 kcal" | ✅ |
| `e96df4f` | optimizer step bound + weight trap | brain/optimizer +25/−2 | "k=3/5/7 all land 2,000 exactly" | ✅ |
| `b28bd17` | free-text term must not match mid-word (H5) | dietaryFilter +26/−3 | "57/57 GF pasta hidden from celiacs" | ✅ |
| `6530fa0` | **peanut exclusion carries lupin (T-3)** | allergenTaxonomy +32, dietaryFilter +18/−1 | "3 lupin rows in the library today" | ✅ |
| `677dd78` | derive slot warning server-side (E8) | routes/plans +88/−15 | "warning:null erased a real 262 kcal miss" | ✅ |
| `30508fe` | surface slot warnings on Today (1.3) | **frontend TodayTab +60/−0** | lint/build only — no artifact path, no test name | ❌ **none** |
| `b2ec6f2` | GF pasta visible to celiacs (H3) | dietaryFilter +51/−0 | "celiac pool 466 → 525 of 910" | ✅ |
| `7327a84` | **cilantro leaf under its commoner name (L1)** | allergenTaxonomy +4/−1, dietaryFilter +23 | "13 personas, 198 offers, 44 recipes" | ✅ |

Two of these — `6530fa0` and `7327a84` — I verified independently in `LAWS-SWEEP.md`: **both fixes work.** The lupin cross-reaction fires; bare `Coriander` is now excluded.

The other 17 commits touch no product source (measurement, artifacts, `backend/scripts/qc/`, ledger, docs) and are within the rule as written. One edge: `dcb9412` changes `backend/data/foodOverrides.json` (5 lines) — shipped data, not `src/**`, and its own body says the repairs were staged in the overrides file and **not** written to `dev.db`.

## 3 · What actually changed — uncommitted (+497 / −80 over 6 files)

| path | what it is | risk |
|---|---|---|
| **`backend/src/lib/bmrEngine.js`** | Fat-prescription rewrite. New `fatBandFor()`; the non-keto anchor moves from `lbm×0.34–0.40` **grams** to a **share of target kcal** (`FAT_PCT_ENERGY_MID = 0.25`, half-width `3/37` preserving the old band shape); `ESSENTIAL_FAT_PER_LB_LBM = 0.30` now clamps **every edge**, not just the midpoint (previously `fatLo` could publish at 0.27 g/lb — *beneath the engine's own declared floor*). Publishes `fatFloorG`, `fatFloored`, `fatPctEnergy`. | **HIGH — see §4.1.** User-visible (`EngineTab.jsx:324` "Fat range", TodayTab fat rail, solver prose, every day's grading band). WORK-PLAN Tier **5**, the last item in its own recommended order. |
| **`backend/prisma/schema.prisma`** (+63) + untracked migration `20260802034419_plan_verdict_persistence` | 4 nullable columns on `Plan`: `verdict`, `diagnosis`, `verdictAt`, `verdictSlotSig`. Migration is 4 additive `ALTER TABLE`s, no drops. | Low in itself. |
| **`frontend/src/components/PlanTab.jsx`** (+192) | Verdict persistence + staleness UI: `planSlotSig`, a **localStorage mirror** (`cutprotocol.plan.verdict`), `judgeVerdict` → `stale ∈ {mutated, unverifiable}`, new `StaleVerdict` amber card, `genMeta` → `sessionVerdict`. Its own comment concedes the **backend writer does not exist yet** — the DB read path is live, the insert belongs in `POST /plans/generate`, which this change does not own. | **Medium — no test, half-wired.** |
| `backend/scripts/qc/runSolve.mjs` (+35), `docs/…/A1/rig/runRig.mjs` (+116), untracked `personas.mjs`, `poolGap.mjs` | K2c fix — the rig and runSolve drop `applyFilterStack`. Sanctioned area (`backend/scripts/qc/`, docs). | None. |
| untracked `backend/tests/fatPrescriptionDrift.test.js` (335 lines, 13 tests) | Locks the bmrEngine change: fat responds to target, %E does not climb as the deficit deepens, no unfloored prescription leaves AMDR 20–35 %E, every target publishes `fatFloorG`, band half-width still ≈0.081. | Good practice — but uncommitted alongside the change it guards. |
| untracked `frontend/vite.qa2.config.js` | Second QA vite on 127.0.0.1:5174 so a destructive walk gets its own cookie origin. Not product code. | None. |
| **`.claude/settings.json`** (+26/−1) | **Permission-scope widening** during an autonomous run: adds `Write(**)` (previously only `Edit(**)`), `Bash(git worktree:*)`, four loopback `curl` patterns, three PowerShell read cmdlets, 14 `mcp__claude-in-chrome__*` tools. The `deny` block (incl. `git push`) is untouched. | **Flagged.** No decision record covers it. W4-2 treats this as a *finding to report*, never as authorization for anything. |

## 4 · The four hazards that actually follow

### 4.1 The tree has a red test, and it is a floor test

Verified by W4-2, not inherited:

```
$ node --test backend/tests/qc/macroFloors.test.js
✖ non-keto carbs never go below the floor when the target can hold them
  AssertionError: the floor should have engaged   (macroFloors.test.js:53)
```

A committed test asserts that at 95 kg / 12 % BF / 1700 kcal the **carb floor engages**; under the uncommitted fat anchor it no longer does (fat now takes 25 % of 1700 ≈ 47 g instead of ≈68 g, leaving room the floor used to have to create). Commit `7327a84`'s own body already recorded it — *"1585 tests; the single failure is the UNCOMMITTED bmrEngine fat change"* — and **no `DECISIONS.md` or `WORK-PLAN.md` entry adjudicates it.** Either the new behaviour is right and the test is stale, or the test is right; nobody has said which, in writing, and the branch is red either way.

For the record, from my own sweep: the change does **not** breach the calorie floor — W4-1's `armF` dumps, produced with the new engine, show **0 prescription-floor violations** in `lawsweep2.json`. The red test is about the *carb* floor engaging, not about under-feeding.

### 4.2 Every W3 number was measured on the pre-fix tree

W3-7 says so itself (*"Measured on the PRE-FIX tree (962ac88)"*), and `fa6c0db` measured Tier 2's effect afterwards (closer fires −51 %, satisfiable 77.34 → 77.90 %). But the **uncommitted** bmrEngine change moves the fat band that every day is graded against, and no full-fleet baseline exists on top of it (W4-1 is measuring that right now — `fleet/out/W4-1/bmrEngine.OLD.js` / `.NEW.js` + `daydump-armP-*`). **W5 must not quote a W3 absolute number as "current" without stating which tree it was measured on.**

### 4.3 The handoff documents now contradict the tree

- `fleet/TRIAGE.md` still opens with *"Nothing in this file is fixed by this fleet"*, while **T-3 has been fixed** (`6530fa0`) and verified. T-2's `L1` — fixed in `7327a84` — was never written into TRIAGE.md at all.
- `fleet/state.json` and `fleet/PROGRESS.md` contain **no row or log line for any of the 11 product-fix commits**; the ledger was last written at `001dce3`. The resume protocol reads that ledger. A relaunched run would not know the product tree had moved.
- `fleet/WORK-PLAN.md:72` credits E4 to commit **`79523f6`**, which is a real object but **unreachable from any ref** (`git branch -a --contains` returns nothing). The fix on this branch is `e50c10a`. The audit trail points at a dangling commit.

### 4.4 Uncommitted product source is the exact condition W0 existed to fix

W0-1's whole job was rescuing stranded uncommitted work. The branch now carries a fat-prescription rewrite, a schema change, a migration, a 192-line frontend change and a 335-line test **uncommitted**, in a tree where multiple sessions are writing concurrently and one run has already been killed mid-flight. Push is guard-blocked (D-2), so none of it exists off this disk except in the 56 MB rescue bundle — **which predates all of it.**

## 5 · Where the sanction actually is

Only one file authorizes any of this, and it is not `DECISIONS.md`:

- `fleet/WORK-PLAN.md:64` — `## TIER 2 — Correctness bugs that gate the levers ✅ COMPLETE 2026-08-01`
- `fleet/WORK-PLAN.md:66` — *"W3-4: 'Ship the G4 guard fix and the E4 warning re-derivation regardless — correctness, prerequisites, not levers.'"*
- `fleet/WORK-PLAN.md:198` — *"**Tier 2** — correctness prerequisites; the fleet says ship these regardless."*

Three things make that a weak sanction:
1. `WORK-PLAN.md` was **created inside `f56a155`**, the first product-fix commit. The authorization and the first instance of the authorized act arrived together; there is no prior record.
2. The sentence **quotes agent W3-4's recommendation**. A subagent recommending its own fix be shipped is an input to a decision, not the decision — and no agent's report is the owner's consent.
3. Tier 2 is the only tier so worded, yet **Tiers 1, 3 and 5 were also entered**: committed `677dd78`, `30508fe` (Tier 1), `6530fa0`, `b28bd17`, `b2ec6f2` (Tier 3); uncommitted PlanTab+schema (Tier 1.4/1.5) and bmrEngine (Tier **5**.5/5.6) — Tier 5 being step 6 of WORK-PLAN's own six-step order, behind *"resume the fleet tail"*, which is still 5 agents `pending`.

`fleet/DECISIONS.md` holds D-1…D-8 — rescue split, blocked push, brief-vs-prompt divergence, persona provenance, the `-F` guard false positive, allergen severity, W0-1 inline, test suite deferral. **Not one concerns product edits, and the file has not been touched since `750e2ae`.** A run that logged its decision to *skip running the test suite* did not log its decision to *start rewriting the engine*.

## 6 · Recommendations (W4-2 does not act on any of them)

1. **Log it retroactively.** A `D-9` in `DECISIONS.md` stating plainly that ground rule 1 was suspended for correctness-class fixes on 2026-08-01, which tiers were entered, and on whose authority. An undocumented suspension is worse than a documented one.
2. **Adjudicate the red test** (`macroFloors.test.js:50`) in writing before anything else lands, and either commit `bmrEngine.js` + `fatPrescriptionDrift.test.js` + the updated `macroFloors` expectation together, or park the change on a branch. It must not stay half-in.
3. **Test the two untested UI changes** (`TodayTab.jsx` `30508fe`, `PlanTab.jsx` uncommitted) or mark them explicitly untested in the ledger. No frontend test exists anywhere on this branch.
4. **Reconcile the handoffs**: close T-3 and add L1 in `TRIAGE.md`; add the product-fix commits to `state.json`/`PROGRESS.md`; fix the `79523f6` → `e50c10a` citation.
5. **Re-bundle.** The rescue bundle predates every product fix and all the uncommitted work. Owner action, per D-2.
6. **Note the `.claude/settings.json` widening** in the same D-9. A run that grants itself broader tool authority mid-flight should say so out loud.
