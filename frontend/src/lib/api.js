import { logApi, logEvent } from "./bugLog.js";

// ─────────────────────────────────────────────────────────────────────────
// The single HTTP seam. Everything the app knows about talking to its own
// backend lives here: timeouts, aborts, the error taxonomy, and the ONE
// place a 401 is turned into "you are signed out".
//
// Base URL: same-origin in production (Express serves the built frontend);
// in dev, Vite's server.proxy forwards /api/* to the backend (see
// vite.config.js) — so a relative /api path is correct either way and no
// CORS is involved. That holds even now that the Electron shell binds the
// backend to a FREE loopback port: the renderer is served FROM that origin,
// so relative paths follow it automatically, and the per-launch nonce is
// deliberately never exposed to the renderer (see electron/preload.cjs —
// backend identity is proven in the main process before any page loads).
// apiUrl()/handshakeHeaders() below stay inert unless the bridge one day
// publishes an explicit origin/nonce; see docs/qc/handoff/agent07.md.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE (fleet finding resilience-errors-5)
// "The server said no" and "the server didn't answer" are DIFFERENT
// failures and must never be collapsed into each other. Only a real HTTP
// 401 means the session is gone. A 500, a timeout, a refused connection,
// or an aborted request must never sign the user out, and must never be
// reported to the user as if the app knew what the server did.
// ─────────────────────────────────────────────────────────────────────────

/** Error kinds. `http` = the server answered; everything else = it didn't. */
export const ERR = {
  HTTP: "http",         // server answered with a non-2xx status
  TIMEOUT: "timeout",   // we gave up waiting — outcome UNKNOWN
  OFFLINE: "offline",   // connection failed/refused — request likely never landed
  ABORTED: "aborted",   // we cancelled it (unmount, superseded) — not a failure
};

export class ApiError extends Error {
  constructor(message, { kind, status, body, method, path, timeoutMs, cause } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind || ERR.HTTP;
    // status/body stay EXACTLY where callers already expect them (e.g. the
    // 422 rate-ack payload, 404 barcode misses, 401 bad-login). They are
    // undefined for every non-http kind, which is the point: code that
    // branches on `e.status === 422` cannot be fooled by a timeout.
    if (status != null) this.status = status;
    if (body !== undefined) this.body = body;
    this.method = method;
    this.path = path;
    if (timeoutMs != null) this.timeoutMs = timeoutMs;
    if (cause) this.cause = cause;
  }
  /** True when we genuinely do not know whether the server applied the change. */
  get outcomeUnknown() {
    return this.kind === ERR.TIMEOUT;
  }
}

export const isApiError = (e) => e instanceof ApiError;
export const isAuthError = (e) => isApiError(e) && e.kind === ERR.HTTP && e.status === 401;
export const isTimeoutError = (e) => isApiError(e) && e.kind === ERR.TIMEOUT;
export const isOfflineError = (e) => isApiError(e) && e.kind === ERR.OFFLINE;
export const isAbortError = (e) =>
  (isApiError(e) && e.kind === ERR.ABORTED) || (e && e.name === "AbortError");
/** Server never answered — the change may or may not have been applied. */
export const isNoAnswer = (e) => isTimeoutError(e) || isOfflineError(e);

const secs = (ms) => (ms >= 1000 ? Math.round(ms / 1000) : ((ms || 0) / 1000).toFixed(1));

/**
 * One honest sentence for any thrown error, in the app's voice. Never claims
 * to know what the server did when it doesn't.
 */
export function describeError(e, fallback = "Something went wrong.") {
  if (!e) return fallback;
  if (isAbortError(e)) return "The request was cancelled.";
  if (isTimeoutError(e)) {
    return `No answer from the app's server after ${secs(e.timeoutMs)}s — it may or may not have gone through.`;
  }
  if (isOfflineError(e)) return "Couldn't reach the app's server — the change was not sent.";
  if (isAuthError(e)) return "Your session expired.";
  if (isApiError(e) && e.status >= 500) return `The server hit an error (${e.status}) — your change was not saved.`;
  return e.message || fallback;
}

