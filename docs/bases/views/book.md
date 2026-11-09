# Book view

A book view turns the pages of a scanned notebook, a photo album or a stack of PDFs: each row of the base names one page file, and the view shows them as pages (`pages`), as editable transcriptions (`text`), or with each page's picture beside its transcription (`side`), either in one long column (`scroll`) or a page at a time (`flip`). The same reader opens any single image or PDF; see [read one image or PDF as a book](#read-one-image-or-pdf-as-a-book).

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
| `bookMode` | string | `pages`, `text`, `side`, `scroll` | `pages` | The pages, their transcriptions as editable text, or each page beside its text; `scroll` is `pages` with `bookFlow: scroll` |
| `bookFlow` | string | `scroll`, `flip` | `flip` for `pages`, `scroll` for `scroll`, `text` and `side` | One long column, or a page at a time (`pages` turn as a book) |
| `bookDark` | boolean | `true`, `false` | `appearance.pdfDarkMode` | Draws the pages dark, as the PDF viewer's dark mode does |

An invalid `bookLayout` reads as `spread`, an invalid `bookMode` reads as `pages`, an invalid `bookFlow` reads as its default, and a `bookDark` that is not `true` or `false` is ignored.

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

Pages sit straight on the pane's background, the way a reading app shows them: no page edges, no spine line and no shadows, so the margins inside each page are the only gutter. In `pages` mode the pages on screen set the size: the wider of the two pages shown, kept between 1:2 and 1.6:1, so each page fills its half of the pane and neither is cut; a spread of portrait pages fills the height even when the book opens with a wide photo. The narrower page of a mixed spread sits against the spine with the background around it (centred in `single` layout). The spread scales to fit the pane's height or width, whichever runs out first.

The page number sits centred under the book in `pages` mode: `2–3 of 8` on a two-page spread, `1 of 8` for a page on its own.

Two pages need at least 280 px each, so a narrower pane shows one page whatever `bookLayout` says.

The sliders button at the end of the view bar opens the display panel. Its `layout` row picks `auto`, two pages when the pane fits them, or `single`, one page at a time. `single` is saved as `bookLayout: single`; `auto` removes the key. Its `text size` row sets the type size of `text` and `side`.

## Turn the page

In `pages` mode, turn a page by key, click or drag:

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

A page's text is its transcription. With `transcription.auto` on, the default, opening a book reads every page that has no text, and so does adding pages; a failure there is silent and the page keeps its `[ transcribe ]` cell. With `transcription.auto` off, nothing runs until a button below is clicked.

A transcript lives in the page file's companion note (`<file>.<ext>.md`), between markers, so keyword search and semantic search find it. The companion note is described in [companion notes](../../vault/frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs); engines, options and the `bismuth transcribe` command are in [Transcribe pages and handwritten scans](../../vault/transcription.md).

While some pages have no text and nothing is running, the first action in the view bar is a `transcribe 3 pages` button (`transcribe 1 page` for one page). Clicking it starts the run and the button goes; it returns when pages are left without text. Both the automatic run and the button use the engine in `transcription.engine`.

### Progress and cancel

While a run goes, the view bar's readout reads `p. 3 / 12 // transcribing 4 of 12 // about 2 min left`, with `[ cancel ]` after it. Both counts are pages of the same book. Before the first page finishes the estimate is absent, and under a minute reads `under a minute left`. `[ cancel ]` stops the run at once and shows the toast `stopped transcribing <file name>`; pages already read keep their text, the rest return to `not transcribed`.

Each page's divider shows its own status at the right end:

| Status | Shows |
|---|---|
| read | the reader that produced the text: `on-device`, `math reader` or `ai` |
| waiting | `queued` |
| being read | `reading // math reader` (the reader at work) |
| failed | `failed // <reason>` in red, then `[ retry ]` |
| no text, no run | `not transcribed`, then `[ transcribe ]` |

A page that is waiting or being read shows `no text yet` where its text will appear, and the text arrives in place without moving the scroll.

### Math

