# TO OWNER — RESOLVED: the `foodOverrides.json` change is yours

**Status: closed.** The owner confirmed on 2026-07-30 that the modification to
`backend/data/foodOverrides.json` (mtime 04:40:08) is their own work, made in a
parallel session. **There was no Law 1 violation and no fleet contamination.** This
file is kept as the record, and because your overrides interact with two of the
campaign's findings in ways worth writing down.

Evidence preserved in `incident/` regardless: `foodOverrides.json.AS-FOUND-0440`,
`foodOverrides.json.HEAD-0d3eaa5`, `foodOverrides.diff`. Nothing needs reverting.

---

## 1. Your `Pepper` override corrected an error of MINE

Your entry reclassifies `Pepper` as black peppercorn (`pantry`, 251 kcal) with the note
*"previous row carried BANANA PEPPER vegetable data (27 kcal)… the row now denotes what
recipes mean."*

I had used that same row as evidence for a nightshade leak (D1b), reasoning from its
`fruit-veg` category and 27 kcal density that it was a fresh capsicum. **You were right
and I was wrong.** The gram amounts are decisive:

```
"Pepper"        81 recipes   median 0.25 g   min 0.1 g    -> seasoning, not a vegetable
"Green Pepper"  15 recipes   median 1.25 g   max 28.1 g
"Red Pepper"    46 recipes   median 1.25 g   max 18.8 g
```

0.125 g of "Pepper" in `Arepa Pabellón` is a pinch. The banana-pepper macros were the
defect; the ingredient was always peppercorn.

**Corrected in `FLEET-REPORT.md`:** D1b drops from 10 hits / 5 customers to **5 hits /
3 customers** (p042, p111, p183 — p088 and p170 are clean), and the campaign total from
42 hits / 18 customers to **37 hits / 16 customers, 93.6 % clean**.

## 2. Three rows your sweep did not reach — and one is my #2 by customer impact

Your 17 entries cover 4 of the 8 rows this campaign ranked by how often they actually
reached a customer's plate. **Three are still uncovered:**

| row | slots reached | carries | status |
|---|---:|---|---|
| `Potatoes` | 111 | *Bread, potato* | ✅ covered by you |
| **`Tomato Puree`** | **102** | tomato-powder family | ❌ **not covered — my #2 by reach** |
| `Carrots` | 92 | *Carrot, dehydrated* (8×) | ✅ covered |
| `Tinned Tomatos` | 53 | *Tomato powder* | ✅ covered |
| `Tomatoes` | 17 | *Tomato powder* | ✅ covered |
| **`Tuna`** | **17** | *Fish, tuna salad* (mayo) — 9.26 g fat vs ~1 | ❌ **not covered** |
| **`Cannellini Beans`** | **14** | *Beans, cannellini, **dry*** — 345 kcal, used in a **baked** dish | ❌ **not covered** |
| `Chicken Breast` | 7 | *tenders, breaded* | ✅ covered |

`Tomato Puree` is the notable gap: you fixed `Tomatoes` and `Tinned Tomatos` but the
puree row reaches **more** fleet slots than either.

## 3. `Red Pepper` and `Green Pepper` need exactly what you just did to `Pepper`

Both are `fruit-veg` rows carrying fresh-capsicum macros, but used at **1.25 g median**
— so they are wrong twice over: the macros are for a vegetable, and the usage is a
spice. They also differ from `Pepper` in one way that matters for the allergen gate:
**crushed red pepper and cayenne flakes ARE *Capsicum*, so they remain genuine
nightshades however small the dose**, whereas black peppercorn is *Piper nigrum* and
never was one. `Green Pepper` at 28 g in `Szechuan Beef` is plainly a vegetable.

Suggested split: a `pantry` spice row for the flake/ground forms, a `fruit-veg` row for
the vegetable form, and let the recipes point at whichever they mean.

## 4. `Perogies, boiled` needs a keyword, not a macro fix

The last surviving D1b hit is not a macro problem — `Perogies, boiled` (200 kcal,
`pantry`) is correct data. The defect is that **the nightshade family's `nameKeywords`
has no `perogi`/`pierogi` entry**, though the *gluten* family already does. A potato
dumpling whose name never says "potato" walks through a nightshade wall. One-line fix in
`allergenTaxonomy.js`.

## 5. Effect on the report's numbers, and what to re-measure

**No campaign measurement is invalidated.** Everything was measured before 04:40 against
the unmodified rows, and I confirmed at end of run that the `Food` table still carried
the old values (`Potatoes` 266, `Carrots` 341, `Tinned Tomatos` 302, `Chicken Breast`
14.7 g P) — overrides only reach customers once seeded into SQLite, so nothing served
during this campaign was affected.

**After you seed them, re-measure these and expect them to move:**

- **the 40.8 % macro-compliance figure** — it is measured against the old rows and is
  *unsigned*, so it can move either way. The vegan cohort should improve most, since the
  rows you fixed are the ones concentrated on it (13.3 % in band, 8.1 inflated-row slots
  per persona).
- **D3's specific examples will stop reproducing** — `Boulangère Potatoes` at 2,240 kcal,
  the 1,995-kcal "potato" contribution, p073's 1,264-vs-470 kcal day. That is the fix
  landing, not the finding being wrong.
- **D1b's `Pepper` hits are already gone** by virtue of your override.

Worth a `qc:integrity` pass plus a re-run of the 15×3 regeneration subsample afterwards
to confirm the direction of travel.

---
*Campaign remains report-only: HEAD unchanged at `0d3eaa5`, no git writes, port 3001
never probed, and every fleet artifact inside
`docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/`.*
