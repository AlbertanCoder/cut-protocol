# Fix 6 [LOW] — undisclosed flat −25g carb-midpoint fudge in `computeMacros()`

**File:** `backend/src/lib/bmrEngine.js` (compute), `frontend/src/components/EngineTab.jsx` (surface)
**Diagnosed in:** PABLO_REVIEW.md §2.2 — `carbMid = round((targetKcal -
proteinAvg*4 - fatAvg*9)/4) - 25` subtracts a flat 25g with no comment
explaining why. Practical effect at this user's 2000 kcal target: the
protein+fat+carb midpoints sum to ~1900 kcal, a ~100 kcal gap the UI never
surfaces. Pablo's framing: "exactly the kind of unexplained arithmetic this
app's own Constitution (CLAUDE.md C1: 'every displayed number is tappable →
reveals formula, inputs, arithmetic') says shouldn't exist."

---

## Design reasoning — chose "surface honestly," not "remove," as the primary fix

The task allows either: remove the fudge, or explain it. Two considered,
picked the second as primary:

- **Removing it changes a live, already-in-use prescription.** This user has
  been eating against these macro ranges already (per project memory: FTMO-
  unrelated context aside, this is a real, currently-running cut protocol per
  `CLAUDE.md` §7/§9). Silently raising the displayed carb range by ~6g
  (25g ÷ 4 to reverse the kcal subtraction... actually the subtraction is
  already in grams directly, so removing it raises `carbMid` by exactly 25g,
  ~100 kcal) is itself an undisclosed change to a number the user has been
  trusting, just in the opposite direction from the current bug. That's not
  obviously safer than what's being fixed.
