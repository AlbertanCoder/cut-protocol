# Data Isolation Audit — cross-user leak/mutation check

Scope: every Prisma query in every route handler under `backend/src/routes/`
(`auth.js`, `profile.js`, `weighins.js`, `recipes.js`, `plans.js`, `foods.js`,
`cart.js`), checked against `backend/prisma/schema.prisma`. Read-only
analysis, no code changed.

`req.userId` is trustworthy: it's set in `backend/src/lib/auth.js`
`requireAuth()` (line 47) from the verified JWT `sub` claim, never from a
client-supplied header/body/param. So the only question per query is whether
the `where` clause actually constrains on it (or on a relation that does)
when the model is meant to be per-user.

## Model ownership, per schema.prisma

| Model | Has `userId`? | Intended scope |
|---|---|---|
| `Profile` | yes (`@unique`) | per-user |
| `Weighin` | yes | per-user |
| `Plan` / `PlanSlot` (via `Plan`) / `GroceryList` (via `Plan`) | yes (on `Plan`) | per-user |
| `CartItem` | yes | per-user |
| `Food` | **no** | shared global library (schema.prisma:74-75, explicit comment) |
| `Recipe` / `RecipeIngredient` (via `Recipe`) | **no** | shared global library |

## Route-by-route findings

### `auth.js`

| Route | Query | Verdict |
|---|---|---|
| `POST /login` | `prisma.user.findUnique({ where: { email } })` (auth.js:12) | SAFE — lookup by credential, not by another user's identifier; pre-auth by definition |
| `POST /logout` | none | SAFE |
| `GET /me` | `prisma.user.findUnique({ where: { id: req.userId } })` (auth.js:28) | SAFE |

### `profile.js` (all routes behind `router.use(requireAuth)`, profile.js:6)

| Route | Query | Verdict |
|---|---|---|
| `GET /` | `prisma.profile.findUnique({ where: { userId: req.userId } })` (profile.js:16) | SAFE |
| `PUT /` | `prisma.profile.upsert({ where: { userId: req.userId }, ... })` (profile.js:25-29) | SAFE |
| `PUT /target` | `prisma.profile.update({ where: { userId: req.userId }, ... })` (profile.js:37) | SAFE |

No client-supplied ID is ever used to locate a `Profile` row — always keyed off `req.userId`. Correct.

### `weighins.js` (behind `requireAuth`, weighins.js:7)

| Route | Query | Verdict |
|---|---|---|
| `GET /` | `findMany({ where: { userId: req.userId }, ... })` (weighins.js:13) | SAFE |
| `POST /` | `upsert({ where: { userId_date: { userId: req.userId, date } }, ... })` (weighins.js:22-26) | SAFE — compound key includes `userId`, so it can never touch another user's row even if `date` collides |
| `DELETE /:date` | `deleteMany({ where: { userId: req.userId, date: req.params.date } })` (weighins.js:31) | SAFE — `date` comes from the URL param but is combined with `userId` in the filter, so it can only ever delete the caller's own row |
| `GET /summary` | `profile.findUnique({ where: { userId: req.userId } })` (weighins.js:36) + `weighin.findMany({ where: { userId: req.userId }, ... })` (weighins.js:39) | SAFE |

Weighin is clean across the board — every query, including the delete-by-date-param, is compound-scoped to `req.userId`.

### `recipes.js` (behind `requireAuth`, recipes.js:11)

| Route | Query | Verdict |
|---|---|---|
| `GET /` | `recipe.findMany({ include: RECIPE_INCLUDE, ... })` (recipes.js:14) — no `userId` filter | SHARED-BY-DESIGN — `Recipe` has no `userId` column; this is the intended global library read |
| `POST /generate-drafts` | `profile.findUnique({ where: { userId: req.userId } })` (recipes.js:23); `recipe.findMany({ select: { name: true } })` (recipes.js:29) reads all recipe names only, to dedupe AI output | SAFE (profile part) / SHARED-BY-DESIGN (recipe-name read, no sensitive data) |
| `POST /save-draft` | `food.findMany({ where: { id: { in: ... } } })` (recipes.js:53) reads global Food library, then `persistRecipe()` → `prisma.recipe.create(...)` (recipeGeneration.js:62) — recipe created with **no owner field at all** | SHARED-BY-DESIGN, but see flag below — any authenticated user's saved recipe becomes visible/editable/deletable by every other user, permanently, with no record of who created it |
| `PUT /:id` | `prisma.recipe.findUnique({ where: { id: req.params.id } })` (recipes.js:73) then `prisma.recipe.update({ where: { id: recipe.id }, ... })` (recipes.js:101) — **id from URL param, zero ownership check of any kind** | **VULNERABLE** (flagged, see below) — not a classic IDOR-vs-intended-scoping bug since `Recipe` genuinely has no `userId` to check, but functionally: any logged-in user can rename, re-describe, re-step, and swap the entire ingredient list of ANY other user's recipe, including recipes actively referenced by other users' current `PlanSlot`/`CartItem` rows |
| `DELETE /:id` | `prisma.recipe.findUnique({ where: { id: req.params.id } })` (recipes.js:110) then `recipeIngredient.deleteMany` + `prisma.recipe.delete({ where: { id: recipe.id } })` (recipes.js:114-115) — same, id from URL param, no ownership check | **VULNERABLE** (flagged) — any user can delete any other user's recipe outright |

