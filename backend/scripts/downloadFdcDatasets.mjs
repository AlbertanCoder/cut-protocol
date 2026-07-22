#!/usr/bin/env node
// One command to fetch the USDA FoodData Central bulk archives.
//
//   node scripts/downloadFdcDatasets.mjs            # all three
//   node scripts/downloadFdcDatasets.mjs foundation # just one
//   node scripts/downloadFdcDatasets.mjs --force    # re-download existing
//
// Files land in backend/data/fdc-cache/ (gitignored — ~18 MB compressed,
// ~283 MB expanded; they are reproducible inputs, not source).
//
// NOTE ON THE HOST: the download page advertises
// https://fdc-datasets.nal.usda.gov/..., which does not resolve from every
// network. The equivalent, longer-standing path on the main host —
// https://fdc.nal.usda.gov/fdc-datasets/... — serves the identical archives
// and is what this script uses.
//
// Dataset versions are pinned in scripts/lib/fdcDataset.js so an import is
// reproducible. When USDA publishes a new Foundation/FNDDS release, bump the
// filename there; SR Legacy is final and will not change again.

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DATASETS, CACHE_DIR } = require("./lib/fdcDataset.js");

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));
const wanted = only.length ? DATASETS.filter((d) => only.includes(d.key)) : DATASETS;

if (!wanted.length) {
  console.error(`Unknown dataset. Available: ${DATASETS.map((d) => d.key).join(", ")}`);
  process.exit(2);
}

fs.mkdirSync(CACHE_DIR, { recursive: true });
const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";

let failures = 0;
for (const ds of wanted) {
  const dest = path.join(CACHE_DIR, ds.file);
  if (fs.existsSync(dest) && !force) {
    console.log(`[fdc-download] ${ds.key}: already present (${mb(fs.statSync(dest).size)}) — use --force to refetch`);
    continue;
  }
  process.stdout.write(`[fdc-download] ${ds.key}: fetching ${ds.file} ... `);
  try {
    const res = await fetch(ds.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const tmp = dest + ".part";
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    // Only replace the real file once the transfer completed, so an
    // interrupted download can never masquerade as a valid archive.
    fs.renameSync(tmp, dest);
    console.log(mb(fs.statSync(dest).size));
  } catch (e) {
    failures++;
    console.log(`FAILED — ${e.message}`);
  }
}

if (failures) {
  console.error(`\n${failures} download(s) failed. The archives can also be fetched manually from`);
  console.error("https://fdc.nal.usda.gov/download-datasets.html and dropped into backend/data/fdc-cache/.");
  process.exit(1);
}
console.log("\nNext: node scripts/buildFdcIndex.mjs && node scripts/importFdcBulk.mjs --apply");
