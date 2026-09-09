# Note ink — draw anywhere on a note

Every real `.md` note in the normal (CodeMirror) editor carries an optional **ink layer**: press
the `toggle-draw-mode` keybinding (default **Mod+Shift+I**; Escape also exits) and draw freehand
directly over the text — margins included. Toggling back returns to ordinary editing; the ink
stays visible (paint-only) while you type. Blocks mode is unaffected.

## Surfaces & files

| Piece | Where |
| --- | --- |
| Overlay component | `app/src/editor/InkOverlay.tsx` (+ `InkOverlay.module.css`, a CSS Module — not a plain `.css` file; story: `InkOverlay.stories.tsx`) — mounted by `Editor.tsx` inside its wrapper, gated to `.md` buffers. There is no `editor/ink/` subdirectory; all three files sit directly under `app/src/editor/`. |
| Fence scan + read/write | `core/src/drawing/drawBlocks.ts` — locates ` ```draw ` fences, associates each with the block it decorates, reads/writes a note's ink without disturbing the rest of the document. Free of CodeMirror/DOM imports so it runs headless under `bun test`. |
| Stroke codec | `core/src/drawing/inkCodec.ts` — encodes/decodes a fence's stroke payload (base64 + deflate); shares `Stroke` from `model.ts`. |
| Commit | `app/src/editor/inkCommit.ts` — the pure half of "a stroke becomes markdown": given the note's text, a drawing session's strokes, and the note's block table, produces the new note text with each stroke cut at every seam it crossed and written into its owning block's fence. |
| Block widget | `app/src/editor/drawBlock.ts` — the ` ```draw ` embedded block: hides the fence's raw source, reserves height for a standalone drawing, carries the standalone drag handle. |
| Keybinding | `toggle-draw-mode` in `KEYBINDING_CATALOG` (`core/src/keybindings.ts`), rebindable via `keybindings:` in `.settings` |
| Toolbar | Reuses `app/src/drawing/Toolbar.tsx` (paper/zoom/import groups are optional props and omitted here) |
| Undo | Two independent stacks: CM `history()` for text (untouched); the drawing store's snapshot undo for ink — Mod+Z/Mod+Shift+Z route to ink **only while draw mode is on** |

There is no `.ink/<note path>.ink` sidecar. Ink lives **in the note itself**, inside ` ```draw `
fences — a note's ink travels with the file on copy, sync, and export, and needs no server-side
carry logic on rename/move/delete.

## Two fence shapes

A fence's mode is written in the fence's own info string, never inferred from its surroundings:

- ` ```draw ` — **attached**: ink decorating the block immediately above it. The widget that
  replaces the fence reserves zero height, since the block above already occupies its own.
- ` ```draw block ` — **standalone**: a drawing with no text to attach to. The widget reserves the
  ink's own bounding-box height (`drawBlockGeometry.ts`'s `standaloneHeight`) so the document
  still flows and text after the drawing has somewhere to sit.

The fence never reveals its raw source when the cursor enters it (unlike `queryBlock.ts` /
`graphBlock.ts`) — the block is atomic, so arrow keys step over it rather than landing a caret
inside.

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
- A stroke never becomes its own document transaction. Strokes accumulate in a session op log
  and land as ONE transaction, debounced and flushed on draw-mode exit, note switch, window
  blur and unmount. Every ink transaction carries `Transaction.addToHistory.of(false)`, so
  cmd+Z in the editor restores the user's typing and never their ink. The drawing tool keeps
  its own, session-scoped undo stack, cleared on draw-mode exit and on any document change the
  overlay did not make.

## Coordinates & anchoring

Strokes are CAPTURED in a logical content space: x/y in the editor's 680px reading column
(`INK_LOGICAL_W`, `core/src/drawing/model.ts`), painted at a uniform scale
`s = contentDOM.width / 680` with the offset read from the live `contentDOM` rect each repaint.

What a fence STORES is a different question, with a different answer per shape (the contract
lives in `inkCommit.ts`):

- **Attached** fences store ink relative to the TOP of the block they decorate, in **unscaled
  pixels**. Top rather than bottom because markdown grows downward — typing into an annotated
  paragraph moves its bottom but leaves its top where it was. Pixels rather than the 680px
  logical column because line heights do not rescale with pane width but a logical offset does;
  x stays scaled, so a narrow pane squashes annotation ink horizontally rather than letting it
  drift off its text.
- **Standalone** fences store ink in the uniform logical space, scaling as a whole — there is no
  text to stay aligned with. A fence created from scratch is normalized so the ink's top sits
  exactly `pad` below the widget top.

A fence is anchored by its own position in the document, which the document already tracks, so
an insertion above it needs no remapping of anything — unlike the old per-stroke `a: {p, y}`
line anchor, which no longer exists.

## Server behavior

Ink now lives inside note markdown, so it is ordinary note content: a stroke commit is a normal
note write, classified and cached exactly like any other edit to the file (graph/tree/search/
rows/tasks all see it the same way a typed paragraph would). There is no separate sidecar path,
no dirty-to-nothing carve-out, and nothing for `files.ts` to carry on move/delete/restore beyond
the note itself.

## Drawing embeds are gone

`![[Sketch.draw]]` no longer renders an embed in notes (`kindForTarget` returns `null` for
`.draw`; the token stays as inert plain text). Standalone `.draw` tabs, image/PDF markup
sidecars, and drawing export are untouched.
