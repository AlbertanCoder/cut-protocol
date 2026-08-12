import { Sheet, Row, Panel, Busy, Note } from "./parts.jsx";

// "Something else instead" — the one overlay on the simple surface.
//
// Shared by Today and Plan. It lives in its own file rather than in parts.jsx
// because it knows the shape of a solver alternate (`recipeId`, `kcal`), and
// parts.jsx is deliberately domain-free presentation.
//
// It decides nothing. The caller loads the alternates and applies the chosen
// one; this renders a list and reports a click. Every number shown is the
// server's.

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

export default function SwapSheet({ alts, busy, applyingId, onApply, onClose, error }) {
  return (
    <Sheet
      title="Something else instead"
      sub="These all fit the same day. Pick one and the rest of the day stays where it is."
      onClose={onClose}
    >
      {error && <Note>{error}</Note>}

      {busy && <Busy>Finding other options…</Busy>}

      {!busy && alts && alts.length === 0 && (
        <Panel>Nothing else fits this slot. The meal you have is the closest one available.</Panel>
      )}

      {!busy && alts && alts.map((a) => (
        <Row
          key={a.recipeId}
          lead={a.name || a.recipeName}
          meta={applyingId === a.recipeId ? "Swapping…" : `${kc(a.kcal)} calories`}
          onClick={applyingId == null ? () => onApply(a) : undefined}
        />
      ))}
    </Sheet>
  );
}
