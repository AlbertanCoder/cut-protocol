# Image provenance — an image without a line here does not ship

Per CUT_PROTOCOL_DIRECTIVE.md §6.4. Enforced by
`backend/tests/imageProvenance.test.js`, which scans every shipped image
surface (`frontend/public/`, `assets/icon/`, `CutProtocol.ico`) and fails
the build on any image file whose name is absent from this document.

## Rules (§6, restated as law)

1. **Never scrape.** No Google Images, no hotlinking, no "found it online."
2. v1 recipe visuals are the **deterministic first-party illustration
   system**: `frontend/src/lib/foodIcon.js` (keyword taxonomy → dish
   category) rendering `frontend/src/components/ui/FoodTile.jsx` glyphs from
   `frontend/public/icons.svg`. Code, not assets; consistent by construction.
3. Openly licensed photos may be layered in ONLY with the licence recorded
   here and the photo honestly depicting the dish.
4. **TheMealDB photos are an OWNER DECISION, not taken:** 602 of 910 legacy
   recipes match TheMealDB (verified via a full local index, 2026-08-19
   handoff), but their licence requires the paid tier (~CA$16/month) with
   attribution for a commercial product — and 308 recipes could never have a
   photo, so the treatment of a ⅔-photos grid has to be decided first.
   Nothing is downloaded, nothing is hotlinked.

## Shipped images

| File | What it is | Source & licence |
|---|---|---|
| `CutProtocol.ico` | App/installer icon (shield mark, 6 sizes) | First-party, drawn in-repo 2026-07-18 (Phase 6) from the SVG masters below |
| `assets/icon/cutprotocol-outline.svg` | Brand mark master, ≥48 px | First-party original work |
| `assets/icon/cutprotocol-solid.svg` | Brand mark master, ≤32 px | First-party original work |
| `assets/icon/png/icon-16.png` … `icon-512.png` (9 files) | Rendered icon set | First-party, rendered from the masters |
| `assets/social-preview.png` | GitHub social card | First-party (shield + wordmark) |
| `frontend/public/favicon.svg` | Favicon | First-party, from the solid master |
| `frontend/public/icons.svg` | UI + dish-category glyph sheet (the v1 recipe illustration system) | First-party original work |

## Repo-only image classes (not shipped; listed by class, not per file)

- `screenshots/`, `docs/design/v2/`, `docs/audit/**/screenshots`,
  `docs/qc/**/ui/` — first-party captures of this app's own UI.
- `docs/design/logo-2026-08/` — first-party logo exploration (85 marks).
  The 19 third-party competitor reference assets that briefly lived at
  `candidates/_ref/` were **removed from history before any push**
  (commit amend, 2026-08-19); the files exist only untracked on the
  owner's disk as private research.

## Adding an image (the only procedure)

Source it cleanly → add the file → add its row here (source AND licence) →
the provenance test passes. In that order; the test exists to make the
reverse order fail.
