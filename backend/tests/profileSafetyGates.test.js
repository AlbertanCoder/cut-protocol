const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateProfileFields, validateProfilePatch, adultGate, goalWeightGate, SAFETY_GATES,
} = require("../src/routes/profile.js");
const { computeEnergy, deriveTarget, computeMacros } = require("../src/lib/bmrEngine.js");

// ─────────────────────────────────────────────────────────────────────────
// The two things this app could do to a stranger that it could not take back:
// prescribe a cut to a child, and prescribe a cut toward a weight nobody
// should be steering someone to. Neither had a gate. These lock both.
//
// The owner is the only adult user today, so this was never a live risk to
// him — it becomes one the moment anyone else installs it, and one outside
// tester already has.
// ─────────────────────────────────────────────────────────────────────────

// ── 1. THE 14-YEAR-OLD ───────────────────────────────────────────────────

test("the number that makes this necessary: the engine really does prescribe 1,212 kcal to a 14yo girl", () => {
  // Not a hypothetical. This is the live engine, on the rate menu's own top
  // option, with nothing patched out.
  const girl = {
    sex: "F", age: 14, heightCm: 160, bodyFatPct: 0,
    occupationKey: "student", activityOverride: null,
    sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
    rateLbPerWeek: 2.0, floorKcal: null, excludedFormulas: [], dietaryStyle: null,
  };
  const e = computeEnergy(girl, 50);
  const t = deriveTarget(girl, e.tdee, e.rmr);
  const m = computeMacros(girl, 50, t.target);

  assert.equal(t.target, 1212, "50 kg / 160 cm / 2.0 lb-wk lands on 1,212 kcal");
  assert.equal(m.proteinLo, 90);
  assert.equal(m.proteinHi, 99);
  // She has no body fat on file, so the GRADED floor comes off bodyweight
  // (50 kg x 1.6 = 80 g) rather than off an assumed 28%. The prescribed band is
  // unchanged. Not the subject of this test — the 1,212 kcal is — but pinned so
  // the floor policy cannot drift here silently.
  assert.equal(m.proteinFloorG, 80);
  // Adolescent EER is roughly 1,800-2,200. The engine is ~600-1,000 under it
  // and has no growth term with which to know that.
  assert.ok(t.target < 1500, "and it is far under any published adolescent requirement");

  const boy = { ...girl, sex: "M" };
  const eb = computeEnergy(boy, 60);
  assert.equal(deriveTarget(boy, eb.tdee, eb.rmr).target, 1500, "a 14yo boy at 60 kg gets 1,500");
});

test("adultGate refuses every age under 18 and nothing at or over it", () => {
  assert.equal(SAFETY_GATES.ADULT_MIN_AGE, 18);
  for (const age of [5, 12, 13, 14, 15, 16, 17, 17.9]) {
    const g = adultGate({ age });
    assert.ok(g, `age ${age} must be refused`);
    assert.equal(g.gate, "adult-only");
    assert.match(g.error, /under 18/);
    assert.ok(Array.isArray(g.detail) && g.detail.length >= 2, "the refusal explains itself");
    assert.ok(g.whatNow, "and says what to do if the age was a typo");
  }
  for (const age of [18, 19, 30, 64, 100]) {
    assert.equal(adultGate({ age }), null, `age ${age} must pass`);
  }
});

test("adultGate reads the MERGED row, so an under-18 profile can't edit around it", () => {
  // The route runs this on { ...existing, ...patch }. A minor changing their
  // dietary style sends no age at all — the gate still has to fire.
  assert.ok(adultGate({ age: 15, dietaryStyle: "keto" }), "existing age 15 + unrelated patch is still refused");
  // …and correcting the age upward is the one edit that gets through.
  assert.equal(adultGate({ age: 22 }), null);
});

test("adultGate is not fooled by a missing or junk age", () => {
  // A row with no usable age can't be judged a minor; validation owns that
  // case, and refusing here would lock people out on a null.
  for (const age of [undefined, null, "16", NaN]) {
    assert.equal(adultGate({ age }), null, `age ${JSON.stringify(age)} is validation's problem, not the gate's`);
  }
});

test("the age BOUND stays 14 on purpose — the GATE, not a range error, answers a 15-year-old", () => {
  // A "must be between 18 and 100" range error reads as a typo notice. The
  // person is not mistyping; they are 15, and they deserve the real answer.
  assert.deepEqual(validateProfileFields({ age: 15 }), {}, "15 is a well-formed age…");
  assert.ok(adultGate({ age: 15 }), "…and is refused by the gate instead");
  // Genuinely malformed ages are still field errors.
  assert.ok(validateProfileFields({ age: 200 }).age);
  assert.ok(validateProfileFields({ age: "thirty" }).age);
});

