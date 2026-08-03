// Fleet finding W2-6 — the fat prescription. Two defects, one root cause.
//
// 5.5  FAT %E CLIMBED AS THE CUT DEEPENED. Fat was prescribed as a fixed
//      0.34-0.40 g per lb of lean mass, a number with no reference to
//      targetKcal. Lean mass barely moves during a cut while the target falls,
//      so the same gram count became a rising share of energy. Measured on the
//      pre-fix engine, one 200 lb / 20% BF man (LBM 160 lb), fat pinned at
//      59 g / 531 kcal the whole way down:
//          3,200 kcal -> 16.6 %E     2,000 kcal -> 26.6 %E
//          2,400 kcal -> 22.1 %E     1,800 kcal -> 29.5 %E
//          2,200 kcal -> 24.1 %E     1,600 kcal -> 33.2 %E
//      Across the canonical 250-persona fleet: r(deficit depth, fat %E) =
//      +0.51 on the 232 non-keto personas, 5th-95th percentile 16.8-33.7 %E,
//      64 of 232 outside the AMDR's 20-35 %E band. Every published source has
//      fat %E holding or FALLING into a deficit -- protein is the fixed-gram
//      requirement whose share is meant to rise against a shrinking budget.
//
// 5.6  THE ENGINE CERTIFIED DAYS UNDER ITS OWN FLOOR. ESSENTIAL_FAT_PER_LB_LBM
//      = 0.30 was applied to the band's MIDPOINT in two branches and never to
//      the band's LOWER EDGE, so keto and carb-floored targets published
//      fatLo = round(0.9 x essential) = 0.27 g/lb LBM -- beneath the engine's
//      own declaration with no downstream tolerance involved. Measured on the
//      pre-fix engine at 120 kg / 8% BF / 1,500 kcal: floor 73 g, published
//      fatLo 66 g.
//
// ROOT CAUSE, shared: the fat prescription was a naked gram count derived from
// lean mass alone -- it neither knew the energy target (5.5) nor carried its
// own floor into what it published (5.6).
//
// STILL OPEN, DOWNSTREAM, NOT THIS FILE: mealSolver grades a day's fat against
// this band with an unconditional +/-25%-of-midpoint allowance
// (mealSolver.js:212, 218-225, 250), so the lowest fat it certifies as
// compliant is fatLo - 0.25 x fatMid. On the old band that was
// 0.34 - 0.25 x 0.37 = 0.2475 g/lb LBM, which is the 232-of-250 measurement.
// No band this engine can emit fixes that: 0.875 x fatLo - 0.125 x fatHi >=
// fatLo has no solution for fatHi > 0. The engine now publishes `fatFloorG` so
// the solver can clamp its lower allowance to an absolute number; until it
// does, the compliant minimum stays under the floor. See the last test.
const test = require("node:test");
const assert = require("node:assert");
const {
  computeMacros, kg2lb,
  ESSENTIAL_FAT_PER_LB_LBM, FAT_PCT_ENERGY_MID, FAT_BAND_HALF_WIDTH,
} = require("../src/lib/bmrEngine.js");

const fatMidOf = (m) => (m.fatLo + m.fatHi) / 2;
const fatPctE = (m, kcal) => (fatMidOf(m) * 9) / kcal;
const pp = (x) => Math.round(x * 1000) / 10; // fraction -> percentage points

// AMDR (IOM/DRI) for adult fat intake. The published band the prescription has
// to live inside whenever a floor is not overriding it.
const AMDR_LO = 0.20;
const AMDR_HI = 0.35;

// A generic body grid — no persona, no personal defaults, nothing from the
// owner's profile. Every combination is a legal Profile the app can produce.
const BODIES = [];
for (const sex of ["M", "F"]) {
  for (const weightKg of [52, 68, 84, 100, 120]) {
    for (const bodyFatPct of [8, 14, 20, 26, 34]) {
      BODIES.push({ sex, weightKg, bodyFatPct, profile: { sex, bodyFatPct, dietaryStyle: null } });
    }
  }
}
const TARGETS = [1300, 1500, 1700, 1900, 2100, 2400, 2700, 3000, 3400];

