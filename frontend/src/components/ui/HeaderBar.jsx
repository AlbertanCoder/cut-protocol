import { ModeToggle } from "@/components/mode-toggle";

const kc = (n) => Math.round(n).toLocaleString("en-CA");

// Slim app header — the top stroke of the inverted-L chassis. The sidebar
// and this bar are fixed chrome; only the content pane below changes.
// Carries the Day / Target pair that used to live pinned in the sidebar
// footer. The active section name is deliberately NOT echoed here — the
// sidebar's active nav item and each screen's PageHead already name it, so
// repeating it in the header just doubled the title under every PageHead.
// SIGNAL BLACK: semantic tokens only, alpha-hairline bottom border.
export default function HeaderBar({ profile, summary }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-end gap-4 border-b border-border bg-background/80 backdrop-blur-sm px-5 lg:px-9">
      <div className="flex items-center gap-5 text-xs font-semibold">
        <span className="text-muted-foreground">
          Day <b className="ml-0.5 text-foreground tabular-nums">{summary?.daysIn ?? "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Target <b className="ml-0.5 text-foreground tabular-nums">{profile ? `${kc(profile.targetKcal)} kcal` : "—"}</b>
        </span>
      </div>
      <ModeToggle />
    </header>
  );
}