// ── 2. THE GOAL WEIGHT NOBODY CHECKED ────────────────────────────────────

const at = (heightCm, goalWeightKg) => goalWeightGate({ heightCm, goalWeightKg }, { goalWeightKg });

test("the reported case: 170 cm with a 40 kg goal (BMI 13.8) is refused outright", () => {
  const g = at(170, 40);
  assert.ok(g?.refuse, "BMI 13.8 must be refused, not warned");
  assert.equal(g.body.gate, "goal-weight-floor");
  assert.match(g.body.error, /BMI of 13\.8/);
  // The refusal is actionable: it names the lowest goal it WILL take.
  // 46.3, not 46.2: BMI 16 at 170 cm is 46.24 kg, and the shown minimum
  // rounds UP so the number the message quotes actually passes the gate —
  // 46.2 computes BMI 15.99 and was refused when customers typed it back
  // (fleet, 2026-08-20).
  assert.match(g.body.fields.goalWeightKg, /46\.3 kg/);
  assert.ok(!g.body.requiresAck, "there is no tick-box past this one");
});

test("the three bands, at 170 cm", () => {
  assert.equal(SAFETY_GATES.GOAL_BMI_REFUSE, 16.0);
  assert.equal(SAFETY_GATES.GOAL_BMI_ACK, 18.5);
  // BMI 18.5 at 170 cm = 53.47 kg; BMI 16 = 46.24 kg.
  assert.equal(at(170, 60), null, "BMI 20.8 — nothing happens");
  assert.equal(at(170, 53.5), null, "BMI 18.5 — the boundary is inclusive, nothing happens");
  assert.ok(at(170, 52)?.needsAck, "BMI 18.0 — grey zone, explain and ask");
  assert.ok(at(170, 47)?.needsAck, "BMI 16.3 — still the grey zone");
  assert.ok(at(170, 46)?.refuse, "BMI 15.9 — refused");
  assert.ok(at(170, 30)?.refuse);
});

test("the grey-zone warning argues its own case instead of just blocking", () => {
  const g = at(170, 50); // BMI 17.3
  assert.ok(g.needsAck);
  assert.equal(g.body.ack, "goalWeight", "named, so it can't be answered with a rate acknowledgement");
  assert.equal(g.body.requiresAck, true);
  const text = g.body.reasons.join(" ");
  // Non-moralising and honest about what BMI is: the finding was that nothing
  // in the app knew what a healthy weight was, not that it needed a scolding.
  assert.match(text, /BMI knows nothing about your frame/i);
  assert.match(text, /penalises short people/i);
  assert.match(text, /prompt to think, not a verdict/i);
  // Symptoms beat the statistic — including above the band.
  assert.match(text, /strength going backwards|sleep breaking up|periods/i);
  assert.ok(!/unhealthy|dangerous weight|too thin/i.test(text), "no verdicts about the person");
});

test("BMI is measured on the GOAL, never on the weight someone actually is", () => {
  // A real weight is a fact. Refusing to record it is how a tracker becomes
  // something you lie to.
  assert.equal(goalWeightGate({ heightCm: 170, goalWeightKg: 70, startWeightKg: 40 }, { startWeightKg: 40 }), null);
  assert.deepEqual(validateProfileFields({ startWeightKg: 40 }), {}, "a 40 kg start weight saves without comment");
});

test("the gate stays out of the way of edits that aren't about the goal", () => {
  const lowGoal = { heightCm: 170, goalWeightKg: 40 };
  assert.equal(goalWeightGate(lowGoal, { dietaryStyle: "vegan" }), null);
  assert.equal(goalWeightGate(lowGoal, { sessionsPerWeek: 4 }), null);
  assert.equal(goalWeightGate(lowGoal, { rateLbPerWeek: 1.0 }), null);
});

