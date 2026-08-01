// D2-check.mjs — integrity + mechanism check for an arm against the baseline.
// Re-derives everything from the day records; does NOT reuse compare.v2's logic.
// node D2-check.mjs base.jsonl arm.jsonl [armSlots.jsonl baseSlots.jsonl]
import fs from "node:fs";
const [bp, ap, aSlots, bSlots] = process.argv.slice(2);
const rd = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const B = rd(bp), A = rd(ap);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");

const key = (r) => `${r.personaId}#${r.windowIndex}#${r.dayOfWeek}`;
const bm = new Map(B.map((r) => [key(r), r]));
const pairs = A.map((r) => [bm.get(key(r)), r]).filter(([x]) => x);
console.log(`paired days: ${pairs.length} / ${A.length}`);

const tot = (rows, f) => sum(rows.map(f));
console.log(`\n--- DENOMINATOR (C21 self-scoring trap) ---`);
console.log(`  judged days     base ${B.filter((r) => r.judged).length}   arm ${A.filter((r) => r.judged).length}`);
console.log(`  planned days    base ${B.length}   arm ${A.length}`);
console.log(`  slots total     base ${tot(B, (r) => r.slotsTotal || 0)}   arm ${tot(A, (r) => r.slotsTotal || 0)}`);
console.log(`  slots FILLED    base ${tot(B, (r) => r.slotsFilled || 0)}   arm ${tot(A, (r) => r.slotsFilled || 0)}`);
console.log(`  UNFILLED slots  base ${tot(B, (r) => (r.slotsTotal || 0) - (r.slotsFilled || 0))}   arm ${tot(A, (r) => (r.slotsTotal || 0) - (r.slotsFilled || 0))}`);

console.log(`\n--- HONESTY ---`);
const warned = (rows) => sum(rows.map((r) => (r.slots || []).filter((s) => s.warning).length));
console.log(`  warned slots    base ${warned(B)}   arm ${warned(A)}`);
console.log(`  days with any warning   base ${B.filter((r) => r.honesty?.hasWarning).length}   arm ${A.filter((r) => r.honesty?.hasWarning).length}`);
const silent = (rows) => rows.filter((r) => r.judged && !r.verdict.inBand && r.honesty?.declared === false).length;
console.log(`  SILENT MISSES (out of band, no warning, no diagnosis)   base ${silent(B)}   arm ${silent(A)}`);

console.log(`\n--- MECHANISM: where the day landed ---`);
for (const [name, rows] of [["base", B], ["arm", A]]) {
  const j = rows.filter((r) => r.judged);
  const fatOver = j.filter((r) => r.verdict.fatOk === false && (r.verdict.fatOverPct || 0) > 0).length;
  const fatShort = j.filter((r) => r.verdict.fatOk === false && (r.verdict.fatShortPct || 0) > 0).length;
  const carbOver = j.filter((r) => r.verdict.carbOk === false && (r.verdict.carbOverPct || 0) > 0).length;
  const carbShort = j.filter((r) => r.verdict.carbOk === false && (r.verdict.carbShortPct || 0) > 0).length;
  const kOver = j.filter((r) => r.verdict.kcalOk === false && r.achieved.kcal > r.target.kcal).length;
  const kUnder = j.filter((r) => r.verdict.kcalOk === false && r.achieved.kcal <= r.target.kcal).length;
  const pShort = j.filter((r) => r.verdict.proteinOk === false).length;
  console.log(`  ${name.padEnd(5)} fatOver ${String(fatOver).padStart(3)} fatShort ${String(fatShort).padStart(3)} · carbOver ${String(carbOver).padStart(3)} carbShort ${String(carbShort).padStart(3)} · kcalOver ${String(kOver).padStart(3)} kcalUnder ${String(kUnder).padStart(3)} · proteinShort ${String(pShort).padStart(3)}`);
  // independent day-level fat excess in grams over fatHi
  const excess = sum(j.filter((r) => r.target.fatHi && r.achieved.fat > r.target.fatHi).map((r) => r.achieved.fat - r.target.fatHi));
  console.log(`        total fat delivered ABOVE fatHi across judged days: ${f1(excess)} g over ${j.filter((r) => r.target.fatHi && r.achieved.fat > r.target.fatHi).length} days`);
}

