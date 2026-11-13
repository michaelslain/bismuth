# Merge a newer version of a PDF

A merge brings a newer copy of a PDF into the one in your vault. Every page takes the newer copy's picture, new pages are added where the newer copy has them, and each page you already had keeps your highlights, ink and bookmarks. A page with nothing new written on it keeps its transcript too. Use it when a notebook you scan grows and the scanner exports the whole notebook again, or when lecture slides you annotated come out again with more pages.

```bash
bismuth pdf merge "self/notebook.pdf" "incoming/notebook v2.pdf" --vault ~/vault
```

```json
{"steps":[{"kind":"keep","page":0,"from":0},{"kind":"keep","page":1,"from":1},{"kind":"update","page":2,"from":2},{"kind":"add","from":3}],"pages":4,"kept":2,"updated":1,"added":1,"only":0}
```

Without `--write` the command prints the plan and changes nothing. With `--write` it writes the plan into `self/notebook.pdf`.

## Merge from the page sorter

In the app, open the PDF on its own, switch to the book reader, and open the page sorter (`edit pages`). Then:

1. Press `merge a new version` and pick the newer PDF. The sorter lays out the merged pages. Nothing is written yet.
2. Read the head line, such as `merging notebook v2.pdf // 1 updated // 2 new`, and the captions under the pages: `6 // updated` marks a page that replaces the old one, and `7 // new` marks a page added from the newer copy.
3. Drag, remove or add pages as in any sorter. If the merge is wrong, press `undo merge`: the pages return to how they were before it, and the sorter stays open.
4. Press `save` to write the merge, or `cancel` to leave the PDF as it was.

`merge a new version` is disabled while the sorter holds changes that are not saved yet. Save or cancel them first. While a merge is laid out, `undo merge` takes its place.

## What happens to each page

Each page of the merged PDF is one of four kinds.

| Kind | Which page | Highlights, ink, bookmarks | Transcript |
|---|---|---|---|
| kept (`keep`) | the newer copy's picture of a page you had, with nothing new written on it | move over from the old page | stays |
| updated (`update`) | the newer copy's picture of a page you had, written on since, or the page in its place | move over from the old page | dropped, so the page is read again |
| new (`add`) | a page only the newer copy has, where the newer copy has it | none | none |
| only here (`only`) | a page only the vault's copy has, after the page it followed | stay | stays |

A merge never deletes a page: a page the newer copy lacks stays where it was. The merged pages follow the newer copy's order. With `transcription.auto` on, opening the book reads the updated and new pages. A highlight moved onto a newer picture keeps its place on the page, even when the newer page is a different size, so on a page framed differently it can sit a little off its words.

## How pages are matched

Pages are compared by their ink: how much darker than the paper each part of the page is. A page scanned again, cropped or framed differently, greyer or cleaned up, still matches its old scan, because the newer page is moved and scaled onto the old one before they are compared. The pages that match line up in order, the order with the most likeness winning, so a sparse page that looks like a later one does not pull the pages apart. Between two matched pages, the leftover old and new pages pair up by position as updates, counted from the matched page before them; extra new pages are added there, and extra old pages stay. Before the first matched page, the leftovers count back from it instead: a newer copy that starts a few pages into the notebook pairs its first page with the old page just before the match, and the old pages ahead of it stay. With no page in common, the two copies are one gap, so every page pairs by order from page 1.

A matched page counts as written on when, once lined up, it has a patch of ink the old page has nowhere near: a line written under the last one, a note in the margin. A word crossed out adds ink on top of old ink and may not count, so its transcript stays as it was.

Highlights and other annotations are left out when pages are compared, so a page you highlighted still matches its unmarked copy.

## Failure modes

- If the two PDFs share no unchanged page (every page photographed again), every page pairs by order: page 1 with page 1, and so on, with extra new pages added at the end. The head reads `no page matched, paired by order`. A page inserted in the middle then shifts every pairing after it, so check the pages before you save, or press `undo merge`.
- A page that changed past matching (most of it rewritten) with another page added beside it can be paired with the wrong page by position. The sorter shows it before anything is written: press `undo merge` to leave the pages as they were.
- A page photographed half in shadow can read as written on, so its transcript is dropped and read again.
- If the vault's PDF is encrypted or signed, saving fails with `409 PDF_NOT_WRITABLE` and nothing is written, as for any [page rewrite](pdf-pages.md).
- On the iPad the plan cannot be made: the toast reads `merging a newer version needs the desktop app`.

## Verify

```bash
bismuth pdf merge "self/notebook.pdf" "incoming/notebook v2.pdf" --vault ~/vault
```

After a merge is written, this prints `"kept"` plus `"only"` equal to `"pages"`: every page of the newer copy is now in the vault's PDF, and the pages only the vault's copy had are still there.

## How it works

`planPdfMerge` in `core/src/pdfMerge.ts` draws every page of both PDFs with pdf.js and `@napi-rs/canvas`, without annotations, 200 px wide. pdf.js draws a scanned page's image through scratch canvases from `PdfjsCanvasFactory` (`core/src/drawing/pdfHighlightText.ts`), because its own Node factory `require`s `@napi-rs/canvas` at runtime, which the compiled core in the desktop app cannot resolve; `core/test/pdfMergeCompiled.test.ts` draws a scanned PDF inside a compiled binary. If a page still fails to draw, the plan fails with `400 cannot draw the pdf pages` and core logs the cause under `[pdf merge]`. `pageInk` measures each pixel's darkness against the brightest pixel near it (the paper there) and averages it down to a 40 x 60 map of ink. `pageMatch` in `core/src/pdfMergePlan.ts` searches scales and shifts of the newer page, down to half a cell, for the best correlation with the old page (`same`), then takes the densest 3 x 3 patch of ink the newer page has where the old page, grown by a cell, has none (`added`). `planMerge` lines up the pairs with `same` at least `SAME_MIN` in the order with the most likeness, pairs the rest by position between them (counting back from the first match before it), and keeps a matched page unless its `added` reaches `ADDED_MIN`. `bench/pdfMergeFit.ts` fits both cuts on a scanned notebook, each page scanned again by simulation with and without a line written in, and checks them on a real pair of versions held out of the fit.

The write is `rewritePdfPages` in `core/src/pdfPages.ts` with order entries `{with, marksOf?, textOf?}`, which take pages from the newer PDF given as `with`. `marksOf` names the old page whose ink, bookmarks and highlights the page takes, and `textOf` the old page whose transcript it keeps; without `textOf` the transcript is dropped. `mergeOrder` turns a plan into that order, and `mergePdf` plans and writes in one call.

The routes are `POST /pdf/merge/plan` and `POST /pdf/pages` in `core/src/routes/transcribe.ts` ([HTTP reference](../api/http-reference.md)). The iPad's in-process backend in `core/src/localBackend.ts` writes a merge order but refuses the plan. In the app, `BookView` lays out the plan in `BookPageEditor` and reads the picked file's pages through `holdPdfBytes` in `app/src/bases/bookFaces.ts`. `bench/pdfMergeE2E.ts` drives the whole flow in a headless browser, on real files with `--old` and `--new`.

Source: `core/src/pdfMerge.ts`, `core/src/pdfMergePlan.ts`, `core/src/drawing/pdfHighlightText.ts`, `core/src/pdfPages.ts`, `core/src/routes/transcribe.ts`, `core/src/localBackend.ts`, `cli/src/commands/pdf.ts`, `app/src/bases/BookView.tsx`, `app/src/bases/BookPageEditor.tsx`, `app/src/bases/bookFaces.ts`
