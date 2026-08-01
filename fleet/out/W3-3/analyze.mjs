// W3-3 analyzer — arms x seeds x denominators, cap-violation per diet,
// oracle vs realised, variety violations, LNS arm, permutation, D5.
//   node fleet/scratch/W3-3/analyze.mjs fleet/out/W3-3/probe-s*.json --json=fleet/out/W3-3/results.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const jsonOut = (args.find((a) => a.startsWith("--json=")) || "").split("=")[1] || null;

const ARMS = ["base", "oracle", "master", "greedy", "lns", "realised"];
const pct = (k, n) => (n ? (100 * k) / n : null);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
// A5: real at 95% iff |b-c| > 1.96*sqrt(b+c)   (b = baseline-fail -> arm-pass)
const a5 = (b, c) => ({ b, c, diff: b - c, floor: r2(1.959964 * Math.sqrt(b + c)), real: Math.abs(b - c) > 1.959964 * Math.sqrt(b + c) });

const docs = files.map((f) => JSON.parse(fs.readFileSync(path.resolve(REPO, f), "utf8")));

function analyze(doc) {
  const rows = doc.rows.filter((r) => !r.crash);
  const crashed = doc.rows.filter((r) => r.crash);
  const isDeg = (r) => (r.mealSlots + r.snackSlots) === 0;
  const week = rows.filter((r) => r.D > 1);
  const dayH = rows.filter((r) => r.D === 1);

  // ── LEVEL: three denominators, judged held FIXED at the baseline's value ──
  const T = Object.fromEntries(ARMS.map((a) => [a, { d640: { k: 0, n: 0 }, d553: { k: 0, n: 0 }, d537: { k: 0, n: 0 } }]));
  let degDays = 0, unjudgedSatDays = 0;
  for (const r of rows) {
    const deg = isDeg(r);
    if (deg) degDays += r.D;
    for (let i = 0; i < r.D; i++) {
      const sat = r.satisfiable && !deg;
      const judged = !!(r.judgedPerDay && r.judgedPerDay[i]);
      if (sat && !judged) unjudgedSatDays++;
      for (const a of ARMS) {
        const inB = r[a].perDayInBand ? !!r[a].perDayInBand[i] : null;
        if (inB == null) continue;
        T[a].d640.n++; if (inB) T[a].d640.k++;
        if (sat) { T[a].d553.n++; if (inB) T[a].d553.k++; }
        if (sat && judged) { T[a].d537.n++; if (inB) T[a].d537.k++; }
      }
    }
  }
  for (const r of crashed) for (const a of ARMS) { T[a].d640.n += (r.D || 1); }

  // ── A. CAP VIOLATION of the naive per-day argmax, per diet ───────────────
  const capByDiet = {};
  for (const r of week) {
    capByDiet[r.diet] ||= { personas: 0, violated: 0, maxUsageHist: {}, worstExcess: 0, examples: [] };
    const v = capByDiet[r.diet];
    v.personas++;
    if (r.oracle.capViolated) { v.violated++; if (v.examples.length < 3) v.examples.push({ id: r.id, maxUsage: r.oracle.maxUsage, cap: r.cap, over: r.oracle.capExcess.slice(0, 2) }); }
    v.maxUsageHist[r.oracle.maxUsage] = (v.maxUsageHist[r.oracle.maxUsage] || 0) + 1;
    v.worstExcess = Math.max(v.worstExcess, r.oracle.maxUsage - r.cap);
  }
  const capWeek = { personas: week.length, violated: week.filter((r) => r.oracle.capViolated).length };
  const capAll = { personas: rows.length, violated: rows.filter((r) => r.oracle.capViolated).length };
  const capDay = { personas: dayH.length, violated: dayH.filter((r) => r.oracle.capViolated).length };

  // pool capacity vs slot demand — is the cap near-tight BEFORE selection?
  const capacity = {};
  for (const r of week) {
    const c = (capacity[r.diet] ||= { personas: 0, snackStarved: 0, mealStarved: 0, minSnackSlack: null, minMealSlack: null, snackEligibleMin: Infinity, snackEligibleMax: -Infinity });
    c.personas++;
    if (r.snackSlots > 0) {
      const s = r.snackCapacity - r.snackSlots;
      c.minSnackSlack = c.minSnackSlack == null ? s : Math.min(c.minSnackSlack, s);
      if (s < 0) c.snackStarved++;
      c.snackEligibleMin = Math.min(c.snackEligibleMin, r.snackEligible);
      c.snackEligibleMax = Math.max(c.snackEligibleMax, r.snackEligible);
    }
    if (r.mealSlots > 0) { const m = r.mealCapacity - r.mealSlots; c.minMealSlack = c.minMealSlack == null ? m : Math.min(c.minMealSlack, m); if (m < 0) c.mealStarved++; }
  }
  for (const c of Object.values(capacity)) { if (c.snackEligibleMin === Infinity) { c.snackEligibleMin = null; c.snackEligibleMax = null; } }

  // ── B. sub-populations ───────────────────────────────────────────────────
  const sub = (list) => Object.fromEntries(ARMS.map((a) => {
    let k = 0, n = 0;
    for (const r of list) for (let i = 0; i < r.D; i++) { if (!r[a].perDayInBand) continue; n++; if (r[a].perDayInBand[i]) k++; }
    return [a, { k, n, pct: r2(pct(k, n)) }];
  }));
  const weekSat = week.filter((r) => r.satisfiable && !isDeg(r));
  const daySat = dayH.filter((r) => r.satisfiable && !isDeg(r));

  // ── A5 paired discordance, per arm, satisfiable days, per DAY ───────────
  const discord = {};
  for (const a of ARMS.filter((x) => x !== "base")) {
    let b = 0, c = 0;
    for (const r of rows) {
      if (!r.satisfiable || isDeg(r) || !r[a].perDayInBand) continue;
      for (let i = 0; i < r.D; i++) {
        const A = !!r.base.perDayInBand[i], B = !!r[a].perDayInBand[i];
        if (!A && B) b++; else if (A && !B) c++;
      }
    }
    discord[a] = a5(b, c);
  }

  // ── E. variety violations, EVERY arm (week personas) ────────────────────
  const variety = Object.fromEntries(ARMS.map((a) => {
    let breach = 0, worst = 0, pairs = 0, inc = 0, withRepeat = 0;
    for (const r of week) {
      const mu = r[a].maxUsage;
      if (mu != null && mu > r.cap) { breach++; worst = Math.max(worst, mu - r.cap); }
      const ad = r[a].adj;
      if (ad) { pairs += ad.pairs; inc += ad.incidences; if (ad.pairs) withRepeat++; }
    }
    return [a, { weekPersonas: week.length, capBreaches: breach, capBreachPct: r2(pct(breach, week.length)), worstExcess: worst, adjPairs: pairs, adjIncidences: inc, personasWithAdjRepeat: withRepeat }];
  }));

  // ── D. free permutation ────────────────────────────────────────────────
  const permutation = Object.fromEntries(["base", "pick", "lns"].map((w) => {
    const acc = { weekPersonas: week.length, adjPairsBefore: 0, adjPairsAfter: 0, adjIncidencesBefore: 0, adjIncidencesAfter: 0, daysInBandBefore: 0, daysInBandAfter: 0, personasImproved: 0, personasZeroAfter: 0 };
    for (const r of week) {
      const p = r.perm[w];
      acc.adjPairsBefore += p.before.pairs; acc.adjPairsAfter += p.after.pairs;
      acc.adjIncidencesBefore += p.before.incidences; acc.adjIncidencesAfter += p.after.incidences;
      acc.daysInBandBefore += p.inBandBefore; acc.daysInBandAfter += p.inBandAfter;
      if (p.after.incidences < p.before.incidences) acc.personasImproved++;
      if (p.after.incidences === 0) acc.personasZeroAfter++;
    }
    acc.reductionPct = r2(pct(acc.adjIncidencesBefore - acc.adjIncidencesAfter, acc.adjIncidencesBefore));
    acc.complianceCost = acc.daysInBandBefore - acc.daysInBandAfter;
    return [w, acc];
  }));

  // ── F/D5 ────────────────────────────────────────────────────────────────
  const decidedBy = {};
  let byMatchLoss = 0, byMatchGain = 0;
  for (const r of rows) {
    if (!r.d5) continue;
    decidedBy[r.d5.decidedBy] = (decidedBy[r.d5.decidedBy] || 0) + 1;
    const d = r.d5.byMatchOnly.inBand - r.base.inBand;
    if (d < 0) byMatchLoss += -d; else if (d > 0) byMatchGain += d;
  }
  const exhausted = rows.filter((r) => r.attemptsRun === (doc.kMain ?? doc.k)).length;
  const attemptHist = {};
  for (const r of rows) attemptHist[r.attemptsRun] = (attemptHist[r.attemptsRun] || 0) + 1;

  // ── the k-ladder ────────────────────────────────────────────────────────
  const ladder = {};
  for (const r of rows) {
    if (!r.ladder) continue;
    const sat = r.satisfiable && !isDeg(r);
    for (const [kk, v] of Object.entries(r.ladder)) {
      const L = (ladder[kk] ||= { base: 0, oracle: 0, master: 0, n: 0, capViolatedWeek: 0, weekPersonas: 0, masterNull: 0 });
      if (!sat) continue;
      L.base += v.base; L.oracle += v.oracle; L.n += r.D;
      if (v.master == null) L.masterNull++; else L.master += v.master;
      if (r.D > 1) { L.weekPersonas++; if (v.capViolated) L.capViolatedWeek++; }
    }
  }
  for (const L of Object.values(ladder)) {
    L.basePct = r2(pct(L.base, L.n)); L.oraclePct = r2(pct(L.oracle, L.n));
    L.masterPct = L.masterNull ? null : r2(pct(L.master, L.n));
    L.capViolPct = r2(pct(L.capViolatedWeek, L.weekPersonas));
  }

  // ── per-diet arm levels, week personas only (where selection can act) ────
  const byDiet = {};
  for (const r of week) {
    const d = (byDiet[r.diet] ||= { personas: 0, days: 0, poolMin: Infinity, poolMax: -Infinity, ...Object.fromEntries(ARMS.map((a) => [a, 0])) });
    d.personas++; d.days += r.D;
    d.poolMin = Math.min(d.poolMin, r.poolSize); d.poolMax = Math.max(d.poolMax, r.poolSize);
    for (const a of ARMS) d[a] += r[a].inBand;
  }

  // ── COMPRESSION TEST: does the oracle's headroom shrink as the baseline
  //    per-persona success rises? (W2-2 §7: fixing the portioner shrinks
  //    selection's headroom.) Bucketed by the persona's baseline day count.
  const compression = {};
  for (const r of week) {
    const b = r.base.inBand;
    const c = (compression[b] ||= { personas: 0, baseDays: 0, oracleDays: 0, masterDays: 0, realisedDays: 0, totalDays: 0 });
    c.personas++; c.baseDays += r.base.inBand; c.oracleDays += r.oracle.inBand;
    c.masterDays += r.master.inBand; c.realisedDays += r.realised.inBand; c.totalDays += r.D;
  }
  for (const c of Object.values(compression)) {
    c.oracleGainPerPersona = r2((c.oracleDays - c.baseDays) / c.personas);
    c.masterGainPerPersona = r2((c.masterDays - c.baseDays) / c.personas);
    c.realisedGainPerPersona = r2((c.realisedDays - c.baseDays) / c.personas);
    // days the persona could still gain if every remaining day landed
    c.remainingDays = c.totalDays - c.baseDays;
    c.oracleCaptureOfRemaining = c.remainingDays ? r2((100 * (c.oracleDays - c.baseDays)) / c.remainingDays) : null;
  }

  // ── E11 GUARD: no arm may gain by REFUSING. Total filled slots per arm. ──
  const filledByArm = {};
  for (const a of ["base", "oracle", "lns"]) {
    let f = 0;
    for (const r of rows) if (r[a].perDayFilled) f += r[a].perDayFilled.reduce((s, x) => s + x, 0);
    filledByArm[a] = f;
  }

  return {
    seed: doc.seed, k: doc.k, kMain: doc.kMain ?? doc.k, personas: doc.personas,
    byDiet, compression, filledByArm,
    provenance: doc.provenance, lnsConfig: doc.lns,
    population: {
      weekPersonas: week.length, dayPersonas: dayH.length,
      weekDays: week.reduce((s, r) => s + r.D, 0), dayDays: dayH.reduce((s, r) => s + r.D, 0),
      degenerateDays: degDays, unjudgedSatDays, crashed: crashed.length,
    },
    level: Object.fromEntries(ARMS.map((a) => [a, {
      d553: { ...T[a].d553, pct: r2(pct(T[a].d553.k, T[a].d553.n)) },
      d640: { ...T[a].d640, pct: r2(pct(T[a].d640.k, T[a].d640.n)) },
      d537: { ...T[a].d537, pct: r2(pct(T[a].d537.k, T[a].d537.n)) },
    }])),
    weekSatOnly: sub(weekSat),
    dayHorizonSatOnly: sub(daySat),
    capViolation: {
      all: { ...capAll, pct: r2(pct(capAll.violated, capAll.personas)) },
      weekPersonas: { ...capWeek, pct: r2(pct(capWeek.violated, capWeek.personas)) },
      dayPersonas: { ...capDay, pct: r2(pct(capDay.violated, capDay.personas)) },
      byDiet: Object.fromEntries(Object.entries(capByDiet).map(([d, v]) => [d, { ...v, pct: r2(pct(v.violated, v.personas)) }])),
    },
    capCapacity: capacity,
    a5: discord,
    variety, permutation,
    d5: { exhaustedRuns: exhausted, exhaustedPct: r2(pct(exhausted, rows.length)), attemptHist, decidedBy, byMatchOnlyLostDays: byMatchLoss, byMatchOnlyGainedDays: byMatchGain },
    ladder,
    lnsExtraDaySolves: doc.lns.extraDaySolves,
    masterAttainsOracle: { week: week.filter((r) => r.master.attainsOracle).length, weekTotal: week.length, truncated: rows.filter((r) => r.master.truncated).length },
  };
}

