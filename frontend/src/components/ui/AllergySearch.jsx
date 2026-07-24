import { useState, useMemo, useRef, useId } from "react";
import { Search, X, Plus, AlertTriangle } from "lucide-react";
import { C } from "../../lib/theme.js";
import { rankTaxonomy, didYouMean, normTerm } from "./allergyTaxonomy.js";

// ─────────────────────────────────────────────────────────────────────────
// Searchable allergen picker — Stage 1, "Allergies 2.0".
//
// Replaces the fixed ten-checkbox list. Type → predictive dropdown over the
// server's allergen taxonomy (label + synonyms) → Enter/click adds a chip.
// Anything the taxonomy doesn't know is still accepted as free text and
// labelled honestly with how it will actually be matched.
//
// ⚠️  The fuzzy matching behind the dropdown (see allergyTaxonomy.js) is UI
// convenience ONLY — it decides what appears in a list, never what is safe to
// eat. Enforcement lives in backend/src/lib/dietaryFilter.js. Do not move any
// matching logic from there into here.
//
// COLOR LAWS (CLAUDE.md): green means on-target/primary only — a selected
// allergen is not a "success", so selection is a LIGHTNESS step (--card-2 +
// --faint-light border). Red is reserved for the failed-save alert the parent
// owns. A literal-only match is a partial capability, not an error: calm
// amber (--warn), stated plainly.
//
// This component holds NO save state. It reports intent (onAdd / onRemove /
// onReplace) and renders what it is given, so the parent's rollback-to-
// server-truth machinery stays the single source of what is really saved.
// ─────────────────────────────────────────────────────────────────────────

const MAX_TERMS = 40;   // mirrors the profile route's excludedFoods bound
const MAX_TERM_LEN = 60;

