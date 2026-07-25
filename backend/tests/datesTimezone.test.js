"use strict";
// Cut Protocol — the timezone lock on the calendar-date helpers.
//
// WHY THIS FILE EXISTS (2026-07-24)
// The app had THREE independent definitions of "what day is it": the backend
// lib computed it in UTC, the frontend lib computed it in LOCAL time, and
// routes/weighins.js carried a private third copy of the UTC one. In Edmonton
// (UTC-6) the UTC answer is tomorrow's date every evening from 18:00 local
// until midnight — verified live on this machine, backend 2026-07-25 vs a
// local calendar reading 2026-07-24.
//
// That one-line disagreement was not cosmetic. It rolled TOMORROW's meals up
// under "today's plan", stamped profile.startDate a day ahead (permanently
// offsetting "Day N of protocol"), labelled the adaptive ledger with a
// Saturday as a "week of", let the WEEK 1 water-noise hold lift a day early,
// read staleDays = 1 for data logged minutes ago, and — through
// mondayOf(todayStr()) in six places in routes/plans.js — served NEXT week's
// meal plan every Sunday evening while Sunday's own meals sat unreachable
// behind "No meals planned for this week yet".
//
// A second, latent break lived in addDays(): it built a LOCAL noon Date and
// read it back through toISOString(), i.e. through UTC. East of UTC+12 local
// noon is the PREVIOUS day in UTC, so addDays(d, 0) returned d-1 and the whole
// checkpoint grid corrupted. Invisible in Edmonton, fatal in Auckland in
// January.
//
// HOW THIS FILE TESTS IT
// Faking the CLOCK is not enough for a timezone bug — the zone itself has to
// move. process.env.TZ is mutated per-case (V8 re-reads it), so every
// assertion below runs against a genuinely different runtime offset, including
// half-hour and quarter-hour zones, +14, -12, and a zone whose DST crosses
// UTC+0. Node's test runner gives each test FILE its own process, so the
// mutation cannot leak into another suite; it is restored after every case
// regardless.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const D = require("../src/lib/dates.js");

const BACKEND = path.resolve(__dirname, "..");
const FRONTEND_DATES = path.resolve(BACKEND, "../frontend/src/lib/dates.js");

// The zone this machine actually runs in. `delete process.env.TZ` does NOT put
// it back — V8 keeps the last value it was handed — so the original has to be
// written back explicitly.
const HOST_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const ZONES = [
  ["America/Edmonton", "UTC-6/-7 — the owner's zone, where the bug was observed"],
  ["UTC", "UTC+0 — the zone the old backend assumed everyone lived in"],
  ["Pacific/Auckland", "UTC+12/+13 — NZDT is where addDays(d, 0) returned d-1"],
  ["Asia/Kolkata", "UTC+5:30 — half-hour offset"],
  ["Asia/Kathmandu", "UTC+5:45 — quarter-hour offset"],
  ["Pacific/Kiritimati", "UTC+14 — the largest offset there is"],
  ["Etc/GMT+12", "UTC-12 — the largest negative offset (POSIX inverts the sign)"],
  ["Europe/London", "DST crosses UTC+0, which is where dayNum's rounding flipped"],
  ["Australia/Lord_Howe", "a 30-minute DST step"],
  ["America/Santiago", "DST transition at local midnight"],
];

// Instants chosen to land on both sides of local midnight in several zones, on
// both DST edges in the northern and southern hemispheres, and on the calendar
// edges (year boundary, leap day).
const INSTANTS = [
  Date.UTC(2026, 6, 25, 0, 10),   // 18:10 Jul 24 in Edmonton — the exact drift window
  Date.UTC(2026, 6, 25, 5, 59),   // 23:59 Jul 24 in Edmonton
  Date.UTC(2026, 6, 25, 6, 0),    // 00:00 Jul 25 in Edmonton
  Date.UTC(2026, 0, 15, 11, 30),  // 00:30 Jan 16 in NZDT (UTC+13)
  Date.UTC(2026, 0, 1, 10, 0),    // 00:00 Jan 2 on Kiritimati (UTC+14)
  Date.UTC(2026, 11, 31, 23, 59), // year boundary
  Date.UTC(2024, 1, 29, 18, 0),   // leap day
  Date.UTC(2026, 2, 8, 9, 0),     // US spring forward
  Date.UTC(2026, 10, 1, 8, 0),    // US fall back
  Date.UTC(2026, 2, 29, 1, 30),   // EU spring forward
  Date.UTC(2026, 9, 25, 1, 30),   // EU fall back
  Date.UTC(2026, 8, 6, 4, 30),    // Santiago's midnight transition
];

