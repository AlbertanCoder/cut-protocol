// Ported from frontend v1's lib/bmrEngine.js — same formulas, same thresholds.
// DB stores weight/height in SI (kg/cm) per the v2 plan, but the tuned
// heuristics here (1.14-1.25 g protein/lb LBM, 1.4-1.9 lb/wk verdict bands)
// are pound-denominated by design (standard bodybuilding-nutrition
// convention), so we convert kg -> lb at the boundary rather than
// re-deriving new constants in kg, which would risk silently drifting from
// the numbers this protocol was actually tuned against.
const FLOOR = 2000;
const JOB = { desk: 1.2, light: 1.28, mixed: 1.35, heavy: 1.5 };

const kg2lb = (kg) => kg * 2.20462;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function bmrTable(profile, weightKg) {
  const kg = weightKg, cm = profile.heightCm, a = profile.age;
  const male = profile.sex === "M";
  const rows = [];
  rows.push({ f: "Mifflin–St Jeor", v: 10 * kg + 6.25 * cm - 5 * a + (male ? 5 : -161) });
  rows.push({
    f: "Oxford (Henry)",
    v: male
      ? (a < 30 ? 16 * kg + 545 : a < 60 ? 14.2 * kg + 593 : 13.5 * kg + 514)
      : (a < 30 ? 13.1 * kg + 558 : a < 60 ? 9.74 * kg + 694 : 10.1 * kg + 569),
  });
  rows.push({
    f: "Harris–Benedict",
    v: male
      ? 88.362 + 13.397 * kg + 4.799 * cm - 5.677 * a
      : 447.593 + 9.247 * kg + 3.098 * cm - 4.33 * a,
  });
  if (profile.bodyFatPct > 0) {
    const lbmKg = kg * (1 - profile.bodyFatPct / 100);
    rows.push({ f: "Katch–McArdle", v: 370 + 21.6 * lbmKg });
    rows.push({ f: "Cunningham", v: 500 + 22 * lbmKg });
  }
  // Schofield (WHO) — recomp-v2's CLAUDE.md spec's this as a 6th formula, but
  // its own source only publishes verified coefficients for the 18-30 and
  // 30-60 age bands ("Implement remaining age bands from the published
  // table — verify coefficients before coding, never guess them" — its own
  // words) and was never actually implemented in recomp-v2's real code
  // either (grepped calculator.js: no Schofield function exists there, spec
  // vs. build gap same as several UI features that doc flagged elsewhere).
  // Scoped honestly to the two verified bands rather than guessing
  // coefficients for <18 or >=60 — omitted outside that range, same
  // "omit rather than fabricate" pattern already used above for
  // Katch–McArdle/Cunningham when body-fat % is unknown.
  if (a >= 18 && a < 60) {
    rows.push({
      f: "Schofield (WHO)",
      v: male
        ? (a < 30 ? 15.057 * kg + 692.2 : 11.472 * kg + 873.1)
        : (a < 30 ? 14.818 * kg + 486.6 : 8.126 * kg + 845.6),
    });
  }
  return rows;
}

function computeTDEE(profile, weightKg) {
  const rows = bmrTable(profile, weightKg);
  const rmr = median(rows.map((r) => r.v));
  const tdee = rmr * (JOB[profile.job] + 0.01 * profile.sessionsPerWeek);
  return { rows, rmr, tdee };
}

// Protein/fat targets are g-per-lb-of-LBM heuristics — convert weight to lb
// here specifically, matching v1's EngineTab math exactly.

// Undisclosed-until-now conservatism margin (PABLO_REVIEW.md §2.2): shaves
// this many grams off the carb midpoint before deriving carbLo/carbHi below.
// Effect: the displayed protein+fat+carb midpoints sum to ~100 kcal UNDER
// the displayed calorie target, with nothing in the UI explaining why -
// this constant and computeMacros()'s new `macroKcalGap`/`carbBufferG`
// return fields exist specifically to make that gap visible per this
// project's own constitution (CLAUDE.md C1: "every displayed number is
// tappable -> reveals formula, inputs, arithmetic"). Kept at its existing
// value (25g) rather than changed - nobody could confirm whether this
// number was a deliberate calibration or a stray leftover (no comment, no
// test, no pre-dump git history exists to check against per AUDIT.md §9),
// and this user has already been eating against the range it produces.
const CARB_MIDPOINT_BUFFER_G = 25;

