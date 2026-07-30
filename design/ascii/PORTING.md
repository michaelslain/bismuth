# Porting the ASCII redesign into `michaelslain/bismuth`

Companion to `README.md`. Read that first for the design itself; this file is the
implementation plan against the real repo (`main`, Tauri + SolidJS + TypeScript + Vite).

Everything below was written after reading the current source of `core/src/theme/tokens.ts`,
`app/src/settingsCssVars.ts`, `app/src/settings.ts`, `app/src/ui/ui.css`,
`app/src/ui/buttonClass.ts` and `app/src/ui/palette.ts`. Line-level values quoted from those
files are what's in the repo today.

---

## 0. Why this port is mostly a values change

The app already has exactly the pipeline this redesign needs:

```
core/src/theme/tokens.ts   THEMES[name] -> ColorTokens        (single source of colour)
        ↓ resolveAppearance / semanticTokens / shadowTokens
app/src/settingsCssVars.ts settingsToCssVars(settings) -> { "--var": value }
        ↓ setCssVars
:root                      --bg --fg --accent --border --surface-1 … --graph-4
        ↓
app/src/ui/ui.css, App.css, every component
```

`design-system/tokens/colors.css` is written **on those exact variable names**, and
`design-system/patterns.css` is written on **the app's own class names** (`.btn--text`,
`.btn--icon`, `.chip-toggle`, `.ui-input`, `.ui-field`, `.ui-overlay`, `.ui-empty`,
`.status-text`, `.stars`, `.search-bar`, `.search-bar-input`, `.ui-select-trigger`) plus new
`.asc-*` classes for things the app has no primitive for. So:

- **No renames.** Nothing that consumes a `var(--…)` today needs to change to get new colour.
- **The colour work is four new entries in `THEMES`** (+ a small extension to `ColorTokens`).
- **The chrome work is a rewrite of `app/src/ui/ui.css`'s geometry** (radii, padding, borders,
  type sizes) — the selectors stay.
- **The genuinely new code is `app/src/ui/ascii/`** — five primitives, ported to Solid.

---

## 1. Colour — `core/src/theme/tokens.ts` + `app/src/settingsCssVars.ts`

### 1a. The problem to decide first

`ColorTokens` carries only 8 colour fields (`background foreground neutral accent border
surface surface2 accentPalette` + `isLight` + three optional category hues). Everything else
`settingsCssVars` **derives** with `color-mix`:

| CSS var | Derived today as | Design wants (`.ink`) | Match? |
|---|---|---|---|
| `--border-soft` | `mix(fg 10%, transparent)` | `#282B34` | close — accept or override |
| `--faint` | `mix(fg 42%, transparent)` | `#6A675E` | close — accept |
| `--hover-bg` | `mix(fg 8%, transparent)` | `rgba(232,227,214,.05)` | tune to 5% |
| `--surface-3` | `mix(fg 14%, transparent)` | `#31353F` (opaque) | **differs — override** |
| `--rail` | `mix(bg 88%, #000)` | `#101116` | **differs — override** |
| `--editor` | `= bg` on dark | `#191A1F` (lifted) | **differs — override** |
| `--graph-bg` | a `radial-gradient(…)` | **flat** `#121317` | **differs — override** |
| `--term-bg/-fg` | hardcoded `#08090E`/`#C7CCE0` | `#101116` / `#C9C4B6` | **differs — override** |
| `--glow-accent`, `--glow-text` | *do not exist* | per-scope | **new tokens** |
| `--overlay-bg` | lives in `ui.css` as `rgba(0,0,0,.5)` | per-scope | **move into the theme** |

**Recommendation:** extend `ColorTokens` with optional explicit fields and have
`settingsCssVars` prefer them, keeping the existing `color-mix` derivations as the fallback
for the twelve legacy themes. That way the ASCII themes hit their exact values and no existing
theme changes appearance.

