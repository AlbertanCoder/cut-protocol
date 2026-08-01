/**
 * brain-analyze.mjs — re-attribute Phase 3 spend correctly, and read the brain's
 * behaviour off the wall clock.
 *
 * WHY THIS EXISTS: brain-cohort.mjs attributed per-persona spend with a RAW SQL
 * comparison, `where createdAt > '<iso string>'`. Prisma stores SQLite DateTime
 * as an INTEGER of milliseconds, so that compares an integer column to a string
 * and matches nothing — every persona was recorded `brainRows=0` and the summary
 * printed `brainFiredCount: 0` while the global ledger had plainly moved by
 * $0.053274. The numbers were wrong in the SAFE direction, but wrong is wrong.
 *
 * Nothing needs re-running: every persona's t0/t1 window is already recorded in
 * brain-cohort.jsonl, so attribution is redone here against Date-typed rows.
 */
import { prisma, readLines, writeJson } from './lib.mjs';

const C0_COST = 0.392812; // Phase-3 baseline, recorded in PREFLIGHT.md
const C0_ROWS = 13;
const SLOT_TIMEOUT_MS = 35000;  // BRAIN_SLOT_TIMEOUT_MS default (plans.js:187)
const GEN_BUDGET_MS = 75000;    // BRAIN_GENERATE_BUDGET_MS default (plans.js:184)

const cohort = readLines('brain-cohort.jsonl');

const windowStart = new Date(Math.min(...cohort.map((c) => new Date(c.generate.t0).getTime())) - 1000);
const rows = await prisma.llmUsage.findMany({ where: { createdAt: { gte: windowStart } }, orderBy: { createdAt: 'asc' } });

const emailById = new Map();
for (const u of await prisma.user.findMany({ where: { email: { contains: 'qa-fleet-' } }, select: { id: true, email: true } })) emailById.set(u.id, u.email);

const attributed = cohort.map((c) => {
  const t0 = new Date(c.generate.t0).getTime();
  const t1 = new Date(c.generate.t1).getTime();
  const mine = rows.filter((r) => {
    const t = r.createdAt.getTime();
    return t >= t0 && t <= t1 + 2000;
  });
  const ms = c.generate.ms;
  // The signature: a design is only STARTED when the remaining budget covers a
  // whole one, so n abandoned designs cost n x slotTimeout of wall clock.
  const timeoutUnits = ms / SLOT_TIMEOUT_MS;
  const nearMultiple = Math.abs(timeoutUnits - Math.round(timeoutUnits)) < 0.06 && Math.round(timeoutUnits) >= 1;
  return {
    id: c.id, arm: c.arm, ms,
    rowCount: mine.length,
    costUsd: Number(mine.reduce((s, r) => s + (r.costUsd || 0), 0).toFixed(6)),
    phases: mine.map((r) => `${r.phase}/${r.intent}`),
    models: [...new Set(mine.map((r) => r.model))],
    tokens: mine.map((r) => ({ in: r.inputTokens, out: r.outputTokens, cacheRead: r.cacheReadTokens })),
    brainEngaged: ms >= SLOT_TIMEOUT_MS * 0.9,
    timeoutUnits: Number(timeoutUnits.toFixed(2)),
    timeoutSignature: nearMultiple ? `${Math.round(timeoutUnits)} x ${SLOT_TIMEOUT_MS}ms slot timeout` : null,
    budgetExhausted: ms >= GEN_BUDGET_MS * 0.9,
    phase2Band: c.phase2 ? `${c.phase2.daysInTolerance}/${c.phase2.daysJudged}` : null,
    phase3Band: c.mine ? `${c.mine.daysInTolerance}/${c.mine.daysJudged}` : null,
    warnedSlots: c.mine?.warnedSlots ?? null,
    leakCount: c.mine?.leakCount ?? 0,
    verdict: c.verdict,
  };
});

// Did any paid output actually reach the product?
const artifacts = {
  generatedRecipeRows: await prisma.generatedRecipe.count(),
  generatedPlanRows: await prisma.generatedPlan.count(),
  brainSolveRunRows: await prisma.brainSolveRun.count(),
  aiGeneratedRecipes: await prisma.recipe.count({ where: { source: 'ai-generated' } }),
  recipesCreatedTonight: await prisma.recipe.count({ where: { createdAt: { gte: windowStart } } }),
};

const ledgerNow = await prisma.llmUsage.aggregate({ _sum: { costUsd: true }, _count: true });
const totalSpend = Number(((ledgerNow._sum.costUsd || 0) - C0_COST).toFixed(6));

const engaged = attributed.filter((a) => a.brainEngaged);
const billed = attributed.filter((a) => a.rowCount > 0);

const out = {
  cohortSize: attributed.length,
  ledger: {
    c0Rows: C0_ROWS, c0Cost: C0_COST,
    nowRows: ledgerNow._count, nowCost: Number((ledgerNow._sum.costUsd || 0).toFixed(6)),
    phase3Rows: ledgerNow._count - C0_ROWS, phase3SpendUsd: totalSpend,
    capUsd: 5.00, hardStopUsd: 4.50, withinCap: totalSpend <= 5.00,
    attributionSumUsd: Number(attributed.reduce((s, a) => s + a.costUsd, 0).toFixed(6)),
  },
  headline: {
    personasWhereBrainEngaged: engaged.length,
    personasWhereBrainBilled: billed.length,
    personasBilledIds: billed.map((a) => a.id),
    wallClockBurnedSec: Math.round(engaged.reduce((s, a) => s + a.ms, 0) / 1000),
    timeoutSignatureCount: attributed.filter((a) => a.timeoutSignature).length,
    budgetExhaustedCount: attributed.filter((a) => a.budgetExhausted).length,
  },
  artifacts,
  perPersona: attributed,
};
writeJson('brain-analysis.json', out);

console.log('== PHASE 3 RE-ATTRIBUTION ==');
console.log(`ledger      : C0 ${C0_ROWS} rows/$${C0_COST} -> now ${out.ledger.nowRows} rows/$${out.ledger.nowCost}`);
console.log(`phase 3     : ${out.ledger.phase3Rows} row(s), $${totalSpend.toFixed(6)} of a $5.00 cap  (attribution sums to $${out.ledger.attributionSumUsd})`);
console.log(`brain ENGAGED (>=31.5s wall clock): ${engaged.length}/${attributed.length} personas`);
console.log(`brain BILLED  (>=1 LlmUsage row)  : ${billed.length}/${attributed.length} personas -> ${billed.map((a) => `${a.id} $${a.costUsd} [${a.phases.join(',')}]`).join(', ') || 'none'}`);
console.log(`wall clock burned by engaged brain: ${out.headline.wallClockBurnedSec}s`);
console.log(`generates landing on an exact multiple of the 35s slot timeout: ${out.headline.timeoutSignatureCount}`);
console.log(`\nartifacts persisted from paid output: ${JSON.stringify(artifacts)}`);
console.log('\nper-persona:');
for (const a of attributed) {
  console.log(`  ${a.id} [${a.arm}] ${String(a.ms).padStart(6)}ms  ${a.timeoutSignature ? `= ${a.timeoutSignature}` : ''}  rows=${a.rowCount} $${a.costUsd}  band ${a.phase2Band}->${a.phase3Band}  warned=${a.warnedSlots}`);
}
await prisma.$disconnect();
