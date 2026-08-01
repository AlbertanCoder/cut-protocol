#!/usr/bin/env bash
# A14 search-budget sweep. Sequential on purpose: solveMs is a reported metric,
# so no two solves may share the CPU.
set -u
D=/c/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A14
cd "$D" || exit 1

run () { # run <label> <seed> <extra flags...>
  local label=$1; shift
  local seed=$1; shift
  local out="$D/A14-${label}-s${seed}.jsonl"
  if [ -s "$out" ]; then echo "== skip $label s$seed (exists)"; return; fi
  echo "== $label s$seed  $*"
  node A14-runRig.mjs --seed="$seed" --label="$label" --quiet \
    --out="$out" --statcsv="$D/A14-cost-${label}-s${seed}.csv" "$@" 2>&1 | grep -E "^\[A14\]"
}

# ---- Tier A: three seeds each -------------------------------------------
for S in 424242 20260730 8675309; do
  run base    "$S"
  run flat5   "$S" --flat=5
  run flat12  "$S" --flat=12
  run flat14  "$S" --flat=14
  run flat20  "$S" --flat=20
  run cap40   "$S" --min=5 --max=40 --div=10
  run att12   "$S" --attempts=12
done

# ---- Tier B: primary seed only ------------------------------------------
run flat8      424242 --flat=8
run flat30     424242 --flat=30
run flat60     424242 --flat=60
run cap60div5  424242 --min=5 --max=60 --div=5
run cap200div2 424242 --min=5 --max=200 --div=2
run att1       424242 --attempts=1
run att2       424242 --attempts=2
run att20      424242 --attempts=20
run att30      424242 --attempts=30
run cap40att20 424242 --min=5 --max=40 --div=10 --attempts=20

echo "== SWEEP DONE"
