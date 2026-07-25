> # ⚠ CERTIFICATE VOID — 2026-07-24
> **This report certifies an artifact that no longer exists, and today's
> installer has never been scanned.** Every PASS below is void. The checklist
> is kept because the method is right; the verdict is not.
>
> | | Scanned artifact (2026-07-21) | `release/` today |
> |---|---|---|
> | Size | 209,270,871 B | **243,269,113 B** |
> | SHA-256 | `996877c6…590a1ef3` | **`bfdef822…c940a34d7`** |
> | Built | 2026-07-21 | **2026-07-24 18:44** |
>
> Different size, different hash, different build. **A hash-pinned scan
> certifies exactly one file and expires the moment that file is rebuilt** —
> and this one was rebuilt at least twice on 2026-07-24 alone (an 18:25 build
> was superseded by the 18:44 one before this note was written). Nothing in the
> repo re-runs the scan or invalidates this page on rebuild, so it has been
> sitting here vouching for a binary that was replaced days ago.
>
> **The current installer is known-unsafe to share.** It leaks secrets and
> real user health data:
> - `backend/.env.qc` ships, because the payload denylist blocks `.env` and
>   `.env.local` **by name** and never anticipated a third variant.
> - `backend/prisma/dev.db.snapshot-agentcontam-20260721-212858` ships — a real
>   3.2 MB user database containing **10 users' health data**. The exclusions
>   `dev.db.backup-*` and `*.db.backup*` both miss it: it is a *snapshot*, not a
>   *backup*.
>
> This directly falsifies rows 2, 3 and 4 of the table below ("Secrets in the
> UNPACKED installer: PASS", "Real `.env` / API keys shipped: PASS (none)",
> "Personal data in the shipped DB: PASS"). Row 9's "864 foods" is also stale —
> the library is 14,122 foods / 889 recipes.
>
> **Do not share `release/Cut Protocol Setup 1.0.0.exe` with anyone.** If a
> build was already sent to a tester, note the open question in
> `BATTLE-PLAN.md`: the 2026-07-21 share predates `.env.qc` (created 07-22), but
> the DB snapshot is stamped 07-21 21:28 — if that build was cut after 21:28,
> the tester already has the data.
>
> **Before this page may carry a verdict again:** convert `build.files` to an
> allowlist (see CLAUDE.md → Packaging), rebuild, re-run `npm run dist:check`
> and `npm run scan:secrets` against *that* binary, and replace the size/hash
> above in the same commit that produces it. A scan report that is not
> regenerated with its artifact is worse than no scan report — it converts an
> unknown into a false assurance.

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
