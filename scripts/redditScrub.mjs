#!/usr/bin/env node
// Reddit scrub — the LEGAL, Reddit-ToS-compliant way to read Reddit at scale.
//
// WHY THIS EXISTS. Anonymous scraping of reddit.com/*.json is now hard-blocked
// at Reddit's CDN (HTTP 403, 0 bytes) — and it violates Reddit's API terms
// anyway. Reddit's *sanctioned* path is OAuth: register a free "script" app,
// authenticate application-only, and read public listings through
// oauth.reddit.com under a rate limit (~100 requests/min). Verified reachable
// from this machine (the token endpoint answers 401 to bad creds, not 403).
//
// This script:
//   • authenticates application-only (client_credentials) — NO Reddit password,
//     no user login; it only reads PUBLIC posts/comments;
//   • pulls top posts (+ optional top comments) for a set of subreddits and
//     search queries relevant to Cut Protocol;
//   • self-throttles to stay under the documented rate limit, honoring the
//     X-Ratelimit-Remaining / -Reset headers Reddit returns;
//   • writes raw JSON per source + a readable markdown digest under
//     docs/research/forums-2026-07-24/reddit-raw/.
//
// SETUP (2 minutes, free, you never share a password with anyone):
//   1. Sign in to reddit.com in a browser, go to https://www.reddit.com/prefs/apps
//   2. "create another app…" → type = **script** → name = cut-protocol-research
//      → redirect uri = http://localhost:8080 (unused for app-only) → create.
//   3. Copy the client id (under the app name) and the "secret".
//   4. In this terminal set them as env vars, then run:
//        REDDIT_CLIENT_ID=xxxx REDDIT_CLIENT_SECRET=yyyy node scripts/redditScrub.mjs
//      (Optionally set REDDIT_USER_AGENT="windows:cut-protocol-research:v1.0 (by /u/yourname)")
//
// It writes nothing to Reddit and reads only public content.

import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const USER_AGENT = process.env.REDDIT_USER_AGENT
  || "windows:cut-protocol-research:v1.0 (research; contact via app)";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing credentials. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.");
  console.error("See the header of this file for the 2-minute app-registration steps.");
  process.exit(2);
}

const OUT = path.resolve(path.join(import.meta.dirname, "..", "docs", "research", "forums-2026-07-24", "reddit-raw"));
fs.mkdirSync(OUT, { recursive: true });

// ── what to pull ─────────────────────────────────────────────────────────────
// Subreddits: top posts of the year. Queries: subreddit-scoped searches for the
// language people use when they want features. Tune freely.
const SUBREDDITS = [
  "loseit", "cico", "1200isplenty", "fitness", "xxfitness", "leangains",
  "gainit", "mealprep", "EatCheapAndHealthy", "MacroFactor", "Cronometer",
  "keto", "vegan1200isplenty", "intermittentfasting", "Celiac", "foodallergies",
];
const QUERIES = [
  { sub: "loseit", q: "app OR MyFitnessPal OR wish OR alternative" },
  { sub: "fitness", q: "macro app OR meal plan OR MacroFactor" },
  { sub: "mealprep", q: "app OR generator OR grocery OR macro" },
  { sub: "MacroFactor", q: "missing OR wish OR meal plan OR feature request" },
  { sub: "Celiac", q: "app OR meal plan OR filter" },
];
const POSTS_PER_SOURCE = 100;      // Reddit max per listing page
const COMMENTS_FOR_TOP = 8;        // pull top comments for the N highest posts per source
const MIN_INTERVAL_MS = 700;       // ~85 req/min, comfortably under the 100/min cap

// ── OAuth (application-only) ──────────────────────────────────────────────────
async function getToken() {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status} ${await res.text()}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("no access_token in token response");
  return j.access_token;
}

