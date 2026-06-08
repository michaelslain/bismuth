# Themes & Palette System

This document covers every named Bismuth theme, how the `appearance` settings section maps to CSS custom properties on `:root`, the graph accent palette, and the editor font choices. The theme system is the **single source of color** for the entire app: selecting a theme recolors the canvas, surfaces, border, text, accent, graph nodes, terminal, and category swatches from one place, with no per-color overrides. All logic lives in `app/src/themes.ts` (token definitions) and `app/src/settingsCssVars.ts` (CSS projection).

---

## Theme Names

The setting is `appearance.theme` in `settings.yaml`. The schema enum lists 12 names; the first is the default.

```yaml
appearance:
  theme: oxide-duotone   # default
```

### Dark Themes

| Setting value | Display name |
|---|---|
| `oxide-duotone` | Oxide Duotone *(default)* |
| `gunmetal-teal` | Gunmetal · Teal |
| `rose-gold` | Rose-Gold Metal |
| `indigo-oxide` | Indigo Oxide |
| `forest-oxide` | Forest Oxide |
| `full-sheen` | Gunmetal · Full Sheen |

### Light Themes

| Setting value | Display name |
|---|---|
| `oxide-duotone-light` | Oxide Duotone · Light |
| `gunmetal-teal-light` | Gunmetal · Teal · Light |
| `rose-gold-light` | Rose-Gold · Light |
| `indigo-oxide-light` | Indigo Oxide · Light |
| `forest-oxide-light` | Forest Oxide · Light |
| `full-sheen-light` | Gunmetal · Full Sheen · Light |

The `THEME_NAMES` array in `themes.ts` is the ordered authoritative list; the first entry (`oxide-duotone`) is both the schema default and the `DEFAULT_THEME` constant used by `resolveTheme()` when an unknown name is provided.

---

## ColorTokens Interface

Every theme resolves to a `ColorTokens` object. These are the raw hex values that feed into CSS var derivation:

```ts
interface ColorTokens {
  background: string;      // canvas / --bg
  foreground: string;      // text / --fg
  neutral: string;         // muted text + graph edges / --text-muted
  accent: string;          // --accent
  border: string;          // --border
  surface: string;         // --surface-1 / --panel
  surface2: string;        // --surface-2
  accentPalette: string[]; // graph node ramp (5–6 entries)
  isLight?: boolean;       // true for all *-light themes; drives light/dark branching
  categoryGreen?: string;  // --green (optional override; defaults to palette[1])
  categoryGold?: string;   // --gold (optional override; defaults to palette[4] ?? palette[3])
  categoryRose?: string;   // --rose (optional override; defaults to palette[3])
}
```

The `isLight` flag is only present (and `true`) on light themes. Its absence is treated as `false`. It drives several structural surfaces that branch differently between dark and light (rail, pop-bg, scrim, label-halo, editor surface, graph background gradient).

---

## Per-Theme Color Values

### oxide-duotone (dark, default)

```
background:    #0D0E16
foreground:    #E7E8F2
neutral:       #888EA8
accent:        #5E8DE6
border:        #2A2E45
surface:       #161827
surface2:      #1E2133
accentPalette: ["#22C6D6", "#3F9BE6", "#5C7BEE", "#8B6CF0", "#B16AD6"]
```

### gunmetal-teal (dark)

```
background:    #0E1014
foreground:    #E6E9EF
neutral:       #878F9E
accent:        #27C2D1
border:        #2A303C
surface:       #161922
surface2:      #1E2330
accentPalette: ["#2FD4BE", "#27C2D1", "#39A8E6", "#5C8DEF", "#6FE0A0"]
```

### rose-gold (dark)

```
background:    #15110F
foreground:    #F1EAE5
neutral:       #A99A8F
accent:        #E1748F
border:        #382E29
surface:       #201917
surface2:      #2A221E
accentPalette: ["#F2C24A", "#F0A055", "#EC7E6A", "#E1748F", "#E06AB0"]
```

### indigo-oxide (dark)

