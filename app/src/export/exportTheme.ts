// app/src/export/exportTheme.ts
// Concrete colors/fonts for the visual export renderers (calendar/cards/kanban/list) and
// the document wrapper. The export document is standalone and carries none of the app's
// `:root` palette vars, so theme tokens (accent/teal/…) and status colors must be resolved
// to literal values here instead of emitting var()/color-mix (which the html2canvas
// rasterizer may drop). The LIVE app palette is read from the DOM at export time
// (resolvePalette.ts) and passed in via ExportOptions; DEFAULT_PALETTE is the headless
// (CLI) fallback and mirrors the default "Oxide" theme from App.css.
import type { ExportTheme, ThemePalette, PaletteToken } from "./types";

// Default 7-token palette (App.css "Oxide" defaults) — the headless fallback.
const DEFAULT_TOKENS: Record<PaletteToken, string> = {
  accent: "#3F6BF0", teal: "#22C6D6", blue: "#5C7BEE", violet: "#8B6CF0",
  green: "#43D49A", gold: "#F2C53D", rose: "#F0509B",
};

const DEFAULT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const DEFAULT_PALETTE: Record<ExportTheme, ThemePalette> = {
  dark: {
    scheme: "dark", bg: "#1e1e22", fg: "#e7e7ea", muted: "#a1a1aa", border: "#3a3a42",
    cell: "#26262c", head: "#2a2a31", accent: DEFAULT_TOKENS.accent, tokens: DEFAULT_TOKENS, font: DEFAULT_FONT,
  },
  light: {
    scheme: "light", bg: "#ffffff", fg: "#1a1a1a", muted: "#52525b", border: "#d8d8dd",
    cell: "#fafafa", head: "#f1f1f3", accent: DEFAULT_TOKENS.accent, tokens: DEFAULT_TOKENS, font: DEFAULT_FONT,
  },
};

/** The palette to render with: a live-theme override (from the DOM) or the default. */
export function paletteFor(theme: ExportTheme, override?: ThemePalette): ThemePalette {
  return override ?? DEFAULT_PALETTE[theme];
}

// Status -> palette token (mirrors ui/StatusDot.STATUS_COLOR, which stores var(--token)
// values that can't render in a standalone export doc).
const STATUS_TOKEN: Record<string, PaletteToken> = {
  reading: "teal", "to read": "blue", toread: "blue",
  finished: "green", done: "green", complete: "green",
  abandoned: "rose", dropped: "rose",
};

/** A stored color string (theme token name, hex, rgb, or named) -> a literal CSS color. */
export function resolveColor(color: string | undefined, p: ThemePalette): string {
  if (!color) return p.accent;
  return (p.tokens as Record<string, string>)[color] ?? color;
}

/** Group/column-header color for a (status-ish) key, resolved to a literal color. */
export function groupColorHex(key: string, p: ThemePalette): string {
  const tok = STATUS_TOKEN[key.trim().toLowerCase()];
  return tok ? p.tokens[tok] : p.accent;
}

export function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A `border-left + faint fill` tint for a category/status color (no color-mix). */
export function tintStyle(color: string | undefined, p: ThemePalette, alpha?: number): string {
  const c = resolveColor(color, p);
  const a = alpha ?? (p.scheme === "dark" ? 0.3 : 0.16);
  const bg = hexToRgba(c, a) ?? "transparent";
  return `border-left:3px solid ${c};background:${bg};`;
}
