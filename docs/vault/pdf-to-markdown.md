# Convert a PDF to markdown

Converting a PDF writes a new markdown note beside it, with headings, lists, tables and math as LaTeX, and a `source` property that links back to the PDF. The PDF itself is never changed. It runs Marker, the same engine as `bismuth ocr --math`; install it first (see [OCR](ocr.md#install-the-ocr-engines)).

```bash
bismuth pdf md "papers/scan.pdf" --vault ~/vault --pretty
```

```json
{
  "ok": true,
  "path": "papers/scan.pdf",
  "note": "papers/scan.md"
}
```

`papers/scan.md` then reads:

```markdown
---
source: "[[scan.pdf]]"
---

# Gradient descent

The loss is minimised by stepping against the gradient. For a learning rate $\eta > 0$ the update is

$$\theta_{t+1} = \theta_t - \eta \nabla_{\theta} L(\theta_t)$$
```

## Convert from the PDF bar

The PDF bar's convert-to-markdown button (a page glyph beside the bookmarks button) starts the conversion. While it runs, the button is disabled and the bar reads `// converting to markdown [ cancel ]` after the page number. When it finishes, the new note opens in its own tab and a `converted to <name>.md` toast offers `open`. A long PDF takes minutes; close the PDF meanwhile and the toast still arrives when it is done.

The button hides in a pane narrower than 650px, together with the file actions. On iPad and iPhone, conversion is unavailable and the button reports an error, because the engines run on a desktop.

## Cancel a conversion

Press `[ cancel ]` in the PDF bar while a conversion runs. The engine stops at once, no note is written, the convert button works again, and a `cancelled converting <name>.pdf` toast confirms it. An existing note the conversion would have rewritten is left as it was. In a narrow pane the bar shortens to `converting [ cancel ]`, and `[ cancel ]` never hides.

A conversion started again right after a cancel waits for the stopped engine to exit, then runs from the first page.

## Rewrite an existing note

If the note already exists, the button opens it instead and the toast offers `rewrite`, which converts again over it.

## What the note holds

The note is named after the PDF with `.md` in place of `.pdf`, in the same folder. Its frontmatter holds one property, `source`, a link to the PDF. The body is Marker's markdown: headings, paragraphs, lists, tables, inline math as `$…$` and display math as `$$…$$`, which the editor renders. Figures are left out; they stay in the PDF that `source` links to.

A sentence Marker splits before an inline equation is joined back into one paragraph.

## Options

Every option applies to the CLI command and the MCP tool.

| Flag | MCP argument | Effect |
|---|---|---|
| `--pages <spec>` | `pages` | 1-based pages, such as `3`, `1-4` or `1-3,7` |
| `--force` | `force: true` | Read every page as an image even where text exists; use it when copied text from the PDF is garbage |
| `--replace` | `replace: true` | Rewrite an existing note |

Without `--replace`, an existing note is refused with `EEXIST` and left as it is, so a note you edited is never overwritten. A path that is not a PDF is refused with `not a PDF`, and a missing file with `no such file`.

## When a conversion fails

A failed conversion reports one line: the error Marker raised and the command that reinstalls it, such as `couldn't convert scan.pdf: marker's install is broken (ImportError: …) — repair it: uv tool install --reinstall 'marker-pdf>=2,<3'`. No note is written. Run the command, then convert again. [OCR](ocr.md#install-the-ocr-engines) owns the install.

PDFs whose pages hold both text and images convert like any other.

## Convert as an agent

An agent calls the `pdf_to_markdown` MCP tool with `path` and the arguments in the options table. It is its own tool rather than a `bismuth_cli` call because a long PDF takes minutes and `bismuth_cli` gives up after 30 seconds; `pdf_to_markdown` waits up to 30 minutes. It is path-scoped under the vault's visibility settings: a hidden PDF is refused like any other read. See [visibility](visibility.md).

To give a scanned PDF a selectable text layer instead, which does change the PDF, use [`bismuth ocr`](ocr.md).

## How it works

`core/src/pdfMarkdown.ts` holds the conversion: `pdfMarkdownPath` names the note, `checkPdfMarkdown` refuses what cannot convert, and `convertPdfToMarkdown` runs Marker and writes the note. Marker itself, engine lookup on a short `PATH`, page parsing and `tidyMarkdown` live in `core/src/marker.ts`, shared with `bismuth ocr`; `sourcedNote` adds the `source` frontmatter.

marker-pdf 2.0.0 reads an image's box with `PdfObject.get_pos`, a method the pypdfium2 5 it pins names `get_bounds`, and it reaches that call on any page with text and an image, because `markerArgs` passes `--strip_existing_ocr`. `markerTranscribe` therefore runs Marker with `markerShimEnv`, which puts a `sitecustomize.py` holding `MARKER_SHIM` first on `PYTHONPATH`; the shim adds `get_pos` as an alias of `get_bounds` only when `get_pos` is missing. `markerFailure` turns a non-zero exit into the one-line message, with `MARKER_REPAIR` as the command.

The CLI command is `pdf md` in `cli/src/commands/pdf.ts`. The MCP tool is `pdf_to_markdown` in `mcp/src/server.ts`, which runs the command through `pdfToMarkdownCliArgs` with `OCR_TIMEOUT_MS`. `pdf` is in `PATH_SCOPED_COMMANDS` in `core/src/visibilityCliGate.ts`.

The button cannot hold one HTTP request open for the whole run, since Bun drops a request idle for 255 seconds. `POST /convert/pdf-markdown` calls `startPdfMarkdownJob`, which starts the conversion in the background and answers at once; `GET /convert/pdf-markdown` reads the job's state from `pdfMarkdownJob`. A start while a job for the same PDF runs joins it. `POST /convert/pdf-markdown/cancel` calls `cancelPdfMarkdownJob`, which marks the job `cancelled` and aborts it; a start that follows waits for the stopped run to settle, because the stopping Marker would tear down the llama-server a new run attaches to.

Marker ignores SIGINT, and it stops the llama-server it spawned only from a Python `atexit`. So `runTool` in `core/src/marker.ts` stops an engine by freezing it, listing its descendants with `descendants`, killing it, and sending each descendant SIGTERM, then SIGKILL after `STOP_GRACE_MS`. Surya replaces the llama-server sentinel the killed run leaves behind on its next start. `app/src/preview/pdfMarkdownJobs.ts` polls the job, raises the toasts and opens the note, and `cancelConversion` wakes the poll so the bar clears at once; it is module-level, so a job outlives the PDF's tab. The note is written like any external write, and the file watcher picks it up.

Source: `core/src/pdfMarkdown.ts`, `core/src/marker.ts`, `core/src/routes/vault.ts`, `cli/src/commands/pdf.ts`, `mcp/src/server.ts`, `app/src/preview/pdfMarkdownJobs.ts`, `app/src/preview/PreviewBar.tsx`
