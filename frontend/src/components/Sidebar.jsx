import { useState } from "react";
import {
  User, Activity, CalendarDays, BookOpen, TrendingUp,
  Calculator, Dumbbell, LogOut, ChevronsLeft, ChevronsRight, Bug,
} from "lucide-react";
import { C } from "../lib/theme.js";
import { TRAINING } from "../lib/flags.js";
import { sidebarPref } from "../lib/storage.js";
import CutMark from "./ui/CutMark.jsx";

const kc = (n) => Math.round(n).toLocaleString("en-CA");

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

export default function Sidebar({ tab, setTab, profile, summary, onLogout, onReportBug }) {
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
      style={{ width: collapsed ? 72 : 236, background: C.card, borderRight: `1px solid ${C.rule}` }}
    >
      {/* brand */}
      <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${collapsed ? "justify-center px-0" : ""}`}>
        <div className="shrink-0 flex items-center justify-center">
          <CutMark size={40} />
        </div>
        {!collapsed && (
          <div className="leading-none">
            <div className="font-black text-[14px] uppercase" style={{ color: C.ink, letterSpacing: ".02em" }}>Cut Protocol</div>
            <div className="text-[10px] font-bold uppercase mt-1" style={{ color: C.faintLight, letterSpacing: ".08em" }}>Recomp Engine</div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-1 px-3 mt-2">
        {NAV.map((t) => {
          const active = activeId === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={t.soon ? undefined : () => setTab(t.id)}
              disabled={t.soon}
              title={t.soon ? "Coming soon" : collapsed ? t.label : undefined}
              className={`relative flex items-center gap-3 rounded-xl font-bold text-[13px] transition-colors duration-100 ${collapsed ? "justify-center py-2.5" : "px-3 py-2.5"}`}
              style={{ color: active ? C.accent : C.faint, background: active ? C.accentBg : "transparent", opacity: t.soon ? 0.45 : 1, cursor: t.soon ? "default" : "pointer" }}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full" style={{ background: C.accent }}></span>}
              <Icon size={18} strokeWidth={active ? 2.5 : 2} />
              {!collapsed && t.label}
              {!collapsed && t.soon && (
                <span className="ml-auto text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: C.card2, color: C.faintLight, border: `1px solid ${C.rule}` }}>SOON</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* pinned day / target summary */}
      <div className="px-4 py-4" style={{ borderTop: `1px solid ${C.rule}` }}>
        {collapsed ? (
          <div className="text-center">
            <div className="text-[10px] font-bold uppercase" style={{ color: C.faintLight }}>Day</div>
            <div className="mono stat-hero text-lg" style={{ color: C.ink }}>{summary?.daysIn ?? "—"}</div>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase" style={{ color: C.faintLight, letterSpacing: ".08em" }}>Day</div>
              <div className="mono stat-hero text-3xl" style={{ color: C.ink }}>{summary?.daysIn ?? "—"}</div>
            </div>
            <div className="text-right pb-1">
              <div className="text-[10px] font-bold uppercase" style={{ color: C.faintLight, letterSpacing: ".08em" }}>Target</div>
              <div className="mono text-sm font-extrabold" style={{ color: C.accent }}>{profile ? `${kc(profile.targetKcal)} kcal` : "—"}</div>
            </div>
          </div>
        )}
      </div>

      {/* report a bug — always available, not only on an error */}
      <div className="px-3 pb-1">
        <button
          onClick={onReportBug}
          title="Report a bug"
          className={`flex items-center gap-2 text-xs font-semibold rounded-lg hover:opacity-80 ${collapsed ? "w-8 h-8 justify-center mx-auto" : "w-full px-2.5 py-2"}`}
          style={{ color: C.faint, border: `1px solid ${C.rule}` }}
        >
          <Bug size={14} />
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
          className={`flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 rounded-lg ${collapsed ? "w-8 h-8 justify-center" : "px-2 py-1.5"}`}
          style={{ color: C.faint }}
        >
          <LogOut size={14} />
          {!collapsed && "Log out"}
        </button>
      </div>
    </aside>
  );
}