// A day whose fat was moved by a floor is a different claim (a floor block) and
// is judged on the flag, not on %E.
const unfloored = (m) => !m.fatFloored && !m.carbFloored;

// ── 5.5 ───────────────────────────────────────────────────────────────────

test("5.5 the fat prescription responds to the calorie target at all", () => {
  // The mechanical core of the defect: same body, very different targets, and
  // the pre-fix engine returned the SAME gram count for both, because fat was
  // a pure function of lean mass.
  const p = { sex: "M", bodyFatPct: 20, dietaryStyle: null };
  const high = computeMacros(p, 90.7, 3000);
  const low = computeMacros(p, 90.7, 2000);
  assert.equal(high.lbmLb, low.lbmLb, "same body, so lean mass is the control");
  assert.ok(
    fatMidOf(high) > fatMidOf(low),
    `a 3,000 kcal target must prescribe more fat than a 2,000 kcal one; got ${fatMidOf(high)} g vs ${fatMidOf(low)} g`,
  );
  // and it must scale with energy, not sit a rounding step apart
  assert.ok(
    fatMidOf(high) - fatMidOf(low) > 20,
    `1,000 kcal of target should move fat by ~28 g at ${FAT_PCT_ENERGY_MID} of energy; moved ${fatMidOf(high) - fatMidOf(low)} g`,
  );
});

test("5.5 fat %E does not climb as the deficit deepens", () => {
  // One body, target swept from maintenance down to the point where the
  // essential-fat floor takes over. Pre-fix this ran 16.6 %E -> 29.5 %E.
  const p = { sex: "M", bodyFatPct: 20, dietaryStyle: null };
  const sweep = [3200, 3000, 2800, 2600, 2400, 2200, 2000, 1900]
    .map((kcal) => ({ kcal, m: computeMacros(p, 90.7, kcal) }))
    .filter((r) => unfloored(r.m));
  assert.ok(sweep.length >= 6, `need a real unfloored range to judge, got ${sweep.length} points`);

  const pcts = sweep.map((r) => fatPctE(r.m, r.kcal));
  const spread = pp(Math.max(...pcts) - Math.min(...pcts));
  assert.ok(spread <= 1.0, `fat %E must be flat across the deficit range; spread was ${spread} pp (${pcts.map((v) => pp(v)).join(", ")})`);

  // Direction, stated separately from spread: the deepest target may not carry
  // a materially HIGHER fat share than the shallowest. This is the assertion
  // the old model fails by +12.9 pp.
  const shallowest = fatPctE(sweep[0].m, sweep[0].kcal);
  const deepest = fatPctE(sweep[sweep.length - 1].m, sweep[sweep.length - 1].kcal);
  assert.ok(
    pp(deepest - shallowest) <= 1.0,
    `deepening the cut from ${sweep[0].kcal} to ${sweep[sweep.length - 1].kcal} kcal raised fat from ${pp(shallowest)} %E to ${pp(deepest)} %E`,
  );
});

test("5.5 every unfloored prescription sits at the published energy share", () => {
  let checked = 0;
  for (const b of BODIES) {
    for (const kcal of TARGETS) {
      const m = computeMacros(b.profile, b.weightKg, kcal);
      if (!unfloored(m)) continue;
      checked++;
      const d = Math.abs(fatPctE(m, kcal) - FAT_PCT_ENERGY_MID);
      assert.ok(
        pp(d) <= 0.6,
        `${b.sex} ${b.weightKg}kg ${b.bodyFatPct}%BF @ ${kcal} kcal: ${pp(fatPctE(m, kcal))} %E, expected ${pp(FAT_PCT_ENERGY_MID)} +/- 0.6 pp (integer-gram rounding only)`,
      );
    }
  }
  assert.ok(checked > 100, `grid must actually exercise the unfloored path, only ${checked} cases`);
});

