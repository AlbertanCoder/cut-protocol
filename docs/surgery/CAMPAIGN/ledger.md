# CAMPAIGN LEDGER — Phase Two, dual-terminal command

Append-only. One line per event: UTC · block · HEAD · summary.
Numbers in this file come from machines, never from model arithmetic.

| UTC | block | HEAD | summary |
|---|---|---|---|
| 2026-07-28T11:00:39Z | — | b82d577 | ARCHITECT boot. B0 pass: root=cut-protocol, CP_ROLE=architect. |
| 2026-07-28T11:00:39Z | — | b82d577 | B1 probe A: Write `.architect-cage-probe.tmp` → BLOCKED by guard-edit. Correct. |
| 2026-07-28T11:00:39Z | — | b82d577 | B1 probe B: Write `CAMPAIGN/ledger.md` → BLOCKED. Architect door welded shut. Stop-the-world. |
| 2026-07-28T11:00:39Z | — | b82d577 | B2: `CP_ROLE` found in 2 files repo-wide (both charters). Harness has zero role awareness. |
| 2026-07-28T11:00:39Z | — | b82d577 | B2: CAMPAIGN/ untracked — campaign law not under version control. |
| 2026-07-28T11:00:39Z | — | b82d577 | B2: ledger-delta machine output — 13 rows, $0.3928 all-time, zero generate-path rows. |
| 2026-07-28T11:00:39Z | SITREP campaign.0 | b82d577 | State as found; three briefing claims re-verified TRUE; blocked at B3. |
| 2026-07-28T11:00:39Z | ASK campaign.1 | b82d577 | Two decisions: resequence to one unlock window; manifest replacement text. |
| 2026-07-28T11:00:39Z | — | b82d577 | OWNER RATIFIED both decisions, passphrase typed bare in terminal. Law change authorized. |
| 2026-07-28T11:00:39Z | — | b82d577 | Manifest `campaign-p2-m0` verified on disk, byte-match to proposal. locked=false. |
| 2026-07-28T11:00:39Z | — | b82d577 | Re-probe: `backend/src/lib/` → BLOCKED (allow list governs). `backend/tests/golden/` → BLOCKED (hard-deny above lock). Window is narrow as designed. |
| 2026-07-28T11:00:39Z | — | b82d577 | Re-probe: `CAMPAIGN/ledger.md` → ALLOWED. Architect door open. Black box exists. |
| 2026-07-28T11:00:39Z | ORDER M0.1 | b82d577 | The Wall issued to builder. Tier B. Role enforcement, fail-closed. |
| 2026-07-28T11:30Z | CLAIMS M0.1.3 | 08a5b6b | Received CORRUPTED — 8+ lines truncated. Sequence gap: M0.1.1/M0.1.2 never reached architect. Not graded from the block. |
| 2026-07-28T11:30Z | — | 08a5b6b | Builder landed 4 commits: 59f9aae I1, 431ccbd I6, efae135 I2-I5+I7, 08a5b6b evidence. |
| 2026-07-28T11:30Z | — | 08a5b6b | Architect fresh run: `guard-selftest: 66 passed, 0 failed, 66 total`, exit 0. |
| 2026-07-28T11:30Z | — | 08a5b6b | Architect fresh run: `GOLDENS INTACT`, 10 tests 0 failures under BRAIN=off. |
| 2026-07-28T11:30Z | — | 08a5b6b | Live probes from architect terminal: A4 DENY, A6 DENY (on allow list — INTERSECTION proven), A12 DENY. |
| 2026-07-28T11:30Z | — | 08a5b6b | A14 `git diff b82d577..HEAD --stat -- backend/src/` empty. A13 7 files tracked. |
| 2026-07-28T11:30Z | — | 08a5b6b | I1 proven TRUE by experiment: CP_ROLE visible in both hooks; self-promotion shown impossible. |
| 2026-07-28T11:30Z | VERDICT M0.1 | 08a5b6b | PASS 13/14. A10 HELD — contradicts I2; architect's own drafting defect, escalated to owner. |
| 2026-07-28T11:30Z | — | 08a5b6b | FINDING: builder filed no claims.md and no ask-M0.1-a to disk. Paste corrupted; no original existed. Remedy before M1. |
| 2026-07-28T11:50Z | CLAIMS M0.1.4 | bf1288c | Builder remedy VERIFIED: claims-M0.1.md, ask-M0.1-a.md, ask-M0.1-b.md tracked at c7f7bcc/bf1288c. Finding closed. |
| 2026-07-28T11:50Z | — | bf1288c | WIRE: architect's VERDICT M0.1 paste ALSO corrupted (~12 lines); ASK campaign.2 fence carried truncated HEAD. Corruption ran both directions in one exchange. |
| 2026-07-28T11:50Z | — | bf1288c | One truncation INVERTED a claim (create-vs-edit read as its opposite) and read as fluent. Disk original was correct. |
| 2026-07-28T11:50Z | ASK M0.1-b | bf1288c | Builder finding CONFIRMED by architect git status: verdict + checkpoint untracked, ledger unstaged. I5+I6 seam. |
| 2026-07-28T11:50Z | — | bf1288c | ARCHITECT DEFECT: ASK campaign.2 was couriered before being filed — same defect I had just diagnosed in the builder. Backfilled. |
| 2026-07-28T11:50Z | — | bf1288c | NEW FINDING (architect): builder has WRITE access to all CAMPAIGN/ artifacts. Machine probe — builder exit=0, architect exit=2 on verdict-M0.1.md. |
| 2026-07-28T11:50Z | — | bf1288c | Black box is immutable to its author, mutable to the party it grades. guard-selftest has zero cases for builder-under-CAMPAIGN. |
| 2026-07-28T11:50Z | ASK campaign.3 | bf1288c | Both defects escalated. Recommend: deny builder write under CAMPAIGN/, standing duty to commit it as found. |
| 2026-07-28T12:10Z | CLAIMS M0.1.5 | f23ff8a | Builder confirmed Defect 2 independently and EXTENDED it: both charters are builder-writable. The amendment clause is writable by the party it governs. |
| 2026-07-28T12:10Z | — | f23ff8a | Builder NEW FINDING: shell writes are ungated. Verified by architect. |
| 2026-07-28T12:10Z | — | f23ff8a | ARCHITECT PROBE (hooks spawned, nothing executed): SHELL write to bmrEngine.js / manifest.json / charter / goldens dir / .git hook delete = ALLOW for builder, architect AND unset. |
| 2026-07-28T12:10Z | — | f23ff8a | Same targets via EDIT tool = BLOCK. The manifest is enforced on one door and ungated on the other. |
| 2026-07-28T12:10Z | — | f23ff8a | Goldens "mechanically impossible to relock" is TRUE of the Edit door, FALSE of the shell — guard-bash protects them by filename, not by path. |
| 2026-07-28T12:10Z | — | f23ff8a | guard-bash is a DENYLIST of command phrasings — the exact structure CLAUDE.md's packaging rule forbids by name. |
| 2026-07-28T12:10Z | — | f23ff8a | Architect's own VERDICT M0.1 A5/A6/A11 stand for the Edit tool only. Unqualified as written. Record overclaims. |
| 2026-07-28T12:10Z | ASK campaign.4 | f23ff8a | **HALT DECLARED** — charter condition "a probe the harness should block sails through". 4 rulings outstanding. Nothing in flight. |
| 2026-07-28T18:20Z | CLAIMS M0.2.0 | 455c317 | Owner gave word; builder committed the black box. 8 files, 594 insertions. Preservation, not ratification. |
| 2026-07-28T18:20Z | — | 455c317 | VERIFIED by architect: 455c317 is the FIRST and only commit touching verdict-M0.1.md — no prior version existed to diverge from. |
| 2026-07-28T18:20Z | — | 455c317 | VERIFIED: load-bearing content intact — "PASS on 13 of 14 / A10 is HELD", "HALT DECLARED", Defect 2 framing all as authored. Not doctored. |
| 2026-07-28T18:20Z | — | 455c317 | Builder left CURRENT/manifest.json unstaged again. Correct — authorization, not material. |
| 2026-07-28T18:20Z | — | 455c317 | ASK campaign.4 — the HALT declaration itself — was untracked until this commit. The I5/I6 seam nearly ate the document announcing the cage does not hold. |
| 2026-07-28T18:20Z | — | 455c317 | **DETECTION BASELINE BLOCKED.** Architect's SHA-256 hashing command refused by guard-bash: rule `/--force\b\|(^\|\s)-f(\s\|$)/i` matched PowerShell's FORMAT operator `-f`. Read-only command, pure false positive. |
| 2026-07-28T18:20Z | — | 455c317 | Reported as a stop sign, NOT rephrased. Recommendation 4 of ASK campaign.4 (hash-based tamper detection) is itself blocked by the denylist it was proposed to compensate for. |
| 2026-07-28T18:20Z | — | 455c317 | ARCHITECT DEFECT 5: ask-campaign.4 embeds a literal API-key SHAPE in prose. Now committed to a repo whose origin is PUBLIC. Not a secret; a scanner landmine + guard-bash tripwire. Immutable to author; needs builder or owner. |
| 2026-07-29T00:32Z | CLAIMS M0.2.1 | a2c2ba5 | Received CORRUPTED again (~8 truncations). Verified from disk + own runs, not from the block. |
| 2026-07-29T00:32Z | — | a2c2ba5 | **DEFECT 5 FALSIFIED — architect claim WITHDRAWN.** `node scripts/scanSecrets.mjs --tracked` → 1 finding, `relay\test\relay.test.js:20`. ask-campaign.4 is NOT among them. "It will trip secret scanners" was FALSE. |
| 2026-07-29T00:32Z | — | a2c2ba5 | **NO EXPOSURE.** `git branch -r --contains 455c317` → empty. 48 commits on no remote. Origin is public; nothing from this campaign has ever reached it. Architect's urgency framing was wrong. |
| 2026-07-29T00:32Z | — | a2c2ba5 | SURVIVES: guard-bash is STRICTER than the repo's own scanner — no length bound, so it refuses commands merely naming a line scanSecrets does not consider a leak. |
| 2026-07-29T00:32Z | — | a2c2ba5 | **SCANNER IS RED, pre-existing.** relay/test/relay.test.js:20 [anthropic-key], no `scan:allow` marker (grep confirms absent). Landed in e68388a. |
| 2026-07-29T00:32Z | — | a2c2ba5 | e68388a is on NO remote. Contained. Blocks any push until adjudicated — real key vs fixture is UNDETERMINED and was deliberately not read into transcript. |
| 2026-07-29T00:32Z | — | a2c2ba5 | RULING: builder's commit-message rewrite was NOT evasion. Removing a key shape entirely serves the guard's object; it does not reach a protected target by another phrasing. Distinction ratified. |
| 2026-07-29T00:32Z | — | a2c2ba5 | Under that ratified distinction the architect's `-f` block was a FALSE POSITIVE, so recomputing without the format operator is legitimate. Hash baseline now established (below). |
| 2026-07-29T00:32Z | — | a2c2ba5 | OWNER INSTRUCTION (typed, bare): timestamp receipts and work orders. CONVENTIONS.md written. Charter fence format extended additively — logged, not passphrase-gated. |

