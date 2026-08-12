// Must run before dotenv and before any route file is required, since the
// route files require src/lib/prisma.js which constructs the PrismaClient
// (and resolves DATABASE_URL) at module-load time. In packaged Electron
// mode, CUT_PROTOCOL_DB_PATH/DATABASE_URL are already set in process.env by
// electron/main.cjs before this file is ever required, so this is safe to
// call even ahead of dotenv/config (dotenv never overwrites existing vars).
const { ensureDatabaseReady, ensureSchemaCurrent } = require("./src/lib/desktopBootstrap.js");
ensureDatabaseReady();

require("dotenv/config");

// Relay config for the packaged app, from <userData>/brain.json. Runs AFTER
// dotenv and follows the same non-destructive rule, so backend/.env keeps
// winning in dev and an explicit BRAIN=off in the environment still turns the
// coach off regardless of what the file says.
//
// Absent or malformed file => nothing is set => isBrainEnabled() stays false =>
// the app is byte-identical to one that never had this feature. That degrade
// path is the whole contract, which is why this is a bare call with no error
// handling to get wrong: applyToEnv() cannot throw on a missing or broken file.
require("./src/lib/brainRelayConfig.js").applyToEnv();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

// ── logging seam ────────────────────────────────────────────────────────────
// Every boot-time diagnostic in this file goes through `log`, never through
// `console` directly. In a packaged Windows GUI build there IS no console, so a
// console-only line about a failed schema migration or a failed data audit is a
// guardrail that reports to nobody. electron/logger.cjs already writes to a file
// in the user's data dir and mirrors to stdout; the Electron main process can
// point this at it with ONE assignment before requiring this file:
//
//   require("./backend/server.js").setLogger((level, ...args) => log.write("backend", args.join(" ")));
//
// Default is console, so `node server.js` and the tests are unchanged.
let logSink = (level, ...args) => (console[level] || console.log)(...args);
const log = {
  info: (...a) => logSink("log", ...a),
  warn: (...a) => logSink("warn", ...a),
  error: (...a) => logSink("error", ...a),
};

const authRoutes = require("./src/routes/auth.js");
const profileRoutes = require("./src/routes/profile.js");
const weighinRoutes = require("./src/routes/weighins.js");
const recipeRoutes = require("./src/routes/recipes.js");
const planRoutes = require("./src/routes/plans.js");
const foodRoutes = require("./src/routes/foods.js");
const cartRoutes = require("./src/routes/cart.js");
const ratingsRoutes = require("./src/routes/ratings.js");
const trainingRoutes = require("./src/routes/training.js");
const diaryRoutes = require("./src/routes/diary.js");
const brainRoutes = require("./src/routes/brain.js");
const micronutrientRoutes = require("./src/routes/micronutrients.js");

const app = express();

// A full data export is megabytes of JSON, and POST /api/import takes that same
// document back. The global express.json() below caps bodies at body-parser's
// 100 kB default, which would 413 every real restore before the route ever saw
// it. Mounted FIRST and PATH-SCOPED: body-parser marks `req._body` once it has
// parsed, so the global parser skips this request, and no other route's size
// limit changes.
app.use("/api/import", express.json({ limit: "64mb" }));

// saas-launch Stage 3: Lemon Squeezy signs its webhooks over the RAW body
// (HMAC-SHA256 in X-Signature). Same path-scoped-first trick as /api/import:
// express.raw marks the body consumed, the global JSON parser skips it, and
// the route verifies the signature against the exact bytes LS signed.
app.use("/api/webhooks/lemonsqueezy", express.raw({ type: "*/*", limit: "1mb" }));

app.use(express.json());
app.use(cookieParser());

// M2: an updated install must bring the user's existing DB up to the shipped
// schema before any data route touches it. ensureSchemaCurrent() applies the
// pending shipped migrations in-process (automatic backup first; no-op in dev
// and on every already-current boot); every /api request waits on it once.
// On failure the data is untouched and every request says exactly where the
// backup and the error log are, instead of a generic 500.
const schemaReady = ensureSchemaCurrent();
schemaReady.catch((e) => log.error("[desktopBootstrap]", e.message));

// M2 (cont.): once the schema is current, bring the SHIPPED FOOD/RECIPE LIBRARY
// current too. Migrations move the schema; they do not move data, so an install
// created before the 14,122-food import stays frozen at whatever library it was
// packaged with and can never receive a data fix — the owner's own copy sat at
// 973 foods. src/lib/librarySync.js closes that; it no-ops in dev (no
// CUT_PROTOCOL_DB_PATH) and on an already-current library, backs up first, and
// never overwrites user-owned rows.
//
// Guarded by an existence check because this file and librarySync.js can land
// independently: if the module is not present, the app boots exactly as before
// rather than crashing on a require that isn't there yet.
const LIBRARY_SYNC_PATH = path.join(__dirname, "src", "lib", "librarySync.js");
const bootReady = schemaReady.then(async () => {
  // An explicit file check, NOT a try/catch around require: catching
  // MODULE_NOT_FOUND would also swallow a missing dependency INSIDE
  // librarySync.js and silently skip a sync that was supposed to run. This asks
  // the one question it means to ask — is the module here yet?
  if (!require("node:fs").existsSync(LIBRARY_SYNC_PATH)) return;
  const { ensureLibraryCurrent } = require(LIBRARY_SYNC_PATH);
  try {
    await ensureLibraryCurrent();
  } catch (e) {
    // A library that could not be refreshed is a stale library, not a broken
    // one. Boot on what is already there and say so; never block the app.
    log.error("[librarySync] library update failed, booting on the existing library:", e.message);
  }
});
bootReady.catch(() => { /* handled above; the /api gate reports the schema half */ });

