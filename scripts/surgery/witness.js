#!/usr/bin/env node
/**
 * witness — the only door through which this surgery may spend money.
 *
 * H6 contract. In order:
 *   1. ASSERT the target is the dev DB. Never the packaged template, never a
 *      path outside backend/prisma. Refuse rather than guess.
 *   2. BACK UP that DB, with the backup path printed before anything else runs.
 *   3. ARM the caps — designs <= 2 (BRAIN_MAX_DESIGNS_PER_GENERATE, read by
 *      BRAIN_CALL_CEILING in routes/plans.js), dollars <= $0.50, calls <= 12.
 *   4. STAMP t0, snapshot the ledger's newest row id.
 *   5. BOOT the backend on a non-3001 port. 3001 is the owner's live app and is
 *      sacred; this script refuses to bind it under any flag.
 *   6. RUN the generate.
 *   7. STAMP t1, snapshot the ledger again, and print machine numbers.
 *
 * The model does not do the arithmetic it is judged on: every number this
 * prints comes from the process or from ledger-delta.js, never from prose.
 *
 * Flags:
 *   --brain on|off     which arm of the witness to run          (required)
 *   --port <n>         non-3001 port to boot on                 (default 3999)
 *   --dry-run          do everything EXCEPT the generate call — proves boot,
 *                      auth, profile and cap arming for $0
 *   --label <s>        evidence filename suffix
 *
 * UNRUN AS SHIPPED. Authored before the incisions so the instrument cannot be
 * tuned to the result it is supposed to measure. The session that first runs it
 * must treat the first execution as itself under test.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(REPO, 'backend');
const PRISMA_DIR = path.join(BACKEND, 'prisma');
const DEV_DB = path.join(PRISMA_DIR, 'dev.db');

// ---- caps (H6) -------------------------------------------------------------
const CAP_CALLS = 12;
const CAP_USD = 0.5;
const CAP_DESIGNS = 2;
const FORBIDDEN_PORT = 3001;

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (f) => process.argv.includes(f);

const BRAIN = arg('--brain');
const PORT = Number(arg('--port', '3999'));
const DRY = has('--dry-run');
const LABEL = arg('--label', BRAIN || 'run');

function die(msg) {
  console.error(`\nWITNESS REFUSED: ${msg}\n`);
  process.exit(2);
}

if (BRAIN !== 'on' && BRAIN !== 'off') die('--brain must be exactly "on" or "off".');
if (!Number.isInteger(PORT) || PORT <= 0) die('--port must be a positive integer.');
if (PORT === FORBIDDEN_PORT) {
  die(`port ${FORBIDDEN_PORT} is the owner's live app. The witness never binds it.`);
}

// ---- 1. assert the dev DB --------------------------------------------------
console.log('== WITNESS ==');
console.log(`run        : brain=${BRAIN} port=${PORT} dry-run=${DRY}`);

try {
  require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env'), quiet: true });
} catch {
  /* optional */
}
const rawUrl = process.env.DATABASE_URL || 'file:./dev.db';
if (!/^file:/.test(rawUrl)) die(`DATABASE_URL is not a file: URL (${rawUrl}). Refusing.`);
const resolved = path.resolve(PRISMA_DIR, rawUrl.replace(/^file:/, ''));
if (/template/i.test(resolved)) die(`DATABASE_URL resolves to the PACKAGED template DB (${resolved}). Sacred. Refusing.`);
if (path.dirname(resolved) !== PRISMA_DIR) die(`DATABASE_URL resolves outside backend/prisma (${resolved}). Refusing.`);
if (path.basename(resolved) !== 'dev.db') die(`DATABASE_URL resolves to ${path.basename(resolved)}, not dev.db. Refusing.`);
if (!fs.existsSync(resolved)) die(`dev DB not found at ${resolved}.`);
console.log(`db         : ${resolved} (asserted dev)`);

// ---- 2. back it up ---------------------------------------------------------
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const backup = path.join(PRISMA_DIR, `dev.db.backup-witness-${stamp}`);
fs.copyFileSync(resolved, backup);
console.log(`backup     : ${backup}`);

// ---- 3. arm the caps -------------------------------------------------------
// The MONTHLY cap must be armed relative to money ALREADY spent this month, or
// pre-existing rows starve the run and the witness reports a false null. The
// run's own ceiling is what we add on top: existing + CAP_USD.
const { prisma } = require(path.join(BACKEND, 'src', 'lib', 'prisma.js'));

async function monthSpend() {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const agg = await prisma.llmUsage.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: start } },
  });
  return agg._sum.costUsd || 0;
}

async function newestRow() {
  const r = await prisma.llmUsage.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } });
  return r || null;
}

function ledgerDelta(args) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'ledger-delta.js'), ...args], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

