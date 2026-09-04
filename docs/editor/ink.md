# Note ink — draw anywhere on a note

Every real `.md` note in the normal (CodeMirror) editor carries an optional **ink layer**: press
the `toggle-draw-mode` keybinding (default **Mod+Shift+I**; Escape also exits) and draw freehand
directly over the text — margins included. Toggling back returns to ordinary editing; the ink
stays visible (paint-only) while you type. Blocks mode is unaffected.

## Surfaces & files

| Piece | Where |
| --- | --- |
| Overlay component | `app/src/editor/InkOverlay.tsx` (+ `InkOverlay.module.css`, a CSS Module — not a plain `.css` file; story: `InkOverlay.stories.tsx`) — mounted by `Editor.tsx` inside its wrapper, gated to `.md` buffers. There is no `editor/ink/` subdirectory; all three files sit directly under `app/src/editor/`. |
| Document model | `core/src/drawing/ink.ts` — `InkDoc { v:1, kind:"ink", strokes }` (reuses `Stroke` from `model.ts`; `kind` discriminates from page-based `.draw`) |
| Persistence | Hidden sidecar `.ink/<note path>.ink` (`inkPathFor`), written lazily on the first stroke via the generic `PUT /file`, debounced 600ms |
| Keybinding | `toggle-draw-mode` in `KEYBINDING_CATALOG` (`core/src/keybindings.ts`), rebindable via `keybindings:` in `.settings` |
| Toolbar | Reuses `app/src/drawing/Toolbar.tsx` (paper/zoom/import groups are optional props and omitted here) |
| Undo | Two independent stacks: CM `history()` for text (untouched); the drawing store's snapshot undo for ink — Mod+Z/Mod+Shift+Z route to ink **only while draw mode is on** |

## Mode mechanics

- Entering draw mode reconfigures an `EditorView.editable` **Compartment** to `false` (never
  `readOnly` — programmatic dispatches like the SSE external-reconcile and autosave-normalize
  keep working), blurs the content DOM, and flips the overlay's live canvas to
  `pointer-events:auto` so a click physically can't place a caret. Text editing in normal mode
  is byte-for-byte unaffected (the overlay is `pointer-events:none` and does nothing per
  keystroke).
- Strokes are captured with the same state machine as the page drawing (pressure/velocity
  width, hold-to-straighten, smooth-on-release) and rendered by the shared
  `core/src/drawing/render2d.drawStroke`.

## Coordinates & anchoring

Strokes are stored in a **logical content space**: x/y in the editor's 680px reading column
(`INK_LOGICAL_W`), painted at a uniform scale `s = contentDOM.width / 680` with the offset read
from the live `contentDOM` rect each repaint — so scrolling and pane-width changes need no
bookkeeping.

**Per-stroke line anchoring is implemented** (`core/src/drawing/ink.ts`'s `InkAnchor`,
`app/src/editor/InkOverlay.tsx`) — this used to be a stated v1 limitation ("ink is not anchored to
lines") with a deferred v2 spec; that spec has since shipped. Each `InkStroke` optionally carries
`a: { p, y }`: `p` is the CodeMirror document position of the **start of the line** the stroke's
first point was drawn beside (anchored to the line start rather than the exact point so the ink
doesn't jitter sideways as you type elsewhere on that line), and `y` is that line's top, in
ink-logical units, at draw time. On every repaint the stroke is displaced vertically by
`lineTop(p) - y` (`shiftFor`/`lineTopLogical`) — so inserting a line above the anchored line moves
the ink DOWN along with the text it annotates, and deleting lines above moves it up. `p` itself is
kept live: an `EditorView.updateListener` (wired through a `Compartment` so `InkOverlay` can attach
to a view it doesn't own and cleanly detach when it's swapped) remaps every stroke's anchor through
`changes.mapPos` on every document change, so the anchor tracks the line even across edits far away
in the document. `lineTopLogical` reads CodeMirror's height map (`lineBlockAt`) rather than
`coordsAtPos`, deliberately — the height map covers the whole document, so anchoring keeps working
for ink outside the currently-rendered viewport in a long note.

**What genuinely remains unanchored, verified against `anchorFor` in `InkOverlay.tsx`:** a stroke
gets no anchor at all — and keeps the original paper-like "shifts by 0, forever" behaviour — when
`anchorFor` cannot resolve a document position for its first point: no live `EditorView`, a
zero-width content box, or (the real-world case) `posAtCoords` returning `null` for a point outside
the document's text, such as a stroke drawn in blank space past the last line of a short note. Every
`.ink` sidecar written before anchoring existed also has no `a` field on any stroke and behaves the
same way — this is deliberately the entire migration story: an absent `a` is not a distinct code
path, it's the same `shiftFor` expression evaluating to a no-op. Anchoring is **vertical only**: a
stroke's x position never adjusts, but the fixed 680px logical reading column means there is no
horizontal reflow for it to track in the first place.

## Server behavior (cache-neutral by design)

`.ink/**` paths pass the vault watcher but classify as **dirty to nothing** (`classifyVault`),
and an ink-only batch skips the search/rows/tasks cache drops (`vaultTouched` in `arm()`).
An ink autosave therefore rebuilds no graph, tree, search index, rows, or tasks anywhere — the
SSE publish (version + path) exists solely so a split pane showing the same note refetches its
ink. `files.ts` carries the sidecar on move/delete, and because a delete stashes it at the
trash-derived path, `POST /restore` (plain `moveEntry`) restores it automatically. The same
carry also moves/trashes a co-located `<path>.draw` image-markup sidecar (previously orphaned).

## Drawing embeds are gone

`![[Sketch.draw]]` no longer renders an embed in notes (`kindForTarget` returns `null` for
`.draw`; the token stays as inert plain text). Standalone `.draw` tabs, image/PDF markup
sidecars, and drawing export are untouched.