// ── Liveness probe (Railway healthcheckPath) ────────────────────────────────
// Public on purpose, same as /api/meta/whoami: it must answer before anyone
// has logged in, it carries no user data, and it never touches the database.
// Mounted AHEAD of the bootReady gate so it answers even while migrations are
// still running — or after they failed. The question this endpoint answers is
// "is this process up and serving HTTP"; the boot state rides along honestly
// instead of being gated on, so an operator hitting /api/health can tell a
// healthy deploy from one whose /api requests are all 500ing on a failed boot.
// railway.json's deploy.healthcheckPath points here; a crash-looping deploy
// never answers this and so never reads as live.
let bootState = "pending"; // "pending" | "ready" | "failed"
bootReady.then(() => { bootState = "ready"; }, () => { bootState = "failed"; });
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true, bootReady: bootState === "ready", bootState });
});

app.use("/api", (req, res, next) => {
  bootReady.then(
    () => next(),
    (e) => res.status(500).json({ error: `Database schema update failed: ${e.message}. Your data was not modified.` })
  );
});

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/weighins", weighinRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/foods", foodRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/ratings", ratingsRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/diary", diaryRoutes);
app.use("/api/brain", brainRoutes); // Stage D2: guarded chat surface (gated; inert with BRAIN=off)
app.use("/api/micronutrients", micronutrientRoutes);
app.use("/api/billing", require("./src/routes/billing.js")); // saas-launch: LS checkout creation
app.use("/api/webhooks/lemonsqueezy", require("./src/routes/lsWebhook.js")); // signature-authed, no session
// GET /api/export + POST /api/import. Mounted at /api (the router declares both
// full paths itself and attaches requireAuth per route), so an unmatched /api
// path still falls through to the JSON 404 below.
app.use("/api", require("./src/routes/export.js"));

// ── Identity handshake (resilience-errors-2) ────────────────────────────────
// The desktop shell picks a port, then loads a URL. If ANOTHER process holds
// that port, the old code happily loaded whatever answered — a different app's
// API, or a hostile one — and the renderer would have treated its responses as
// our own data. Reading a stranger's API as if it were your own is the real
// danger of a port conflict; the crash is the mild failure.
//
// So: electron/main.cjs generates a random nonce per launch, hands it to this
// process via CUT_PROTOCOL_NONCE, and refuses to load the window until this
// endpoint echoes the SAME nonce back. A foreign service cannot know it.
//
// Public on purpose (no auth): it carries no user data, and it has to be
// answerable before anyone has logged in. Mounted ahead of the meta router so
// it can never be shadowed by it.
app.get("/api/meta/whoami", (req, res) => {
  res.json({
    app: "cut-protocol",
    nonce: process.env.CUT_PROTOCOL_NONCE || null,
    pid: process.pid,
    port: Number(process.env.PORT) || null,
  });
});

app.use("/api/meta", require("./src/routes/meta.js")); // public: build version/OS for bug reports

// Unmatched /api routes return clean JSON, not the SPA index.html (the
// catch-all below only handles non-/api paths).
app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));

// Serve the built frontend as static files, same origin as the API â€”
// no CORS needed. Falls back to index.html for client-side routing.
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(frontendDist));
// saas-launch Stage 4: clean legal URLs (what Google's consent screen and the
// LS store settings link to). The files ship via frontend/public → dist, so
// /terms.html works through the static mount above; these routes add the
// extension-less spellings ahead of the SPA fallback.
app.get(["/terms", "/privacy"], (req, res) => {
  res.sendFile(path.join(frontendDist, `${req.path.slice(1)}.html`));
});
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Terminal error middleware (Stage-C #23). Express 5 auto-forwards async
// route rejections here, so every route's errors now leave as a clean
// { error } JSON with a sane status — instead of framework stack-trace HTML
// that the frontend could only surface as a generic "request failed: 500".
// Common Prisma codes map to meaningful statuses; stack traces are logged
// server-side only, never sent to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const prismaStatus = { P2002: 409, P2025: 404, P2021: 500, P2022: 500 }[err.code];
  const status = err.status || prismaStatus || 500;
  if (status >= 500) log.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(status).json({ error: status < 500 ? err.message : "something went wrong on our end" });
});

// The QC fuzz harness (scripts/qc/fuzz.mjs) imports this file to get `app` and
// binds its own ephemeral port, so it must be able to load the whole server
// WITHOUT the module grabbing :3001 or running the boot audit. A require.main
// guard can't be used here: in packaged mode electron/main.cjs REQUIRES this
// file (it is never the main module), so require.main===module is false in the
// real desktop path too. An explicit opt-out flag is the only correct guard.
const PORT = process.env.PORT || 3001;

