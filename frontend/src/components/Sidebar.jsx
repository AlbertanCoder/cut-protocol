import { useState } from "react";
import {
  User, Activity, CalendarDays, BookOpen, TrendingUp,
  Calculator, Dumbbell, LogOut, ChevronsLeft, ChevronsRight, Bug, Heart, Scale,
} from "lucide-react";
import { C } from "../lib/theme.js";
import { TRAINING, WELLBEING } from "../lib/flags.js";
import { sidebarPref } from "../lib/storage.js";
import CutMark from "./ui/CutMark.jsx";

const NAV = [
  { id: "profile", label: "Profile", icon: User },
  { id: "today", label: "Today", icon: Activity },
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "recipes", label: "Recipes", icon: BookOpen },
  // Training ships behind a flag (frontend/src/lib/flags.js): "on" |
  // "soon" (greyed, SOON chip, not clickable) | "hidden".
  ...(TRAINING !== "hidden" ? [{ id: "training", label: "Training", icon: Dumbbell, soon: TRAINING === "soon" }] : []),
  { id: "trend", label: "Trend", icon: TrendingUp },
  // Wellbeing sits directly below Trend: the ED self-check, the micronutrient
  // detail, and the Alberta/Canada support contacts. It replaced the footer
  // "Wellbeing check" button — a real destination, not a dialog launcher
  // buried under three other quiet buttons.
  ...(WELLBEING === "on" ? [{ id: "wellbeing", label: "Wellbeing", icon: Heart }] : []),
  { id: "engine", label: "Engine", icon: Calculator },
];

export default function Sidebar({ tab, setTab, onLogout, onReportBug, onCompare, wellbeingMarked }) {
  const [collapsed, setCollapsed] = useState(() => sidebarPref.get());
  const toggle = () => {
    sidebarPref.set(!collapsed);
    setCollapsed(!collapsed);
  };
  // Foods is a child view of Recipes (no top-level nav item of its own).
  const activeId = tab === "foods" ? "recipes" : tab;

  return (
    <aside
      className="sticky top-0 h-svh flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200"
      style={{ width: collapsed ? 72 : 240 }}
    >
      {/* brand */}
      <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${collapsed ? "justify-center px-0" : ""}`}>
        <div className="shrink-0 flex items-center justify-center">
          <CutMark size={40} />
        </div>
        {!collapsed && (
          <div className="leading-none">
            <div className="font-heading font-bold text-[14px] uppercase tracking-[.02em] text-sidebar-foreground">Cut Protocol</div>
            <div className="text-[10px] font-bold uppercase mt-1 tracking-[.08em] text-muted-foreground">Recomp Engine</div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-1 px-3 mt-2" aria-label="Primary">
        {NAV.map((t) => {
          const active = activeId === t.id;
          const Icon = t.icon;
          // One quiet marker, never a count. App decides when it's warranted
          // (see wellbeingSignals) and it stands down as soon as the tab is
          // opened — no streaks, no repeats, no notification mechanics.
          const marked = t.id === "wellbeing" && wellbeingMarked;
          // Accessible name: icon-only (collapsed) buttons need it spelled
          // out since there's no visible text; the "coming soon" state is
          // carried by the SOON chip visually, so screen readers get the
          // same fact in words even when collapsed hides the chip. The
          // wellbeing marker is a dot — meaningless to AT — so it gets words.
          const a11yName = t.soon
            ? `${t.label} — coming soon`
            : marked
              ? `${t.label} — something in your current plan may be worth a look`
              : (collapsed ? t.label : undefined);
          return (
            <button
              key={t.id}
              onClick={t.soon ? undefined : () => setTab(t.id)}
              disabled={t.soon}
              aria-current={active ? "page" : undefined}
              aria-label={a11yName}
              title={t.soon ? "Coming soon" : collapsed ? t.label : undefined}
              className={`relative flex items-center gap-3 rounded-xl font-bold text-[13px] transition-colors duration-150 ease-out ${collapsed ? "justify-center py-2.5" : "px-3 py-2.5"} ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"} ${t.soon ? "opacity-45" : ""}`}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-sidebar-foreground" aria-hidden="true"></span>}
              <Icon size={18} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
              {!collapsed && t.label}
              {marked && (
                // Calm amber (law b) — the strongest tone allowed on anything
                // touching food or body data. A 6px dot, no number on it.
                <span
                  className={collapsed ? "absolute top-1.5 right-3 w-1.5 h-1.5 rounded-full" : "ml-auto w-1.5 h-1.5 rounded-full"}
                  aria-hidden="true"
                  style={{ background: "var(--warn)" }}
                />
              )}
              {!collapsed && t.soon && (
                <span className="ml-auto text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-border bg-sidebar-accent text-muted-foreground">SOON</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Day/Target moved to the HeaderBar (inverted-L chassis). */}

      {/* how it compares — an in-app view of Cut Protocol vs the other
          calorie/macro/meal-planning apps, from the forum + review research. */}
      <div className="px-3 pb-1">
        <button
          onClick={onCompare}
          title="How it compares"
          aria-label="How it compares"
          className={`flex items-center gap-2 text-xs font-semibold rounded-lg border border-border text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-foreground ${collapsed ? "w-8 h-8 justify-center mx-auto" : "w-full px-2.5 py-2"}`}
        >
          <Scale size={14} aria-hidden="true" />
          {!collapsed && "How it compares"}
        </button>
      </div>

      {/* The "Wellbeing check" footer button used to live here. It is now the
          Wellbeing NAV ITEM above (below Trend), which holds the self-check,
          the micronutrient detail and the support contacts. Keeping both would
          have meant two doors to the same room, one of them hidden. */}

      {/* report a bug — always available, not only on an error */}
      <div className="px-3 pb-1">
        <button
          onClick={onReportBug}
          title="Report a bug"
          aria-label="Report a bug"
          className={`flex items-center gap-2 text-xs font-semibold rounded-lg border border-border text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-foreground ${collapsed ? "w-8 h-8 justify-center mx-auto" : "w-full px-2.5 py-2"}`}
        >
          <Bug size={14} aria-hidden="true" />
          {!collapsed && "Report a bug"}
        </button>
      </div>

      {/* controls */}
      <div className={`flex items-center gap-1 px-3 pb-4 ${collapsed ? "flex-col" : "justify-between"}`}>
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-8 h-8 rounded-lg flex items-center justify-center border border-border text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
        <button
          onClick={onLogout}
          title="Log out"
          aria-label="Log out"
          className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:text-sidebar-foreground ${collapsed ? "w-8 h-8 justify-center" : "px-2 py-1.5"}`}
        >
          <LogOut size={14} aria-hidden="true" />
          {!collapsed && "Log out"}
        </button>
      </div>
    </aside>
  );
}
