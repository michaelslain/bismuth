// Category colours can be either a THEME TOKEN (one of the palette vars) or any
// custom CSS colour (a hex from the picker). Storing the bare token — not the
// resolved hex — means a category recolours itself automatically when the theme
// changes, because it renders through `var(--token)`.

/** Palette tokens a category colour may reference. Each maps to a `--<token>` CSS var. */
export const THEME_SWATCHES = ["accent", "teal", "blue", "violet", "green", "gold", "rose"] as const;
export type ThemeSwatch = (typeof THEME_SWATCHES)[number];

export function isThemeToken(color: string | undefined): color is ThemeSwatch {
  return !!color && (THEME_SWATCHES as readonly string[]).includes(color);
}

/**
 * A stored category colour → a CSS colour value usable in `background`/`color`.
 * Theme tokens become `var(--token)` (so they track the active theme); anything
 * else (hex, rgb(), named) passes through unchanged. Undefined falls back to accent.
 */
export function resolveCategoryColor(color: string | undefined): string {
  if (!color) return "var(--accent)";
  return isThemeToken(color) ? `var(--${color})` : color;
}

/**
 * Resolve to a concrete hex string for the native `<input type="color">` value
 * (which can't display `var(...)`). For theme tokens this reads the live computed
 * var off :root; custom colours pass through.
 */
export function categoryColorHex(color: string | undefined): string {
  if (isThemeToken(color)) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${color}`).trim();
    return v || "#888888";
  }
  return color && color.startsWith("#") ? color : "#888888";
}

// ── Multi-category support ────────────────────────────────────────────────────
// An event may belong to several categories. `categories` (array) is authoritative
// when present; otherwise the legacy single `category` field is used. This keeps
// old single-category events working unchanged.

interface CategoryLike {
  name: string;
  color: string;
}
interface EventLike {
  category?: string;
  categories?: string[];
}

/** The ordered list of category NAMES an event belongs to (prefers the array). */
export function eventCategoryNames(event: EventLike): string[] {
  if (event.categories && event.categories.length) return event.categories;
  return event.category ? [event.category] : [];
}

/**
 * The ordered list of resolved CSS colours for an event's categories — one per
 * category that resolves to a known category definition (unknown names dropped).
 */
export function eventCategoryColors(event: EventLike, categories: CategoryLike[]): string[] {
  return eventCategoryNames(event)
    .map((name) => categories.find((c) => c.name === name)?.color)
    .filter((c): c is string => c != null)
    .map(resolveCategoryColor);
}

/**
 * Turn an ordered list of resolved category colours into a CSS `background` value:
 *  - 0 colours → `undefined` (caller renders an outline-only ghost)
 *  - 1 colour  → a solid tint (85% mix, matching the historical single-category look)
 *  - 2+ colours → a linear-gradient blending each colour across the block
 */
export function categoryFill(colors: string[]): string | undefined {
  if (colors.length === 0) return undefined;
  const tint = (c: string) => `color-mix(in srgb, ${c} 85%, transparent)`;
  if (colors.length === 1) return tint(colors[0]);
  const stops = colors.map((c, i) => `${tint(c)} ${(i / (colors.length - 1)) * 100}%`);
  return `linear-gradient(135deg, ${stops.join(", ")})`;
}

/** Convenience: resolve an event straight to its `background` fill (or undefined). */
export function eventCategoryFill(event: EventLike, categories: CategoryLike[]): string | undefined {
  return categoryFill(eventCategoryColors(event, categories));
}
