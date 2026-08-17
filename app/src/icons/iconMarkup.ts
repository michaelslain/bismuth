// app/src/icons/iconMarkup.ts
// Static markup for an icon, for IMPERATIVE call sites that cannot dispose a reactive root —
// notably CodeMirror's `addToOptions` render hook, which gives no per-option teardown.
//
// This builds the markup straight from the registry rather than mounting <Icon> into a detached node
// and reading it back. Since every icon is now a single character that would once again be possible,
// but it is still the wrong trade: reading back `textContent` loses the box styles, and those are
// exactly what has to match. So the box is MIRRORED from Icon.tsx instead — see boxStyle, and keep
// the two in lockstep. Results are memoized by name+size.
import { resolveIcon, looksLikeIconName, FALLBACK_ART } from "./registry";
import { escapeHtml } from "../htmlEscape";

const cache = new Map<string, string>();

/** The `<Icon>` box, as an inline style string. Mirrors Icon.tsx's declarations, including the two
 *  that exist for multi-character text: `white-space: nowrap` and the min-width-instead-of-width
 *  swap. Case 3 of Icon.tsx's contract (an emoji or arbitrary string passed straight through) reaches
 *  this function too, so dropping them here would wrap a two-character glyph to a second row in
 *  CodeMirror's autocomplete while the same icon rendered correctly everywhere else.
 *
 *  `--icon-font-stack`, NOT `--ui-font-stack`: the latter follows the user's `appearance.uiFont`
 *  choice and none of those faces contain these glyphs. */
const boxStyle = (size: number, wide: boolean): string =>
  `display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;` +
  `${wide ? `min-width:${size}px` : `width:${size}px`};height:${size}px;` +
  `font-size:${Math.round(size * 0.85)}px;line-height:1;white-space:nowrap;` +
  `font-family:var(--icon-font-stack);font-variant-ligatures:none`;

/** Cached static `<span>…</span>` markup for an icon, sized and rendered to match <Icon>.
 *  Empty string only if the name resolves to nothing. */
export function lucideIconMarkup(name: string, size = 14): string {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const art = resolveIcon(name) ?? (looksLikeIconName(name) ? FALLBACK_ART : { kind: "glyph" as const, text: name });
  const inner = escapeHtml(art.text);
  const markup = inner ? `<span style="${boxStyle(size, [...art.text].length > 1)}">${inner}</span>` : "";
  cache.set(key, markup);
  return markup;
}
