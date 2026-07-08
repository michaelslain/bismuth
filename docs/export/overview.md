# Export

Bismuth can turn any vault document — a prose note, a base, a spreadsheet, or a drawing — into a downloadable file: Markdown, HTML, PNG, PDF, or (bases only) CSV. The system has two faces that share one renderer: a **dedicated export pane** inside the app (`ExportView.tsx`, opened via the `::export:<path>` sentinel) and the **`bismuth export` CLI command**, which calls the *exact same* `renderExport()` function with headless dependencies injected. Bases get a "visual vs data" choice — render the chosen view as its kind (a calendar grid, cards, kanban, list) or flatten it to a table — and calendars additionally pick a grid span and anchor day. Most paths are fully headless; the only browser-only step is rasterizing a note/base's HTML to PNG/PDF (which needs `html2canvas`), while drawings rasterize through the headless core renderer.

## The export pane (`ExportView.tsx`)

Export is a first-class pane content, not a modal. Its content id is the `EXPORT_PREFIX` sentinel from `app/src/tabIds.ts`:

```ts
// Export options screen for a file: EXPORT_PREFIX + "<file path>".
export const EXPORT_PREFIX = "::export:";
```

`PaneContent.tsx` routes any leaf whose path `startsWith(EXPORT_PREFIX)` to a **lazily-imported** `ExportView` (`ExportView` pulls in `jspdf`/`html2canvas` transitively, so it is deferred off the entry bundle), stripping the prefix to recover the vault-relative file path: `<ExportView path={props.path.slice(EXPORT_PREFIX.length)} />`. The tab reads as `Export: <name>` with a `Download` icon (`contentLabel`/`contentIcon` in `tabIds.ts`).

The pane is a two-column layout: a live **preview** on the left (an `<iframe srcdoc>` for HTML/MD/CSV, an `<img>` for image previews) and a **control panel** on the right. The panel exposes:

- **Input path** — which vault-relative file to export. Defaults to the file the tab was opened for, re-pointable by typing a path or (in the desktop app) the `BROWSE` button (`pickFile`, filtered to `md`/`sheet`/`draw`). The committed `srcPath` (which drives the preview resource) is kept separate from the live `srcDraft` text so typing doesn't refetch on every keystroke and drop input focus mid-word; the draft commits on blur/Enter.
- **Output path** — the destination folder. Empty = the browser/OS Downloads dir. A chosen folder (desktop only, via `pickFolder`) is remembered in `localStorage` under `bismuth.export.destFolder`.
- **View** (bases with >1 view) — a chip per base view, picking `viewIndex`.
- **Content** (bases only) — the `Visual` / `Data` `RenderMode` toggle.
- **Calendar span** + **Start day** (visual calendar only) — `month`/`week`/`3day`/`day` and the anchor date (blank = today). The span is remembered in `localStorage` under `bismuth.export.calSpan`.
- **Frontmatter** (plain `.md` only, not a base) — an "Include frontmatter" toggle, default ON. See "Include/exclude frontmatter" below.
- **Format** — the valid format chips for the current file/mode (see Formats below). A page-broken PNG export shows a small heads-up ("N pages → exports as N separate PNG files"); see "Page breaks" below.
- **Theme** — `dark` or `light`.

`browseSource`/`browseDest` short-circuit with a toast when not running under Tauri (`isTauri()`), since native pickers and arbitrary-folder writes are desktop-only.

### Source detection: is it a base?

On every source change, a `createResource` keyed on `srcPath` reads the file and checks `parseFrontmatter(text).data?.type === "base"`. If so it parses the file (`parseBaseFile`) and exposes its `config.views`; otherwise it resolves to `null` and **none** of the base controls render. A base is therefore detected by frontmatter, not by extension — there is no `.base` extension; a base is just a `.md` (mirrored by `isBaseText()` in `exporters.ts`).

