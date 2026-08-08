// Recipe Brain — channel 3: the WEB. Scour the internet — politely, and only
// where the owner said so.
//
// WHAT THIS IS. The Phase 5 importer already turns ONE user-pasted URL into a
// reviewable draft (schema.org ladder → grams → resolved foods). This channel
// automates the step before it: given a RecipeSpec, build search queries, ask
// the OWNER-ENABLED sites in the curated registry, harvest candidate recipe
// links, and run each through that same importer. Everything downstream —
// ingredient resolution, the wall screens, the placeholder audit, the macro
// gate — is the orchestrator's verify path, IDENTICAL to what AI drafts face.
// The web is a source of proposals, not of trusted data.
//
// LEGAL/CONDUCT POSTURE (structural):
//   • the registry ships with every site DISABLED. data/recipeSources.json is
//     the owner's allowlist; an empty allowlist makes this channel a no-op —
//     which is also why its default presence changes no existing behaviour and
//     no test: zero-network by default, like everything else in this codebase.
//   • robots.txt is fetched and honoured PER REQUEST, fail-closed: an
//     unreachable or unparseable robots.txt skips the site, recorded honestly.
//   • the same SSRF guard as the manual importer (isBlockedHost), an
//     identified user-agent, one search fetch + a hard cap of recipe-page
//     fetches per site, and a courtesy delay between page fetches.
//   • imported rows carry source:"imported" — never presented as curated.
const path = require("node:path");
const fs = require("node:fs");

// sources/ → recipeBrain/ → lib/ → src/ → backend/ — four levels up to data/.
const REGISTRY_PATH = path.join(__dirname, "..", "..", "..", "..", "data", "recipeSources.json");

const FETCH_TIMEOUT_MS = 12000;
const MAX_TEXT_BYTES = 3_000_000;
const COURTESY_DELAY_MS = 1100; // ≥1s between page fetches to the same site
const UA = "Mozilla/5.0 (CutProtocol desktop; recipe-brain importer; +https://github.com/AlbertanCoder/cut-protocol)";

function loadRegistry(deps = {}) {
  const { registryPath = REGISTRY_PATH, readFileImpl = fs.readFileSync } = deps;
  try {
    const raw = JSON.parse(readFileImpl(registryPath, "utf8"));
    return {
      maxImportsPerSite: Number.isInteger(raw.maxImportsPerSite) && raw.maxImportsPerSite > 0 ? raw.maxImportsPerSite : 2,
      sources: Array.isArray(raw.sources) ? raw.sources : [],
    };
  } catch {
    // No registry file = no web channel. A sourcing channel must never make
    // the app unbootable.
    return { maxImportsPerSite: 2, sources: [] };
  }
}

// ── queries: what to ask a site for, from the spec alone ────────────────────
// Deterministic (no randomness — a stable query keeps behaviour reproducible
// and cacheable). Order: most-specific first. Capped at 2 per site sweep.
function buildQueries(spec) {
  const q = [];
  const cuisine = spec.soft?.cuisines?.[0] || null;
  const protein = spec.soft?.protein || null;
  const diet = spec.walls?.dietaryStyle || null;
  const slot = spec.slotType === "snack" ? "snack" : "dinner";
  const lean = spec.emphasis?.fat === "lower" || (spec.fatEnergyFracMax != null && spec.fatEnergyFracMax <= 0.3) ? "lean " : "";
  const parts = [lean + "high protein"];
  if (diet) parts.push(diet);
  if (cuisine) parts.push(cuisine);
  if (protein) parts.push(protein);
  parts.push(slot);
  q.push(parts.join(" ").replace(/\s+/g, " ").trim());
  if (cuisine || protein) q.push(`${lean}high protein ${diet ? diet + " " : ""}${slot}`.replace(/\s+/g, " ").trim());
  return [...new Set(q)].slice(0, 2);
}