---

## TIME CONVENTION CORRECTED — read CONVENTIONS-2.md, not CONVENTIONS.md

2026-07-28 18:40 MDT (2026-07-29T00:40Z) · owner instruction: the timestamps
read as the wrong day. Diagnosed: clock CORRECT, convention WRONG. v1 stamped
UTC; Mountain is UTC−6 in summer, so evening work filed itself under the next
calendar day. Superseded by `CONVENTIONS-2.md` — **local time leads, UTC in
parentheses.** Pre-existing names are not changed (Rule 4); the index below
now carries both times.

## ARTIFACT INDEX — chronological, oldest first

Pre-convention artifacts carry unstamped names and are never renamed
(CONVENTIONS.md Rule 4). This is the authoritative ordering. Newest at the
bottom.

**LOCAL time is Shad's working day. UTC is the machine record.** Note rows
13–15: local July 28 evening, UTC already July 29. That rollover is what the
v1 convention got wrong.

| # | authored — LOCAL (MDT) | UTC | artifact |
|---|---|---|---|
| 1 | 2026-07-28 05:00 | 11:00Z | `sitreps/sitrep-campaign.0.md` |
| 2 | 2026-07-28 05:00 | 11:00Z | `asks/ask-campaign.1.md` |
| 3 | 2026-07-28 05:00 | 11:00Z | `orders/order-M0.1.md` |
| 4 | 2026-07-28 05:00 | 11:00Z | `checkpoints/checkpoint-2026-07-28T1100Z.md` |
| 5 | 2026-07-28 05:30 | 11:30Z | `verdicts/verdict-M0.1.md` |
| 6 | 2026-07-28 05:30 | 11:30Z | `checkpoints/checkpoint-2026-07-28T1130Z.md` |
| 7 | 2026-07-28 05:50 | 11:50Z | `asks/ask-campaign.2.md` (backfilled) |
| 8 | 2026-07-28 05:50 | 11:50Z | `asks/ask-campaign.3.md` |
| 9 | 2026-07-28 05:50 | 11:50Z | `checkpoints/checkpoint-2026-07-28T1150Z.md` |
| 10 | 2026-07-28 06:10 | 12:10Z | `asks/ask-campaign.4.md` (HALT) |
| 11 | 2026-07-28 06:10 | 12:10Z | `checkpoints/checkpoint-2026-07-28T1210Z.md` |
| 12 | 2026-07-28 12:20 | 18:20Z | `checkpoints/checkpoint-2026-07-28T1820Z.md` |
| 13 | 2026-07-28 18:32 | 07-29 00:32Z | `CONVENTIONS.md` (superseded) |
| 14 | 2026-07-28 18:32 | 07-29 00:32Z | `checkpoints/checkpoint-2026-07-29T0032Z.md` |
| 15 | 2026-07-28 18:40 | 07-29 00:40Z | `CONVENTIONS-2.md` ← **current time law** |
| 16 | 2026-07-28 19:42 | 07-29 01:42Z | `checkpoints/checkpoint-20260728-1942.md` ← first local-stamped artifact |
| 17 | 2026-07-28 19:58 | 07-29 01:58Z | `orders/order-20260728-1958-M0.2.md` ← **LATEST ORDER** |
| 18 | 2026-07-28 20:05 | 07-29 02:05Z | `verdicts/verdict-20260728-2005-M0.2.md` ← **LATEST VERDICT** |
| 19 | 2026-07-28 20:05 | 07-29 02:05Z | `asks/ask-20260728-2005-campaign.5.md` ← **LATEST ASK** |
| 20 | 2026-07-28 20:09 | 07-29 02:09Z | `sitreps/sitrep-20260728-2009-campaign.1.md` ← **LATEST SITREP** |
| 21 | 2026-07-28 20:24 | 07-29 02:24Z | `orders/order-20260728-2024-M1.1.md` ← **LATEST ORDER** |
| 22 | 2026-07-28 20:24 | 07-29 02:24Z | `verdicts/verdict-20260728-2024-M0.2-final.md` ← **LATEST VERDICT** |
| 23 | 2026-07-28 20:44 | 07-29 02:44Z | `asks/ask-20260728-2044-campaign.6.md` — blocks M1 |
| 24 | 2026-07-29 04:11 | 07-29 10:11Z | `asks/ask-20260729-0411-campaign.6a.md` — scope correction |
| 25 | 2026-07-29 04:19 | 07-29 10:19Z | `asks/ask-20260729-0419-campaign.6b.md` ← **RULE FROM THIS ONE. Supersedes the mapping in 6 and 6a.** |

