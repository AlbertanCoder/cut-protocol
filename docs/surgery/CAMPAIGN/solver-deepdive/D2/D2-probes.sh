#!/bin/sh
# D2-probes.sh — single-seed directional probes on the slot loop.
# Every arm carries the SAME instrumentation as the baseline, so the only
# difference between baseline and arm is the treatment edit itself.
set -e
cd "$(dirname "$0")"
SEED=${1:-424242}

run () {  # run <label> <D2_EDITS json>
  echo "=== $1 (seed $SEED) ==="
  D2_EDITS="$2" node --require ./D2-hook.cjs D2-run.mjs --seed=$SEED --label="$1" \
    --out="$PWD/D2-$1-s$SEED.jsonl" 2>&1 | grep -E '^\[D2\]'
}

# --- ordering of the within-day slot chain ---------------------------------
DESC='[{"file":"weeklyPlanner.js","find":"  const openTargets = openIdx.map((i) => dayTargets[i]);","replace":"  openIdx.sort((a, b) => dayTargets[b].weight - dayTargets[a].weight);\n  const openTargets = openIdx.map((i) => dayTargets[i]);"}]'
ASC='[{"file":"weeklyPlanner.js","find":"  const openTargets = openIdx.map((i) => dayTargets[i]);","replace":"  openIdx.sort((a, b) => dayTargets[a].weight - dayTargets[b].weight);\n  const openTargets = openIdx.map((i) => dayTargets[i]);"}]'

# --- the within-day carry-forward cap --------------------------------------
CARRY0='[{"file":"weeklyPlanner.js","find":"const CARRY_CAP_PCT = 0.3;","replace":"const CARRY_CAP_PCT = 0;"}]'
CARRY9='[{"file":"weeklyPlanner.js","find":"const CARRY_CAP_PCT = 0.3;","replace":"const CARRY_CAP_PCT = 0.9;"}]'

run order-desc "$DESC"
run order-asc  "$ASC"
run carry-off  "$CARRY0"
run carry-wide "$CARRY9"
