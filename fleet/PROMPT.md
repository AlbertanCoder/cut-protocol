# CUT PROTOCOL — RESEARCH FLEET (25 core agents, adaptive to 50): MEASURE THE REAL SOLVER, VALIDATE THE CLOUD FINDINGS, DELIVER THE FIX PLAN

You are Claude Code running fully autonomously on Shad's Windows machine inside the `cut-protocol` repo. Execute this file top to bottom. You were launched by a BAT file; nobody is watching the terminal. Never wait for input. Never ask questions — make the reasonable call, record it in `fleet/DECISIONS.md`, and keep moving.

## MISSION

The meal solver works but can't land everyone's generated macros (kcal/protein/fat/carb) as compliant meals — match % is well under 100 and many profiles are declared unsolvable. A 25-agent cloud investigation (2026-07-31) already measured WHY on a generic clone. Your job is the part the cloud could not do: **measure everything on THIS machine's real code, real database, and real 250-persona fleet — including the uncommitted campaign work the cloud never saw — validate or refute each cloud finding, research the remaining gaps online, and deliver a fix plan ranked by YOUR measured numbers.**

**You do NOT modify product behavior.** Product source (`backend/src/**`, `frontend/src/**`) stays byte-identical on the working tree. You MAY: commit existing uncommitted work as a protective rescue (W0), add measurement scripts under `backend/scripts/qc/` and `fleet/`, and build probe copies under `fleet/scratch/` where experimental patches live and die. All fleet work commits to branch `fleet/measure-2026-08`.

## SESSION-LIMIT ARMOR (do this first, maintain always)

Create `fleet/state.json` (agent ledger: `{"agents":{"W0-1":{"status":"pending|running|done|failed","artifacts":[],"headline":""},...}}`) and `fleet/PROGRESS.md` before anything else. **Update both after EVERY agent finishes.** If this run dies (usage limit, crash), the BAT relaunches you with instructions to resume: read the ledger, skip everything `done`, continue from the first unfinished agent. Design every agent so its artifacts stand alone.

## GROUND RULES

1. The repo's laws stand: never weaken allergy/diet exclusions, floors, or honesty rules. Finding an allergen leak = write `fleet/TRIAGE.md` immediately with reproduction, keep going.
2. Zero API cost in harnesses: `BRAIN=off` everywhere; a harness making an LLM/network call is itself a P0 finding.
3. Every number carries its command + seed. Same seeds across compared runs, always. No number without an artifact file.
4. Probes prove direction on this machine; they are NOT ship-ready patches. The deliverable is the plan + evidence.
5. Run agents as parallel subagents (Task tool), ≤5 concurrent. Waves in order — later waves consume earlier artifacts.
6. Artifacts live in `fleet/out/<agent-id>/`. Keep summaries dense; raw JSONL stays on disk, not in context.

## INHERITED INTELLIGENCE — CANONICAL SOURCE: `docs/surgery/CAMPAIGN/solver-deepdive/CONSOLIDATED-BRIEF.md`

