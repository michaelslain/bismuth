import type { ThemeColors } from "./model";
import { THEMES, DEFAULT_THEME } from "../theme/tokens";

// Which named theme supplies the paper/ink for each coarse light/dark bucket the drawing
// callers pass (headless export + canvas both work in "dark"|"light", not a theme name).
const LIGHT_THEME = "oxide-duotone-light";

/** Resolve the document paper/ink colors for a theme bucket, sourced from the color source
 *  of truth (core/src/theme/tokens.ts) so a drawing's paper + default ink track the app theme
 *  instead of a hand-copied literal that had drifted from it. */
export function themeColors(theme: "dark" | "light"): ThemeColors {
  const t = theme === "light" ? THEMES[LIGHT_THEME] : THEMES[DEFAULT_THEME];
  return { bg: t.background, fg: t.foreground };
}

/** "fg" => theme ink; any explicit hex passes through. */
export function makeColorResolver(t: ThemeColors): (c: string) => string {
  return (c) => (c === "fg" ? t.fg : c);
}

const _gridCache = new Map<string, string>();

/** Grid/line wash = the ink color at low alpha (rgba), matching App.css surfaces. */
export function gridColor(t: ThemeColors): string {
  const cached = _gridCache.get(t.fg);
  if (cached) return cached;
  const h = t.fg.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const out = `rgba(${r},${g},${b},0.14)`;
  _gridCache.set(t.fg, out);
  return out;
}
