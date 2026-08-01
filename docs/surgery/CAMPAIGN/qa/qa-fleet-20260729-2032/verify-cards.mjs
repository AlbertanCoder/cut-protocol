/**
 * verify-cards.mjs — every deep-dive card is checked against the database before
 * it is allowed to count.
 *
 * WHY THIS EXISTS: the first Phase-4 card scored the app 1/10 with six pork leaks
 * and a cross-account data leak. All of it was real text about the WRONG ACCOUNT —
 * two concurrent agents shared a cookie-jar filename (HARNESS-INCIDENT.md). A
 * confident, richly-evidenced, entirely misattributed safety report is the
 * characteristic failure of agent-driven testing, so no card is trusted on its own
 * word again.
 *
 * For each card this asserts, against raw rows for THAT persona's user id:
 *   · schema — the nine required keys, criteria in 1..10
 *   · identity — the meal/snack shape and targetKcal the card argues from must be
 *     the persona's own. A card reasoning about someone else's plan shows up here.
 *   · leak claims — any ingredient the card calls a leak is re-tested with the
 *     fleet's own matcher against the persona's real walls, so an INFERENCE about a
 *     composite food ("jerky is usually soy-marinated") is separated from a NAMED
 *     banned ingredient. Only the latter can move the safety headline.
 *
 *   node verify-cards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma, HOME, RUN_ID, readLines, writeJson, nameCarries, nameCarriesTerm, WALLS } from './lib.mjs';

const REQUIRED = ['personaId', 'satisfaction', 'wouldRecommend', 'criteria', 'allergenRespect', 'delights', 'defects', 'followUp', 'verdict'];
const CRITERIA = ['macrosInRange', 'worksEndToEnd', 'mealsAreGood', 'affordableAdjustable', 'tasty'];

const personas = new Map(readLines('personas.jsonl').map((p) => [p.id, p]));
const cardDir = path.join(HOME, 'cards');
const files = fs.readdirSync(cardDir).filter((f) => /^card-p\d+\.json$/.test(f)).sort();

const out = [];
for (const f of files) {
  const id = f.match(/p\d+/)[0];
  const p = personas.get(id);
  const r = { id, file: f, ok: true, problems: [], notes: [] };

  let c = null;
  try { c = JSON.parse(fs.readFileSync(path.join(cardDir, f), 'utf8')); }
  catch (e) { r.ok = false; r.problems.push(`malformed JSON: ${e.message}`); out.push(r); continue; }

  // ── schema ──────────────────────────────────────────────────────────────
  for (const k of REQUIRED) if (!(k in c)) r.problems.push(`missing key "${k}"`);
  for (const k of CRITERIA) {
    const v = c.criteria?.[k];
    if (!Number.isInteger(v) || v < 1 || v > 10) r.problems.push(`criteria.${k} = ${JSON.stringify(v)} (want integer 1-10)`);
  }
  if (!Number.isInteger(c.satisfaction) || c.satisfaction < 1 || c.satisfaction > 10) r.problems.push(`satisfaction = ${JSON.stringify(c.satisfaction)}`);
  if (typeof c.wouldRecommend !== 'boolean') r.problems.push('wouldRecommend not boolean');
  if (c.personaId !== id) r.problems.push(`personaId "${c.personaId}" != filename ${id}`);

  // ── identity: is this card arguing about its OWN account? ───────────────
  const user = await prisma.user.findUnique({ where: { email: `qa-fleet-${RUN_ID}-${id}@fleet.local` }, select: { id: true } });
  if (!user) { r.problems.push('no such fleet user'); out.push(r); r.ok = r.problems.length === 0; continue; }
  const prof = await prisma.profile.findUnique({ where: { userId: user.id } });
  const slots = await prisma.planSlot.findMany({
    where: { plan: { userId: user.id } },
    select: { slotType: true, recipeId: true, ingredients: true, kcal: true, warning: true, recipe: { select: { name: true } } },
  });
  const snackSlots = slots.filter((s) => s.slotType === 'snack').length;
  r.truth = {
    userId: user.id, targetKcal: prof?.targetKcal, mealsPerDay: prof?.mealsPerDay, snacksPerDay: prof?.snacksPerDay,
    dietaryStyle: prof?.dietaryStyle, excludedFoods: prof?.excludedFoods,
    slots: slots.length, filled: slots.filter((s) => s.recipeId).length, snackSlots,
  };
  if (c.sessionCrossed === true) r.problems.push('agent self-reported sessionCrossed:true');

  // A card that quotes a targetKcal or a snack count that is not this persona's is
  // reasoning about another account — the exact signature of the jar collision.
  const blob = JSON.stringify(c);
  const quotedTargets = [...blob.matchAll(/target(?:Kcal)?["':\s]+(\d{3,4})/gi)].map((m) => Number(m[1]));
  const wrongTarget = quotedTargets.filter((v) => Math.abs(v - (prof?.targetKcal ?? -1)) > 2);
  if (prof && quotedTargets.length && wrongTarget.length === quotedTargets.length) {
    r.problems.push(`every targetKcal quoted (${[...new Set(quotedTargets)].join(', ')}) differs from this persona's ${prof.targetKcal} — possible cross-account reasoning`);
  }
  if (prof?.snacksPerDay === 0 && /\bsnack/i.test(blob) && snackSlots === 0 && /snack slot/i.test(blob)) {
    r.notes.push('card mentions snack slots; this persona has none — check it is not another account');
  }

  // ── leak claims: NAMED banned ingredient vs INFERENCE ───────────────────
  const walls = p?.walls || [];
  const claimed = (c.allergenRespect?.leaks || []).filter((x) => typeof x === 'string');
  r.leakClaims = { count: claimed.length, confirmedNamed: [], inferenceOnly: [] };
  // the ingredient names actually shipped to this persona, from raw rows
  const shipped = new Set();
  for (const s of slots) for (const ing of (s.ingredients || [])) if (ing?.name) shipped.add(String(ing.name));
  const foodRows = shipped.size
    ? await prisma.food.findMany({ where: { name: { in: [...shipped] } }, select: { name: true } })
    : [];
  const shippedNames = new Set(foodRows.map((x) => x.name).concat([...shipped]));

  for (const claim of claimed) {
    // Does any REAL shipped ingredient name in this claim actually carry a wall?
    let hit = null;
    for (const nm of shippedNames) {
      if (!claim.toLowerCase().includes(nm.toLowerCase())) continue;
      for (const w of walls) {
        const t = nameCarries(nm, w);
        if (t) { hit = { ingredient: nm, wall: w, term: t }; break; }
      }
      if (hit) break;
    }
    if (hit) r.leakClaims.confirmedNamed.push({ claim: claim.slice(0, 110), ...hit });
    else r.leakClaims.inferenceOnly.push(claim.slice(0, 160));
  }
  if (c.allergenRespect?.ok === false && r.leakClaims.confirmedNamed.length === 0) {
    r.notes.push('allergenRespect.ok=false but NO named shipped ingredient carries a declared wall — inference about composite foods (report as D4, not as a leak)');
  }
  if (c.allergenRespect?.ok === false && r.leakClaims.confirmedNamed.length > 0 && c.satisfaction !== 1) {
    r.problems.push(`confirmed named leak but satisfaction ${c.satisfaction} (the precondition says 1)`);
  }
  r.ok = r.problems.length === 0;
  out.push(r);
}

writeJson('card-verification.json', {
  runId: RUN_ID, checked: out.length,
  passed: out.filter((x) => x.ok).length,
  failed: out.filter((x) => !x.ok).map((x) => ({ id: x.id, problems: x.problems })),
  namedLeakClaims: out.flatMap((x) => x.leakClaims?.confirmedNamed?.map((y) => ({ id: x.id, ...y })) || []),
  inferenceOnlyClaims: out.flatMap((x) => (x.leakClaims?.inferenceOnly || []).map((y) => ({ id: x.id, claim: y }))),
  cards: out,
});

console.log(`== CARD VERIFICATION ==  ${out.filter((x) => x.ok).length}/${out.length} pass schema+identity`);
for (const x of out) {
  const flag = x.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${flag} ${x.id}  leakClaims=${x.leakClaims?.count ?? 0} (named ${x.leakClaims?.confirmedNamed?.length ?? 0} / inference ${x.leakClaims?.inferenceOnly?.length ?? 0})  target=${x.truth?.targetKcal} slots=${x.truth?.filled}/${x.truth?.slots}`);
  for (const pr of x.problems) console.log(`        ! ${pr}`);
  for (const n of x.notes) console.log(`        · ${n}`);
}
await prisma.$disconnect();
