#!/usr/bin/env node
// Cut Protocol — pre-package cleanup of build junk that nothing ever deletes.
// Keyless, dependency-free.
//
//   node scripts/cleanBuildArtifacts.mjs          delete what it finds (predist)
//   node scripts/cleanBuildArtifacts.mjs --check  report only, exit 1 if any exist
//
// WHY: `prisma generate` on Windows writes the query engine to a temp name in
// backend/node_modules/.prisma/client/ and then renames it over the live DLL.
// When the live DLL is locked — a dev server running, an Electron instance
// open, an antivirus scan mid-file — the rename fails and the temp copy is
// abandoned. Nothing ever cleans it up, and each one is a 21 MB binary. Ten of
// them had accumulated (202 MB) and all ten were being packaged into the
// installer, because build.files matched them the same way it matched the real
// engine.
//
// The allowlist in package.json now keeps them OUT of the installer whatever
// they are named; this script keeps them off the disk as well, so the next
// `prisma generate` isn't racing a pile of stale copies.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));

// Directories that accumulate junk, and what counts as junk in each.
const TARGETS = [
  {
    dir: path.join(ROOT, "backend/node_modules/.prisma/client"),
    // query_engine-windows.dll.node.tmp22308 and friends
    match: /\.tmp[0-9]*$/i,
    what: "abandoned prisma engine temp copies",
  },
];

export function findArtifacts() {
  const found = [];
  for (const t of TARGETS) {
    let names;
    try { names = fs.readdirSync(t.dir); } catch { continue; }
    for (const name of names) {
      if (!t.match.test(name)) continue;
      const p = path.join(t.dir, name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      found.push({ path: p, size: st.size, what: t.what });
    }
  }
  return found;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const found = findArtifacts();
  if (!found.length) {
    console.log("cleanBuildArtifacts: nothing to clean.");
    process.exit(0);
  }
  const mb = (found.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1);

  if (checkOnly) {
    console.error(`cleanBuildArtifacts: ${found.length} stale artifact(s), ${mb} MB:`);
    for (const f of found) console.error(`  ${path.relative(ROOT, f.path)}  (${f.what})`);
    console.error("\nRun `node scripts/cleanBuildArtifacts.mjs` to remove them.");
    process.exit(1);
  }

  let removed = 0, failed = 0;
  for (const f of found) {
    try { fs.unlinkSync(f.path); removed++; }
    catch (e) { failed++; console.error(`  could not remove ${path.relative(ROOT, f.path)}: ${e.message}`); }
  }
  console.log(`cleanBuildArtifacts: removed ${removed} stale artifact(s), reclaimed ~${mb} MB.`);
  // A file we could not delete is almost always still locked by a running
  // process. Say so, but do not block the build — the allowlist already keeps
  // these out of the installer.
  if (failed) console.error(`cleanBuildArtifacts: ${failed} file(s) could not be removed (locked?). They will NOT be packaged.`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
