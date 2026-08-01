// A14-pool.mjs — pool the paired McNemar across seeds, and compute a
// LOAD-INDEPENDENT cost metric (total per-slot candidate draws), because
// wall-clock is contaminated: flat20 and floor20 are the SAME effective rule
// (both mean budget 20.00, both 9773 slotCalls, byte-identical verdicts) yet
// logged 34.9s and 78.7s. solveMs measures machine load, not the treatment.
import fs from "node:fs";
const Z = 1.959964;
const SEEDS = [424242, 20260730, 8675309];
const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

function pairs(base, treat) {
  const B = new Map(readJsonl(base).filter(r=>r.dayKey).map(r=>[r.dayKey,r]));
  const T = new Map(readJsonl(treat).filter(r=>r.dayKey).map(r=>[r.dayKey,r]));
  const out = [];
  for (const [k, rb] of B) { const rt = T.get(k); if (!rt) continue;
    if (!(rb.judged && rt.judged)) continue;
    out.push({ sat: rb.satisfiable !== false, ok:[!!rb.verdict?.inBand, !!rt.verdict?.inBand] }); }
  return out;
}
function mc(ps){ let n=0,b=0,c=0,kB=0,kT=0;
  for(const [x,y] of ps){n++; if(x)kB++; if(y)kT++; if(x&&!y)b++; else if(!x&&y)c++;}
  const d=(c-b)/n, se=Math.sqrt(Math.max(0,b+c-((c-b)**2)/n))/n;
  return {n,kB,kT,b,c,d,se,hw:Z*se}; }
function draws(label, seed){ // deterministic: sum over customers of slotCalls*meanBudget
  const p = `A14-cost-${label}-s${seed}.csv`; if(!fs.existsSync(p)) return null;
  const L = fs.readFileSync(p,"utf8").trim().split("\n"); const h=L[0].split(",");
  let tot=0; for(const l of L.slice(1)){ const c=l.split(","); const o={}; h.forEach((k,i)=>o[k]=c[i]);
    const sc=Number(o.slotCalls), mb=Number(o.meanBudget); if(Number.isFinite(sc)&&Number.isFinite(mb)) tot+=sc*mb; }
  return tot; }

const ARMS = process.argv.slice(2);
const baseDraws = draws("base", 424242);
console.log("arm            seeds  n_sat    b    c   delta_pts   95%CI              draws       xCost");
for (const arm of ARMS) {
  let P=[]; const used=[];
  for (const s of SEEDS) { const f=`A14-${arm}-s${s}.jsonl`; if(!fs.existsSync(f)) continue;
    used.push(s); P = P.concat(pairs(`A14-base-s${s}.jsonl`, f).filter(r=>r.sat)); }
  if(!P.length){ console.log(`${arm.padEnd(14)} MISSING`); continue; }
  const m = mc(P.map(r=>r.ok));
  const dr = draws(arm, 424242);
  const lo=(m.d-m.hw)*100, hi=(m.d+m.hw)*100;
  console.log(`${arm.padEnd(14)} ${String(used.length).padStart(3)}  ${String(m.n).padStart(5)} ${String(m.b).padStart(4)} ${String(m.c).padStart(4)}   ${((m.d>=0?"+":"")+(m.d*100).toFixed(2)).padStart(7)}   [${(lo>=0?"+":"")+lo.toFixed(2)}, ${(hi>=0?"+":"")+hi.toFixed(2)}]`.padEnd(78)
    + `${dr==null?"-":Math.round(dr/1000)+"k"}`.padStart(9) + `  x${dr==null?"-":(dr/baseDraws).toFixed(2)}`);
}
console.log(`\nbase draws s424242 = ${Math.round(baseDraws/1000)}k candidate slot-draws`);
