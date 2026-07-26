# Bismuth ASCII — Design System

The design system for **Bismuth**, a local-first personal-knowledge-management desktop app
(internally *"Three Brains"*). Bismuth is a Markdown vault editor where notes, a knowledge
graph, agents, and a background daemon stitch a person's thinking together over time.

This system documents the **ASCII/terminal direction**: the whole interface is drawn on a
monospace character grid. Structure that other products would render as SVG — tree
connectors, progress bars, charts, and the knowledge graph itself — is rasterized into
plain ASCII characters instead.

## Sources

- **GitHub:** `michaelslain/bismuth` (branch `main`) — the production app.
  - `core/src/theme/tokens.ts` — **the color source of truth** (12 themes, semantic +
    shadow tokens, the category swatch ramp). Read, not copied.
  - `app/src/settingsCssVars.ts` — projects a theme onto `:root` as `--*` custom
    properties. **Every variable name in `tokens/colors.css` comes from here**, so porting
    this direction is a value change, not a rename.
  - `app/src/ui/` — the component inventory (`ui.css`, `buttonClass.ts`, `palette.ts`,
    and one `.tsx` per primitive). This system builds exactly those families.
  - `app/src/icons/registry.ts`, `seedNames.ts` — the icon registry.
- **Stack:** Tauri + SolidJS + TypeScript + Vite. Components here are React recreations for
  prototyping — port to Solid for production.
- **Predecessor:** the earlier "Bismuth Design System" (oxide-duotone / CATHODE) remains a
  separate project; this one supersedes its visual direction, not its structure.

---

## CONTENT FUNDAMENTALS — how Bismuth writes

Two registers coexist and must not be blended.

**1. Chrome — terse, lowercase-technical, factual.** UI labels mirror files and commands:
`~/vault`, `reading.base`, `settings.yaml`, `daemon: idle`, `md · utf-8`. Counts are
stated plainly and precisely: "318 files scanned in 12ms", "614 edges", "3 proposals ·
last run 03:14 · 1.8s". Section labels are **UPPERCASE, widely tracked**, in inverse video:
`VAULT`, `NIGHTJAR`, `DAEMON INBOX`, `BACKLINKS 4`. Buttons are bracketed lowercase:
`[ accept ]`, `[ dismiss ]`, `[ review 9 ]`.

**2. Prose — first-person, quiet, literary.** Sample note content reads like a journal, never
like a productivity tool: *"I walked the long way home and let the day unspool behind me."*
*"The graph remembers what I don't."* *"The quiet between entries is not emptiness — it is the
part the agent fills in for me."* The app almost never says "you"; it gets out of the way.

**Status lines are a third, narrow register** — a field log. Lowercase, one clause per line,
terminated with a period, no subject: "vault index rebuilt.", "9 orphans pruned.", "embedding
drift within tolerance.", "no unresolved links.", then "daemon idle…" with a blinking caret.

**Vocabulary.** *vault, note, wikilink `[[…]]`, tag `#…`, brain (2nd/3rd), daemon, agent,
base, graph, backlink, orphan, spaced repetition, proposal.* Filenames are identifiers:
`2029-09-15 journal`, `CLAUDE`, `DAEMON`.

**Brains are provenance, not display modes.** Bismuth's three-brain model is literal: **You**
(the self node), **2nd brain** (the vault — markdown with wikilinks, tags, YAML frontmatter),
**3rd brain** (the daemon's memory graph under `<vault>/.daemon/memory`, shown as `mem:` nodes
with `about` edges, only when the daemon is enabled). Any UI that filters by brain is filtering
by **authorship**, and the graph's own modes are `2nd` / `3rd` / `both` / `agents` / `daemon`.

**The daemon inbox is a list of PAGES, not proposals.** A daemon page is an ordinary markdown
note the daemon authored at `<vault>/.daemon/pages/<slug>.md`, with `actions[]` in its
frontmatter, asking to be approved or dismissed. The inbox has three sections — **Needs review**
(due, oldest first), **Scheduled** (a future `deliverAt`, read-only), **Recently resolved**
(collapsed). A row is a status dot, title, source tag (`cron:answer-emails`), relative time, a
one-line snippet of the body, and the page's own action buttons. Status is one of
`pending · working · done · failed · dismissed`. **Rows are a list, never cards**, and there are
no confidence scores or diffs — the page body is the proposal, in prose.

**The word "bismuth"** in prose renders with the iridescent sheen gradient. It is the only
decorative flourish in the system.

**Emoji: none.** Not in chrome, not in content. Unicode is used only where a glyph is the
icon (see ICONOGRAPHY) and for keyboard caps (`⌘ ⌥ ↵`).

---

## VISUAL FOUNDATIONS

