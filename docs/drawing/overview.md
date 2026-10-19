# Drawing

A drawing is a `.draw` file in your vault: a multi-page vector sketch you draw with a pen, a highlighter and an eraser. The same pen and highlighter also ink directly on any image or PDF you open, saving the marks beside the file. This page is for anyone who draws in Bismuth, and for engineers who read or write `.draw` files.

A `.draw` file is JSON Lines: a header line, then one line per page that has anything on it. This one is a three-page drawing with a single pen stroke on its second page:

```json
{"v":1,"kind":"drawing","paper":{"bg":"grid"},"pageCount":3}
{"page":1,"strokes":[{"t":"pen","c":"fg","w":5,"pts":[50,50,255,200,200,200]}]}
```

Ink inside a note (a ` ```draw ` fence) uses the same stroke format but has its own page; see [note ink](../editor/ink.md).

## Create a drawing

Right-click a folder in the file tree and choose **New Drawing** to make `Untitled.draw` there, ready to rename. The **New drawing** command (command palette, the `+` menu or a toolbar button) makes `Drawing.draw` at the vault root and opens it. A `.draw` file that does not exist yet, or is empty, opens as a blank drawing on grid paper.

## Draw on a page

The toolbar above the page holds every control. Each page is a letter-sized sheet; add more with **add page** under the last one. Everything saves automatically after each stroke, erase, paper change or undo.

| Control | Choices |
|---|---|
| Tool | Pen, highlighter, eraser |
| Colour | Default ink, the theme accent, rose, gold, green |
| Size | Five levels: 2, 5, 9, 14, 20 |
| Smoothing | `sharp` keeps your raw path; `smooth` relaxes the stroke when you lift the pen |
| Paper | blank, lines, grid, dots (shared by every page) |
| Undo / redo | Whole-drawing history |
| Zoom | 25% to 400%, read as `− 100% +`; Cmd/Ctrl + wheel or pinch zooms smoothly, `−` and `+` step 5%, and `[reset]` returns to 100% |
| Import image | Place a picture on page 1 |

A new drawing starts on the pen, the 5 size, `smooth` and grid paper.

The pen thins with speed, or follows pressure on a stylus. The highlighter draws a translucent band at twice the pen size. The eraser removes a whole stroke: the topmost stroke within a few pixels of the pointer, not individual pixels.

Default ink is stored as the word `fg` and resolves to the theme's ink colour whenever the drawing is drawn, so it follows a theme change. The accent and the other colours are stored as fixed hex values. The drawing surface always paints on the dark theme's paper.

### Hold to straighten

With the pen tool, pause for 0.9 seconds a few points into a stroke and it snaps to a straight line from where you started to where the pen is. Keep moving to aim the end. The line is stored as two points and is never smoothed.

### Place an image on a page

Add a picture three ways: the **Import image** button, pasting an image from the clipboard (focus the page first), or dragging an image file onto a page. An imported picture is centred on the page, fitted to it and never enlarged beyond its own size. Images sit under the ink, so you can draw over them. They are stored inside the `.draw` file, which keeps the file portable. You can undo an insert, but you cannot select, move or delete one afterwards.

## Ink on images and PDFs in place

An image or PDF opens in a preview tab, and you draw on it right there. Press Mod+Shift+I (the `toggle-draw-mode` keybinding, Escape to leave) or the **Draw** button in the preview bar. The drawing toolbar docks at the bottom of the visible area with the pen, highlighter, eraser, colour, size, smoothing and undo controls.

Your marks save to a sidecar named after the file with `.draw` added: `photo.png` becomes `photo.png.draw`, `report.pdf` becomes `report.pdf.draw`. The file tree hides the sidecar while its image or PDF exists, and the sidecar moves with it. Nothing is written until you draw something.

Mod+Z and Mod+Shift+Z undo and redo on the focused preview whether or not draw mode is on. One history covers strokes, highlights, bookmarks and the scratch strip (on, off and its width) together, and it resets when a different file opens.

Saving is debounced by 600 ms and flushes when you leave draw mode, click out of the pane, switch files or close the tab. Three cases protect existing data:

- An empty sidecar means no ink yet, and nothing is written until you draw.
- A sidecar that cannot be read as a drawing, including one with a line that is not valid JSON, is never overwritten. Ink stays off for that file, its ink controls stay disabled, and trying to draw shows `Couldn't read this file's ink, so drawing is off`.
- If reading the sidecar fails, ink stays off the same way, rather than risk overwriting it.

A sidecar created by drawing in place holds strokes on blank paper, without a copy of the image or PDF page. A headless export of that sidecar therefore renders your ink on a blank page.

## Highlight, bookmark and add a margin on a PDF

A PDF's preview bar adds three more tools. Highlights are saved inside the PDF itself; bookmarks and the scratch strip are saved in the same `<file>.draw` sidecar as ink. The tools stay disabled until the sidecar has loaded.

| Control | What it does |
|---|---|
| **Highlight text** | With text selected, highlights it at once and stays off. With nothing selected it arms: your next text selection is highlighted, or a click on an existing highlight removes it. Right-click it for its colours: yellow, green, blue, pink and orange, the current one marked. Picking a colour with text selected highlights it in that colour at once; with nothing selected it arms highlight in that colour. The colour holds for every PDF until you pick another, and a new window starts on yellow |
| **Draw** | Turns draw mode on and off, the same as Mod+Shift+I |
| **Scratch paper** | Adds a drawable strip to the right of every page, or removes it |
| **Bookmarks** | Opens a right-hand panel with your bookmarks (add the current page, jump, rename, delete) above the PDF's own outline |

The bar also shows the current page (click it to type a page number), the zoom controls and a `fit` button that returns to fit-to-width. In the desktop app it adds open-in-default-app and reveal-in-file-manager buttons. Narrow panes drop the zoom steps, the dark-mode moon and the file actions first; the highlight, draw, scratch and bookmark controls stay at every width.

A PDF or image opens where you left it: the same zoom, scroll position and (for a PDF) bookmarks panel, whether you come back by switching tabs, reopening a closed tab with Cmd+Shift+T, opening the file again or restarting the app. The first open of a file is fit-to-width at the top.

### Resize the scratch strip and the bookmarks panel

Drag the line between a page and its scratch strip, or the left edge of the bookmarks panel, the same way you drag the sidebar's edge. Hover either line and it lights up, with a chevron button at its middle; a click on the line or the chevron hides that strip or panel.

| Line | Drag | Saved in | Snaps onto |
|---|---|---|---|
| Page and scratch strip | Left widens the strip, right narrows it, from a tenth of the page's width to twice it | The PDF's sidecar, so each PDF keeps its own width | The 0.4 default, within 12px |
| Bookmarks panel's left edge | Left widens the panel, up to 60% of the preview | `appearance.pdfBookmarksWidth` in `.settings`, shared by every PDF | The 260px default, within 12px |

One drag of the scratch line is one Mod+Z step. The scratch line is hidden in draw mode and while highlight is armed, so a stroke or selection that starts on it is never taken as a drag.

An outline entry whose destination cannot be resolved shows dimmed and does nothing. Highlights default to yellow. Highlighting a selection that overlaps or touches an existing highlight of the same colour on the same line extends that highlight into one mark, joining their text, instead of stacking a second mark on the shared words. Highlighting over a highlight of another colour recolours the part you selected: the old highlight keeps the rest of its line in its own colour.

## Share highlights with Preview, Okular, Edge and Acrobat

A highlight you make on a PDF in Bismuth is a standard PDF highlight annotation written into the PDF file, the format macOS Preview, Okular and Evince on Linux, and Windows viewers such as Edge, Acrobat and SumatraPDF read and write. In the other direction, a highlight any of those apps saved into the PDF shows in Bismuth in its own colour, and a click on it while **Highlight text** is armed removes it from the file. Mod+Z undoes a highlight add or remove in the file too.

- **Existing sidecar highlights move into the PDF** the first time Bismuth opens that PDF, and leave the sidecar. `bismuth highlights migrate --all` moves every PDF's at once.
- **A PDF Bismuth cannot rewrite safely keeps its highlights in the sidecar**: an encrypted PDF, or one carrying a digital signature, whose signature a rewrite would break. Highlights other apps put in such a file still show, and are never copied into the sidecar.
- **Highlights that cover the same spot are one mark to Bismuth.** Removing one removes every highlight drawn over exactly the same lines.

## Read a PDF in dark mode

PDF dark mode shows a PDF's pages inverted with their hues kept: white paper turns black, black text turns white, and a red figure stays red. Press the moon button in a PDF's preview bar to switch that PDF; the choice is remembered for that PDF alone, so it opens the same way next time. The moon stays disabled until the sidecar has loaded.

The choice is saved in the PDF's `<file>.pdf.draw` sidecar, beside its ink, and undoes with Mod+Z like the scratch strip. The PDF itself is untouched. A PDF you have never switched follows the default in `.settings`, which the **Toggle PDF dark mode default** command also flips:

```yaml
appearance:
  pdfDarkMode: true
```

In dark mode, highlights show as a tint behind the white text, pen ink in the default colour turns light, and the scratch paper strip keeps its own ground.

## Read a PDF's highlights from the shell or an agent

A PDF's highlights are standard annotations inside the file, so other PDF apps show them. `bismuth highlights <file.pdf>` prints the highlighted text page by page, including any still in the `<file>.draw` sidecar; `bismuth highlights migrate <file.pdf>` moves those into the PDF. An agent reaches both through the `bismuth_cli` MCP tool. The [CLI reference](../cli/reference.md#export-and-render) has its flags and output.

```bash
bismuth highlights "readings/week 8 reading 1.pdf"
bismuth highlights "readings/week 8 reading 1.pdf" --json
```

On an image, the scratch strip appears only when its sidecar already carries a `margin`; the preview bar has no scratch button for images. Dragging the line between the image and its strip resizes the strip, and a click on that line does nothing, since nothing in the bar could bring a hidden strip back.

## Scratch notes

The scratch strip also takes typed notes. Click any empty spot on the strip and a small note block starts there, pinned to that page and position. A page can hold any number of blocks, and each scales with zoom so it stays beside the passage it annotates.

- **Look.** The strip is a note surface, not the page's own paper. It uses the editor's ground and the prose font, and ink drawn on it takes the note-ink colours. A stroke that crosses from the page onto the strip changes colour at the page edge.
- **Where blocks live.** Typed blocks are saved in the body of the file's companion note (`x.png` has `x.png.md`), below its frontmatter, not in the `.draw` sidecar. That makes their text searchable and lets their `[[wikilinks]]` and `#tags` reach the vault graph like any other note. The block grammar is in [companion notes](../vault/frontmatter.md).
- **When blocks are editable.** Blocks take clicks only while scratch paper is on, draw mode is off, and highlight is not armed. In draw mode the strip takes ink only.
- **Editing.** Clicking empty strip space places a block and focuses it; leaving a block that is still blank removes it. Hover a block for an `X` to delete it and a handle along its top edge to drag it; dropping it over any page's strip re-anchors it there.
- **Undo.** Mod+Z inside a block undoes that block's own text only. Creating, moving or deleting a block is not undoable.

Because a block's text lives in the companion note and not in the `.draw` file, an export of the sidecar does not include it.

## The `.draw` file format

A `.draw` file is JSON Lines: line 1 is the header, and each later line is one page. The same format holds a standalone drawing and the `<file>.<ext>.draw` ink sidecar of an image or PDF. A page with no strokes, images or highlights has no line, so a PDF with ink on three pages is a four-line file. A stroke rewrites one line, and `grep '"page":40' book.pdf.draw` returns page 40 with its marks.

The header line holds these keys.

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | Version discriminant |
| `kind` | `"drawing"` | Literal checked on read |
| `paper.bg` | `"blank" \| "lines" \| "grid" \| "dots"` | Background shared by every page |
| `pageCount` | `number` | How many pages the drawing has, empty ones included. A non-negative integer |
| `bookmarks` | `Bookmark[]?` | Image and PDF sidecars only |
| `margin` | `{ right: number }?` | Image and PDF sidecars only |
| `dark` | `boolean?` | PDF sidecars only |

Any other top-level key in the header is kept when the file is read and rewritten.

A file that is one JSON object with a `pages` array (`{"v":1,"kind":"drawing","paper":{...},"pages":[...]}`) also opens. The next save rewrites it as JSON Lines.

Each page line is `{"page": <index>, ...}` with a 0-based index below `pageCount`, followed by that page's `strokes`, `images?` and `highlights?`. Pages are written in ascending order. A page that has no line reads as empty.

A drawing read from a file with no page lines is `pageCount` empty pages. An empty drawing, as the app creates it, is one grid page:

```json
{"v":1,"kind":"drawing","paper":{"bg":"grid"},"pageCount":1}
```

### Read a file that fails to parse

A `.draw` file that is empty, or does not exist yet, is a new drawing and opens as one blank grid page. A file with any other problem does not open for editing: an unparseable line, a missing or invalid `pageCount`, a `page` index that is not an integer below `pageCount`, or a first line whose `kind` is not `"drawing"`.

- On a standalone drawing, the drawing page shows `couldn't open this drawing` with the error and a **retry** button. Saving is off, so the file stays exactly as it was.
- On an image or PDF, ink is switched off for that file and the sidecar is never overwritten.
- `bismuth render` and `bismuth export` stop with the error. An empty file renders as one blank page there, as it does in the app's export pane.

Fix or remove the bad line to open the file again.

### Pages and strokes

Every page uses a fixed logical space of 816 by 1056 units (`PAGE_W`, `PAGE_H`: US Letter at 96 DPI), whatever the screen size or zoom. A page is `{ strokes, images?, highlights? }`.

| Stroke field | Type | Meaning |
|---|---|---|
| `t` | `"pen" \| "hl"` | Pen or highlighter. The eraser is not stored |
| `c` | `string` | `"fg"` for theme ink, or a hex colour |
| `w` | `number` | Base width: one of 2, 5, 9, 14, 20 |
| `straight` | `boolean?` | `true`: draw only the first and last point as a capsule |
| `pts` | `number[]` | Flat `[x, y, pressure, x, y, pressure, ...]` triplets |

`x` and `y` are logical units, rounded to integers when written. `pressure` is a byte from 0 to 255, clamped when written; a point with missing pressure reads as 255. A straight stroke stores exactly two triplets, and any extra points are ignored when drawing.

```json
{ "t": "pen", "c": "#CBB27E", "w": 9, "straight": true, "pts": [100, 100, 255, 400, 300, 255] }
```

Images on a page are `{ src, x, y, w, h }`. `src` is a `data:image/...;base64,...` URL, and `x`, `y`, `w`, `h` are the bounding box in page units. Saving rounds the box and never touches `src`.

### Highlights, bookmarks and margin

An image or PDF sidecar can carry these extra fields.

| Field | Shape | Notes |
|---|---|---|
| A page line's `highlights` | `{ id, c, rects, text? }[]` | Only on an image's sidecar or a PDF that cannot be rewritten; any other PDF keeps its highlights in the file. `rects` are one `{x, y, w, h}` per line of selected text, in page units. `c` is a hex colour or `"hl"` for the default yellow |
| `bookmarks` | `{ id, page, label }[]` | `page` is 0-based; `label` defaults to `Page N` |
| `margin` | `{ right }` | Strip width as a fraction of the page's rendered width, clamped to 0..2. Turning the strip on sets 0.4, dragging its line sets 0.1 to 2, turning it off removes the key |
| `dark` | `boolean` | This PDF's dark mode, written by the moon button. `false` keeps the PDF light under a dark `appearance.pdfDarkMode` default; an absent key follows that default |

The PDF's outline is not stored; it is read from the PDF each time.

### Where sidecar ink sits on its source page

Sidecar page `i` is source page `i`: an image has one page, a PDF has one per page. The source page occupies a box inside the 816 by 1056 space. If the sidecar page carries `images[0]`, that stored box is the page box and wins. A stored `images[0]` is the source image or PDF page embedded as a data URL, and an export draws it under the ink. Otherwise the box is the source's natural size scaled to fit and centred.

A screen point maps to the page by `logical = box.xy + (screenPoint - renderedPageRect.xy) x (box.w / renderedPageRect.w)`. Margin ink sits at logical `x` beyond `box.x + box.w`. Ink drawn outside the page box is kept in the file but not shown.

## Export a drawing

A drawing exports to PNG or PDF. From the app, open the drawing and use **Export current file…** (Mod+Shift+P); the options are on the [export page](../export/overview.md). From the shell:

```bash
bismuth export Sketch.draw                       # Sketch.draw.png, no vault needed
bismuth export Sketch.draw --format pdf --out sketch.pdf
bismuth render Sketch.draw --theme light --out sketch-light.png
```

Both commands render without a browser. `--theme` is `dark` (the default) or `light` and sets the paper and the colour of default ink. Every page renders at twice its logical size. A PNG stacks the pages vertically in one tall image. The PDF from the shell has one page per drawing page, each 816 by 1056 points. The PDF the app produces is cut onto Letter pages instead.

Placed images export under the ink. An undecodable image is skipped rather than failing the export. The command's full flags are in the [CLI reference](../cli/reference.md).

## How it works

The subsystem splits into a headless backend (`core/src/drawing/`) of pure functions and a browser frontend (`app/src/drawing/`, `app/src/preview/`). Rendering has no DOM dependency, so the same code draws on screen, in the CLI and in the export pane.

### Width model

`input.ts` derives each point's width. A pointer event has real pressure when `pressure > 0 && pressure !== 0.5`; 0.5 is the browser's default for a mouse. With real pressure, width is `base x (0.35 + 1.4 x pressure)`. Without it, width follows speed: `t = min(speed / 3.2, 1)` and `base x (1.25 - 0.7 x t)`, where `speed` is distance over milliseconds times 16. The result is normalised by `base x 1.75` and stored as the pressure byte, so the taper is baked into the file and replays identically.

### Smoothing

In `smooth` mode, `smoothStrokePoints()` runs once on pointer-up; the live stroke is always raw. It dedupes points closer than 0.6 units, resamples at even arc length, runs binomial `[0.25, 0.5, 0.25]` denoise passes with pinned endpoints, then interpolates a centripetal Catmull-Rom spline (alpha 0.5, 8 samples per segment). Strength scales with the stroke's length so handwriting survives:

| Arc length | Resample spacing | Denoise passes |
|---|---|---|
| under 70 | 2 | 1 |
| 70 to 160 | ramps linearly 2 to 9 | ramps linearly 1 to 12 |
| over 160 | 9 (`RESAMPLE_SPACING`) | 12 (`DENOISE_PASSES`) |

Strokes with fewer than 3 points come back unchanged.

### Stroke outlines

`strokeOutline()` in `geometry.ts` turns a stroke into a filled polygon with `perfect-freehand`: `thinning` 0.6 for a freehand pen and 0 for a highlighter or straight stroke, `smoothing` 0.5, `streamline` 0 (the input is already smooth, and streamline only adds lag), `simulatePressure` false, `last` true. The polygon is filled through quadratic curves between midpoints, which avoids a faceted outline.

The highlighter draws at alpha 0.32. On a light page it uses `multiply`; on a dark page, where multiply would vanish into near-black, it uses `screen`. The choice follows the paper's luminance (below 0.18 counts as dark).

### Paper and theme colours

`GRID_GAP` is 14 units for ruled lines, grid lines and dots (dot radius 1.3). Lines and grid use the theme's `borderSoft` token and dots use `border`. `themeColors()` in `theme.ts` reads two buckets from `core/src/theme/tokens.ts`: `light` resolves to the `paper` theme and `dark` to the default theme (`ink`), supplying `bg`, `fg`, `border` and `borderSoft`. `makeColorResolver()` turns `"fg"` into the bucket's `fg`.

### Canvas and store

`DrawingCanvas.tsx` stacks two canvases per page. The base canvas repaints through `renderPage()` when the document or theme changes. The live canvas redraws only the in-progress stroke and clears on pointer-up. The pixel ratio is capped at 2, and pointer events are read coalesced for smooth stylus input. Pointer positions map to logical units through `getBoundingClientRect()`, so zoom changes only the CSS size.

Decoded images are cached module-wide in an LRU of 32 entries, shared by every canvas. `renderPage()` draws paper, then images, then strokes, and skips an image that has not finished decoding until it repaints.

`createDrawingStore()` in `store.ts` holds the document as a signal with whole-document undo and redo stacks (`structuredClone` snapshots). Every mutation, including undo and redo, calls the save callback, which writes through the generic `PUT /file` route; there is no drawing-specific route. The eraser deletes the topmost stroke whose points fall within `tools.size + 8` units of the pointer.

### Preview ink layer

`PageInk.tsx` renders sidecar ink over an image or PDF page, driven by one annotation store (`createAnnotationStore.ts`) that `PreviewView` creates for the open file and shares with `PageInk`, `HighlightLayer` and `BookmarksPanel`. The coordinate rules live in `core/src/drawing/pageInk.ts` (`pageBoxFor`, `screenToLogical`, `logicalToScreen`, `ensurePages`, which pads a sidecar when ink first lands on a later page and never truncates one). An image measures the painted `<img>` rect letterboxed by `object-fit: contain`; a PDF hands `PageInk` to `PdfPages` as an overlay and feeds it page boxes from its layout callback. Canvases exist only for pages near the viewport, tracked by an `IntersectionObserver` that watches a page only while draw mode is on or the page has ink.

The page|strip line and the bookmarks panel's edge are `shell/EdgeHandle`, the sidebar's grab strip. `PdfPages` and `ImagePane` render the scratch line's handle through their `scratchEdge` slot, after the ink overlay so it takes the pointer first. `preview/scratchResize.ts` turns a drag into a ratio: it takes the surface's own layout as a function from ratio to line position (`fixedUnitLine` for a PDF page, `imageZoomLayout` for an image) and solves for the ratio that puts the line under the pointer. `PreviewView` previews that ratio in a signal while the pointer moves and writes the sidecar once on release. The bookmarks width goes through `edgeResize.ts`'s `dragWidth`, as the sidebar's does.

The margin strip paints in two passes (`paintSplit`): each stroke against the page's colour bucket, and against the strip's dark bucket when a strip exists, split at `box.x + box.w`. `PdfPages` lays a page and its strip out together inside the zoom width.

### PDF highlight annotations

`core/src/drawing/pdfHighlights.ts` reads and writes a PDF's highlights with pdf-lib, and runs unchanged in the iPad's in-process core. Each highlight is a `/Subtype /Highlight` annotation with one quad per line in `/QuadPoints`, in upper-left, upper-right, lower-left, lower-right order, plus an `/AP` appearance whose resources carry an ExtGState with `/BM /Multiply`. PDFKit and Poppler regenerate a highlight from its quads unless that ExtGState is present, and both draw counter-clockwise quads as a bowtie, so both details are load-bearing. `/C`, `/CA`, `/F 4`, `/M`, `/NM` and `/T (Bismuth)` complete the dictionary.

A highlight's id is `pdfHighlightId(page, quads)`, a hash of the page and the quads rounded to half a point. Preview drops `/NM` on save and object numbers change on every rewrite, so geometry is the only identity both pdf-lib and pdf.js see. Page geometry follows pdf.js: the CropBox clipped to the MediaBox and `/Rotate`, both inherited from the page tree, mapped into the 816 by 1056 logical page through `fitImage`.

`readPdfHighlights` reports a file as not writable when it is encrypted, signed (a `/Sig` field, `/SigFlags`, or `/Perms` DocMDP or UR3), or unreadable, and `applyPdfHighlightEdits` refuses those with `PDF_NOT_WRITABLE` (HTTP 409). Edits are `{ add, remove }` applied to the file as it is on disk, so a highlight another app added since Bismuth read the file survives. `core/src/pdfHighlightStore.ts` runs them through `POST /pdf/highlights`, serves the highlights a PDF holds through `GET /pdf/highlights?path=` (the light reader, 404 for a missing file; the viewer reads them there instead of asking pdf.js for every page's annotations, which would range-fetch each highlighted page), and moves sidecar highlights with `POST /pdf/highlights/migrate`; an add or remove is appended to the file as a PDF incremental update (new annotation objects, the changed page's `/Annots`, a cross-reference section and a trailer pointing at the previous one), so the original bytes stay untouched and an edit to a large scanned PDF writes a few kilobytes. `core/src/drawing/pdfLight.ts` reads only the cross-reference data and the page tree for this, handling classic tables, cross-reference streams, object streams and hybrid files. A remove that matches no annotation writes nothing. A file the light reader cannot resolve, and the iPad's in-process core, which has no append, take a full pdf-lib save written through a temporary file and a rename onto the real path, keeping a symlink and the file mode; that response carries `rewrote: true`. `core/src/drawing/pdfHighlightText.ts` recovers the text under each highlight with pdf.js for `bismuth highlights`, because Preview stores none. It imports `@napi-rs/canvas` and pdf.js's worker module by literal specifiers and hands them to pdf.js through `globalThis` (`DOMMatrix`, `Path2D`, `pdfjsWorker`), because the compiled `bismuth` binary cannot resolve the runtime requires pdf.js makes for them.

In the app, `PdfPageCanvas` renders with `annotationMode: ENABLE_STORAGE` and marks every Highlight annotation `noView` in the document's annotation storage, so pdf.js paints ink, stamps and other annotations but never a highlight. `PdfPages` reads a URL-loaded PDF's highlights from `GET /pdf/highlights`, and falls back to pdf.js `getAnnotations()` (`pdfAnnotHighlights.ts`) for a PDF loaded from bytes, one the server reports as not writable, or a failed request; it reports them through `onPdfHighlights`, with page geometry through `onPageGeoms`. The annotation store holds them in the same in-memory document as ink, so undo, extend-on-overlap and dark mode work unchanged. A new highlight stores the colour picked from the highlight button's right-click menu (`app/src/preview/HighlightColorMenu.tsx`, `PDF_HIGHLIGHT_COLORS` in `core/src/theme/tokens.ts`, held per window by `app/src/preview/highlightColor.ts`; yellow stays the `hl` sentinel), and `addHighlight` (`core/src/drawing/pageHighlights.ts`) cuts the selected rects out of any highlight of another colour before adding it, so overlapping colours never stack. On save it sends `diffHighlights` of the last saved set and calls `expectSelfWrite` first, so the open document is not reloaded by its own write; a failed write cancels that and retries with backoff.

PDF dark mode is CSS only. `PreviewView` reads it with `darkOf` (`core/src/drawing/pageDark.ts`): the sidecar's `dark` flag, else `appearance.pdfDarkMode`; the moon writes the flag with `setDark` through the annotation store. `PdfPageCanvas` puts `filter: invert(1) hue-rotate(180deg)` on each page canvas, so the stashed raster and the text layer stay as rendered. `HighlightLayer` switches its rects from `multiply` to `screen` at a lower alpha, because multiply over black paper paints nothing. `PageInk` resolves page ink against the dark bucket instead of the light one.

PDF documents are cached by vault path (`pdfDocCache.ts`, 3 documents) and share one pdf.js worker. A raster stash keeps the last 4 rendered (page, width) canvases so a remounted tab paints instantly. On desktop, `PdfPages` opens a PDF from its `/asset` URL with pdf.js range requests (`disableStream`, `disableAutoFetch`), so the first page paints after a few megabytes instead of the whole file. An SSE change that names the exact path invalidates an entry and reloads any open view of it (`onPdfReplaced`); a sidecar's own edits, and a highlight save that appended to the file, do not evict its PDF, while a save that rewrote it does. An SSE change with no paths revalidates each cached document against its `ETag` and drops the ones whose file changed; a document with no `ETag` to ask with (the iPad's in-process core, a story) is dropped. `PdfPages` keeps the reader's place (page and fraction under the viewport's middle) across reflows. Zoom (`zoomGesture.ts`, `createPreviewZoom.ts`) treats a Chrome-style pinch as ctrl+wheel with factor `exp(-deltaY x 0.01)`, clamps a wheel notch to about 1.3x, handles Safari `gesture*` events for WKWebView, and keeps the point under the pointer fixed. The zoom buttons glide for 160 ms, and a page re-renders sharp once its size has held still for 140 ms. While the page stack scrolls, a page that comes into view paints its raster but builds its selectable text layer only once 150 ms pass with no scroll event, and the stack's per-page visibility checks re-run only when a page enters or leaves the rendered window. Only pages in that window (the viewport plus about a viewport of overscan each way) have DOM: `PdfPages` renders their rows alone and reports the range through `onVisibleRange`, and `PreviewView` hands it to `PageInk` and `HighlightLayer` as `visibleRange`, so the cost of a zoom frame follows the pages on screen, not the length of the document. An image zooms from fit up to 8x.

