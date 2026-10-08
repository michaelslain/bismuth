# Themes and fonts

Bismuth paints the whole app, the graph and the terminal from one colour theme, and sets type in two font families: a monospace face for the interface and a proportional face for your writing.
You choose both with three keys in `.settings`: `appearance.theme`, `appearance.uiFont` and `appearance.proseFont`.
To change a single colour or size instead, see [design tokens](tokens.md); to build a whole theme, see the [custom themes guide](../guides/custom-themes.md).

```yaml
appearance:
  theme: paper
  uiFont: Monaspace Neon
  proseFont: Lora
```

The app repaints as soon as you save; no reload.

## Pick a theme

| `theme` value | Name | Light or dark | Character |
|---|---|---|---|
| `ink` | Ink (default) | dark | Warm paper ink on charcoal. |
| `paper` | Paper | light | The light counterpart of Ink, with the same inks. |
| `cathode` | Cathode | dark | A phosphor terminal: high contrast, and the only theme that glows. |
| `riso` | Riso | light | Cream paper and indigo ink, print-flat, no glow. |

Set it by editing `.settings`, or from the shell:

```bash
bismuth settings set appearance.theme cathode --vault ~/vault
```

A theme name that is not one of these, and not a valid custom theme of this vault, reads as `ink` without an error.
A theme changes every colour in the app: surfaces, borders, text, the accent, the graph's node colours and edges, category colours for statuses and calendar events, the terminal's colours, and the native scrollbar and form-control appearance.
It does not change the graph's 2D/3D mode or any layout setting.

Exports and drawing paper do not follow the theme: an exported file looks the same wherever it is opened.

## Pick fonts

Two keys choose the families. Every family is bundled with the app, so nothing needs installing.

| Key | Used for | Values | Default |
|---|---|---|---|
| `appearance.uiFont` | All chrome (rail, tabs, buttons, menus, calendar chips) and the monospace parts of a note: code, inline code, frontmatter, math, in-note tags, and config buffers such as `.settings` | `Monaspace Xenon`, `Monaspace Neon`, `Monaspace Argon`, `Monaspace Krypton`, `Monaspace Radon` | `Monaspace Xenon` |
| `appearance.proseFont` | Your writing: note body, headings and tables, chat messages and the chat composer | `Libron`, `IBM Plex Serif`, `Lora`, or any `uiFont` value | `Libron` |

Set `proseFont` to a Monaspace face for an all-monospace editor. A name not in the list reads as the default, with no error. Outside the editor, text written as prose uses the prose face.

