# The bug-fix loop — issue to pushed fix in minutes

Cut Protocol has an in-app bug reporter (Stage D). This is the other half: what
you do when a report arrives. The whole point is that it takes minutes.

## How a report reaches you

1. In the app, an error shows a **"Something went wrong"** dialog with **Report
   this**; there's also **Report a bug** in the sidebar at any time.
2. The reporter shows the user the exact text that will be sent (no weights,
   food logs, names, or allergies — scrubbed and body-free by design), they
   optionally describe what they were doing, and click **Send report**.
3. That opens a **pre-filled GitHub issue** in the browser (no secret token is
   embedded in the app — see `frontend/src/lib/bugReport.js` for why). The user
   clicks **Submit new issue**.
4. The issue lands in **AlbertanCoder/cut-protocol** labeled **`bug-report`**.
   Offline reports are saved and offered again when back online.

Watch for them: <https://github.com/AlbertanCoder/cut-protocol/labels/bug-report>
or `gh issue list --label bug-report`.

## Fixing one (the minutes-long loop)

1. **Grab the issue.** `gh issue view <N>` — or just copy its body.
2. **Paste it to Claude Code** with a one-liner, e.g.:
   > Fix this bug report. Reproduce it, fix it, add a regression test, run the
   > suite, commit and push. Issue #<N>: `<paste the body>`
3. **Claude reproduces + fixes + tests.** The report already carries the app
   version, OS, the error + stack, and the recent activity log (method + path +
   status for the last ~25 calls) — usually enough to pinpoint the failing
   route or component without more back-and-forth.
4. **It commits and pushes** with a message referencing the issue, and the
   regression test means that exact bug can't silently return.
5. **Close the loop.** `gh issue close <N> --comment "Fixed in <sha> — thanks for the report."`

## What's in a report (and what's never in it)

**Included:** app version, OS/arch, packaged-vs-dev, the user's optional
description, the error message + a trimmed stack, and the recent activity log
(HTTP method + path + status, navigations, error types).

**Never included, by construction:** request/response bodies, so no weights,
food logs, plan contents, allergy/diet settings, names, or emails ever enter
the log. A second scrub pass (`frontend/src/lib/scrub.js`) redacts any email,
bodyweight, or token that somehow reached an error string.

## If you want to tighten the loop further later

- A GitHub Action that pings you (or auto-labels by area) when a `bug-report`
  issue opens.
- A tiny relay (serverless function holding a scoped token) so reports file
  silently without the browser hand-off — only worth it if the app ever has
  users beyond you. The current URL approach is deliberately zero-infrastructure
  and zero-secret.
