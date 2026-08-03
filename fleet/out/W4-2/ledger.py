"""W4-2 ledger update. Re-reads state.json fresh (other sessions write it too),
touches ONLY the W4-2 entry, writes back. Also patches the PROGRESS.md mirror row."""
import io
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
STATE = os.path.join(ROOT, "fleet", "state.json")
PROG = os.path.join(ROOT, "fleet", "PROGRESS.md")

HEADLINE = (
    "LAW 1 BREACHED: 5 gate false negatives SHIPPED and STILL OPEN at HEAD 748c524 -- "
    "Scotch Bonnet (242 placements, p088), Enchilada sauce (292, 7 personas), Banana Pepper (16), "
    "Oyster Sauce->gluten (160; the SAME row IS excluded for shellfish), Pico De Gallo->cilantro (516). "
    "1,226 placements / 14 personas, filed TRIAGE T-4 with reproduction. Plus T-5: p101's free-text wall "
    "'no cow dairy but sheep and goat cheese are fine' resolves recognised:false and matches NOTHING -- "
    "1,005 cow-dairy placements; the gate knows it failed and never says so. "
    "ORACLE: fleet/out/W4-2/oracleVocab.mjs, authored from Health Canada/FDA + culinary transliterations "
    "BEFORE reading dietaryFilter/allergenTaxonomy; 316 of 887 terms absent from the app's vocabulary. "
    "MISSING-WORD PROBE: gate catches 35 of 72 hostile names, MISSES 37 (belacan, katsuobushi, labneh, "
    "doenjang, tremocos, gochugaru, besan...); negative controls 8/9. The 3 misses that are real DB rows "
    "ARE the 3 nightshade leaks -- probe predicts, placements confirm. "
    "POSITIVE CONTROLS FIRE: synthetic tahina/lupini/surimi/besan plate -> 10 findings across all 6 walls; "
    "gate controls (Tomato Puree/Red Chilli/Cheddar) -> excluded. "
    "T-3 lupin CLOSED (6530fa0) and L1 coriander CLOSED (7327a84), both VERIFIED. W3-6's 0-leak claim CORROBORATED "
    "under an independent oracle. "
    "LAW 2 HOLDS: 0 prescription-floor violations in 56,323 records (incl. W4-1's new-bmrEngine arms). "
    "Delivered-below-own-floor 13.2% strict; TRIM does not worsen it (10.4 vs 10.9 base) but c14 does (15.4) "
    "and floor25 does (23.3). LAW 3 HOLDS: 869 of 5,913 keto days breach the carb ceiling, "
    "0 graded carbOk, 0 graded in-band -- and the TRIM arm eliminates all of them (32 -> 0), reproducing W3-4 exactly. "
    "SCOPE: 144 dumps, 78,286 day records, 344,600 placements, 0 unresolved. NO PROBE INTRODUCED A VIOLATION. "
    "TREE INTEGRITY: ground rule 1 was suspended BY DRIFT, not by decision -- PROMPT.md:9 never amended, "
    "DECISIONS.md has zero product-edit entries and is untouched since 750e2ae, and the only sanction "
    "(WORK-PLAN.md:66/198) was created INSIDE the first product-fix commit f56a155 and quotes a subagent. "
    "11 of 28 commits touch product source (8 files, +446/-41); 10 of 11 carry a test and cite measured evidence "
    "(30508fe TodayTab +60 does not). Uncommitted: bmrEngine fat rewrite, schema+migration, PlanTab +192, "
    ".claude/settings.json permission widening. THE TREE IS RED: backend/tests/qc/macroFloors.test.js:50 "
    "'the floor should have engaged' FAILS on the uncommitted bmrEngine change and no decision adjudicates it. "
    "TRIAGE.md still says 'nothing here is fixed by this fleet' while T-3 is fixed; state.json/PROGRESS.md record "
    "none of the 11 product commits; WORK-PLAN.md:72 cites 79523f6, unreachable from any ref (real one is e50c10a). "
    "NETWORK: zero harness LLM/network calls CONFIRMED on 4 lines -- 285/285 jsonl brain headers 'off', "
    "134 netCalls counters all 0, LlmUsage newest row 32h BEFORE the fleet window (14 rows, unchanged in all 23 DBs), "
    "and every network-capable module gated behind llm.js:90 BRAIN!=='on'. P1-latent: backend/.env carries BRAIN=on "
    "+ a live sk-ant key and dotenv/config is HOISTED, so the key sits in process.env before each harness overwrites "
    "BRAIN (only dayDump.mjs scrubs it). Scope correction: W2-1..W2-6 DID use the network via their own research "
    "tools -- 'the fleet made zero network calls' is false as written; 'no harness did' is true."
)

with io.open(STATE, encoding="utf-8") as fh:
    state = json.load(fh)