// ── timeout budgets ──────────────────────────────────────────────────────
// A timeout is a per-call option; these are the safe defaults. Short for
// plain reads/writes against local SQLite, long for the solver, longer for
// anything that goes out to the internet or an LLM. Passing
// `{ timeoutMs: n }` on any api.* call overrides it; `timeoutMs: 0` disables.
export const TIMEOUT = {
  READ: 15_000,     // plain GETs against the local DB
  WRITE: 20_000,    // plain writes
  BULK: 30_000,     // the big library reads (854 foods / 600+ recipes)
  SOLVER: 45_000,   // week/day solves, grocery lists, plan mutations
  REMOTE: 60_000,   // calls that leave the machine (Open Food Facts, recipe import)
  LLM: 120_000,     // AI generation / brain chat
};

// ── base URL + optional handshake ────────────────────────────────────────
// Both read the preload bridge lazily and fall back to today's behaviour
// (relative /api, no extra header) when the keys are absent — which is the
// case with the current shell, by design.
function bridge() {
  return (typeof window !== "undefined" && window.cutProtocol) || null;
}
function apiUrl(path) {
  const base = bridge()?.apiBaseUrl || "";
  return `${base}/api${path}`;
}
function handshakeHeaders() {
  const nonce = bridge()?.apiNonce;
  return nonce ? { "X-Cut-Protocol-Nonce": nonce } : null;
}

// ── the one place a 401 becomes "signed out" ─────────────────────────────
let sessionExpiredHandler = null;
/**
 * Register THE handler for a real 401 (App does this once). Called only for
 * an actual HTTP 401 on a non-exempt route — never for a 500, a timeout, an
 * abort, or a refused connection.
 */
export function onSessionExpired(handler) {
  sessionExpiredHandler = handler;
  return () => { if (sessionExpiredHandler === handler) sessionExpiredHandler = null; };
}
function notifySessionExpired(path) {
  logEvent("auth", `401 on ${path} — session cleared`);
  sessionExpiredHandler?.();
}

// ── request ──────────────────────────────────────────────────────────────
/**
 * @param {string} path      /-prefixed path under /api
 * @param {object} options   fetch options plus:
 *   timeoutMs   number  ms before we abort and throw a TIMEOUT ApiError (0 = none)
 *   signal      AbortSignal  caller's signal (component unmount) — composed
 *                            with the timeout; aborting it throws ABORTED
 *   authExempt  boolean  skip the global 401 handler (auth routes own theirs)
 */
