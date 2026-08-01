// scoreRulers.mjs — W1-2. Re-score a dayDump JSONL under RULER A and RULER D.
// PURE ARITHMETIC on the stored record. No re-solve, no DB, no RNG, no network.
//
//   node fleet/out/W1-2/scoreRulers.mjs <dump.jsonl> [<dump2.jsonl> ...] --json=out.json
//
// WHY A SEPARATE FILE: scoreDays.mjs is shared instrumentation that other fleet
// agents may be invoking concurrently; W1-2 does not mutate it. Ruler A here is
// verified against scoreDays' own `product-recomputed` path AND against the
// booleans dayDump stored at solve time — three-way agreement or the run is void.
//
// RULER A — the shipping rule (backend/src/lib/mealSolver.js::dayTolerance):
//   kcal    |achieved-target|/target <= 0.15            (symmetric)
//   protein max(0,(pMid-achieved)/pMid) <= 0.15          (ONE-SIDED, no ceiling)
//   fat     [fatLo - 0.25*fatMid , fatHi + 0.25*fatMid]
//   carb    [carbLo - 0.25*carbMid, carbHi + A*carbMid]  A = keto ? 0 : 0.25
//
// RULER D — the floor ruler (mission spec):
//   kcal    unchanged (+-15% symmetric)
//   protein unchanged (>= 0.85*pMid, one-sided)
//   fat     >= 0.30 * lbmLb           HARD FLOOR, NO CEILING
//           (backend/src/lib/bmrEngine.js:286 ESSENTIAL_FAT_PER_LB_LBM = 0.3)
//   carb    >= carbLo                 FLOOR, no slack; NO CEILING unless keto
//   keto    carb <= carbHi (=KETO_CARB_CEILING_G 30) STILL ENFORCED
//
// lbmLb is NOT stored on the record. It is reconstructed from personas.jsonl by
// re-running bmrEngine's own two lines, and then PROVEN exact by checking that
// round(lbm*1.14)==proteinLo AND round(lbm*1.25)==proteinHi on every record.
// Any record that fails that check is counted and excluded from Ruler D rather
// than silently guessed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PERSONAS = path.join(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");

// bmrEngine.js:18, :283, :286, :297-300 — transcribed, then differentially verified below.
const KG2LB = 2.20462;
const ASSUMED_BODY_FAT_PCT = { M: 21, F: 28 };
const ESSENTIAL_FAT_PER_LB_LBM = 0.3;

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ── LBM reconstruction ──────────────────────────────────────────────────────
function lbmTable() {
  const t = new Map();
  for (const p of readJsonl(PERSONAS)) {
    const pr = p.profile;
    // dayDump.mjs:170 passes `bodyFatPct: pr.bodyFatPct ?? 0`; bmrEngine:296
    // treats null OR 0 as unknown. dayDump.mjs:192 passes weightKg = startWeightKg.
    const bf = pr.bodyFatPct ?? 0;
    const bfKnown = bf != null && bf > 0;
    const bfForLbm = bfKnown ? bf : (pr.sex === "F" ? ASSUMED_BODY_FAT_PCT.F : ASSUMED_BODY_FAT_PCT.M);
    const lbmLb = (pr.startWeightKg * KG2LB) * (1 - bfForLbm / 100);
    t.set(p.id, { lbmLb, bfAssumed: !bfKnown, sex: pr.sex });
  }
  return t;
}

// ── rulers ──────────────────────────────────────────────────────────────────
function rulerA(r) {
  const t = r.target || {}, a = r.achieved || {};
  const pMid = Number.isFinite(t.proteinMid) ? t.proteinMid : (t.proteinLo + t.proteinHi) / 2;
  const kcalOk = t.kcal > 0 ? Math.abs((a.kcal - t.kcal) / t.kcal) <= 0.15 : false;
  const proteinOk = pMid > 0 ? Math.max(0, (pMid - a.protein) / pMid) <= 0.15 : true;
  const fatJudged = Number.isFinite(t.fatLo) && Number.isFinite(t.fatHi) && t.fatHi > 0;
  const carbJudged = Number.isFinite(t.carbLo) && Number.isFinite(t.carbHi) && t.carbHi > 0;
  const fMid = (t.fatLo + t.fatHi) / 2, cMid = (t.carbLo + t.carbHi) / 2;
  const fatOk = !fatJudged || (a.fat >= t.fatLo - 0.25 * fMid && a.fat <= t.fatHi + 0.25 * fMid);
  const carbOverAllow = t.keto ? 0 : 0.25;
  const carbOk = !carbJudged || (a.carb >= t.carbLo - 0.25 * cMid && a.carb <= t.carbHi + carbOverAllow * cMid);
  return { inBand: kcalOk && proteinOk && fatOk && carbOk, kcalOk, proteinOk, fatOk, carbOk };
}

