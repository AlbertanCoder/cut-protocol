#!/bin/sh
# H5 — no push without the owner's hand. Logic lives in .claude/hooks/pre-push-check.js
# so that a deleted or corrupted checker fails the push rather than waving it through.
exec node .claude/hooks/pre-push-check.js "$@"
