// Minimal, dependency-free HTML → tree parser used only by recipeImporter.js.
// No npm install is available in this worktree (shared node_modules junction),
// so this is a small tolerant tokenizer rather than a full HTML5 parser —
// good enough to walk real recipe-page markup for microdata / RDFa / plain
// heuristic scanning. It is NOT a spec-complete parser (no implied-tag
// insertion, no foreign-content handling); it degrades gracefully on
// malformed markup by treating stray closing tags as no-ops.

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Elements whose content is opaque text, not nested markup.
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", deg: "°",
  frac12: "½", frac14: "¼", frac34: "¾", middot: "·",
  eacute: "é", agrave: "à",
};

function decodeEntities(s) {
  if (!s || s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent) => {
    if (ent[0] === "#") {
      const isHex = ent[1] === "x" || ent[1] === "X";
      const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent] ?? whole;
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (name === "/") continue;
    const raw = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[2] !== undefined ? m[2] : "";
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

/** html string -> tree of { tag, attrs, children, parent } / { text } nodes. */
const MAX_TREE_DEPTH = 500; // guards recursive tree walks against stack overflow

function parseHtmlTree(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  const stack = [root];
  let current = root;
  const n = html.length;
  let i = 0;

  while (i < n) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i] === "<") {
      if (html[i + 1] === "!") {
        const end = html.indexOf(">", i);
        i = end === -1 ? n : end + 1;
        continue;
      }
      if (html[i + 1] === "/") {
        const end = html.indexOf(">", i);
        if (end === -1) { i = n; continue; }
        const closeName = html.slice(i + 2, end).trim().toLowerCase();
        for (let s = stack.length - 1; s >= 1; s--) {
          if (stack[s].tag === closeName) { stack.length = s; break; }
        }
        current = stack[stack.length - 1];
        i = end + 1;
        continue;
      }
      // opening tag — scan to the matching '>' respecting quoted attr values
      let j = i + 1;
      let inQuote = null;
      while (j < n) {
        const c = html[j];
        if (inQuote) { if (c === inQuote) inQuote = null; }
        else if (c === '"' || c === "'") inQuote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) { i = n; continue; }
      const tagSrc = html.slice(i + 1, j);
      const nameMatch = tagSrc.match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
      if (!nameMatch) { i = j + 1; continue; }
      const tagName = nameMatch[1].toLowerCase();
      const selfClosing = /\/\s*$/.test(tagSrc);
      const attrs = parseAttrs(tagSrc.slice(nameMatch[0].length));
      const node = { tag: tagName, attrs, children: [], parent: current };
      current.children.push(node);

      if (RAW_TEXT_ELEMENTS.has(tagName)) {
        const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
        const rest = html.slice(j + 1);
        const cm = closeRe.exec(rest);
        node.children.push({ text: cm ? rest.slice(0, cm.index) : rest });
        i = cm ? j + 1 + cm.index + cm[0].length : n;
        continue;
      }
      // Depth cap (QC v2): a pathologically nested page ("<div>"×20000) used to
      // build a tree so deep that any recursive walk of it overflowed the stack.
      // Beyond MAX_DEPTH we stop descending — deeper tags still parse, they just
      // attach at the cap level. Real recipe pages nest well under this.
      if (!VOID_ELEMENTS.has(tagName) && !selfClosing && stack.length < MAX_TREE_DEPTH) {
        stack.push(node);
        current = node;
      }
      i = j + 1;
      continue;
    }
    const next = html.indexOf("<", i);
    const stop = next === -1 ? n : next;
    if (stop > i) current.children.push({ text: html.slice(i, stop) });
    i = stop;
  }
  return root;
}

function textContent(node) {
  if (!node) return "";
  if (node.text != null) return decodeEntities(node.text);
  if (!node.children) return "";
  let out = "";
  for (const c of node.children) out += textContent(c);
  return out;
}

const cleanText = (node) => textContent(node).replace(/\s+/g, " ").trim();

function queryAll(node, pred, acc = []) {
  if (!node) return acc;
  if (node.tag && node.tag !== "#root" && pred(node)) acc.push(node);
  if (node.children) for (const c of node.children) queryAll(c, pred, acc);
  return acc;
}
const queryOne = (node, pred) => queryAll(node, pred)[0] || null;

const hasClassOrId = (node, re) => re.test(node.attrs.class || "") || re.test(node.attrs.id || "");

module.exports = { parseHtmlTree, textContent, cleanText, queryAll, queryOne, hasClassOrId, decodeEntities };
