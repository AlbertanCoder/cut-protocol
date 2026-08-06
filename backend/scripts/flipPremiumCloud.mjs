// Stage 5 instrument — the cloud twin of flipPremium.mjs, for the PRODUCTION
// (Supabase Postgres) database. Same six states, plus the two time-surgery
// flags Stage 5's scenarios need: after a REAL test-card purchase has created
// the row, artificially shrink the grace window or the paid-until date so
// "what happens when time runs out" is testable tonight instead of next week.
//
//   node scripts/flipPremiumCloud.mjs --url "postgresql://..." --list
//   node scripts/flipPremiumCloud.mjs --url "..." --email you@x.com --state grace
//   node scripts/flipPremiumCloud.mjs --url "..." --email you@x.com --expire-grace
//   node scripts/flipPremiumCloud.mjs --url "..." --email you@x.com --expire-period
//
// --expire-grace  : keeps status past_due, moves graceUntil 1 minute into the
//                   past (the "grace ran out" downgrade, without waiting 7 days)
// --expire-period : keeps status cancelled, moves endsAt 1 minute into the past
//                   (the "paid period over" downgrade, without waiting a month)
//
// NEVER touches status vocabulary beyond what the webhook writes — it edits
// dates, so the entitlement logic being tested is the real one.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const BACKEND = path.resolve(import.meta.dirname, "..");
const PG_SCHEMA = path.join(BACKEND, "prisma", "postgres", "schema.prisma");
const SEED_CLIENT = path.join(BACKEND, "prisma", "postgres", "seed-client");
const { isEntitled } = require(path.join(BACKEND, "src", "lib", "entitlement.js"));

const DAY = 864e5;
const days = (n) => new Date(Date.now() + n * DAY);

// Kept in lockstep with scripts/flipPremium.mjs (the sqlite twin).
const STATES = {
  premium:   { status: "active",    plan: "monthly", renewsAt: days(30), endsAt: null,     graceUntil: null },
  trial:     { status: "on_trial",  plan: "monthly", renewsAt: days(7),  endsAt: null,     graceUntil: null },
  cancelled: { status: "cancelled", plan: "monthly", renewsAt: null,     endsAt: days(5),  graceUntil: null },
  grace:     { status: "past_due",  plan: "monthly", renewsAt: null,     endsAt: null,     graceUntil: days(3) },
  lapsed:    { status: "cancelled", plan: "monthly", renewsAt: null,     endsAt: days(-1), graceUntil: null },
  free:      { status: "none",      plan: null,      renewsAt: null,     endsAt: null,     graceUntil: null },
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const url = arg("url") || "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('Usage: node scripts/flipPremiumCloud.mjs --url "postgresql://..." (--list | --email <e> [--state <s> | --expire-grace | --expire-period])');
  process.exit(1);
}

if (!fs.existsSync(path.join(SEED_CLIENT, "index.js"))) {
  console.log("[flip-cloud] generating the postgres client…");
  const r = spawnSync("npx", ["prisma", "generate", `--schema=${PG_SCHEMA}`], {
    cwd: BACKEND,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
const { PrismaClient } = require(SEED_CLIENT);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const show = (email, r) =>
  console.log(
    `${email}: status=${r.status} plan=${r.plan ?? "-"} renewsAt=${r.renewsAt?.toISOString() || "-"} endsAt=${r.endsAt?.toISOString() || "-"} graceUntil=${r.graceUntil?.toISOString() || "-"} -> ${isEntitled(r) ? "PREMIUM" : "FREE"}`
  );

async function main() {
  if (process.argv.includes("--list")) {
    const rows = await prisma.subscription.findMany({ include: { user: { select: { email: true } } } });
    if (!rows.length) console.log("No subscription rows yet.");
    for (const r of rows) show(r.user.email, r);
    return;
  }

  const email = (arg("email") || "").trim().toLowerCase();
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
    : null;
  if (!user) {
    console.error(`No user with email "${email}". They must sign in once first.`);
    process.exit(1);
  }

  if (process.argv.includes("--expire-grace") || process.argv.includes("--expire-period")) {
    const field = process.argv.includes("--expire-grace") ? "graceUntil" : "endsAt";
    const row = await prisma.subscription.findUnique({ where: { userId: user.id } });
    if (!row) {
      console.error("No subscription row to expire — run the purchase/cancel scenario first.");
      process.exit(1);
    }
    const updated = await prisma.subscription.update({
      where: { userId: user.id },
      data: { [field]: new Date(Date.now() - 60_000) },
    });
    console.log(`[flip-cloud] ${field} moved 1 minute into the past:`);
    show(user.email, updated);
    return;
  }

  const state = arg("state");
  if (!STATES[state]) {
    console.error(`--state must be one of: ${Object.keys(STATES).join(", ")}`);
    process.exit(1);
  }
  const data = STATES[state];
  const row = await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  console.log("[flip-cloud] wrote:");
  show(user.email, row);
}

main()
  .catch((e) => {
    console.error("[flip-cloud] FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
