// A17-hook-v1.mjs — rig treatment. Two jobs:
//   1. publish `foodById` and the current persona id on a global, so
//      A17-preload-v1.cjs (which intercepts macroCloser.closeDayMacros) can
//      resolve ingredient macros and stamp its dump. Setting a global changes
//      no solver input.
//   2. optionally WIDEN the adjuster candidate set — the one closer gate that
//      IS reachable from the rig's treatment contract (`adjusters`).
//
// Every widened candidate goes through the SAME two gates planContext.loadAdjusters
// uses: foodValidation.macroTrustIssue and exclusionGate.isExcluded, imported from
// product code. The widening is in WHICH ROWS ARE OFFERED, never in the gate.
//
// env A17T = {"mode":"none"|"curated"|"dense", "n":8}
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const REPO = "C:/Users/<account>/Desktop/cut-protocol";
const require = createRequire(import.meta.url);
const gate = require(path.join(REPO, "backend/src/lib/exclusionGate.js"));
const foodVal = require(path.join(REPO, "backend/src/lib/foodValidation.js"));

const T = (() => { try { return JSON.parse(process.env.A17T || "{}"); } catch { return {}; } })();
const MODE = T.mode || "none";
const N = Number.isFinite(T.n) ? T.n : 8;
const A17DIR = path.join(REPO, "docs/surgery/CAMPAIGN/solver-brain/A17");

export const NAME = `A17-adjusters-${MODE}${MODE === "dense" ? `-n${N}` : ""}`;

// product's 10 (planContext.js:167-178), verbatim
const BASE = [
  { name: "Olive Oil", role: "fat" }, { name: "Butter", role: "fat" }, { name: "Avocado", role: "fat" },
  { name: "White rice, cooked", role: "carb" }, { name: "Potatoes", role: "carb" }, { name: "Oats", role: "carb" },
  { name: "Chicken breast, cooked, skinless", role: "protein" }, { name: "Greek Yogurt", role: "protein" },
  { name: "Tofu", role: "protein" }, { name: "Lentils", role: "protein" },
];

let _pool = null;          // role -> [{food, density}] sorted, gate-agnostic
let _curatedRows = null;
const _seen = new Map();   // name -> {role, styles:Set}

async function buildPool(prisma) {
  if (_pool) return _pool;
  const rows = await prisma.food.findMany({ select: gate.FOOD_GATE_SELECT });
  const usable = rows.filter((f) => !foodVal.macroTrustIssue(f) && f.kcal > 0);
  const byRole = { protein: [], carb: [], fat: [] };
  for (const f of usable) {
    for (const role of ["protein", "carb", "fat"]) {
      const g = f[role] || 0;
      if (g <= 0) continue;
      byRole[role].push({ food: f, d: g / f.kcal, g });
    }
  }
  for (const role of Object.keys(byRole)) {
    // density desc, then id asc — fully deterministic
    byRole[role].sort((a, b) => (b.d - a.d) || (a.food.id - b.food.id));
  }
  _pool = byRole;
  return _pool;
}

async function curatedRows(prisma) {
  if (_curatedRows) return _curatedRows;
  const p = path.join(A17DIR, "A17-curated-v1.json");
  const list = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  const names = list.map((c) => c.name);
  const rows = names.length ? await prisma.food.findMany({ where: { name: { in: names } }, select: gate.FOOD_GATE_SELECT }) : [];
  const byLower = new Map();
  for (const f of rows) { const k = f.name.trim().toLowerCase(); if (!byLower.has(k)) byLower.set(k, f); }
  _curatedRows = { list, byLower };
  return _curatedRows;
}

let baseRows = null;
async function baseFoods(prisma) {
  if (baseRows) return baseRows;
  const rows = await prisma.food.findMany({ where: { name: { in: BASE.map((b) => b.name) } }, select: gate.FOOD_GATE_SELECT });
  const m = new Map();
  for (const f of rows) { const k = f.name.trim().toLowerCase(); if (!m.has(k)) m.set(k, f); }
  baseRows = m;
  return baseRows;
}

function record(name, role, style) {
  if (!_seen.has(name)) _seen.set(name, { role, styles: new Set() });
  _seen.get(name).styles.add(style || "none");
}

export async function applyTreatment({ customer, profile, adjusters, prisma, foodById }) {
  globalThis.__A17 = globalThis.__A17 || {};
  globalThis.__A17.foodById = foodById;
  globalThis.__A17.customer = customer?.id || null;

  if (MODE === "none") return {};

  const style = profile?.dietaryStyle || "none";
  const out = [];
  const bm = await baseFoods(prisma);
  for (const cand of BASE) {
    const f = bm.get(cand.name.trim().toLowerCase());
    if (!f) continue;
    if (foodVal.macroTrustIssue(f)) continue;
    if (gate.isExcluded(f, profile)) continue;
    out.push({ role: cand.role, food: f });
    record(f.name, cand.role, style);
  }

  if (MODE === "curated") {
    const { list, byLower } = await curatedRows(prisma);
    for (const cand of list) {
      const f = byLower.get(cand.name.trim().toLowerCase());
      if (!f) continue;
      if (out.some((o) => o.food.id === f.id)) continue;
      if (foodVal.macroTrustIssue(f)) continue;
      if (gate.isExcluded(f, profile)) continue;
      out.push({ role: cand.role, food: f });
      record(f.name, cand.role, style);
    }
  } else if (MODE === "dense") {
    const pool = await buildPool(prisma);
    for (const role of ["fat", "carb", "protein"]) {
      let taken = 0;
      for (const c of pool[role]) {
        if (taken >= N) break;
        if (out.some((o) => o.food.id === c.food.id)) continue;
        if (gate.isExcluded(c.food, profile)) continue;
        out.push({ role, food: c.food });
        record(c.food.name, role, style);
        taken++;
      }
    }
  }
  return { adjusters: out };
}

process.on("exit", () => {
  if (MODE === "none" || !_seen.size) return;
  try {
    const rows = [..._seen.entries()].map(([name, v]) => ({ name, role: v.role, styles: [...v.styles].sort() }));
    fs.writeFileSync(path.join(A17DIR, `A17-candidates-${MODE}${MODE === "dense" ? `-n${N}` : ""}.json`),
      JSON.stringify({ mode: MODE, n: N, count: rows.length, rows }, null, 2));
  } catch (e) { console.error("[A17 hook] flush failed:", e.message); }
});