console.log(`\n--- PORTION PINNING (A2's 0.5x floor) ---`);
for (const [name, rows] of [["base", B], ["arm", A]]) {
  const all = rows.flatMap((r) => r.slots || []).filter((s) => s.recipeId != null);
  console.log(`  ${name.padEnd(5)} filled slots ${all.length} · pinned at 0.5x ${pct(all.filter((s) => s.pinnedLo).length, all.length)} · pinned at 2.0x ${pct(all.filter((s) => s.pinnedHi).length, all.length)}`);
}

console.log(`\n--- WHO MOVED (slice by snacks/day) ---`);
const bySn = new Map();
for (const [b, a] of pairs) {
  if (!b.judged || !a.judged) continue;
  const k = b.snacksPerDay;
  if (!bySn.has(k)) bySn.set(k, { n: 0, bIn: 0, aIn: 0, b2: 0, c2: 0 });
  const o = bySn.get(k); o.n++;
  if (b.verdict.inBand) o.bIn++; if (a.verdict.inBand) o.aIn++;
  if (b.verdict.inBand && !a.verdict.inBand) o.b2++;
  if (!b.verdict.inBand && a.verdict.inBand) o.c2++;
}
console.log(`  snacks/day   days   base in-band   arm in-band   delta pts   b(lost)  c(gained)`);
for (const [k, o] of [...bySn.entries()].sort((x, y) => x[0] - y[0])) {
  console.log(`  ${String(k).padStart(9)}  ${String(o.n).padStart(5)}   ${pct(o.bIn, o.n).padStart(10)}   ${pct(o.aIn, o.n).padStart(10)}   ${(((o.aIn - o.bIn) / o.n) * 100).toFixed(2).padStart(9)}   ${String(o.b2).padStart(7)}  ${String(o.c2).padStart(8)}`);
}

console.log(`\n--- WHO MOVED (slice by diet) ---`);
const byD = new Map();
for (const [b, a] of pairs) {
  if (!b.judged || !a.judged) continue;
  const k = b.dietStyle;
  if (!byD.has(k)) byD.set(k, { n: 0, bIn: 0, aIn: 0 });
  const o = byD.get(k); o.n++;
  if (b.verdict.inBand) o.bIn++; if (a.verdict.inBand) o.aIn++;
}
for (const [k, o] of [...byD.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${k.padEnd(15)} n=${String(o.n).padStart(4)}  ${pct(o.bIn, o.n).padStart(7)} -> ${pct(o.aIn, o.n).padStart(7)}   ${(((o.aIn - o.bIn) / o.n) * 100).toFixed(2).padStart(7)} pts`);
}

if (aSlots && bSlots) {
  console.log(`\n--- SLOT-LOOP TELEMETRY (shipped slots only) ---`);
  for (const [name, p] of [["base", bSlots], ["arm", aSlots]]) {
    const S = rd(p).filter((r) => r.won);
    const mix = {};
    for (const r of S) mix[r.exit] = (mix[r.exit] || 0) + 1;
    const cf = S.filter((r) => r.fatShare > 0);
    const fatOverAsk = sum(cf.map((r) => Math.max(0, (r.gotFat || 0) - (r.fatTarget ?? r.fatShare))));
    console.log(`  ${name.padEnd(5)} slots ${S.length} · ${Object.entries(mix).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pct(v, S.length)}`).join(" · ")}`);
    console.log(`        total fat delivered above each slot's own ask: ${f1(fatOverAsk)} g`);
  }
}