Related size keys, all in the [settings reference](reference.md#appearance):

- `appearance.editorFontSize` sets prose size (default 13.5 px).
- `appearance.uiFontSize` sets chrome text size (default 11.5 px).
- `appearance.monoScale` scales the monospace text inside prose (default 1).
- `editor.lineHeight` sets prose line height as a multiple of the 18 px row unit (default 1.25).

A serif and a monospace face at the same pixel size do not look the same size. Bismuth corrects for this with a measured factor per prose face, so changing `proseFont` does not shrink or grow your notes.
Code inside prose is sized at a fixed ratio of the prose text, so it sits at the same visual weight.

## Pick the logo mark

`appearance.icon` chooses the logo in the favicon and the sidebar, independently of the theme: `hopper-crystal` (default), `node-b`, `square-funnel`, `nested-diamonds`, `pinwheel`, `node-crystal`, `lattice`, `diamond-bloom`, `node-diamond`, `octagon-bloom`, `spin-cross`, `tri-bloom`, `radial-graph` or `node-rings`.

## Custom themes

A vault can define its own themes. A custom theme is a partial override of a built-in, so you write only what you change. [The custom themes guide](../guides/custom-themes.md) walks through making one, and [design tokens](tokens.md) lists every token a theme may set.

- File. `<vault>/.themes/<name>.yaml`, one per theme, with optional `label`, optional `extends` (a built-in, default `ink`) and a `tokens:` map. An empty file is valid and is stock `ink`.
- Name. It matches `^[a-z0-9][a-z0-9-]{0,39}$` and cannot be a built-in name.
- Select it. Set `appearance.theme: <name>`, or run `bismuth theme use <name>`. The schema and the editor's lint accept the name only while the theme is valid.
- Precedence. From lowest to highest: the built-in default, the theme's `extends`, the theme's `tokens:`, then `appearance.tokens` in `.settings`. [Precedence](tokens.md#precedence) has the exceptions.
- A broken theme shows `ink`. A file that fails validation, or a name with no file, paints `ink`, like any unknown name. `bismuth theme validate` lists the problems. Low contrast is only a warning.
- Refused files. A theme file or `.themes/` directory that is a symlink is refused, as is a file over 64 KB. A refused file reads `cannot read file: symlink refused` or `cannot read file: not a regular file`.
- iPad and iOS. Custom themes work there too: the in-process backend lists `.themes/` through the same file-access seam.

`.themes/` and its top-level `*.yaml` files appear in the sidebar tree, like `.settings`.

## How it works

`core/src/theme/tokens.ts` owns the built-in themes, so core code (Google Calendar colour mapping, drawing paper and ink, the settings schema) can import them; `app/src/themes.ts` re-exports it for the app.
`THEME_NAMES` is the ordered list (the first, `ink`, is `DEFAULT_THEME`), `THEME_LABELS` the display names, and `THEMES` maps each name to a `ColorTokens` object.
To read another theme's values, open `THEMES` in that file; [design tokens](tokens.md) lists the `ink` defaults of every token.

A `ColorTokens` object requires background, foreground, neutral, accent, border, surface, surface2 and an `accentPalette` (the graph's node ramp: rose, violet, blue, teal, green).
Everything else is optional: structural surfaces, graph colours, terminal colours, glow, category hues and the danger, success and warning trio. `isLight` is set on `paper` and `riso`.
All four built-ins set every optional field explicitly; a theme that omits one gets a colour-mix derivation from `settingsToCssVars`.

Resolution is pure and DOM-free:

- `resolveTheme(name, custom?)` returns the named theme's `ColorTokens`. A built-in name always beats a custom theme of the same name; an unknown name returns `ink`.
- `resolveAppearance(appearance, custom?)` resolves the theme, then writes the colour tokens from `appearance.tokens` over it. Tokens that are not colours go straight to `:root`.
- `semanticTokens` returns the theme's own danger, success and warning, or a light or dark fallback chosen by `isLight`.
- `shadowTokens` returns one flat shadow colour, `--shadow-hard`. The depth cue itself is `--lift`, a zero-blur hard offset defined once in `global.css`.

`settingsToCssVars` in `app/src/settingsCssVars.ts` turns the resolved theme and the settings into one `{ '--var': value }` map, and `applyCssVars` sets it on `document.documentElement` in one pass, together with `color-scheme`.
An inline script in `index.html` applies the same map from the cached settings before the app mounts, so the right theme shows on the first frame.

`CATEGORY_SWATCHES` (the six category hues), `ACCENT_RAMP` and `THEME_ACCENTS` in `tokens.ts` are the single source for the drawing toolbar, the export theme, the Google Calendar colour map and the first-paint fallbacks in `global.css`.

Custom themes: parsing and validation are pure, in `core/src/theme/customTheme.ts`; file reads are in `core/src/theme/themeFiles.ts`.
`GET /themes` returns a `ThemesFeed` of valid themes with their resolved colours, plus the invalid ones with diagnostics ([HTTP reference](../api/http-reference.md#get-themes)).
`app/src/customThemes.ts` holds a signal fed by that route and refetched when an SSE path matches a theme file, so every caller of `resolveTheme` repaints with no reload.

### Fonts

`FONT_STACKS` and `PROSE_SCALES` in `app/src/settings.ts` turn a family name into a CSS stack and an optical scale:

| Family | Stack | `--prose-scale` |
|---|---|---|
| `Libron` | `'Libron', Georgia, serif` | `0.97` |
| `IBM Plex Serif` | `'IBM Plex Serif', Georgia, serif` | `1` |
| `Lora` | `'Lora Variable', Lora, Georgia, serif` | `1.04` |
| Each Monaspace face | `'<name>', ui-monospace, monospace` | `1.04` (the default for a face with no entry) |

The scales come from measured x-heights against Monaspace Xenon. `--prose-font-size` is `calc(var(--editor-font-size) * var(--prose-scale))`, never a literal.
`--code-font-size` is the prose size times `--code-scale` (0.89) times `--mono-scale`, and it is the one size for monospace inside prose. `font-variant-ligatures: none` is set app-wide so Monaspace's coding ligatures do not break the character grid.

A stack must lead with the family name the font package actually declares. Lora's is `Lora Variable`; plain `Lora` resolves nothing and falls silently through to Georgia.
Libron is vendored in `app/src/assets/fonts/libron/` and declared by `@font-face` in `global.css`; the Monaspace families and IBM Plex Serif come from `@fontsource` imports in `app/src/fonts.ts`, and Lora from `@fontsource-variable/lora`.
An export embeds only the prose face its stack names (`proseFacesFor` in `app/src/export/fontFaceCss.ts`).

### Add a built-in theme

1. Add the name to `THEME_NAMES` and a display name to `THEME_LABELS` in `core/src/theme/tokens.ts`. The settings schema imports `THEME_NAMES`, so the enum follows.
2. Add its `ColorTokens` to `THEMES`, setting every optional field. Set `isLight: true` for a light theme.
3. Nothing changes in `settingsCssVars.ts`; its derivations are generic over the tokens.

### Add a font

Add the family to `MONO_FONTS` (extends both `uiFont` and `proseFont`) or to `PROSE_FONTS` (prose only) in `core/src/theme/fontFamilies.ts`, and add its stack to `FONT_STACKS` in `app/src/settings.ts`.
A prose serif also needs a measured `PROSE_SCALES` entry, its `@fontsource` imports in `app/src/fonts.ts` and `app/.storybook/preview.ts`, and its files in the export embedder so exports can ship it. The schema enum, autocomplete and lint follow.

Source: `core/src/theme/tokens.ts`, `core/src/theme/fontFamilies.ts`, `core/src/theme/customTheme.ts`, `core/src/theme/themeFiles.ts`, `core/src/schema/settingsSchema.ts`, `app/src/themes.ts`, `app/src/settings.ts`, `app/src/settingsCssVars.ts`, `app/src/customThemes.ts`, `app/src/fonts.ts`, `app/src/export/fontFaceCss.ts`
