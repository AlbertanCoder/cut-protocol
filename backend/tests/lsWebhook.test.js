// saas-launch Stage 3: Lemon Squeezy webhook — signature verification and
// event handling, end to end through the REAL route (raw-body mount included;
// a re-serialized body would break the HMAC, so these tests prove the mount
// order in server.js too).
//
// Local reality check (Stage 3 item 5): LS cannot reach localhost, so the
// live-fire webhook test happens on the deployed URL in Stage 5. What CAN be
// proven offline is everything deterministic: the HMAC gate, every event's
// row effects, the entitlement each state derives, idempotent replay. That
// is this file.
//
// Web mode is armed (SUPABASE_URL set) so requirePremium is real; the test
// user authenticates with a password session cookie, which stays valid in
// web mode by design (the cookie path is untouched).
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");
const SECRET = "ls-webhook-test-signing-secret"; // scan:allow — fixture, never a real secret
const EMAIL = "ls-webhook@example.test";
const PASSWORD = "correct-horse-battery";
const VARIANT_MONTHLY = "111";
const VARIANT_ANNUAL = "222";
const SUB_ID = "9001";
const DAY = 864e5;

let tmpDir, dbFile, app, srv, base, prisma, cookie, userId;

function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs
    .readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  assert.ok(names.length > 0, "no migrations found — cannot build a fresh-install DB");
  const db = new DatabaseSync(file);
  try {
    for (const name of names) {
      db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
    }
  } finally {
    db.close();
  }
}

const sign = (raw, secret = SECRET) => crypto.createHmac("sha256", secret).update(raw).digest("hex");

