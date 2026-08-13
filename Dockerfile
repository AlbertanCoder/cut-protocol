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

# server.js binds loopback unless told otherwise (the desktop-safety default);
# a container must listen on all interfaces to be reachable.
ENV HOST=0.0.0.0
EXPOSE 3001
# prisma is a PROD dependency, so its CLI is right there in node_modules —
# invoked directly because the image's global npm-11 upgrade leaves npx
# broken at runtime ("Class extends value undefined", measured deploy
# ea2b53f3, crash-looping every 2s while build-time npx had worked).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/postgres/schema.prisma && node server.js"]
