import { useEffect, useRef } from "react";

/**
 * An AbortSignal that is aborted when the component unmounts.
 *
 * Why: a slow response landing after a tab switch used to call setState on a
 * dead component (React logs it, and half-applied state is how a screen ends
 * up showing data that isn't there any more). Passing this signal into any
 * api.* call cancels the request instead, and api.js throws an ApiError with
 * kind "aborted" that every handler ignores.
 *
 *   const abort = useAbortSignal();
 *   useEffect(() => {
 *     api.getFoods({ signal: abort.signal })
 *       .then(setFoods)
 *       .catch((e) => { if (!isAbortError(e)) setError(e); });
 *   }, []);
 *
 * The returned object is STABLE across renders and reads `.signal` lazily, so
 * a StrictMode double-mount (which aborts the first controller) transparently
 * gets a fresh one. Never put `abort.signal` in a dependency array — read it
 * inside the effect/handler body.
 */
export function useAbortSignal() {
  const controller = useRef(null);
  const holder = useRef(null);

  if (!holder.current) {
    const live = () => {
      if (!controller.current || controller.current.signal.aborted) {
        controller.current = new AbortController();
      }
      return controller.current;
    };
    holder.current = {
      get signal() { return live().signal; },
      /** Cancel everything in flight right now (e.g. before a fresh load). */
      cancel() { controller.current?.abort(); },
    };
  }

  useEffect(() => {
    void holder.current.signal; // ensure a live controller for THIS mount
    return () => controller.current?.abort();
  }, []);

  return holder.current;
}