test("5.5 no unfloored prescription leaves the AMDR 20-35 %E band", () => {
  const offenders = [];
  for (const b of BODIES) {
    for (const kcal of TARGETS) {
      const m = computeMacros(b.profile, b.weightKg, kcal);
      if (!unfloored(m)) continue;
      const v = fatPctE(m, kcal);
      if (v < AMDR_LO || v > AMDR_HI) offenders.push(`${b.sex} ${b.weightKg}kg ${b.bodyFatPct}%BF @${kcal} = ${pp(v)} %E`);
    }
  }
  assert.deepEqual(offenders, [], `outside AMDR: ${offenders.slice(0, 8).join(" | ")}`);
});

test("5.5 does NOT apply to keto — there fat filling the balance is the diet", () => {
  // Guard against over-correcting. A ketogenic target caps carbs by definition
  // and fat takes the remainder, so a high fat %E is correct there and the
  // energy-share midpoint must not be imposed on it.
  const m = computeMacros({ sex: "M", bodyFatPct: 22, dietaryStyle: "keto" }, 95, 2043);
  assert.equal(m.keto, true);
  assert.ok(m.carbMid <= 30, `keto carbs stay capped, got ${m.carbMid}`);
  assert.ok(
    fatPctE(m, 2043) > 0.45,
    `keto fat must still fill the balance, got ${pp(fatPctE(m, 2043))} %E`,
  );
});

// ── 5.6 ───────────────────────────────────────────────────────────────────

test("5.6 every target publishes the essential-fat floor it was held to", () => {
  for (const style of [null, "keto"]) {
    for (const b of BODIES) {
      const m = computeMacros({ ...b.profile, dietaryStyle: style }, b.weightKg, 1900);
      assert.equal(
        typeof m.fatFloorG, "number",
        `a target that declares a floor must publish it (style=${style}, ${b.sex} ${b.weightKg}kg)`,
      );
      assert.equal(
        m.fatFloorG, Math.round(m.lbmLb * ESSENTIAL_FAT_PER_LB_LBM),
        "the floor is one number, single-sourced from ESSENTIAL_FAT_PER_LB_LBM — no branch re-derives it",
      );
    }
  }
});

