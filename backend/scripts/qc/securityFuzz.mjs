// QC gauntlet v2 — Phase 3 security expansion: IDOR / injection / ED-safety.
//
//   node scripts/qc/securityFuzz.mjs [--assert]
//
// Mounts the REAL app on an ephemeral port against a THROWAWAY DB copy with TWO
// seeded accounts. Threat model: the API binds loopback only (desktop app), so
// cross-account access is the "multiple profiles on one machine" risk — still
// tested. Checks:
//   IDOR       — account B's session must not read or delete account A's
//                weigh-ins / diary entries.
//   INJECTION  — Prisma-operator objects ({"$ne":null}) and SQL meta-chars in
//                auth + free-text fields must not bypass or 500.
//   ED-SAFETY  — no write path may produce a target below the sex floor; extreme
//                rates clamp, they don't breach.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..", "..");
const REPO = path.resolve(BACKEND, "..");
const ASSERT = process.argv.includes("--assert");

const liveDb = path.join(BACKEND, "prisma", "dev.db");
const fuzzDb = path.join(BACKEND, "prisma", "dev.db.qcsec");
for (const s of ["", "-journal", "-wal", "-shm"]) { try { fs.rmSync(fuzzDb + s, { force: true }); } catch {} }
fs.copyFileSync(liveDb, fuzzDb);
process.env.DATABASE_URL = `file:${fuzzDb.replace(/\\/g, "/")}`;
process.env.QC_NO_LISTEN = "1";
process.env.BRAIN = "off";
delete process.env.ANTHROPIC_API_KEY;

