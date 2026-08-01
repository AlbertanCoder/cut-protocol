// W1-4 — assemble fleet/out/W1-4/honesty.json from the measured artifacts.
import fs from "node:fs";
const rd = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const A = rd("fleet/out/W1-4/analysis.json");
const R = rd("fleet/out/W1-4/repro.json");
const K = rd("fleet/out/W1-4/kpi.json");
const D6 = rd("fleet/out/W1-4/d6.json");
const E6 = rd("fleet/out/W1-4/e6.json");
const p = A.seeds["424242"];

const honesty = {
  agent: "W1-4",
  mission: "honesty-detection — adjudicate the prompt-vs-brief contradiction on diagnosis, then measure where honesty actually breaks",
  provenance: {
    ...R.provenance,
    canonicalDump: "fleet/out/W1-2/daydump-route-s424242.jsonl (+ s20260730, s8675309)",
    schema: "fleet/W1-1/day/v2",
    ruler: "product/dayTolerance+dayInTolerance (mealSolver.js:229,:256)",
    brain: "off",
    networkCallsAttempted: R.networkCallsAttempted,
    productSourceModified: false,
  },

  // ══════════════════════════════════════════════════════════════════════════
  ADJUDICATION: {
    question: "Does `diagnoseFromResult` return feasible:false unconditionally, mislabelling perfect weeks (prompt), or does the constitution hold on /generate (brief)?",
    verdict: "BRIEF WINS. Both statements are literally true of DIFFERENT things and the prompt draws the wrong conclusion from its true premise.",
    theFunctionIsUnconditional: {
      confirmed: true,
      location: "backend/src/lib/mealSolver.js:443",
      code: "return { feasible: false, reasons, suggestions };",
      detail: "diagnoseFromResult has exactly ONE return statement and it hardcodes feasible:false. There is no path through it that returns feasible:true. The prompt's structural claim is CORRECT (its line number 405 is stale; the symbol is at :379-444).",
    },
    butEveryCallSiteIsGated: {
      confirmed: true,
      sites: [
        { where: "mealSolver.js:562-567 (generateDayCandidates)", gate: "needDiagnosis (:548-559) — candidates empty, matchPct<60, all candidates warned, candidates[0].inTolerance===false, or a protein-floor miss", elseValue: "diagnosis: null" },
        { where: "mealSolver.js:754-756 (generateBestWeekPlan)", gate: "anyDayMissed || anyUnfilledSlot || floorMissed || noDaysAtAll", elseValue: "best.diagnosis = null" },
        { where: "mealSolver.js:1296-1322 (generateHorizonPlan)", gate: "anyMissed || unfilledSlots>0 || varietyBreached", elseValue: "diagnosis = null" },
      ],
      consequence: "A converged run never reaches :443. `feasible:false` is therefore not a FEASIBILITY claim the app makes about clean weeks — it is a constant on an object that only exists when something genuinely missed.",
    },
    measuredOnThisTree: {
      denominator: "250 /generate runs, seed 424242 (route shape, canonical personas)",
      perfectRunsMislabeled: 0,
      perfectRunsCorrectlySilent: p.runLevel.matrix.convergedSilent,
      falseSurrenderRatePct: 0.0,
      promptClaimedFalseSurrenderPct: 95.8,
      promptClaimed_41of41PerfectWeeksMislabeled: "REFUTED — 171 of 171 converged runs carry diagnosis: null",
      crossSeed: { s424242: 0, s20260730: 0, s8675309: 0 },
    },
    residualDefect: {
      severity: "cosmetic-to-moderate, NOT the 95.8% claim",
      what: "`feasible:false` is a SEVERITY-FREE constant. A week that landed 6 of 7 days and a week whose pool is empty carry the identical machine flag, and frontend/src/components/PlanTab.jsx:388 (`diag.feasible === false` -> `infeasible`) renders both in warn colour with a '->' prefix. diagnose() at :369 computes a real `feasible: reasons.length === 0`; diagnoseFromResult DISCARDS its preSolve's verdict and overwrites it.",
      recommendation: "Do NOT re-fix the gating (the brief is right). Replace the constant with a graded severity so the UI can distinguish 'one day rough' from 'this ask is impossible'.",
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  twoByTwo: {
    runLevel: {
      note: "THE headline 2x2. A 'run' = one /generate call = one persona. oracle-feasible := every planned day in band AND zero empty slots. declared := the run carries a diagnosis (always feasible:false when present).",
      denominator: 250,
      matrix: p.runLevel.matrix,
      precisionPct: p.runLevel.precision,
      recallPct: p.runLevel.recall,
      falseSurrenderRatePct_ofDeclared: p.runLevel.falseSurrenderRate,
      falseSurrenderRatePct_ofConverged: p.runLevel.falseSurrenderRate_ofConverged,
      specificityPct: p.runLevel.specificity,
      certifiedFalseSurrenders: 0,
      certifiedFalseSurrenderDetail: "runs that converged (all days in band, no empty slots) AND were told they had not: ZERO, at all three seeds.",
      silentMissRuns: p.runLevel.silentMissRuns,
      crossSeed: Object.fromEntries(Object.entries(A.seeds).map(([s, v]) => [s, v.runLevel.matrix])),
    },
    dayLevel: {
      note: "Day-level 'declared' inherits the RUN's diagnosis (hasDiagnosis is a run flag replicated onto every day). An in-band day inside a week where a DIFFERENT day missed therefore reads as 'declared' — that is correct behaviour, not a mislabel.",
      denominator: 640,
      matrix: p.dayLevel.matrix,
      inBandSplit: K.inBandSplit,
      silentMissDays: p.dayLevel.silentMissDays,
      silentMissCount: 1,
      silentMissIdentity: "p233 — the 0-slot config (mealsPerDay:0, snacksPerDay:0). A plan containing no food, diagnosis:null, no warning. Reproduces W1-1's A6+ exactly; it is the ONLY declared===false record in the corpus.",
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  tierDetection: {
    warning: "W1-2 established 'IMPOSSIBLE' is a persona-generator LABEL, not a proof. Scored against BOTH denominators, as required.",
    ...p.tiers,
    reading: {
      against32Label: "24 of 32 declared = 75.0% detection. The 8 undeclared are runs that CONVERGED — 8 of the 32 'impossible' personas produced a fully compliant plan, so silence is CORRECT and the 75% is not a miss rate.",
      against18Provable: "18 of 18 declared = 100.0% detection, 0 false surrenders, 0 silent misses. Every provably-infeasible persona is correctly refused, and none of them produced a single in-band day (0 of 54).",
      theGapIsTheLabel: "Scoring against the 32-label alone would report 75% and read as a detector failure. It is a POPULATION failure: the 14 non-provable personas pass 62.5% of their days. Detection on the provable set is perfect.",
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  vectors: {
    E5: { ...R.vectors.E5, verdict: "REPRODUCED, ADJUSTED", finding: "NaN and undefined kcalTarget both ship a 0.5x half portion with warning:null — fully silent. Infinity ships the same half portion but emits a MALFORMED warning with an empty parenthesis ('closest was \"X\" ().') because NaN>0.15 is false for both miss tests, so the misses[] array is empty. The brief said Infinity yields warning:null; on this tree it yields a degenerate string. Either way an INFINITE ask produces the SMALLEST plate." },
    E6: { ...E6, verdict: "REPRODUCED, WORSE THAN THE BRIEF", finding: "Cliff edge is exact: at a 99% lock (budgetKcal=20) the open slots ship 1,813 kcal with 20 warnings; at a 100% lock (budgetKcal=0) they ship 2,623 kcal with ZERO warnings. 100% / 130% / 200% locks produce BYTE-IDENTICAL open solves (same 20 recipe ids, same 2,623 kcal, same 90.5 g fat). Day total 4,623 kcal on a 2,000 kcal target, silent. Brief measured 2,953 kcal / 123 g fat; this tree is worse." },
    E7: { ...R.vectors.E7, dumpMeasurements: p.e7, verdict: "REPRODUCED", finding: "The shipped slot object's keys are [recipeId, warning, proteinScale, sidesScale, ingredients, kcal, protein, fat, carb] — ZERO match /pin|bound|clamp|limit|floor|ceil/. On the real dump: 796 lo-pinned slots and 524 hi-pinned of 3,011. Days carrying a lo-pinned slot are in band 63.3% vs 86.4% for unpinned days — a 23.1-point compliance gap. The kcal warning fires when the pin causes a big enough miss, but nothing ever states the CAUSE ('this dish cannot go smaller'), so the user is told the number and never the wall." },
    D6: { ...D6, verdict: "REPRODUCED END-TO-END — UNSOUND, PROVEN BY COUNTEREXAMPLE" },
    E9: { ...R.vectors.E9, verdict: "REPRODUCED (mechanism), MAGNITUDE ADJUSTED DOWN", finding: "matchPct is the ONLY sort key at mealSolver.js:503-505; the 4-macro `inTolerance` verdict is computed at :482-490, attached to every candidate, and never consulted for ranking. Measured: 2 of 194 runs that HAD an in-tolerance option offered an out-of-tolerance day first (1.03%). Both inversions were 1 match-point (85 vs 84; 83 vs 82), not the brief's 95-vs-77. In BOTH cases the first in-tolerance candidate sat at rank 3 of 3 — the default pick is the non-compliant one. W1-6 established /day-options also lacks the macro closer (11 args vs a 12-param declaration), so it is weaker on two independent axes." },
    E10: { ...R.vectors.E10, verdict: "REPRODUCED, MAGNITUDE ADJUSTED DOWN", finding: "alternatesForSlot (mealSolver.js:821-863) contains zero .sort() calls and returns alternates in draw order; mealSolver.js:1388 and routes/plans.js:260 both name options[0] `best`. Measured 504 of 1,126 draws (44.76%) where options[0] is not the top-scoring option, vs the brief's 67% of 200. Mean gap 4.26 match-points, max 44." },
  },

  // ══════════════════════════════════════════════════════════════════════════
  E2_persistence: {
    verdict: "CONFIRMED VERBATIM",
    schema: {
      file: "backend/prisma/schema.prisma",
      Plan: { lines: "493-505", fields: ["id", "userId", "user", "startDate", "createdAt", "slots", "groceryList"], dayVerdictColumn: null, diagnosisColumn: null },
      PlanSlot: { lines: "506-527", hasWarningColumn: true, dayVerdictColumn: null },
      consequence: "The four-macro verdict the solver computes for every day is never written to disk. GET /plans/current returns slots and their warnings; the day verdict and the diagnosis are not in the response because they are not in the model.",
    },
    genMeta: {
      file: "frontend/src/components/PlanTab.jsx",
      declaration: ":750 const [genMeta, setGenMeta] = useState(null)",
      writes: [":877 setGenMeta(null) — inside generate()", ":890 setGenMeta(resMeta) — inside generate()"],
      totalSetGenMetaCallsInFile: 2,
      renderedAt: [":1116-1118 HorizonSummary", ":1122-1124 SolverNarration"],
      consequence: "Ordinary React state with no persistence and no refetch. Unmount (tab switch), reload, or app restart sets it back to null and the entire miss narration disappears. The plan survives; the verdict on it does not.",
    },
  },

  E3_display: {
    verdict: "CONFIRMED on the canonical denominator; the 'fully silent' leg ADJUSTED DOWN",
    theStructuralBlindSpot: {
      mechanism: "The surviving slot warning is formed at weeklyPlanner.js:661-671 only when best.kcalOff > KCAL_TOLERANCE_PCT or best.proteinShort > PROTEIN_TOLERANCE_PCT — a 2-MACRO trigger. The day verdict (mealSolver.js:229-256) is 4-macro. A day that fails ONLY on fat and/or carb cannot produce a slot warning by construction.",
      brief: "66.6%",
      measured: K.e3ByDenominator,
      headline: "65.22% of out-of-band days on the CANONICAL 553 denominator have kcal AND protein both fine — the warning structurally cannot fire on them. Brief's 66.6% CONFIRMED.",
      denominatorHazard: "The same quantity is 45.85% on all-planned (640) and 73.77% on satisfiable-judged (537). A4 in action: quoting it without the denominator makes it look like a refutation or an inflation.",
    },
    fullySilent: {
      brief: "30.6% of bad days end fully silent",
      measured_noSlotWarning_canonical553: K.e3ByDenominator["satPlanned-degenerate (CANONICAL 553)"].noSlotWarning,
      measured_fullySilent_canonical553: K.e3ByDenominator["satPlanned-degenerate (CANONICAL 553)"].fullySilent,
      verdict: "ADJUSTED DOWN. 14.49% of out-of-band days carry no slot warning at all; 0% are fully silent once the run diagnosis is counted (1 day of 640 corpus-wide, p233). The brief's 30.6% does not reproduce on any of the six live denominators.",
      butTheCaveatIsLoadBearing: "That 0% depends ENTIRELY on the run diagnosis — which E2 proves is never persisted. After a reload, the slot warning is the only surviving signal, and it is absent on 14.49% of bad days and structurally impossible on 65.22%.",
    },
    todayTabRendersNoWarning: {
      verdict: "CONFIRMED",
      method: "Node byte-read (hazard K1: rg/Grep negatives are void). frontend/src/components/TodayTab.jsx is 55,843 bytes, contains NO NUL bytes, and matches /warning/i on ZERO lines.",
      contrast: "PlanTab.jsx renders slot.warning at :543, :660-662 and :1161.",
      consequence: "The persisted PlanSlot.warning column — the ONLY honesty signal that survives a restart — is rendered on exactly one screen, and it is not the screen the user opens every day.",
    },
    todayFatRailCannotTint: {
      verdict: "CONFIRMED — and it matters more than the brief says",
      code: [
        "TodayTab.jsx:137 <MacroRail label=\"Fat\" ... kind=\"floor\" />",
        "TodayTab.jsx:92  const ceil = kind === \"range\" && Number.isFinite(hi) ? hi : null;   // null for fat",
        "TodayTab.jsx:93  const over  = ceil != null && eaten > ceil;                          // always false for fat",
        "TodayTab.jsx:110 color: over ? C.warn : C.ink                                        // fat can never go amber",
      ],
      why_it_matters: "Fat is the DOMINANT failure macro on this tree — W1-2 measured fat failures 82 over / 0 short (perfectly one-sided); W1-6 measured fat OVER on 83 of 120 failing days. The solver grades fat two-sided (mealSolver.js:250 checks BOTH fat.shortPct and fat.overPct against 0.25). Today draws it one-sided. An over-fat day renders as a met floor — visually a success — on the one screen the user actually reads.",
      note: "TodayTab.jsx:76-87 shows this is a deliberate design decision ('fat is a floor'), which means it contradicts the engine's own ruler by intent, not by accident. Reconciling them is a product decision, not a bug fix.",
    },
  },

  E8_serverTrust: {
    verdict: "CONFIRMED VERBATIM",
    clientSuppliedWarning: {
      location: "backend/src/routes/plans.js:110",
      code: "warning: typeof incoming.warning === \"string\" ? incoming.warning : null,",
      inFunction: "rebuildSlotFromClient",
      consumers: ["POST /plans/accept-day (:503)", "POST /plans/.../apply"],
      contrast: "Every other field on that path is re-derived or re-validated server-side: recipeId is looked up in the pool, each ingredient's foodId must belong to the recipe, grams are bounds-checked against 0.5x-2x with a 6 g tolerance and 400 on violation, kcal/protein/fat/carb are RECOMPUTED from raw Food rows (:89-100), and both scales are clamped (:103). The warning is the ONLY field taken on trust.",
      consequence: "A client can accept a day and send warning:null for every slot. The server recomputes the macros faithfully and stores the lie. Under this repo's constitution ('Solver declares unsolvable + why — silent target misses are forbidden') that is a rule violation regardless of whether any shipping client does it.",
    },
    placeRecipeHardcodesNull: {
      location: "backend/src/routes/plans.js:625",
      code: "ingredients, ...totals, warning: null, locked: false,",
      contrast: "The sibling path at :669-678 does the right thing — it computes kcalOff and writes a real warning when kcalOff > 0.15, with the comment 'instead of storing warning:null — the constitution bans silent misses.' The two paths disagree with each other inside one file.",
    },
    staleVerdictAfterMutation: {
      verdict: "CONFIRMED",
      mechanism: "setGenMeta is called at exactly 2 sites, both inside generate() (PlanTab.jsx:877, :890). applyAlternate (:594-607) calls api.applySlotAlternate then reloadPlan() and never touches genMeta.",
      consequence: "After a swap the plan data refreshes and the SolverNarration card (:1122-1124) keeps rendering the PRE-SWAP week's day counts, match percentages and diagnosis. The verdict on screen describes a week that no longer exists.",
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  C10_E11_inflationTrap: {
    ...K.inflationTrap,
    c10: K.c10,
    recommendedKPISet: {
      principle: "No lever may score by refusing more days. Every KPI below is either invariant under refusal or moves the WRONG way when a lever refuses, so refusal can never be a winning strategy.",
      kpis: [
        { id: "K1", name: "COMPLIANCE — in-band days / ALL PLANNED DAYS", denominator: "planned (640) or satisfiable-planned-minus-degenerate (553, canonical)", current: "435/640 = 67.97% (all-planned) · 415/553 = 75.05% (canonical)", target: ">= 82% canonical", refusalProof: "YES — refusing a day leaves it in the denominator and removes it from the numerator, so refusal strictly LOWERS this. This is the anti-inflation anchor and must be the headline.", banned: "`judged` (623/537) may never be the headline: it is the +30.18 pt refusal lever." },
        { id: "K2", name: "SILENT-MISS COUNT — out-of-band days with neither a slot warning nor a diagnosis", denominator: "planned (640)", current: "1 (p233)", target: "0", refusalProof: "YES — a refused day is still a planned day and still owes an explanation; refusing without declaring makes this worse.", note: "Absolute count, never a rate. One silent miss is a constitution violation whatever the denominator." },
        { id: "K3", name: "PERSISTED-SIGNAL COVERAGE — out-of-band days whose explanation SURVIVES a reload", denominator: "out-of-band days on the canonical 553", current: "85.51% (14.49% carry no slot warning; the run diagnosis is not persisted at all)", target: "100%", refusalProof: "YES — refusing more days adds more days that must carry a persisted signal.", note: "THE KPI THIS LANE EXISTS TO ADD. It is the only one that fails today, and it fails because of E2, not because of diagnosis." },
        { id: "K4", name: "FALSE-SURRENDER COUNT — converged runs told they did not converge", denominator: "250 runs", current: "0", target: "0", refusalProof: "YES, and it is the DIRECT counterweight: a lever that refuses more days drives this up first.", note: "Pair with K2. K2 punishes under-declaring, K4 punishes over-declaring; a lever cannot game both." },
        { id: "K5", name: "WARNING FIDELITY — adjusted slots whose warning quotes a kcal the slot does not ship", denominator: "adjusted slots (250)", current: "15/250 = 6.0%, worst 701 kcal with the sign wrong (W1-6, E4)", target: "0%", refusalProof: "YES — refusal does not touch it; only recomputing warnings after mutation does.", note: "Inherited from W1-6. Hard prerequisite for any trimmer at weeklyPlanner.js:951." },
        { id: "K6", name: "REFUSAL SOUNDNESS — refused runs that were provably infeasible", denominator: "refused runs", current: "18 of 18 provable refused; 78 runs declared total, 0 of them converged", target: "100% of refusals justified by a miss or a proof", refusalProof: "YES — this is the gate that makes refusal expensive: every extra refusal must be justified or it lowers the ratio." },
      ],
      mandatoryCoReport: "Any A/B must publish K1 on ALL PLANNED DAYS first and again as the closing line, with `unjudged: baseline N -> treatment M` beside it (W1-1's rule). A rise in unjudged is a treatment refusing days, not solving them.",
      whyThisSetCloses_E11: "E11's +27.94 pt phantom is the same arithmetic as this tree's +30.18: it lives entirely in a denominator that drops refused days. K1 pins the denominator to PLANNED, so the phantom evaluates to exactly +0.00 (measured: 435/640 at 0 refusals and 435/640 at 188 refusals). K4 and K6 then make the 186 false refusals cost points rather than earn them.",
    },
  },
};

fs.writeFileSync("fleet/out/W1-4/honesty.json", JSON.stringify(honesty, null, 2));
console.log("wrote fleet/out/W1-4/honesty.json", fs.statSync("fleet/out/W1-4/honesty.json").size, "bytes");
console.log("\nRUN 2x2:", JSON.stringify(honesty.twoByTwo.runLevel.matrix));
console.log("precision", honesty.twoByTwo.runLevel.precisionPct, "recall", honesty.twoByTwo.runLevel.recallPct, "falseSurrender", honesty.twoByTwo.runLevel.falseSurrenderRatePct_ofDeclared);
