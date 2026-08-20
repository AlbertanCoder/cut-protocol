// imageProvenance.test.js — §6.4/§12 test_image_provenance, mapped to JS.
//
// Every image on a SHIPPED surface must have a provenance line in
// docs/IMAGE_PROVENANCE.md. Unattributed = build fails. Scope is the
// shipped surfaces only (installer allowlist + frontend/public); repo-only
// screenshots are covered by class in the document, not per file.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const DOC = path.join(ROOT, "docs", "IMAGE_PROVENANCE.md");
const IMAGE_RE = /\.(png|jpe?g|gif|svg|ico|webp|avif)$/i;

const SHIPPED_SURFACES = [
  path.join(ROOT, "frontend", "public"),
  path.join(ROOT, "assets", "icon"),
];
const SHIPPED_FILES = [path.join(ROOT, "CutProtocol.ico")];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test("every shipped image has a provenance line — unattributed images fail the build", () => {
  assert.ok(fs.existsSync(DOC), "docs/IMAGE_PROVENANCE.md must exist");
  const doc = fs.readFileSync(DOC, "utf8");
  const shipped = [
    ...SHIPPED_SURFACES.flatMap(walk),
    ...SHIPPED_FILES.filter((f) => fs.existsSync(f)),
  ].filter((f) => IMAGE_RE.test(f));
  assert.ok(shipped.length > 0, "the shipped surfaces should contain at least the brand assets");
  const missing = [];
  for (const f of shipped) {
    const base = path.basename(f);
    // The icon set is listed as a documented range (icon-16 … icon-512).
    const inRange = /^icon-\d+\.png$/.test(base) && doc.includes("icon-16.png") && doc.includes("icon-512.png");
    if (!doc.includes(base) && !inRange) missing.push(path.relative(ROOT, f));
  }
  assert.deepEqual(missing, [], `images with no provenance line: ${missing.join(", ")}`);
});

test("no recipe photo assets have appeared without the owner's TheMealDB licence decision", () => {
  // §6.4 rule 4: recipe photography is an owner decision. Until it is taken,
  // no recipe-photo directory may exist on a shipped surface.
  for (const dir of ["frontend/public/recipes", "frontend/public/photos", "assets/recipes"]) {
    assert.ok(!fs.existsSync(path.join(ROOT, dir)), `${dir} exists — that decision belongs to the owner (IMAGE_PROVENANCE.md rule 4)`);
  }
});