When the source changes, `viewIndex` resets to 0 and `userSetMode` clears, so the mode default re-derives from the new file's first view kind.

## Targets × formats

`formats.ts` holds the extension-keyed matrix (`ext(path)` lowercases the trailing extension):

```ts
const MATRIX: Record<string, ExportFormat[]> = {
  md:    ["html", "pdf", "png", "md"],
  sheet: ["html", "pdf", "png"],
  draw:  ["pdf", "png"],
};
```

`formatsFor(path)` returns `[]` for sentinels (`::…`) and for `SETTINGS_FILE` (`.settings`, config not a document); `isExportable(path)` is the boolean App.tsx uses to gate the export command at render time.

`ExportFormat` is `"html" | "pdf" | "md" | "png" | "csv"`. CSV is **not** in the static matrix — it's base-only and bolted on by the contents-aware refinement below.

### The four targets

- **Note** (`.md`, not a base) — prose rendered to HTML via `renderMarkdown`. Exports to `md` (its own text), `html`, `png`, `pdf`.
- **Base** (`.md` with `type: base`) — falls under `md` in the matrix, but the *available* formats narrow by render mode (below). Exports to `html`/`pdf`/`png`/`md`/`csv` in data mode; `html`/`pdf`/`png` in visual mode.
- **Sheet** (`.sheet`) — the Univer workbook JSON is rendered to an HTML table by `snapshotToHtmlTable`. Exports to `html`/`pdf`/`png` (no `md`/`csv`).
- **Drawing** (`.draw`) — rasterized directly. Exports to `pdf`/`png` only.

### Mode-aware format refinement (bases)

`formatsForOptions(path, isBase, mode)` is what the UI's format chips actually use, because `formatsFor` is extension-keyed and can't see file contents:

```ts
if (!isBase) return formatsFor(path);
return mode === "data"
  ? ["html", "pdf", "png", "md", "csv"]   // flat-table forms; md + csv only make sense as data
  : ["html", "pdf", "png"];               // a calendar grid / kanban board has no md/csv form
```

The export pane keeps the chosen format valid: a `createEffect` re-snaps `format()` to the first valid entry whenever the available set changes (a mode flip or a new file).

## Visual vs data render mode (bases)

`RenderMode` is `"visual" | "data"`:

- **`data`** — the chosen view's flat table, in the requested format: a Markdown table (`tableToMarkdown`), CSV (`tableToCsv`, RFC-4180 quoting + CRLF), or an HTML table (`tableToHtml(baseToTable(...))`). This is the historical behavior.
- **`visual`** — the view rendered **as its kind**: a calendar grid, cards, kanban board, or list. Implemented by `baseView.ts`'s `baseViewHtml`, which resolves the base's `ViewResult` and dispatches on `vr.view.type`:
  - `calendar` → `calendarHtml`
  - `cards` → `cardsHtml`
  - `kanban` → `kanbanHtml`
  - `list` / `bullets` → `listHtml`
  - everything else (`table`/`map`/`bar`/`line`/`stat`/`heatmap`/`flashcards`) → **degrades to the flat data table**, so a visual export never throws on an unsupported kind.

The visual renderers (`viewHtml.ts`, `calendarHtml.ts`) are pure string builders — no Solid, no DOM — so they share the exporter's bun-compilable path. Each returns `{ body, css }`; the exporter injects the scoped CSS into the document `<head>`. They reuse the live views' value formatting (`cellText` + `renderCellHtml`) and the **resolved live-theme palette** (`ThemePalette`) for colors/fonts so the export reads like what's on screen.

`defaultModeForView(kind)` (in `options.ts`) decides the initial mode the pane shows: `calendar`, `cards`, `kanban`, `list`, `bullets` default to `visual`; everything else to `data`. The user can override per session; once overridden (`userSetMode`), the default stops re-applying.

### Calendar span + anchor

When the selected view is a calendar in visual mode, the pane shows two extra controls. They flow into `ExportOptions.calSpan` and `ExportOptions.calStart`, resolved by `calendarHtml`:

