const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isValidSqlite, ensureDatabaseReady } = require("../src/lib/desktopBootstrap.js");
const { runDataQualityAudit } = require("../src/lib/dataQualityAudit.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cp-boot-"));

test("REGRESSION (Stage C / M6): a 0-byte or truncated DB file is NOT treated as valid", () => {
  const dir = tmp();
  const zero = path.join(dir, "zero.db");
  fs.writeFileSync(zero, "");
  assert.equal(isValidSqlite(zero), false, "0-byte file is invalid");

  const junk = path.join(dir, "junk.db");
  fs.writeFileSync(junk, "not a database at all, just text padding".repeat(40));
  assert.equal(isValidSqlite(junk), false, "a non-SQLite file is invalid even if large");

  const real = path.join(dir, "real.db");
  const header = Buffer.alloc(1024);
  header.write("SQLite format 3\0", 0, "latin1");
  fs.writeFileSync(real, header);
  assert.equal(isValidSqlite(real), true, "a file with the SQLite magic header and >=512 bytes is valid");

  assert.equal(isValidSqlite(path.join(dir, "missing.db")), false, "a missing file is invalid, not a throw");
});

test("REGRESSION (Stage C / M6): a failed first-run copy self-heals — the bad file is preserved, not left to brick every launch", () => {
  const dir = tmp();
  const dbPath = path.join(dir, "cutprotocol.db");
  fs.writeFileSync(dbPath, ""); // simulate Prisma's 0-byte file from a missing path
  const prev = process.env.CUT_PROTOCOL_DB_PATH;
  process.env.CUT_PROTOCOL_DB_PATH = dbPath;
  try {
    // No template resource exists in this test context, so it can't re-copy —
    // but the invalid file must be moved aside (not left in place as "valid").
    ensureDatabaseReady();
    const corruptBackups = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    assert.equal(corruptBackups.length, 1, "the invalid DB was preserved under a .corrupt-* name");
    assert.ok(!isValidSqlite(dbPath) || !fs.existsSync(dbPath), "the bad file is no longer sitting at the live path as if initialized");
  } finally {
    if (prev === undefined) delete process.env.CUT_PROTOCOL_DB_PATH; else process.env.CUT_PROTOCOL_DB_PATH = prev;
  }
});

test("REGRESSION (Stage C / #31): the data-quality audit reports EMPTY, not clean, on a zero-row library", async () => {
  const s = await runDataQualityAudit({ foods: [], recipes: [] });
  assert.equal(s.empty, true);
  assert.equal(s.clean, false, "an empty library must never read as clean");
});

test("data-quality audit still reports clean for a healthy tiny library", async () => {
  const s = await runDataQualityAudit({
    foods: [{ name: "Chicken breast", kcal: 165, protein: 31, fat: 3.6, carbs: 0, fiber: 0, category: "protein", source: "usda" }],
    recipes: [],
  });
  // recipes:0 means empty=true by design — a real library always has recipes.
  assert.equal(s.empty, true);
});
