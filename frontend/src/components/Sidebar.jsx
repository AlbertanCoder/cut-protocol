import { useState } from "react";
import {
  User, Activity, CalendarDays, BookOpen, TrendingUp,
  Calculator, Dumbbell, LogOut, ChevronsLeft, ChevronsRight, Bug,
} from "lucide-react";
import { C } from "../lib/theme.js";
import { TRAINING } from "../lib/flags.js";
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
  { id: "engine", label: "Engine", icon: Calculator },
];

export default function Sidebar({ tab, setTab, onLogout, onReportBug }) {
  const [collapsed, setCollapsed] = useState(() => sidebarPref.get());
  const toggle = () => {
    sidebarPref.set(!collapsed);
    setCollapsed(!collapsed);
  };
  // Foods is a child view of Recipes (no top-level nav item of its own).
  const activeId = tab === "foods" ? "recipes" : tab;

  return (
    <aside
      className="sticky top-0 h-svh flex flex-col shrink-0 transition-[width] duration-200"
      style={{ width: collapsed ? 72 : 240, background: C.cardGlass, borderRight: `1px solid ${C.rule}` }}
    >
      {/* brand */}
      <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${collapsed ? "justify-center px-0" : ""}`}>
        <div className="shrink-0 flex items-center justify-center">
          <CutMark size={40} />
        </div>
        {!collapsed && (
          <div className="leading-none">
            <div className="font-black text-[14px] uppercase" style={{ color: C.ink, letterSpacing: ".02em" }}>Cut Protocol</div>
            <div className="text-[10px] font-bold uppercase mt-1" style={{ color: C.faint, letterSpacing: ".08em" }}>Recomp Engine</div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-1 px-3 mt-2" aria-label="Primary">
        {NAV.map((t) => {
          const active = activeId === t.id;
          const Icon = t.icon;
          // Accessible name: icon-only (collapsed) buttons need it spelled
          // out since there's no visible text; the "coming soon" state is
          // carried by the SOON chip visually, so screen readers get the
          // same fact in words even when collapsed hides the chip.
          const a11yName = t.soon ? `${t.label} — coming soon` : (collapsed ? t.label : undefined);
          return (
            <button
              key={t.id}
              onClick={t.soon ? undefined : () => setTab(t.id)}
              disabled={t.soon}
              aria-current={active ? "page" : undefined}
              aria-label={a11yName}
              title={t.soon ? "Coming soon" : collapsed ? t.label : undefined}
              className={`relative flex items-center gap-3 rounded-xl font-bold text-[13px] transition-colors duration-100 ${collapsed ? "justify-center py-2.5" : "px-3 py-2.5"}`}
              style={{ color: active ? C.ink : C.faint, background: active ? C.card2 : "transparent", opacity: t.soon ? 0.45 : 1 }}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full" aria-hidden="true" style={{ background: C.ink }}></span>}
              <Icon size={18} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
              {!collapsed && t.label}
              {!collapsed && t.soon && (
                <span className="ml-auto text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: C.card2, color: C.faint, border: `1px solid ${C.rule}` }}>SOON</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Day/Target moved to the HeaderBar (inverted-L chassis). */}

      {/* report a bug — always available, not only on an error */}
      <div className="px-3 pb-1">
        <button
          onClick={onReportBug}
          title="Report a bug"
          aria-label="Report a bug"
          className={`flex items-center gap-2 text-xs font-semibold rounded-lg hover:opacity-80 ${collapsed ? "w-8 h-8 justify-center mx-auto" : "w-full px-2.5 py-2"}`}
          style={{ color: C.faint, border: `1px solid ${C.rule}` }}
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
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80"
          style={{ color: C.faint, border: `1px solid ${C.rule}` }}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
        <button
          onClick={onLogout}
          title="Log out"
          aria-label="Log out"
          className={`flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 rounded-lg ${collapsed ? "w-8 h-8 justify-center" : "px-2 py-1.5"}`}
          style={{ color: C.faint }}
        >
          <LogOut size={14} aria-hidden="true" />
          {!collapsed && "Log out"}
        </button>
      </div>
    </aside>
  );
}
