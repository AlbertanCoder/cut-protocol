#!/usr/bin/env bash
# A14 sweep 2 — isolate the two strata the pool-scaled rule separates.
#
# Measured on the baseline (A14-cost-base-s424242.csv): today's per-slot depth is
# 5.00 for the 47 personas whose pool is <60 recipes, 9.63 for 60-140, 17.86 for
# 140-300 and 20.00 above that. So the cap and the floor touch DISJOINT customers:
#   floor* : changes ONLY thin pools   (the 2026 "deep search starves a thin pool")
#   cap*   : changes ONLY fat pools    (the 2026 "depth stops paying after 12")
set -u
D=/c/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A14
cd "$D" || exit 1

run () {
  local label=$1; shift
  local seed=$1; shift
  local out="$D/A14-${label}-s${seed}.jsonl"
  if [ -s "$out" ]; then echo "== skip $label s$seed (exists)"; return; fi
  echo "== $label s$seed  $*"
  node A14-runRig.mjs --seed="$seed" --label="$label" --quiet \
    --out="$out" --statcsv="$D/A14-cost-${label}-s${seed}.csv" "$@" 2>&1 | grep -E "^\[A14\]"
}

for S in 424242 20260730 8675309; do
  run floor12 "$S" --min=12 --max=20 --div=10   # thin pools only: 5 -> 12
  run cap12   "$S" --min=5  --max=12 --div=10   # fat pools only: 20 -> 12
done

run floor8       424242 --min=8  --max=20 --div=10
run floor20      424242 --min=20 --max=20 --div=10
run floor40      424242 --min=40 --max=40 --div=10
run floor12cap40 424242 --min=12 --max=40 --div=10
run cap8         424242 --min=5  --max=8  --div=10

echo "== SWEEP2 DONE"
