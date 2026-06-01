// app/src/settingsCssVars.ts
// The single place that projects user settings into CSS custom properties on :root.
// Appearance/UI values that are consumed by CSS (fonts, sizes, colors, spacing,
// widths, animation durations) live here as `--var` mappings; the CSS files
// reference them via var(--name, <fallback>). Adding a CSS-driven setting means
// adding one line to settingsToCssVars + one var() reference in the stylesheet.
import { FONT_STACKS, DEFAULT_ACCENT_PALETTE, type Settings } from "./settings";
import { resolveAppearance } from "./themes";

/** Pure: the full `{ "--var": "value" }` map for the given settings. DOM-free + testable.
 *  The color tokens (--bg/--fg/--border/--panel/--text-muted/surfaces/etc.) all come from
 *  the selected Bismuth theme (app/src/themes.ts), which carries the full base palette —
 *  background, surfaces, border, text, muted, accent, and the graph node ramp — so the whole
 *  app + graph share one source of color. App.css :root keeps only literal first-paint fallbacks. */
export function settingsToCssVars(s: Settings): Record<string, string> {
  const a = resolveAppearance(s.appearance);
  const palette = a.accentPalette?.length ? a.accentPalette : DEFAULT_ACCENT_PALETTE;
  // --accent-purple drives editor syntax + task accents; use the palette's purple (index 1)
  // so it tracks the theme's graph ramp instead of a stray hardcoded lavender.
  const accentPurple = palette[1] ?? palette[0] ?? a.accent;
  return {
    "--bg": a.background,
    "--fg": a.foreground,
    "--accent": a.accent,
    // Base UI colors come straight from the theme (mockup palette): explicit border,
    // surfaces, and muted text. The two extra tints (--surface-3, --hover-bg) the theme
    // doesn't define are derived from the theme's foreground.
    "--border": a.border,
    "--text-muted": a.neutral,
    "--panel": a.surface,
    "--hover-bg": `color-mix(in srgb, ${a.foreground} 8%, transparent)`,
    "--surface-1": a.surface,
    "--surface-2": a.surface2,
    "--surface-3": `color-mix(in srgb, ${a.foreground} 14%, transparent)`,
    "--accent-purple": accentPurple,
    "--editor-font": FONT_STACKS[s.appearance.editorFont] ?? s.appearance.editorFont,
    "--editor-font-size": s.appearance.editorFontSize + "px",
    "--sidebar-width": s.appearance.sidebarWidth + "px",
    "--sidebar-graph-height": s.appearance.sidebarGraphHeight + "px",
    "--ui-font-size": s.appearance.uiFontSize + "px",
    "--tab-font-size": s.appearance.tabFontSize + "px",
    "--sidebar-icon-font-size": s.appearance.sidebarIconFontSize + "px",
    "--palette-input-font-size": s.appearance.paletteInputFontSize + "px",
    "--palette-top-offset": s.ui.paletteTopOffset,
    "--pane-divider-width": s.ui.paneDividerWidth + "px",
    "--prose-line-height": String(s.editor.lineHeight),
    "--month-cell-min-h": s.calendar.monthCellMinHeight + "px",
    "--time-gutter-width": s.calendar.timeGutterWidth + "px",
    "--term-cursor-width": s.terminal.cursorWidth + "px",
    "--term-cursor-glide": s.terminal.cursorGlideMs + "ms",
    "--term-cursor-blink": s.terminal.cursorBlinkSeconds + "s",
    "--card-grid-min": s.ui.cardGridMinWidth + "px",
    "--kanban-col-min": s.ui.kanbanColumnMinWidth + "px",
    "--kanban-col-max": s.ui.kanbanColumnMaxWidth + "px",
    "--map-min-height": s.ui.mapMinHeight + "px",
  };
}

/** Apply the derived CSS vars to the document root. No-op outside the DOM.
 *  (Dark-only: there is no longer a data-theme attribute / light mode.) */
export function applyCssVars(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = settingsToCssVars(s);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
