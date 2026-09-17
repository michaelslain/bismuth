# Export

Bismuth can turn any vault document — a prose note, a base, a spreadsheet, or a drawing — into a downloadable file: Markdown, HTML, PNG, PDF, or (bases only) CSV. This is the reference for anyone building an export format, adding a new exportable file kind, or debugging a mismatch between what the export pane shows and what actually gets written to disk.

The system has two faces that share one renderer: a **dedicated export pane** inside the app (`ExportView.tsx`, opened via the `::export:<path>` sentinel) and the **`bismuth export` CLI command**, which calls the *exact same* `renderExport()` function with headless dependencies injected. Bases get a "visual vs data" choice — render the chosen view as its kind (a calendar grid, cards, kanban, list) or flatten it to a table — and calendars additionally pick a grid span and anchor day. Most paths (markdown, HTML, CSV, the pure table/view builders) are fully headless already; rasterizing a note/base/sheet's HTML to PNG/PDF is where the two faces diverge in *how*, not *whether* — the app rasterizes in its own browser process (`html2canvas`/`jsPDF`), while the CLI launches a disposable headless Chrome over CDP (`core/src/render/htmlRaster.ts`, `core/src/render/chromeSession.ts`) to do the same job with no running app to borrow a browser from. Drawings rasterize through the headless core renderer (`core/src/drawing/export.ts`) either way.

