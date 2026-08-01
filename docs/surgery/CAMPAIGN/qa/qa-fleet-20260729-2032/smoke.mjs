/**
 * smoke.mjs — ONE persona through the whole front door, before 250 follow.
 * Proves: mint, real login cookie, profile over HTTP, generate, raw-row audit,
 * independent macro recompute, and $0 ledger movement. Idempotent.
 *
 *   node smoke.mjs [--port 3947]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { prisma, hashPassword, BACKEND, RUN_ID, Jar, client, mintAndLogin, ledger, auditPlanSafety, recomputeDays, judgeDay, writeJson } from './lib.mjs';

const require = createRequire(path.join(BACKEND, 'package.json'));
const { computeMacros } = require(path.join(BACKEND, 'src', 'lib', 'bmrEngine.js'));
const { getWeightNowKg } = require(path.join(BACKEND, 'src', 'lib', 'weightNow.js'));
const { reconcileTarget } = require(path.join(BACKEND, 'src', 'lib', 'profileTarget.js'));

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i === -1 ? d : process.argv[i + 1]; };
const PORT = Number(argOf('--port', '3947'));
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * The app's own promise for this user, read from the raw Profile row through the
 * same three functions planContext.js uses. The TARGET is the app's promise and
 * must be quoted as the app states it; the DELIVERY is what the fleet recomputes
 * independently. Keeping those two apart is the whole method.
 */
export async function targetFor(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const weightKg = await getWeightNowKg(userId, profile);
  // write:false — the fleet observes; it never lets its own measurement mutate
  // the row it is measuring. planContext passes write:true during generate, so
  // by the time this runs the row is already reconciled by the app itself.
  const reconciled = await reconcileTarget(userId, { profile, reason: 'qa-fleet-audit', write: false });
  return { target: computeMacros(profile, weightKg, reconciled.target), profile, weightKg };
}

