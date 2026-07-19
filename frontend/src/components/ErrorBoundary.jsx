import { Component } from "react";
import { AlertTriangle, Bug, RotateCw } from "lucide-react";
import { C } from "../lib/theme.js";
import { logEvent } from "../lib/bugLog.js";
import BugReportDialog from "./BugReportDialog.jsx";

// Catches render-time crashes anywhere in the tree and shows a friendly
// recovery screen instead of a blank white page — with a "Report this" button
// wired to the same reviewed, no-personal-data report flow as everywhere else.
// (React error boundaries must be class components.)
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reportOpen: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logEvent("react-crash", `${error.message} | ${(info?.componentStack || "").split("\n")[1]?.trim() || ""}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: C.paper }}>
        <AlertTriangle size={34} style={{ color: C.warn }} />
        <div className="text-lg font-black" style={{ color: C.ink }}>Something went wrong</div>
        <div className="text-sm font-semibold max-w-md" style={{ color: C.faint }}>
          The app hit an unexpected error and stopped this screen from rendering. Your data is safe. You can reload, or send a report so it gets fixed.
        </div>
        <div className="flex gap-2 mt-1">
          <button onClick={() => window.location.reload()} className="text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5" style={{ background: C.accent, color: C.accentInk }}>
            <RotateCw size={14} />Reload
          </button>
          <button onClick={() => this.setState({ reportOpen: true })} className="text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5" style={{ background: "transparent", color: C.ink, border: `1.5px solid ${C.rule}` }}>
            <Bug size={14} />Report this
          </button>
        </div>
        <BugReportDialog open={this.state.reportOpen} error={this.state.error} onClose={() => this.setState({ reportOpen: false })} />
      </div>
    );
  }
}
