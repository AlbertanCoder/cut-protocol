import { Component, Fragment } from "react";
import { AlertTriangle, Bug, RotateCw, Undo2 } from "lucide-react";
import { logEvent } from "../lib/bugLog.js";
import BugReportDialog from "./BugReportDialog.jsx";

// Catches render-time crashes and shows a friendly recovery screen instead of a
// blank white page — with a "Report this" button wired to the same reviewed,
// no-personal-data report flow as everywhere else.
// (React error boundaries must be class components.)
//
// ── WHAT A BOUNDARY CANNOT CATCH (so this isn't oversold) ──────────────────
// React error boundaries catch throws during RENDER, in lifecycle methods, and
// in constructors of the tree below them. They do NOT catch:
//   · anything asynchronous — a rejected fetch, a setTimeout callback, an
//     effect body that throws after an await;
//   · event handlers (onClick, onChange) — React deliberately lets those
//     propagate to window.onerror;
//   · errors thrown in the boundary's own render;
//   · anything in the main process, or in server-side rendering.
// Those paths are covered elsewhere and separately: window "error" /
// "unhandledrejection" listeners and the main-process bridge, all in
// lib/bugLog.js#installGlobalHandlers, which surface the same report dialog.
// A boundary is a blast-radius limiter for render crashes, nothing more.

function FallbackScreen({ error, full, label, onRetry, onReload, onReport, reportOpen, onCloseReport }) {
  const btn = { background: "var(--primary)", color: "var(--primary-foreground)" };
  const ghost = { background: "transparent", color: "var(--foreground)", border: "1.5px solid var(--border)" };
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-4 px-6 text-center ${full ? "min-h-svh" : "py-16"}`}
      style={full ? { background: "var(--background)" } : { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20 }}
    >
      <AlertTriangle size={34} style={{ color: "var(--warn)" }} aria-hidden="true" />
      <div className="text-lg font-black" style={{ color: "var(--foreground)" }}>
        {label ? `${label} couldn't be drawn` : "Something went wrong"}
      </div>
      <div className="text-sm font-semibold max-w-md" style={{ color: "var(--muted-foreground)" }}>
        {label
          ? "This one screen hit an unexpected error. The rest of the app is still working — switch to another screen, or try drawing this one again. Your data is safe."
          : "The app hit an unexpected error and stopped this screen from rendering. Your data is safe. Try again first — a reload is a bigger hammer and isn't usually needed."}
      </div>
      <div className="flex gap-2 mt-1 flex-wrap justify-center">
        {/* Try again re-mounts the subtree. It costs nothing, keeps every other
            screen's state, and recovers the common case: a render that threw on
            data that has since loaded or changed. */}
        <button onClick={onRetry} className="text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5" style={btn}>
          <Undo2 size={14} aria-hidden="true" />Try again
        </button>
        {full && (
          <button onClick={onReload} className="text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5" style={ghost}>
            <RotateCw size={14} aria-hidden="true" />Reload the app
          </button>
        )}
        <button onClick={onReport} className="text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5" style={ghost}>
          <Bug size={14} aria-hidden="true" />Report this
        </button>
      </div>
      <BugReportDialog open={reportOpen} error={error} onClose={onCloseReport} />
    </div>
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reportOpen: false, attempt: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const where = this.props.label ? `${this.props.label}: ` : "";
    logEvent("react-crash", `${where}${error.message} | ${(info?.componentStack || "").split("\n")[1]?.trim() || ""}`);
  }

  render() {
    if (!this.state.error) {
      // `attempt` as a key forces a fresh subtree on retry, so a component that
      // wedged on bad state gets a genuinely clean mount rather than a re-render
      // of the same broken instance. A keyed Fragment does that without adding
      // a DOM node that could disturb the surrounding grid.
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }
    return (
      <FallbackScreen
        error={this.state.error}
        full={!this.props.label}
        label={this.props.label}
        reportOpen={this.state.reportOpen}
        onCloseReport={() => this.setState({ reportOpen: false })}
        onReport={() => this.setState({ reportOpen: true })}
        onRetry={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
        onReload={() => window.location.reload()}
      />
    );
  }
}

/**
 * A boundary around ONE screen, so a crash in one view doesn't blank the whole
 * window. Renders an in-page panel (not a full-screen takeover) with the nav
 * still visible and usable, and offers a retry that re-mounts only that screen.
 *
 * Intended use, in App.jsx's <main>:
 *
 *   <ScreenBoundary label="Trend">
 *     <TrendTab … />
 *   </ScreenBoundary>
 *
 * The `label` is what makes it a per-screen boundary rather than a second root
 * one: it selects the panel presentation and names the screen in both the copy
 * and the activity log. Pass `key={tab}` alongside it if you want switching
 * tabs to clear a previous crash automatically.
 */
export function ScreenBoundary({ label, children }) {
  return <ErrorBoundary label={label || "This screen"}>{children}</ErrorBoundary>;
}