const results = docs.map(analyze);
const sumBy = (f) => results.reduce((s, r) => { const v = f(r); s.k += v.k; s.n += v.n; return s; }, { k: 0, n: 0 });
const wp = (o) => ({ ...o, pct: r2(pct(o.k, o.n)) });

const pooled = {
  seeds: results.map((r) => r.seed),
  level553: Object.fromEntries(ARMS.map((a) => [a, wp(sumBy((r) => r.level[a].d553))])),
  level640: Object.fromEntries(ARMS.map((a) => [a, wp(sumBy((r) => r.level[a].d640))])),
  level537: Object.fromEntries(ARMS.map((a) => [a, wp(sumBy((r) => r.level[a].d537))])),
  weekSatOnly: Object.fromEntries(ARMS.map((a) => [a, wp(sumBy((r) => r.weekSatOnly[a]))])),
  dayHorizonSatOnly: Object.fromEntries(ARMS.map((a) => [a, wp(sumBy((r) => r.dayHorizonSatOnly[a]))])),
  a5: Object.fromEntries(ARMS.filter((x) => x !== "base").map((a) => {
    const b = results.reduce((s, r) => s + r.a5[a].b, 0), c = results.reduce((s, r) => s + r.a5[a].c, 0);
    return [a, a5(b, c)];
  })),
  capViolationWeek: (() => { const o = results.reduce((s, r) => { s.violated += r.capViolation.weekPersonas.violated; s.personas += r.capViolation.weekPersonas.personas; return s; }, { violated: 0, personas: 0 }); o.pct = r2(pct(o.violated, o.personas)); return o; })(),
  capViolationAll: (() => { const o = results.reduce((s, r) => { s.violated += r.capViolation.all.violated; s.personas += r.capViolation.all.personas; return s; }, { violated: 0, personas: 0 }); o.pct = r2(pct(o.violated, o.personas)); return o; })(),
  capByDiet: (() => {
    const m = {};
    for (const r of results) for (const [d, v] of Object.entries(r.capViolation.byDiet)) {
      m[d] ||= { personas: 0, violated: 0, worstExcess: 0 };
      m[d].personas += v.personas; m[d].violated += v.violated; m[d].worstExcess = Math.max(m[d].worstExcess, v.worstExcess);
    }
    for (const d of Object.keys(m)) m[d].pct = r2(pct(m[d].violated, m[d].personas));
    return m;
  })(),
  variety: Object.fromEntries(ARMS.map((a) => [a, results.reduce((s, r) => {
    s.capBreaches += r.variety[a].capBreaches; s.weekPersonas += r.variety[a].weekPersonas;
    s.adjPairs += r.variety[a].adjPairs; s.adjIncidences += r.variety[a].adjIncidences;
    s.worstExcess = Math.max(s.worstExcess, r.variety[a].worstExcess);
    return s;
  }, { capBreaches: 0, weekPersonas: 0, adjPairs: 0, adjIncidences: 0, worstExcess: 0 })])),
  permutation: Object.fromEntries(["base", "pick", "lns"].map((w) => {
    const o = results.reduce((s, r) => {
      const p = r.permutation[w];
      for (const kk of ["adjPairsBefore", "adjPairsAfter", "adjIncidencesBefore", "adjIncidencesAfter", "daysInBandBefore", "daysInBandAfter", "personasImproved", "personasZeroAfter", "weekPersonas"]) s[kk] += p[kk];
      return s;
    }, { adjPairsBefore: 0, adjPairsAfter: 0, adjIncidencesBefore: 0, adjIncidencesAfter: 0, daysInBandBefore: 0, daysInBandAfter: 0, personasImproved: 0, personasZeroAfter: 0, weekPersonas: 0 });
    o.reductionPct = r2(pct(o.adjIncidencesBefore - o.adjIncidencesAfter, o.adjIncidencesBefore));
    o.complianceCost = o.daysInBandBefore - o.daysInBandAfter;
    return [w, o];
  })),
  d5: (() => {
    const o = { exhaustedRuns: 0, totalRuns: 0, decidedBy: {}, byMatchOnlyLostDays: 0, byMatchOnlyGainedDays: 0 };
    for (const r of results) {
      o.exhaustedRuns += r.d5.exhaustedRuns; o.totalRuns += r.personas;
      o.byMatchOnlyLostDays += r.d5.byMatchOnlyLostDays; o.byMatchOnlyGainedDays += r.d5.byMatchOnlyGainedDays;
      for (const [k, v] of Object.entries(r.d5.decidedBy)) o.decidedBy[k] = (o.decidedBy[k] || 0) + v;
    }
    o.exhaustedPct = r2(pct(o.exhaustedRuns, o.totalRuns));
    return o;
  })(),
  ladder: (() => {
    const m = {};
    for (const r of results) for (const [kk, v] of Object.entries(r.ladder)) {
      const L = (m[kk] ||= { base: 0, oracle: 0, master: 0, n: 0, capViolatedWeek: 0, weekPersonas: 0, masterNull: 0 });
      L.base += v.base; L.oracle += v.oracle; L.master += v.master; L.n += v.n;
      L.capViolatedWeek += v.capViolatedWeek; L.weekPersonas += v.weekPersonas; L.masterNull += v.masterNull;
    }
    for (const L of Object.values(m)) {
      L.basePct = r2(pct(L.base, L.n)); L.oraclePct = r2(pct(L.oracle, L.n));
      L.masterPct = L.masterNull ? null : r2(pct(L.master, L.n));
      L.capViolPct = r2(pct(L.capViolatedWeek, L.weekPersonas));
    }
    return m;
  })(),
  byDiet: (() => {
    const m = {};
    for (const r of results) for (const [d, v] of Object.entries(r.byDiet)) {
      const t = (m[d] ||= { personas: 0, days: 0, poolMin: Infinity, poolMax: -Infinity, ...Object.fromEntries(ARMS.map((a) => [a, 0])) });
      t.personas += v.personas; t.days += v.days;
      t.poolMin = Math.min(t.poolMin, v.poolMin); t.poolMax = Math.max(t.poolMax, v.poolMax);
      for (const a of ARMS) t[a] += v[a];
    }
    for (const t of Object.values(m)) for (const a of ARMS) t[a + "Pct"] = r2(pct(t[a], t.days));
    return m;
  })(),
  compression: (() => {
    const m = {};
    for (const r of results) for (const [b, v] of Object.entries(r.compression)) {
      const t = (m[b] ||= { personas: 0, baseDays: 0, oracleDays: 0, masterDays: 0, realisedDays: 0, totalDays: 0 });
      for (const kk of ["personas", "baseDays", "oracleDays", "masterDays", "realisedDays", "totalDays"]) t[kk] += v[kk];
    }
    for (const t of Object.values(m)) {
      t.oracleGainPerPersona = r2((t.oracleDays - t.baseDays) / t.personas);
      t.masterGainPerPersona = r2((t.masterDays - t.baseDays) / t.personas);
      t.realisedGainPerPersona = r2((t.realisedDays - t.baseDays) / t.personas);
      t.remainingDays = t.totalDays - t.baseDays;
      t.oracleCaptureOfRemaining = t.remainingDays ? r2((100 * (t.oracleDays - t.baseDays)) / t.remainingDays) : null;
    }
    return m;
  })(),
  filledByArm: (() => {
    const m = {};
    for (const a of ["base", "oracle", "lns"]) m[a] = results.reduce((s, r) => s + r.filledByArm[a], 0);
    return m;
  })(),
  // effective independent attempts: solve 1-(1-p1)^m = pk for m, where p1 is
  // the k=1 per-day success rate and pk the ORACLE at k. W2-2 §5.2 derived
  // m~2.46 from two numbers whose denominators it could not verify; this
  // computes both endpoints on ONE denominator (n=553 satisfiable-planned).
  effectiveAttempts: null,
  lnsExtraDaySolves: results.reduce((s, r) => s + r.lnsExtraDaySolves, 0),
  masterAttainsOracle: results.reduce((s, r) => { s.week += r.masterAttainsOracle.week; s.weekTotal += r.masterAttainsOracle.weekTotal; s.truncated += r.masterAttainsOracle.truncated; return s; }, { week: 0, weekTotal: 0, truncated: 0 }),
};