```
background:    #0C0E1A
foreground:    #E7E9F6
neutral:       #868DAE
accent:        #5C6CF2
border:        #262B47
surface:       #151829
surface2:      #1D2138
accentPalette: ["#6FA0FF", "#5C6CF2", "#7B5CF0", "#9B5CE8", "#56AEEA"]
```

### forest-oxide (dark)

```
background:    #0D120F
foreground:    #E6EDE7
neutral:       #8B9A8E
accent:        #3FB87C
border:        #2B362D
surface:       #161E18
surface2:      #1F2921
accentPalette: ["#43C586", "#2FB89A", "#7FD68A", "#9CC24F", "#C9A23E"]
```

### full-sheen (dark)

```
background:    #0E0F12
foreground:    #EBEDF0
neutral:       #878D97
accent:        #27C2D1
border:        #262931
surface:       #16181D
surface2:      #1E2128
accentPalette: ["#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"]
```

Note: `full-sheen` uses the six-entry `SHEEN` palette — the only theme with 6 graph colors instead of 5.

### oxide-duotone-light

```
background:    #F1EFF7
foreground:    #322D49
neutral:       #7A7393
accent:        #7A86DE    (palette index 2, not a saturated guess)
border:        #DCD7EB
surface:       #FFFFFF
surface2:      #EEEBF7
accentPalette: ["#3FB6C4", "#6FA6E6", "#7A86DE", "#A98FE0", "#C08FD8"]
isLight:       true
```

### gunmetal-teal-light

```
background:    #EEF4F4
foreground:    #1B2A2C
neutral:       #6E8385
accent:        #1FA6B4
border:        #D4E2E2
surface:       #FFFFFF
surface2:      #E6EFEF
accentPalette: ["#3FB8A8", "#2FA9B6", "#5AA6DE", "#7C9CE6", "#6CC79A"]
isLight:       true
```

### rose-gold-light

```
background:    #FAF1EE
foreground:    #3A2A28
neutral:       #9A8780
accent:        #D06A86
border:        #ECDDD7
surface:       #FFFFFF
surface2:      #F4E9E4
accentPalette: ["#E0B65A", "#E0A06A", "#DE8A78", "#D27E92", "#CE82B0"]
isLight:       true
```

### indigo-oxide-light

```
background:    #EEEFF9
foreground:    #272B45
neutral:       #767C9C
accent:        #5360E0
border:        #DADCEF
surface:       #FFFFFF
surface2:      #E7E9F6
accentPalette: ["#6F9AEC", "#6470E2", "#8270E0", "#9A72DC", "#62A8E2"]
isLight:       true
```

### forest-oxide-light

```
background:    #EDF4EF
foreground:    #213027
neutral:       #74897C
accent:        #2FA86C
border:        #D6E4DA
surface:       #FFFFFF
surface2:      #E5EFE8
accentPalette: ["#4FB585", "#3FAE96", "#84C28E", "#9AB45E", "#C0A055"]
isLight:       true
```

### full-sheen-light

```
background:    #F2F1F4
foreground:    #25272D
neutral:       #6F757F
accent:        #1FA6B4
border:        #DEDCE4
surface:       #FFFFFF
surface2:      #EAE9EE
accentPalette: ["#E863A0", "#9A6CE0", "#5A82E8", "#3FB8C4", "#5AC79A", "#E0BC55"]
isLight:       true
```

---

## CSS Custom Properties

`settingsCssVars.ts` exports `settingsToCssVars(settings)` which returns a `Record<string, string>` map of every CSS var the app consumes. `applyCssVars(settings)` calls this then sets them all on `document.documentElement`. It also sets `color-scheme` to `"light"` or `"dark"` (so native form controls and scrollbars match). The map is DOM-free and testable in isolation.

### Color Variables (from theme tokens)

These are all set directly or derived from the selected theme's `ColorTokens`:

| CSS var | Source | Description |
|---|---|---|
| `--bg` | `background` | Canvas background |
| `--fg` | `foreground` | Primary text color |
| `--accent` | `accent` | Primary accent color (buttons, links, selected states) |
| `--border` | `border` | Default border color |
| `--border-soft` | `color-mix(fg 10%, transparent)` | Hairline / softer border |
| `--text-muted` | `neutral` | Muted / secondary text, graph edges |
| `--faint` | `color-mix(fg 42%, transparent)` | Tertiary / disabled text |
| `--panel` | `surface` | Panel background (same as `--surface-1`) |
| `--surface-1` | `surface` | First surface level |
| `--surface-2` | `surface2` | Second surface level |
| `--surface-3` | `color-mix(fg 14%, transparent)` | Third surface level (not in theme; derived) |
| `--hover-bg` | `color-mix(fg 8%, transparent)` | Row/item hover tint |
| `--rail` | dark: `color-mix(bg 88%, black)`; light: `color-mix(bg 70%, border)` | Sidebar + topbar rail |
| `--editor` | dark: `background`; light: `color-mix(surface 64%, bg)` | Editor/main pane background |
| `--pop-bg` | dark: `color-mix(bg 82%, transparent)`; light: `color-mix(surface 84%, transparent)` | Popover / floating card surface |
| `--pop-bg-strong` | dark: `color-mix(bg 88%, transparent)`; light: `color-mix(surface 90%, transparent)` | Stronger popover surface |
| `--scrim-bg` | dark: `color-mix(fg 62%, transparent)`; light: `color-mix(neutral 32%, transparent)` | Modal overlay scrim |
| `--label-halo` | dark: `#05060a`; light: `color-mix(#fff 90%, transparent)` | Graph hub-label halo |
| `--graph-bg` | radial gradient (see below) | Graph canvas radial backdrop |
| `--vignette-edge` | dark: `color-mix(bg 70%, black)`; light: `color-mix(bg 50%, border)` | Depth vignette edge color |
| `--graph-edge` | `color-mix(fg 18%, transparent)` | Graph edge (link) color |
| `--node-cold` | `color-mix(fg 24%, bg)` | Uncolored/cold graph node fill |
| `--node-self` | `foreground` | "You" self-node color |
| `--accent-soft` | `color-mix(accent 14%, transparent)` | Accent tint background (selected tab/row) |
| `--on-accent` | dark: `#08101F`; light: `#fff` | Text on solid accent fill |

#### Graph Background Gradient

The `--graph-bg` var is a radial gradient:

- **Dark**: `radial-gradient(120% 90% at 50% 30%, {bg} 0%, color-mix(bg 60%, black) 72%)`
- **Light**: `radial-gradient(120% 90% at 50% 30%, color-mix(#fff 60%, bg) 0%, color-mix(bg 50%, border) 72%)`

This stops the agents graph mode from going half-black on light themes.

### Terminal Variables (fixed palette, not theme-tinted)

The terminal deliberately stays dark in both light and dark modes:

| CSS var | Dark value | Light value |
|---|---|---|
| `--term-bg` | `#08090E` | `#2B2740` |
| `--term-fg` | `#C7CCE0` | `#E3DEF2` |

### Graph Ramp Variables

The `accentPalette` array is exposed positionally as `--graph-0` through `--graph-4` (always 5 slots; if the palette has fewer, the last valid entry is repeated):

| CSS var | Source |
|---|---|
| `--graph-0` | `palette[0]` or `accent` |
| `--graph-1` | `palette[1]` or `accent` |
| `--graph-2` | `palette[2]` or `accent` |
| `--graph-3` | `palette[3]` or `accent` |
| `--graph-4` | `palette[4]` or `accent` |

### Chrome Accent Variables

Three named accents are extracted from palette ramp positions and used for chrome highlights and the iridescent gradient:

| CSS var | Source | Description |
|---|---|---|
| `--teal` | `palette[0]` or `accent` | Chrome teal accent |
| `--blue` | `palette[2]` or `palette[1]` or `accent` | Chrome blue accent |
| `--violet` | `palette[3]` or `palette[2]` or `accent` | Chrome violet accent |
| `--grad` | `linear-gradient(120deg, teal, blue, violet)` | Iridescent gradient |
| `--accent-purple` | `palette[1]` or `palette[0]` or `accent` | Editor syntax + task accents (purple from graph ramp) |

### Category Color Variables

