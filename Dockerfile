FROM node:22-slim AS frontend-build
# Both lockfiles are written by npm 11 on the dev machine. The image ships
# npm 10.9, whose `npm ci` reads bundled optional deps differently and dies
# with "Missing: @emnapi/runtime from lock file" (measured, deploys ec275bad
# and 87de8117). Same major npm on both sides ends the argument.
RUN npm install -g npm@11 --no-audit --no-fund
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Vite bakes import.meta.env values into the bundle AT BUILD TIME — without
# these the deployed frontend boots in desktop mode (password login, no
# Google). Railway passes service variables to Docker builds as build args
# when they are declared here. Publishable values only; secrets never enter
# the frontend build.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM node:22-slim
# Prisma's query engine picks an OpenSSL build at startup. node:22-slim
# (bookworm) ships without the openssl package, so the engine cannot detect a
# version and falls back to openssl-1.1.x — visible on every cloud boot as
# "Prisma failed to detect the libssl/openssl version to use". It is benign
# TODAY only because this image happens to satisfy the fallback; a base bump
# or a stage split turns it into a hard engine-load failure. Installing it is
# Prisma's own documented instruction, and it makes engine detection resolve
# debian-openssl-3.0.x properly. ca-certificates rides along so outbound TLS
# (Supabase, USDA, Anthropic) validates rather than trusting an empty store.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Same npm-11 alignment as the frontend stage — the backend lock has the
# same author.
RUN npm install -g npm@11 --no-audit --no-fund
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
# The cloud runs Postgres. Flip the image-local schema provider, then generate
# the client at the default location the app requires from. The committed
# migrations for this provider live in prisma/postgres/migrations (the SQLite
# history under prisma/migrations carries PRAGMA statements Postgres rejects).
RUN node scripts/buildPostgresSchema.mjs --patch-main && npx prisma generate
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Boot logic lives in a real script, not a CMD one-liner — it has to tell three
# different migrate failures apart. See the file's own header for each.
# `sed -i` strips CR in case the file ever reaches the build context with
# Windows line endings, which would make /bin/sh fail with a bare "\r: not
# found" that reads like the script is missing. .gitattributes pins LF too;
# this is the belt to that suspenders.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# server.js binds loopback unless told otherwise (the desktop-safety default);
# a container must listen on all interfaces to be reachable.
ENV HOST=0.0.0.0
# ── keep the error channel meaning "error" (2026-08-14) ────────────────────
# The Prisma CLI's version-upgrade banner ("Update available 6.19.3 -> 7.9.1")
# is printed with console.error — verified in the installed CLI, prisma 6.19.3,
# node_modules/prisma/build/index.js: the function that renders it ends
# `console.error(p)`, and its first statement is
# `let r = process.env.PRISMA_HIDE_UPDATE_MESSAGE; if (... || r || ...) return;`.
# console.error writes to stderr, and the cloud log collector types every stderr
# line as level=error. So a routine "a newer version exists" notice arrives in
# production logs wearing the same badge as a failed migration.
#
# That is the actual harm, and it is not cosmetic: the owner reads these logs to
# diagnose a live incident, and a boot that reliably prints ERROR lines for
# non-errors teaches everyone to scroll past ERROR. The next real one is then
# already invisible. A release announcement is not an operational event and must
# not ride the channel reserved for ones that are.
#
# PRISMA_HIDE_UPDATE_MESSAGE is Prisma's own documented switch and it gates
# EXACTLY that banner — the early return above is the whole of its effect.
# Deliberately NOT used, and never to be added here: PRISMA_DISABLE_WARNINGS,
# which silences real `prisma:warn` diagnostics (engine/OpenSSL detection,
# datasource problems); and any `2>/dev/null` on the migrate call, which would
# throw away the failure text docker-entrypoint.sh matches on to tell a
# saturated pool apart from a broken migration. Suppress the banner, nothing
# else. Set here rather than in code so no runtime path can be reached without
# it, and placed after `prisma generate` so build-log output is unaffected.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
EXPOSE 3001
# prisma is a PROD dependency, so its CLI is right there in node_modules —
# invoked directly because the image's global npm-11 upgrade leaves npx
# broken at runtime ("Class extends value undefined", measured deploy
# ea2b53f3, crash-looping every 2s while build-time npx had worked).
#
# The timeout guard (measured, deploys 08b923b3 + latest): migrate deploy
# COMPLETES its work in ~1s against the Supabase session pooler and then
# HANGS ON EXIT — the engine process never terminates over the pooled IPv4
# connection, so a bare `&&` chain never reaches `node server.js` and the
# healthcheck stares at a serverless container for its whole 5-minute
# window. timeout kills the lingering process at 120s (exit 124, treated
# as success — the migration state already lives in the DB); any REAL
# migrate failure still aborts the boot with its own exit code.
CMD ["/app/docker-entrypoint.sh"]
