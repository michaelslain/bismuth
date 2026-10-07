# Design tokens

A **token** is one named design choice: a colour, a length, a duration, a font. Every token is a CSS custom property on `:root` in `app/src/global.css`, and the registry in `core/src/theme/designTokens.ts` (`DESIGN_TOKENS`) lists each one with its kind, group, default and a line saying what it paints. After reading this page you can restyle any part of Bismuth by writing a few lines of YAML, with no code change.

**The key is the CSS variable name without the leading `--`.** `--accent` is `accent`, `--sp-3` is `sp-3`, `--r-card` is `r-card`. Keys are lowercase and case-sensitive. To list them all from the shell: `bismuth theme tokens` (see [the CLI reference](../cli/reference.md)).

## Where to set a token

There are two places. Both take the same `tokens:` map and check every value the same way.

**1. In the vault's `.settings`**, under `appearance.tokens`. It applies to this vault, whatever theme is selected:

```yaml
appearance:
  tokens:
    accent: '#ff6b6b'
    r-card: 0
    sp-3: 10px
```

**2. In a theme file**, `<vault>/.themes/<name>.yaml`, under `tokens:`. It applies whenever that theme is selected (`appearance.theme: <name>`). A theme can also say `extends: paper` to start from a built-in. See [the custom themes guide](../guides/custom-themes.md).

```yaml
label: 'Dusk'
extends: paper
tokens:
  accent: '#7a3cff'
  r-card: 4px
```

Quote colours (`'#ff6b6b'`): an unquoted `#` starts a YAML comment and the value is lost. A bare number is fine where a number or a px length is expected (`r-card: 0`, `sp-3: 10`).