const app = require(path.join(BACKEND, "server.js"));
const { prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js"));
const { hashPassword } = require(path.join(BACKEND, "src", "lib", "auth.js"));

const findings = [];
const add = (sev, kind, detail) => findings.push({ sev, kind, detail });
let base;
async function req(method, p, { body, cookie, timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {}; let payload;
    if (body !== undefined) { headers["content-type"] = "application/json"; payload = typeof body === "string" ? body : JSON.stringify(body); }
    if (cookie) headers.cookie = cookie;
    const r = await fetch(base + p, { method, headers, body: payload, signal: ctrl.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json, setCookie: r.headers.get("set-cookie") };
  } catch (e) { return { status: e.name === "AbortError" ? 0 : -1, text: String(e.message || e), hang: e.name === "AbortError" }; }
  finally { clearTimeout(timer); }
}
const cookieOf = (r) => (r.setCookie || "").split(";")[0];

async function mkUser(email) {
  const passwordHash = await hashPassword("qc-sec-pw-1");
  const user = await prisma.user.create({ data: { email, passwordHash, role: "user" } });
  const donor = await prisma.profile.findFirst();
  if (donor) { const { id, userId, ...rest } = donor; await prisma.profile.create({ data: { ...rest, userId: user.id, sex: "F", rateLbPerWeek: 1.0 } }); }
  return user;
}

async function main() {
  const A = await mkUser(`qc-sec-a-${Date.now()}@local`);
  const B = await mkUser(`qc-sec-b-${Date.now()}@local`);
  const srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const cookieA = cookieOf(await req("POST", "/api/auth/login", { body: { email: A.email, password: "qc-sec-pw-1" } }));
  const cookieB = cookieOf(await req("POST", "/api/auth/login", { body: { email: B.email, password: "qc-sec-pw-1" } }));

  // ── IDOR: A creates data; B must not touch it ──────────────────────────
  await req("POST", "/api/weighins", { body: { date: "2026-07-01", weightKg: 80 }, cookie: cookieA });
  const aDiary = await req("POST", "/api/diary/entry", { body: { name: "A private meal", kcal: 500, protein: 30, fat: 10, carb: 40 }, cookie: cookieA });
  const aEntryId = aDiary.json?.id || aDiary.json?.entry?.id;

  // B tries to delete A's weigh-in and diary entry
  const bDelWeigh = await req("DELETE", "/api/weighins/2026-07-01", { cookie: cookieB });
  const bDelDiary = aEntryId ? await req("DELETE", `/api/diary/entry/${aEntryId}`, { cookie: cookieB }) : { status: "n/a" };
  // A's data must survive
  const aWeighins = await req("GET", "/api/weighins", { cookie: cookieA });
  const aStillHasWeigh = (aWeighins.json || aWeighins.json?.weighins || []).length ? true : /2026-07-01/.test(aWeighins.text);
  if (bDelWeigh.status >= 200 && bDelWeigh.status < 300 && !aStillHasWeigh) add("P0", "idor-weighin-delete", `B deleted A's weigh-in (status ${bDelWeigh.status})`);
  if (bDelDiary.status >= 200 && bDelDiary.status < 300) {
    const check = await req("GET", "/api/diary/2026-07-01", { cookie: cookieA });
    if (!/A private meal/.test(check.text)) add("P0", "idor-diary-delete", `B deleted A's diary entry ${aEntryId} (status ${bDelDiary.status})`);
  }
  // B tries to read A's data via A's ids where routes expose them
  const bReadA = await req("GET", "/api/diary/2026-07-01", { cookie: cookieB });
  if (/A private meal/.test(bReadA.text)) add("P0", "idor-diary-read", "B read A's diary through the date route");

  // ── INJECTION: Prisma-operator objects + SQL meta in auth/free-text ────
  for (const bad of [{ email: { $ne: null }, password: "x" }, { email: { $gt: "" }, password: { $ne: null } }, { email: "a@b.com'--", password: "x" }]) {
    const r = await req("POST", "/api/auth/login", { body: bad, cookie: undefined });
    if (r.status >= 500 || r.hang) add("P1", "injection-login-500", `operator/meta login -> ${r.status}`);
    if (r.status >= 200 && r.status < 300 && r.setCookie) add("P0", "injection-auth-bypass", `operator login returned a session: ${JSON.stringify(bad)}`);
  }
  // operator object in a free-text create field (must be validated/stringified, not a where-clause)
  const inj = await req("POST", "/api/foods", { body: { name: { $ne: null }, kcal: 100, protein: 5, fat: 2, carb: 10 }, cookie: cookieA });
  if (inj.status >= 500 || inj.hang) add("P1", "injection-food-500", `operator name -> ${inj.status}`);

  // ── ED-SAFETY: no write path yields a sub-floor target ─────────────────
  const SEX_FLOOR = { M: 1500, F: 1200 };
  for (const rate of [2.0, 5, 99]) {
    const put = await req("PUT", "/api/profile", { body: { rateLbPerWeek: rate, rateAcknowledged: true }, cookie: cookieA });
    const prof = await req("GET", "/api/profile", { cookie: cookieA });
    const target = prof.json?.targetKcal ?? prof.json?.profile?.targetKcal;
    if (typeof target === "number" && target < SEX_FLOOR.F - 1) add("P0", "ed-subfloor-target", `rate ${rate} -> target ${target} below floor ${SEX_FLOOR.F}`);
    void put;
  }
  // attempt a stricter-than-safe floor and an absurd unit weight
  const lowFloor = await req("PUT", "/api/profile", { body: { floorKcal: 300 }, cookie: cookieA });
  const profAfter = await req("GET", "/api/profile", { cookie: cookieA });
  const t2 = profAfter.json?.targetKcal ?? profAfter.json?.profile?.targetKcal;
  if (typeof t2 === "number" && t2 < SEX_FLOOR.F - 1) add("P0", "ed-subfloor-via-floorkcal", `floorKcal 300 -> target ${t2}`);
  void lowFloor;

  srv.close(); await prisma.$disconnect();
  for (const s of ["", "-journal", "-wal", "-shm"]) { try { fs.rmSync(fuzzDb + s, { force: true }); } catch {} }

  const P0 = findings.filter((f) => f.sev === "P0"), P1 = findings.filter((f) => f.sev === "P1");
  const L = [];
  L.push(`# Cut Protocol — security fuzz (IDOR / injection / ED-safety)`);
  L.push("");
  L.push(`- Real app, ephemeral port, throwaway DB (deleted), two seeded accounts. Threat model: loopback-only -> cross-account = multi-profile-on-one-machine.`);
  L.push(`- Findings: **${P0.length} P0**, ${P1.length} P1.`);
  L.push("");
  if (!findings.length) L.push(`No IDOR (B could not read or delete A's data), no auth bypass or 500 from operator/SQL-meta injection, and no write path produced a sub-floor target.`);
  else { L.push(`| sev | kind | detail |`); L.push(`|---|---|---|`); for (const f of [...P0, ...P1]) L.push(`| ${f.sev} | ${f.kind} | ${String(f.detail).replace(/\|/g, "\\|")} |`); }
  L.push("");
  L.push(`_Generated ${new Date().toISOString()}. npm run qc:security_`);
  const out = path.join(REPO, "docs", "qc"); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "security-fuzz-report.md"), L.join("\n") + "\n");
  const fstream = fs.createWriteStream(path.join(out, "failures.jsonl"), { flags: "a" });
  for (const f of findings) fstream.write(JSON.stringify({ phase: "security", ...f }) + "\n"); fstream.end();

  console.log(`\nSECURITY FUZZ: ${P0.length} P0, ${P1.length} P1`);
  for (const f of findings) console.log(`  [${f.sev}] ${f.kind}: ${f.detail}`);
  console.log(`  report: docs/qc/security-fuzz-report.md`);
  if (ASSERT && P0.length) process.exit(1);
}
main().catch(async (e) => { console.error(e); try { await prisma.$disconnect(); } catch {} process.exit(1); });