// effective independent attempts, computed on ONE denominator
{
  const p1 = pooled.ladder["1"] ? pooled.ladder["1"].oracle / pooled.ladder["1"].n : null;
  const out = {};
  if (p1 != null && p1 > 0 && p1 < 1) {
    for (const kk of Object.keys(pooled.ladder)) {
      const pk = pooled.ladder[kk].oracle / pooled.ladder[kk].n;
      out[kk] = { oraclePct: r2(100 * pk), m: pk >= 1 ? null : r2(Math.log(1 - pk) / Math.log(1 - p1)) };
    }
  }
  pooled.effectiveAttempts = { p1: r2(100 * p1), byK: out, note: "m = ln(1-oracle_k)/ln(1-p1); m=k would mean fully independent attempts" };
}

// C12 support: the ATTEMPT-BUDGET term, restated on n=537 so it is directly
// comparable with C12's published pair (C2@1 = 79.9% vs baseline@5 = 77.1%).
// A day with 0 filled slots has 0 kcal and is out of band under EVERY arm and
// every k, so moving from n=553 to n=537 changes only the denominator.
{
  const unjudged = results.reduce((s, r) => s + r.population.unjudgedSatDays, 0);
  const l = pooled.ladder;
  pooled.ladder537 = Object.fromEntries(Object.keys(l).map((kk) => {
    const n = l[kk].n - unjudged;
    return [kk, { base: l[kk].base, n, basePct: r2(pct(l[kk].base, n)), oraclePct: r2(pct(l[kk].oracle, n)), masterPct: l[kk].masterNull ? null : r2(pct(l[kk].master, n)) }];
  }));
  pooled.c12Support = {
    baselineAt1_n537: pooled.ladder537["1"]?.basePct,
    baselineAt5_n537: pooled.ladder537["5"]?.basePct,
    attemptBudgetWorth_pts: r2((pooled.ladder537["5"]?.basePct ?? 0) - (pooled.ladder537["1"]?.basePct ?? 0)),
    note: "C12 asserts a REORDERING (C2, smallest-slot-first) at 1 attempt beats the baseline at 5. This lane measures only the attempt-budget half: how much the baseline gains from attempts 2..5. C2 itself is W3-2/W3-5's.",
  };
}

