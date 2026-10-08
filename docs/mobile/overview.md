# Mobile (iPad and iOS)

On iPad and iOS, Bismuth runs the same vault logic inside the app's WebView, with no server: there is no Bun process, no listening port and no `node:fs` on the device. The app calls an in-process backend directly, and the files are read and written through the Tauri file plugin. This page is for engineers building the mobile app, and for anyone who needs to know what the iPad build can and cannot do.

A mobile entry point swaps the app's file and transport seams before it loads `App`:

```ts
import { bootMobile } from './mobile/bootMobile'
await bootMobile() // swap the file layer and the transport
const { App } = await import('./App') // App loads after the swap
const { start } = await import('./serverVersion')
start() // the version poll starts only when called
render(() => <App />, root)
```

`bootMobile()` uses `<documentDir>/Bismuth` as the vault, creating it when it is missing; pass `{ vault, memory? }` to use another folder. The desktop `app/src/index.tsx` never imports it, so the desktop build is unchanged.

## What the iPad build can do

The in-process backend answers the read paths and the writes that change a note's content. Everything else the desktop server does is listed under the next heading.

| Area | Works |
|---|---|
| Graph and file tree | The graph with its layouts, the file tree, the vault's rows for Bases |
| Notes | Read a note, write it (with an edit-conflict check), read its frontmatter, set and delete properties, replace across the vault |
| Bases | Read a base, resolve a source into rows, update, delete and reorder rows, including the kanban batch writes |
| Tasks | List tasks, toggle one |
| Flashcards | List decks and cards, review a card |
| Search | Vault search |
| Settings and themes | Read `.settings` with its defaults applied, and read custom themes from `.themes/` |
| Status bar | Segments, except shell segments |

## What it cannot do

These requests fail on a device. The in-process backend throws an `EINVAL` error with status 501 and the message `<METHOD /path> is not supported by the in-process backend yet` for the first group, and an `ENOENT` error with status 404 for routes it has no handler for.

| Not available | Detail |
|---|---|
| Creating, moving, deleting or restoring files and folders | `POST /create`, `/move`, `/delete`, `/restore` |
| Changing settings from the app | `POST /set-setting`, `/folder-icon`; the app reads `.settings` but cannot write it |
| Daily notes, backup, opening another vault | `POST /daily-note`, `/backup` (there is no `git` on the device), `/open-folder` |
| Attachments | Uploading, downloading a remote image, HEIC conversion and staging a temp file all throw |
| Shell status segments | A `run:` segment returns `shell segments are desktop-only`; `POST /status-bar/trust` is refused |
| The daemon | The cron and process writes (`/daemon/cron/*`, `/daemon/process/*`) are refused, because the in-process path has no owner channel. Every other `/daemon/*` route has no handler, so the daemon page cannot load |
| The doctor | `GET /doctor` and `POST /doctor/fix` |
| Templates and the property schema | `GET /templates` returns `[]` and `GET /schema` returns `{ properties: {} }` |
| Most task edits | `/tasks/reschedule`, `/update`, `/delete`, `/move`, `/archive`, `/create` have no handler; only toggling works |
| Chat, updates, search prompts, folder visibility | `/chat/*`, `/update/*`, `POST /search-prompt`, `POST /folder-visibility` have no handler |

## Emoji task fields do not show on iPad

Bismuth reads task dates, priorities and recurrences only from bracket fields such as `[due 2026-09-14]`. The conversion of the Obsidian-Tasks emoji spelling to bracket fields runs on the desktop, because it takes a git snapshot first and a device has no `git`. A vault that is only ever opened on an iPad keeps its emoji fields, and the app shows those tasks without dates, priorities or recurrences. The note text is untouched. Open the vault once on a desktop and the conversion runs there. A vault created on the device starts with nothing to convert, and emoji fields typed by hand on the iPad stay unconverted until a desktop opens the vault. [Tasks syntax](../tasks/syntax.md) has the bracket-field grammar.

## How it works

### The file and transport seams

The logic modules (engine, bases, search, tasks, flashcards, frontmatter, layout) must not import Bun or `node:fs` statically, or the WebView bundle breaks. Two interfaces keep them out of it.

`FileAccess` in `core/src/fileAccess.ts` is the one file interface the logic reads and writes through.

```ts
interface FileAccess {
    listMarkdown(root): Promise<string[]> // every .md, vault-relative
    listTree(root): Promise<TreeEntry[]> // the sidebar tree
    readNote(root, rel): Promise<string>
    writeNote(root, rel, contents): Promise<void>
    statNote(root, rel): Promise<FileStat | null> // null if the file vanished
    listDir(root, rel): Promise<string[]> // entry names; [] if the folder is missing
    realPath(path): Promise<string> // for cycle detection; best effort
}
```

