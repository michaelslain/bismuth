---
name: Bismuth
description: A local-first markdown vault drawn on a monospace character grid
colors:
  ground-charcoal: "#15161A"
  editor-ground: "#191A1F"
  rail-ground: "#101116"
  surface-1: "#20222A"
  surface-2: "#272A33"
  surface-3: "#31353F"
  border: "#3A3E4A"
  border-soft: "#282B34"
  ink-paper: "#E8E3D6"
  ink-muted: "#9C998E"
  ink-faint: "#827F78"
  accent-sage: "#93BDB0"
  on-accent: "#15161A"
  category-teal: "#83B4AE"
  category-blue: "#8296C6"
  category-violet: "#A190C4"
  category-green: "#A3BE8C"
  category-gold: "#CBB27E"
  category-rose: "#C98CA8"
  danger: "#C87F72"
  success: "#A3BE8C"
  warning: "#CBB27E"
typography:
  display:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.01em"
  title:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
  lead:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  ui:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: ".14em"
  prose:
    fontFamily: "Lora Variable, Lora, Georgia, serif"
    fontSize: "calc(var(--editor-font-size) * 1.04)"
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: "Monaspace Xenon, ui-monospace, monospace"
    fontSize: "calc(var(--prose-font-size) * 0.89)"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0"
  dot: "50%"
spacing:
  sp-1: "2px"
  sp-2: "4px"
  sp-3: "6px"
  sp-4: "8px"
  sp-5: "12px"
  sp-6: "16px"
  sp-7: "24px"
  row: "18px"
  control: "24px"
  band: "36px"
components:
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink-paper}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "0"
    height: "24px"
  button-text-unselected:
    textColor: "{colors.ink-faint}"
  button-text-selected:
    textColor: "{colors.accent-sage}"
  button-text-primary:
    textColor: "{colors.accent-sage}"
    fontWeight: 600
  button-text-danger:
    textColor: "{colors.danger}"
  chip-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
    height: "24px"
  card:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
  modal:
    backgroundColor: "{colors.editor-ground}"
    borderColor: "{colors.border}"
    rounded: "{rounded.none}"
  popover:
    backgroundColor: "{colors.editor-ground}"
    rounded: "{rounded.none}"
    padding: "4px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink-paper}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    height: "{spacing.control}"
    borderColor: "{colors.border-soft}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    rounded: "{rounded.none}"
    height: "{spacing.control}"
  status-dot:
    rounded: "{rounded.dot}"
governance:
  framework: solid
  source: [app/src]
  components:
    match: "**/[A-Z]*.tsx"
    exclude: ["**/*.stories.tsx", "**/*.test.tsx", "**/_*"]
  stylesheets:
    match: "**/*.module.css"
    importersExempt: ["**/*.stories.*", "**/*.test.*", "**/_*"]
  tokens:
    # tokens.ts owns every colour; tokens.css holds the first-paint copy of the ink theme plus the
    # whole geometry / type / motion scale; settingsCssVars.ts projects the selected theme at runtime
    files: [core/src/theme/tokens.ts, app/src/global.css, app/src/settingsCssVars.ts]
    use: "var(--"
  # classes built OUTSIDE the bundler, so :global() is the only spelling available —
  # RUNTIME_CLASS_PREFIXES in app/src/cssLayering.test.ts, the same list, plus xterm's own DOM
  externalClasses: ["bismuth-*", "callout-*", "cm-*", "xterm*"]
  global:
    - app/src/global.css           # the ONE global stylesheet — tokens, reset, runtime-HTML
                                    # classes, app shell chrome, the ASCII (asc-*) register,
                                    # CodeMirror/xterm/Univer theming, the switcher and
                                    # popover runtime literals — each former file its own
                                    # clearly commented section (one-global-stylesheet, Task 14)
  primitives:
    dir: app/src/ui
    elements:
      p: Text
      span: Text
      h1: Heading
      h2: Heading
      h3: Heading
      h4: Heading
      h5: Heading
      h6: Heading
      button: Button
      input: Field
      textarea: Field
      select: Field
      label: Label
  stories:
    sibling: "{name}.stories.tsx"
    exempt:
      - app/src/index.tsx          # boot entry; mounts the app, nothing to render in isolation
  checks: {}
