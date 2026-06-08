# Vault Attachments & Embeds

This document covers everything about embedding and serving vault media in Bismuth: the two embed syntaxes (`![[file]]` and `![](url)`), how each media kind is rendered (image, PDF, audio, video, `.md` transclusion), the drag-resize mechanism and how the persisted `|WxH` size works, how the backend resolves asset filenames via `resolveAsset`, the `POST /asset` upload endpoint including size cap and collision-avoidance, and the `attachments` settings section that controls where new files land.

---

## Embed Syntaxes

The editor supports two embed patterns, both parsed by `embedBlock.ts`:

```
EMBED_RE = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
```

### Wikilink-style: `![[target#fragment|size]]`

- `![[photo.png]]` — embed image
- `![[report.pdf#page=3]]` — embed PDF, opening on page 3
- `![[clip.mp4]]` — embed video
- `![[sound.mp3]]` — embed audio
- `![[Other Note]]` — transclude a markdown note (any target without a recognised media extension is treated as a note)
- `![[photo.png|300]]` — image constrained to 300 px wide (aspect-locked)
- `![[photo.png|300x200]]` — image constrained to 300×200 px
- `![[report.pdf|800x600]]` — PDF iframe 800×600 px

The `#fragment` and `|size` parts are parsed by `parseWikilink` and `parseSize`:

```
parseSize("300")    → { width: 300 }
parseSize("300x200") → { width: 300, height: 200 }
parseSize("text")   → {}           // non-numeric alias, ignored for sizing
```

Only `![[...]]` wikilink embeds can be drag-resized and have their size persisted.

### Markdown-style: `![alt](url)`

- `![](https://example.com/photo.jpg)` — remote image (URL is used as-is)
- `![](photo.png)` — vault image (classified by extension, resolved via `/asset`)
- `![](clip.mp4)` — vault video
- `![](doc.pdf#page=2)` — vault PDF, page 2
- `![alt text](photo.png)` — image with alt text

Remote URLs starting with `https?:`, `data:`, or `blob:` are treated as images regardless of extension. Vault paths are classified the same way as wikilinks (by extension). `![](url)` embeds are **not** resizable — only `![[...]]` wikilink embeds get the resize handle.

---

## Media Classification

Classification is done purely by file extension in `kindForTarget()`:

| Extensions | Kind |
|---|---|
| `png jpg jpeg gif webp svg avif bmp ico` | `image` |
| `pdf` | `pdf` |
| `mp3 wav ogg m4a flac aac opus` | `audio` |
| `mp4 webm mov m4v ogv mkv` | `video` |
| anything else (no extension, or `.md`, `.txt`, etc.) | `note` (transclusion) |

A bare `![[Note Name]]` with no extension always becomes a note transclusion. A `![[foo.xyz]]` with an unrecognised extension also falls through to note transclusion (and will fail to render if `foo.xyz` is not a markdown note).

---

## Rendering Behaviour per Kind

### Images

Block (standalone line) images:
- Wrapped in a `<div class="cm-embed-block">`
- Sized on load: if no `|W` is set, defaults to `min(naturalWidth, editorWidth)`
- Drag-resizable via a custom aspect-locked corner handle (see Resize section)
- `![[icon|18]]` on a non-standalone line → inline `<span class="cm-embed-inline">`

Inline images use `img.style.width/height` directly; block images use the wrapper `div` dimensions.

### PDFs

Block PDFs only (no inline PDF). An `<iframe>` is rendered with browser viewer controls suppressed:

