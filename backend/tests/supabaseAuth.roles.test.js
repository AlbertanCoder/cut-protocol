// QC audit 2026-08-11 item 1 (docs/qc/session-findings-2026-08-10.md): the
// Supabase sign-in path used to mirror /register's first-run rule — the first
// account created on an empty database got role "admin". Right on a desktop
// install, where the first account is by construction the machine's owner.
// Fatal on a hosted deployment with a freshly-seeded cloud Postgres, where the
// first account is whichever STRANGER Googles in first — who then owns the
// deployment (food-library writes via FoodsTab, recipe mutation, every
// admin-gated route).
//
// These tests pin the fix: on the Supabase path a created account is ALWAYS
// role "user", even against a genuinely EMPTY users table — the exact state a
// fresh Railway deploy is in. Admin on that path is operational only
// (scripts/grantAdmin.mjs). The desktop first-run-admin rule is untouched and
// stays asserted where it lives, in tests/auth.registration.test.js.
//
// Same fresh-install idiom as auth.registration.test.js: a throwaway SQLite
// file built from prisma/migrations (never from dev.db — that holds real
// personal data and does not exist on CI), zero rows. Tokens are REAL HS256
// JWTs verified by the real verifySupabaseToken via SUPABASE_JWT_SECRET —
// nothing in the verify path is stubbed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");
const SUPABASE_URL = "https://dummy-test.supabase.co"; // arm web mode, as in lsWebhook.test.js
const SUPABASE_JWT_SECRET = "supabase-roles-test-only-secret"; // scan:allow — fixture, never a real secret

let tmpDir, dbFile, prisma, resolveSupabaseSession;

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

/** A real Supabase-shaped access token, signed with the shared test secret. */
function mintToken({ sub, email }) {
  return jwt.sign({ sub, email }, SUPABASE_JWT_SECRET, {
    algorithm: "HS256",
    issuer: `${SUPABASE_URL}/auth/v1`,
    audience: "authenticated",
    expiresIn: "1h",
  });
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-supa-roles-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  // Set before requiring anything that touches prisma.js: the client resolves
  // DATABASE_URL at module load, and dotenv never overwrites an existing var —
  // so this also keeps the developer's real secrets out of the test process.
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "supabase-roles-test-only-jwt"; // scan:allow — fixture
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET; // scan:allow — fixture; a throwaway HS256 key minted for this test process only
  process.env.BRAIN = "off";

  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  ({ resolveSupabaseSession } = require(path.join(BACKEND, "src", "lib", "supabaseAuth.js")));
});

test.after(async () => {
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── the finding itself ───────────────────────────────────────────────────────

test("the FIRST Supabase sign-in on an empty users table gets role 'user', never 'admin'", async () => {
  assert.equal(await prisma.user.count(), 0, "precondition: the users table starts empty");

  const session = await resolveSupabaseSession(
    mintToken({ sub: "supa-first-stranger", email: "first-stranger@example.test" })
  );
  assert.ok(session?.userId, "a verified token for a new identity must create an account");

  const created = await prisma.user.findUnique({ where: { id: session.userId } });
  assert.equal(created.email, "first-stranger@example.test");
  assert.equal(created.supabaseUserId, "supa-first-stranger");
  assert.equal(
    created.role,
    "user",
    "first-stranger-owns-the-deployment: the first Google sign-in on a freshly-seeded cloud DB must NOT be auto-granted admin"
  );

  // Not just this row: the sign-in must not have minted an admin anywhere.
  assert.equal(await prisma.user.count({ where: { role: "admin" } }), 0, "no admin may exist after a Supabase-path creation");
});

test("later Supabase sign-ins are plain 'user' too, and repeat sign-in does not touch the role", async () => {
  const session = await resolveSupabaseSession(
    mintToken({ sub: "supa-second", email: "second@example.test" })
  );
  const created = await prisma.user.findUnique({ where: { id: session.userId } });
  assert.equal(created.role, "user");

  // Same identity again — resolves to the same row by supabaseUserId, role untouched.
  const again = await resolveSupabaseSession(mintToken({ sub: "supa-second", email: "second@example.test" }));
  assert.equal(again.userId, session.userId);
  assert.equal((await prisma.user.findUnique({ where: { id: session.userId } })).role, "user");
});

// ── the linking path is out of the fix's blast radius ────────────────────────

test("email-linking an EXISTING admin account preserves its role (link sets supabaseUserId, nothing else)", async () => {
  // A pre-existing local owner (e.g. desktop-era account carried into the cloud
  // DB by the operator) who signs in with Google for the first time: matched by
  // email, linked, and the role they already legitimately hold survives.
  const owner = await prisma.user.create({
    data: { email: "owner@example.test", role: "admin" },
    select: { id: true },
  });

  const session = await resolveSupabaseSession(
    mintToken({ sub: "supa-owner", email: "Owner@Example.TEST" }) // case-insensitive link
  );
  assert.equal(session.userId, owner.id, "must link to the existing row, not create a new one");

  const linked = await prisma.user.findUnique({ where: { id: owner.id } });
  assert.equal(linked.supabaseUserId, "supa-owner");
  assert.equal(linked.role, "admin", "linking must never demote (or promote) — it only sets supabaseUserId");
});
