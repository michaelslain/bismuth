# Themes & Palette System

This document covers every named Bismuth theme, how the `appearance` settings section maps to CSS custom properties on `:root`, the graph accent palette, and the editor font choices. The theme system is the **single source of color** for the entire app: selecting a theme recolors the canvas, surfaces, border, text, accent, graph nodes, terminal, and category swatches from one place, with no per-color overrides. The **single source of truth** is `core/src/theme/tokens.ts` (token definitions). It lives in `core` — not `app` — because the dependency runs app → core: core consumers (gcal event-color mapping, drawing paper/ink, the settings-schema theme enum) must be able to `import` the tokens, and core cannot import app. `app/src/themes.ts` is a **thin, byte-identical re-export** of that module so the frontend keeps its `"./themes"` import path. `app/src/settingsCssVars.ts` still does the CSS projection.

The four themes are the **ASCII redesign's** four scopes (`design/ascii/design-system/tokens/colors.css`): `ink` (default, dark), `paper` (light), `cathode` (phosphor-terminal, dark), `riso` (cream + indigo, light).

---

## Theme Names

The setting is `appearance.theme` in `.settings` (the vault's hidden, extensionless settings file — `SETTINGS_FILE` in `core/src/settings.ts:17`). The schema enum lists 4 names; the first is the default.

```yaml
appearance:
  theme: ink   # default
```

| Setting value | Display name | Light/Dark |
|---|---|---|
| `ink` | Ink *(default)* | Dark — "Riso, but dark": warm paper ink on charcoal |
| `paper` | Paper | Light — the light counterpart to Ink, same inks |
| `cathode` | Cathode | Dark — hot phosphor terminal, high-contrast, glows |
| `riso` | Riso | Light — cream paper + indigo ink, print-flat, no glow |

The `THEME_NAMES` array in `core/src/theme/tokens.ts` is the ordered authoritative list; the first entry (`ink`) is both the schema default and the `DEFAULT_THEME` constant used by `resolveTheme()` when an unknown name is provided. The display names above are the authoritative `THEME_LABELS` map in the same file (no decorative separators). (`app/src/themes.ts` re-exports `THEME_NAMES`, `THEME_LABELS`, and `DEFAULT_THEME`, so the frontend's `"./themes"` import path is unchanged.)

**Legacy names**: `.settings` files saved under the pre-redesign 12-theme system (e.g. `oxide-duotone`, `indigo-oxide`) are unknown names to `resolveTheme()` and silently fall back to `ink` — no migration or error, just the same "unknown name → default" behavior that has always backed `resolveTheme()`.

---

## ColorTokens Interface

Every theme resolves to a `ColorTokens` object. The base palette (first 8 fields) is required; everything after it is an **optional explicit override** — each documents the CSS var it feeds, and `settingsCssVars` prefers the explicit value when a theme sets it, falling back to its original color-mix derivation otherwise. All four ASCII themes set every optional field explicitly.

```ts
interface ColorTokens {
  background: string;   // canvas / --bg
  foreground: string;   // text / --fg
  neutral: string;      // muted text + graph edges / --text-muted
  accent: string;       // --accent
  border: string;       // --border
  surface: string;      // --surface-1 / --panel
  surface2: string;     // --surface-2
  accentPalette: string[]; // graph node ramp (5 entries: rose, violet, blue, teal, green)
  isLight?: boolean;     // true for paper + riso; drives light/dark branching

  // Structural surfaces
  rail?: string; editor?: string; surface3?: string; borderSoft?: string; faint?: string;
  hoverBg?: string; popBg?: string; popBgStrong?: string; scrimBg?: string; overlayBg?: string;
  labelHalo?: string; graphBg?: string; graphEdge?: string; nodeCold?: string; nodeSelf?: string;
  vignetteEdge?: string; termBg?: string; termFg?: string;
  glowAccent?: string; glowText?: string;   // bloom is a THEME decision — only cathode glows
  accentSoft?: string; onAccent?: string;

  // Category hues (Bases statuses, calendar categories, map pins, chart series) — CATEGORICAL,
  // distinct from the semantic danger/success/warning below.
  categoryTeal?: string; categoryBlue?: string; categoryViolet?: string;
  categoryGreen?: string; categoryGold?: string; categoryRose?: string;

  // Semantic status overrides — each ASCII theme sets these explicitly.
  danger?: string; success?: string; warning?: string;
}
```

`--accent-purple` is **not** its own `ColorTokens` field: it equals `accentPalette[1]` in every scope, so the existing `palette[1]` derivation in `settingsCssVars` covers it without a dedicated token.

The `isLight` flag is only present (and `true`) on `paper` and `riso`. Its absence is treated as `false`. It drives several structural surfaces that branch differently between dark and light whenever a theme doesn't set the explicit field (rail, pop-bg, scrim, label-halo, editor surface, graph background).

---

## Per-Theme Color Values

Values are transcribed verbatim from `design/ascii/design-system/tokens/colors.css` (`:root`/`.ink`, `.paper`, `.cathode`, `.riso`).

### ink (dark, default)

```
background:    #15161A        accent:        #93BDB0
foreground:    #E8E3D6        border:        #3A3E4A
neutral:       #9C998E        surface:       #20222A
surface2:      #272A33        accentPalette: ["#C98CA8","#A190C4","#8296C6","#83B4AE","#A3BE8C"]
rail:          #101116        editor:        #191A1F
surface3:      #31353F        borderSoft:    #282B34
faint:         #6A675E        hoverBg:       rgba(232,227,214,.05)
popBg:         rgba(25,26,31,.88)      popBgStrong: rgba(25,26,31,.94)
scrimBg:       rgba(10,11,14,.6)      overlayBg:   rgba(10,11,14,.6)
labelHalo:     #15161A        graphBg:       #121317
graphEdge:     #3C4048        nodeCold:      #4A4E58
nodeSelf:      #E8E3D6        vignetteEdge:  #0D0E11
termBg:        #101116        termFg:        #C9C4B6
glowAccent:    0 0 0 1px rgba(147,189,176,.14)   glowText: none
accentSoft:    rgba(147,189,176,.12)    onAccent: #15161A
categoryTeal/Blue/Violet/Green/Gold/Rose: #83B4AE #8296C6 #A190C4 #A3BE8C #CBB27E #C98CA8
danger:        #C87F72        success:       #A3BE8C        warning: #CBB27E
```

### paper (light)

```
background:    #E9E6E0        accent:        #4E7F73
foreground:    #2E2C29        border:        #C4BEB3
neutral:       #6E6A63        surface:       #EFEDE8
surface2:      #E1DDD5        accentPalette: ["#A85C7A","#7A6AA0","#5A6E9E","#4E8079","#6E8A55"]
isLight:       true
rail:          #E3E0D9        editor:        #F2F0EB
surface3:      #D3CEC5        borderSoft:    #D8D3C9
faint:         #9A958C        hoverBg:       rgba(46,44,41,.05)
popBg:         rgba(242,240,235,.9)   popBgStrong: rgba(242,240,235,.96)
scrimBg:       rgba(90,86,78,.3)      overlayBg:   rgba(90,86,78,.3)
labelHalo:     #F2F0EB        graphBg:       #E1DDD5
graphEdge:     #C9C3B7        nodeCold:      #B6B0A4
nodeSelf:      #2E2C29        vignetteEdge:  #D8D3C9
termBg:        #2E2C29        termFg:        #E9E6E0
glowAccent:    0 0 0 1px rgba(78,127,115,.16)    glowText: none
accentSoft:    rgba(78,127,115,.12)     onAccent: #F2F0EB
categoryTeal/Blue/Violet/Green/Gold/Rose: #4E8079 #5A6E9E #7A6AA0 #5E7F4B #A8863F #A85C7A
danger:        #A8503F        success:       #5E7F4B        warning: #B54708
```

### cathode (dark)

```
background:    #05070A        accent:        #35F0E0
foreground:    #DDF3EA        border:        #1B3A38
neutral:       #6FA69A        surface:       #0C1116
surface2:      #121A20        accentPalette: ["#FF5AA8","#A96BFF","#5A82F5","#35E8E0","#5CFA8A"]
rail:          #020304        editor:        #070A0E
surface3:      #18242B        borderSoft:    #112524
faint:         #3F5F58        hoverBg:       rgba(53,240,224,.07)
popBg:         rgba(7,10,14,.82)      popBgStrong: rgba(7,10,14,.9)
scrimBg:       rgba(0,0,0,.66)        overlayBg:   rgba(0,0,0,.66)
labelHalo:     #05070A        graphBg:       #04070A
graphEdge:     #1B3A38        nodeCold:      #24504B
nodeSelf:      #DDF3EA        vignetteEdge:  #020405
termBg:        #020304        termFg:        #9FE6D8
glowAccent:    0 0 12px rgba(53,240,224,.35)     glowText: 0 0 8px rgba(53,240,224,.28)
accentSoft:    rgba(53,240,224,.12)     onAccent: #05070A
categoryTeal/Blue/Violet/Green/Gold/Rose: #35E8E0 #5A82F5 #A96BFF #5CFA8A #FFC23D #FF4FA3
danger:        #FF6B5A        success:       #5CFA8A        warning: #FFC23D
```

Cathode is the **one theme with bloom** — `glowAccent`/`glowText` carry real glow shadows; every other theme sets `glowText: none` and a flat 1px accent rim (or `none`) for `glowAccent`.

### riso (light)

```
background:    #EAE4D4        accent:        #2E36A8
foreground:    #22285E        border:        #B9AE92
neutral:       #5E628C        surface:       #E3DCC8
surface2:      #DBD3BC        accentPalette: ["#C0387A","#6B4FA8","#2E36A8","#2F7F86","#5E8A3C"]
isLight:       true
rail:          #E1DACA        editor:        #F1ECDF
surface3:      #CFC5AA        borderSoft:    #CFC6AE
faint:         #948F86        hoverBg:       rgba(34,40,94,.06)
popBg:         rgba(241,236,223,.92)  popBgStrong: rgba(241,236,223,.97)
scrimBg:       rgba(60,58,74,.28)     overlayBg:   rgba(60,58,74,.28)
labelHalo:     #F1ECDF        graphBg:       #DBD3BC
graphEdge:     #BCB39A        nodeCold:      #AFA68E
nodeSelf:      #22285E        vignetteEdge:  #CFC6AE
termBg:        #22285E        termFg:        #EAE4D4
glowAccent:    0 0 0 1px rgba(46,54,168,.18)     glowText: none
accentSoft:    rgba(46,54,168,.12)      onAccent: #F1ECDF
categoryTeal/Blue/Violet/Green/Gold/Rose: #2F7F86 #2E36A8 #6B4FA8 #5E8A3C #C08A2E #C0387A
danger:        #B03A2E        success:       #4F7A34        warning: #A86A18
```

---

## CSS Custom Properties

`settingsCssVars.ts` exports `settingsToCssVars(settings)` which returns a `Record<string, string>` map of every CSS var the app consumes. `applyCssVars(settings)` calls this then sets them all on `document.documentElement`. It also sets `color-scheme` to `"light"` or `"dark"` (so native form controls and scrollbars match). The map is DOM-free and testable in isolation.

### Color Variables (from theme tokens)

Each of these prefers the theme's explicit `ColorTokens` field (all four ASCII themes set one) and falls back to a color-mix derivation only for a theme that omits it:

| CSS var | Explicit field | Fallback derivation |
|---|---|---|
| `--bg` / `--fg` / `--accent` / `--border` / `--text-muted` / `--panel` / `--surface-1` / `--surface-2` | `background`/`foreground`/`accent`/`border`/`neutral`/`surface`/`surface`/`surface2` | (required — no fallback) |
| `--border-soft` | `borderSoft` | `color-mix(fg 10%, transparent)` |
| `--faint` | `faint` | `color-mix(fg 42%, transparent)` |
| `--hover-bg` | `hoverBg` | `color-mix(fg 8%, transparent)` |
| `--surface-3` | `surface3` | `color-mix(fg 14%, transparent)` |
| `--rail` | `rail` | dark: `color-mix(bg 88%, black)`; light: `color-mix(bg 70%, border)` |
| `--editor` | `editor` | dark: `background`; light: `color-mix(surface 64%, bg)` |
| `--pop-bg` | `popBg` | dark: `color-mix(bg 82%, transparent)`; light: `color-mix(surface 84%, transparent)` |
| `--pop-bg-strong` | `popBgStrong` | dark: `color-mix(bg 88%, transparent)`; light: `color-mix(surface 90%, transparent)` |
| `--scrim-bg` | `scrimBg` | dark: `color-mix(fg 62%, transparent)`; light: `color-mix(neutral 32%, transparent)` |
| `--overlay-bg` | `overlayBg` | same fallback expression as `--scrim-bg` |
| `--label-halo` | `labelHalo` | dark: `#05060a`; light: `color-mix(#fff 90%, transparent)` |
| `--graph-bg` | `graphBg` (a **flat color**, not a gradient) | dark/light radial-gradient (legacy derivation) |
| `--vignette-edge` | `vignetteEdge` | dark: `color-mix(bg 70%, black)`; light: `color-mix(bg 50%, border)` |
| `--graph-edge` | `graphEdge` | `color-mix(fg 18%, transparent)` |
| `--node-cold` | `nodeCold` | `color-mix(fg 24%, bg)` |
| `--node-self` | `nodeSelf` | `foreground` |
| `--accent-soft` | `accentSoft` | `color-mix(accent 14%, transparent)` |
| `--on-accent` | `onAccent` | dark: `#08101F`; light: `#fff` |
| `--glow-accent` | `glowAccent` | `"none"` |
| `--glow-text` | `glowText` | `"none"` |

### Terminal Variables (fixed palette, not theme-tinted)

| CSS var | Explicit field | Fallback |
|---|---|---|
| `--term-bg` | `termBg` | dark: `#08090E`; light: `#2B2740` |
| `--term-fg` | `termFg` | dark: `#C7CCE0`; light: `#E3DEF2` |

### Graph Ramp Variables

`settingsToCssVars` exposes exactly `--graph-0` through `--graph-4` (5 slots), positional to `accentPalette[i]`; a missing index falls back to the theme's **accent** (`palette[i] ?? a.accent`).

| CSS var | Source |
|---|---|
| `--graph-0` … `--graph-4` | `palette[0..4]` or `accent` |

### Chrome Accent Variables

| CSS var | Explicit field | Fallback source |
|---|---|---|
| `--teal` | `categoryTeal` | `palette[0]` or `accent` |
| `--blue` | `categoryBlue` | `palette[2]` or `palette[1]` or `accent` |
| `--violet` | `categoryViolet` | `palette[3]` or `palette[2]` or `accent` |
| `--grad` | — | `linear-gradient(120deg, graph-0, graph-1, graph-2, graph-3, graph-4, gold)` — six stops, matching every scope's `--grad` in `colors.css` |
| `--accent-purple` | — | `palette[1]` or `palette[0]` or `accent` (editor syntax + task accents) |

### Category Color Variables

Used for Bases status badges, calendar event categories, map pins, and chart series. Re-tint automatically when the theme changes (stored category tokens that match one of these values get the new theme's hue; custom hex colours stay fixed):

| CSS var | Explicit field | Fallback source |
|---|---|---|
| `--green` | `categoryGreen` | `palette[1]` or `accent` |
| `--gold` | `categoryGold` | `palette[4]` or `palette[3]` or `accent` |
| `--rose` | `categoryRose` | `palette[3]` or `accent` |

All four ASCII themes pin every category field explicitly.

### Map Variables

Bases offline map surfaces:

| CSS var | Source |
|---|---|
| `--map-sea` | `surface2` |
| `--map-land` | `surface` |
| `--map-coast` | `color-mix(accent 45%, surface)` |
| `--map-grid` | `color-mix(fg 12%, transparent)` |

---

## Semantic Status Tokens

Beyond the palette, `core/src/theme/tokens.ts` defines a **semantic status trio** — `danger` / `success` / `warning` — invariant across a theme's hue but tuned **separately per light vs dark** for accessibility. `semanticTokens(tokens)` prefers a theme's own explicit `danger`/`success`/`warning` fields (all four ASCII themes set these) and otherwise falls back to `SEMANTIC_LIGHT`/`SEMANTIC_DARK`. `settingsCssVars` projects the result as `--danger` / `--success` / `--warning`, so components read `var(--danger)` instead of hardcoding reds and greens.

| Token | CSS var | Dark fallback (`SEMANTIC_DARK`, = ink) | Light fallback (`SEMANTIC_LIGHT`, = paper) |
|---|---|---|---|
| `danger` | `--danger` | `#C87F72` | `#A8503F` |
| `success` | `--success` | `#A3BE8C` | `#5E7F4B` |
| `warning` | `--warning` | `#CBB27E` | `#B54708` |

These are **semantic**, distinct from the categorical `--green`/`--rose` swatches above — so destructive/success affordances are never re-tinted by a theme's category hues.

---

## Elevation Shadows

`tokens.ts` also owns the elevation shadow set — `menu` / `popup` / `card` / `modal` — selected by `shadowTokens(tokens)` and projected as `--shadow-menu` / `--shadow-popup` / `--shadow-card` / `--shadow-modal`. The dark values come from the ASCII redesign's `design/ascii/design-system/tokens/effects.css`; the light values are lighter and smaller-blur, so light themes don't wear the dark themes' heavy near-black drop shadows.

| CSS var | Dark (`SHADOW_DARK`) | Light (`SHADOW_LIGHT`) |
|---|---|---|
| `--shadow-menu` | `0 4px 16px rgba(0,0,0,.3)` | `0 4px 12px rgba(16, 24, 40, 0.10)` |
| `--shadow-popup` | `0 8px 24px rgba(0,0,0,.4)` | `0 8px 20px rgba(16, 24, 40, 0.12)` |
| `--shadow-card` | `0 1px 0 rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35)` | `0 12px 32px rgba(16, 24, 40, 0.12)` |
| `--shadow-modal` | `0 24px 70px rgba(0,0,0,.5)` | `0 24px 64px rgba(16, 24, 40, 0.14)` |

---

## Category Swatches & Accent Ramp (centralization)

`tokens.ts` fixes the six named category hues in one place — `CATEGORY_SWATCHES` — so every consumer sources the same values (the `ink` scope's hues):

| Token | Hex |
|---|---|
| `teal` | `#83B4AE` |
| `blue` | `#8296C6` |
| `violet` | `#A190C4` |
| `green` | `#A3BE8C` |
| `gold` | `#CBB27E` |
| `rose` | `#C98CA8` |

`ACCENT_RAMP` is those six hexes in canonical order (teal → blue → violet → green → gold → rose). `THEME_ACCENTS` is the per-theme `--accent` hex, derived from `THEMES` (`Object.fromEntries(THEME_NAMES.map(n => [n, THEMES[n].accent]))`) so it can **never drift** from the theme definitions.

This is the **one ramp** that used to be hand-copied — and had drifted — into four places; all now source from `tokens.ts`:

- **Drawing toolbar** (`core/src/drawing/theme.ts`): `themeColors()` reads `THEMES[…]` / `DEFAULT_THEME` for a drawing's paper + default ink (dark → `ink`, light → `paper`).
- **Export theme** (`app/src/export/exportTheme.ts`): `DEFAULT_TOKENS` spreads `CATEGORY_SWATCHES` for the headless-fallback teal→rose ramp (`accent` stays the App.css default `#93BDB0`, the ink accent).
- **gcal color map** (`core/src/gcal/colors.ts`): resolves category tokens via `CATEGORY_SWATCHES` and the `accent` token via `THEME_ACCENTS` before snapping to the nearest Google event color.
- **App.css `:root` fallbacks**: the first-paint literal values mirror these swatches (documented in `tokens.ts`).

---

## Appearance Settings → CSS Vars (Font & Layout)

Beyond color, `settingsToCssVars` maps the remaining `appearance.*`, `editor.*`, `ui.*`, `calendar.*`, and `terminal.*` settings to CSS vars. A complete listing:

### From `appearance.*`

| Setting | CSS var | Default |
|---|---|---|
| `appearance.editorFont` | `--editor-font` | `'Monaspace Xenon', ui-monospace, monospace` |
| `appearance.uiFont` | `--ui-font-stack` | `'Monaspace Xenon', ui-monospace, monospace` |
| `appearance.editorFontSize` | `--editor-font-size` | `11.5px` |
| `appearance.sidebarWidth` | `--sidebar-width` | `266px` |
| `appearance.sidebarGraphHeight` | `--sidebar-graph-height` | `305px` |
| `appearance.uiFontSize` | `--ui-font-size` | `11.5px` |
| `appearance.monoScale` | `--mono-scale` | `1` |
| `appearance.tabFontSize` | `--tab-font-size` | `11.5px` |
| `appearance.sidebarIconFontSize` | `--sidebar-icon-font-size` | `11.5px` |
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
| `editor.lineHeight` | `--prose-line-height` | `1` |

`--prose-line-height` is a multiplier of `--row-h` (the app's fixed 18px row unit, `ui.css`
`:root` — not itself settings-driven), consumed as `calc(var(--row-h) * var(--prose-line-height))`
in both editors (Editor.tsx / BlockEditor.css). Default `1` → 18px exactly.

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

## Editor & UI Fonts (EDITOR_FONTS / FONT_STACKS)

Serif is gone — the ASCII redesign is **one monospace family for the whole interface**. `appearance.editorFont` (prose) and `appearance.uiFont` (rail/tabs/tables/buttons/menus) each independently pick one of the five Monaspace variants; both default to `Monaspace Xenon`. The setting name maps to a full CSS font stack via `FONT_STACKS` in `app/src/settings.ts`:

| Setting value | CSS font stack | Notes |
|---|---|---|
| `Monaspace Xenon` *(default)* | `'Monaspace Xenon', ui-monospace, monospace` | From `@fontsource/monaspace-xenon`; shipped with Bismuth |
| `Monaspace Neon` | `'Monaspace Neon', ui-monospace, monospace` | From `@fontsource/monaspace-neon`; shipped with Bismuth |
| `Monaspace Argon` | `'Monaspace Argon', ui-monospace, monospace` | From `@fontsource/monaspace-argon`; shipped with Bismuth |
| `Monaspace Krypton` | `'Monaspace Krypton', ui-monospace, monospace` | From `@fontsource/monaspace-krypton`; shipped with Bismuth |
| `Monaspace Radon` | `'Monaspace Radon', ui-monospace, monospace` | From `@fontsource/monaspace-radon`; shipped with Bismuth |

`app/src/index.tsx` imports the 400/500/700 weights of all five variants at boot, so any variant is available instantly regardless of which one is selected. `--editor-font` receives `editorFont`'s stack, `--ui-font-stack` receives `uiFont`'s stack (with a static literal fallback in `app/src/ui/ui.css :root` for first paint, before settings load). `font-variant-ligatures: none` is set app-wide (`App.css`, html/body) — Monaspace's coding ligatures (`->`, `!=`) would otherwise break the character grid the design leans on.

The `--mono-scale` var (default `1`) is a legacy optical-size correction from the serif-prose era (it shrank mono text to match a serif body); the all-mono UI needs no correction, but the setting and its consumers (inline `<code>`, code blocks) still exist for anyone who wants to tune it.

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
- Modal scrim, overlay, popovers, and label halos
- The graph canvas backdrop (`--graph-bg`, a flat color per theme)
- Bloom (`--glow-accent`/`--glow-text`) — only `cathode` turns it on
- `color-scheme` on `<html>` (native scrollbar/form-control appearance)

The 2D/3D graph dimension and graph simulation settings are **not** affected by theme changes.

---

## resolveTheme / resolveAppearance / semanticTokens / shadowTokens

```ts
// Resolve a theme name string to its ColorTokens.
// Unknown names (including every pre-redesign 12-theme name) silently fall back to
// DEFAULT_THEME ("ink").
resolveTheme(name: string): ColorTokens

// Resolve from the appearance sub-object in settings.
// Currently identical to resolveTheme(a.theme); no per-color overrides exist yet.
resolveAppearance(a: { theme: string }): ColorTokens

// The semantic status trio (danger/success/warning) for a resolved theme — prefers
// the theme's own explicit fields, else SEMANTIC_LIGHT/SEMANTIC_DARK by t.isLight.
semanticTokens(t: ColorTokens): SemanticTokens

// The elevation shadow set (menu/popup/card/modal) for a resolved theme —
// SHADOW_LIGHT when t.isLight, else SHADOW_DARK.
shadowTokens(t: ColorTokens): ShadowTokens
```

All four live in `core/src/theme/tokens.ts` and are **DOM-free + dependency-free** (pure data + pure functions), so they're safe to call from tests, the graph renderer, the terminal palette builder, the backend, the CLI, or any non-browser context.

---

## Default Accent Palette Fallback

`app/src/settings.ts` exports `DEFAULT_ACCENT_PALETTE` as a fallback used by `settingsToCssVars` when `a.accentPalette` is empty:

```ts
// Single-sourced from themes.ts's default theme so the values can't drift.
export const DEFAULT_ACCENT_PALETTE = THEMES[DEFAULT_THEME].accentPalette;
```

In practice every theme provides its own palette, so this fallback is defensive only.

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

1. Add the theme name to `THEME_NAMES` in `core/src/theme/tokens.ts`. There is **no copy to keep in sync**: `settingsSchema.ts` imports the tuple (`import { THEME_NAMES as THEME_NAME_TUPLE } from "../theme/tokens"; const THEME_NAMES = [...THEME_NAME_TUPLE];`), so the schema enum updates automatically.
2. Add a `THEME_LABELS` entry for the display name in `tokens.ts`.
3. Add the `ColorTokens` object to `THEMES` in `tokens.ts` — set every optional field explicitly (the ASCII themes all do; a theme that omits one gets `settingsCssVars`'s legacy color-mix derivation instead).
4. Set `isLight: true` if it is a light theme.
5. `categoryTeal`/`categoryBlue`/`categoryViolet`/`categoryGreen`/`categoryGold`/`categoryRose` can pin specific category hues that suit the palette; otherwise the defaults from the ramp apply.
6. No changes to `settingsCssVars.ts` are needed: all derivations are generic over the tokens.

---

## Adding a CSS-Driven Setting

Per the architecture: one schema entry in `settingsSchema.ts` + one line in `settingsToCssVars` mapping `s.<section>.<key>` to `"--var-name"` + one `var(--var-name, <fallback>)` in the CSS. The setting value is converted to a string; numeric settings that map to `px` values use `s.foo + "px"`.

---

Source: `core/src/theme/tokens.ts`, `app/src/themes.ts` (re-export), `app/src/settingsCssVars.ts`, `core/src/schema/settingsSchema.ts`, `app/src/settings.ts`, `core/src/gcal/colors.ts`, `core/src/drawing/theme.ts`, `app/src/export/exportTheme.ts`, `design/ascii/design-system/tokens/colors.css`, `design/ascii/design-system/tokens/effects.css`, `design/ascii/README.md`