// ── harness ──────────────────────────────────────────────────────────────

function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = prev === undefined ? HOST_TZ : prev;
  }
}

// Freeze the wall clock without touching the zone. `new Date()` and Date.now()
// report the given instant; every other form (Date.UTC, new Date(ms), parsing)
// is inherited unchanged, which is what the helpers use internally.
function withClock(ms, fn) {
  const Real = globalThis.Date;
  class Frozen extends Real {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() { return ms; }
  }
  globalThis.Date = Frozen;
  try {
    return fn();
  } finally {
    globalThis.Date = Real;
  }
}

// The INDEPENDENT oracle: what calendar date is it in `tz` at instant `ms`,
// according to Intl rather than to any code under test. Always evaluated with
// the real Date, never inside withClock.
function localDateIn(tz, ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// The instant at which the local wall clock in `tz` reads `dateStr hh:mm`.
// Found by scanning rather than computed, so it needs no offset table and stays
// correct through DST. The window must cover every offset from UTC-12 to UTC+14
// across a full local day: the target instant sits between base-14h (far east,
// 00:00 local) and base+36h (far west, 23:59 local), so -26h…+50h is the range
// with margin. Throws rather than returning null — a silent null became
// `new Date(null)` = the epoch, which reads as a passing-looking 1969 date.
function instantAtLocal(tz, dateStr, hour, minute) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const base = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10));
  for (let m = -26 * 60; m <= 50 * 60; m++) {
    const ms = base + m * 60000;
    const parts = f.formatToParts(new Date(ms));
    const get = (t) => parts.find((p) => p.type === t).value;
    const h = get("hour") === "24" ? "00" : get("hour");
    if (`${get("year")}-${get("month")}-${get("day")}` === dateStr && +h === hour && +get("minute") === minute) {
      return ms;
    }
  }
  throw new Error(`instantAtLocal: ${tz} has no ${dateStr} ${hour}:${minute} local (DST gap?)`);
}

// The weekday of a date STRING, read through UTC so the reading itself cannot
// be bent by the zone under test. 1 = Monday.
const weekdayOf = (dateStr) => new Date(dateStr + "T00:00:00Z").getUTCDay();

// The two implementations as they stood before this fix, kept verbatim so the
// regression tests can prove the old code really did produce the wrong answer
// rather than merely asserting that the new code produces the right one.
const OLD_todayStr = () => new Date().toISOString().slice(0, 10);
const OLD_addDays = (d, n) => {
  const t = new Date(d + "T12:00:00");
  t.setDate(t.getDate() + Math.round(n));
  return t.toISOString().slice(0, 10);
};

// ── the zone harness itself has to work ──────────────────────────────────

// Minutes EAST of UTC that `tz` runs at instant `ms`, computed from Intl alone.
// Used to prove the TZ mutation really took effect without comparing zone
// NAMES — ICU canonicalises some of them (Asia/Kolkata resolves as
// Asia/Calcutta), and a name comparison would fail on an alias while the zone
// was in fact applied correctly.
// Negating a zero offset yields -0, and assert.equal uses Object.is, where
// -0 !== 0. Adding 0 collapses it back to +0.
const runtimeOffsetMinutes = (ms) => -new Date(ms).getTimezoneOffset() + 0;

function offsetMinutesIn(tz, ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => +parts.find((p) => p.type === t).value;
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUTC - ms) / 60000;
}

test("the test harness actually moves the runtime timezone", () => {
  const ms = Date.UTC(2026, 6, 25, 6, 0);
  const offsets = new Map();
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      // The runtime's own offset must match what `tz` is doing at this instant.
      assert.equal(
        runtimeOffsetMinutes(ms), offsetMinutesIn(tz, ms) + 0,
        `TZ=${tz} did not take effect — every assertion in this file would be vacuous`
      );
      offsets.set(tz, new Date(ms).getTimezoneOffset());
    });
  }
  // If the offsets were all identical the zones were never really applied.
  assert.ok(new Set(offsets.values()).size >= 6, `expected distinct UTC offsets, got ${[...offsets]}`);
  // The half-hour and quarter-hour zones must really be fractional, or the
  // "catches half-hour offsets" claim is empty.
  assert.equal(offsets.get("Asia/Kolkata") % 60, -30, "Kolkata must sit on a half hour");
  assert.equal(offsets.get("Asia/Kathmandu") % 60, -45, "Kathmandu must sit on a quarter hour");
  // …and the host zone is back afterwards, whatever it is (CI runs in UTC).
  for (const probe of [ms, Date.UTC(2026, 0, 15)]) {
    assert.equal(
      runtimeOffsetMinutes(probe), offsetMinutesIn(HOST_TZ, probe) + 0,
      "host zone not restored"
    );
  }
});