`getFileAccess()` builds the desktop implementation on first use with dynamic `import()` calls, so `files.ts`, `node:fs` and `node:path` stay out of the static dependency graph. `setFileAccess()` installs another implementation, and once it is set the desktop one never loads. On a device that is `tauriFileAccess()` in `app/src/mobile/tauriFileAccess.ts`, built on `@tauri-apps/plugin-fs`. It walks the vault with `readDir`, skips unreadable folders and dot-files (`.git`, `.obsidian`), lists the same file types the desktop tree lists, hides a binary's companion note and ink sidecar when the binary is present, and treats `realPath` as the identity because iOS has no `realpath`. The vault root is an absolute, security-scoped folder you granted; the mobile entry starts access to it before the first read.

`Transport` in `app/src/api.ts` is the interface every `api.*` call goes through: `getJson`, `getText`, `post`, `put`, `postJson`, `writeFileChecked`, `uploadAsset`, `fetchAsset`, `convertHeic`, `stageTmpFile`, `assetUrl`, `eventsUrl` and `base`. Desktop uses the HTTP transport. `setTransport(inProcessTransport(backend))` swaps in `app/src/mobile/inProcessTransport.ts`, which turns each verb into `backend.dispatch(...)`. Because `post` and `put` still return a `Response`, no call site changes. `writeFileChecked` reads the file, compares it with the caller's base text and writes only if they match, returning `{ conflict: true, current }` otherwise; a small window remains between the read and the write, which is acceptable with one process and one tab. `assetUrl` returns its input, `eventsUrl` returns `""`, and `base()` returns `inprocess://local`.

### The in-process backend

`createLocalBackend({ vault, memory? })` in `core/src/localBackend.ts` returns `{ dispatch, subscribe, getVersion }`. `dispatch(method, path, body)` parses the path as a URL, switches on `"<METHOD> <pathname>"` and returns plain data, not a `Response`. It keeps a lazy graph cache like the server's. Every content write ends with `emit(paths)`, which bumps the version, drops the graph so the next read rebuilds it, and calls each `subscribe` listener with `{ version, paths }`.

| Reads | Handled by |
|---|---|
| `GET /version`, `/config` | The backend's own state |
| `GET /graph`, `/graph/views` | The engine, with layouts attached, cached |
| `GET /tree` | `FileAccess.listTree` |
| `GET /vault-data` | `buildVaultRows`, the Bases feed |
| `GET /settings` | `.settings` merged over the schema defaults by the serializer the desktop server uses; an unreadable file gives the defaults |
| `GET /themes` | Each `.themes/<name>.yaml` through the theme feed; no folder means an empty feed |
| `GET /status-bar` | `.settings` parsed in place; shell segments are not run and every segment counts as trusted |
| `GET /file`, `/meta`, `/base` | The note text (`""` when absent), its frontmatter, the parsed base (404 when missing) |
| `GET /tasks`, `/cards/{decks,all,note,due}` | The task and flashcard collectors |
| `POST /rows`, `/search` | Source resolution and vault search |

| Content writes | Handled by |
|---|---|
| `PUT /file` | `FileAccess.writeNote` |
| `POST /set-property`, `/delete-property`, `/set-properties` | Frontmatter edits; the batch form groups writes per note and skips a note that has vanished |
| `POST /row/update`, `/row/delete`, `/row/reorder`, `/rows/update` | The row operations in `bases/rowOps.ts` |
| `POST /tasks/toggle` | `applyTaskToggle`, which range-checks the line number and keeps CRLF line endings |
| `POST /cards/review` | A base row when the body carries `{file, index}`, else a markdown card by `{id}` |
| `POST /replace` | `replaceInVault` |

A row update, delete or reorder whose `index` is missing or not an integer is refused with a 400, because an omitted index would otherwise append a duplicate row or delete the first one.

### Change detection

There is no `/events` stream. `inProcessTransport.eventsUrl()` returns an empty string, so no `EventSource` opens. The mobile entry calls `backend.subscribe(evt => …)` to drive refetches, with the `api.version()` poll as a backstop. The payload has the same `{ version, paths }` shape the server's stream carries, so the app's refetch logic is shared.

Source: `core/src/localBackend.ts`, `core/src/fileAccess.ts`, `app/src/api.ts`, `app/src/mobile/{bootMobile,inProcessTransport,tauriFileAccess}.ts`, `core/src/taskMigrateRun.ts`