Changes repaint the running app live. Deleting a line puts the default (or the theme's value) back.

## Precedence

Lowest to highest: the built-in default in `global.css`, then the theme's `extends` built-in, then the theme's `tokens:`, then `.settings` `appearance.tokens`. A key that is present beats one that is absent.

The legacy `.settings` keys in the next section alias tokens, and a legacy key that is **present** in the file beats the theme. An explicit `appearance.tokens` entry beats its legacy key. Examples:

1. The theme sets `accent: '#111111'` and `.settings` `appearance.tokens` sets `accent: '#ff6b6b'`. Red wins.
2. The theme sets `editor-font-size: 14px` and `.settings` has `appearance.editorFontSize: 16`. The editor is 16px.
3. The same `.settings` also has `appearance.tokens.editor-font-size: 18px`. The editor is 18px.
4. `.settings` sets none of them. The theme's value applies, because an absent legacy key no longer pins its default over a theme.

## Legacy settings keys

Ten older `.settings` keys stay valid and are aliases for tokens. No saved `.settings` changes meaning.

| token | legacy key | kind |
|---|---|---|
| `ui-font-stack` | `appearance.uiFont` | font-mono |
| `prose-font` | `appearance.proseFont` | font-prose |
| `mono-scale` | `appearance.monoScale` | number |
| `editor-font-size` | `appearance.editorFontSize` | length |
| `fs-ui` | `appearance.uiFontSize` | length |
| `prose-line-height` | `editor.lineHeight` | number |
| `icon` | `appearance.iconSize` | length |
| `cursor-width` | `appearance.cursorWidth` | length |
| `cursor-glide` | `appearance.cursorGlideMs` | duration |
| `cursor-blink` | `appearance.cursorBlinkSeconds` | duration |

Values for the legacy keys are checked against the schema's min and max; a value outside them is skipped. A legacy font key holds the family name.

## What a value may be

Each token has a **kind**, which fixes what a valid value looks like. A value that fails is an **error**. In `.settings` the bad key is dropped and the rest apply. In a theme file the theme is invalid and the app paints `ink` until it validates. An unknown key is only a warning, with a did-you-mean hint, and is ignored. In `.settings` the warning reads `unknown token: <key>`; in a theme file it reads `<key>: unknown token, ignored (did you mean <key>?)`.

Nothing that could escape a declaration is accepted: no `;`, braces, `<`, `>`, `!`, `@`, quotes, backslashes, comments, `url(...)` or `expression`.

| kind | accepts | valid | invalid |
|---|---|---|---|
| `color` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, numeric `rgb()` / `rgba()` / `hsl()` / `hsla()`, `transparent` | `'#93BDB0'`, `rgba(147, 189, 176, 0.12)` | `purple`, `var(--x)` on a field token |
| `length` | a number plus `px`, `rem`, `em`, `%`, `ch`, `vh` or `vw`; a bare number means px; `var(--registered)`; `calc()` / `min()` / `max()` / `clamp()` over registered vars | `6px`, `0.5em`, `10` | `big`, `6pt` |
| `number` | a plain number; `var(--registered)` | `1.5` | `1.5x` |
| `duration` | a number plus `ms` or `s`; a bare number means ms; `var(--registered)`; `calc()` / `min()` / `max()` / `clamp()` over registered vars | `120ms`, `0.2s`, `70` | `fast` |
| `easing` | `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `step-start`, `step-end`, `cubic-bezier(x1, y1, x2, y2)` with `x1` and `x2` between 0 and 1; a whole `var(--registered)` | `cubic-bezier(0.2, 0, 0, 1)` | `bouncy` |
| `shadow` | `none`, a CSS shadow (offsets, optional blur and spread, a colour), several layers joined by commas; a whole `var(--registered)` | `2px 2px 0 rgba(0, 0, 0, 0.4)` | `2px 2px` (no colour) |
| `border` | `none`, `<length> <solid\|dashed\|dotted\|double> <colour>`; a whole `var(--registered)` | `1px solid #3a3e4a` | `thick red` |
| `gradient` | a `linear-gradient(...)` / `radial-gradient(...)` of at least two stops: plain colours, `var(--registered)`, angles and percentages | `linear-gradient(120deg, #c98ca8, #8296c6)` | `url(a.png)` |
| `font-mono` | one bundled Monaspace family name | `Monaspace Neon` | `Comic Sans` |
| `font-prose` | one of `IBM Plex Serif`, `Lora` or a Monaspace family | `Lora` | `Georgia` |
| `scheme` | `light` or `dark` | `light` | `auto` |

Colour tokens come in two flavours:

- **Field tokens** are read by JavaScript (the graph canvas, the terminal, Google Calendar), so they accept **plain colours only**.
- **CSS-only colour tokens** also accept `var(--registered)` and `color-mix(...)`.

Where a value references `var(--x)`, `x` must be a registered token.

In a theme file an error reads like `sp-3: not a length: big (6px, 0.5em, or a number of px)`. In `.settings` the message is the same, `not a length: big (6px, 0.5em, or a number of px)`, on the `appearance.tokens.sp-3` diagnostic with no key prefix, and every bad token is reported individually.

## Tokens by group

Every row below comes from `DESIGN_TOKENS`; `core/test/theme/tokensDoc.test.ts` fails if a row's kind, default or description disagrees with the registry. **default** is what Bismuth paints at default settings (the `ink` theme's value for a colour).

### surface

| key | kind | default | what it paints |
|---|---|---|---|
| `bg` | color | `#15161A` | Canvas behind everything. |
| `surface-1` | color | `#20222A` | First raised surface: cards, panels. |
| `surface-2` | color | `#272A33` | Second raised surface: inputs, wells. |
| `surface-3` | color | `#31353F` | Third raised surface: pressed and selected fills. |
| `panel` | color | `#20222A` | Panel fill (same as surface-1 in every built-in theme). |
| `rail` | color | `#101116` | Sidebar and top strip, a notch under the canvas. |
| `editor` | color | `#191A1F` | Main note pane. |
| `pop-bg` | color | `rgba(25,26,31,.88)` | Floating cards: legends, graph cards, pickers. |
| `pop-bg-strong` | color | `rgba(25,26,31,.94)` | Floating cards that must stay legible over busy content. |
| `scrim-bg` | color | `rgba(10,11,14,.6)` | Veil behind command, quick and template overlays. |
| `overlay-bg` | color | `rgba(10,11,14,.6)` | Backdrop behind modals. |
| `hover-bg` | color | `rgba(232,227,214,.05)` | Hover tint on rows and buttons. |
| `border` | color | `#3A3E4A` | The standard line between regions. |
| `border-soft` | color | `#282B34` | A hairline one notch softer than border. |
| `term-bg` | color | `#101116` | Terminal background (a dark panel in every theme). |
| `color-scheme` | scheme | `dark` | light or dark: the browser color-scheme and the light/dark branch of derived surfaces. |
| `skeleton-ink` | color | `color-mix(in srgb, var(--faint) 22%, transparent)` | Loading placeholder ink: the bars and blocks of a skeleton. |
| `skeleton-ink-faint` | color | `color-mix(in srgb, var(--faint) 16%, transparent)` | The quieter second step of placeholder ink, for a skeleton's secondary blocks. |

