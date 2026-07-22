#!/usr/bin/env node
// ── Adaptive-TDEE self-benchmark ─────────────────────────────────────────
//
// Generates synthetic user histories with a KNOWN true expenditure, runs the
// real estimator against them, and reports the error it actually achieved.
// This exists so the claim "the adaptive estimator beats the formula" is a
// MEASUREMENT, not an assertion. It reports whatever it finds, including bad
// numbers. No database, no network — pure simulation.
//
//   node backend/scripts/benchmarkAdaptiveTdee.js [--users 500] [--seed 20260721] [--json out.json]
//
// The simulated world (every assumption is a knob, all listed in the header
// this prints, so a stranger can disagree with a specific number):
//   · true expenditure  = formula TDEE + N(0, 497)      ← calibrated so the
//     static-formula baseline reproduces its published ~335 kcal MEDIAN error
//     BY CONSTRUCTION. The baseline is the reference point, not a discovery.
//   · body mass moves by (intake − expenditure)/ρ_true, ρ_true = 7716 × N(1, 8%)
//     — the estimator's fixed ρ is deliberately wrong by a realistic amount
//   · observed weight = mass + AR(1) water/glycogen + sodium spikes + scale noise
//   · weigh-ins happen on ~85% of days; food is logged on ~90%, of which ~5%
//     are partial logs; reported intake carries noise and (scenario-dependent)
//     a systematic under-report
const { computeEnergy, deriveTarget } = require("../src/lib/bmrEngine.js");
const { estimateExpenditure, KCAL_PER_KG } = require("../src/lib/expenditureEstimator.js");
const { OCCUPATIONS } = require("../src/lib/activityData.js");
const { addDays } = require("../src/lib/dates.js");

// ── CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const USERS = Number(argOf("users", 500));
const SEED = Number(argOf("seed", 20260721));
const JSON_OUT = argOf("json", null);
const HORIZONS = [14, 21, 28, 42, 56];
const SIM_DAYS = 60;
const ANCHOR = "2026-01-01"; // simulation day 0; only relative dates matter

