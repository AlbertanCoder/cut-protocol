import { ApiError, ERR, TIMEOUT } from "../../lib/api.js";

// ─────────────────────────────────────────────────────────────────────────
// Allergen taxonomy — client side of Stage 1 "Allergies 2.0".
//
// ⚠️  THE MATCHING IN THIS FILE IS UI CONVENIENCE ONLY. ⚠️
//
// `rankTaxonomy()` and `didYouMean()` exist so that typing "cel" surfaces
// "Celiac / Gluten" in a dropdown. They are typo-tolerant on purpose, which
// is exactly why they must NEVER be promoted into the enforcement path.
// What actually keeps an allergen out of a meal plan is
// backend/src/lib/dietaryFilter.js, server-side, on real ingredient rows and
// persisted allergen metadata — deliberately strict, word-boundary matching.
//
// If you are here to "improve the allergy matching": you are in the wrong
// file. A fuzzy match that decides what is SAFE to eat is a bug with a
// medical consequence. This one only decides what to show in a list.
// ─────────────────────────────────────────────────────────────────────────

/** Trimmed lowercase form used for every comparison and for de-duping chips. */
export function normTerm(t) {
  return String(t ?? "").trim().toLowerCase();
}

/** Is `needle` a subsequence of `hay`? ("clac" ⊂ "celiac") */
function isSubsequence(hay, needle) {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/** Bounded Levenshtein — small lists, short strings; returns >max as max+1. */
function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Word tokens of a phrase. Multi-word labels ("Celiac / Gluten") have to be
 * matched piece by piece, or a one-letter typo in the second word scores
 * worse than an unrelated short entry — "glutin" surfacing Lupin instead of
 * Gluten, which is exactly the kind of nonsense a picker must not do.
 */
function tokens(s) {
  return normTerm(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Best (lowest) edit distance from q to any token of `phrase`, capped. */
function tokenDistance(phrase, q, max = 2) {
  let best = max + 1;
  for (const t of tokens(phrase)) {
    const d = editDistance(t, q, max);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Rank taxonomy entries for a typed query. Lower score = better.
 * Matches the LABEL and the SYNONYMS, whole and token by token; returns
 * entries only (no scores) so callers can't accidentally treat a score as a
 * confidence in safety.
 */
export function rankTaxonomy(taxonomy, query, limit = 8) {
  const q = normTerm(query);
  const list = Array.isArray(taxonomy) ? taxonomy : [];
  if (!q) return list.slice(0, limit);
  const scored = [];
  for (const e of list) {
    const label = normTerm(e.label);
    const syns = (e.synonyms || []).map(normTerm);
    const starts = (p) => p.startsWith(q) || tokens(p).some((t) => t.startsWith(q));
    let score = Infinity;
    if (label === q || syns.includes(q)) score = 0;
    else if (starts(label)) score = 1;
    else if (syns.some(starts)) score = 2;
    else if (label.includes(q)) score = 3;
    else if (syns.some((s) => s.includes(q))) score = 4;
    else if (q.length >= 4 && tokenDistance(label, q) <= 2) {
      // Typo tolerance, scaled by how far off it is — a 1-edit miss on the
      // right word must always beat a 2-edit miss on an unrelated one.
      score = 5 + tokenDistance(label, q);
    } else if (q.length >= 4 && Math.min(...syns.map((s) => tokenDistance(s, q)), 3) <= 2) {
      score = 7 + Math.min(...syns.map((s) => tokenDistance(s, q)), 3);
    } else if (q.length >= 3 && isSubsequence(label, q)) score = 10;
    // Subsequence over SYNONYMS needs a longer query: 3 letters match almost
    // any long phrase by chance ("soy" ⊂ "chinese gooseberry") and that noise
    // pushes real answers off the list.
    else if (q.length >= 4 && syns.some((s) => isSubsequence(s, q))) score = 11;
    if (score !== Infinity) scored.push({ e, score, len: label.length });
  }
  scored.sort((a, b) => a.score - b.score || a.len - b.len || a.e.label.localeCompare(b.e.label));
  return scored.slice(0, limit).map((s) => s.e);
}

/**
 * For a term the SERVER said it can only match literally: the closest
 * taxonomy entry, or null. Powers "exact text match — did you mean Dairy?".
 * A suggestion, never an automatic substitution — the user's word stands
 * exactly as typed until they choose otherwise.
 */
export function didYouMean(taxonomy, term) {
  const q = normTerm(term);
  if (!q || q.length < 3) return null;
  let best = null;
  let bestScore = Infinity;
  for (const e of Array.isArray(taxonomy) ? taxonomy : []) {
    for (const cand of [e.label, ...(e.synonyms || [])]) {
      const c = normTerm(cand);
      if (!c) continue;
      let score = Infinity;
      if (c === q) score = 0;
      else if (c.startsWith(q) || q.startsWith(c)) score = 1;
      else if (c.includes(q) || q.includes(c)) score = 2;
      else {
        // Token-wise, for the same reason as rankTaxonomy: "glutin" must
        // reach "Celiac / Gluten", not the nearest short unrelated word.
        const d = Math.min(editDistance(c, q, 2), tokenDistance(c, q));
        if (d <= 2) score = 2 + d;
      }
      if (score < bestScore) { bestScore = score; best = e; }
    }
  }
  return bestScore <= 4 ? best : null;
}

// ── transport ────────────────────────────────────────────────────────────
// A deliberately tiny fetch seam for the two read-only /api/meta endpoints
// this control needs. It reuses api.js's ERROR TAXONOMY (ApiError + ERR) so
// callers keep the one distinction the app is built on: "the server said no"
// vs "the server never answered". Relative /api path, credentials included —
// identical to lib/api.js's own request() in the current shell.
async function metaFetch(path, { signal, body, timeoutMs = TIMEOUT.READ } = {}) {
  const method = body ? "POST" : "GET";
  if (signal?.aborted) throw new ApiError("request cancelled", { kind: ERR.ABORTED, method, path });
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });
  try {
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new ApiError("no answer from the server", { kind: ERR.TIMEOUT, method, path, timeoutMs, cause });
      if (signal?.aborted) throw new ApiError("request cancelled", { kind: ERR.ABORTED, method, path, cause });
      throw new ApiError(cause?.message || "couldn't reach the server", { kind: ERR.OFFLINE, method, path, cause });
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) {
      throw new ApiError(json?.error || `request failed: ${res.status}`, { kind: ERR.HTTP, status: res.status, body: json, method, path });
    }
    return json;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

/**
 * The searchable allergen vocabulary. The endpoint answers 200 with
 * `available: false` when the taxonomy module isn't on this build, so a
 * thrown error here genuinely means the request failed — the two are never
 * collapsed. Callers degrade to the quick-chip list either way.
 */
export async function fetchAllergenTaxonomy(opts) {
  const r = await metaFetch("/meta/allergens", opts);
  return {
    available: !!r?.available,
    taxonomy: Array.isArray(r?.taxonomy) ? r.taxonomy : [],
    reason: r?.reason || null,
  };
}

/**
 * How the REAL matcher will read each saved term (category / alias / literal).
 * Comes from dietaryFilter.describeExclusionTerms() — never re-derived here,
 * because the whole point is to report what enforcement actually does.
 */
export async function fetchExclusionDescriptions(terms, opts) {
  const list = (terms || []).filter((t) => typeof t === "string" && t.trim());
  if (!list.length) return { available: true, byTerm: {} };
  const r = await metaFetch("/meta/allergens/describe", { ...opts, body: { terms: list } });
  const byTerm = {};
  for (const d of Array.isArray(r?.described) ? r.described : []) {
    if (d?.term != null) byTerm[normTerm(d.term)] = d;
  }
  return { available: !!r?.available, byTerm };
}
