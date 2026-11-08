# OCR for PDFs

OCR gives a scanned PDF an invisible text layer, so its text selects and highlights in the PDF viewer. Run `bismuth ocr`; install the engine first (see the section on installing it). To read a page's words into a note, including handwriting and math, use [Transcribe pages and handwritten scans](transcription.md).

```bash
bismuth ocr "readings/week 8 reading 2.pdf" --vault ~/vault --pretty
```

```json
{
  "ok": true,
  "path": "readings/week 8 reading 2.pdf",
  "layer": { "bytesBefore": 103839, "bytesAfter": 111288, "wordsBefore": 8, "wordsAfter": 77 }
}
```

## Install the OCR engine

`bismuth ocr` drives programs installed on the machine, and fails with the install command when one is missing.

| Engine | Needed for | Install |
|---|---|---|
| `ocrmypdf` (with `tesseract`) | the PDF text layer | `brew install ocrmypdf` |
| `pdftotext` (optional) | the word counts in the result | `brew install poppler` |

The command finds the engines on `PATH` and also in `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`, so an agent or daemon session with a short `PATH` still reaches them.

## Make a scanned PDF's text selectable

`bismuth ocr <file.pdf>` adds a text layer to the PDF and replaces the file in place. Pages that already carry real text keep it, and every other part of the page is read with tesseract, so the PDF keeps roughly its original size. The added text selects and highlights like any other. A tab that already shows the PDF keeps its old copy, with no text layer, until you close and reopen it.

A page whose only real text is a publisher watermark (a "Downloaded from …" line up the margin) still gets its body read. `wordsBefore` and `wordsAfter` in the result show whether OCR found the body: a jump from a handful of words to hundreds means it did.

`--force` reads every page from scratch, even where text exists. Use it for a PDF whose existing text layer is wrong (copied text comes out as garbage). It re-encodes every page as an image, so the file grows several times larger.

## Read an image or a page into a note

`bismuth ocr` works on a PDF only. A path that is not a PDF is refused with `ocr adds a text layer to a PDF; to read an image into its note, run: bismuth transcribe <file>`. To get a PDF's or an image's words into its companion note, run [`bismuth transcribe`](transcription.md).

## Options

| Flag | Effect |
|---|---|
| `--force` | OCR every page even where text exists; the PDF grows |
| `--lang <codes>` | Tesseract languages, `eng` by default, several joined with `+` (`eng+deu`) |
| `--pages <spec>` | 1-based pages, such as `3`, `1-4` or `1-3,7`. Page 0 and backwards ranges are refused |

The path is vault-relative. A path outside the vault fails with `path escapes vault`, and a missing file with `ocr: no such file`. To OCR a download, move it into the vault first.

## Run OCR as an agent

An agent runs `bismuth ocr <path>` in its shell with the flags listed in the options table. A host with no shell calls the `bismuth_cli` MCP tool with the same arguments, such as `["ocr", "papers/scan.pdf", "--math"]`; `bismuth_cli` gives `ocr` and `pdf` commands 30 minutes and every other command 2 minutes, because a long PDF takes minutes.

In either route the command finds the vault from the session's working directory when no `--vault` or `BISMUTH_VAULT` is given, and fails with `no vault` outside one.

`ocr` is path-scoped under the vault's visibility settings: an agent can OCR any file it can see, and a hidden file is refused like any other read. See [visibility](visibility.md).

## How it works

`cli/src/commands/ocr.ts` is the command; `cli/src/ocr.ts` holds the pure argv builders, and `core/src/marker.ts` holds the engine lookup and page parsing, shared with [transcription](transcription.md); both are unit-tested in `cli/test/ocr.test.ts` against a fixture scan with a watermark.

The text layer comes from `ocrmypdf --redo-ocr --output-type pdf`. `--redo-ocr` keeps visible vector text and OCRs the rest without rasterising the page; `--skip-text` would skip any page with a watermark. `--output-type pdf` skips the PDF/A conversion through Ghostscript. ocrmypdf writes a hidden `.<file>.ocr-tmp.pdf` beside the original, which is renamed over it, so the watcher sees one change and a reader never sees a half-written file.

`bismuth_cli` runs the command with the long timeout `cliTimeoutMs` in `mcp/src/cli.ts`. `ocr` is in `PATH_SCOPED_COMMANDS` in `core/src/visibilityCliGate.ts`.

Source: `cli/src/commands/ocr.ts`, `cli/src/ocr.ts`, `core/src/marker.ts`, `mcp/src/cli.ts`, `core/src/visibilityCliGate.ts`