test("the frozen clock reports the given instant and leaves the rest of Date alone", () => {
  const ms = Date.UTC(2026, 6, 25, 0, 10);
  const realUTC = Date.UTC(2026, 6, 24);
  withClock(ms, () => {
    assert.equal(new Date().getTime(), ms);
    assert.equal(Date.now(), ms);
    assert.equal(Date.UTC(2026, 6, 24), realUTC, "Date.UTC must still be the real one");
    assert.equal(realUTC / 864e5, 20658, "…and it must be whole days since the epoch");
    assert.equal(new Date(0).toISOString(), "1970-01-01T00:00:00.000Z");
  });
  assert.notEqual(Date.now(), ms, "real clock not restored");
});

// ── 1. todayStr() is the LOCAL calendar day, everywhere ──────────────────

test("todayStr() names the local calendar day in every timezone", () => {
  for (const [tz, why] of ZONES) {
    for (const ms of INSTANTS) {
      const expected = localDateIn(tz, ms); // oracle first, real Date, real zone
      const actual = withTZ(tz, () => withClock(ms, () => D.todayStr()));
      assert.equal(actual, expected, `${tz} (${why}) at ${new Date(ms).toISOString()}`);
    }
  }
});

test("todayStr() agrees with the host calendar on the real clock", () => {
  const before = Date.now();
  const got = D.todayStr();
  const after = Date.now();
  // A run that straddles local midnight may legitimately match either side.
  assert.ok(
    got === localDateIn(HOST_TZ, before) || got === localDateIn(HOST_TZ, after),
    `todayStr() = ${got}, host calendar = ${localDateIn(HOST_TZ, before)}`
  );
  assert.match(got, /^\d{4}-\d{2}-\d{2}$/);
});

test("REGRESSION: the old UTC todayStr() named tomorrow on an Edmonton evening", () => {
  const ms = instantAtLocal("America/Edmonton", "2026-07-24", 18, 30);
  assert.ok(ms != null, "could not locate 18:30 local");
  withTZ("America/Edmonton", () => withClock(ms, () => {
    assert.equal(OLD_todayStr(), "2026-07-25", "the bug this file exists for");
    assert.equal(D.todayStr(), "2026-07-24", "the fix");
  }));
});

// ── 2. backend and frontend must never disagree again ────────────────────

test("the backend and frontend copies return the same answers in every timezone", async () => {
  assert.ok(fs.existsSync(FRONTEND_DATES), `mirror file missing: ${FRONTEND_DATES}`);
  const F = await import(pathToFileURL(FRONTEND_DATES).href);

  assert.deepEqual(
    Object.keys(F).sort(),
    ["addDays", "dayNum", "fmtD", "fmtDY", "mondayOf", "todayStr"],
    "the two copies must export the same surface — see the MIRROR header in both files"
  );
  for (const name of Object.keys(F)) {
    assert.equal(typeof D[name], "function", `backend copy is missing ${name}`);
  }

  const dates = ["2026-07-24", "2026-07-26", "2026-01-01", "2024-02-29", "2026-12-31", "2026-03-08"];
  for (const [tz] of ZONES) {
    for (const ms of INSTANTS.slice(0, 5)) {
      withTZ(tz, () => withClock(ms, () => {
        assert.equal(D.todayStr(), F.todayStr(), `todayStr disagrees in ${tz}`);
        for (const d of dates) {
          assert.equal(D.dayNum(d), F.dayNum(d), `dayNum(${d}) disagrees in ${tz}`);
          assert.equal(D.mondayOf(d), F.mondayOf(d), `mondayOf(${d}) disagrees in ${tz}`);
          assert.equal(D.fmtD(d), F.fmtD(d), `fmtD(${d}) disagrees in ${tz}`);
          assert.equal(D.fmtDY(d), F.fmtDY(d), `fmtDY(${d}) disagrees in ${tz}`);
          for (const n of [-30, -7, -1, 0, 1, 7, 30]) {
            assert.equal(D.addDays(d, n), F.addDays(d, n), `addDays(${d}, ${n}) disagrees in ${tz}`);
          }
        }
      }));
    }
  }
});

