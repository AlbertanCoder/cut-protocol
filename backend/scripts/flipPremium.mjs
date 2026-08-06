// Manually set a user's subscription state — the ONLY writer of the
// Subscription table until Lemon Squeezy webhooks land in Stage 3, and the
// test harness for every entitlement state after that.
//
//   node scripts/flipPremium.mjs --email you@example.com --state premium
//   node scripts/flipPremium.mjs --list
//
// States (what they simulate):
//   premium    active subscription                          -> PREMIUM
//   trial      on_trial                                     -> PREMIUM
//   cancelled  cancelled, paid period ends in 5 days        -> PREMIUM (until then)
//   grace      payment failed 4 days ago, 3 left to retry   -> PREMIUM (until then)
//   lapsed     cancelled, paid period ended yesterday       -> FREE
//   free       no subscription (status none, dates cleared) -> FREE
//
// Prints the row it wrote AND the entitlement the backend derives from it,
// so what you just did and what the app will now do are both on screen.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/prisma.js");
const { isEntitled } = require("../src/lib/entitlement.js");

const DAY = 24 * 60 * 60 * 1000;
const days = (n) => new Date(Date.now() + n * DAY);

const STATES = {
  premium:   { status: "active",    plan: "monthly", renewsAt: days(30), endsAt: null,      graceUntil: null },
  trial:     { status: "on_trial",  plan: "monthly", renewsAt: days(7),  endsAt: null,      graceUntil: null },
  cancelled: { status: "cancelled", plan: "monthly", renewsAt: null,     endsAt: days(5),   graceUntil: null },
  grace:     { status: "past_due",  plan: "monthly", renewsAt: null,     endsAt: null,      graceUntil: days(3) },
  lapsed:    { status: "cancelled", plan: "monthly", renewsAt: null,     endsAt: days(-1),  graceUntil: null },
  free:      { status: "none",      plan: null,      renewsAt: null,     endsAt: null,      graceUntil: null },
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  if (process.argv.includes("--list")) {
    const rows = await prisma.subscription.findMany({ include: { user: { select: { email: true } } } });
    if (!rows.length) console.log("No subscription rows yet.");
    for (const r of rows) {
      console.log(`${r.user.email}: status=${r.status} plan=${r.plan} endsAt=${r.endsAt?.toISOString() || "-"} graceUntil=${r.graceUntil?.toISOString() || "-"} -> ${isEntitled(r) ? "PREMIUM" : "FREE"}`);
    }
    return;
  }

  const email = (arg("email") || "").trim().toLowerCase();
  const state = arg("state");
  if (!email || !STATES[state]) {
    console.error(`Usage: node scripts/flipPremium.mjs --email <email> --state <${Object.keys(STATES).join("|")}>   (or --list)`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) {
    console.error(`No user with email ${email}. Sign in once first (the row is created on first sight).`);
    process.exit(1);
  }

  const data = STATES[state];
  const row = await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  console.log(`Wrote: ${user.email} -> status=${row.status} plan=${row.plan ?? "-"} renewsAt=${row.renewsAt?.toISOString() || "-"} endsAt=${row.endsAt?.toISOString() || "-"} graceUntil=${row.graceUntil?.toISOString() || "-"}`);
  console.log(`Backend now derives: ${isEntitled(row) ? "PREMIUM" : "FREE"}`);
  console.log("Sign out/in or reload the app to see the flip (the tier ships on /api/auth/me).");
}

main().finally(() => prisma.$disconnect());
