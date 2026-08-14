#!/bin/sh
# Cut Protocol — container boot. Migrate, then serve.
#
# ── WHY THIS IS A SCRIPT AND NOT A ONE-LINE CMD (2026-08-13) ────────────────
# Three failure modes were hit for real on the first day of cloud deploys, and
# each one is handled explicitly below. A `migrate && node server.js` chain
# cannot express any of them.
#
#  1. HANGS ON EXIT. `prisma migrate deploy` finishes its work against the
#     Supabase session pooler in ~1s and then never exits — the engine child
#     does not terminate over the pooled connection. A bare `&&` chain waits
#     forever, so `node server.js` never ran and the healthcheck stared at an
#     empty container for its whole window. Seven deploys died this way before
#     the CLI's runtime logs showed the last line was "No pending migrations to
#     apply." `timeout` bounds it; exit 124 means "killed after doing the work"
#     and is a SUCCESS for our purposes, because the migration state already
#     lives in the database.
#
#  2. POOL EXHAUSTION AT HANDOVER — the deadlock this script exists for.
#     Supabase's session pooler caps at 15 clients. Railway keeps the OLD
#     container serving until the NEW one is healthy, so during every deploy
#     both are alive; if the old one's Prisma pool is already near the cap, the
#     new one's migrate cannot get a connection, never becomes healthy, and the
#     old one therefore never stops. That is a permanent deadlock — measured
#     four times tonight, unbreakable by redeploy/restart/scale.
#     A connection shortage is NOT a schema problem: the migrations that matter
#     were applied long before. So we log it loudly and BOOT ANYWAY. The app's
#     own pool acquires connections as the old container drains, which is
#     exactly what lets the handover complete.
#
#  3. A GENUINELY BROKEN MIGRATION still aborts the boot with its own exit
#     code, which is the whole point of running migrate at startup. Serving an
#     app against a schema it does not understand is worse than not serving.
#
# Keep this file and railway.json's startCommand in agreement: startCommand
# overrides the Dockerfile CMD on Railway, so both must invoke this script.
set -u

SCHEMA="prisma/postgres/schema.prisma"

echo "[boot] applying migrations (bounded)…"
out=$(timeout -k 10 120 ./node_modules/.bin/prisma migrate deploy --schema "$SCHEMA" 2>&1)
ec=$?
echo "$out"

if [ "$ec" -ne 0 ] && [ "$ec" -ne 124 ]; then
  case "$out" in
    *EMAXCONNSESSION*|*"max clients reached"*|*"Timed out fetching a new connection"*)
      echo "[boot] WARNING: migrate could not obtain a pooled connection (pool is saturated —"
      echo "[boot] typically the outgoing container during a deploy). NO migration was applied"
      echo "[boot] or skipped: the schema is whatever it already was. Starting the server so the"
      echo "[boot] handover can complete. If a migration IS pending, run it explicitly:"
      echo "[boot]   prisma migrate deploy --schema $SCHEMA"
      ;;
    *)
      echo "[boot] FATAL: migrate failed for a non-connection reason — refusing to serve against"
      echo "[boot] a schema this build may not understand. Exit code $ec."
      exit "$ec"
      ;;
  esac
fi

echo "[boot] starting server…"
exec node server.js