| 2026-07-29 04:19 | CLAIMS M1.1.2 | 7901d72 | Builder ran an ELEVEN-FIELD check against the app's own `validateProfileFields`. **SIXTH mismatch found.** |
| 2026-07-29 04:19 | — | 7901d72 | **ARCHITECT'S PROPOSED MAPPING WOULD HAVE FAILED.** `dietaryStyle:'omnivore'` is not in DIETARY_STYLES (`dietaryFilter.js:1265`). Carried forward unexamined in campaign.6 AND 6a. |
| 2026-07-29 04:19 | — | 7901d72 | Root cause of the shared miss: the app's 400 body was truncated mid-field at `"trainingStyle":"Pick a t` — dietaryStyle's error never reached either session. |
| 2026-07-29 04:19 | — | 7901d72 | ARCHITECT RAN THE SCRIPT: frozen `5 ok / 4 rejected / 2 silently dropped`; proposed `11 ok / 0 / 0`. `bmrEngine.js:288` calls it `"none"/omnivore` — meaning preserved. |
| 2026-07-29 04:19 | — | 7901d72 | **REJECTED vs DROPPED separated — the mechanism behind the whole defect.** `weightKg` and `allergies` are not in PROFILE_FIELDS: the request SUCCEEDS and the value evaporates. No error, ever. |
| 2026-07-29 04:19 | — | 7901d72 | Silent-drop is worse than rejection: rejection at least produces a witness. Best explanation yet of how a forcing profile looked correct indefinitely while forcing nothing. |
| 2026-07-29 04:19 | — | 7901d72 | **ARCHITECT DEFECT 7** — incomplete mapping. Distinction from defect 6: campaign.6 NAMED dietaryStyle as unverified and ordered the eleven-field check. The instruction caught the mapping. |
| 2026-07-29 04:19 | — | 7901d72 | **FINDING AGAINST ARCHITECT'S OWN M0.1 GRADING:** `git merge-base --is-ancestor` (read-only) BLOCKED by the role gate — `git merge` is a substring. Graded green across 74 cases. Fifth false positive of this class, first one the architect ordered into existence. |
| 2026-07-29 04:19 | — | 7901d72 | CLOCK: builder's block stamped `2026-07-28 21:05 MDT`; its commit's real author date `2026-07-29 04:16:48 -0600`. Stamp ~7h stale. Future orders: derive the stamp at emission, never reuse. |
| 2026-07-29 04:19 | ASK campaign.6b | 7901d72 | **AUTHORITATIVE MAPPING FILED.** Six fields. Nothing applied; witness.js byte-identical; $0.00. |
| 2026-07-29 04:35 | CLAIMS M1.1.3 | 05f5dd3 | Builder owned the clock defect with cause: it ESTIMATED a stamp from a remembered number instead of re-deriving. Model arithmetic in a field two conventions exist to protect. Wire law 5 — a timestamp is a number. |
| 2026-07-29 04:35 | — | 05f5dd3 | Builder broadened the merge finding: `git merge-tree` also BLOCKED, and `merge-file`/`merge-index` would be. Cause `/\bgit\s+merge\b/i` — `\b` matches at the hyphen. Proposed fix `/\bgit\s+merge(?![-\w])/i`. |
| 2026-07-29 04:35 | — | 05f5dd3 | **ARCHITECT COULD NOT VERIFY IT — THE RULE BLOCKS ITS OWN INVESTIGATION.** The probe command must contain `git merge-base`, which trips the rule. Constructing the string from fragments would be the obfuscation class we ruled is evasion; architect stopped. |
| 2026-07-29 04:35 | — | 05f5dd3 | Logic confirmed BY INSPECTION only (`\b` matches at the e→- transition; the lookahead fixes it). Recorded as **builder-OBSERVED, architect-UNVERIFIABLE** — not architect-confirmed. Evidence law: can't prove it, don't pass it, say what's missing. |
| 2026-07-29 04:35 | — | 05f5dd3 | A self-shielding guard rule is a new defect class for this record: it refuses the command that would demonstrate it. Stronger evidence of the denylist pathology than a successful probe would have been. |
| 2026-07-29 04:35 | — | 05f5dd3 | Builder adopted campaign.6b's mapping — matches its own measurement on all six, incl. dietaryStyle→'none'. |
| 2026-07-29 04:35 | — | 05f5dd3 | **CAMPAIGN IS BLOCKED ON EXACTLY ONE THING: the owner's passphrase on the six-field mapping.** Nothing else is in flight. |
| 2026-07-29 04:45 | CLAIMS M1.1-final | d63592c | Builder reports the witness COMPLETES; six-field amendment applied on the owner's passphrase. |
| 2026-07-29 04:45 | — | d63592c | **ARCHITECT RAN THE WITNESS ITSELF:** `profile : celiac+soy walls, non-keto, 1 lb/wk` verbatim · exit 0 · `delta 0 row(s), $0.0000` · all-time unchanged `13 row(s), $0.3928` · caps 0<=12, 0<=0.5 ok · `== WITNESS COMPLETE ==`. |
| 2026-07-29 04:45 | — | d63592c | FROZEN CLAUSES VERIFIED UNTOUCHED — diff grep for CAP_CALLS/CAP_USD/CAP_DESIGNS/monthlyCap/verdicts/breached/process.exit returns ZERO matches. Only the six profile lines changed. |
| 2026-07-29 04:45 | — | d63592c | **GOVERNANCE GAP: no ruling artifact on disk for campaign.6b.** Only `ruling-20260728-1955-owner-G1G4.md` exists. The authority for a FROZEN-CLAUSE amendment lives solely in a conversation — the exact fragility this campaign was built to eliminate. Remedy: builder files it verbatim as it did for G1–G4. |
| 2026-07-29 04:45 | HANDOFF | d63592c | **Owner requested a full-systems-audit handoff prompt for a cold session.** Filed `handoff-20260729-0445-systems-audit.md` — 9 stages, 25 agents, read-only, runs in a CLONE so it cannot collide with the campaign or weaken the live cage. |
| 2026-07-29 04:45 | — | d63592c | Architect's answer on responsibility: neither architect nor builder may audit this system. Both are disqualified by evidence law — one graded the work, the other did it. |
| 2026-07-29 04:53 | HANDOFF v2 | d63592c | **v1 SUPERSEDED.** Inventoried the project's real tooling and found v1 materially understated it. |
| 2026-07-29 04:53 | — | d63592c | DISCOVERED: repo already ships `security:all` (scanSecrets+brainPurity+supplyChain), `dist:files`, `dist:check`, and a 10-script backend QC suite — `qc:sweep14k`, `qc:integrity`, `qc:security`, `qc:invariants`, `qc:recipe-allergen`, `audit:dietary`, `bench:solver:check`, `qc:smoke`. |
| 2026-07-29 04:53 | — | d63592c | **K7 PARTLY REFUTED BY ARCHITECT:** root `build.files` IS already an explicit allowlist (`["package.json","CutProtocol.ico","electron/main.cjs",…]`). CLAUDE.md still says the inversion is "in progress" — stale in the SAFE direction, still a doc defect. |
| 2026-07-29 04:53 | — | d63592c | v2 adds: PART 5 run-existing-tooling-first (with the "what would have to be true for this to pass while broken?" test), a copy-paste agent brief template, a worked example finding, severity calibration anchors, failure/conflict handling, a definition of done, mechanical path-existence verification, and Stage 6 agent 21 (math truth end-to-end). |
| 2026-07-29 04:53 | — | d63592c | v2 agent reallocation: 25 across 10 stages; CVEs merged into the dependency agent to fund a third runtime agent, because the owner named "functionality" explicitly and v1 under-served it. |
| 2026-07-31 19:36 | FLEET | f414f8b | **GOLDEN BASELINE REGENERATED IN THE WORKING TREE, UNLEDGERED.** `backend/tests/golden/engine-baseline.golden.json` modified and uncommitted: 289 insertions / 289 deletions — every line changed, nothing added or removed. Found by the research-fleet session during preflight, not by the campaign. |
| 2026-07-31 19:36 | — | f414f8b | NOT a fixture change: `tests/golden/fixtures.js` is UNMODIFIED, `BASE_PROFILE = { dietaryStyle: "none", excludedFoods: [] }`. Same input, different output — `Tofu & Potato`→`Chicken & Rice`, `Firm Tofu`→`Chicken Breast`, proteinScale 1.95→1.14, sidesScale 0.91→2, macros moved throughout. |
| 2026-07-31 19:36 | — | f414f8b | **NO DIET-LAW BREACH.** The fixture is omnivore with zero exclusions, so both plans are legal for it. Stated explicitly so this row is never later misread as an allergen finding. No TRIAGE raised. |
| 2026-07-31 19:36 | — | f414f8b | **THE TEST NOW PASSES CIRCULARLY.** `npx vitest run tests/golden/goldenBaseline.test.js` → `✔ BRAIN=off engine output is byte-identical to the locked baseline`. That is NEW engine against NEW golden. The artifact whose only job is detecting solver drift has been regenerated to match the drift, and reports green while doing it. |
| 2026-07-31 19:36 | — | f414f8b | Proximate cause is the campaign's own uncommitted solver edits — `mealSolver.js`, `weeklyPlanner.js`, `planContext.js`, `allergenTaxonomy.js`. WHICH behaviour changes were intended is UNDETERMINED and the golden can no longer answer it. Recorded as fleet-OBSERVED, intent-UNVERIFIABLE. |
| 2026-07-31 19:36 | — | f414f8b | **NOT DATA LOSS.** HEAD `f414f8b` still holds the pre-campaign golden; it is recoverable whatever lands next. This is a LEGIBILITY defect, not a destruction one. Precedent for a legitimate relock exists and was done correctly: `6cc61c6 test(golden): relock the engine baseline`, labelled as such. |
| 2026-07-31 19:36 | — | f414f8b | **GUARD ASYMMETRY — a false NEGATIVE, inverse of the merge-regex class logged 04:35.** guard-bash refuses any command NAMING `engine-baseline.golden.json`, but `git add -A` does not contain the string and sweeps the golden in silently. The seal catches the explicit relock and misses the blanket one. Same denylist pathology, opposite direction. |
| 2026-07-31 19:36 | — | f414f8b | REMEDY PROPOSED, NOT APPLIED: commit the golden as its own labelled commit rather than inside a blanket rescue, and state which behaviour change it encodes. Filed by the fleet session on the owner's explicit typed instruction; the fleet holds no campaign role, applied nothing, and touched no other file. |