test("correcting a HEIGHT that exposes an unsafe saved goal asks, rather than trapping the user", () => {
  // Height is a fact being fixed. Hard-refusing the correction would leave
  // BOTH the wrong height and the unsafe goal in place — so this downgrades
  // to the acknowledgement path and names the goal as the thing to move.
  const g = goalWeightGate({ heightCm: 190, goalWeightKg: 40 }, { heightCm: 190 }); // BMI 11.1
  assert.ok(g?.needsAck, "not refused — the height edit must be able to land");
  assert.ok(!g.refuse);
  assert.match(g.body.reasons[0], /raise the goal/i);
  // But once they touch the goal itself at that height, the floor is absolute.
  assert.ok(goalWeightGate({ heightCm: 190, goalWeightKg: 40 }, { goalWeightKg: 40 })?.refuse);
});

test("an unmeasurable BMI is never guessed at", () => {
  assert.equal(goalWeightGate({ heightCm: 0, goalWeightKg: 40 }, { goalWeightKg: 40 }), null);
  assert.equal(goalWeightGate({ heightCm: 170, goalWeightKg: null }, { goalWeightKg: null }), null);
  assert.equal(goalWeightGate({}, { goalWeightKg: 40 }), null);
});

test("the 422 names the literal acknowledgement field — customers must not have to guess it", () => {
  // 84 of 250 fleet customers (2026-08-20) never saved a profile because the
  // response asked for "the matching acknowledgement flag" without saying
  // which field that is. Every plausible guess re-served the same 422.
  const g = at(170, 50);
  assert.ok(g?.needsAck);
  assert.equal(g.body.ackField, "goalWeightAcknowledged");
  assert.match(g.body.howToConfirm, /"goalWeightAcknowledged": true/);
  assert.match(g.body.howToConfirm, /Nothing from this request was saved/i);
});

test("every kg minimum a gate quotes passes the gate that quotes it", () => {
  // The property behind the 46.3 fix, swept across the fleet's height range:
  // the refusal's "lowest goal this app will take" must not itself be refused,
  // and the "where the usual range starts" number must save without a prompt.
  for (let h = 150; h <= 210; h += 2) {
    const refuse = at(h, 30);
    assert.ok(refuse?.refuse, `30 kg at ${h} cm should be refused`);
    const floorKg = parseFloat(refuse.body.fields.goalWeightKg.match(/(\d+(?:\.\d+)?) kg/)[1]);
    const retry = at(h, floorKg);
    assert.ok(!retry?.refuse, `${floorKg} kg at ${h} cm was quoted as the lowest accepted goal and then refused`);
    if (retry?.needsAck) {
      const m = retry.body.reasons[0].match(/about (\d+(?:\.\d+)?) kg/);
      if (m) {
        const ackKg = parseFloat(m[1]);
        assert.equal(at(h, ackKg), null, `${ackKg} kg at ${h} cm was quoted as where the range starts and still prompted`);
      }
    }
  }
});

test("gainDirectionGate tells the truth about what 'set a maintenance goal' will do at this height", () => {
  const { gainDirectionGate } = require("../src/routes/profile.js");
  const gain = (heightCm, startWeightKg, goalWeightKg) =>
    gainDirectionGate({ heightCm, startWeightKg, goalWeightKg, rateLbPerWeek: 0.5 }, { goalWeightKg });

  // Current BMI under 16: a maintenance goal would be refused too — the gate
  // must say there is no prescribable goal, not advise a bounce.
  const trapped = gain(195, 55, 60);
  assert.ok(trapped, "goal above current fires the gate");
  assert.match(trapped.whatNow, /no prescribable goal/i);
  assert.match(trapped.detail[2], /maintenance goal would be refused/i);

  // Current BMI 16–18.5: maintenance works via the confirm prompt — say so,
  // and name the field that completes it.
  const grey = gain(170, 50, 55); // current BMI 17.3
  assert.match(grey.detail[2], /"goalWeightAcknowledged": true/);
  assert.match(grey.detail[2], /maintenance/i);

  // Normal-range current weight: the original advice stands.
  const normal = gain(170, 70, 80);
  assert.match(normal.whatNow, /at or below 70 kg/);
});

test("the floor scales with height — it is a ratio, not a fixed number of kilos", () => {
  // 150 cm: BMI 16 = 36 kg. 200 cm: BMI 16 = 64 kg. A single kg threshold
  // would be wrong for almost everyone.
  assert.ok(at(150, 37)?.needsAck, "37 kg at 150 cm is BMI 16.4 — grey zone, not refused");
  assert.ok(at(150, 35)?.refuse, "35 kg at 150 cm is BMI 15.6 — refused");
  assert.ok(at(200, 60)?.refuse, "60 kg at 200 cm is BMI 15.0 — refused, though 60 kg is fine at 170");
  assert.equal(at(170, 60), null);
});

