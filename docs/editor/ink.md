# Note ink — draw anywhere on a note

Every real `.md` note in the normal (CodeMirror) editor carries an optional **ink layer**: press
the `toggle-draw-mode` keybinding (default **Mod+Shift+I**; Escape also exits) and draw freehand
directly over the text — margins included. Toggling back returns to ordinary editing; the ink
stays visible (paint-only) while you type.

**Blocks mode (`BlockEditor.tsx`, Milkdown) has no ink layer and no ` ```draw ` handling.** That
line used to read "Blocks mode is unaffected", which was true only while ink lived in a sidecar
the note never mentioned. Ink is note content now, so a note carrying it opens in Blocks mode as
an ordinary fenced code block showing the base64 payload. The strokes are not lost — the fence is
untouched and the note renders normally again in the CodeMirror editor — but do not read Blocks
mode as an ink-capable surface.

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
| Undo | Two independent stacks: CM `history()` for text (untouched); for ink, a session-scoped op log **inside `InkOverlay.tsx` itself** — Mod+Z/Mod+Shift+Z route to ink **only while draw mode is on**. Not the drawing store's snapshot undo: the overlay does not import that store at all, and a snapshot stack could restore a document state from before the user's typing. See **Mode mechanics** below for what the log holds and when it is dropped. |

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

### A pending op is addressed by something that survives an edit

The debounce means an op is recorded when the hand moves and spent up to `COMMIT_DELAY` later,
so between the two anything else may write the note — the daemon, the `bismuth` CLI, a second
window, an external editor over SSE, the autosave's frontmatter normalizer. Two rules hold the
window shut, and both are load-bearing:

- **An erase carries the STROKE, not just its coordinates.** A raw line number does not survive
  a foreign insert above the fence, and a raw stroke index does not survive a foreign rewrite of
  that fence's payload. So the op holds a `StrokeRef` — a line number remapped through every
  document change (`inkRemap.ts`, invoked from the update listener, the only place CodeMirror's
  change set exists) plus the stroke itself, from which the index is re-derived at flush.
- **A plan that cannot apply is REPORTED, never returned as the input text.** `planErase` and
  `planStrokeEdit` return a `Plan` (`{ok: true, text}` or `{ok: false, reason}`). `flushNow`
  spends the ops against the real document BEFORE it empties the log, and an op that will not
  resolve is dropped with a console warning.

An unresolvable op is dropped, never applied to a guess: splicing a different stroke is worse
than losing an erase, because nothing looks wrong afterwards and no one reports it.

Only the ADDRESS is remapped. A seam's `origin` is its block's top and a pending stroke's y was
captured in the same layout, so a line shift moves both rigidly and the stored offset is already
correct; rewriting it would be exactly the drift the coordinate contract below exists to prevent.
A foreign REFLOW is still unhandled, for the same reason a late web-font load is.

Pinned by `inkCommit.test.ts` (the plans), `inkRemap.test.ts` (the mapping, against real
`ChangeSet`s) and InkOverlay's `EraseSurvivesALineShift` / `EraseSurvivesAPayloadRewrite`
stories, which are the only place the commit path itself runs end to end.

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
  text to stay aligned with. Its widget top is the block boundary above it and the ink keeps the
  real distance below that boundary it was drawn at, so it paints back where the pen left it.
  **Normalizing to `pad` is the LAST RESORT**, used only when there is no edge in the document to
  measure against at all: normalizing re-seats the ink against a widget that lands wherever the
  fence's three lines fall, which is not where the pen was (measured: ink drawn 380px below the
  prose reappeared 358px higher the moment the pen lifted).

A fence is anchored by its own position in the document, which the document already tracks, so
an insertion above it needs no remapping of anything — unlike the old per-stroke `a: {p, y}`
line anchor, which no longer exists.

## A drawing never displaces text

A standalone fence reserves real height (`standaloneHeight` = its lowest ink plus a pad); an
attached one reserves nothing. So a standalone fence with prose under it turns every unit of ink
added below its lowest ink into a unit the whole rest of the note moves down, the instant the pen
lifts. That is the whole of the user-facing complaint "when i finish drawing, things jump around,
spacing is made", and unlike a coordinate bug the ink is exactly where it was drawn — the
DOCUMENT moves out from under it.

Measured in the running app on a note shaped like the reporter's own (a heading, a standalone
drawing, then three paragraphs): one stroke drawn across the drawing's lower edge is cut at the
box edge, and its upper piece was stored at exactly the box bottom — one pad past the lowest ink
— so the box grew by a pad and **all three paragraphs jumped down 41.9 CSS px**. Every further
stroke across that edge did it again, cumulatively.

The rule `inkCommit.ts` now holds, in three parts:

- Ink inside the vertical span the document already occupies **attaches**, reserves zero height,
  and paints over what is there. That includes ink over a standalone drawing that has text under
  it: it is written into the next attached band instead of into the drawing, so the drawing
  cannot grow. The ink does not move — the attached frame paints it back at the same absolute y —
  it just stops being part of that drawing, which is the price of the note not jumping.
- Ink past the last line of content becomes **one standalone block at the end**, reserving from
  the last content line down to the ink's bottom. Nothing follows it, so nothing is displaced,
  and text written afterwards still flows below it (that is the feature standalone height exists
  for, and it is unaffected).
- **No fence with a non-zero reserved height is ever written above existing content.** The seam
  table is captured at pointerdown and spent up to `COMMIT_DELAY` later, so it can go stale — an
  external edit over SSE, the autosave normalizer, the user typing at the end — and a stale table
  names an insertion point with prose under it. A drawing landing there moves everything below it
  by its whole height. `trailingAnchor` checks its answer against the note's last content line
  and falls back to a normalized fence at the end of the note instead.

Pinned by `inkCommit.test.ts`'s "a drawing never displaces text" block (pure text-to-text, and
the assertion is the reserved height above the prose, not a fence count) and by InkOverlay's
`DrawingNeverDisplacesText` story, which reads the paragraphs' own client rects before and after
a real pointer gesture.

## Export

`bismuth export <note> --format html|pdf|png` renders a note's ink as REAL PICTURES, not as the
base64 its fence stores — `app/src/export/inkHtml.ts` rewrites each fence before the markdown is
rendered, rasterizing its strokes through `ExportDeps.drawingToPng` (the same seam a `.draw` file
export uses, with a `box` argument for a transparent, caller-sized ink layer).

Placement follows the same coordinate contract the editor paints by, expressed in CSS so it holds
at any reading-column width — 624px printable Letter in the PDF, 760px in the PNG, whatever the
window is in an `.html` opened in a browser:

- **Attached**: the annotated block is wrapped in a `position: relative` container and the ink is
  absolutely positioned over it at `width: 100%; height: <its own px>` — x scaled by the column,
  y left in unscaled pixels, which is the asymmetry the contract requires.
- **Standalone**: a block image at `width: 100%; height: auto`, reserving the same height the
  editor widget does, uniformly scaled.

The accepted cost is that an attached raster is scaled non-uniformly by CSS, so a pen nib reads
as a slight ellipse at a column narrower than the 680px logical one (~15% in the PDF). Position
beats nib roundness; making it exact would mean baking the column width into the raster, which is
the guess this placement exists to avoid.

The page-render golden is `cli/test/notePageInk.test.ts` — it renders a note with both fence
shapes and asserts non-trivial ink coverage AND that the annotation lands on its paragraph's own
glyph rows, at two different column widths.

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
