import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { Page, Row, RowAction, Panel, Big, Quiet, Empty, Busy, Note, Search, Pill, Stat, Sheet, Details } from "./parts.jsx";

// Food › Recipes — the library.
//
// RecipesTab carries 36 capabilities. This room carries browsing, searching,
// grouping by what the meal is built on, seeing what's in one, and putting it
// into the week. NOTHING IS DELETED: AI generation, URL import, the cart's
// grocery list, serving-scale editing, inline recipe editing, taste ratings,
// delete, and the trust/provenance detail all still live in RecipesTab.jsx,
// unmodified, behind the links at the bottom.
//
// The food database and the barcode scanner are reached FROM here rather than
// being doors of their own — the owner's call. Nobody browses 14,000 rows;
// you want them when you are inside a recipe or logging something off-plan.
//
// This screen computes nothing. `protein per 100 calories` is not derived here
// — where a number is shown it is the server's, and the one arithmetic below
// (grouping counts) is counting, not nutrition.

const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

// Display grouping only, by what the meal is mostly built on. Same idea as
// RecipesTab's PROTEIN_GROUPS, deliberately coarser: four buckets a person
// recognises rather than a taxonomy.
const GROUPS = [
  { id: "all", label: "Everything", match: () => true },
  { id: "chicken", label: "Chicken", match: (r) => /chicken|turkey|poultry/i.test(r.name) },
  { id: "beef", label: "Beef & pork", match: (r) => /beef|steak|pork|lamb|bacon|mince/i.test(r.name) },
  { id: "fish", label: "Fish", match: (r) => /fish|salmon|tuna|cod|prawn|shrimp|haddock/i.test(r.name) },
  { id: "plant", label: "Meat-free", match: (r) => /bean|lentil|tofu|chickpea|veg|paneer|halloumi/i.test(r.name) },
];

// How many rows to draw before "Show more". The library is thousands of rows;
// rendering all of them is the thing that makes the current tab feel heavy.
const PAGE = 25;

function Detail({ recipe, onClose, onPlaced }) {
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Scale is clamped 0.5–2 server-side (POST /plans/place-recipe). These are
  // the four steps a person actually wants; the full tab keeps the slider.
  const STEPS = [0.5, 1, 1.5, 2];

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      // Tomorrow's dinner is the honest default for "put this in my week":
      // today is usually already eaten or already planned. The full planner is
      // where you choose a different slot.
      const dayOfWeek = (() => {
        const js = new Date().getDay();
        const todayIso = js === 0 ? 6 : js - 1;
        return (todayIso + 1) % 7;
      })();
      await api.placeRecipe({ recipeId: recipe.id, scale, dayOfWeek, slotType: "meal", slotIndex: 2 });
      setDone("Added to tomorrow's dinner. Change it in the planner if that's wrong.");
      if (onPlaced) await onPlaced();
    } catch (e) {
      if (!isAbortError(e)) setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={recipe.name} sub={`${kc(recipe.kcal)} calories a serving`} onClose={onClose}>
      {error && <Note>{error}</Note>}
      {done && <Panel>{done}</Panel>}

      <div className="flex flex-col gap-3">
        <span className="text-base text-muted-foreground">How much?</span>
        <div className="flex gap-2 flex-wrap">
          {STEPS.map((s) => (
            <Pill key={s} on={s === scale} onClick={() => setScale(s)}>
              {s === 1 ? "One serving" : `×${s}`}
            </Pill>
          ))}
        </div>
      </div>

      <Panel>
        <Stat label="Calories" value={kc(recipe.kcal * scale)} />
        {Number.isFinite(recipe.protein) && <Stat label="Protein" value={`${Math.round(recipe.protein * scale)} g`} />}
        {recipe.prepMinutes ? <Stat label="Takes about" value={`${recipe.prepMinutes} min`} /> : null}
      </Panel>

      {/* Data-honesty carries over from the full tab. A recipe built on rows
          that carry another food's numbers must say so before someone plans
          a week around it. */}
      {recipe.trust === "low" && (
        <Panel tone="warn">
          Some ingredients in this one have crowd-sourced numbers rather than lab-verified ones.
        </Panel>
      )}

      <Big onClick={place} disabled={busy || !!done}>
        {busy ? "Adding…" : "Put this in my week"}
      </Big>
    </Sheet>
  );
}

export default function SimpleRecipes({ onShowFull }) {
  const [data, setData] = useState(null);      // null = loading
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getRecipes());
      setError(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
      setData("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Memoised on `data`, not rebuilt inline: a fresh array identity every render
  // makes the filter memo below re-run every render, which on a nine-hundred-row
  // library is the difference between a list that types smoothly and one that
  // stutters.
  const all = useMemo(
    () => ((data && typeof data === "object" && Array.isArray(data.recipes)) ? data.recipes : []),
    [data],
  );
  // hiddenCount is the server's own count of recipes its allergy filter
  // removed. It is stated, never silently swallowed.
  const hidden = (data && typeof data === "object") ? data.hiddenCount : 0;

  const matcher = GROUPS.find((g) => g.id === group) || GROUPS[0];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((r) => matcher.match(r))
      .filter((r) => (needle ? r.name.toLowerCase().includes(needle) : true));
  }, [all, matcher, q]);

  useEffect(() => { setShown(PAGE); }, [q, group]);

  if (data === null) return <Busy>Getting your recipes…</Busy>;

  return (
    <Page title="Recipes" sub={all.length ? `${all.length.toLocaleString()} you can cook` : undefined}>
      {error && <Note>{error}</Note>}

      <Search value={q} onChange={setQ} placeholder="Search your recipes" />

      <div className="flex gap-2 flex-wrap">
        {GROUPS.map((g) => (
          <Pill key={g.id} on={g.id === group} onClick={() => setGroup(g.id)}>
            {g.label}
          </Pill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty>
          {q.trim()
            ? `Nothing matches "${q.trim()}". Try a shorter word.`
            : "Nothing in this group yet."}
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {filtered.slice(0, shown).map((r) => (
              <Row
                key={r.id}
                lead={r.name}
                meta={`${kc(r.kcal)} calories`}
                onClick={() => setOpen(r)}
                action={<RowAction onClick={() => setOpen(r)} label={`Open ${r.name}`}>Look</RowAction>}
              />
            ))}
          </div>

          {shown < filtered.length && (
            <Quiet onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, filtered.length - shown)} more — {filtered.length - shown} left
            </Quiet>
          )}
        </>
      )}

      {hidden > 0 && (
        <p className="text-base text-muted-foreground">
          {hidden.toLocaleString()} recipes are hidden because of the foods you avoid.
        </p>
      )}

      <div className="flex flex-col items-start gap-3 pt-2">
        <Details onClick={onShowFull} label="Make one with AI, or import a link" />
        <Details onClick={onShowFull} label="Search all 14,000 single foods, or scan a barcode" />
      </div>

      {open && <Detail recipe={open} onClose={() => setOpen(null)} onPlaced={load} />}
    </Page>
  );
}