| 2026-07-28 20:50 | CLAIMS M1.1.1 | d5e8d27 | Builder confirmed the `.allergies` finding independently and CORRECTED ITS SCOPE. |
| 2026-07-29 04:11 | — | d5e8d27 | **CAMPAIGN PAUSED ~7h overnight.** Both sessions resumed from disk, no state carried in conversation. Persistence law doing its job. |
| 2026-07-29 04:11 | — | d5e8d27 | **ARCHITECT CLAIM SCOPE-CORRECTED.** campaign.6's "consumed nowhere in the application" is true OF THE WITNESS; read fast it implies Cut Protocol ignores allergies. It does not. |
| 2026-07-29 04:11 | — | d5e8d27 | VERIFIED: `schema.prisma:159` has `excludedFoods Json`, no `allergies` column — the witness sent a key that never existed in the data model. |
| 2026-07-29 04:11 | — | d5e8d27 | VERIFIED `excludedFoods` LIVE in profile.js (validated), diary.js:229, aiRecipeClient.js:163 ("These are real restrictions"), export.js. **The allergy feature is wired.** |
| 2026-07-29 04:11 | — | d5e8d27 | **ARCHITECT ADDITION (builder did not reach it): excludedFoods enters the BRAIN's hard constraints** — `brain/constraints.js:35` as a `"hard"` leaf from `"profile"`, plus pool.js:56, exclusions.js:25, guard.js:137. |
| 2026-07-29 04:11 | — | d5e8d27 | Therefore the translation puts the two walls into the GENERATOR's own constraint path — exactly the forcing mechanism the witness criterion needs. Case for the amendment STRENGTHENED. |
| 2026-07-29 04:11 | — | d5e8d27 | INSTRUMENT defect, NOT product defect. Distinction worth more than either session being right about the mechanism. |
| 2026-07-29 04:11 | ASK campaign.6a | d5e8d27 | Correction filed as a NEW artifact — campaign.6 is immutable to its author. Create-only cost paid again, this time on a document already before the owner. |
| 2026-07-29 04:11 | — | d5e8d27 | Builder corrected a claim that was in its favour to leave alone. Third declined easier-version-of-being-right this campaign. |