- **We don't actually know if 25g was a deliberate calibration or a stray
  leftover.** Pablo's own review only guesses ("my best guess: a crude
  fiber/rounding buffer") — there's no comment, no test asserting the exact
  behavior, no git history predating the single-commit dump to check against
  (per AUDIT.md §9: "There is no history to audit for how the original solver
  was built"). Changing a number nobody can currently explain, instead of
  just explaining it, has a real chance of being the wrong call either way.
- **C1 itself asks for disclosure, not a specific numeric answer** ("every
  displayed number is tappable → reveals formula, inputs, arithmetic") — the
  constitution's actual bar is explainability, which this patch satisfies
  directly without gambling on which numeric answer is "more correct."

**A removal path is included below as an alternative**, clearly marked, in
case the product owner reviews the disclosed reasoning and decides the buffer
should just go — but it's not the primary recommendation.

---

## Patch (primary) — surface the buffer, keep behavior identical

### 1. `backend/src/lib/bmrEngine.js` — name the constant, comment it honestly, return the gap so the UI can show it

**Before:**
```js
// Protein/fat targets are g-per-lb-of-LBM heuristics — convert weight to lb
// here specifically, matching v1's EngineTab math exactly.
function computeMacros(profile, weightKg, targetKcal) {
  const weightLb = kg2lb(weightKg);
  const lbmLb = weightLb * (1 - profile.bodyFatPct / 100);
  const proteinLo = Math.round(lbmLb * 1.14);
  const proteinHi = Math.round(lbmLb * 1.25);
  const fatLo = Math.round(lbmLb * 0.34);
  const fatHi = Math.round(lbmLb * 0.4);
  const carbMid = Math.round((targetKcal - ((proteinLo + proteinHi) / 2) * 4 - ((fatLo + fatHi) / 2) * 9) / 4) - 25;
  return {
    lbmLb,
    kcal: targetKcal,
    proteinLo, proteinHi,
    fatLo, fatHi,
    carbLo: Math.max(carbMid - 12, 0),
    carbMid,
    carbHi: carbMid + 12,
  };
}
```

**After:**
```js
// Protein/fat targets are g-per-lb-of-LBM heuristics — convert weight to lb
// here specifically, matching v1's EngineTab math exactly.

// Undisclosed-until-now conservatism margin (PABLO_REVIEW.md §2.2): shaves
// this many grams off the carb midpoint before deriving carbLo/carbHi below.
// Effect: the displayed protein+fat+carb midpoints sum to ~100 kcal UNDER
// the displayed calorie target, with nothing in the UI explaining why -
// this constant and computeMacros()'s new `macroKcalGap`/`carbBufferG`
// return fields exist specifically to make that gap visible per this
// project's own constitution (CLAUDE.md C1: "every displayed number is
// tappable -> reveals formula, inputs, arithmetic"). Kept at its existing
// value (25g) rather than changed - nobody could confirm whether this
// number was a deliberate calibration or a stray leftover (no comment, no
// test, no pre-dump git history exists to check against per AUDIT.md §9),
// and this user has already been eating against the range it produces. If a
// future review decides it should be removed instead of disclosed, that's a
// one-line change (drop the `- CARB_MIDPOINT_BUFFER_G`) plus removing the
// two new return fields and their EngineTab.jsx display line.
const CARB_MIDPOINT_BUFFER_G = 25;

function computeMacros(profile, weightKg, targetKcal) {
  const weightLb = kg2lb(weightKg);
  const lbmLb = weightLb * (1 - profile.bodyFatPct / 100);
  const proteinLo = Math.round(lbmLb * 1.14);
  const proteinHi = Math.round(lbmLb * 1.25);
  const fatLo = Math.round(lbmLb * 0.34);
  const fatHi = Math.round(lbmLb * 0.4);
  const proteinMid = (proteinLo + proteinHi) / 2;
  const fatMid = (fatLo + fatHi) / 2;
  const carbMid = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4) - CARB_MIDPOINT_BUFFER_G;
  // Live-computed, not hardcoded to "100 kcal" - self-updating if the
  // protein/fat heuristics or the buffer constant ever change, rather than
  // a second place that can silently drift from the actual arithmetic
  // above (the exact class of bug this whole fix exists to prevent).
  const macroKcalGap = Math.round(targetKcal - (proteinMid * 4 + fatMid * 9 + carbMid * 4));
  return {
    lbmLb,
    kcal: targetKcal,
    proteinLo, proteinHi,
    fatLo, fatHi,
    carbLo: Math.max(carbMid - 12, 0),
    carbMid,
    carbHi: carbMid + 12,
    carbBufferG: CARB_MIDPOINT_BUFFER_G,
    macroKcalGap,
  };
}
```

*(`carbLo`/`carbMid`/`carbHi`/every previously-returned field is numerically
identical to before this patch — this is a pure disclosure add, zero
behavior change to any existing consumer.)*

### 2. `frontend/src/components/EngineTab.jsx` — display the gap in the Macro engine card

**Before:**
```jsx
      <Card section="§4" title="Macro engine">
        <div className="flex rounded-full overflow-hidden h-2.5 mb-3">
          <div style={{ width: `${(macros.proteinHi * 4 / profile.targetKcal) * 100}%`, background: C.protein }}></div>
          <div style={{ width: `${(macros.fatHi * 9 / profile.targetKcal) * 100}%`, background: C.fat }}></div>
          <div style={{ width: `${(macros.carbHi * 4 / profile.targetKcal) * 100}%`, background: C.carb }}></div>
          <div className="flex-1" style={{ background: C.rule }}></div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <Stat label="Protein range" value={`${macros.proteinLo}–${macros.proteinHi}`} unit="g" />
          <Stat label="Fat range" value={`${macros.fatLo}–${macros.fatHi}`} unit="g" />
          <Stat label="Carb range" value={`~${macros.carbLo}–${macros.carbHi}`} unit="g" />
          <Stat label="Fiber" value="25+" unit="g" />
        </div>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          For target {kc(profile.targetKcal)} · protein + calories are load-bearing walls · fat is a floor · carbs flex
        </div>
      </Card>
```

**After:**
```jsx
      <Card section="§4" title="Macro engine">
        <div className="flex rounded-full overflow-hidden h-2.5 mb-3">
          <div style={{ width: `${(macros.proteinHi * 4 / profile.targetKcal) * 100}%`, background: C.protein }}></div>
          <div style={{ width: `${(macros.fatHi * 9 / profile.targetKcal) * 100}%`, background: C.fat }}></div>
          <div style={{ width: `${(macros.carbHi * 4 / profile.targetKcal) * 100}%`, background: C.carb }}></div>
          <div className="flex-1" style={{ background: C.rule }}></div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <Stat label="Protein range" value={`${macros.proteinLo}–${macros.proteinHi}`} unit="g" />
          <Stat label="Fat range" value={`${macros.fatLo}–${macros.fatHi}`} unit="g" />
          <Stat label="Carb range" value={`~${macros.carbLo}–${macros.carbHi}`} unit="g" />
          <Stat label="Fiber" value="25+" unit="g" />
        </div>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          For target {kc(profile.targetKcal)} · protein + calories are load-bearing walls · fat is a floor · carbs flex
        </div>
        {macros.macroKcalGap > 0 && (
          <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
            Ranges sum to ~{kc(profile.targetKcal - macros.macroKcalGap)} kcal at the midpoint ({macros.macroKcalGap} kcal under target) — {macros.carbBufferG}g is deliberately trimmed off the carb midpoint as a rounding/conservatism margin, not a formula error.
          </div>
        )}
      </Card>
```

---

## Alternative patch (not primary) — remove the buffer instead

If the product owner reviews this and decides the number should just go away
rather than be explained, the change is a single line plus deleting the two
new return fields and the new display block above:

```js
const carbMid = Math.round((targetKcal - proteinMid * 4 - fatMid * 9) / 4); // no buffer
```

This raises `carbMid`/`carbHi`/`carbLo` by 25g each for every user, which —
for the current fixture user at 2000 kcal — moves the displayed carb range
from roughly 135-160g toward roughly 160-185g (rough numbers; recompute
exactly against the live profile before applying). **Do not apply this
alternative without confirming with the account owner first** — it's a
real, silent-until-you-check change to an already-running cut protocol's
carb prescription, which is exactly the kind of thing `CLAUDE.md` C4 ("every
automatic adjustment is logged, visible, one-tap reversible") and C9
("user's observed data beats the model's prediction") argue against doing
unannounced.

---

## Risks / things to double-check before applying

1. **`computeMacros()` has three call sites** (`routes/plans.js:49`,
   `routes/recipes.js:26`, `routes/weighins.js:50`) — confirmed via grep that
   none of them destructure a fixed field list or otherwise assume the exact
   shape of the return object; two new additive fields (`carbBufferG`,
   `macroKcalGap`) are safe to add. `routes/weighins.js`'s `summary.macros`
   gets serialized straight to JSON for the frontend (`GET
   /api/weighins/summary`) — the two new fields will appear there too,
   harmlessly, unless some frontend code does strict-shape validation on
   that response (not observed in `TodayTab.jsx`'s usage during this
   review, but not exhaustively checked either).
2. **The primary patch is disclosure-only and changes no delivered numbers**
   — this is the lowest-risk of the six patches in this set. The main thing
   to verify post-apply is that `macroKcalGap`'s live computation actually
   equals the historical ~100 kcal Pablo observed for the fixture user (a
   quick sanity check, not a design risk).
3. **Wording of the new UI line is a first draft** — "deliberately trimmed...
   as a rounding/conservatism margin" is honest about *what* happens but
   still can't honestly claim *why* 25g specifically (nobody currently
   knows). If that reads as evasive to the account owner when they see it,
   the more blunt alternative is: "This app subtracts 25g from your carb
   target for an unexplained historical reason — flag to fix or remove." Pick
   whichever tone fits; this patch defaults to the softer framing.
