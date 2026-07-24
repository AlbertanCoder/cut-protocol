# Cut Protocol — security fuzz (IDOR / injection / ED-safety)

- Real app, ephemeral port, throwaway DB (deleted), two seeded accounts. Threat model: loopback-only -> cross-account = multi-profile-on-one-machine.
- Findings: **0 P0**, 0 P1.

No IDOR (B could not read or delete A's data), no auth bypass or 500 from operator/SQL-meta injection, and no write path produced a sub-floor target.

_Generated 2026-07-23T02:29:59.319Z. npm run qc:security_