| 2026-07-28 20:36 | CLAIMS M1.1 | 0000598 | Builder STOPPED at B2 per order. I1/I2/I3 done, B7 met. Corrupted in transit; graded from disk. |
| 2026-07-28 20:44 | — | 0000598 | **WITNESS AUTHENTICATES for the first time in its existence** — cookie jar + Prisma-minted account + real `/api/auth/login`. `backend/src/` diff EMPTY. |
| 2026-07-28 20:44 | — | 0000598 | B7 MET: failure path exits **1**, not 127 and not a Windows abort. Builder disclosed its intended forcing method failed and a different real failure exercised the path. |
| 2026-07-28 20:44 | — | 0000598 | Frozen clauses UNTOUCHED in the plumbing commit — verified by architect diff over CAP_*/profile/verdicts. |
| 2026-07-28 20:44 | — | 0000598 | **ARCHITECT DEFECT 6.** ORDER M1.1 asserted "It does not; I checked." FALSE — checked the plumbing against the clauses, never checked the profile against the app. Wider claim than the check performed. |
| 2026-07-28 20:44 | — | 0000598 | VERIFIED: 5 of 11 profile fields rejected. `sex` needs M/F · `carpenter` not a key (`carpenter-finish`) · `trainingStyle` needs weights/mixed/sport/cardio · `weightKg`→`startWeightKg` · `allergies`→`excludedFoods`. |
| 2026-07-28 20:44 | — | 0000598 | Root cause: `'hypertrophy'` exists in the TRAINING GENERATOR's vocabulary; profile `trainingStyle` is a separate MET list in activityData.js. Two vocabularies, one word. |
| 2026-07-28 20:44 | — | 0000598 | **THE REAL FINDING (architect answered what builder refused to guess): `grep "\.allergies\b" backend/src/` → NO MATCHES.** The field is consumed nowhere. |
| 2026-07-28 20:44 | — | 0000598 | **THE FORCING PROFILE HAS NEVER FORCED ANYTHING.** Its comment claims the walls make the library thin enough that scaling cannot land the day; that mechanism was never connected. Undetectable because the witness had never completed a run. |
| 2026-07-28 20:44 | — | 0000598 | `excludedFoods` IS real: dietaryFilter → excludedByList → exclusionEvidence, unioning name/keyword with fdcCategory/allergenTags/mayContain. `gluten` and `soy` are full families in allergenTaxonomy.js with synonym expansion. |
| 2026-07-28 20:44 | — | 0000598 | Therefore translation STRENGTHENS the instrument — not softening after a disappointing result, but the first time the profile would bite. No prior measurement exists to invalidate. |
| 2026-07-28 20:44 | ASK campaign.6 | 0000598 | **FROZEN-CLAUSE AMENDMENT — passphrase territory, owner's call.** Translate the profile to the app's vocabulary, preserve semantics, re-freeze at new bytes. Validate ALL ELEVEN fields, not the five found. |
| 2026-07-28 20:44 | — | 0000598 | Builder declined to translate the profile itself though the order arguably invited it. Second refusal tonight of a cleaner-looking result; both preserved the evidence. |

