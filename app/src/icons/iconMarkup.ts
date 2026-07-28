// app/src/icons/iconMarkup.ts
// Static markup for an icon, for IMPERATIVE call sites that cannot dispose a reactive root —
// notably CodeMirror's `addToOptions` render hook, which gives no per-option teardown.
//
// This builds the markup straight from the registry rather than mounting <Icon> into a detached
// node and reading it back: that trick only ever worked because an icon was pure text, and an
// icon can now be a pixel-art <svg> (whose `textContent` is empty). Keeping the two in lockstep
// is instead a matter of mirroring Icon.tsx's box styles — see the shared constants below.
// Results are memoized by name+size.
import { resolveIcon, looksLikeIconName, FALLBACK_ART } from "./registry";
import { escapeHtml, escapeAttr } from "../htmlEscape";

const cache = new Map<string, string>();

/** The `<Icon>` box, as an inline style string (same declarations, same order). */
const boxStyle = (size: number): string =>
  `display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;` +
  `font-size:${Math.round(size * 0.85)}px;line-height:1;font-family:var(--ui-font-stack);font-variant-ligatures:none`;

/** Cached static `<span>…</span>` markup for an icon, sized and rendered to match <Icon> —
 *  a pixel-art `<svg>` or a typed glyph. Empty string only if the name resolves to nothing. */
export function lucideIconMarkup(name: string, size = 14): string {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const art = resolveIcon(name) ?? (looksLikeIconName(name) ? FALLBACK_ART : { kind: "glyph" as const, text: name });
  const inner =
    art.kind === "pixel"
      ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" shape-rendering="crispEdges" style="display:block"><path d="${escapeAttr(art.d)}"/></svg>`
      : escapeHtml(art.text);

  const markup = inner ? `<span style="${boxStyle(size)}">${inner}</span>` : "";
  cache.set(key, markup);
  return markup;
}