**The premise.** The interface is a character grid. Every structural line is a real character
(`-`, `|`, `+`, `/`, `\`), every tree is `|--` and `\`--`, every meter is `[####......]`,
every chart is a row of `#`. Nothing is drawn that could be typed. This is why the system
uses one monospace family everywhere: the grid is the layout engine.

**Color.** Two-ink thinking. A ground, an ink, and one accent doing all the work; the six-hue
ramp is reserved for *categorical* meaning (graph clusters, statuses, tags) and never for
decoration. Four scopes ship:

| Scope | Ground | Ink | Accent | Mood |
|---|---|---|---|---|
| `.ink` (default) | `#15161A` charcoal | `#E8E3D6` warm paper | `#93BDB0` sage-teal | riso, but dark |
| `.paper` | `#E9E6E0` warm greige | `#2E2C29` | `#4E7F73` | the light counterpart |
| `.cathode` | `#05070A` pure black | `#DDF3EA` phosphor | `#35F0E0` cyan | hot CRT terminal |
| `.riso` | `#EAE4D4` cream | `#22285E` indigo | `#2E36A8` | print-flat |

Text has exactly three steps — `--fg` (read it), `--text-muted` (scan it), `--faint`
(structure only, never content). Category hues (`--teal --blue --violet --green --gold
--rose`) are the app's `PALETTE_TOKENS` and stay distinct from semantic
`--danger/--success/--warning`.

**Type.** **Monaspace**, all five variants, nothing else. Xenon (slab) is canonical; Neon,
Argon, Krypton and Radon are selectable per user setting and metric-compatible, so switching
never reflows the grid. Put a `.face-*` scope class (`face-xenon` … `face-radon`, from
`tokens/typography.css`) on `<html>` or any subtree to swap the face. Sizes: 10.5 micro / 11.5 UI / 13–13.5 prose / 15 lead / 19 panel
title / 24 note title. Nothing below 10.5px. Eyebrows are uppercase at `.14em` tracking;
body text is never tracked. Lora survives only as a legacy prose stack.

**Prose gets a ruled underline** (`text-decoration` in `--border`, 5px offset) — the page is
lined paper, not a card.

**Spacing & layout.** Fixed desktop chrome at 1320×858: a 40px top strip, a 266px left rail,
46px view bars, a 26px status bar, and a right tab strip that is 46px collapsed / 232px open.
Prose columns are constrained to 620px. Spacing scale: 4 / 6 / 8 / 12 / 16 / 22 / 30.

**Corners are technical.** 2px chips, 3px controls, 4px cards, 5px panels. Nothing is
pill-round except status dots.

**Cards** are a `--surface-1` fill with a **hairline border and no shadow** in flow. A 2px
left accent border marks exactly two things: the frontmatter block and a callout/proposal.
Elevation is reserved for things that actually float (popovers, modals), which also get a
translucent ground plus `backdrop-filter: blur(6px)`.

**Borders & shadows.** Two weights only: `--border` (structure) and `--border-soft`
(hairline row rules). Shadow is depth-on-dark, never grey haze.

**Texture & glow are a theme decision.** `--glow-text` / `--glow-accent` are `none` in Ink,
Paper and Riso; only Cathode turns on phosphor bloom. Components always read the token, never
hardcode a shadow. Scanlines exist only inside the graph field, never over the whole app.

**Gradients.** One: `--grad`, the six-stop bismuth sheen. It appears on the wordmark, the
active-tab rule and the agent avatar. Never as a panel background.

**Hover / press.** Hover is a faint ink wash (`--hover-bg`) and text lifting muted → `--fg`.
Selected is `--accent-soft` with an accent border and accent text. No scale, no bounce.

**Animation.** Two durations (120/150ms, `cubic-bezier(.2,.6,.3,1)`) plus two named loops:
a 1.1s step-end caret blink and the 8s wordmark sheen. Nothing else loops.

**The graph.** A flat `--graph-bg` ground (no gradient) sets the field apart. Nodes are glyphs whose
weight *is* their degree (`.` leaf → `o` linked → `@` hub), colored by cluster from the
ramp. Edges are Bresenham-rasterized into `- | / \` with `+` at junctions; the noise field
underneath sits at 45% opacity and is cleared under every edge and label. **Zoom is
resolution, not scale**: character size never changes, the grid subdivides — 0% is fit,
100% is maximum resolution with every note named.

**No imagery.** No photography, no illustration, no hand-drawn SVG. If something needs
picturing, it is typed.

---

## ICONOGRAPHY

The production app ships an icon **registry** (`app/src/icons/registry.ts` +
`seedNames.ts`) with a `SymbolGallery` picker. This direction replaces rendered icons with
**typed glyphs** in most chrome:

- **ASCII first.** Window controls are `[-] [+] [x]` (macOS: the same brackets, tinted
  red/gold/green on the left). Tree connectors are `|--` and `\`--`. Buttons are
  `[ accept ]`. Meters are `[####......]`. Collapse handles are `<<` / `>>`. Close is `x`.
- **A small unicode glyph set** carries surface identity where ASCII would be ambiguous —
  one glyph per surface, used in both the tab rail and the vault tree:
  `⁘` graph · `✎` note · `▤` base · `▦` calendar · `◈` agent · `✳` daemon · `▸` folder.
- **Keyboard caps** use `⌘ ⌥ ↵ ↑ ↓ esc` in a `.asc-kbd`.
- **No icon font, no sprite, no SVG set ships in this system.** Nothing is hand-drawn.
- **No emoji**, ever, in chrome.
- **No brand mark.** The app selects one of 14 runtime marks and none of them are committed.
  The one SVG in the repo — `app/src/assets/logo.svg` — is the **SolidJS framework logo** left
  over from the Vite starter (blue gradient swashes, `viewBox="0 0 166 155.3"`), not a Bismuth
  mark; it is not used here and must not be treated as branding. The wordmark is therefore
  rendered **in type** (`.asc-wordmark`, with the sheen) wherever a logo would go. Do not draw one.

---

## Index

| Path | What |
|---|---|
| `styles.css` | **Global entry** — `@import`s every token file + `patterns.css`. |
| `tokens/fonts.css` | `@font-face` for all five Monaspace variants + Lora. |
| `tokens/colors.css` | Four theme scopes on the app's own variable names. |
| `tokens/typography.css` | Font stacks, size scale, tracking. |
| `tokens/spacing.css` | Spacing steps + the fixed chrome measurements. |
| `tokens/effects.css` | Radius, borders, elevation, motion. |
| `tokens/ascii.css` | **The character grid** — cell metrics + glyph vocabulary. |
| `patterns.css` | The class library (app class names + `.asc-*` additions). |
| `components/core/` | Button, IconButton, TextButton, IconTextButton, SegmentedToggle, Chip. |
| `components/forms/` | Field, TextInput, Select, SearchBar, MarkdownField. |
| `components/display/` | StatusDot, StatusText, Stars, Card, Kbd (+Key/KbdHint/KbdHints), EmptyState, Loading, Modal, MenuRow, PopoverList, ViewBar. |
| `components/ascii/` | Glyph, AsciiTree, AsciiMeter, AsciiChart, GraphField, TabRail. |
| `ui_kits/bismuth-app/` | Full-screen recreation of the app (`index.html`). |
| `guidelines/` | Foundation specimen cards — one per Bases view kind, Overlays, ASCII, Colors, Type. |
| `SKILL.md` | Agent-Skill front matter for downloadable use. |

### Intentional additions

The component inventory is exactly `app/src/ui/` plus these, which this direction requires:

- **Glyph / AsciiTree / AsciiMeter / AsciiChart / GraphField** — the character-grid
  primitives. The app draws these ad hoc inside views; the direction makes them the system's
  load-bearing pieces, so they are formalised.
- **TabRail** — the vertical right-hand tab strip. The app has a horizontal tab strip; this
  direction moves it and collapses it to glyphs, so it is a new family.
- **Card / Kbd** — used throughout the daemon inbox, palette and status bar; the app styles
  them inline rather than as `ui/` primitives. `Kbd` parses the app's own keybinding syntax
  (`Mod+Shift+D`, `Mod+\`, Mod+J`) with the same `Mod` → ⌘/Ctrl mapping as
  `app/src/palette/CommandPalette.tsx`, and renders each key as its own cap.

### Not built

`MilkdownField` (a Milkdown editor binding) and `SymbolGallery` (the icon-registry picker)
are app-specific integrations with no meaningful design surface here; `MarkdownField` covers
the editing look.

---

## CAVEATS

- **Fonts are CDN-linked** (fontsource + Google). A local-first desktop build should bundle
  Monaspace locally and swap `tokens/fonts.css`.
- **No brand mark** exists in the source — `app/src/assets/logo.svg` is the SolidJS starter
  logo, not Bismuth's. The wordmark is type. See ICONOGRAPHY.
- **Themes:** four scopes ship here. The app defines twelve (six hues × light/dark). Adding a
  hue means adding one scope with the same variable names.
- These are **React** recreations; production is **SolidJS**.

---

## Build note — the UI kit

`ui_kits/bismuth-app/bundle.jsx` is **generated**: it concatenates the component
sources (with `import`/`export` stripped) and the kit screens, and `index.html`
inlines it. Two constraints made this necessary and will bite anyone who "simplifies" it:

1. A `<script type="text/babel" src="…">` transform reports every runtime failure as an
   opaque `Script error.` — inline the source instead.
2. Babel Standalone's default **automatic** JSX runtime emits
   `import { jsx } from "react/jsx-runtime"`, which cannot run in a plain script. The page
   transforms with `presets: [["react", { runtime: "classic" }]]`.

Edit `components/**` and `ui_kits/bismuth-app/*View.jsx` / `Shell.jsx`, then regenerate
the bundle and re-inline it.
