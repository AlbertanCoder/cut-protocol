import { useState, useEffect, useRef, useId } from "react";
import { Bug, X, Send, Copy, Check, ShieldCheck, WifiOff } from "lucide-react";
import { C } from "../lib/theme.js";
import {
  fetchMeta, fetchLogTail, buildReportBody, buildTitle, buildIssueUrl, openExternal,
  savePending, loadPending, clearPending,
} from "../lib/bugReport.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

// The bug-report review + send dialog. The user sees the EXACT text that will
// be filed (privacy review #1), then GitHub shows it pre-filled again before
// they submit (privacy review #2). Nothing sends without an explicit click.
export default function BugReportDialog({ open, error, onClose }) {
  const [meta, setMeta] = useState(null);
  // The desktop shell's diagnostic log. Empty in a browser, and empty until it
  // arrives — the preview re-renders when it does, so the user still reviews
  // the exact final text before anything is sent.
  const [logTail, setLogTail] = useState("");
  const [userText, setUserText] = useState("");
  const [status, setStatus] = useState(null); // null | "sent" | "saved" | "copied"
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);
  const panelRef = useRef(null);
  const titleId = useId();
  // a11y: focus trap + Escape-to-close + focus restore on the ONE truly
  // blocking modal in the app that can appear over anything (crash reports,
  // manual "Report a bug"). Runs even while `open` is false — the hook no-
  // ops until `active` flips true — matching this component's pattern of
  // always rendering (it returns null below rather than being unmounted).
  useFocusTrap(panelRef, { active: open, onClose });

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setUserText("");
    setLogTail("");
    fetchMeta().then(setMeta);
    fetchLogTail().then(setLogTail).catch(() => setLogTail(""));
    setPendingCount(loadPending().length);
  }, [open]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  if (!open) return null;

  const body = buildReportBody({ meta, error, userText, logTail });
  const title = buildTitle(error, userText);

  const send = () => {
    if (!navigator.onLine) {
      savePending({ title, body });
      setPendingCount(loadPending().length);
      setStatus("saved");
      return;
    }
    const { url, truncated, fullBody } = buildIssueUrl({ title, body });
    if (truncated) navigator.clipboard?.writeText(fullBody).catch(() => {});
    const handed = openExternal(url);
    if (handed) {
      setStatus("sent");
    } else {
      savePending({ title, body });
      setPendingCount(loadPending().length);
      setStatus("saved");
    }
  };

  const copy = () => { navigator.clipboard?.writeText(body).catch(() => {}); setStatus("copied"); };

  const sendPending = () => {
    for (const p of loadPending()) {
      const { url } = buildIssueUrl({ title: p.title, body: p.body });
      openExternal(url);
    }
    clearPending();
    setPendingCount(0);
  };

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const panel = { background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 20, width: "100%", maxWidth: 640, maxHeight: "88vh", display: "flex", flexDirection: "column" };
  const inp = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };

  return (
    <div style={overlay} onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={panel} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Bug size={18} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <div id={titleId} className="text-[15px] font-extrabold" style={{ color: "var(--foreground)" }}>{error ? "Something went wrong" : "Report a bug"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--muted-foreground)" }}><X size={18} aria-hidden="true" /></button>
        </div>

        <div className="px-5 overflow-y-auto" style={{ flex: 1 }}>
          {error && (
            <div className="text-xs font-semibold mb-3 p-2.5 rounded-lg" style={{ color: "var(--destructive)", background: "color-mix(in srgb, var(--destructive) 12%, transparent)", border: `1px solid ${"var(--destructive)"}44` }}>
              {String(error.message || error).slice(0, 200)}
            </div>
          )}

          {pendingCount > 0 && status !== "sent" && (
            <div className="text-xs font-semibold mb-3 p-2.5 rounded-lg flex items-center justify-between gap-2" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
              <span>{pendingCount} report{pendingCount === 1 ? "" : "s"} saved offline.</span>
              <button onClick={sendPending} disabled={!online} className="font-bold px-2 py-1 rounded-md" style={{ background: online ? C.accent : "var(--secondary)", color: online ? C.accentInk : "var(--muted-foreground)" }}>
                Open {pendingCount === 1 ? "it" : "them"} now
              </button>
            </div>
          )}

          <label className="block mb-3">
            <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>What were you doing? (optional)</span>
            <textarea value={userText} onChange={(e) => setUserText(e.target.value)} rows={3}
              placeholder="e.g. I clicked Generate on the Plan tab and it froze"
              className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inp} />
          </label>

          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck size={13} style={{ color: C.good }} />
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.good }}>Exactly what will be sent — no weights, food logs, names, allergies, or your Windows username</span>
          </div>
          <pre className="text-[11px] leading-relaxed p-3 rounded-xl overflow-auto mb-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--muted-foreground)", maxHeight: 260, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
{body}
          </pre>
        </div>

        <div className="px-5 py-4 flex items-center gap-2 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={send} className="text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5" style={{ background: C.accent, color: C.accentInk }}>
            {online ? <Send size={14} /> : <WifiOff size={14} />}{online ? "Send report" : "Save (offline)"}
          </button>
          <button onClick={copy} className="text-sm font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5" style={{ background: "transparent", color: "var(--foreground)", border: "1.5px solid var(--border)" }}>
            <Copy size={14} />Copy
          </button>
          <div className="flex-1" />
          {status === "sent" && <span className="text-xs font-bold flex items-center gap-1" style={{ color: C.good }}><Check size={13} />Opened in your browser — click "Submit new issue" to finish.</span>}
          {status === "saved" && <span className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--warn)" }}><Check size={13} />Saved — you'll be offered to send it when you're back online.</span>}
          {status === "copied" && <span className="text-xs font-bold flex items-center gap-1" style={{ color: C.good }}><Check size={13} />Copied to clipboard.</span>}
        </div>
      </div>
    </div>
  );
}