A run that finds pages that look like math, with `transcription.math` at `ask` (the default), keeps their fast on-device text and asks as soon as the first one is found, while the other pages keep reading. The dialog is titled `this page has math` (or `3 pages have math`, the count growing as the run finds more) and says that reading math properly takes about 15 s a page. `[ read it properly ]` re-reads those pages with the math reader, or an ai backend where it is missing; `[ go fast ]`, `[x]` or Escape keeps the text there. The choice covers the whole run, including math pages found later. Opening a book also looks at pages the on-device reader transcribed earlier: once a session, those whose stored text looks like math join the same prompt (with `transcription.math` at `careful` they are re-read without asking, and at `fast` they are left). With `don't ask again` ticked, the choice is saved as `transcription.math` (`careful` or `fast`). When the math reader is not installed yet, the dialog adds that it downloads itself the first time (about 1.2 GB), and `[ read it properly ]` installs it first while the readout ends with `// setting up the math reader`; see [Install Marker](../../vault/transcription.md#install-marker).

### The page menu

Right-click a page in `pages` mode, a section in `text` or `side` mode, or a picture in `side` mode, for the page's menu: `read again on-device`, `read again with the math reader` and `read again with ai` read only that page again with that reader, replacing its text and showing its status in the divider. The pane's own rows (split, close) follow below them in the same menu. A failed run shows a toast with the server's message.

## Fix a page's text

In `text` and `side` mode every section is an editable field. Click to put the caret there and type, and undo and redo with Mod+Z and Mod+Shift+Z; the text is written into the page file's companion note in place of that page's transcript a moment after typing stops, and only that page is written. Clearing every word removes the page's text, so the page shows as not transcribed. `bismuth transcript set` does the same from a shell; see [Transcribe pages and handwritten scans](../../vault/transcription.md).

## Text mode

The sliders button in the view bar opens the display panel. Its `show` row picks what shows: a page (`pages`), a page of text (`text`) or two columns (`side by side`). The panel is away while the page sorter is open. How it moves is the panel's `move by` row: `scroll` (one long column) or `flip` (a page at a time). `text` with `scroll` shows the transcriptions as one scrolling column on the pane's own background, at the width of a note and centred. Each page is a section that starts with a divider row: `page 3` at the left in muted text (`<file name> // page 3` in a book spanning several files), the page's status at the right, and a rule under the row. A lone image has no divider. The text below renders like a note: headings, lists, tables, `$math$` and `$$math$$` typeset, and `==marks==` tinted.

The type is the prose font (`appearance.proseFont`, the font notes are set in), sized by the `text size` row of the display panel, which is `− 100% +` (the same steps as a PDF's zoom) and is saved as `reader.textScale` for every book. A resize keeps the first words on screen where they were. `text` and `side by side` are disabled, with the tooltip `no page is transcribed yet`, while no page has text and nothing is transcribing; a single image or PDF opened on its own can always pick them. The choices are saved as `bookMode` and `bookFlow`. A book opens on the page it was left on, and how far into that page's text, across restarts.

When a page's text changes from outside while the book is open, by an agent or another window, the page shows the change. A page with typing not yet saved keeps the typing. A line typed as `### Page 3` stays ordinary text on its page; the companion note stores it with a backslash in front.

`text` with `flip` shows one page's section at a time, with `‹ p. 3 / 12 ›` under it; the arrows and the page-turn keys go to the page before or after, the text curling over as a book's page does. In `scroll`, the page-turn keys scroll the column to the page before or after.

Switching what shows, or between `scroll` and `flip`, keeps the page you were reading: `text` and `side by side` open on the page the book was on, and `pages` opens on the page at the top of the text. The flow stays as it was when you pick what shows, so a book that flips its pages flips its text too.

## Side by side

`side by side` shows each page's picture on the left, about half the pane, and that page's section on the right with the tops aligned, in one scroller: scrolling anywhere scrolls both. Below 720 px of pane width the picture keeps its place beside the text, at about two fifths of the row. The readout follows the row at the top (`p. 4 / 12`), and the page-turn keys scroll to the page before or after. With `flip` it shows one page and its text at a time, the picture and the text set as an open book: the picture against the spine, and one leaf turning over it, the next page's picture on its back, turned by the arrows under it or the page-turn keys: the picture fits the pane and stays in view, and the text scrolls on its own beside it.

Selecting text in a section draws boxes over the matching lines on that page's picture, and clears them when the selection empties. Clicking a line on the picture puts the caret at the start of that line's text and tints it for about a second. In `text` mode, right-click with a selection and choose `show on page` (the first row of the menu) to open side by side at that page with the boxes drawn. Line boxes come from on-device recognition; where it is unavailable no boxes are drawn.

## Highlight words

In `text` and `side by side` mode, select words in a section and press the `highlight` button to wrap them in `==…==`; with the selection inside a mark, the button unwraps it, and with nothing selected it does nothing. A mark is tinted, and its `==` delimiters show only while the caret touches it. A selection lies inside one section, so it marks one page. The mark is saved in that page's transcript in its companion note, so search sees it.

## Dark pages

The moon icon (`dark pages`) in the view bar draws every page dark: white paper turns near-black and dark ink near-white, while colours keep their hue, as the PDF viewer's dark mode draws a PDF. On a PDF page, photos keep their own colours, the same photos the PDF viewer keeps. It applies to scans and PDF pages in `scroll` and `pages` mode and to the pictures in `side by side`; the text keeps the theme's colours. In a book base the choice is saved as `bookDark`; with no `bookDark` key the book follows `appearance.pdfDarkMode`. On a single image or PDF it is the same per-file flag as the PDF viewer's moon, so the viewer and the book agree.

## Scroll

`pages` with `scroll` shows every page in one column at the pane's width, up to 760 px, top to bottom, each page at its own shape. Pages draw as they come near the view, so a long book costs only what is on screen. The readout names the page at the top of the view (`p. 3 / 10`), the page-turn keys do nothing, and switching to `flip` opens the spread holding that page. The choice is saved as `bookFlow: scroll`.

## Read one image or PDF as a book

An image or PDF opened in its own tab has the same sliders button, and its panel has the same `show` and `move by` rows:

- `pages` with `scroll` is the file's viewer, with zoom, find, the draw and highlight tools and scratch paper.
- `pages` with `flip`, `text` and `side by side` open the book reader over that one file, with this page's bar: page turns, text mode and its display panel, highlights and bookmarks. A PDF is one page per PDF page; an image is one page. There is no `+` to add pages.

Switching between the viewer and the book lands where you were reading: the book opens on the page the viewer shows (`text` and `side by side` at about the same point in that page), and the viewer returns to the page the book was on, scrolled about as far into it. `text` is available for a file on its own before it has any text: its pages show as not transcribed yet while transcription runs (with `transcription.auto` on). Both picks and a `single` layout are remembered per file on this device; a file opens as `pages` with `scroll` until you pick otherwise.


## Bookmarks

The bookmark icon in the view bar opens the bookmarks panel on the right. Its header has a `+` that bookmarks the page on screen (in `pages` mode, the left page of a spread), labelled `Page 12` after its place in the book. Every bookmark in the book is listed in page order. Click a row to jump to its page, double-click or use the pencil to rename it, and use the hover `[x]` to delete it. A jump in `text` or `side by side` mode scrolls to that page's section.

Bookmarks are stored where the PDF preview keeps them, in the page file's `<file>.draw` sidecar (page 0 for an image, the PDF page for a PDF). A bookmark added on a PDF page shows in that PDF's preview panel, and one made in the preview shows in the book.

## Highlight a region

In `pages` mode, the `highlight` button in the view bar arms the highlighter. While it is armed, dragging over a page draws a translucent box in the current colour and releasing saves it, and clicking a box removes it. The button disarms after each box. Without arming, the pointer turns into an X over a box: click to remove it, and press `undo` on the toast to put it back. A drag that starts on a box still turns the page. Right-click it for the colour menu, the same colours and the same current colour as the PDF preview.

A box is stored where the PDF preview stores highlights for that file: inside a PDF as a standard highlight annotation, in the sidecar for an image or for a PDF that cannot be rewritten. Boxes made in the preview show in the book. On a Mac the transcript lines under a new box also gain `==marks==` in the page's companion note; elsewhere only the box saves.

Mod+Z and Mod+Shift+Z (the `ink-undo` and `ink-redo` keybindings) undo and redo bookmark and box edits for the pages on screen, last edit first. Inside a transcript section they undo and redo the typing instead.

## Failure modes

- If the `page` column names a note, a missing property or an empty cell, the row is skipped without an error and the book is shorter than the row count.
- If `bookLayout` is misspelled, the view uses `spread`.
- If a page file is missing, its page shows `missing: <file name>` on blank paper and the book still turns.
- If a page's wikilink names a file without its folder (`[[a.jpg]]` for `scans/a.jpg`), the page shows as missing.

## How it works

`bookPageRefs` in `core/src/bases/bookPages.ts` reads each row's page column with `resolveProperty` and keeps the rows whose value is an image or PDF path (`isImagePath`, `isPdfPath`), falling back to `binaryForCompanion` on the row's own path. `expandLeaves` turns those refs into one leaf per image and per PDF page, given each PDF's page count. `spreadFor` maps a leaf to the pair shown with it, and `stepSpread` returns the first leaf of the next or previous spread. All four are pure, so the app and the server share them.

`normalizeView` in `core/src/bases/parse.ts` reads `page`, `bookLayout`, `bookMode` and `bookFlow`; `BASE_VIEW_KINDS` in `app/src/baseViews.ts` lists the kind in the New Base menu, and `baseTemplate('book')` writes no `source:`.

In the app, `BookView` (`app/src/bases/BookView.tsx`) reads either a base's rows or, given `files`, page files on their own; `ReadModeSwitch` is the `show` row, `FlowToggle` the `move by` row, `FlipNav` the arrows under a flipped page, and `BookScroll` draws the column from the same faces as the turns. `PreviewView` (`app/src/PreviewView.tsx`) mounts `BookView` over the open file for everything but `pages` with `scroll`, swaps its `PreviewBar` for the book's bar slots, and keeps the viewer mounted out of sight; `previewViewMemory.ts` remembers both picks per file. `BookView` lays out the spread with the pure helpers in `app/src/bases/bookNav.ts`, rasterises pages through `app/src/bases/bookFaces.ts` (images by asset URL, PDF pages through pdf.js, with at most twelve faces kept: the spread on screen, one either side and a burst of waiting turns ahead), and draws a turn with `PageTurnLayer`, a WebGL page mesh bent by `app/src/bases/pageCurl.ts`; turns that wait behind the running one start on the same layer through its `turnKey`, so a burst keeps one WebGL context. `text` mounts `TranscriptDoc` (one `TranscriptSection` per page, only the sections near the view mounted) and `side` mounts `SideBySide`, whose rows pair a `BookPageImage` (with a `LocateLayer` for boxes and clicks, lines from `transcriptLocate.ts`) with the same `TranscriptSection`; `PageStatus` draws each divider's status; a `==mark==` is toggled by `transcriptMarks.ts`; `transcription.ts` polls the server's per-file job (`/transcribe/job`) for progress, cancel and the mid-run math question, and `MathPrompt` asks it; `bookIntake.ts` copies dropped files and writes rows, `BookPageEditor` is the page sorter (its base row writes planned by `bookRowPlan.ts`; a lone PDF saves through `api.pdfPages`, after which every cached face, document and annotation store of the file is dropped and read again through `retireAnnotationStore`), each section saves through `api.setTranscriptPage`, `darkPage.ts` turns faces and text colours dark with the same transform as the PDF viewer's CSS filter, the page's right-click rows reach the pane menu through `app/src/paneMenuExtras.ts`. `bookFaces.ts` marks a PDF face's photos through `app/src/preview/pdfDarkImages.ts` so a dark face draws them back as printed. `BaseView` mounts the view with the base's sorted rows.

Annotations go through the same store the PDF preview uses: `acquireAnnotationStore` in `app/src/preview/sharedAnnotationStore.ts` keeps one store per image or PDF however many views hold it, so a book and a preview of the same file edit one document. `createPageStores` in `app/src/bases/bookPageStores.ts` leases a store for each page file on screen and releases it when its page is turned away from (the last release flushes), a bookmark edit on a page off screen leases that file's store just for the edit, and `readSidecars` reads every page file's sidecar once, in parallel, for the bookmark list. `bookBookmarks` in `core/src/bases/bookBookmarks.ts` maps those sidecars to leaves. `BookHighlightLayer` draws and edits the boxes in the 816x1056 logical page space of `core/src/drawing/pageInk.ts`, and while unarmed follows the pointer on the window to show the X cursor over a box and remove the box a click lands on, using the click rule in `app/src/preview/highlightClick.ts`; `BookBookmarksPanel` and the PDF preview's panel both show `BookmarkList` (`app/src/preview/BookmarkList.tsx`), and the transcript marks come from `api.bookLines` and `linesInRegion`.

Source: `app/src/bases/BookPageEditor.tsx`, `app/src/bases/bookRowPlan.ts`, `app/src/bases/darkPage.ts`, `app/src/paneMenuExtras.ts`, `core/src/bases/bookPages.ts`, `core/src/bases/parse.ts`, `core/src/bases/types.ts`, `app/src/baseViews.ts`, `app/src/bases/BookView.tsx`, `app/src/bases/BookScroll.tsx`, `app/src/bases/ReadModeSwitch.tsx`, `app/src/PreviewView.tsx`, `app/src/preview/previewViewMemory.ts`, `app/src/bases/MathPrompt.tsx`, `app/src/bases/TranscriptDoc.tsx`, `app/src/bases/TranscriptSection.tsx`, `app/src/bases/TranscriptPage.tsx`, `app/src/bases/SideBySide.tsx`, `app/src/bases/BookPageImage.tsx`, `app/src/bases/LocateLayer.tsx`, `app/src/bases/PageStatus.tsx`, `app/src/bases/transcription.ts`, `app/src/bases/transcriptLocate.ts`, `app/src/bases/transcriptMarks.ts`, `app/src/bases/bookNav.ts`, `app/src/bases/bookFaces.ts`, `app/src/bases/PageTurnLayer.tsx`, `app/src/bases/pageCurl.ts`, `app/src/bases/bookIntake.ts`, `app/src/bases/bookPageStores.ts`, `app/src/bases/BookHighlightLayer.tsx`, `app/src/bases/BookBookmarksPanel.tsx`, `core/src/bases/bookBookmarks.ts`, `app/src/preview/sharedAnnotationStore.ts`, `app/src/bases/bookRegion.ts`, `app/src/preview/highlightClick.ts`, `app/src/preview/pdfDarkImages.ts`
