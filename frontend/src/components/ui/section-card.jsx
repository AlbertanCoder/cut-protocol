import { useId } from "react";
import { cn } from "@/lib/utils";

// SIGNAL BLACK card: machined black glass — bg-card with an alpha-hairline
// border, no shadows (direction usage rules: elevation rides the border).
// Keeps the legacy Parts.jsx Card's a11y contract verbatim: a real <section>
// labelled by its <h2> title, so screen-reader heading navigation still works
// across a dense dashboard. API-compatible with the legacy Card (section,
// title, className, children) so call-site swaps stay mechanical.
export function SectionCard({ section, title, className, children }) {
  const hid = useId();
  return (
    <section
      className={cn("rounded-xl border border-border bg-card p-6 text-card-foreground", className)}
      aria-labelledby={title ? hid : undefined}
    >
      {(section || title) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && (
            <h2 id={hid} className="m-0 font-heading text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
          )}
          {section && (
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{section}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
