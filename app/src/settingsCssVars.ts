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
  // Light themes are the app's first; a handful of dark-assuming structural surfaces
  // (rail, pop-bg, scrim, label-halo, editor pane) branch on this. See LIGHT_THEMES.md Part B.
  const light = !!a.isLight;
  const mix = (a1: string, p: number, a2: string) => `color-mix(in srgb, ${a1} ${p}%, ${a2})`;
  // Graph ramp anchors reused as the design's named chrome accents (teal→blue→violet)
  // and the iridescent gradient — sourced from the palette so they re-tint per theme.
  const teal = palette[0] ?? a.accent;
  const blue = palette[2] ?? palette[1] ?? a.accent;
  const violet = palette[3] ?? palette[2] ?? a.accent;
  return {
    "--bg": a.background,
    "--fg": a.foreground,
    "--accent": a.accent,
    // Base UI colors come straight from the theme (mockup palette): explicit border,
    // surfaces, and muted text. The two extra tints (--surface-3, --hover-bg) the theme
    // doesn't define are derived from the theme's foreground.
    "--border": a.border,
    // Hairline border (design's --border2): one notch softer than --border.
    "--border-soft": `color-mix(in srgb, ${a.foreground} 10%, transparent)`,
    "--text-muted": a.neutral,
    // Tertiary / disabled text (design's --faint): the .4–.5 opacity-on-fg used app-wide.
    "--faint": `color-mix(in srgb, ${a.foreground} 42%, transparent)`,
    "--panel": a.surface,
    "--hover-bg": `color-mix(in srgb, ${a.foreground} 8%, transparent)`,
    "--surface-1": a.surface,
    "--surface-2": a.surface2,
    "--surface-3": `color-mix(in srgb, ${a.foreground} 14%, transparent)`,
    // Sidebar + topbar rail (design's --rail). Dark: a notch under the canvas.
    // Light: the design's #EAE7F3 — bg pulled toward the border so the rail reads
    // as a distinct surface, not the flat near-canvas wash a surface2-mix produced.
    // (mix(bg 70%, border) lands on #EBE8F3 for oxide-light ≈ the design value.)
    "--rail": light ? mix(a.background, 70, a.border) : mix(a.background, 88, "#000"),
    // Editor / main pane (design's --editor): canvas on dark, lifted toward white on
    // light. mix(surface 64%, bg) ≈ the design's #FAF8FD for oxide-light.
    "--editor": light ? mix(a.surface, 64, a.background) : a.background,
    // Popover / floating-card surfaces (legends, graph cards, structure picker).
    "--pop-bg": light ? mix(a.surface, 84, "transparent") : mix(a.background, 82, "transparent"),
    "--pop-bg-strong": light ? mix(a.surface, 90, "transparent") : mix(a.background, 88, "transparent"),
    // Modal scrim (command/quick/template overlays). Light: a soft lavender-grey veil
    // from the theme's neutral (design's rgba(120,110,150,.32) ≈ oxide-light neutral),
    // NOT the heavy near-black a foreground-tint gave. Dark: fg-tinted veil.
    "--scrim-bg": light ? mix(a.neutral, 32, "transparent") : mix(a.foreground, 62, "transparent"),
    // Graph hub-label halo: near-black on dark, the design's translucent white on light.
    "--label-halo": light ? mix("#fff", 90, "transparent") : "#05060a",
    // Graph canvas radial (design's --graph-bg): a soft lavender wash on light, the deep ink
    // well on dark. Used by the agents-mode backdrop + the depth vignette. Light center lifts
    // toward white, the edge settles toward the border (oxide-light ≈ design #F3F0FA → #E6E2F2);
    // dark keeps the near-black well. This is what stops the agents view going half-black on light.
    "--graph-bg": light
      ? `radial-gradient(120% 90% at 50% 30%, ${mix("#fff", 60, a.background)} 0%, ${mix(a.background, 50, a.border)} 72%)`
      : `radial-gradient(120% 90% at 50% 30%, ${a.background} 0%, ${mix(a.background, 60, "#000")} 72%)`,
    // Depth-vignette edge color: fade toward the lavender border on light (a gentle deepening),
    // toward black on dark. The vignette overlay (.graph-vignette) blends from transparent to this.
    "--vignette-edge": light ? mix(a.background, 50, a.border) : mix(a.background, 70, "#000"),
    // Graph edges + node tints.
    "--graph-edge": mix(a.foreground, 18, "transparent"),
    "--node-cold": mix(a.foreground, 24, a.background),
    "--node-self": a.foreground,
    // Terminal stays a dark ink panel in BOTH modes (intentional per LIGHT_THEMES.md).
    "--term-bg": light ? "#2B2740" : "#08090E",
    "--term-fg": light ? "#E3DEF2" : "#C7CCE0",
    // Bases offline map surfaces.
    "--map-sea": a.surface2,
    "--map-land": a.surface,
    "--map-coast": mix(a.accent, 45, a.surface),
    "--map-grid": mix(a.foreground, 12, "transparent"),
    "--accent-purple": accentPurple,
    // Accent tint background (selected tab / row) + text color on a solid accent fill.
    "--accent-soft": `color-mix(in srgb, ${a.accent} 14%, transparent)`,
    // Text on a solid accent fill (selected tab, primary button). The light themes use
    // mid-tone accents, so white reads where the dark themes' near-black ink does
    // (matches the design's --on-accent: #fff on light / #08101F on dark).
    "--on-accent": light ? "#fff" : "#08101F",
    // Named chrome accents + iridescent gradient (built from the graph ramp).
    "--teal": teal,
    "--blue": blue,
    "--violet": violet,
    "--grad": `linear-gradient(120deg, ${teal}, ${blue}, ${violet})`,
    // Graph ramp exposed positionally for canvas/legend/tag consumers.
    "--graph-0": palette[0] ?? a.accent,
    "--graph-1": palette[1] ?? a.accent,
    "--graph-2": palette[2] ?? a.accent,
    "--graph-3": palette[3] ?? a.accent,
    "--graph-4": palette[4] ?? a.accent,
    // Category hues (statuses / event categories / map pins / chart series). These are the
    // preset category swatches, so they MUST derive from the theme's accent ramp — that way a
    // category that stores one of these tokens auto-recolors when the theme changes (only
    // custom hex colours stay fixed). A theme may still pin a specific hue via ColorTokens;
    // otherwise every swatch comes straight from the palette, for dark and light alike.
    "--green": a.categoryGreen ?? (palette[1] ?? a.accent),
    "--gold": a.categoryGold ?? (palette[4] ?? palette[3] ?? a.accent),
    "--rose": a.categoryRose ?? (palette[3] ?? a.accent),
    "--editor-font": FONT_STACKS[s.appearance.editorFont] ?? s.appearance.editorFont,
    "--editor-font-size": s.appearance.editorFontSize + "px",
    "--sidebar-width": s.appearance.sidebarWidth + "px",
    "--sidebar-graph-height": s.appearance.sidebarGraphHeight + "px",
    "--ui-font-size": s.appearance.uiFontSize + "px",
    "--mono-scale": String(s.appearance.monoScale),
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

/** Apply a precomputed `{ "--var": "value" }` map to the document root. No-op outside the
 *  DOM. Split out so callers that also cache the map (for the pre-bundle theme script) can
 *  compute it once. The inline script in index.html applies the SAME map shape from cache. */
export function setCssVars(vars: Record<string, string>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Apply the derived CSS vars to the document root. No-op outside the DOM.
 *  Also sets `color-scheme` from the theme so native form controls + scrollbars
 *  match light/dark themes. */
export function applyCssVars(s: Settings): void {
  setCssVars(settingsToCssVars(s));
  if (typeof document !== "undefined") {
    document.documentElement.style.colorScheme = resolveAppearance(s.appearance).isLight ? "light" : "dark";
  }
}