function rulerD(r, lbmLb) {
  const t = r.target || {}, a = r.achieved || {};
  const pMid = Number.isFinite(t.proteinMid) ? t.proteinMid : (t.proteinLo + t.proteinHi) / 2;
  const kcalOk = t.kcal > 0 ? Math.abs((a.kcal - t.kcal) / t.kcal) <= 0.15 : false;
  const proteinOk = pMid > 0 ? Math.max(0, (pMid - a.protein) / pMid) <= 0.15 : true;
  const essentialFat = Math.round(lbmLb * ESSENTIAL_FAT_PER_LB_LBM);
  const fatOk = a.fat >= essentialFat;
  const carbFloorOk = Number.isFinite(t.carbLo) ? a.carb >= t.carbLo : true;
  const ketoCeilOk = t.keto ? (Number.isFinite(t.carbHi) ? a.carb <= t.carbHi : true) : true;
  const carbOk = carbFloorOk && ketoCeilOk;
  return { inBand: kcalOk && proteinOk && fatOk && carbOk, kcalOk, proteinOk, fatOk, carbOk, essentialFat };
}

// ── denominators. Five, all named, never interchangeable. ───────────────────
const DENOMS = {
  "planned":              { desc: "every planned day record (n=640). Unjudged/degenerate count as MISSES.", f: () => true },
  "planned-minus-degen":  { desc: "planned minus 0-slot-config days — the rig-comparable all-planned n (639).", f: (r) => !r.degenerate },
  "judged":               { desc: "slotsFilled>0 (A1/rig/schema.mjs:83). Drops total-failure days.", f: (r) => r.judged },
  "satisfiable-judged":   { desc: "judged AND tier!=IMPOSSIBLE. The historically published 'satisfiable'.", f: (r) => r.judged && r.satisfiable !== false },
  "satisfiable-planned":  { desc: "tier!=IMPOSSIBLE, ALL planned. Total failures counted as misses. THE HONEST ONE.", f: (r) => r.satisfiable !== false },
};

function tally(rows, filt, ok) {
  let n = 0, k = 0, unjudged = 0, unjudgedSat = 0, degen = 0;
  for (const r of rows) {
    if (!filt(r)) continue;
    n++; if (ok(r)) k++;
    if (!r.judged) { unjudged++; if (r.satisfiable !== false && !r.degenerate) unjudgedSat++; }
    if (r.degenerate) degen++;
  }
  return { k, n, rate: n ? k / n : null, unjudged, unjudgedSat, degenerate: degen };
}

