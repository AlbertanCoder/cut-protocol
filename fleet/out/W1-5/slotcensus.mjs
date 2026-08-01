// W1-5 B/H — empty-slot census + F2 correlation, from the rig baseline records.
import fs from "node:fs";
const LINES = fs.readFileSync("fleet/out/W1-5/rig-baseline-s424242.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const T = JSON.parse(fs.readFileSync("fleet/out/W1-5/targets.json", "utf8"));
const byPersona = new Map(T.personas.map((p) => [p.id, p]));

let emptyMeal = 0, emptySnack = 0, totalMeal = 0, totalSnack = 0;
const emptyByDiet = {}, emptySnackByDiet = {};
const daysWithEmpty = new Set();
for (const d of LINES) {
  for (const s of d.slots || []) {
    const isEmpty = !s.recipeId;
    if (s.slotType === "snack") { totalSnack++; if (isEmpty) { emptySnack++; daysWithEmpty.add(d.dayKey); } }
    else { totalMeal++; if (isEmpty) { emptyMeal++; daysWithEmpty.add(d.dayKey); } }
    if (isEmpty) {
      emptyByDiet[d.dietStyle] = (emptyByDiet[d.dietStyle] || 0) + 1;
      if (s.slotType === "snack") emptySnackByDiet[d.dietStyle] = (emptySnackByDiet[d.dietStyle] || 0) + 1;
    }
  }
}
const emptyTotal = emptyMeal + emptySnack;

// snack-slot fill quality: fat density of what actually landed in snack slots
const snackFilled = [];
for (const d of LINES) for (const s of d.slots || []) if (s.slotType === "snack" && s.recipeId && s.kcal > 0) snackFilled.push(s);

// ── F2: correlation between demanded protein density and day-in-band ─────
const rows = [];
for (const d of LINES) {
  if (!d.judged) continue;
  const p = byPersona.get(d.personaId); if (!p) continue;
  rows.push({ x: p.demandedDensity, y: d.verdict?.inBand ? 1 : 0, gap: p.demandedDensity - p.poolP50 });
}
const pearson = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return num / Math.sqrt(dx * dy);
};
const r_density = pearson(rows.map((r) => r.x), rows.map((r) => r.y));
const r_gap = pearson(rows.map((r) => r.gap), rows.map((r) => r.y));

// quartile split on demanded density
const sorted = [...rows].sort((a, b) => a.x - b.x);
const qn = Math.floor(sorted.length / 4);
const bands = [0, 1, 2, 3].map((i) => {
  const seg = sorted.slice(i * qn, i === 3 ? sorted.length : (i + 1) * qn);
  return { q: i + 1, n: seg.length, minDensity: +seg[0].x.toFixed(2), maxDensity: +seg[seg.length - 1].x.toFixed(2), inBandPct: +((seg.filter((s) => s.y).length / seg.length) * 100).toFixed(1) };
});

// ── I2/F1: are the 250 personas expressible? (in-band achieved at least once) ──
const perPersona = new Map();
for (const d of LINES) { if (!d.judged) continue; const e = perPersona.get(d.personaId) || { days: 0, inBand: 0 }; e.days++; if (d.verdict?.inBand) e.inBand++; perPersona.set(d.personaId, e); }
const personasAllFail = [...perPersona.entries()].filter(([, v]) => v.inBand === 0);

const out = {
  dayRecords: LINES.length, judged: LINES.filter((d) => d.judged).length,
  inBand: LINES.filter((d) => d.verdict?.inBand).length,
  slots: { totalMeal, totalSnack, total: totalMeal + totalSnack },
  empty: { total: emptyTotal, meal: emptyMeal, snack: emptySnack, snackSharePct: +((emptySnack / (emptyTotal || 1)) * 100).toFixed(1) },
  snackSlotFillRate: +((1 - emptySnack / (totalSnack || 1)) * 100).toFixed(1),
  mealSlotFillRate: +((1 - emptyMeal / (totalMeal || 1)) * 100).toFixed(1),
  emptyByDiet, emptySnackByDiet,
  daysWithAnyEmptySlot: daysWithEmpty.size,
  snackSlotsFilled: snackFilled.length,
  F2: {
    n: rows.length,
    r_demandedDensity_vs_inBand: +r_density.toFixed(4),
    r_densityGapOverPoolP50_vs_inBand: +r_gap.toFixed(4),
    quartiles: bands,
  },
  F1: {
    personasWithZeroInBandDays: personasAllFail.length,
    personasWithAtLeastOneInBandDay: perPersona.size - personasAllFail.length,
    listZeroInBand: personasAllFail.map(([id, v]) => ({ id, days: v.days, diet: LINES.find((d) => d.personaId === id)?.dietStyle, tier: LINES.find((d) => d.personaId === id)?.tier })),
  },
};
fs.writeFileSync("fleet/out/W1-5/slotcensus.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
