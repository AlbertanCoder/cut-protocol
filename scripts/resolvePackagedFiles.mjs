#!/usr/bin/env node
// Cut Protocol — resolve, WITHOUT running a build, the exact list of files that
// electron-builder's `build.files` config would put inside app.asar.
//
//   node scripts/resolvePackagedFiles.mjs              print a summary
//   node scripts/resolvePackagedFiles.mjs --list       print every matched path
//
// WHY: `build.files` is the single control that decides whether the installer
// carries the owner's JWT secret, API keys and a database full of real people.
// Reading the patterns and reasoning about them is how a `.env.qc` and a
// `dev.db.snapshot-…` shipped anyway — minimatch's ordering rules (a positive
// pattern AFTER a negative one RE-INCLUDES) are not obvious, and nobody wants
// to sit through a ten-minute `npm run dist` to find out. This runs
// electron-builder's OWN matcher against the real tree in about a second, so
// the packaging gate can assert on the actual payload instead of on the
// spelling of the patterns.
//
// app-builder-lib is a devDependency (via electron-builder) and is not present
// on a production-only install, so it is required defensively: callers get
// `{ available: false }` and must degrade rather than crash.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));

function loadMatcher() {
  try {
    return {
      fileMatcher: require(path.join(ROOT, "node_modules/app-builder-lib/out/fileMatcher.js")),
      filter: require(path.join(ROOT, "node_modules/app-builder-lib/out/util/filter.js")),
    };
  } catch {
    return null;
  }
}

/**
 * @returns {{available: boolean, files?: string[], bytes?: number, patterns?: string[], reason?: string}}
 *   `files` are repo-relative, forward-slashed, sorted.
 *
 * NOTE: this models the MAIN application walker only. Root-level production
 * dependencies (electron-updater and its tree) are copied by electron-builder's
 * separate node-module collector and are not listed here. That collector never
 * touches backend/, which is where every secret and database in this repo
 * lives, so its absence does not weaken the checks built on top of this.
 */
export function resolvePackagedFiles(patternsOverride) {
  const mod = loadMatcher();
  if (!mod) return { available: false, reason: "app-builder-lib not installed" };
  const { FileMatcher, excludedNames, excludedExts } = mod.fileMatcher;
  const { createFilter } = mod.filter;

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const userPatterns = patternsOverride || (pkg.build && pkg.build.files) || [];
  const outDir = (pkg.build && pkg.build.directories && pkg.build.directories.output) || "dist";
  const buildResourcesDir = (pkg.build && pkg.build.directories && pkg.build.directories.buildResources) || "build";

  const matcher = new FileMatcher(ROOT, "app", (s) => s, userPatterns);
  const patterns = matcher.patterns;

  // ── replicate app-builder-lib's getMainFileMatchers() preprocessing ──────
  // Kept in lockstep with node_modules/app-builder-lib/out/fileMatcher.js. If a
  // future electron-builder changes this, the tests that compare a resolved
  // set against a REAL built app.asar are what will notice.
  const customFirst = [];
  if (!matcher.isSpecifiedAsEmptyArray && (matcher.isEmpty() || matcher.containsOnlyIgnore())) customFirst.push("**/*");
  else if (!patterns.includes("package.json")) patterns.push("package.json");

  let nmIndex = -1;
  for (let i = 0; i < patterns.length; i++) {
    if (!patterns[i].startsWith("!") && (patterns[i].includes("/node_modules") || patterns[i].includes("node_modules/"))) { nmIndex = i; break; }
  }
  if (nmIndex !== -1) patterns.splice(nmIndex, 0, "!**/node_modules/**");
  else customFirst.push("!**/node_modules/**");

  customFirst.push(`!${buildResourcesDir}{,/**/*}`);
  customFirst.push(`!${outDir}{,/**/*}`);

  let insertIndex = 0;
  for (let i = patterns.length - 1; i >= 0; i--) if (patterns[i].startsWith("**/")) { insertIndex = i + 1; break; }
  patterns.splice(insertIndex, 0, ...customFirst);

  patterns.push(`!**/*.{${excludedExts},pdb}`);
  patterns.push("!**/._*");
  patterns.push("!**/electron-builder.{yaml,yml,json,json5,toml,ts}");
  patterns.push(`!**/{${excludedNames}}`);
  patterns.push("!.yarn{,/**/*}");
  patterns.push("!.editorconfig");
  patterns.push("!.yarnrc.yml");

  const parsed = [];
  matcher.computeParsedPatterns(parsed);
  const filter = createFilter(ROOT, parsed, null);

  // Same directory pruning AppFileWalker.consume() performs.
  const files = [];
  let bytes = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (filter(p, st)) walk(p); continue; }
      if (!filter(p, st)) continue;
      files.push(path.relative(ROOT, p).replace(/\\/g, "/"));
      bytes += st.size;
    }
  };
  walk(ROOT);
  files.sort();
  return { available: true, files, bytes, patterns };
}

function main() {
  const res = resolvePackagedFiles();
  if (!res.available) {
    console.error(`resolvePackagedFiles: ${res.reason} — cannot resolve the payload.`);
    process.exit(2);
  }
  if (process.argv.includes("--list")) for (const f of res.files) console.log(f);
  console.log(`resolvePackagedFiles: ${res.files.length} file(s), ${(res.bytes / 1048576).toFixed(1)} MB would go into app.asar.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
