const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Local, email-free password reset for a desktop app.
//
// There is no mail server to send a reset link to, so the "proof you are allowed
// to reset this account" is LOCAL FILE ACCESS: begin() writes a one-time code to
// a file sitting next to the SQLite database, and the code is NEVER returned over
// HTTP. To finish a reset you have to READ that file — which is the exact same
// local access that reading the database itself requires. So the reset never
// weakens the app's trust boundary: anyone who could complete a reset could
// already open the DB directly. And a caller who is NOT on the machine (the
// HOST=0.0.0.0 misconfiguration the /register gate also worries about) can start
// the flow but can't read the code, so they still can't take an account over.

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// PER-ACCOUNT filename, not one fixed file.
//
// It used to be a single `password-reset-code.txt` for the whole install, which
// broke as soon as two accounts existed on the machine (the app supports
// exactly that — the owner adds local profiles). Two resets in flight and the
// second overwrote the first's code; then completing the FIRST reset unlinked
// the file that now held the SECOND account's code, so a user in the middle of
// a legitimate reset watched their instructions vanish. Deriving the name from
// the email gives every account its own file and its own lifecycle.
//
// The tag is a truncated SHA-256 of the normalized email rather than the email
// itself: the file sits in a directory a person browses, and a filename is not
// the place to publish account names. It leaks nothing an attacker doesn't
// already have — the same directory holds the SQLite database with the address
// in plaintext, which is exactly the local access this whole flow is gated on.
const RECOVERY_PREFIX = "password-reset-";
const RECOVERY_SUFFIX = ".txt";
/** Matches every file this module may create, for the test-seam sweep. */
const RECOVERY_FILE_RE = /^password-reset-[0-9a-f]{8}\.txt$/;
// Crockford-ish alphabet: no 0/O/1/I/L, so a handwritten/retyped code is
// unambiguous. 32 symbols × 8 chars ≈ 40 bits of entropy — plenty for a code
// that lives 15 minutes and is rate-limited on the way in.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// email -> { codeHash: Buffer, expiresAt: number, filePath: string }
// In-memory only: a reset is a here-and-now action, and not persisting the code
// means a stolen DB file never carries a live reset token. Cleared on restart.
const pending = new Map();

/**
 * Where the recovery file goes: the directory that holds the live database.
 * Packaged Electron sets CUT_PROTOCOL_DB_PATH to the real DB in userData
 * (electron/main.cjs); in dev the DB is backend/prisma/dev.db, and this file is
 * backend/src/lib/passwordReset.js, so ../../prisma is that same folder.
 */
function resolveRecoveryDir() {
  // Explicit override (tests, or a user who moved their data dir) wins.
  if (process.env.CUT_PROTOCOL_RECOVERY_DIR) return process.env.CUT_PROTOCOL_RECOVERY_DIR;
  if (process.env.CUT_PROTOCOL_DB_PATH) return path.dirname(process.env.CUT_PROTOCOL_DB_PATH);
  return path.resolve(__dirname, "..", "..", "prisma");
}

/** Normalize exactly the way the route does, so the same address always maps
 *  to the same file no matter which entry point asked. */
function normalizeEmailKey(email) {
  return (typeof email === "string" ? email : "").trim().toLowerCase();
}

function recoveryFileName(email) {
  const tag = crypto.createHash("sha256").update(normalizeEmailKey(email), "utf8").digest("hex").slice(0, 8);
  return `${RECOVERY_PREFIX}${tag}${RECOVERY_SUFFIX}`;
}

/** The REAL absolute path — for writing, reading and unlinking. Never send this
 *  to a client; use recoveryDisplayPath() for anything a person will see. */
function recoveryFilePath(email) {
  return path.join(resolveRecoveryDir(), recoveryFileName(email));
}

/**
 * The same location, written so a person can find it WITHOUT the response
 * carrying this machine's account name.
 *
 * /api/auth/reset/begin is unauthenticated by necessity — someone who forgot
 * their password is neither first-run nor signed in — so whatever it returns is
 * readable by any caller that can reach the port. An absolute path on Windows
 * is `C:\Users\<username>\…`, i.e. it hands out the OS username for free.
 * routes/meta.js already suppresses paths in its responses for exactly this
 * reason, and Phase 9 rewrote this repo's git history specifically to scrub
 * that username before the repo went public — so publishing it live over HTTP
 * would give back the thing that rewrite was for.
 *
 * `~` is both honest and universally understood, and the tail of the path is
 * what the user actually needs in order to open the file.
 */