// resilience-errors-2: bind LOOPBACK ONLY.
// `app.listen(PORT)` with no host binds 0.0.0.0 — every interface — which put
// this single-user desktop app's whole API (login, profile, food data) on the
// LAN of every coffee shop and job site the laptop ever joined. Nothing about
// this app is meant to be reachable from another machine. HOST stays
// overridable for the container/Railway deploy path (Dockerfile/railway.json),
// which is the only place a non-loopback bind is legitimate.
const HOST = process.env.HOST || "127.0.0.1";

// ── Phase 2 guardrail, without the per-launch bill ──────────────────────────
// Bad food/recipe data must never come back silently, so the library is still
// audited and the verdict is still said out loud. What changed is WHEN.
//
// Measured on the live 14,122-food library, as this ran before: 973 ms wall,
// 155 ms of contiguous event-loop block, RSS 65 -> 320 MB with ~220 MB never
// returned to the OS, re-paid IN FULL on the second boot (913 ms — there was no
// cache). It fired inside the listen() callback, which is exactly when the
// renderer requests /me, /profile and /summary, so it taxed first paint by up to
// ~155 ms and then tripled backend RSS for the life of the process. Its entire
// output was a console.log that a packaged Windows GUI app cannot display, and
// it printed "ATTENTION NEEDED" on every single launch because of one known
// placeholder food.
//
// Now: the audit runs only when the LIBRARY FINGERPRINT MOVED (see
// dataQualityAudit.auditIfLibraryChanged — a boot on an unchanged library costs
// five aggregate queries), it is deferred past first paint, its own queries no
// longer select the columns it never reads, and the banner distinguishes a
// placeholder from a defect. Set CUT_PROTOCOL_AUDIT=1 to force a full re-run,
// or CUT_PROTOCOL_AUDIT=off to skip it entirely.
const AUDIT_DELAY_MS = Number(process.env.CUT_PROTOCOL_AUDIT_DELAY_MS) || 4000;

function scheduleDataQualityAudit() {
  const mode = String(process.env.CUT_PROTOCOL_AUDIT || "").toLowerCase();
  if (mode === "off" || mode === "0") {
    log.info("[data-audit] skipped (CUT_PROTOCOL_AUDIT=off)");
    return null;
  }
  // unref() so a short-lived process (a test, a script that requires this file)
  // is never held open by a pending audit.
  const timer = setTimeout(() => {
    const { auditIfLibraryChanged, formatAuditSummary } = require("./src/lib/dataQualityAudit.js");
    auditIfLibraryChanged({ force: mode === "1" || mode === "always" })
      .then(({ summary, source }) => log.info(formatAuditSummary(summary, source)))
      // Was console-only, which meant this Phase-2 guardrail could be silently
      // dead in a packaged build — the one place it matters most. It goes
      // through the replaceable sink now, so the Electron logger picks it up.
      .catch((e) => log.error("[data-audit] failed to run — the food/recipe guardrail did NOT report this boot:", e.message));
  }, AUDIT_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

let server = null;
if (!process.env.QC_NO_LISTEN) {
  server = app.listen(PORT, HOST, () => {
    log.info(`Cut Protocol backend listening on ${HOST}:${PORT}`);
    scheduleDataQualityAudit();
  });

  // resilience-errors-2: a bind failure used to be an UNCAUGHT 'error' event
  // on the http server — in the Electron main process that surfaced as a raw
  // stack-trace dialog, and the shell then went on to load whatever foreign
  // service owned the port. Handle it here so the failure is a value the shell
  // can read (`module.exports.listenError`, plus the 'error' event on
  // `module.exports.server`) instead of a crash, and keep a plain log line for
  // the standalone `node server.js` path.
  server.on("error", (err) => {
    module.exports.listenError = err;
    if (err && err.code === "EADDRINUSE") {
      log.error(`[server] port ${PORT} on ${HOST} is already in use — refusing to start a second listener.`);
    } else {
      log.error("[server] listen failed:", err && err.message);
    }
  });
}

// Exported so the QC fuzz harness can mount the real app on an ephemeral port.
// Requiring this file still starts the server normally unless QC_NO_LISTEN is set.
module.exports = app;
// `app` is a function, so these ride along without disturbing the existing
// `module.exports = app` contract the fuzz harness depends on.
module.exports.server = server;       // null when QC_NO_LISTEN is set
module.exports.listenError = null;    // set by the 'error' handler above
module.exports.host = HOST;
module.exports.port = Number(PORT);
/**
 * Replace the destination of this file's boot diagnostics.
 * `sink(level, ...args)` where level is "log" | "warn" | "error".
 * Call it BEFORE requiring/booting if you want the listen line too.
 * Passing nothing restores console.
 */
module.exports.setLogger = (sink) => {
  logSink = typeof sink === "function" ? sink : (level, ...args) => (console[level] || console.log)(...args);
};
module.exports.scheduleDataQualityAudit = scheduleDataQualityAudit;
