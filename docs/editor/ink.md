# Note ink

Every markdown note in the editor can carry freehand ink: handwriting, underlines and sketches drawn directly over the text, margins included. The ink is stored inside the note itself, so it travels with the file when you copy, sync or export it.

This page is for anyone drawing on notes, for agents that read or write a note's raw markdown, and for engineers changing the overlay.

A note with one annotated paragraph and one standalone sketch looks like this in the file:

````markdown
Ink lives in the note, next to the text it marks.

```draw
AQAAACGLrlYqUbJSKkjNU9JRSgay0tKBjHIlK1MdpTwlK+PaWAAT0WhgsmFhsGFjAAA=
```

```draw block
AQAAACGLrlYqUbJSKkjNU9JRSgay0tKBjHIlK1MdpTwlK+PaWAAT0WhgsmFhsGFjAAA=
```
````

The editor hides both fences and paints their strokes instead.

## Draw on a note

1. Open a `.md` note in the editor and press the `toggle-draw-mode` keybinding (default `Mod+Shift+I`). A drawing toolbar appears and the text stops accepting keystrokes.
2. Draw with the pen. The toolbar also offers a highlighter, a stroke eraser, a lasso to select, move and resize ink, and the color, size and smoothing controls the [drawing page](../drawing/overview.md) describes.
3. Press `Escape` (the `exit-draw-mode` keybinding) or the toggle key to leave draw mode. The ink stays visible while you type.

Draw mode gives you endless scroll space below the last line, so there is always fresh page to draw on. That space is not saved in the note.

Draw mode applies to `.md` notes in the note editor only. It is not available in the vault's `.settings` file or in a `.draw` file (which is its own drawing surface).

Rebind the toggle under `keybindings:` in `.settings`. On Linux and Windows, `Ctrl+Shift+I` opens browser devtools, so rebind it there if the toggle does not respond. See [keybindings](../settings/keybindings.md).

### Undo and redo while drawing

While draw mode is on, `Mod+Z` and `Mod+Shift+Z` (the `ink-undo` and `ink-redo` keybindings) undo and redo ink strokes only. Outside draw mode they undo and redo typing only. The two histories never mix, so undoing a typo cannot remove a drawing and undoing a stroke cannot revert your text. Ink undo covers the current draw-mode session and resets when you leave it.

## Two kinds of drawing: attached and standalone

A fence's kind is written in its info string, never guessed from the lines around it.

| Fence | Kind | What it is | Space it takes |
|---|---|---|---|
| ` ```draw ` | Attached | Ink over the block directly above it | None; it paints over existing text |
| ` ```draw block ` | Standalone | A drawing with no text to attach to | The height of the ink, so text after it flows below |

Ink you draw over text becomes an attached fence under that paragraph, heading or list. Ink you draw below the last line becomes one standalone fence at the end of the note.