const doc = { schema: "fleet/W3-3/results/v1", generatedAt: new Date().toISOString(), arms: ARMS, armNotes: {
  base: "shipping generateBestWeekPlan best-of-5, reconstructed from the same attempt stream; XCHECKed 640/640 vs W1-2",
  oracle: "post-hoc per-day argmax across the k attempts, IGNORES the weekly repeat cap — an UPPER BOUND, not a policy",
  master: "exact cap-feasible master over the same candidate set (one candidate per calendar day, usage(r) <= repeatCap)",
  greedy: "naive greedy-with-skip — MEASURED FOR REFERENCE ONLY; W2-2 §3(iv) forbids shipping it",
  lns: "W2-2's recommendation: keep the best whole week, destroy the d worst days, re-solve against the surviving usageCount ledger",
  realised: "W2-2's safe rule: cherry-pick argmax; if it passes the cap ship it (attains the bound); if not, LNS repair",
}, seeds: results, pooled };
if (jsonOut) { const p = path.resolve(REPO, jsonOut); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(doc, null, 1)); }

const L = [];
L.push(`## POPULATION`);
for (const r of results) L.push(`seed ${r.seed}: week personas ${r.population.weekPersonas} (${r.population.weekDays} d) · day personas ${r.population.dayPersonas} (${r.population.dayDays} d) · degenerate ${r.population.degenerateDays} d · unjudged-sat ${r.population.unjudgedSatDays} d`);
L.push("");
L.push(`## LEVEL by arm (pooled ${results.length} seeds)`);
L.push(`| arm | n=553×${results.length} | n=640×${results.length} | n=537×${results.length} | week-horizon sat only | day-horizon sat only |`);
L.push(`|---|---|---|---|---|---|`);
for (const a of ARMS) L.push(`| ${a} | ${pooled.level553[a].k}/${pooled.level553[a].n} = **${pooled.level553[a].pct}%** | ${pooled.level640[a].k}/${pooled.level640[a].n} = ${pooled.level640[a].pct}% | ${pooled.level537[a].k}/${pooled.level537[a].n} = ${pooled.level537[a].pct}% | ${pooled.weekSatOnly[a].k}/${pooled.weekSatOnly[a].n} = ${pooled.weekSatOnly[a].pct}% | ${pooled.dayHorizonSatOnly[a].k}/${pooled.dayHorizonSatOnly[a].n} = ${pooled.dayHorizonSatOnly[a].pct}% |`);
L.push("");
L.push(`## A. CAP VIOLATION of the naive per-day argmax`);
L.push(`pooled, week personas: ${pooled.capViolationWeek.violated}/${pooled.capViolationWeek.personas} = **${pooled.capViolationWeek.pct}%** · all personas: ${pooled.capViolationAll.violated}/${pooled.capViolationAll.personas} = ${pooled.capViolationAll.pct}%`);
L.push(`| diet | violated/week-personas (3 seeds) | % | worst excess over cap |`);
L.push(`|---|---|---|---|`);
for (const [d, v] of Object.entries(pooled.capByDiet).sort((a, b) => b[1].personas - a[1].personas)) L.push(`| ${d} | ${v.violated}/${v.personas} | ${v.pct}% | +${v.worstExcess} |`);
L.push("");
L.push(`## A5 (pooled, satisfiable days, paired per-day vs baseline)`);
for (const [a, v] of Object.entries(pooled.a5)) L.push(`  ${a.padEnd(9)} b=${v.b} c=${v.c} diff=${v.diff} floor=${v.floor} => ${v.real ? "CLEARS the A5 floor" : "does NOT clear"}`);
L.push("");
L.push(`## E. VARIETY VIOLATIONS by arm (week personas, pooled)`);
L.push(`| arm | cap breaches | worst excess | adjacency pairs | adjacency incidences |`);
L.push(`|---|---|---|---|---|`);
for (const a of ARMS) { const v = pooled.variety[a]; L.push(`| ${a} | ${v.capBreaches}/${v.weekPersonas} | +${v.worstExcess} | ${v.adjPairs} | ${v.adjIncidences} |`); }
L.push("");
L.push(`## D. FREE PERMUTATION (pooled)`);
for (const [w, v] of Object.entries(pooled.permutation)) L.push(`  ${w.padEnd(5)} adj incidences ${v.adjIncidencesBefore} -> ${v.adjIncidencesAfter} (${v.reductionPct}% cut) · pairs ${v.adjPairsBefore} -> ${v.adjPairsAfter} · daysInBand ${v.daysInBandBefore} -> ${v.daysInBandAfter} (COST ${v.complianceCost}) · improved ${v.personasImproved}/${v.weekPersonas} · zero-after ${v.personasZeroAfter}`);
L.push("");
L.push(`## F/D5`);
L.push(`  exhausted all k=${results[0].kMain}: ${pooled.d5.exhaustedRuns}/${pooled.d5.totalRuns} = ${pooled.d5.exhaustedPct}%`);
L.push(`  winner decided by: ${JSON.stringify(pooled.d5.decidedBy)}`);
L.push(`  selecting on avgMatch ALONE (SCORE_WEIGHTS only): loses ${pooled.d5.byMatchOnlyLostDays} days, gains ${pooled.d5.byMatchOnlyGainedDays}`);
for (const r of results) L.push(`  seed ${r.seed}: attemptsRun hist ${JSON.stringify(r.d5.attemptHist)}`);
L.push("");
L.push(`## k-LADDER (satisfiable days, pooled; n=${pooled.ladder["5"]?.n})`);
L.push(`| k | base | oracle | exact master | cap-violated (week personas) |`);
L.push(`|--:|--:|--:|--:|--:|`);
for (const kk of Object.keys(pooled.ladder).sort((a, b) => Number(a) - Number(b))) { const v = pooled.ladder[kk]; L.push(`| ${kk} | ${v.basePct}% | ${v.oraclePct}% | ${v.masterPct == null ? "—" : v.masterPct + "%"} | ${v.capViolPct}% |`); }
L.push("");
L.push(`## LNS budget: ${pooled.lnsExtraDaySolves} extra day-solves across ${results.length} seeds`);
L.push(`## master attains the oracle on ${pooled.masterAttainsOracle.week}/${pooled.masterAttainsOracle.weekTotal} week personas · DFS truncations ${pooled.masterAttainsOracle.truncated}`);
L.push("");
L.push(`## PER-DIET arm levels — WEEK personas only (pooled 3 seeds)`);
L.push(`⚠️ W1-2 §2: do NOT A/B on a per-diet cell. Reported for shape, not for decisions.`);
L.push(`| diet | week personas | days | pool | base | oracle | master | realised | oracle headroom |`);
L.push(`|---|--:|--:|--:|--:|--:|--:|--:|--:|`);
for (const [d, v] of Object.entries(pooled.byDiet).sort((a, b) => b[1].days - a[1].days)) L.push(`| ${d} | ${v.personas} | ${v.days} | ${v.poolMin}–${v.poolMax} | ${v.basePct}% | ${v.oraclePct}% | ${v.masterPct}% | ${v.realisedPct}% | +${r2(v.oraclePct - v.basePct)} |`);
L.push("");
L.push(`## COMPRESSION — oracle headroom vs the persona's OWN baseline (week personas)`);
L.push(`| baseline days in band (of 7) | personas | oracle gain / persona | master gain | realised gain | oracle capture of remaining days |`);
L.push(`|--:|--:|--:|--:|--:|--:|`);
for (const b of Object.keys(pooled.compression).sort((a, z) => Number(a) - Number(z))) { const v = pooled.compression[b]; L.push(`| ${b} | ${v.personas} | +${v.oracleGainPerPersona} | +${v.masterGainPerPersona} | +${v.realisedGainPerPersona} | ${v.oracleCaptureOfRemaining == null ? "—" : v.oracleCaptureOfRemaining + "%"} |`); }
L.push("");
L.push(`## EFFECTIVE INDEPENDENT ATTEMPTS (n=553 satisfiable-planned, one denominator)`);
L.push(`  p(k=1) = ${pooled.effectiveAttempts.p1}%`);
for (const [kk, v] of Object.entries(pooled.effectiveAttempts.byK)) L.push(`  k=${kk.padStart(2)} oracle ${v.oraclePct}% => m = ${v.m}`);
L.push("");
L.push(`## E11 GUARD — filled slots per arm (an arm that gained by REFUSING would show fewer)`);
L.push(`  ${JSON.stringify(pooled.filledByArm)}`);
L.push("");
L.push(`## CAP CAPACITY before selection (seed ${results[0].seed}, week personas)`);
L.push(`| diet | personas | snack-eligible | min snack slack | snack-starved | min meal slack | meal-starved |`);
L.push(`|---|--:|--:|--:|--:|--:|--:|`);
for (const [d, v] of Object.entries(results[0].capCapacity)) L.push(`| ${d} | ${v.personas} | ${v.snackEligibleMin}–${v.snackEligibleMax} | ${v.minSnackSlack} | ${v.snackStarved} | ${v.minMealSlack} | ${v.mealStarved} |`);
console.log(L.join("\n"));