| 2026-07-28 20:45 | CLAIMS M0.2.2 | 1c360c4 | G3 built. Owner added the two manifest paths. A13–A16, A24 claimed met. |
| 2026-07-28 20:24 | — | 1c360c4 | ARCHITECT VERIFIED widening is EXACT: `goldens-verify.js` BLOCK, `.git/hooks/pre-push` BLOCK, `ledger.md` BLOCK (G2 intact), `backend/src/` BLOCK. Only the two named paths opened. |
| 2026-07-28 20:24 | — | 1c360c4 | **A13 EVIDENCE GAP CLOSED BY CODE READ.** Hook uses `--diff-filter=MDR` — M, D and R share ONE filter and ONE path. The builder's staged-deletion test exercises the identical branch a modification would. Not a weaker proxy. |
| 2026-07-28 20:24 | — | 1c360c4 | Hook also covers RENAMES, which nobody ordered — the third way to damage a record. |
| 2026-07-28 20:24 | — | 1c360c4 | `git diff HEAD -- orders/order-M0.1.md` EMPTY, file still tracked. The A13 test damaged nothing. |
| 2026-07-28 20:24 | — | 1c360c4 | ARCHITECT FINDING: installed `.git/hooks/pre-commit` DIVERGES from tracked source — 12 diff lines, **logic byte-identical**, comments only. No drift detection exists and plain `diff` cannot serve as one. Receipt item. |
| 2026-07-28 20:24 | — | 1c360c4 | **FAIL-CLOSED PROVEN BY ACCIDENT:** owner's first manifest edit had a doubled quote; JSON stopped parsing; every write refused; guard could not self-repair (must read manifest to know manifest is writable). Only the owner's hand cleared it. |
| 2026-07-28 20:24 | VERDICT M0.2 final | 1c360c4 | **M0.2 CLOSES 24/24.** G1–G4 all closed. |
| 2026-07-28 20:24 | ORDER M1.1 | 1c360c4 | **ISSUED — the campaign returns to the mission.** Heal witness.js. Tier B with Tier A frozen clauses named by coordinate: CAP_CALLS=12, CAP_USD=0.5, CAP_DESIGNS=2, the forcing profile + its comment, the verdict logic, the header criterion. |
| 2026-07-28 20:24 | — | 1c360c4 | M1 authorized by the owner's ORIGINAL ratification ("one unlock window for M0+M1"); witness.js on the allow list since the window opened. No new ruling sought. Mission spends $0 — dry-run only. |