// ── throttled GET against oauth.reddit.com ───────────────────────────────────
let lastCall = 0;
async function api(token, urlPath) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch("https://oauth.reddit.com" + urlPath, {
    headers: { "Authorization": `Bearer ${token}`, "User-Agent": USER_AGENT },
  });
  // If the API tells us we're near the limit, back off proactively.
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(remaining) && remaining < 3 && Number.isFinite(reset)) {
    await new Promise((r) => setTimeout(r, (reset + 1) * 1000));
  }
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000)); return api(token, urlPath); }
  if (!res.ok) throw new Error(`GET ${urlPath} -> HTTP ${res.status}`);
  return res.json();
}

const postRow = (c) => ({
  id: c.data.id, title: c.data.title, score: c.data.score,
  num_comments: c.data.num_comments, created_utc: c.data.created_utc,
  permalink: "https://www.reddit.com" + c.data.permalink,
  selftext: (c.data.selftext || "").slice(0, 4000),
  flair: c.data.link_flair_text || null,
});

async function topComments(token, sub, id) {
  try {
    const j = await api(token, `/r/${sub}/comments/${id}?limit=${COMMENTS_FOR_TOP}&sort=top&depth=1`);
    const listing = Array.isArray(j) ? j[1] : null;
    return (listing?.data?.children || [])
      .filter((c) => c.kind === "t1")
      .slice(0, COMMENTS_FOR_TOP)
      .map((c) => ({ score: c.data.score, body: (c.data.body || "").slice(0, 1500) }));
  } catch { return []; }
}

async function main() {
  console.log(`[reddit] authenticating (application-only)…`);
  const token = await getToken();
  console.log(`[reddit] token OK. UA="${USER_AGENT}". Writing to ${OUT}`);

  const digest = ["# Reddit scrub — raw digest", "", `Pulled ${new Date().toISOString()} via the official OAuth API (application-only). Top-of-year listings; top ${COMMENTS_FOR_TOP} comments for the highest posts per source.`, ""];
  const all = [];

  const sources = [
    ...SUBREDDITS.map((s) => ({ label: `r/${s}`, sub: s, url: `/r/${s}/top?t=year&limit=${POSTS_PER_SOURCE}` })),
    ...QUERIES.map((qq) => ({ label: `r/${qq.sub} search: ${qq.q}`, sub: qq.sub, url: `/r/${qq.sub}/search?q=${encodeURIComponent(qq.q)}&restrict_sr=on&sort=top&t=all&limit=${POSTS_PER_SOURCE}` })),
  ];

  for (const src of sources) {
    try {
      const j = await api(token, src.url);
      const posts = (j.data?.children || []).filter((c) => c.kind === "t3").map(postRow);
      // enrich the top few with comments
      for (const p of posts.slice(0, COMMENTS_FOR_TOP)) {
        p.top_comments = await topComments(token, src.sub, p.id);
      }
      all.push({ source: src.label, count: posts.length, posts });
      digest.push(`## ${src.label} — ${posts.length} posts`, "");
      for (const p of posts.slice(0, 15)) {
        digest.push(`- **[${p.score}] ${p.title}** ${p.flair ? `_(${p.flair})_` : ""} — ${p.permalink}`);
        if (p.selftext) digest.push(`  > ${p.selftext.replace(/\s+/g, " ").slice(0, 300)}`);
      }
      digest.push("");
      console.log(`[reddit] ${src.label}: ${posts.length} posts`);
    } catch (e) {
      digest.push(`## ${src.label} — ERROR: ${e.message}`, "");
      console.error(`[reddit] ${src.label}: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(OUT, "reddit-raw.json"), JSON.stringify(all, null, 2));
  fs.writeFileSync(path.join(OUT, "reddit-digest.md"), digest.join("\n"));
  const totalPosts = all.reduce((n, s) => n + s.count, 0);
  console.log(`\n[reddit] DONE. ${all.length} sources, ${totalPosts} posts.`);
  console.log(`  raw:    ${path.join(OUT, "reddit-raw.json")}`);
  console.log(`  digest: ${path.join(OUT, "reddit-digest.md")}`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
