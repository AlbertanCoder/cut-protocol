// saas-launch Stage 4: the deployed product runs Postgres from a GENERATED
// schema copy (prisma/postgres/schema.prisma). A datamodel change that only
// touches the canonical sqlite schema would deploy a cloud database missing
// the change — this suite makes that impossible to miss.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BACKEND = path.resolve(__dirname, "..");
const MAIN = path.join(BACKEND, "prisma", "schema.prisma");
const PG = path.join(BACKEND, "prisma", "postgres", "schema.prisma");
const PG_MIGRATIONS = path.join(BACKEND, "prisma", "postgres", "migrations");

const norm = (s) => s.replace(/\r\n/g, "\n");

test("postgres schema matches the transform of the canonical schema", async () => {
  const { toPostgresSchema } = await import(
    pathToFileURL(path.join(BACKEND, "scripts", "buildPostgresSchema.mjs")).href
  );
  const expected = norm(toPostgresSchema(fs.readFileSync(MAIN, "utf8")));
  const actual = norm(fs.readFileSync(PG, "utf8"));
  assert.equal(
    actual,
    expected,
    "prisma/postgres/schema.prisma is stale — regenerate: node scripts/buildPostgresSchema.mjs " +
      "(and refresh the init migration if the datamodel changed; see that script's header)"
  );
});

test("postgres schema's DATASOURCE really is postgresql (not just a comment)", () => {
  const src = norm(fs.readFileSync(PG, "utf8"));
  assert.match(
    src,
    /datasource\s+db\s*\{[^}]*provider\s*=\s*"postgresql"/,
    "the datasource block must carry the postgres provider — a comment mentioning sqlite once fooled a bare string replace"
  );
});

test("postgres migrations exist, are locked to postgresql, and render postgres DDL", () => {
  assert.match(
    fs.readFileSync(path.join(PG_MIGRATIONS, "migration_lock.toml"), "utf8"),
    /provider = "postgresql"/
  );
  const dirs = fs
    .readdirSync(PG_MIGRATIONS)
    .filter((n) => fs.existsSync(path.join(PG_MIGRATIONS, n, "migration.sql")));
  assert.ok(dirs.length >= 1, "no postgres migrations committed");
  const initSql = fs.readFileSync(path.join(PG_MIGRATIONS, dirs[0], "migration.sql"), "utf8");
  // The dialect tripwire: DATETIME is SQLite's spelling; Postgres renders
  // TIMESTAMP(3). Generating the sqlite dialect into this folder is exactly
  // the bug the scoped-regex fix in buildPostgresSchema.mjs closed.
  assert.match(initSql, /TIMESTAMP\(3\)/);
  assert.doesNotMatch(initSql, /\bDATETIME\b/);
  assert.doesNotMatch(initSql, /\bPRAGMA\b/);
});

test("every model in the canonical schema appears in the postgres init migration", () => {
  const models = [...fs.readFileSync(MAIN, "utf8").matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  const dirs = fs
    .readdirSync(PG_MIGRATIONS)
    .filter((n) => fs.existsSync(path.join(PG_MIGRATIONS, n, "migration.sql")))
    .sort();
  const allSql = dirs
    .map((n) => fs.readFileSync(path.join(PG_MIGRATIONS, n, "migration.sql"), "utf8"))
    .join("\n");
  for (const model of models) {
    assert.ok(
      allSql.includes(`CREATE TABLE "${model}"`),
      `model ${model} missing from the postgres migrations — regenerate the init migration`
    );
  }
});
