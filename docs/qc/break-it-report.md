# Cut Protocol — break-it (fuzz) report

- Requests fired: **244** across 16 route groups · auth: ok · DB: throwaway copy (deleted)
- Server: real app on an ephemeral port · BRAIN=off · no network
- Outcomes: 25 2xx · 219 clean 4xx · **0 500s** · **0 hangs** · **0 stack-leaks** · 0 transport errors

## Findings
None. Every hostile input got a clean 4xx or a sane response; no 500, no hang, no stack-trace leak; races handled; brain degraded calmly.

## Garbage accepted on mutating routes (soft findings — validation gaps)
None. Every clearly-invalid create/update body was rejected with a 4xx.

## Races & lifecycle
- 8× concurrent generate: 8/8 ok, 0 failed
- server responsive after burst: yes
- brain route with BRAIN=off + no key: degraded calmly (no 500/hang) (status 200)

## Reproduce
```
node scripts/qc/fuzz.mjs
```
_Generated 2026-07-23T01:34:51.004Z._
