// E-V1 — VERIFIER's OWN ledger derivation, via the repo's Prisma client.
// The surgeon queried with node:sqlite. This is a different client against the
// same file, so agreement is not an echo of their method.
// Read-only: findMany / aggregate only. No writes.
// Absolute path: this script lives outside the backend module tree.
const { prisma } = require("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/prisma.js");

// Boundaries that matter, all derived from git, not from the surgeon's prose:
//   2297f26 committed 2026-07-26 16:11:28 -0600  -> the generate->brain path did
//           not exist before this instant, so no row before it can be from it.
//   surgery M0 began      2026-07-27 02:17:54Z   -> the witness window opens here.
const PATH_EXISTS_FROM = Date.parse("2026-07-26T22:11:28Z");
const WITNESS_WINDOW_FROM = Date.parse("2026-07-27T02:17:54Z");

(async () => {
  const rows = await prisma.llmUsage.findMany({ orderBy: { createdAt: "asc" } });
  console.log("TOTAL LlmUsage ROWS:", rows.length);

  let sum = 0;
  for (const r of rows) sum += Number(r.costUsd || 0);
  console.log("ALL-TIME COST USD  :", sum.toFixed(4));

  console.log("");
  console.log("=== EVERY ROW, ALL TIME ===");
  for (const r of rows) {
    const t = Number(r.createdAt);
    console.log(
      [
        r.id,
        new Date(t).toISOString(),
        String(r.phase).padEnd(9),
        String(r.model).padEnd(18),
        "in=" + r.inputTokens,
        "out=" + r.outputTokens,
        "$" + Number(r.costUsd || 0).toFixed(4),
      ].join("  ")
    );
  }

  // A generate-path call is written by aiRecipeClient (phase "create", intent
  // "recipe-drafts"). /generate-drafts writes the SAME shape, so phase alone
  // cannot separate them — the separator is time: the generate->brain path did
  // not exist until 2297f26 landed.
  const createRows = rows.filter((r) => r.phase === "create");
  const afterPathExists = createRows.filter((r) => Number(r.createdAt) > PATH_EXISTS_FROM);
  const inWitnessWindow = rows.filter((r) => Number(r.createdAt) > WITNESS_WINDOW_FROM);

  console.log("");
  console.log("=== GENERATE-PATH ANALYSIS ===");
  console.log('phase="create" rows, all time              :', createRows.length);
  for (const r of createRows) {
    console.log("   ", r.id, new Date(Number(r.createdAt)).toISOString(), "$" + Number(r.costUsd).toFixed(4));
  }
  console.log("...of those, AFTER the path existed (2297f26):", afterPathExists.length,
    "<- any row here could be generate-path");
  console.log("ROWS INSIDE THE WITNESS WINDOW (after M0)   :", inWitnessWindow.length,
    "<- surgeon claims 0, i.e. $0.00 spent");
  let witnessSpend = 0;
  for (const r of inWitnessWindow) witnessSpend += Number(r.costUsd || 0);
  console.log("WITNESS-WINDOW SPEND USD                    : $" + witnessSpend.toFixed(4));

  console.log("");
  console.log("=== BY PHASE ===");
  const byPhase = await prisma.llmUsage.groupBy({
    by: ["phase", "model"],
    _count: { _all: true },
    _sum: { costUsd: true },
  });
  for (const g of byPhase) {
    console.log(
      String(g.phase).padEnd(9), String(g.model).padEnd(18),
      "n=" + g._count._all, "$" + Number(g._sum.costUsd || 0).toFixed(4)
    );
  }
  console.log("");
  console.log('phase="critic" rows (critic has never fired):',
    rows.filter((r) => r.phase === "critic").length);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("LEDGER CHECK ERROR:", e && e.stack ? e.stack : e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
