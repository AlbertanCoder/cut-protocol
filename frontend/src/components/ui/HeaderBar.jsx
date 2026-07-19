import { C } from "../../lib/theme.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");

// Slim app header — the top stroke of the inverted-L chassis. The sidebar
// and this bar are fixed chrome; only the content pane below changes.
// Carries the active section name plus the Day / Target pair that used to
// live pinned in the sidebar footer.
export default function HeaderBar({ title, profile, summary }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between gap-4 h-12 px-5 lg:px-9"
      style={{
        background: "rgba(11, 13, 12, 0.82)",
        borderBottom: `1px solid ${C.rule}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <div className="disp text-[14px] uppercase" style={{ color: C.ink, letterSpacing: ".02em" }}>{title}</div>
      <div className="flex items-center gap-5 text-xs font-semibold">
        <span style={{ color: C.faint }}>
          Day <b className="mono ml-0.5" style={{ color: C.ink }}>{summary?.daysIn ?? "—"}</b>
        </span>
        <span style={{ color: C.faint }}>
          Target <b className="mono ml-0.5" style={{ color: C.ink }}>{profile ? `${kc(profile.targetKcal)} kcal` : "—"}</b>
        </span>
      </div>
    </header>
  );
}
