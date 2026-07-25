import { Phone, Mail, ExternalLink } from "lucide-react";
import { C } from "../../lib/theme.js";
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
        <li key={r.name} className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
          <div className="text-sm font-semibold" style={{ color: C.ink }}>{r.name}</div>
          <div className="text-xs mt-0.5" style={{ color: C.faint }}>{r.detail}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2">
            {r.phone && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold select-all" style={{ color: C.ink }}>
                <Phone size={12} aria-hidden="true" style={{ color: C.faint }} /> {r.phone}
              </span>
            )}
            {r.email && (
              <button type="button" onClick={() => openExternal(`mailto:${r.email}`)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80"
                style={{ color: C.ink }}>
                <Mail size={12} aria-hidden="true" style={{ color: C.faint }} /> {r.email}
              </button>
            )}
            {r.url && (
              <button type="button" onClick={() => openExternal(r.url)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80"
                style={{ color: C.ink }}>
                <ExternalLink size={12} aria-hidden="true" style={{ color: C.faint }} /> {r.url.replace("https://", "")}
                <span className="sr-only"> (opens in a new browser window)</span>
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