async function request(path, options = {}) {
  const {
    timeoutMs = TIMEOUT.READ,
    signal: callerSignal,
    authExempt = false,
    headers: extraHeaders,
    ...fetchOpts
  } = options || {};
  const method = (fetchOpts.method || "GET").toUpperCase();

  // Already-cancelled (component unmounted before the call) — don't open a socket.
  if (callerSignal?.aborted) {
    throw new ApiError("request cancelled", { kind: ERR.ABORTED, method, path });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;
  const relayAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", relayAbort, { once: true });

  // Turns a thrown fetch/parse failure into the right ApiError kind. Order
  // matters: our own timeout wins over "the caller aborted", which wins over
  // "the network died" — an AbortError alone tells you nothing about why.
  const classify = (cause) => {
    if (timedOut) {
      logApi(method, path, "timeout");
      return new ApiError(`no answer from the server after ${secs(timeoutMs)}s`, {
        kind: ERR.TIMEOUT, method, path, timeoutMs, cause,
      });
    }
    if (callerSignal?.aborted) {
      return new ApiError("request cancelled", { kind: ERR.ABORTED, method, path, cause });
    }
    logApi(method, path, "network-error");
    return new ApiError(cause?.message || "couldn't reach the server", {
      kind: ERR.OFFLINE, method, path, cause,
    });
  };

  try {
    let res;
    try {
      res = await fetch(apiUrl(path), {
        credentials: "include",
        ...fetchOpts,
        headers: {
          ...(fetchOpts.body ? { "Content-Type": "application/json" } : null),
          ...handshakeHeaders(),
          ...extraHeaders,
        },
        signal: controller.signal,
      });
    } catch (netErr) {
      throw classify(netErr);
    }

    logApi(method, path, res.status); // status only — never the request/response body

    // THE 401 SEAM. A real 401 and nothing else.
    if (res.status === 401 && !authExempt) notifySessionExpired(path);

    if (res.status === 204) return null;

    let body = null;
    try {
      body = await res.json();
    } catch (parseErr) {
      // A body that never finished arriving is a transport failure, not an
      // empty response — classify it as such instead of silently null.
      if (timedOut || controller.signal.aborted) throw classify(parseErr);
      body = null; // genuinely non-JSON (or empty) response
    }

    if (!res.ok) {
      throw new ApiError(body?.error || `request failed: ${res.status}`, {
        kind: ERR.HTTP,
        status: res.status,
        body, // 422 rate-ack responses carry {requiresAck, reasons}
        method,
        path,
      });
    }
    return body;
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", relayAbort);
  }
}

// Every method takes an OPTIONAL trailing `opts` ({ signal, timeoutMs }).
// Existing call signatures are unchanged — passing nothing keeps the old
// behaviour plus a default timeout.
export const api = {
  // Auth routes own their 401 handling (a bad password and an expired
  // session are different events) — they never trip the global handler.
  login: (email, password, opts) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }), authExempt: true, timeoutMs: TIMEOUT.WRITE, ...opts }),
  logout: (opts) => request("/auth/logout", { method: "POST", authExempt: true, timeoutMs: TIMEOUT.WRITE, ...opts }),
  me: (opts) => request("/auth/me", { authExempt: true, ...opts }),

  getProfile: (opts) => request("/profile", opts),
  getProfileMeta: (opts) => request("/profile/meta", opts),
  putProfile: (patch, opts) => request("/profile", { method: "PUT", body: JSON.stringify(patch), timeoutMs: TIMEOUT.WRITE, ...opts }),

  getWeighins: (opts) => request("/weighins", opts),
  postWeighin: (date, weightKg, opts) => request("/weighins", { method: "POST", body: JSON.stringify({ date, weightKg }), timeoutMs: TIMEOUT.WRITE, ...opts }),
  deleteWeighin: (date, opts) => request(`/weighins/${date}`, { method: "DELETE", timeoutMs: TIMEOUT.WRITE, ...opts }),
  getSummary: (opts) => request("/weighins/summary", opts),

  getFoods: (opts) => request("/foods", { timeoutMs: TIMEOUT.BULK, ...opts }),
  putFood: (id, patch, opts) => request(`/foods/${id}`, { method: "PUT", body: JSON.stringify(patch), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  // Barcode-off track: manual UPC entry. lookupUpc previews (never writes);
  // importUpc re-validates server-side and saves, tagged source:"community".
  // Both leave the machine (Open Food Facts) — REMOTE budget.
  lookupUpc: (upc, opts) => request(`/foods/lookup-upc/${encodeURIComponent(upc)}`, { timeoutMs: TIMEOUT.REMOTE, ...opts }),
  importUpc: (upc, opts) => request("/foods/import-upc", { method: "POST", body: JSON.stringify({ upc }), timeoutMs: TIMEOUT.REMOTE, ...opts }),

  getRecipes: (opts) => request("/recipes", { timeoutMs: TIMEOUT.BULK, ...opts }),
  generateRecipeDrafts: (params, opts) => request("/recipes/generate-drafts", { method: "POST", body: JSON.stringify(params), timeoutMs: TIMEOUT.LLM, ...opts }),
  saveRecipeDraft: (draft, opts) => request("/recipes/save-draft", { method: "POST", body: JSON.stringify(draft), timeoutMs: TIMEOUT.WRITE, ...opts }),
  importRecipe: (url, opts) => request("/recipes/import", { method: "POST", body: JSON.stringify({ url }), timeoutMs: TIMEOUT.REMOTE, ...opts }),
  placeRecipe: (payload, opts) => request("/plans/place-recipe", { method: "POST", body: JSON.stringify(payload), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  fillTodayFromCart: (opts) => request("/plans/fill-today-from-cart", { method: "POST", timeoutMs: TIMEOUT.SOLVER, ...opts }),
  updateRecipe: (id, patch, opts) => request(`/recipes/${id}`, { method: "PUT", body: JSON.stringify(patch), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  deleteRecipe: (id, opts) => request(`/recipes/${id}`, { method: "DELETE", timeoutMs: TIMEOUT.WRITE, ...opts }),

  getCurrentPlan: (opts) => request("/plans/current", opts),
  generatePlan: (filters, opts) => request("/plans/generate", { method: "POST", body: JSON.stringify({ filters }), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  getDayOptions: (dayOfWeek, filters, opts) => request("/plans/day-options", { method: "POST", body: JSON.stringify({ dayOfWeek, filters }), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  acceptDay: (dayOfWeek, slots, opts) => request("/plans/accept-day", { method: "POST", body: JSON.stringify({ dayOfWeek, slots }), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  setSlotLock: (planId, slotId, locked, opts) => request(`/plans/${planId}/slots/${slotId}`, { method: "PUT", body: JSON.stringify({ locked }), timeoutMs: TIMEOUT.WRITE, ...opts }),
  getSlotAlternates: (planId, slotId, filters, opts) => request(`/plans/${planId}/slots/${slotId}/alternates`, { method: "POST", body: JSON.stringify({ filters }), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  applySlotAlternate: (planId, slotId, slot, opts) => request(`/plans/${planId}/slots/${slotId}/apply`, { method: "PUT", body: JSON.stringify(slot), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  swapSlot: (planId, slotId, opts) => request(`/plans/${planId}/slots/${slotId}/swap`, { method: "POST", timeoutMs: TIMEOUT.SOLVER, ...opts }),
  generateGroceryList: (planId, opts) => request(`/plans/${planId}/grocery-list`, { method: "POST", timeoutMs: TIMEOUT.SOLVER, ...opts }),
  checkGroceryItem: (planId, name, checked, opts) => request(`/plans/${planId}/grocery-list/check`, { method: "PUT", body: JSON.stringify({ name, checked }), timeoutMs: TIMEOUT.WRITE, ...opts }),

  getTrainingMeta: (opts) => request("/training/meta", opts),
  getTrainingPlan: (opts) => request("/training", opts),
  generateTrainingPlan: (inputs, opts) => request("/training/generate", { method: "POST", body: JSON.stringify(inputs), timeoutMs: TIMEOUT.SOLVER, ...opts }),
  deleteTrainingPlan: (opts) => request("/training", { method: "DELETE", timeoutMs: TIMEOUT.WRITE, ...opts }),

  // T (v2) — recipe taste ratings (soft solver re-rank; 1 = like, -1 = dislike).
  getRatings: (opts) => request("/ratings", opts),
  rateRecipe: (recipeId, rating, opts) => request("/ratings", { method: "PUT", body: JSON.stringify({ recipeId, rating }), timeoutMs: TIMEOUT.WRITE, ...opts }),
  unrateRecipe: (recipeId, opts) => request(`/ratings/${recipeId}`, { method: "DELETE", timeoutMs: TIMEOUT.WRITE, ...opts }),

  getCart: (opts) => request("/cart", opts),
  addToCart: (recipeId, opts) => request("/cart", { method: "POST", body: JSON.stringify({ recipeId }), timeoutMs: TIMEOUT.WRITE, ...opts }),
  removeFromCart: (recipeId, opts) => request(`/cart/${recipeId}`, { method: "DELETE", timeoutMs: TIMEOUT.WRITE, ...opts }),
  generateCartGroceryList: (opts) => request("/cart/grocery-list", { method: "POST", timeoutMs: TIMEOUT.SOLVER, ...opts }),

  // Food diary ("ate as planned"). Backend is being built in parallel — every
  // caller degrades gracefully on a 404 / missing field (see TodayTab).
  getDiary: (date, opts) => request(`/diary/${date}`, opts),
  logPlannedDiary: (date, opts) => request("/diary/log-planned", { method: "POST", body: JSON.stringify({ date }), timeoutMs: TIMEOUT.WRITE, ...opts }),
  addDiaryEntry: (entry, opts) => request("/diary/entry", { method: "POST", body: JSON.stringify(entry), timeoutMs: TIMEOUT.WRITE, ...opts }),
  deleteDiaryEntry: (id, opts) => request(`/diary/entry/${id}`, { method: "DELETE", timeoutMs: TIMEOUT.WRITE, ...opts }),

  // Micronutrients — today's rollup, sourced from the solved plan's real
  // per-food grams (see routes/micronutrients.js for why the diary can't be
  // used for this honestly). Defaults to today when date is omitted.
  getMicronutrientsToday: (date, opts) => request(`/micronutrients/today${date ? `?date=${date}` : ""}`, { timeoutMs: TIMEOUT.SOLVER, ...opts }),

  // Stage D2 — brain chat. getBrainStatus gates whether the chat bar renders at
  // all; brainChat sends one message. Both no-op cleanly when the brain is off.
  getBrainStatus: (opts) => request("/brain/status", opts),
  brainChat: (message, depth, history, opts) => request("/brain/chat", { method: "POST", body: JSON.stringify({ message, depth, history }), timeoutMs: TIMEOUT.LLM, ...opts }),
};
