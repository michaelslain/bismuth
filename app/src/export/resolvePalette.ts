// app/src/export/resolvePalette.ts
// Read the LIVE app theme into a concrete ThemePalette so the export matches the app.
// Browser-only: the app's CSS vars (--bg/--fg/--accent/--teal/… + the font) are set at
// runtime by settingsCssVars from the active theme + settings, and many resolve through
// color-mix()/var() — which the export doc + html2canvas can't evaluate. So we resolve each
// to a literal rgb()/hex by applying it to a probe element and reading the computed color.
// Headless callers never reach this (they keep DEFAULT_PALETTE).
import { DEFAULT_PALETTE } from "./exportTheme";
import type { ExportTheme, ThemePalette, PaletteToken } from "./types";

const TOKENS: PaletteToken[] = ["accent", "teal", "blue", "violet", "green", "gold", "rose"];

/**
 * Resolve the current app theme to a palette. `scheme === "dark"` mirrors the app's actual
 * chrome (bg/fg/border read live); `scheme === "light"` keeps the live accent/category
 * tokens + font but swaps in light "paper" chrome (a print-friendly variant).
 */
export function readThemePalette(scheme: ExportTheme): ThemePalette {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return DEFAULT_PALETTE[scheme];
  }
  try {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0";
    document.body.appendChild(probe);
    // Resolve a CSS color expression (var()/color-mix/hex) to a literal rgb() string.
    const lit = (expr: string): string => {
      probe.style.color = "";
      probe.style.color = expr;
      return getComputedStyle(probe).color || expr;
    };

    const tokens = Object.fromEntries(TOKENS.map((t) => [t, lit(`var(--${t})`)])) as Record<PaletteToken, string>;
    const font = getComputedStyle(document.body).fontFamily || DEFAULT_PALETTE[scheme].font;
    const fallback = DEFAULT_PALETTE[scheme];

    const chrome =
      scheme === "dark"
        ? {
            bg: lit("var(--bg)"),
            fg: lit("var(--fg)"),
            muted: lit("var(--faint)"),
            border: lit("var(--border)"),
            cell: lit("var(--panel)"),
            head: lit("var(--surface-2)"),
          }
        : { bg: fallback.bg, fg: fallback.fg, muted: fallback.muted, border: fallback.border, cell: fallback.cell, head: fallback.head };

    probe.remove();
    return { scheme, ...chrome, accent: tokens.accent, tokens, font };
  } catch {
    return DEFAULT_PALETTE[scheme];
  }
}
