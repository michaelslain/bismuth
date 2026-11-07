# Rewrite a PDF's pages

A PDF's pages can be kept, moved, deleted and added to: the file is rewritten to hold exactly the pages you list, in that order, and what hangs on a page (its highlights, ink, bookmarks and transcript) moves with it. Use it to reorder a scan, drop a bad page, or append photographed pages to a PDF that sits in a [book view](../bases/views/book.md).

```bash
bismuth pdf pages scans/notes.pdf --order 1,3,2,blank,@scans/page4.png --vault ~/vault
```

```json
{"pages":5}
```

That keeps page 1, then page 3, then page 2 of `notes.pdf`, then an empty page, then the image `scans/page4.png` as the last page. A page left out of the list is deleted. `bismuth pdf pages scans/notes.pdf` with no `--order` prints the page count and changes nothing.

## Write the order

`--order` takes comma-separated items, in the order the new PDF holds them.

| Item | Page it adds |
|---|---|
| `3` | page 3 of this PDF |
| `2-5` | pages 2 to 5 of this PDF; `5-2` runs them backwards |
| `blank` | an empty page |
| `@scans/a.png` | the image, as one page |
| `@other.pdf` | every page of another PDF in the vault |
| `@other.pdf#4` | page 4 of that PDF; `#2-4` takes a range |

A page number can appear twice; the second copy carries its own copy of the page's highlights, ink and text. A path with a comma in it cannot be named.

## What an added page looks like

An image becomes a page as wide as the page before it in the new order (the first page, when it comes first), as tall as the image's shape needs, with the image filling it. An empty page has the size of the page before it. JPEG and PNG images are added as they are, and a HEIC photo is converted to JPEG first on the desktop. Any other image type is refused with `415 only jpeg and png images can be added to a pdf`; the iPad also refuses HEIC.

## What follows a page

| Kept with its page | Where it lives |
|---|---|
| Highlights | annotations inside the PDF |
| Ink and bookmarks | the PDF's `.draw` sidecar |
| Transcript text, `==marks==` included | the `<file>.pdf.md` companion note, renumbered to the page's new number |

A deleted page takes its ink, bookmarks and transcript with it. A new page starts empty and has no text, so a book view transcribes it on its own. The sidecar's `margin`, `dark` and `paper` and the companion's frontmatter, tags and your own text stay as they were. A PDF with no sidecar or no companion gets none written.

The document outline and form fields stay behind, because the new file is built from the copied pages. The title, author, subject and keywords carry over.

## Failure modes

- If the order is empty or keeps no page, the call fails with `400 a pdf needs at least one page`.
- If a page number is outside the PDF, or outside another PDF named in the order, the call fails with `400` naming the count, and nothing is written.
- If the PDF is encrypted or signed, the call fails with `409 PDF_NOT_WRITABLE` and nothing is written, because a rewrite would drop the encryption or break the signature.
- If the sidecar cannot be read, the call fails with `409` before the PDF is touched, so ink never points at the wrong pages.
- If an order lists a file that does not exist, the call fails with `404`; a file that is neither an image nor a PDF fails with `415`.
- If the order keeps every page where it is, nothing is written.
- An agent whose visibility settings hide the PDF, its companion, its sidecar or a file in the order reads the PDF as missing (`403 forbidden` over HTTP). See [visibility](visibility.md).

## Verify

```bash
bismuth pdf pages scans/notes.pdf
```

The printed `{"pages":N}` is the count after the rewrite.

## How it works

`rewritePdfPages` in `core/src/pdfPages.ts` resolves each order entry to a copied page, an image or a blank, builds a new pdf-lib document, and writes the PDF, then the sidecar, then the companion, marking each path as self-written first. It checks `readPdfHighlights` before anything else, so a PDF the highlight code cannot rewrite is refused the same way. Pages are copied with `copyPages`, one call per source PDF, which keeps their annotations and shares fonts and images between them. `remapDrawingDoc` there moves a sidecar's pages and bookmarks through the page map, and `remapTranscriptPages` in `core/src/transcript.ts` renumbers the transcript block.

The route is `POST /pdf/pages` in `core/src/routes/transcribe.ts` ([HTTP reference](../api/http-reference.md)), also answered by the iPad's in-process backend in `core/src/localBackend.ts`. The command grammar is in `cli/src/pageOrder.ts` and the command in `cli/src/commands/pdf.ts` ([CLI reference](../cli/reference.md#pdf)).

Source: `core/src/pdfPages.ts`, `core/src/transcript.ts`, `core/src/routes/transcribe.ts`, `core/src/localBackend.ts`, `cli/src/pageOrder.ts`, `cli/src/commands/pdf.ts`
