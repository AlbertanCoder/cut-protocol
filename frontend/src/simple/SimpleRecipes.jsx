import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { trustReport } from "../lib/recipeTrust.js";
import { Page, Row, Panel, Big, Quiet, Empty, Busy, Note, Search, Pill, Stat, Sheet, Details } from "./parts.jsx";

// Food › Recipes — the library.
//
// RecipesTab carries 36 capabilities. This room carries browsing, searching,
// grouping by what the meal is built on, seeing what's in one, and putting it
// into the week. NOTHING IS DELETED: AI generation, URL import, the cart's
// grocery list, serving-scale editing, inline recipe editing, taste ratings,
// delete, and the trust/provenance detail all still live in RecipesTab.jsx,
// behind links into the full app — placed in context now (Cut List row 6):
// AI/import offered when a search comes up empty, the single-food lookup
// inside the recipe sheet.
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
// "Beans & veg" is EXCLUSIVE of the meat/fish words the other groups match:
// a plant word in the title is not enough when the title also names an animal
// — the shipped matcher filed "Spanish beans with chicken & chorizo" and five
// other animal dishes under "Meat-free". Display taxonomy only; real dietary
// filtering stays server-side, untouched.
const MEAT_OR_FISH = /chicken|turkey|poultry|beef|steak|pork|lamb|bacon|mince|fish|salmon|tuna|cod|prawn|shrimp|haddock/i;
const GROUPS = [
  { id: "all", label: "Everything", match: () => true },
  { id: "chicken", label: "Chicken", match: (r) => /chicken|turkey|poultry/i.test(r.name) },
  { id: "beef", label: "Beef & pork", match: (r) => /beef|steak|pork|lamb|bacon|mince/i.test(r.name) },
  { id: "fish", label: "Fish", match: (r) => /fish|salmon|tuna|cod|prawn|shrimp|haddock/i.test(r.name) },
  { id: "plant", label: "Beans & veg", match: (r) => /bean|lentil|tofu|chickpea|veg|paneer|halloumi/i.test(r.name) && !MEAT_OR_FISH.test(r.name) },
];

// How many rows to draw before "Show more". The library is thousands of rows;
// rendering all of them is the thing that makes the current tab feel heavy.
const PAGE = 25;

