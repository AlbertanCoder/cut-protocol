#!/usr/bin/env node
/**
 * no-hardcoded-colours.js — colour literals belong in the theme, nowhere else.
 *
 * Scans the frontend source tree for colour literals — hex, `rgb(`, `rgba(`,
 * `hsl(`, `oklch(`, `Color(0x` — and exits 1 if it finds any outside the theme
 * files. Adapted to the stack detected in Phase 0: this is a React + Vite +
 * Tailwind 4 app whose theme lives in TWO files rather than a directory, so
 * those two are the exclusion (see THEME_FILES).
 *
 * Comments are stripped before scanning. Several files carry a literal inside a
 * comment specifically to record what a value USED to be before it was
 * tokenised; flagging those would punish the documentation of the fix.
 *
 * Usage:
 *   node scripts/no-hardcoded-colours.js                 # whole source tree
 *   node scripts/no-hardcoded-colours.js <file> [file…]  # scoped to one screen
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "frontend", "src");

// The sanctioned homes for colour literals. index.css is the token layer;
// lib/theme.js carries the documented non-DOM fallback mirror of it.
const THEME_FILES = new Set([
  path.join(SRC, "index.css"),
  path.join(SRC, "lib", "theme.js"),
]);

/**
 * Literals that are NOT theme colours and must not be tokenised.
 * Each entry needs a reason; this list is not a place to park violations.
 */
const ALLOWLIST = [
  {
    file: path.join(SRC, "components", "LoginScreen.jsx"),
    values: ["#EA4335", "#4285F4", "#FBBC05", "#34A853"],
    reason: "Google's own brand mark inside the sign-in SVG — a third-party logo, not app chrome. Recolouring it would misrepresent the brand.",
  },
];

const EXTS = new Set([".js", ".jsx", ".css"]);

const PATTERNS = [
  { name: "hex", re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb()", re: /\brgba?\s*\(/g },
  { name: "hsl()", re: /\bhsla?\s*\(/g },
  { name: "oklch()", re: /\boklch\s*\(/g },
  { name: "Color(0x…)", re: /\bColor\s*\(\s*0x[0-9a-fA-F]+/g },
];

/** Remove // line comments, /* block *\/ comments and JSX {/* … *\/} blocks. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function allowedIn(file, value) {
  for (const entry of ALLOWLIST) {
    if (entry.file === file && entry.values.includes(value)) return true;
  }
  return false;
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((a) => path.resolve(REPO, a))
  : walk(SRC);

const findings = [];

for (const file of files) {
  if (THEME_FILES.has(file)) continue;
  if (!fs.existsSync(file)) {
    console.error(`no-hardcoded-colours: not found — ${file}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(file, "utf8");
  const code = stripComments(raw);
  const lines = code.split(/\r?\n/);

  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const value = m[0];
        const before = line.slice(0, m.index);

        // `var(--scrim, rgba(0,0,0,0.55))` is a token WITH a fallback — the
        // token is the source of truth and the fallback is the degradation
        // path, which is the pattern we want, not a violation of it.
        if (/var\(\s*--[\w-]+\s*,\s*$/.test(before)) continue;

        // A hex inside an attribute-selector equality — `[stroke='#ccc']`,
        // `[fill="#fff"]` — is a MATCH TARGET, not a paint value. shadcn's
        // chart wrapper uses these to find the elements Recharts drew with its
        // own hardcoded defaults and restyle them TO a token
        // (`[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50`).
        // Flagging them would demand editing a third-party library's output
        // rather than the app's own colour, and the colour actually applied is
        // already a token. Narrow on purpose: an unclosed `[`, then `='`.
        if (/\[[^\]]*=\s*['"]$/.test(before)) continue;

        if (allowedIn(file, value)) continue;
        findings.push({
          file: path.relative(REPO, file).replace(/\\/g, "/"),
          line: i + 1,
          kind: name,
          value,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

if (findings.length) {
  console.error("HARDCODED COLOURS FOUND\n");
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}  ${f.kind}  ${f.value}`);
    console.error(`      ${f.text}`);
  }
  console.error(
    `\n  ${findings.length} literal(s) outside the theme files.` +
    `\n  Every colour comes from a semantic token in frontend/src/index.css.` +
    `\n  If you need a tint of an existing token, add a token — do not inline it.`
  );
  process.exit(1);
}

console.log("NO HARDCODED COLOURS");
console.log(`  scanned ${files.length} file(s); theme files excluded: index.css, lib/theme.js`);
if (ALLOWLIST.length) {
  const n = ALLOWLIST.reduce((t, e) => t + e.values.length, 0);
  console.log(`  ${n} allowlisted third-party brand literal(s) — see ALLOWLIST in this script`);
}
process.exit(0);
