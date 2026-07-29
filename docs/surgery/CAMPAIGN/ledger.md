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
