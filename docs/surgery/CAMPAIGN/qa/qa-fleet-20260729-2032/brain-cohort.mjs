/**
 * brain-cohort.mjs — Phase 3. BRAIN=on, ≤20 personas, HARD $5.00 CAP.
 *
 * THE MONEY STOP IS MECHANICAL, NOT A PROMISE:
 *   · C0 = cumulative LlmUsage cost, read BEFORE the cohort.
 *   · Before EVERY persona, C is re-read. If C − C0 ≥ $4.50 the cohort ends
 *     mid-stride and records exactly where it stopped.
 *   · The per-generate design cap is armed with the variable the code actually
 *     reads — BRAIN_MAX_DESIGNS_PER_GENERATE → BRAIN_CALL_CEILING (plans.js:155).
 *   · The monthly cap is armed RELATIVE to month-to-date spend, or pre-existing
 *     rows starve the run and it reports a false null (witness.js's lesson).
 *
 * Selection, per the mission: ~15 HARD personas whose Phase-2 days landed OUT of
 * tolerance or carried warned slots; 2–3 that landed comfortably IN band (where
 * the brain STAYING SILENT is the pass, per the repo's library-first D0 law); and
 * 2 IMPOSSIBLE (where a fast honest refusal at $0 is the pass).
 *
 *   node brain-cohort.mjs --port 3948
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {
  prisma, hashPassword, BACKEND, HOME, RUN_ID, Jar, client, mintAndLogin, ledger, sql,
  auditPlanSafety, recomputeDays, judgeDay, readLines, writeJson, appendLine, sleep,
} from './lib.mjs';

const require = createRequire(path.join(BACKEND, 'package.json'));
const { computeMacros } = require(path.join(BACKEND, 'src', 'lib', 'bmrEngine.js'));
const { getWeightNowKg } = require(path.join(BACKEND, 'src', 'lib', 'weightNow.js'));
const { reconcileTarget } = require(path.join(BACKEND, 'src', 'lib', 'profileTarget.js'));

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i === -1 ? d : process.argv[i + 1]; };
const PORT = Number(argOf('--port', '3948'));
const BASE = `http://127.0.0.1:${PORT}`;
const HARD_STOP_USD = 4.50;   // cohort ends at C − C0 ≥ this
const TOTAL_CAP_USD = 5.00;   // the mission's absolute ceiling
const PASSWORD = `fleet-${RUN_ID}-pw`;

async function targetFor(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const weightKg = await getWeightNowKg(userId, profile);
  const reconciled = await reconcileTarget(userId, { profile, reason: 'qa-fleet-brain', write: false });
  return computeMacros(profile, weightKg, reconciled.target);
}

/** Ledger rows created strictly inside this window, for per-persona attribution. */
async function rowsSince(iso) {
  return sql('select id, phase, intent, model, inputTokens, outputTokens, cacheReadTokens, costUsd, createdAt, userId from LlmUsage where createdAt > ? order by createdAt', iso);
}