---

# Design System: Bismuth

## Overview

**Creative North Star: "Typed, Not Drawn"**

Bismuth is a markdown vault whose whole interface sits on a monospace character grid. Anything
another product would draw as SVG (tree connectors, progress meters, charts, the knowledge graph
itself) is typed from plain characters: `|--` and `` `-- `` for trees, `[####......]` for meters,
`- | / \` with `+` at junctions for graph edges. The grid is the layout engine, so the chrome uses
one monospace family and a single 18px row unit, and every taller band is a whole multiple of it.

Inside that terminal chrome, the note is the one place that changes register: prose, note
headings, note tables and chat bodies are set in a serif on lined paper. Everything that is
mechanism (code, frontmatter, tags, math) goes back to mono. The system is dense and quiet: three
ink steps, one accent per view, hairline rules instead of shadows, square corners. The one
decorative flourish is the iridescent bismuth sheen, which appears only on the wordmark and a few
chrome accents.

The system ships as four themes over one set of token names: **Ink** (the default, dark: warm
paper ink on charcoal), **Paper** (its light counterpart), **Cathode** (hot phosphor terminal, the
only theme that glows) and **Riso** (cream paper and indigo ink, print-flat). The frontmatter
records Ink. `core/src/theme/tokens.ts` holds all four and is the only source of colour.

**Key Characteristics:**
- One monospace family (Monaspace, Xenon by default) for all chrome; one serif (Lora) for note prose.
- An 18px row unit (`--row-h`); controls are 24px, bands are 36px.
- Three ink steps: read (`--fg`), scan (`--text-muted`), structure (`--faint`).
- One accent per view. The six-hue ramp means *category*, never decoration.
- Square corners everywhere. The only curve is the round status dot.
- No blur and no soft shadow. The one depth cue is a hard 2px offset (`--lift`).

## Colors

A charcoal ground, a warm paper ink and one sage accent do all the work; the six category hues
are for data that genuinely has categories.

### Primary
- **Sage Teal** (`--accent`): the view's one voice. Selected state, the primary action, the focus
  ring, the frontmatter and callout left edge (`--accent-edge`). Its 12% wash (`--accent-soft`) is
  the selected-row fill, and `--on-accent` is the ink that sits on a solid accent.

### Neutral
- **Charcoal Ground** (`--bg`): the canvas.
- **Editor Ground** (`--editor`): the note surface, one step lifted from the canvas.
- **Rail Ground** (`--rail`): the sidebar and terminal, one step sunk below it.
- **Surfaces 1 / 2 / 3** (`--surface-1`, `--surface-2`, `--surface-3`): cards, panels, and
  nested fills, in that order of depth.
- **Border** (`--border`): structural rules. **Soft Border** (`--border-soft`): hairline row rules.
- **Paper Ink** (`--fg`): anything you read.
- **Muted Ink** (`--text-muted`): anything you scan (metadata, secondary labels, graph edges).
- **Faint Ink** (`--faint`): structure only (rules, tree connectors, empty meter cells, resting glyphs).

### Category ramp
- **Teal, Blue, Violet, Green, Gold, Rose** (`--teal` `--blue` `--violet` `--green` `--gold`
  `--rose`): Bases statuses, calendar categories, map pins, chart series and graph clusters.
  The graph ramp is a fixed five of them: rose, violet, blue, teal, green.

### Semantic
- **Danger / Success / Warning** (`--danger` `--success` `--warning`): status only. They share
  hues with the category ramp in Ink but are separate tokens, so recolouring a category never
  recolours a destructive button.

### Named Rules
**The Three Inks Rule.** Text has exactly three steps. `--fg` is read, `--text-muted` is scanned,
`--faint` is structure and never carries content a user must read.

**The One Voice Rule.** One accent per view, and at most one `primary` button per view.

**The Categorical Ramp Rule.** A ramp hue means "this belongs to group N". It is never used to make
something prettier, and it is never used for danger or success.

**The Single Source Rule.** Colour is defined in `core/src/theme/tokens.ts` and nowhere else. The
literals in `app/src/styles/tokens.css` are a first-paint copy of Ink, which `themeGuard.test.ts`
keeps byte-identical. A component stylesheet only ever reads `var(--…)`.

## Typography

**Chrome Font:** Monaspace Xenon (with `ui-monospace, monospace`); the user may pick any of the
five metric-compatible Monaspace variants (`appearance.uiFont`), so the grid never reflows.
**Prose Font:** Lora Variable (with `Lora, Georgia, serif`), via `appearance.proseFont`.
**Icon Font:** Symbols Nerd Font Mono, never user-selectable.

**Character:** a slab mono doing the work of a terminal, and a warm book serif for the part a
person actually wrote. The two never mix within one register.

### Hierarchy
- **Hero** (40px `--fs-hero`, 48px `--fs-intro-title`): the vault intro and the wordmark only; never in app chrome.
- **Display** (600, 24px `--fs-display`): note titles; the one big size in chrome.
- **Title** (600, 19px `--fs-title`): panel titles.
- **Lead** (15px `--fs-lead`): section heads in chrome; also the editor's first-paint size.
- **Body** (13px `--fs-body`): prose inside panels.
- **UI** (11.5px `--fs-ui`, line-height 1.7): the workhorse. Rail, tabs, tables, menus, popovers,
  and every `[text button]`.
- **Label / Micro** (10.5px `--fs-micro`, uppercase, `.06em`–`.14em` tracking): eyebrows,
  status bar, legends. Nothing in the app is set smaller.
- **Prose** (`--prose-font-size` = the user's editor size × 1.04): note body, note headings,
  note tables, chat messages and the chat composer.
- **Code** (`--code-font-size` = prose × `--code-scale` 0.89, × the user's `monoScale`): every mono
  run inside a note or a chat message — code blocks and both fence rows, frontmatter, inline code
  (`--fs-rel-code`, the same ratio off `1em`), `#tags`, task checkboxes and fields, list and syntax
  marks. One step below prose because Monaspace at prose x-height is 24% wider and carries 16% more
  ink than Lora; 0.89 is ink parity. KaTeX output is not code and keeps its own size.

### The content heading ramp
Markdown headings in every surface read `--fs-h1` … `--fs-h6`. h1/h2 are never smaller than prose,
h3/h4 sit *at* prose size and separate by weight, h5/h6 drop into label register (caps, tracking,
muted). The ramp is relative to the user's editor size, so it holds at every setting.

### Named Rules
**The Heading-Never-Shrinks Rule.** A heading is never smaller than the prose it heads. Consume
`--fs-h*`; never copy the numbers into a consumer.

**The Register Rule.** Prose is serif; anything pulled back out of prose (code, frontmatter,
`#tags`, math source) returns to `--ui-font-stack` at ONE size, `--code-font-size` — never the
prose size, never a per-construct size.

**The One Fence Rule.** A frontmatter `---` and a code block's ```` ``` ```` keep their own
characters but are one row style: same size, padding, height and dim fence tone; the code fence's
language label is fence text in that tone. YAML keys read muted in both blocks.

**The Untracked Body Rule.** Uppercase labels are widely tracked; body text is never tracked.

## Layout

Fixed desktop chrome on a vertical rhythm of 18px rows: a sidebar tree row, a tab's hit height,
a graph list row and a line of note prose are all one `--row-h`. Controls (buttons, selects,
inputs, chips) are `--h-control` (24px). Bands (the top strip, view bars, the sidebar toolzone)
are `--h-band` (36px, two rows), so a horizontal ruler through the app lands on a row boundary.

Spacing runs on a dense 2/4/6/8 grid (`--sp-1` … `--sp-7`: 2, 4, 6, 8, 12, 16, 24px). It is denser
than an 8-grid product on purpose.

The sidebar is 266px wide and collapses by animating the registered `--sidebar-w` property; the
vertical tab rail overlays leftward on hover rather than reflowing the editor.

**`ViewBar` is the one view header** (graph, Bases, calendar, flashcards, chat), with six named
slots: `identity` `locus` `facet` lead, `readouts` `config` `actions` trail. When it narrows,
controls drop in a single shared ladder that a control opts into with `data-bar-drop`.

### Named Rules
**The Row Unit Rule.** Every repeated row is `--row-h`; every taller band is a whole multiple of it.

**The Zoom-Is-Resolution Rule.** In the graph, a character never changes size. Zooming re-rasterizes
the field at a finer grid.

## Elevation & Depth

Flat by default. Depth comes from tonal steps (rail → ground → editor → surfaces 1–3) and hairline
borders, not shadows. Nothing in the app is blurred. Things that genuinely float get exactly one cue.

### Shadow Vocabulary
- **Lift** (`--lift`: `2px 2px 0 var(--shadow-hard)`): a zero-blur, hard-offset "TUI drop-shadow"
  for surfaces that float directly over live content with no scrim (popovers, context menus,
  autocomplete). `--shadow-hard` is projected per theme and is more opaque on light themes, since
  an unblurred shadow otherwise disappears.
- **Glow** (`--glow-accent`, `--glow-text`): a theme decision, not a component one. Ink, Paper and
  Riso set a flat 1px accent rim and no text glow; only Cathode blooms.

### Named Rules
**The No-Blur Rule.** No `blur()` in a shadow and no `backdrop-filter`. Modals sit on a scrim
(`--overlay-bg`) and need no shadow; popovers get `--lift`, and nothing else does.

**The Token-Not-Shadow Rule.** Components read `--lift` or `--glow-*`; they never write a shadow literal.

## Shapes

Every corner is square (`--r-0`), whether chip, control, card, panel, modal or popover. The only
curve is a genuine circle (status dots, at 50%). Lines are one of four named rules: `--rule`
(structure), `--rule-soft` (row hairline), `--rule-accent`, `--rule-dashed` (drop cues). A 2px
accent left edge (`--accent-edge`) marks exactly two things: the frontmatter block and a
callout/proposal.

Icons are 24px-grid pixel art rendered `crispEdges` at a single size (`--icon`, 12px — the `appearance.iconSize` setting; no call site passes its own), so the bitmap
grid stays as hard as the character grid.

### Named Rules
**The Square Corner Rule.** Radius is `0` or `50%`. The older `--r-chip` / `--r-control` /
`--r-card` / `--r-panel` steps (2–5px) are deprecated aliases awaiting removal; new code never
reads them.

## Components

Terse and technical: borderless at rest, and state is shown by swapping the background or drawing
the accent. An outline appears only when it means something.

### Buttons
- **Shape:** square (`--r-0`), fixed 24px height in every variant, so text and icon buttons line up.
- **Text button:** `[label]` — a lowercase `--fs-ui` label, untracked, with the brackets tight to
  the word and no space inside. No border, no fill, no horizontal padding: **the brackets are the
  edge.** The 24px height is an invisible hit area, so buttons still line up with rows. An icon
  goes inside the brackets: `[✓ label]`. One size only.
- **States are colour and weight, nothing drawn:** `normal` `--fg`; `unselected` (a toggle member
  that is off) `--faint`; `selected` `--accent` + bold (or `accent`, if set); `primary` `--accent`
  + bold, at most one per view; `danger` `--danger`; disabled `--faint` with no hover.
- **Hover:** `unselected` lifts to `--text-muted`; states already at full ink underline the label
  (1px) instead of changing colour.
- **Spacing:** sibling bracket buttons sit `--sp-4` apart — about one monospace cell — so a focus
  ring never touches the next `[`.
- **Toggles are brackets too:** a segmented control is a row of `[option]` buttons `--sp-4`
  apart; the on option is `selected` (accent + bold), the rest `unselected`. Icon-only tool
  groups (the drawing dock, the embedded-graph icon groups) are the same bracket idiom, rendered
  `[▣]` per option — there is no separate butted look any more.
- **`accent` recolours a selected toggle** (a category's own colour).
- **Hierarchy:** `selected` and `primary` paint alike (accent + bold); `primary` is the one
  confirming action in a footer or view, `selected` is a toggle member that is on. A `[cancel]`
  is `normal`.
- **Focus:** a 2px accent outline (`--focus-ring`) around the glyphs, on `:focus-visible` only.
- **Icon button:** a separate register, no box — `[▣]`, the pixel icon set between generated
  `[`/`]` bracket glyphs (same device as the text button's brackets, and hidden from the
  accessible name the same way). Brackets rest at `--faint`; both brackets and glyph move to
  `--accent` on hover/`:focus-visible`; `selected` paints accent brackets and icon together. A
  24px square hit area minimum outside a bar; inside a view bar the brackets draw at `--fs-ui`,
  26px wide.

### Chips
- **Chip toggle:** no box (no border, no fill) — `[label]` bracket text in the same register as
  the text button and `SegmentedToggle`'s bracket look. Unselected `--faint`, selected tints
  brackets + label to `--accent` or, with a `tone`, to that category's own hue.
- **Segmented toggle:** a row of `[option]` buttons `--sp-4` apart, same bracket idiom; the on
  option is `selected` (accent + bold). Icon-only tool groups (the drawing dock) render each
  option as a bracket icon button, `[▣]`, the same idiom rather than a separate look.
- **On/off toggle row** (`ToggleRow`, settings-form checkboxes): a full `--row-h` row rendering
  `[x]` checked / `[ ]` unchecked (`BracketToggle`) — no box fill, just the bracket glyph flipping.

### Cards / Containers
- **Card:** `--surface-1` fill, `--rule` hairline, square, `12px 16px` padding, no shadow.
  A `proposal` card adds the 2px accent left edge.
- **Callout:** the same accent left edge on a surface fill.

### Inputs / Fields
- **Underline fields, shared with the search field:** every text input, select trigger and prompt
  input in the app is the same idiom — transparent, no fill, no box outline. At rest the field is
  underlined `--rule-soft` full-width; on focus the underline firms from `--rule-soft` to the
  neutral `--rule` (never an accent line — an autofocused field, which a modal's first control
  always is, would otherwise read as a permanent coloured divider). Placeholder is always
  `--faint`, height `--h-control`. `Select` composes the identical trigger and reads `value ▾` on
  the same underline.
- **Search field (`SearchBar`):** the one variant that also carries a leading prompt glyph — a
  typed terminal prompt line, not a boxed input. A `/` glyph (`>` for the command palette) in
  `--accent` leads the input by one monospace cell and turns bold on focus (the glyph is the only
  thing that still moves on focus; the underline itself follows the shared neutral rule above).
  The field is set in the same type size as the results under it; its three densities
  (`compact`/`default`/`large`) change padding, never text size, and in the palette and switcher
  the prompt glyph sits on the rows' icon column.
- **Settings-form field (`SettingsField`):** a row pairing a label column (`--text-muted`,
  `--fs-ui`, text only — no icon) with the control on the same row, keyed to one shared
  `--label-col` token so every field in a form starts its control at the same x, whether or not it
  sits inside a `SettingsGrid`. `span` drops the row for a stacked label-above-control column when
  a control is too wide to share it.
- **Section rule (`SettingsSection`):** reads `── name ─────────` — a two-cell leading rule, the
  lowercase name in `--faint`, then a `--rule-soft` hairline trailing to the edge.
- **Hint (`SettingsHint`):** sits under its control, in the same column as the control it
  describes, `--faint`, `--fs-micro`.
- **Required / optional badge:** plain text on the label line, inline after the label (wraps with
  it rather than pinning to the row's right edge), no box — `req` in `--accent`, `opt` in
  `--faint`.

### Overlays
- **Modal (`FormModal`):** the one dialog shell in the app — the old `PromptModal`/`CardsModal`
  variants are gone. A single `--rule` hairline frame on `--pop-bg-strong` (translucent editor
  ground), square, no shadow, over the `--overlay-bg` scrim. Composed from `ModalHeader` /
  `ModalBody` / `ModalFooter`, which between them draw one continuous frame rather than three
  stacked boxes.
- **`ModalHeader`** IS the frame's top edge: `┌─ title // subtitle ─────────[x]┐`, one hairline
  broken only by the title/subtitle text and the close control, joining the panel's side borders
  at the corners — no stub rule above it, no second line below it. Title `--fg`, `// subtitle`
  `--faint`, both lowercase `--ui-font-stack` at `--fs-ui`; `tone="danger"` paints the title
  `--danger`. Close is `[x]`, a `TextButton` holding the letter x — never an icon, never a boxed ✕. On open, focus lands on
  the modal's first body control, never on the close button, so mount never draws an accent box
  on `[x]`.
- **`ModalFooter`:** a full-width `--rule` divider meeting the panel's side borders (never a
  `--rail` fill band). Actions only — no keybind hints (`esc`, `↵`) anywhere in a modal; every
  modal ends in a real dismiss button (`[cancel]` / `[close]` / `[done]`). Leading edge: leading
  actions (delete, reset); trailing edge: the primary/secondary actions.
- **Popover / menu:** `--pop-bg` with a hairline and `--lift`; 4px inner padding, rows at `--row-h`
  with `8px` horizontal padding, selection in `--state-selected-bg` and accent text.

### Navigation
- **ViewBar:** the single view header (see Layout). **Tab rail / top strip / sidebar:** `--fs-ui`
  mono on `--rail`, rows at `--row-h`; the active tab carries the sheen rule.
- **Keyboard caps** (`Kbd`) use `⌘ ⌥ ↵ ↑ ↓ esc`.

### ASCII primitives (signature)
`Glyph`, `AsciiTree`, `AsciiMeter` and `GraphField` (in `app/src/ui/ascii/`) draw structure as
text on the cell grid (`--cell-h` = the row unit). Graph node weight *is* degree: `.` leaf, `o`
linked, `@` hub, coloured by cluster from the ramp, over a noise field at 45% opacity that clears
under every edge and label.

## Do's and Don'ts

### Do:
- **Do** compose `app/src/ui/` primitives (`Text`, `Heading`, `Label`, `Button`, `Field` …) instead
  of writing a bare `<p>`, `<span>`, `<h*>`, `<button>` or `<input>` with a class. If none fits,
  the primitive is missing: add it.
- **Do** read every colour, font, radius, shadow and duration through a token (`var(--…)`).
- **Do** size rows to `--row-h`, controls to `--h-control` and bands to `--h-band`.
- **Do** type structure (`|--`, `[####....]`, `- | / \ +`) rather than drawing it.
- **Do** give every component a colocated `.module.css` imported only by that component, and a sibling story.
- **Do** use the `//` separator in chrome, not `·`.
- **Do** move with `--dur-fast` (80ms) / `--dur` (120ms) on `--ease`; the only loops are the 1.1s
  caret blink and the 8s wordmark sheen.

### Don't:
- **Don't** write a hex, `rgb()` or named colour in a component stylesheet.
- **Don't** round a corner, blur anything, or add a soft shadow.
- **Don't** use a ramp hue decoratively, or a semantic hue to mean a category.
- **Don't** use `--faint` for content a user must read.
- **Don't** put more than one accent or one `primary` button in a view.
- **Don't** use emoji in chrome, or add photography, illustration or hand-drawn SVG.
- **Don't** retype the Monaspace stack; read `--ui-font-stack` (or `--prose-font`).
- **Don't** set anything smaller than 10.5px, or track body text.
- **Don't** import another component's stylesheet. A second importer means a component nobody
  extracted: extract it, and never copy the stylesheet.