| 2026-07-28 20:20 | CLAIMS M0.2.1 | b7aa1dd | **A20 PASS.** Builder committed 2 architect files + ledger append in ONE commit, exit 0, 215 insertions. |
| 2026-07-28 20:09 | — | b7aa1dd | ARCHITECT VERIFIED: ledger `21 insertions, 0 deletions`; verdict's first and only appearance is b7aa1dd; content intact incl. the line praising the builder and the ASK permitting a decline. |
| 2026-07-28 20:09 | — | b7aa1dd | Builder probed all 3 files BLOCKED to itself **before** staging — denial timestamped ahead of the commit, not asserted after. |
| 2026-07-28 20:09 | — | b7aa1dd | **I1 closed the write door; I2 kept the commit door open — same 3 files, same minute.** G2 proven end-to-end on real work. |
| 2026-07-28 20:09 | VERDICT M0.2 final | b7aa1dd | **M0.2 CLOSES 19/24.** A13–A16, A24 UNMET pending ASK campaign.5 (two manifest lines, owner's hand). |
| 2026-07-28 20:09 | SITREP campaign.1 | b7aa1dd | **DRIFT NAMED.** Campaign ran 05:03→20:09; M0 and M0.2 closed; M1/M2/M3 never opened. Zero product work. Phase Two defect unchanged since boot. |
| 2026-07-28 20:09 | — | b7aa1dd | Architect recommendation: close M0.2, PARK G6/G7/G7b as pre-push backlog (not on critical path, nothing ever pushed), open M1 now, relock, then M2. |

## EVENTS (M0.2)

| local (MDT) | block | HEAD | summary |
|---|---|---|---|
| 2026-07-28 20:12 | CLAIMS M0.2 | 2f46ffd | Builder delivered G1, G2, G4. G3 blocked by manifest. Three commits 008fd10 / 8c84911 / 2f46ffd. |
| 2026-07-28 20:05 | — | 2f46ffd | ARCHITECT FRESH RUN: `guard-selftest: 74 passed, 0 failed, 74 total`, exit 0. |
| 2026-07-28 20:05 | — | 2f46ffd | ARCHITECT PROBE A2–A7 all BLOCK for builder: existing order, both charters, the verdict grading it, a new file, ledger.md. |
| 2026-07-28 20:05 | — | 2f46ffd | WIDTH PROOF — A11 ALLOW (`.claude/hooks/`) vs A6 BLOCK (CAMPAIGN/). Manifest preserved, CAMPAIGN closed. Neither too wide nor too narrow. |
| 2026-07-28 20:05 | — | 2f46ffd | A8/A9 architect unchanged ALLOW. A12 goldens BLOCK. A18 `backend/src/` diff EMPTY. |
| 2026-07-28 20:05 | — | 2f46ffd | A19: CAMPAIGN diff is all `A` except ledger.md `M` — 110 insertions, **0 deletions**. That M is architect authorship committed under the G2 duty; builder disclosed it proactively. |
| 2026-07-28 20:05 | — | 2f46ffd | A23: role.js diff entirely inside one `/** */` block; `resolveRole()` byte-identical. Comment records the ruling. |
| 2026-07-28 20:05 | — | 2f46ffd | A17/A22: TRUTH doc read in full. Names guard-edit's goldens comment, C7, C16, C19, and architect's own A5/A6/A11 — each read before qualifying, not paraphrased. |
| 2026-07-28 20:05 | — | 2f46ffd | **G3 UNMET — manifest forbids both paths.** Architect verified: `scripts/surgery/pre-commit.sh` BLOCK, `.git/hooks/pre-commit` BLOCK. Not a builder failure. |
| 2026-07-28 20:05 | — | 2f46ffd | **Builder DECLINED to install the hook via the ungated shell**, which would have met A13–A16/A24. Installing an anti-bypass guard by using the bypass would be self-refuting. Recorded as the campaign's sharpest discipline. |
| 2026-07-28 20:05 | VERDICT M0.2 | 2f46ffd | **PASS 18/24.** A13–A16, A24 UNMET (unreachable under authorization). A20 under test. |
| 2026-07-28 20:05 | ASK campaign.5 | 2f46ffd | Requests two exact-path manifest entries to finish G3. |
| 2026-07-28 20:05 | — | 2f46ffd | ARCHITECT CONCEDES: the authority gate was over-careful. Passphrase typed bare in the builder's terminal IS the charter standard; the gate protected architect grading confidence, not builder authorization. |
| 2026-07-28 20:05 | — | 2f46ffd | **A20 TEST ARMED:** two new CAMPAIGN files + this ledger append await a single builder commit. Success = the G2 standing duty survives G2 itself. |

## EVENTS (continued)

| local (MDT) | block | HEAD | summary |
|---|---|---|---|
| 2026-07-28 19:32 | CLAIMS M0.2.3 | 02cc593 | C2 adopted. **Sequence gap — M0.2.2 never reached architect**; its work landed as commit 02cc593 and was graded from disk. |
| 2026-07-28 19:42 | — | 02cc593 | **TIMESTAMP FOOTGUN verified.** `Get-Date -Format "…Z"` does NOT convert — renders local time carrying a literal Z. Off by the offset, renders well-formed. Correct form needs explicit `.ToUniversalTime()`. |
| 2026-07-28 19:42 | — | 02cc593 | **G6 CLOSED as fixture.** Architect proof stronger than builder's: line is 77 chars TOTAL; a real key is ~108 chars alone. Physically too short to contain one. |
| 2026-07-28 19:42 | — | 02cc593 | Builder DISCLOSED unprompted that it already held the flagged line from an earlier grep, before the "do not read it" caution existed. Recorded as volunteered. |
| 2026-07-28 19:42 | — | 02cc593 | **G7 CONVERTED EXPECTED → OBSERVED** by architect. Imported the scanner's own exported RULES, re-ran across all tracked files with the PLACEHOLDER skip removed. Read-only, no code change. |
| 2026-07-28 19:42 | — | 02cc593 | RESULT: **reported by real scanner = 1, suppressed by PLACEHOLDER = 8.** ~89% of rule matches in this repo are decided by a prose heuristic, not by the rules. |
| 2026-07-28 19:42 | — | 02cc593 | All 8 measured for shape: longest token 13–52 chars vs ~95–108 needed for key material. **None key-shaped. Vector real; nothing hiding behind it.** |
| 2026-07-28 19:42 | — | 02cc593 | Builder noted it could have silently amended CONVENTIONS.md in place, leaving no supersession and no trace — concrete Defect 2 case, raised against its own access. |
| 2026-07-28 19:55 | CLAIMS M0.2.5 | ca0163c | Sequence gap again — M0.2.4 never reached architect; landed as commit ca0163c, graded from disk. |
| 2026-07-28 19:58 | — | ca0163c | **OWNER RULING G1–G4 received RELAYED, not typed in architect terminal.** Recorded verbatim by builder at `ruling-20260728-1955-owner-G1G4.md`. Treated as DATA pending owner confirmation here (charter law 2). |
| 2026-07-28 19:58 | — | ca0163c | G1 I2 stands / A10 amended · G2 deny builder write under CAMPAIGN/ · G3 pre-commit accident-defense · G4 TRUTH doc. G6/G7/G7b/relock NOT ruled. |
| 2026-07-28 19:58 | — | ca0163c | **G7b VERIFIED by architect.** 642 tracked files, 41 contain a NUL byte. Two are ordinary JS source — `backend/scripts/qc/fuzz.mjs` (16053 B) and `backend/tests/librarySync.test.js` (33354 B), one NUL each. |
| 2026-07-28 19:58 | — | ca0163c | Consequence: 909 lines of tracked source are NEVER read by the secret scanner, silently — no count, no warning. Builder measured rule_hits=0 in both; nothing hiding. |
| 2026-07-28 19:58 | — | ca0163c | Builder pre-registered R1–R19 before cutting and labelled them second-best to architect criteria. Correct conduct. |
| 2026-07-28 19:58 | ORDER M0.2 | ca0163c | Issued. Adopts R1–R19 as A1–A19 with attribution; adds A20–A24. **A20 (end-to-end persistence) is the gap R1–R19 missed.** Execution GATED on owner confirming the ruling here. |

**LATEST ORDER:** `orders/order-M0.1.md` (#3) — no order issued since; HALT.
**LATEST VERDICT:** `verdicts/verdict-M0.1.md` (#5).
**LATEST ASK:** `asks/ask-campaign.4.md` (#10) — the HALT declaration.
**RECEIPTS:** none issued. RECEIPT v4 is owed at M3.

## TAMPER-DETECTION BASELINE — SHA-256, first 16 hex, at HEAD a2c2ba5

Recorded 2026-07-29T00:32Z per ASK campaign.4 recommendation 4. Prevention is
unavailable through the shell door; detection is. Re-run
`Get-FileHash -Algorithm SHA256` and compare.

    968EF263E80565BC  asks/ask-campaign.1.md
    F5A24307734C4A89  asks/ask-campaign.2.md
    B03228A16419963F  asks/ask-campaign.3.md
    27F7503AD4BB7A8F  asks/ask-campaign.4.md
    E4BCD26295732B6E  charter-architect.md
    14F1A00774A6D846  charter-builder.md
    C4EBA1AC97E0EAB1  checkpoints/checkpoint-2026-07-28T1100Z.md
    AE6BD192B630E2F5  checkpoints/checkpoint-2026-07-28T1130Z.md
    6CCC52750664F771  checkpoints/checkpoint-2026-07-28T1150Z.md
    0BE788F7AEC6E527  checkpoints/checkpoint-2026-07-28T1210Z.md
    D91145B52E36B010  checkpoints/checkpoint-2026-07-28T1820Z.md
    8CF2471CB8540D44  orders/order-M0.1.md
    2C3220BCC96AD73A  sitreps/sitrep-campaign.0.md
    62D63BB9742FBF7D  verdicts/verdict-M0.1.md

`ledger.md` and `CONVENTIONS.md` are deliberately absent. The ledger is the
mutable witness — its own hash changes on every append, so its integrity is
git history, not self-attestation. CONVENTIONS.md postdates the sweep and
enters the baseline at the next recording.