function Detail({ recipe, onClose, onPlaced, onShowFull }) {
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Scale is clamped 0.5–2 server-side (POST /plans/place-recipe). These are
  // the four steps a person actually wants; the full tab keeps the slider.
  const STEPS = [0.5, 1, 1.5, 2];
  // The steps in words, not notation — one label in their language beats
  // three in maths, directly above the calorie number they came for. STEPS
  // and the clamp are untouched; this maps display text only.
  const STEP_WORD = { 0.5: "Half a serving", 1: "One serving", 1.5: "One and a half", 2: "Two servings" };

  // The same trust signal the full tab renders, derived from the ingredient
  // rows this response already carries — see lib/recipeTrust.js.
  const trust = useMemo(() => trustReport(recipe), [recipe]);

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
      // The server UPSERTS: an existing tomorrow-dinner is overwritten with
      // no undo on this sheet. Say so honestly — and "Plan" is the door's
      // name; "the planner" means two different places across the app.
      setDone("This is now tomorrow's dinner. Whatever was there has been swapped out — change it under Plan.");
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
              {STEP_WORD[s] || `×${s}`}
            </Pill>
          ))}
        </div>
      </div>

      <Panel>
        <Stat label="Calories" value={kc(recipe.kcal * scale)} />
        {Number.isFinite(recipe.protein) && <Stat label="Protein" value={`${Math.round(recipe.protein * scale)} g`} />}
        {/* prepTimeMin is the schema's column (schema.prisma:411); the old
            `prepMinutes` read a field that exists nowhere in the repo, so
            this line had never rendered once. */}
        {recipe.prepTimeMin ? <Stat label="Takes about" value={`${recipe.prepTimeMin} min`} /> : null}
      </Panel>

      {/* Data-honesty carries over from the full tab. A recipe built on rows
          that carry another food's numbers must say so before someone plans
          a week around it. `recipe.trust` was never a field the API returns
          — that check is kept but the panel now also reads the full tab's
          own trustReport, and fires at its measured MATERIAL_SHARE threshold
          (most of the stated calories come from rows carrying another food's
          numbers). Firing on ANY flagged ingredient would stamp this on ~88%
          of the library — alarm fatigue, not honesty. Amber, never red. */}
      {(recipe.trust === "low" || trust?.material) && (
        <Panel tone="warn">
          The calorie count here is a good estimate rather than an exact one.
        </Panel>
      )}

      <Big onClick={place} disabled={busy || !!done}>
        {busy ? "Adding…" : "Add to tomorrow's dinner"}
      </Big>

      {/* Moved up from the bottom of the room (Cut List row 6): the moment
          you want a single food or a barcode is when you're inside a recipe,
          not under a stack of grey links. */}
      <Details onClick={onShowFull} label="Look up a single food, or scan a barcode" />
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
  // removed. It is stated, never silently swallowed. hiddenBecauseUnreadable
  // is the subset hidden because WE cannot read a recipe's ingredients at all
  // — a data bug on our side, shipped as its own field precisely so a broken
  // import can never masquerade as an allergy (recipes.js:39-46). Stated
  // separately here for the same reason.
  const hidden = (data && typeof data === "object") ? data.hiddenCount : 0;
  const unreadable = (data && typeof data === "object") ? (data.hiddenBecauseUnreadable || 0) : 0;
  const hiddenDietary = Math.max(0, (hidden || 0) - unreadable);

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
        // An empty result names what emptied it: when a group pill is on,
        // the pill is usually the culprit, not the word — blame the pill and
        // offer the way out. Empty's own contract says no action = dead end.
        <Empty
          action={
            <>
              {group !== "all" ? (
                <Big onClick={() => setGroup("all")}>Search everything</Big>
              ) : q.trim() ? (
                <Big onClick={() => setQ("")}>Clear the search</Big>
              ) : null}
              {/* Moved from the bottom of the room (Cut List row 6): a
                  search that found nothing is the moment AI generation or
                  an import answers a real question. */}
              <Details onClick={onShowFull} label="Make one with AI, or import a link" />
            </>
          }
        >
          {q.trim()
            ? (group !== "all"
              ? `Nothing in ${matcher.label} matches "${q.trim()}".`
              : `Nothing matches "${q.trim()}". Try a shorter word.`)
            : "Nothing in this group."}
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {filtered.slice(0, shown).map((r) => (
              // "Look" is a plain span, not a RowAction: Row with onClick
              // renders a <button>, and a button inside a button is invalid
              // HTML — two nested controls doing the same setOpen(r). The
              // whole row stays the click target, the bigger of the two;
              // RowAction itself is untouched and still serves Today and
              // Plan. aria-hidden because the span is purely the visual
              // affordance at the row's right edge — the row button already
              // carries the name.
              <Row
                key={r.id}
                lead={r.name}
                meta={`${kc(r.kcal)} calories`}
                onClick={() => setOpen(r)}
                action={
                  <span
                    aria-hidden="true"
                    className="shrink-0 min-h-12 min-w-12 px-4 rounded-2xl border border-border bg-background
                               text-sm font-medium text-muted-foreground
                               flex items-center justify-center gap-2"
                  >
                    Look
                  </span>
                }
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

      {hiddenDietary > 0 && (
        <p className="text-base text-muted-foreground">
          {hiddenDietary.toLocaleString()} recipes don&rsquo;t fit what you told us you eat.
        </p>
      )}
      {unreadable > 0 && (
        <p className="text-base text-muted-foreground">
          {unreadable.toLocaleString()} more are hidden because we can&rsquo;t read their
          ingredients properly yet — that&rsquo;s a problem with our data, not with your answers.
        </p>
      )}

      {/* The two grey links that used to stack here moved into context (Cut
          List row 6): AI/import now lives in the empty-search state, the
          single-food lookup inside the recipe sheet — and the hardcoded
          "14,000" went with them. The shell still renders its escape hatch
          and the wellbeing link under every room. */}

      {open && <Detail recipe={open} onClose={() => setOpen(null)} onPlaced={load} onShowFull={onShowFull} />}
    </Page>
  );
}