```
frame.src = `${assetUrl}#${[page, "toolbar=0", "navpanes=0", "view=FitH"].filter(Boolean).join("&")}`
```

Default size: `100%` wide, `520px` tall. If `|WxH` is set: `W`px wide, `H`px tall. Free-resize (not aspect-locked) via native CSS `resize: both`.

### Audio

A `<audio controls>` element, `min(420px, 100%)` wide. Not resizable.

### Video

A `<video controls>` element. Resizable (free, not aspect-locked) if the embed is `![[...]]` and standalone.

### Note Transclusion (`.md` transclusion)

Fetches the note via `api.read(resolvedPath)`, strips YAML frontmatter, renders the body as sanitised markdown (via `renderMarkdown`). The widget shows:

- A small title bar with the bare filename (last path segment, no `.md` extension)
- The rendered body below

Styled with a left accent border (`var(--accent)`) and a surface-2 background. If the note is not found or read fails, shows `⚠ note not found: <target>` / `⚠ failed to load: <target>`.

Path resolution uses `resolveNotePath` (wikilink filename-first resolution) on the available notes list, then appends `.md` if needed.

---

## Cursor-reveal Behaviour

- **Standalone embed** (the only non-whitespace content on a line): when the cursor is anywhere on that line, the raw source is shown for editing. Moving the cursor off the line re-renders the widget.
- **Inline embed** (mid-paragraph): when the cursor is anywhere within the `![[...]]` or `![](...)` span, the raw source is revealed. Moving the cursor outside re-renders.

This is handled in `decorationsFor()` by skipping the `Decoration.replace` for tokens whose range contains the cursor.

---

## Resize and `|WxH` Persistence

Only `![[...]]` wikilink embeds of kind `image`, `pdf`, or `video` (`RESIZABLE_KINDS`) are resizable. `![](url)` embeds are not resizable.

### Image resize (aspect-locked)

Images use a **custom corner handle** (`div.cm-embed-handle`, invisible 20×20 px bottom-right corner, `cursor: nwse-resize`). On drag:

1. `pointerdown` on the handle captures the pointer.
2. `pointermove` computes `newW = clamp(40, startW + dx, editorWidth)` and sets both `wrap.style.width = newW` and `wrap.style.height = newW / aspect` simultaneously — this eliminates native-resize/JS conflict and prevents flicker.
3. On `pointerup`/`pointercancel`, if the width changed by more than 1 px, `commitEmbedSize(view, dom, `${w}`)` is called. The size is persisted as `|W` only (width only) since height is always derived from the aspect ratio.

### PDF / video resize (free)

PDF and video use native CSS `resize: both` (`overflow: hidden`, `.cm-embed-resizable` class). The native drag corner is invisible (`::-webkit-resizer { display: none }`) but functional. `pointerdown` records start dimensions; `pointerup` persists `|WxH` if either dimension changed by more than 1 px.

### Commit mechanics (`commitEmbedSize`)

Called with `(view, dom, size)` where `size` is either `"W"` (image) or `"WxH"` (pdf/video).

1. `view.posAtDOM(dom)` locates the character position of the embed widget in the document.
2. The line at that position is searched for `![[...]]` patterns.
3. The embed whose range contains the position is chosen (falling back to the first embed on the line).
4. The part before any existing `|` is kept (preserving the target and `#fragment`); the new size is appended: `![[target#frag|size]]`.
5. A CodeMirror transaction replaces the old embed source with the new one.

The result is that resize is always written back into the markdown, so it survives reload.

---

## Asset Resolution (`resolveAsset`)

The backend resolves embed targets **filename-first**, matching wikilink semantics. Called from `GET /asset`.

### Algorithm (in order)

1. Strip `#fragment` and `|size` suffixes from the target.
2. Try an exact vault-relative path: `resolveInVault(root, clean)` + `existsSync` + `isFile`. If it exists, return it.
3. Fall back to basename search: extract the last path segment as `base`, then `walkDir` the entire vault for a file with `d.name === base`. Return the first match.
4. If nothing matches, return `null` → 404.

```ts
// 1. Exact match:  "attachments/photo.png" → resolves if that path exists
// 2. Basename:     "photo.png"             → finds "projects/assets/photo.png" anywhere
```

Key properties:
- Moving an attachment to a different subfolder **does not break** `![[photo.png]]` — the basename search still finds it.
- Path traversal is blocked by `resolveInVault` (throws `EINVAL` if the resolved path escapes the vault root).
- The walk is per-request on a cache miss; browser `Cache-Control: private, max-age=60` caches the served bytes for 60 seconds so repeated views of the same note don't re-walk the vault.

---

## `GET /asset` Endpoint

```
GET /asset?path=<target>
```

- `path` (required): the raw embed target (e.g. `photo.png`, `attachments/photo.png`, `report.pdf`). URL-encoded.
- Calls `resolveAsset(vault, path)`, returns the file via `Bun.file(abs)`.
- Response headers: `Content-Type` inferred by `Bun.file` from the file's extension (falls back to `application/octet-stream`); `Cache-Control: private, max-age=60`.
- Returns 404 `"asset not found"` if `resolveAsset` returns `null`.
- **Read-only**, NOT a mutating route (no cache invalidation, no SSE broadcast).

The frontend builds the URL via:

```ts
api.assetUrl(target)  // → `${BASE}/asset?path=${encodeURIComponent(target)}`
```

This is used as the `src` of `<img>`, `<iframe>`, `<audio>`, and `<video>` elements in `EmbedWidget.toDOM()`.

---

## `POST /asset` Upload Endpoint

```
POST /asset?path=<desired-vault-relative-path>
Content-Type: application/octet-stream
<raw bytes>
```

- `path` (required query param): the desired vault-relative destination, e.g. `attachments/Pasted image 20240601.png`. URL-encoded.
- Body: raw binary bytes (`ArrayBuffer`).
- Returns `{ path: string }` — the **actual** path written (may differ from the requested path if a collision was resolved).

### Size cap

```ts
const MAX_ASSET_BYTES = 100 * 1024 * 1024; // 100 MB
```

Two checks: `Content-Length` header (fast reject before buffering) and the actual body size. Either exceeding 100 MB returns `413 "attachment too large"`.

### Path safety (`isSafeAssetTarget`)

```ts
function isSafeAssetTarget(rel: string): boolean {
  const segs = rel.split("/");
  return segs.length > 0 && segs.every(
    (s) => s !== "" && s !== "." && s !== ".." && !s.startsWith(".")
  );
}
```

