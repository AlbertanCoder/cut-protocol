# Fresh-install verification — v0.1.0-prototype

Doc 2 Stage 2. Verify the built installer behaves as a **brand-new person** (the
tester), with **no project env vars** and **no reference to the owner**. Run the
interactive rows on a clean Windows user profile or a VM before sending the link.

Legend: **PASS** verified · **PENDING** run on a clean profile · **—** n/a

## A. Data-safety (verified automatically — the M4 gate)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| A1 | Template DB has **zero personal rows** | **PASS** | `buildTemplateDb.mjs`: users 0, profiles 0, weighins 0, plans 0 |
| A2 | Template keeps the shared library | **PASS** | 864 foods, 889 recipes (+ taste tiers) |
| A3 | No personal email in the template | **PASS** | `checkDistSafe dev.db.template` → safe |
| A4 | Installer bundles **no** real `.env` / API keys | **PASS** | extraResources ships only `dev.db.template`; `distPrecheck` green |
| A5 | JWT/session secret is **not** shipped | **PASS** | `main.cjs` generates it per-install into userData on first run |
| A6 | No secret in shipping code | **PASS** | `distPrecheck` secret scan green |

## B. Install & first-run (interactive — clean profile)

| # | Check | Result |
|---|-------|--------|
| B1 | Installer runs; SmartScreen "More info → Run anyway" (unsigned) works | PENDING |
| B2 | App launches; no crash, no console errors | PENDING |
| B3 | **Create a NEW local account** (register/first-run path) | PENDING |
| B4 | First-run wizard: units, stats, rate — completes | PENDING |
| B5 | Engine shows a target derived from the entered stats | PENDING |
| B6 | **Generate a meal plan** — a week solves (fully offline, no API key) | PENDING |
| B7 | Add a **weigh-in** | PENDING |
| B8 | **Grocery list** generates from the plan | PENDING |
| B9 | AI/brain features degrade calmly ("AI unavailable"), everything else works | PENDING |

## C. No-owner-data (interactive)

| # | Check | Result |
|---|-------|--------|
| C1 | No pre-filled email / name / login anywhere | PENDING (template has 0 users → expected clean) |
| C2 | No old targets, weigh-ins, or plans from the owner | PENDING (template has 0 profiles/weighins/plans) |
| C3 | Data lives under the new user's account only | PENDING |

## D. Uninstall

| # | Check | Result |
|---|-------|--------|
| D1 | Uninstaller runs and removes the app cleanly | PENDING |
| D2 | (Optional) userData (DB, session secret) handling is acceptable | PENDING |

---

**Status:** the automatic data-safety block (A1–A6) is **PASS** — the installer
carries no secrets and no owner data by construction. The interactive block
(B–D) must be run once on a clean profile/VM before the link is shared. Nothing
ships until it's green.
