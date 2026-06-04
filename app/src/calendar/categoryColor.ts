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