/** POST a webhook body. sig: undefined = correctly signed; null = no header; string = as given. */
async function postHook(bodyObj, { sig } = {}) {
  const raw = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  const headers = { "content-type": "application/json" };
  const signature = sig === undefined ? sign(raw) : sig;
  if (signature !== null) headers["x-signature"] = signature;
  const res = await fetch(`${base}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body: raw });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** The premium probe: what does the gated surface actually answer right now? */
async function premiumStatus() {
  const res = await fetch(`${base}/api/plans/current`, { headers: { cookie } });
  return res.status;
}

const subRow = () => prisma.subscription.findUnique({ where: { userId } });

/** A subscription-object event (created/updated/cancelled/…). */
const subEvent = (event_name, attrs = {}) => ({
  meta: { event_name, custom_data: { user_id: userId } },
  data: {
    type: "subscriptions",
    id: SUB_ID,
    attributes: {
      status: "active",
      customer_id: 4242,
      variant_id: Number(VARIANT_MONTHLY),
      variant_name: "Monthly",
      user_email: EMAIL,
      renews_at: new Date(Date.now() + 30 * DAY).toISOString(),
      ends_at: null,
      ...attrs,
    },
  },
});

/** A subscription-invoice event (payment success/failed/recovered). */
const invoiceEvent = (event_name, attrs = {}) => ({
  meta: { event_name, custom_data: { user_id: userId } },
  data: {
    type: "subscription-invoices",
    id: "777",
    attributes: { subscription_id: Number(SUB_ID), ...attrs },
  },
});

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-lshook-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "ls-webhook-test-only-secret"; // scan:allow — fixture
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";
  process.env.CUT_PROTOCOL_AUDIT = "off";
  process.env.SUPABASE_URL = "https://dummy-test.supabase.co"; // arm web mode: paywall is real
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = SECRET;
  process.env.LEMONSQUEEZY_VARIANT_MONTHLY = VARIANT_MONTHLY;
  process.env.LEMONSQUEEZY_VARIANT_ANNUAL = VARIANT_ANNUAL;
  // LEMONSQUEEZY_API_KEY / STORE_ID deliberately unset — the checkout 503 test.

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  const { hashPassword } = require(path.join(BACKEND, "src", "lib", "auth.js"));

  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword(PASSWORD), role: "user" },
    select: { id: true },
  });
  userId = user.id;

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(login.status, 200, "test user must be able to sign in");
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
});

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── the gate itself ──────────────────────────────────────────────────────────

test("no X-Signature header -> 401, nothing written", async () => {
  const r = await postHook(subEvent("subscription_created"), { sig: null });
  assert.equal(r.status, 401);
  assert.equal(await subRow(), null);
});

test("wrong signature -> 401, nothing written", async () => {
  const r = await postHook(subEvent("subscription_created"), { sig: sign("some other body") });
  assert.equal(r.status, 401);
  assert.equal(await subRow(), null);
});

test("signature from the wrong secret -> 401", async () => {
  const raw = JSON.stringify(subEvent("subscription_created"));
  const r = await postHook(raw, { sig: sign(raw, "not-the-secret") });
  assert.equal(r.status, 401);
});

test("valid signature over invalid JSON -> 400", async () => {
  const r = await postHook("{not json");
  assert.equal(r.status, 400);
});

test("valid signature, missing meta.event_name -> 400", async () => {
  const r = await postHook({ data: {} });
  assert.equal(r.status, 400);
});

// ── the lifecycle, in story order against the gated route ────────────────────

test("before any event: premium route refuses (403)", async () => {
  assert.equal(await premiumStatus(), 403);
});

test("subscription_created (active) unlocks premium and syncs the row", async () => {
  const r = await postHook(subEvent("subscription_created"));
  assert.equal(r.status, 200);
  const row = await subRow();
  assert.equal(row.status, "active");
  assert.equal(row.plan, "monthly");
  assert.equal(row.lsSubscriptionId, SUB_ID);
  assert.equal(row.lsCustomerId, "4242");
  assert.ok(row.renewsAt instanceof Date && row.renewsAt > new Date());
  assert.equal(await premiumStatus(), 200);
});

test("replaying the same event is harmless (idempotent)", async () => {
  const before = await subRow();
  await postHook(subEvent("subscription_created"));
  const after = await subRow();
  assert.equal(after.status, before.status);
  assert.equal(after.id, before.id); // same row, not a duplicate
  assert.equal(await premiumStatus(), 200);
});

test("payment_failed -> past_due with a ~7-day grace, premium KEPT", async () => {
  const r = await postHook(invoiceEvent("subscription_payment_failed"));
  assert.equal(r.status, 200);
  const row = await subRow();
  assert.equal(row.status, "past_due");
  const days = (row.graceUntil - Date.now()) / DAY;
  assert.ok(days > 6.9 && days < 7.1, `grace should be ~7 days out, got ${days.toFixed(2)}`);
  assert.equal(await premiumStatus(), 200);
});

test("a REPEAT failure does not restart the 7-day clock", async () => {
  const first = (await subRow()).graceUntil;
  await postHook(invoiceEvent("subscription_payment_failed"));
  assert.equal((await subRow()).graceUntil.getTime(), first.getTime());
});

test("payment_recovered -> active again, grace cleared", async () => {
  const r = await postHook(invoiceEvent("subscription_payment_recovered"));
  assert.equal(r.status, 200);
  const row = await subRow();
  assert.equal(row.status, "active");
  assert.equal(row.graceUntil, null);
  assert.equal(await premiumStatus(), 200);
});

test("cancelled with ends_at in the future keeps premium until then", async () => {
  const endsAt = new Date(Date.now() + 5 * DAY).toISOString();
  await postHook(subEvent("subscription_cancelled", { status: "cancelled", ends_at: endsAt }));
  const row = await subRow();
  assert.equal(row.status, "cancelled");
  assert.equal(row.endsAt.toISOString(), endsAt);
  assert.equal(await premiumStatus(), 200); // paid-for period still runs
});

test("subscription_updated moving ends_at into the past drops premium", async () => {
  await postHook(subEvent("subscription_updated", { status: "cancelled", ends_at: new Date(Date.now() - DAY).toISOString() }));
  assert.equal(await premiumStatus(), 403);
});

test("resumed brings it back", async () => {
  await postHook(subEvent("subscription_resumed", { status: "active", ends_at: null }));
  assert.equal((await subRow()).status, "active");
  assert.equal(await premiumStatus(), 200);
});

test("order_refunded revokes immediately", async () => {
  const r = await postHook({
    meta: { event_name: "order_refunded", custom_data: { user_id: userId } },
    data: { type: "orders", id: "555", attributes: { customer_id: 4242, refunded: true } },
  });
  assert.equal(r.status, 200);
  const row = await subRow();
  assert.equal(row.status, "refunded");
  assert.equal(row.renewsAt, null);
  assert.equal(row.endsAt, null);
  assert.equal(row.graceUntil, null);
  assert.equal(await premiumStatus(), 403);
});

test("annual variant maps to plan=annual", async () => {
  await postHook(subEvent("subscription_updated", { status: "active", variant_id: Number(VARIANT_ANNUAL), variant_name: "Yearly" }));
  const row = await subRow();
  assert.equal(row.plan, "annual");
  assert.equal(await premiumStatus(), 200);
});

test("unknown events are acknowledged and change nothing", async () => {
  const before = await subRow();
  const r = await postHook({ meta: { event_name: "affiliate_activated" }, data: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(await subRow(), before);
});

test("event for an unknown user is acknowledged, logged, and writes nothing", async () => {
  const rows = await prisma.subscription.count();
  const body = subEvent("subscription_created");
  body.meta.custom_data.user_id = "cuid-that-does-not-exist";
  body.data.id = "8888"; // unknown sub id too
  const r = await postHook(body);
  assert.equal(r.status, 200); // a replay cannot fix an unmappable event — ack, don't retry-loop
  assert.equal(await prisma.subscription.count(), rows);
});

// ── checkout endpoint, unconfigured ──────────────────────────────────────────

test("penny period is refused unless its hidden variant is configured", async () => {
  const call = () =>
    fetch(`${base}/api/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ period: "penny" }),
    });
  const rejected = await call();
  assert.equal(rejected.status, 400); // no LEMONSQUEEZY_VARIANT_PENNY -> invalid period
  process.env.LEMONSQUEEZY_VARIANT_PENNY = "333";
  try {
    const allowed = await call();
    // Past validation now; 503 because the API key/store are (deliberately)
    // unset in this suite — proves penny reaches the real checkout path.
    assert.equal(allowed.status, 503);
  } finally {
    delete process.env.LEMONSQUEEZY_VARIANT_PENNY;
  }
});

test("checkout without LS config -> honest 503; signed-out -> 401", async () => {
  const r = await fetch(`${base}/api/billing/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ period: "monthly" }),
  });
  assert.equal(r.status, 503);
  const anon = await fetch(`${base}/api/billing/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period: "monthly" }),
  });
  assert.equal(anon.status, 401);
});
