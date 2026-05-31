// app/src/settingsCssVars.ts
// The single place that projects user settings into CSS custom properties on :root.
// Appearance/UI values that are consumed by CSS (fonts, sizes, colors, spacing,
// widths, animation durations) live here as `--var` mappings; the CSS files
// reference them via var(--name, <fallback>). Adding a CSS-driven setting means
// adding one line to settingsToCssVars + one var() reference in the stylesheet.
import { FONT_STACKS, type Settings } from "./settings";

/** Pure: the full `{ "--var": "value" }` map for the given settings. DOM-free + testable. */
export function settingsToCssVars(s: Settings): Record<string, string> {
  const a = s.appearance;
  return {
    "--accent": a.accent,
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

/** Apply the CSS vars + the data-theme attribute to document root. No-op outside the DOM. */
export function applyCssVars(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", s.appearance.theme);
  const vars = settingsToCssVars(s);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