`preview/previewViewMemory.ts` remembers each preview's view by vault path: a PDF's zoom, panel state and `PdfPosition`, and an image's zoom with the picture point under the centre of the view. Every save updates an in-memory map and a debounced write mirrors it to `localStorage` (`bismuth-preview-view::<api base>`, the 500 most recently saved paths), flushed on `pagehide`; a rename or delete re-keys or drops the entry. An image keeps that centre point as a live anchor: each explicit re-layout scrolls back to it, so the place survives a reflow such as the companion strip settling above a reopened image, and a scroll event that only echoes the anchor's own clamped offset does not move it.

Scratch notes: `createCompanionStore.ts` is the one owner of a binary's companion note while its preview is open. Tags (`CompanionFrontmatter`) and blocks (`ScratchTextLayer`) both write through it, with one debounced write and one conflict-reload path, so neither drops the other's content. `core/src/scratchNotes.ts` parses and writes the block regions. Only pages within two of the current page mount a block editor.

### Export

`core/src/drawing/export.ts` renders with `@napi-rs/canvas` and assembles PDFs with `pdf-lib`. `renderDocToPng(doc, theme, box?)` stacks all pages in one canvas at `SCALE = 2` (1632 by 2112 per page). `renderDocToPdf()` rasterises each page separately and embeds each as a PDF page. Both pre-decode every distinct image `src` first.

