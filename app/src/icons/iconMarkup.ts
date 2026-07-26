// app/src/icons/iconMarkup.ts
// Static markup for an icon glyph, for IMPERATIVE call sites that cannot dispose a reactive
// root — notably CodeMirror's `addToOptions` render hook, which gives no per-option teardown.
// We render ONCE into a detached node (via <Icon>, so this stays in lockstep with registry.ts's
// name->glyph map), read the text out, dispose immediately (no leak), and memoize by name+size.
import { lucideIconSpan } from "./iconElement";
import { escapeHtml } from "../htmlEscape";

const cache = new Map<string, string>();

/** Cached static `<span>…</span>` markup carrying an icon's mapped glyph text, sized to match
 *  <Icon>. Empty string only if the name resolves to no visible text. */
export function lucideIconMarkup(name: string, size = 14): string {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const { el, dispose } = lucideIconSpan(name, size);
  const text = el.textContent ?? "";
  const markup = text
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.85)}px;line-height:1;font-family:var(--ui-font-stack);font-variant-ligatures:none">${escapeHtml(text)}</span>`
    : "";
  dispose(); // tear the reactive root down right away — markup is now static
  cache.set(key, markup);
  return markup;
}
