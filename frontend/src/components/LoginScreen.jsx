import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Card, Btn } from "./ui/Parts.jsx";
import CutMark from "./ui/CutMark.jsx";
import { api, ApiError, ERR, TIMEOUT, describeError } from "../lib/api.js";
import { logApi } from "../lib/bugLog.js";
import { supabaseEnabled, signInWithGoogle } from "../lib/supabase.js";

// Minimum must match backend/src/lib/auth.js MIN_PASSWORD_LENGTH. The server is
// the authority — this only saves a round trip and lets the message sit next to
// the field. A mismatch fails safe: the server rejects and we render its errors.
const MIN_PASSWORD_LENGTH = 8;

// ── /auth/status · /auth/register · /auth/reset/begin · /auth/reset/complete ──
//
// These four are the ONLY calls in the app that don't have an api.js method, so
// they were a bare fetch() with NO TIMEOUT — while every other call in the app
// goes through api.js and gets one. A wedged backend (started but not
// answering: mid-migration, a locked SQLite file, a half-dead dev server) left
// "Create account" spinning forever with no error and no way out — on the exact
// screen where a brand-new user meets a broken install and has nothing else to
// judge the app by.
//
// api.js's request() is module-private and that file belongs to another
// workstream this session, so this cannot literally call it. It instead uses
// api.js's PRIMITIVES — the same ApiError class, the same ERR taxonomy, the
// same TIMEOUT budgets, the same base-URL/nonce resolution, the same
// describeError() copy — so the two behave identically and a screen can't tell
// which one it went through. THE FIX THAT BELONGS UPSTREAM: four methods on
// api.js (authStatus / register / resetBegin / resetComplete, all authExempt),
// after which everything between here and the end of this block is deleted.
//
// Mirrors api.js's apiUrl()/handshakeHeaders(): inert with the current Electron
// shell (the bridge publishes neither key), correct if it ever does.
function bridge() {
  return (typeof window !== "undefined" && window.cutProtocol) || null;
}

/** A sentence, not a status code. `request failed: 404` told the user nothing
 *  and read like a crash on the first screen they ever see. */
function httpFallback(status) {
  if (status === 404) return "This version of the app asked the server for something it doesn't have — the two halves may be out of step.";
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (status >= 500) return `The app's server hit an error (${status}).`;
  return `The app's server refused that request (${status}).`;
}

