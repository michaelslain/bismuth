# Transcribe pages and handwritten scans

Transcription turns the pictures in a vault into text: a photographed notebook page, a handwritten scan, a scanned PDF or a page of lecture math becomes markdown inside the file's companion note, where search and embeddings index it, with math written as LaTeX. Use it for the pages of a [book view](../bases/views/book.md) or any image or PDF. To make a scanned PDF's text selectable in the viewer, use [OCR](ocr.md).

```bash
bismuth transcribe math/math110-2025-09-22.pdf --book Math.base.jsonl --vault ~/vault
```

```json
{"ok":true,"companion":"math/math110-2025-09-22.pdf.md","engine":"marker","pages":[{"page":1,"chars":943},{"page":2,"chars":744},{"page":3,"chars":1027},{"page":4,"chars":554}],"escalated":[1,2,3,4]}
```

## Pick an engine

Each engine reads a page, and `auto` combines them.

| Engine | Where it runs | Good at | Needs |
|---|---|---|---|
| `on-device` | on this machine, Apple Vision | printed text, neat handwriting, fast bulk runs; garbles math | the Bismuth mac app (its bundled `bismuth-vision` helper) |
| `marker` | Marker on this machine | math as `$…$` and `$$…$$` LaTeX, about 10-15 s a page | `marker_single` and `llama-server`; see [Install Marker](#install-marker) |
| `ai` | one turn on an agent backend, reading the page image | messy handwriting, mixed layouts | an installed backend that reads images |
| `auto` | on-device first, then marker or ai on the pages that need it | a whole book of mixed pages | the mac app; marker and ai are optional |

`auto` is the default. The `transcription.engine` setting names the engine used when a call names none.

A run with `--pages` replaces only those pages; a run without it replaces the file's whole transcript.

## How auto routes a page

`auto` reads every page on-device first, then re-reads the pages that need more. The result lists every re-read page in `escalated`.

- A page that looks like math is re-read by `marker` when `math` is `careful`, or by `ai` where marker cannot run; the result's `markerSkipped` says why marker did not run.
- With `math` set to `fast`, a math page keeps its on-device text, and the result's `math` lists those page numbers.
- Any other page whose recognition confidence is below 0.5, or whose text is blank, is re-read by `ai`. If ai cannot run, the on-device text stays and the result carries `aiSkipped` with the reason.
- Where on-device recognition is absent, `auto` sends every page to `marker`, then to `ai` if marker cannot run.

A page looks like math when at least 2 of its lines, and at least 15% of its lines, carry a math tell: a relation or operator symbol, two lone single-letter variables, or a digit next to a letter.

## Choose how math is read

The `math` option sets what `auto` does with a page that looks like math: `careful` re-reads it, `fast` keeps the on-device text. Pass `--math careful|fast` on the command line, or set `transcription.math`. A call that names none uses the setting. With the setting at `ask`, a book view reads math pages fast and then asks whether to read them properly (see [book view transcription](../bases/views/book.md#transcription)), while the CLI, the MCP tool and an HTTP request with no `math` read them carefully.

## Install Marker

Marker installs itself on a Mac the first time it is needed: choosing `[ read it properly ]` in a book's math prompt starts the install when Marker is missing (the prompt says so), the book's readout ends with `// setting up the math reader` while it runs, and the math pages are re-read when it finishes. From the command line, `bismuth transcribe setup` does the same and waits:

```bash
bismuth transcribe setup
```

```json
{ "installed": true, "missing": [], "dir": "/Users/you/.bismuth/tools" }
```

The install puts three programs under `~/.bismuth/tools`, about 1.2 GB in all, skipping any already on the machine:

| Program | Needed for | Comes from |
|---|---|---|
| `uv` | installing Marker | the uv release on GitHub |
| `marker_single` (Marker) | the `marker` engine and `auto`'s math pages | `uv tool install 'marker-pdf>=2,<3'`, with a Python uv fetches for it |
| `llama-server` (llama.cpp) | Marker's models | the llama.cpp release for macOS on GitHub |

A failed install says which program failed and why; math pages then go to `ai`. Off a Mac, the install fails at once and names the commands to install by hand. A run that needs Marker while it is missing fails with `run: bismuth transcribe setup`.

The first Marker run downloads its models from Hugging Face, which takes several minutes; later runs start in seconds. Bismuth finds the programs on `PATH` and also in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and `~/.bismuth/tools/bin`, so an agent or daemon session with a short `PATH` still reaches them. Delete `~/.bismuth/tools` to remove what the install added.

Marker 2 is the release line that runs its models on `llama-server`, and the `>=2,<3` constraint keeps `uv tool upgrade` on it. A failed Marker run reports Python's last exception line and the repair command; run it to reinstall Marker within that line:

```bash
uv tool install --reinstall 'marker-pdf>=2,<3'
```

## Settings

| Key | Default | Effect |
|---|---|---|
| `transcription.auto` | `true` | A book view transcribes every page with no text on its own |
| `transcription.engine` | `auto` | The engine used when a call names none: `auto`, `on-device`, `marker` or `ai` |
| `transcription.math` | `ask` | What `auto` does with a page that looks like math: `ask`, `careful` or `fast` |
| `transcription.provider` | `auto` | The backend that runs `ai`; `auto` follows `chat.provider` |
| `transcription.model` | empty | The model `ai` asks for; empty is the backend's own default |

The `ai` turn runs in an empty temporary folder and receives only the rendered page image. The vault is never its working folder, the backend's own session record is erased afterwards, and a turn that asks for a tool or permission is stopped. See [settings](../settings/reference.md).

## Where the text lands

The transcript is written into the page file's companion note, `<file>.<ext>.md` (`scan.jpg` gives `scan.jpg.md`). The companion is created on the first run. It holds one marked block:

```markdown
---
transcribed: ai
transcribedAt: 2026-10-31T09:14:02.511Z
books: ["[[Notebook]]"]
---
Your own notes about the page stay here.

<!-- bismuth:transcript:start -->
Dear diary, the integral of $x^2$ is $x^3/3$.
<!-- bismuth:transcript:end -->
```

- `transcribed` is `on-device`, `marker` or `ai`, the transcriber whose text is stored (`ai` when any page went to ai, else `marker` when any went to marker, else `on-device`), and `transcribedAt` the time of the last run.
- `books` lists each book base the page was filed under with `--book`; a base already in the list is not added twice.
- Everything outside the two marker comments (tags, other properties, text you wrote) is kept byte for byte on a re-run. Only the block is replaced.
- An image is one page and its text is the block. A PDF gets one `### Page N` heading per page, in page order.

The companion is an ordinary note, so `bismuth search "<a word on the page>"` finds it, and with embeddings on, `--semantic` finds it by meaning. See [semantic search](semantic-search.md).

## Mark text in a transcript

A highlight on a page's text is a `==marked==` span inside that page's part of the transcript block, so search and notes see it:

```markdown
Dear diary, the ==integral of $x^2$== is $x^3/3$.
```

`POST /transcript/mark` with `{ "file": "scan.pdf", "page": 2, "add": ["integral"] }` wraps the first unmarked occurrence of each quote on that page, and `remove` unwraps a span. A quote that is not on the page is skipped, and a span already marked is not wrapped twice. Only the one page's text changes; the frontmatter, other pages and your own text stay byte for byte.

A re-run of a transcript keeps each mark whose text still occurs on the new page and drops the rest.

## Edit a page's transcript by hand

A page's text can be typed or corrected directly. `POST /transcript/page` with `{ "file": "scan.pdf", "page": 2, "text": "Dear diary, the ==integral== …" }` replaces that one page's text, or adds the page when it has none. The text is stored as written, `==marks==` included, and the other pages, the `transcribed` and `transcribedAt` frontmatter and your own text stay byte for byte. Text that is empty after trimming removes the page's text, and removing the last page removes the whole marked block. The companion is created when it does not exist.

```bash
bismuth transcript set scans/notes.pdf --page 2 --text "Dear diary, the integral of \$x^2\$ is \$x^3/3\$."
```

```json
{"ok":true,"companion":"scans/notes.pdf.md","page":2}
```

`--stdin` reads the text from standard input instead of `--text`; give one of the two. For an image, the page is `1`. A later `bismuth transcribe` run replaces the typed text, keeping only the marks whose words still occur.

## Line boxes

`POST /transcript/lines` with `{ "file": "scan.jpg" }` recognises the page again on this machine and returns each line with its box, so a client can find the lines under a region the reader drew:

```json
{ "pages": [{ "page": 1, "lines": [{ "text": "buy milk", "x": 0.12, "y": 0.2, "w": 0.4, "h": 0.04 }] }] }
```

`x`, `y`, `w` and `h` are fractions of the page, with the origin at the top left. Boxes are never stored in the companion. A line belongs to a region when the box overlaps it by at least 30% of the line's height. Where on-device recognition is absent (no Mac helper, or the iPad) the route answers 503 `VISION_UNAVAILABLE`.

## Transcribe in the background

A reader that transcribes a long file starts a background job instead of waiting on one request: `POST /transcribe/job` answers the job at once and the pages land in the companion note as they finish. Reading the stored transcript mid-run shows every page done so far.

- **Progress.** The job lists every page it covers with a status of `queued`, `reading`, `done` or `failed`. A `done` page carries the engine whose text it holds and how long it took in milliseconds; a `failed` page carries a one-line reason, and the run goes on with the next page. The job's `etaMs` is the mean time of the pages done so far times the pages left, and is absent until one page is done. `on-device` and `ai` read one page at a time; `marker` reads its pages as one batch, so they change status together.
- **Cancel.** `POST /transcribe/job/cancel` ends the job with the state `cancelled`. `on-device` and `ai` stop after the page being read; `marker` stops at once. Pages already done keep their text and nothing is written after the cancel. A job started for the file after a cancel waits until the stopped engine has settled.
- **One at a time.** Jobs for different files run one after another in start order, because the engines are heavy. Starting a job for a file whose job is running returns that job.
- **A math question during the run.** With `math` at `ask`, the job reads every page on-device first and lists the pages that look like math in `mathPending` as soon as each is found, while it goes on with the other pages. `POST /transcribe/job/math` with `careful` re-reads every pending page, and every math page found later, with `marker` (with `ai` where marker is not installed, and the job then sets `markerMissing`); `fast` keeps the on-device text and clears the list. With no choice the job ends `done` with `mathPending` still listed, and a `careful` choice made afterward starts the re-read.

The job lives in the running server, so a restart forgets it; the finished pages stay in the companion. `GET /transcribe/job?file=<file>` answers the file's current or last job, or `null`. Under `ask` the CLI, the MCP tool and `POST /transcribe` have no one to ask and read math pages carefully.

## Transcribe from the command line

`bismuth transcribe <file>` runs in the calling process and needs no running app. The path is vault-relative and names an image or a PDF; anything else is refused.

| Flag | Effect |
|---|---|
| `--engine auto\|on-device\|marker\|ai` | The engine; the `transcription.engine` setting when omitted |
| `--math careful\|fast` | What `auto` does with a page that looks like math; the `transcription.math` setting when omitted |
| `--pages <spec>` | 1-based PDF pages, such as `3`, `1-4` or `1-3,7`. Default all |
| `--book <base>` | Add `[[<base>]]` to the companion's `books` list |
| `--missing` | Skip a file whose companion already has `transcribed:`; the result carries `"skipped": true` |
| `--progress` | Write one JSON line to stderr per page state change, such as `{"page":3,"status":"done","engine":"on-device","ms":1840}`; stdout is unchanged. Ctrl-C stops the run after the page being read |

`bismuth book pages <base>` prints a book base's page files in the view's sorted order, one per line; `--json` prints each as `{ file, kind, rowIndex }`. Pipe it into `transcribe` to do a whole book:

```bash
bismuth book pages Notebook --vault ~/vault | while read f; do bismuth transcribe "$f" --missing --book Notebook --vault ~/vault; done
```

## Transcripts follow rewritten pages

When a PDF's pages are reordered, deleted or added to (see [Rewrite a PDF's pages](pdf-pages.md)), each page's transcript is renumbered to follow it, a deleted page's text is dropped, and an added page has none until it is transcribed.

## Transcribe as an agent

An agent runs `bismuth transcribe` from its shell with the flags in the table above; a host with no shell sends the same arguments through the MCP tool `bismuth_cli`, which lets `transcribe` run up to 30 minutes, since a long PDF takes minutes. It fails outside a vault.

`transcribe` and `transcript set` are path-scoped under the vault's visibility settings. A hidden or chat-only page file, or one whose companion is hidden, reads as missing to an agent. See [visibility](visibility.md).

## Failure modes

- If the engine is `on-device` and the helper is absent (the app is not installed, or the machine is not a Mac), the call fails with `VISION_UNAVAILABLE` and status 503, and no companion is written. Retry with `--engine marker` or `--engine ai`.
- If the engine is `marker` and `marker_single` or `llama-server` is missing, the call fails with `MARKER_UNAVAILABLE` and status 503, naming the install command, and no companion is written. Under `auto` the math pages go to `ai` instead and the result carries `markerSkipped`.
- If the engine is `ai` and the resolved backend is not installed or cannot read images, the call fails with `AI_UNAVAILABLE` and status 503, naming the backend. Under `auto` the on-device text is kept instead.
- An unknown `engine`, or a `math` other than `careful`, `fast` or `ask`, fails with status 400.
- If a job's every page fails, the job ends `failed` with the reason in `error`.
- If you start a job on the iPad, the call fails with `VISION_UNAVAILABLE` and status 503; `GET /transcribe/job` answers `null`.
- If the file is a note or any other kind, the call fails with status 422. If it does not exist, status 404.
- If a page is blank or unreadable, the block is written with empty text for that page. Re-run it with another engine, or with `auto`.
- If you delete the marker comments, the next run appends a new block after your text instead of replacing the old one.

## How it works

`core/src/transcribe.ts` holds the one path every entry point shares: it checks the file, reads the `transcription` settings, picks the engine, runs it and writes the companion. `transcribeAuto` there routes each page. The HTTP routes are `POST /transcribe`, the four `/transcribe/job` routes, `GET /transcript`, `POST /transcript/mark`, `POST /transcript/page` and `POST /transcript/lines` in `core/src/routes/transcribe.ts` ([HTTP reference](../api/http-reference.md)); the CLI commands are `transcribe` and `transcript set`, and `cliTimeoutMs` in `mcp/src/cli.ts` gives it `bismuth_cli`'s long timeout.

`core/src/transcribeJob.ts` holds the jobs, keyed by file, and runs them through one promise chain so only one engine works at a time. A job calls `transcribe` with `onPage`, which makes it run page by page (`createPager` in `transcribe.ts`), `signal`, `onMath` and `mathChoice`; the same function serves `POST /transcribe` and the CLI, which pass none of them (the CLI's `--progress` passes `onPage` and a `SIGINT` signal). Each finished page is written with `writeTranscript` before the next starts. A choice that arrives after the reading pass runs `transcribeMathPages` over the pages still pending. The job types are in `core/src/transcribeJobTypes.ts`.

`runTool` in `core/src/marker.ts` stops Marker when its signal aborts. Marker ignores `SIGINT` and tears down its `llama-server` helper, which runs in its own session, only from a Python `atexit` that no signal reliably reaches. So `runTool` freezes Marker with `SIGSTOP`, lists its descendants with `ps`, kills Marker with `SIGKILL`, sends each descendant `SIGTERM`, and sends `SIGKILL` to any still alive after `STOP_GRACE_MS`. A Marker run started while `llama-server` is still dying would attach to it, so `runTool` returns only after those descendants have exited, and a job started after a cancel waits for the stopped run to settle before its engine starts.

`core/src/mathDetect.ts` decides whether a page looks like math from its on-device text. `core/src/marker.ts` runs Marker: `markerPageTexts` runs it with `--paginate_output` and `splitMarkerPages` splits the markdown on Marker's page labels, so each page keeps its own text. `INSTALL_HINTS` there holds the install commands in [Install Marker](#install-marker).

`core/src/bookMarks.ts` finds a page's text inside the block and wraps or unwraps its spans, and `linesInRegion` picks the lines under a region. `core/src/transcript.ts` renders, merges and reads the marked block and stamps the frontmatter through `mutateFrontmatter`; `setTranscriptPage` and `writeTranscriptPage` there set one page without stamping, and `remapTranscriptPages` renumbers the pages after a PDF rewrite. `core/src/visionOcr.ts` runs the `bismuth-vision` helper, which is found through `BISMUTH_VISION_PATH`, then the app bundle, then the development build in `app/src-tauri/binaries`, then, on a Mac with `swiftc`, a build of `main.swift` compiled once and cached in `~/.bismuth/cache/vision`. `core/src/aiTranscribe.ts` runs one headless turn per page image on the resolved backend, in an empty temp folder.

The engines load through dynamic `import()`, so the iPad's in-process core, which has no child processes, still loads the module. Its backend in `core/src/localBackend.ts` answers `POST /transcribe` with 503 `AI_UNAVAILABLE` for `ai` and 503 `VISION_UNAVAILABLE` otherwise, answers `POST /transcript/lines` and the three `POST /transcribe/job` routes with 503 `VISION_UNAVAILABLE`, answers `GET /transcribe/job` with `null`, and serves `GET /transcript`, `POST /transcript/mark` and `POST /transcript/page`. `transcribe` and `transcript` are in `PATH_SCOPED_COMMANDS` in `core/src/visibilityCliGate.ts`.

Source: `core/src/markerSetup.ts`, `core/src/transcribe.ts`, `core/src/transcript.ts`, `core/src/mathDetect.ts`, `core/src/marker.ts`, `core/src/bookMarks.ts`, `core/src/visionOcr.ts`, `core/src/aiTranscribe.ts`, `core/src/transcribeJob.ts`, `core/src/transcribeJobTypes.ts`, `core/src/routes/transcribe.ts`, `core/src/localBackend.ts`, `cli/src/commands/transcribe.ts`, `mcp/src/cli.ts`