### text

| key | kind | default | what it paints |
|---|---|---|---|
| `fg` | color | `#E8E3D6` | Primary text. |
| `text-muted` | color | `#9C998E` | Secondary text and graph edges. |
| `faint` | color | `#827F78` | Tertiary and disabled text. |
| `term-fg` | color | `#C9C4B6` | Terminal text. |
| `label-halo` | color | `#15161A` | Halo behind graph labels. |
| `on-accent` | color | `#15161A` | Text on a solid accent fill. |
| `on-scrim` | color | `#fff` | Text over a photo scrim; white in every theme. |

### accent

| key | kind | default | what it paints |
|---|---|---|---|
| `accent` | color | `#93BDB0` | The one accent: focus, selection, links, primary buttons. |
| `accent-soft` | color | `rgba(147,189,176,0.12)` | Accent tint behind a selected tab or row. |
| `accent-purple` | color | `#A190C4` | Editor syntax and task accent; the graph ramp violet. |
| `grad` | gradient | `linear-gradient(120deg, #C98CA8, #A190C4, #8296C6, #83B4AE, #A3BE8C, #CBB27E)` | The iridescent gradient on the wordmark and hero marks. |
| `selection` | color | `color-mix(in srgb, var(--accent) 38%, transparent)` | Text selection highlight. |

### graph

| key | kind | default | what it paints |
|---|---|---|---|
| `graph-0` | color | `#C98CA8` | Graph node ramp, slot 0 (rose). |
| `graph-1` | color | `#A190C4` | Graph node ramp, slot 1 (violet). |
| `graph-2` | color | `#8296C6` | Graph node ramp, slot 2 (blue). |
| `graph-3` | color | `#83B4AE` | Graph node ramp, slot 3 (teal). |
| `graph-4` | color | `#A3BE8C` | Graph node ramp, slot 4 (green). |
| `graph-bg` | color | `#121317` | Graph canvas ground. |
| `graph-edge` | color | `#3C4048` | Graph edges. |
| `node-cold` | color | `#4A4E58` | Graph nodes with no hue: untagged and far. |
| `node-self` | color | `#E8E3D6` | The open note in the local graph. |
| `vignette-edge` | color | `#0D0E11` | Graph depth vignette, at the edge. |
| `map-sea` | color | `#272A33` | Bases offline map: water. |
| `map-land` | color | `#20222A` | Bases offline map: land. |
| `map-coast` | color | `color-mix(in srgb, #93BDB0 45%, #20222A)` | Bases offline map: coastline. |
| `map-grid` | color | `color-mix(in srgb, #E8E3D6 12%, transparent)` | Bases offline map: graticule. |

### category

| key | kind | default | what it paints |
|---|---|---|---|
| `teal` | color | `#83B4AE` | Category hue: statuses, event categories, map pins, chart series. |
| `blue` | color | `#8296C6` | Category hue: blue. |
| `violet` | color | `#A190C4` | Category hue: violet. |
| `green` | color | `#A3BE8C` | Category hue: green. |
| `gold` | color | `#CBB27E` | Category hue: gold. |
| `rose` | color | `#C98CA8` | Category hue: rose. |

### semantic

