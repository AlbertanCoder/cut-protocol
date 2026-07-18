import { useState } from "react";
import { C } from "../lib/theme.js";
import { Card, Btn } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

export default function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inpStyle = { background: C.paper, border: `1.5px solid ${C.rule}`, color: C.ink };

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
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: C.paper }}>
      <div className="w-full max-w-xs">
        <div className="flex items-center gap-2.5 mb-5 justify-center">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-base" style={{ background: C.accent, color: "#fff" }}>C</div>
          <div className="text-xl font-extrabold" style={{ color: C.ink, letterSpacing: "-.01em" }}>Cut Protocol</div>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-3">
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
            {error && <div className="text-xs font-semibold" style={{ color: C.red }}>{error}</div>}
            <Btn disabled={busy}>{busy ? "Logging in…" : "Log in"}</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