// ── 3. addDays stays in calendar space ───────────────────────────────────

test("addDays(d, 0) === d in every timezone", () => {
  const dates = [
    "2026-01-01", "2026-02-28", "2024-02-29", "2026-03-08", "2026-03-29",
    "2026-06-30", "2026-07-24", "2026-10-25", "2026-11-01", "2026-12-31",
  ];
  for (const [tz, why] of ZONES) {
    withTZ(tz, () => {
      for (const d of dates) {
        assert.equal(D.addDays(d, 0), d, `${tz} (${why}): addDays(${d}, 0)`);
      }
    });
  }
});

test("REGRESSION: the old addDays lost a day east of UTC+12", () => {
  // NZDT (UTC+13) in January is the case that made addDays(d, 0) === d-1.
  withTZ("Pacific/Auckland", () => {
    assert.equal(OLD_addDays("2026-01-15", 0), "2026-01-14", "the latent bug");
    assert.equal(D.addDays("2026-01-15", 0), "2026-01-15", "the fix");
  });
  // UTC+14 has no DST, so it is wrong all year round.
  withTZ("Pacific/Kiritimati", () => {
    assert.equal(OLD_addDays("2026-07-24", 0), "2026-07-23");
    assert.equal(D.addDays("2026-07-24", 0), "2026-07-24");
  });
  // And the far west failed the other way.
  withTZ("Etc/GMT+12", () => {
    assert.equal(OLD_addDays("2026-07-24", 0), "2026-07-25");
    assert.equal(D.addDays("2026-07-24", 0), "2026-07-24");
  });
});

test("addDays moves exactly n days and round-trips, in every timezone", () => {
  const dates = ["2026-01-01", "2024-02-28", "2026-03-08", "2026-07-24", "2026-10-25", "2026-12-28"];
  const steps = [-400, -90, -28, -7, -1, 0, 1, 7, 28, 90, 400];
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      for (const d of dates) {
        for (const n of steps) {
          const moved = D.addDays(d, n);
          assert.match(moved, /^\d{4}-\d{2}-\d{2}$/, `${tz}: addDays(${d}, ${n}) shape`);
          assert.equal(D.dayNum(moved) - D.dayNum(d), n, `${tz}: addDays(${d}, ${n}) day delta`);
          assert.equal(D.addDays(moved, -n), d, `${tz}: addDays round-trip ${d} ± ${n}`);
        }
      }
    });
  }
});

test("addDays crosses month, year and leap boundaries correctly", () => {
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      assert.equal(D.addDays("2026-01-31", 1), "2026-02-01");
      assert.equal(D.addDays("2026-02-28", 1), "2026-03-01", "2026 is not a leap year");
      assert.equal(D.addDays("2024-02-28", 1), "2024-02-29", "2024 is");
      assert.equal(D.addDays("2024-02-29", 1), "2024-03-01");
      assert.equal(D.addDays("2026-12-31", 1), "2027-01-01");
      assert.equal(D.addDays("2027-01-01", -1), "2026-12-31");
      assert.equal(D.addDays("2026-03-01", -1), "2026-02-28");
    });
  }
});

// ── 4. dayNum is a difference that survives every zone ───────────────────

test("dayNum differences equal the true day gap in every timezone", () => {
  const start = Date.UTC(2024, 0, 1);
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      let prev = null;
      for (let i = 0; i < 1100; i++) {
        const d = new Date(start + i * 864e5).toISOString().slice(0, 10);
        const n = D.dayNum(d);
        assert.ok(Number.isFinite(n), `${tz}: dayNum(${d}) not finite`);
        if (prev != null) assert.equal(n - prev, 1, `${tz}: consecutive days must differ by exactly 1 at ${d}`);
        prev = n;
      }
    });
  }
});