| key | kind | default | what it paints |
|---|---|---|---|
| `danger` | color | `#C87F72` | Destructive actions and errors. |
| `success` | color | `#A3BE8C` | Success and done. |
| `warning` | color | `#CBB27E` | Caution. |
| `warning-soft` | color | `color-mix(in srgb, #CBB27E 7%, transparent)` | Faint caution tint behind a box that needs attention. |
| `warning-edge` | color | `color-mix(in srgb, #CBB27E 45%, transparent)` | Caution tint for the outline of a box that needs attention. |

### state

| key | kind | default | what it paints |
|---|---|---|---|
| `state-hover-bg` | color | `color-mix(in srgb, var(--fg) 8%, transparent)` | Row or button under the pointer. |
| `state-active-bg` | color | `color-mix(in srgb, var(--fg) 14%, transparent)` | Row or button being pressed: the one pressed fill for list rows and chips. |
| `state-selected-bg` | color | `var(--accent-soft)` | Selected row or tab fill. |
| `state-selected-fg` | color | `var(--accent)` | Selected row or tab text. (no consumer yet) |
| `state-focus-ring` | shadow | `inset 0 0 0 1px var(--accent)` | Keyboard focus drawn inside a control. (no consumer yet) |
| `state-disabled-op` | number | `0.45` | The one sanctioned opacity-as-state: it dims the sidebar toolbar while the switcher is active (`shell/AppFrame.module.css`), a whole non-interactive region. The text of a disabled control is still `--faint` ink alone, because any opacity over `--faint` falls under the 3:1 UI floor. No other state is shown by opacity. |
| `focus-ring` | border | `2px solid var(--accent)` | Keyboard focus outline. |
| `focus-ring-offset` | length | `1px` | Gap between a control and its focus outline. (no consumer yet) |

### effect

| key | kind | default | what it paints |
|---|---|---|---|
| `glow-accent` | shadow | `0 0 0 1px rgba(147,189,176,0.14)` | Accent bloom; only cathode really glows. |
| `glow-text` | shadow | `none` | Text bloom; only cathode uses it. |
| `shadow-hard` | color | `rgba(0,0,0,.45)` | The flat shadow colour that lift composites against. |
| `lift` | shadow | `2px 2px 0 var(--shadow-hard)` | Hard-offset drop shadow under menus, popups and cards. |
| `lift-start` | shadow | `-2px 2px 0 var(--shadow-hard)` | The mirror of lift for a panel on the right edge, so its depth cue falls inside the window. |
| `hud-fps-good` | color | `#3fb950` | FPS meter: healthy frame rate. Theme-independent. |
| `hud-fps-ok` | color | `#d29922` | FPS meter: borderline frame rate. Theme-independent. |
| `hud-fps-bad` | color | `#f85149` | FPS meter: slow frame rate. Theme-independent. |
| `field-noise-op` | number | `.45` | Opacity of the graph field texture. |
| `intro-glyph-scale` | number | `1.3333` | Largest scale the first-run intro's glyph art is drawn at. A 24-row art box over an 18-row scene is exactly 4/3; GlyphCanvas caps its fit here, then snaps down onto whole device pixels. |
| `z-local` | number | `1` | Stacking inside one component: a handle over its sibling. |
| `z-overlay` | number | `20` | Pane overlays: the chat panel, the switcher, drop cues. |
| `z-shell` | number | `100` | Shell chrome over the panes: the tab rail and the sidebar edge. |
| `z-modal` | number | `1000` | The modal band: scrim and panel, shared with the drag ghost. A modal sits over the shell. |
| `z-toast` | number | `1050` | Toasts: above a modal, because a notification must be seen, and below a popover, so a toast never covers an open menu. |
| `z-popover` | number | `1100` | Popovers and menus: tops the stack, because a menu can open inside a modal and must sit over it. |

### callout