```ts
// core/src/theme/tokens.ts — additions to the ColorTokens interface
export interface ColorTokens {
  // …existing fields…
  /** Explicit structural surfaces. When absent, settingsCssVars derives them (legacy themes). */
  rail?: string;         // --rail
  editor?: string;       // --editor
  surface3?: string;     // --surface-3
  borderSoft?: string;   // --border-soft
  faint?: string;        // --faint
  hoverBg?: string;      // --hover-bg
  overlayBg?: string;    // --overlay-bg  (was hardcoded in ui.css)
  /** Flat graph ground. When absent, the radial-gradient derivation is used. */
  graphBg?: string;      // --graph-bg
  termBg?: string;
  termFg?: string;
  /** Bloom is a THEME decision. "none" for flat scopes; Cathode is the only lit one. */
  glowAccent?: string;   // --glow-accent
  glowText?: string;     // --glow-text
}
```

```ts
// app/src/settingsCssVars.ts — inside settingsToCssVars, replace the derived lines with:
"--border-soft": a.borderSoft ?? `color-mix(in srgb, ${a.foreground} 10%, transparent)`,
"--faint":       a.faint      ?? `color-mix(in srgb, ${a.foreground} 42%, transparent)`,
"--hover-bg":    a.hoverBg    ?? `color-mix(in srgb, ${a.foreground} 8%, transparent)`,
"--surface-3":   a.surface3   ?? `color-mix(in srgb, ${a.foreground} 14%, transparent)`,
"--rail":        a.rail       ?? (light ? mix(a.background, 70, a.border) : mix(a.background, 88, "#000")),
"--editor":      a.editor     ?? (light ? mix(a.surface, 64, a.background) : a.background),
"--graph-bg":    a.graphBg    ?? (/* existing radial-gradient branch */),
"--term-bg":     a.termBg     ?? (light ? "#2B2740" : "#08090E"),
"--term-fg":     a.termFg     ?? (light ? "#E3DEF2" : "#C7CCE0"),
"--overlay-bg":  a.overlayBg  ?? (light ? "rgba(60,58,74,.28)" : "rgba(0,0,0,.5)"),
"--glow-accent": a.glowAccent ?? "none",
"--glow-text":   a.glowText   ?? "none",
```

Then delete `--overlay-bg` from the `:root` block at the top of `app/src/ui/ui.css` (it becomes
theme-owned) and keep a literal first-paint fallback in `App.css :root` as that file already
does for the other tokens.

### 1b. The four new themes

Add to `THEME_NAMES` / `THEME_LABELS` / `THEMES`. `ink` is the new default
(`DEFAULT_THEME = "ink"`); keep the twelve existing themes so nobody's settings break.

```ts
"ink": {
  background: "#15161A", foreground: "#E8E3D6", neutral: "#9C998E",
  accent: "#93BDB0", border: "#3A3E4A", surface: "#20222A", surface2: "#272A33",
  accentPalette: ["#C98CA8", "#A190C4", "#8296C6", "#83B4AE", "#A3BE8C"],
  rail: "#101116", editor: "#191A1F", surface3: "#31353F", borderSoft: "#282B34",
  faint: "#6A675E", hoverBg: "rgba(232,227,214,.05)", overlayBg: "rgba(10,11,14,.6)",
  graphBg: "#121317", termBg: "#101116", termFg: "#C9C4B6",
  glowAccent: "0 0 0 1px rgba(147,189,176,0.14)", glowText: "none",
  categoryGreen: "#A3BE8C", categoryGold: "#CBB27E", categoryRose: "#C98CA8",
},
```

`paper` (light, `isLight: true`), `cathode` and `riso` follow the same shape — every value is
in `design-system/tokens/colors.css`, one `:root`-style block per scope, in the same variable
order. Semantic trio per scope: ink `#C87F72 / #A3BE8C / #CBB27E`; paper `#A8503F / #5E7F4B /
#B54708`; cathode `#FF6B5A / #5CFA8A / #FFC23D`; riso `#B03A2E / #4F7A34 / #A86A18`. Those
don't fit `SEMANTIC_DARK`/`SEMANTIC_LIGHT`'s two-way split — either add optional
`danger/success/warning` to `ColorTokens` and prefer them in `semanticTokens()`, or accept the
existing pair for the new themes (the ink values are close to `SEMANTIC_DARK` already).

