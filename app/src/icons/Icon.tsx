// app/src/icons/Icon.tsx
//
// The one component every call site uses to show an icon. Pass a `value` (a
// canonical icon name, the legacy "Li"/"Lu" convention, or an emoji/arbitrary
// glyph) and it renders the mapped typed glyph — this is what lets a note's
// `icon: 🪶` keep showing the feather while `icon: House` renders the app's
// own glyph for it. Same component API as before the ASCII redesign (value/
// size/class/style/fallback), so the ~100 existing call sites are unchanged;
// only the rendering (SVG -> typed glyph, design/ascii/README.md
// "Iconography") moved underneath it.
//
// Resolution is synchronous (see registry.ts) — a small static name->glyph
// map, not a lazily-loaded manifest — so there's no pending/placeholder state
// to render while a chunk loads. Three cases, in order:
//   1. `value` (or `fallback`) is a known name -> its mapped glyph.
//   2. It LOOKS like an icon name but isn't mapped (e.g. a legacy Lucide name
//      from old vault frontmatter) -> the generic fallback glyph, never the
//      literal name text (which would just read as a typo on screen).
//   3. Anything else (an emoji, an arbitrary glyph) -> passed through as-is.
//
// Every icon renders in a fixed `size`x`size` box regardless of case, so
// glyphs/emoji line up on the character grid the same way an SVG icon used to.
import { type Component, type JSX } from "solid-js";
import { resolveIcon, looksLikeIconName, FALLBACK_GLYPH } from "./registry";

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
  const glyph = () => {
    const s = spec();
    const known = resolveIcon(s);
    if (known) return known;
    // A name-shaped spec that isn't mapped reads as an unresolved icon, not a literal glyph —
    // show the generic fallback rather than the (broken-looking) raw name text.
    return looksLikeIconName(s) ? FALLBACK_GLYPH : s;
  };
  return (
    <span
      class={props.class}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        "flex-shrink": 0,
        width: `${props.size ?? 16}px`,
        height: `${props.size ?? 16}px`,
        "font-size": `${Math.round((props.size ?? 16) * 0.85)}px`,
        "line-height": 1,
        "font-family": "var(--ui-font-stack)",
        "font-variant-ligatures": "none",
        ...props.style,
      }}
    >
      {glyph()}
    </span>
  );
};