### `foods.js` (behind `requireAuth`, foods.js:6)

| Route | Query | Verdict |
|---|---|---|
| `GET /` | `food.findMany({ orderBy: [...] })` (foods.js:9) — no `userId` filter, no write routes exist for Food at all | SHARED-BY-DESIGN — matches schema.prisma:74-75's explicit comment; there is no mutation surface to worry about since `foods.js` only exports the read route |

### `plans.js` (behind `requireAuth`, plans.js:12) — spot-checked closely per instructions

| Route | Query | Verdict |
|---|---|---|
| `GET /current` | `plan.findUnique({ where: { userId_startDate: { userId: req.userId, startDate: monday } }, ... })` (plans.js:79-82) | SAFE — compound key scoped |
| `POST /generate` | `planContext(req.userId)` → `profile.findUnique({ where: { userId } })` (plans.js:46); existing-plan lookup `plan.findUnique({ where: { userId_startDate: {...} } })` (plans.js:91-94); `plan.upsert({ where: { userId_startDate: {...} }, ... })` (plans.js:107-111); `planSlot.deleteMany({ where: { planId: plan.id, id: { notIn: [...] } } })` (plans.js:116) | SAFE — `plan.id` used in the deleteMany was itself obtained from a `userId`-scoped upsert immediately above, so the deleteMany can't reach another user's slots even though its own `where` doesn't repeat `userId` |
| `PUT /:planId/slots/:slotId` | ownership check first: `planSlot.findFirst({ where: { id: req.params.slotId, planId: req.params.planId, plan: { userId: req.userId } } })` (plans.js:129), THEN `planSlot.update({ where: { id: slot.id }, ... })` (plans.js:131) | SAFE — correct pattern: verify-then-act. The second query's `where: { id: slot.id }` looks unscoped in isolation, but `slot.id` only exists because the prior query already proved that slot belongs to `req.userId` |
| `POST /:planId/slots/:slotId/swap` | `plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } })` (plans.js:137) — ownership verified — then `target` is found via in-memory `.find()` over `plan.slots` (plans.js:139), `upsertSlot(plan.id, result)` (plans.js:148) and `planSlot.findUnique({ where: { id: updated.id } })` (plans.js:149) both operate on IDs already proven to belong to this user/plan | SAFE |
| `POST /:planId/grocery-list` | `plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } })` (plans.js:179) ownership check, then `groceryList.upsert({ where: { planId: plan.id }, ... })` (plans.js:192-196) | SAFE — `plan.id` already verified |
| `GET /:planId/grocery-list` | `groceryList.findFirst({ where: { planId: req.params.planId, plan: { userId: req.userId } } })` (plans.js:201) | SAFE — relation filter scopes correctly |

`plans.js` is the most complex file in the app and it's also the most disciplined: every mutation either scopes `userId` directly in the same query, or does an explicit ownership `findFirst`/`findUnique` first and only ever chains subsequent queries off IDs pulled from that already-verified result. No shortcuts taken.

### `cart.js` (behind `requireAuth`, cart.js:8)

| Route | Query | Verdict |
|---|---|---|
| `GET /` | `cartItem.findMany({ where: { userId: req.userId }, ... })` (cart.js:11-15) | SAFE |
| `POST /` | `recipe.findUnique({ where: { id: recipeId } })` (cart.js:22) — no `userId` needed, `Recipe` is global — existence check only, then `cartItem.upsert({ where: { userId_recipeId: { userId: req.userId, recipeId } }, ... })` (cart.js:25-30) | SAFE — the compound key means a user can only ever create/touch their own cart row, regardless of which `recipeId` they pass |
| `DELETE /:recipeId` | `cartItem.deleteMany({ where: { userId: req.userId, recipeId: req.params.recipeId } })` (cart.js:35) | SAFE — `recipeId` from URL param but combined with `userId`, so it can only ever delete the caller's own cart entry |
| `POST /grocery-list` | `cartItem.findMany({ where: { userId: req.userId }, ... })` (cart.js:55-58) | SAFE |

`cart.js` is clean. `CartItem`'s compound unique key (`userId_recipeId`) does the scoping work for free in both the upsert and the delete.

## Cross-user blast radius trace: shared `Recipe`/`Food` library

Per schema.prisma:74-75 and :175-178, `Food` and `Recipe` are explicitly
**not** per-user, "single-user app for now, shared curated library is
simpler model regardless." Tracing what that means once real User A and
User B both exist:

