// decompose.mjs — W3-1. The mechanics behind the ruler table. RE-SCORING ONLY.
//
//   node fleet/out/W3-1/decompose.mjs <dump.jsonl> [...] --json=fleet/out/W3-1/decompose.json
//
// Produces, on the canonical denominator (satisfiable-planned − degenerate, n=553):
//   1. %E FRONTIER      — fat ceiling swept 25…60 %E. Where does a nutritionally
//                         anchored ceiling break even, and at what %E?
//   2. TERM ATTRIBUTION — for every b (day A passes, treatment fails) and c
//                         (day A fails, treatment passes), WHICH macro term did it.
//   3. NUTRITIONAL AUDIT of each ruler's COMPLIANT set (not just its rescues):
//                         days graded compliant above AMDR 35%E fat, below the
//                         engine's own 0.30*lbm fat floor, below 50 g carb.
//   4. DOUBLE-COUNT MAP — the ruler-eligible days cross-tabbed by the solver's
//                         own bindingMissKey / missSide, so W3-2 / W3-4's levers
//                         and any ruler change cannot both bank the same day.
//   5. C9 IMPLICIT-CEILING variants — four defensible formulas, so the
//                         19%-vs-90% comparison does not rest on one arithmetic
//                         choice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PERSONAS = path.join(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");
const KG2LB = 2.20462, ASSUMED = { M: 21, F: 28 }, EFAT = 0.3, CARB50 = 50;

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

const LBM = new Map();
for (const p of readJsonl(PERSONAS)) {
  const pr = p.profile, bf = pr.bodyFatPct ?? 0, known = bf != null && bf > 0;
  const use = known ? bf : (pr.sex === "F" ? ASSUMED.F : ASSUMED.M);
  LBM.set(p.id, { lbmLb: pr.startWeightKg * KG2LB * (1 - use / 100), sex: pr.sex, bfAssumed: !known });
}

const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;
const pMidOf = (t) => (Number.isFinite(t.proteinMid) ? t.proteinMid : (t.proteinLo + t.proteinHi) / 2);
const fatMidOf = (t) => (t.fatLo + t.fatHi) / 2;
const carbMidOf = (t) => (Number.isFinite(t.carbMid) ? t.carbMid : (t.carbLo + t.carbHi) / 2);
const kcalOk = (t, a) => (t.kcal > 0 ? Math.abs((a.kcal - t.kcal) / t.kcal) <= 0.15 : false);
const protOk = (t, a) => { const p = pMidOf(t); return p > 0 ? Math.max(0, (p - a.protein) / p) <= 0.15 : true; };