**What's in here**: the pane's controls and how a source file is classified as a base ([The export pane](#the-export-pane-exportviewtsx)); which formats each file kind supports ([Targets × formats](#targets--formats)); the visual-vs-data render mode for bases ([Visual vs data render mode](#visual-vs-data-render-mode-bases)); the frontmatter toggle, the markdown-syntax toggle, and page-break splitting ([Include/exclude frontmatter](#includeexclude-frontmatter), [Markdown syntax markers](#markdown-syntax-markers), [Page breaks](#page-breaks)); how a note's document fonts get embedded ([Font embedding](#font-embedding)); the shared renderer internals ([The renderer: exporters.ts](#the-renderer-exportersts)); what runs in-app vs. headless ([Headless vs browser-only paths](#headless-vs-browser-only-paths)); the CLI ([The CLI: bismuth export](#the-cli-bismuth-export)); and how a completed export actually reaches disk ([Download flow](#download-flow)).

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
- **Markdown syntax** (plain `.md` only, not a base, same field as Frontmatter above) — a "Show markdown syntax" toggle, default OFF, wired to `ExportOptions.showMarkdownSyntax`. See "Markdown syntax markers" below.
- **Format** — the valid format chips for the current file/mode (see Formats below). A page-broken PNG export shows a small heads-up ("N pages → exports as N separate PNG files"); see "Page breaks" below.
- **Font size** (PDF only) — a chip per size in `PDF_FONT_SIZES` (`9 10 11 12 14 16 18`pt, `options.ts`), wired to `ExportOptions.pdfFontSize`. Defaults to `DEFAULT_PDF_FONT_SIZE` (12pt, "a standard document body size"). A larger size renders bigger text and **repaginates** — taller content overflows onto more Letter pages, same as widening the font in any paginated document. The CLI has no equivalent flag; a headless PDF export always uses the 12pt default (`defaultExportOptions()`).
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

## Markdown syntax markers

`ExportOptions.showMarkdownSyntax` (default `false`) controls whether an `html`/`pdf`/`png` export of a plain (non-base) note shows the literal `##`/`###`/…/`######` marker in front of an `h2`-`h6` heading, mirroring the app editor's own aesthetic of leaving the marker visible next to the rendered heading (`htmlTemplate.ts`'s `styles()`). It's rendered `::before` the heading text in the theme's muted color, at normal weight, so it reads as an annotation rather than part of the title. `h1` never gets a marker — it's the document title, the same distinction the pane's card view draws. It's a no-op for `md` (the raw text already has its markers) and for bases/sheets/drawings, which have no note-editor heading markup.

Off by default: turning it on is opt-in, not a stripped-down feature — a heading rendered with its marker literally visible (`## Problem 1`) reads as broken to a reader who doesn't expect it, so clean formatting (markers rendered away, the normal `marked`/HTML behavior) is the default and this toggle is for someone who wants the export to visually match the source markdown.

CLI: pass `--markdown-syntax` to `bismuth export` to turn the toggle on (maps to `ExportOptions.showMarkdownSyntax: true`); omit it to keep the default (no markers).

## Page breaks

A lone `<!-- pagebreak -->` comment line (invisible on screen and in Obsidian — inserted via the editor's slash menu, `id: "pagebreak"`) marks a page boundary. `bases/markdown.ts`'s `renderMarkdown` turns it into a zero-height `<div class="bismuth-page-break">` (masked/restored like wikilinks so a marker inside a code fence/span stays literal) that survives `sanitizeHtml`; `htmlTemplate.ts` gives it `break-after: page; page-break-after: always; height: 0`. Each format honors this marker differently, since only some formats can hold more than one page:

- **PDF** — a single PDF with a forced page break at each marker. `export/htmlToPdf.ts`'s `htmlToCanvas` measures every `.bismuth-page-break` div's post-layout Y offset (ignoring one that lands outside the real content band — i.e. right at the very start/end of the document, which would otherwise slice off an empty page) and passes those offsets to `htmlToPdf`, which cuts a new Letter page at each one instead of only at the natural page-height boundary. The page math is pure and DOM-free in `export/pageGeometry.ts`: US-Letter-in-points constants (`PAGE_W_PT`/`PAGE_H_PT` 612×792, `MARGIN_PT` 72, `CONTENT_W_PT`/`CONTENT_H_PT` 468×648), the source raster widths (`PAGE_W_PX` 816 for PNG, `CONTENT_W_PX` 624 for the PDF's 1:1-inch printable-box layout), `pdfSliceMetrics` (px→pt scale + per-page slice height), `pageSlices` (auto-pagination: bands ≤ one page, forced breaks ending a page early, and each natural page bottom pulled back to the nearest legal cut — see "Page boundaries never cut a line"), and `parseRgbColor` (the `rgb()`/hex → `[r,g,b]` parser feeding jsPDF's `setFillColor` for the margin-band page fill).
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

## Page boundaries never cut a line

A PDF page bottom is chosen by MEASUREMENT, not by arithmetic on a baseline grid.

`htmlToPdf.ts`'s `measureCutStops(doc, scale)` runs on the laid-out off-screen iframe, just before
html2canvas snapshots it, and collects every **atom** — anything that must not be sliced:

- one rect per rendered **line box**, from `Range.getClientRects()` over each text node (that call is
  what makes wrapped lines visible at all; an element-level walk cannot see them);
- every indivisible element: `tr` (the ROW, not the whole table, so a long table still paginates),
  `img`, `svg`, `canvas`, `hr`, `video`.

An atom's bottom edge becomes a legal cut unless another atom **encloses** it — starts at or above it
and ends below it. That is the nesting case (a text line inside a table row), and it is the only one
that disqualifies an edge. Sibling line boxes that merely *overlap* do not: `getClientRects` returns
each line's ink box rather than its line box, so at a tight `editor.lineHeight` consecutive lines
overlap by a pixel or two, and treating that as disqualifying threw away nearly every text edge in the
document. `pageSlices` then pulls each natural page bottom back to the last legal stop that fits; when
nothing fits (a single atom taller than a whole page) the raw bottom stands, so the pager always
advances.

**Why it is not the 22px grid any more.** `RULE_PX` (`htmlTemplate.ts`) is still the typographic
baseline unit, and `pdfSliceMetrics` still snaps the page height to a multiple of it — but that only
lands on a line boundary if *every* block in the document is a whole number of rules tall. A `<table>`
row (a 22px line + 2×0.4rem padding + borders ≈ 36.9px) and an `<hr>` (2px + 2×8px margin) are not, so
one table shifted everything below it off the grid and every later page cut sliced a text line in
half — measured at 10.5px into an 18px glyph rect, on all four cuts after the table in a six-page
probe note. Three earlier rounds each conformed one more block type (`pre`, callouts, math blocks);
that work is unbounded, because any CSS change can re-open it and no test that does not RENDER can
catch it. Measuring where the lines actually are ends the class of bug.

The one residue: at an `editor.lineHeight` low enough that the type's ink is taller than its line box
(a leading ratio around 1.2 and below), consecutive lines genuinely overlap and no horizontal cut is
clean. The pager still cuts on the line-box boundary — clipping a descender by the overflow amount,
about 2px — which is the best available, and the app renders those lines overlapping too.

## Note prose carries the app's typography

A rendered NOTE export takes its typography from what the app is currently showing, alongside the
colours `resolvePalette` already resolved:

| | source | where |
|---|---|---|
| face | `--prose-font` (the proportional note face, Lora Variable) | `:root`, `styles/tokens.css` |
| leading | the app's own `calc(var(--row-h) * var(--prose-line-height))`, read back as a **ratio of the type** | `--prose-line-height` = `editor.lineHeight` |
| colours | `--bg`/`--fg`/`--accent`/the category tokens | probed — see "html2canvas and modern CSS colors" |

The UI face (`ThemePalette.font`, used by every NON-prose export) comes from `--ui-font-stack`.
It used to be read off `getComputedStyle(document.body).fontFamily`, but nothing sets a
`font-family` on `<body>` — App.css puts the app's `font:` shorthand on `.app-shell` and `.layout` —
so that resolved to the browser default and every base/calendar/sheet export rendered in Times.

Leading travels as `ThemePalette.proseLeading`, a ratio, **not** as `editor.lineHeight` itself: that
setting is a multiple of the app's 18px row unit (`--row-h`), not of the type, so the raw number means
something different at the export's font size — at the default it lands on a 1.07 ratio, the cramped
case the setting's own schema doc warns about. `resolvePalette` puts the app's identical `calc()` on
its probe element and divides the computed line-height by the computed font-size, so the value cannot
drift when the app's expression changes.

There is deliberately no `--prose-scale` in the palette. In the app that scale exists so a serif reads
at the same *optical* size as the mono chrome beside it; an export document has no mono chrome, and
the pt picker is already the intended reading size — applying the scale would silently render a chosen
12pt at 15.36pt.

Only note prose switches. A base's visual export (calendar grid, cards, kanban), a sheet table and a
raw markdown dump keep `ThemePalette.font` (the UI face) on the fixed `RULE_PX` rule, because that is
what those surfaces use in the app too. The flag is `prose` on `bodyHtml` / `wrapBody` /
`wrapHtmlDocument`; `exporters.ts` sets it on the plain-`.md` branch only.

Headless (CLI) exports have no DOM to probe, so colour still falls back to `DEFAULT_PALETTE`'s
values — but typography does not. `cli/src/commands/export.ts`'s `buildPaletteOverride(vault, theme)`
reads the vault's own `.settings` (via `readSettings`) and builds a `ThemePalette` override —
`options.palette`, passed into `renderExport`/`renderPreview` — that replaces three fields on top of
`DEFAULT_PALETTE[theme]`:

- **`proseLeading`** — recomputed from `editor.lineHeight` (falling back to the schema default `1.5`
  when the vault has no `.settings` or leaves the key unset) and `appearance.editorFontSize`
  (falling back to `13.5`), using the **same ratio the live app's DOM probe computes**:
  `proseLeading = (ROW_H_PX * lineHeight) / (editorFontSize * PROSE_SCALE)`, where `ROW_H_PX = 18`
  (the app's `--row-h` row unit) and `PROSE_SCALE = 1.28` (`styles/tokens.css`'s `--prose-scale`) are
  mirrored as local constants rather than re-derived, so a change to either token in the app is the
  only place this can drift from.
- **`monoFont`** — `appearance.uiFont` resolved through `FONT_STACKS` (the same setting and map
  `settingsCssVars.ts` uses for the app's `--ui-font-stack`; `uiFont` is now the sole source for both the
  in-note mono face and the chrome face), or the raw string when the vault names a face the map
  doesn't carry, falling back to `DEFAULT_PALETTE[theme].monoFont` when the setting is unset.
- **`font`** — `appearance.uiFont` resolved the same way, falling back to
  `DEFAULT_PALETTE[theme].font`.

So a headless PDF/PNG/HTML export's prose leading and both faces track the vault's own settings; only
colour (and the prose scale itself, per the note above) stay fixed at `DEFAULT_PALETTE`'s values.

## Font embedding

An exported document is standalone — no `<link>` to the app's own stylesheets, and (for a PDF/PNG
rasterizer, browser or headless) no access to whatever fonts the app loaded from `node_modules` at
runtime. Without embedding the actual font files, a note's prose face (`Lora Variable`) and mono face
(`Monaspace Xenon`) simply aren't resolvable in the exported document, and every browser silently
falls through the CSS font stack to its next entry — measured directly on a real export before this
existed (under the prior CMU-Serif-based prose face): a prose run painted 737.1px wide, identical to
Georgia's 737.1px and nothing like CMU Serif's 677.2px, while KaTeX's own faces (embedded separately,
see `katexCss`) rendered as real Computer Modern — two different serifs a few pixels apart in the
same document. The prose face is Lora Variable now, but the fallback trap the measurement exposed
is unchanged: an unresolvable family name still falls silently through to Georgia.