async function authRequest(path, body, { timeoutMs = TIMEOUT.WRITE } = {}) {
  const method = body ? "POST" : "GET";
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;

  try {
    let res;
    try {
      res = await fetch(`${bridge()?.apiBaseUrl || ""}/api${path}`, {
        method,
        credentials: "include",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : null),
          ...(bridge()?.apiNonce ? { "X-Cut-Protocol-Nonce": bridge().apiNonce } : null),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (netErr) {
      // "We stopped waiting" and "it refused the connection" are DIFFERENT
      // failures — the first leaves the outcome genuinely unknown, and the
      // screen must not claim to know which one happened.
      if (timedOut) {
        logApi(method, path, "timeout");
        throw new ApiError(`no answer from the app's server after ${Math.round(timeoutMs / 1000)}s`, {
          kind: ERR.TIMEOUT, method, path, timeoutMs, cause: netErr,
        });
      }
      logApi(method, path, "network-error");
      throw new ApiError(netErr?.message || "couldn't reach the app's server", {
        kind: ERR.OFFLINE, method, path, cause: netErr,
      });
    }

    logApi(method, path, res.status); // status only — never a request/response body
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new ApiError(parsed?.error || httpFallback(res.status), {
        kind: ERR.HTTP, status: res.status, body: parsed, method, path,
      });
      err.fields = parsed?.fields || {};
      throw err;
    }
    return parsed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One honest sentence for anything thrown on this screen.
 *
 * describeError() alone is wrong here: it maps EVERY 401 to "Your session
 * expired", which is true on the rest of the app but nonsense on a sign-in form
 * where a 401 means the password was wrong. So auth's own 401 is handled first
 * and everything else falls through to the shared copy.
 */
function authErrorMessage(err, on401 = "Wrong email or password.") {
  if (err?.kind === ERR.HTTP && err.status === 401) return on401;
  return describeError(err, "Something went wrong. Try again.");
}

export default function LoginScreen({ onLoggedIn }) {
  // "checking" until /auth/status answers, then "register" (zero accounts on
  // this machine) or "login". Never guess: rendering a sign-in form to someone
  // who has no account is the bug this whole screen exists to fix.
  const [mode, setMode] = useState("checking");
  const [statusError, setStatusError] = useState(null);

  useEffect(() => {
    // Web build (saas-launch): sign-in is Google-only, so "does this machine
    // have an account yet" is meaningless — skip the status probe entirely.
    if (supabaseEnabled) return;
    let cancelled = false;
    // READ budget, not WRITE: this is the very first request the app makes, and
    // it decides whether a new user is shown "Create account" or "Sign in". It
    // must resolve one way or the other rather than hang on a wedged backend.
    authRequest("/auth/status", undefined, { timeoutMs: TIMEOUT.READ })
      .then((s) => {
        if (!cancelled) setMode(s?.needsSetup ? "register" : "login");
      })
      .catch((err) => {
        // Backend down / not reachable / not answering. Fall back to sign-in
        // (the safe default) and say what happened out loud — never a blank
        // screen and never an endless spinner.
        if (cancelled) return;
        setStatusError(describeError(err, "the app's server didn't answer"));
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
            <div className="text-xl font-heading font-bold tracking-tight uppercase" style={{ color: "var(--foreground)", letterSpacing: ".01em" }}>Cut Protocol</div>
            <div className="text-[10px] font-bold uppercase mt-1" style={{ color: "var(--muted-foreground)", letterSpacing: ".08em" }}>Recomp Engine</div>
          </div>
        </div>
        <Card>
          {supabaseEnabled ? (
            <GoogleSignIn />
          ) : (
            <>
              {mode === "checking" && (
                <div className="text-xs font-semibold py-2" style={{ color: "var(--muted-foreground)" }}>Checking this install…</div>
              )}
              {mode === "register" && <RegisterForm onLoggedIn={onLoggedIn} />}
              {mode === "login" && <LoginForm onLoggedIn={onLoggedIn} statusError={statusError} />}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// Web build (saas-launch): the ONLY way in. No password form exists on the
// deployed product, so nothing here submits credentials anywhere — the button
// leaves for Google and the browser comes back with a session, which App's
// boot() then confirms against the backend. `busy` never resets on success
// because on success this page is gone.
function GoogleSignIn() {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setBusy(false);
      setError(describeError(err, "Couldn't reach Google sign-in. Try again."));
    }
  };

  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Sign in to continue</div>
      <Btn onClick={go} disabled={busy}>
        <span className="inline-flex items-center justify-center gap-2.5">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
        </span>
      </Btn>
      {error && (
        <div className="text-[11px] font-semibold" style={{ color: "var(--destructive)" }}>{error}</div>
      )}
      <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
        No passwords — your Google account handles sign-in.
      </p>
      {/* Stage 4: the legal + medical line the consent flow expects at signup. */}
      <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
        By continuing you agree to the{" "}
        <a href="/terms.html" className="underline hover:opacity-80">Terms</a> and{" "}
        <a href="/privacy.html" className="underline hover:opacity-80">Privacy Policy</a>.
        Cut Protocol offers nutrition planning, not medical advice.
      </p>
    </div>
  );
}

const inpStyle = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };

function FieldError({ children }) {
  if (!children) return null;
  return <div className="text-[11px] font-semibold mt-1" style={{ color: "var(--destructive)" }}>{children}</div>;
}

// A password field with a show/hide eye. There is no way to reveal a STORED
// password (it's a one-way hash) — this only shows what you're typing right now,
// so you can confirm a login or read back a new password before you commit to it.
// Defaults to hidden; the toggle never leaves the field's value anywhere.
function PasswordInput({ value, onChange, autoComplete, autoFocus, required, ariaInvalid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        aria-invalid={ariaInvalid}
        className="text-sm pl-3 pr-10 py-2.5 rounded-xl w-full"
        style={inpStyle}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:opacity-80"
        style={{ color: "var(--muted-foreground)" }}
      >
        {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
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
      // A 401 here is a bad password, NOT an expired session — see
      // authErrorMessage. Everything else (timeout, refused, 500) gets the
      // shared honest copy instead of a raw status code.
      setError(authErrorMessage(err));
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
        <div role="alert" className="text-[11px] font-semibold" style={{ color: "var(--warn)" }}>
          Couldn't reach the app's backend ({statusError}). If this is a brand-new install, start the app again — account setup needs the backend running.
        </div>
      )}
      <label className="block">
        <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} autoFocus />
      </label>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Password</span>
        <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>
      {error && <div role="alert" className="text-xs font-semibold" style={{ color: "var(--destructive)" }}>{error}</div>}
      <Btn disabled={busy}>{busy ? "Logging in…" : "Log in"}</Btn>
      <button type="button" onClick={() => setResetting(true)}
        className="text-[11px] font-semibold w-full text-center pt-1 hover:opacity-80"
        style={{ color: "var(--muted-foreground)" }}>
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
      setError(authErrorMessage(err, "That didn't work — sign in again or start over."));
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
      setError(authErrorMessage(err, "That didn't work — start the reset over."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[15px] font-bold" style={{ color: "var(--foreground)", letterSpacing: "-.01em" }}>Reset your password</div>
        <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
          No email needed — the code is saved to a file on this computer.
        </div>
      </div>

      {step === "request" && (
        <form onSubmit={request} className="space-y-3" noValidate>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Email</span>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setFields({}); }}
              aria-invalid={!!fields.email}
              className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} autoFocus />
            <FieldError>{fields.email}</FieldError>
          </label>
          {error && <div role="alert" className="text-xs font-semibold" style={{ color: "var(--destructive)" }}>{error}</div>}
          <Btn disabled={busy}>{busy ? "Preparing…" : "Get a reset code"}</Btn>
          <button type="button" onClick={onCancel}
            className="text-[11px] font-semibold w-full text-center pt-1 hover:opacity-80" style={{ color: "var(--muted-foreground)" }}>
            Back to sign in
          </button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={complete} className="space-y-3" noValidate>
          <div className="text-[11px] rounded-xl p-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
            Open this file on your computer and copy the code inside
            {" "}(<span className="font-mono">~</span> is your user folder):
            <div className="font-mono mt-1 break-all" style={{ color: "var(--foreground)" }}>{filePath || "the app's data folder"}</div>
            {/* "var(--muted-foreground)" (60%), not "var(--muted-foreground)" (38% = 3.26:1) — this is body
                text a user has to READ to finish a reset, and the 38% tier
                fails WCAG AA. The 38% tier is for decoration, never prose. */}
            <div className="mt-1" style={{ color: "var(--muted-foreground)" }}>The code expires 15 minutes after you requested it.</div>
          </div>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Code from the file</span>
            <input type="text" value={code} onChange={(e) => { setCode(e.target.value); if (fields.code) setFields((f) => ({ ...f, code: undefined })); }}
              autoComplete="one-time-code" aria-invalid={!!fields.code}
              className="text-sm px-3 py-2.5 rounded-xl w-full mt-1 font-mono tracking-wide" style={inpStyle} autoFocus />
            <FieldError>{fields.code}</FieldError>
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>New password</span>
            <PasswordInput value={password} onChange={(e) => { setPassword(e.target.value); if (fields.password) setFields((f) => ({ ...f, password: undefined })); }}
              autoComplete="new-password" ariaInvalid={!!fields.password} />
            <FieldError>{fields.password}</FieldError>
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Confirm new password</span>
            <PasswordInput value={confirm} onChange={(e) => { setConfirm(e.target.value); if (fields.confirm) setFields((f) => ({ ...f, confirm: undefined })); }}
              autoComplete="new-password" ariaInvalid={!!fields.confirm} />
            <FieldError>{fields.confirm}</FieldError>
          </label>
          {error && <div role="alert" className="text-xs font-semibold" style={{ color: "var(--destructive)" }}>{error}</div>}
          <Btn disabled={busy}>{busy ? "Setting password…" : "Set new password"}</Btn>
          <button type="button" onClick={onCancel}
            className="text-[11px] font-semibold w-full text-center pt-1 hover:opacity-80" style={{ color: "var(--muted-foreground)" }}>
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
      setError(authErrorMessage(err, "Couldn't create the account — try again."));
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
        <div className="text-[15px] font-bold" style={{ color: "var(--foreground)", letterSpacing: "-.01em" }}>Create your account</div>
        <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
          This machine has no account yet. Everything you log stays in this app, on this computer.
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Email</span>
        <input type="email" value={email} onChange={set(setEmail, "email")} autoComplete="username"
          aria-invalid={!!fields.email}
          className="text-sm px-3 py-2.5 rounded-xl w-full mt-1" style={inpStyle} autoFocus />
        <FieldError>{fields.email}</FieldError>
      </label>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Password</span>
        <PasswordInput value={password} onChange={set(setPassword, "password")} autoComplete="new-password" ariaInvalid={!!fields.password} />
        <FieldError>{fields.password}</FieldError>
        {/* "var(--muted-foreground)" (60%), not "var(--muted-foreground)" (38% = 3.26:1, fails WCAG AA):
            this is the password rule itself, on the first screen a new user
            ever sees. It has to be readable. */}
        {!fields.password && (
          <div className="text-[11px] mt-1" style={{ color: "var(--muted-foreground)" }}>At least {MIN_PASSWORD_LENGTH} characters — use the eye to check it. Forgot it later? You can reset it from the sign-in screen using a code saved on this computer.</div>
        )}
      </label>
      <label className="block">
        <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Confirm password</span>
        <PasswordInput value={confirmPassword} onChange={set(setConfirmPassword, "confirmPassword")} autoComplete="new-password" ariaInvalid={!!fields.confirmPassword} />
        <FieldError>{fields.confirmPassword}</FieldError>
      </label>
      {error && <div role="alert" className="text-xs font-semibold" style={{ color: "var(--destructive)" }}>{error}</div>}
      <Btn disabled={busy}>{busy ? "Creating account…" : "Create account"}</Btn>
    </form>
  );
}
