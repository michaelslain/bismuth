# Book view

A book view turns the pages of a scanned notebook, a photo album or a stack of PDFs: each row of the base names one page file, and the view shows them three ways, as one long column (`scroll`), as a book with page turns (`pages`), and as text, where each page's transcription is the page. The same reader opens any single image or PDF; see [read one image or PDF as a book](#read-one-image-or-pdf-as-a-book).

```json
{"type":"base","view":"book"}
{"page":"[[scans/notebook-01.jpg]]"}
{"page":"[[scans/notebook-02.jpg]]"}
{"page":"![[scans/appendix.pdf]]"}
```

The first line is the config, and each later line stores one page. The book owns its rows, so the config has no `source:`. An image row is one page; a PDF row is one page per PDF page. Row order is page order: reorder, add or remove pages in the [page sorter](#edit-the-pages), or by editing these lines in the base's source view. Removing a page removes its row, never the file.

## Book config keys

Every key below is a top-level key beside `view: book`.

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `view` | string | `book` | `table` | Selects this view |
| `page` | string | a property id such as `scan` or `note.scan` | `page` | The column holding each row's page file |
| `bookLayout` | string | `spread`, `single` | `spread` | Two pages side by side when the pane fits them, or always one page |
| `bookMode` | string | `scroll`, `pages`, `text` | `pages` | One long column of pages, the pages turned as a book, or their transcriptions set as text |
| `bookDark` | boolean | `true`, `false` | `appearance.pdfDarkMode` | Draws the pages dark, as the PDF viewer's dark mode does |

An invalid `bookLayout` reads as `spread`, an invalid `bookMode` reads as `pages`, and a `bookDark` that is not `true` or `false` is ignored.

## What a row stores

A row's page column holds a vault path, a wikilink or an embed. All of these name the same kind of page:

| Stored value | Page |
|---|---|
| `scans/c.png` | the image at that path |
| `[[scans/a.jpg]]` | the image at `scans/a.jpg` |
| `![[b.pdf]]` | every page of the PDF `b.pdf` |

A wikilink is read as a vault path, not looked up by name, so write the folder too. A row whose own note is the companion of an image or PDF (`x.jpg.md`) uses that file when its page column is empty. A row whose value is a note, or is empty, is skipped and shows no page.

## How a PDF row expands

A PDF row contributes one page per PDF page, in order, so a three-page PDF between two images makes a five-page book. A PDF whose page count is not known yet shows as one page until it loads.

## Spreads and page size

In `spread` layout the first page sits alone on the right, like a front cover. The pages after it pair up, 2 with 3, 4 with 5 and so on. When the book has an even number of pages the last page sits alone on the left. In `single` layout each turn shows one page.

Pages sit straight on the pane's background, the way a reading app shows them: no page edges, no spine line and no shadows, so the margins inside each page are the only gutter. In `pages` mode the pages on screen set the size: the wider of the two pages shown, kept between 1:2 and 1.6:1, so each page fills its half of the pane and neither is cut; a spread of portrait pages fills the height even when the book opens with a wide photo. The narrower page of a mixed spread sits against the spine with the background around it (centred in `single` layout). In `text` mode a page keeps the scans' shape when it is a portrait reading page (between 0.55:1 and 0.85:1), and is a 2:3 reading page otherwise, as for a book of wide photos. The spread scales to fit the pane's height or width, whichever runs out first.

The page number sits centred under the book: `2–3 of 8` on a two-page spread, `1 of 8` for a page on its own.

Two pages need at least 280 px each, so a narrower pane shows one page whatever `bookLayout` says.

The `Aa` button at the end of the view bar opens the display panel. Its `layout` row picks `auto`, two pages when the pane fits them, or `single`, one page at a time. `single` is saved as `bookLayout: single`; `auto` removes the key. Its `text size` row sets text mode's type size.

## Turn the page

Turn a page in any of three ways:

- Press the `book-next-page` or `book-prev-page` keybinding, `ArrowRight` and `ArrowLeft` by default. Both are rebindable in `.settings`. They do nothing while the cursor is in a text field.
- Click in the outer third of a page.
- Drag a page from its outer half toward the spine. Letting go past the spine completes the turn; letting go before it lets the page fall back.

The page curls as it turns, in a fraction of a second. A press while a page is turning the same way waits behind it rather than cutting it short. Waiting turns run back to back, quicker the more are waiting, so flipping fast moves through the book in one smooth run; a few turns can wait, and a press past that is dropped. A press the other way ends the running turn at once and turns back. With the system's reduce-motion setting on, pages swap without the curl. A turn stops at the first and last spread.

## Add pages

Drop images or PDFs onto the book, or pick them with the `+` (add pages) in the view bar or `[ + pages ]` on the empty book. Each file is copied into the vault's attachment folder (the `attachments:` settings choose where) and gets a row at the end, in the order dropped. Other file types are skipped with the toast `only images and PDFs can be pages`.

A book with a `source:` takes its pages from that source, so dropping files onto it adds nothing and shows a toast saying so.

## Edit the pages

The page sorter adds, moves and removes pages. Open it with the grid icon (`edit pages`) in the view bar; it shows every page as a thumbnail with its number under it.

- Drag a page to move it. An accent line marks where it lands.
- Hover a page and press its `[x]` to remove it. The `undo` on the toast that follows puts it back.
- The `[+]` tile after the last page picks images and PDFs to add at the end; dropping files between two pages adds them there.
- `+ blank page` adds an empty page, on a PDF read on its own.

Nothing is written until `save`; `cancel` leaves the book as it was. In a book base, `save` edits the base's rows: a removed page's row is deleted, an added file is copied into the attachment folder and gets a row, and the rows are put in the sorter's order. One tile stands for one row, so a PDF row moves and goes as a whole and its tile reads `lecture.pdf // 12 pages`. A book with a `source:` has no sorter.

On a PDF read on its own, `save` rewrites the PDF itself: one tile is one PDF page, and each page's highlights, ink, bookmarks and transcript move with it. Only JPEG, PNG and PDF files can be added to a PDF. [Rewrite a PDF's pages](../../vault/pdf-pages.md) describes the rewrite and its `bismuth pdf pages` command. An image read on its own has no sorter.