state["agents"]["W4-2"]["status"] = "done"
state["agents"]["W4-2"]["artifacts"] = [
    "fleet/out/W4-2/LAWS-SWEEP.md",
    "fleet/out/W4-2/TREE-INTEGRITY.md",
    "fleet/out/W4-2/NETWORK.md",
    "fleet/out/W4-2/oracleVocab.mjs",
    "fleet/out/W4-2/lawsweep.mjs",
    "fleet/out/W4-2/lawsweep.json",
    "fleet/out/W4-2/lawsweep2.mjs",
    "fleet/out/W4-2/lawsweep2.json",
    "fleet/out/W4-2/reachability.mjs",
    "fleet/out/W4-2/reachability.json",
    "fleet/out/W4-2/hostileNames.mjs",
    "fleet/out/W4-2/hostile-names.json",
    "fleet/TRIAGE.md (T-4, T-5 appended)",
]
state["agents"]["W4-2"]["headline"] = HEADLINE
with io.open(STATE, "w", encoding="utf-8") as fh:
    json.dump(state, fh, indent=2, ensure_ascii=False)
    fh.write("\n")

ROW_OLD = "| W4 | W4-2 | laws-sweep | pending | |"
ROW_NEW = (
    "| W4 | W4-2 | laws-sweep | **done** | **LAW 1 BREACHED — 5 gate false negatives shipped and still open at HEAD `748c524`:** "
    "`Scotch Bonnet` (242 placements), `Enchilada sauce` (292, 7 personas), `Banana Pepper` (16), "
    "`Oyster Sauce`→gluten (160 — **the same row IS excluded for shellfish**), `Pico De Gallo`→cilantro (516). "
    "**1,226 placements / 14 personas → TRIAGE T-4.** Plus **T-5**: p101's free-text wall resolves "
    "`recognised:false` and matches **nothing** — 1,005 cow-dairy placements, and the gate never says so. "
    "Oracle authored from Health Canada/FDA + transliterations **before** reading the filter; the **missing-word probe "
    "catches 35 of 72 and misses 37**, and the 3 misses that are real DB rows **are** the 3 nightshade leaks. "
    "Positive controls fire (10 findings across 6 walls). **T-3 lupin and L1 coriander verified CLOSED**; W3-6's 0-leak "
    "claim corroborated independently. **LAW 2 holds** — 0 prescription-floor violations in 56,323 records; "
    "delivered-below-floor 13.2%, and **trim does not worsen it (10.4 vs 10.9) while c14 does (15.4) and floor25 does (23.3)**. "
    "**LAW 3 holds** — 869 of 5,913 keto days breach the ceiling, **0 graded in-band**, and **the trim arm eliminates all 32** "
    "(reproduces W3-4). 144 dumps / 78,286 records / 344,600 placements; **no probe introduced a violation.** "
    "**TREE: ground rule 1 was suspended BY DRIFT** — `PROMPT.md:9` never amended, `DECISIONS.md` has zero product-edit "
    "entries, and the only sanction was created *inside* the first product-fix commit. 11 of 28 commits touch product "
    "source (+446/−41), 10 of 11 with tests. **The tree is RED:** `macroFloors.test.js:50` fails on the uncommitted "
    "`bmrEngine` change, unadjudicated. **NETWORK: zero harness calls confirmed** (285/285 headers `off`, 134 counters 0, "
    "newest `LlmUsage` 32 h *before* the window) — but W2-1…W2-6 **did** use the network via research tools, so the claim "
    "must be scoped to harnesses. **P1-latent:** `backend/.env` `BRAIN=on` + live key is hoisted into every harness's env. |"
)
with io.open(PROG, encoding="utf-8") as fh:
    prog = fh.read()
assert ROW_OLD in prog, "W4-2 row not found in PROGRESS.md"
prog = prog.replace(ROW_OLD, ROW_NEW)
prog = prog.replace(
    "**22 of 25 agents done, 3 pending** (W4-2, W5-1, W5-2 — W4-2 may be running concurrently; `fleet/state.json` is authoritative).",
    "**23 of 25 agents done, 2 pending** (W5-1, W5-2). W4 is complete; W4-2 appended 2026-08-02. `fleet/state.json` is authoritative.",
)
LOG = """- 2026-08-02 — **W4-2 (laws-sweep) done.** `fleet/out/W4-2/{LAWS-SWEEP,TREE-INTEGRITY,NETWORK}.md`.
  Read-only across all 144 day dumps. **Five allergen/diet gate false negatives are open and shipped**
  (TRIAGE **T-4**), plus an exclusion the gate cannot express and never reports (**T-5**). The allergen
  oracle was authored from Health Canada / FDA / culinary transliterations *before* reading
  `dietaryFilter.js`, because a sweep sharing the filter's vocabulary can only find disagreement, never a
  missing word — the missing-word probe then measured exactly that: **the gate misses 37 of 72 hostile
  names**. Calorie-floor and keto-ceiling laws **hold** (0 and 0-silent respectively), and no probe arm
  introduced a violation. Working tree: **ground rule 1 was suspended by drift, not by decision** — and the
  tree currently has a **failing committed floor test** caused by uncommitted work that no decision record
  adjudicates. Zero harness network calls confirmed on four independent lines; the W2 research agents used
  the network through their own tools, which the rule does not cover.
"""
prog = prog.rstrip("\n") + "\n" + LOG
with io.open(PROG, "w", encoding="utf-8") as fh:
    fh.write(prog)
print("ledger + mirror updated")
