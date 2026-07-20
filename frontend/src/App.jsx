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
import TrainingTab from "./components/TrainingTab.jsx";
import BrainChat from "./components/BrainChat.jsx";
import BugReportDialog from "./components/BugReportDialog.jsx";
import HeaderBar from "./components/ui/HeaderBar.jsx";
import { SkeletonCard } from "./components/ui/Skeleton.jsx";
import { onUncaughtError } from "./lib/bugLog.js";
import { TRAINING } from "./lib/flags.js";

export default function App() {
  const [authStatus, setAuthStatus] = useState("checking"); // checking | out | in
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [tab, setTab] = useState("today");
  // If the training flag is flipped off while Training is the active tab,
  // land on Today instead of a blank pane.
  useEffect(() => {
    if (tab === "training" && TRAINING !== "on") setTab("today");
  }, [tab]);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null); // startup data-load failure (session is still valid)
  const [isAdmin, setIsAdmin] = useState(false);
  const [bugReport, setBugReport] = useState({ open: false, error: null });

  // Uncaught async errors (unhandled rejections, window.onerror) surface the
  // friendly report dialog instead of failing silently.
  useEffect(() => {
    onUncaughtError((err) => setBugReport({ open: true, error: err }));
  }, []);
  const openBugReport = () => setBugReport({ open: true, error: null });

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

  const boot = useCallback(async () => {
    // Stage-C fix (#44): a failed data load must NOT read as logged-out. Only
    // an auth failure sends the user to the login screen; a data-load error
    // keeps the valid session and shows a retryable error screen.
    let me;
    try {
      me = await api.me();
    } catch {
      setAuthStatus("out");
      return;
    }
    setIsAdmin(me.role === "admin");
    setAuthStatus("in");
    try {
      setLoadError(null);
      await loadData();
    } catch (e) {
      setLoadError(e.message || "Couldn't load your data.");
    }
  }, [loadData]);

  useEffect(() => { boot(); }, [boot]);

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
    <div className="min-h-svh flex items-center justify-center">
      <div className="w-[420px] max-w-[80vw] flex flex-col gap-3">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );

  // The bug-report dialog rides on top of every app state (login, wizard,
  // loading, main) so an uncaught error can always surface a report. The
  // aurora + grain ambience layers wrap every state the same way; content
  // sits at z-1 so the fixed aurora stays behind it.
  const dialog = <BugReportDialog open={bugReport.open} error={bugReport.error} onClose={() => setBugReport({ open: false, error: null })} />;
  const withDialog = (content) => (
    <>
      <div className="aurora" aria-hidden="true" />
      <div className="relative z-[1]">{content}</div>
      <div className="grain" aria-hidden="true" />
      {dialog}
    </>
  );

  if (authStatus === "checking") return withDialog(loading);

  if (authStatus === "out") {
    return withDialog(<LoginScreen onLoggedIn={async () => { setAuthStatus("in"); await loadData(); }} />);
  }

  if (needsSetup) {
    return withDialog(<SetupWizard onDone={loadData} />);
  }

  // A valid session whose data couldn't load: a retryable error, NOT the login
  // screen and NOT an infinite "Loading…" (#44).
  if (loadError && (!profile || !summary)) {
    return withDialog(
      <div className="min-h-svh flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-bold" style={{ color: C.red }}>Couldn't load your data</div>
        <div className="text-xs font-semibold max-w-sm" style={{ color: C.faint }}>{loadError}</div>
        <button onClick={boot} className="text-sm font-bold px-4 py-2 rounded-xl" style={{ background: C.accent, color: C.accentInk }}>Retry</button>
      </div>
    );
  }

  if (!profile || !summary) return withDialog(loading);

  const openFoods = () => setTab("foods");

  return withDialog(
    <div className="min-h-svh flex" style={{ color: C.ink }}>
      <Sidebar tab={tab} setTab={setTab} onLogout={logout} onReportBug={openBugReport} />

      <div className="flex-1 min-w-0">
        <HeaderBar profile={profile} summary={summary} />
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
          {tab === "training" && TRAINING === "on" && <TrainingTab />}
        </main>
      </div>
      <BrainChat />
    </div>
  );
}