- **`Food` (foods.js)**: read-only route, no create/update/delete endpoint
  exists anywhere in `backend/src/routes/`. Even though the table is global,
  there's currently no way for any user to mutate it via the API, so there's
  no cross-user mutation risk today. (Food rows are presumably seeded/grown
  server-side via `ingredientResolver.js`, not through a user-facing route —
  not audited here since it's outside `routes/`.) SAFE as shipped, but worth
  noting: the moment a food-editing route is added, it needs the same
  ownership-model decision recipes need below.

- **`Recipe` (recipes.js)**: fully mutable with **no ownership field, no
  permission check, and no per-user visibility split**. Concretely:
  - User A calls `PUT /api/recipes/:someId` with an id that happens to be a
    recipe User B created via `POST /save-draft` (or that's in the curated
    seed library). The route (recipes.js:72-107) does not know or care who
    created it — it succeeds. User A can rename it, change its macros,
    rewrite its steps, replace all its ingredients.
  - User A calls `DELETE /api/recipes/:someId` on the same id (recipes.js:
    109-117) and it's gone — for every user, permanently.
  - **`onDelete` trace for what happens downstream (schema.prisma):**
    - `PlanSlot.recipeId → Recipe`: `onDelete: SetNull` (schema.prisma:146).
      So if User A deletes a recipe that's sitting in User B's current
      `PlanSlot`, User B's plan silently loses that meal — `recipeId` and
      `ingredients`/macros on the slot go stale/null-referenced with **no
      notification to User B**. `recipes.js:112-113`'s own comment
      acknowledges this is deliberate ("old plans survive intact") but that
      reasoning was written for a single-user app where only the recipe's
      own owner could ever trigger it. In multi-user it becomes User A
      silently breaking User B's meal plan.
    - `CartItem.recipeId → Recipe`: `onDelete: Cascade` (schema.prisma:184).
      So if User A deletes a recipe that's in User B's cart, **User B's
      `CartItem` row is silently deleted too** — no error, no trace, the
      item just vanishes from User B's cart next time they load it. This is
      a direct, mechanical cross-user side effect caused by one user's
      unscoped delete.
  - This is functionally a data-integrity/authorization gap, not a
    read-confidentiality leak (nothing secret is exposed — recipe content
    is meant to be shared) — but it is a cross-user **availability/integrity**
    problem: any user can destroy or corrupt content other users depend on.

## Prioritized fix list

1. **[HIGH] `recipes.js` `PUT /:id` and `DELETE /:id` have no ownership or
   permission model whatsoever (recipes.js:72-117).** Before multi-user
   launch, decide and implement one of:
   - (a) Add `createdBy`/`userId` to `Recipe`, make user-generated recipes
     (`source: "ai-generated"`/saved drafts) editable/deletable only by
     their creator, and lock the curated seed library (`source: "curated"`)
     to admin-only mutation; or
   - (b) Keep the library fully shared/collaborative by explicit product
     decision, but then add a real permission gate (e.g. only curator/admin
     role can `PUT`/`DELETE`) so a random authenticated user can't unilaterally
     rewrite or delete content other users' plans and carts depend on.
   Either way, the current "any authenticated user, no check" state should
   not ship to real multi-user traffic — it's the one place in the codebase
   where `req.userId` is available but never consulted at all for a mutating
   route.

2. **[MEDIUM] `CartItem` cascade-deletes silently on another user's
   `Recipe` deletion (schema.prisma:184, triggered via recipes.js:115).**
   Once (1) is fixed this mostly resolves itself, but independently worth
   flagging: even a legitimate recipe-owner deleting their own recipe
   currently wipes it out of every other user's cart with no warning. If
   recipes stay a shared library by design, consider notifying affected
   users or blocking delete while the recipe is in any cart/active plan,
   rather than a silent cascade.

3. **[LOW / informational] `PlanSlot.recipeId` `SetNull` on recipe delete
   (schema.prisma:146) has the same "no notification to the affected user"
   gap**, but it degrades more gracefully (slot just goes empty/stale
   rather than the row disappearing) and the comment at recipes.js:112-113
   shows it was a deliberate tradeoff — just re-confirm that tradeoff still
   holds once the deleter and the affected plan owner can be different
   people.

No other route, in any file, has a missing or incorrect `userId` scope.
`weighins.js`, `plans.js`, and `cart.js` in particular all correctly either
filter directly on `userId` (including inside compound unique keys) or
verify ownership via an explicit lookup before any subsequent ID-based
mutation.

## Summary count

- **SAFE (correctly scoped):** 20 routes — `auth.js` (3: login, logout, me),
  `profile.js` (3), `weighins.js` (4), `plans.js` (6), `cart.js` (4).
- **VULNERABLE (would allow cross-user mutation with no ownership check):**
  2 routes — `recipes.js` `PUT /:id`, `DELETE /:id`.
- **SHARED-BY-DESIGN (intentionally global, flagged for re-review):**
  4 routes — `recipes.js` `GET /`, `foods.js` `GET /`, plus the read-only
  portions of `recipes.js` `POST /generate-drafts` and `POST /save-draft`
  that touch the global `Food`/`Recipe` tables without needing `userId`.