When `renderDocToPng` receives a `box` (`{ width, height }`), it takes the note-ink path: only `pages[0].strokes`, no paper or images, on a transparent canvas of the caller's size. A note's ` ```draw ` fences use this so the ink composites over the exported page's own text (`app/src/export/inkHtml.ts`). `cli/src/commands/draw.ts` never passes `box`.

The browser export pane rasterises with `app/src/export/drawingRaster.ts`, which feeds the same `renderDocStacked` into a DOM canvas, so the preview and the CLI output agree apart from canvas rounding.

### The file format code

`serializeDoc()` in `core/src/drawing/model.ts` rounds the document with `roundDoc()`, writes every top-level key except `pages` plus `pageCount` as line 1, then one `{ page: i, ...page }` line for each page that `pageHasContent()` accepts. `parseDoc()` splits on newlines, ignores blank lines, and builds `pageCount` empty pages before laying each page line over its index. A file holding one JSON object with a `pages` array takes the single-object path. Every failure throws, and each caller refuses to write after a throw: `loadDrawing()` in `DrawingPage.tsx` returns an error result instead of a document (a zero-byte file short-circuits to `emptyDoc()` first), `createAnnotationStore.ts` sets its load state to `failed` and logs a `[page-ink]` warning, and `drawingRaster.ts` treats a zero-byte file as a blank page before calling `parseDoc()`. The CLI calls `parseDoc()` directly.

### Gotchas

- Two different "fewer than 3" checks exist: `eachPoint` yields one point per complete triplet of the flat array, while `smoothStrokePoints` skips strokes with fewer than 3 points.
- `fg` is written to disk as the literal string, so a theme change recolours existing default-ink strokes with no re-save.
- The page size is fixed. There is no per-drawing or per-page size.
- A stored `images[0]` box wins over a fit computed from the source's natural size, because the strokes were drawn against it.
- `PaneContent.tsx` matches the `.draw` route before the preview route, so a sidecar such as `photo.png.draw` opened directly opens as a drawing.

Source: `core/src/drawing/model.ts`, `core/src/drawing/geometry.ts`, `core/src/drawing/smooth.ts`, `core/src/drawing/paper.ts`, `core/src/drawing/theme.ts`, `core/src/drawing/render2d.ts`, `core/src/drawing/export.ts`, `core/src/drawing/pageInk.ts`, `core/src/drawing/pageHighlights.ts`, `core/src/drawing/pageBookmarks.ts`, `core/src/drawing/pageMargin.ts`, `core/src/drawing/pageDark.ts`, `core/src/scratchNotes.ts`, `core/src/fileKinds.ts`, `core/src/theme/tokens.ts`, `app/src/drawing/DrawingPage.tsx`, `app/src/drawing/DrawingCanvas.tsx`, `app/src/drawing/Toolbar.tsx`, `app/src/drawing/store.ts`, `app/src/drawing/input.ts`, `app/src/preview/PageInk.tsx`, `app/src/preview/createAnnotationStore.ts`, `app/src/preview/createCompanionStore.ts`, `app/src/preview/PreviewBar.tsx`, `app/src/preview/pdfDocCache.ts`, `app/src/preview/PdfPages.tsx`, `app/src/preview/PdfPageCanvas.tsx`, `app/src/preview/HighlightLayer.tsx`, `app/src/preview/HighlightColorMenu.tsx`, `app/src/preview/highlightColor.ts`, `core/src/drawing/pdfHighlights.ts`, `core/src/drawing/pdfHighlightText.ts`, `core/src/drawing/pdfLight.ts`, `core/src/pdfHighlightStore.ts`, `app/src/preview/pdfAnnotHighlights.ts`, `app/src/preview/highlightSaveDiff.ts`, `app/src/preview/scratchResize.ts`, `app/src/preview/ImagePane.tsx`, `app/src/preview/previewViewMemory.ts`, `app/src/shell/EdgeHandle.tsx`, `app/src/edgeResize.ts`, `app/src/PreviewView.tsx`, `app/src/export/drawingRaster.ts`, `app/src/export/inkHtml.ts`, `cli/src/commands/draw.ts`, `cli/src/commands/export.ts`
