# Bismuth ASCII — Extended surfaces

Three app surfaces the **Bismuth ASCII redesign handoff** never specified. They exist in the
shipping app but had no specimen, so a straight port of the main handoff would leave them
looking like the old app in the middle of a redesigned one.

Each is a **retheme onto the existing token set** — no new colours, no new primitives, no
controls added or removed.

| Surface | Specimen | App source |
|---|---|---|
| Terminal | `design/guidelines/view-terminal.card.html` | `app/src/TerminalView.tsx` |
| Sheets · Drawing | `design/guidelines/view-sheets-draw.card.html` | `app/src/{SheetView,DrawView}.tsx`, `App.css` |
| Export | `design/guidelines/view-export.card.html` | `app/src/ExportView.{tsx,css}` |

Open **`index.html`** to see all three, with a live theme (ink · paper · cathode · riso) and
face (xenon · neon · argon · krypton · radon) switcher. Everything is static HTML + CSS; no
build, no server, no network beyond the two font CDNs.

> Vault intro was designed too, but is deliberately **not** in this folder — it ships with the
> theme work, not with these three. It lives in `design_handoff_bismuth_ascii/`.

---

## What each surface is

### Terminal

An embedded xterm.js session pane with tabbed shells. The redesign touches two things:

1. **The ANSI palette.** xterm needs 16 colours. Rather than author 64 hex values across four
   scopes, the palette is **derived** from tokens that already exist — the base 8 map onto
   `--rail --danger --green --gold --blue --violet --teal --term-fg`, and the bright 8 are each
   base mixed 70% toward `--fg`. Any scope themes its terminal for free, and a token change
   moves the terminal with it.
2. **The chrome.** Session tabs are bracket buttons (`[ 1 zsh ]`), not tab shapes. Unread
   output is a trailing `*`. The caret is a blinking underline, matching `.asc-caret`
   everywhere else in the system.

Ground is `--term-bg`, text `--term-fg` — both already defined in all four scopes.

### Sheets · Drawing

Two canvas-owning views. **We do not touch the canvases** — Univer draws the spreadsheet and
the drawing surface is a real brush canvas. What gets rethemed is everything around them:

- **Sheet** — name box, `fx` cell, formula bar, column/row headers, sheet tabs, aggregate
  readout. Formula syntax colouring uses the ramp: function `--violet`, range `--blue`,
  literal `--fg`. The selected cell is a 1px `--accent` outline over `--accent-soft`.
- **Drawing** — the tool row becomes the system's own `SegmentedToggle` + button vocabulary,
  colour is five token swatches, weight is a three-way segment. The **paper ground** is the
  only part of the canvas the theme owns: grid · dot · ruled · blank, all built from
  `--border-soft` at a 14px pitch.

Drawing is the one surface in this system that is **not** on the character grid. Strokes are
tapered brush outlines, not ASCII art — a drawing app has to draw.

### Export

A pure retheme. The layout, the fields, their order, and their control types are all exactly
what `ExportView.tsx` ships today; only the paint changes. The one design decision added: the
**rendered artifact carries its own inline copy of the chosen scope's tokens**, so an exported
file still reads in its theme when opened outside Bismuth — and it sits on ruled paper at a
strict 22px baseline.

---

## Contents

```
handoff_extended_surfaces/
├── README.md                  this file — what and why
├── PORTING.md                 file-by-file implementation plan
├── index.html                 all three specimens + theme/face switcher
└── design/
    ├── styles.css             the only stylesheet a consumer links
    ├── tokens/                colors · typography · spacing · effects · ascii · fonts
    ├── patterns.css           the component class library (.btn, .chip-toggle, .viewbar, …)
    ├── monaspace-family.css   the five Monaspace faces
    └── guidelines/
        ├── view-terminal.card.html
        ├── view-sheets-draw.card.html
        └── view-export.card.html
```

Specimens link `../styles.css` relatively, so the folder works from disk with no server.

---

## Reading the specimens

They are **plain HTML documents**, not React. Every one is inline-commented at the point where
a decision was made, and the interactive bits (paper picker, chip groups, ANSI strip, theme
swatches) are a dozen lines of vanilla JS at the bottom of each file. Read the CSS block at the
top of a card to see exactly which tokens a surface is allowed to use.

---

## Two collisions to know about

The redesign introduces four theme-scope **class names**: `ink`, `paper`, `cathode`, `riso`.
Two places in the app already use one of those words as a local class:

- `ExportView.css` → `.paper` (the preview sheet). Rename to `.exp-paper`.
- Any `.ink`/`.riso` local class you may add later — don't.

Landing the scopes without renaming these silently re-scopes the whole subtree to the wrong
theme. Details in `PORTING.md`.
