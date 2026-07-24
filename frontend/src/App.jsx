import { useState, useEffect, useCallback, useRef } from "react";
import { api, isAuthError, isAbortError, isNoAnswer, describeError, onSessionExpired } from "./lib/api.js";
import { useAbortSignal } from "./lib/useAbortable.js";
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
  // checking | out | unreachable | in
  //   out         = the server ANSWERED and said "not authenticated" (401)
  //   unreachable = the server never answered, or answered with a 5xx. The
  //                 session may be perfectly valid — showing the login screen
  //                 here would be a lie (fleet finding resilience-errors-5).
  const [authStatus, setAuthStatus] = useState("checking");
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
  const [bootError, setBootError] = useState(null); // couldn't reach/boot the server at all
  const [sessionNotice, setSessionNotice] = useState(null); // shown on the sign-in screen
  const [isAdmin, setIsAdmin] = useState(false);
  const [bugReport, setBugReport] = useState({ open: false, error: null });
  const abort = useAbortSignal();

  // a11y: this is a single-page app with no real route change (tab content
  // swaps in place), so nothing tells a screen-reader or keyboard user the
  // "page" changed. On every tab switch after the first render, move focus
  // to the new view's own <h1> (every tab renders one via PageHead) — the
  // standard SPA route-change pattern. Skipped on first mount so load
  // doesn't yank focus away from wherever the browser naturally put it.
  const mainRef = useRef(null);
  const skipFirstFocus = useRef(true);
  useEffect(() => {
    if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
    const el = mainRef.current;
    if (!el) return;
    const target = el.querySelector("h1") || el;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: false });
  }, [tab]);

  // Uncaught async errors (unhandled rejections, window.onerror) surface the
  // friendly report dialog instead of failing silently.
  useEffect(() => {
    onUncaughtError((err) => setBugReport({ open: true, error: err }));
  }, []);
  const openBugReport = () => setBugReport({ open: true, error: null });

  // ── THE 401 SEAM (frontend-arch-3) ─────────────────────────────────────
  // api.js calls this for a real HTTP 401 and nothing else — never for a
  // 500, a timeout, or a refused connection. One place, one behaviour:
  // drop the local session state and land on sign-in with an honest reason.
  // The ref keeps a late 401 (e.g. an in-flight request landing just after a
  // deliberate sign-out) from overwriting the reason with "expired".
  const authStatusRef = useRef(authStatus);
  useEffect(() => { authStatusRef.current = authStatus; }, [authStatus]);
  useEffect(() => onSessionExpired(() => {
    if (authStatusRef.current !== "in") return;
    setProfile(null);
    setSummary(null);
    setNeedsSetup(false);
    setIsAdmin(false);
    setLoadError(null);
    setBootError(null);
    setError(null);
    setTab("today");
    setSessionNotice("Your session expired — sign in again to continue.");
    setAuthStatus("out");
  }), []);

  const loadData = useCallback(async () => {
    const p = await api.getProfile({ signal: abort.signal });
    if (!p) {
      // First-ever launch for this account — run the setup wizard instead of
      // silently creating a default profile row.
      setNeedsSetup(true);
      return;
    }
    setNeedsSetup(false);
    setProfile(p);
    setSummary(await api.getSummary({ signal: abort.signal }));
  }, [abort]);

  const boot = useCallback(async () => {
    // Stage-C fix (#44) + frontend-arch-3: a failed data load must NOT read
    // as logged-out, and neither must a server that never answered. ONLY an
    // actual 401 sends the user to the sign-in screen.
    setBootError(null);
    let me;
    try {
      me = await api.me({ signal: abort.signal });
    } catch (e) {
      if (isAbortError(e)) return;
      if (isAuthError(e)) { setAuthStatus("out"); return; }
      setBootError(describeError(e));
      setAuthStatus("unreachable");
      return;
    }
    setIsAdmin(me.role === "admin");
    setAuthStatus("in");
    try {
      setLoadError(null);
      await loadData();
    } catch (e) {
      if (isAbortError(e)) return;
      setLoadError(describeError(e, "Couldn't load your data."));
    }
  }, [loadData, abort]);

  useEffect(() => { boot(); }, [boot]);

  const refresh = useCallback(async () => {
    try {
      await loadData();
      setError(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    }
  }, [loadData]);

  // Guarded (frontend-arch-4): a failed/slow logout used to be an unhandled
  // rejection straight into the crash dialog. Whatever the server does, the
  // local session state is cleared — but we say so honestly when the server
  // never confirmed it.
  const logout = async () => {
    let notice = null;
    try {
      await api.logout();
    } catch (e) {
      if (!isAbortError(e)) {
        notice = isNoAnswer(e)
          ? "Signed out on this device — the server didn't confirm, so sign out again once it's reachable."
          : `Signed out on this device — the server reported: ${describeError(e)}`;
      }
    }
    setProfile(null);
    setSummary(null);
    setNeedsSetup(false);
    setIsAdmin(false);
    setLoadError(null);
    setError(null);
    setSessionNotice(notice);
    setAuthStatus("out");
    setTab("today");
  };

  // Guarded: SetupWizard (and the login screen) hand control back here; a
  // throw from loadData must land in a retryable UI, never the crash dialog.
  const afterAuthLoad = useCallback(async () => {
    try {
      setLoadError(null);
      await loadData();
    } catch (e) {
      if (isAbortError(e)) return;
      setLoadError(describeError(e, "Couldn't load your data."));
    }
  }, [loadData]);

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

  // The server didn't answer (or 5xx'd). This is NOT a logged-out state and
  // must never be dressed up as one — the user's session is probably fine.
  if (authStatus === "unreachable") {
    return withDialog(
      <div className="min-h-svh flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-bold" style={{ color: C.red }}>Can't reach the app's server</div>
        <div className="text-xs font-semibold max-w-sm" style={{ color: C.faint }}>
          {bootError} You are not signed out — the app just couldn't get an answer. If this persists, close and reopen Cut Protocol.
        </div>
        <button onClick={boot} className="text-sm font-bold px-4 py-2 rounded-xl" style={{ background: C.accent, color: C.accentInk }}>Retry</button>
      </div>
    );
  }

  if (authStatus === "out") {
    return withDialog(
      <div className="relative">
        {sessionNotice && (
          <div role="status" className="absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-5">
            <div className="text-xs font-bold px-4 py-2.5 rounded-xl max-w-md text-center"
              style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
              {sessionNotice}
            </div>
          </div>
        )}
        {/* The expired-session notice is rendered HERE, not inside
            LoginScreen — App owns session state and LoginScreen is being
            edited in parallel (see docs/qc/handoff/agent07.md). */}
        <LoginScreen
          onLoggedIn={async () => {
            setSessionNotice(null);
            setAuthStatus("in");
            await afterAuthLoad();
          }}
        />
      </div>
    );
  }

  if (needsSetup) {
    return withDialog(<SetupWizard onDone={afterAuthLoad} />);
  }

  // A valid session whose data couldn't load: a retryable error, NOT the login
  // screen and NOT an infinite "Loading…" (#44).
  if (loadError && (!profile || !summary)) {
    return withDialog(
      <div className="min-h-svh flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-bold" style={{ color: C.red }}>Couldn't load your data</div>
        <div className="text-xs font-semibold max-w-sm" style={{ color: C.faint }}>
          {loadError} You are still signed in — this is a load failure, not a sign-out.
        </div>
        <button onClick={boot} className="text-sm font-bold px-4 py-2 rounded-xl" style={{ background: C.accent, color: C.accentInk }}>Retry</button>
      </div>
    );
  }

  if (!profile || !summary) return withDialog(loading);

  const openFoods = () => setTab("foods");

  return withDialog(
    <div className="min-h-svh flex" style={{ color: C.ink }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Sidebar tab={tab} setTab={setTab} onLogout={logout} onReportBug={openBugReport} />

      <div className="flex-1 min-w-0">
        <HeaderBar profile={profile} summary={summary} />
        {error && (
          <div role="alert" className="text-xs font-semibold px-8 py-2" style={{ color: C.red, background: C.redBg }}>
            {error} — couldn't refresh your data. Repeat your last change to retry; if it keeps failing, restart the app.
          </div>
        )}

        <main id="main-content" ref={mainRef} tabIndex={-1} className="px-5 py-6 lg:px-9 lg:py-8 max-w-[1600px]">
          {tab === "profile" && <ProfileTab profile={profile} summary={summary} refresh={refresh} />}
          {tab === "today" && <TodayTab profile={profile} summary={summary} refresh={refresh} openTrend={() => setTab("trend")} />}
          {tab === "trend" && <TrendTab profile={profile} summary={summary} openTraining={() => setTab("training")} />}
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
