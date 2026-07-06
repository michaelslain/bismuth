# Note ink — draw anywhere on a note

Every real `.md` note in the normal (CodeMirror) editor carries an optional **ink layer**: press
the `toggle-draw-mode` keybinding (default **Mod+Shift+I**; Escape also exits) and draw freehand
directly over the text — margins included. Toggling back returns to ordinary editing; the ink
stays visible (paint-only) while you type. Blocks mode is unaffected.

## Surfaces & files

| Piece | Where |
| --- | --- |
| Overlay component | `app/src/editor/ink/InkOverlay.tsx` (+ `InkOverlay.css`) — mounted by `Editor.tsx` inside its wrapper, gated to `.md` buffers |
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

## Coordinates & anchoring (v1)

Strokes are stored in a **logical content space**: x/y in the editor's 680px reading column
(`INK_LOGICAL_W`), painted at a uniform scale `s = contentDOM.width / 680` with the offset read
from the live `contentDOM` rect each repaint — so scrolling and pane-width changes need no
bookkeeping. **Stated v1 limitation:** ink is *not* anchored to lines. Editing text above
existing ink shifts the text but not the ink, like annotations on paper. (v2 spec: per-stroke
line anchors remapped via `changes.mapPos` — deliberately deferred.)

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
