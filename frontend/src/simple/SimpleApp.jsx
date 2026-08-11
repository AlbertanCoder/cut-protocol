import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, isAbortError, isAuthError, onSessionExpired } from "../lib/api.js";
import { uiMode } from "../lib/uiMode.js";
import LoginScreen from "../components/LoginScreen.jsx";
import SimpleOnboarding from "./SimpleOnboarding.jsx";
import SimpleToday from "./SimpleToday.jsx";
import SimpleWeight from "./SimpleWeight.jsx";
import { Screen, Big, Note, Details } from "./parts.jsx";

// The simple surface's shell: sign in, six questions, then two screens.
//
// WHY THIS IS A SIBLING OF App AND NOT A BRANCH INSIDE IT
// App.jsx's auth chain, data loading, 401 seam, and tab routing are all inside
// DO-NOT-TOUCH.md's protected regions (lines 34-62, 107-121, 123-172, 245-304).
// Threading a second surface through them means editing them. This shell
// re-implements the parts it needs — roughly forty lines — so that App.jsx
// keeps exactly one modified line: which component AppWithTheme renders.
//
// The cost of that choice, stated plainly: the boot sequence below is a second
// copy of the same idea, and a future change to auth has two homes. It is the
// smaller of the two risks, but it is not free. If the two ever disagree, this
// one is the copy that is wrong — App.jsx is the original.
//
// NOT DUPLICATED, on purpose: the upgrade/penny checkout flow, admin detection,
// the bug-report dialog, the Wellbeing dialog, and the Compare dialog. Those
// live on the full surface. "Show me the details" is one click from every
// screen here, which is also how the wellbeing resources stay reachable —
// they are never hidden or greyed out, they are one door away.

const goFull = () => uiMode.set("full");

export default function SimpleApp() {
  // checking | out | unreachable | in — same vocabulary as App.jsx:34-38.
  const [authStatus, setAuthStatus] = useState("checking");
  const [profile, setProfile] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Keeps a late 401 — an in-flight request landing just after a deliberate
  // sign-out — from overwriting the reason with "expired". App.jsx:172-186.
  const authStatusRef = useRef(authStatus);
  useEffect(() => { authStatusRef.current = authStatus; }, [authStatus]);

  useEffect(() => onSessionExpired(() => {
    if (authStatusRef.current !== "in") return;
    setProfile(null);
    setNeedsSetup(false);
    setBootError(null);
    setTab("today");
    setNotice("Your session expired — sign in again to continue.");
    setAuthStatus("out");
  }), []);

  const loadData = useCallback(async () => {
    const p = await api.getProfile();
    if (!p) { setNeedsSetup(true); return; }
    setNeedsSetup(false);
    setProfile(p);
  }, []);

  // A failed data load must NOT read as logged-out, and neither must a server
  // that never answered. Only a real 401 goes to the sign-in screen.
  const boot = useCallback(async () => {
    setBootError(null);
    try {
      await api.me();
    } catch (e) {
      if (isAbortError(e)) return;
      if (isAuthError(e)) { setAuthStatus("out"); return; }
      setBootError(describeError(e));
      setAuthStatus("unreachable");
      return;
    }
    setAuthStatus("in");
    try {
      await loadData();
    } catch (e) {
      if (!isAbortError(e)) setBootError(describeError(e));
    }
  }, [loadData]);

  useEffect(() => { boot(); }, [boot]);

  if (authStatus === "checking") {
    return <Screen><p className="text-lg text-muted-foreground">One moment…</p></Screen>;
  }

  if (authStatus === "unreachable") {
    return (
      <Screen>
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">Can't reach the app right now</h1>
          {bootError && <Note>{bootError}</Note>}
          <Big onClick={boot}>Try again</Big>
          <Details onClick={goFull} />
        </div>
      </Screen>
    );
  }

  if (authStatus === "out") {
    return (
      <>
        {notice && (
          <div className="px-6 pt-6 max-w-xl mx-auto">
            <Note>{notice}</Note>
          </div>
        )}
        <LoginScreen onLoggedIn={async () => { setNotice(null); setAuthStatus("in"); await loadData(); }} />
      </>
    );
  }

  if (needsSetup) {
    return <SimpleOnboarding onDone={loadData} onShowFull={goFull} />;
  }

  if (!profile) {
    return (
      <Screen>
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">That didn't load</h1>
          {bootError && <Note>{bootError}</Note>}
          <Big onClick={boot}>Try again</Big>
          <Details onClick={goFull} />
        </div>
      </Screen>
    );
  }

  // ONE SCREEN. No tabs, no nav bar, nothing to find.
  //
  // Two things exist on this surface — the day of food and the weight box — and
  // a navigation system for two items is a thing to learn. Food is on top
  // because it is what gets opened twenty times a week; weight sits below it
  // because it is a five-second job done once a day.
  //
  // The weight section is deliberately two elements and no more: a box and a
  // line. No seven-day average, no rate, no projected date. The moment a third
  // number appears down there it is a dashboard again, which is the thing this
  // surface exists to not be.
  return (
    <div className="min-h-svh bg-background text-foreground">
      <a href="#simple-main" className="skip-link">Skip to main content</a>

      <main id="simple-main" className="mx-auto w-full max-w-xl px-6 pt-10 pb-16 flex flex-col gap-12">
        <SimpleToday profile={profile} />

        <hr className="border-border" />

        <SimpleWeight profile={profile} onSaved={loadData} />

        <div className="flex flex-col items-start gap-3 pt-2">
          <Details onClick={goFull} />
          {/* The support resources are never hidden and never greyed out — a
              standing safety rule that survives any visual direction. On this
              surface they are one labelled click away, on the full app's
              Wellbeing tab. */}
          <Details onClick={goFull} label="Support and wellbeing resources" />
        </div>
      </main>
    </div>
  );
}