Also update: `app/src/themes.ts` re-export (byte-identical, nothing to do), the settings-schema
theme enum (`core/src/schema/settingsSchema.ts`), and `docs/settings/themes.md`.

### 1c. Ramp semantics

`--graph-0…4` map to rose → violet → blue → teal → green in this design (see `colors.css`).
`PALETTE_TOKENS` in `app/src/ui/palette.ts` is unchanged — the six category names keep working,
they just resolve to the new hues. Nothing that stores a category token needs migrating.

---

## 2. Type — `app/src/settings.ts`, `settingsCssVars.ts`, `ui.css`

1. **`FONT_STACKS`** — add the five Monaspace variants:
   `"Monaspace Xenon" | Neon | Argon | Krypton | Radon` → `'Monaspace <V>', ui-monospace,
   monospace`. Keep Lora/Georgia/system-ui for users who want serif prose.
2. **Prose is mono now.** The direction sets `--editor-font: var(--ui-font-stack)`. Ship it as
   a *default change* (`appearance.editorFont: "Monaspace Xenon"` in
   `core/src/schema/settingsSchema.ts` DEFAULTS), not a hardcode — a user can still pick Lora.
3. **`--ui-font-stack` should come from settings, not CSS.** It is currently hardcoded in the
   `:root` block of `app/src/ui/ui.css`. Add `appearance.uiFont` (default `"Monaspace Xenon"`)
   and project `"--ui-font-stack": FONT_STACKS[s.appearance.uiFont]` from `settingsToCssVars`;
   leave the literal in `ui.css` as a first-paint fallback only.
4. **Variant scopes.** `design-system/tokens/typography.css` ships `.face-xenon … .face-radon`
   on `html`. If you'd rather not add a settings key, keep just the scope classes and toggle
   them from the appearance panel.
5. **Size scale.** The app's `--ui-font-size` default should drop to **11.5px**, tabs to
   11.5px, micro chrome to 10.5px. Add `--fs-*` as real tokens (they're in
   `tokens/typography.css`) rather than repeating literals in `App.css`.
6. **Ligatures off app-wide:** `font-variant-ligatures: none` on the app root — Monaspace's
   coding ligatures break the character grid.

---

## 3. Chrome CSS — `app/src/ui/ui.css` (and `App.css`)

Same selectors, new geometry. Diff against the current file:

| Selector | Today | ASCII direction |
|---|---|---|
| `.btn` gap | `6px` | `4px` |
| `.btn--text` | `padding 6px 12px`, `radius 6px`, **`border: none`**, uppercase | `padding 2px 9px`, `radius 3px`, **`border: 1px solid var(--border)`**, uppercase, `font-size 10.5px`, `letter-spacing .06em` |
| `.btn--text.btn--unselected` | `color: var(--text-muted)` | `color: var(--faint)` |
| `.btn--text.btn--selected` | `--fg` on `var(--border)` fill | `--accent` on `--accent-soft`, `border-color: var(--accent)` |
| *(new)* `.btn--text.btn--primary` | — | selected + `box-shadow: var(--glow-accent)` — **max one per view** |
| `.btn--text.btn--sm` / `--lg` | `3px 10px / 12px`, `10px 22px / 15px` | `1px 7px`, `5px 14px / 11.5px` |
| `.btn--icon` | `padding 4px 6px`, `radius 4px`, `15px` | `padding 3px 5px`, `radius 3px`, `14px` |
| `.btn--icon.btn--selected` | icon on `var(--border)` | `--accent` on `--accent-soft` |
| *(new)* `.btn-glyph` | — | `color: var(--faint); line-height: 1; translateY(.5px)` — the ASCII glyph slot inside a button |
| `.segmented` | `gap: 2px` | `gap: 0`, buttons butted, inner left borders removed, only outer corners rounded |
| `.ui-input` | `--editor-font` **15px**, `padding 9px 12px`, `radius 9px` | `--ui-font-stack` **11.5px**, `padding 6px 8px`, `radius 3px` |
| `.ui-input:focus` | `0 0 0 3px var(--accent-soft)` | `0 0 0 2px var(--accent-soft)` |
| `.ui-input::placeholder` | mono 13px, `--text-muted` | `--faint`, inherits size (value and hint are both mono now) |
| `.search-bar` | bare flex | `border: 1px solid var(--border)`, `background: var(--surface-1)`, `padding 5px 8px` |
| `.search-bar-lead` | `opacity .6` | `color: var(--accent)` |
| `.chip-toggle` | `height 30px`, `padding 0 12px`, `radius 8px`, `12px`, `--surface-2` fill | `padding 1px 6px`, `radius 2px`, `10.5px`, **transparent fill**, 1px rule |
| `.chip-toggle` tones | only `tone-teal` | all six: `tone-{teal,blue,violet,green,gold,rose}` at 14% fill / 45% border |
| `.ui-empty-block` | `gap 16px` | `gap 12px`, heading uppercase 11.5px `.14em` |
| `.status-text` gap | `7px` | `6px`; `.status-dot` 6px round, `background: currentColor` |
| `.stars` | `gap 2px`, SVG stars | typed `*` glyphs, `letter-spacing -.05em` |
| `.ui-overlay` | `font: 13px/1.5` | `font: 11.5px/1.5`, `background: var(--overlay-bg)` (now theme-owned) |
| *(new)* `.asc-modal` / `.asc-popover` | (modal chrome is inline / App.css today) | `--pop-bg-strong` / `--pop-bg` + `backdrop-filter: blur(6px)`, 1px rule, radius 5px, `--shadow-modal` / `--shadow-popup` |

