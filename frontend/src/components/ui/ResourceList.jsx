import { Phone, Mail, ExternalLink } from "lucide-react";
import { openExternal } from "../../lib/bugReport.js";
import { WELLBEING_RESOURCES } from "../../lib/wellbeingResources.js";

// The Alberta / Canada support resources, rendered as a clean, consistent list.
// Used by both the Profile "Outside help" card and the Wellbeing check so the
// two can never disagree. Design-law note: links are ink, not accent — green is
// reserved for on-target / success, never for general affordances (law a).
// Phone numbers are plain selectable text (a desktop app has no dialer); the
// website and email open in the user's real browser / mail client.
export default function ResourceList({ resources = WELLBEING_RESOURCES }) {
  return (
    <ul className="space-y-2 list-none">
      {resources.map((r) => (
        <li key={r.name} className="rounded-xl p-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{r.name}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{r.detail}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2">
            {r.phone && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold select-all" style={{ color: "var(--foreground)" }}>
                <Phone size={12} aria-hidden="true" style={{ color: "var(--muted-foreground)" }} /> {r.phone}
              </span>
            )}
            {r.email && (
              <button type="button" onClick={() => openExternal(`mailto:${r.email}`)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80"
                style={{ color: "var(--foreground)" }}>
                <Mail size={12} aria-hidden="true" style={{ color: "var(--muted-foreground)" }} /> {r.email}
              </button>
            )}
            {r.url && (
              <button type="button" onClick={() => openExternal(r.url)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80"
                style={{ color: "var(--foreground)" }}>
                <ExternalLink size={12} aria-hidden="true" style={{ color: "var(--muted-foreground)" }} /> {r.url.replace("https://", "")}
                <span className="sr-only"> (opens in a new browser window)</span>
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