test("5.6 the published band's LOWER EDGE is never beneath the published floor", () => {
  // The direct breach. Pre-fix, the keto and carb-floored branches clamped the
  // MIDPOINT to essential fat and then published fatLo = round(mid x 0.9),
  // i.e. 0.27 g/lb LBM. These four inputs reach that path.
  const reachers = [
    ["carb-floored, lean and heavy", { sex: "M", bodyFatPct: 8, dietaryStyle: null }, 120, 1500],
    ["carb-floored, lean and heavy (2)", { sex: "M", bodyFatPct: 10, dietaryStyle: null }, 110, 1600],
    ["keto, floor binding", { sex: "M", bodyFatPct: 8, dietaryStyle: "keto" }, 120, 1500],
    ["keto, floor binding (F)", { sex: "F", bodyFatPct: 14, dietaryStyle: "keto" }, 85, 1300],
  ];
  for (const [label, profile, weightKg, kcal] of reachers) {
    const m = computeMacros(profile, weightKg, kcal);
    assert.ok(
      m.fatLo >= m.fatFloorG,
      `${label}: published fatLo ${m.fatLo} g is below the engine's own floor ${m.fatFloorG} g (${(m.fatLo / m.lbmLb).toFixed(4)} g/lb LBM vs ${ESSENTIAL_FAT_PER_LB_LBM})`,
    );
  }

  // And nowhere else across the whole grid, both diet paths.
  const offenders = [];
  for (const style of [null, "keto"]) {
    for (const b of BODIES) {
      for (const kcal of TARGETS) {
        const m = computeMacros({ ...b.profile, dietaryStyle: style }, b.weightKg, kcal);
        if (m.fatLo < m.fatFloorG) offenders.push(`${style || "none"} ${b.sex} ${b.weightKg}kg ${b.bodyFatPct}%BF @${kcal}: ${m.fatLo} < ${m.fatFloorG}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `band edges under the floor: ${offenders.slice(0, 8).join(" | ")}`);
});

test("5.6 a floor block is FLAGGED, never absorbed in silence", () => {
  // Constitution: floor blocks are shown, not hidden. Whenever the floor moved
  // the band — either because the model asked for less fat than is essential,
  // or because only the lower edge would have dipped under — the target has to
  // say so, or the UI cannot.
  //
  // Note the flag is "the floor MOVED something", not "the band happens to
  // touch the floor": a band can land on the floor by arithmetic coincidence
  // (M 68 kg / 14% BF @ 1,500 kcal computes a lower edge of exactly 39 g
  // against a 39 g floor), and reporting a block there would be crying wolf.
  let flagged = 0;
  for (const style of [null, "keto"]) {
    for (const b of BODIES) {
      for (const kcal of TARGETS) {
        const m = computeMacros({ ...b.profile, dietaryStyle: style }, b.weightKg, kcal);
        assert.equal(typeof m.fatFloored, "boolean", "the flag must exist on every target, true or false");
        // The flag never lies about what it means: if it is up, the published
        // band really is sitting on the floor.
        if (m.fatFloored) {
          assert.equal(
            m.fatLo, m.fatFloorG,
            `${style || "none"} ${b.sex} ${b.weightKg}kg @${kcal}: flagged as floored but fatLo ${m.fatLo} != floor ${m.fatFloorG}`,
          );
          flagged++;
        }
      }
    }
  }
  assert.ok(flagged > 0, "the grid must actually reach the floor somewhere, or this test proves nothing");

  // And the obligation that makes the flag load-bearing: a non-keto target may
  // only depart from the published energy share when it SAYS a floor moved it.
  // Silent departure is exactly defect 5.5.
  const silent = [];
  for (const b of BODIES) {
    for (const kcal of TARGETS) {
      const m = computeMacros(b.profile, b.weightKg, kcal);
      if (m.fatFloored || m.carbFloored) continue;
      if (pp(Math.abs(fatPctE(m, kcal) - FAT_PCT_ENERGY_MID)) > 0.6) {
        silent.push(`${b.sex} ${b.weightKg}kg ${b.bodyFatPct}%BF @${kcal} = ${pp(fatPctE(m, kcal))} %E, unflagged`);
      }
    }
  }
  assert.deepEqual(silent, [], `unflagged departures from the energy share: ${silent.slice(0, 8).join(" | ")}`);
});

test("5.6 fatPctEnergy reveals the share the published band actually carries", () => {
  // "Displayed numbers can reveal their formula and inputs." The share is
  // derived from the band that shipped, not recomputed from the model, so a
  // floor-lifted band reports the higher share it really represents.
  for (const style of [null, "keto"]) {
    for (const kcal of [1400, 1900, 2600]) {
      const m = computeMacros({ sex: "M", bodyFatPct: 15, dietaryStyle: style }, 95, kcal);
      assert.equal(
        m.fatPctEnergy, Math.round((fatMidOf(m) * 9 / kcal) * 10000) / 10000,
        `${style || "none"} @${kcal}: published share must match the published band`,
      );
    }
  }
});

// ── guards: what this change must NOT have moved ──────────────────────────

test("guard: protein, carb non-negativity and the keto flag are untouched", () => {
  for (const b of BODIES) {
    for (const kcal of TARGETS) {
      const m = computeMacros(b.profile, b.weightKg, kcal);
      const lbm = kg2lb(b.weightKg) * (1 - b.bodyFatPct / 100);
      assert.equal(m.proteinLo, Math.round(lbm * 1.14), "protein stays per-lb-LBM");
      assert.equal(m.proteinHi, Math.round(lbm * 1.25));
      assert.ok(m.carbMid >= 0 && m.carbLo >= 0 && m.carbHi >= 0, `carbs must never render negative (${m.carbLo}-${m.carbHi})`);
      assert.ok(m.fatLo <= m.fatHi, "the band must not invert");
      assert.equal(m.keto, undefined, "a non-keto profile must not acquire the keto flag");
    }
  }
});

test("guard: the band keeps the half-width the downstream tolerance was calibrated against", () => {
  // mealSolver.js:204 documents its +/-25%-of-midpoint allowance as calibrated
  // against "about +/-8% around the midpoint". Moving the anchor must not have
  // quietly re-tuned that. Only floor-clamped bands are narrower, by design.
  const m = computeMacros({ sex: "M", bodyFatPct: 20, dietaryStyle: null }, 90.7, 2600);
  assert.equal(m.fatFloored, false, "pick an unfloored case so the band is the model's own");
  const mid = fatMidOf(m);
  assert.ok(Math.abs((mid - m.fatLo) / mid - FAT_BAND_HALF_WIDTH) < 0.01, `lower half-width ${(mid - m.fatLo) / mid}`);
  assert.ok(Math.abs((m.fatHi - mid) / mid - FAT_BAND_HALF_WIDTH) < 0.01, `upper half-width ${(m.fatHi - mid) / mid}`);
  assert.ok(Math.abs(FAT_BAND_HALF_WIDTH - 0.081) < 0.001, "and that width is still the old 0.34-0.40 g/lb shape");
});

test("guard: macros still reconstruct to the target less the declared carb buffer", () => {
  for (const kcal of [1600, 2000, 2500, 3000]) {
    const m = computeMacros({ sex: "M", bodyFatPct: 18, dietaryStyle: null }, 82, kcal);
    const rec = ((m.proteinLo + m.proteinHi) / 2) * 4 + fatMidOf(m) * 9 + m.carbMid * 4;
    assert.equal(Math.round(kcal - rec), m.macroKcalGap, "macroKcalGap must be the honest residual, not a stored guess");
    // The gap is the deliberate carb buffer (25 g = 100 kcal), never a silent miss.
    assert.ok(Math.abs(m.macroKcalGap - m.carbBufferG * 4) < 12, `@${kcal}: gap ${m.macroKcalGap} vs declared buffer ${m.carbBufferG * 4} kcal`);
  }
});

// ── the half of 5.6 this file cannot close ────────────────────────────────

test("HANDOFF: the engine now supplies the absolute floor mealSolver needs", () => {
  // What remains: mealSolver.dayTolerance judges fat with bandMiss(), whose
  // downward allowance is 25% of the band midpoint BELOW fatLo. That accepts
  // fat under the floor for any band, which is why 232 of 250 personas graded
  // compliant at 0.2475 g/lb LBM. Re-measured after this change the compliant
  // minimum moves to a median of 0.2741 g/lb LBM, but 169 of 250 are still
  // under 0.30 — and the deepest cases got WORSE (min 0.2276 -> 0.2159),
  // because an energy-anchored prescription lands ON the floor more often and
  // the solver's slack is then taken off the floor itself. Clamping that
  // allowance to `dailyTarget.fatFloorG` takes it to 0 of 250 below the floor.
  //
  // This test asserts only what THIS file owes that fix: an absolute, numeric,
  // per-target floor, present on every branch. It does not assert the solver's
  // behaviour, which another owner has to change.
  for (const style of [null, "keto"]) {
    const m = computeMacros({ sex: "M", bodyFatPct: 12, dietaryStyle: style }, 95, 1700);
    assert.ok(Number.isFinite(m.fatFloorG) && m.fatFloorG > 0, "fatFloorG must be a usable absolute number");
    assert.ok(m.fatFloorG <= m.fatLo, "and it must be a floor the published band already respects");
    // The residual, stated as arithmetic so nobody has to trust the prose:
    // this is what the solver would certify today, and it is under the floor.
    const solverMin = m.fatLo - 0.25 * fatMidOf(m);
    assert.ok(
      solverMin < m.fatFloorG,
      "if this ever stops holding, mealSolver has been fixed and this comment is stale",
    );
  }
});
