# Handoff: Bismuth — ASCII / terminal redesign

## Overview

A complete visual redesign of **Bismuth** (repo `michaelslain/bismuth`, branch `main`), the
local-first Markdown-vault PKM desktop app. The direction: **the whole interface is drawn on a
monospace character grid.** Anything another product would render as SVG — tree connectors,
progress meters, charts, the knowledge graph — is rasterized into plain ASCII characters
(`- | + / \ # . o @`). One font family (Monaspace) everywhere; two ink steps do all the work;
one accent per view; hairline borders instead of shadows.

This bundle contains the full design system (tokens, pattern CSS, component references,
specimen cards, and an interactive recreation of the app), plus a file-by-file porting plan
for the real Solid/Tauri codebase (`PORTING.md`).

## About the design files

**Everything in `design-system/` is a design reference authored in HTML/CSS/React** — a
prototype of the intended look and behavior, **not production code to copy in**. The
production app is **Tauri + SolidJS + TypeScript + Vite**; the `.jsx` component files here are
React recreations for prototyping only.

The work is to **re-express these designs in the existing codebase's patterns**: Solid
components under `app/src/`, colors through the existing theme pipeline
(`core/src/theme/tokens.ts` → `app/src/settingsCssVars.ts`), chrome through the existing
`app/src/ui/ui.css` primitives. **The CSS in `design-system/tokens/` and
`design-system/patterns.css` is deliberately written on the app's own CSS variable names and
class names** (`--bg --fg --text-muted --faint --border --border-soft --surface-1/2/3 --rail
--editor --accent --accent-soft --on-accent --hover-bg --pop-bg --graph-*`, `.btn--text
.btn--icon .chip-toggle .ui-input .ui-field .ui-overlay .status-text .stars .search-bar`), so
porting is mostly a **value change, not a rename**. See `PORTING.md`.

## Fidelity

**High-fidelity.** Colors, type scale, spacing, corner radii, motion timings, and interaction
states are all final and specified below. Reproduce them exactly. The two places that are
deliberately *not* pixel-final: the sample vault content (notes, filenames, counts — all
placeholder prose) and the exact node placement of the graph field (generated at runtime).

---

## Design tokens

All four theme scopes ship in `design-system/tokens/colors.css`. `.ink` is the default;
`.paper` is its light counterpart; `.cathode` and `.riso` are alternates.

### Grounds, ink, accent

| Token | `.ink` (default) | `.paper` | `.cathode` | `.riso` |
|---|---|---|---|---|
| `--bg` | `#15161A` | `#E9E6E0` | `#05070A` | `#EAE4D4` |
| `--editor` | `#191A1F` | `#F2F0EB` | `#070A0E` | `#F1ECDF` |
| `--rail` | `#101116` | `#E3E0D9` | `#020304` | `#E1DACA` |
| `--surface-1` / `--panel` | `#20222A` | `#EFEDE8` | `#0C1116` | `#E3DCC8` |
| `--surface-2` | `#272A33` | `#E1DDD5` | `#121A20` | `#DBD3BC` |
| `--surface-3` | `#31353F` | `#D3CEC5` | `#18242B` | `#CFC5AA` |
| `--border` | `#3A3E4A` | `#C4BEB3` | `#1B3A38` | `#B9AE92` |
| `--border-soft` | `#282B34` | `#D8D3C9` | `#112524` | `#CFC6AE` |
| `--fg` | `#E8E3D6` | `#2E2C29` | `#DDF3EA` | `#22285E` |
| `--text-muted` | `#9C998E` | `#6E6A63` | `#6FA69A` | `#5E628C` |
| `--faint` | `#6A675E` | `#9A958C` | `#3F5F58` | `#948F86` |
| `--accent` | `#93BDB0` | `#4E7F73` | `#35F0E0` | `#2E36A8` |
| `--accent-soft` | `rgba(147,189,176,.12)` | `rgba(78,127,115,.12)` | `rgba(53,240,224,.12)` | `rgba(46,54,168,.12)` |
| `--on-accent` | `#15161A` | `#F2F0EB` | `#05070A` | `#F1ECDF` |
| `--hover-bg` | `rgba(232,227,214,.05)` | `rgba(46,44,41,.05)` | `rgba(53,240,224,.07)` | `rgba(34,40,94,.06)` |

**Three ink steps, and only three.** `--fg` = anything you read. `--text-muted` = anything you
scan. `--faint` = structure (rules, connectors, empty meter cells) — **never body content**.

### Category ramp (categorical, not semantic)

`.ink`: `--teal #83B4AE` · `--blue #8296C6` · `--violet #A190C4` · `--green #A3BE8C` ·
`--gold #CBB27E` · `--rose #C98CA8`. Graph ramp `--graph-0…4` = rose, violet, blue, teal,
green in that order. Semantic status stays separate: `--danger #C87F72`, `--success #A3BE8C`,
`--warning #CBB27E`. Full per-scope values in `tokens/colors.css`.

