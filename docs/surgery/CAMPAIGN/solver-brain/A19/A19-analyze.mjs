// A19-analyze.mjs — reads A19's already-written artifacts. Solves nothing.
//   node A19-analyze.mjs
import fs from "node:fs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const rd = (f) => fs.readFileSync(path.join(HERE, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ── 1. ORACLE PROBE: ceiling of per-day harvesting from the rolls already run ──
function probeStats(file) {
  const rows = rd(file);
  const acc = { days: 0, satDays: 0, base: 0, satBase: 0, any: 0, satAny: 0, rolls: 0, windows: 0,
                nInTolHist: {}, multiRoll: 0 };
  for (const r of rows) {
    for (const w of r.windows) {
      acc.windows++; acc.rolls += w.rolls;
      if (w.rolls > 1) acc.multiRoll++;
      for (const d of w.perDay) {
        acc.days++;
        if (d.baseInTol) acc.base++;
        if (d.anyInTol) acc.any++;
        acc.nInTolHist[d.nInTol] = (acc.nInTolHist[d.nInTol] || 0) + 1;
        if (r.satisfiable) {
          acc.satDays++;
          if (d.baseInTol) acc.satBase++;
          if (d.anyInTol) acc.satAny++;
        }
      }
    }
  }
  return acc;
}
for (const f of ["A19-probe-s424242.jsonl", "A19-probe-dayN-s424242.jsonl", "A19-probe-strict-s424242.jsonl"]) {
  const a = probeStats(f);
  const pc = (k, n) => ((k / n) * 100).toFixed(1);
  console.log(`\n[PROBE] ${f}`);
  console.log(`  windows ${a.windows} (rolls>1: ${a.multiRoll}) · mean rolls/window ${(a.rolls / a.windows).toFixed(2)}`);
  console.log(`  ALL planned days ${a.days}: chosen-week in-band ${a.base} (${pc(a.base, a.days)}%) · ANY-ROLL in-band ${a.any} (${pc(a.any, a.days)}%)  [ORACLE BOUND]`);
  console.log(`  SATISFIABLE days ${a.satDays}: chosen ${a.satBase} (${pc(a.satBase, a.satDays)}%) · ANY-ROLL ${a.satAny} (${pc(a.satAny, a.satDays)}%)  [ORACLE BOUND]`);
  console.log(`  rolls-in-band histogram (how many of the N rolls landed that day):`,
    Object.entries(a.nInTolHist).sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(" "));
}

// ── 2. ASSEMBLY COST: what the repeat cap did to the dayN mix ──
for (const f of ["A19-probe-dayN-s424242.jsonl", "A19-probe-strict-s424242.jsonl"]) {
  const rows = rd(f);
  let sw = 0, cb = 0, cd = 0, rej = 0, breach = 0, wins = 0, capFail = 0;
  for (const r of rows) {
    if (r.varietyCapHeld === false) capFail++;
    for (const a of (r.assembly || [])) {
      if (!a) continue;
      wins++; sw += a.switched; cb += a.capBlocked; cd += a.consecDup;
      if (a.rejected) rej++;
      if (a.capBreached) breach++;
    }
  }
  console.log(`\n[ASSEMBLY] ${f}: windows-with-assembly ${wins} · days switched ${sw} · cap-blocked candidate-days ${cb} · consecutive-day dup slots ${cd} · mixes rejected ${rej} · per-window cap breached ${breach} · customers failing horizon variety cap ${capFail}`);
}

// ── 3. DIRECTION OF THE FLIPS (C9: is the joint solve able to go DOWN?) ──
function keyed(file) {
  const m = new Map();
  for (const r of rd(file)) if (r.dayKey) m.set(r.dayKey, r);
  return m;
}
for (const seed of ["424242", "20260730", "8675309"]) {
  const B = keyed(`A19-forkweek-s${seed}.jsonl`), T = keyed(`A19-dayN-s${seed}.jsonl`);
  const gained = [], lost = [];
  for (const [k, b] of B) {
    const t = T.get(k); if (!t || !b.judged || !t.judged) continue;
    if (!b.verdict.inBand && t.verdict.inBand) gained.push([b, t]);
    if (b.verdict.inBand && !t.verdict.inBand) lost.push([b, t]);
  }
  const dir = (rows, idx) => {
    let down = 0, up = 0, dk = 0;
    for (const [b, t] of rows) {
      const d = t.achieved.kcal - b.achieved.kcal;
      if (d < -1) down++; else if (d > 1) up++;
      dk += d;
    }
    return `${idx}: n=${rows.length} kcal-down ${down} · kcal-up ${up} · mean dkcal ${(dk / (rows.length || 1)).toFixed(0)}`;
  };
  // which macro rule was broken on the baseline day that got fixed
  const why = {};
  for (const [b] of gained) {
    const v = b.verdict;
    const f = [];
    if (!v.kcalOk) f.push(v.kcalDeltaPct > 0 ? "kcal-over" : "kcal-under");
    if (!v.proteinOk) f.push("protein-short");
    if (!v.fatOk) f.push(v.fatOverPct > 0 ? "fat-over" : "fat-short");
    if (!v.carbOk) f.push(v.carbOverPct > 0 ? "carb-over" : "carb-short");
    const key = f.sort().join("+") || "none";
    why[key] = (why[key] || 0) + 1;
  }
  console.log(`\n[FLIPS] dayN vs forkweek seed ${seed}`);
  console.log("  " + dir(gained, "GAINED"));
  console.log("  " + dir(lost, "LOST"));
  console.log("  baseline failure mode of the gained days:", Object.entries(why).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
}

// ── 4. PINNED-BOUND share among still-missed days (C10 cross-check) ──
for (const [lbl, f] of [["forkweek", "A19-forkweek-s424242.jsonl"], ["dayN", "A19-dayN-s424242.jsonl"]]) {
  const rows = rd(f).filter((r) => r.judged);
  const miss = rows.filter((r) => !r.verdict.inBand);
  const pin = miss.filter((r) => r.pinned?.anyPinned).length;
  const lo = miss.filter((r) => (r.pinned?.atLoBound || 0) > 0).length;
  const hi = miss.filter((r) => (r.pinned?.atHiBound || 0) > 0).length;
  console.log(`\n[PINNED] ${lbl}: judged ${rows.length} · missed ${miss.length} · anyPinned ${pin} · atLo ${lo} · atHi ${hi}`);
}
