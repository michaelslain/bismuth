# Attachments and embeds

An embed shows a vault file inside a note: an image, a PDF, audio, video, a live HTML page or another note.
You write it as `![[file]]`, drag or paste files in to create attachments, and the `attachments:` settings choose where new files land.
Read this page for the embed syntax, resizing, adding files, and the settings; the matching rules for plain links are on [Wikilinks and tags](wikilinks-tags.md).

```markdown
![[photo.png|300]]
![[report.pdf#page=3]]
![[clip.mp4]]
![[viz.html#region=form]]
![[Other Note]]
![remote](https://example.com/photo.jpg)
```

Each line sits on its own, so each renders as a block in the note. Click an embed or move the cursor onto its line to see and edit the raw text.

## Which embed syntaxes are supported?

Two forms exist. Both render the same way; only the wikilink form carries a size in a slot of its own.

| Form | Example | Notes |
|---|---|---|
| Wikilink embed | `![[photo.png]]` | The file is found by name anywhere in the vault. |
| With size | `![[photo.png\|300]]`, `![[photo.png\|300x200]]` | Width, or width by height, in pixels. |
| With a fragment | `![[report.pdf#page=3]]` | Opens a PDF on that page. For HTML, the fragment becomes the page's `location.hash`. |
| Markdown image | `![alt](photo.png)` | A vault path or a URL. |
| Remote image | `![](https://example.com/p.jpg)` | `https:`, `http:`, `data:` and `blob:` URLs always render as images. |
| Markdown with width | `![alt\|300](photo.png)` | The width after the last `\|` in the alt text. |

Embed syntax inside a code span or fenced block is shown as text and not rendered. A size alias that is not a number (`![[photo.png|caption]]`) is ignored.

## What kinds of file can I embed?

The extension decides how an embed renders.

| Extensions | Renders as |
|---|---|
| `png jpg jpeg gif webp svg avif bmp ico` | image |
| `pdf` | PDF viewer |
| `mp3 wav ogg m4a flac aac opus` | audio player |
| `mp4 webm mov m4v ogv mkv` | video player |
| `html htm` | live HTML page in a sandboxed frame |
| `draw` | not embeddable; the line stays plain text |
| anything else, or no extension | another note, shown inline |

`![[Other Note]]` transcludes a note. A name with an unrecognised extension (`![[foo.xyz]]`) is also tried as a note, and shows `not found: foo.xyz` if no such note exists.

## How does each kind render?

