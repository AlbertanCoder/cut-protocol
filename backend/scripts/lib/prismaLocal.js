// A PrismaClient pinned to THIS worktree's database.
//
// WHY THIS EXISTS (worktree hazard — read before writing any script here):
// `node_modules` is a junction shared by all parallel worktrees, and the
// Prisma client inside it was generated in the MAIN repo. A generated client
// remembers its generation-time schema directory and loads the `.env` next to
// it, so a bare `new PrismaClient()` in a worktree silently resolves
// DATABASE_URL="file:./dev.db" against
//   <main repo>/backend/prisma/dev.db
// — NOT the worktree's own copy. Every worktree therefore reads and writes one
// shared database while appearing to use its own.
//
// This was observed, not theorised: a repair run from this worktree landed 738
// row updates in the main repo's dev.db while this worktree's dev.db kept its
// original mtime and 0 changed rows.
//
// So: resolve the path from THIS file's location and pass it explicitly.
// process.env.DATABASE_URL still wins when set, so CI and the app can override.

const path = require("node:path");
const fs = require("node:fs");

// Read the caller's DATABASE_URL BEFORE @prisma/client is required: requiring
// the client auto-loads the .env sitting next to its generation-time schema
// (the main repo's), which INJECTS DATABASE_URL="file:./dev.db" into
// process.env. Anything reading the variable afterwards cannot tell an
// operator's deliberate override from Prisma's own injected default.
const CALLER_DATABASE_URL = process.env.DATABASE_URL;

const { PrismaClient } = require("@prisma/client");

const LOCAL_DB = path.resolve(__dirname, "..", "..", "prisma", "dev.db");
const toFileUrl = (p) => "file:" + p.replace(/\\/g, "/"); // Prisma wants forward slashes

// A relative sqlite URL is resolved by Prisma against the generation-time
// schema directory, not the cwd — which is exactly the trap this module
// exists to avoid. Only an ABSOLUTE override is unambiguous, so only an
// absolute override is honoured.
const isAbsoluteFileUrl = (u) => /^file:(\/\/)?\/|^file:[A-Za-z]:/.test(u || "");

function localDatabaseUrl() {
  if (CALLER_DATABASE_URL && isAbsoluteFileUrl(CALLER_DATABASE_URL)) return CALLER_DATABASE_URL;
  return toFileUrl(LOCAL_DB);
}

function makeLocalPrisma() {
  const url = localDatabaseUrl();
  if (!process.env.DATABASE_URL && !fs.existsSync(LOCAL_DB)) {
    throw new Error(`No database at ${LOCAL_DB}. Set DATABASE_URL to point somewhere else.`);
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

module.exports = { makeLocalPrisma, localDatabaseUrl, LOCAL_DB };
