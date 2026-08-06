import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────
// Supabase Auth client — WEB BUILD ONLY (saas-launch).
//
// The desktop build ships neither env var, so `supabase` is null there and
// every consumer falls back to the cookie/password path unchanged. That
// null-means-desktop convention is the whole mode switch: no flag file, no
// build-time define, nothing to keep in sync.
//
// The publishable key is safe to expose by design (it is in every request the
// browser makes anyway); the SECRET key must never appear in this bundle —
// it lives only in backend/.env.
// ─────────────────────────────────────────────────────────────────────────

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase =
  url && publishableKey
    ? createClient(url, publishableKey, {
        // PKCE: the OAuth redirect comes back with a one-time code (not a
        // token in the URL fragment); supabase-js exchanges it automatically
        // on load (detectSessionInUrl defaults on) and strips it from the URL.
        auth: { flowType: "pkce" },
      })
    : null;

export const supabaseEnabled = !!supabase;

/**
 * Current access token, or null when signed out / desktop build. Awaiting
 * getSession() also waits out the client's startup work (restoring the
 * persisted session, exchanging a just-returned OAuth code), so callers right
 * after the redirect get the fresh token instead of a race.
 */
export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

/**
 * Full-page redirect to Google via Supabase. Only ever returns on FAILURE —
 * on success the browser leaves this page and comes back to the origin with
 * a session. Throws so the caller can show the error.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

/** Sign out of Supabase (web). Safe no-op on the desktop build. */
export async function supabaseSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
