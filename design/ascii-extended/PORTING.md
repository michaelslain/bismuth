# PORTING — Extended surfaces

How to land the terminal, sheet/drawing chrome, and export retheme in
`michaelslain/bismuth`. Read `README.md` first for what each surface is.

**Prerequisite:** the four theme scopes (`ink` · `paper` · `cathode` · `riso`) and the
Monaspace type stacks must already be in `core/src/theme/tokens.ts` +
`app/src/settingsCssVars.ts`. All three surfaces below read tokens and add none. If the scopes
are not in yet, port them first (see `design_handoff_bismuth_ascii/PORTING.md` §1–2) — these
three are the *last* PRs of that sequence, not the first.

Every surface here is low-risk: no data model changes, no new dependencies, no behavioural
change. They are paint.

---

## 1. Terminal — `app/src/TerminalView.tsx`

### 1a. Derive the ANSI palette, don't author it

xterm's `ITheme` wants 16 colours plus 4 chrome ones. Build them from the live CSS variables so
a scope switch moves the terminal with everything else:

```ts
// Resolve a var against the app root. Values in tokens.ts are literal colors, so this is
// a plain read — no color-mix resolution needed for the base 8.
const v = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// The bright half is the base mixed 70% toward --fg. color-mix() can't be read back off a
// custom property, so resolve it through a throwaway probe element once per theme change.
function mix(color: string, toward: string, pct = 70): string {
  const el = document.createElement("span");
  el.style.color = `color-mix(in srgb, ${color} ${pct}%, ${toward})`;
  document.body.appendChild(el);
  const out = getComputedStyle(el).color;
  el.remove();
  return out;
}

export function buildTerminalTheme(): ITheme {
  const fg = v("--fg");
  const base = {
    black:   v("--rail"),
    red:     v("--danger"),
    green:   v("--green"),
    yellow:  v("--gold"),
    blue:    v("--blue"),
    magenta: v("--violet"),
    cyan:    v("--teal"),
    white:   v("--term-fg"),
  };
  return {
    background: v("--term-bg"),
    foreground: v("--term-fg"),
    cursor: v("--accent"),
    cursorAccent: v("--term-bg"),
    selectionBackground: v("--accent-soft"),
    ...base,
    brightBlack:   v("--faint"),
    brightRed:     mix(base.red, fg),
    brightGreen:   mix(base.green, fg),
    brightYellow:  mix(base.yellow, fg),
    brightBlue:    mix(base.blue, fg),
    brightMagenta: mix(base.magenta, fg),
    brightCyan:    mix(base.cyan, fg),
    brightWhite:   fg,
  };
}
```

**Re-apply on theme change, not only at mount** — this is the bug to avoid:

```ts
createEffect(() => {
  settings.appearance.theme;        // track
  settings.appearance.font;         // track
  term.options.theme = buildTerminalTheme();
  term.options.fontFamily = v("--ui-font-stack");
});
```

### 1b. Terminal options

| Option | Value | Why |
|---|---|---|
| `cursorBlink` | `true` | matches `.asc-caret` |
| `cursorStyle` | `"underline"` | the system's caret is `_`, never a block |
| `fontFamily` | resolved `--ui-font-stack` | follows the face setting |
| `letterSpacing` | `0` | any tracking shears the cell grid |
| `lineHeight` | `1` | cell height must equal the line box |
| `allowTransparency` | `false` | `--term-bg` is opaque in every scope |

### 1c. Chrome

- Session tabs: bracket buttons `[ 1 zsh ]`, `--faint` idle → `--accent` on
  `--accent-soft` active. Not tab shapes, no rounded top corners.
- Unread output on a background session: a trailing `*` inside the bracket. Not a dot badge.
- The view bar follows `ViewBar` as everywhere else: `TERMINAL` eyebrow, cwd in
  `--text-muted`, shell + session count in `--faint`.

**Specimen:** `design/guidelines/view-terminal.card.html` — the ANSI strip at the bottom is
generated from the same custom properties, so it doubles as a visual test of the derivation.

---

## 2. Sheets + Drawing — `app/src/{SheetView,DrawView}.tsx`, `App.css`

### 2a. Scope of the change

**Do not touch either canvas.** Univer renders the spreadsheet itself and the drawing surface
is a real canvas. Only DOM chrome around them changes. If a change requires reaching into
Univer's render tree, it is out of scope for this PR.

### 2b. Sheet chrome (`.sheet` in `App.css`)

| Element | Treatment |
|---|---|
| Name box | `--accent`, `--fs-micro`, right hairline |
| `fx` cell | `--faint`, fixed 26px, right hairline |
| Formula bar | `--fg`; function `--violet`, range `--blue`, literal `--fg` |
| Column / row headers | `--rail` ground, `--faint` labels, 9.5px, `.08em` tracking |
| Grid lines | `--border-soft` hairlines, never `--border` |
| Selected cell | 1px `--accent` outline `outline-offset:-1px` + `--accent-soft` fill |
| Sheet tabs | bracket buttons on `--rail`, active = `--accent` on `--accent-soft` |
| Aggregate readout | `--faint`, 9.5px, right-aligned in the tab strip |

Formula-bar syntax colours reuse the graph ramp tokens — do not introduce a separate
syntax palette.

### 2c. Drawing chrome (`.draw` in `App.css`)

- The tool row uses the system's own primitives: a `SegmentedToggle` for
  PEN · LINE · BOX · TEXT · ERASE and another for weight `1 · 2 · 4`. Do **not** hand-roll
  bracket-text tools here — this was tried and reads as debug UI.
- Colour is a butted row of five 16px token swatches (`--fg --accent --rose --gold --green`)
  in a single `--border` frame; the active one takes an inset 2px `--fg` ring.
