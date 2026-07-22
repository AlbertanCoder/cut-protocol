# Cut Protocol — release security scan report

**Artifact:** `release/Cut Protocol Setup 1.0.0.exe` (v0.1.0-prototype)
**Size:** 209,270,871 bytes (~200 MB)
**SHA-256:** `996877c639fcc29adced66c18e6b3914e5811f4021e6c53058dac726590a1ef3`
**Date:** 2026-07-21

## Results

| Check | Result | Evidence |
|-------|--------|----------|
| Secrets in repo (tracked) | **PASS** | `scanSecrets --tracked` clean (302 files) |
| Secrets in the UNPACKED installer | **PASS** | `checkDistSafe release/win-unpacked` → "safe to share"; `scanSecrets` on app.asar.unpacked clean |
| Real `.env` / API keys shipped | **PASS (none)** | extraResources ships only `dev.db.template`; **no `backend.env.template`** in `resources/` |
| Personal data in the shipped DB | **PASS** | `dev.db.template` = 0 users / 0 profiles / 0 weigh-ins / 0 plans; no personal emails |
| Dependency vulnerabilities (`npm audit` high+) | **PASS** | 0 vulnerabilities — backend and frontend |
| Malicious patterns in brain code (S1) | **PASS** | `checkBrainPurity` — no web/shell/file-write/eval across 35 files |
| Supply-chain (off-registry / wildcard deps, S3) | **PASS** | `checkSupplyChain` clean; lockfiles present |
| Dist precheck (M4 gate) | **PASS** | `distPrecheck` green as `predist` |
| Shipped library intact | **PASS** | template keeps 864 foods + 889 recipes (+ taste tiers) |

## Honest limits
A scan **reduces** risk — it is **not** a guarantee of safety. Before the link is shared:
- Upload the final `.exe` to **https://www.virustotal.com** (free, ~70 AV engines) and keep the report link.
- Keep antivirus running on the build machine.
- The app is **unsigned**, so Windows SmartScreen shows "Windows protected your PC" → the tester clicks **"More info → Run anyway."** (Recommend code-signing before any wider release.)
- A professional security review is advised before real, paying users at scale.
