import type { ThemeColors } from "./model";

/** Resolve the document paper/ink colors for a theme. Mirrors App.css --bg/--fg. */
export function themeColors(theme: "dark" | "light"): ThemeColors {
  return theme === "light" ? { bg: "#fbfbfa", fg: "#1b1b1f" } : { bg: "#0e0e11", fg: "#e8e8ea" };
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