// ── 3. VALIDATION MESSAGES ARE FOR PEOPLE ────────────────────────────────

test("validation answers with per-field sentences, not a semicolon-joined key dump", () => {
  const f = validateProfileFields({ heightCm: 12, goalWeightKg: 4 });
  assert.deepEqual(Object.keys(f).sort(), ["goalWeightKg", "heightCm"]);
  // The exact strings from the finding must be gone.
  assert.notEqual(f.heightCm, "heightCm must be a number between 100 and 250");
  assert.notEqual(f.goalWeightKg, "goalWeightKg must be a number between 30 and 400 kg");
});

test("no message names a column, prints an enum union, or leaves a unit untranslated", () => {
  const everyBadPatch = {
    mealsPerDay: 99, snacksPerDay: 99, sex: "X", occupationKey: "astronaut",
    trainingStyle: "vibes", minutesPerSession: 9999, sessionsPerWeek: 99,
    activityOverride: 9, rateLbPerWeek: 7, unitPref: "furlongs",
    dietaryStyle: "breatharian", excludedFormulas: ["nope"], age: 900,
    heightCm: 1, bodyFatPct: 900, bodyFatSource: "vibes",
    startWeightKg: 1, goalWeightKg: 1, excludedFoods: [5],
  };
  const f = validateProfileFields(everyBadPatch);
  assert.equal(Object.keys(f).length, Object.keys(everyBadPatch).length, "every bad field gets its own message");

  for (const [key, msg] of Object.entries(f)) {
    assert.ok(!msg.includes("|"), `${key}: pipe-separated enum union leaked into "${msg}"`);
    // No identifier may appear in prose. `age`/`sex` are ordinary English
    // words and are fine; anything camelCase is a column name, always.
    assert.ok(!/\b[a-z]+[A-Z][A-Za-z]*\b/.test(msg), `${key}: a column name leaked into "${msg}"`);
    assert.match(msg, /[.!?]$/, `${key}: not a sentence — "${msg}"`);
    assert.match(msg, /^[A-Z]/, `${key}: not a sentence — "${msg}"`);
    // Anything quoting kg or cm must give the user's other unit too.
    if (/\d\s*kg\b/.test(msg)) assert.match(msg, /lb\b/, `${key} quotes kg without lb — "${msg}"`);
    if (/\d\s*cm\b/.test(msg)) assert.match(msg, /ft\b/, `${key} quotes cm without ft — "${msg}"`);
  }
});

test("the log shape still carries the field key, because a log line is not a screen", () => {
  const lines = validateProfilePatch({ heightCm: 12 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^heightCm: /);
});

test("a clean patch produces no messages at all", () => {
  assert.deepEqual(validateProfileFields({}), {});
  assert.deepEqual(validateProfileFields({ age: 33, heightCm: 182, goalWeightKg: 79 }), {});
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 4. THE GATES OVER REAL HTTP
//
// Everything above tests the functions. This tests THE RULE â€” that a client
// which never opens the wizard cannot get past it either. The desktop build
// ships an Express API on loopback; the wizard is one caller of it, not the
// only one, and "the UI stops you" is not a safety property.
//
// Same harness as auth.registration.test.js: a throwaway SQLite file in the OS
// temp dir with every shipped migration applied and zero rows in it. Never the
// developer's dev.db.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");
const EMAIL = "gates@example.test";
const PASSWORD = "correct-horse-battery";

let tmpDir, dbFile, app, srv, base, prisma, cookie;

function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  assert.ok(names.length > 0, "no migrations found â€” cannot build a fresh-install DB");
  const db = new DatabaseSync(file);
  try {
    for (const name of names) db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  } finally {
    db.close();
  }
}

async function call(method, p, { body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body kept in text */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

const putProfile = (body) => call("PUT", "/api/profile", { body });

// An adult profile the gates are happy with, used as the starting point.
// 0.5 lb/wk deliberately: at 1.0 this person's target floor-clamps, which is
// its own (correct) 422 and would mask what these tests are actually about.
const ADULT = {
  unitPref: "metric", sex: "F", age: 30, heightCm: 170,
  startWeightKg: 70, goalWeightKg: 62,
  occupationKey: "desk-office", sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
  rateLbPerWeek: 0.5,
};

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-gates-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  // Set BEFORE requiring server.js â€” prisma.js resolves DATABASE_URL at module
  // load. This is also what keeps the developer's real dev.db and JWT_SECRET
  // out of this process entirely.
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "profile-safety-gates-test-only-secret"; // scan:allow â€” fixture, never a real secret
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const reg = await call("POST", "/api/auth/register", { body: { email: EMAIL, password: PASSWORD, confirmPassword: PASSWORD } });
  assert.ok(reg.status === 200 || reg.status === 201, `register failed (${reg.status}): ${reg.text}`);
  cookie = (reg.setCookie || "").split(";")[0];
  assert.ok(cookie, "no session cookie");
});

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("HTTP: an adult profile saves normally â€” the gates are not in the way", async () => {
  const r = await putProfile(ADULT);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.age, 30);
  assert.equal(r.json.goalWeightKg, 62);
});

test("HTTP: the 14-year-old is refused with 403 and never reaches the engine", async () => {
  const r = await putProfile({ age: 14 });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.gate, "adult-only");
  assert.match(r.json.error, /under 18/);
  const after = await call("GET", "/api/profile");
  assert.equal(after.json.age, 30, "the refused age must not have been written");
});