test("REGRESSION: the old dayNum mis-measured spans across a Europe/London DST switch", () => {
  const OLD_dayNum = (d) => Math.round(Date.parse(d + "T12:00:00") / 864e5);
  withTZ("Europe/London", () => {
    // London runs at UTC+0 in winter and UTC+1 in summer, which is exactly
    // where the old local-noon rounding flipped from +1 to +0.
    assert.equal(OLD_dayNum("2026-03-29") - OLD_dayNum("2026-03-28"), 0, "spring forward swallowed a day");
    assert.equal(OLD_dayNum("2026-10-25") - OLD_dayNum("2026-10-24"), 2, "fall back invented one");
    assert.equal(D.dayNum("2026-03-29") - D.dayNum("2026-03-28"), 1);
    assert.equal(D.dayNum("2026-10-25") - D.dayNum("2026-10-24"), 1);
  });
});

test("dayNum returns NaN for a non-date so the Number.isFinite guards still fire", () => {
  // adaptiveTarget.checkpointDates and expenditureEstimator both branch on
  // Number.isFinite(dayNum(...)); a silently-numeric answer would skip them.
  for (const bad of ["", "garbage", "2026-7-4", "2026-13-01", "2026-00-10", "2026-07-00", "2026-07-32", "2026/07/24", null, undefined, 20659, {}]) {
    assert.ok(Number.isNaN(D.dayNum(bad)), `dayNum(${JSON.stringify(bad)}) should be NaN`);
  }
  assert.ok(Number.isFinite(D.dayNum("2026-07-24")));
});

// ── 5. mondayOf: a Monday, every day, every zone ─────────────────────────

test("mondayOf returns a Monday for every day of the week in every timezone", () => {
  const start = Date.UTC(2025, 11, 1);
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      for (let i = 0; i < 400; i++) {
        const d = new Date(start + i * 864e5).toISOString().slice(0, 10);
        const m = D.mondayOf(d);
        assert.equal(weekdayOf(m), 1, `${tz}: mondayOf(${d}) = ${m} is not a Monday`);
        const back = D.dayNum(d) - D.dayNum(m);
        assert.ok(back >= 0 && back <= 6, `${tz}: mondayOf(${d}) = ${m} is ${back} days away`);
      }
    });
  }
});

test("ISO week boundaries: Sunday belongs to the week that already started", () => {
  // 2026-07-20 Mon … 2026-07-26 Sun — one full ISO week.
  const week = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      for (const d of week) {
        assert.equal(D.mondayOf(d), "2026-07-20", `${tz}: ${d} belongs to the week of Jul 20`);
      }
      // The next day starts the next week, not before.
      assert.equal(D.mondayOf("2026-07-27"), "2026-07-27");
      assert.equal(D.mondayOf("2026-07-19"), "2026-07-13", "the Sunday before belongs to the week before");
      // Sunday is six days after its Monday, never one day before the next.
      assert.equal(D.dayNum("2026-07-26") - D.dayNum(D.mondayOf("2026-07-26")), 6);
    });
  }
});

test("mondayOf is stable across year boundaries and leap years", () => {
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      assert.equal(D.mondayOf("2026-01-01"), "2025-12-29", "Thu Jan 1 2026 → Mon Dec 29 2025");
      assert.equal(D.mondayOf("2024-02-29"), "2024-02-26", "leap day is a Thursday");
      assert.equal(D.mondayOf("2027-01-03"), "2026-12-28", "Sun Jan 3 2027 → Mon Dec 28 2026");
    });
  }
});

// ── 6. the Sunday-evening plan bug, end to end ───────────────────────────

test("SUNDAY 18:30 LOCAL: mondayOf(todayStr()) is THIS week's Monday in every timezone", () => {
  // routes/plans.js calls mondayOf(todayStr()) in six places. With a UTC
  // todayStr, any Sunday evening west of UTC rolled to Monday, mondayOf
  // returned NEXT week, /plans/current served an empty week, and Today showed
  // "No meals planned for this week yet" while Sunday's meals still existed.
  for (const [tz, why] of ZONES) {
    const ms = instantAtLocal(tz, "2026-07-26", 18, 30); // 2026-07-26 is a Sunday
    assert.ok(ms != null, `${tz}: could not locate Sunday 18:30 local`);
    withTZ(tz, () => withClock(ms, () => {
      assert.equal(D.todayStr(), "2026-07-26", `${tz} (${why}): today is still Sunday at 18:30`);
      assert.equal(D.mondayOf(D.todayStr()), "2026-07-20", `${tz} (${why}): must be THIS week's Monday`);
      assert.equal(weekdayOf(D.mondayOf(D.todayStr())), 1);
      // The day index plans.js derives (0 = Monday … 6 = Sunday) must say Sunday.
      assert.equal(D.dayNum(D.todayStr()) - D.dayNum(D.mondayOf(D.todayStr())), 6, `${tz}: Sunday is index 6`);
    }));
  }
});

