// W4-2 pass 2 — the two numeric laws, uncapped and split by whether the app
// AGREED the day was out of band. A keto day over its own carb ceiling that
// the app FLAGS is a failed day; one the app grades in-band is a law breach.
//   node fleet/out/W4-2/lawsweep2.mjs
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const personaRaw = fs.readFileSync(path.join(ROOT, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const P = new Map(personaRaw.map((p) => [p.id, { sex: p.profile.sex, diet: p.dietaryStyle, userFloor: p.profile.floorKcal || 0 }]));

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p); } };
for (const b of ["fleet/out", "fleet/scratch"]) walk(path.join(ROOT, b));
files.sort();

const perFile = [];
const energyByPersona = new Map();
const worstKeto = [];
let recordsWithEnergy = 0, records = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let meta = null, first = true;
  const s = { file: rel, records: 0, filledDaysWithEnergy: 0, underFloorStrict: 0, ketoDays: 0, ketoOver: 0, ketoOverGradedOk: 0, ketoOverGradedInBand: 0, floorViol: 0, energyRecords: 0, underFloorDelivered: 0, filledDays: 0 };
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (first) { meta = r.run || null; first = false; }
    if (!r.personaId) continue;
    const p = P.get(r.personaId); if (!p) continue;
    s.records++; records++;
    if (r.energy) { s.energyRecords++; recordsWithEnergy++; if (!energyByPersona.has(r.personaId)) energyByPersona.set(r.personaId, r.energy); }
    const en = r.energy || energyByPersona.get(r.personaId);
    const sexFloor = p.sex === "F" ? 1200 : 1500;
    if (r.energy) {
      const expect = Math.max(r.energy.rmr * 0.95, sexFloor, p.userFloor);
      if (r.energy.targetKcal < expect - 1) s.floorViol++;
    }
    if (r.slotsFilled > 0) {
      s.filledDays++;
      if (r.energy) s.filledDaysWithEnergy++;
      if (en && r.achieved && r.achieved.kcal < Math.max(en.rmr * 0.95, sexFloor, p.userFloor)) {
        s.underFloorDelivered++;
        // STRICT: only days whose own record carries the energy block, so the
        // rate is never inflated or deflated by a cross-file persona join.
        if (r.energy) s.underFloorStrict++;
      }
    }
    if (p.diet === "keto" && r.target && r.achieved && r.slotsFilled > 0) {
      s.ketoDays++;
      if (r.achieved.carb > r.target.carbHi + 1e-6) {
        s.ketoOver++;
        const gradedOk = r.verdict ? r.verdict.carbOk === true : null;
        const inBand = r.engineInBand === true || (r.verdict && r.verdict.inBand === true);
        if (gradedOk) s.ketoOverGradedOk++;
        if (inBand) s.ketoOverGradedInBand++;
        const over = r.achieved.carb - r.target.carbHi;
        worstKeto.push({ file: rel, personaId: r.personaId, dayKey: r.dayKey, carbHi: r.target.carbHi, carb: +r.achieved.carb.toFixed(1), overBy: +over.toFixed(1), gradedCarbOk: gradedOk, engineInBand: inBand, matchPct: r.engineMatchPct ?? null });
      }
    }
  }
  s.agent = meta?.agentId ?? null; s.label = meta?.label ?? null; s.seed = meta?.seed ?? null;
  perFile.push(s);
}

worstKeto.sort((a, b) => b.overBy - a.overBy);
const tot = perFile.reduce((a, s) => ({
  records: a.records + s.records, energyRecords: a.energyRecords + s.energyRecords, floorViol: a.floorViol + s.floorViol,
  ketoDays: a.ketoDays + s.ketoDays, ketoOver: a.ketoOver + s.ketoOver, ketoOverGradedOk: a.ketoOverGradedOk + s.ketoOverGradedOk,
  ketoOverGradedInBand: a.ketoOverGradedInBand + s.ketoOverGradedInBand, filledDays: a.filledDays + s.filledDays, underFloorDelivered: a.underFloorDelivered + s.underFloorDelivered,
  filledDaysWithEnergy: a.filledDaysWithEnergy + s.filledDaysWithEnergy, underFloorStrict: a.underFloorStrict + s.underFloorStrict,
}), { records: 0, energyRecords: 0, floorViol: 0, ketoDays: 0, ketoOver: 0, ketoOverGradedOk: 0, ketoOverGradedInBand: 0, filledDays: 0, underFloorDelivered: 0, filledDaysWithEnergy: 0, underFloorStrict: 0 });

const out = { generatedAt: new Date().toISOString(), files: files.length, totals: tot, worstKeto: worstKeto.slice(0, 25), perFile };
fs.writeFileSync(path.join(ROOT, "fleet/out/W4-2/lawsweep2.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ files: files.length, totals: tot, worstKeto: worstKeto.slice(0, 6) }, null, 1));