async function main() {
  const c0 = await ledger();
  console.log(`ledger C0  : ${c0.rows} rows, $${c0.cost.toFixed(6)}`);

  const email = `qa-fleet-${RUN_ID}-p000@fleet.local`;
  const password = `fleet-${RUN_ID}-pw`;
  const hash = await hashPassword(password);
  const jar = new Jar();
  const api = client(BASE, jar);

  const mint = await mintAndLogin(api, email, password, hash);
  console.log(`mint/login : minted=${mint.minted} ok=${mint.ok} status=${mint.status}`);
  if (!mint.ok) throw new Error(`login failed: ${mint.status} ${mint.body}`);
  if (!jar.has('cutprotocol_session')) throw new Error('no cutprotocol_session cookie');

  const meta = await api('GET', '/api/profile/meta');
  console.log(`meta       : ${meta.status} styles=${meta.json?.dietaryStyles?.length} occupations=${meta.json?.occupations?.length} rates=${JSON.stringify(meta.json?.rateOptions)}`);

  const profileBody = {
    sex: 'M', age: 41, heightCm: 178, startWeightKg: 95, goalWeightKg: 84,
    occupationKey: 'driver-truck', trainingStyle: 'mixed', minutesPerSession: 30, sessionsPerWeek: 3,
    rateLbPerWeek: 1.0, dietaryStyle: 'none', excludedFoods: ['gluten', 'shellfish'],
    mealsPerDay: 3, snacksPerDay: 1, unitPref: 'imperial',
  };
  const prof = await api('PUT', '/api/profile', profileBody);
  console.log(`profile    : ${prof.status} targetKcal=${prof.json?.targetKcal} excluded=${JSON.stringify(prof.json?.excludedFoods)}`);
  if (prof.status >= 400) throw new Error(`profile failed ${prof.status}: ${prof.text.slice(0, 400)}`);

  // Confirm the round-trip: what did the server actually KEEP? Silent field
  // drops are the exact failure mode witness.js was amended for.
  const kept = {};
  for (const k of Object.keys(profileBody)) kept[k] = JSON.stringify(prof.json?.[k]) === JSON.stringify(profileBody[k]);
  const dropped = Object.keys(kept).filter((k) => !kept[k]);
  console.log(`round-trip : ${dropped.length ? `DROPPED/CHANGED ${dropped.join(',')}` : 'all fields persisted'}`);

  const gen = await api('POST', '/api/plans/generate', { horizon: 'week' });
  console.log(`generate   : ${gen.status} in ${gen.ms}ms  slots=${gen.json?.slots?.length ?? 0}`);
  console.log(`  app claims: matchPct=${gen.json?.meta?.matchPct} daysInTol=${gen.json?.meta?.score?.daysInTolerance}/${gen.json?.meta?.score?.totalDays} diagnosis=${gen.json?.meta?.diagnosis ? 'present' : 'null'}`);
  console.log(`  poolCounts: ${JSON.stringify(gen.json?.meta?.poolCounts && { raw: gen.json.meta.poolCounts.raw, afterDiet: gen.json.meta.poolCounts.afterDiet, afterPrep: gen.json.meta.poolCounts.afterPrep, afterStack: gen.json.meta.poolCounts.afterStack })}`);

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const t = await targetFor(user.id);
  console.log(`target     : kcal=${t.target.kcal} P ${t.target.proteinLo}-${t.target.proteinHi} F ${t.target.fatLo}-${t.target.fatHi} C ${t.target.carbLo}-${t.target.carbHi} keto=${!!t.target.keto}`);

  const audit = await auditPlanSafety(user.id, { walls: ['gluten', 'shellfish'], dietaryStyle: null, freeTextExclusions: [] });
  console.log(`raw slots  : ${audit.slotCount} filled, unresolved foodIds=${audit.unresolved.length}`);
  console.log(`LEAKS      : ${audit.leaks.length} (ingredient surface)  nameFlags=${audit.nameFlags.length}`);
  for (const l of audit.leaks.slice(0, 10)) console.log(`   ${l.wall || l.kind} <- "${l.name}" (${l.surface}) via "${l.term}" in ${l.recipe}`);

  const days = recomputeDays(audit.slots, audit.foods);
  let inTol = 0;
  for (const d of days) {
    const v = judgeDay(t.target, d);
    if (v.inTolerance) inTol++;
    const claimDrift = Math.abs(d.kcal - d.claimedKcal);
    console.log(`  day ${d.dayOfWeek}: mine ${Math.round(d.kcal)} kcal / ${Math.round(d.protein)}P  app-claimed ${Math.round(d.claimedKcal)} kcal (drift ${claimDrift.toFixed(1)})  inTol=${v.inTolerance} [k${v.kcalOk ? '+' : '-'} p${v.proteinOk ? '+' : '-'} f${v.fatOk ? '+' : '-'} c${v.carbOk ? '+' : '-'}]  warned=${d.warned}/${d.slots}`);
  }
  console.log(`my verdict : ${inTol}/${days.length} days in tolerance (app claimed ${gen.json?.meta?.score?.daysInTolerance}/${gen.json?.meta?.score?.totalDays})`);

  const c1 = await ledger();
  console.log(`ledger C1  : ${c1.rows} rows, $${c1.cost.toFixed(6)}  DELTA rows=${c1.rows - c0.rows} $${(c1.cost - c0.cost).toFixed(6)}`);

  writeJson('smoke-result.json', {
    runId: RUN_ID, port: PORT, email,
    login: mint, profileStatus: prof.status, droppedFields: dropped,
    generate: { status: gen.status, ms: gen.ms, slots: gen.json?.slots?.length ?? 0, meta: gen.json?.meta },
    target: t.target,
    myAudit: { slotCount: audit.slotCount, leaks: audit.leaks, unresolved: audit.unresolved.length, days, inTolerance: inTol },
    ledger: { c0, c1, deltaRows: c1.rows - c0.rows, deltaCost: c1.cost - c0.cost },
  });
  console.log('\nwrote smoke-result.json');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('SMOKE FAILED:', e && e.stack); try { await prisma.$disconnect(); } catch {} process.exitCode = 1; });