| key | kind | default | what it paints |
|---|---|---|---|
| `callout-note` | color | `#448aff` | Callout [!note] accent. Theme-independent. |
| `callout-tip` | color | `#00bfa5` | Callout [!tip] accent. |
| `callout-success` | color | `#21c065` | Callout [!success] accent. |
| `callout-question` | color | `#e0a526` | Callout [!question] accent. |
| `callout-warning` | color | `#ef8e2c` | Callout [!warning] accent. |
| `callout-failure` | color | `#e5484d` | Callout [!failure] accent. |
| `callout-danger` | color | `#e93147` | Callout [!danger] accent. |
| `callout-bug` | color | `#e93147` | Callout [!bug] accent. |
| `callout-example` | color | `#a371f7` | Callout [!example] accent. |
| `callout-quote` | color | `#9aa0a6` | Callout [!quote] accent. |
| `callout-abstract` | color | `#00b8d4` | Callout [!abstract] accent. |
| `callout-todo` | color | `#448aff` | Callout [!todo] accent. |
| `callout-important` | color | `#00b8d4` | Callout [!important] accent. |

### font

| key | kind | default | what it paints |
|---|---|---|---|
| `ui-font-stack` | font-mono | `Monaspace Xenon` | UI + mono font family (all chrome, code, frontmatter, math, tags). Legacy: appearance.uiFont. |
| `prose-font` | font-prose | `IBM Plex Serif` | Prose font family (note body, headings, tables, chat). Legacy: appearance.proseFont. |
| `prose-scale` | number | `1` | Size correction measured for the prose face, so prose reads at one optical size. |
| `mono-scale` | number | `1` | Optical-size factor for the mono font, 0.6 to 1. Legacy: appearance.monoScale. |
| `glyph-scale` | number | `1.25` | Size of glyph art relative to its cell. |
| `code-scale` | number | `0.89` | Mono text size relative to the prose around it. |

### type-scale

| key | kind | default | what it paints |
|---|---|---|---|
| `fs-nano` | length | `9.5px` | Smallest text. |
| `fs-micro` | length | `10.5px` | Fine print and captions. |
| `fs-ui` | length | `11.5px` | Chrome text: tabs, menus, rows, 11 to 16px. Also scales the ASCII cell width. Legacy: appearance.uiFontSize. |
| `fs-body` | length | `13px` | Dense body text. |
| `fs-body-lg` | length | `13.5px` | Prose body text. |
| `fs-lead` | length | `15px` | Lead paragraphs. |
| `fs-title` | length | `19px` | Titles. |
| `fs-display` | length | `24px` | Display headings. |
| `fs-hero` | length | `40px` | Hero text. |
| `fs-hero-xl` | length | `48px` | Largest hero text. |
| `fs-wordmark-display` | length | `96px` | The brand wordmark as a slide's whole picture (the first-run intro). |
| `fs-h1` | length | `max(var(--fs-display), var(--editor-font-size))` | Note heading 1. |
| `fs-h2` | length | `max(var(--fs-title), var(--editor-font-size))` | Note heading 2. |
| `fs-h3` | length | `var(--editor-font-size)` | Note heading 3. |
| `fs-h4` | length | `var(--editor-font-size)` | Note heading 4. |
| `fs-h5` | length | `min(var(--fs-body), var(--editor-font-size))` | Note heading 5. |
| `fs-h6` | length | `min(var(--fs-body), var(--editor-font-size))` | Note heading 6. |
| `editor-font-size` | length | `13.5px` | Note prose size, 11 to 28px. Legacy: appearance.editorFontSize. |

### weight

| key | kind | default | what it paints |
|---|---|---|---|
| `fw-regular` | number | `400` | Regular weight. |
| `fw-medium` | number | `500` | Medium weight. |
| `fw-bold` | number | `600` | Bold weight. |
| `fw-h1` | number | `var(--fw-bold)` | Heading 1 weight. |
| `fw-h2` | number | `var(--fw-bold)` | Heading 2 weight. |
| `fw-h3` | number | `var(--fw-bold)` | Heading 3 weight. |
| `fw-h4` | number | `var(--fw-medium)` | Heading 4 weight. |
| `fw-h5` | number | `var(--fw-medium)` | Heading 5 weight. |
| `fw-h6` | number | `var(--fw-medium)` | Heading 6 weight. |

### line-height

