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
    </form>
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
          <div className="text-[11px] mt-1" style={{ color: C.faintLight }}>At least {MIN_PASSWORD_LENGTH} characters. There is no password reset — write it down.</div>
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
