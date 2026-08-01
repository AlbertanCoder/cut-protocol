// D2-analyze.mjs — aggregate the slot-loop telemetry.
// node D2-analyze.mjs <slots.jsonl> <daysolve.jsonl> <days.jsonl>
import fs from "node:fs";

const [slotsPath, daysolvePath, daysPath] = process.argv.slice(2);
const rd = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const S = rd(slotsPath);
const DS = rd(daysolvePath);
const D = rd(daysPath);

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const med = (xs) => { if (!xs.length) return NaN; const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const p = (xs, q) => { if (!xs.length) return NaN; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");

const W = S.filter((r) => r.won);        // slots on the SHIPPED week
const WD = DS.filter((r) => r.won);      // day-solves on the SHIPPED week

console.log(`\n================ SCOPE ================`);
console.log(`slot resolutions total ${S.length} · on the shipped week ${W.length} (${pct(W.length, S.length)})`);
console.log(`day solves total ${DS.length} · shipped ${WD.length}`);
console.log(`graded day records ${D.length} (judged ${D.filter((d) => d.judged).length})`);

// ── 1. exit paths ──────────────────────────────────────────────────────────
console.log(`\n================ 1. resolveSlot EXIT PATH ================`);
const byExit = new Map();
for (const r of W) byExit.set(r.exit || "NONE", (byExit.get(r.exit || "NONE") || 0) + 1);
for (const [k, v] of [...byExit].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(13)} ${String(v).padStart(6)}  ${pct(v, W.length)}`);
console.log(`  composed=true on ${pct(W.filter((r) => r.composed).length, W.length)} of shipped slots`);
console.log(`  twoPass (priorUsage armed) on ${pct(W.filter((r) => r.twoPass).length, W.length)}`);

// ── 2. search depth ────────────────────────────────────────────────────────
console.log(`\n================ 2. SEARCH DEPTH ================`);
const budgets = new Map();
for (const r of W) budgets.set(r.attemptBudget, (budgets.get(r.attemptBudget) || 0) + 1);
console.log(`  attemptBudget distribution: ${[...budgets].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
const exhausted = W.filter((r) => r.tried >= r.attemptBudget);
console.log(`  tried == attemptBudget (search exhausted, not satisfied): ${exhausted.length} / ${W.length} = ${pct(exhausted.length, W.length)}`);
console.log(`  mean tried ${f1(mean(W.map((r) => r.tried)))} · mean fits (composed, fitsort) ${f1(mean(W.filter((r) => r.exit === "fitsort").map((r) => r.fitsN)))}`);
const ge = W.filter((r) => r.exit === "goodenough");
console.log(`  good-enough early exits: ${ge.length} (${pct(ge.length, W.length)}); their mean tried ${f1(mean(ge.map((r) => r.tried)))}`);
const fs2 = W.filter((r) => r.exit === "fitsort");
console.log(`  fitsort: mean compBest ${f3(mean(fs2.map((r) => r.compBest)))} · median ${f3(med(fs2.map((r) => r.compBest)))} · share with compBest<=0.05 ${pct(fs2.filter((r) => r.compBest <= 0.05).length, fs2.length)}`);

// ── 3. carry-forward clamp ─────────────────────────────────────────────────
console.log(`\n================ 3. CARRY-FORWARD CLAMP (CARRY_CAP_PCT=0.3) ================`);
const EPS = 1e-9;
let cLoK = 0, cHiK = 0, cFreeK = 0, cLoP = 0, cHiP = 0, cFreeP = 0;
for (const r of W) {
  const lo = r.nomKcal * 0.7, hi = r.nomKcal * 1.3;
  if (r.propKcal < lo - EPS) cLoK++; else if (r.propKcal > hi + EPS) cHiK++; else cFreeK++;
  const plo = r.nomProtein * 0.7, phi = r.nomProtein * 1.3;
  if (r.propProtein < plo - EPS) cLoP++; else if (r.propProtein > phi + EPS) cHiP++; else cFreeP++;
}
console.log(`  kcal   : clamped DOWN-to-floor ${cLoK} (${pct(cLoK, W.length)}) · clamped UP-to-ceiling ${cHiK} (${pct(cHiK, W.length)}) · unclamped ${cFreeK} (${pct(cFreeK, W.length)})`);
console.log(`  protein: clamped DOWN-to-floor ${cLoP} (${pct(cLoP, W.length)}) · clamped UP-to-ceiling ${cHiP} (${pct(cHiP, W.length)}) · unclamped ${cFreeP} (${pct(cFreeP, W.length)})`);
console.log(`  (clamped DOWN = the day is ALREADY over and the loop was told to ask for less than 70% of the nominal share, but could not)`);
// how much correction was suppressed
const supp = W.filter((r) => r.propKcal < r.nomKcal * 0.7 - EPS).map((r) => r.nomKcal * 0.7 - r.propKcal);
console.log(`  kcal correction SUPPRESSED by the floor, per clamped slot: median ${f1(med(supp))} kcal · p90 ${f1(p(supp, 0.9))} · max ${f1(Math.max(0, ...supp))}`);

// ── 4. per-position behaviour ──────────────────────────────────────────────
console.log(`\n================ 4. SLOT POSITION ================`);
const byPos = new Map();
for (const r of W) { const k = `${r.pos}/${r.nOpen}`; (byPos.get(k) || byPos.set(k, []).get(k)).push(r); }
console.log(`  pos/n     n     type    nomKcal  effKcal   gotKcal  signedErr%  |  exit mix`);
for (const [k, rs] of [...byPos.entries()].sort()) {
  if (rs.length < 30) continue;
  const err = rs.map((r) => (r.gotKcal - r.nomKcal) / r.nomKcal * 100);
  const mix = {};
  for (const r of rs) mix[r.exit] = (mix[r.exit] || 0) + 1;
  const mixs = Object.entries(mix).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, b]) => `${a} ${pct(b, rs.length)}`).join(", ");
  console.log(`  ${k.padEnd(8)} ${String(rs.length).padStart(5)}  ${rs[0].slotType.padEnd(6)} ${f1(mean(rs.map((r) => r.nomKcal))).padStart(8)} ${f1(mean(rs.map((r) => r.effKcal))).padStart(8)} ${f1(mean(rs.map((r) => r.gotKcal))).padStart(9)} ${f1(mean(err)).padStart(10)}  |  ${mixs}`);
}