test("REGRESSION: on that same Sunday evening the old code served next week", () => {
  const ms = instantAtLocal("America/Edmonton", "2026-07-26", 18, 30);
  withTZ("America/Edmonton", () => withClock(ms, () => {
    const oldToday = OLD_todayStr();
    assert.equal(oldToday, "2026-07-27", "UTC had already rolled to Monday");
    assert.equal(D.mondayOf(oldToday), "2026-07-27", "…so the week served was the NEXT one");
    assert.equal(D.mondayOf(D.todayStr()), "2026-07-20", "…where the fix serves the current one");
  }));
});

test("the week label a ledger renders is always a Monday, at every hour of the day", () => {
  // The Engine's ledger rendered "Week of Jul 25" — a Saturday — because the
  // week was derived from a UTC today. Whatever hour it is locally, the label
  // must be a Monday and must not change during the day.
  for (const [tz] of ZONES) {
    let label = null;
    for (const hour of [0, 6, 12, 17, 18, 21, 23]) {
      const ms = instantAtLocal(tz, "2026-07-24", hour, 30);
      assert.ok(ms != null, `${tz}: no ${hour}:30 local on 2026-07-24`);
      withTZ(tz, () => withClock(ms, () => {
        const week = D.mondayOf(D.todayStr());
        assert.equal(weekdayOf(week), 1, `${tz} @${hour}:30 → ${week} is not a Monday`);
        if (label === null) label = week;
        assert.equal(week, label, `${tz}: the week label moved at ${hour}:30 local`);
      }));
    }
    assert.equal(label, "2026-07-20");
  }
});

// ── 7. the counters that shifted with the clock ──────────────────────────

test("daysIn reads 1 on the start day at every hour (the WEEK 1 water-noise hold)", () => {
  // routes/weighins.js: daysIn = dayNum(asOf) - dayNum(profile.startDate) + 1,
  // and bmrEngine.verdict() holds the verdict while daysIn < 10. A UTC asOf
  // added a phantom day every evening, lifting the hold early.
  const startDate = "2026-07-24";
  for (const [tz] of ZONES) {
    for (const hour of [0, 9, 18, 21, 23]) {
      const ms = instantAtLocal(tz, startDate, hour, 45);
      withTZ(tz, () => withClock(ms, () => {
        assert.equal(D.dayNum(D.todayStr()) - D.dayNum(startDate) + 1, 1, `${tz} @${hour}:45 → day 1`);
      }));
    }
  }
  // Day 10 is when the hold lifts, and it must be day 10 all day long.
  const day10 = D.addDays(startDate, 9);
  for (const hour of [0, 18, 23]) {
    const ms = instantAtLocal("America/Edmonton", day10, hour, 45);
    withTZ("America/Edmonton", () => withClock(ms, () => {
      assert.equal(D.dayNum(D.todayStr()) - D.dayNum(startDate) + 1, 10);
      assert.equal(D.dayNum(OLD_todayStr()) - D.dayNum(startDate) + 1, hour >= 18 ? 11 : 10, "the old early lift");
    }));
  }
});

test("staleDays is 0 for data logged today, at any local hour", () => {
  // expenditureEstimator gates the adaptive estimator on staleDays; a UTC
  // today made this morning's weigh-in read as one day old every evening.
  for (const [tz] of ZONES) {
    for (const hour of [0, 12, 18, 23]) {
      const ms = instantAtLocal(tz, "2026-07-24", hour, 15);
      withTZ(tz, () => withClock(ms, () => {
        const loggedToday = D.todayStr();
        assert.equal(D.dayNum(D.todayStr()) - D.dayNum(loggedToday), 0, `${tz} @${hour}:15`);
      }));
    }
  }
});