### Glow

`--glow-text` / `--glow-accent` are **theme decisions**, not component ones. `.ink`, `.paper`
and `.riso` set `--glow-text: none` and a flat 1px accent rim for `--glow-accent`. Only
`.cathode` turns on real bloom (`0 0 12px rgba(53,240,224,.35)` / `0 0 8px
rgba(53,240,224,.28)`). Components must always read the token, never hardcode a shadow.

### Typography (`tokens/typography.css`)

**Monaspace, all five variants, nothing else.** Xenon (slab) is canonical; Neon, Argon,
Krypton and Radon are user-selectable and metric-compatible, so switching never reflows the
grid. Prose uses mono too — `--editor-font: var(--ui-font-stack)`. Lora survives only as a
legacy stack (`--font-serif`).

| Token | Value | Use |
|---|---|---|
| `--fs-micro` | 10.5px | eyebrows, meta, legends, status bar |
| `--fs-ui` | 11.5px | rail, tabs, tables, chrome — the workhorse |
| `--fs-body` | 13px | note prose in panels |
| `--fs-body-lg` | 13.5px | note prose in the editor column |
| `--fs-lead` | 15px | section heads inside prose |
| `--fs-title` | 19px | panel titles |
| `--fs-display` | 24px | note titles — the one big size |

Line heights: `--lh-tight 1.4` / `--lh-ui 1.7` / `--lh-prose 1.9` / `--lh-grid 1` (ASCII
fields — line-height must equal the cell height). Weights 400/500/600. Tracking: eyebrows
`.14em` uppercase, labels `.06em`, display `-.01em`; **body text is never tracked**. Nothing
below 10.5px ships. Ligatures are off app-wide (`font-variant-ligatures: none`).

### Spacing & fixed chrome (`tokens/spacing.css`)

Scale: `4 / 6 / 8 / 12 / 16 / 22 / 30` (`--sp-1…7`). Window reference **1320×858**.
Top strip 40px · view bar 46px · status bar 26px · left rail 266px · right tab rail 46px
collapsed / 232px open · prose column 620px · inspector panel 300px. Rows 22px, controls 30px,
icon button 28px, minimum hit target 24px.

### Corners, borders, elevation, motion (`tokens/effects.css`)

Radii: chip 2px, control 3px, card 4px, panel 5px. **Nothing is pill-round except status
dots.** Two border weights: `--rule` (1px `--border`, structure) and `--rule-soft` (1px
`--border-soft`, row rules). `--accent-edge` (2px solid accent) marks exactly two things: the
frontmatter block and a callout/proposal. Shadows exist only for things that float
(`--shadow-menu/popup/card/modal`). Motion: `--dur-fast 120ms`, `--dur 150ms`, ease
`cubic-bezier(.2,.6,.3,1)`; two named loops only — `--blink 1.1s` (step-end caret) and
`--sheen 8s` (wordmark gradient).

### The character grid (`tokens/ascii.css`)

`--cell-w 6.3px` / `--cell-h 11px` at `--fs-ui`; dense field `4.2px` / `7px` at 7px.
**If you change a field's font size you must change both the cell width and the line-height,
or the drawing shears.** Glyph vocabulary: `-` `|` `|--` `` `-- `` `+` `/` `\` `_` (caret),
`#` (meter filled), `.` (meter empty). Node degree ramp: `.` leaf → `o` linked → `@` hub.
Field opacities: noise `.45` under edges at `1`. **Do not substitute Unicode box-drawing
characters** — plain ASCII renders identically in the terminal, in exports, and in a `.md`.

---

## Components & their states

Class library: `design-system/patterns.css` (261 lines, sectioned to match `app/src/ui/`).
Reference implementations: `design-system/components/**` (`.jsx` + `.d.ts` + `.prompt.md` per
component). Live specimens: `design-system/guidelines/*.card.html`.

**Buttons** (`.btn` + `.btn--text|--icon` + `.btn--normal|--selected|--unselected`, tone
`--danger`, sizes `--sm|--lg`). Text buttons: `padding 2px 9px`, radius 3px, **1px border**,
UPPERCASE, `--fs-micro`, tracking `.06em`. normal = `--fg`; unselected = `--faint`; selected /
primary = `--accent` text on `--accent-soft` with an accent border (primary adds
`--glow-accent`). Hover = `--hover-bg` wash and text lifting to `--fg`. Icon buttons are
borderless, 14px, radius 3px; unselected sits at `opacity .5`.

**SegmentedToggle** — text buttons butted together sharing one rule (inner left borders
removed, only the outer corners rounded).