`.btn .btn-label { top: 1px }` (the optical-centering nudge) stays — it's still Monaspace.

**`buttonClass.ts`**: add `"primary"` to `ButtonState` (or a `primary?: boolean` tone next to
`danger`) and emit `btn--primary`. Everything else in that file is unchanged.

**`App.css`** carries the view-level chrome (rail, tabs, editor, graph, tables, calendar,
flashcards, chat, inbox). Port it view by view against `design-system/patterns.css` +
`design-system/guidelines/*.card.html`; the `.asc-*` classes there are the reference for
anything App.css has no equivalent of (eyebrow, wordmark, caret, tree, meter, field, key caps,
frontmatter, callout, prose underline).

---

## 4. New primitives — `app/src/ui/ascii/`

Port these from `design-system/components/ascii/` (React) to Solid. Signatures as shipped
(`.d.ts` next to each `.jsx`, with a `.prompt.md` describing intent and edge cases):

```ts
Glyph({ text, dense?, color?, opacity?, glow?, style?, class? })
noiseField(cols, rows, density?, seed?): string

AsciiTree({ rows: { id, label, depth?, last?, glyph?, meta? }[], activeId?, onSelect?, class? })
treePrefix(depth, last): string          // "|   |-- " / "|   `-- "

AsciiMeter({ value /* 0–1 */, width?, label?, suffix?, color? })
AsciiChart({ series: { label, value, color? }[], width? })

GraphField({ cols?, rows?, nodes?, edges?, labels?, density?, showNoise?, showEdges?, style?, children? })
rasterEdges(cols, rows, nodes, edges): string   // Bresenham → "- | / \" with "+" junctions

TabRail({ tabs: { id, glyph, label }[], value?, onChange?, open?, onToggle?, class? })