export default function AllergySearch({
  taxonomy = [],
  taxonomyReason = null,
  quickOptions = [],
  selected = [],
  descriptions = null,      // { [normTerm]: { kind, note, synonymKey } } | null
  describeAvailable = true,
  busyTerms = [],
  disabled = false,
  onAdd,
  onRemove,
  onReplace,                // optional: (oldTerm, newTerm, newLabel) => void
  inputRef,
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listId = `allergy-list-${uid}`;
  const inputId = `allergy-search-${uid}`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef(null);

  const selectedNorm = useMemo(() => selected.map(normTerm), [selected]);
  const atCapacity = selected.length >= MAX_TERMS;

  // Label for a saved term: the taxonomy's own wording when we know it, the
  // quick-chip wording next, otherwise exactly what the user typed.
  const labelFor = useMemo(() => {
    const byKey = new Map();
    for (const e of taxonomy) {
      byKey.set(normTerm(e.key), e.label);
      for (const s of e.synonyms || []) if (!byKey.has(normTerm(s))) byKey.set(normTerm(s), e.label);
    }
    for (const q of quickOptions) if (!byKey.has(normTerm(q.key))) byKey.set(normTerm(q.key), q.label);
    return (term) => byKey.get(normTerm(term)) || term;
  }, [taxonomy, quickOptions]);

  const suggestions = useMemo(
    () => rankTaxonomy(taxonomy, query, 8).filter((e) => !selectedNorm.includes(normTerm(e.key))),
    [taxonomy, query, selectedNorm]
  );

  const typed = query.trim();
  const typedIsNew =
    typed.length > 0 &&
    typed.length <= MAX_TERM_LEN &&
    !selectedNorm.includes(normTerm(typed)) &&
    !suggestions.some((e) => normTerm(e.key) === normTerm(typed) || normTerm(e.label) === normTerm(typed));

  // The dropdown rows, in render order. The free-text row is last and always
  // reachable — an allergen we don't know about must never be a dead end.
  const rows = useMemo(() => {
    const r = suggestions.map((e) => ({ kind: "entry", entry: e, term: e.key, label: e.label }));
    if (typedIsNew) r.push({ kind: "free", term: typed, label: typed });
    return r;
  }, [suggestions, typedIsNew, typed]);

  const clampActive = (i) => (rows.length ? Math.max(0, Math.min(i, rows.length - 1)) : 0);

  const commit = (row) => {
    if (!row || disabled || atCapacity) return;
    onAdd?.(row.term);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      setActive((i) => clampActive(i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(rows.length - 1); return; }
      setActive((i) => clampActive(i - 1));
    } else if (e.key === "Home" && open) {
      e.preventDefault(); setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault(); setActive(clampActive(rows.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && rows[active]) commit(rows[active]);
      else if (typedIsNew) commit({ kind: "free", term: typed, label: typed });
    } else if (e.key === "Escape") {
      // First Escape closes the list, second clears the box — the standard
      // combobox contract, so Escape never traps a keyboard user.
      e.preventDefault();
      if (open) setOpen(false);
      else setQuery("");
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const activeId = open && rows[active] ? `${listId}-opt-${active}` : undefined;

  // Only the terms that need explaining are listed: a term matched as a
  // recognised category is the expected case and says nothing. An alias or a
  // literal-only match is something the user is entitled to know about.
  const notes = useMemo(() => {
    if (!descriptions) return [];
    return selected
      .map((term) => ({ term, d: descriptions[normTerm(term)] }))
      .filter(({ d }) => d && d.kind !== "category")
      .map(({ term, d }) => ({
        term,
        kind: d.kind,
        note: d.note,
        suggestion: d.kind === "literal" ? didYouMean(taxonomy, term) : null,
      }));
  }, [descriptions, selected, taxonomy]);

  const chipBase = "inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full text-sm font-semibold";

  return (
    <div>
      {/* ── search + predictive dropdown ── */}
      <label className="block mb-1 text-xs font-bold" style={{ color: C.faint }} htmlFor={inputId}>
        Search allergies &amp; exclusions
      </label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} aria-hidden="true" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={`${inputId}-help`}
          autoComplete="off"
          disabled={disabled || atCapacity}
          placeholder={atCapacity ? `Limit reached — ${MAX_TERMS} exclusions` : "Type an allergen — e.g. cel, kiwi, lupin…"}
          value={query}
          onChange={(e) => { setQuery(e.target.value.slice(0, MAX_TERM_LEN)); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          // A short delay lets an option's onMouseDown/onClick land before the
          // list unmounts (same pattern as the occupation picker).
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
          onKeyDown={onKeyDown}
          className="text-sm pl-9 pr-3 py-2 rounded-xl w-full"
          style={{ background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink }}
        />
      </div>
      <div id={`${inputId}-help`} className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
        Arrow keys to browse, Enter to add, Escape to close. Not in the list? Type it and press Enter — it is still applied.
      </div>
      {/* Result count for screen readers — a dropdown appearing silently is
          invisible to anyone not looking at it. */}
      <div className="sr-only" role="status" aria-live="polite">
        {open ? `${rows.length} suggestion${rows.length === 1 ? "" : "s"}` : ""}
      </div>

      {open && rows.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Allergen suggestions"
          className="mt-1.5 max-h-56 overflow-y-auto rounded-xl"
          style={{ background: C.card2, border: `1px solid ${C.rule}` }}
        >
          {rows.map((row, i) => {
            const isActive = i === active;
            return (
              // The <li> IS the option: an option must not contain its own
              // focusable control, or a screen reader announces two things
              // where there is one. Focus stays on the input the whole time
              // and aria-activedescendant points here (the combobox pattern).
              <li
                key={`${row.kind}-${row.term}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => { clearTimeout(blurTimer.current); commit(row); }}
                className="px-3 py-2 text-sm font-semibold flex items-center gap-2"
                style={{
                  // Active row = lightness step, never green (law a).
                  background: isActive ? C.card : "transparent",
                  borderBottom: `1px solid ${C.rule}`,
                  borderLeft: `2px solid ${isActive ? C.faintLight : "transparent"}`,
                  color: C.ink,
                }}
              >
                {row.kind === "free" ? (
                  <>
                    <Plus size={13} style={{ color: C.faint }} aria-hidden="true" />
                    <span className="truncate">Add “{row.label}” as your own</span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{row.label}</span>
                    {row.entry.synonyms?.length > 0 && (
                      <span className="text-xs font-semibold truncate ml-auto" style={{ color: C.faint }}>
                        {row.entry.synonyms.slice(0, 3).join(", ")}
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Honest about the vocabulary itself: a missing taxonomy narrows what
          search can FIND, it never narrows what is enforced. */}
      {taxonomy.length === 0 && (
        <div className="text-xs font-semibold mt-1.5" style={{ color: C.warn }}>
          Search list unavailable{taxonomyReason ? ` (${taxonomyReason})` : ""} — the common allergens below still work,
          and anything you type is still applied.
        </div>
      )}

      {/* ── quick chips: the common allergens, one click, no typing ──
          Kept deliberately — the fast path is the reason most people never
          need the search box at all. */}
      {quickOptions.length > 0 && (
        <>
          <div className="text-xs font-bold mt-3 mb-1.5" style={{ color: C.faint }}>Common allergens</div>
          <div className="flex flex-wrap gap-1.5">
            {quickOptions.map((a) => {
              const on = selectedNorm.includes(normTerm(a.key));
              const saving = busyTerms.includes(a.key);
              return (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled || saving || (!on && atCapacity)}
                  aria-busy={saving}
                  onClick={() => (on ? onRemove?.(a.key) : onAdd?.(a.key))}
                  className="px-3 py-1.5 rounded-full text-sm font-semibold transition-colors inline-flex items-center gap-1.5"
                  style={{
                    background: on ? C.card2 : "transparent",
                    border: `1px solid ${on ? C.faintLight : C.rule}`,
                    color: on ? C.ink : C.faint,
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {a.label}
                  {saving && <span className="text-xs font-bold uppercase" style={{ color: C.warn }}>saving…</span>}
                  {saving && <span className="sr-only"> — saving, not confirmed yet</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── the chips actually in force ── */}
      <div className="text-xs font-bold mt-3 mb-1.5" style={{ color: C.faint }}>
        Excluded ({selected.length})
      </div>
      {selected.length === 0 ? (
        // None is a valid state and must READ as a deliberate one.
        <div className="text-xs font-semibold" style={{ color: C.faint }}>
          Nothing excluded. That is a valid setting — add anything above if you need it.
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Excluded allergens and foods">
          {selected.map((term) => {
            const saving = busyTerms.includes(term);
            const d = descriptions?.[normTerm(term)];
            const literal = d?.kind === "literal";
            return (
              <li key={term}>
                <span
                  className={chipBase}
                  style={{
                    background: C.card2,
                    border: `1px solid ${literal ? `${C.warn}66` : C.faintLight}`,
                    color: C.ink,
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {labelFor(term)}
                  {saving && (
                    <>
                      <span className="text-xs font-bold uppercase" style={{ color: C.warn }}>saving…</span>
                      <span className="sr-only"> — saving, not confirmed yet</span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove?.(term)}
                    disabled={disabled || saving}
                    aria-label={`Remove ${labelFor(term)} from your exclusions`}
                    className="w-6 h-6 rounded-full inline-flex items-center justify-center"
                    style={{ color: C.faint, border: `1px solid ${C.rule}` }}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── how each term is ACTUALLY matched ──
          dietaryFilter.describeExclusionTerms() has always produced this and
          nothing rendered it (audit finding). A literal-only match is a
          partial capability the user is entitled to see — stated in calm
          amber, never red: this is food data, and it is not a failure. */}
      {notes.length > 0 && (
        <div className="mt-3 p-3 rounded-xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}55` }}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: C.warn }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-extrabold mb-1" style={{ color: C.warn }}>How these are matched</div>
              <ul className="flex flex-col gap-1.5">
                {notes.map((n) => (
                  <li key={n.term} className="text-xs font-semibold" style={{ color: C.ink }}>
                    <b>{n.term}</b>{" — "}
                    {n.kind === "literal"
                      ? <>exact text match{n.suggestion ? <> — did you mean <b>{n.suggestion.label}</b>?</> : " — no allergen category recognised"}</>
                      : n.note}
                    {n.kind === "literal" && n.suggestion && onReplace && (
                      <button
                        type="button"
                        onClick={() => onReplace(n.term, n.suggestion.key, n.suggestion.label)}
                        disabled={disabled || busyTerms.length > 0}
                        className="ml-2 px-2 py-0.5 rounded-lg text-xs font-bold align-middle"
                        style={{ background: C.card2, border: `1px solid ${C.faintLight}`, color: C.ink }}
                      >
                        Use {n.suggestion.label} instead
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="text-xs font-semibold mt-1.5" style={{ color: C.faint }}>
                An exact-text term is still applied — it just matches the words it contains, not a whole allergen family.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "We couldn't check" and "everything is a clean category match" are
          different facts and are never allowed to look the same. */}
      {!describeAvailable && selected.length > 0 && (
        <div className="text-xs font-semibold mt-2" style={{ color: C.warn }}>
          Couldn&apos;t check how these terms will be matched — they are still applied exactly as saved.
        </div>
      )}

      {atCapacity && (
        <div className="text-xs font-semibold mt-2" style={{ color: C.warn }}>
          {MAX_TERMS} exclusions is the limit — remove one before adding another.
        </div>
      )}
    </div>
  );
}
