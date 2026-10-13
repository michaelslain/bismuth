# OCR for PDFs and images

OCR reads the words off a scanned PDF or an image. In Bismuth it does two jobs: it gives a PDF an invisible text layer so its text selects and highlights in the PDF viewer, and it transcribes a PDF or image into a markdown note with math written as LaTeX. Install the engines first (see the section on installing them); then a person runs `bismuth ocr` and an agent calls the `ocr` MCP tool.

```bash
bismuth ocr "readings/week 8 reading 2.pdf" --math --vault ~/vault --pretty
```

```json
{
  "ok": true,
  "path": "readings/week 8 reading 2.pdf",
  "note": "readings/week 8 reading 2.ocr.md",
  "engine": "marker",
  "layer": { "bytesBefore": 103839, "bytesAfter": 111288, "wordsBefore": 8, "wordsAfter": 77 }
}
```

## Install the OCR engines

`bismuth ocr` drives programs installed on the machine, and fails with the install command when one is missing.

| Engine | Needed for | Install |
|---|---|---|
| `ocrmypdf` (with `tesseract`) | the PDF text layer, and plain image OCR | `brew install ocrmypdf` |
| `marker_single` (Marker) | `--math` transcriptions | `uv tool install marker-pdf` |
| `llama-server` (llama.cpp) | Marker's models | `brew install llama.cpp` |
| `pdftotext` (optional) | the word counts in the result | `brew install poppler` |

The first `--math` run downloads Marker's models from Hugging Face, which takes several minutes; later runs start in seconds. The command finds the engines on `PATH` and also in `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`, so an agent or daemon session with a short `PATH` still reaches them.

## Make a scanned PDF's text selectable

`bismuth ocr <file.pdf>` adds a text layer to the PDF and replaces the file in place. Pages that already carry real text keep it, and every other part of the page is read with tesseract, so the PDF keeps roughly its original size. The new text selects and highlights like any other. A tab that already shows the PDF keeps its old copy, with no text layer, until you close and reopen it.

A page whose only real text is a publisher watermark (a "Downloaded from …" line up the margin) still gets its body read. `wordsBefore` and `wordsAfter` in the result show whether OCR found the body: a jump from a handful of words to hundreds means it did.

`--force` reads every page from scratch, even where text exists. Use it for a PDF whose existing text layer is wrong (copied text comes out as garbage). It re-encodes every page as an image, so the file grows several times larger.

## Transcribe math to LaTeX

To convert a PDF into a note without touching the PDF, use [Convert a PDF to markdown](pdf-to-markdown.md).

`--math` also writes a transcription beside the file: `paper.pdf` gives `paper.ocr.md`, a visible note whose `source` property links back to the PDF. Marker writes the text as markdown, inline math as `$…$` and display math as `$$…$$`, which the editor renders with KaTeX:

```markdown
---
source: "[[week 8 reading 2.pdf]]"
---

## Gradient descent

The loss is minimised by stepping against the gradient. For a learning rate $\eta > 0$ the update is

$$\theta_{t+1} = \theta_t - \eta \nabla_{\theta} L(\theta_t)$$
```

On a PDF, `--math` adds the text layer too. Figures are left out of the note; they stay in the PDF it links to. If the note already exists, the command refuses with `EEXIST` and changes nothing, so a transcription you edited is never overwritten; `--replace` rewrites it.

## OCR an image

An image (png, jpg, jpeg, tif, tiff, webp, bmp) has no text layer to add, so `bismuth ocr <image>` always writes the `<name>.ocr.md` note. Without `--math`, tesseract writes the plain text; with `--math`, Marker writes markdown with LaTeX. Other image kinds (svg, gif, heic, avif, ico) are refused.

## Options

Every option applies to both the CLI command and the MCP tool.

| Flag | MCP argument | Effect |
|---|---|---|
| `--math` | `math: true` | Also write `<name>.ocr.md` with Marker. Images always get the note |
| `--force` | `force: true` | OCR every page even where text exists; the PDF grows |
| `--lang <codes>` | `lang` | Tesseract languages, `eng` by default, several joined with `+` (`eng+deu`) |
| `--pages <spec>` | `pages` | 1-based pages, such as `3`, `1-4` or `1-3,7`. Page 0 and backwards ranges are refused |
| `--replace` | `replace: true` | Rewrite an existing `<name>.ocr.md` |

The path is vault-relative. A path outside the vault fails with `path escapes vault`, and a missing file with `ocr: no such file`. To OCR a download, move it into the vault first.

## Run OCR as an agent

An agent calls the `ocr` MCP tool with `path` and the arguments listed in the options table. It is its own tool rather than a `bismuth_cli` call because a long PDF takes minutes, and `bismuth_cli` gives up after 30 seconds; `ocr` waits up to 30 minutes. The tool resolves the vault the way `vault_map` does and fails outside a vault.

`ocr` is path-scoped under the vault's visibility settings: an agent can OCR any file it can see, and a hidden file is refused like any other read. See [visibility](visibility.md).

## How it works

`cli/src/commands/ocr.ts` is the command; `cli/src/ocr.ts` holds the pure argv builders and note shaping, and `core/src/marker.ts` holds Marker, page parsing and engine lookup, shared with [PDF to markdown](pdf-to-markdown.md); both are unit-tested in `cli/test/ocr.test.ts` against a fixture scan with a watermark.

The text layer comes from `ocrmypdf --redo-ocr --output-type pdf`. `--redo-ocr` keeps visible vector text and OCRs the rest without rasterising the page; `--skip-text` would skip any page with a watermark. `--output-type pdf` skips the PDF/A conversion through Ghostscript. ocrmypdf writes a hidden `.<file>.ocr-tmp.pdf` beside the original, which is renamed over it, so the watcher sees one change and a reader never sees a half-written file.

With `--math`, Marker runs before the text layer is added and always with `--strip_existing_ocr`, so tesseract's reading of an equation from an earlier run never reaches the note. `tidyMarkdown` collapses Marker's padding around inline math. The MCP tool is `ocr` in `mcp/src/server.ts`; `ocrCliArgs` builds its argv and `OCR_TIMEOUT_MS` sets its timeout. `ocr` is in `PATH_SCOPED_COMMANDS` in `core/src/visibilityCliGate.ts`.

Source: `cli/src/commands/ocr.ts`, `cli/src/ocr.ts`, `core/src/marker.ts`, `mcp/src/server.ts`, `core/src/visibilityCliGate.ts`
