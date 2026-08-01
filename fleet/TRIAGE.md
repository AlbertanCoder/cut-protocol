# FLEET TRIAGE — safety findings

Ground rule 1: an allergen/diet gate defect gets written here the moment it is
found, with reproduction, and the fleet keeps moving. Nothing in this file is
fixed by this fleet — this fleet measures. These are handoffs.

---

## T-1 — The allergen gate fails OPEN on protein/nutritional powders (CONFIRMED on real DB, currently UNREACHABLE)

**Severity: P1-latent.** The defect is real and reproduced on this machine's
real database. It is *not* currently shipping to users, because every affected
row is unreachable by the solver. It becomes **P0 the instant the adjuster pool
or recipe library widens into this food class** — which is exactly what a
"vegan protein density" fix is tempted to do. Read this before W3-6.

**Found:** W0-1, 2026-07-31. **Inherited from:** CONSOLIDATED-BRIEF §7 (D3),
which marked its own verdict "unproven, not wrong." It is now proven.

### Reproduction (real DB, `backend/prisma/dev.db` sha256 `d9037dce…b623a1`)

```bash
cd backend && node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const df=require('./src/lib/dietaryFilter.js');
(async()=>{
  const r=(await p.food.findMany({where:{name:{contains:'Isopure'}}}))[0];
  console.log(r.name, r.protein, r.fdcCategory, r.allergenTags, r.mayContain);
  for (const t of ['whey','dairy','milk'])
    console.log(t, df.foodMatchesExclusionTerm(r,t));
  console.log('vegan-excluded?', df.adjusterExcludedByStyle(r,'vegan'));
  await p.\$disconnect();
})();"
```

**Observed:**

```
Nutritional powder mix (Isopure)  58.1  Protein and nutritional powders  null  null
whey  false
dairy false
milk  false
vegan-excluded? false
```

`Isopure` is a **whey protein isolate**. The gate clears it for a whey-allergic
user, a dairy-allergic user, a milk-allergic user, and a vegan.

### Mechanism

`Food.allergenTags` and `Food.mayContain` are **NULL on 100% of all 14,151
rows** (verified by raw SQL, not by ORM default). With both metadata columns
empty the gate falls back to the food **name** and `fdcCategory`. The string
`"Nutritional powder mix (Isopure)"` contains no allergen word, and the
category `"Protein and nutritional powders"` maps to no allergen family. Every
evidence channel returns "no evidence," and the gate reads absence of evidence
as evidence of safety. **It fails open, not closed.**

### Blast radius (measured, not estimated)

| Population | Count |
|---|---|
| Foods in `fdcCategory = 'Protein and nutritional powders'` | 17 |
| …that clear **dairy AND milk AND vegan** simultaneously | **13 of 17** |
| …of those, referenced by ≥1 `RecipeIngredient` | **0** |
| …of those, present in `ADJUSTER_CANDIDATES` (`planContext.js:167-178`) | **0** |

The 13 include unambiguously dairy products — `Carnation Instant Breakfast`,
`Slim Fast`, `Herbalife high protein`. **All are inert today:** zero recipe
references, and the adjuster list is a hardcoded ten-name constant that does
not include them.

### Why this matters to THIS fleet specifically

The brief's own remediation instinct — widen the protein-adjuster pool to fix
vegan protein density — walks straight into this. The brief already says it:
*"Do not widen the adjuster pool into `Protein and nutritional powders` until
the whey question is resolved."* This triage upgrades that from caution to a
**measured hard gate**: 13 of 17 rows in that category are provably
mis-classified by the live gate. **W3-6 must not insert any row from this class
into a probe DB**, and W5-1 must not recommend widening into it.

### What a real fix requires (not this fleet's job)

Populating `allergenTags` is necessary but not sufficient — the failure is that
*absence of evidence passes*. The gate needs to **fail closed on unclassified
rows** in an allergen-restricted context. That inverts the same denylist→
allowlist lesson this repo's own `CLAUDE.md` already teaches about the
installer payload; `WORD_GUARDS` is a denylist of exceptions to a denylist and
will keep producing one of these per vocabulary expansion.

### Honest limits of this finding

- Method is a **known-item probe**, not a leak sweep. It confirms these rows
  leak; it does **not** bound how many other rows do. No agent in the prior
  campaign used a method capable of finding false negatives, and neither has
  this one yet. Absence of further hits below is not evidence of safety.
- "Unreachable" is measured against the current DB and the current hardcoded
  adjuster list. Both are things people change.

---

## T-2 — (open) Full false-negative leak sweep — NOT YET PERFORMED

Recorded so it is not mistaken for done. Every leak statement in the inherited
corpus rests on methods that inspect what was *removed* and are structurally
incapable of finding a false negative. W1-5's wrong-record scan and W4-2's laws
sweep are the fleet's attempts; neither is a complete sweep, and the final
report must say so rather than implying the gate is clean.
