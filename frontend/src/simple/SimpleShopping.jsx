import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeError, isAbortError } from "../lib/api.js";
import { Page, Panel, Big, Quiet, Empty, Busy, Note, Details, Sheet } from "./parts.jsx";

// Food › Shopping — the list.
//
// This is the one room that is genuinely NEW as a destination. The grocery
// list already exists twice in the app — generated inside the week plan and
// inside the recipe cart — and lives in neither. It is the thing you open
// standing in a shop, so it gets a door.
//
// Same endpoints as PlanTab: POST /plans/:id/grocery-list to build it,
// PUT .../check to tick an item. The check state is persisted server-side, so
// closing the app in aisle three does not lose your place.
//
// NO WEEKLY TOTAL, on purpose, and the reason is stated on screen. The backend
// can price items only roughly; a confident-looking total built from rough
// numbers is the kind of fake precision the constitution forbids.

// Same helpers as PlanTab.jsx:63-71 — grams are ground truth, the practical
// purchase unit is what you actually buy. Copied rather than imported because
// PlanTab is not on this surface's import graph and reaching into a screen
// for a helper couples two things that should stay separable.
const itemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? i.grams ?? 0);
const itemSection = (i) => i.section ?? i.category ?? "other";
const itemLine = (i) => {
  const grams = itemGrams(i);
  const practical = i.purchaseUnits?.display;
  return practical ? `${practical} — ${i.name} (${grams} g)` : `${grams} g ${i.name}`;
};

// The classifier emits protein / dairy / spices / produce / pantry / other
// (groceryList.js:139-145). `meat`, `bakery` and `frozen` can never match
// today — they stay anyway, per the never-delete rule. `protein` spells out
// its members because eggs AND tofu land there (PROTEIN_WORDS), so neither
// "Meat & fish" nor "Dairy & eggs" would be telling the truth.
const SECTION_LABEL = {
  produce: "Fruit & veg",
  meat: "Meat & fish",
  protein: "Meat, fish, eggs & tofu",
  dairy: "Dairy",
  bakery: "Bakery",
  pantry: "Cupboard",
  spices: "Herbs & spices",
  frozen: "Frozen",
  other: "Everything else",
};
const sectionWord = (s) => SECTION_LABEL[s] || (s ? s[0].toUpperCase() + s.slice(1) : "Everything else");

function Tick({ item, onToggle, busy }) {
  const on = !!item.checked;
  // Display-only split of itemLine(): the practical purchase unit is the big
  // line, the grams drop to a quieter second line, and the item's name repeats
  // after the unit only when the unit doesn't already contain it —
  // case-insensitive containment is the confidence test. So "3 apples" stands
  // alone, while "2 bulbs (≈20 cloves)" still gets "— Garlic". itemLine()
  // itself is untouched: asText() exports the full one-line form.
  const grams = itemGrams(item);
  const practical = item.purchaseUnits?.display;
  const nameRepeats =
    practical && !practical.toLowerCase().includes(String(item.name ?? "").toLowerCase());
  const lead = practical ? (nameRepeats ? `${practical} — ${item.name}` : practical) : item.name;
  return (
    <button
      type="button"
      // aria-disabled + early return, never native disabled: this control is
      // pressed repeatedly, and disabling the focused element drops keyboard
      // focus to the top of the page on every tick.
      onClick={() => {
        if (busy) return;
        onToggle(item, !on);
      }}
      aria-disabled={busy}
      aria-pressed={on}
      className="w-full text-left min-h-14 px-4 py-2 rounded-2xl flex items-center gap-3
                 hover:bg-card aria-disabled:opacity-50 transition-colors"
    >
      <span
        aria-hidden="true"
        className={`h-6 w-6 shrink-0 rounded-lg border flex items-center justify-center text-sm ${
          on ? "bg-primary border-primary text-primary-foreground" : "bg-card border-border"
        }`}
      >
        {on ? "✓" : ""}
      </span>
      <span className="min-w-0 flex flex-col">
        <span className={`text-base leading-snug ${on ? "line-through text-muted-foreground" : ""}`}>
          {lead}
        </span>
        <span className={`text-sm text-muted-foreground leading-snug ${on ? "line-through" : ""}`}>
          {grams} g
        </span>
      </span>
    </button>
  );
}

