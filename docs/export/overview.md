# Export

Export turns a note, base, spreadsheet or drawing into a file you can share: Markdown, HTML, PNG, PDF, or CSV for a base. It works from the app's export pane and from the `bismuth export` command, and both produce the same result except for a note's tables ([tables](#export-a-notes-tables)). This page is for anyone who exports, and for engineers who add a format or change how pages are cut.

```bash
bismuth export Essay.md --format pdf --out essay.pdf
bismuth export Tasks.md --mode visual --format html
bismuth export Sketch.draw                          # Sketch.draw.png, no vault needed
```

## Export a file from the app

Open the file you want, then run **Export current file…** (Mod+Shift+P, or File > Export…). An export tab opens beside your work. Its bar names the file and holds the format toggle and `[export]`. Below the bar, a live preview of the page sits on the left and the options on the right. Change an option and the preview updates; nothing is written until you export.

The options run in the order you decide them: how the file looks, what goes in, then where it goes. The last line names exactly what the export writes, such as `writes roadmap.pdf → Downloads`, next to a second `[export]`.

| Option | When it appears | What it does |
|---|---|---|
| Format | Always, in the bar | The formats valid for this file and mode |
| font size | PDF | 9, 10, 11, 12, 14, 16 or 18 pt; 12 by default. A larger size repaginates the document |
| theme | Always | `dark` or `light` |
| content | Bases | `visual` renders the view as its kind; `data` exports its flat table |
| span, starts | A calendar base in visual mode | `month`, `week`, `3-day` or `day`, anchored on the start day (blank is today) |
| include `frontmatter` | Plain notes | Keep or strip the leading YAML block. On by default |
| include `markdown syntax` | Plain notes | Print `##` markers before `h2` to `h6` headings. Off by default |
| from | Always | The file to export. Defaults to the file you opened; type another vault path, or browse in the desktop app |
| to | Always | Destination folder. Empty means your Downloads folder; choosing a folder works in the desktop app and is remembered |

The preview shows the page as it prints. An HTML or PNG preview draws one sheet in the chosen theme's colours. A PDF preview is the same viewer a PDF tab uses: the bar carries `p. N / M` (click it to jump) and `− 100% + fit`, and pinch or Ctrl/Cmd+scroll zooms at the pointer. Changing an option keeps the last preview on screen, with `rendering…` in the bar, until the new one is ready, and a new PDF opens on the page you were reading.

Your choices stay put when you switch to another tab and back. Format, font size, theme and the two plain-note toggles carry over to every export you open next; the `from` path, content mode and start day belong to that export tab.

The tab is not available for `.settings`, which is configuration rather than a document.

## Which formats each file supports

| File | Formats |
|---|---|
| Note (`.md`) | `pdf`, `html`, `png`, `md` |
| Base (`.md` with `type: base`), `data` content | `pdf`, `html`, `png`, `md`, `csv` |
| Base, `visual` content | `pdf`, `html`, `png` |
| Sheet (`.sheet`) | `pdf`, `html`, `png` |
| Drawing (`.draw`) | `pdf`, `png` |

A base is detected by its frontmatter, not its extension. The export pane starts on `pdf` until you pick a format, and returns to `pdf` whenever a change makes the current format unavailable.

A sheet exports its first sheet only, as a plain table of raw cell values. Formatting, formulas and later sheets are not included.

## Export a base as it looks or as data

`data` exports the view's flat table: a Markdown table, CSV (RFC 4180 quoting, CRLF line ends) or an HTML table. `visual` renders the view as its own kind, using the live theme's palette. A visual view that resolves no rows reads `no rows` in place of the view. A `md` or `csv` preview shows the file's lines exactly as written, one per line, and scrolls sideways when a line is wider than the sheet.

| View kind | Visual export |
|---|---|
| `calendar` | A month grid, or a time grid for `week`, `3day` and `day` |
| `cards` | Cards |
| `kanban` | A board |
| `list`, `bullets` | A list |
| `table`, `map`, `bar`, `line`, `stat`, `heatmap`, `flashcards` | The flat data table |

The pane starts in `visual` for calendar, cards, kanban, list and bullets bases, and in `data` for the rest. Once you choose a content mode, opening another file resets it to that file's default.

A calendar span of `month` shows the month containing the start day with leading and trailing days from adjacent months. `week` shows seven days from the start of the week, `3day` the start day and the two after it, and `day` just that day. Events come from the same mapping the live calendar uses, with recurrence expanded. In the app, `calendar.weekStartsOnMonday` and `calendar.militaryTime` apply; the command uses a Monday start and 12-hour times.

## Strip frontmatter and show markdown syntax

With **Include frontmatter** off, the leading `---` block is removed from `md`, `html`, `pdf` and `png` output. Leave it on and the HTML-family formats print the frontmatter as a styled block at the top. A base ignores the option, because a base's frontmatter is its configuration.

**Show markdown syntax** prints the literal `##` to `######` in front of `h2` to `h6` headings in `html`, `pdf` and `png`, in a muted colour. `h1` never gets one, and `md` already contains its markers.

## Break a note into pages

A line containing only `<!-- pagebreak -->` marks a page boundary. Insert one from the editor's slash menu. It is invisible on screen, and each format treats it differently.

| Format | Result |
|---|---|
| `pdf` | One PDF with a forced page break at each marker |
| `html` | A print-only break: invisible on screen, honoured when the file is printed |
| `png` | One file per section: `note-1.png`, `note-2.png`, and so on |
| `md` | The comment passes through as text |

A marker inside a code fence or inline code stays literal. A section left blank by a marker at the very start or end, or two markers in a row, is dropped. For a page-broken PNG export the pane's bar reads `N pages // N files` and its last line names the first and last file (`writes note-1.png … note-3.png`), and its HTML preview draws one labelled `page N of M` sheet per section. The PDF preview is the real PDF.

## Export a note's tables

A note's markdown tables, a table inside a callout among them, export from the app as the same typed table the app shows: a `+ - | =` grid (a doubled `=` under the header), columns sized to their content, and a `:--` or `--:` column aligned left or right. A centered column (`:-:`) prints left-aligned, as it shows in the editor. The grid prints in `html`, `pdf` and `png`, in the grid ink of the chosen theme. An exported table does not squeeze to the page width: a table too wide in whole words runs past the right margin.

The `bismuth export` command prints the same tables with plain 1px borders, because the typed grid is drawn by the app's own table component.

## Export a note with its ink

A note's ` ```draw ` fences export as pictures in `html`, `pdf` and `png`. An attached fence is laid over the block it annotates, and a standalone fence (` ```draw block `) sits in the flow with its own height. Without this step the ink would export as a block of base64 text. Attached ink scales with the page's column width sideways but not vertically, so a pen nib can look slightly oval in a column narrower than the editor's; its position on the words is exact. See [note ink](../editor/ink.md#export-a-note-with-its-ink).

## Where the exported file goes

With an output folder chosen in the desktop app, the file is written there and the toast shows its full path. With no folder, the desktop app writes to your Downloads folder, and if that write fails it opens a Save dialog instead. A browser downloads the file through its normal download flow.

The app confirms every desktop write by checking that the file exists, and it only reports success for a file that is there. If a write fails, the toast names the path it tried.

## Export from the command line

```bash
bismuth export <file> [--format md|html|png|pdf|csv] [--out FILE]
  [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day]
  [--no-frontmatter] [--markdown-syntax] [--theme dark|light] [--vault <dir>]
```

| Flag | Default | Effect |
|---|---|---|
| `--format` | `md`; `png` for a `.draw` | Output format |
| `--out` | `<name>.<format>` in the current directory; `<file>.png` or `<file>.pdf` for a `.draw` | Output path |
| `--mode` | `data` | `data` or `visual`, for a base. The command does not pick `visual` for you |
| `--cal-start`, `--cal-span` | Today, `month` | Calendar anchor and span, for a visual calendar. The week starts on Monday and times are 12-hour |
| `--no-frontmatter` | Frontmatter included | Strip the leading YAML block |
| `--markdown-syntax` | Off | Print heading markers |
| `--theme` | `dark` | Anything but `dark` or `light` fails |

A `.draw` file needs no vault and exports to `png` or `pdf` only; any other format fails with `a .draw file exports to png or pdf`. A `.draw` file with a line that is not valid JSON fails with the parse error. An empty `.draw` file exports as a blank page from the app, and fails with `not a drawing document` from the command. A note, base or sheet needs a vault, from `--vault` or `BISMUTH_VAULT`. The command has no flag for PDF font size: a PDF always uses 12 pt. A page-broken PNG note writes one file per page and ignores `--out`.

PNG and PDF of a note, base or sheet run a real headless Chrome that Bismuth launches for each call. That Chrome must be at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; there is no environment variable or `PATH` lookup. Without it the export fails at launch with `chrome debugger port never opened`. The other formats, and PNG and PDF of a `.draw`, need no Chrome.

An exported note's typography follows the vault's `.settings`: prose leading from `editor.lineHeight` and `appearance.editorFontSize`, and the faces from `appearance.uiFont` and `appearance.proseFont`. Colours come from a fixed default palette, because there is no running theme to read. Every flag is also listed in the [CLI reference](../cli/reference.md).

## How it works

The pane (`ExportView.tsx`) and the command (`cli/src/commands/export.ts`) call the same two functions in `app/src/export/exporters.ts`, with different injected `ExportDeps`. That keeps the module unit-testable and compilable into the Bun binary.

- `renderPreview(path, format, deps, theme, opts)` computes only what the pane shows. It never produces export bytes, so flipping options is instant.
- `renderExport(path, format, deps, theme, opts)` returns `{ bytes, mime, filename }`, plus `files` when a note splits into several PNGs.

`ExportDeps` carries `read`, `resolveRows`, `htmlToPdf`, `htmlToPng`, `drawingToPng`, `katexCss`, `docFontCss` and `typeTables`. The pane resolves the format list with `formatsFor()` and `formatsForOptions()` in `formats.ts`, and defaults the format with `defaultFormat()` in `formats.ts` and the mode with `defaultModeForView()` in `options.ts`. The pane's `writes …` line and `renderExport` both name output files through `exportFilenames()` in `formats.ts`, so the line never promises a name the export does not write.

### Add a format or a file kind

A new file kind needs a row in the extension matrix in `formats.ts` (`formatsFor()` returns it, and `isExportable()` gates the command). Then add a branch to `bodyHtml` in `exporters.ts` that returns the kind's HTML body, and a case in `renderExport` for any format that bypasses HTML. A new format adds an `ExportFormat` value and a `renderExport` case. `md` and `csv` skip HTML (`markdownText`, `csvText`; CSV throws for anything but a base). The pane persists its options in `localStorage`: the output folder and calendar span under `bismuth.export.destFolder` and `bismuth.export.calSpan`, the shared formatting options under `bismuth.export.prefs`, and each tab's `from` path, hand-picked mode and start day under `bismuth.export.tab:<path>`. `export/exportPrefs.ts` validates what it reads back, so a bad stored value falls back to its default.

### Building the document

`bodyHtml` picks the body by file kind. A sheet goes through `snapshotToHtmlTable` (`sheetHtml.ts`). A base goes through `baseViewHtml` for `visual` or `tableToHtml(baseToTable(...))` for `data`; `viewHtml.ts` and `calendarHtml.ts` are pure string builders that return `{ body, css }`. Any other `md` goes through `renderMarkdown` after `inkifyMarkdown` (`inkHtml.ts`) rewrites its draw fences into pictures, then through `deps.typeTables` when the caller supplies it.

`renderedBody` re-renders after `whenMathReady()` when the first pass leaves an unrendered KaTeX placeholder. `wrapBody` produces a standalone document: it inlines the document fonts unconditionally, KaTeX CSS (fonts as `data:` URIs) only when the body contains rendered math, and any view-specific CSS. The `.html` download and the rasteriser iframe cannot reach the app's stylesheets, so everything is inlined.

Stripping frontmatter uses `stripFrontmatter` (`bases/cardBodySplit.ts`). It slices between a leading `---` fence and the next one without parsing YAML, and never touches a `---` that is not on the first line. Left in place, `marked` would read the closing fence as a setext heading underline.

### Typed tables

The pane's `typeTables` dep is `typeExportTables` (`app/src/ui/table/exportTables.ts`). It types every table in the body with `typeTable`, the call a note's table widget and a chat message make, in a detached element, then serializes the body. The CSS it returns is the app's own `.bismuth-table` rules and `AsciiCellEdges` rules, read back from `document.styleSheets`, plus the custom properties they name, resolved to literals on `:root`. A `light` export passes `palette.border` as the grid ink; a `dark` one keeps the app's `--border-soft`.

The app paints a cell's glyphs as a `-webkit-mask-box-image` over its ink. WebKit's PDF output paints that mask as a solid block with the glyphs cut out, which hides the cell's text, so the document overrides it: each overlay paints its glyph sprite, pre-tinted in the ink on a canvas, as a nine-slice `border-image` with the same slices, widths and `round` repeat. `html2canvas` paints no `border-image` either, so `htmlToCanvas` calls `bakeTableEdges` before the snapshot: it draws each overlay's nine-slice into an image of the overlay's box, sets it as the overlay's background, and moves the overlay out of its `display: contents` mount, whose children `html2canvas` skips. `htmlTemplate.ts` keeps its bordered table rules for every table without `bismuth-table`: a sheet, a base's data table, a CLI export.

### Page breaks and PNG sections

`renderMarkdown` turns a pagebreak marker into a zero-height `<div class="bismuth-page-break">`, masked like wikilinks so a marker in code stays literal. `htmlTemplate.ts` gives it `break-after: page`. For PNG, `pageSections(text, includeFrontmatter)` in `pageBreaks.ts` splits the text before rendering: it slices frontmatter off first (so a marker right after it never makes page 1 just the frontmatter), splits on marker lines, and drops blank sections. With the frontmatter toggle on, the block is re-prepended to the first surviving section. The section count does not depend on the toggle. Each section is wrapped in its own document and rasterised separately, and `ExportResult.files` is set only when there are two or more real pages. The pane's preview uses the same `pageSections` model, so preview and export agree.

### PDF engines

Three paths produce PDF and PNG bytes, all starting from the same standalone HTML.

| Surface | Engine |
|---|---|
| Desktop app, PDF | Native WebKit print through the `print_pdf` Tauri command |
| Browser dev mode and iPad PDF, and every PNG in the app | `html2canvas`, then `jsPDF` for PDF (`htmlToPdf.ts`) |
| CLI | Headless Chrome over CDP (`core/src/render/htmlRaster.ts`) |

`pdfPrint.ts` chooses the engine: `pickPdfEngine({ tauri })` returns `webkit` inside a Tauri webview and `canvas` elsewhere. A failing WebKit print falls back to the canvas engine and warns once, except for the expected answer `unsupported` on non-macOS targets.

`app/src-tauri/src/print_pdf.rs` loads the HTML into a never-shown `WKWebView`, runs a print operation with panels off into a temporary file, then redraws each page onto a Letter sheet filled with the document's background (this paints the 1 in margins) and sets the PDF title. It runs on a `spawn_blocking` thread under a process-wide `PRINT_LOCK`, because the pane fires several prints at once; a still-pending session moves to an `ORPHANS` list rather than being dropped while AppKit holds a pointer to it.

The CLI's `htmlToPdfHeadless` and `htmlToPngHeadless` set the document with `Page.setDocumentContent` (a `data:` URL would exceed Chrome's URL limit with the embedded fonts), then use `Page.printToPDF` or `Page.captureScreenshot` at `deviceScaleFactor` 2. Chrome's own pagination honours the `@page { size: 8.5in 11in; margin: 1in }` rule and the `.bismuth-page-break` rule in the document. `launchChrome` is in `core/src/render/chromeSession.ts`, which hardcodes the macOS binary path.

`printCss.ts` holds the CSS shared by both PDF engines so page geometry does not depend on the engine: `PDF_BODY_OVERRIDE` drops the reading-column padding so the only margin is the page's own, and `WEBKIT_PRINT_HEAD` adds the print-ready title marker the native printer polls for, plus `break-inside: avoid` on `tr`, `table`, `img`, `svg` and `.katex-display`. WebKit ignores `break-after: avoid` on headings, so its injected script (`keepHeadingsWithNext`) wraps each heading in a `div.bismuth-keep` with an empty spacer as tall as the first 48px of the block after it, which a matching negative margin overlaps; `break-inside: avoid` on that wrapper moves a heading to the next page rather than leaving it alone at a page foot. The block after the heading stays outside the wrapper, so a long list or paragraph still breaks across pages instead of pulling its whole section onto a new page. The script's `trimTrailingMargin` zeroes the bottom margin of the document's last element chain, which would otherwise overflow a full last page onto an extra blank one.

### Pagination on the canvas fallback

WebKit and Chrome never cut a text line or a table row, because a line box is not a legal cut point in a real print engine. The `html2canvas` and `jsPDF` fallback slices a raster with arithmetic, so it chooses cut points by measurement:

1. `measureCutStops()` in `htmlToPdf.ts` collects every atom on the laid-out iframe: one rect per line box (from `Range.getClientRects()` over text nodes) and every indivisible element (`tr`, `img`, `svg`, `canvas`, `hr`, `video`). An atom's bottom edge is a legal cut unless another atom encloses it; siblings that merely overlap by a pixel or two do not disqualify it.
2. `pageSlices()` in `pageGeometry.ts` pulls each natural page bottom back to the last legal stop that fits. If no stop fits, the raw bottom stands, so the pager always advances.
3. A pixel gate checks the raster itself, because `html2canvas` can paint a block tens of pixels away from its DOM position. `classifyRows()` marks each canvas row `uniform` (within `INK_THRESHOLD` = 60 of the row's first sample) or `full` (at least `FULL_FRACTION` = 0.9 of samples differ). `cutSafe()` allows a cut only outside the padded bands (`DRIFT_PAD_CSS` = 60) around formula atoms, and only between two blank rows, right after a full-width rule, or inside a uniform fill. The search never goes back past `MIN_PAGE_FRACTION` = 0.5 of a page.

`pageGeometry.ts` also holds the Letter constants (`PAGE_W_PT` 612, `MARGIN_PT` 72, `CONTENT_W_PT` 468, `CONTENT_H_PT` 648; `PAGE_W_PX` 816 for PNG, `CONTENT_W_PX` 624 for PDF) and `pdfSliceMetrics`. At an `editor.lineHeight` low enough that the type's ink is taller than its line box (a leading ratio near 1.2 and below), consecutive lines overlap and no horizontal cut is clean. The pager cuts on the line-box boundary and clips a descender by about 2 px.

### Note typography

A note export takes its look from the running app. `resolvePalette.ts` probes the live CSS custom properties into a `ThemePalette`, with these sources:

| Palette field | Source |
|---|---|
| `proseFont` | `--prose-font` |
| `proseLeading` | The app's `calc(var(--row-h) * var(--prose-line-height))` read back as a ratio of the font size |
| `codeScale` | `--code-scale` (measured per prose face) times `--mono-scale`, read back as a ratio |
| `font`, `monoFont` | `--ui-font-stack` (`appearance.uiFont`) |
| Colours | `--bg`, `--fg`, `--accent` and the category tokens |

Leading travels as a ratio, not as `editor.lineHeight`, because that setting multiplies the app's 18 px row unit rather than the type. The palette has no prose scale: the chosen point size is used literally. Code is the one thing scaled against the prose size, in `pre`, block `code`, frontmatter and `#tag` runs, with inline code in `em`. Only note prose switches to the prose face; a base's visual export, a sheet and a raw dump keep the UI face.

Headless exports have no DOM to probe. `buildPaletteOverride(vault, theme)` reads the vault's `.settings` and overrides `proseLeading` (`ROW_H_PX` 18 times `editor.lineHeight`, divided by `appearance.editorFontSize` times the prose face's scale), `codeScale` (`CODE_SCALE` times `appearance.monoScale`), `monoFont`, `font` and `proseFont`. Colours stay at `DEFAULT_PALETTE`.

### Font embedding

An exported document is standalone, so the faces must travel inside it. Otherwise a missing family name falls silently through the font stack to Georgia. `fontFaceCss.ts` holds the shared `DocFace` type and `faceCss()`, and `proseFacesFor()` keeps every mono face but only the prose serif the document names. The browser embedder `docFontCss.ts` pulls the faces in as base64 through Vite's `?inline`. The CLI twin `cli/src/docFontCss.ts` imports the same font files with Bun's `with { type: 'file' }` so they are inlined into the compiled binary at build time, and reads them with `Bun.file().arrayBuffer()`, which makes its `docFontInlineCss()` async. That difference is why `exporters.ts` takes `docFontCss` as an injected dependency. The CLI inlines KaTeX the same way (`cli/src/katexCss.ts`).

### Colour safety for the rasteriser

`html2canvas` throws on CSS Color 4 values (`color()`, `color-mix()`, `oklab()`, `lab()` and relatives), and Chrome serialises a computed alpha `color-mix` as `color(srgb ...)`. Two layers in `cssColor.ts` keep them out of the document. `normalizeCssColor()` runs every probed palette value: safe values pass through, `color(srgb ...)` converts through `colorSrgbToRgb`, anything else the browser can evaluate resolves through a 1 by 1 canvas pixel read, and a hopeless value falls back to the `DEFAULT_PALETTE` entry. Then `sanitizeDocColorsForRaster(doc)` walks the laid-out iframe and inlines `rgb()` over any colour property still carrying a modern function, dropping an unsafe `box-shadow`.

### Drawings

A drawing rasterises through `deps.drawingToPng`. The app uses `drawingRaster.ts` (a DOM canvas) for the preview and the downloaded PNG, so what you see is what is written. The CLI short-circuits a `.draw` before `renderExport` and uses the core renderer (`renderDocToPng`, `renderDocToPdf`). Both share `render2d.ts`. In the app, a drawing's PDF wraps the stacked PNG in an `<img>` document and cuts it onto Letter pages through `htmlToPdf`; the CLI emits one PDF page per drawing page. Details are on the [drawing page](../drawing/overview.md#export-a-drawing).

### Note ink

`inkifyMarkdown()` in `inkHtml.ts` scans a note for draw fences and rasterises each one to a transparent PNG through `deps.drawingToPng` with a `box` argument, whose width is `INK_LOGICAL_W` (680). It then rewrites the markdown before rendering. An attached fence wraps the annotated block in a `position: relative` container with the picture absolutely positioned at `width: 100%; height: <its own px>`, which maps x onto the column and keeps y unscaled. A standalone fence is a block image at `width: 100%; height: auto`. A fence with nothing above it to decorate becomes a zero-height overlay. A note with no ink is unchanged.

Source: `app/src/ExportView.tsx`, `app/src/export/exporters.ts`, `app/src/ui/table/exportTables.ts`, `app/src/export/types.ts`, `app/src/export/formats.ts`, `app/src/export/options.ts`, `app/src/export/pageBreaks.ts`, `app/src/export/pageGeometry.ts`, `app/src/export/cssColor.ts`, `app/src/export/resolvePalette.ts`, `app/src/export/exportTheme.ts`, `app/src/export/baseView.ts`, `app/src/export/baseTable.ts`, `app/src/export/rowsHtml.ts`, `app/src/export/mdTable.ts`, `app/src/export/sheetHtml.ts`, `app/src/export/viewHtml.ts`, `app/src/export/calendarHtml.ts`, `app/src/export/csvTable.ts`, `app/src/export/htmlToPdf.ts`, `app/src/export/pdfPrint.ts`, `app/src/export/printCss.ts`, `app/src/export/htmlTemplate.ts`, `app/src/export/inkHtml.ts`, `app/src/export/drawingRaster.ts`, `app/src/export/download.ts`, `app/src/export/docFontCss.ts`, `app/src/export/fontFaceCss.ts`, `app/src-tauri/src/print_pdf.rs`, `app/src/bases/cardBodySplit.ts`, `app/src/tabIds.ts`, `cli/src/commands/export.ts`, `cli/src/docFontCss.ts`, `cli/src/katexCss.ts`, `core/src/render/htmlRaster.ts`, `core/src/render/chromeSession.ts`