```ts
const anchor = opts.calStart ? parseLocal(opts.calStart) : new Date();  // "" = today
const span: CalSpan = opts.calSpan;                                     // month | week | 3day | day
```

- **`month`** → a full month grid (`monthGrid`) anchored on the month containing `anchor`, with leading/trailing days from adjacent months (`out` cells) and a `today` marker.
- **`week`** → 7 columns from `startOfWeek(anchor, ...)`.
- **`3day`** → `anchor`, `anchor+1`, `anchor+2`.
- **`day`** → just `anchor`.

Week/3day/day all render a column-per-day time grid (`timeGrid`): a left hour gutter, an all-day band on top, and timed events absolutely positioned at `44px/hour` (`HOUR_PX`), with simple lane assignment so overlapping events don't stack. Events come from `rowToEvent` (the exact mapping the live calendar uses) and are expanded recurrence-aware via `expandRecurrence`/`occurrencesIn`, so an exported calendar agrees with the on-screen one. `weekStartsOnMonday` and `militaryTime` (from `settings.calendar`) drive the week start and 12h/24h times.

## Include/exclude frontmatter

`ExportOptions.includeFrontmatter` (default `true`, preserving the historical behavior) controls whether a plain (non-base) note's leading YAML frontmatter block shows up in the exported output. It's ignored for a base (a base's frontmatter is its config — filters/formulas/views — never rendered as content in the first place, regardless of the toggle) and for sheets/drawings (no frontmatter concept).

- **`md`** — `true` passes the raw file through unchanged (frontmatter and all); `false` strips the leading `---\n…\n---` block before writing.
- **`html` / `pdf` / `png`** — the same strip applies to the markdown BEFORE `renderMarkdown`. With the block left in (the default), `marked` parses it as plain prose — the opening `---` becomes a thematic break (`<hr>`), and because YAML frontmatter always has a *second* `---` immediately after a paragraph of key/value lines, that second fence is parsed as a **Setext heading underline**, turning the frontmatter into a heading. Turning the toggle off avoids this entirely.

The strip itself reuses the existing pure `stripFrontmatter` (`app/src/bases/cardBodySplit.ts`) — the same helper transclusion (`editor/embedBlock.ts`) and the "Detect AI text" scanner (`ai/aiDetect.ts`) already use to keep frontmatter out of a note's rendered/scanned body. It's tolerant of malformed YAML (it never parses the YAML, just slices off everything between a leading `---` fence and the next `---` fence) and never touches a `---` that isn't the very first line of the file (so a horizontal rule further down the document is left alone).

CLI: pass `--no-frontmatter` to `bismuth export` to turn the toggle off (maps to `ExportOptions.includeFrontmatter: false`); omit it to keep the default (frontmatter included).

## Page breaks

A lone `<!-- pagebreak -->` comment line (invisible on screen and in Obsidian — inserted via the editor's slash menu, `id: "pagebreak"`) marks a page boundary. `bases/markdown.ts`'s `renderMarkdown` turns it into a zero-height `<div class="bismuth-page-break">` (masked/restored like wikilinks so a marker inside a code fence/span stays literal) that survives `sanitizeHtml`; `htmlTemplate.ts` gives it `break-after: page; page-break-after: always; height: 0`. Each format honors this marker differently, since only some formats can hold more than one page:

- **PDF** — a single PDF with a forced page break at each marker. `export/htmlToPdf.ts`'s `htmlToCanvas` measures every `.bismuth-page-break` div's post-layout Y offset (ignoring one that lands outside the real content band — i.e. right at the very start/end of the document, which would otherwise slice off an empty page) and passes those offsets to `htmlToPdf`, which cuts a new Letter page at each one instead of only at the natural page-height boundary.
- **HTML** — the marker becomes the CSS rule above: a no-op on screen (a live, continuously-scrolling document), but a forced page break if the exported `.html` file is printed (e.g. browser Print → Save as PDF) — print fidelity without changing the on-screen document.
- **PNG** — a single raster image can't hold more than one page, so a note with page breaks exports as **one PNG file per section** instead of one file for the whole note: `note-1.png`, `note-2.png`, … (`ExportResult.files`). A note with no markers is unaffected (still a single `note.png`). The split happens at the TEXT level, before rendering — `export/pageBreaks.ts`'s pure `pageSections(text)`:
  1. slices frontmatter off FIRST (`stripFrontmatter`, same helper the frontmatter toggle uses) so a marker placed right after the frontmatter block never makes "page 1" just the frontmatter — with `includeFrontmatter: true` the block is re-prepended onto the first surviving section (it renders as prose at the top of page 1, exactly like the single-page/PDF paths, but never counts as a page; the section COUNT is toggle-invariant, so page numbering never shifts);
  2. splits on `<!-- pagebreak -->` marker lines (`splitByPageBreaks`, code-fence/inline-code-safe via the same `maskCode`/`unmaskCode` `bases/markdown.ts` uses internally);
  3. drops any section left blank after trimming (a marker at the very start/end, or two adjacent markers, would otherwise produce an empty page).

  Each remaining section is independently rendered (`renderMarkdown`) and wrapped into its own self-contained HTML document, then rasterized via `deps.htmlToPng` — so `ExportResult.files` is only populated when there are 2+ real pages; the single-result fields (`bytes`/`filename`/`previewImg`) mirror page 1 for a caller that only looks at those. `ExportView.tsx`'s `doExport` writes/downloads every file in `files` (looping `writeToFolder`/`downloadFile`) and toasts an "Exported N pages…" summary instead of the single-file message; the panel shows a "N pages → N files" hint next to the Format chips once a page-broken note is selected with PNG chosen.
- **`md`** — unaffected: the marker passes through as a literal `<!-- pagebreak -->` HTML comment in the raw text (same as any other export — `md` never renders through `renderMarkdown`).
- **CSV / bases** — not applicable; page breaks are a plain-note concept (a base's cells render inline, not as blocks).

### The preview visualizes the pages

The export pane's preview of a page-broken note (html/pdf/png formats) renders **one visually distinct "sheet" per section** — a dashed-border block labeled `Page N of M` with a gap before the next — instead of one continuous body, so the pane shows exactly where the export will split. `renderPreview` builds it from the **same `pageSections(text, includeFrontmatter)` model the PNG export writes files from** (`pageBreakSections` in `exporters.ts` is the shared gate), so preview and export can never disagree about page count or content; each section renders through the same `renderMarkdown` + math-guard as the export. The sheet chrome (`.bismuth-preview-page` / `.bismuth-preview-pagelabel`, palette-tinted) is **preview-only** — the exported HTML file remains one continuous document with invisible print-break markers, the PDF gets real page boundaries, and each PNG file contains just its own section. A note without page breaks previews exactly as before (no wrappers).

## The renderer: `exporters.ts`

Both faces call into two functions, parameterized by an injected `ExportDeps` so the module stays unit-testable and bun-compilable:

- **`renderPreview(path, format, deps, theme, opts)`** — computes *only what the pane displays*. It never produces export bytes and never runs the heavy `html → pdf` pipeline, so flipping formats/options in the UI is instant and side-effect-free. The PDF/PNG **preview** is just the source HTML (shown in the iframe) — except a page-broken note, which previews as labeled per-page sheets (see "The preview visualizes the pages"); MD/CSV previews are the literal text in a `<pre>`; a drawing preview is its rasterized data-URL `previewImg`.
- **`renderExport(path, format, deps, theme, opts)`** — produces the real downloadable `{ bytes, mime, filename }` (`ExportResult`).

Inside, a file's HTML body is built by `bodyHtml` → `renderedBody` → `wrapBody`:

- `bodyHtml` picks the body by file kind: a sheet → `snapshotToHtmlTable`; a base → visual (`baseViewHtml`) or data table; any other `md` → `renderMarkdown`; otherwise it throws ("No HTML body").
- `renderedBody` guards math: if the first render leaves an unrendered KaTeX placeholder (`/<span class="bismuth-math[^"]*" data-math=/`), it `await whenMathReady()` and re-renders, so exported math isn't blank.
- `wrapBody` wraps the body in a standalone document (`wrapHtmlDocument`), inlining a self-contained KaTeX stylesheet (fonts as `data:` URIs, via `deps.katexCss()`) **only when** the body contains rendered math (`class="katex`), plus any view-specific CSS. The `.html` download and the off-screen rasterizer iframe can't reach the app's loaded stylesheets, so everything must be inlined.

`md`/`csv` exports bypass HTML entirely: `markdownText` returns a base's view-table as a Markdown table or any other note's own text; `csvText` enforces base-ness (throws "CSV export is only available for bases").

### Rasterizer color safety (`export/cssColor.ts`)

html2canvas (1.4.x) throws `Attempting to parse an unsupported color function 'color'` on any CSS Color 4 value — `color()`, `color-mix()`, `oklab()`/`oklch()`, `lab()`/`lch()`. The app's theming leans on `color-mix(in srgb, X n%, transparent)` (`--border`/`--faint`/`--panel`/`--surface-2`…, App.css + settingsCssVars), and Chrome serializes the **computed** value of an alpha-carrying color-mix as `color(srgb r g b / a)` — so `resolvePalette`'s probe alone still fed the rasterizer an unparseable color and every themed pdf/png export died. Two defense layers share `cssColor.ts`:

1. **Palette normalization** — `readThemePalette`'s `lit()` runs every probed value through `normalizeCssColor(value, fallback)`: already-safe values (hex/rgb/hsl/named) pass through; `color(srgb …)` converts via the pure `colorSrgbToRgb` parser; anything else the browser can evaluate resolves through a 1×1-canvas pixel read; a hopeless value falls back to the corresponding `DEFAULT_PALETTE` entry. The export doc's stylesheet therefore only ever carries `rgb()`/`rgba()`/hex.
2. **Iframe sweep** — `htmlToCanvas` (`htmlToPdf.ts`) calls `sanitizeDocColorsForRaster(doc)` on the laid-out off-screen iframe right before snapshotting: it walks every element, and any computed color property (`color`, `background-color`, the four `border-*-color`s, `outline-color`, `text-decoration-color`) still carrying a modern function gets a normalized `rgb()` inlined over it (an unsafe `box-shadow` is dropped). A clean document is a 0-rewrite no-op; this guards KaTeX/view/extra CSS that never routed through the palette. The body background fed to html2canvas + the PDF page fill is normalized the same way.

The pure parts (`isRasterUnsafeColor`, `colorSrgbToRgb`, the document walk with an injectable normalizer) are unit-tested in `cssColor.test.ts`.

## Headless vs browser-only paths

The split is entirely about *who supplies `deps`*. The pure renderers (markdown, table builders, calendar/cards/kanban/list HTML, document wrapping) run anywhere. The rasterization steps are injected:

- **`md` / `html`** — fully headless. Pure string output; the CLI writes them directly.
- **`png` / `pdf` of a note / base / sheet** — **browser-only**. These rasterize the rendered HTML body through `deps.htmlToPng` / `deps.htmlToPdf`, implemented by `htmlToPdf.ts`: the HTML document is written into an isolated off-screen `<iframe>`, snapshotted with **`html2canvas`**, then (for PDF) sliced across US-Letter pages via **`jsPDF`**. This requires a DOM, so the CLI's `htmlToPdf`/`htmlToPng` deps simply throw a clear message ("pdf/png export of notes/bases/sheets is browser-only (html2canvas) — open the file in the app …").
- **`png` / `pdf` of a drawing** — headless-capable. Drawings rasterize through `deps.drawingToPng`. In the app this is `drawingRaster.ts` (a browser Canvas2D `drawingToPng`); in the CLI it's the **core headless renderer** `renderDocToPng`/`renderDocToPdf` (`@napi-rs/canvas` + `pdf-lib`). The PDF path for a drawing wraps the rasterized PNG data-URL in an `<img>` document and runs it through `htmlToPdf` (in the app) — but the CLI special-cases `.draw` *before* reaching the app exporter and renders both formats straight through the core renderer, so drawing PNG **and** PDF both work headlessly there. See the next section for how the two rasterizers relate.

### Drawing rasterization: browser (`drawingRaster.ts`) vs headless (`core/src/drawing/export.ts`)

A `.draw` doc is rasterized by two independent implementations that share the same pure pixel logic (`core/src/drawing/render2d.ts`'s `renderPage`/`renderDocStacked`) but a different canvas backend and page-assembly strategy — this is the split referenced above:

- **Browser** — `app/src/export/drawingRaster.ts`'s `drawingToPng(docText, theme)`: parses the doc (`parseDoc`, falling back to `emptyDoc()` on a parse error), pre-decodes every distinct image `src` referenced by placed images / backgrounds into `HTMLImageElement`s (`decodeImages`; an undecodable src is skipped rather than failing the export), creates a real DOM `<canvas>` sized `PAGE_W*SCALE` × `PAGE_H*pages.length*SCALE` (`SCALE = 2`), and calls `renderDocStacked` to draw every page into **one tall canvas** (pages stacked vertically), returning `{ bytes, dataUrl }` via `canvas.toDataURL("image/png")`. This is wired in as `ExportView.tsx`'s `ExportDeps.drawingToPng` and — unlike `htmlToPdf`/`htmlToPng` — is imported statically, not lazily, since it doesn't pull in `jspdf`/`html2canvas`. It backs **both** the instant preview (`renderPreview`'s `previewImg`) and the real downloadable PNG bytes (`renderExport`'s `png` case) — there's no separate preview-only rasterizer, so what you see in the pane is pixel-for-pixel what gets written to disk.
- **Headless** — `core/src/drawing/export.ts`'s `renderDocToPng`/`renderDocToPdf`: same pre-decode step (`decodeImages`, but via `@napi-rs/canvas`'s `loadImage` instead of `Image()`) into a **non-DOM** `createCanvas`. `renderDocToPng` mirrors the browser path exactly — one call to `renderDocStacked` over a single tall (`PAGE_H * pages.length`) canvas at the same 2x `SCALE` — so app and CLI PNG output agree pixel-for-pixel. `renderDocToPdf` does **not** stack: it rasterizes each page separately at its native `PAGE_W`×`PAGE_H` (`pageToPng` → `renderPage`, one call per page index) and embeds each page's PNG into its own `pdf-lib` `PDFDocument` page sized to the drawing's own dimensions — no Letter-page slicing.

Because `renderDocToPdf` doesn't stack while the app's PDF path does, a multi-page drawing's PDF differs in shape depending on which face produced it: the **app** rasterizes the whole (stacked) drawing to one PNG, wraps it in an `<img>` document, and slices *that* through `htmlToPdf` (html2canvas + jsPDF) onto US-Letter pages, so the app's drawing PDF is Letter-paginated rather than one-drawing-page-per-PDF-page. The **CLI**'s PDF (`renderDocToPdf`, used directly — see below) instead emits exactly one PDF page per drawing page, each sized to the drawing's own `PAGE_W`(816)/`PAGE_H`(1056) — no Letter slicing at all.

## The CLI: `bismuth export`

`cli/src/commands/export.ts` reuses the **same** `renderExport` so CLI output matches the in-app export exactly. Usage:

```
bismuth export <file> [--format md|html|png|pdf|csv] [--out FILE]
  [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day]
  [--no-frontmatter] [--vault <dir>]
```

Flow:

1. The default format is `md`, except a `.draw` defaults to `png`.
2. **Drawings short-circuit**: a `.draw` is parsed (`parseDoc`) and rendered with the headless core renderer (`renderDocToPng`/`renderDocToPdf`, dark theme); `png` and `pdf` both work, any other format errors ("a .draw file exports to png or pdf").
3. **Everything else** calls `renderExport(file, fmt, deps, "dark", optionsFrom(args))` with headless deps:
   - `read` → `readNote(vault, p)`
   - `resolveRows` → `resolveSource(spec, { root: vault, today })`
   - `htmlToPdf` / `htmlToPng` → **throw** the browser-only message
   - `drawingToPng` → core `renderDocToPng`
   - `katexCss` → returns `""` (the app's `?inline`-bundled KaTeX font CSS is Vite-only and unresolvable in a bun-compiled binary; CLI HTML exports still carry the math markup, just without embedded fonts)
4. `optionsFrom(args)` maps `--view`/`--mode`/`--cal-start`/`--cal-span`/`--no-frontmatter` onto `defaultExportOptions()` (no-ops for non-base files; `--no-frontmatter` sets `includeFrontmatter: false`, see "Include/exclude frontmatter" above).
5. Bytes are written to `--out` (or `res.filename`) — **except** a page-broken PNG note (`res.files.length > 1`, see "Page breaks" above), which writes every file to its own computed name instead (`--out` doesn't apply to a multi-file result). Unreachable today since `htmlToPng` throws first for a note/base/sheet in the CLI; kept ready for a future headless PNG rasterizer.

So `bismuth export Tasks.md --format html`, `bismuth export sketch.draw --format pdf`, `bismuth export Calendar.md --mode visual --cal-span week --format html`, and `bismuth export Essay.md --format md --no-frontmatter` all work headlessly; `bismuth export note.md --format pdf` errors with the "open in the app" hint.

## Download flow

`doExport` (`ExportView.tsx`) flushes any un-blurred edit, calls `renderExport`, then dispatches on the chosen output:

- **A chosen folder + desktop app** → `writeToFolder(dest, filename, bytes)` (Tauri fs plugin; returns the absolute path; the folder must be inside the app's fs capability scope), toasting `Exported … → <path>`.
- **Otherwise** → `downloadFile(filename, bytes, mime)`: in Tauri, writes to the OS `downloadDir`; in the browser, a `Blob` + `<a download>` anchor click. If a folder was set but the app isn't Tauri, it falls back to Downloads with an explanatory toast.

The `ExportDeps` the pane wires up include `read`/`resolveRows` (HTTP via `api`), the deferred `htmlToPdf`/`htmlToPng` (dynamic-imported only when actually exporting a PDF/PNG, to keep `jspdf`+`html2canvas` out of the preview path), `drawingToPng` (browser raster), and `katexCss` (the Vite `?inline` module, lazy-loaded only when an export contains math).

Source: `app/src/ExportView.tsx`, `app/src/export/exporters.ts`, `app/src/export/types.ts`, `app/src/export/formats.ts`, `app/src/export/options.ts`, `app/src/export/pageBreaks.ts`, `app/src/export/cssColor.ts`, `app/src/export/resolvePalette.ts`, `app/src/export/baseView.ts`, `app/src/export/viewHtml.ts`, `app/src/export/calendarHtml.ts`, `app/src/export/csvTable.ts`, `app/src/export/htmlToPdf.ts`, `app/src/export/htmlTemplate.ts`, `app/src/export/drawingRaster.ts`, `app/src/export/download.ts`, `app/src/bases/cardBodySplit.ts`, `app/src/bases/markdown.ts`, `app/src/tabIds.ts`, `app/src/PaneContent.tsx`, `cli/src/commands/export.ts`.
