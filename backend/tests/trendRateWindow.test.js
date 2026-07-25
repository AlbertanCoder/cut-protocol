// The trend window is a CALENDAR window, not a row count.
//
// `trendRate` used to read `entries.slice(-14)` — the last fourteen ROWS —
// while the UI promised "the last 14 days" and "verdicts judge 7-day averages
// only". For anyone who does not weigh in daily those are different windows,
// and the same rate drives the goal-date projection, so the error propagates
// past the verdict stamp.
//
// These tests lock the reproduction that motivated the fix, the gates that stop
// the engine speaking off a thin window, and the day-windowed trailing average
// that replaces `slice(-7)`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  trendRate, trendWindow, trailingAverage, verdict,
  TREND_WINDOW_DAYS, TREND_MIN_POINTS, TRAILING_AVG_DAYS,
} = require("../src/lib/bmrEngine.js");
const { addDays } = require("../src/lib/dates.js");

// A fixed anchor — no wall clock anywhere in this file.
const ANCHOR = "2026-07-24";
const back = (n) => addDays(ANCHOR, -n);

// ── the reproduction ───────────────────────────────────────────────────────

// Eight MONTHLY weigh-ins, 209.4 → 196.2 lb across 213 days. Under the old
// row window all eight were "the last 14 days".
const MONTHLY = [
  { date: "2025-12-23", weightLb: 209.4 },
  { date: "2026-01-22", weightLb: 207.5 },
  { date: "2026-02-21", weightLb: 205.7 },
  { date: "2026-03-23", weightLb: 203.6 },
  { date: "2026-04-22", weightLb: 201.6 },
  { date: "2026-05-22", weightLb: 199.9 },
  { date: "2026-06-21", weightLb: 198.0 },
  { date: "2026-07-21", weightLb: 196.2 },
];

test("REPRO: 8 monthly weigh-ins across 213 days no longer produce a 14-day rate", () => {
  // The old behaviour, reproduced by hand so the regression is documented as
  // arithmetic rather than as a memory: least squares over all 8 rows.
  const oldRate = leastSquaresLbPerWeek(MONTHLY);
  assert.ok(Math.abs(oldRate - 0.44) < 0.02, `old row-window rate was ~0.44 lb/wk, got ${oldRate.toFixed(3)}`);
  const oldV = verdict({ rate: oldRate, chosenRate: 1.0, daysIn: 213, atFloor: false });
  assert.equal(oldV.tag, "Slower than planned", "…and that rate reads as slower than planned");

  // New behaviour: only ONE of those weigh-ins (2026-07-21) is inside the real
  // fortnight, which is not a trend. The engine says nothing.
  assert.equal(trendRate(MONTHLY, { asOf: ANCHOR }), null);
  const v = verdict({ rate: trendRate(MONTHLY, { asOf: ANCHOR }), chosenRate: 1.0, daysIn: 213, atFloor: false });
  assert.equal(v.tone, "wait");
  assert.equal(v.tag, "Not enough weigh-ins yet");
});

test("REPRO: a flat real fortnight is no longer diluted by seven months of history", () => {
  // Six flat weigh-ins across the actual last fortnight — true rate 0.0 lb/wk.
  const flatFortnight = [0, 2, 5, 8, 11, 13].map((n) => ({ date: back(n), weightLb: 196.2 }));
  const mixed = [...MONTHLY, ...flatFortnight];

  // Old behaviour: the last 14 ROWS still reached back to December.
  const oldRate = leastSquaresLbPerWeek(mixed.slice(-14));
  assert.ok(oldRate > 0.3, `old window still reported ~${oldRate.toFixed(2)} lb/wk of loss on a flat fortnight`);

  // New behaviour: the window holds only the fortnight, whose true slope is 0.
  // 6 flat + the one monthly weigh-in that genuinely falls inside the fortnight
  // (2026-07-21) = 7 points; the other 7 monthly rows are out of window.
  const w = trendWindow(mixed, { asOf: ANCHOR });
  assert.equal(w.points.length, 7, "only the in-window weigh-ins are fitted");
  assert.equal(w.dropped, 7, "the older monthly weigh-ins leave the fit, not the record");
  // 7 points < the 8-point minimum → still no claim.
  assert.equal(trendRate(mixed, { asOf: ANCHOR }), null);

  const full = [...MONTHLY, ...[0, 1, 3, 5, 7, 9, 11, 13].map((n) => ({ date: back(n), weightLb: 196.2 }))];
  const flatRate = trendRate(full, { asOf: ANCHOR });
  assert.ok(Math.abs(flatRate) < 1e-9, `a flat fortnight reads as 0.0 lb/wk, not 0.40 — got ${flatRate}`);
});

