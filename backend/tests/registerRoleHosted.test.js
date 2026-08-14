// ── /register must not mint an admin on a HOSTED deploy ─────────────────────
//
// Found live 2026-08-13, minutes after the first green Railway deploy, by
// probing the running product rather than reading it: the cloud database is
// seeded with the shared library only (Food/Recipe/RecipeIngredient), so its
// User table is EMPTY. `POST /api/auth/register` reads that emptiness as
// `isFirstRun` and — under the pre-fix rule — handed `role: "admin"` to
// whichever STRANGER posted first, unlocking the food-library writes that role
// gates (routes/recipes.js canMutateRecipe, FoodsTab's isAdmin).
//
// It is the same hole the QC audit (2026-08-11, item 1) closed for the Google
// path in supabaseAuth.js. That fix never covered the password path, and the
// deploy-night audit fleet did not look here either — it audited the deploy
// chain, not the product's hosted-mode behaviour.
//
// The desktop rule is CORRECT and must survive: on a single-user install the
// first account genuinely is the machine's owner, and auth.registration.test.js
// pins that behaviour. So the discriminator is HOSTED MODE
// (isSupabaseAuthEnabled — the same signal entitlement.js uses), not the user
// count. Hosted admin is granted operationally instead, via
// scripts/grantAdmin.mjs.
//
// Harness mirrors auth.registration.test.js exactly, with one deliberate
// difference: SUPABASE_URL is ARMED here, because hosted mode is the whole
// subject of the test.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");

let tmpDir, dbFile, app, srv, base, prisma, authRouter;

/** A fresh-install database: current schema, zero rows. */
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
    assert.equal(db.prepare("SELECT count(*) AS c FROM User").get().c, 0, "fresh-install DB must have zero users");
  } finally {
    db.close();
  }
}

async function call(method, p, { body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body kept in text */ }
  return { status: res.status, json, text };
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-register-role-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  // Set before requiring server.js — prisma.js resolves DATABASE_URL at module
  // load and dotenv never overwrites an existing var, so this also keeps the
  // developer's real secrets out of the test process.
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "register-role-hosted-test-only-secret"; // scan:allow — fixture, never a real secret
  process.env.SUPABASE_URL = "https://dummy-test.supabase.co"; // ARMS HOSTED MODE — the subject of this file
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";
  process.env.CUT_PROTOCOL_AUDIT = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  authRouter = require(path.join(BACKEND, "src", "routes", "auth.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.beforeEach(() => authRouter.__registerThrottle?.reset());

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("the FIRST /register on a hosted deploy with an empty users table gets role 'user', never 'admin'", async () => {
  assert.equal(await prisma.user.count(), 0, "precondition: the users table starts empty");

  const r = await call("POST", "/api/auth/register", {
    body: { email: "first-stranger@example.test", password: "a-long-enough-password-1" },
  });
  assert.ok(
    r.status === 200 || r.status === 201,
    `registration should succeed on an empty hosted DB (got ${r.status}: ${r.text.slice(0, 200)})`
  );

  const created = await prisma.user.findUnique({ where: { email: "first-stranger@example.test" } });
  assert.ok(created, "the account must exist");
  assert.equal(
    created.role,
    "user",
    "first-stranger-owns-the-deployment: the first /register on a freshly-seeded cloud DB must NOT be auto-granted admin"
  );

  // Not just this row: the registration must not have minted an admin anywhere.
  assert.equal(
    await prisma.user.count({ where: { role: "admin" } }),
    0,
    "no admin may exist after a hosted-mode registration"
  );
});
