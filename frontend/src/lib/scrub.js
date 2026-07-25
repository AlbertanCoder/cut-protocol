// Belt-and-suspenders redaction for anything that reaches a bug report.
// The activity log is already body-free (see bugLog.js), so this mostly
// guards free-text the user typed and any data that slipped into an error
// message. It NEVER lets an email, a bodyweight, or a token leave the app.
//
// ── WHY FILESYSTEM PATHS ARE IN HERE (and were the biggest hole) ────────────
// Delivery is a PRE-FILLED GITHUB ISSUE URL on a PUBLIC repo. Whatever this
// function misses lands on github.com under the user's own account. And the
// two richest inputs to a report — `error.stack` and anything the Electron main
// process said — are made almost entirely of absolute paths:
//
//   at loadData (C:\Users\<account>\AppData\Local\Programs\Cut Protocol\…)
//   could not persist the session secret at C:\Users\<account>\AppData\…
//
// Phase 9 of this project rewrote git history specifically to get that username
// off a public repo. Filing one bug report put it straight back. The username
// is not the only thing a home directory leaks either — the path shape names
// the machine's owner, their OS account, and sometimes their employer (OneDrive
// business folders are literally "OneDrive - Company Name").
//
// The approach: find the account name from the path shapes that carry it,
// replace it there, and then remove EVERY remaining standalone occurrence of
// that same name anywhere in the text — because once a stack trace has named
// the user once, the name tends to appear again outside a path.

// C:\Users\NAME · /Users/NAME · /home/NAME · file:///C:/Users/NAME
// Also matches the UNC and extended-length forms Windows produces
// (\\?\C:\Users\NAME, \\host\Users\NAME).
const HOME_DIR = /((?:[A-Za-z]:)?[\\/]{1,2}(?:\?[\\/])?(?:[A-Za-z]:[\\/])?(?:Users|home|Documents and Settings)[\\/])([^\\/\s"'<>|:*?]+)/gi;

// Windows account names that turn up outside a path (`USERPROFILE=…`,
// `C:\Users\x` already handled, `logged in as x`). Only names harvested from a
// real path are removed this way — never a guess.
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scrub(text) {
  let s = String(text ?? "");

  // ── 1. Home directories, and the account name they expose ────────────────
  const names = new Set();
  s = s.replace(HOME_DIR, (m, prefix, name) => {
    // "Public", "Default" and "All Users" are shared Windows accounts, not a
    // person — leaving them intact keeps the path readable for debugging.
    if (/^(public|default|default user|all users)$/i.test(name)) return m;
    // Only a WINDOWS path (backslash or drive letter) feeds the whole-text
    // sweep below. A forward-slash "/home/x" or "/Users/x" can just as easily
    // be a URL path, and treating a URL segment as an account name would blank
    // that word everywhere it appears in the report.
    if (/\\|[A-Za-z]:/.test(prefix)) names.add(name);
    return `${prefix}[user]`;
  });
  for (const name of names) {
    if (name.length < 3) continue; // too short to match safely
    s = s.replace(new RegExp(`\\b${escapeRe(name)}\\b`, "g"), "[user]");
  }

  // ── 2. Sync-folder names, which carry employer/organisation ──────────────
  // "OneDrive - Acme Roofing Ltd" → "OneDrive - [org]".
  s = s.replace(/\b(OneDrive|Dropbox|Box|Google Drive)\s+-\s+[^\\/\n\r]+/gi, "$1 - [org]");

  // ── 3. Everything the original version already covered ───────────────────
  // Email addresses.
  s = s.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]");
  // Bodyweights ("212 lb", "88.4 kg", "95 kilograms").
  s = s.replace(/\b\d{2,3}(?:\.\d+)?\s?(?:kg|kgs|kilograms?|lb|lbs|pounds?)\b/gi, "[weight]");
  // API keys / bearer tokens / JWT-ish blobs.
  s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "[redacted]");
  s = s.replace(/\beyJ[A-Za-z0-9._-]{10,}\b/g, "[redacted]"); // JWT

  // ── 4. Calorie figures ───────────────────────────────────────────────────
  // A target or an intake is this app's most personal number after bodyweight,
  // and it is 4 digits — which the 2-3 digit weight rule above never touched.
  // Covers "2384 kcal", "2,384 calories", "targetKcal: 2384", "target=2384".
  s = s.replace(/\b\d{1,2},?\d{3}(?:\.\d+)?\s?(?:kcal|cals?|calories|calorie)\b/gi, "[kcal]");
  s = s.replace(/\b\d{3}(?:\.\d+)?\s?(?:kcal|calories)\b/gi, "[kcal]");
  s = s.replace(/\b((?:target|goal|intake|tdee|bmr|maintenance)\w*)\s*[:=]\s*\d{3,5}(?:\.\d+)?\b/gi, "$1: [kcal]");

  // ── 5. Food and recipe names ─────────────────────────────────────────────
  // What someone eats is personal, and it reaches errors and logs in a small
  // number of fixed shapes: the backend's data-audit lines (`food "X": …`), the
  // importer's messages, and solver diagnostics. The quoted-name shape is the
  // one that actually occurs, so that is what is matched — a blanket
  // quoted-string rule would gut the debugging value of every other message.
  s = s.replace(/\b(food|foods|recipe|recipes|ingredient|ingredients|meal)\s+"[^"\n]{1,120}"/gi, '$1 "[name]"');
  s = s.replace(/\b(food|recipe|ingredient|meal)\s*(?:name)?\s*[:=]\s*"[^"\n]{1,120}"/gi, '$1: "[name]"');

  return s;
}