The fix is split across three files because the two callers obtain font bytes by incompatible,
non-interchangeable means:

- **`app/src/export/fontFaceCss.ts`** — the shared, asset-import-free half: the `DocFace` type
  (`family`/`style`/`weight`/an already-inlined `src: data:` URI) and `faceCss(faces)`, which
  serializes a `DocFace[]` into `@font-face` rules. Neither embedder imports the other's module, so
  this is the one place that fixes which weights get shipped and how they're written out.
- **`app/src/export/docFontCss.ts`** — the browser embedder. It pulls the document faces (Lora Variable
  regular/italic — two variable faces spanning weight range 400 700, replacing the four static CMU
  Serif faces this used to ship — plus Monaspace Xenon regular/italic/bold) in as base64 through
  Vite's `?inline` transform — the same mechanism `katexCss.ts` uses for KaTeX's glyphs — and calls
  `faceCss()` to build the stylesheet, caching the result after the first build. `docFontInlineCss()`
  is synchronous and is what `ExportView.tsx` wires into `ExportDeps.docFontCss`.
- **`cli/src/docFontCss.ts`** — the headless twin, for a `bun build --compile` binary that has no
  `node_modules` anywhere near it at run time. It imports the same seven font files via Bun's
  `with { type: 'file' }` import attributes (resolved and inlined into the binary **at build time**,
  not looked up on disk at run time — the same reasoning `cli/src/katexCss.ts` documents for why
  `require.resolve()` would be wrong here), reads each one lazily through `Bun.file(path).arrayBuffer()`,
  base64-encodes it, and calls the same `faceCss()` to produce identical `@font-face` text. Because
  `Bun.file().arrayBuffer()` is async, `docFontInlineCss()` here is `async` where the browser version
  isn't — the two are not drop-in interchangeable, which is exactly why `exporters.ts` takes
  `docFontCss` as an injected `ExportDeps` field rather than importing either module directly.