| key | kind | default | what it paints |
|---|---|---|---|
| `lh-tight` | number | `1.4` | Tight line height. |
| `lh-ui` | number | `1.7` | Chrome line height. |
| `lh-prose` | number | `1.6` | Prose line height where the editor setting does not apply. |
| `lh-grid` | number | `1` | Character-grid line height; one cell tall. |
| `prose-line-height` | number | `1.25` | Note prose line height, 0.8 to 1.8. Legacy: editor.lineHeight. |

### tracking

| key | kind | default | what it paints |
|---|---|---|---|
| `ls-eyebrow` | length | `.14em` | Letter spacing of eyebrow labels. |
| `ls-label` | length | `.06em` | Letter spacing of small labels. |
| `ls-display` | length | `-.01em` | Letter spacing of display text. |

### spacing

| key | kind | default | what it paints |
|---|---|---|---|
| `sp-1` | length | `2px` | Spacing step 1. |
| `sp-2` | length | `4px` | Spacing step 2. |
| `sp-3` | length | `6px` | Spacing step 3. |
| `sp-4` | length | `8px` | Spacing step 4. |
| `sp-5` | length | `12px` | Spacing step 5. |
| `sp-6` | length | `16px` | Spacing step 6. |
| `sp-7` | length | `24px` | Spacing step 7. |
| `optical-nudge` | length | `1px` | One-pixel nudge that centres glyphs optically. |
| `bar-icon-gap` | length | `var(--sp-4)` | Gap between icons in a view bar. |
| `bar-crumb-gap` | length | `var(--sp-5)` | Gap between breadcrumbs in a view bar. |

### size

| key | kind | default | what it paints |
|---|---|---|---|
| `row-h` | length | `18px` | The app row unit: tree rows, tabs, prose lines land on it. |
| `h-row` | length | `18px` | Height of a list row. |
| `h-control` | length | `24px` | Height of a button or field. |
| `h-band` | length | `36px` | Height of a header band. |
| `inset-traffic-lights` | length | `78px` | Start inset of a band that clears the macOS traffic lights (Band inset). |
| `note-column` | length | `620px` | Reading width of a note. |
| `note-gutter` | length | `40px` | Side padding of a note: the editor content inset that the title, frontmatter and chat transcript line up with. |
| `chat-column` | length | `680px` | Reading width of a chat transcript and its composer. |
| `daemon-list-max` | length | `100ch` | Widest an opened daemon section list (crons, services, inbox, log) grows, so all four end at one x. |
| `view-gutter` | length | `var(--sp-5)` | Side gutter of a Bases view body; matches the view bar. |
| `rail-w-collapsed` | length | `46px` | Width of the tab rail when collapsed. |
| `skeleton-bar-h` | length | `var(--sp-5)` | Height of one placeholder bar in a skeleton. |
| `list-max-h` | length | `320px` | Tallest a dropdown list grows before scrolling. |
| `icon` | length | `12px` | Size of every icon, 11 to 20px. Legacy: appearance.iconSize. |
| `bar-icon-size` | length | `18px` | Size of icons in a view bar. |
| `ascii-dash-pitch` | number | `2` | Cells between dashes of an ASCII dashed line. |

### radius

| key | kind | default | what it paints |
|---|---|---|---|
| `r-0` | length | `0` | Square corners. |
| `r-mark` | length | `1px` | Marks and ticks. |
| `r-chip` | length | `2px` | Chips and badges. |
| `r-control` | length | `3px` | Buttons and fields. |
| `r-card` | length | `4px` | Cards. |
| `r-panel` | length | `5px` | Panels. |
| `r-dot` | length | `50%` | Status dots, colour dots, pager dots. |

### rule

| key | kind | default | what it paints |
|---|---|---|---|
| `rule` | border | `1px solid var(--border)` | The standard line. |
| `rule-soft` | border | `1px solid var(--border-soft)` | A hairline. |
| `rule-accent` | border | `1px solid var(--accent)` | An accent line. (no consumer yet) |
| `rule-dashed` | border | `1px dashed var(--border)` | A dashed line. Dashed edges read this, or rule-drop for a drop cue, never a hand-written 1.5px dashed. |
| `rule-drop` | border | `1.5px dashed var(--accent)` | The outline of a place that takes the drop. |
| `rule-soft-dashed` | border | `1px dashed var(--border-soft)` | A dashed hairline. |
| `accent-edge` | border | `2px solid var(--accent)` | The accent bar on the edge of a selected block. |

