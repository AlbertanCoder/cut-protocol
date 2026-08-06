import { C } from "../../lib/theme.js";
import { foodIconFor } from "../../lib/foodIcon.js";

// A small, offline, privacy-safe "image" for a recipe: a recognizable food icon
// on a neutral tile. No photos means no network calls and no storage, and it
// covers every recipe. Colour-law safe — the tile is a neutral lightness step
// (elevation = lightness) and the icon is faint ink, so it never borrows the
// reserved accent green or the macro-triad hues. The shape does the talking.
export default function FoodTile({ recipe, size = 36 }) {
  const { Icon, label } = foodIconFor(recipe);
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="shrink-0 rounded-xl flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(155deg, ${"var(--secondary)"}, ${"var(--card)"})`,
        border: "1px solid var(--border)",
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} aria-hidden="true" style={{ color: "var(--muted-foreground)" }} />
    </div>
  );
}