function computeMacros(profile, weightKg, targetKcal) {
  const weightLb = kg2lb(weightKg);
  const lbmLb = weightLb * (1 - profile.bodyFatPct / 100);
  const proteinLo = Math.round(lbmLb * 1.14);
  const proteinHi = Math.round(lbmLb * 1.25);
  const fatLo = Math.round(lbmLb * 0.34);
  const fatHi = Math.round(lbmLb * 0.4);
  const proteinMid = (proteinLo + proteinHi) / 2;
  const fatMid = (fatLo + fatHi) / 2;
  const carbMid = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4) - CARB_MIDPOINT_BUFFER_G;
  // Live-computed, not hardcoded to "100 kcal" - self-updating if the
  // protein/fat heuristics or the buffer constant ever change, rather than
  // a second place that can silently drift from the actual arithmetic
  // above (the exact class of bug this whole fix exists to prevent).
  const macroKcalGap = Math.round(targetKcal - (proteinMid * 4 + fatMid * 9 + carbMid * 4));
  return {
    lbmLb,
    kcal: targetKcal,
    proteinLo, proteinHi,
    fatLo, fatHi,
    carbLo: Math.max(carbMid - 12, 0),
    carbMid,
    carbHi: carbMid + 12,
    carbBufferG: CARB_MIDPOINT_BUFFER_G,
    macroKcalGap,
  };
}

function trendRate(entries) {
  // entries: [{ date: "yyyy-mm-dd", weightLb }], most recent last
  const pts = entries.slice(-14);
  if (pts.length < 8) return null;
  const dayNum = (d) => Math.round(Date.parse(d + "T12:00:00") / 864e5);
  const x0 = dayNum(pts[0].date);
  const xs = pts.map((p) => dayNum(p.date) - x0);
  const ys = pts.map((p) => p.weightLb);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  if (den === 0) return null;
  return -(num / den) * 7; // lb/wk lost (positive = losing)
}

function verdict(rate, target, daysIn) {
  if (daysIn < 10)
    return { tone: "wait", tag: "WEEK 1 — WATER NOISE", sub: "Scale is lying right now. Log daily. Judge nothing until day 10." };
  if (rate == null)
    return { tone: "wait", tag: "INSUFFICIENT DATA", sub: "Need 8+ weigh-ins across the last 14 days for a verdict." };
  if (rate > 2.2)
    return { tone: "warn", tag: "TOO FAST", sub: `Losing ${Math.round(rate * 10) / 10} lb/wk. Add 100 back.`, apply: target + 100, applyLabel: `Apply ${Math.round(target + 100).toLocaleString("en-CA")}` };
  if (rate >= 1.9)
    return { tone: "warn", tag: "FAST — HOLD", sub: `${Math.round(rate * 10) / 10} lb/wk. Acceptable. Watch next week.` };
  if (rate >= 1.4)
    return { tone: "good", tag: "PERFECT — TOUCH NOTHING", sub: `${Math.round(rate * 10) / 10} lb/wk. Right in the 1.4–1.9 band.` };
  if (rate >= 1.3)
    return { tone: "warn", tag: "BORDERLINE SLOW — HOLD 1 WK", sub: `${Math.round(rate * 10) / 10} lb/wk. If it repeats next week, drop to ${FLOOR.toLocaleString("en-CA")}.` };
  if (target > FLOOR)
    return { tone: "bad", tag: "SLOW — DROP TO 2,000", sub: `${Math.round(rate * 10) / 10} lb/wk is under 1.3. Step to the floor.`, apply: FLOOR, applyLabel: "Apply 2,000" };
  return { tone: "bad", tag: "SLOW — ALREADY AT FLOOR", sub: `${Math.round(rate * 10) / 10} lb/wk. NEVER below 2,000. Add movement: weekend walks, site steps.` };
}

module.exports = { FLOOR, JOB, kg2lb, mean, median, bmrTable, computeTDEE, computeMacros, trendRate, verdict };
