// app/src/export/exportTheme.ts
// Concrete colors/fonts for the visual export renderers (calendar/cards/kanban/list) and
// the document wrapper. The export document is standalone and carries none of the app's
// `:root` palette vars, so theme tokens (accent/teal/…) and status colors must be resolved
// to literal values here instead of emitting var()/color-mix (which the html2canvas
// rasterizer may drop). The LIVE app palette is read from the DOM at export time
// (resolvePalette.ts) and passed in via ExportOptions; DEFAULT_PALETTE below is the
// headless (CLI) fallback AND the safety net if that DOM probe throws — it embeds an
// inline copy of a NAMED scope's tokens straight from core/src/theme/tokens.ts (design/
// ascii-extended PORTING.md §3d), not a hand-copied literal that can drift from the design
// system. "dark" = the default scope (ink); "light" = paper (the print-friendly light
// scope) — the SAME dark/light → ink/paper mapping core/src/drawing/theme.ts uses, so a
// headless export is deterministic and reproducible regardless of the vault's OWN
// .settings theme (unlike the live in-app path, which mirrors whatever scope is active).
import type { ExportTheme, ThemePalette, PaletteToken } from "./types";
import { CATEGORY_SWATCHES, THEMES, DEFAULT_THEME } from "../themes";

const DARK_SCOPE = DEFAULT_THEME; // "ink"
const LIGHT_SCOPE = "paper";

const DEFAULT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function paletteFromScope(theme: ExportTheme): ThemePalette {
  const t = theme === "light" ? THEMES[LIGHT_SCOPE] : THEMES[DARK_SCOPE];
  // The 7-token category/status palette: accent from the resolved scope, the teal→rose
  // ramp from the ONE fixed source (themes.ts CATEGORY_SWATCHES) so it can't drift from
  // the drawing toolbar / gcal copies — category hues are intentionally scope-invariant.
  const tokens: Record<PaletteToken, string> = { accent: t.accent, ...CATEGORY_SWATCHES };
  return {
    scheme: theme,
    bg: t.background,
    fg: t.foreground,
    muted: t.neutral,
    border: t.border,
    cell: t.surface,
    head: t.surface2,
    accent: t.accent,
    tokens,
    font: DEFAULT_FONT,
  };
}

export const DEFAULT_PALETTE: Record<ExportTheme, ThemePalette> = {
  dark: paletteFromScope("dark"),
  light: paletteFromScope("light"),
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
