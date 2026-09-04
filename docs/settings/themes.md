# Themes & Palette System

This document covers every named Bismuth theme, how the `appearance` settings section maps to CSS custom properties on `:root`, the graph accent palette, and the editor font choices. Read it if you're picking exact color values, wiring a new themed component, debugging a color mismatch, or adding a fifth theme (see [Adding a New Theme](#adding-a-new-theme)). For the `appearance` section's non-color keys (sizing, fonts by name) alongside every other setting, see the [Settings Reference](reference.md).

The theme system is the **single source of color** for the entire app: selecting a theme recolors the canvas, surfaces, border, text, accent, graph nodes, terminal, and category swatches from one place, with no per-color overrides. The **single source of truth** is `core/src/theme/tokens.ts` (token definitions). It lives in `core` — not `app` — because the dependency runs app → core: core consumers (gcal event-color mapping, drawing paper/ink, the settings-schema theme enum) must be able to `import` the tokens, and core cannot import app. `app/src/themes.ts` is a **thin, byte-identical re-export** of that module so the frontend keeps its `"./themes"` import path. `app/src/settingsCssVars.ts` still does the CSS projection.

The four themes are the **ASCII redesign's** four scopes (`bismuth-design/ascii/design-system/tokens/colors.css`): `ink` (default, dark), `paper` (light), `cathode` (phosphor-terminal, dark), `riso` (cream + indigo, light).

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

Re-transcribed programmatically from the `THEMES` object in `core/src/theme/tokens.ts` (2026-09-03) —
the section previously claimed to be a verbatim transcription of
`bismuth-design/ascii/design-system/tokens/colors.css` but had drifted from the actual, live
`tokens.ts` values in several fields per theme (`faint` in all four; `neutral`/`accent`/`glowAccent`/
`accentSoft`/`categoryGold` in `paper`; `neutral`/`categoryGold` in `riso`). `tokens.ts` is the single
source of truth `settingsCssVars` actually reads, so it — not the design-system CSS — is what these
blocks are transcribed from now.

### ink (dark, default)

```text
background:    #15161A        accent:        #93BDB0
foreground:    #E8E3D6        border:        #3A3E4A
neutral:       #9C998E        surface:       #20222A
surface2:      #272A33        accentPalette: ["#C98CA8","#A190C4","#8296C6","#83B4AE","#A3BE8C"]
rail:          #101116        editor:        #191A1F
surface3:      #31353F        borderSoft:    #282B34
faint:         #827F78        hoverBg:       rgba(232,227,214,.05)
popBg:         rgba(25,26,31,.88)      popBgStrong: rgba(25,26,31,.94)
scrimBg:       rgba(10,11,14,.6)      overlayBg:   rgba(10,11,14,.6)
labelHalo:     #15161A        graphBg:       #121317
graphEdge:     #3C4048        nodeCold:      #4A4E58
nodeSelf:      #E8E3D6        vignetteEdge:  #0D0E11
termBg:        #101116        termFg:        #C9C4B6
glowAccent:    0 0 0 1px rgba(147,189,176,0.14)   glowText: none
accentSoft:    rgba(147,189,176,0.12)    onAccent: #15161A
categoryTeal/Blue/Violet/Green/Gold/Rose: #83B4AE #8296C6 #A190C4 #A3BE8C #CBB27E #C98CA8
danger:        #C87F72        success:       #A3BE8C        warning: #CBB27E
```

### paper (light)

```text
background:    #E9E6E0        accent:        #436D63
foreground:    #2E2C29        border:        #C4BEB3
neutral:       #64605A        surface:       #EFEDE8
surface2:      #E1DDD5        accentPalette: ["#A85C7A","#7A6AA0","#5A6E9E","#4E8079","#6E8A55"]
isLight:       true
rail:          #E3E0D9        editor:        #F2F0EB
surface3:      #D3CEC5        borderSoft:    #D8D3C9
faint:         #6A6761        hoverBg:       rgba(46,44,41,.05)
popBg:         rgba(242,240,235,.9)   popBgStrong: rgba(242,240,235,.96)
scrimBg:       rgba(90,86,78,.3)      overlayBg:   rgba(90,86,78,.3)
labelHalo:     #F2F0EB        graphBg:       #E1DDD5
graphEdge:     #C9C3B7        nodeCold:      #B6B0A4
nodeSelf:      #2E2C29        vignetteEdge:  #D8D3C9
termBg:        #2E2C29        termFg:        #E9E6E0
glowAccent:    0 0 0 1px rgba(67,109,99,0.16)    glowText: none
accentSoft:    rgba(67,109,99,0.12)     onAccent: #F2F0EB
categoryTeal/Blue/Violet/Green/Gold/Rose: #4E8079 #5A6E9E #7A6AA0 #5E7F4B #A07F3C #A85C7A
danger:        #A8503F        success:       #5E7F4B        warning: #B54708
```