test("the weekly checkpoint grid does not gain a step in the evening", () => {
  // adaptiveTarget.checkpointDates walks k = 0 … floor((asOf - start)/7) and
  // applies one capped ±125 kcal step per checkpoint. When today jumped a day
  // at 18:00 the walk gained a step every evening and gave it back every
  // morning — a target that oscillated on the clock alone.
  const startDate = "2026-05-04"; // a Monday
  for (const [tz] of ZONES) {
    const seen = new Set();
    for (const hour of [0, 8, 12, 17, 18, 20, 23]) {
      const ms = instantAtLocal(tz, "2026-07-24", hour, 30);
      withTZ(tz, () => withClock(ms, () => {
        const totalWeeks = Math.floor((D.dayNum(D.todayStr()) - D.dayNum(startDate)) / 7);
        seen.add(totalWeeks);
        const grid = [];
        for (let k = 0; k <= totalWeeks; k++) grid.push(D.addDays(startDate, 7 * k));
        assert.equal(new Set(grid).size, grid.length, `${tz}: duplicate checkpoint`);
        for (let i = 1; i < grid.length; i++) {
          assert.equal(D.dayNum(grid[i]) - D.dayNum(grid[i - 1]), 7, `${tz}: checkpoints must be 7 days apart`);
        }
        assert.equal(weekdayOf(grid[0]), 1, `${tz}: the grid anchor keeps its weekday`);
      }));
    }
    assert.equal(seen.size, 1, `${tz}: the checkpoint count changed during the day: ${[...seen]}`);
  }
});

// ── 8. formatters ────────────────────────────────────────────────────────

test("fmtD/fmtDY render the date they were given, not a neighbour", () => {
  for (const [tz] of ZONES) {
    withTZ(tz, () => {
      assert.equal(D.fmtD("2026-07-24"), "Jul 24", tz);
      assert.equal(D.fmtDY("2026-07-24"), "Jul 24, 2026", tz);
      assert.equal(D.fmtD("2026-01-01"), "Jan 1", tz);
      assert.equal(D.fmtDY("2026-12-31"), "Dec 31, 2026", tz);
      assert.equal(D.fmtD("2024-02-29"), "Feb 29", tz);
    });
  }
});

test("the formatters never throw — a bad row shows itself instead of blanking a screen", () => {
  for (const bad of ["", "garbage", null, undefined]) {
    assert.doesNotThrow(() => D.fmtD(bad));
    assert.doesNotThrow(() => D.fmtDY(bad));
  }
  assert.equal(D.fmtD("garbage"), "garbage");
});

// ── 9. invalid input keeps the old, loud failure mode ────────────────────

test("addDays and mondayOf still reject non-dates loudly", () => {
  // The old implementations threw RangeError out of toISOString() on bad
  // input. Callers depend on that being loud rather than silently producing
  // "NaN-NaN-NaN", so the class of failure is preserved deliberately.
  for (const bad of ["garbage", "2026-13-01", null, undefined, 42]) {
    assert.throws(() => D.addDays(bad, 1), RangeError, `addDays(${JSON.stringify(bad)})`);
    assert.throws(() => D.mondayOf(bad), RangeError, `mondayOf(${JSON.stringify(bad)})`);
  }
  for (const n of [NaN, Infinity, -Infinity, "7", null, undefined]) {
    assert.throws(() => D.addDays("2026-07-24", n), RangeError, `addDays(d, ${n})`);
  }
});

// ── 10. tripwire: no fourth copy ─────────────────────────────────────────

test("routes/weighins.js imports the shared helpers and declares none of its own", () => {
  const src = fs.readFileSync(path.join(BACKEND, "src/routes/weighins.js"), "utf8");
  assert.match(src, /require\(["']\.\.\/lib\/dates\.js["']\)/, "weighins.js must import ../lib/dates.js");
  assert.doesNotMatch(
    src, /^\s*const\s+todayStr\s*=/m,
    "weighins.js re-declared todayStr — that private copy is what computed today in UTC"
  );
  assert.doesNotMatch(src, /^\s*const\s+dayNum\s*=/m, "weighins.js re-declared dayNum");
  assert.doesNotMatch(
    src, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/,
    "a UTC 'today' is back in weighins.js"
  );
});

test("lib/dates.js is the only place in src/lib that defines today", () => {
  const src = fs.readFileSync(path.join(BACKEND, "src/lib/dates.js"), "utf8");
  // The fixed helper must not reach for UTC when naming today. (The string
  // appears in this file's header comment describing the old bug, so match the
  // executable form: an assignment or return, not a comment line.)
  const code = src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /new Date\(\)\.toISOString\(\)/, "todayStr must read local components");
  assert.match(code, /getFullYear\(\)/, "todayStr must read local components");
});
