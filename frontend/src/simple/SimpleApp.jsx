import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, isAbortError, isAuthError, onSessionExpired } from "../lib/api.js";
import { uiMode } from "../lib/uiMode.js";
import LoginScreen from "../components/LoginScreen.jsx";
import SimpleOnboarding from "./SimpleOnboarding.jsx";
import SimpleToday from "./SimpleToday.jsx";
import SimpleWeight from "./SimpleWeight.jsx";
import SimplePlan from "./SimplePlan.jsx";
import SimpleRecipes from "./SimpleRecipes.jsx";
import SimpleShopping from "./SimpleShopping.jsx";
import SimplePrescription from "./SimplePrescription.jsx";
import SimpleDetails from "./SimpleDetails.jsx";
import SimpleProgress from "./SimpleProgress.jsx";
import { Screen, Big, Note, Details, Tabs, Busy } from "./parts.jsx";

// The three rooms behind the Food door. Plan first — it is what the week is.
const FOOD_ROOMS = [
  { id: "plan", label: "Plan" },
  { id: "recipes", label: "Recipes" },
  { id: "shopping", label: "Shopping" },
  // The prescription solver's preview room (Phase 5/6 increment): read-only,
  // solved to the directive ruler, persists nothing.
  { id: "preview", label: "Preview" },
];

