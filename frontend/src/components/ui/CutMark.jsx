import { C } from "../../lib/theme.js";

// The Cut Protocol brand mark: solid athletic-green shield with the six-pack
// carved out. Same geometry as assets/icon/cutprotocol-solid.svg minus the
// charcoal tile — screens place it directly on their own surface.
export default function CutMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-label="Cut Protocol" role="img">
      <path
        d="M 62 46 H 194 Q 202 46 202 54 V 120 Q 202 158 176 182 Q 154 202 128 212 Q 102 202 80 182 Q 54 158 54 120 V 54 Q 54 46 62 46 Z"
        fill={C.accent} stroke={C.accent} strokeWidth="6" strokeLinejoin="round"
      />
      <g fill={C.accentInk}>
        <rect x="75" y="70" width="44" height="30" rx="8" />
        <rect x="137" y="70" width="44" height="30" rx="8" />
        <rect x="75" y="116" width="44" height="30" rx="8" />
        <rect x="137" y="116" width="44" height="30" rx="8" />
        <rect x="85" y="162" width="34" height="22" rx="9" />
        <rect x="137" y="162" width="34" height="22" rx="9" />
      </g>
    </svg>
  );
}
