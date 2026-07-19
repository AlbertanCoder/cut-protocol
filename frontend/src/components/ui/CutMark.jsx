import { C } from "../../lib/theme.js";

// The Cut Protocol brand mark: athletic-green shield with a fit torso + six-pack
// inside (outline treatment). Same geometry as assets/icon/cutprotocol-outline.svg
// minus the charcoal tile — screens place it directly on their own surface.
export default function CutMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Cut Protocol" role="img">
      <path
        d="M50,9 L83,19 L83,47 C83,68 68,85 50,91 C32,85 17,68 17,47 L17,19 Z"
        fill="none" stroke={C.accent} strokeWidth="5.2" strokeLinejoin="round"
      />
      <path
        d="M39,33 C39,29 43,27 47,27 L53,27 C57,27 61,29 61,33 L56,59 C55,67 52,73 50,73 C48,73 45,67 44,59 Z"
        fill={C.accent}
      />
      <g stroke={C.accentInk} strokeWidth="2.5" strokeLinecap="round" fill="none">
        <path d="M43,35 C47,39 53,39 57,35" />
        <path d="M50,37 L50,67" />
        <path d="M44,45 H56" />
        <path d="M45,53 H55" />
        <path d="M46,61 H54" />
      </g>
    </svg>
  );
}
