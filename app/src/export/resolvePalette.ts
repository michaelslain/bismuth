// app/src/export/resolvePalette.ts
// Read the LIVE app theme into a concrete ThemePalette so the export matches the app.
// Browser-only: the app's CSS vars (--bg/--fg/--accent/--teal/… + the font) are set at
// runtime by settingsCssVars from the active theme + settings, and many resolve through
// color-mix()/var() — which the export doc + html2canvas can't evaluate. So we resolve each
// to a literal rgb()/hex by applying it to a probe element and reading the computed color.
// Headless callers never reach this (they keep DEFAULT_PALETTE).
//
// The probe alone is NOT enough: Chrome serializes the computed value of a color-mix that
// carries alpha (every `color-mix(… X%, transparent)` var — --border/--faint/--panel/…) as
// a CSS Color 4 `color(srgb r g b / a)` function, which html2canvas can't parse either
// ("Attempting to parse an unsupported color function 'color'"). So every probed value is
// additionally normalized to rgb()/rgba() via cssColor.normalizeCssColor.
import { DEFAULT_PALETTE } from "./exportTheme";
import { normalizeCssColor } from "./cssColor";
import { PALETTE_TOKENS } from "../ui/palette";
import type { ExportTheme, ThemePalette, PaletteToken } from "./types";

const TOKENS: PaletteToken[] = [...PALETTE_TOKENS];

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
    const fallback = DEFAULT_PALETTE[scheme];
    // Resolve a CSS color expression (var()/color-mix/hex) to a literal rgb()/rgba() the
    // rasterizer can parse. The probe's computed color may still be a `color(srgb …)`
    // serialization (see header comment) — normalizeCssColor converts it; when even that
    // fails, the given palette default wins so an export never carries an unsafe color.
    const lit = (expr: string, dflt: string): string => {
      probe.style.color = "";
      probe.style.color = expr;
      return normalizeCssColor(getComputedStyle(probe).color || expr, dflt);
    };

    const tokens = Object.fromEntries(
      TOKENS.map((t) => [t, lit(`var(--${t})`, fallback.tokens[t])]),
    ) as Record<PaletteToken, string>;
    const font = getComputedStyle(document.body).fontFamily || DEFAULT_PALETTE[scheme].font;

    const chrome =
      scheme === "dark"
        ? {
            bg: lit("var(--bg)", fallback.bg),
            fg: lit("var(--fg)", fallback.fg),
            muted: lit("var(--faint)", fallback.muted),
            border: lit("var(--border)", fallback.border),
            cell: lit("var(--panel)", fallback.cell),
            head: lit("var(--surface-2)", fallback.head),
          }
        : { bg: fallback.bg, fg: fallback.fg, muted: fallback.muted, border: fallback.border, cell: fallback.cell, head: fallback.head };

    probe.remove();
    return { scheme, ...chrome, accent: tokens.accent, tokens, font };
  } catch {
    return DEFAULT_PALETTE[scheme];
  }
}