Only a fence opened with exactly three backticks counts. A `draw` fence quoted inside a wider fence (four backticks or tildes) is ordinary code, and an unrecognized info string such as ` ```draw other ` stays an ordinary code block.

The editor treats a draw fence as one atomic block: arrow keys step over it, and the cursor never enters its raw base64. Outside draw mode, pressing and dragging a standalone drawing moves it to another spot between the note's blocks, and the hand cursor over it says so. An attached fence cannot be moved on its own, because it belongs to the paragraph above it.

Because ink is note content, a stroke commit is an ordinary note write, and everything that reads the note sees the fences. Change the payload only by drawing; it is a compressed stroke list, not text.

### Ink never pushes your text around

Drawing does not move the words in your note. Ink inside the span the note already covers is saved as an attached fence, which reserves no height, and that includes ink drawn across an existing standalone drawing with text below it. Only ink drawn past the last line becomes a standalone fence, and nothing follows it. Pen strokes that cross a block edge are cut at the edge and each piece goes to the block it landed in.

### How ink follows text

An attached fence stores its ink relative to the top of the block it annotates. If you type into that paragraph, its top stays put and the ink stays on the words it marked. Horizontally, ink scales with the pane width, so a narrow pane squashes annotation ink sideways rather than letting it drift off its text; vertically it keeps its pixel offset because line heights do not change with pane width. A standalone drawing scales uniformly as one picture.

## Export a note with its ink

`bismuth export <note> --format html|pdf|png` renders a note's ink as pictures in place. Each attached drawing is laid over the paragraph it annotates and each standalone drawing sits in the flow. Without this step the ink would export as a block of base64 text. See the [CLI reference](../cli/reference.md) for the other export flags.

Attached ink in an export is scaled sideways to the page's column width but not vertically, so a pen nib can look slightly oval in a column narrower than the editor's. The ink still lands on the words it marks.

## Ink on images and PDFs

Images and PDFs take ink with the same toggle key and toolbar, but the strokes live in a `<file>.draw` sidecar next to the file, not in a fence. None of the fence behavior above applies. See [Drawing](../drawing/overview.md).

## How it works

### Where each piece lives

| Piece | File |
|---|---|
| Overlay component, mounted by `Editor.tsx` for `.md` buffers (not `.settings`) | `app/src/editor/InkOverlay.tsx` |
| Fence scan, read and write; free of CodeMirror and DOM imports | `core/src/drawing/drawBlocks.ts` |
| Stroke payload codec (version byte, deflate, base64) | `core/src/drawing/inkCodec.ts` |
| Stroke-to-markdown commit planner (cut at seams, choose the owning fence) | `app/src/editor/inkCommit.ts` |
| Fence widget: hides the source, reserves height, drag handle | `app/src/editor/drawBlock.ts` |
| Standalone height and ink bounds | `app/src/editor/drawBlockGeometry.ts` |
| Endless scroll space while drawing | `app/src/editor/drawScrollSpace.ts` |
| Pending-op address remapping across foreign edits | `app/src/editor/inkRemap.ts` |
| Toolbar, shared with `.draw` pages | `app/src/drawing/Toolbar.tsx` |
| Export rewrite of fences into pictures | `app/src/export/inkHtml.ts` |

The keybindings `toggle-draw-mode`, `exit-draw-mode`, `ink-undo` and `ink-redo` are entries in `KEYBINDING_CATALOG` (`core/src/keybindings.ts`). `Editor.tsx` handles the toggle on the pane wrapper, so the key only affects the focused pane.

### The fence format

`drawFenceKind(info)` in `drawBlocks.ts` maps the normalized info string to `attached` (`draw`), `standalone` (`draw block`) or `null`. `scanDrawBlocks(text)` follows CommonMark fence rules: a fence opens with a run of backticks or tildes and closes only on the same character with a run at least as long. Only a three-backtick run can open a draw fence, and a fence's whole body is consumed in one step so a nested fence-looking line is content. Each result carries the fence's line range, its decoded strokes, `standalone`, and for an attached fence `attachedToLine`, the nearest non-blank line above it.

The payload is `[version byte][deflated JSON header][deflated point stream]`, base64-encoded. Points are delta-coded per stroke as zigzag varints. A payload that fails to decode reads as no strokes.

### Draw mode and the editor

Entering draw mode reconfigures an `EditorView.editable` compartment to `false`. It is never `readOnly`, so programmatic dispatches such as the reload after an external file change and the autosave normalizer keep working. It also blurs the editor and turns on the overlay's live canvas, so a click cannot place a caret. A second compartment adds the scroll space. Toggling does not rebuild the editor view.

Strokes are captured by the same state machine as a `.draw` page: pressure or velocity width, hold-to-straighten, smoothing on release. `drawStroke` in `core/src/drawing/render2d.ts` paints them.

### Commit model

A stroke is not a document transaction. Strokes and erases accumulate in a session op log and land as one transaction, debounced by `COMMIT_DELAY` (500 ms) and flushed on draw-mode exit, note switch, window blur and unmount. Every ink transaction carries `Transaction.addToHistory.of(false)`, so editor undo never touches ink. The ink undo stack lives inside `InkOverlay.tsx`; it does not use the `.draw` store, whose snapshots could restore a state from before your typing. It is cleared on draw-mode exit and on any document change the overlay did not make.

A pending op must survive edits made during the debounce window by the daemon, the CLI, a second window or the autosave normalizer. An erase therefore carries a `StrokeRef`: a line number remapped through every document change (`inkRemap.ts`, called from the update listener) plus the stroke itself, from which the index is re-derived at flush. `planCommit`, `planErase`, `planStrokeEdit` and `planReorder` return a `Plan`, either `{ ok: true, text }` or `{ ok: false, reason }`. `flushNow` applies the ops against the live document before emptying the log, and an op that cannot be resolved against the document is dropped with a console warning, never applied to a guess.

### Coordinates

Strokes are captured in a logical space: x and y in the editor's reading column of `INK_LOGICAL_W` (680) units, painted at scale `contentDOM.width / 680` with the offset read from the live `contentDOM` rect on each repaint. What a fence stores depends on its kind, per the contract in `inkCommit.ts`:

- Attached fences store ink relative to the top of the annotated block, in unscaled pixels for y and logical units for x. The top is the stable edge, because markdown grows downward.
- Standalone fences store ink in the uniform logical space. Its widget top is the block boundary above it, and the ink keeps its distance below that boundary. Normalizing the ink to the fence's padding is the last resort, used only when the note has no edge to measure against.

### Why a drawing cannot displace text

A standalone fence reserves `standaloneHeight` (its lowest ink plus a pad) and an attached fence reserves nothing, so a standalone fence with prose below it would push the rest of the note down by every unit of ink added past its lowest ink. `inkCommit.ts` prevents this with three rules:

- Ink inside the vertical span the note already occupies attaches, reserves zero height, and paints in the same absolute position. Ink over a standalone drawing that has text below it is written into the next attached band instead of into the drawing, so the drawing cannot grow.
- Ink past the last content line becomes one standalone block at the end.
- No fence with non-zero reserved height is ever written above existing content. The seam table is captured at pointer-down and spent up to `COMMIT_DELAY` later, so it can be stale; `trailingAnchor` checks its answer against the note's last content line and falls back to a normalized fence at the end.

Regression coverage: `inkCommit.test.ts` (pure text-to-text plans, including the displacement block), `inkRemap.test.ts` (mapping against real `ChangeSet`s), the `InkOverlay` stories `EraseSurvivesALineShift`, `EraseSurvivesAPayloadRewrite` and `DrawingNeverDisplacesText` (the only place the commit path runs end to end), and `cli/test/notePageInk.test.ts` (an exported note with both fence kinds, at two column widths).

### Export placement

`inkifyMarkdown` in `inkHtml.ts` rasterizes each fence to a transparent PNG through `ExportDeps.drawingToPng` (with a `box` argument), the same seam a `.draw` export uses, then rewrites the markdown before it renders. An attached drawing wraps the annotated block in a `position: relative` container and places the picture absolutely at `width: 100%; height: <its own px>`, so x scales with the column and y stays unscaled, matching the editor. A standalone drawing is a block image at `width: 100%; height: auto`. A note with no ink exports unchanged.

### Embeds and the server

`kindForTarget` in `app/src/editor/embedSpec.ts` returns `null` for the `.draw` extension, so `![[Sketch.draw]]` is not an embed and stays as plain text. A stroke commit is an ordinary note write, classified, cached and indexed like typing, and a note's ink needs no handling on rename, move or delete beyond the note itself.

Source: `core/src/drawing/drawBlocks.ts`, `core/src/drawing/inkCodec.ts`, `core/src/drawing/model.ts`, `core/src/drawing/render2d.ts`, `core/src/keybindings.ts`, `app/src/editor/InkOverlay.tsx`, `app/src/editor/inkCommit.ts`, `app/src/editor/inkRemap.ts`, `app/src/editor/drawBlock.ts`, `app/src/editor/drawBlockGeometry.ts`, `app/src/editor/drawScrollSpace.ts`, `app/src/editor/embedSpec.ts`, `app/src/export/inkHtml.ts`, `app/src/Editor.tsx`