**That file is the single source of truth for prior findings and MUST be read end-to-end in W0 before any agent spawns.** It consolidates the campaign + the cloud investigation and is newer than the condensed block below. **Wherever the brief and this block disagree, the brief wins.** The block below is a fallback summary only (for orientation, and in case the file has moved — if it's not at that path, glob `docs/**/CONSOLIDATED-BRIEF*.md` before giving up).

Cloud lab = master `8796f5f`, fresh-seed 626-recipe DB, n=1000/7000 days, seed 42, pre-campaign code. Headlines, all adversarially reproduced:
- **Ceiling math:** 83/250 personas engineered-unsatisfiable ⇒ all-days ceiling 495/578 = **85.6%**. All-days 85% ⇔ satisfiable-only 99.25%. The honest target: **satisfiable-only ≥85% under a floor ruler** + detection KPIs on the 83.
- **Ruler verdict:** fat band `lbm×0.34–0.40` is wrong both directions — 0/6 evidence sources prescribe any tight upper fat band (Helms 15–30% kcal, ISSN 20–35%, RP 0.3 g/lb floor, Trexler 40–60 g floor); pass floor 0.2475×lbm < the app's own `ESSENTIAL_FAT_PER_LB_LBM=0.30`. Lab: 64.7% of days ABOVE the raw band, fat-under = 0 in 7000 days. Ruler A→floor-ruler B/D on identical plans: **6.33→23.97/20.27%** (flips +1065/−89). But kcal+protein alone still cap baseline at 41.8% — ruler is A blocker, not THE blocker.
- **Lever ledger (lab measured):** guarded repartition-H 9.8→26.0% filled days (guard mandatory; unguarded wrecks oracle 49→16.3) · per-day best-of selection bound 10.8→24.5% @k=20 · closer v3 +7.23pp but **add-only ceiling 31.03%** (74.2% of misses are OVER-side → needs TRIM arm) · attempts 20→40 +1.74pp @2× · vegan pack 1.29→13.67% (10.6×, 0 leaks) · **weights tuning DEAD** (247/3500 identical ×4 variants) · best-stack total 22.17% A / 41.39% D.
- **Honesty bug:** `diagnoseFromResult` returns `feasible:false` unconditionally (8796f5f mealSolver.js:405) — 41/41 perfect weeks mislabeled, precision 4.2%, false-surrender 95.8%. Silent misses 0.
- **Data bug class:** one wrong-record seed row ("Egg Plants" carrying egg-white macros) caused ALL 115 lab safety P0s. Harness gap: mc.mjs:127 drops per-day data; oracle.mjs:214-215 mislabels outcomes.
- **Vegan:** binding constraint = protein-density tail (4/46 recipes clear the pass floor; 0 snack-eligible pre-pack). Killer stacks (vegan+soy+gluten+legumes) are protein-walled — detection tests, not compliance targets.
- **Transfer caveats:** lab pool 626 vs real ~889+; lab fleet ~4% infeasible vs real 33%; lab code pre-campaign. Cloud line numbers may not match this tree — locate by symbol.

---

## W0 — PREFLIGHT & RESCUE (1 agent, alone, before all else)

**W0-1 preflight-rescue.** Verify: node ≥18, `backend/` tests runnable, DB present (record SHA-256 + Food/Recipe counts + macro fingerprint if the harness computes one). `git status`: if ANY uncommitted changes exist, commit them ALL to branch `campaign-2026-07` with an inventory message (this is the stranded campaign: macroCloser.js, sampling, ~8 files, scripts) and push; if push fails, `git bundle` to `%USERPROFILE%\Desktop\cut-protocol-rescue.bundle` and log it. Then create `fleet/measure-2026-08` from it. **Read `docs/surgery/CAMPAIGN/solver-deepdive/CONSOLIDATED-BRIEF.md` in full** (glob `docs/**/CONSOLIDATED-BRIEF*.md` if moved; record its hash) and distill `fleet/BRIEF-CLAIMS.md`: every load-bearing claim as a numbered row — claim → its number/source → which agent(s) in this fleet will test it on real data → verdict column left blank. Every subsequent agent reads BRIEF-CLAIMS.md at start; if the brief contradicts the condensed block in this prompt, the brief wins and the divergence gets logged in DECISIONS.md. If the brief is truly absent, log that and run on the condensed block alone. Locate and record paths+hashes: the 250-persona fleet definition, its seeds, the campaign scoring script, macroCloser.js. If the persona fleet cannot be found byte-exact: say so in `fleet/00-rescue.md`, fall back to `scripts/qc/genProfile.mjs` fleets (n=1000 seed=42) and mark every downstream number "FALLBACK FLEET". DoD: `fleet/00-rescue.md` + state ledger initialized.

## W1 — MEASURE THE REAL APP (6 agents, parallel after W0)

**W1-1 harness-truth.** Instrumentation only: make the MC harness persist per-day records (totals + per-check booleans + daysInBand/daysPlanned — the solver already computes them; the harness drops them) and stamp DB fingerprint + git SHA in report headers. Fix the oracle outcome-mislabel if present in this tree. Commit on the fleet branch. DoD: one small run emits per-day JSONL.
**W1-2 re-baseline.** THE number: the real fleet (250 personas or fallback) through the real engine, scored BOTH rulers (A = shipping dayTolerance; D = floors: fat ≥0.30×lbm hard, carb ≥carbLo, keto ceiling kept) × BOTH metrics (all-days, satisfiable-only), per-diet split. Compare to the historical 70.1%/77.8% and document the aggregation semantics. DoD: `fleet/out/W1-2/BASELINE.md`.
**W1-3 taxonomy.** Bucket every failing day by binding miss (kcal-over/under, protein-short, fat-over/under, carb-over/under, multi, empty-slot); exact reconciliation (buckets sum = failing days); per-diet. Is the real mix fat-over-dominant like the lab's, or did the campaign shift it? What % of misses are OVER-side (decides the TRIM-arm priority)?
**W1-4 honesty-detection.** On the real run: the 2×2 (oracle feasible/infeasible × declared/silent), precision/recall on the 83 engineered personas, false-surrender rate of THIS tree's diagnosis code (campaign may have changed it from the lab's 95.8%), certified false-surrenders (declared ∧ converged). Locate the unconditional `feasible:false` if it still exists.
**W1-5 pool-census.** Real DB: per-diet pool sizes + protein-density distributions (g P/100 kcal p25/50/75) through the real filters; vegan meal-eligible density tail + snack-eligible count — did the campaign's 21 recipes fill the density/snack niches or miss them? Plus a wrong-record scan (EggPlants class) of the REAL DB AND the seed files: name-class vs macro-vector mismatches, flag every hit.
**W1-6 closer-audit.** Read the real `macroCloser.js` (cloud never saw it). Document: add-only or trim-capable? Which ruler does it chase? Then measure its actual contribution: one fleet run with it disabled (config/env toggle if present, else scratch copy), same seeds. DoD: the closer's real delta + whether 74.2%-over-side applies here.