// The saved-days list: read-only lines, same section vocabulary as the week
// list. Dates covered are stated so nobody shops for days they didn't save.
function SavedDaysBlock({ grocery }) {
  const groups = {};
  for (const i of grocery.items || []) {
    const sct = itemSection(i);
    (groups[sct] = groups[sct] || []).push(i);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-2">
        <h2 className="text-xl font-semibold">From your saved days</h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {grocery.daysFound} day{grocery.daysFound === 1 ? "" : "s"} saved
        </p>
      </div>
      {Object.entries(groups).map(([section, rows]) => (
        <div key={section} className="flex flex-col gap-1">
          <h3 className="text-sm text-muted-foreground px-4">{sectionWord(section)}</h3>
          <Panel className="px-4 py-3">
            {rows.map((i) => (
              <p key={`${i.name}-${i.state || ""}`} className="text-base leading-relaxed tabular-nums">
                {itemLine(i)}
              </p>
            ))}
          </Panel>
        </div>
      ))}
      <Note>
        Covers {grocery.dates?.length ? grocery.dates.join(", ") : "your saved days"} — the days you
        saved in Food › Day. Grams are the stored prescription, not estimates.
      </Note>
    </div>
  );
}

export default function SimpleShopping({ onShowFull, onOpenPlan }) {
  const [plan, setPlan] = useState("loading");// "loading" | null (no plan) | "error" | plan
  const [error, setError] = useState(null);
  const [building, setBuilding] = useState(false);
  const [busyName, setBusyName] = useState(null);
  const [copied, setCopied] = useState(false);
  // Purely visual: is the "start the list over" confirm sheet open.
  const [confirmingRestart, setConfirmingRestart] = useState(false);

  // Saved days (Food > Day) carry their own frozen ingredients; the grocery
  // endpoint consolidates the next week's worth through the same engine as
  // the week list. Additive and read-only — there is no per-item check
  // state stored for saved days, and inventing one client-side would lie
  // across devices. A failed load shows nothing; the week list stands.
  const [savedGrocery, setSavedGrocery] = useState(null);

  const load = useCallback(async () => {
    try {
      setPlan(await api.getCurrentPlan());
      setError(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
      setPlan("error");
    }
    try {
      const g = await api.prescriptionGrocery();
      setSavedGrocery(g?.daysFound > 0 ? g : null);
    } catch {
      setSavedGrocery(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const list = (plan && typeof plan === "object") ? plan.groceryList : null;
  const items = useMemo(() => (list?.items || []), [list]);
  const hasPlan = !!(plan && typeof plan === "object" && Array.isArray(plan.slots) && plan.slots.length);

  const bySection = useMemo(() => {
    const groups = {};
    for (const i of items) {
      const s = itemSection(i);
      (groups[s] = groups[s] || []).push(i);
    }
    return groups;
  }, [items]);

  const left = items.filter((i) => !i.checked).length;

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      const built = await api.generateGroceryList(plan.id);
      setPlan((p) => ({ ...p, groceryList: built }));
    } catch (e) {
      if (!isAbortError(e)) setError(describeError(e));
    } finally {
      setBuilding(false);
    }
  };

  // Regenerating the list resets every checkbox server-side ("a regenerated
  // list naturally resets its checkboxes" — plans.js:911), while this file's
  // own header promises that closing the app in aisle three keeps your place.
  // So: when anything is ticked, confirm before wiping it. Nothing ticked,
  // nothing to lose — build straight away.
  const startOver = () => {
    if (building) return;
    if (items.some((i) => i.checked)) { setConfirmingRestart(true); return; }
    build();
  };

  // Optimistic, with a rollback — ticking in a shop over bad signal must feel
  // instant, and must not silently lie if the write fails.
  const toggle = async (item, next) => {
    setBusyName(item.name);
    const before = items.map((i) => ({ ...i }));
    setPlan((p) => ({
      ...p,
      groceryList: { ...p.groceryList, items: p.groceryList.items.map((i) => (i.name === item.name ? { ...i, checked: next } : i)) },
    }));
    try {
      await api.checkGroceryItem(plan.id, item.name, next);
    } catch (e) {
      setPlan((p) => ({ ...p, groceryList: { ...p.groceryList, items: before } }));
      if (!isAbortError(e)) setError(describeError(e));
    } finally {
      setBusyName(null);
    }
  };

  const asText = () =>
    Object.entries(bySection)
      .map(([s, rows]) => `${sectionWord(s).toUpperCase()}\n${rows.map((r) => `- ${itemLine(r)}`).join("\n")}`)
      .join("\n\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy — your browser blocked it. Select the list and copy by hand.");
    }
  };

  if (plan === "loading") return <Busy>Getting your list…</Busy>;

  if (!hasPlan) {
    return (
      <Page title="Shopping">
        {error && <Note>{error}</Note>}
        {/* First visit lands here — there must be something to press. The
            button opens the Plan room, where the week gets built. Rendered
            only when the shell passes the navigation, never as a dead door. */}
        {savedGrocery && <SavedDaysBlock grocery={savedGrocery} />}
        <Empty action={onOpenPlan ? <Big onClick={onOpenPlan}>Open Plan</Big> : undefined}>
          Your shopping list comes from your week&rsquo;s food. Build a week first and the
          list writes itself.
        </Empty>
      </Page>
    );
  }

  if (!items.length) {
    return (
      <Page title="Shopping">
        {error && <Note>{error}</Note>}
        {savedGrocery && <SavedDaysBlock grocery={savedGrocery} />}
        <Empty action={<Big onClick={build} disabled={building}>{building ? "Working it out…" : "Make my list"}</Big>}>
          Everything this week&rsquo;s food needs, in one list, grouped by where it sits in the shop.
        </Empty>
      </Page>
    );
  }

  return (
    <Page
      title="Shopping"
      sub={left === 0 ? "All done — nothing left to get." : `${left} thing${left === 1 ? "" : "s"} left to get`}
      actions={<Quiet onClick={startOver}>{building ? "Starting over…" : "Start the list over"}</Quiet>}
    >
      {error && <Note>{error}</Note>}

      {Object.entries(bySection).map(([section, rows]) => (
        <div key={section} className="flex flex-col gap-1">
          <h2 className="text-sm text-muted-foreground px-4 pt-2">{sectionWord(section)}</h2>
          <Panel className="px-1 py-1">
            {rows.map((i) => (
              <Tick key={i.name} item={i} onToggle={toggle} busy={busyName === i.name} />
            ))}
          </Panel>
        </div>
      ))}

      {savedGrocery && <SavedDaysBlock grocery={savedGrocery} />}

      <div className="flex gap-2 flex-wrap">
        <Quiet onClick={copy}>{copied ? "Copied" : "Copy the list"}</Quiet>
        <a
          href={`sms:?&body=${encodeURIComponent(asText())}`}
          className="min-h-11 px-3 rounded-xl text-base text-muted-foreground hover:text-foreground
                     transition-colors flex items-center"
        >
          Text it
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent("Shopping list")}&body=${encodeURIComponent(asText())}`}
          className="min-h-11 px-3 rounded-xl text-base text-muted-foreground hover:text-foreground
                     transition-colors flex items-center"
        >
          Email it
        </a>
      </div>

      {/* Stated, not hidden. The backend's prices are rough estimates, and a
          confident total built from rough numbers is fake precision. */}
      <p className="text-base text-muted-foreground">
        No total — shop prices vary too much to quote one honestly.
      </p>

      <Details onClick={onShowFull} label="Costs and the full grocery view" />

      {confirmingRestart && (
        <Sheet
          title="Start the list over?"
          sub={`A fresh list starts with every box unticked — including the ${items.length - left} thing${
            items.length - left === 1 ? "" : "s"
          } you've already ticked off.`}
          onClose={() => setConfirmingRestart(false)}
        >
          <Big onClick={() => { setConfirmingRestart(false); build(); }}>
            Start the list over
          </Big>
        </Sheet>
      )}
    </Page>
  );
}