// ── the window itself ──────────────────────────────────────────────────────

test("the window is TREND_WINDOW_DAYS calendar days, inclusive of the anchor", () => {
  const inside = { date: back(TREND_WINDOW_DAYS - 1), weightLb: 200 }; // day 14 of 14
  const outside = { date: back(TREND_WINDOW_DAYS), weightLb: 200 };    // one day too old
  const w = trendWindow([outside, inside], { asOf: ANCHOR });
  assert.equal(w.points.length, 1);
  assert.equal(w.points[0].date, inside.date);
  assert.equal(w.windowDays, TREND_WINDOW_DAYS);
});

test("with no asOf the window anchors on the newest entry — pure, no clock", () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ date: addDays("2020-01-01", i), weightLb: 200 - i * 0.2 }));
  const rate = trendRate(pts);
  assert.ok(rate != null, "a 10-day daily series from 2020 still fits — the function has no clock");
  assert.ok(Math.abs(rate - 1.4) < 1e-9, `0.2 lb/day = 1.4 lb/wk, got ${rate}`);
  // Judged against today, the same series is far outside the window.
  assert.equal(trendRate(pts, { asOf: ANCHOR }), null);
});

test("gates: fewer than TREND_MIN_POINTS inside the window → null, never a guess", () => {
  const seven = Array.from({ length: TREND_MIN_POINTS - 1 }, (_, i) => ({ date: back(i), weightLb: 200 - i * 0.1 }));
  assert.equal(seven.length, 7);
  assert.equal(trendRate(seven, { asOf: ANCHOR }), null);
  const eight = [...seven, { date: back(TREND_MIN_POINTS - 1), weightLb: 200 - 0.7 }];
  assert.ok(trendRate(eight, { asOf: ANCHOR }) != null, "the 8th in-window weigh-in unlocks it");
});

test("gates: 8 weigh-ins crammed into 2 days cannot extrapolate a weekly rate", () => {
  const crammed = [
    ...Array.from({ length: 4 }, (_, i) => ({ date: back(1), weightLb: 200 + i * 0.01 })),
    ...Array.from({ length: 4 }, (_, i) => ({ date: back(0), weightLb: 197 + i * 0.01 })),
  ];
  assert.equal(crammed.length, TREND_MIN_POINTS);
  assert.equal(trendRate(crammed, { asOf: ANCHOR }), null, "3 lb in one day is not a 21 lb/wk trend");
});

test("junk rows are filtered, not fatal", () => {
  const good = Array.from({ length: 8 }, (_, i) => ({ date: back(i), weightLb: 200 - i * 0.1 }));
  const junk = [null, undefined, { date: "not-a-date", weightLb: 200 }, { date: back(2) }, { date: back(3), weightLb: NaN }];
  assert.deepEqual(trendRate([...junk, ...good], { asOf: ANCHOR }), trendRate(good, { asOf: ANCHOR }));
  assert.equal(trendRate([], { asOf: ANCHOR }), null);
  assert.equal(trendRate(null, { asOf: ANCHOR }), null);
});

