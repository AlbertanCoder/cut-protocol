/**
 * stats.mjs — Phase 5. Wilson intervals, defect clusters, regeneration variance,
 * latency percentiles, spend to the cent, convergence.
 *
 * Emits stats.json + defects.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, readLines, writeJson } from './lib.mjs';

// ── VERIFIED FALSE POSITIVES IN THE FLEET'S OWN MATCHER ─────────────────────
// Suppressed here rather than by re-running, so the raw record in results.jsonl
// stays intact and the correction is auditable. Each entry was checked by hand
// against the recipe's full ingredient list before being dismissed.
const FP_SUPPRESS = [
  {
    wall: 'shellfish', term: 'paella',
    why: 'fired on the ingredient row "Paella Rice", a short-grain rice variety, inside "Roast fennel and aubergine paella" — verified 15 ingredients, zero shellfish. A dish-style word is not an allergen on an ingredient surface.',
  },
];
const isFalsePositive = (l) => FP_SUPPRESS.some((f) => f.term === l.term && (f.wall === l.wall || f.wall === (l.diet ? l.wall : null)));

const results = readLines('results.jsonl');
const personas = new Map(readLines('personas.jsonl').map((p) => [p.id, p]));
const brainAnalysis = fs.existsSync(path.join(HOME, 'brain-analysis.json')) ? JSON.parse(fs.readFileSync(path.join(HOME, 'brain-analysis.json'), 'utf8')) : null;

const cards = [];
for (const f of fs.readdirSync(path.join(HOME, 'cards'))) {
  if (!/^card-p\d+\.json$/.test(f)) continue;
  try { cards.push(JSON.parse(fs.readFileSync(path.join(HOME, 'cards', f), 'utf8'))); }
  catch { cards.push({ personaId: f.replace(/card-|\.json/g, ''), malformed: true }); }
}

// ── Wilson score interval, 95% ──────────────────────────────────────────────
function wilson(k, n, z = 1.959964) {
  if (!n) return { n: 0, k: 0, p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { n, k, p: r3(p), lo: r3(Math.max(0, (centre - half) / d)), hi: r3(Math.min(1, (centre + half) / d)) };
}
const r3 = (x) => Math.round(x * 1000) / 1000;
const pct = (x) => (x == null ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const pctile = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const withPlan = results.filter((r) => r.primary?.mine);

// ── leaks, after false-positive suppression ─────────────────────────────────
const leakRecords = [];
for (const r of withPlan) {
  for (const l of r.primary.mine.leaks) {
    if (isFalsePositive(l)) { leakRecords.push({ ...l, persona: r.id, tier: r.tier, suppressed: true }); continue; }
    leakRecords.push({ ...l, persona: r.id, tier: r.tier, suppressed: false });
  }
}
const realLeaks = leakRecords.filter((l) => !l.suppressed);
const leakPersonas = new Set(realLeaks.map((l) => l.persona));

// A leak's clinical weight decides FIX ORDER, so it is recorded, never used to
// soften the count. Anaphylaxis-capable walls first; observances and aversions
// are still broken promises.
const CLINICAL = new Set(['gluten', 'peanut', 'tree nut', 'shellfish', 'fish', 'dairy', 'egg', 'soy', 'sesame']);
const leakByWall = {};
for (const l of realLeaks) {
  const k = l.wall || l.kind;
  leakByWall[k] = leakByWall[k] || { wall: k, clinical: CLINICAL.has(k), hits: 0, personas: new Set(), examples: new Set() };
  leakByWall[k].hits++;
  leakByWall[k].personas.add(l.persona);
  leakByWall[k].examples.add(`"${l.name}" (via "${l.term}") in "${l.recipe}"`);
}

// ── IMPOSSIBLE-tier reclassification (computed early — the defect clusters
//    below need it, and a cluster is only a defect if it survived verification)
//
// MY FORGE MISLABELLED SOME OF THESE, AND THE FIX BELONGS IN CODE, NOT IN PROSE.
//
// The `floor-vs-rate` construction assumed a floor-clamped target at the most
// aggressive rate is unsatisfiable. For several bodies it simply is not: a clamped
// 2,321 kcal target with a 193-211 g protein band is an ordinary day, and the app
// hit it with real food — verified against the fleet's OWN recomputation from raw
// Food rows, not the app's claim. Grading those as "a confident fake plan
// answering a contradiction" would punish the app for succeeding at something I
// wrongly asserted was impossible.
//
// So an IMPOSSIBLE-tier persona whose day genuinely landed in tolerance on the
// fleet's own arithmetic is reclassified MISLABELLED-SATISFIABLE, removed from the
// honesty denominator, and counted as the app passing.
const impossAll = withPlan.filter((r) => r.tier === 'IMPOSSIBLE' && r.primary.impossible);
const mislabelled = impossAll.filter((r) => r.primary.mine.daysJudged > 0
  && r.primary.mine.daysInTolerance === r.primary.mine.daysJudged
  && r.primary.mine.slotsFilled > 0);
const mislabelledIds = new Set(mislabelled.map((r) => r.id));
const imposs = impossAll.filter((r) => !mislabelledIds.has(r.id));
const honestImposs = imposs.filter((r) => ['honest-diagnosis', 'honest-refusal'].includes(r.primary.impossible.verdict));
const fakeImposs = imposs.filter((r) => r.primary.impossible.verdict === 'CONFIDENT-FAKE-PLAN');

// ── day-level macro compliance ──────────────────────────────────────────────
let daysJudged = 0, daysInBand = 0, emptyDays = 0, silentMisses = 0, missesTotal = 0;
const driftDays = [];
for (const r of withPlan) {
  const m = r.primary.mine;
  daysJudged += m.daysJudged; daysInBand += m.daysInTolerance;
  emptyDays += m.emptyDays || 0;
  silentMisses += (m.silentMisses || []).length;
  missesTotal += m.daysJudged - m.daysInTolerance;
  for (const d of m.days) if (d.claimDriftKcal > 1) driftDays.push({ persona: r.id, day: d.dayOfWeek, drift: d.claimDriftKcal });
}

// ── slices ──────────────────────────────────────────────────────────────────
function sliceBy(keyFn) {
  const groups = new Map();
  for (const r of withPlan) {
    for (const key of [].concat(keyFn(r))) {
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, { dj: 0, db: 0, personas: 0, leakPersonas: 0, warned: 0, ms: [] });
      const g = groups.get(key);
      g.dj += r.primary.mine.daysJudged; g.db += r.primary.mine.daysInTolerance;
      g.personas++; g.ms.push(r.primary.ms);
      if (leakPersonas.has(r.id)) g.leakPersonas++;
      if (r.primary.mine.warnedSlots > 0) g.warned++;
    }
  }
  return Object.fromEntries([...groups.entries()].sort((a, b) => b[1].dj - a[1].dj).map(([k, g]) => [k, {
    personas: g.personas, daysInBand: wilson(g.db, g.dj),
    personasWithLeak: g.leakPersonas,
    personasWithWarnedSlot: g.warned,
    latencyP50: pctile(g.ms, 0.5), latencyP95: pctile(g.ms, 0.95),
  }]));
}

// ── defect clusters: endpoint + error class + constraint pattern ─────────────
// Built AFTER the two corrections below it in this file, because a cluster is
// only a defect if it survived verification: suppressed false-positive leaks and
// mislabelled-satisfiable "impossible" personas are dropped here, not explained
// away in the report.
const clusters = new Map();
for (const r of results) {
  for (const d of r.defects) {
    if (d.signature.startsWith('allergen-leak:')) {
      const wall = d.signature.split(':')[1];
      if (!realLeaks.some((l) => l.persona === r.id && (l.wall || l.kind) === wall)) continue; // suppressed FP
    }
    if (d.signature === 'impossible-confident-fake-plan' && mislabelledIds.has(r.id)) continue; // forge error
    // A REFUSAL THE APP IS SUPPOSED TO MAKE IS NOT A DEFECT.
    // The gain-direction gate (D2's fix) answers 400 to any profile whose goal weight
    // sits above the start weight, which is the whole point of it. fleet.mjs only
    // whitelists the two gates that existed when it was written (adult-only,
    // goal-weight-floor), so the new one arrived here miscounted as 38 defects.
    if (d.signature === 'profile-400-gain-not-supported') continue;
    const key = `${d.endpoint} | ${d.signature}`;
    if (!clusters.has(key)) clusters.set(key, { endpoint: d.endpoint, signature: d.signature, sev: d.sev, count: 0, personas: [], tiers: {}, constraintPatterns: {}, example: d.detail, repro: d.repro ?? null });
    const c = clusters.get(key);
    c.count++;
    if (c.personas.length < 40) c.personas.push(r.id);
    c.tiers[r.tier] = (c.tiers[r.tier] || 0) + 1;
    const pattern = `${r.dietaryStyle || 'no-style'}+${(r.walls || []).length}walls`;
    c.constraintPatterns[pattern] = (c.constraintPatterns[pattern] || 0) + 1;
    if (d.sev === 'P0' && c.sev !== 'P0') c.sev = 'P0';
  }
}
const SEV_RANK = { P0: 0, P1: 1, P2: 2 };
const defectClusters = [...clusters.values()].sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.count - a.count);

// ── regeneration variance (the 15 x 3 subsample) ─────────────────────────────
const subs = results.filter((r) => r.stability);
const regen = {
  personas: subs.length,
  generationsEach: subs[0]?.stability.generations ?? null,
  complianceStable: subs.filter((r) => r.stability.complianceStable).length,
  complianceUnstable: subs.filter((r) => !r.stability.complianceStable).map((r) => ({ id: r.id, tier: r.tier, daysInTolerance: r.stability.daysInTolerance, daysJudged: r.stability.daysJudged })),
  leakStability: subs.every((r) => new Set(r.stability.leakCounts).size <= 1),
  varietySwings: subs.map((r) => ({ id: r.id, distinct: r.stability.distinctRecipes, range: r.stability.varietyRange, maxRepeat: r.stability.maxRepeat })),
  worstComplianceSwing: Math.max(0, ...subs.map((r) => { const a = r.stability.daysInTolerance; return a.length ? Math.max(...a) - Math.min(...a) : 0; })),
  latency: subs.flatMap((r) => r.stability.latencyMs),
};

// ── convergence: first half vs second half of the fleet ─────────────────────
const half = Math.floor(withPlan.length / 2);
const firstHalf = withPlan.slice(0, half), secondHalf = withPlan.slice(half);
const halfRate = (set) => { let j = 0, b = 0; for (const r of set) { j += r.primary.mine.daysJudged; b += r.primary.mine.daysInTolerance; } return wilson(b, j); };


// ── affordability + robustness ──────────────────────────────────────────────
const afford = results.filter((r) => r.affordability);
const cov = results.filter((r) => r.costCoverage);
const robust = results.filter((r) => r.steps?.rejection);

// ── satisfaction from the deep-dive cards ───────────────────────────────────
const good = cards.filter((c) => !c.malformed && typeof c.satisfaction === 'number');
const sats = good.map((c) => c.satisfaction).sort((a, b) => a - b);
const critMean = (k) => good.length ? r3(good.reduce((s, c) => s + ((c.criteria && c.criteria[k]) || 0), 0) / good.length) : null;

const stats = {
  runId: path.basename(HOME), head: '0d3eaa5', generatedAt: new Date().toISOString(),
  fleet: {
    personasPlanned: 250, personasRun: results.length,
    reachedAPlan: withPlan.length,
    outcomes: results.reduce((m, r) => { m[r.outcome] = (m[r.outcome] || 0) + 1; return m; }, {}),
    httpFailures: results.filter((r) => r.primary && r.primary.status !== 200).length,
    spinnerForever: results.filter((r) => r.primary?.spinnerForever).length,
  },
  safety: {
    rawHits: leakRecords.length,
    falsePositivesSuppressed: leakRecords.filter((l) => l.suppressed).length,
    suppressionRationale: FP_SUPPRESS,
    confirmedLeakHits: realLeaks.length,
    personasAffected: leakPersonas.size,
    personasAffectedRate: wilson(leakPersonas.size, withPlan.length),
    cleanPersonaRate: wilson(withPlan.length - leakPersonas.size, withPlan.length),
    byWall: Object.values(leakByWall).map((v) => ({ wall: v.wall, clinical: v.clinical, hits: v.hits, personas: v.personas.size, examples: [...v.examples].slice(0, 6) })),
    clinicalWallLeaks: Object.values(leakByWall).filter((v) => v.clinical).reduce((s, v) => s + v.hits, 0),
    nameFlagsAdvisory: withPlan.reduce((s, r) => s + r.primary.mine.nameFlagCount, 0),
  },
  macros: {
    daysJudged, daysInBand, emptyDays,
    daysInBandRate: wilson(daysInBand, daysJudged),
    missesTotal, silentMisses,
    honestyOnMissRate: wilson(missesTotal - silentMisses, missesTotal),
    storedVsRecomputedDrift: { daysWithDrift: driftDays.length, worst: driftDays.length ? Math.max(...driftDays.map((d) => d.drift)) : 0 },
  },
  impossibleTier: {
    tierSize: impossAll.length,
    mislabelledSatisfiable: mislabelled.length,
    mislabelledIds: [...mislabelledIds],
    mislabelledNote: 'forge error, not an app defect: these floor-vs-rate requests WERE satisfiable and the app satisfied them — every day landed in tolerance on the fleet\'s own recomputation from raw Food rows. Removed from the honesty denominator and counted as the app passing.',
    graded: imposs.length,
    honest: honestImposs.length,
    honestRate: wilson(honestImposs.length, imposs.length),
    confidentFakePlans: fakeImposs.length,
    verdicts: imposs.reduce((m, r) => { m[r.primary.impossible.verdict] = (m[r.primary.impossible.verdict] || 0) + 1; return m; }, {}),
    medianMs: pctile(imposs.map((r) => r.primary.ms), 0.5),
    refusedOutright: imposs.filter((r) => r.primary.impossible.refusedOutright).length,
  },
  latency: {
    p50: pctile(withPlan.map((r) => r.primary.ms), 0.5),
    p95: pctile(withPlan.map((r) => r.primary.ms), 0.95),
    max: Math.max(...withPlan.map((r) => r.primary.ms)),
    byHorizon: { day: pctile(withPlan.filter((r) => r.horizon === 'day').map((r) => r.primary.ms), 0.95), week: pctile(withPlan.filter((r) => r.horizon === 'week').map((r) => r.primary.ms), 0.95) },
    solveMsP95: pctile(withPlan.map((r) => r.primary.claims?.solveMs).filter((x) => x != null), 0.95),
  },
  slices: {
    byTier: sliceBy((r) => r.tier),
    byWall: sliceBy((r) => (r.walls.length ? r.walls : 'no-walls')),
    byDiet: sliceBy((r) => r.dietaryStyle || 'none/null'),
    byGoal: sliceBy((r) => r.goalKind),
    byHorizon: sliceBy((r) => r.horizon),
    byWallCount: sliceBy((r) => `${r.walls.length} walls`),
  },
  regeneration: {
    ...regen, latencyP50: pctile(regen.latency, 0.5), latencyP95: pctile(regen.latency, 0.95), latency: undefined,
  },
  convergence: {
    firstHalf: halfRate(firstHalf), secondHalf: halfRate(secondHalf),
    stable: (() => { const a = halfRate(firstHalf), b = halfRate(secondHalf); return a.lo != null && b.lo != null && a.lo <= b.hi && b.lo <= a.hi; })(),
  },
  robustness: {
    illegalValueProbes: robust.length,
    namedTheField: robust.filter((r) => r.steps.rejection.namedTheField).length,
    honestRejections: robust.filter((r) => r.steps.rejection.honest).length,
    statuses: robust.reduce((m, r) => { m[r.steps.rejection.status] = (m[r.steps.rejection.status] || 0) + 1; return m; }, {}),
    sampleMessage: robust[0]?.steps.rejection.message ?? null,
    ackGatesHit: results.filter((r) => r.steps?.ackGate).length,
  },
  affordability: {
    groceryListProbes: afford.length,
    ok: afford.filter((a) => a.affordability?.status === 200 || a.affordability?.status === 201).length,
    statuses: afford.reduce((m, r) => { m[r.affordability.status] = (m[r.affordability.status] || 0) + 1; return m; }, {}),
    // Recomputed from the recorded response KEYS, not from fleet.mjs's
    // `hasEstimatedTotal` flag: that flag probed for `estimatedTotalCad`/
    // `estTotal`/`totalCad` and the endpoint actually returns
    // `totalEstimatedCostCad`, so it read 0/15 and would have reported a missing
    // cost surface as a product gap. The surface exists; my probe was wrong.
    withEstimatedTotal: afford.filter((r) => (r.affordability.keys || []).includes('totalEstimatedCostCad')).length,
    costSurfaceKeys: ['totalEstimatedCostCad', 'costCoverageNote', 'bySection'],
    responseKeys: [...new Set(afford.flatMap((r) => r.affordability.keys || []))],
    recipeMetadataCoverage: cov.length ? {
      shippedRecipes: cov.reduce((s, r) => s + r.costCoverage.shippedRecipes, 0),
      withCost: cov.reduce((s, r) => s + r.costCoverage.withCost, 0),
      withPrepTime: cov.reduce((s, r) => s + r.costCoverage.withPrepTime, 0),
      withTasteTier: cov.reduce((s, r) => s + r.costCoverage.withTasteTier, 0),
      withDifficulty: cov.reduce((s, r) => s + r.costCoverage.withDifficulty, 0),
    } : null,
  },
  productGaps: (() => {
    const m = {};
    for (const r of results) for (const g of r.gaps || []) { const k = g.split(';')[0]; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([gap, personas]) => ({ gap, personas }));
  })(),
  satisfaction: {
    cardsExpected: 25, cardsReceived: cards.length, malformed: cards.filter((c) => c.malformed).length,
    median: sats.length ? sats[Math.floor(sats.length / 2)] : null,
    mean: sats.length ? r3(sats.reduce((a, b) => a + b, 0) / sats.length) : null,
    min: sats[0] ?? null, max: sats[sats.length - 1] ?? null,
    distribution: sats.reduce((m, s) => { m[s] = (m[s] || 0) + 1; return m; }, {}),
    wouldRecommend: wilson(good.filter((c) => c.wouldRecommend === true).length, good.length),
    criteriaMeans: {
      macrosInRange: critMean('macrosInRange'), worksEndToEnd: critMean('worksEndToEnd'),
      mealsAreGood: critMean('mealsAreGood'), affordableAdjustable: critMean('affordableAdjustable'), tasty: critMean('tasty'),
    },
    allergenRespectFailures: good.filter((c) => c.allergenRespect && c.allergenRespect.ok === false).map((c) => ({ id: c.personaId, leaks: c.allergenRespect.leaks })),
    byStratum: null,
  },
  brain: brainAnalysis ? {
    cohortSize: brainAnalysis.cohortSize, ledger: brainAnalysis.ledger, headline: brainAnalysis.headline, artifacts: brainAnalysis.artifacts,
  } : null,
  money: {
    phase2SpendUsd: 0, phase2Verified: true,
    phase3SpendUsd: brainAnalysis?.ledger.phase3SpendUsd ?? null,
    capUsd: 5.00, withinCap: brainAnalysis?.ledger.withinCap ?? null,
    ledgerRowsBefore: 13, ledgerRowsAfter: brainAnalysis?.ledger.nowRows ?? 13,
  },
};

writeJson('stats.json', stats);
writeJson('defects.json', { runId: stats.runId, head: '0d3eaa5', clusters: defectClusters, leaks: realLeaks, suppressedFalsePositives: leakRecords.filter((l) => l.suppressed) });

// ── console summary ─────────────────────────────────────────────────────────
console.log('== PHASE 5 STATS ==');
console.log(`personas      : ${stats.fleet.personasRun}/250 run, ${stats.fleet.reachedAPlan} reached a plan, ${stats.fleet.httpFailures} non-200, ${stats.fleet.spinnerForever} spinner-forever`);
console.log(`SAFETY        : ${stats.safety.confirmedLeakHits} confirmed leak hit(s) across ${stats.safety.personasAffected} persona(s)  [${stats.safety.falsePositivesSuppressed} FP suppressed]`);
console.log(`                clean-persona rate ${pct(stats.safety.cleanPersonaRate.p)} (95% CI ${pct(stats.safety.cleanPersonaRate.lo)}–${pct(stats.safety.cleanPersonaRate.hi)})`);
for (const w of stats.safety.byWall) console.log(`                · ${w.wall}${w.clinical ? ' [CLINICAL]' : ''}: ${w.hits} hit(s), ${w.personas} persona(s)`);
console.log(`MACROS        : ${daysInBand}/${daysJudged} days in band = ${pct(stats.macros.daysInBandRate.p)} (95% CI ${pct(stats.macros.daysInBandRate.lo)}–${pct(stats.macros.daysInBandRate.hi)})`);
console.log(`                ${emptyDays} day(s) with ZERO food · honesty-on-miss ${pct(stats.macros.honestyOnMissRate.p)} (${missesTotal - silentMisses}/${missesTotal})`);
console.log(`                stored-vs-recomputed drift: ${stats.macros.storedVsRecomputedDrift.daysWithDrift} day(s)`);
console.log(`IMPOSSIBLE    : tier ${impossAll.length}, ${mislabelled.length} mislabelled-satisfiable (app passed) -> ${honestImposs.length}/${imposs.length} honest = ${pct(stats.impossibleTier.honestRate.p)} · ${fakeImposs.length} confident fake plan(s) · median ${stats.impossibleTier.medianMs}ms`);
console.log(`LATENCY       : p50 ${stats.latency.p50}ms · p95 ${stats.latency.p95}ms · max ${stats.latency.max}ms`);
console.log(`REGEN (15x3)  : ${regen.complianceStable}/${regen.personas} stable · worst swing ${regen.worstComplianceSwing} day(s) · leak-stable ${regen.leakStability}`);
console.log(`CONVERGENCE   : 1st half ${pct(stats.convergence.firstHalf.p)} vs 2nd half ${pct(stats.convergence.secondHalf.p)} — ${stats.convergence.stable ? 'CIs overlap, stable' : 'CIs disjoint, NOT converged'}`);
console.log(`ROBUSTNESS    : ${stats.robustness.namedTheField}/${stats.robustness.illegalValueProbes} illegal values answered with a named field error · ack gates hit ${stats.robustness.ackGatesHit}`);
console.log(`MONEY         : phase2 $0.00 verified · phase3 $${(stats.money.phase3SpendUsd ?? 0).toFixed(6)} of $5.00`);
console.log(`CARDS         : ${stats.satisfaction.cardsReceived}/25 received, ${stats.satisfaction.malformed} malformed, median ${stats.satisfaction.median}/10`);
console.log(`\ndefect clusters: ${defectClusters.length}`);
for (const c of defectClusters.slice(0, 12)) console.log(`  [${c.sev}] ${c.count.toString().padStart(3)} × ${c.endpoint} | ${c.signature}`);
