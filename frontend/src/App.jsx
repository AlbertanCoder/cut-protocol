import { useState, useEffect, useCallback } from "react";
import { Activity, TrendingUp, Calculator, CalendarDays, Search, BookOpen, LogOut, Sun, Moon } from "lucide-react";
import { api } from "./lib/api.js";
import { C, applyTheme } from "./lib/theme.js";
import { themePref } from "./lib/storage.js";

import LoginScreen from "./components/LoginScreen.jsx";
import TodayTab from "./components/TodayTab.jsx";
import TrendTab from "./components/TrendTab.jsx";
import EngineTab from "./components/EngineTab.jsx";
import PlanTab from "./components/PlanTab.jsx";
import FoodsTab from "./components/FoodsTab.jsx";
import RecipesTab from "./components/RecipesTab.jsx";

const kc = (n) => Math.round(n).toLocaleString("en-CA");

export default function App() {
  const [authStatus, setAuthStatus] = useState("checking"); // checking | out | in
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState("today");
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [theme, setTheme] = useState(() => themePref.get());

  // Applied synchronously during render (not in an effect): applyTheme just
  // toggles a DOM class and mutates the C palette object in place, neither
  // of which triggers a re-render on its own, so doing it in an effect left
  // one stale paint between clicking the toggle and colors actually
  // updating. Calling it here keeps C in sync with `theme` on every render,
  // including the one caused by clicking the toggle itself. Idempotent and
  // cheap (a classList.toggle + a handful of getComputedStyle reads).
  applyTheme(theme);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    themePref.set(next);
    setTheme(next);
  };

  const loadData = useCallback(async () => {
    let p = await api.getProfile();
    if (!p) p = await api.putProfile({}); // first login — creates a default profile row
    setProfile(p);
    setSummary(await api.getSummary());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setIsAdmin(me.role === "admin");
        setAuthStatus("in");
        await loadData();
      } catch {
        setAuthStatus("out");
      }
    })();
  }, [loadData]);

  const refresh = useCallback(async () => {
    try {
      await loadData();
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [loadData]);

  const logout = async () => {
    await api.logout();
    setProfile(null);
    setSummary(null);
    setAuthStatus("out");
  };

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
      </div>
    );
  }

  if (authStatus === "out") {
    return <LoginScreen onLoggedIn={async () => { setAuthStatus("in"); await loadData(); }} />;
  }

  if (!profile || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
      </div>
    );
  }

  const TABS = [
    { id: "today", label: "Today", icon: Activity },
    { id: "trend", label: "Trend", icon: TrendingUp },
    { id: "engine", label: "Engine", icon: Calculator },
    { id: "plan", label: "Plan", icon: CalendarDays },
    { id: "foods", label: "Foods", icon: Search },
    { id: "recipes", label: "Recipes", icon: BookOpen },
  ];

  return (
    <div className="min-h-screen transition-colors duration-150" style={{ background: C.paper, color: C.ink, fontFamily: "-apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}>
      <header className="px-4 pt-4 pb-3.5 flex items-center justify-between sticky top-0 z-10 transition-colors duration-150" style={{ background: C.card, borderBottom: `1px solid ${C.rule}` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-extrabold text-sm" style={{ background: C.accent, color: "#fff" }}>C</div>
          <div>
            <div className="font-extrabold text-[15px] leading-none" style={{ letterSpacing: "-.01em" }}>Cut Protocol</div>
            <div className="text-[11px] font-semibold mt-0.5" style={{ color: C.faint }}>Day {summary.daysIn} · {kc(profile.targetKcal)} kcal</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors duration-150 hover:opacity-80"
            style={{ color: C.faint, border: `1px solid ${C.rule}` }}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold hover:opacity-80" style={{ color: C.faint }}>
            <LogOut size={13} /> Log out
          </button>
        </div>
      </header>

      {error && (
        <div className="text-xs font-semibold px-4 py-2" style={{ color: C.red, background: C.redBg }}>
          {error} — retry by making any change.
        </div>
      )}

      <main className="pt-4 pb-24 px-3 max-w-xl mx-auto">
        {tab === "today" && <TodayTab profile={profile} summary={summary} refresh={refresh} isAdmin={isAdmin} />}
        {tab === "trend" && <TrendTab profile={profile} summary={summary} isAdmin={isAdmin} />}
        {tab === "engine" && <EngineTab profile={profile} summary={summary} refresh={refresh} isAdmin={isAdmin} />}
        {tab === "plan" && <PlanTab profile={profile} summary={summary} refresh={refresh} />}
        {tab === "foods" && <FoodsTab />}
        {tab === "recipes" && <RecipesTab isAdmin={isAdmin} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 transition-colors duration-150" style={{ background: C.card, borderTop: `1px solid ${C.rule}` }}>
        <div className="max-w-xl mx-auto grid grid-cols-6 px-1.5 py-2 gap-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="text-[10.5px] font-bold py-1.5 rounded-xl flex flex-col items-center gap-0.5 transition-colors duration-150"
                style={{ color: active ? C.accent : C.faint, background: active ? C.accentBg : "transparent" }}>
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