### cathode (dark)

```text
background:    #05070A        accent:        #35F0E0
foreground:    #DDF3EA        border:        #1B3A38
neutral:       #6FA69A        surface:       #0C1116
surface2:      #121A20        accentPalette: ["#FF5AA8","#A96BFF","#5A82F5","#35E8E0","#5CFA8A"]
rail:          #020304        editor:        #070A0E
surface3:      #18242B        borderSoft:    #112524
faint:         #637D78        hoverBg:       rgba(53,240,224,.07)
popBg:         rgba(7,10,14,.82)      popBgStrong: rgba(7,10,14,.9)
scrimBg:       rgba(0,0,0,.66)        overlayBg:   rgba(0,0,0,.66)
labelHalo:     #05070A        graphBg:       #04070A
graphEdge:     #1B3A38        nodeCold:      #24504B
nodeSelf:      #DDF3EA        vignetteEdge:  #020405
termBg:        #020304        termFg:        #9FE6D8
glowAccent:    0 0 12px rgba(53,240,224,.35)     glowText: 0 0 8px rgba(53,240,224,.28)
accentSoft:    rgba(53,240,224,0.12)     onAccent: #05070A
categoryTeal/Blue/Violet/Green/Gold/Rose: #35E8E0 #5A82F5 #A96BFF #5CFA8A #FFC23D #FF4FA3
danger:        #FF6B5A        success:       #5CFA8A        warning: #FFC23D
```

Cathode is the **one theme with bloom** — `glowAccent`/`glowText` carry real glow shadows; every other theme sets `glowText: none` and a flat 1px accent rim (or `none`) for `glowAccent`.

### riso (light)