// The four doors. `built` marks which have a rebuilt room; the rest hand over
// to the full app rather than opening onto nothing. Mirrors the SECTIONS list
// in lib/nav.js (23158d9) — today · food · progress · setup.
const DOORS = [
  { id: "today", label: "Today", built: true },
  { id: "food", label: "Food", built: true },
  { id: "progress", label: "Progress", built: true },
  { id: "you", label: "You", built: true },
];

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
  const [summary, setSummary] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [door, setDoor] = useState("today");
  // Which room is open behind the Food door. Visual state only — it reaches
  // neither the network nor storage.
  const [room, setRoom] = useState("plan");

  // Keeps a late 401 — an in-flight request landing just after a deliberate
  // sign-out — from overwriting the reason with "expired". App.jsx:172-186.
  const authStatusRef = useRef(authStatus);
  useEffect(() => { authStatusRef.current = authStatus; }, [authStatus]);

  useEffect(() => onSessionExpired(() => {
    if (authStatusRef.current !== "in") return;
    setProfile(null);
    setSummary(null);
    setNeedsSetup(false);
    setBootError(null);
    // setDoor, not setTab. `tab` was this shell's state before the surface
    // became one screen; the rename left this call behind and it would have
    // thrown a ReferenceError the first time a session expired — on the one
    // path nobody exercises until it matters.
    setDoor("today");
    setRoom("plan");
    setNotice("Your session expired — sign in again to continue.");
    setAuthStatus("out");
  }), []);

  const loadData = useCallback(async () => {
    const p = await api.getProfile();
    if (!p) { setNeedsSetup(true); return; }
    setNeedsSetup(false);
    setProfile(p);
    // Your details shows the seven-day average as "weight now". The summary is
    // fetched separately, exactly as App.jsx:198 does it, and a failure here
    // must not take the whole surface down — the rest of the app is still
    // correct without it.
    try {
      setSummary(await api.getSummary());
    } catch {
      // "error", not null. Progress used `!summary` as its loading test, so a
      // failed summary left that whole door spinning forever with no way to
      // retry. A distinguishable value lets it show a real error instead.
      setSummary("error");
    }
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
    // Busy, not hand-rolled markup — parts.jsx:324 is this exact element, and
    // it exists because "Loading…" tells nobody anything. The first screen a
    // new person sees should obey the same rule as every other wait.
    return <Screen><Busy>Signing you in…</Busy></Screen>;
  }

  if (authStatus === "unreachable") {
    return (
      <Screen>
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">Can't reach the app right now</h1>
          {bootError && (
            <>
              {/* The calm line is for the person. On the offline path the raw
                  describeError string says "the change was not sent" — on first
                  load there was no change, so it does not render bare. */}
              <Note>Nothing was lost. If this keeps happening, close Cut Protocol completely and open it again.</Note>
              {/* The raw string survives, one small click away, for whoever is
                  helping them figure it out. */}
              <details className="text-sm text-muted-foreground">
                <summary className="w-fit cursor-pointer underline underline-offset-4 hover:text-foreground transition-colors">
                  What went wrong
                </summary>
                <p className="mt-2 leading-relaxed break-words">{bootError}</p>
              </details>
            </>
          )}
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
          {bootError && (
            <>
              {/* The calm line is for the person. On the offline path the raw
                  describeError string says "the change was not sent" — on first
                  load there was no change, so it does not render bare. */}
              <Note>Nothing was lost. If this keeps happening, close Cut Protocol completely and open it again.</Note>
              {/* The raw string survives, one small click away, for whoever is
                  helping them figure it out. */}
              <details className="text-sm text-muted-foreground">
                <summary className="w-fit cursor-pointer underline underline-offset-4 hover:text-foreground transition-colors">
                  What went wrong
                </summary>
                <p className="mt-2 leading-relaxed break-words">{bootError}</p>
              </details>
            </>
          )}
          <Big onClick={boot}>Try again</Big>
          <Details onClick={goFull} />
        </div>
      </Screen>
    );
  }

  // FOUR DOORS — Today · Food · Progress · You.
  //
  // Same structure as the committed nav.js SECTIONS (23158d9), reached
  // independently by an earlier session. All four now have rooms. The one
  // screen still not redrawn is the Engine, and Progress says so on its own
  // face rather than hiding it — see SimpleProgress.
  //
  // TODAY IS STILL ONE SCREEN. The owner's call earlier this session — the day
  // of food and the weight box on one page, no sub-navigation, because two
  // things do not need a navigation system. That decision governs the Today
  // door and is not undone by the app having doors.
  const body = (
    <>
      {door === "today" && (
        <div className="flex flex-col gap-12">
          <SimpleToday profile={profile} />
          <hr className="border-border" />
          <SimpleWeight profile={profile} onSaved={loadData} onOpenProgress={() => setDoor("progress")} />
        </div>
      )}
      {door === "food" && (
        <div className="flex flex-col gap-6">
          <Tabs tabs={FOOD_ROOMS} active={room} onSelect={setRoom} />
          {room === "plan" && <SimplePlan profile={profile} onShowFull={goFull} />}
          {room === "recipes" && <SimpleRecipes onShowFull={goFull} />}
          {room === "shopping" && <SimpleShopping onShowFull={goFull} onOpenPlan={() => setRoom("plan")} />}
          {room === "preview" && <SimplePrescription />}
        </div>
      )}
      {door === "progress" && (
        <SimpleProgress profile={profile} summary={summary} onShowFull={goFull} onOpenToday={() => setDoor("today")} />
      )}
      {door === "you" && (
        <SimpleDetails
          profile={profile}
          summary={summary}
          refresh={loadData}
          onShowFull={goFull}
          onOpenToday={() => setDoor("today")}
        />
      )}
    </>
  );

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a href="#simple-main" className="skip-link">Skip to main content</a>

      {/* Sidebar on a desktop window, a row of doors above the content on a
          phone. One component set, per the responsive decision. */}
      <div className="sm:flex sm:min-h-svh">
        <nav
          aria-label="Sections"
          className="sm:w-52 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-border
                     flex sm:flex-col sm:gap-1 sm:p-4 sm:pt-10"
        >
          {DOORS.map((d) => {
            const on = d.id === door;
            const cls = `flex-1 sm:flex-none min-h-14 px-4 rounded-none sm:rounded-2xl text-base
                         flex items-center justify-center sm:justify-start transition-colors ${
              on ? "font-semibold text-foreground sm:bg-secondary" : "text-muted-foreground hover:text-foreground"
            }`;
            return d.built ? (
              <button key={d.id} type="button" onClick={() => setDoor(d.id)} aria-current={on ? "page" : undefined} className={cls}>
                {d.label}
              </button>
            ) : (
              <button key={d.id} type="button" onClick={goFull} className={cls} title="Opens the full app — this room hasn't been rebuilt yet">
                {d.label}
              </button>
            );
          })}
        </nav>

        <main id="simple-main" className="flex-1 min-w-0 px-6 pt-10 pb-16">
          <div className="mx-auto w-full max-w-3xl flex flex-col gap-12">
            {body}

            {/* THE EXIT USED TO BE THE MOST REPEATED THING IN THE APP. Two
                links here, plus each room's own, meant the bottom of Recipes
                and You read as four different offers that were one offer — all
                the same component, all the same grey, all landing in the same
                place. Now the generic one renders ONLY where the room supplies
                none — Today, and Food > Recipes since its own bottom link
                moved (Cut List row 6). Every other room has its own link
                with better words. */}
            <div className="flex flex-col items-start gap-4 pt-2">
              {(door === "today" || (door === "food" && room === "recipes")) && (
                <Details onClick={goFull} label="Open the full app" />
              )}

              {/* The support resources are never hidden and never greyed out —
                  a standing safety rule that survives any visual direction. It
                  renders on EVERY screen, unconditionally, and now actually
                  lands on the resources: the You door renders the real
                  ResourceList. It used to call goFull, which dropped you on
                  whatever tab the full app happened to be on — the one link
                  that must not be a guess. */}
              <button
                type="button"
                onClick={() => setDoor("you")}
                className="min-h-11 text-base text-foreground underline underline-offset-4"
              >
                Support and wellbeing resources
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