### motion

| key | kind | default | what it paints |
|---|---|---|---|
| `motion-scale` | number | `1` | Multiplies every CSS transition and animation duration; 0 turns CSS motion off. Not scaled: cursor-blink, cursor-glide and the graph renderer's own morph timings. |
| `dur-fast` | duration | `calc(80ms * var(--motion-scale))` | Fast transitions: hover, press. |
| `dur` | duration | `calc(120ms * var(--motion-scale))` | Standard transitions. |
| `dur-grow` | duration | `calc(140ms * var(--motion-scale))` | A surface growing into another: a daemon-page box opening to fill the page. |
| `dur-pop` | duration | `calc(260ms * var(--motion-scale))` | Popovers and larger movements. |
| `ease` | easing | `cubic-bezier(0.22, 1, 0.36, 1)` | The standard ease-out. |
| `ease-spring` | easing | `cubic-bezier(0.34, 1.56, 0.64, 1)` | A small overshoot. |
| `ease-std` | easing | `ease` | The browser ease curve many components use. |
| `sheen` | duration | `calc(8s * var(--motion-scale))` | Cycle of the idle sheen sweep. |

### popover

| key | kind | default | what it paints |
|---|---|---|---|
| `popover-radius` | length | `var(--r-0)` | Corner radius of menus and popovers. |
| `popover-pad` | length | `4px` | Padding inside a popover. |
| `popover-row-pad-y` | length | `0px` | Vertical padding of a popover row. |
| `popover-row-pad-x` | length | `8px` | Horizontal padding of a popover row. |
| `popover-row-radius` | length | `0` | Corner radius of a popover row. |
| `popover-row-gap` | length | `var(--sp-4)` | Gap between parts of a popover row. |
| `popover-font-size` | length | `var(--fs-ui)` | Popover text size. |
| `popover-min-width` | length | `170px` | Narrowest a popover gets. |
| `popover-selected-bg` | color | `var(--state-selected-bg)` | Fill of the selected popover row. |
| `popover-detail-opacity` | number | `0.5` | Opacity of the secondary text in a popover row. |
| `popover-shadow` | shadow | `var(--lift)` | Shadow under a popover. |

### cursor

| key | kind | default | what it paints |
|---|---|---|---|
| `cursor-width` | length | `2px` | Text cursor bar width, 1 to 4px. Legacy: appearance.cursorWidth. |
| `cursor-glide` | duration | `70ms` | Cursor glide between positions, 20 to 200ms. Legacy: appearance.cursorGlideMs. |
| `cursor-blink` | duration | `1.2s` | Cursor blink cycle, 0.6 to 2s. Legacy: appearance.cursorBlinkSeconds. |

## What is not a token

These are deliberate. Each is either product identity, algorithm tuning or data, not a design choice. Writing one of them under `tokens:` produces an `unknown token` warning and changes nothing.

