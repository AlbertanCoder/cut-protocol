// Manually grant (or revoke) the "admin" role — the ONLY way an account
// becomes admin on the hosted deployment.
//
// Why this script exists (QC audit 2026-08-11 item 1): the Supabase sign-in
// path (src/lib/supabaseAuth.js) used to mirror /register's first-run rule and
// auto-grant "admin" to the first account created on an empty database. On a
// desktop install that first account is the machine's owner; on a
// freshly-seeded cloud Postgres it is whichever stranger Googles in first —
// who then owns the deployment (food-library writes via FoodsTab, recipe
// mutation, every admin-gated route). That auto-grant is removed; the hosted
// path now creates every account as "user" and admin is granted HERE, by the
// operator, on purpose.
//
// The desktop first-run rule in routes/auth.js is untouched and correct —
// this script is for the hosted database (and works on a local one too).
//
//   node scripts/grantAdmin.mjs --email you@example.com              grant (local DATABASE_URL)
//   node scripts/grantAdmin.mjs --email you@example.com --revoke     back to "user"
//   node scripts/grantAdmin.mjs --list                               show every account + role
//   node scripts/grantAdmin.mjs --url "postgresql://..." --email you@example.com   cloud twin
//
// Prints the row it wrote, so what you just did is on screen.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const BACKEND = path.resolve(import.meta.dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

// --url selects the PRODUCTION (Postgres) database via the generated postgres
// seed-client, exactly like scripts/flipPremiumCloud.mjs. Without it, the
// ordinary client from src/lib/prisma.js is used, which resolves DATABASE_URL
// (backend/.env or the environment) — the local/desktop database.
function makeClient() {
  const url = arg("url");
  if (!url) {
    return require("../src/lib/prisma.js").prisma;
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error('--url must be a postgresql:// connection string (omit --url for the local DATABASE_URL).');
    process.exit(1);
  }
  const PG_SCHEMA = path.join(BACKEND, "prisma", "postgres", "schema.prisma");
  const SEED_CLIENT = path.join(BACKEND, "prisma", "postgres", "seed-client");
  if (!fs.existsSync(path.join(SEED_CLIENT, "index.js"))) {
    console.log("[grant-admin] generating the postgres client…");
    const r = spawnSync("npx", ["prisma", "generate", `--schema=${PG_SCHEMA}`], {
      cwd: BACKEND,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  const { PrismaClient } = require(SEED_CLIENT);
  return new PrismaClient({ datasources: { db: { url } } });
}

const prisma = makeClient();

async function main() {
  if (process.argv.includes("--list")) {
    const rows = await prisma.user.findMany({
      select: { email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (!rows.length) console.log("No users yet.");
    for (const r of rows) console.log(`${r.email}: role=${r.role} created=${r.createdAt.toISOString()}`);
    return;
  }

  const email = (arg("email") || "").trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/grantAdmin.mjs [--url "postgresql://..."] --email <email> [--revoke]   (or --list)');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
  if (!user) {
    console.error(`No user with email ${email}. They must sign in once first (the row is created on first sight).`);
    process.exit(1);
  }

  const role = process.argv.includes("--revoke") ? "user" : "admin";
  if (user.role === role) {
    console.log(`${user.email} already has role=${role}. Nothing to do.`);
    return;
  }

  const row = await prisma.user.update({
    where: { id: user.id },
    data: { role },
    select: { email: true, role: true },
  });
  console.log(`Wrote: ${row.email} -> role=${row.role}`);
  console.log("They see the change on their next /api/auth/me (reload or sign out/in).");
}

main().finally(() => prisma.$disconnect());