Used for Bases status badges, calendar event categories, map pins, and chart series. These re-tint automatically when the theme changes (stored category tokens that match one of these values get the new theme's hue; custom hex colours stay fixed):

| CSS var | Default source | Override field |
|---|---|---|
| `--green` | `palette[1]` or `accent` | `categoryGreen` in `ColorTokens` |
| `--gold` | `palette[4]` or `palette[3]` or `accent` | `categoryGold` in `ColorTokens` |
| `--rose` | `palette[3]` or `accent` | `categoryRose` in `ColorTokens` |

No stock theme sets `categoryGreen`/`categoryGold`/`categoryRose`; they all derive from the palette ramp.

### Map Variables

Bases offline map surfaces:

| CSS var | Source |
|---|---|
| `--map-sea` | `surface2` |
| `--map-land` | `surface` |
| `--map-coast` | `color-mix(accent 45%, surface)` |
| `--map-grid` | `color-mix(fg 12%, transparent)` |

---

## Appearance Settings → CSS Vars (Font & Layout)

Beyond color, `settingsToCssVars` maps the remaining `appearance.*`, `editor.*`, `ui.*`, `calendar.*`, and `terminal.*` settings to CSS vars. A complete listing:

### From `appearance.*`

| Setting | CSS var | Default |
|---|---|---|
| `appearance.editorFont` | `--editor-font` | `'Lora', serif` |
| `appearance.editorFontSize` | `--editor-font-size` | `16px` |
| `appearance.sidebarWidth` | `--sidebar-width` | `280px` |
| `appearance.sidebarGraphHeight` | `--sidebar-graph-height` | `305px` |
| `appearance.uiFontSize` | `--ui-font-size` | `13px` |
| `appearance.monoScale` | `--mono-scale` | `0.85` |
| `appearance.tabFontSize` | `--tab-font-size` | `12px` |
| `appearance.sidebarIconFontSize` | `--sidebar-icon-font-size` | `15px` |
| `appearance.paletteInputFontSize` | `--palette-input-font-size` | `15px` |

### From `ui.*`

| Setting | CSS var | Default |
|---|---|---|
| `ui.paletteTopOffset` | `--palette-top-offset` | `12vh` |
| `ui.paneDividerWidth` | `--pane-divider-width` | `5px` |
| `ui.cardGridMinWidth` | `--card-grid-min` | `220px` |
| `ui.kanbanColumnMinWidth` | `--kanban-col-min` | `248px` |
| `ui.kanbanColumnMaxWidth` | `--kanban-col-max` | `288px` |
| `ui.mapMinHeight` | `--map-min-height` | `480px` |

### From `editor.*`

| Setting | CSS var | Default |
|---|---|---|
| `editor.lineHeight` | `--prose-line-height` | `1.65` |

### From `calendar.*`

| Setting | CSS var | Default |
|---|---|---|
| `calendar.monthCellMinHeight` | `--month-cell-min-h` | `80px` |
| `calendar.timeGutterWidth` | `--time-gutter-width` | `50px` |

### From `terminal.*`

| Setting | CSS var | Default |
|---|---|---|
| `terminal.cursorWidth` | `--term-cursor-width` | `2px` |
| `terminal.cursorGlideMs` | `--term-cursor-glide` | `70ms` |
| `terminal.cursorBlinkSeconds` | `--term-cursor-blink` | `1.2s` |

---

## Editor Fonts (EDITOR_FONTS / FONT_STACKS)

The `appearance.editorFont` setting accepts one of four values. The setting name maps to a full CSS font stack via `FONT_STACKS` in `app/src/settings.ts`:

| Setting value | CSS font stack | Notes |
|---|---|---|
| `Lora` *(default)* | `'Lora', serif` | Variable serif from `@fontsource/lora`; shipped with Bismuth |
| `Monaspace Xenon` | `'Monaspace Xenon', ui-monospace, monospace` | Monospaced from `@fontsource/monaspace-xenon`; shipped with Bismuth; use `monoScale` to correct optical size |
| `Georgia` | `Georgia, 'Times New Roman', serif` | System serif; no download |
| `system-ui` | `system-ui, -apple-system, sans-serif` | System sans; no download |

The `--editor-font` CSS var receives the full stack, not just the name. The `--mono-scale` var (default `0.85`) globally shrinks all Monaspace text — both editor body and code blocks — to correct its visual size relative to the body serif. When `editorFont` is not Monaspace, `monoScale` still applies to inline `<code>` and code blocks that render in Monaspace.

**Adding a new font**: add it to `EDITOR_FONTS` in `settingsSchema.ts` AND to `FONT_STACKS` in `settings.ts`. The schema enum, autocomplete, and lint all pick it up automatically.

---

## What Changes When You Switch Themes

Switching `appearance.theme` reruns `settingsToCssVars` → `applyCssVars`, which sets all vars in one synchronous pass on `:root`. The following update immediately without any page reload:

- The entire background/surface/border/text palette
- The graph node colors (via `--graph-0..4`) and any already-rendered nodes
- Graph edge color (`--graph-edge`)
- The "you" node color (`--node-self`)
- All accent-derived UI (buttons, selection rings, active tabs, progress bars)
- The iridescent gradient (`--grad`) and named chrome accents (`--teal`, `--blue`, `--violet`)
- Editor syntax accent (`--accent-purple`, pulled from `palette[1]`)
- Category swatches for Bases statuses, calendar events, map pins, chart series (`--green`, `--gold`, `--rose`)
- Bases map surface colors
- The terminal background/foreground (two fixed values, one for dark/one for light)
- Modal scrim, popovers, and label halos
- The graph canvas backdrop gradient (`--graph-bg`)
- `color-scheme` on `<html>` (native scrollbar/form-control appearance)

The 2D/3D graph dimension and graph simulation settings are **not** affected by theme changes.

---

## resolveTheme / resolveAppearance

```ts
// Resolve a theme name string to its ColorTokens.
// Unknown names silently fall back to DEFAULT_THEME ("oxide-duotone").
resolveTheme(name: string): ColorTokens

// Resolve from the appearance sub-object in settings.
// Currently identical to resolveTheme(a.theme); no per-color overrides exist yet.
resolveAppearance(a: { theme: string }): ColorTokens
```

Both functions are DOM-free and safe to call from tests, the graph renderer, the terminal palette builder, or any non-browser context.

---

## Default Accent Palette Fallback

`app/src/settings.ts` exports `DEFAULT_ACCENT_PALETTE` as a six-color fallback used by `settingsToCssVars` when `a.accentPalette` is empty:

```ts
export const DEFAULT_ACCENT_PALETTE = [
  "#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"
];
```

This is the same as the `full-sheen` / `SHEEN` constant in `themes.ts`. In practice every theme provides its own palette, so this fallback is defensive only.

---

## App Logo Mark

The `appearance.icon` setting selects the per-vault logo mark (favicon + sidebar logo). This is independent of the theme. Valid values:

```
hopper-crystal (default) · node-b · square-funnel · nested-diamonds ·
pinwheel · node-crystal · lattice · diamond-bloom · node-diamond ·
octagon-bloom · spin-cross · tri-bloom · radial-graph · node-rings
```

---

## Adding a New Theme

1. Add the theme name to `THEME_NAMES` in `app/src/themes.ts` (and to the copy in `core/src/schema/settingsSchema.ts` — they must stay in sync).
2. Add a `THEME_LABELS` entry for the display name.
3. Add the `ColorTokens` object to `THEMES`.
4. Set `isLight: true` if it is a light theme.
5. Light themes can optionally provide `categoryGreen`/`categoryGold`/`categoryRose` to pin specific category hues that suit the palette; otherwise the defaults from the ramp apply.
6. No changes to `settingsCssVars.ts` are needed: all derivations are generic over the tokens.

---

## Adding a CSS-Driven Setting

Per the architecture: one schema entry in `settingsSchema.ts` + one line in `settingsToCssVars` mapping `s.<section>.<key>` to `"--var-name"` + one `var(--var-name, <fallback>)` in the CSS. The setting value is converted to a string; numeric settings that map to `px` values use `s.foo + "px"`.

---

Source: `app/src/themes.ts`, `app/src/settingsCssVars.ts`, `core/src/schema/settingsSchema.ts`, `app/src/settings.ts`
