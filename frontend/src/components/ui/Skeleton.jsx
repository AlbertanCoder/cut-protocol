// Skeleton shimmer — the app's only loading language. Shapes approximate the
// content they stand in for (title line + body lines inside a card), so a
// loading screen reads as the screen it is about to become, not a spinner.
// The shimmer animation lives in index.css (.skeleton) and freezes under
// prefers-reduced-motion.

export const Skeleton = ({ className = "", style }) => (
  <div className={`skeleton ${className}`} style={style} aria-hidden="true" />
);

// A card-shaped placeholder: optional title bar + n body lines.
export const SkeletonCard = ({ lines = 3, title = true, className = "" }) => (
  <div className={`p-5 rounded-2xl glass-card ${className}`} aria-hidden="true">
    {title && <Skeleton className="h-4 w-1/3 mb-4" />}
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${100 - (i % 3) * 18}%` }} />
      ))}
    </div>
  </div>
);

// Row placeholders for lists (recipes, foods, grocery items).
export const SkeletonRows = ({ rows = 4, className = "" }) => (
  <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className="h-9" />
    ))}
  </div>
);
