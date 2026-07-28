// app/src/icons/Icon.tsx
//
// The one component every call site uses to show an icon. Pass a `value` (a
// canonical icon name, the legacy "Li"/"Lu" convention, or an emoji/arbitrary
// glyph) and it renders the mapped art — this is what lets a note's
// `icon: 🪶` keep showing the feather while `icon: House` renders the app's
// own icon for it. Same component API as before the ASCII redesign (value/
// size/class/style/fallback), so the ~100 existing call sites are unchanged;
// only the rendering moved underneath it.
//
// Resolution is synchronous (see registry.ts) — two small static maps, not a
// lazily-loaded manifest — so there's no pending/placeholder state to render
// while a chunk loads. Three cases, in order:
//   1. `value` (or `fallback`) is a known name -> its mapped art: a 24x24
//      pixel-art path, or a typed glyph for the seven surface icons.
//   2. It LOOKS like an icon name but isn't mapped (e.g. a legacy Lucide name
//      from old vault frontmatter) -> the generic fallback glyph, never the
//      literal name text (which would just read as a typo on screen).
//   3. Anything else (an emoji, an arbitrary glyph) -> passed through as-is.
//
// Every icon renders in a fixed `size`x`size` box regardless of case, so
// glyphs/emoji/pixel art line up on the character grid identically.
//
// PIXEL CRISPNESS: the art is drawn on a 24px grid but the app asks for boxes
// of 12-18px, so edges land on fractional device pixels and would antialias
// into mush — which is the whole point of pixel art, lost. `shape-rendering:
// crispEdges` snaps them instead: safe here precisely because every path in
// the set is axis-aligned (see build-pixel-icons.ts), so there are no diagonals
// to turn jagged. This is what lets every existing `size={13}`/`size={14}` call
// site stay exactly as it is.
import { type Component, type JSX } from "solid-js";
import { resolveIcon, looksLikeIconName, FALLBACK_ART, type IconArt } from "./registry";

export interface IconProps {
  /** Icon name (any casing, optional Li/Lu prefix) OR an emoji / arbitrary string. */
  value: string | null | undefined;
  /** Pixel size of the glyph's box (default 16). */
  size?: number;
  /** Accepted for API compatibility with the old SVG-backed Icon; glyphs have no stroke. */
  strokeWidth?: number;
  /** Applied to the glyph's wrapping span. */
  class?: string;
  /** Inline style applied to the glyph's wrapping span. */
  style?: JSX.CSSProperties;
  /** Used when `value` is empty/null (resolved the same way as `value`). */
  fallback?: string;
}

export const Icon: Component<IconProps> = (props) => {
  const spec = () => {
    const v = props.value?.trim();
    return v ? v : props.fallback ?? "";
  };
  const art = (): IconArt => {
    const s = spec();
    const known = resolveIcon(s);
    if (known) return known;
    // A name-shaped spec that isn't mapped reads as an unresolved icon, not a literal glyph —
    // show the generic fallback rather than the (broken-looking) raw name text.
    return looksLikeIconName(s) ? FALLBACK_ART : { kind: "glyph", text: s };
  };
  const size = () => props.size ?? 16;
  return (
    <span
      class={props.class}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        "flex-shrink": 0,
        width: `${size()}px`,
        height: `${size()}px`,
        "font-size": `${Math.round(size() * 0.85)}px`,
        "line-height": 1,
        "font-family": "var(--ui-font-stack)",
        "font-variant-ligatures": "none",
        ...props.style,
      }}
    >
      {(() => {
        const a = art();
        return a.kind === "pixel" ? (
          <svg
            viewBox="0 0 24 24"
            width={size()}
            height={size()}
            fill="currentColor"
            shape-rendering="crispEdges"
            style={{ display: "block" }}
          >
            <path d={a.d} />
          </svg>
        ) : (
          a.text
        );
      })()}
    </span>
  );
};