Both embedders keep their own local face list (`FACES` in the CLI module) rather than importing a
shared list of *faces*, since only the serializer (`faceCss`) and the shape (`DocFace`) are common —
what differs between them is how the `src` gets filled in.

`wrapBody` (`exporters.ts`) inlines `deps.docFontCss()`'s output into every exported document's
`<style>` block **unconditionally** — a note has prose regardless of format, unlike the KaTeX
stylesheet, which is inlined only when the body actually contains rendered math. This is what lets
the headless Chrome that rasterizes a CLI PDF/PNG (see "Headless vs browser-only paths" below) paint
real Lora Variable and Monaspace Xenon instead of falling through to Georgia, exactly as it lets the
app's own `html2canvas` pass do the same.

## The renderer: `exporters.ts`

Both faces call into two functions, parameterized by an injected `ExportDeps` so the module stays unit-testable and bun-compilable:

- **`renderPreview(path, format, deps, theme, opts)`** — computes *only what the pane displays*. It never produces export bytes and never runs the heavy `html → pdf` pipeline, so flipping formats/options in the UI is instant and side-effect-free. The PDF/PNG **preview** is just the source HTML (shown in the iframe) — except a page-broken note, which previews as labeled per-page sheets (see "The preview visualizes the pages"); MD/CSV previews are the literal text in a `<pre>`; a drawing preview is its rasterized data-URL `previewImg`.
- **`renderExport(path, format, deps, theme, opts)`** — produces the real downloadable `{ bytes, mime, filename }` (`ExportResult`).

Inside, a file's HTML body is built by `bodyHtml` → `renderedBody` → `wrapBody`:

