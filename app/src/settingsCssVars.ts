// app/src/settingsCssVars.ts
// The single place that projects user settings into CSS custom properties on :root.
// Appearance/UI values that are consumed by CSS (fonts, sizes, colors, spacing,
// widths, animation durations) live here as `--var` mappings; the CSS files
// reference them via var(--name, <fallback>). Adding a CSS-driven setting means
// adding one line to settingsToCssVars + one var() reference in the stylesheet.
import { FONT_STACKS, DEFAULT_ACCENT_PALETTE, type Settings } from "./settings";

/** Pure: the full `{ "--var": "value" }` map for the given settings. DOM-free + testable.
 *  The theme color tokens (--bg/--fg/--border/--panel/--text-muted/surfaces/etc.) are all
 *  derived here from the 5 appearance token groups (background, foreground, neutral, accent,
 *  accentPalette) so the entire app + graph share one source of color. App.css :root keeps
 *  only literal fallbacks for first paint. */
export function settingsToCssVars(s: Settings): Record<string, string> {
  const a = s.appearance;
  const palette = a.accentPalette?.length ? a.accentPalette : DEFAULT_ACCENT_PALETTE;
  // --accent-purple drives editor syntax + task accents; use the palette's purple (index 1)
  // so it tracks the centralized palette instead of a stray hardcoded lavender.
  const accentPurple = palette[1] ?? palette[0] ?? a.accent;
  return {
    "--bg": a.background,
    "--fg": a.foreground,
    "--accent": a.accent,
    // Borders/muted/surfaces derive from the neutral (Steel) + foreground via color-mix,
    // matching the prior recipe but now keyed off the editable tokens.
    "--border": `color-mix(in srgb, ${a.neutral} 22%, transparent)`,
    "--text-muted": `color-mix(in srgb, ${a.foreground} 60%, transparent)`,
    "--panel": `color-mix(in srgb, ${a.neutral} 6%, transparent)`,
    "--hover-bg": `color-mix(in srgb, ${a.foreground} 8%, transparent)`,
    "--surface-1": `color-mix(in srgb, ${a.foreground} 5%, transparent)`,
    "--surface-2": `color-mix(in srgb, ${a.foreground} 9%, transparent)`,
    "--surface-3": `color-mix(in srgb, ${a.foreground} 14%, transparent)`,
    "--accent-purple": accentPurple,
    "--editor-font": FONT_STACKS[a.editorFont] ?? a.editorFont,
    "--editor-font-size": a.editorFontSize + "px",
    "--sidebar-width": a.sidebarWidth + "px",
    "--sidebar-graph-height": a.sidebarGraphHeight + "px",
    "--ui-font-size": a.uiFontSize + "px",
    "--tab-font-size": a.tabFontSize + "px",
    "--sidebar-icon-font-size": a.sidebarIconFontSize + "px",
    "--palette-input-font-size": a.paletteInputFontSize + "px",
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