function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
  const LBM = lbmTable();
  const report = { tool: "fleet/out/W1-2/scoreRulers.mjs", generatedAt: new Date().toISOString(), runs: [] };
  const lines = [];

  for (const f of files) {
    const rows = readJsonl(path.resolve(f));
    const h = rows[0].run;

    // ── integrity: ruler A must reproduce what the solver stored, on every row.
    let aVsStored = 0, andMismatch = 0, lbmFail = 0;
    const lbmFailIds = new Set();
    for (const r of rows) {
      const A = rulerA(r);
      if (A.inBand !== !!r.verdict?.inBand) aVsStored++;
      const AND = r.verdict.kcalOk && r.verdict.proteinOk && r.verdict.fatOk && r.verdict.carbOk;
      if (AND !== r.verdict.inBand) andMismatch++;
      const L = LBM.get(r.personaId);
      if (!L) { lbmFail++; lbmFailIds.add(r.personaId); continue; }
      if (Math.round(L.lbmLb * 1.14) !== r.target.proteinLo || Math.round(L.lbmLb * 1.25) !== r.target.proteinHi) {
        lbmFail++; lbmFailIds.add(r.personaId);
      }
    }

    const okA = (r) => rulerA(r).inBand;
    const okD = (r) => rulerD(r, LBM.get(r.personaId).lbmLb).inBand;

    const cells = {};
    for (const [name, d] of Object.entries(DENOMS)) {
      cells[name] = { desc: d.desc, A: tally(rows, d.f, okA), D: tally(rows, d.f, okD) };
    }

    // per-diet, on satisfiable-planned AND satisfiable-judged AND planned
    const diets = [...new Set(rows.map((r) => r.dietStyle ?? "null"))].sort();
    const perDiet = {};
    for (const dt of diets) {
      const sel = (r) => (r.dietStyle ?? "null") === dt;
      perDiet[dt] = {};
      for (const [name, d] of Object.entries(DENOMS)) {
        perDiet[dt][name] = {
          A: tally(rows, (r) => sel(r) && d.f(r), okA),
          D: tally(rows, (r) => sel(r) && d.f(r), okD),
        };
      }
      perDiet[dt].personas = new Set(rows.filter(sel).map((r) => r.personaId)).size;
    }

    // per-tier (claim F1)
    const tiers = [...new Set(rows.map((r) => r.tier))].sort();
    const perTier = {};
    for (const ti of tiers) {
      const sel = (r) => r.tier === ti;
      perTier[ti] = {
        personas: new Set(rows.filter(sel).map((r) => r.personaId)).size,
        planned: { A: tally(rows, sel, okA), D: tally(rows, sel, okD) },
        judged: { A: tally(rows, (r) => sel(r) && r.judged, okA), D: tally(rows, (r) => sel(r) && r.judged, okD) },
      };
      // persona-level: does this persona EVER produce an in-band day?
      const ids = [...new Set(rows.filter(sel).map((r) => r.personaId))];
      let allFailA = 0, allFailD = 0, anyPassA = 0;
      for (const id of ids) {
        const rs = rows.filter((r) => r.personaId === id);
        const pa = rs.some(okA), pd = rs.some(okD);
        if (pa) anyPassA++; else allFailA++;
        if (!pd) allFailD++;
      }
      perTier[ti].personasWithZeroInBandDays = { A: allFailA, D: allFailD };
      perTier[ti].personasWithAtLeastOneInBandDay = { A: anyPassA };
    }

    // ruler A -> D flip census on all planned days
    let a1d1 = 0, a1d0 = 0, a0d1 = 0, a0d0 = 0;
    const flipCause = {};
    for (const r of rows) {
      const A = rulerA(r), D = rulerD(r, LBM.get(r.personaId).lbmLb);
      if (A.inBand && D.inBand) a1d1++;
      else if (A.inBand && !D.inBand) { a1d0++; const c = [!D.fatOk && "fat<essential", !D.carbOk && "carb<carbLo|ketoCeil"].filter(Boolean).join("+"); flipCause["A_pass_D_fail:" + c] = (flipCause["A_pass_D_fail:" + c] || 0) + 1; }
      else if (!A.inBand && D.inBand) { a0d1++; const c = [!A.fatOk && "fatBand", !A.carbOk && "carbBand"].filter(Boolean).join("+"); flipCause["A_fail_D_pass:" + c] = (flipCause["A_fail_D_pass:" + c] || 0) + 1; }
      else a0d0++;
    }

    const rec = {
      file: path.relative(REPO, path.resolve(f)).replace(/\\/g, "/"),
      run: { label: h.label, seed: h.seed, seedName: h.seedName, poolShape: h.poolShape, dbSha256: h.dbSha256, foodFingerprint: h.foodFingerprint, personasSha256: h.personasSha256, gitSha: h.gitSha, gitDiffStat: h.gitDiffStat, brain: h.brain },
      integrity: { rows: rows.length, rulerA_vs_stored_mismatch: aVsStored, stored_AND_mismatch: andMismatch, lbm_reconstruction_failures: lbmFail, lbmFailIds: [...lbmFailIds] },
      cells, perDiet, perTier,
      flips: { a1d1, a1d0, a0d1, a0d0, flipCause },
    };
    report.runs.push(rec);

    lines.push(`\n=== ${rec.file}`);
    lines.push(`    seed=${h.seed} shape="${h.poolShape}" db=${h.dbSha256.slice(0, 12)} brain=${h.brain}`);
    lines.push(`    INTEGRITY  rulerA-vs-stored ${aVsStored} · stored-AND ${andMismatch} · lbm-recon-fail ${lbmFail}   (all must be 0)`);
    lines.push(`    ${"denominator".padEnd(22)} ${"RULER A".padStart(18)} ${"RULER D".padStart(18)}   unjudged`);
    for (const [name, c] of Object.entries(cells)) {
      const fmt = (t) => `${String(t.k).padStart(3)}/${String(t.n).padEnd(3)} = ${(t.rate * 100).toFixed(1).padStart(5)}%`;
      lines.push(`    ${name.padEnd(22)} ${fmt(c.A).padStart(18)} ${fmt(c.D).padStart(18)}   ${c.A.unjudged} (sat ${c.A.unjudgedSat})`);
    }
    lines.push(`    FLIPS A->D  both-pass ${a1d1} · A-pass/D-fail ${a1d0} · A-fail/D-pass ${a0d1} · both-fail ${a0d0}`);
    for (const [k, v] of Object.entries(flipCause).sort((x, y) => y[1] - x[1])) lines.push(`        ${k}: ${v}`);
  }

  console.log(lines.join("\n"));
  const jp = path.resolve(String(flags.json || path.join(REPO, "fleet/out/W1-2/scored.json")));
  fs.writeFileSync(jp, JSON.stringify(report, null, 2) + "\n");
  console.log(`\njson -> ${jp}`);
}
main();