- `bodyHtml` picks the body by file kind: a sheet → `snapshotToHtmlTable` (`sheetHtml.ts` — the Univer workbook's first sheet flattened to a `<table>`, each cell through `renderCellHtml`); a base → visual (`baseViewHtml`) or a data table (`tableToHtml`, `rowsHtml.ts` — headers escaped, data cells through `renderCellHtml` so inline markdown + `$math$` match the live Base view) built from `baseToTable` (`baseTable.ts` — resolves the `type: base` file the same way `BaseView` does: `parseBaseFile` → resolve source → `runView` → flatten the `ViewResult` to string cells via `cellText`); any other `md` → `renderMarkdown`; otherwise it throws ("No HTML body").
- `renderedBody` guards math: if the first render leaves an unrendered KaTeX placeholder (`/<span class="bismuth-math[^"]*" data-math=/`), it `await whenMathReady()` and re-renders, so exported math isn't blank.
- `wrapBody` wraps the body in a standalone document (`wrapHtmlDocument`), inlining the document faces **unconditionally** (`deps.docFontCss()` — see "Font embedding" above) and a self-contained KaTeX stylesheet (fonts as `data:` URIs, via `deps.katexCss()`) **only when** the body contains rendered math (`class="katex`), plus any view-specific CSS. The `.html` download and the off-screen rasterizer iframe (browser or headless) can't reach the app's loaded stylesheets, so everything must be inlined.

`md`/`csv` exports bypass HTML entirely: `markdownText` returns a base's view-table as a Markdown table (`tableToMarkdown`, `mdTable.ts` — pipe-delimited, `|`/newlines escaped per cell) or any other note's own text; `csvText` enforces base-ness (throws "CSV export is only available for bases").

### Rasterizer color safety (`export/cssColor.ts`)

html2canvas (1.4.x) throws `Attempting to parse an unsupported color function 'color'` on any CSS Color 4 value — `color()`, `color-mix()`, `oklab()`/`oklch()`, `lab()`/`lch()`. The app's theming leans on `color-mix(in srgb, X n%, transparent)` (`--border`/`--faint`/`--panel`/`--surface-2`…, App.css + settingsCssVars), and Chrome serializes the **computed** value of an alpha-carrying color-mix as `color(srgb r g b / a)` — so `resolvePalette`'s probe alone still fed the rasterizer an unparseable color and every themed pdf/png export died. Two defense layers share `cssColor.ts`:

1. **Palette normalization** — `readThemePalette`'s `lit()` runs every probed value through `normalizeCssColor(value, fallback)`: already-safe values (hex/rgb/hsl/named) pass through; `color(srgb …)` converts via the pure `colorSrgbToRgb` parser; anything else the browser can evaluate resolves through a 1×1-canvas pixel read; a hopeless value falls back to the corresponding `DEFAULT_PALETTE` entry. The export doc's stylesheet therefore only ever carries `rgb()`/`rgba()`/hex.
2. **Iframe sweep** — `htmlToCanvas` (`htmlToPdf.ts`) calls `sanitizeDocColorsForRaster(doc)` on the laid-out off-screen iframe right before snapshotting: it walks every element, and any computed color property (`color`, `background-color`, the four `border-*-color`s, `outline-color`, `text-decoration-color`) still carrying a modern function gets a normalized `rgb()` inlined over it (an unsafe `box-shadow` is dropped). A clean document is a 0-rewrite no-op; this guards KaTeX/view/extra CSS that never routed through the palette. The body background fed to html2canvas + the PDF page fill is normalized the same way.

The pure parts (`isRasterUnsafeColor`, `colorSrgbToRgb`, the document walk with an injectable normalizer) are unit-tested in `cssColor.test.ts`.

## Headless vs browser-only paths

The split is entirely about *who supplies `deps`*, and — as of `core/src/render/` landing — it is no
longer a split between "works" and "throws". Every export format works both in the app and from the
CLI; what differs is which rasterizer produces the PNG/PDF bytes. The pure renderers (markdown, table
builders, calendar/cards/kanban/list HTML, document wrapping) run anywhere:

- **`md` / `html`** — fully headless everywhere. Pure string output; the CLI writes it directly, no
  rasterizer of any kind involved.
- **`png` / `pdf` of a note / base / sheet** — rasterized, by one of **two independent
  implementations** wired in through `deps.htmlToPng` / `deps.htmlToPdf`, both starting from the exact
  same self-contained HTML document `wrapBody` produces:
  - **The app** — `app/src/export/htmlToPdf.ts`: the document is written into an isolated off-screen
    `<iframe>` inside the running app's own browser, snapshotted with **`html2canvas`**, then (for PDF)
    sliced across US-Letter pages via **`jsPDF`**, using the pixel-measurement pagination described in
    "Page boundaries never cut a line" above.
  - **The CLI** — `core/src/render/htmlRaster.ts`'s `htmlToPdfHeadless` / `htmlToPngHeadless`, wired in
    by `cli/src/commands/export.ts`. There is no running Bismuth to borrow a browser from, so this
    module launches a **disposable headless Chrome** (`core/src/render/chromeSession.ts`'s
    `launchChrome`, the same launcher `bench/` visual tooling re-exports) and drives it over CDP: the
    document is set directly via `Page.setDocumentContent` (not navigated to a `data:` URL — the
    export document's own inlined fonts, see "Font embedding" above, are large enough to blow past
    Chrome's URL length limit, which failed silently as a 30s `Page.loadEventFired` timeout before this
    was fixed), then rasterized with Chrome's own **native** `Page.printToPDF` (PDF) or
    `Page.captureScreenshot` (a full-page PNG, sized to the document's real content box via
    `Page.getLayoutMetrics`, at `deviceScaleFactor: 2` to match the app's own PNG default) — no
    `html2canvas`, no `jsPDF`. Because `Page.printToPDF` is Chrome's real print pipeline, it honors the
    `@page { size: 8.5in 11in; margin: 1in; }` rule and the `.bismuth-page-break` `break-after: page`
    rule already baked into every export document (`htmlTemplate.ts`) on its own — the CLI's PDF
    pagination is native browser pagination, not the app's `measureCutStops`/`pageSlices` pixel
    measurement, though both land on the same Letter page box.

  This is a genuine external-tool dependency: `chromeSession.ts` hardcodes `CHROME` to
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with **no environment-variable
  override and no PATH lookup**, so a headless PDF/PNG export from the CLI requires that exact binary
  to exist at that path — on any other OS, or a machine without Google Chrome installed there, the
  export fails at Chrome launch (`chrome debugger port never opened`) rather than at `renderExport`.
  Every other export format (`md`/`html`/`csv`, and `png`/`pdf` of a `.draw`) has no such dependency.
- **`png` / `pdf` of a drawing** — headless-capable regardless of the Chrome dependency above.
  Drawings rasterize through `deps.drawingToPng`. In the app this is `drawingRaster.ts` (a browser
  Canvas2D `drawingToPng`); in the CLI it's the **core headless renderer** `renderDocToPng`/
  `renderDocToPdf` (`@napi-rs/canvas` + `pdf-lib`) — no Chrome involved at all. The PDF path for a
  drawing wraps the rasterized PNG data-URL in an `<img>` document and runs it through `htmlToPdf` (in
  the app) — but the CLI special-cases `.draw` *before* reaching the app exporter and renders both
  formats straight through the core renderer, so drawing PNG **and** PDF both work headlessly there.
  See the next section for how the two rasterizers relate.

### Drawing rasterization: browser (`drawingRaster.ts`) vs headless (`core/src/drawing/export.ts`)

A `.draw` doc is rasterized by two independent implementations that share the same pure pixel logic (`core/src/drawing/render2d.ts`'s `renderPage`/`renderDocStacked`) but a different canvas backend and page-assembly strategy — this is the split referenced above:

- **Browser** — `app/src/export/drawingRaster.ts`'s `drawingToPng(docText, theme)`: parses the doc (`parseDoc`, falling back to `emptyDoc()` on a parse error), pre-decodes every distinct image `src` referenced by placed images / backgrounds into `HTMLImageElement`s (`decodeImages`; an undecodable src is skipped rather than failing the export), creates a real DOM `<canvas>` sized `PAGE_W*SCALE` × `PAGE_H*pages.length*SCALE` (`SCALE = 2`), and calls `renderDocStacked` to draw every page into **one tall canvas** (pages stacked vertically), returning `{ bytes, dataUrl }` via `canvas.toDataURL("image/png")`. This is wired in as `ExportView.tsx`'s `ExportDeps.drawingToPng` and — unlike `htmlToPdf`/`htmlToPng` — is imported statically, not lazily, since it doesn't pull in `jspdf`/`html2canvas`. It backs **both** the instant preview (`renderPreview`'s `previewImg`) and the real downloadable PNG bytes (`renderExport`'s `png` case) — there's no separate preview-only rasterizer, so what you see in the pane is pixel-for-pixel what gets written to disk.
- **Headless** — `core/src/drawing/export.ts`'s `renderDocToPng`/`renderDocToPdf`: same pre-decode step (`decodeImages`, but via `@napi-rs/canvas`'s `loadImage` instead of `Image()`) into a **non-DOM** `createCanvas`. `renderDocToPng` mirrors the browser path exactly — one call to `renderDocStacked` over a single tall (`PAGE_H * pages.length`) canvas at the same 2x `SCALE` — so app and CLI PNG output agree pixel-for-pixel. `renderDocToPdf` does **not** stack: it rasterizes each page separately at its native `PAGE_W`×`PAGE_H` (`pageToPng` → `renderPage`, one call per page index) and embeds each page's PNG into its own `pdf-lib` `PDFDocument` page sized to the drawing's own dimensions — no Letter-page slicing.

Because `renderDocToPdf` doesn't stack while the app's PDF path does, a multi-page drawing's PDF differs in shape depending on which face produced it: the **app** rasterizes the whole (stacked) drawing to one PNG, wraps it in an `<img>` document, and slices *that* through `htmlToPdf` (html2canvas + jsPDF) onto US-Letter pages, so the app's drawing PDF is Letter-paginated rather than one-drawing-page-per-PDF-page. The **CLI**'s PDF (`renderDocToPdf`, used directly — see below) instead emits exactly one PDF page per drawing page, each sized to the drawing's own `PAGE_W`(816)/`PAGE_H`(1056) — no Letter slicing at all.

## The CLI: `bismuth export`

`cli/src/commands/export.ts` reuses the **same** `renderExport` so CLI output matches the in-app export exactly. Usage:

```text
bismuth export <file> [--format md|html|png|pdf|csv] [--out FILE]
  [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day]
  [--no-frontmatter] [--markdown-syntax] [--theme dark|light] [--vault <dir>]
```

Flow:

1. The default format is `md`, except a `.draw` defaults to `png`. `--theme` defaults to `"dark"`; any other value fails (`--theme must be "dark" or "light": <x>`).
2. **Drawings short-circuit**: a `.draw` is parsed (`parseDoc`) and rendered with the headless core renderer (`renderDocToPng`/`renderDocToPdf`, themed by `--theme`); `png` and `pdf` both work, any other format errors ("a .draw file exports to png or pdf").
3. **Everything else** calls `renderExport(file, fmt, deps, theme, optionsFrom(args))` with headless deps:
   - `read` → `readNote(vault, p)`
   - `resolveRows` → `resolveSource(spec, { root: vault, today })`
   - `htmlToPdf` / `htmlToPng` → `htmlToPdfHeadless` / `htmlToPngHeadless` (`core/src/render/htmlRaster.ts`) — a real headless Chrome, launched and torn down per call; see "Headless vs browser-only paths" above for the Chrome-binary dependency this brings
   - `htmlToPdfPages` → `htmlToPdfPagesHeadless`, which **always throws**: it only backs the in-app paged PDF preview (`renderPreview`'s `format === 'pdf'` branch), the CLI never calls `renderPreview`, and `--format pdf` itself never calls `htmlToPdfPages` — so this deliberately-unimplemented dep is wired in but unreachable from `bismuth export`
   - `drawingToPng` → core `renderDocToPng`
   - `katexCss` → returns `""` (the app's `?inline`-bundled KaTeX font CSS is Vite-only and unresolvable in a bun-compiled binary; CLI HTML exports still carry the math markup, just without embedded fonts)
   - `docFontCss` → `cli/src/docFontCss.ts`'s `docFontInlineCss` (see "Font embedding" above) — without it the headless Chrome rasterizing a CLI PDF/PNG would have no Lora Variable or Monaspace Xenon to paint prose with
   - `options.palette` → `buildPaletteOverride(vault, theme)`, read from the vault's own `.settings` (see "Note prose carries the app's typography" above)
4. `optionsFrom(args)` maps `--view`/`--mode`/`--cal-start`/`--cal-span`/`--no-frontmatter`/`--markdown-syntax` onto `defaultExportOptions()` (no-ops for non-base files; `--no-frontmatter` sets `includeFrontmatter: false`, see "Include/exclude frontmatter" above; `--markdown-syntax` sets `showMarkdownSyntax: true`, see "Markdown syntax markers" above). There is no CLI flag for `pdfFontSize` — a headless PDF always renders at the 12pt default.
5. Bytes are written to `--out` (or `res.filename`) — **except** a page-broken PNG note (`res.files.length > 1`, see "Page breaks" above), which writes every file to its own computed name instead (`--out` doesn't apply to a multi-file result). This path is live: a multi-page note exported as PNG renders each `<!-- pagebreak -->` section through `htmlToPngHeadless` in its own headless-Chrome call and writes one file per page.

So `bismuth export Tasks.md --format html`, `bismuth export sketch.draw --format pdf`, `bismuth export Calendar.md --mode visual --cal-span week --format html`, `bismuth export Essay.md --format md --no-frontmatter`, and now `bismuth export note.md --format pdf` (or `png`) all work headlessly — the last two by way of a real headless Chrome the command launches for that one call, and only fail if that Chrome binary isn't present on the machine (see "Headless vs browser-only paths" above).

## Download flow

`doExport` (`ExportView.tsx`) flushes any un-blurred edit, calls `renderExport`, then dispatches on the chosen output. **The write result is authoritative**: every desktop write is verified with `fs.exists` afterwards, and success is only toasted for a file that provably landed — a resolved-but-missing write throws into the failure toast with the attempted absolute path. (The packaged app used to toast "Exported … to Downloads" purely because the write call resolved; when nothing landed, the toast lied — the exact bug this design removes.)

- **A chosen folder + desktop app** → `writeToFolder(dest, filename, bytes)` (Tauri fs plugin; the folder must be inside the app's fs capability scope), write **verified**, returning the absolute path; toasts `Exported … → <path>`.
- **Otherwise** → `deliverFile(filename, bytes, mime)` (`download.ts`):
  - **Desktop**: write to `path.downloadDir()` (the REAL OS Downloads dir) → verify with `fs.exists` (capability `fs:allow-exists`). If the write throws **or** verification fails, fall back to the native **Save dialog** (`dialog.save` — a user-consented path is always allowed by the fs scope; covers e.g. a denied macOS Files-and-Folders permission on Downloads); write + verify there. A cancelled dialog or a doubly-failed write **throws** — nothing silently succeeds. Resolves `{ via: "tauri", path }`; the toast shows the verified absolute path (`Exported → /Users/…/Downloads/note.pdf`).
  - **Browser**: `Blob` + `<a download>` anchor click, resolving `{ via: "browser" }` (the browser owns the download from there); toasts "to Downloads".

The Tauri surface is injectable (`TauriDelivery`), so the routing + verify-after-write logic is unit-tested without a webview (`download.test.ts`); the real seam lazy-imports `@tauri-apps/plugin-fs` / `@tauri-apps/api/path` / `@tauri-apps/plugin-dialog`.

The `ExportDeps` the pane wires up include `read`/`resolveRows` (HTTP via `api`), the deferred `htmlToPdf`/`htmlToPng` (dynamic-imported only when actually exporting a PDF/PNG, to keep `jspdf`+`html2canvas` out of the preview path), `drawingToPng` (browser raster), and `katexCss` (the Vite `?inline` module, lazy-loaded only when an export contains math).

Source: `app/src/ExportView.tsx`, `app/src/export/exporters.ts`, `app/src/export/types.ts`, `app/src/export/formats.ts`, `app/src/export/options.ts`, `app/src/export/pageBreaks.ts`, `app/src/export/pageGeometry.ts`, `app/src/export/cssColor.ts`, `app/src/export/resolvePalette.ts`, `app/src/export/baseView.ts`, `app/src/export/baseTable.ts`, `app/src/export/rowsHtml.ts`, `app/src/export/mdTable.ts`, `app/src/export/sheetHtml.ts`, `app/src/export/viewHtml.ts`, `app/src/export/calendarHtml.ts`, `app/src/export/csvTable.ts`, `app/src/export/htmlToPdf.ts`, `app/src/export/htmlTemplate.ts`, `app/src/export/drawingRaster.ts`, `app/src/export/download.ts`, `app/src/export/docFontCss.ts`, `app/src/export/fontFaceCss.ts`, `app/src/bases/cardBodySplit.ts`, `app/src/bases/markdown.ts`, `app/src/tabIds.ts`, `app/src/PaneContent.tsx`, `cli/src/commands/export.ts`, `cli/src/docFontCss.ts`, `core/src/render/htmlRaster.ts`, `core/src/render/chromeSession.ts`.
