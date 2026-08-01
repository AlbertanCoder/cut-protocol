/**
 * fleet.mjs — Phase 2. 250 strangers, BRAIN=off, $0, concurrency 3.
 *
 * Every persona: mint (Prisma-direct row + REAL login) → profile over HTTP, in
 * the order the UI would → generate → capture raw → grade from RAW DB ROWS.
 *
 * The app's own verdicts (`meta.matchPct`, `meta.days[].inTolerance`,
 * `meta.diagnosis`, slot `warning`) are recorded as CLAIMS and then checked
 * against the fleet's own recomputation. Law 10: the app is the subject, not a
 * witness.
 *
 *   node fleet.mjs [--port 3947] [--limit N] [--from N]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {
  prisma, hashPassword, BACKEND, HOME, RUN_ID, Jar, client, mintAndLogin, ledger,
  auditPlanSafety, recomputeDays, judgeDay, readLines, writeJson, readJson, appendLine, pool, sleep,
} from './lib.mjs';

const require = createRequire(path.join(BACKEND, 'package.json'));
const { computeMacros } = require(path.join(BACKEND, 'src', 'lib', 'bmrEngine.js'));
const { getWeightNowKg } = require(path.join(BACKEND, 'src', 'lib', 'weightNow.js'));
const { reconcileTarget } = require(path.join(BACKEND, 'src', 'lib', 'profileTarget.js'));

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i === -1 ? d : process.argv[i + 1]; };
const PORT = Number(argOf('--port', '3947'));
const BASE = `http://127.0.0.1:${PORT}`;
const LIMIT = Number(argOf('--limit', '250'));
const FROM = Number(argOf('--from', '0'));
const GEN_TIMEOUT_MS = 90000;
const CONCURRENCY = 3;
const PASSWORD = `fleet-${RUN_ID}-pw`;

// The 15-persona variety subsample: every 17th, so the spread crosses tiers.
const SUBSAMPLE = Array.from({ length: 15 }, (_, k) => k * 17).filter((i) => i < 250);
const REGENS = 3; // total generations for a subsample persona (the primary + 2)

/** The app's own promise for this user (see PREFLIGHT.md — target vs delivery). */
async function targetFor(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const weightKg = await getWeightNowKg(userId, profile);
  const reconciled = await reconcileTarget(userId, { profile, reason: 'qa-fleet-audit', write: false });
  return computeMacros(profile, weightKg, reconciled.target);
}

/** SQLite write-lock backoff. Persistent contention is a finding; a blip is not. */
const LOCKY = /database is locked|SQLITE_BUSY|Timed out during query execution|P2028|P2024/i;
async function withRetry(fn, label, budget = 3) {
  let last = null;
  for (let attempt = 1; attempt <= budget; attempt++) {
    const r = await fn();
    const body = `${r.status} ${r.text || ''} ${r.err || ''}`;
    if (!LOCKY.test(body)) return { ...r, lockRetries: attempt - 1 };
    last = r;
    if (attempt < budget) await sleep(250 * attempt * attempt);
  }
  return { ...last, lockRetries: budget - 1, lockGaveUp: true, lockLabel: label };
}

