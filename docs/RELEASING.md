# Releasing Cut Protocol

How a fix that lands in this repo reaches a copy of the app someone else is
already running.

Before this existed, it didn't. A built copy was frozen at the version it was
installed at — including any allergen or solver bug it shipped with. That is
the failure mode this whole document exists to close.

---

## 0. What the update channel actually is

- **`electron-updater`** (root dependency) checking **GitHub Releases** for
  `AlbertanCoder/cut-protocol` (configured in root `package.json` →
  `build.publish`).
- The check runs **8 seconds after the window is already open**, never before
  it. Nothing on the boot path waits for the network.
- Offline is not an error. A failed check writes one line to the log and is
  never shown to the user, unless the user explicitly clicked
  "Check for updates" — then it says so honestly.
- The download happens in the background; the user is asked before any
  restart. Deferring installs it on the next quit.
- Wiring: `electron/updater.cjs`, called from `electron/main.cjs`.

**Only NSIS installer builds auto-update.** A portable/zip build has no
updater. Keep shipping `nsis` (already the only `win.target`).

---

## 1. One-time setup (owner, once)

### 1.1 Install the dependency

```
npm install
```

(`electron-updater` was added to root `package.json`; a tree that hasn't run
this yet still boots — `updater.cjs` requires it lazily and logs that updates
are unavailable.)

### 1.2 Create a GitHub token

A classic personal access token with the **`repo`** scope (public repos need
`public_repo` at minimum; `repo` is fine).

- <https://github.com/settings/tokens>
- **The token never goes in this repo.** No `.env`, no `electron-builder.yml`,
  no CI file in this project. It exists only as an environment variable in the
  shell you publish from.

---

## 2. Cutting a release

### 2.1 Bump the version

`package.json` → `"version"`. electron-updater compares this to the version in
the published `latest.yml`, so **a release with an unchanged version will
never be offered to anyone.**

Use plain semver: `1.0.0` → `1.0.1` for a fix, `1.1.0` for a feature.

### 2.2 Verify the build is safe to share

```
npm run scan:secrets        # tracked files: keys, seeds, personal data
npm run security:all        # + brain purity + supply chain
```

`predist` also runs `scripts/distPrecheck.mjs` automatically.

### 2.3 Publish

PowerShell:

```powershell
$env:GH_TOKEN = "ghp_xxx"      # this shell only — never committed, never in a file
npm run release
Remove-Item Env:\GH_TOKEN      # clear it when you're done
```

Bash / Git Bash:

```bash
GH_TOKEN=ghp_xxx npm run release
```

`npm run release` = build the frontend, then `electron-builder --publish always`.
It creates (or updates) a **draft** GitHub release for the tag matching the
version and uploads:

- `Cut Protocol Setup <version>.exe` — the installer
- `latest.yml` — the manifest electron-updater reads
- `*.blockmap` — differential-download map

### 2.4 Check the artifacts, then publish the release

Run `npm run dist:check` against `release/` before you publish anything, then
on GitHub open the draft release and click **Publish release**.

**Until the draft is published, no installed copy sees the update.** That is
the intended safety valve: build, look at it, then release.

---

## 3. Verifying the channel actually works

Do this once, properly, before handing a copy to anyone:

1. Install version *N* on a second machine (or a VM).
2. Publish version *N+1* with a visible change.
3. Open the app on the test machine. Within ~10 seconds of the window
   appearing, the log should show `update <N+1> available — downloading`, then
   `downloaded — prompting`, then the restart dialog.
4. Log path: `%AppData%\Cut Protocol\logs\cut-protocol.log`

Also test the offline case: disconnect the network, launch. The app must open
completely normally, with a single `check failed (this is normal offline)`
line in the log and **no dialog**.

---

## 4. Rollback

There is no "un-update". If a bad build ships:

1. Delete or un-publish the bad GitHub release **immediately** (this stops any
   further clients from seeing it).
2. Bump the version again (e.g. `1.0.2` → `1.0.3`) with the fix and publish.
   Never re-publish a different binary under a version number that already
   went out — clients cache by version.

---

## 5. Licensing (optional, off by default)

`electron/license.cjs` is an **offline** entitlement gate. It never phones
home. Out of the box it is **inert**: `PUBLIC_KEY_B64` is empty, so
`check()` returns `state: "unconfigured"` and the app runs normally.

To turn it on:

```
npm run license:keygen -- --out C:\somewhere\safe\cutprotocol-private.pem
```

- Paste the printed **public** key into `electron/license.cjs` →
  `PUBLIC_KEY_B64`. A public key in a public repo is fine and expected.
- **Keep the private key out of this repo.** Password manager or an encrypted
  volume. If it leaks, anyone can mint keys and the only fix is rotating the
  public key in a new release.

Issue a key:

```
node electron/licenseTool.cjs sign --key <private.pem> --licensee "Jane Doe" --exp 2027-01-01
```

Send the printed string as a file named `license.key`. The customer drops it
in `%AppData%\Cut Protocol\license.key`.

`electron/licenseTool.cjs` is excluded from the packaged build
(`build.files` → `!electron/licenseTool.cjs`) — it never ships.

**Development bypass** (clearly marked in the source): any unpackaged run, or
`CUT_PROTOCOL_DEV_LICENSE_BYPASS=1`. Both write a loud `DEV BYPASS` line to
the log so a bypassed build can't be mistaken for a licensed one.

**Honest limits, stated because pretending otherwise is worse:** this stops
casual copying, not a determined person. Anyone can edit an unpacked build and
remove the check, and a key file works on any machine (deliberately — no
fingerprinting, no activation server, nothing that can strand a paying user
offline).

---

## 6. Things that will bite you

| Symptom | Cause |
| --- | --- |
| No update ever offered | Version in `package.json` wasn't bumped, or the GitHub release is still a draft |
| `Cannot find dev-app-update.yml` | You ran an update check from the source tree. Expected — `updater.cjs` skips unpackaged runs unless `CUT_PROTOCOL_FORCE_UPDATE_CHECK` is set |
| Publish 401/403 | `GH_TOKEN` missing from the shell, expired, or lacks `repo` scope |
| Update downloads but never installs | User chose "Later" — it installs on next quit, by design |
| Installed copy still on the old version after restart | NSIS needs the app fully closed; check the taskbar for a second window |