| group | where | why |
|---|---|---|
| ASCII glyph choices | `app/src/ui/ascii/ (glyph tables and tiles)` | which character draws a rule, corner or marker is the product identity, not a design choice to override |
| Graph-renderer tuning constants | `app/src/graph/AsciiGraphRenderer.ts, asciiGrid.ts, lod.ts` | alphas, the zoom ladder and level-of-detail thresholds are algorithm tuning; changing one changes how the graph reads, not how it is themed |
| Component geometry | `app/src/**/*.module.css` | widths, heights, z-index and component-local --x props belong to one component and are not shared design choices |
| color-mix percentages | `app/src/**/*.module.css, app/src/global.css` | the percentage in a tint is part of the formula that makes the tint; override the colours it mixes instead |
| Terminal glyph-fallback font list | `app/src/Terminal.tsx` | the Nerd Font fallback list is what terminal programs expect to find; the sixteen ANSI colours are NOT listed here because they are derived from tokens (--rail, --danger, --fg and the rest), so a token edit already moves the terminal |
| Export and drawing palettes | `app/src/export/, core/src/drawing/` | exported files and drawings are theme-independent so they look the same wherever they are opened |
| Google event colours | `core/src/gcal/colors.ts` | Google defines these; they are data from another system |
| Chat tab colour swatches | `app/src/chat/chatColors.ts` | per-chat identity colours chosen by the person, stored as data |
| Univer sheet theme variables | `app/src/global.css (--univer-* on .bismuth-sheet, not :root)` | Univer's own --univer-* vars are scoped to the sheet and already derived from tokens (--accent and friends) in CSS, so a token edit reaches the sheet without a token of their own |
| Graph hub-label pill colours | `app/src/GraphView.tsx (labelTextColor, labelBgColor)` | the translucent rgba pill behind graph hub labels is chosen per light or dark theme as a legibility pair over the graph canvas, not a themed colour; label text on light themes does follow --fg |
| PDF page constants | `core/src/theme/tokens.ts (PDF_PAGE_PAPER, PDF_PAGE_RULE, PDF_HIGHLIGHT_YELLOW)` | a PDF page is white paper and a highlight is highlighter yellow in every theme; the margin and highlight fill must match that fixed page, not a theme surface |
| Font metrics | `app/src/global.css (--cell-w, --cell-w-dense, --cell-h-dense)` | they must equal the font's own advance width and line box, so they follow the font and are never a free choice |
| Layout preferences | `.settings (appearance.sidebarWidth, sidebarGraphHeight, tabRailWidth; ui.* widths; calendar.* sizes)` | per-person layout already owned by .settings; a theme setting a drag width would fight the drag |

### `:root` variables that are not tokens

Each of these is set on `:root` but is a font metric, a formula over tokens, or a per-person layout preference. `app/src/tokenRegistry.test.ts` requires every `:root` variable to be either a token or listed here. A trailing `*` is a prefix.

| variable | why |
|---|---|
| `--cell-w` | font metric: the mono advance width, derived from --fs-ui (6.3px at 11.5px), must track the font |
| `--cell-w-dense` | font metric: the advance width at 7px, must track the font |
| `--cell-h-dense` | font metric: the dense line-box height, must track the font |
| `--cell-h` | constraint formula: always equals --row-h; set the row unit instead |
| `--label-col` | constraint formula: 20 cells wide; set the cell metric instead |
| `--prose-font-size` | constraint formula: editor size times the prose scale; set those instead |
| `--code-font-size` | constraint formula: prose size times code scale times mono scale; set those instead |
| `--fs-rel-code` | constraint formula: 1em times code scale times mono scale; set those instead |
| `--sidebar-width` | layout preference: .settings (appearance.sidebarWidth) owns it, and a theme would fight the drag |
| `--sidebar-graph-height` | layout preference: .settings (appearance.sidebarGraphHeight) owns it |
| `--tab-rail-width` | layout preference: .settings (appearance.tabRailWidth) owns it, set by dragging |
| `--palette-top-offset` | layout preference: .settings (ui.paletteTopOffset) owns it |
| `--pane-divider-width` | layout preference: .settings (ui.paneDividerWidth) owns it |
| `--month-cell-min-h` | layout preference: .settings (calendar.monthCellMinHeight) owns it |
| `--time-gutter-width` | layout preference: .settings (calendar.timeGutterWidth) owns it |
| `--card-grid-min` | layout preference: .settings (ui.cardGridMinWidth) owns it |
| `--kanban-col-min` | layout preference: .settings (ui.kanbanColumnMinWidth) owns it |
| `--kanban-col-max` | layout preference: .settings (ui.kanbanColumnMaxWidth) owns it |
| `--map-min-height` | layout preference: .settings (ui.mapMinHeight) owns it |
| `--popover-font` | alias of --ui-font-stack: a font stack is set through the font token, not per surface |

## Related

- [Custom themes guide](../guides/custom-themes.md): the `.themes/<name>.yaml` format and workflow
- [Themes](themes.md): the four built-in themes and how they resolve
- [Settings reference](reference.md#appearance): `appearance.tokens`