Kbd({ combo? /* "Mod+Shift+D" | "Mod+`, Mod+J" */, children?, muted? })
parseCombo(combo): string[][]            // same Mod → ⌘/Ctrl mapping as palette/CommandPalette.tsx
KbdHint({ combo?, keys?, children? }) · KbdHints({ items })
```

Notes for the port:

- `treePrefix`, `rasterEdges`, `noiseField` and `parseCombo` are **pure functions** — move them
  to plain `.ts` next to the components and unit-test them (the repo already tests pure helpers
  this way, e.g. `buttonClass.test.ts`, `activeItem.test.ts`).
- `GraphField` **must not use CSS scale for zoom.** Zoom re-rasterizes at a finer grid: cell
  size is constant, `cols`/`rows` grow. 0% = fit; 100% = maximum resolution, every note named.
  The noise layer sits *under* edges at `.45` opacity and is cleared beneath every edge and
  label. This is the single most important behavioural rule in the redesign.
- `TabRail` replaces the horizontal tab strip when `settings.ui.verticalTabs` is on — the
  setting already exists. Collapsed = 46px of glyphs, open = 232px with filenames; the active
  tab carries the `--grad` rule.
- These five plus `Kbd` are the only **new** families. Everything else maps onto an existing
  `app/src/ui/` primitive.

---

## 5. Screen → source map

| Screen | Design reference | App source to change |
|---|---|---|
| Shell, rail, status bar | `ui_kits/bismuth-app/Shell.jsx`, `guidelines/spacing-chrome.card.html` | `app/src/App.tsx`, `App.css` |
| Vault tree | `guidelines/ascii-tree.card.html` | `App.tsx` sidebar, new `ui/ascii/AsciiTree` |
| Editor | `ui_kits/bismuth-app/EditorView.jsx` | `app/src/BlockEditor.{tsx,css}`, `app/src/editor/` |
| Knowledge graph | `guidelines/ascii-graph.card.html`, `ascii-zoom.card.html` | `app/src/graph/` |
| Bases (12 kinds) | `guidelines/bases-*.card.html` | `app/src/bases/`, `app/src/baseViews.ts` |
| Calendar | `guidelines/bases-calendar.card.html` | `app/src/calendar/`, `bases/CalendarView.tsx` |
| Flashcards | `guidelines/bases-flashcards.card.html` | `app/src/bases/FlashcardsView.tsx`, `flashcardsQueue.ts` |
| Chat | `guidelines/view-chat.card.html` | `app/src/ChatView.{tsx,css}`, `ChatComposer.tsx` |
| Daemon inbox | `guidelines/view-inbox.card.html` | `app/src/InboxView.tsx`, `daemonInboxLogic.ts`, `core/src/daemonPages.ts` |
| Palette / switcher / modals | `guidelines/overlay-*.card.html` | `app/src/palette/`, `app/src/ui/Modal.tsx`, `ui/popover/` |
| Type / colour foundations | `guidelines/type-*.card.html`, `colors-*.card.html` | tokens + `ui.css` |

---

## 6. Suggested PR order

1. **Tokens** — `ColorTokens` extension + the four themes + `settingsCssVars` overrides.
   Ship behind the theme picker; nothing else changes. Verifiable in Storybook immediately.
2. **Type** — Monaspace stacks, `--ui-font-stack` from settings, size-scale tokens, ligatures
   off.
3. **`ui.css` geometry** — the table in §3. All 11 stories in `app/src/ui/*.stories.tsx`
   should be re-reviewed here; `uiLint.test.ts` guards the class vocabulary.
4. **ASCII primitives** — `app/src/ui/ascii/` + pure-helper tests, unused at first.
5. **Views**, in this order: shell/rail → editor → graph → bases → calendar/flashcards →
   chat → inbox → overlays.

## 7. Checklist before calling it done

- [ ] No component hardcodes a shadow or glow — every one reads `--glow-*` / `--shadow-*`.
- [ ] No Unicode box-drawing characters anywhere (`─ │ ├`); ASCII only.
- [ ] Every ASCII field's `line-height` equals its cell height, and `letter-spacing: 0`.
- [ ] `font-variant-ligatures: none` is on the app root.
- [ ] Nothing renders below 10.5px; hit targets ≥ 24px.
- [ ] At most one `btn--primary` per view.
- [ ] `--faint` is never used for content, only for structure.
- [ ] Graph zoom subdivides the grid — no CSS `transform: scale` on the field.
- [ ] Only two infinite animations exist: the 1.1s caret blink and the 8s wordmark sheen.
- [ ] All four scopes (`ink`, `paper`, `cathode`, `riso`) pass a visual sweep of every view;
      light scopes must not inherit the dark shadows.
- [ ] `app/src/assets/logo.svg` is still unused — it is the SolidJS starter logo, not a mark.