function recoveryDisplayPath(email) {
  const full = recoveryFilePath(email);
  let home = "";
  try { home = os.homedir() || ""; } catch { home = ""; }

  let shown = full;
  if (home && full.toLowerCase().startsWith(home.toLowerCase() + path.sep)) {
    shown = `~${path.sep}${full.slice(home.length + 1)}`;
  } else if (path.isAbsolute(full)) {
    // Data dir moved outside the home tree (CUT_PROTOCOL_DB_PATH, a portable
    // install). Still don't publish the whole path — the last folder plus the
    // filename is enough to find it, and reveals no account name.
    shown = path.join("…", path.basename(path.dirname(full)), path.basename(full));
  }

  // Backstop: if the username survives anywhere in what's left (a data folder
  // named after the user, a home dir that isn't a prefix of it), redact it.
  const userName = home ? path.basename(home) : "";
  if (userName.length >= 3) {
    shown = shown.replace(new RegExp(userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "…");
  }
  return shown;
}

/** Uppercase and strip anything that isn't an alphabet symbol, so the grouping
 *  dash, spaces, and case never cause a false mismatch. */
function normalizeCode(raw) {
  return (typeof raw === "string" ? raw : "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out; // normalized form (no dash); display adds the dash
}

function display(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest();
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* already gone — fine */ }
}

function pruneExpired() {
  const now = Date.now();
  for (const [email, e] of pending) {
    if (e.expiresAt <= now) {
      safeUnlink(e.filePath);
      pending.delete(email);
    }
  }
}

/**
 * Create a recovery code for `email` and write it to the local file. Only ever
 * called for an account that actually exists (the route checks first). Returns
 * the file path — never the code. A second call for the same email replaces the
 * previous code, so an old file's code stops working immediately.
 */
function beginReset(email) {
  pruneExpired();
  const code = generateCode();
  const filePath = recoveryFilePath(email);
  const expiresAt = Date.now() + CODE_TTL_MS;

  // Kept to plain ASCII on purpose: this is a bare .txt a user opens in Notepad,
  // and a UTF-8 em dash there renders as mojibake without a BOM.
  const body = [
    "Cut Protocol - password reset",
    "==============================",
    "",
    `Account:  ${email}`,
    `Code:     ${display(code)}`,
    `Created:  ${new Date().toLocaleString()}`,
    "Expires:  15 minutes after it was created",
    "",
    "Type this code back into the app to set a new password.",
    "If you did NOT ask to reset your password, just delete this file -",
    "nothing has changed, and the code becomes useless on its own in 15 minutes.",
    "",
  ].join("\r\n"); // CRLF so Windows Notepad shows the line breaks

  // mode 0o600 = owner read/write only, on platforms that honour it.
  fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o600 });
  pending.set(normalizeEmailKey(email), { codeHash: sha256(code), expiresAt, filePath });
  return { filePath };
}

/**
 * Verify a code for `email`. Constant-time compare. On success the code is
 * CONSUMED (file deleted, entry removed) so it can't be replayed. Returns false
 * for wrong, expired, or never-issued codes — the caller must not distinguish
 * them to the client.
 */
function verifyResetCode(email, rawCode) {
  pruneExpired();
  const key = normalizeEmailKey(email);
  const entry = pending.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    safeUnlink(entry.filePath);
    pending.delete(key);
    return false;
  }
  const provided = sha256(normalizeCode(rawCode));
  const ok =
    provided.length === entry.codeHash.length &&
    crypto.timingSafeEqual(provided, entry.codeHash);
  if (ok) {
    // Unlinks THIS account's file (entry.filePath is per-email). It used to
    // unlink the one shared file, which is how completing one user's reset
    // deleted a different user's live instructions.
    safeUnlink(entry.filePath);
    pending.delete(key);
  }
  return ok;
}

module.exports = {
  beginReset,
  verifyResetCode,
  recoveryFilePath,
  recoveryDisplayPath,
  CODE_TTL_MS,
  // Test seam only: empty the pending map + remove any file, so tests don't leak
  // state into each other. Never call per-request.
  __reset() {
    for (const [, e] of pending) safeUnlink(e.filePath);
    pending.clear();
    // Sweep the directory too — now that names are per-email, a file whose
    // pending entry was already dropped would otherwise survive the seam.
    try {
      const dir = resolveRecoveryDir();
      for (const name of fs.readdirSync(dir)) {
        if (RECOVERY_FILE_RE.test(name)) safeUnlink(path.join(dir, name));
      }
    } catch { /* no recovery dir yet — nothing to sweep */ }
  },
};