Rejects:
- Empty segments (`//`)
- `.` or `..` (traversal)
- Any segment starting with `.` — this blocks `.git/hooks/pre-commit` (which the next git-backed vault save would execute, leading to RCE), `.obsidian/`, `.trash/`, etc.

Paths that fail this check return `400 "invalid attachment path"`.

### Collision handling (`uniqueAssetPath`)

After safety validation, `uniqueAssetPath(root, target)` is called to find a free path:

1. If the requested path does not exist in the vault, it is returned unchanged.
2. Otherwise, the basename is split at the last `.` (dot): `stem` + `ext`. A leading-dot name is treated as an all-stem name with no extension.
3. Attempts `"stem 1.ext"`, `"stem 2.ext"`, …, `"stem 9999.ext"` until a free path is found.
4. Pathological fallback (> 9999 tries): `"stem <Date.now()>.ext"`.

```
"attachments/photo.png" already exists
→ tries "attachments/photo 1.png"   (free) → returned
```

The returned path is what the note editor should insert as `![[basename]]`. The frontend caller receives the `path` field from the JSON response and inserts only the basename portion into the note.

### Why it is NOT a mutating route

Attachments are invisible to the graph/tree/search caches — `listTree` excludes binary files (only `.md`, `.draw`, `.sheet`, `.yaml`, `.yml` appear). Therefore no cache invalidation or SSE broadcast is needed. The subsequent note edit that inserts the `![[...]]` embed triggers its own normal invalidation.

---

## Attachment Settings (`settings.yaml`)

All fields live under the `attachments:` top-level key in `settings.yaml`.

### `attachments.folder`

**Type**: string  
**Default**: `"attachments"`

Vault-relative folder where new pasted/dropped attachments are saved. The folder is created automatically on first use (via `writeBinary` → `mkdirSync(dirname(full), { recursive: true })`).

Special values:
- `""` (empty string) — save at the vault root
- `"."` — save in the same folder as the current note (the backend receives the resolved path from the frontend)

Embeds always resolve by filename, not by path, so changing `folder` after files are already uploaded does not break existing `![[name]]` embeds.

### `attachments.onDrop`

**Type**: `"copy"` | `"reference"`  
**Default**: `"copy"`

Behaviour when dragging a file in from outside the vault:
- `"copy"` — copy the file into the attachment folder (keeps the vault self-contained)
- `"reference"` — insert a reference to the file at its original path (best-effort in the browser build; the embed only resolves on desktop)

`⌥`-drop (Option/Alt) always references regardless of this setting. Clipboard pastes (Ctrl/Cmd+V) always copy in regardless of this setting.

### `attachments.naming`

**Type**: string  
**Default**: `"Pasted image {timestamp}"`

Filename template for pasted clipboard images. The file extension is appended automatically based on the clipboard content type.

Substitutions:
- `{timestamp}` → a sortable date-time stamp

Name collisions after template expansion are resolved by `uniqueAssetPath` with a numeric suffix (`" 1"`, `" 2"`, …).

---

## Code-masked Embeds

`stripCode` (from `core/src/wikilinks.ts`) masks code spans and fenced code blocks before the `EMBED_RE` regex runs. This means embed syntax shown inside backtick code or fenced blocks is NOT rendered — it remains as raw text in the editor. The masking preserves character offsets, so `m.index` values from the regex are correct positions in the actual document.

---

## Gotchas & Edge Cases

- **Non-media extension treated as note**: `![[foo.xyz]]` — since `.xyz` is not in the recognised extension sets, this is classified as `"note"` and will try to transclude `foo.xyz` as markdown. It will show an error widget if `foo.xyz` is not found as a note.
- **Fragment stripping in `resolveAsset`**: `resolveAsset` strips `#fragment` before searching. So `![[report.pdf#page=3]]` resolves `report.pdf` correctly.
- **Resize only on `![[...]]` wikilink embeds**: `![](photo.png)` images have no resize handle even when standalone. Only wikilink-style embeds get the drag-resize handle.
- **Size persisted as `|W` for images, `|WxH` for PDF/video**: after an image resize, the embed becomes `![[photo.png|300]]`; after a PDF/video resize it becomes `![[report.pdf|800x600]]`.
- **`posAtDOM` fallback in `commitEmbedSize`**: if the widget's DOM position can't be found (e.g. the widget was removed), `commitResize` is silently skipped. No crash.
- **Security — dot-segment rejection in `isSafeAssetTarget`**: uploading to `.git/hooks/pre-commit` would produce an executable that runs on the next git-backed save. The check is defence-in-depth on top of `resolveInVault`'s traversal guard.
- **`listTree` excludes binary assets**: images/PDFs/etc. do not appear in the file tree or search index; the graph is unaffected by attachment uploads.
- **`private, max-age=60` cache**: the browser caches asset bytes for 60 seconds. If a file is replaced (same name), the old version may serve for up to 60 seconds. Hard-reload clears this.

`Source: app/src/editor/embedBlock.ts, core/src/files.ts, core/src/server.ts, core/src/schema/settingsSchema.ts, app/src/api.ts`