test("HTTP: 15, 16 and 17 are refused too â€” 14 was not a magic number", async () => {
  for (const age of [15, 16, 17]) {
    assert.equal((await putProfile({ age })).status, 403, `age ${age} got through`);
  }
  assert.equal((await putProfile({ age: 18 })).status, 200, "18 must be accepted");
  await putProfile({ age: 30 }); // restore
});

test("HTTP: the BMI-13.8 goal (170 cm, 40 kg) is refused with a per-field message", async () => {
  const r = await putProfile({ goalWeightKg: 40 });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.gate, "goal-weight-floor");
  assert.match(r.json.error, /BMI of 13\.8/);
  assert.match(r.json.fields.goalWeightKg, /46\.3 kg/); // rounds UP — see the unit test
  const after = await call("GET", "/api/profile");
  assert.equal(after.json.goalWeightKg, 62, "the refused goal must not have been written");
});

test("HTTP: a refused goal cannot be forced with the acknowledgement flag", async () => {
  const r = await putProfile({ goalWeightKg: 40, goalWeightAcknowledged: true });
  assert.equal(r.status, 400, "below the hard floor there is no tick-box");
  assert.equal(r.json.gate, "goal-weight-floor");
});

test("HTTP: a grey-zone goal (BMI 17.3) asks once, then saves on the acknowledgement", async () => {
  const asked = await putProfile({ goalWeightKg: 50 });
  assert.equal(asked.status, 422, asked.text);
  assert.equal(asked.json.requiresAck, true);
  assert.equal(asked.json.ack, "goalWeight", "must be distinguishable from the rate ack");
  assert.equal(asked.json.ackField, "goalWeightAcknowledged", "the literal field, over HTTP too");

  const saved = await putProfile({ goalWeightKg: 50, goalWeightAcknowledged: true });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.goalWeightKg, 50);
  // Request-only: there is no column for it and none was invented.
  assert.equal(saved.json.goalWeightAcknowledged, undefined);
  await putProfile({ goalWeightKg: 62, goalWeightAcknowledged: true }); // restore
});

test("HTTP: a real weight is never refused, however low â€” only the goal is gated", async () => {
  const r = await putProfile({ startWeightKg: 42 });
  assert.equal(r.status, 200, "a tracker you cannot tell the truth to is worthless");
  await putProfile({ startWeightKg: 70 });
});

test("HTTP: a GAIN ask from a lean body gets the gain answer, not the BMI answer", async () => {
  // 45 kg at 170 cm asking for 50 kg: the goal is a gain AND under BMI 18.5.
  // The old gate order answered with "won't prescribe a deficit down to it"
  // for a goal ABOVE their weight. The gain gate must speak first.
  await putProfile({ startWeightKg: 45 });
  const r = await putProfile({ goalWeightKg: 50 });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.gate, "gain-not-supported", `got ${r.json.gate}: ${r.json.error}`);
  // At BMI 15.6 current, the advice is honest about the dead zone.
  assert.match(r.json.whatNow, /no prescribable goal/i);
  await putProfile({ startWeightKg: 70 }); // restore
});

