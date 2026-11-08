# book

A page-turning view over a base's rows: each row names one image or PDF page file. Read this before writing a base with `view: book`.

## Working example

A book base is a `.base.jsonl` file. Line 1 is the config; each later line is one page. Leave `source:` out so the base owns its rows.

```json
{"type":"base","view":"book","bookLayout":"spread"}
{"page":"[[scans/notebook-01.jpg]]"}
{"page":"[[scans/notebook-02.jpg]]"}
{"page":"![[scans/appendix.pdf]]"}
```

Add a page with `bismuth row add Notebook --json '{"page":"[[scans/notebook-03.jpg]]"}'`. Validate with `bismuth base validate Notebook.base.jsonl`.

Transcribe a page with `bismuth transcribe scans/notebook-01.jpg --book Notebook`, or list the base's pages with `bismuth book pages Notebook`. Transcripts are written into each page file's companion note and appear in the view's text panel. Engines and options are in [Transcribe pages and handwritten scans](../../vault/transcription.md).

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `view` | `string` | `table` | Must be `book`. |
| `page` | `string` | `"page"` | Column holding each row's image or PDF: a vault path, `[[wikilink]]` or `![[embed]]`. `note.scan` names a column called `scan`. |
| `bookLayout` | `string` | `"spread"` | `spread` (two pages when the pane fits them) or `single` (always one page). Any other value reads as `spread`. |
| `bookMode` | `string` | `"pages"` | `pages`, `text` or `side` (each page beside its text); `scroll` reads as `pages` with `bookFlow: scroll`. Any other value reads as `pages`. |
| `bookFlow` | `string` | `"flip"` for `pages`, `"scroll"` otherwise | `scroll` (one long column) or `flip` (a page at a time). Any other value reads as the default. |
| `bookDark` | `boolean` | `appearance.pdfDarkMode` | `true` draws the pages dark, as the PDF viewer's dark mode does. Any other value is ignored. |

## Failure modes

- If a row's `page` value is a note, empty or misspelled as another column, the row is skipped silently and the book has fewer pages than the file has rows. Check which rows became pages with `bismuth book pages <path>`; a row missing from its output was skipped.
- If the base sets `source:`, the rows come from that source instead of the base file's own rows. Delete the key with `bismuth prop delete <path> source`.
- A PDF row is one page per PDF page, so the book can be longer than the row count.

Full reference: [docs/bases/views/book.md](../views/book.md)