async function main() {
  const brainStatus = await fetch(`${BASE}/api/auth/status`).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  console.log(`== PHASE 3 == BRAIN=on  port ${PORT}  server reachable: ${JSON.stringify(brainStatus)}`);

  const personas = readLines('personas.jsonl');
  const results = readLines('results.jsonl');
  const byId = new Map(personas.map((p) => [p.id, p]));
  const res = new Map(results.map((r) => [r.id, r]));

  // ── selection from Phase-2 EVIDENCE, not from a guess ────────────────────
  const scored = results.filter((r) => r.primary?.mine).map((r) => ({
    r, m: r.primary.mine,
    outOfBand: r.primary.mine.daysJudged - r.primary.mine.daysInTolerance,
    warned: r.primary.mine.warnedSlots,
    residual: (r.primary.mine.daysJudged - r.primary.mine.daysInTolerance) + (r.primary.mine.warnedSlots > 0 ? 1 : 0),
  }));

  const hardProspects = scored
    .filter((x) => x.r.tier === 'HARD' && (x.outOfBand > 0 || x.warned > 0))
    // A genuine residual gap: days that missed, but a plan that mostly EXISTS.
    // A persona whose pool collapsed to 1 recipe is a filter problem, not a
    // residual-gap problem, and the brain cannot be blamed or credited for it.
    .filter((x) => x.m.slotsFilled >= Math.max(2, x.m.slotsReturned * 0.5))
    .sort((a, b) => b.residual - a.residual || b.warned - a.warned)
    .slice(0, 15);

  const inBand = scored
    .filter((x) => x.m.daysJudged > 0 && x.m.daysInTolerance === x.m.daysJudged && x.m.warnedSlots === 0)
    .sort((a, b) => b.m.daysJudged - a.m.daysJudged)
    .slice(0, 3);

  const impossible = scored.filter((x) => x.r.tier === 'IMPOSSIBLE').sort((a, b) => b.outOfBand - a.outOfBand).slice(0, 2);

  const cohort = [
    ...hardProspects.map((x) => ({ id: x.r.id, arm: 'HARD-residual', why: `${x.outOfBand}/${x.m.daysJudged} days out of band, ${x.warned} warned slot(s) in Phase 2` })),
    ...inBand.map((x) => ({ id: x.r.id, arm: 'IN-BAND-silence', why: `${x.m.daysInTolerance}/${x.m.daysJudged} days in band, 0 warned slots — the brain staying silent is the pass (D0)` })),
    ...impossible.map((x) => ({ id: x.r.id, arm: 'IMPOSSIBLE-refuse', why: `contradictory by construction (${x.r.impossibleKind}) — a fast honest refusal at $0 is the pass` })),
  ];
  console.log(`cohort     : ${cohort.length} personas — ${hardProspects.length} HARD-residual, ${inBand.length} in-band, ${impossible.length} impossible`);

  const c0 = await ledger();
  console.log(`ledger C0  : ${c0.rows} rows / $${c0.cost.toFixed(6)}   HARD STOP at C-C0 >= $${HARD_STOP_USD.toFixed(2)} (mission cap $${TOTAL_CAP_USD.toFixed(2)})`);

  const HASH = await hashPassword(PASSWORD);
  const out = [];
  let stoppedAt = null;

  for (const spec of cohort) {
    // ── THE STOP, RE-READ BEFORE EVERY PERSONA ─────────────────────────────
    const c = await ledger();
    const spent = c.cost - c0.cost;
    if (spent >= HARD_STOP_USD) {
      stoppedAt = { persona: spec.id, spentUsd: Number(spent.toFixed(6)), rows: c.rows - c0.rows, remaining: cohort.length - out.length };
      console.log(`\n!! COHORT OVER — $${spent.toFixed(4)} spent >= $${HARD_STOP_USD} stop. Halted before ${spec.id}; ${stoppedAt.remaining} persona(s) not run.`);
      break;
    }

    const p = byId.get(spec.id);
    const phase2 = res.get(spec.id);
    const email = `qa-fleet-${RUN_ID}-${p.id}@fleet.local`;
    const jar = new Jar();
    const api = client(BASE, jar);
    const rec = {
      id: p.id, arm: spec.arm, why: spec.why, tier: p.tier, walls: p.walls,
      dietaryStyle: p.profile.dietaryStyle, horizon: p.horizon,
      phase2: phase2?.primary?.mine && {
        daysInTolerance: phase2.primary.mine.daysInTolerance, daysJudged: phase2.primary.mine.daysJudged,
        warnedSlots: phase2.primary.mine.warnedSlots, slotsFilled: phase2.primary.mine.slotsFilled,
        leakCount: phase2.primary.mine.leakCount, ms: phase2.primary.ms,
      },
      spendBefore: Number(spent.toFixed(6)),
    };

    const mint = await mintAndLogin(api, email, PASSWORD, HASH);
    if (!mint.ok) { rec.error = `login ${mint.status}`; out.push(rec); continue; }

    // Same profile as Phase 2 — the ONLY variable is BRAIN.
    const prof = await api('PUT', '/api/profile', p.profile);
    if (prof.status === 422 && prof.json?.requiresAck) {
      await api('PUT', '/api/profile', { ...p.profile, rateAcknowledged: true, goalWeightAcknowledged: true });
    }
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const target = await targetFor(user.id);

    const t0 = new Date().toISOString();
    const gen = await api('POST', '/api/plans/generate', { horizon: p.horizon, filters: p.filters }, 150000);
    const t1 = new Date().toISOString();
    rec.generate = { status: gen.status, ms: gen.ms, aborted: !!gen.aborted, t0, t1 };

    // ── ledger delta attributed to THIS persona, by row id and timestamp ────
    const rows = await rowsSince(t0);
    const mine = rows.filter((x) => x.createdAt > t0 && x.createdAt <= t1 || x.userId === user.id);
    rec.ledger = {
      rowIds: mine.map((x) => x.id),
      rowCount: mine.length,
      costUsd: Number(mine.reduce((s, x) => s + (x.costUsd || 0), 0).toFixed(6)),
      phases: mine.reduce((m, x) => { m[x.phase || 'null'] = (m[x.phase || 'null'] || 0) + 1; return m; }, {}),
      models: [...new Set(mine.map((x) => x.model))],
      windowT0: t0, windowT1: t1,
    };
    rec.brainFired = mine.length > 0;

    if (gen.status === 200 && target) {
      const audit = await auditPlanSafety(user.id, p);
      const days = recomputeDays(audit.slots, audit.foods);
      const byDow = new Map(days.map((d) => [d.dayOfWeek, d]));
      const dows = (gen.json?.meta?.days || []).map((d) => d.dayOfWeek);
      const list = (dows.length ? dows : [...byDow.keys()]).map((dow) => byDow.get(dow) || { dayOfWeek: dow, kcal: 0, protein: 0, fat: 0, carb: 0, claimedKcal: 0, slots: 0, warned: 0, empty: true });
      const verdicts = list.map((d) => ({ d, v: judgeDay(target, d) }));

      rec.mine = {
        slotsFilled: audit.slotCount, slotsReturned: gen.json?.slots?.length ?? 0,
        daysInTolerance: verdicts.filter((x) => x.v.inTolerance).length, daysJudged: verdicts.length,
        warnedSlots: audit.slots.filter((s) => s.warning).length,
        leakCount: audit.leaks.length, leaks: audit.leaks,
        distinctRecipes: new Set(audit.slots.map((s) => s.recipeId)).size,
      };
      rec.claims = {
        matchPct: gen.json.meta?.matchPct,
        daysInTolerance: gen.json.meta?.score?.daysInTolerance, totalDays: gen.json.meta?.score?.totalDays,
        diagnosisPresent: !!gen.json.meta?.diagnosis, binding: gen.json.meta?.diagnosis?.binding?.key ?? null,
      };

      // Which shipped slots came from the BRAIN? Provenance is a Recipe column.
      const rids = [...new Set(audit.slots.map((s) => s.recipeId))].filter(Boolean);
      if (rids.length) {
        const recipes = await prisma.recipe.findMany({ where: { id: { in: rids } }, select: { id: true, name: true, source: true, aiFingerprint: true, aiVerifiedAt: true, createdAt: true } });
        const brainDesigned = recipes.filter((x) => x.source === 'ai-generated' || x.aiFingerprint != null || new Date(x.createdAt).toISOString() > t0);
        rec.provenance = {
          shippedRecipes: recipes.length,
          bySource: recipes.reduce((m, x) => { m[x.source] = (m[x.source] || 0) + 1; return m; }, {}),
          brainDesigned: brainDesigned.map((x) => ({ id: x.id, name: x.name, source: x.source, verified: !!x.aiVerifiedAt, createdInWindow: new Date(x.createdAt).toISOString() > t0 })),
          brainDesignedCount: brainDesigned.length,
        };
        // SAFETY RE-VERIFICATION ON BRAIN-DESIGNED MEALS — the worst possible
        // finding of the night, so it is checked separately and explicitly.
        const brainIds = new Set(brainDesigned.map((x) => x.id));
        rec.brainLeaks = audit.leaks.filter((l) => audit.slots.some((s) => s.slotId === l.slotId && brainIds.has(s.recipeId)));
      }

      // ── the D0 verdict for this arm ──────────────────────────────────────
      if (spec.arm === 'IN-BAND-silence') {
        rec.verdict = !rec.brainFired ? 'PASS — brain stayed silent on an in-band day'
          : `DEFECT — brain fired ($${rec.ledger.costUsd}) on a day that was already in band`;
      } else if (spec.arm === 'IMPOSSIBLE-refuse') {
        rec.verdict = rec.ledger.costUsd === 0 ? 'PASS — no dollars burned chasing a contradiction'
          : `DEFECT — spent $${rec.ledger.costUsd} on a mathematically unsatisfiable request`;
      } else {
        const before = rec.phase2?.daysInTolerance ?? null;
        const after = rec.mine.daysInTolerance;
        rec.verdict = !rec.brainFired
          ? `brain SILENT despite a residual gap (${before}→${after} days in band, ${rec.mine.warnedSlots} warned slots)`
          : `brain fired ${rec.ledger.rowCount} row(s)/$${rec.ledger.costUsd}: ${before}→${after} days in band`;
        rec.improved = before != null ? after - before : null;
      }
    } else if (gen.status >= 400) {
      rec.refusal = { status: gen.status, error: (gen.json?.error ?? gen.text).toString().slice(0, 400) };
      rec.verdict = spec.arm === 'IMPOSSIBLE-refuse'
        ? (rec.ledger.costUsd === 0 ? 'PASS — honest refusal, $0 spent' : `DEFECT — refused but spent $${rec.ledger.costUsd}`)
        : `generate ${gen.status}: ${rec.refusal.error.slice(0, 160)}`;
    } else if (gen.status === 0) {
      rec.verdict = 'DEFECT — no response inside 150 s (spinner forever)';
    }

    console.log(`  ${p.id} [${spec.arm}] gen=${gen.status} ${gen.ms}ms  brainRows=${rec.ledger.rowCount} $${rec.ledger.costUsd}  band ${rec.mine ? `${rec.mine.daysInTolerance}/${rec.mine.daysJudged}` : '-'}  ${rec.verdict || ''}`);
    out.push(rec);
    appendLine('brain-cohort.jsonl', rec);
    await sleep(200);
  }

  const c1 = await ledger();
  const summary = {
    runId: RUN_ID, port: PORT, cohortPlanned: cohort.length, cohortRun: out.length,
    status: stoppedAt ? 'capped' : 'complete', stoppedAt,
    ledgerC0: c0, ledgerC1: c1,
    phase3SpendUsd: Number((c1.cost - c0.cost).toFixed(6)),
    phase3Rows: c1.rows - c0.rows,
    capUsd: TOTAL_CAP_USD, hardStopUsd: HARD_STOP_USD,
    withinCap: (c1.cost - c0.cost) <= TOTAL_CAP_USD,
    brainFiredCount: out.filter((r) => r.brainFired).length,
    brainLeakCount: out.reduce((s, r) => s + (r.brainLeaks?.length || 0), 0),
    arms: out.reduce((m, r) => { m[r.arm] = (m[r.arm] || 0) + 1; return m; }, {}),
  };
  writeJson('brain-summary.json', summary);
  console.log(`\n== PHASE 3 CLOSE ==`);
  console.log(`spend      : $${summary.phase3SpendUsd.toFixed(6)} over ${summary.phase3Rows} row(s)  (cap $${TOTAL_CAP_USD}) — ${summary.withinCap ? 'WITHIN CAP' : 'CAP BREACHED'}`);
  console.log(`brain fired: ${summary.brainFiredCount}/${out.length} personas · brain-designed leaks: ${summary.brainLeakCount}`);
  console.log(`status     : ${summary.status}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('BRAIN COHORT FAILED:', e && e.stack); try { await prisma.$disconnect(); } catch {} process.exitCode = 1; });