test("HTTP: 2 lb/wk still forces the rate acknowledgement, and says which ack it wants", async () => {
  const asked = await putProfile({ rateLbPerWeek: 2.0 });
  assert.equal(asked.status, 422, asked.text);
  assert.equal(asked.json.requiresAck, true);
  assert.equal(asked.json.ack, "rate");
  assert.equal(asked.json.ackField, "rateAcknowledged", "the literal field, not a riddle");
  assert.match(asked.json.howToConfirm, /"rateAcknowledged": true/);
  assert.ok(asked.json.reasons.length > 0);

  const saved = await putProfile({ rateLbPerWeek: 2.0, rateAcknowledged: true });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.rateAcknowledged, true);
  await putProfile({ rateLbPerWeek: 0.5 });
});

test("HTTP: the rate 422 no longer holds allergies and dietary style hostage", async () => {
  // The fleet's worst pattern (2026-08-20): one PUT carrying everything, the
  // rate needs an ack the customer never resolves, and their EXCLUSIONS die
  // with it. The rate is the last gate — the rest must save.
  const asked = await putProfile({ rateLbPerWeek: 2.0, dietaryStyle: "vegan", excludedFoods: ["shellfish"] });
  assert.equal(asked.status, 422, asked.text);
  assert.ok(asked.json.applied.includes("dietaryStyle"), `applied: ${JSON.stringify(asked.json.applied)}`);
  assert.match(asked.json.howToConfirm, /Everything else in this request was saved/i);

  const after = await call("GET", "/api/profile");
  assert.equal(after.json.dietaryStyle, "vegan", "the safety data must have been written");
  assert.deepEqual(after.json.excludedFoods, ["shellfish"]);
  assert.equal(after.json.rateLbPerWeek, 0.5, "the unacknowledged rate must NOT have been written");
  await putProfile({ dietaryStyle: null, excludedFoods: [] }); // restore
});

test("HTTP: a first PUT with an unsafe rate still creates the profile, at a safe seeded rate", async () => {
  // A brand-new customer whose single onboarding PUT trips the rate ack used
  // to end the session with no profile at all. Now the row exists with their
  // safety data, holding the fastest rate that needs no acknowledgement.
  const bcrypt = require(path.join(BACKEND, "node_modules", "bcryptjs"));
  const fresh = await prisma.user.create({
    data: { email: "first-put@example.test", passwordHash: bcrypt.hashSync(PASSWORD, 4), role: "user" },
  });
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "first-put@example.test", password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const freshCookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const put = await fetch(base + "/api/profile", {
    method: "PUT", headers: { "content-type": "application/json", cookie: freshCookie },
    body: JSON.stringify({
      unitPref: "metric", sex: "F", age: 30, heightCm: 170, startWeightKg: 70, goalWeightKg: 62,
      occupationKey: "desk-office", sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
      rateLbPerWeek: 2.0, dietaryStyle: "vegetarian", excludedFoods: ["eggs"],
    }),
  });
  assert.equal(put.status, 422, await put.text());

  const row = await prisma.profile.findUnique({ where: { userId: fresh.id } });
  assert.ok(row, "the profile must exist despite the unresolved ack");
  assert.equal(row.dietaryStyle, "vegetarian");
  assert.deepEqual(JSON.parse(JSON.stringify(row.excludedFoods)), ["eggs"]);
  assert.notEqual(row.rateLbPerWeek, 2.0, "the unacknowledged rate must not be stored");
  // The seeded rate itself passes the gate it was seeded around: resending it
  // unchanged draws no 422.
  const resend = await fetch(base + "/api/profile", {
    method: "PUT", headers: { "content-type": "application/json", cookie: freshCookie },
    body: JSON.stringify({ rateLbPerWeek: row.rateLbPerWeek }),
  });
  assert.equal(resend.status, 200, await resend.text());
});

test("HTTP: a bad field comes back as a message under that field, not a key dump", async () => {
  const r = await putProfile({ heightCm: 12, goalWeightKg: 4 });
  assert.equal(r.status, 400);
  assert.ok(r.json.fields.heightCm && r.json.fields.goalWeightKg);
  assert.ok(!r.json.error.includes(";"), `error is still a joined dump: ${r.json.error}`);
  assert.ok(!r.json.error.includes("heightCm"), `error names a column: ${r.json.error}`);
});

test("HTTP: /meta serves the gate thresholds, so no client has to hardcode 18", async () => {
  const r = await call("GET", "/api/profile/meta");
  assert.equal(r.status, 200);
  assert.equal(r.json.limits.adultMinAge, 18);
  assert.equal(r.json.limits.goalBmi.refusedBelow, 16);
  assert.equal(r.json.limits.goalBmi.needsAckBelow, 18.5);
  assert.equal(r.json.limits.heightCm.min, 100);
});