## Transcription

A page's text is its transcription: `text` mode is the one place a transcript shows. With `transcription.auto` on, the default, opening a book queues every page that has no text for transcription, and so does adding pages. While pages are queued the view bar's readout ends with `// transcribing 3 of 12`. With `transcription.auto` off, nothing runs until the button below is clicked.

A transcript lives in the page file's companion note (`<file>.<ext>.md`), between markers, so keyword search and semantic search find it. The companion note is described in [companion notes](../../vault/frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs); engines, options and the `bismuth transcribe` command are in [Transcribe pages and handwritten scans](../../vault/transcription.md).

While some pages have no text and nothing is running, the first action in the view bar is a `transcribe 3 pages` button (`transcribe 1 page` for one page). Clicking it starts the run and the button goes; once every page has text, nothing replaces it. A page whose run failed keeps the button. Both the automatic run and the button use the engine in `transcription.engine`; engines, providers and settings are in [Transcribe pages and handwritten scans](../../vault/transcription.md).

A run that finds pages that look like math, with `transcription.math` at `ask` (the default), keeps their fast on-device text and then asks once, when the run ends: a dialog titled `this page has math` (or `3 pages have math`) says that reading math properly takes about 15 s a page. `[ read it properly ]` re-reads only those pages with Marker, or an ai backend where Marker is missing; `[ go fast ]`, `[x]` or Escape keeps the text there. Opening a book also looks at pages the built-in on-device reader transcribed earlier: once a session, those whose stored text looks like math join the same prompt (with `transcription.math` at `careful` they are re-read without asking, and at `fast` they are left). With `don't ask again` ticked, the choice is saved as `transcription.math` (`careful` or `fast`) and the dialog does not come back. When Marker is not installed yet, the dialog adds that the math reader downloads itself the first time (about 1.2 GB), and `[ read it properly ]` installs it first while the readout ends with `// setting up the math reader`; see [Install Marker](../../vault/transcription.md#install-marker).

Right-click a page in `pages` mode, or a text page in `text` mode, for the page's menu: `edit text` opens that notebook page's text to [fix by hand](#fix-a-pages-text), and `transcribe again with ai` transcribes only that page again with an ai backend, replacing its text. In `text` mode both act on the notebook page whose text was under the pointer. The pane's own rows (split, close) follow below them in the same menu. A failed ai run shows a toast with the server's message.

## Fix a page's text

`edit text` on a page's right-click menu opens its transcript over the book as markdown, in the prose font, with `$math$` and `==marks==` as they are stored. Correct what the reader got wrong and press `save`; `cancel` (or Escape, the `ui-dismiss` keybinding) leaves it. The text is written into the page file's companion note in place of that page's transcript, and text mode sets it again. Clearing every word removes the page's text, so the page shows as not transcribed. `bismuth transcript set` does the same from a shell; see [Transcribe pages and handwritten scans](../../vault/transcription.md).

## Text mode

The `scroll | pages | text` switch in the view bar picks how the book is read. `text` shows the transcriptions. `text` sets every page's text as a reading-app book, on the same sheet as the scans: white paper and dark ink (dark pages turn both, as the [dark pages](#dark-pages) toggle does the scans), in the scans' own page shape, with justified text in the prose font (`appearance.proseFont`, the font notes are set in) in wide outer and narrower inner margins, the same page turns and the page number under the book, counted in text pages (`2–3 of 14`). Each notebook page's text starts on a new text page, so switching between `pages` and `text` lands at the top of the page you were on. The first text page sits alone on the right, like the cover, and the readout counts text pages (`pages 2–3 // 14`). Text reflows to fit the pane, and a resize keeps the first words on screen where they were. A page with no text shows as one muted line, `page 4 isn't transcribed yet`, where its text would be, and the page numbering and page turns are unchanged around it. `text` is disabled, with the title `no page is transcribed yet`, until some page has text. The choice is saved as `bookMode`.

## Dark pages

The moon icon (`dark pages`) in the view bar draws every page dark: white paper turns near-black and dark ink near-white, while colours keep their hue, as the PDF viewer's dark mode draws a PDF. It applies to scans, PDF pages and text pages alike, in every mode. In a book base the choice is saved as `bookDark`; with no `bookDark` key the book follows `appearance.pdfDarkMode`. On a single image or PDF it is the same per-file flag as the PDF viewer's moon, so the viewer and the book agree.

## Scroll

`scroll` shows every page in one column at the pane's width, up to 760 px, top to bottom, each page at its own shape. Pages draw as they come near the view, so a long book costs only what is on screen. The readout names the page at the top of the view (`page 3 // 10`), the page-turn keys do nothing, and switching to `pages` opens the spread holding that page. The choice is saved as `bookMode: scroll`.

## Read one image or PDF as a book

An image or PDF opened in its own tab has the same `scroll | pages | text` switch at the start of its bar's tools:

- `scroll` is the file's viewer, with zoom, find, the draw and highlight tools, scratch paper and convert to markdown.
- `pages` and `text` open the book reader over that one file, with this page's bar: page turns, text mode and its display panel, highlights and bookmarks. A PDF is one page per PDF page; an image is one page. There is no `+` to add pages.

Switching between `scroll` and the book lands where you were reading: `pages` and `text` open on the page the viewer shows (`text` at about the same point in that page's text), and `scroll` returns the viewer to the page the book was on, scrolled about as far into it. `text` is available for a file on its own before it has any text: its pages show as not transcribed yet while transcription runs (with `transcription.auto` on). The mode and a `single` layout are remembered per file on this device. Switching back to `scroll` returns the viewer to where it was.

Transcripts are markdown, and text mode sets it the way a reading app does:

- `#` headings and `**bold**` set bold.
- Inline math, `$…$`, sets in the line with KaTeX.
- Display math, `$$…$$`, sets centred on a line of its own; a formula wider than the text shrinks to fit.
- Wrapped lines of prose rejoin into one paragraph, while short lines (a claim, a heading, a step of a proof) keep their breaks.
- A line that would open wide gaps when justified is set ragged instead.

The display panel's `text size` row is `− 100% +`, the same steps as a PDF's zoom: `−` and `+` step the type smaller or larger and the percentage shows the size; the pages reflow to the new size. The size is saved as `reader.textScale` and applies to every book.

Switching to `text` opens the text page where the notebook page you were on begins. Switching back without turning a page returns to exactly the spread you left; after turning, it opens the notebook page whose text begins on the text spread shown. Switching during a page turn finishes that turn first, so you land where it was going. Dragging a page does not turn it in text mode, since a drag selects words; click the outer third or press the page-turn keys.

Select words and press `highlight` to highlight them at once. With nothing selected, `highlight` arms: the next selection is highlighted, and a click on a highlight removes it. A highlight saves as `==marks==` in that page's transcript in its companion note, so search sees it, and shows as a tint in the highlighter's current colour. A selection across two notebook pages saves one mark on each. A mark survives re-transcription while its words still occur.

## Bookmarks

The bookmark icon in the view bar opens the bookmarks panel on the right. Its header has a `+` that bookmarks the page on screen (the left page of a spread), labelled `Page 12` after its place in the book. Every bookmark in the book is listed in page order. Click a row to jump to its page, double-click or use the pencil to rename it, and use the hover `[x]` to delete it. A jump in text mode opens the text page holding that notebook page.

Bookmarks are stored where the PDF preview keeps them, in the page file's `<file>.draw` sidecar (page 0 for an image, the PDF page for a PDF). A bookmark added on a PDF page shows in that PDF's preview panel, and one made in the preview shows in the book.

## Highlight a region

The `highlight` button in the view bar arms the highlighter. While it is armed, dragging over a page draws a translucent box in the current colour and releasing saves it, and clicking a box removes it. The button disarms after each box. Right-click it for the colour menu, the same colours and the same current colour as the PDF preview.

A box is stored where the PDF preview stores highlights for that file: inside a PDF as a standard highlight annotation, in the sidecar for an image or for a PDF that cannot be rewritten. Boxes made in the preview show in the book. On a Mac the transcript lines under a new box also gain `==marks==` in the page's companion note; elsewhere only the box saves.

Mod+Z and Mod+Shift+Z (the `ink-undo` and `ink-redo` keybindings) undo and redo bookmark and box edits for the pages on screen, last edit first.

## Failure modes

- If the `page` column names a note, a missing property or an empty cell, the row is skipped without an error and the book is shorter than the row count.
- If `bookLayout` is misspelled, the view uses `spread`.
- If a page file is missing, its page shows `missing: <file name>` on blank paper and the book still turns.
- If a page's wikilink names a file without its folder (`[[a.jpg]]` for `scans/a.jpg`), the page shows as missing.

## How it works

`bookPageRefs` in `core/src/bases/bookPages.ts` reads each row's page column with `resolveProperty` and keeps the rows whose value is an image or PDF path (`isImagePath`, `isPdfPath`), falling back to `binaryForCompanion` on the row's own path. `expandLeaves` turns those refs into one leaf per image and per PDF page, given each PDF's page count. `spreadFor` maps a leaf to the pair shown with it, and `stepSpread` returns the first leaf of the next or previous spread. All four are pure, so the app and the server share them.

`normalizeView` in `core/src/bases/parse.ts` reads `page`, `bookLayout` and `bookMode`; `BASE_VIEW_KINDS` in `app/src/baseViews.ts` lists the kind in the New Base menu, and `baseTemplate('book')` writes no `source:`.

In the app, `BookView` (`app/src/bases/BookView.tsx`) reads either a base's rows or, given `files`, page files on their own; `ReadModeSwitch` is the `scroll | pages | text` switch, and `BookScroll` draws the column from the same faces as the turns. `PreviewView` (`app/src/PreviewView.tsx`) mounts `BookView` over the open file for `pages` and `text`, swaps its `PreviewBar` for the book's bar slots, and keeps the viewer mounted out of sight; `previewViewMemory.ts` remembers the mode per file. `BookView` lays out the spread with the pure helpers in `app/src/bases/bookNav.ts`, rasterises pages through `app/src/bases/bookFaces.ts` (images by asset URL, PDF pages through pdf.js, with at most twelve faces kept: the spread on screen, one either side and a burst of waiting turns ahead), and draws a turn with `PageTurnLayer`, a WebGL page mesh bent by `app/src/bases/pageCurl.ts`; turns that wait behind the running one start on the same layer through its `turnKey`, so a burst keeps one WebGL context. text mode paginates with `bookText.ts` (markdown, formula boxes, the text scale), measures and draws formulas through `bookMath.ts` (KaTeX markup rendered once a formula, measured in one layout pass at a reference size and scaled to the text size, and drawn for the curl one formula per idle callback; the spreads either side load in idle time too, so a turn never waits behind them), draws still pages with `TextSpread` and curl faces with `bookTextRaster.ts`, asks about math pages with `MathPrompt`, and maps a selection back to notebook pages with `bookSelection.ts`; `bookIntake.ts` copies dropped files and writes rows, `BookPageEditor` is the page sorter (its base row writes planned by `bookRowPlan.ts`; a lone PDF saves through `api.pdfPages`, after which every cached face, document and annotation store of the file is dropped and read again through `retireAnnotationStore`), `TranscriptEditor` edits one page's transcript through `api.setTranscriptPage`, `darkPage.ts` turns faces and text colours dark with the same transform as the PDF viewer's CSS filter, the page's right-click rows reach the pane menu through `app/src/paneMenuExtras.ts`, and `transcribeQueue.ts` sends one transcription request at a time and passes no engine for automatic and button runs. `BaseView` mounts the view with the base's sorted rows.

Annotations go through the same store the PDF preview uses: `acquireAnnotationStore` in `app/src/preview/sharedAnnotationStore.ts` keeps one store per image or PDF however many views hold it, so a book and a preview of the same file edit one document. `createPageStores` in `app/src/bases/bookPageStores.ts` leases a store for each page file on screen and releases it when its page is turned away from (the last release flushes), a bookmark edit on a page off screen leases that file's store just for the edit, and `readSidecars` reads every page file's sidecar once, in parallel, for the bookmark list. `bookBookmarks` in `core/src/bases/bookBookmarks.ts` maps those sidecars to leaves. `BookHighlightLayer` draws and edits the boxes in the 816x1056 logical page space of `core/src/drawing/pageInk.ts`, `BookBookmarksPanel` and the PDF preview's panel both show `BookmarkList` (`app/src/preview/BookmarkList.tsx`), and the transcript marks come from `api.bookLines` and `linesInRegion`.

Source: `app/src/bases/BookPageEditor.tsx`, `app/src/bases/bookRowPlan.ts`, `app/src/bases/TranscriptEditor.tsx`, `app/src/bases/darkPage.ts`, `app/src/paneMenuExtras.ts`, `core/src/bases/bookPages.ts`, `core/src/bases/parse.ts`, `core/src/bases/types.ts`, `app/src/baseViews.ts`, `app/src/bases/BookView.tsx`, `app/src/bases/BookScroll.tsx`, `app/src/bases/ReadModeSwitch.tsx`, `app/src/PreviewView.tsx`, `app/src/preview/previewViewMemory.ts`, `app/src/bases/bookMath.ts`, `app/src/bases/MathPrompt.tsx`, `app/src/bases/bookNav.ts`, `app/src/bases/bookFaces.ts`, `app/src/bases/PageTurnLayer.tsx`, `app/src/bases/pageCurl.ts`, `app/src/bases/bookIntake.ts`, `app/src/bases/transcribeQueue.ts`, `app/src/bases/bookPageStores.ts`, `app/src/bases/BookHighlightLayer.tsx`, `app/src/bases/BookBookmarksPanel.tsx`, `core/src/bases/bookBookmarks.ts`, `app/src/preview/sharedAnnotationStore.ts`, `app/src/bases/TextSpread.tsx`, `app/src/bases/bookText.ts`, `app/src/bases/bookTextRaster.ts`, `app/src/bases/bookSelection.ts`, `app/src/bases/bookRegion.ts`
