# Fix 5 [MEDIUM] — "Cut/bulk table" tiers are read-only, no apply action

**File:** `frontend/src/components/EngineTab.jsx`
**Diagnosed in:** AUDIT.md §5/§10 — "Shows 6 computed kcal tiers with
projected dates — tapping a row does nothing; only the 3 buttons below
(2,150 / 2,000 / custom) actually set a target. A user reading 'Standard
−20%: 2,320 kcal, finish Nov 3' has no way to apply it except manually
retyping the number into the custom field." Confirmed visually in AUDIT.md
§8 screenshot notes (no cursor affordance, no click handler fires).

---

## Design reasoning

**Reuse the existing `setTarget`/`Btn` pattern exactly — don't invent a new
one.** `EngineTab.jsx` already has a working apply action
(`setTarget`, line 38-41) and a working small-button component (`Btn`,
imported from `ui/Parts.jsx`) used three times already in the same file's
"Current prescription" card (lines 221-222, 226). The tier table needs
nothing new — just a `Btn small` per row calling `setTarget(t.kcal)`.

**Clamping is inherited for free, not something this patch adds.**
`setTarget()` already does `Math.max(FLOOR, Math.round(t))` before calling
the API, and `PUT /api/profile/target` re-clamps server-side to `>= 2000`
regardless (`routes/profile.js:36`). Tapping "Apply" on "Hard cut −25%" for a
user whose TDEE makes that tier compute below 2000 will silently clamp to
2000 — same behavior the existing quick-set buttons already have. Flagged in
Risks below since it's a real (if pre-existing) UX wrinkle this patch doesn't
fix.

**Layout — extend the grid, don't shrink existing columns aggressively.**
Current header/row grid is `grid-cols-12`: Tier(5) / kcal(2) / lb/wk(2) /
Goal date(3). Adding an Apply column needs to borrow space from somewhere.
Picked Tier(4) / kcal(2) / lb/wk(2) / Goal date(2) / Apply(2) — Tier names
("Hard cut −25%", "Lean bulk +10%") are the longest strings in the row and
losing a column of width there is the most visible risk; flag for the
reviewer to actually render this and confirm nothing wraps awkwardly on a
narrow phone viewport (this is a mobile-first app per `CLAUDE.md` §8: "Mobile
user: tight").

---

## Patch — `frontend/src/components/EngineTab.jsx`

**Before:**
```jsx
      <Card section="TIERS" title="Cut / bulk table">
        <div className="text-[10.5px] font-extrabold grid grid-cols-12 pb-1.5 uppercase tracking-wide" style={{ color: C.faintLight, borderBottom: `1px solid ${C.rule}` }}>
          <div className="col-span-5">Tier</div>
          <div className="col-span-2 text-right">kcal</div>
          <div className="col-span-2 text-right">lb/wk</div>
          <div className="col-span-3 text-right">Goal date</div>
        </div>
        {tiers.map((t) => (
          <div key={t.name} className="text-xs grid grid-cols-12 py-2 items-baseline font-semibold rounded-lg px-1"
            style={{ borderBottom: `1px solid ${C.rule}`, background: t.pin ? C.accentBg : "transparent", color: C.ink }}>
            <div className="col-span-5 pr-1">{t.name}</div>
            <div className="col-span-2 text-right font-extrabold">{kc(t.kcal)}</div>
            <div className="col-span-2 text-right">{t.rate > 0.05 ? r1(t.rate) : "—"}</div>
            <div className="col-span-3 text-right">{t.date ? fmtD(t.date) : "—"}</div>
          </div>
        ))}
      </Card>
```

**After:**
```jsx
      <Card section="TIERS" title="Cut / bulk table">
        <div className="text-[10.5px] font-extrabold grid grid-cols-12 pb-1.5 uppercase tracking-wide" style={{ color: C.faintLight, borderBottom: `1px solid ${C.rule}` }}>
          <div className="col-span-4">Tier</div>
          <div className="col-span-2 text-right">kcal</div>
          <div className="col-span-2 text-right">lb/wk</div>
          <div className="col-span-2 text-right">Goal date</div>
          <div className="col-span-2 text-right">Apply</div>
        </div>
        {tiers.map((t) => (
          <div key={t.name} className="text-xs grid grid-cols-12 py-2 items-center font-semibold rounded-lg px-1"
            style={{ borderBottom: `1px solid ${C.rule}`, background: t.pin ? C.accentBg : "transparent", color: C.ink }}>
            <div className="col-span-4 pr-1">{t.name}</div>
            <div className="col-span-2 text-right font-extrabold">{kc(t.kcal)}</div>
            <div className="col-span-2 text-right">{t.rate > 0.05 ? r1(t.rate) : "—"}</div>
            <div className="col-span-2 text-right">{t.date ? fmtD(t.date) : "—"}</div>
            <div className="col-span-2 text-right">
              <Btn small kind="ghost" onClick={() => setTarget(t.kcal)}>Set</Btn>
            </div>
          </div>
        ))}
      </Card>
```

Notes on the two incidental changes:
- `items-baseline` → `items-center`: with a button now in the row, baseline
  alignment (designed for text-only rows) will visually misalign the button
  against the text columns — `items-center` is the same fix `Stat`/other
  button-containing rows in this codebase already use. Low-risk, cosmetic;
  revert to `items-baseline` if a reviewer prefers and it still looks fine
  once actually rendered.
- Reuses the exact `Btn small kind="ghost"` variant already used for the
  custom-target "Set" button two cards below (`EngineTab.jsx:226`) rather
  than inventing a new button style, per this file's own established pattern.

---

## Risks / things to double-check before applying

1. **Clamping surprise on sub-floor tiers is pre-existing, not introduced by
   this patch, but now more directly reachable.** "Hard cut −25%" or
   "Standard −20%" can compute below the 2000 floor depending on the user's
   TDEE (not the case for the current single fixture user, whose numbers keep
   every tier at/above 2000 per `CLAUDE.md` §7, but not guaranteed for a
   different user/weight). Tapping "Set" on such a row will silently clamp to
   2000 with no visible feedback that the applied number differs from the
   displayed tier number. Consider (not included in this patch, since it's a
   product-behavior decision, not a bug fix): disabling/graying the Apply
   button for any tier whose `kcal < FLOOR`, or showing the clamped number
   inline. Flag for product review.
2. **The RX-locked row (`pin: true`) also gets an Apply button** under this
   patch — tapping it applies `RX` (2150), which is identical to what the
   existing "2,150" quick-set button below already does. Harmless
   duplication, not a new capability, but confirm this is the intended UX
   (vs. e.g. disabling Apply specifically on the pinned/locked row) before
   shipping.
3. **Grid column re-split (5/2/2/3 → 4/2/2/2/2) needs an actual visual
   check**, not just a diff read — this patch was written by reasoning about
   Tailwind grid math, not by rendering the component. Longest tier name
   ("Hard cut −25%") at `col-span-4` on a narrow phone viewport is the
   specific thing to verify doesn't wrap into two lines and break row-height
   consistency.