**Chip** (`.chip-toggle`) — `padding 1px 6px`, radius 2px, 1px border, `--fs-micro`. Selected
tints to accent; `tone-{teal|blue|violet|green|gold|rose}` tints to a category hue at 14%
fill / 45% border.

**Form controls** — `.ui-input`: `--surface-2` fill, hairline border, radius **3px**,
`padding 6px 8px`, mono at `--fs-ui`. Focus = accent border + `0 0 0 2px var(--accent-soft)`.
`.search-bar` has an accent lead glyph. `.ui-field` is a stacked label + control, 4px gap.

**Overlays** — `.ui-overlay` scrim (`--overlay-bg`); `.asc-modal` / `.asc-popover` use
`--pop-bg-strong` / `--pop-bg` with `backdrop-filter: blur(6px)`, a 1px rule, 5px radius, and
`--shadow-modal` / `--shadow-popup`. `.asc-menurow` rows go accent-on-`--accent-soft` when
hovered or active, with right-aligned key caps.

**Cards & prose** — `.asc-card`: `--surface-1`, 1px rule, 4px radius, `12px 14px` padding,
**no shadow in flow**. `.asc-card--proposal`, `.asc-frontmatter` and `.asc-callout` add the
2px left accent border. `.asc-prose` is 13.5px / 1.9 with a **ruled underline** in `--border`
at 5px offset — the page reads as lined paper, not a card. Wikilinks are accent, tags gold.

**Kbd** — a keybinding is a run of individual caps (`.asc-key`, min-width 16px, height 15px,
2px bottom border), not one box; adjacency is the chord. Parses the app's own combo syntax
(`Mod+Shift+D`) with `Mod` → ⌘/Ctrl. Caps recede (transparent, 1px bottom) inside menu rows.

**Eyebrow** (`.asc-eyebrow`) — the system's section label: **inverse video** (`--fg` ground,
`--bg` text), uppercase, `.14em` tracking. `VAULT`, `DAEMON INBOX`, `BACKLINKS 4`.

**Wordmark** (`.asc-wordmark`) — the word "bismuth" in the `--grad` six-stop sheen, 200%
background-size traversed over 8s. The only decorative flourish in the system; also the only
place `--grad` appears outside the active-tab rule and the agent avatar.

