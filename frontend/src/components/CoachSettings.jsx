import { useState, useEffect, useCallback } from "react";
import { Check, Link2, Trash2 } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, Btn, ErrorNote } from "./ui/Parts.jsx";
import { api, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";

// Where the coach gets turned on.
//
// The installed app ships no API key — deliberately, so a build can be shared
// without handing over a secret. The coach therefore talks to a relay that
// holds the key, and this card is where the relay's address and this device's
// token get entered. Both are written to a file in the app's own data folder,
// never into the app itself.
//
// COLOR LAWS (CLAUDE.md, constitutional):
//   - green ONLY means connected/success. Not a selected state, not a border,
//     not a label.
//   - amber for "you need to do something", never red. Red is reserved for
//     system errors, which is what ErrorNote already handles.
// So: the connected state is green, everything else is the neutral ink ladder.

// Plain English for each backend reason. No jargon labels — the user should
// never have to learn what "incomplete-config" means to act on it.
const EXPLAIN = {
  "no-config": {
    tone: "idle",
    title: "The coach is off",
    body: "Nothing is connected yet. Paste your relay address and device token below to turn it on.",
  },
  "incomplete-config": {
    tone: "warn",
    title: "The saved settings are unreadable",
    body: "There is a settings file, but it is damaged or half-written. Re-enter both values below to replace it.",
  },
  off: {
    tone: "warn",
    title: "Connected, but switched off",
    body: "A relay is configured, but the coach has been disabled somewhere outside this screen. Re-saving below will switch it back on.",
  },
  "relay-unreachable": {
    tone: "warn",
    title: "Your relay did not answer",
    body: "The address is saved but nothing responded. Check the relay is running, and that the address is exactly right.",
  },
  ok: {
    tone: "ok",
    title: "The coach is on",
    body: "Connected to your relay. It answers in the chat bar at the bottom of the screen.",
  },
};

export default function CoachSettings() {
  const signal = useAbortSignal();
  const [status, setStatus] = useState(null); // null = still checking
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async ({ probe = false } = {}) => {
    try {
      setStatus(await api.getBrainStatus({ probe, signal }));
      setErr(null);
    } catch (e) {
      if (!isAbortError(e)) setErr(describeError(e));
    }
  }, [signal]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await api.setBrainConfig(url.trim(), token.trim(), { signal });
      setStatus(next);
      // Clear the token from component state the moment it is stored. It is a
      // credential; there is no reason for it to sit in memory (or in a React
      // devtools inspector) after the save, and no read endpoint will ever give
      // it back to repopulate this field.
      setToken("");
      setUrl("");
    } catch (e) {
      if (!isAbortError(e)) setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      setStatus(await api.clearBrainConfig({ signal }));
    } catch (e) {
      if (!isAbortError(e)) setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setChecking(true);
    await load({ probe: true });
    setChecking(false);
  };

  const reason = status?.reason || "no-config";
  const info = EXPLAIN[reason] || EXPLAIN["no-config"];
  const connected = info.tone === "ok";

  return (
    <Card section="COACH" title="Connect the coach" className="xl:col-span-12">
      {err && <ErrorNote msg={err} hint="Nothing was changed. Your existing settings are untouched." />}

      {/* Status line. Green appears here and nowhere else on this card, and
          only when it genuinely means connected. */}
      <div
        className="flex items-start gap-2.5 rounded-2xl px-3.5 py-3 mb-3"
        style={{
          background: C.card2,
          border: `1px solid ${connected ? C.accent : C.rule}`,
        }}
      >
        {connected ? (
          <Check size={16} strokeWidth={2.5} style={{ color: C.accent, marginTop: 1, flexShrink: 0 }} />
        ) : (
          <Link2 size={16} strokeWidth={2.5} style={{ color: info.tone === "warn" ? C.warn : C.faint, marginTop: 1, flexShrink: 0 }} />
        )}
        <div>
          <div className="text-xs font-extrabold" style={{ color: connected ? C.accent : C.ink }}>
            {status === null ? "Checking…" : info.title}
          </div>
          {status !== null && (
            <div className="text-[11px] font-semibold mt-0.5" style={{ color: C.faint }}>{info.body}</div>
          )}
        </div>
      </div>

      {/* Both buttons below are ghost. Btn's `ink` kind renders on the accent
          green, which law a reserves for on-target / primary action / success —
          neither of these is that. "Turn the coach off" is not red either: red
          is for system errors and destructive confirms, and this is reversible
          by pasting the two values back in. */}
      {connected ? (
        <div className="flex flex-wrap gap-2 items-center">
          <Btn kind="ghost" small onClick={check} disabled={checking}>
            {checking ? "Checking…" : "Check the connection"}
          </Btn>
          <Btn kind="ghost" small onClick={disconnect} disabled={busy}>
            <span className="inline-flex items-center gap-1.5"><Trash2 size={13} strokeWidth={2.5} /> Turn the coach off</span>
          </Btn>
          <span className="text-[11px] font-semibold" style={{ color: C.faintLight }}>
            Turning it off deletes the saved settings from this computer.
          </span>
        </div>
      ) : (
        <>
          <label className="block mb-2.5">
            <span className="text-[11px] font-extrabold tracking-wide" style={{ color: C.faint }}>RELAY ADDRESS</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-relay-address"
              spellCheck={false}
              autoComplete="off"
              className="w-full mt-1 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}
            />
          </label>

          <label className="block mb-3">
            <span className="text-[11px] font-extrabold tracking-wide" style={{ color: C.faint }}>DEVICE TOKEN</span>
            <input
              // type=password so a credential is not left readable on screen —
              // this card sits on a tab a user might be showing someone.
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token from your relay"
              spellCheck={false}
              autoComplete="off"
              className="w-full mt-1 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}
            />
          </label>

          <div className="flex flex-wrap gap-2 items-center">
            {/* `ink` is the accent-green button. Legal here and only here on
                this card: turning the coach on is the primary action. */}
            <Btn kind="ink" small onClick={save} disabled={busy || !url.trim() || !token.trim()}>
              {busy ? "Saving…" : "Turn the coach on"}
            </Btn>
            <span className="text-[11px] font-semibold" style={{ color: C.faintLight }}>
              Both values are stored on this computer only. They are never part of the app you share.
            </span>
          </div>
        </>
      )}

      <div className="text-[10.5px] font-semibold mt-3" style={{ color: C.faintLight }}>
        The coach never sets your calorie or macro numbers — those always come from the engine. It reads them and talks about them.
      </div>
    </Card>
  );
}