## W2 — ONLINE RESEARCH, GAPS ONLY (6 agents, parallel with W1)

Each agent: web research with URLs for every load-bearing claim; primary sources over blogs; deliver `fleet/out/<id>/FINDINGS.md` with a "what this changes for Cut Protocol" section. Do NOT re-research what the inherited block already settled.
**W2-1 repartition-practice.** Production-grade approaches to multi-macro day re-portioning: goal programming / bounded least-squares in JS (libraries, numerical-safety patterns, integer-gram rounding). What guard conditions do real systems use?
**W2-2 selection-precedents.** Per-day best-of / portfolio selection across solver restarts: precedents, and how systems keep variety/repeat/leftover constraints while cherry-picking days.
**W2-3 vegan-snack-market.** High-protein-density vegan snack foods ACTUALLY available at Canadian retail (Superstore/Costco/Walmart CA) with per-100g macros + rough CAD prices — candidates for the density/snack niches if W1-5 confirms the gap.
**W2-4 competitor-teardown.** Deep teardown of Eat This Much, MacroFactor, StrongrFastr, Prospre, Mealime: what accuracy/window do they actually promise (exact claims, quoted), how they message "your targets can't be met as configured," their target-adjustment flows, and any engineering writeups on their generators. Deliver: a promises-vs-reality table + 3 concrete infeasibility copy blocks matching the app's calm-amber honesty rules.
**W2-5 weekly-metric.** Designs + precedent for weekly-rolling adherence headline metrics (7-day mean kcal ±5%, ≥6/7 protein-floor days): who uses what, gaming risks, how to display alongside per-day honesty.
**W2-6 fresh-sweep.** 2025–2026 developments in meal-plan generation/optimization the cloud sweep may have missed + an explicit CONTRARIAN pass: find the best argument AGAINST the floor-ruler recommendation and against repartition. If the contrarian case holds anywhere, say so plainly.

## W3 — PROBES ON REAL DATA (7 agents, after W1; scratch copies / re-scoring only)