/** One persona's whole journey. Never throws — a thrown persona is a lost datum. */
async function runPersona(p) {
  const email = `qa-fleet-${RUN_ID}-${p.id}@fleet.local`;
  const t0 = Date.now();
  const rec = {
    idx: p.idx, id: p.id, tier: p.tier, email, horizon: p.horizon,
    walls: p.walls, dietaryStyle: p.profile.dietaryStyle, goalKind: p.goalKind,
    macroStyle: p.macroStyle, bmi: p.bmi, robustKind: p.robustKind ?? null,
    impossibleKind: p.impossibleKind ?? null,
    steps: {}, defects: [], gaps: p.requestedButUnsupported.slice(),
  };

  try {
    const jar = new Jar();
    const api = client(BASE, jar);

    // ── 1. mint + real login ────────────────────────────────────────────────
    const mint = await mintAndLogin(api, email, PASSWORD, HASH);
    rec.steps.login = { minted: mint.minted, ok: mint.ok, status: mint.status };
    if (!mint.ok || !jar.has('cutprotocol_session')) {
      rec.defects.push({ sev: 'P0', endpoint: 'POST /api/auth/login', signature: `login-${mint.status}`, detail: `login failed ${mint.status}: ${mint.body}` });
      rec.outcome = 'login-failed';
      return rec;
    }

    // ── 2. profile, through the front door ──────────────────────────────────
    let body = { ...p.profile };
    let prof = await withRetry(() => api('PUT', '/api/profile', body), 'profile');
    rec.steps.profile = [{ status: prof.status, ms: prof.ms, sent: Object.keys(body).length }];

    // An illegal value must come back as a NAMED FIELD ERROR, not a 500 and not
    // a silent accept. Grade that, then do what a real customer does: fix it.
    if (p.expectRejection) {
      const named = prof.json?.fields && Object.prototype.hasOwnProperty.call(prof.json.fields, p.expectRejection.field);
      rec.steps.rejection = {
        expectedField: p.expectRejection.field, status: prof.status,
        namedTheField: !!named,
        message: named ? prof.json.fields[p.expectRejection.field] : (prof.json?.error ?? prof.text.slice(0, 200)),
        honest: prof.status === 400 && !!named,
      };
      if (prof.status === 500 || prof.status === 0) {
        rec.defects.push({ sev: 'P1', endpoint: 'PUT /api/profile', signature: `illegal-value-${prof.status}`, detail: `${p.expectRejection.field}=${p.profile[p.expectRejection.field]} produced ${prof.status}, not a field error` });
      } else if (prof.status === 200) {
        rec.defects.push({ sev: 'P1', endpoint: 'PUT /api/profile', signature: 'illegal-value-accepted', detail: `${p.expectRejection.field}=${p.profile[p.expectRejection.field]} was ACCEPTED (validator says ${p.expectRejection.why})` });
      }
      if (prof.status !== 200) {
        body = { ...body, [p.expectRejection.field]: 3 }; // the customer corrects it
        prof = await withRetry(() => api('PUT', '/api/profile', body), 'profile-corrected');
        rec.steps.profile.push({ status: prof.status, ms: prof.ms, corrected: true });
      }
    }

    // Answer an acknowledgement gate the way a person would, once.
    if (prof.status === 422 && prof.json?.requiresAck) {
      const ackField = prof.json.ack === 'rate' ? 'rateAcknowledged' : 'goalWeightAcknowledged';
      rec.steps.ackGate = { ack: prof.json.ack, status: 422, reasons: (prof.json.reasons || []).length };
      body = { ...body, [ackField]: true };
      prof = await withRetry(() => api('PUT', '/api/profile', body), 'profile-ack');
      rec.steps.profile.push({ status: prof.status, ms: prof.ms, acked: prof.json?.ack ?? ackField });
    }

    if (prof.status !== 200) {
      rec.steps.profileFinal = { status: prof.status, gate: prof.json?.gate ?? null, error: (prof.json?.error ?? prof.text).toString().slice(0, 300) };
      // A REFUSAL WE ASKED FOR IS NOT A DEFECT. adultGate/goalWeightGate firing
      // on a persona engineered to trip them is the app working.
      // Gates the app is SUPPOSED to fire are not defects. `gain-not-supported` was
      // added by this campaign's own remediation (D2) and belongs on this list.
      const engineered = ['adult-only', 'goal-weight-floor', 'gain-not-supported'].includes(prof.json?.gate);
      if (!engineered) {
        rec.defects.push({ sev: prof.status >= 500 ? 'P0' : 'P2', endpoint: 'PUT /api/profile', signature: `profile-${prof.status}-${prof.json?.gate ?? 'nogate'}`, detail: (prof.json?.error ?? prof.text).toString().slice(0, 300) });
      }
      rec.outcome = `profile-blocked-${prof.status}`;
      rec.ms = Date.now() - t0;
      return rec;
    }

    // What did the server actually KEEP? Silent field drops are the exact
    // failure mode witness.js was amended for on 2026-07-29.
    const droppedFields = Object.keys(body).filter((k) =>
      !['rateAcknowledged', 'goalWeightAcknowledged'].includes(k)
      && JSON.stringify(prof.json?.[k]) !== JSON.stringify(body[k]));
    rec.steps.droppedFields = droppedFields;
    if (droppedFields.length) {
      rec.defects.push({ sev: 'P2', endpoint: 'PUT /api/profile', signature: `silent-field-drop:${droppedFields.sort().join('+')}`, detail: `sent ${droppedFields.join(', ')}; the 200 response does not carry them back` });
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    rec.userId = user.id;
    const target = await targetFor(user.id);
    rec.target = target && { kcal: target.kcal, proteinLo: target.proteinLo, proteinHi: target.proteinHi, fatLo: target.fatLo, fatHi: target.fatHi, carbLo: target.carbLo, carbHi: target.carbHi, keto: !!target.keto, macroKcalGap: target.macroKcalGap };
    rec.targetKcal = prof.json?.targetKcal ?? null;
    rec.floorClamped = target ? prof.json?.targetKcal === (prof.json?.floorKcal ?? null) : null;

    // ── 3. generate, and 4. capture ─────────────────────────────────────────
    const isSub = SUBSAMPLE.includes(p.idx);
    const runs = [];
    const n = isSub ? REGENS : 1;
    for (let g = 0; g < n; g++) {
      const gen = await withRetry(() => api('POST', '/api/plans/generate', { horizon: p.horizon, filters: p.filters }, GEN_TIMEOUT_MS), 'generate');
      const obs = { gen: g, status: gen.status, ms: gen.ms, aborted: !!gen.aborted, lockRetries: gen.lockRetries || 0 };

      if (gen.status === 0 && gen.aborted) {
        obs.spinnerForever = true;
        rec.defects.push({ sev: 'P0', endpoint: 'POST /api/plans/generate', signature: 'client-timeout-90s', detail: `no response within ${GEN_TIMEOUT_MS} ms — spinner forever` });
      } else if (gen.status >= 500) {
        obs.serverError = (gen.json?.error ?? gen.text).toString().slice(0, 300);
        rec.defects.push({ sev: 'P0', endpoint: 'POST /api/plans/generate', signature: `generate-${gen.status}:${(gen.json?.error ?? 'blank').toString().slice(0, 60)}`, detail: obs.serverError });
      } else if (gen.status >= 400) {
        obs.refusal = { status: gen.status, error: (gen.json?.error ?? gen.text).toString().slice(0, 400) };
      }

      if (g === 0) {
        fs.writeFileSync(path.join(HOME, 'raw', `${p.id}.json`), JSON.stringify({
          persona: p, request: { horizon: p.horizon, filters: p.filters },
          profileResponse: prof.json, generate: { status: gen.status, ms: gen.ms, body: gen.json ?? gen.text.slice(0, 4000) },
        }, null, 1));
      }

      // The app's CLAIMS about this generation, recorded verbatim, judged later.
      const m = gen.json?.meta;
      obs.claims = m ? {
        matchPct: m.matchPct, attempts: m.attempts,
        daysInTolerance: m.score?.daysInTolerance ?? null, totalDays: m.score?.totalDays ?? null,
        diagnosisPresent: !!m.diagnosis, diagnosisFeasible: m.diagnosis?.feasible ?? null,
        binding: m.diagnosis?.binding?.key ?? null,
        poolCounts: m.poolCounts && { raw: m.poolCounts.raw, afterDiet: m.poolCounts.afterDiet, afterPrep: m.poolCounts.afterPrep, afterStack: m.poolCounts.afterStack },
        days: (m.days || []).map((d) => ({ dayOfWeek: d.dayOfWeek, inTolerance: d.inTolerance, miss: d.miss, warnedSlots: d.warnedSlots, unfilledSlots: d.unfilledSlots, matchPct: d.matchPct })),
        solveMs: m.horizon?.solveMs ?? null,
        distinctRecipesClaimed: m.variety?.horizon?.distinctRecipes ?? null,
        varietyNotes: (m.variety?.notes || []).length,
      } : null;
      obs.slotsReturned = gen.json?.slots?.length ?? 0;

      // ── 5. GRADE, from raw DB rows ────────────────────────────────────────
      if (gen.status === 200 && target) {
        const audit = await auditPlanSafety(user.id, p);
        const days = recomputeDays(audit.slots, audit.foods);

        // THE DENOMINATOR MUST INCLUDE THE EMPTY DAYS.
        //
        // recomputeDays only sees slots that HAVE a recipe, so a day the solver
        // left completely unfilled produced no row at all and was silently
        // dropped from the count. Persona p005 exposed this in the trial run: the
        // app honestly reported 0/7 days in tolerance with five days at 0 kcal,
        // and the fleet scored it 0/1 — flattering the app by ignoring six days
        // of nothing. A day with no food is the WORST day, not an absent one.
        //
        // So the day set comes from the horizon the app itself says it covered,
        // and any day with no recomputed row is judged as a real 0-kcal day.
        const byDow = new Map(days.map((d) => [d.dayOfWeek, d]));
        const coveredDows = (m?.days || []).map((d) => d.dayOfWeek);
        const dowList = coveredDows.length ? coveredDows : [...byDow.keys()];
        const judged = dowList.map((dow) => byDow.get(dow)
          || { dayOfWeek: dow, startDate: null, kcal: 0, protein: 0, fat: 0, carb: 0, claimedKcal: 0, claimedProtein: 0, claimedFat: 0, claimedCarb: 0, slots: 0, warned: 0, missingFood: 0, empty: true });
        const verdicts = judged.map((d) => ({ d, v: judgeDay(target, d) }));

        obs.mine = {
          slotsFilled: audit.slotCount,
          unresolvedFoodIds: audit.unresolved.length,
          ingParseFailures: audit.slots.filter((s) => s._ingParseFailed).length,
          leaks: audit.leaks,
          leakCount: audit.leaks.length,
          nameFlagCount: audit.nameFlags.length,
          nameFlags: audit.nameFlags.slice(0, 6),
          daysJudged: verdicts.length,
          daysInTolerance: verdicts.filter((x) => x.v.inTolerance).length,
          distinctRecipes: new Set(audit.slots.map((s) => s.recipeId)).size,
          maxRepeat: (() => { const c = {}; for (const s of audit.slots) c[s.recipeId] = (c[s.recipeId] || 0) + 1; return Math.max(0, ...Object.values(c)); })(),
          warnedSlots: audit.slots.filter((s) => s.warning).length,
          emptyDays: verdicts.filter(({ d }) => d.slots === 0).length,
          slotsReturned: gen.json?.slots?.length ?? 0,
          unfilledSlots: (gen.json?.slots?.length ?? 0) - audit.slotCount,
          days: verdicts.map(({ d, v }) => ({
            dayOfWeek: d.dayOfWeek, slots: d.slots, empty: !!d.empty,
            kcal: Math.round(d.kcal), protein: Math.round(d.protein), fat: Math.round(d.fat), carb: Math.round(d.carb),
            claimedKcal: Math.round(d.claimedKcal),
            claimDriftKcal: Math.round(Math.abs(d.kcal - d.claimedKcal) * 10) / 10,
            inTolerance: v.inTolerance, kcalOk: v.kcalOk, proteinOk: v.proteinOk, fatOk: v.fatOk, carbOk: v.carbOk,
            kcalDeltaPct: Math.round(v.kcalDeltaPct * 1000) / 1000,
            proteinShortPct: Math.round(v.proteinShortPct * 1000) / 1000,
            fatShortPct: Math.round(v.fatShortPct * 1000) / 1000, fatOverPct: Math.round(v.fatOverPct * 1000) / 1000,
            carbShortPct: Math.round(v.carbShortPct * 1000) / 1000, carbOverPct: Math.round(v.carbOverPct * 1000) / 1000,
            warned: d.warned, missingFood: d.missingFood,
          })),
        };

        // SAFETY — precondition. Any ingredient-surface leak is P0.
        if (audit.leaks.length) {
          const byWall = {};
          for (const l of audit.leaks) { const k = l.wall || l.kind; (byWall[k] = byWall[k] || []).push(l); }
          for (const [wall, hits] of Object.entries(byWall)) {
            rec.defects.push({
              sev: 'P0', endpoint: 'POST /api/plans/generate', signature: `allergen-leak:${wall}`,
              detail: `${hits.length} ingredient hit(s) for wall "${wall}": ${[...new Set(hits.map((h) => `"${h.name}" (via "${h.term}") in ${h.recipe}`))].slice(0, 4).join('; ')}`,
              repro: `raw/${p.id}.json`, walls: p.walls, dietaryStyle: p.profile.dietaryStyle,
            });
          }
        }
        // Slot rows whose stored macros disagree with their own ingredients.
        const drifted = obs.mine.days.filter((d) => d.claimDriftKcal > 1);
        if (drifted.length) {
          rec.defects.push({ sev: 'P1', endpoint: 'PlanSlot (stored)', signature: 'stored-macro-drift', detail: `${drifted.length} day(s) where the stored slot totals disagree with the raw ingredient arithmetic (max ${Math.max(...drifted.map((d) => d.claimDriftKcal))} kcal)` });
        }
        if (audit.unresolved.length) {
          rec.defects.push({ sev: 'P1', endpoint: 'PlanSlot.ingredients', signature: 'dangling-foodId', detail: `${audit.unresolved.length} ingredient foodId(s) in the shipped plan resolve to no Food row` });
        }
        // A plan written mostly EMPTY. The app diagnoses this honestly (binding:
        // max-prep etc.), so it is not a lie — but a week with most slots blank
        // and days at 0 kcal is still a product failure from the customer's seat,
        // and writing it beats refusing it only if the customer is told plainly.
        if (obs.slotsReturned > 0 && audit.slotCount < obs.slotsReturned * 0.5) {
          rec.defects.push({
            sev: 'P1', endpoint: 'POST /api/plans/generate', signature: 'mostly-empty-plan-written',
            detail: `${audit.slotCount}/${obs.slotsReturned} slots filled (${obs.mine.emptyDays} day(s) at 0 kcal); pool collapsed ${obs.claims?.poolCounts?.raw}→${obs.claims?.poolCounts?.afterDiet}→${obs.claims?.poolCounts?.afterPrep}→${obs.claims?.poolCounts?.afterStack}, binding=${obs.claims?.binding}`,
            repro: `raw/${p.id}.json`,
          });
        }

        // HONESTY — a day I judge OUT of band that the app presented as fine.
        const claimByDay = new Map((obs.claims?.days || []).map((d) => [d.dayOfWeek, d]));
        const silent = [];
        for (const { d, v } of verdicts) {
          if (v.inTolerance) continue;
          const c = claimByDay.get(d.dayOfWeek);
          const appSaidSomething = (c && c.inTolerance === false) || (c && c.miss) || d.warned > 0 || obs.claims?.diagnosisPresent;
          if (!appSaidSomething) silent.push({ dayOfWeek: d.dayOfWeek, kcal: Math.round(d.kcal), targetKcal: target.kcal, why: [!v.kcalOk && 'kcal', !v.proteinOk && 'protein', !v.fatOk && 'fat', !v.carbOk && 'carb'].filter(Boolean).join('+') });
        }
        obs.mine.silentMisses = silent;
        if (silent.length) {
          rec.defects.push({ sev: 'P1', endpoint: 'POST /api/plans/generate', signature: 'silent-target-miss', detail: `${silent.length} day(s) out of band with no warning, no per-day miss line and no diagnosis: ${JSON.stringify(silent.slice(0, 3))}` });
        }
        // Disagreement between the app's own count and mine, on the same rule.
        if (obs.claims?.daysInTolerance != null && obs.claims.daysInTolerance !== obs.mine.daysInTolerance) {
          obs.mine.countDisagreement = { app: obs.claims.daysInTolerance, fleet: obs.mine.daysInTolerance };
        }

        // IMPOSSIBLE tier — graded on refusal quality, not on plan quality.
        if (p.tier === 'IMPOSSIBLE') {
          const anyInTol = obs.mine.daysInTolerance > 0;
          const honest = obs.claims?.diagnosisPresent === true && obs.claims?.diagnosisFeasible === false;
          const confidentLie = obs.mine.daysInTolerance === verdicts.length && verdicts.length > 0 && !obs.claims?.diagnosisPresent;
          obs.impossible = {
            refusedOutright: false, hadPlan: true, fast: gen.ms < 5000, ms: gen.ms,
            honestDiagnosis: honest, binding: obs.claims?.binding ?? null,
            reasonGiven: !!obs.claims?.diagnosisPresent,
            daysInTolerance: obs.mine.daysInTolerance, daysJudged: verdicts.length,
            unfilledSlots: (obs.claims?.days || []).reduce((s, d) => s + (d.unfilledSlots || 0), 0),
            warnedSlots: obs.mine.warnedSlots,
            verdict: honest ? 'honest-diagnosis' : confidentLie ? 'CONFIDENT-FAKE-PLAN' : anyInTol ? 'partial-silent' : 'unflagged-miss',
          };
          if (obs.impossible.verdict === 'CONFIDENT-FAKE-PLAN') {
            rec.defects.push({ sev: 'P0', endpoint: 'POST /api/plans/generate', signature: 'impossible-confident-fake-plan', detail: `contradictory request answered with a plan claiming every day in tolerance and NO diagnosis (${p.impossibleKind})`, repro: `raw/${p.id}.json` });
          }
        }
      } else if (gen.status === 200 && !target) {
        rec.defects.push({ sev: 'P1', endpoint: 'internal', signature: 'no-target-derivable', detail: 'plan returned but no target could be derived from the profile row' });
      }

      if (p.tier === 'IMPOSSIBLE' && gen.status >= 400 && gen.status < 500) {
        obs.impossible = { refusedOutright: true, hadPlan: false, fast: gen.ms < 5000, ms: gen.ms, reasonGiven: !!(gen.json?.error), message: (gen.json?.error ?? '').toString().slice(0, 300), verdict: gen.json?.error ? 'honest-refusal' : 'bare-refusal' };
      }
      runs.push(obs);
      if (g < n - 1) await sleep(60);
    }

    rec.runs = runs;
    rec.primary = runs[0];
    if (isSub) {
      const ok = runs.filter((x) => x.status === 200 && x.mine);
      rec.stability = {
        generations: runs.length, succeeded: ok.length,
        distinctRecipes: ok.map((x) => x.mine.distinctRecipes),
        daysInTolerance: ok.map((x) => x.mine.daysInTolerance),
        daysJudged: ok.map((x) => x.mine.daysJudged),
        maxRepeat: ok.map((x) => x.mine.maxRepeat),
        leakCounts: ok.map((x) => x.mine.leakCount),
        latencyMs: runs.map((x) => x.ms),
        complianceStable: new Set(ok.map((x) => x.mine.daysInTolerance)).size === 1,
        varietyRange: ok.length ? [Math.min(...ok.map((x) => x.mine.distinctRecipes)), Math.max(...ok.map((x) => x.mine.distinctRecipes))] : null,
      };

      // AFFORDABILITY, on the subsample only: does a cost surface exist and does
      // it actually carry numbers? (Grocery list is the customer-facing one.)
      const planId = (await prisma.plan.findFirst({ where: { userId: user.id }, orderBy: { startDate: 'desc' }, select: { id: true } }))?.id;
      if (planId) {
        const gl = await withRetry(() => api('POST', `/api/plans/${planId}/grocery-list`, {}), 'grocery');
        const items = gl.json?.items || gl.json?.list?.items || [];
        rec.affordability = {
          status: gl.status, ms: gl.ms, itemCount: Array.isArray(items) ? items.length : null,
          hasEstimatedTotal: !!(gl.json?.estimatedTotalCad ?? gl.json?.estTotal ?? gl.json?.totalCad ?? gl.json?.estimatedTotal),
          keys: gl.json && typeof gl.json === 'object' ? Object.keys(gl.json).slice(0, 14) : null,
        };
      }
      // Recipe-level cost coverage across THIS persona's shipped dishes.
      const rids = [...new Set((await prisma.planSlot.findMany({ where: { plan: { userId: user.id }, recipeId: { not: null } }, select: { recipeId: true } })).map((s) => s.recipeId))];
      if (rids.length) {
        const rows = await prisma.recipe.findMany({ where: { id: { in: rids } }, select: { id: true, costPerServing: true, prepTimeMin: true, difficulty: true, tasteTier: true } });
        rec.costCoverage = {
          shippedRecipes: rows.length,
          withCost: rows.filter((x) => x.costPerServing != null).length,
          withPrepTime: rows.filter((x) => x.prepTimeMin != null).length,
          withTasteTier: rows.filter((x) => x.tasteTier != null).length,
          withDifficulty: rows.filter((x) => x.difficulty != null).length,
        };
      }
    }

    rec.outcome = runs[0].status === 200 ? 'ok' : `generate-${runs[0].status}`;
  } catch (e) {
    rec.outcome = 'harness-error';
    rec.error = String((e && e.stack) || e).slice(0, 900);
    rec.defects.push({ sev: 'P2', endpoint: 'harness', signature: 'harness-error', detail: rec.error.slice(0, 200) });
  }
  rec.ms = Date.now() - t0;
  return rec;
}

// ── the run ─────────────────────────────────────────────────────────────────
let HASH;
async function main() {
  const started = Date.now();
  const c0 = await ledger();
  console.log(`== PHASE 2 == BRAIN=off  port ${PORT}  ledger C0 = ${c0.rows} rows / $${c0.cost.toFixed(6)}`);

  const all = readLines('personas.jsonl');
  if (all.length !== 250) throw new Error(`expected 250 personas, found ${all.length} — run personas.mjs first`);

  // Resume: personas already in results.jsonl are done. Idempotent by design.
  const done = new Set(readLines('results.jsonl').map((r) => r.id));
  if (done.size) console.log(`resume     : ${done.size} persona(s) already recorded — skipping them`);
  const todo = all.filter((p) => p.idx >= FROM && p.idx < FROM + LIMIT && !done.has(p.id));
  console.log(`to run     : ${todo.length}`);

  HASH = await hashPassword(PASSWORD); // one bcrypt, reused for all 250 rows

  let n = 0;
  let brakeTripped = null;
  const sigCounts = new Map();

  await pool(todo, CONCURRENCY, async (p) => {
    if (brakeTripped) return null;
    const rec = await runPersona(p);
    appendLine('results.jsonl', rec);
    n++;

    // Systemic-failure brake: >=30% of the first 50 hard-failing on the same
    // endpoint with the same signature means the remaining 200 would measure
    // the same broken pipe.
    for (const d of rec.defects) {
      if (d.sev !== 'P0') continue;
      const k = `${d.endpoint}|${d.signature}`;
      sigCounts.set(k, (sigCounts.get(k) || 0) + 1);
      if (n <= 50 && sigCounts.get(k) >= Math.ceil(0.30 * Math.min(50, todo.length))) {
        brakeTripped = { signature: k, count: sigCounts.get(k), after: n };
      }
    }

    if (n % 25 === 0 || n === todo.length) {
      const rows = readLines('results.jsonl');
      const ok = rows.filter((r) => r.outcome === 'ok');
      const withPlan = ok.filter((r) => r.primary?.mine);
      const leaks = withPlan.reduce((s, r) => s + r.primary.mine.leakCount, 0);
      const dj = withPlan.reduce((s, r) => s + r.primary.mine.daysJudged, 0);
      const dt = withPlan.reduce((s, r) => s + r.primary.mine.daysInTolerance, 0);
      const line = `${new Date().toISOString()}  n=${rows.length}/250  ok=${ok.length}  leaks=${leaks}  days-in-band=${dt}/${dj} (${dj ? (100 * dt / dj).toFixed(1) : '0.0'}%)  p50=${median(withPlan.map((r) => r.primary.ms))}ms  elapsed=${Math.round((Date.now() - started) / 1000)}s`;
      appendLine('heartbeat.log', line);
      console.log(`  ${line}`);
      writeJson('state.json', { phase: 2, runId: RUN_ID, head: '0d3eaa5', done: rows.length, ok: ok.length, leaks, ledgerC0: c0, updatedAt: new Date().toISOString() });
    }
    return rec;
  });

  const c1 = await ledger();
  const rows = readLines('results.jsonl');
  console.log(`\n== PHASE 2 CLOSE ==`);
  console.log(`personas   : ${rows.length}`);
  console.log(`MONEY      : C0 = ${c0.rows} rows / $${c0.cost.toFixed(6)}   C1 = ${c1.rows} rows / $${c1.cost.toFixed(6)}`);
  console.log(`             delta = ${c1.rows - c0.rows} rows / $${(c1.cost - c0.cost).toFixed(6)}  ${c1.cost === c0.cost && c1.rows === c0.rows ? '<= $0.00 VERIFIED' : '<= NON-ZERO, INVESTIGATE'}`);
  if (brakeTripped) console.log(`BRAKE      : tripped on ${brakeTripped.signature} (${brakeTripped.count} hits by persona ${brakeTripped.after})`);
  writeJson('state.json', { phase: 2, complete: true, runId: RUN_ID, done: rows.length, ledgerC0: c0, ledgerC1: c1, phase2SpendUsd: c1.cost - c0.cost, brakeTripped, elapsedSec: Math.round((Date.now() - started) / 1000), updatedAt: new Date().toISOString() });
  await prisma.$disconnect();
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

main().catch(async (e) => { console.error('FLEET FAILED:', e && e.stack); try { await prisma.$disconnect(); } catch {} process.exitCode = 1; });
