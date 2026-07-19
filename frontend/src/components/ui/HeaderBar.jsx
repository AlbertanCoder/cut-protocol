import { C } from "../../lib/theme.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");

// Slim app header — the top stroke of the inverted-L chassis. The sidebar
// and this bar are fixed chrome; only the content pane below changes.
// Carries the Day / Target pair that used to live pinned in the sidebar
// footer. The active section name is deliberately NOT echoed here — the
// sidebar's active nav item and each screen's PageHead already name it, so
// repeating it in the header just doubled the title under every PageHead.
export default function HeaderBar({ profile, summary }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-end gap-4 h-12 px-5 lg:px-9"
      style={{
        background: "rgba(11, 13, 12, 0.82)",
        borderBottom: `1px solid ${C.rule}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
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