Probe = measurement, not merge. Scratch copies live in `fleet/scratch/<id>/`; the working tree stays clean (verify with `git status` at each probe's end).
**W3-1 ruler-share.** Re-score W1-2's day dump (no re-solve) under rulers A/B/C/D/E/F (definitions per inherited block). THE decomposition: how much of the real gap is ruler vs solver. Flip counts + per-diet.
**W3-2 repartition-probe.** Guarded repartition-H in a scratch copy on the real DB/fleet: filled-day delta, guard on, keto reverts counted. Real-machine ms/day cost.
**W3-3 selection-probe.** Per-day best-of across attempts in scratch: realized delta (not just bound) on the real fleet, variety violations counted.
**W3-4 trim-probe.** Extend the REAL macroCloser minimally in scratch with a TRIM/downscale arm aimed at the floor ruler: over-side conversion rate, allergen/floor violations (must be 0).
**W3-5 attempts-curve.** Real pool: his adaptive budget vs fixed 20 vs 40, same seeds — marginal pp per doubling on the richer pool.
**W3-6 vegan-niche-probe.** ONLY if W1-5 confirmed missing niches: insert W2-3-informed staples/recipes in a scratch DB (validator-passing, tagged, provenance `fleet-probe`), re-run vegan + killer-stack segments, leak-sweep. Else convert to a second wrong-record deep-scan.
**W3-7 best-stack-probe.** One scratch copy combining every probe that won (expect: repartition + selection + TRIM + attempts knee), full fleet, BOTH rulers × BOTH metrics: **the headline "here is where your numbers can actually go."**

## W4 — ADVERSARIAL VERIFY (3 agents, after W3)

**W4-1 reproduce.** Re-run the three most load-bearing numbers (W1-2 baseline, W3-1 ruler share, W3-7 best-stack) from their recorded commands/seeds. CONFIRMED / PLAUSIBLE / REFUTED each; any mismatch >0.1pp gets root-caused.
**W4-2 laws-sweep.** Allergen/floor/keto sweep across ALL probe outputs; verify working tree byte-clean (`git status` = only fleet/ + sanctioned instrumentation); verify zero network calls in harness logs.
**W4-3 reconcile.** Taxonomy sums, denominators, satisfiable-cut definitions, and old-vs-new metric comparability (70.1% ↔ W1-2) all reconcile exactly. List every knife-edge.

## W4b — ADAPTIVE EXPANSION (0–25 agents, hard cap 50 total, after W4)

Review everything with a cold eye and spawn follow-up agents ONLY where a thread earned it. Qualifying triggers (log each spawn's justification in `fleet/DECISIONS.md`): a probe measured ≥2pp lift → one refinement agent to sharpen it; a taxonomy bucket is large but unexplained → one digger; the wrong-record scan found hits → one verifier per food class (batch small hits); a cloud finding was REFUTED on real data → one root-causer; W2 research surfaced a technique nobody probed → one probe agent for it. Spawn in batches of ≤5, update state.json for each, hard cap 50 agents total for the whole run. **If you see any sign of usage-limit pressure (API errors, refusals), skip remaining expansion immediately — the W5 synthesis must NEVER be sacrificed for extra breadth.** Zero qualifying triggers = zero spawns; say so and move on.

## W5 — SYNTHESIZE (2 agents, after W4b)

**W5-1 fleet-report.** Write `fleet/FLEET-REPORT.md` covering ALL agents including W4b expansions (state the final agent count): (1) verdict — real baseline 2×2, real ruler share, real achievable number from W3-7, distance to 85/90/95; (2) brief-vs-desktop scoreboard — every row of `fleet/BRIEF-CLAIMS.md` gets its verdict filled: CONFIRMED/ADJUSTED/REFUTED with the brief's number and YOUR measured number side by side; (3) ranked fix plan — lever → YOUR measured delta → effort → risk → acceptance gate; (4) honesty/detection KPIs current vs target; (5) data fixes (wrong-record hits); (6) threats. Every number → artifact path. Also `fleet/DASHBOARD.md`: the before/after tables compact.
**W5-2 next-prompt.** Author `fleet/NEXT-IMPLEMENT-PROMPT.md`: a complete staged implementation prompt (laws-first, DoD-gated, same-seed A/B acceptance gates) pre-filled with THIS fleet's measured numbers, ready to paste into a fresh Claude Code session to actually ship the fixes. End by printing to console: the 5-line verdict, the report paths, and "Double-click the BAT again anytime — state.json makes reruns incremental."

## END STATE

Branch `fleet/measure-2026-08` holds: instrumentation, `fleet/out/**`, FLEET-REPORT.md, DASHBOARD.md, NEXT-IMPLEMENT-PROMPT.md, state.json (all agents `done`). Working product tree: unchanged. Campaign work: rescued on `campaign-2026-07`. Commit everything, push if possible, print the summary. Done.
