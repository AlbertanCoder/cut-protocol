// Assembles a bug report and files it as a GitHub issue via the PRE-FILLED
// issue-creation URL — the deliberate no-secret approach.
//
// WHY NOT A TOKEN: a GitHub token embedded in a shipped desktop app is
// extractable by anyone who has the installer, and would grant write access
// to the repo. GitHub's own `issues/new?title=&body=&labels=` URL needs no
// token: it opens the pre-filled issue form in the user's browser, where they
// are already authenticated and must click "Submit new issue" themselves.
// That also gives a SECOND privacy review (the user sees the exact issue on
// github.com before it posts). No relay to host, nothing to keep secret.

import { recentLogs } from "./bugLog.js";
import { scrub } from "./scrub.js";

const REPO = "AlbertanCoder/cut-protocol";
const PENDING_KEY = "cutprotocol:pendingBugReports";
const URL_BUDGET = 7000; // practical cap for a browser/GitHub issue URL

export async function fetchMeta() {
  try {
    const m = await fetch("/api/meta", { credentials: "include" }).then((r) => r.json());
    return m;
  } catch {
    return { version: "unknown", platform: navigator.platform || "unknown", packaged: false };
  }
}

function osLabel(meta) {
  const map = { win32: "Windows", darwin: "macOS", linux: "Linux" };
  const os = map[meta?.platform] || meta?.platform || "unknown";
  return meta?.arch ? `${os} (${meta.arch})` : os;
}

function trimStack(stack) {
  return String(stack).split("\n").slice(0, 12).join("\n");
}

// The exact text that will be filed — shown to the user for review before send.
export function buildReportBody({ meta, error, userText }) {
  const L = [];
  L.push("### What happened");
  L.push(userText && userText.trim() ? scrub(userText.trim()) : "_(no description provided)_");
  L.push("");
  L.push("### Environment");
  L.push(`- App version: \`${meta?.version || "unknown"}\``);
  L.push(`- OS: ${osLabel(meta)}`);
  L.push(`- Build: ${meta?.packaged ? "packaged desktop app" : "dev / web"}`);
  L.push("");
  if (error) {
    L.push("### Error");
    L.push("```");
    L.push(scrub(error.message || String(error)));
    if (error.stack) L.push(scrub(trimStack(error.stack)));
    L.push("```");
    L.push("");
  }
  L.push("### Recent activity");
  L.push("_Actions and statuses only — no weights, food logs, names, or allergy data._");
  L.push("```");
  const logs = recentLogs().map((l) => `${l.t}  ${l.type}  ${scrub(l.detail)}`);
  L.push(logs.slice(-25).join("\n") || "(no recent activity captured)");
  L.push("```");
  L.push("");
  L.push("<sub>Filed via Cut Protocol's in-app reporter. Reviewed and sent by the user; personal data is excluded by design.</sub>");
  return L.join("\n");
}

export function buildTitle(error, userText) {
  if (userText && userText.trim()) return `Bug: ${scrub(userText.trim()).slice(0, 70)}`;
  if (error?.message) return `Bug: ${scrub(error.message).slice(0, 70)}`;
  return "Bug report";
}

// Returns { url, truncated, fullBody } — the fullBody is copied to the
// clipboard when the URL had to be truncated so nothing is lost.
export function buildIssueUrl({ title, body }) {
  const enc = encodeURIComponent;
  const base = `https://github.com/${REPO}/issues/new?labels=bug-report&title=${enc(title)}&body=`;
  const full = base + enc(body);
  if (full.length <= URL_BUDGET) return { url: full, truncated: false, fullBody: body };
  // Truncate the body (keep the head — description + environment + error) to fit.
  let b = body;
  while ((base + enc(b)).length > URL_BUDGET && b.length > 500) b = b.slice(0, Math.floor(b.length * 0.85));
  b += "\n\n_…report truncated to fit the URL — the full text was copied to your clipboard, paste it into the issue._";
  return { url: base + enc(b), truncated: true, fullBody: body };
}

// Open the pre-filled issue in the user's real browser (Electron) or a new
// tab (web). Returns true if a handoff happened.
export function openExternal(url) {
  if (window.cutProtocol?.openExternal) {
    window.cutProtocol.openExternal(url);
    return true;
  }
  const w = window.open(url, "_blank", "noopener,noreferrer");
  return !!w;
}

// ── offline queue ──────────────────────────────────────────────────────────
export function savePending(report) {
  const q = loadPending();
  q.push({ ...report, savedAt: Date.now() });
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(q.slice(-10)));
  } catch {
    /* storage full / unavailable — nothing more we can safely do */
  }
}
export function loadPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  } catch {
    return [];
  }
}
export function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
}