```text
background:    #EAE4D4        accent:        #2E36A8
foreground:    #22285E        border:        #B9AE92
neutral:       #55587E        surface:       #E3DCC8
surface2:      #DBD3BC        accentPalette: ["#C0387A","#6B4FA8","#2E36A8","#2F7F86","#5E8A3C"]
isLight:       true
rail:          #E1DACA        editor:        #F1ECDF
surface3:      #CFC5AA        borderSoft:    #CFC6AE
faint:         #69665F        hoverBg:       rgba(34,40,94,.06)
popBg:         rgba(241,236,223,.92)  popBgStrong: rgba(241,236,223,.97)
scrimBg:       rgba(60,58,74,.28)     overlayBg:   rgba(60,58,74,.28)
labelHalo:     #F1ECDF        graphBg:       #DBD3BC
graphEdge:     #BCB39A        nodeCold:      #AFA68E
nodeSelf:      #22285E        vignetteEdge:  #CFC6AE
termBg:        #22285E        termFg:        #EAE4D4
glowAccent:    0 0 0 1px rgba(46,54,168,.18)     glowText: none
accentSoft:    rgba(46,54,168,0.12)      onAccent: #F1ECDF
categoryTeal/Blue/Violet/Green/Gold/Rose: #2F7F86 #2E36A8 #6B4FA8 #5E8A3C #A97928 #C0387A
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

**The four blurred shadow vars described in older copies of this section — `--shadow-menu` /
`--shadow-popup` / `--shadow-card` / `--shadow-modal` — were deleted 2026-08-27** (visual-unification
audit §9.3, wave 1): no blur survives the ASCII redesign, and every former consumer now reads a
single var, `--lift`, instead. The `ShadowTokens` interface, `SHADOW_DARK`, `SHADOW_LIGHT` and
`shadowTokens()` all still exist in `core/src/theme/tokens.ts` — they were narrowed to one field,
not removed:

```ts
interface ShadowTokens {
  hard: string;
}
const SHADOW_DARK: ShadowTokens  = { hard: 'rgba(0,0,0,.45)' };
const SHADOW_LIGHT: ShadowTokens = { hard: 'rgba(16, 24, 40, .35)' };
```

`shadowTokens(tokens)` still picks `SHADOW_LIGHT` when `t.isLight`, else `SHADOW_DARK`, exactly as
before — only the shape of what it returns changed. `settingsCssVars.ts` projects `shadow.hard` as
`--shadow-hard`.

`hard` is **not itself a box-shadow value** — it is the flat shadow *color* that the actual depth cue
composites against. That cue is `--lift`, defined once in `app/src/styles/tokens.css` (not
per-theme):

```css
--lift: 2px 2px 0 var(--shadow-hard);
```

A zero-blur, hard-offset "TUI drop-shadow" — the one permitted depth cue post-redesign, used
everywhere the four deleted vars used to be. Because it has no blur to soften it, `--shadow-hard`
carries **more opacity** than the old blurred shadows did (`.45`/`.35` here vs. the old `.3`-`.5`
dark range and `.10`-`.14` light range) — a flat 2px offset with a faint fill would barely read as a
shadow at all.

| CSS var | Dark (`SHADOW_DARK.hard`) | Light (`SHADOW_LIGHT.hard`) |
|---|---|---|
| `--shadow-hard` | `rgba(0,0,0,.45)` | `rgba(16, 24, 40, .35)` |

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
| `appearance.editorFontSize` | `--editor-font-size` | `13.5px` |
| `appearance.sidebarWidth` | `--sidebar-width` | `266px` |
| `appearance.sidebarGraphHeight` | `--sidebar-graph-height` | `305px` |
| `appearance.uiFontSize` | `--ui-font-size` | `11.5px` |
| `appearance.monoScale` | `--mono-scale` | `1` |
| `appearance.tabFontSize` | `--tab-font-size` | `11.5px` |
| `appearance.sidebarIconFontSize` | `--sidebar-icon-font-size` | `12px` |
| `appearance.paletteInputFontSize` | `--palette-input-font-size` | `15px` |

Two of these defaults deliberately break from the app's `--fs-ui` chrome size (`11.5px`), each for a
documented reason (`settingsSchema.ts`'s own `doc` string on the key):

- **`editorFontSize` is `13.5`, not `11.5`.** Despite the name, this key sets the **prose** font size
  — `13.5` is the design system's own prose size (`--fs-body-lg`, `ui.css`), deliberately off the
  `11.5px` chrome scale because chrome is scanned and prose is read. The `18px` row unit
  (`--row-h`) is unaffected, so a line of prose still lands on the same grid as a tree row or a tab.
- **`sidebarIconFontSize` is `12`, not `11.5`.** It is deliberately off the `11.5px` `--fs-ui` text
  size, and it matches the tab toolbars' own 12px `ICON_PX` default.

  The schema's `doc:` string still explains this as half-scaling a 24×24 pixel-icon grid and cites
  `app/src/icons/pixelPaths.ts`. **That rationale is historical**: the pixel-icon era ended, the
  Nerd Font era after it ended too, and `pixelPaths.ts` no longer exists — icons are now Phosphor
  SVG on a 256×256 native grid (`app/src/assets/icons/icon-manifest.json`, see
  [third-party notices](../overview/third-party-notices.md)). The `12` default is unchanged and
  still correct; only the reason recorded in the code for it is out of date.

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
| `editor.lineHeight` | `--prose-line-height` | `1.5` |

`--prose-line-height` is a multiplier of `--row-h` (the app's fixed 18px row unit, `ui.css`
`:root` — not itself settings-driven), consumed as `calc(var(--row-h) * var(--prose-line-height))`
in both editors (Editor.tsx / BlockEditor.css). Default `1.5` → **27px**, not 18px: prose renders in
the proportional serif face (`--prose-font`, ~16.9px effective size) now, and 18px of leading on that
is a cramped 1.07 ratio — the old default was tuned for 13.5px MONO prose, before the serif face
existed. `1.5` gives a 1.6 ratio, the normal range for serif body text, while staying a **rational
multiple of the row unit** on purpose: two prose lines still span exactly three tree rows, so the
"prose lands on the app's grid" property this token exists to protect survives — now as a 2:3
relationship instead of 1:1, rather than an arbitrary one. (The `doc` string on this key inside
`settingsSchema.ts` itself is stale and still says "Default 1" — that's an in-app string bug, not a
correction to make here; the schema's actual `default:` field, which is what ships, is `1.5`.)

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

The interface is **one monospace family throughout**, with exactly one proportional exception — note prose and chat message bodies, see [The prose face](#the-prose-face---prose-font) below. `appearance.editorFont` is the **mono** face: everything in a note that is not prose (headings, code blocks and inline code, tables, frontmatter, math), plus the editor chrome. `appearance.uiFont` covers rail/tabs/tables/buttons/menus. Each independently picks one of the five Monaspace variants; both default to `Monaspace Xenon`. The setting name maps to a full CSS font stack via `FONT_STACKS` in `app/src/settings.ts`:

| Setting value | CSS font stack | Notes |
|---|---|---|
| `Monaspace Xenon` *(default)* | `'Monaspace Xenon', ui-monospace, monospace` | From `@fontsource/monaspace-xenon`; shipped with Bismuth |
| `Monaspace Neon` | `'Monaspace Neon', ui-monospace, monospace` | From `@fontsource/monaspace-neon`; shipped with Bismuth |
| `Monaspace Argon` | `'Monaspace Argon', ui-monospace, monospace` | From `@fontsource/monaspace-argon`; shipped with Bismuth |
| `Monaspace Krypton` | `'Monaspace Krypton', ui-monospace, monospace` | From `@fontsource/monaspace-krypton`; shipped with Bismuth |
| `Monaspace Radon` | `'Monaspace Radon', ui-monospace, monospace` | From `@fontsource/monaspace-radon`; shipped with Bismuth |

`app/src/index.tsx` imports the 400/500/700 weights of all five variants at boot, so any variant is available instantly regardless of which one is selected. `--editor-font` receives `editorFont`'s stack, `--ui-font-stack` receives `uiFont`'s stack (with a static literal fallback in `app/src/ui/ui.css :root` for first paint, before settings load). `font-variant-ligatures: none` is set app-wide (`App.css`, html/body) — Monaspace's coding ligatures (`->`, `!=`) would otherwise break the character grid the design leans on.

### The prose face (`--prose-font`)

Note prose (both the CodeMirror and Milkdown surfaces) and chat message bodies render in a **proportional serif** rather than the mono stack. It is **not** a setting — there is no enum, no `.settings` key, and no user choice; it is three tokens in `app/src/styles/tokens.css`:

| Token | Value | Meaning |
|---|---|---|
| `--prose-font` | `'CMU Serif', Georgia, serif` | The one proportional face — CMU Serif (Computer Modern, Knuth's LaTeX face). |
| `--prose-scale` | `1.28` | Optical-size compensation. A serif and a mono at the same nominal px do not read at the same size, so without this, moving prose off the mono stack silently shrinks every note. Re-derived per face from measured x-height and `n` advance — it is not a constant that survives a face swap. |
| `--prose-font-size` | `calc(var(--editor-font-size) * var(--prose-scale))` | **Derived, never a literal.** The user's `appearance.editorFontSize` still moves prose with it. |

The scope is deliberately narrow: prose bodies only. Headings, tables, code spans, frontmatter and every `ui/` primitive are pulled back to `--editor-font` in `Editor.css`, `BlockEditor.module.css` and `ChatTranscript.module.css`.

The family is declared in `app/src/styles/cmu.css` — four `@font-face` rules (400/700 × upright/italic) pointing at the `computer-modern` package's woff2 files — rather than importing that package's own stylesheet, which declares upright faces as `font-style: roman` (not a CSS value; browsers only render it via error recovery) and its "regular" at weight 500. CMU Serif ships **two real weights**, 400 and 700; anything else is a synthesised weight.

The family string in `--prose-font` must match `cmu.css` verbatim. A name that does not resolve falls silently through to the `Georgia` fallback with no error anywhere. `app/src/ui/gallery/FontSpecimen.tsx` is the story that exercises the face (reading sizes, both weights, italic, lining vs. oldstyle numerals) and carries the same string — it lies rather than fails if the two drift apart.

The `--mono-scale` var (default `1`) is a legacy optical-size correction from the serif-prose era (it shrank mono text to match a serif body, and is unrelated to `--prose-scale`, which corrects in the other direction); the mono chrome needs no correction, but the setting and its consumers (inline `<code>`, code blocks) still exist for anyone who wants to tune it.

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

```text
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

Source: `core/src/theme/tokens.ts`, `app/src/themes.ts` (re-export), `app/src/settingsCssVars.ts`, `core/src/schema/settingsSchema.ts`, `app/src/settings.ts`, `core/src/gcal/colors.ts`, `core/src/drawing/theme.ts`, `app/src/export/exportTheme.ts`, `bismuth-design/ascii/design-system/tokens/colors.css`, `bismuth-design/ascii/design-system/tokens/effects.css`, `bismuth-design/ascii/README.md`