/** Every ruler as four INDEPENDENT term booleans so b/c can be attributed. */
function terms(spec, r) {
  const t = r.target, a = r.achieved, L = LBM.get(r.personaId);
  const fm = fatMidOf(t), cm = carbMidOf(t), ef = Math.round(L.lbmLb * EFAT);
  const o = { kcal: kcalOk(t, a), protein: protOk(t, a), fatLo: true, fatHi: true, carbLo: true, carbHi: true };
  // fat floor
  if (spec.fatFloor === "A") o.fatLo = !hasBand(t.fatLo, t.fatHi) || a.fat >= t.fatLo - 0.25 * fm;
  else if (spec.fatFloor === "Awide") o.fatLo = !hasBand(t.fatLo, t.fatHi) || a.fat >= t.fatLo - 0.5 * fm;
  else if (spec.fatFloor === "essential") o.fatLo = a.fat >= ef;
  else if (spec.fatFloor === "none") o.fatLo = true;
  // fat ceiling
  if (spec.fatCeil === "A") o.fatHi = !hasBand(t.fatLo, t.fatHi) || a.fat <= t.fatHi + 0.25 * fm;
  else if (spec.fatCeil === "Awide") o.fatHi = !hasBand(t.fatLo, t.fatHi) || a.fat <= t.fatHi + 0.5 * fm;
  else if (typeof spec.fatCeil === "number") o.fatHi = a.fat <= (spec.fatCeil * t.kcal) / 9;
  else if (spec.fatCeil && spec.fatCeil.pctE != null) {
    // %E ceiling with a KETO CARVE-OUT. A ketogenic target puts fat at
    // ~65%E BY CONSTRUCTION (fat fills the balance after a 25 g carb target),
    // so any AMDR/Helms %E ceiling is categorically incompatible with keto.
    // Keto keeps whatever `spec.fatCeil.keto` says instead.
    if (t.keto) {
      if (spec.fatCeil.keto === "A") o.fatHi = !hasBand(t.fatLo, t.fatHi) || a.fat <= t.fatHi + 0.25 * fm;
      else o.fatHi = true;
    } else o.fatHi = a.fat <= (spec.fatCeil.pctE * t.kcal) / 9;
  } else o.fatHi = true;
  // carb floor
  if (spec.carbFloor === "A") o.carbLo = !hasBand(t.carbLo, t.carbHi) || a.carb >= t.carbLo - 0.25 * cm;
  else if (spec.carbFloor === "carbLo") o.carbLo = Number.isFinite(t.carbLo) ? a.carb >= t.carbLo : true;
  else if (spec.carbFloor === "repair50") o.carbLo = !hasBand(t.carbLo, t.carbHi) || a.carb >= (t.keto ? t.carbLo - 0.25 * cm : Math.max(t.carbLo - 0.25 * cm, CARB50));
  else if (spec.carbFloor === "carbLo50") o.carbLo = a.carb >= (t.keto ? (t.carbLo ?? 0) : Math.max(t.carbLo ?? 0, CARB50));
  else o.carbLo = true;
  // carb ceiling
  if (spec.carbCeil === "A") o.carbHi = !hasBand(t.carbLo, t.carbHi) || a.carb <= t.carbHi + (t.keto ? 0 : 0.25) * cm;
  else if (spec.carbCeil === "ketoOnly") o.carbHi = !t.keto || !Number.isFinite(t.carbHi) || a.carb <= t.carbHi;
  else o.carbHi = true;
  o.inBand = o.kcal && o.protein && o.fatLo && o.fatHi && o.carbLo && o.carbHi;
  return o;
}

