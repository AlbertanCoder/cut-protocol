// D2-analyze2.mjs — order effects, closest-miss cost, day reconstruction.
import fs from "node:fs";
const [slotsPath, daysolvePath, daysPath] = process.argv.slice(2);
const rd = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const S = rd(slotsPath).filter((r) => r.won);
const DS = rd(daysolvePath).filter((r) => r.won);
const D = rd(daysPath);

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const med = (xs) => { if (!xs.length) return NaN; const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");

// ── rebuild days from slot telemetry, keyed by (persona, daySeq) ───────────
const keyOf = (r) => `${r.persona}#${r.daySeq}`;
const dayMap = new Map();
for (const r of S) {
  const k = keyOf(r);
  if (!dayMap.has(k)) dayMap.set(k, { persona: r.persona, daySeq: r.daySeq, slots: [], meals: r.meals, snacks: r.snacks, diet: r.diet, tier: r.tier, satisfiable: r.satisfiable });
  dayMap.get(k).slots.push(r);
}
const dsMap = new Map(DS.map((r) => [keyOf(r), r]));
const DAYS = [...dayMap.values()];
let joined = 0;
for (const d of DAYS) {
  const m = dsMap.get(keyOf(d));
  if (!m) continue;
  joined++;
  d.dt = m.dt; d.pre = m.pre; d.post = m.post; d.meta = m.meta;
}
console.log(`reconstructed ${DAYS.length} shipped day-solves; joined to day-solve telemetry: ${joined} (must equal ${DAYS.length})`);
// independent check: the sum of slot kcal must equal the day-solve's pre-closer total
const drift = DAYS.filter((d) => d.pre && Math.abs(d.slots.reduce((a, s) => a + (s.gotKcal || 0), 0) - d.pre.kcal) > 0.01).length;
console.log(`join integrity: day-solves whose slot sum != recorded pre-closer kcal: ${drift} (must be 0)`);

// ── 1. THE CLOSEST-MISS FALLBACK'S FAT COST ───────────────────────────────
console.log(`\n=========== 1. CLOSEST-MISS FALLBACK: THE FAT IT SPENDS ===========`);
const fatOverDays = DAYS.filter((d) => d.dt?.fHi != null && d.pre && d.pre.fat > d.dt.fHi);
console.log(`day-solves finishing above fatHi: ${fatOverDays.length} / ${DAYS.length} (${pct(fatOverDays.length, DAYS.length)})`);
let totalExcess = 0, excessFromCM = 0, excessFromOthers = 0, cmSlots = 0, otherSlots = 0;
for (const d of fatOverDays) {
  const excess = d.pre.fat - d.dt.fHi;
  totalExcess += excess;
  for (const s of d.slots) {
    const ask = s.fatTarget ?? s.fatShare ?? 0;
    const over = Math.max(0, (s.gotFat || 0) - ask);
    if (s.exit === "closestmiss") { excessFromCM += over; cmSlots++; } else { excessFromOthers += over; otherSlots++; }
  }
}
console.log(`  total fat excess over fatHi across those days: ${f1(totalExcess)} g`);
console.log(`  slot-level fat delivered ABOVE its own ask, summed:`);
console.log(`    from exit=closestmiss slots (${cmSlots} slots): ${f1(excessFromCM)} g  (${pct(excessFromCM, excessFromCM + excessFromOthers)} of all slot fat overage)`);
console.log(`    from every other exit    (${otherSlots} slots): ${f1(excessFromOthers)} g`);
console.log(`  closestmiss share of slots on those days: ${pct(cmSlots, cmSlots + otherSlots)}`);
const cmAll = S.filter((r) => r.exit === "closestmiss");
console.log(`  closestmiss mean fat over its own ask: ${f1(mean(cmAll.map((r) => r.gotFat - (r.fatTarget ?? r.fatShare ?? 0))))} g/slot`);
const nonCm = S.filter((r) => r.exit !== "closestmiss" && r.exit !== "unsolved");
console.log(`  every other filled exit:                ${f1(mean(nonCm.map((r) => r.gotFat - (r.fatTarget ?? r.fatShare ?? 0))))} g/slot`);

// ── 2. ORDER: same slot type, different position ──────────────────────────
console.log(`\n=========== 2. ORDER EFFECT (grouped by exact meal config) ===========`);
const cfgs = new Map();
for (const r of S) { const k = `${r.meals}m+${r.snacks}s`; if (!cfgs.has(k)) cfgs.set(k, []); cfgs.get(k).push(r); }
for (const [k, rs] of [...cfgs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
  console.log(`\n  config ${k}  (n=${rs.length} slots)`);
  console.log(`    pos  type   nom kcal  eff kcal  got kcal   err%   unsolved  closestmiss  pinned0.5x   fatErr%`);
  const maxPos = Math.max(...rs.map((r) => r.pos));
  for (let i = 0; i <= maxPos; i++) {
    const at = rs.filter((r) => r.pos === i);
    if (at.length < 15) continue;
    const err = at.map((r) => (r.gotKcal - r.nomKcal) / r.nomKcal * 100);
    const fatE = at.filter((r) => r.fatShare > 0).map((r) => (r.gotFat - (r.fatTarget ?? r.fatShare)) / r.fatShare * 100);
    console.log(`    ${String(i).padStart(3)}  ${at[0].slotType.padEnd(6)} ${f1(mean(at.map((r) => r.nomKcal))).padStart(9)} ${f1(mean(at.map((r) => r.effKcal))).padStart(9)} ${f1(mean(at.map((r) => r.gotKcal))).padStart(9)} ${f1(mean(err)).padStart(6)}  ${pct(at.filter((r) => r.exit === "unsolved").length, at.length).padStart(8)}  ${pct(at.filter((r) => r.exit === "closestmiss").length, at.length).padStart(11)}  ${pct(at.filter((r) => r.gotPS === 0.5 || r.gotSS === 0.5).length, at.length).padStart(10)}  ${f1(med(fatE)).padStart(8)}`);
  }
}

// ── 3. IS THE LAST SLOT WORSE BECAUSE IT IS LAST, OR BECAUSE IT IS SMALL? ──
console.log(`\n=========== 3. LAST-SLOT PENALTY, CONTROLLING FOR SIZE ===========`);
// bucket every shipped slot by its nominal kcal, then split last vs not-last
const buckets = [[0, 150], [150, 250], [250, 350], [350, 500], [500, 700], [700, 3000]];
console.log(`  nominal kcal    n(last)  unsolved%  cmiss%   |  n(other)  unsolved%  cmiss%`);
for (const [lo, hi] of buckets) {
  const inB = S.filter((r) => r.nomKcal >= lo && r.nomKcal < hi);
  const last = inB.filter((r) => r.pos === r.nOpen - 1);
  const other = inB.filter((r) => r.pos !== r.nOpen - 1);
  if (last.length < 20 || other.length < 20) continue;
  console.log(`  ${String(lo).padStart(4)}-${String(hi).padEnd(6)} ${String(last.length).padStart(9)} ${pct(last.filter((r) => r.exit === "unsolved").length, last.length).padStart(9)} ${pct(last.filter((r) => r.exit === "closestmiss").length, last.length).padStart(8)}   |  ${String(other.length).padStart(7)} ${pct(other.filter((r) => r.exit === "unsolved").length, other.length).padStart(9)} ${pct(other.filter((r) => r.exit === "closestmiss").length, other.length).padStart(8)}`);
}

// ── 4. SLOT SIZE vs FAILURE (the 0.5x floor) ──────────────────────────────
console.log(`\n=========== 4. SLOT SIZE vs OUTCOME (all shipped slots) ===========`);
console.log(`  nominal kcal      n    unsolved%   cmiss%   pinned0.5x%   pinned2.0x%   medFatErr%`);
for (const [lo, hi] of buckets) {
  const inB = S.filter((r) => r.nomKcal >= lo && r.nomKcal < hi);
  if (inB.length < 20) continue;
  const fatE = inB.filter((r) => r.fatShare > 0 && r.exit !== "unsolved").map((r) => (r.gotFat - (r.fatTarget ?? r.fatShare)) / r.fatShare * 100);
  console.log(`  ${String(lo).padStart(4)}-${String(hi).padEnd(6)} ${String(inB.length).padStart(7)} ${pct(inB.filter((r) => r.exit === "unsolved").length, inB.length).padStart(10)} ${pct(inB.filter((r) => r.exit === "closestmiss").length, inB.length).padStart(9)} ${pct(inB.filter((r) => r.gotPS === 0.5 || r.gotSS === 0.5).length, inB.length).padStart(13)} ${pct(inB.filter((r) => r.gotPS === 2 || r.gotSS === 2).length, inB.length).padStart(13)} ${f1(med(fatE)).padStart(12)}`);
}

// ── 5. degenerate targets ─────────────────────────────────────────────────
console.log(`\n=========== 5. DEGENERATE TARGETS ===========`);
console.log(`  slots with effKcal <= 0: ${S.filter((r) => !(r.effKcal > 0)).length}`);
console.log(`  slots with effProtein <= 0: ${S.filter((r) => !(r.effProtein > 0)).length}`);
console.log(`  min effKcal ${f1(Math.min(...S.map((r) => r.effKcal)))} · min nomKcal ${f1(Math.min(...S.map((r) => r.nomKcal)))}`);
console.log(`  slots where the day was ALREADY over budget when they were solved (achKcal > budgetKcal): ${S.filter((r) => r.achKcal > r.budgetKcal).length} (${pct(S.filter((r) => r.achKcal > r.budgetKcal).length, S.length)})`);
console.log(`  ... of those, how many still asked for >= 70% of nominal (clamp floor): ${S.filter((r) => r.achKcal > r.budgetKcal && Math.abs(r.effKcal - r.nomKcal * 0.7) < 1e-6).length}`);
const fatSpent = S.filter((r) => r.fatShare > 0 && r.achFat > r.budgetFat);
console.log(`  slots solved when the day's FAT budget was already spent (achFat > budgetFat): ${fatSpent.length} (${pct(fatSpent.length, S.length)})`);
console.log(`  ... their fatTarget: median ${f1(med(fatSpent.map((r) => r.fatTarget)))} g; fat actually delivered: median ${f1(med(fatSpent.map((r) => r.gotFat)))} g`);

// ── 6. how far into the day does the fat overshoot start? ─────────────────
console.log(`\n=========== 6. CUMULATIVE FAT PATH ON FAT-OVER DAYS ===========`);
const path = new Map();
for (const d of fatOverDays) {
  if (!d.dt?.fHi) continue;
  const fMid = (d.dt.fLo + d.dt.fHi) / 2;
  let cum = 0;
  d.slots.forEach((s, i) => {
    cum += s.gotFat || 0;
    const nomCum = d.slots.slice(0, i + 1).reduce((a, x) => a + (x.fatShare || 0), 0);
    if (!path.has(i)) path.set(i, []);
    path.get(i).push({ cum, nomCum, fMid, frac: cum / fMid });
  });
}
console.log(`  after slot #  n     mean cumulative fat   mean "should have"   ratio`);
for (const [i, rs] of [...path.entries()].sort((a, b) => a[0] - b[0])) {
  if (rs.length < 20) continue;
  console.log(`  ${String(i).padStart(12)}  ${String(rs.length).padStart(4)}  ${f1(mean(rs.map((r) => r.cum))).padStart(19)} g ${f1(mean(rs.map((r) => r.nomCum))).padStart(19)} g   ${(mean(rs.map((r) => r.cum)) / mean(rs.map((r) => r.nomCum))).toFixed(2)}`);
}
