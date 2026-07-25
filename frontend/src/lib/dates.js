// Cut Protocol — calendar-date helpers. FRONTEND copy (ESM).
//
// ── MIRROR ────────────────────────────────────────────────────────────────
// backend/src/lib/dates.js is the same file in CommonJS. Same functions, same
// order, same semantics — only `export` vs `module.exports` differs. The two
// halves of the app are bundled separately, so a shared cross-boundary import
// is not available; keeping the files structurally identical is the substitute,
// so the next drift is visible on sight. CHANGE ONE, CHANGE THE OTHER.
//
// ── THE RULE THESE FILES ENFORCE ──────────────────────────────────────────
// Everything here is a CALENDAR DATE — the string "YYYY-MM-DD" — never an
// instant. A calendar date has no timezone, so no function below may let the
// runtime's zone leak into its answer. Two ways that used to happen, both
// fixed 2026-07-24:
//
//  1. todayStr() read `new Date().toISOString().slice(0, 10)` — the date in
//     UTC — while the frontend read the LOCAL date. In Edmonton (UTC-6) those
//     disagree every day from 18:00 local until midnight, and it was verified
//     live on this machine: backend said 2026-07-25, the local calendar said
//     2026-07-24. A user's "today" is their own calendar day, so LOCAL is the
//     correct answer; both copies now compute it identically. That single line
//     was rolling tomorrow's meals up under "today", stamping profile.startDate
//     a day ahead, labelling the ledger week with a Saturday, and — through
//     mondayOf(todayStr()) — serving next week's plan every Sunday evening.
//
//  2. addDays() built a LOCAL noon Date and read it back through toISOString(),
//     which converts to UTC. East of UTC+12, local noon is the PREVIOUS day in
//     UTC, so addDays(d, 0) returned d-1 and every derived grid (the adaptive
//     checkpoint walk, the plan week board) slid with it.
//
// Anything added here must be reproducible from the date string alone.

// Strict shape check. The old `Date.parse(d + "T12:00:00")` path went through
// V8's ISO grammar, which requires zero-padded 4-2-2 and rejects month 00/13+
// and day 00/32+ — but ACCEPTS an over-long month like "2026-02-31" and rolls
// it forward. This reproduces that behaviour exactly (roll-over happens in
// Date.UTC below), so no input that used to resolve starts failing.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// "YYYY-MM-DD" → { y, m, d, utc } where utc is UTC midnight of that date, or
// null when the string is not a calendar date.
function parseDate(dateStr) {
  const m = typeof dateStr === "string" ? ISO_DATE.exec(dateStr) : null;
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d, utc: Date.UTC(y, mo - 1, d) };
}

const pad2 = (n) => String(n).padStart(2, "0");
const fmt = (y, m, d) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;

/**
 * Whole days since 1970-01-01, derived from the calendar date alone.
 *
 * Callers only ever take DIFFERENCES of these (daysIn, staleDays, the
 * checkpoint grid, the regression x-axis), and a difference is what has to
 * survive. The old local-noon parse was off by a constant in most zones, which
 * differences cancelled — but in a zone whose DST crosses UTC+0 (Europe/London)
 * that constant changed with the season, so any span measured across the switch
 * came out a day short. This has no constant to cancel.
 *
 * Returns NaN for a non-date, so the Number.isFinite() guards in
 * adaptiveTarget/expenditureEstimator keep firing exactly as before.
 */
export const dayNum = (dateStr) => {
  const p = parseDate(dateStr);
  return p ? p.utc / 864e5 : NaN;
};

/**
 * Today, in the user's LOCAL calendar. This is the whole point of the file:
 * the backend and the frontend must name the same day, and the day they name
 * must be the one on the user's wall calendar.
 */
export const todayStr = () => {
  const t = new Date();
  return fmt(t.getFullYear(), t.getMonth() + 1, t.getDate());
};

/**
 * The same calendar date shifted by n whole days. Pure string → string.
 *
 * The UTC constructor/getters below are NOT a timezone choice — a calendar date
 * has no zone. They are just fixed-length day arithmetic on a zoneless value:
 * every UTC day is exactly 864e5 ms (no DST, no leap seconds), and the value is
 * formatted back through the matching UTC getters, so it round-trips exactly.
 * addDays(d, 0) === d in every zone, including UTC+13 and the half-hour zones.
 */
export const addDays = (dateStr, n) => {
  const p = parseDate(dateStr);
  if (!p) throw new RangeError(`addDays: expected a YYYY-MM-DD date, got ${JSON.stringify(dateStr)}`);
  if (!Number.isFinite(n)) throw new RangeError(`addDays: expected a finite day count, got ${n}`);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + Math.round(n)));
  if (Number.isNaN(t.getTime())) throw new RangeError(`addDays: ${dateStr} + ${n} days is outside the representable range`);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

/**
 * Monday of the ISO week containing `dateStr` (weeks run Mon → Sun, so Sunday
 * belongs to the week that STARTED six days earlier, never the one about to
 * start).
 *
 * The weekday comes from the epoch-day count rather than a Date's getDay(), so
 * no instant is constructed at all. 1970-01-01 was a Thursday, hence the +3
 * that puts Monday at index 0.
 */
export function mondayOf(dateStr) {
  const n = dayNum(dateStr);
  if (!Number.isFinite(n)) throw new RangeError(`mondayOf: expected a YYYY-MM-DD date, got ${JSON.stringify(dateStr)}`);
  const mondayIndex = (((n + 3) % 7) + 7) % 7; // 0 = Monday … 6 = Sunday
  return addDays(dateStr, -mondayIndex);
}

// Locale rendering of a calendar date. Anchored at LOCAL noon: midnight would
// render as the previous day wherever the offset is positive, and on some DST
// transition days local midnight does not exist at all.
//
// Never throws — a formatter that blanks a screen over one bad row is worse
// than one that shows the row as it is. (The old version rendered the literal
// string "Invalid Date"; this renders the input.)
function localeDate(dateStr, opts) {
  const p = parseDate(dateStr);
  if (!p) return String(dateStr);
  return new Date(p.y, p.m - 1, p.d, 12).toLocaleDateString("en-CA", opts);
}

export const fmtD = (dateStr) => localeDate(dateStr, { month: "short", day: "numeric" });
export const fmtDY = (dateStr) => localeDate(dateStr, { month: "short", day: "numeric", year: "numeric" });
