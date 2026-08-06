// saas-launch Stage 4 — derive the Postgres schema from the canonical SQLite
// one. schema.prisma stays the desktop/dev truth; prisma/postgres/schema.prisma
// is a GENERATED copy with two differences: provider = "postgresql", and a
// client generator that outputs to ./seed-client (so generating it never
// clobbers the default sqlite client in node_modules).
//
//   node scripts/buildPostgresSchema.mjs              regenerate the postgres copy
//   node scripts/buildPostgresSchema.mjs --patch-main Docker-image only: flip the
//                                                     MAIN schema's provider in
//                                                     place so `prisma generate`
//                                                     emits a postgres client at
//                                                     the default location.
//
// tests/postgresSchemaSync.test.js asserts the committed copy matches this
// transform, so a datamodel change that forgets to regenerate fails CI —
// remember to also regenerate the init migration when the datamodel changes:
//   npx prisma migrate diff --from-empty \
//     --to-schema-datamodel prisma/postgres/schema.prisma --script

import fs from "node:fs";
import path from "node:path";

const BACKEND = path.resolve(import.meta.dirname, "..");
const MAIN = path.join(BACKEND, "prisma", "schema.prisma");
const OUT_DIR = path.join(BACKEND, "prisma", "postgres");
const OUT = path.join(OUT_DIR, "schema.prisma");

const HEADER = `// GENERATED FILE — do not edit by hand.
// Derived from ../schema.prisma by scripts/buildPostgresSchema.mjs.
// Regenerate (plus the init migration — see that script's header) whenever
// the datamodel changes; tests/postgresSchemaSync.test.js enforces sync.

`;

// Scoped to the datasource BLOCK: schema.prisma's comments also contain the
// literal `provider = "sqlite"` (they discuss migration_lock.toml), and a
// bare replace hits the first comment instead of the config — silently
// producing a "postgres" schema that still renders SQLite DDL.
const DATASOURCE_PROVIDER = /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"sqlite"/;

export function toPostgresSchema(mainSource) {
  if (!DATASOURCE_PROVIDER.test(mainSource)) {
    throw new Error('did not find provider = "sqlite" inside the datasource db block');
  }
  let out = mainSource.replace(DATASOURCE_PROVIDER, '$1"postgresql"');
  // Point the client generator at a local output so generating this schema
  // never overwrites the default (sqlite) client during local seeding.
  out = out.replace(
    /generator\s+client\s*\{[^}]*\}/,
    'generator client {\n  provider = "prisma-client-js"\n  output   = "./seed-client"\n}'
  );
  return HEADER + out;
}

const main = () => {
  const src = fs.readFileSync(MAIN, "utf8");
  if (process.argv.includes("--patch-main")) {
    // Image-local, never committed: the Docker build flips the main schema so
    // the app's default-location client speaks postgres.
    if (!DATASOURCE_PROVIDER.test(src)) throw new Error("datasource provider not found in main schema");
    fs.writeFileSync(MAIN, src.replace(DATASOURCE_PROVIDER, '$1"postgresql"'));
    console.log("[postgres-schema] main schema provider flipped to postgresql (image-local)");
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, toPostgresSchema(src));
  console.log(`[postgres-schema] wrote ${path.relative(BACKEND, OUT)}`);
};

// Runs as a script; importable for the sync test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