console.log(`\n  --- by slot TYPE (shipped slots) ---`);
for (const t of ["meal", "snack"]) {
  const rs = W.filter((r) => r.slotType === t);
  if (!rs.length) continue;
  const err = rs.map((r) => (r.gotKcal - r.nomKcal));
  const errP = rs.map((r) => (r.gotKcal - r.nomKcal) / r.nomKcal * 100);
  const overGate = rs.filter((r) => r.nomKcal > 0 && (r.gotKcal - r.effKcal) / r.effKcal > 0.15).length;
  const underGate = rs.filter((r) => r.nomKcal > 0 && (r.effKcal - r.gotKcal) / r.effKcal > 0.15).length;
  console.log(`  ${t.padEnd(6)} n=${rs.length} · mean nominal ${f1(mean(rs.map((r) => r.nomKcal)))} kcal · mean signed err ${f1(mean(err))} kcal (${f1(mean(errP))}%) · median ${f1(med(errP))}%`);
  console.log(`         slots landing >15% OVER their EFFECTIVE target: ${overGate} (${pct(overGate, rs.length)}) · >15% UNDER: ${underGate} (${pct(underGate, rs.length)})`);
  const pinLo = rs.filter((r) => r.gotPS === 0.5 || r.gotSS === 0.5).length;
  const pinHi = rs.filter((r) => r.gotPS === 2 || r.gotSS === 2).length;
  console.log(`         pinned at 0.5x: ${pct(pinLo, rs.length)} · pinned at 2.0x: ${pct(pinHi, rs.length)}`);
}

// ── 5. fat: what the gate never looks at ───────────────────────────────────
console.log(`\n================ 5. FAT AT THE SLOT ================`);
const cf = W.filter((r) => r.fatShare != null && r.fatShare > 0);
const fatErr = cf.map((r) => r.gotFat - (r.fatTarget ?? r.fatShare));
console.log(`  slots carrying a fat budget: ${cf.length} (${pct(cf.length, W.length)})`);
console.log(`  fat delivered minus fat asked-for: mean ${f1(mean(fatErr))} g · median ${f1(med(fatErr))} g · p90 ${f1(p(fatErr, 0.9))} · share OVER ${pct(fatErr.filter((x) => x > 0).length, fatErr.length)}`);
const fatErrRel = cf.map((r) => (r.gotFat - (r.fatTarget ?? r.fatShare)) / r.fatShare * 100);
console.log(`  as % of the slot's nominal fat share: mean ${f1(mean(fatErrRel))}% · median ${f1(med(fatErrRel))}%`);
for (const e of ["firstfit", "goodenough", "fitsort", "closestmiss"]) {
  const rs = cf.filter((r) => r.exit === e);
  if (!rs.length) continue;
  const fe = rs.map((r) => (r.gotFat - (r.fatTarget ?? r.fatShare)) / r.fatShare * 100);
  console.log(`    exit=${e.padEnd(12)} n=${String(rs.length).padStart(5)}  median fat error ${f1(med(fe)).padStart(7)}%  mean ${f1(mean(fe)).padStart(7)}%`);
}