- Image. With no size it shows at its natural width, up to the editor width. An unsized embed in the middle of a line is capped at 1.4 em tall so it flows like an icon.
- PDF. The same page viewer as the PDF preview tab, in a card whose header names the file and carries a zoom group and a `p. N / M` readout. The default size is full width and 520 px tall. `#page=N` opens page N.
- HTML. A live, interactive page: its inline scripts run. Default size is full width and 520 px tall. See [Security of HTML embeds](#security-of-html-embeds) for the isolation it runs under.
- Audio. A player at most 420 px wide.
- Video. A player that fits the editor width.
- Note. The note's body, rendered as sanitised markdown without its frontmatter, under a small title bar with the note's name and an accent border. A missing note shows `note not found: <target>`, and a read failure shows `failed to load: <target>`.
- Broken image. Shows `can't load image: <name>` in place.

An embed that is the only thing on its line, or follows a list marker (`- ![[photo.png]]`), renders as a block. An embed in the middle of text renders inline.

## How do I resize an embed?

Drag the bottom-right corner of an image, PDF, video or HTML embed that sits on its own line. The new size is written back into the note, so it survives a reload.

| Kind | Resize | Written as |
|---|---|---|
| Image | Keeps its aspect ratio; width only | `![[photo.png\|300]]` |
| PDF, video, HTML | Free width and height | `![[report.pdf\|800x600]]` |
| Markdown image | Keeps its aspect ratio; width only | `![alt\|300](photo.png)` |

The resize handle is invisible; the pointer changes to a diagonal arrow over the corner. Audio and note embeds do not resize.

## How do I add attachments?

New files can come from a paste, a drop onto a note, a drop onto the file tree, or a drag from the tree into a note.

- Paste an image. The image is saved to the attachments folder under the `attachments.naming` template and embedded as `![[name]]`.
- Drop files onto a note. By default they are copied into the attachments folder and embedded. Hold Option/Alt while dropping, or set `attachments.onDrop` to `reference`, to link the file at its original place instead.
- Drop things from other apps onto a note.
  Images dragged out of a browser, Photos or Messages files, links and selected text are handled by what the drag carries.
  Real file paths win over image bytes, then an image inside dragged HTML, then an image URL, then any other URL, then plain text.
  A browser image is downloaded into the attachments folder and embedded.
  A link with no image is inserted as plain text.
  A drag that carries nothing readable shows one toast, `Couldn't read that drop`.
  Dragging selected text within the editor moves it instead.
- Drag a tree row into a note. Dropping an image or PDF row onto a note's centre inserts `![[name]]` at the drop point; a note row inserts a `[[link]]`. The name is path-qualified when another file shares it.

### Dropping files onto the file tree

Dropping files from outside the app onto the sidebar creates vault files in the folder under the cursor, or the vault root if you drop on empty tree space.
Only file types the sidebar lists are accepted (images, PDFs, `.md`, `.draw`, `.sheet`, `.yaml`, `.yml`); the toast names anything skipped and counts what was created.
A HEIC or HEIF photo is converted to JPEG first.
Name collisions get a numeric suffix.

## Which settings control attachments?

The `attachments:` section of `.settings` holds three keys.

| Key | Type | Default | Effect |
|---|---|---|---|
| `attachments.folder` | string | `attachments` | Vault-relative folder for new pasted and dropped files. Created on first use. `""` is the vault root and `.` is the current note's folder. |
| `attachments.onDrop` | `copy` or `reference` | `copy` | Whether a file dragged in from outside is copied into the vault or referenced in place. Pasted images always copy. |
| `attachments.naming` | string | `Pasted image {timestamp}` | File name for pasted images; the extension is added from the image type. `{timestamp}` is a sortable date-time stamp. |

`reference` is best-effort in the browser build: the file is outside the vault, so the embed only resolves on desktop.
Embeds resolve by file name, so changing `attachments.folder` or moving a file later never breaks existing `![[name]]` embeds.
Full key list: [Settings reference](../settings/reference.md).

## What goes wrong silently?

- Two files with one name. `![[photo.png]]` shows the first match found while walking the vault. Use `![[folder/photo.png]]` to pick one.
- A replaced file looks stale. The app caches asset bytes for 60 seconds. Hard-reload to see a same-name replacement sooner.
- An unknown extension tries a note. `![[data.csv]]` renders as a note embed and fails.
- A drawing embed. `![[sketch.draw]]` stays plain text; drawings are not embeddable.

## How it works

### Resolving an embed target

`resolveAsset(root, target)` in `core/src/files.ts` finds the file an embed names, filename first:

1. Strip any `#fragment` and `|size`.
2. If the cleaned target is an existing vault-relative file, use it.
3. Otherwise take the last path segment and return the first file anywhere in the vault with that name.
4. If nothing matches, return `null`, which `GET /asset` turns into a 404.

A target that escapes the vault in step 2 falls through to the name search rather than throwing, so a bad embed target cannot crash the server. The name search walks the vault on each miss; the 60-second browser cache avoids repeating it.

### The asset routes

These routes live in `core/src/routes/vault.ts`.

| Route | Purpose |
|---|---|
| `GET /asset?path=<target>` | Stream the file with a content type from its extension and `Cache-Control: private, max-age=60`. A miss is a 404 `asset not found` with `no-store`. |
| `POST /asset?path=<dest>` | Upload raw bytes to a vault-relative destination. Returns `{ path }`, the path actually written. |
| `POST /asset/fetch` | Owner only. Body `{ url, path }`. Downloads a remote image into the vault. |
| `POST /convert/heic` | Converts HEIC or HEIF bytes to JPEG and writes nothing. |

Rules each route applies:

- `GET /asset` answers 403 `forbidden` to a request without the owner token when the file is restricted for that caller's channel; see [Visibility controls](visibility.md).
- `POST /asset` rejects a destination with an empty, `.` or `..` segment, or any segment that starts with a dot, with `400 invalid attachment path`. The dot rule blocks `.git/hooks/pre-commit`, which the next git-backed save would run.
- `POST /asset` and `POST /convert/heic` reject bodies over 100 MB (`MAX_ASSET_BYTES`) with 413, checking `Content-Length` before buffering and the real size after.
- `uniqueAssetPath` picks the final name: the requested path if free, else ` 1`, ` 2`, up to ` 9999` appended to the stem, else a timestamp.
- Uploads are not mutating routes, because attachments never enter the graph or search caches. The note edit that inserts the embed triggers its own invalidation, and the file watcher updates the sidebar.

`POST /asset/fetch` (`core/src/assetFetch.ts`) follows at most five redirects and refuses loopback, private, link-local and carrier-grade-NAT addresses, re-checking each hop.
A response whose content type is not `image/*` fails with `415 not an image`, and the file extension is corrected from the response's content type.

### Security of HTML embeds

`![[viz.html]]` renders in an `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so the page has an opaque origin and cannot read the app's DOM, storage or cookies.
Sandboxing alone does not stop it fetching vault content from the core server, so `GET /asset` also stamps every `.html` and `.htm` response with a Content-Security-Policy:

```http
Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'
```

`connect-src 'none'` blocks fetch, XHR, WebSocket and EventSource; `form-action 'none'` blocks form posts; `default-src 'none'` blocks every other external resource.
A self-contained page with inline scripts, styles, SVG and `data:` or `blob:` images still runs.
Both layers are required.
Raw HTML anywhere else in the app goes through `sanitizeHtml.ts`, which strips scripts, so an iframe is the only way to keep a page interactive.

### Rendering and resize code

`app/src/editor/embedBlock.ts` scans the document for `EMBED_RE`, which matches `![[...]]` and `![alt](url "title")`, after `stripCode` has masked code.
A `StateField` caches the tokens and recomputes them only when the text changes; moving the cursor only re-derives which embeds to reveal.
`app/src/editor/embedSpec.ts` holds the pure parts: `kindForTarget`, `parseSize`, `altSize`, `specForWikiEmbed`, `specForMarkdownImage`, `pageIndexFromFragment` and `computeSizeEdit`.

Image resize uses a custom 20 by 20 px corner handle (`div.cm-embed-handle`) that sets width and height together on every pointer move, clamped between 40 px and the editor width.
PDF, video and HTML use native CSS `resize: both`.
On release, `commitEmbedSize` locates the embed with `view.posAtDOM`, builds the edit with `computeSizeEdit` (keeping the target and fragment, replacing the part after `|`), and dispatches it as a transaction.
If the widget's position cannot be found, the commit is skipped without error.
A click on an embed's chrome moves the caret onto its source; audio, video, frames, links, the handle and the PDF controls keep their own clicks.

### Drop handling

`planDrop` in `app/src/dropIntake.ts` picks the actions, and `runDropActions` in `app/src/Editor.tsx` carries them out.
A Photos or Messages file promise arrives through the macOS-only `read_drag_pasteboard` command, which writes it under `~/Library/Caches/bismuth-drop/`; subfolders older than an hour are swept on the next drop.
The tree drop plan is `planTreeUploads` in `app/src/fileTreeDrop.ts`.
On the desktop app a native OS drop arrives as the `bismuth-native-drag` window event (`app/src/nativeDrop.ts`) with absolute paths read through `@tauri-apps/plugin-fs`, and `claimNativeDrop` in `app/src/nativeDropRouting.ts` ensures only one surface takes each drop.
The folder under the cursor comes from the nearest `data-drop-folder` or `data-drop-root` attribute.
A tree row dragged into a note uses `descriptorEmbedPath` and `embedFor` in `app/src/dnd/noteRef.ts`.

Source: `app/src/editor/embedBlock.ts`, `app/src/editor/embedSpec.ts`, `app/src/editor/PdfEmbed.tsx`, `app/src/dropIntake.ts`, `app/src/fileTreeDrop.ts`, `app/src/nativeDropRouting.ts`, `app/src/dnd/noteRef.ts`, `app/src/attachmentPath.ts`, `core/src/files.ts`, `core/src/assetFetch.ts`, `core/src/routes/vault.ts`, `core/src/routes/context.ts`, `core/src/schema/settingsSchema.ts`
