import { useState, useEffect, useCallback } from "react";
import { api } from "./lib/api.js";
import { C } from "./lib/theme.js";

import LoginScreen from "./components/LoginScreen.jsx";
import SetupWizard from "./components/SetupWizard.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ProfileTab from "./components/ProfileTab.jsx";
import TodayTab from "./components/TodayTab.jsx";
import TrendTab from "./components/TrendTab.jsx";
import EngineTab from "./components/EngineTab.jsx";
import PlanTab from "./components/PlanTab.jsx";
import FoodsTab from "./components/FoodsTab.jsx";
import RecipesTab from "./components/RecipesTab.jsx";

export default function App() {
  const [authStatus, setAuthStatus] = useState("checking"); // checking | out | in
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [tab, setTab] = useState("today");
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadData = useCallback(async () => {
    const p = await api.getProfile();
    if (!p) {
      // First-ever launch for this account — run the setup wizard instead of
      // silently creating a default profile row.
      setNeedsSetup(true);
      return;
    }
    setNeedsSetup(false);
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
    setTab("today");
  };

  const loading = (
    <div className="min-h-svh flex items-center justify-center" style={{ background: C.paper }}>
      <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
    </div>
  );

  if (authStatus === "checking") return loading;

  if (authStatus === "out") {
    return <LoginScreen onLoggedIn={async () => { setAuthStatus("in"); await loadData(); }} />;
  }

  if (needsSetup) {
    return <SetupWizard onDone={loadData} />;
  }

  if (!profile || !summary) return loading;

  const openFoods = () => setTab("foods");

  return (
    <div className="min-h-svh flex" style={{ background: C.paper, color: C.ink }}>
      <Sidebar tab={tab} setTab={setTab} profile={profile} summary={summary} onLogout={logout} />

      <div className="flex-1 min-w-0">
        {error && (
          <div className="text-xs font-semibold px-8 py-2" style={{ color: C.red, background: C.redBg }}>
            {error} — couldn't refresh your data. Repeat your last change to retry; if it keeps failing, restart the app.
          </div>
        )}

        <main className="px-5 py-6 lg:px-9 lg:py-8 max-w-[1600px]">
          {tab === "profile" && <ProfileTab profile={profile} summary={summary} refresh={refresh} />}
          {tab === "today" && <TodayTab profile={profile} summary={summary} refresh={refresh} openTrend={() => setTab("trend")} />}
          {tab === "trend" && <TrendTab profile={profile} summary={summary} />}
          {tab === "engine" && <EngineTab profile={profile} summary={summary} refresh={refresh} openFoods={openFoods} openProfile={() => setTab("profile")} />}
          {tab === "plan" && <PlanTab profile={profile} summary={summary} refresh={refresh} />}
          {tab === "foods" && <FoodsTab onBack={() => setTab("recipes")} isAdmin={isAdmin} />}
          {tab === "recipes" && <RecipesTab openFoods={openFoods} profile={profile} />}
        </main>
      </div>
    </div>
  );
}
