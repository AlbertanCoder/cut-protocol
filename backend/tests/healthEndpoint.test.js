// REGRESSION SUITE — Railway deploy healthcheck (deploy-gap 1, session
// findings 2026-08-10).
//
// Two properties this file exists to hold down:
//
//   1. GET /api/health answers 200 with { ok, bootReady, bootState } — public
//      (no auth), no database touch, and mounted AHEAD of the bootReady gate
//      so it answers even while boot work is pending. Without it, Railway has
//      nothing to probe and a crash-looping deploy reads as live.
//   2. railway.json's deploy.healthcheckPath actually points at that route.
//      The two live in different files; either one moving alone silently
//      un-wires the healthcheck, so this suite pins them together.
//
// The server runs as a CHILD PROCESS against a scratch COPY of the database —
// this suite never touches backend/prisma/dev.db (same pattern as
// serverPortIdentity.test.js).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND_DIR = path.join(__dirname, "..");
const SERVER = path.join(BACKEND_DIR, "server.js");
const RAILWAY_JSON = path.join(BACKEND_DIR, "..", "railway.json");

let scratchDb = null;
const children = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Spawn server.js and resolve once it prints its listening line. */
function startServer(env, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    // The "ready" assertions below rely on the dev no-op boot path, and a
    // CUT_PROTOCOL_DB_PATH leaked from a packaged-app shell would point the
    // child's ensureSchemaCurrent at a REAL user database (migrate + backup
    // from inside a test). Never let it reach the child.
    const childEnv = { ...process.env, DATABASE_URL: `file:${scratchDb}`, ...env };
    delete childEnv.CUT_PROTOCOL_DB_PATH;
    const child = spawn(process.execPath, [SERVER], {
      cwd: BACKEND_DIR,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`server did not start in ${timeoutMs}ms\nSTDOUT:${out}\nSTDERR:${err}`)), timeoutMs);

    child.stdout.on("data", (c) => {
      out += c.toString();
      if (out.includes("listening on")) {
        clearTimeout(timer);
        resolve({ child, stdout: () => out, stderr: () => err });
      }
    });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("exit", (code) => {
      if (!out.includes("listening on")) {
        clearTimeout(timer);
        reject(new Error(`server exited (${code}) before listening\nSTDOUT:${out}\nSTDERR:${err}`));
      }
    });
  });
}

function get(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve({ status: res.statusCode, raw }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

before(() => {
  // Scratch COPY — the suite must never read or write the live dev.db.
  const src = path.join(BACKEND_DIR, "prisma", "dev.db");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-health-"));
  scratchDb = path.join(dir, "scratch.db");
  if (fs.existsSync(src)) fs.copyFileSync(src, scratchDb);
  else fs.writeFileSync(scratchDb, ""); // no dev.db in this tree: /api/health touches no DB, still valid
});

after(() => {
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  try { fs.rmSync(path.dirname(scratchDb), { recursive: true, force: true }); } catch { /* ignore */ }
});

test("GET /api/health answers 200 with no auth and reports boot readiness", async () => {
  const port = await freePort();
  const s = await startServer({ PORT: String(port) });

  // First probe: must answer 200 immediately — liveness is "the process is up
  // and serving HTTP", never gated on boot work still in flight.
  const first = await get(`http://127.0.0.1:${port}/api/health`);
  assert.equal(first.status, 200, "the healthcheck must be a 200, or Railway never marks the deploy live");
  const firstBody = JSON.parse(first.raw);
  assert.equal(firstBody.ok, true);
  assert.ok(["pending", "ready", "failed"].includes(firstBody.bootState),
    `bootState must be one of pending/ready/failed, got ${JSON.stringify(firstBody.bootState)}`);

  // It carries NOTHING personal: like /api/meta/whoami it is public by
  // necessity, so it must never grow a field with user data in it.
  assert.deepEqual(Object.keys(firstBody).sort(), ["bootReady", "bootState", "ok"]);

  // Boot work no-ops without CUT_PROTOCOL_DB_PATH, so bootReady settles fast.
  // Poll briefly rather than assume the first response already saw it settle.
  let body = firstBody;
  const deadline = Date.now() + 10000;
  while (body.bootState === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    body = JSON.parse((await get(`http://127.0.0.1:${port}/api/health`)).raw);
  }
  assert.equal(body.bootState, "ready", "a dev-mode boot (no CUT_PROTOCOL_DB_PATH) must reach ready");
  assert.equal(body.bootReady, true, "bootReady must flip true once boot work settles");

  s.child.kill();
});

test("railway.json's healthcheckPath points at the mounted route", () => {
  // The route lives in server.js, the probe path in railway.json — either one
  // moving alone silently disables the healthcheck. Pin them to each other.
  const railway = JSON.parse(fs.readFileSync(RAILWAY_JSON, "utf8"));
  assert.equal(railway.deploy.healthcheckPath, "/api/health",
    "railway.json must probe the exact path server.js mounts — see the /api/health route in backend/server.js");
  assert.ok(Number.isInteger(railway.deploy.healthcheckTimeout) && railway.deploy.healthcheckTimeout > 0,
    "healthcheckTimeout must be a positive number of seconds, or Railway falls back to its default silently");

  // And server.js must actually contain the mount — a rename there without a
  // railway.json change is the same silent un-wiring in the other direction.
  const serverSrc = fs.readFileSync(SERVER, "utf8");
  assert.ok(serverSrc.includes('app.get("/api/health"'),
    "server.js no longer mounts GET /api/health — railway.json's healthcheckPath now probes a 404");
});
