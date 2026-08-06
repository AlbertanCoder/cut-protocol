// saas-launch Stage 4 — seed the shared food/recipe library into a FRESH
// cloud Postgres database (Supabase), from the depersonalized template DB.
//
//   node scripts/buildTemplateDb.mjs                                (refresh template first)
//   node scripts/seedCloudLibrary.mjs --url "postgresql://..."      (then seed)
//
// Copies exactly the three shared-library tables — Food, Recipe,
// RecipeIngredient — with their ORIGINAL ids (the target is empty, so the
// FK graph carries over verbatim). Everything personal was already deleted
// from the template by buildTemplateDb.mjs. Refuses to touch a database
// that already has foods unless --force (then inserts only missing ids).
//
// Runs on the OWNER'S machine against the remote DATABASE_URL: the template
// is gitignored (it is built from the personal dev.db), so the cloud image
// never contains it — this script is the bridge.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const BACKEND = path.resolve(import.meta.dirname, "..");
const TEMPLATE = path.join(BACKEND, "prisma", "dev.db.template");
const PG_SCHEMA = path.join(BACKEND, "prisma", "postgres", "schema.prisma");
const SEED_CLIENT = path.join(BACKEND, "prisma", "postgres", "seed-client");
const TABLES = ["Food", "Recipe", "RecipeIngredient"]; // parents before children
const BATCH = 500;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const url = arg("url") || "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('Usage: node scripts/seedCloudLibrary.mjs --url "postgresql://USER:PASS@HOST:5432/postgres" [--force]');
  console.error("Refusing to run without an explicit postgres --url (never seeds the local SQLite by accident).");
  process.exit(1);
}
if (!fs.existsSync(TEMPLATE)) {
  console.error(`No template at ${TEMPLATE} — build it first: node scripts/buildTemplateDb.mjs`);
  process.exit(1);
}

// The seed client is generated to its own output dir (see postgres schema),
// so making it never disturbs the default sqlite client dev uses.
if (!fs.existsSync(path.join(SEED_CLIENT, "index.js"))) {
  console.log("[seed] generating the postgres seed client…");
  const r = spawnSync("npx", ["prisma", "generate", `--schema=${PG_SCHEMA}`], {
    cwd: BACKEND,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
const { PrismaClient } = require(SEED_CLIENT);
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Scalar field types parsed straight from the postgres schema — the template
// is raw SQLite (booleans as 0/1, dates as text/epoch, json as text), and the
// postgres client wants real types. Relations don't match the scalar-type
// regex, so they fall out naturally.
function modelFieldTypes(model) {
  const src = fs.readFileSync(PG_SCHEMA, "utf8");
  const block = src.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`model ${model} not found in postgres schema`);
  const types = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(\w+)\s+(String|Int|Float|Boolean|DateTime|Json)(\??)/);
    if (m) types[m[1]] = m[2];
  }
  return types;
}

function convert(value, type) {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "Boolean":
      return !!Number(value);
    case "Int":
    case "Float":
      return Number(value);
    case "DateTime": {
      if (typeof value === "number") return new Date(value);
      // SQLite text timestamps without a zone are UTC — parse them as such,
      // never as local time.
      const s = String(value).replace(" ", "T");
      return new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
    }
    case "Json":
      return typeof value === "string" ? JSON.parse(value) : value;
    default:
      return value;
  }
}

const delegate = (model) => prisma[model[0].toLowerCase() + model.slice(1)];

async function main() {
  const template = new DatabaseSync(TEMPLATE, { readOnly: true });
  try {
    const existing = await delegate("Food").count();
    if (existing > 0 && !process.argv.includes("--force")) {
      console.error(`Target already has ${existing} foods. Re-running would mix libraries — pass --force to insert only missing rows.`);
      process.exit(1);
    }

    for (const table of TABLES) {
      const types = modelFieldTypes(table);
      const rows = template.prepare(`SELECT * FROM "${table}"`).all();
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const data = rows.slice(i, i + BATCH).map((row) => {
          const out = {};
          for (const [col, raw] of Object.entries(row)) {
            if (types[col] !== undefined) out[col] = convert(raw, types[col]);
          }
          return out;
        });
        const res = await delegate(table).createMany({ data, skipDuplicates: true });
        inserted += res.count;
      }
      console.log(`[seed] ${table}: ${inserted} inserted (${rows.length} in template)`);
    }

    const counts = {};
    for (const table of TABLES) counts[table] = await delegate(table).count();
    console.log(`[seed] done — target now has ${counts.Food} foods, ${counts.Recipe} recipes, ${counts.RecipeIngredient} ingredients`);
  } finally {
    template.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[seed] FAILED:", e.message);
  process.exitCode = 1;
});