// ── 6. the day: where does the overshoot come from ─────────────────────────
console.log(`\n================ 6. THE SHIPPED DAY ================`);
// join telemetry days to graded days: both are in persona order; use the graded record.
const overD = D.filter((d) => d.judged && !d.verdict.inBand);
console.log(`  graded days ${D.length}; misses ${overD.length}`);
let fatOver = 0, fatShort = 0, kcalOver = 0, kcalUnder = 0, carbOver = 0, carbShort = 0;
for (const d of overD) {
  if (d.verdict.fatOk === false) { if ((d.verdict.fatOverPct || 0) > 0) fatOver++; else fatShort++; }
  if (d.verdict.carbOk === false) { if ((d.verdict.carbOverPct || 0) > 0) carbOver++; else carbShort++; }
  if (d.verdict.kcalOk === false) { if (d.achieved.kcal > d.target.kcal) kcalOver++; else kcalUnder++; }
}
console.log(`  of the misses: fat OUT-of-band ${fatOver + fatShort} (over ${fatOver} / short ${fatShort}) · carb ${carbOver + carbShort} (over ${carbOver} / short ${carbShort}) · kcal ${kcalOver + kcalUnder} (over ${kcalOver} / under ${kcalUnder})`);

// day-level signed totals from the day-solve telemetry (pre-closer vs post)
const changed = WD.filter((r) => Math.abs(r.post.kcal - r.pre.kcal) > 0.01);
console.log(`  macro closer changed the day on ${changed.length} / ${WD.length} shipped day-solves (${pct(changed.length, WD.length)})`);
console.log(`    when it fired: median kcal added ${f1(med(changed.map((r) => r.post.kcal - r.pre.kcal)))} · fat ${f1(med(changed.map((r) => r.post.fat - r.pre.fat)))}g · never negative? ${changed.every((r) => r.post.kcal >= r.pre.kcal - 0.01)}`);
const dayFatOver = WD.filter((r) => r.dt.fHi != null && r.pre.fat > r.dt.fHi).length;
console.log(`  day-solves finishing the slot loop ABOVE fatHi: ${dayFatOver} / ${WD.length} = ${pct(dayFatOver, WD.length)}`);
const dayKcalOver = WD.filter((r) => r.pre.kcal > r.dt.kcal).length;
console.log(`  day-solves finishing the slot loop ABOVE the kcal target: ${dayKcalOver} / ${WD.length} = ${pct(dayKcalOver, WD.length)}`);

// ── 7. how much correction capacity does the loop have LEFT at each position?
console.log(`\n================ 7. RECOVERY CAPACITY ================`);
// at slot i, the maximum kcal the remaining slots can shed vs their nominal:
const byN = new Map();
for (const r of W) { const k = r.nOpen; (byN.get(k) || byN.set(k, []).get(k)).push(r); }
for (const [n, rs] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
  if (rs.length < 60) continue;
  const perPos = [];
  for (let i = 0; i < n; i++) {
    const at = rs.filter((r) => r.pos === i);
    if (!at.length) continue;
    perPos.push({ i, nom: mean(at.map((r) => r.nomKcal)) });
  }
  const totalNom = perPos.reduce((a, x) => a + x.nom, 0);
  const line = perPos.map((x, idx) => {
    const remain = perPos.slice(idx).reduce((a, y) => a + y.nom, 0);
    return `after#${idx}: ${f1(remain * 0.3)}`;
  }).join(" · ");
  console.log(`  nOpen=${n} (n=${rs.length}) day budget≈${f1(totalNom)} kcal · max remaining downward correction (0.3x nominal): ${line}`);
}

// ── 8. best-of-N week selection ────────────────────────────────────────────
console.log(`\n================ 8. WEEK ATTEMPTS ================`);
const attemptsSeen = new Map();
const winSeen = new Map();
const seenWindow = new Set();
for (const r of S) {
  const key = `${r.persona}#${r.windowSeq}`;
  attemptsSeen.set(key, Math.max(attemptsSeen.get(key) ?? 0, r.attempt + 1));
  if (r.won) winSeen.set(key, r.attempt);
  seenWindow.add(key);
}
const dist = new Map();
for (const [, v] of attemptsSeen) dist.set(v, (dist.get(v) || 0) + 1);
console.log(`  windows ${seenWindow.size} · attempts run distribution: ${[...dist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
const winDist = new Map();
for (const [, v] of winSeen) winDist.set(v, (winDist.get(v) || 0) + 1);
console.log(`  winning attempt index: ${[...winDist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
const multi = [...attemptsSeen.values()].filter((v) => v > 1).length;
console.log(`  windows that ran >1 attempt: ${multi} (${pct(multi, seenWindow.size)})`);