- **Paper ground** — the only themed part of the canvas area. Four options, all from
  `--border-soft` at a 14px pitch:

```css
/* grid  */ background-image: linear-gradient(to right,  var(--border-soft) 1px, transparent 1px),
                              linear-gradient(to bottom, var(--border-soft) 1px, transparent 1px);
            background-size: 14px 14px;
/* dot   */ background-image: radial-gradient(var(--border) .8px, transparent .8px);
            background-size: 14px 14px;
/* ruled */ background-image: linear-gradient(to bottom, var(--border-soft) 1px, transparent 1px);
            background-size: 100% 14px;
/* blank */ background-image: none;
```

- **Strokes are not ASCII.** Drawing is the single surface in this system exempt from the
  character grid — a drawing app has to draw. Keep round caps, keep pressure taper. Do not
  rasterize user ink to characters.

### 2d. Naming collision

`.paper` is a **theme-scope class** in the new token system. If `App.css` (or anything under
`DrawView`) uses `.paper` for the drawing ground, rename it — `.draw-paper`. Otherwise the
whole drawing pane silently re-scopes to the light Paper theme regardless of the user's choice.

**Specimen:** `design/guidelines/view-sheets-draw.card.html`.

---

## 3. Export — `app/src/ExportView.{tsx,css}`

This is the strictest of the three: **retheme only.** The option set below is what
`ExportView.tsx` ships today. Do not add, remove, reorder, or change the control type of
anything in it.

### 3a. Layout — leave it alone

`.exp` is `grid-template-columns: 1fr 360px`: **paper preview LEFT, options panel RIGHT** on
`--rail`. Keep it.

### 3b. Fields, in source order

| Field | Control | Condition |
|---|---|---|
| Input path | `TextInput` + `IconTextButton` BROWSE | always |
| Output path | `TextInput` (placeholder "Downloads (default)") + BROWSE | always |
| View | `Chip` per configured view | base with >1 view |
| Content | `Chip` — Visual · Data | base only |
| Calendar span | `Chip` — Month · Week · 3-day · Day | base + visual + calendar view |
| Start day | `<input type="date">` + TODAY reset | same |
| Frontmatter | one `Chip` — "Include frontmatter" | plain `.md` only |
| Format | `Chip` per format | always |
| Font size | `Chip` — 9/10/11/12/14/16/18pt (default 12) | `format === "pdf"` |
| Theme | `Chip` — Light · Dark, each with an 11px swatch | always |
| — | `.exp-spacer` | |
| EXPORT | `IconTextButton` | always |

- **Every option is a `Chip`.** Not a segmented control, not an ASCII `[x]` field. The panel's
  entire vocabulary is chips; `.chip-toggle` in `patterns.css` is already the rethemed Chip.
- Format labels come from `LABEL`: HTML · PDF · **Markdown** (not "MD") · PNG · CSV, gated by
  `formatsForOptions` — `.md` → html/pdf/png/md · sheet → html/pdf/png · draw → pdf/png ·
  base+data adds csv.
- Keep the `.exp-hint` under Format that warns a page-broken note exports as N separate PNGs.

### 3c. Two fixes to make while you're in there

1. **`.paper` collides with the `paper` theme scope.** Rename the preview sheet class to
   `.exp-paper` in `ExportView.css` and `ExportView.tsx`. This must land in the same PR as
   the scopes or the preview re-scopes itself.
2. **`THEME_SWATCH` is hardcoded** `{ light: "#f7f6f2", dark: "#0D0E16" }`. Light stays cream —
   it is print paper, not a UI theme. Repoint **dark** at the active scope's `--bg` so the
   swatch is not lying in cathode or riso.

### 3d. The rendered artifact — `app/src/export/htmlTemplate.ts`

The export already inlines a resolved `ThemePalette` (`export/resolvePalette.ts`) because the
exported document can't reference `var()`. That mechanism is right; extend the ruled-paper
look through it:

- **Ruled paper, 22px.** One rule every 22px, and **every block's line-height must be 22px or
  a multiple of it** — headings, list items, blockquotes, the frontmatter block, all of them.
  A single 1.5-line-height element walks the rest of the document off the ruling.
- Headings keep their markdown marker (`## `) rendered in `--faint` before the text.
- The frontmatter block uses the 2px `--accent-edge` left border — the one sanctioned
  left-accent border in the system.
- Page footer: filename left, `n / total` right, 9px `--faint`.

**Specimen:** `design/guidelines/view-export.card.html`.

---

## 4. PR order

1. **Terminal** — self-contained, one file, no CSS collisions. Ship first to validate the
   derivation approach on a real surface.
2. **Sheet + drawing chrome** — `App.css` only, plus the `.paper` → `.draw-paper` rename.
3. **Export** — the rename, the swatch fix, the panel retheme, then the artifact stylesheet.

---

## 5. Checklist

- [ ] The xterm theme is rebuilt on theme AND font change, not only at mount.
- [ ] No hardcoded ANSI hex anywhere — all 16 derive from tokens.
- [ ] Terminal cursor is a blinking underline; `letterSpacing: 0`; `lineHeight: 1`.
- [ ] Neither canvas (Univer, drawing) was modified.
- [ ] Drawing strokes are still real ink — nothing rasterized to characters.
- [ ] `.paper` renamed everywhere it is a local class (`ExportView.css`, any `App.css` use).
- [ ] `THEME_SWATCH.dark` reads the active scope's `--bg`.
- [ ] The export panel still has every field listed in §3b, in that order, all as chips.
- [ ] "Markdown", not "MD".
- [ ] Every line-height in the export stylesheet is a 22px multiple.
- [ ] All four scopes sweep clean on all three surfaces; light scopes don't inherit dark
      shadows.