test("sign convention survives the rewrite: losing weight is a POSITIVE rate", () => {
  const losing = Array.from({ length: 8 }, (_, i) => ({ date: back(7 - i), weightLb: 200 - i * 0.2 }));
  const gaining = Array.from({ length: 8 }, (_, i) => ({ date: back(7 - i), weightLb: 200 + i * 0.2 }));
  assert.ok(trendRate(losing, { asOf: ANCHOR }) > 0);
  assert.ok(trendRate(gaining, { asOf: ANCHOR }) < 0);
});

test("input order does not matter — entries are sorted by date, not trusted", () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ date: back(i), weightLb: 200 - (9 - i) * 0.2 }));
  const shuffled = [pts[4], pts[9], pts[0], pts[7], pts[2], pts[8], pts[1], pts[5], pts[3], pts[6]];
  assert.equal(trendRate(shuffled, { asOf: ANCHOR }), trendRate(pts, { asOf: ANCHOR }));
});

// ── the "7-day average" that must actually mean 7 days ─────────────────────

test("trailingAverage averages DAYS, not rows — the 3×/week lag is gone", () => {
  // 3 weigh-ins a week for 3 weeks, losing 1 lb/wk from 200.
  const entries = [];
  for (let d = 20; d >= 0; d--) {
    if (d % 7 === 0 || d % 7 === 2 || d % 7 === 4) entries.push({ date: back(d), weightLb: 200 - (20 - d) / 7 });
  }
  const rowAvg = entries.slice(-7).reduce((s, e) => s + e.weightLb, 0) / 7;
  const dayAvg = trailingAverage(entries, (e) => e.weightLb, { asOf: ANCHOR });
  assert.equal(dayAvg.windowDays, TRAILING_AVG_DAYS);
  assert.ok(dayAvg.count < 7, `a 3×/week weigher has ${dayAvg.count} weigh-ins in 7 days, not 7`);
  assert.ok(dayAvg.avg < rowAvg, "the row average lags heavier than the true 7-day average");
  assert.ok(rowAvg - dayAvg.avg > 0.2, `row window lagged by ${(rowAvg - dayAvg.avg).toFixed(2)} lb`);
});

test("trailingAverage reports what it averaged and never silently invents a number", () => {
  const daily = Array.from({ length: 10 }, (_, i) => ({ date: back(i), weightLb: 200 }));
  const a = trailingAverage(daily, (e) => e.weightLb, { asOf: ANCHOR });
  assert.equal(a.count, 7, "7 daily weigh-ins in a 7-day window");
  assert.equal(a.stale, false);
  assert.equal(a.staleDays, 0);
  assert.equal(a.toDate, ANCHOR);
  assert.equal(a.fromDate, back(6));
  assert.equal(trailingAverage([], (e) => e.weightLb, { asOf: ANCHOR }), null);
});

test("trailingAverage falls back to the newest weigh-in when the window is empty — and SAYS so", () => {
  const old = [{ date: back(30), weightLb: 205 }, { date: back(40), weightLb: 208 }];
  const a = trailingAverage(old, (e) => e.weightLb, { asOf: ANCHOR });
  assert.equal(a.stale, true, "nothing in the last 7 days");
  assert.equal(a.staleDays, 30);
  assert.equal(a.count, 1);
  assert.equal(a.avg, 205, "the most recent reading, not an average of a 40-day-old pair");
});

test("trailingAverage works on kg as well as lb (weightNow.js's shape)", () => {
  const kg = Array.from({ length: 5 }, (_, i) => ({ date: back(i), weightKg: 90 + i }));
  const a = trailingAverage(kg, (e) => e.weightKg, { asOf: ANCHOR });
  assert.equal(a.count, 5);
  assert.equal(a.avg, 92);
});

// ── verdict voice ──────────────────────────────────────────────────────────

