// W3-3 · D5 verification, NUL-safe (K1: rg/Grep go silently blind on the files
// carrying NUL bytes, so this walks the tree with Node and reads bytes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ROOTS = ["backend/src", "frontend/src", "backend/scripts", "backend/tests", "electron", "scripts"];
const EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json"]);
const TERMS = ["fatInRange", "carbInRange", "kcalErrPct", "proteinShortPct", "dayTolerance", "dayInTolerance", "SCORE_WEIGHTS", "matchPct", "daysInTolerance"];

const hits = Object.fromEntries(TERMS.map((t) => [t, []]));
const nulFiles = [];
let files = 0;

function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === ".git") continue; walk(p); continue; }
    if (!EXT.has(path.extname(e.name))) continue;
    const buf = fs.readFileSync(p);
    files++;
    if (buf.includes(0)) nulFiles.push(path.relative(REPO, p).replace(/\\/g, "/"));
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (const t of TERMS) {
      if (!text.includes(t)) continue;
      lines.forEach((l, i) => { if (l.includes(t)) hits[t].push({ file: path.relative(REPO, p).replace(/\\/g, "/"), line: i + 1, text: l.trim().slice(0, 160) }); });
    }
  }
}
for (const r of ROOTS) walk(path.resolve(REPO, r));

const isSrc = (h) => h.file.startsWith("backend/src/") || h.file.startsWith("frontend/src/");
const out = {
  filesScanned: files,
  filesWithNulBytes: nulFiles,
  terms: Object.fromEntries(TERMS.map((t) => {
    const all = hits[t];
    const src = all.filter(isSrc);
    const decl = src.filter((h) => h.file === "backend/src/lib/mealSolver.js");
    return [t, {
      totalHits: all.length,
      appSourceHits: src.length,
      appSourceOutsideMealSolver: src.filter((h) => h.file !== "backend/src/lib/mealSolver.js"),
      inMealSolver: decl,
      testHits: all.filter((h) => h.file.startsWith("backend/tests/")).length,
      scriptHits: all.filter((h) => h.file.startsWith("backend/scripts/")).length,
    }];
  })),
};
fs.writeFileSync(path.resolve(REPO, "fleet/out/W3-3/d5-fieldscan.json"), JSON.stringify(out, null, 1));

console.log(`scanned ${files} files · NUL-byte files: ${nulFiles.length ? nulFiles.join(", ") : "none in scanned roots"}`);
for (const t of TERMS) {
  const v = out.terms[t];
  console.log(`\n== ${t} ==  app-source hits ${v.appSourceHits} (tests ${v.testHits}, scripts ${v.scriptHits})`);
  for (const h of v.inMealSolver) console.log(`   mealSolver.js:${h.line}  ${h.text}`);
  for (const h of v.appSourceOutsideMealSolver) console.log(`   OTHER  ${h.file}:${h.line}  ${h.text}`);
}
