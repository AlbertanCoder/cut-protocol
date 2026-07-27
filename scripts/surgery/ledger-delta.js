#!/usr/bin/env node
/**
 * ledger-delta — the money, counted by a script, never by the model.
 *
 * H6 rule: the model does not do the arithmetic it is judged on. This reads
 * the LlmUsage table through the repo's own Prisma client and prints machine
 * numbers: row count, per-phase breakdown, ids, timestamps, token and dollar
 * sums — optionally constrained to a run window and/or to rows newer than a
 * pre-run max id.
 *
 * Usage:
 *   node scripts/surgery/ledger-delta.js
 *   node scripts/surgery/ledger-delta.js --since 2026-07-27T10:00:00Z --until 2026-07-27T10:30:00Z
 *   node scripts/surgery/ledger-delta.js --after-id <cuid>       (rows created after that row)
 *   node scripts/surgery/ledger-delta.js --json
 *
 * Read-only. Never writes, never spends.
 */
'use strict';

const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(REPO, 'backend');

// Load the backend's env exactly as the app does, without echoing any of it.
try {
  require(path.join(BACKEND, 'node_modules', 'dotenv')).config({
    path: path.join(BACKEND, '.env'),
  });
} catch {
  /* dotenv optional; DATABASE_URL may already be in the environment */
}
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';

// The repo's own client — not a hand-rolled sqlite reader. It exports
// { prisma, walReady }, so unwrap rather than assuming a default export.
const { prisma } = require(path.join(BACKEND, 'src', 'lib', 'prisma.js'));

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}
const asJson = process.argv.includes('--json');

function usd(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

async function main() {
  const since = arg('--since');
  const until = arg('--until');
  const afterId = arg('--after-id');

  const where = {};
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = new Date(since);
    if (until) where.createdAt.lte = new Date(until);
  }

  if (afterId) {
    const anchor = await prisma.llmUsage.findUnique({ where: { id: afterId } });
    if (!anchor) {
      console.error(`ledger-delta: --after-id ${afterId} does not exist. Refusing to guess.`);
      process.exit(2);
    }
    where.createdAt = Object.assign({}, where.createdAt, { gt: anchor.createdAt });
  }

  const rows = await prisma.llmUsage.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      model: true,
      phase: true,
      intent: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      costUsd: true,
      createdAt: true,
    },
  });

  const allTime = await prisma.llmUsage.aggregate({
    _count: { _all: true },
    _sum: { costUsd: true },
  });

  const byPhase = new Map();
  let cost = 0;
  let inTok = 0;
  let outTok = 0;
  for (const r of rows) {
    const k = r.phase || '(null)';
    const cur = byPhase.get(k) || { n: 0, cost: 0 };
    cur.n += 1;
    cur.cost += r.costUsd || 0;
    byPhase.set(k, cur);
    cost += r.costUsd || 0;
    inTok += r.inputTokens || 0;
    outTok += r.outputTokens || 0;
  }

  const summary = {
    window: { since: since || null, until: until || null, afterId: afterId || null },
    delta: {
      rows: rows.length,
      costUsd: Number(cost.toFixed(6)),
      inputTokens: inTok,
      outputTokens: outTok,
      byPhase: Object.fromEntries([...byPhase].map(([k, v]) => [k, { rows: v.n, costUsd: Number(v.cost.toFixed(6)) }])),
    },
    allTime: {
      rows: allTime._count._all,
      costUsd: Number((allTime._sum.costUsd || 0).toFixed(6)),
    },
    ids: rows.map((r) => r.id),
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log('== LEDGER DELTA ==');
    console.log(`window   : since=${since || '(none)'}  until=${until || '(none)'}  afterId=${afterId || '(none)'}`);
    console.log(`delta    : ${rows.length} row(s), ${usd(cost)}, in=${inTok} out=${outTok} tokens`);
    if (byPhase.size) {
      for (const [k, v] of byPhase) console.log(`  phase ${k.padEnd(12)} rows=${v.n} ${usd(v.cost)}`);
    }
    console.log(`all-time : ${allTime._count._all} row(s), ${usd(allTime._sum.costUsd || 0)}`);
    if (rows.length) {
      console.log('rows:');
      for (const r of rows) {
        console.log(
          `  ${r.createdAt.toISOString()}  ${r.id}  phase=${r.phase || '(null)'}  ` +
            `model=${r.model}  in=${r.inputTokens} out=${r.outputTokens} ${usd(r.costUsd)}`
        );
      }
    }
    console.log('== END ==');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ledger-delta FAILED:', e && e.message);
  try {
    await prisma.$disconnect();
  } catch {
    /* already down */
  }
  process.exit(1);
});