const SPECS = {
  A: { fatFloor: "A", fatCeil: "A", carbFloor: "A", carbCeil: "A" },
  B: { fatFloor: "essential", fatCeil: "none", carbFloor: "A", carbCeil: "A" },
  C: { fatFloor: "A", fatCeil: "A", carbFloor: "carbLo", carbCeil: "ketoOnly" },
  D: { fatFloor: "essential", fatCeil: "none", carbFloor: "carbLo", carbCeil: "ketoOnly" },
  E35: { fatFloor: "A", fatCeil: 0.35, carbFloor: "A", carbCeil: "A" },
  E30: { fatFloor: "A", fatCeil: 0.30, carbFloor: "A", carbCeil: "A" },
  F: { fatFloor: "A", fatCeil: "A", carbFloor: "repair50", carbCeil: "A" },
  R35: { fatFloor: "essential", fatCeil: 0.35, carbFloor: "carbLo50", carbCeil: "ketoOnly" },
  R30: { fatFloor: "essential", fatCeil: 0.30, carbFloor: "carbLo50", carbCeil: "ketoOnly" },
  A15: { fatFloor: "Awide", fatCeil: "Awide", carbFloor: "A", carbCeil: "A" },
  Z: { fatFloor: "none", fatCeil: "none", carbFloor: "none", carbCeil: "none" },
  // ablation of R35, one term at a time reverted to A
  "R35~fatFloorA": { fatFloor: "A", fatCeil: 0.35, carbFloor: "carbLo50", carbCeil: "ketoOnly" },
  "R35~noFatCeil": { fatFloor: "essential", fatCeil: "none", carbFloor: "carbLo50", carbCeil: "ketoOnly" },
  "R35~carbFloorA": { fatFloor: "essential", fatCeil: 0.35, carbFloor: "A", carbCeil: "ketoOnly" },
  "R35~carbCeilA": { fatFloor: "essential", fatCeil: 0.35, carbFloor: "carbLo50", carbCeil: "A" },
};
// KETO-EXEMPT variants — the correction E35/R35 provably need.
SPECS.E35k = { fatFloor: "A", fatCeil: { pctE: 0.35, keto: "A" }, carbFloor: "A", carbCeil: "A" };
SPECS.R35k = { fatFloor: "essential", fatCeil: { pctE: 0.35, keto: "A" }, carbFloor: "carbLo50", carbCeil: "ketoOnly" };
SPECS.R30k = { fatFloor: "essential", fatCeil: { pctE: 0.30, keto: "A" }, carbFloor: "carbLo50", carbCeil: "ketoOnly" };
// RECOMMENDED, PRICED: keto-exempt %E ceiling at the measured break-even,
// essential-fat floor, carb floor repaired to 50 g, non-keto carb ceiling kept
// (dropping it is what makes vegetarian look good and is a separate decision).
SPECS.R40k = { fatFloor: "essential", fatCeil: { pctE: 0.40, keto: "A" }, carbFloor: "carbLo50", carbCeil: "ketoOnly" };
SPECS["R40k+carbCeil"] = { fatFloor: "essential", fatCeil: { pctE: 0.40, keto: "A" }, carbFloor: "carbLo50", carbCeil: "A" };
SPECS["R35k+carbCeil"] = { fatFloor: "essential", fatCeil: { pctE: 0.35, keto: "A" }, carbFloor: "carbLo50", carbCeil: "A" };
// %E frontier: A's floor + A's carb band, fat ceiling swept
for (const e of [25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 55, 60]) {
  SPECS[`Efrontier:${e}`] = { fatFloor: "A", fatCeil: e / 100, carbFloor: "A", carbCeil: "A" };
  SPECS[`Rfrontier:${e}`] = { fatFloor: "essential", fatCeil: e / 100, carbFloor: "carbLo50", carbCeil: "ketoOnly" };
  SPECS[`EKfrontier:${e}`] = { fatFloor: "A", fatCeil: { pctE: e / 100, keto: "A" }, carbFloor: "A", carbCeil: "A" };
  SPECS[`RKfrontier:${e}`] = { fatFloor: "essential", fatCeil: { pctE: e / 100, keto: "A" }, carbFloor: "carbLo50", carbCeil: "ketoOnly" };
}

const TERMKEYS = ["kcal", "protein", "fatLo", "fatHi", "carbLo", "carbHi"];