// ── seeded RNG ───────────────────────────────────────────────────────────
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}
const gauss = (rnd) => {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (rnd, arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
const uni = (rnd, lo, hi) => lo + rnd() * (hi - lo);

// ── simulation constants (all deliberately visible) ──────────────────────
const TRUE_TDEE_SD = 335 / 0.6745;   // 497 — calibrates the static baseline to its published median error
const RHO_TRUE_REL_SD = 0.08;         // per-person tissue-composition variation
const INTAKE_DAY_SD = 350;            // real day-to-day eating variation
const REPORT_NOISE_SD = 120;          // per-day logging imprecision
const WATER_AR1 = 0.70;               // day-to-day persistence of water weight
const WATER_INNOV_SD = 0.45;          // kg
const SPIKE_PROB = 0.05;
const SPIKE_MEAN_KG = 1.0;
const SPIKE_SD_KG = 0.5;
const SCALE_NOISE_SD = 0.10;          // kg — the scale itself
const WEIGHIN_ADHERENCE = 0.85;
const LOG_ADHERENCE = 0.90;
const PARTIAL_LOG_PROB = 0.05;

const TRAINING_STYLES = ["weights", "cardio", "mixed", "sport"];

function randomProfile(rnd) {
  const male = rnd() < 0.5;
  const sex = male ? "M" : "F";
  const age = Math.round(uni(rnd, 20, 62));
  const heightCm = Math.round(male ? uni(rnd, 163, 194) : uni(rnd, 150, 180));
  const startWeightKg = Math.round((male ? uni(rnd, 68, 135) : uni(rnd, 52, 112)) * 10) / 10;
  const bodyFatPct = rnd() < 0.65 ? Math.round(male ? uni(rnd, 12, 36) : uni(rnd, 20, 45)) : 0;
  return {
    sex, age, heightCm, bodyFatPct,
    occupationKey: pick(rnd, OCCUPATIONS).key,
    activityOverride: null,
    sessionsPerWeek: Math.round(uni(rnd, 0, 6)),
    trainingStyle: pick(rnd, TRAINING_STYLES),
    minutesPerSession: Math.round(uni(rnd, 30, 75)),
    rateLbPerWeek: pick(rnd, [0.5, 0.75, 1.0, 1.25, 1.5]),
    floorKcal: null,
    excludedFormulas: [],
    startWeightKg,
    startDate: ANCHOR,
    targetKcal: 0,
  };
}

/**
 * One synthetic user. Returns the full observable history plus the hidden truth.
 * `scenario` knobs: underReport (fraction), adaptFrac (drift in true expenditure
 * across the simulation).
 */
function simulateUser(rnd, { underReport = 0, adaptFrac = 0 } = {}) {
  const profile = randomProfile(rnd);
  const energy0 = computeEnergy(profile, profile.startWeightKg);
  const formulaTdee0 = energy0.tdee;
  const trueE0 = formulaTdee0 + gauss(rnd) * TRUE_TDEE_SD;
  if (!(trueE0 > 1000)) return null; // pathological draw — discard rather than clamp

  // Target is the app's formula target, held fixed: an OPEN loop, so the
  // measured error is the estimator's, not a feedback artefact.
  const t0 = deriveTarget(profile, formulaTdee0, energy0.rmr);
  const plannedIntake = t0.target;
  const rhoTrue = KCAL_PER_KG * (1 + gauss(rnd) * RHO_TRUE_REL_SD);
  const under = underReport;

  let mass = profile.startWeightKg;
  let water = gauss(rnd) * 0.5;
  const weighins = [], intake = [], trueE = [], trueIntake = [];

  for (let d = 0; d < SIM_DAYS; d++) {
    const date = addDays(ANCHOR, d);
    const eToday = trueE0 * (1 - adaptFrac * (d / SIM_DAYS));
    const iToday = Math.max(900, plannedIntake + gauss(rnd) * INTAKE_DAY_SD);
    trueE.push(eToday);
    trueIntake.push(iToday);

    mass += (iToday - eToday) / rhoTrue;
    water = WATER_AR1 * water + gauss(rnd) * WATER_INNOV_SD;
    const spike = rnd() < SPIKE_PROB ? Math.max(0, SPIKE_MEAN_KG + gauss(rnd) * SPIKE_SD_KG) : 0;
    if (rnd() < WEIGHIN_ADHERENCE) {
      weighins.push({ date, weightKg: mass + water + spike + gauss(rnd) * SCALE_NOISE_SD });
    }
    if (rnd() < LOG_ADHERENCE) {
      const partial = rnd() < PARTIAL_LOG_PROB ? uni(rnd, 0.3, 0.6) : 1;
      intake.push({ date, kcal: Math.max(0, Math.round(iToday * (1 - under) * partial + gauss(rnd) * REPORT_NOISE_SD)) });
    }
  }

  return { profile, weighins, intake, trueE, trueIntake, formulaTdee0, under };
}

// ── metrics ──────────────────────────────────────────────────────────────
const quantile = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const med = (a) => quantile(a, 0.5);
const meanOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function runScenario(label, opts, seed) {
  const rnd = lcg(seed);
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const u = simulateUser(rnd, opts);
    if (u) users.push(u);
  }

  const rows = [];
  for (const days of HORIZONS) {
    const asOf = addDays(ANCHOR, days - 1);
    const errAdaptive = [];   // |estimate − true expenditure today|
    const errReporting = [];  // |estimate − expenditure in the user's REPORTED units|
    const errStatic = [];     // |formula TDEE − true expenditure today|
    const errSystem = [];     // what the app actually runs on (formula when withheld)
    let applied = 0, confident = 0, withheld = 0, ciHits = 0, ciN = 0;

    for (const u of users) {
      // The formula TDEE the app would be using at this checkpoint (7-weigh-in avg).
      const upto = u.weighins.filter((w) => w.date <= asOf);
      const wNow = upto.length ? upto.slice(-7).reduce((s, w) => s + w.weightKg, 0) / upto.slice(-7).length : u.profile.startWeightKg;
      const energy = computeEnergy(u.profile, wNow);
      const r = estimateExpenditure({
        weighins: u.weighins, intake: u.intake, asOf, priorTdee: energy.tdee,
      });

      const eTrue = u.trueE[days - 1];
      // Expenditure expressed in the units the user LOGS in — the quantity that
      // actually matters for setting a target from a food diary.
      const meanTrueIntake = meanOf(u.trueIntake.slice(0, days));
      const eReported = eTrue - meanTrueIntake * u.under;

      errStatic.push(Math.abs(energy.tdee - eTrue));
      if (r.applied) {
        applied++;
        if (r.status === "confident") confident++;
        const est = r.estimate.expenditureKcal;
        errAdaptive.push(Math.abs(est - eTrue));
        errReporting.push(Math.abs(est - eReported));
        errSystem.push(Math.abs(est - eTrue));
        ciN++;
        if (Math.abs(est - eReported) <= r.estimate.seKcal) ciHits++;
      } else {
        withheld++;
        errSystem.push(Math.abs(energy.tdee - eTrue));
      }
    }

    rows.push({
      days,
      n: users.length,
      appliedPct: Math.round((applied / users.length) * 100),
      confidentPct: Math.round((confident / users.length) * 100),
      withheldPct: Math.round((withheld / users.length) * 100),
      adaptiveMedian: errAdaptive.length ? Math.round(med(errAdaptive)) : null,
      adaptiveMean: errAdaptive.length ? Math.round(meanOf(errAdaptive)) : null,
      adaptiveP90: errAdaptive.length ? Math.round(quantile(errAdaptive, 0.9)) : null,
      reportingMedian: errReporting.length ? Math.round(med(errReporting)) : null,
      reportingP90: errReporting.length ? Math.round(quantile(errReporting, 0.9)) : null,
      staticMedian: Math.round(med(errStatic)),
      staticP90: Math.round(quantile(errStatic, 0.9)),
      systemMedian: Math.round(med(errSystem)),
      ci68HitPct: ciN ? Math.round((ciHits / ciN) * 100) : null,
    });
  }
  return { label, opts, rows };
}

// ── report ───────────────────────────────────────────────────────────────
const pad = (s, n) => String(s == null ? "—" : s).padStart(n);
function printScenario(sc) {
  console.log(`\n### ${sc.label}`);
  console.log(`    ${JSON.stringify(sc.opts)}`);
  console.log("");
  console.log("    days  applied  conf   ADAPTIVE med   mean    p90  |  vs REPORTED med  p90  |  STATIC med   p90  |  SYSTEM med  |  68%CI hit");
  console.log("    ----  -------  ----   ------------  -----  -----  |  ---------------  ---  |  ----------  ----  |  ----------  |  ---------");
  for (const r of sc.rows) {
    console.log(
      `    ${pad(r.days, 4)}  ${pad(r.appliedPct + "%", 7)}  ${pad(r.confidentPct + "%", 4)}   ` +
      `${pad(r.adaptiveMedian, 12)}  ${pad(r.adaptiveMean, 5)}  ${pad(r.adaptiveP90, 5)}  |  ` +
      `${pad(r.reportingMedian, 15)}  ${pad(r.reportingP90, 3)}  |  ` +
      `${pad(r.staticMedian, 10)}  ${pad(r.staticP90, 4)}  |  ${pad(r.systemMedian, 10)}  |  ${pad(r.ci68HitPct + "%", 9)}`
    );
  }
}

console.log("═".repeat(112));
console.log("ADAPTIVE-TDEE SELF-BENCHMARK — synthetic users, known true expenditure");
console.log("═".repeat(112));
console.log(`users/scenario ${USERS} · seed ${SEED} · sim ${SIM_DAYS} days · estimator ${require("../src/lib/expenditureEstimator.js").VERSION}`);
console.log("");
console.log("All errors are |estimate − truth| in kcal/day.");
console.log("  ADAPTIVE    = vs the user's REAL expenditure           (only over users where the estimator spoke)");
console.log("  vs REPORTED = vs expenditure expressed in the units the user logs in (what a target must be set in)");
console.log("  STATIC      = the formula-TDEE baseline, same users     (calibrated by construction to ~335 median)");
console.log("  SYSTEM      = what the app actually runs on             (adaptive when applied, formula when withheld)");

const scenarios = [
  runScenario("A · honest logging, stable metabolism", { underReport: 0, adaptFrac: 0 }, SEED),
  runScenario("B · honest logging, 8% metabolic adaptation over the window", { underReport: 0, adaptFrac: 0.08 }, SEED + 1),
  runScenario("C · systematic 15% under-reporting", { underReport: 0.15, adaptFrac: 0 }, SEED + 2),
  runScenario("D · systematic 25% under-reporting (heavy)", { underReport: 0.25, adaptFrac: 0 }, SEED + 3),
];
scenarios.forEach(printScenario);

const a28 = scenarios[0].rows.find((r) => r.days === 28);
console.log("\n" + "═".repeat(112));
console.log("HEADLINE (scenario A, 28 days — the MacroFactor comparison point):");
console.log(`  adaptive estimator : ${a28.adaptiveMedian} kcal median absolute error (p90 ${a28.adaptiveP90}), spoke for ${a28.appliedPct}% of users`);
console.log(`  static formula     : ${a28.staticMedian} kcal median absolute error (p90 ${a28.staticP90})`);
console.log(`  whole system       : ${a28.systemMedian} kcal median (formula fallback counted for the ${a28.withheldPct}% withheld)`);
console.log(`  published reference: MacroFactor ~135 kcal @ 3–4 weeks · static formulas ~335 kcal`);
console.log("═".repeat(112));

if (JSON_OUT) {
  require("node:fs").writeFileSync(JSON_OUT, JSON.stringify({ users: USERS, seed: SEED, scenarios }, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}
