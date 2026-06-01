// app/src/icons/iconMarkup.ts
// Static SVG markup for a Lucide icon, for IMPERATIVE call sites that cannot
// dispose a reactive root — notably CodeMirror's `addToOptions` render hook,
// which gives no per-option teardown. We render ONCE into a detached node, read
// the innerHTML, dispose immediately (no leak), and memoize by name+size.
import { lucideIconSpan } from "./iconElement";

const cache = new Map<string, string>();

/** Cached static `<svg>…</svg>` markup for a Lucide name. Empty string if name resolves to text. */
export function lucideIconMarkup(name: string, size = 14): string {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const { el, dispose } = lucideIconSpan(name, size);
  const svg = el.querySelector("svg");
  const markup = svg ? svg.outerHTML : "";
  dispose(); // tear the reactive root down right away — markup is now static
  cache.set(key, markup);
  return markup;
}