function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
  const out = { tool: "fleet/out/W3-1/decompose.mjs", agent: "W3-1", generatedAt: new Date().toISOString(), denominator: "satisfiable-planned-minus-degenerate", runs: [] };
  const lines = [];

  for (const f of files) {
    const all = readJsonl(path.resolve(f));
    const h = all[0].run;
    const rows = all.filter((r) => r.satisfiable !== false && !r.degenerate);
    const n = rows.length;
    const T = {};
    for (const [id, spec] of Object.entries(SPECS)) T[id] = rows.map((r) => terms(spec, r));

    // ── 1+2. per-ruler: level, b/c, and TERM ATTRIBUTION of every b and c ──
    const perRuler = {};
    for (const [id] of Object.entries(SPECS)) {
      if (id === "A") continue;
      let b = 0, c = 0, k = 0;
      const bWhy = {}, cWhy = {};
      for (let i = 0; i < n; i++) {
        const a = T.A[i], x = T[id][i];
        if (x.inBand) k++;
        if (a.inBand && !x.inBand) { b++; const w = TERMKEYS.filter((tk) => a[tk] && !x[tk]).join("+") || "(none)"; bWhy[w] = (bWhy[w] || 0) + 1; }
        if (!a.inBand && x.inBand) { c++; const w = TERMKEYS.filter((tk) => !a[tk] && x[tk]).join("+") || "(none)"; cWhy[w] = (cWhy[w] || 0) + 1; }
      }
      perRuler[id] = { k, n, pct: r2((k / n) * 100), b, c, net: c - b, netPts: r2(((c - b) / n) * 100), a5Floor: r2(1.96 * Math.sqrt(b + c)), clearsA5: Math.abs(c - b) > 1.96 * Math.sqrt(b + c), bAttribution: bWhy, cAttribution: cWhy };
    }
    perRuler.A = { k: T.A.filter((x) => x.inBand).length, n, pct: r2((T.A.filter((x) => x.inBand).length / n) * 100) };

    // ── 3. NUTRITIONAL AUDIT of each ruler's COMPLIANT set ────────────────
    const audit = {};
    for (const [id] of Object.entries(SPECS)) {
      if (/frontier/.test(id)) continue;
      const pass = rows.filter((_, i) => T[id][i].inBand);
      audit[id] = {
        compliantDays: pass.length,
        aboveAMDR35pctEfat: pass.filter((r) => r.achieved.fat > (0.35 * r.target.kcal) / 9).length,
        aboveHelms30pctEfat: pass.filter((r) => r.achieved.fat > (0.30 * r.target.kcal) / 9).length,
        belowEssentialFat030lbm: pass.filter((r) => r.achieved.fat < Math.round(LBM.get(r.personaId).lbmLb * EFAT)).length,
        belowNonKetoCarb50: pass.filter((r) => !r.target.keto && r.achieved.carb < CARB50).length,
        ketoAboveCarbCeiling: pass.filter((r) => r.target.keto && r.achieved.carb > r.target.carbHi).length,
        medianFatPctE: r2(med(pass.map((r) => (r.achieved.fat * 9) / r.target.kcal)) * 100),
        p90FatPctE: r2([...pass.map((r) => (r.achieved.fat * 9) / r.target.kcal)].sort((x, y) => x - y)[Math.round(0.9 * (pass.length - 1))] * 100),
      };
    }

    // ── 4. DOUBLE-COUNT MAP: ruler-eligible days by the solver's own key ──
    const eligible = rows.filter((_, i) => !T.A[i].inBand && T.Z[i].inBand);
    const irreducible = rows.filter((_, i) => !T.A[i].inBand && !T.Z[i].inBand);
    const byKey = {}, bySide = {};
    for (const r of eligible) { byKey[r.bindingMissKey ?? "?"] = (byKey[r.bindingMissKey ?? "?"] || 0) + 1; bySide[r.missSide ?? "?"] = (bySide[r.missSide ?? "?"] || 0) + 1; }
    const irrByKey = {};
    for (const r of irreducible) irrByKey[r.bindingMissKey ?? "?"] = (irrByKey[r.bindingMissKey ?? "?"] || 0) + 1;
    // how much headroom is LEFT for solver levers after each candidate ruler
    const headroom = {};
    for (const id of ["A", "B", "D", "E35", "E35k", "F", "R35", "R35k", "R40k", "R40k+carbCeil", "A15"]) headroom[id] = { levelPct: r2((T[id].filter((x) => x.inBand).length / n) * 100), remainingGapPts: r2(100 - (T[id].filter((x) => x.inBand).length / n) * 100), remainingDays: n - T[id].filter((x) => x.inBand).length };

    // ── 5. C9 implicit-ceiling variants, per persona ──────────────────────
    const seen = new Set(); const V = { v1: [], v2: [], v3: [], v4: [], wide: [] };
    for (const r of rows) {
      if (seen.has(r.personaId)) continue; seen.add(r.personaId);
      const t = r.target, fm = fatMidOf(t), cm = carbMidOf(t), pM = pMidOf(t);
      const eA = t.fatHi + 0.25 * fm;
      V.wide.push((t.fatHi + 0.5 * fm) / eA);
      // v1 kcalHi 1.15tk, protein at 0.85pMid, carb at carbLo          (Ruler D exact)
      V.v1.push(((1.15 * t.kcal - 0.85 * pM * 4 - (t.carbLo ?? 0) * 4) / 9) / eA);
      // v2 kcalHi 1.15tk, protein at pMid, carb at carbLo             (conservative)
      V.v2.push(((1.15 * t.kcal - pM * 4 - (t.carbLo ?? 0) * 4) / 9) / eA);
      // v3 kcalHi 1.15tk, protein at 0.85pMid, carb at graded A floor (loosest)
      V.v3.push(((1.15 * t.kcal - 0.85 * pM * 4 - Math.max(0, t.carbLo - 0.25 * cm) * 4) / 9) / eA);
      // v4 kcal at nominal tk, protein at 0.85pMid, carb at carbLo    (no kcal slack)
      V.v4.push(((t.kcal - 0.85 * pM * 4 - (t.carbLo ?? 0) * 4) / 9) / eA);
    }
    const c9v = { personas: seen.size, wide50_over_A: r4(med(V.wide)), implicit_v1_kcalHi_prot085_carbLo: r4(med(V.v1)), implicit_v2_kcalHi_protMid_carbLo: r4(med(V.v2)), implicit_v3_kcalHi_prot085_gradedCarbFloor: r4(med(V.v3)), implicit_v4_kcalNominal_prot085_carbLo: r4(med(V.v4)) };

    // ── per-diet for the decision-relevant arms ──────────────────────────
    const diets = [...new Set(rows.map((r) => r.dietStyle ?? "null"))].sort();
    const perDiet = {};
    for (const dt of diets) {
      const idx = rows.map((r, i) => ((r.dietStyle ?? "null") === dt ? i : -1)).filter((i) => i >= 0);
      perDiet[dt] = { days: idx.length, personas: new Set(idx.map((i) => rows[i].personaId)).size };
      for (const id of ["A", "B", "C", "D", "E35", "E35k", "E30", "F", "R35", "R35k", "R40k", "R40k+carbCeil", "R30", "A15", "Z"]) {
        const k = idx.filter((i) => T[id][i].inBand).length;
        let b = 0, c = 0;
        for (const i of idx) { if (T.A[i].inBand && !T[id][i].inBand) b++; if (!T.A[i].inBand && T[id][i].inBand) c++; }
        perDiet[dt][id] = { k, pct: idx.length ? r2((k / idx.length) * 100) : null, b, c, net: c - b };
      }
    }

    out.runs.push({ file: path.relative(REPO, path.resolve(f)).replace(/\\/g, "/"), run: { seed: h.seed, poolShape: h.poolShape, brain: h.brain, dbSha256: h.dbSha256 }, n, perRuler, audit, doubleCount: { rulerEligibleDays: eligible.length, solverIrreducibleDays: irreducible.length, eligibleByBindingMissKey: byKey, eligibleByMissSide: bySide, irreducibleByBindingMissKey: irrByKey, headroomAfterRuler: headroom }, c9ImplicitCeilingVariants: c9v, perDiet });

    lines.push(`\n=== seed ${h.seed}  n=${n} (satisfiable-planned − degenerate)`);
    lines.push(`    A = ${perRuler.A.k}/${n} = ${perRuler.A.pct}%`);
    lines.push(`    %E FRONTIER, KETO-EXEMPT (EK = A's fat floor + A's carb band; RK = essential floor + carb floor 50 + no non-keto carb ceiling):`);
    for (const e of [25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 55, 60]) {
      const p = perRuler[`EKfrontier:${e}`], q = perRuler[`RKfrontier:${e}`];
      lines.push(`      ${String(e).padStart(5)}%E   E: ${String(p.pct).padStart(5)}%  b/c ${String(p.b).padStart(3)}/${String(p.c).padStart(3)}  net ${(p.netPts >= 0 ? "+" : "") + p.netPts} pts     R: ${String(q.pct).padStart(5)}%  b/c ${String(q.b).padStart(3)}/${String(q.c).padStart(3)}  net ${(q.netPts >= 0 ? "+" : "") + q.netPts} pts`);
    }
    lines.push(`    R35 ABLATION (one term reverted to A at a time):`);
    for (const id of ["R35", "R35~fatFloorA", "R35~noFatCeil", "R35~carbFloorA", "R35~carbCeilA"]) lines.push(`      ${id.padEnd(16)} ${String(perRuler[id].pct).padStart(5)}%  b/c ${perRuler[id].b}/${perRuler[id].c}  net ${(perRuler[id].netPts >= 0 ? "+" : "") + perRuler[id].netPts} pts`);
    lines.push(`    TERM ATTRIBUTION of b (days A passes, treatment fails):`);
    for (const id of ["B", "C", "D", "E35", "E35k", "F", "R35", "R35k", "R40k", "R40k+carbCeil", "A15"]) lines.push(`      ${id.padEnd(14)} b=${String(perRuler[id].b).padStart(3)}  ${JSON.stringify(perRuler[id].bAttribution)}`);
    lines.push(`    TERM ATTRIBUTION of c (days A fails, treatment passes):`);
    for (const id of ["B", "C", "D", "E35", "E35k", "F", "R35", "R35k", "R40k", "R40k+carbCeil", "A15"]) lines.push(`      ${id.padEnd(14)} c=${String(perRuler[id].c).padStart(3)}  ${JSON.stringify(perRuler[id].cAttribution)}`);
    lines.push(`    NUTRITIONAL AUDIT of the COMPLIANT set:`);
    lines.push(`      ${"ruler".padEnd(6)} ${"days".padStart(5)} ${">35%E".padStart(6)} ${">30%E".padStart(6)} ${"<0.30lbm".padStart(9)} ${"<50g carb".padStart(10)} ${"medFat%E".padStart(9)}`);
    for (const id of ["A", "B", "C", "D", "E35", "E35k", "E30", "F", "R35", "R35k", "R40k", "R40k+carbCeil", "A15", "Z"]) { const x = audit[id]; lines.push(`      ${id.padEnd(6)} ${String(x.compliantDays).padStart(5)} ${String(x.aboveAMDR35pctEfat).padStart(6)} ${String(x.aboveHelms30pctEfat).padStart(6)} ${String(x.belowEssentialFat030lbm).padStart(9)} ${String(x.belowNonKetoCarb50).padStart(10)} ${String(x.medianFatPctE).padStart(9)}`); }
    lines.push(`    DOUBLE-COUNT: ruler-eligible ${eligible.length} d · solver-irreducible ${irreducible.length} d`);
    lines.push(`      eligible by bindingMissKey: ${JSON.stringify(byKey)}`);
    lines.push(`      eligible by missSide:       ${JSON.stringify(bySide)}`);
    lines.push(`      headroom left for solver levers: ${Object.entries(headroom).map(([k, v]) => `${k} ${v.remainingGapPts}pts/${v.remainingDays}d`).join(" · ")}`);
    lines.push(`    C9 implicit-ceiling variants (median, as multiple of A's explicit ceiling): ${JSON.stringify(c9v)}`);
  }

  // pooled
  if (out.runs.length > 1) {
    const ids = Object.keys(out.runs[0].perRuler);
    const pooled = {};
    for (const id of ids) {
      const pcts = out.runs.map((r) => r.perRuler[id].pct);
      const b = out.runs.reduce((s, r) => s + (r.perRuler[id].b || 0), 0);
      const c = out.runs.reduce((s, r) => s + (r.perRuler[id].c || 0), 0);
      const aMean = out.runs.reduce((s, r) => s + r.perRuler.A.pct, 0) / out.runs.length;
      pooled[id] = { perSeedPct: pcts, meanPct: r2(pcts.reduce((a, x) => a + x, 0) / pcts.length), spread: r2(Math.max(...pcts) - Math.min(...pcts)), meanDeltaVsA: r2(pcts.reduce((a, x) => a + x, 0) / pcts.length - aMean), pooled_b: b, pooled_c: c, pooled_net: c - b, a5Floor: r2(1.96 * Math.sqrt(b + c)), clearsA5: Math.abs(c - b) > 1.96 * Math.sqrt(b + c) };
    }
    const auditIds = Object.keys(out.runs[0].audit);
    const pooledAudit = Object.fromEntries(auditIds.map((id) => [id, {
      meanCompliantDays: r2(out.runs.reduce((s, r) => s + r.audit[id].compliantDays, 0) / out.runs.length),
      meanAbove35pctE: r2(out.runs.reduce((s, r) => s + r.audit[id].aboveAMDR35pctEfat, 0) / out.runs.length),
      meanBelow50gCarb: r2(out.runs.reduce((s, r) => s + r.audit[id].belowNonKetoCarb50, 0) / out.runs.length),
      meanBelowEssentialFat: r2(out.runs.reduce((s, r) => s + r.audit[id].belowEssentialFat030lbm, 0) / out.runs.length),
    }]));
    out.pooled = { seeds: out.runs.map((r) => r.run.seed), n: out.runs[0].n, rulers: pooled, audit: pooledAudit,
      doubleCount: { meanRulerEligibleDays: r2(out.runs.reduce((s, r) => s + r.doubleCount.rulerEligibleDays, 0) / out.runs.length), meanSolverIrreducibleDays: r2(out.runs.reduce((s, r) => s + r.doubleCount.solverIrreducibleDays, 0) / out.runs.length) } };
    lines.push(`\n=== POOLED (${out.runs.length} seeds) n=${out.runs[0].n}`);
    lines.push(`    %E FRONTIER pooled (mean Δ vs A, pts):`);
    for (const e of [25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 55, 60]) lines.push(`      ${String(e).padStart(5)}%E   E ${String((pooled[`Efrontier:${e}`].meanDeltaVsA >= 0 ? "+" : "") + pooled[`Efrontier:${e}`].meanDeltaVsA).padStart(7)} (b/c ${String(pooled[`Efrontier:${e}`].pooled_b).padStart(3)}/${String(pooled[`Efrontier:${e}`].pooled_c).padStart(3)})   EK ${String((pooled[`EKfrontier:${e}`].meanDeltaVsA >= 0 ? "+" : "") + pooled[`EKfrontier:${e}`].meanDeltaVsA).padStart(7)} (b/c ${String(pooled[`EKfrontier:${e}`].pooled_b).padStart(3)}/${String(pooled[`EKfrontier:${e}`].pooled_c).padStart(3)})   RK ${String((pooled[`RKfrontier:${e}`].meanDeltaVsA >= 0 ? "+" : "") + pooled[`RKfrontier:${e}`].meanDeltaVsA).padStart(7)} (b/c ${String(pooled[`RKfrontier:${e}`].pooled_b).padStart(3)}/${String(pooled[`RKfrontier:${e}`].pooled_c).padStart(3)})`);
    lines.push(`    KETO-EXEMPT pooled: ${["E35k", "R35k", "R30k", "R40k", "R40k+carbCeil", "R35k+carbCeil"].map((id) => `${id} ${(pooled[id].meanDeltaVsA >= 0 ? "+" : "") + pooled[id].meanDeltaVsA}`).join(" · ")}`);
    lines.push(`    R35 ABLATION pooled: ${["R35", "R35~fatFloorA", "R35~noFatCeil", "R35~carbFloorA", "R35~carbCeilA"].map((id) => `${id} ${(pooled[id].meanDeltaVsA >= 0 ? "+" : "") + pooled[id].meanDeltaVsA}`).join(" · ")}`);
    lines.push(`    AUDIT pooled (mean days): ${["A", "B", "D", "E35", "E35k", "F", "R35", "R35k", "R40k", "R40k+carbCeil", "A15", "Z"].map((id) => `${id}: ${pooledAudit[id].meanCompliantDays}d, >35%E ${pooledAudit[id].meanAbove35pctE}`).join(" · ")}`);
  }

  console.log(lines.join("\n"));
  const jp = path.resolve(String(flags.json || path.join(REPO, "fleet/out/W3-1/decompose.json")));
  fs.writeFileSync(jp, JSON.stringify(out, null, 2) + "\n");
  console.log(`\njson -> ${jp}`);
}
main();
