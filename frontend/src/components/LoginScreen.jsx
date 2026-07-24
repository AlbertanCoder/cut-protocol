import { useState, useEffect } from "react";
import { C } from "../lib/theme.js";
import { Card, Btn } from "./ui/Parts.jsx";
import CutMark from "./ui/CutMark.jsx";
import { api } from "../lib/api.js";

// Minimum must match backend/src/lib/auth.js MIN_PASSWORD_LENGTH. The server is
// the authority — this only saves a round trip and lets the message sit next to
// the field. A mismatch fails safe: the server rejects and we render its errors.
const MIN_PASSWORD_LENGTH = 8;

// /auth/status and /auth/register are not on api.js yet — that file is owned by
// another workstream this session, so these two calls live here rather than
// racing an edit into it. They mirror api.js's request(): same relative /api
// path, same credentials mode, same { error, fields } unwrapping onto the thrown
// Error. Fold them into api.js when that file is free (they belong there).
async function authRequest(path, body) {
  const res = await fetch(`/api${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(parsed?.error || `request failed: ${res.status}`);
    err.status = res.status;
    err.fields = parsed?.fields || {};
    throw err;
  }
  return parsed;
}

export default function LoginScreen({ onLoggedIn }) {
  // "checking" until /auth/status answers, then "register" (zero accounts on
  // this machine) or "login". Never guess: rendering a sign-in form to someone
  // who has no account is the bug this whole screen exists to fix.
  const [mode, setMode] = useState("checking");
  const [statusError, setStatusError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    authRequest("/auth/status")
      .then((s) => {
        if (!cancelled) setMode(s?.needsSetup ? "register" : "login");
      })
      .catch((err) => {
        // Backend down / not reachable. Fall back to sign-in (the safe default)
        // and say what happened out loud — never a blank screen.
        if (cancelled) return;
        setStatusError(err.message);
        setMode("login");
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="flex items-center justify-center">
            <CutMark size={44} />
          </div>
          <div className="leading-none">
            <div className="text-xl disp uppercase" style={{ color: C.ink, letterSpacing: ".01em" }}>Cut Protocol</div>
            <div className="text-[10px] font-bold uppercase mt-1" style={{ color: C.faint, letterSpacing: ".08em" }}>Recomp Engine</div>
          </div>
        </div>
        <Card>
          {mode === "checking" && (
            <div className="text-xs font-semibold py-2" style={{ color: C.faint }}>Checking this install…</div>
          )}
          {mode === "register" && <RegisterForm onLoggedIn={onLoggedIn} />}
          {mode === "login" && <LoginForm onLoggedIn={onLoggedIn} statusError={statusError} />}
        </Card>
      </div>
    </div>
  );
}

const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };

function FieldError({ children }) {
  if (!children) return null;
  return <div className="text-[11px] font-semibold mt-1" style={{ color: C.red }}>{children}</div>;
}

function LoginForm({ onLoggedIn, statusError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(email, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err.status === 401 ? "Wrong email or password." : err.message);
    } finally {
      setBusy(false);
    }
  };

  // The reset flow is a local-file handshake, not an email link — so it lives
  // right here on the sign-in screen. Prefill it with whatever email is typed.
  if (resetting) {
    return <ResetPanel initialEmail={email} onLoggedIn={onLoggedIn} onCancel={() => setResetting(false)} />;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {statusError && (
        <div role="alert" className="text-[11px] font-semibold" style={{ color: C.warn }}>
          Couldn't reach the app's backend ({statusError}). If this is a brand-new install, start the app again — account setup needs the backend running.
        </div>
      )}
      <label className="block">
        <span className="text-xs font-bold" style={{ color: C.faint }}>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} autoFocus />
      </label>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: C.faint }}>Password</span>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} />
      </label>
      {error && <div role="alert" className="text-xs font-semibold" style={{ color: C.red }}>{error}</div>}
      <Btn disabled={busy}>{busy ? "Logging in…" : "Log in"}</Btn>
      <button type="button" onClick={() => setResetting(true)}
        className="text-[11px] font-semibold w-full text-center pt-1 hover:opacity-80"
        style={{ color: C.faint }}>
        Forgot your password?
      </button>
    </form>
  );
}

// Local, email-free password reset. Two steps:
//   1. name the account → the backend writes a one-time code to a file on THIS
//      computer (next to the app's data) and tells us where.
//   2. open that file, type the code + a new password → signed straight in.
// The code never travels over the network, so only someone at this machine (who
// can read the file) can finish a reset. Mirrors backend/src/routes/auth.js.
function ResetPanel({ initialEmail, onLoggedIn, onCancel }) {
  const [step, setStep] = useState("request"); // "request" | "verify"
  const [email, setEmail] = useState(initialEmail || "");
  const [filePath, setFilePath] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setFields({ email: "Email is required." }); return; }
    setBusy(true);
    try {
      const res = await authRequest("/auth/reset/begin", { email: email.trim() });
      setFilePath(res?.filePath || "");
      setFields({});
      setStep("verify");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async (e) => {
    e.preventDefault();
    setError(null);
    const next = {};
    if (!code.trim()) next.code = "Enter the code from the file.";
    if (!password) next.password = "Choose a new password.";
    else if (password.length < MIN_PASSWORD_LENGTH) next.password = `At least ${MIN_PASSWORD_LENGTH} characters.`;
    if (confirm !== password) next.confirm = "Passwords don't match.";
    setFields(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const user = await authRequest("/auth/reset/complete", { email: email.trim(), code: code.trim(), newPassword: password });
      onLoggedIn(user); // the reset issues a session — lands straight in the app
    } catch (err) {
      setFields(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[15px] font-bold" style={{ color: C.ink, letterSpacing: "-.01em" }}>Reset your password</div>
        <div className="text-xs mt-1" style={{ color: C.faint }}>
          No email needed — the code is saved to a file on this computer.
        </div>
      </div>

      {step === "request" && (
        <form onSubmit={request} className="space-y-3" noValidate>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Email</span>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setFields({}); }}
              aria-invalid={!!fields.email}
              className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} autoFocus />
            <FieldError>{fields.email}</FieldError>
          </label>
          {error && <div role="alert" className="text-xs font-semibold" style={{ color: C.red }}>{error}</div>}
          <Btn disabled={busy}>{busy ? "Preparing…" : "Get a reset code"}</Btn>
          <button type="button" onClick={onCancel}
            className="text-[11px] font-semibold w-full text-center pt-1 hover:opacity-80" style={{ color: C.faint }}>
            Back to sign in
          </button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={complete} className="space-y-3" noValidate>
          <div className="text-[11px] rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.faint }}>
            Open this file on your computer and copy the code inside:
            <div className="font-mono mt-1 break-all" style={{ color: C.ink }}>{filePath || "the app's data folder"}</div>
            <div className="mt-1" style={{ color: C.faintLight }}>The code expires 15 minutes after you requested it.</div>
          </div>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Code from the file</span>
            <input type="text" value={code} onChange={(e) => { setCode(e.target.value); if (fields.code) setFields((f) => ({ ...f, code: undefined })); }}
              autoComplete="one-time-code" aria-invalid={!!fields.code}
              className="text-sm px-3 py-2.5 rounded-xl w-full mt-1 font-mono tracking-wide" style={inpStyle} autoFocus />
            <FieldError>{fields.code}</FieldError>
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>New password</span>
            <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); if (fields.password) setFields((f) => ({ ...f, password: undefined })); }}
              autoComplete="new-password" aria-invalid={!!fields.password}
              className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} />
            <FieldError>{fields.password}</FieldError>
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Confirm new password</span>
            <input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); if (fields.confirm) setFields((f) => ({ ...f, confirm: undefined })); }}
              autoComplete="new-password" aria-invalid={!!fields.confirm}
              className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} />
            <FieldError>{fields.confirm}</FieldError>
          </label>
          {error && <div role="alert" className="text-xs font-semibold" style={{ color: C.red }}>{error}</div>}
          <Btn disabled={busy}>{busy ? "Setting password…" : "Set new password"}</Btn>
          <button type="button" onClick={onCancel}
            className="text-[11px] font-semibold w-full text-center pt-1 hover:opacity-80" style={{ color: C.faint }}>
            Back to sign in
          </button>
        </form>
      )}
    </div>
  );
}

function RegisterForm({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fields, setFields] = useState({}); // per-input messages, client or server
  const [error, setError] = useState(null); // whole-form failure
  const [busy, setBusy] = useState(false);

  // Same rules the server enforces, so the common mistakes never cost a request.
  const clientCheck = () => {
    const next = {};
    const e = email.trim();
    if (!e) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) next.email = "That doesn't look like an email address.";
    if (!password) next.password = "Password is required.";
    else if (password.length < MIN_PASSWORD_LENGTH) next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (confirmPassword !== password) next.confirmPassword = "Passwords don't match.";
    return next;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const clientErrors = clientCheck();
    setFields(clientErrors);
    if (Object.keys(clientErrors).length) return;

    setBusy(true);
    try {
      const user = await authRequest("/auth/register", { email: email.trim(), password, confirmPassword });
      // The server issues the session on register, so this lands straight in
      // the app — no "account created, now sign in" dead end.
      onLoggedIn(user);
    } catch (err) {
      // Never a silent no-op: field messages where the server gave them, and
      // always a form-level line saying what happened.
      setFields(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (setter, key) => (ev) => {
    setter(ev.target.value);
    if (fields[key]) setFields((f) => ({ ...f, [key]: undefined }));
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <div className="text-[15px] font-bold" style={{ color: C.ink, letterSpacing: "-.01em" }}>Create your account</div>
        <div className="text-xs mt-1" style={{ color: C.faint }}>
          This machine has no account yet. Everything you log stays in this app, on this computer.
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: C.faint }}>Email</span>
        <input type="email" value={email} onChange={set(setEmail, "email")} autoComplete="username"
          aria-invalid={!!fields.email}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} autoFocus />
        <FieldError>{fields.email}</FieldError>
      </label>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: C.faint }}>Password</span>
        <input type="password" value={password} onChange={set(setPassword, "password")} autoComplete="new-password"
          aria-invalid={!!fields.password}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} />
        <FieldError>{fields.password}</FieldError>
        {!fields.password && (
          <div className="text-[11px] mt-1" style={{ color: C.faintLight }}>At least {MIN_PASSWORD_LENGTH} characters. Forgot it later? You can reset it from the sign-in screen using a code saved on this computer.</div>
        )}
      </label>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: C.faint }}>Confirm password</span>
        <input type="password" value={confirmPassword} onChange={set(setConfirmPassword, "confirmPassword")} autoComplete="new-password"
          aria-invalid={!!fields.confirmPassword}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} />
        <FieldError>{fields.confirmPassword}</FieldError>
      </label>
      {error && <div role="alert" className="text-xs font-semibold" style={{ color: C.red }}>{error}</div>}
      <Btn disabled={busy}>{busy ? "Creating account…" : "Create account"}</Btn>
    </form>
  );
}