**ASCII primitives** (`components/ascii/`) — `Glyph`, `AsciiTree` (`|--` / `` `-- `` rows,
hover wash, active row accent), `AsciiMeter` (`[####......]`, filled accent / empty faint),
`AsciiChart`, `GraphField` (noise layer under Bresenham-rasterized `- | / \` edges with `+`
junctions, cleared under every edge and label), `TabRail` (vertical right-hand strip, glyphs
collapsed, names expanded).

**Iconography** — two registers, and which one a name lands in is a deliberate call
(`app/src/icons/registry.ts`).

*Typed characters* carry **surface identity and chrome**. One small Unicode glyph names each
surface in both the tab rail and the vault tree: `⁘` graph · `✎` note · `▤` base · `▦` calendar
· `◈` agent · `✳` daemon · `▸` folder. Window controls are `[-] [+] [x]`; collapse handles
`<<` / `>>`; close is `x`; buttons are bracketed lowercase `[ accept ]`; keyboard caps use
`⌘ ⌥ ↵ ↑ ↓ esc`. A few semantic names keep their ASCII form too, because the literal syntax IS
the better drawing: `[ ]` / `[x]` task checkboxes, `.*` regex, `Aa` case-sensitive, `S` sigma.
No emoji, ever.

*Pixel art* carries **everything else** — toolbar, command catalog, palettes, pickers, view
toolbars. 112 icons from HackerNoon's Pixel Icon Library (CC BY 4.0, see
`docs/overview/third-party-notices.md`), drawn on a 24px grid, flattened to single paths and inlined by
`app/scripts/build-pixel-icons.ts` — no icon font, no sprite, no runtime dependency. They fill
with `currentColor` and render with `shape-rendering: crispEdges`, which is what keeps the
pixels hard at the 12–18px boxes the app actually asks for; it is safe only because every path
in the set is axis-aligned. The bitmap grid is the same discipline as the character grid, which
is why this reads as one system rather than as icons bolted onto a text UI.

---

## Screens

Every screen below has a specimen card in `design-system/guidelines/` and appears in the
interactive kit at `design-system/ui_kits/bismuth-app/index.html`.

- **App shell** — 40px top strip (wordmark + `[-] [+] [x]`), 266px vault rail (eyebrow-labelled
  sections, ASCII tree), main pane, 46px right tab rail, 26px status bar (field-log lines and
  a blinking caret).
- **Editor** — 620px centred prose column, 24px note title, 2px-accent frontmatter block,
  ruled-underline prose, wikilinks/tags inline, backlinks section below.
- **Knowledge graph** — full-bleed `--graph-bg` field. Nodes are glyphs whose **weight is their
  degree** (`.` → `o` → `@`), coloured by cluster from the ramp. **Zoom is resolution, not
  scale**: character size never changes, the grid subdivides — 0% is fit, 100% is maximum
  resolution with every note named. Modes: `2nd` / `3rd` / `both` / `agents` / `daemon`.
- **Bases** — 12 view kinds, one card each: table, list, cards, kanban, bullets, stat, bar,
  line, heatmap, map, calendar, flashcards. The flashcards card is a working SM-2 review
  (space reveals; 1/2/3 = hard/good/easy; CARDS + CRAM modes). The calendar card carries
  month/week/3-day/day with a real toolbar and category chips.
- **Chat** — a notebook transcript, **not bubbles**: uppercase turn labels, serif-register
  prose in the reading column, collapsible thinking, tool one-liners with left-ruled excerpts,
  a permission callout (the one chrome affordance), turn footer, composer.
- **Daemon inbox** — a **list, never cards**: status dot, title, source tag
  (`cron:answer-emails`), relative time, one-line body snippet, the page's own action buttons.
  Three sections: Needs review (due, oldest first) / Scheduled (read-only) / Recently resolved
  (collapsed). Status ∈ `pending · working · done · failed · dismissed`. No confidence scores,
  no diffs — the page body *is* the proposal, in prose.
- **Overlays** — command palette, quick switcher (⌘O), modal, menu/popover.

---

## Interactions & behavior

- **Hover**: `--hover-bg` wash, text lifts `--text-muted` → `--fg`. No scale, no bounce.
- **Selected**: `--accent-soft` fill, accent border, accent text (plus `--glow-text` where the
  theme defines one).
- **Focus**: accent border + `0 0 0 2px var(--accent-soft)`.
- **Transitions**: 120ms / 150ms, `cubic-bezier(.2,.6,.3,1)`, on colour and border only.
- **Loops**: exactly two — the 1.1s step-end caret blink (`_` in terminal, chat, status bar,
  active tree row) and the 8s wordmark sheen. Nothing else animates indefinitely.
- **Graph zoom**: re-rasterizes at a finer grid rather than scaling glyphs (see above).
- **Empty states**: uppercase `--fs-ui` heading, centred, muted body, one bracketed action.

## State

Nothing new. The redesign is presentational: it re-skins existing state
(active tab, selected row, graph mode + zoom, tab rail collapsed/open, flashcard queue
position, inbox section collapse). The one genuinely new piece of persisted state is the
**Monaspace variant** user setting (`face-xenon … face-radon`) — see `PORTING.md` §2.

## Assets

- **Fonts**: Monaspace Xenon / Neon / Argon / Krypton / Radon, CDN-linked via fontsource in
  `tokens/fonts.css` (`design-system/monaspace-family.css` carries the `@font-face` set). Lora
  is referenced only as a legacy stack. **A local-first desktop build should bundle these
  locally** and swap the `@font-face` rules.
- **Icons / images**: no icon font, no sprite, no photography, no illustration. Surface
  identity and chrome are typed characters; every other icon is inlined pixel art on a 24px
  grid (CC BY 4.0, `docs/overview/third-party-notices.md`) — see **Iconography** above.
- **Brand mark**: none exists in the repo. `app/src/assets/logo.svg` is the **SolidJS starter
  logo** left over from Vite, not a Bismuth mark — do not treat it as branding. The wordmark
  is rendered in type.

## Files in this bundle

```
README.md                          this document
PORTING.md                         file-by-file plan for michaelslain/bismuth
design-system/
  styles.css                       global entry — @imports every token file + patterns.css
  patterns.css                     the class library (app class names + .asc-* additions)
  tokens/fonts.css                 @font-face for the five Monaspace variants (+ Lora)
  tokens/colors.css                the four theme scopes, on the app's variable names
  tokens/typography.css            stacks, size scale, tracking, .face-* variant scopes
  tokens/spacing.css               spacing steps + the fixed chrome measurements
  tokens/effects.css               radius, borders, elevation, motion
  tokens/ascii.css                 cell metrics + the glyph vocabulary
  components/core|forms|display|ascii/   React references (.jsx + .d.ts + .prompt.md each)
  guidelines/*.card.html           specimen cards — colors, type, spacing, ASCII, overlays,
                                   brand, and one per Bases view kind, chat, inbox
  ui_kits/bismuth-app/index.html   interactive full-app recreation (open this first)
  design-system.html               index of every specimen card
  readme.md                        the design system's own guide (voice, foundations, rules)
  Bismuth ASCII - App.dc.html      the app prototype this system was authored against
```

**Start here:** open `design-system/ui_kits/bismuth-app/index.html` for the whole app, then
`design-system/design-system.html` for the specimen index, then read `PORTING.md`.