test("verdict stamps are sentence-case statements of fact, number first", () => {
  const cases = [
    verdict({ rate: 1.0, chosenRate: 1.0, daysIn: 30, atFloor: false }),
    verdict({ rate: 2.2, chosenRate: 1.0, daysIn: 30, atFloor: false }),
    verdict({ rate: 1.35, chosenRate: 1.0, daysIn: 30, atFloor: false }),
    verdict({ rate: 0.7, chosenRate: 1.0, daysIn: 30, atFloor: false }),
    verdict({ rate: 0.2, chosenRate: 1.0, daysIn: 30, atFloor: false }),
    verdict({ rate: 0.2, chosenRate: 1.0, daysIn: 30, atFloor: true }),
    verdict({ rate: null, chosenRate: 1.0, daysIn: 30, atFloor: false }),
    verdict({ rate: null, chosenRate: 1.0, daysIn: 2, atFloor: false }),
  ];
  for (const v of cases) {
    assert.notEqual(v.tag, v.tag.toUpperCase(), `"${v.tag}" must not be an ALL-CAPS grade`);
    assert.equal(v.tag[0], v.tag[0].toUpperCase(), `"${v.tag}" starts sentence-case`);
    assert.ok(!/\bHOLD 1 WK\b|\bT[0-9]\b/.test(v.tag), `"${v.tag}" must not carry a compressed code label`);
    assert.ok(!/adherence/i.test(v.sub), `"${v.sub}" must not use the word adherence`);
    assert.notEqual(v.tone, "bad", "body data never gets a tone called bad");
  }
  // Every verdict that HAS a number leads with it.
  for (const v of cases.filter((x) => x.band)) {
    assert.match(v.sub, /^-?\d/, `"${v.sub}" must lead with the measured rate`);
  }
});

test("verdict: the slow branches help before they blame; too-fast keeps the lean-mass caution", () => {
  const slow = verdict({ rate: 0.2, chosenRate: 1.0, daysIn: 30, atFloor: false });
  assert.ok(!/check logging accuracy/i.test(slow.sub), "no 'check logging accuracy first'");
  assert.match(slow.sub, /Profile is where you change pace/);

  const borderline = verdict({ rate: 0.7, chosenRate: 1.0, daysIn: 30, atFloor: false });
  assert.match(borderline.sub, /One week isn't a signal/);

  const fast = verdict({ rate: 2.2, chosenRate: 1.0, daysIn: 30, atFloor: false });
  assert.match(fast.sub, /lean mass/, "the clinical warning survives");

  const floored = verdict({ rate: 0.2, chosenRate: 1.0, daysIn: 30, atFloor: true });
  assert.match(floored.tag, /floor/i);
  assert.match(floored.sub, /movement, not less food/);
});

test("verdict tolerates a missing chosen rate instead of printing NaN", () => {
  const v = verdict({ rate: 1.0, chosenRate: undefined, daysIn: 30, atFloor: false });
  assert.ok(!/NaN/.test(`${v.tag} ${v.sub}`), `"${v.sub}" must not contain NaN`);
  assert.equal(v.tone, "good", "1.0 lb/wk against the 1.0 default is on target");
});

// The "insufficient" verdict must describe the gate the engine actually
// enforces — the two numbers used to be hardcoded in the string.
test("the insufficient-data copy quotes the real gate constants", () => {
  const v = verdict({ rate: null, chosenRate: 1.0, daysIn: 30, atFloor: false });
  assert.ok(v.sub.includes(String(TREND_MIN_POINTS)), "names the real minimum point count");
  assert.ok(v.sub.includes(String(TREND_WINDOW_DAYS)), "names the real window length");
});

// ── local helper: the OLD implementation, kept only to prove the delta ──────
function leastSquaresLbPerWeek(pts) {
  const day = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  const x0 = day(pts[0].date);
  const xs = pts.map((p) => day(p.date) - x0);
  const ys = pts.map((p) => p.weightLb);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return -(num / den) * 7;
}
