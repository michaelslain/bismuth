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
// Resolution is synchronous (see registry.ts) — one static map of numbers, not a
// lazily-loaded manifest — so there's no pending/placeholder state to render
// while a chunk loads. Three cases, in order:
//   1. `value` (or `fallback`) is a known name -> its Nerd Font glyph.
//   2. It LOOKS like an icon name but isn't mapped (e.g. a legacy Lucide name
//      from old vault frontmatter) -> the generic fallback glyph, never the
//      literal name text (which would just read as a typo on screen).
//   3. Anything else (an emoji, an arbitrary glyph) -> passed through as-is.
//
// EVERY ICON IS NOW ONE CHARACTER FROM ONE FACE. The pixel-art SVG branch is
// gone with pixelPaths.ts, and so are the ASCII marks that used to sit over it.
// What survives from that era, and MUST survive: cases 2 and 3 above still hand
// this component arbitrary-length text — an emoji, or a raw string — so the box
// still has to cope with more than one character. That is what `isWide` is for.
// Deleting it would re-open the bug this whole migration started from: a
// three-character glyph wrapped to a second row inside a one-row box, and the
// chat Stop button rendered as a bracket pair split by a line break.
//
// Every icon renders in a `size`x`size` box (widening only for multi-character
// pass-through text), so glyphs and emoji line up on the character grid.
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
  /** A MULTI-character typed glyph — "[ ]", "[x]", "<<", ">>", ".*", "Aa", "[W]", "><", "][" and
   *  the two folder marks. Twelve of registry.ts's entries are these ASCII marks rather than single
   *  characters, and they are the case this file's "fixed size x size box" invariant never handled.
   *
   *  Three characters at 0.85 x size need about 1.6 x size of width, so inside a box one row tall
   *  they wrapped to a SECOND ROW: the chat Stop button rendered as a bracket pair split by a line
   *  break (measured: scrollHeight 27 inside a clientHeight 20 box). Two fixes were possible and the
   *  first one was wrong — scaling font-size down to fit took `[ ]` to 7px at a 13px icon, trading
   *  a broken glyph for an illegible one. So the BOX grows instead: an N-cell ASCII mark is honestly
   *  N cells wide, the type stays at full size, and the character grid still lines up because the
   *  width lands on a whole number of cells. Height is untouched, so rows never shift. */
  const isWide = () => [...art().text].length > 1;
  return (
    <span
      class={props.class}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        "flex-shrink": 0,
        ...(isWide() ? { "min-width": `${size()}px` } : { width: `${size()}px` }),
        height: `${size()}px`,
        "font-size": `${Math.round(size() * 0.85)}px`,
        "line-height": 1,
        "white-space": "nowrap",
        // NOT --ui-font-stack. That one follows the user's `appearance.uiFont` choice (settings.ts
        // FONT_STACKS offers five Monaspace variants), and NONE of them contain these glyphs — so
        // inheriting it would blank every icon in the app the moment someone changed their UI font.
        // Icons ride their own face, declared once in styles/icons.css.
        "font-family": "var(--icon-font-stack)",
        "font-variant-ligatures": "none",
        ...props.style,
      }}
    >
      {art().text}
    </span>
  );
};
