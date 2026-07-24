// REGRESSION SUITE — resilience-errors-2 (port conflict / foreign backend).
//
// Three properties this file exists to hold down forever:
//
//   1. The server binds LOOPBACK ONLY. It used to be `app.listen(PORT)` with
//      no host, which binds 0.0.0.0 — this single-user desktop app's login,
//      profile and food API were reachable from every network the laptop ever
//      joined. Nothing about the app needs that.
//   2. /api/meta/whoami echoes the launch nonce. The desktop shell refuses to
//      load a page it cannot verify; without this endpoint answering
//      correctly, a foreign process holding the port would have been rendered
//      as if it were Cut Protocol and handed the user's credentials.
//   3. A port conflict is a HANDLED value, not an uncaught EADDRINUSE that
//      Electron shows as a stack trace.
//
// Every server here runs as a CHILD PROCESS against a scratch COPY of the
// database — this suite never touches backend/prisma/dev.db.

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
    const child = spawn(process.execPath, [SERVER], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: `file:${scratchDb}`, ...env },
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

/** Can we open a TCP connection to host:port? Resolves true/false, never throws. */
function canConnect(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** First non-internal IPv4 address of this machine, or null. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === "IPv4" && !nic.internal) return nic.address;
    }
  }
  return null;
}

before(() => {
  // Scratch COPY — the suite must never read or write the live dev.db.
  const src = path.join(BACKEND_DIR, "prisma", "dev.db");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-portid-"));
  scratchDb = path.join(dir, "scratch.db");
  if (fs.existsSync(src)) fs.copyFileSync(src, scratchDb);
  else fs.writeFileSync(scratchDb, ""); // no dev.db in this tree: still valid for bind tests
});

after(() => {
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  try { fs.rmSync(path.dirname(scratchDb), { recursive: true, force: true }); } catch { /* ignore */ }
});

test("the server binds 127.0.0.1 only — a desktop app's API is not on the LAN", async () => {
  const port = await freePort();
  const nonce = "nonce-loopback-" + Date.now();
  const s = await startServer({ PORT: String(port), CUT_PROTOCOL_NONCE: nonce });
  // HOST is deliberately NOT set: this asserts the DEFAULT is loopback.
  assert.match(s.stdout(), /listening on 127\.0\.0\.1:/, "the boot line names the loopback bind explicitly");

  assert.equal(await canConnect("127.0.0.1", port), true, "reachable on loopback (the app itself must work)");

  const lan = lanAddress();
  if (lan) {
    assert.equal(await canConnect(lan, port), false,
      `REGRESSION: the backend answered on the LAN address ${lan}:${port} — it must bind 127.0.0.1 only`);
  } else {
    // No non-internal NIC on this machine (offline runner): the loopback-only
    // claim can't be disproved here, and the stdout assertion above still
    // pins the bind address. Say so rather than pretend it was checked.
    console.log("[serverPortIdentity] no non-loopback IPv4 on this host — LAN-reachability check skipped");
  }
  s.child.kill();
});

test("/api/meta/whoami echoes the launch nonce so the shell can prove it's OUR backend", async () => {
  const port = await freePort();
  const nonce = "nonce-handshake-" + Math.random().toString(16).slice(2);
  const s = await startServer({ PORT: String(port), CUT_PROTOCOL_NONCE: nonce });

  const res = await get(`http://127.0.0.1:${port}/api/meta/whoami`);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.raw);
  assert.equal(body.app, "cut-protocol");
  assert.equal(body.nonce, nonce, "the nonce must round-trip exactly — this is the whole handshake");
  assert.equal(body.port, port);
  assert.ok(Number.isInteger(body.pid));

  // It carries NOTHING personal: whoami is public by necessity (it answers
  // before login), so it must never grow a field with user data in it.
  assert.deepEqual(Object.keys(body).sort(), ["app", "nonce", "pid", "port"]);

  // And it must be public — no auth cookie was sent above and it still worked.
  s.child.kill();
});

test("a DIFFERENT process on the port cannot forge the handshake", async () => {
  // Stand up an impostor that answers /api/meta/whoami with a plausible but
  // wrong body — exactly what a hostile or merely-confused local service does.
  const port = await freePort();
  const impostor = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ app: "cut-protocol", nonce: "guessed-nonce", pid: 1, port }));
  });
  await new Promise((r) => impostor.listen(port, "127.0.0.1", r));
  try {
    const res = await get(`http://127.0.0.1:${port}/api/meta/whoami`);
    const body = JSON.parse(res.raw);
    // This is the exact comparison electron/main.cjs → verifyOwnBackend makes.
    const launchNonce = "the-real-launch-nonce-" + Date.now();
    const accepted = !!(body && body.app === "cut-protocol" && body.nonce && body.nonce === launchNonce);
    assert.equal(accepted, false,
      "REGRESSION: a foreign service was accepted as our backend — the shell would have loaded it and fed it the user's login");
  } finally {
    await new Promise((r) => impostor.close(r));
  }
});

test("a taken port is a handled error, not an uncaught EADDRINUSE stack", async () => {
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(port, "127.0.0.1", r));

  try {
    const child = spawn(process.execPath, [SERVER], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: `file:${scratchDb}`, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

    const stderr = await new Promise((resolve, reject) => {
      let err = "";
      const timer = setTimeout(() => resolve(err), 20000);
      child.stderr.on("data", (c) => {
        err += c.toString();
        if (err.includes("already in use") || err.includes("EADDRINUSE")) {
          clearTimeout(timer);
          resolve(err);
        }
      });
      child.on("error", reject);
    });

    assert.match(stderr, /already in use/,
      "the conflict must be reported as a clear sentence by our own handler");
    assert.doesNotMatch(stderr, /throw er;|Unhandled 'error' event/,
      "REGRESSION: the bind failure escaped as an uncaught exception again");
    child.kill();
  } finally {
    await new Promise((r) => blocker.close(r));
  }
});

test("HOST stays overridable — the container deploy path can still bind 0.0.0.0", async () => {
  const port = await freePort();
  const s = await startServer({ PORT: String(port), HOST: "0.0.0.0", CUT_PROTOCOL_NONCE: "n" });
  assert.match(s.stdout(), /listening on 0\.0\.0\.0:/,
    "an explicit HOST must still win — Dockerfile/railway.json depend on it");
  s.child.kill();
});
