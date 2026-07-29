#!/bin/sh
#
# pre-commit — the black box is append-only at the commit layer.
#
# Refuses any commit that MODIFIES, DELETES or RENAMES an existing tracked file
# under docs/surgery/CAMPAIGN/. New files pass. ledger.md passes. Everything
# outside that directory passes untouched.
#
# ---------------------------------------------------------------------------
# WHAT THIS IS: ACCIDENT-DEFENSE. IT IS NOT CONTAINMENT.
#
#   · .git/hooks/ is NOT version-controlled. This hook does not survive a
#     clone; a fresh checkout has no protection until someone installs it by
#     hand.
#   · This file is deletable from any shell, by any role, including one with
#     no CP_ROLE set. That was probed and it returns ALLOW.
#   · Nothing here stops a session that intends to bypass it. It stops the
#     slip: a stray redirect, a careless script, a wrong path in a loop.
#
# It is placed at the COMMIT layer deliberately, because a write only enters
# the RECORD through a commit. A tampered-but-uncommitted file stays loudly
# visible in `git status`. That is the whole of the claim; do not describe this
# hook as anything stronger, in any report, ever.
# ---------------------------------------------------------------------------
#
# Install:  cp scripts/surgery/pre-commit.sh .git/hooks/pre-commit
# Source of truth is this tracked file; .git/hooks/pre-commit is the copy that
# git actually runs.

set -e

CAMPAIGN='docs/surgery/CAMPAIGN/'
LEDGER='docs/surgery/CAMPAIGN/ledger.md'

# M = modified, D = deleted, R = renamed. Additions (A) are deliberately absent:
# the black box grows freely and only ever forward.
CHANGED=$(git diff --cached --name-only --diff-filter=MDR -- "$CAMPAIGN" || true)

BAD=''
for f in $CHANGED; do
  [ "$f" = "$LEDGER" ] && continue
  BAD="$BAD  $f
"
done

if [ -n "$BAD" ]; then
  echo "BLOCKED: this commit changes files that already exist in the black box:"
  printf '%s' "$BAD"
  echo "docs/surgery/CAMPAIGN/ is append-only. Orders, verdicts, asks, charters,"
  echo "sitreps and checkpoints are immutable once written; ledger.md is the one"
  echo "mutable file. Adding new files is fine. Changing what is there is not."
  echo ""
  echo "If this is a legitimate correction, it is the owner's hand, not a session's."
  exit 1
fi

exit 0