// ---- plumbing: the server handle and ONE idempotent shutdown ---------------
// Both the happy path and the failure path must use the same shutdown, and it
// must survive being called twice. Previously `shutdown` was defined inside
// main() and registered on 'exit', while main().catch() disconnected Prisma —
// so a failure killed the child from an exit handler while libuv was still
// unwinding the Prisma disconnect, and the process aborted with 127. A crashed
// witness and a cap-breached witness must never share an exit code, because
// then the exit code stops meaning anything.
let serverProc = null;
let shutdownDone = false;
function shutdown() {
  if (shutdownDone) return;
  shutdownDone = true;
  try {
    if (serverProc) serverProc.kill();
  } catch {
    /* already down */
  }
}
process.on('exit', shutdown);

// ---- plumbing: the cookie jar ----------------------------------------------
// requireAuth in backend/src/lib/auth.js reads the session EXCLUSIVELY from the
// httpOnly cookie `cutprotocol_session`. There is no bearer path anywhere in
// the app, so the witness has to hold a cookie exactly as a browser does.
const jar = new Map();

function absorb(res) {
  const lines =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [].concat(res.headers.get('set-cookie') || []);
  for (const line of lines) {
    if (!line) continue;
    const pair = String(line).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader() {
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
}

async function main() {
  const spentThisMonth = await monthSpend();
  const monthlyCap = Number((spentThisMonth + CAP_USD).toFixed(4));

  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    HOST: '127.0.0.1',
    BRAIN,
    BRAIN_MAX_DESIGNS_PER_GENERATE: String(CAP_DESIGNS),
    BRAIN_PER_REQUEST_CAP_USD: String(CAP_USD),
    BRAIN_DAILY_COST_CAP_USD: String(CAP_USD),
    BRAIN_MONTHLY_COST_CAP_USD: String(monthlyCap),
  });

  console.log(
    `caps       : designs<=${CAP_DESIGNS} calls<=${CAP_CALLS} perRequest<=$${CAP_USD} ` +
      `daily<=$${CAP_USD} monthly<=$${monthlyCap} (month-to-date $${spentThisMonth.toFixed(4)} + $${CAP_USD})`
  );

  // ---- 4. t0 + pre-snapshot ------------------------------------------------
  const pre = await newestRow();
  const t0 = new Date().toISOString();
  console.log(`t0         : ${t0}`);
  console.log(`ledger pre : newest=${pre ? `${pre.id} @ ${pre.createdAt.toISOString()}` : '(empty table)'}`);

  // ---- 5. boot -------------------------------------------------------------
  console.log(`boot       : node server.js on 127.0.0.1:${PORT}`);
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc = server;
  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(String(d)));
  server.stderr.on('data', (d) => serverLog.push(String(d)));

  const base = `http://127.0.0.1:${PORT}`;

  async function waitForBoot(ms = 20000) {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
      if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}:\n${serverLog.join('')}`);
      try {
        const r = await fetch(`${base}/healthz`);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server did not answer on ${base} within ${ms}ms:\n${serverLog.join('')}`);
  }
  await waitForBoot();
  console.log('boot       : up');

  // ---- 6. the witness account + forcing profile ----------------------------
  // A dedicated account, so the witness never mutates the owner's own data.
  const email = `witness-${stamp}@local`;
  const password = `witness-${stamp}-pw`;

  async function api(method, url, body) {
    const r = await fetch(`${base}${url}`, {
      method,
      headers: Object.assign(
        { 'content-type': 'application/json' },
        jar.size ? { cookie: cookieHeader() } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    });
    absorb(r);
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { status: r.status, json, text };
  }

  // Mint the account directly, then authenticate through the REAL login route.
  //
  // POST /api/auth/register is gated — it permits registration only on a
  // zero-user install or from a caller already holding a live session — and on
  // success it returns { id, email, role } with the session in a cookie and no
  // token in the body. The witness therefore creates its own dedicated row and
  // signs in the way a person does, so the cookie is issued by exactly the code
  // path a user's cookie comes from. The app is not on this manifest and is not
  // touched: no bearer path is added, no registration gate is weakened.
  const { hashPassword } = require(path.join(BACKEND, 'src', 'lib', 'auth.js'));
  await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: 'user' },
  });

  const login = await api('POST', '/api/auth/login', { email, password });
  if (login.status >= 400) throw new Error(`login failed ${login.status}: ${login.text.slice(0, 300)}`);
  if (!jar.has('cutprotocol_session')) {
    throw new Error(`login returned no session cookie: ${login.text.slice(0, 300)}`);
  }
  console.log(`account    : ${email}`);

  // THE FORCING PROFILE (M5). Celiac + soy walls, non-keto, 1.0 lb/wk. The
  // walls are what make the library thin enough that scaling alone cannot land
  // the day; the rate sets the bands. Kept here, in the frozen instrument, so
  // the profile cannot be softened after seeing a disappointing result.
  //
  // AMENDED 2026-07-29 on the owner's passphrase (ASK campaign.6b). Six FIELD
  // NAMES were wrong for this app and the profile could never have been set:
  // four were rejected outright by PUT /api/profile, and two — weightKg and
  // allergies — are not in PROFILE_FIELDS at all, so the request SUCCEEDED and
  // those values were silently discarded. `allergies` in particular was read by
  // nothing in backend/src, which means THE WALLS ABOVE HAVE NEVER EXISTED and
  // this profile has never forced anything. No prior measurement is invalidated,
  // because the witness had never completed an authenticated run to produce one.
  //
  // Every value below keeps its meaning: same trade and multiplier band, same
  // resistance training, same mass, same two walls, same rate. Nothing was
  // softened — this is the first time the profile bites. Verified whole against
  // the app's own validator (11 ok / 0 rejected / 0 dropped) BEFORE ratification;
  // re-runnable at docs/surgery/campaign-p2-m0/evidence/profile-field-check.js.
  // The clause is re-frozen at these bytes.
  const profile = {
    sex: 'M',
    age: 34,
    heightCm: 180,
    startWeightKg: 88,
    occupationKey: 'carpenter-finish',
    trainingStyle: 'weights',
    minutesPerSession: 60,
    rateLbPerWeek: 1.0,
    dietaryStyle: 'none',
    excludedFoods: ['gluten', 'soy'],
    unitPref: 'metric',
  };
  const prof = await api('PUT', '/api/profile', profile);
  if (prof.status >= 400) throw new Error(`profile failed ${prof.status}: ${prof.text.slice(0, 300)}`);
  console.log(`profile    : celiac+soy walls, non-keto, ${profile.rateLbPerWeek} lb/wk`);

  // ---- 7. the generate -----------------------------------------------------
  let gen = null;
  if (DRY) {
    console.log('generate   : SKIPPED (--dry-run). No model call, no spend.');
  } else {
    const startedAt = Date.now();
    gen = await api('POST', '/api/plans/generate', { horizon: 'week' });
    const elapsed = Date.now() - startedAt;
    console.log(`generate   : status=${gen.status} elapsed=${elapsed}ms`);
    const evidence = path.join(
      REPO, 'docs', 'surgery', process.env.WITNESS_RUN_ID || 'CURRENT', 'evidence'
    );
    try {
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(path.join(evidence, `witness-${LABEL}-response.json`), gen.text);
      console.log(`response   : written to ${path.join(evidence, `witness-${LABEL}-response.json`)}`);
    } catch (e) {
      console.log(`response   : NOT written (${e.message})`);
    }
  }

  // ---- 8. t1 + post-snapshot ----------------------------------------------
  const t1 = new Date().toISOString();
  console.log(`t1         : ${t1}`);

  shutdown();

  const deltaArgs = pre ? ['--after-id', pre.id] : ['--since', t0];
  const deltaText = ledgerDelta(deltaArgs.concat(['--since', t0, '--until', t1]));
  console.log('\n-- ledger-delta.js (machine numbers, not the model\'s arithmetic) --');
  console.log(deltaText.trim());

  // ---- 9. cap verdicts -----------------------------------------------------
  const rowsMatch = /delta\s*:\s*(\d+) row/.exec(deltaText);
  const costMatch = /delta\s*:\s*\d+ row\(s\), \$([0-9.]+)/.exec(deltaText);
  const calls = rowsMatch ? Number(rowsMatch[1]) : null;
  const dollars = costMatch ? Number(costMatch[1]) : null;

  console.log('\n-- CAP VERDICTS --');
  const verdicts = [
    ['calls', calls, CAP_CALLS],
    ['dollars', dollars, CAP_USD],
  ];
  let breached = 0;
  for (const [name, got, cap] of verdicts) {
    if (got === null) {
      console.log(`  ${name}: UNREADABLE from ledger-delta output — treat as a breach`);
      breached++;
    } else if (got > cap) {
      console.log(`  ${name}: ${got} > ${cap}  BREACH`);
      breached++;
    } else {
      console.log(`  ${name}: ${got} <= ${cap}  ok`);
    }
  }
  console.log(`\nbackup kept at: ${backup}`);
  console.log(breached === 0 ? '== WITNESS COMPLETE ==' : `== WITNESS COMPLETE WITH ${breached} CAP BREACH(ES) ==`);

  await prisma.$disconnect();
  process.exit(breached === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\nWITNESS FAILED: ${e && e.message}`);
  // Kill the child FIRST, then disconnect. The reverse order is what aborted
  // libuv and produced exit 127 — an exit code that made a crash and a cap
  // breach indistinguishable.
  shutdown();
  try {
    await prisma.$disconnect();
  } catch {
    /* already down */
  }
  // exitCode, NOT process.exit(). Forcing exit here aborted libuv mid-teardown
  // — first as 127, then as a raw Windows abort — because the Prisma engine and
  // the killed child were still unwinding. Setting the code and letting the loop
  // drain gets the same answer without racing the runtime, and a failure that
  // reports 1 is the whole point: a crash and a cap breach must never share an
  // exit code.
  process.exitCode = 1;
});
