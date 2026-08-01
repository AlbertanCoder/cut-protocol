const fs=require('fs');
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const BMR = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/bmrEngine.js");
const lines = fs.readFileSync("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl","utf8").trim().split('\n').map(JSON.parse);
const out=[];
for (const p of lines) {
  const prof = p.profile;
  try {
    const e = BMR.computeEnergy(prof, prof.startWeightKg);
    const t = BMR.deriveTarget(prof, e.tdee, e.rmr);
    const kcal = t.target;
    const m = BMR.computeMacros(prof, prof.startWeightKg, kcal);
    const pMid=(m.proteinLo+m.proteinHi)/2, fMid=(m.fatLo+m.fatHi)/2, cMid=m.carbMid ?? (m.carbLo+m.carbHi)/2;
    out.push({id:p.id, tier:p.tier, style:p.dietaryStyle, kcal:m.kcal, pMid, fMid, cMid,
      pDen: 100*pMid/m.kcal, fDen:100*fMid/m.kcal, cDen:100*cMid/m.kcal});
  } catch(err) { out.push({id:p.id, err: err.message}); }
}
fs.writeFileSync('targets.json', JSON.stringify(out));
const ok = out.filter(o=>!o.err);
console.log('personas computed:', ok.length, 'errors:', out.length-ok.length);
if (out.find(o=>o.err)) console.log('first err:', out.find(o=>o.err).err);
const st=(a)=>{const s=[...a].sort((x,y)=>x-y); const Q=p=>s[Math.round((s.length-1)*p)]; return {n:s.length,min:s[0].toFixed(2),p10:Q(.1).toFixed(2),p25:Q(.25).toFixed(2),med:Q(.5).toFixed(2),p75:Q(.75).toFixed(2),p90:Q(.9).toFixed(2),max:s[s.length-1].toFixed(2)};};
console.log('TARGET protein g/100kcal', JSON.stringify(st(ok.map(o=>o.pDen))));
console.log('TARGET fat     g/100kcal', JSON.stringify(st(ok.map(o=>o.fDen))));
console.log('TARGET carb    g/100kcal', JSON.stringify(st(ok.map(o=>o.cDen))));