// ── robots.txt: minimal, honest, fail-closed ────────────────────────────────
// Parses only what we need: is `pathname` allowed for our UA (falling back to
// `*`)? Longest-match rule wins, Allow beats Disallow on equal length (the
// de-facto standard). ANY failure to fetch/parse = NOT allowed.
function parseRobots(txt) {
  const groups = [];
  let current = null;
  for (const rawLine of String(txt).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  return groups;
}

function robotsAllows(groups, uaToken, pathname) {
  const ua = uaToken.toLowerCase();
  let g = groups.find((x) => x.agents.some((a) => a !== "*" && ua.includes(a)));
  if (!g) g = groups.find((x) => x.agents.includes("*"));
  if (!g) return true; // no matching group = no restrictions declared
  let best = null;
  for (const r of g.rules) {
    if (r.path === "") continue; // empty Disallow = allow all (ignore as a rule)
    if (pathname.startsWith(r.path)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}

async function defaultFetchText(url) {
  // Same guards as the manual importer's fetch, applied to search pages and
  // robots.txt. Lazy import so requiring this module stays side-effect free.
  const { isBlockedHost } = require("../../recipeImporter.js");
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("only http(s) URLs are supported");
  if (isBlockedHost(parsed.hostname)) throw new Error("refusing to fetch an internal or private-network address");
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": UA, accept: "text/html,text/plain" },
  });
  if (!res.ok) throw new Error(`site returned ${res.status}`);
  const text = await res.text();
  return text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text;
}

// ── candidate links out of a search page ────────────────────────────────────
// Heuristic by design and safe by construction: whatever this harvests still
// has to survive the importer's extraction ladder and the full verify gate.
// Same-host only, must contain the site's linkPattern, de-duped, capped.
function extractRecipeLinks(html, site, cap) {
  const out = [];
  const seen = new Set();
  const host = new URL(site.homepage).hostname.replace(/^www\./, "");
  const re = /href\s*=\s*["']([^"'#?]+)[^"']*["']/gi;
  let m;
  while ((m = re.exec(html)) && out.length < cap * 3) {
    let href = m[1];
    try {
      const abs = new URL(href, site.homepage);
      if (abs.hostname.replace(/^www\./, "") !== host) continue;
      if (!abs.href.includes(site.linkPattern)) continue;
      // search/category/tag pages are not recipes; the pattern match plus a
      // path depth ≥ 2 filters most listing chrome without site-specific code.
      if (abs.pathname === "/" || abs.pathname.split("/").filter(Boolean).length < 1) continue;
      if (/[?&](s|q|search)=/.test(abs.search)) continue;
      const key = abs.origin + abs.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch { /* malformed href — skip */ }
  }
  return out.slice(0, cap);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * sweep({ spec }, deps?) -> { drafts, attempts, enabledSites }
 *
 * drafts: [{ draft, sourceUrl, site }] — importer-shaped drafts, UNVERIFIED.
 * The orchestrator owns verification; this function only sources proposals.
 * attempts records every site touched and every skip with its reason — the
 * channel's honesty surface.
 */
async function sweep({ spec } = {}, deps = {}) {
  const {
    registry = loadRegistry(deps),
    fetchTextImpl = defaultFetchText,
    importImpl = null, // default lazy below — importer pulls in resolver/DB
    delayImpl = sleep,
    maxTotalImports = 3,
  } = deps;

  const attempts = [];
  const drafts = [];
  const enabledSites = registry.sources.filter((s) => s.enabled === true && s.searchUrl && s.homepage && s.linkPattern);
  if (!enabledSites.length) {
    attempts.push({ outcome: "no-enabled-sites", note: "web channel is a no-op until the owner enables a site in data/recipeSources.json" });
    return { drafts, attempts, enabledSites: [] };
  }

  const doImport = importImpl || ((url) => require("../../recipeImporter.js").importRecipeFromUrl(url));
  const queries = buildQueries(spec);
  // One URL is one import, ever — two queries routinely surface the same page
  // and importing it twice would double both the fetch load and the failure
  // noise. (Caught by the channel's own test, not by review.)
  const urlSeen = new Set();

  for (const site of enabledSites) {
    if (drafts.length >= maxTotalImports) break;

    // robots.txt, fail-closed.
    let allowed = false;
    let robotsGroups = null;
    try {
      const robotsUrl = new URL("/robots.txt", site.homepage).href;
      robotsGroups = parseRobots(await fetchTextImpl(robotsUrl));
      const searchPath = new URL(site.searchUrl.replace("{query}", "test")).pathname;
      allowed = robotsAllows(robotsGroups, "cutprotocol", searchPath);
    } catch (e) {
      attempts.push({ site: site.key, outcome: "robots-unreachable-skipped", message: e && e.message ? e.message : String(e) });
      continue;
    }
    if (!allowed) { attempts.push({ site: site.key, outcome: "robots-disallows-search" }); continue; }

    for (const query of queries) {
      if (drafts.length >= maxTotalImports) break;
      let links = [];
      try {
        const html = await fetchTextImpl(site.searchUrl.replace("{query}", encodeURIComponent(query)));
        links = extractRecipeLinks(html, site, registry.maxImportsPerSite);
      } catch (e) {
        attempts.push({ site: site.key, query, outcome: "search-fetch-failed", message: e && e.message ? e.message : String(e) });
        continue;
      }
      if (!links.length) { attempts.push({ site: site.key, query, outcome: "no-candidate-links" }); continue; }

      for (const url of links) {
        if (drafts.length >= maxTotalImports) break;
        if (urlSeen.has(url)) continue;
        urlSeen.add(url);
        // Recipe pages must also be robots-allowed, not just the search page.
        try {
          if (!robotsAllows(robotsGroups, "cutprotocol", new URL(url).pathname)) {
            attempts.push({ site: site.key, url, outcome: "robots-disallows-page" });
            continue;
          }
        } catch { continue; }
        await delayImpl(COURTESY_DELAY_MS);
        try {
          const draft = await doImport(url);
          attempts.push({ site: site.key, url, outcome: "imported-draft" });
          drafts.push({ draft, sourceUrl: url, site: site.key });
        } catch (e) {
          attempts.push({ site: site.key, url, outcome: "import-failed", message: e && e.message ? e.message : String(e) });
        }
      }
    }
  }

  return { drafts, attempts, enabledSites: enabledSites.map((s) => s.key) };
}

module.exports = {
  sweep, buildQueries, extractRecipeLinks, parseRobots, robotsAllows, loadRegistry,
  REGISTRY_PATH, COURTESY_DELAY_MS, UA,
};
