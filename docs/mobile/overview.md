# Mobile (iPad/iOS)

On iPad/iOS the Bun HTTP server can't run — there's no Bun process, no `Bun.serve`, no `node:fs`, no listening port. So the mobile build keeps the **exact same logic modules** (engine, bases, search, tasks, srs, frontmatter, layout) but drops the HTTP layer entirely: the WebView calls an **in-process backend** directly, and all vault IO goes through a `tauri-plugin-fs` file layer instead of `files.ts`.

Two swappable seams make this work with **zero api call-site changes**: a `FileAccess` interface (which filesystem the logic reads/writes) and a `Transport` interface (how `api.*` reaches the backend). The mobile entrypoint swaps both before the app loads; desktop never touches either and is completely unaffected.

## Why in-process

The desktop backend is a Bun server (`core/src/server.ts`) the app talks to over `http://localhost:4321`. That whole path — `Bun.serve`, `Bun.Glob`, `node:fs` — is unavailable in a WKWebView on iOS. Rather than port the logic, Bismuth keeps it and removes the transport: `core/src/localBackend.ts` exposes `dispatch(method, path, body)` that runs the same engine/bases/search/srs code the HTTP routes run, and the mobile Transport calls `dispatch` in-process instead of `fetch`ing a port.

Because nothing in the logic pipeline may statically import Bun/`node:fs` (or the WebView bundle would break), two indirections keep those out of the mobile bundle:

- **`fileAccess.ts`** — every module reads/writes the vault through a `FileAccess` interface, never `files.ts`/`Bun`/`node:fs` directly. Desktop lazily `import()`s the real `files.ts` on first use (a *dynamic* import, so `Bun.Glob` + `node:fs` stay out of the static dep graph); mobile installs a `tauri-plugin-fs` impl before the first read, so the dynamic import never fires.
- **`api.ts`** — every `api.*` verb funnels through a `Transport`. Desktop uses `httpTransport`; mobile swaps in `inProcessTransport`.

## The in-process backend — `core/src/localBackend.ts`

`createLocalBackend({ vault, memory? })` returns `{ dispatch, subscribe, getVersion }`. `dispatch(method, path, body)` parses `path` as a URL (query params included), switches on `"<METHOD> <pathname>"`, and returns **plain data** (not a `Response`). It holds a lazy graph cache mirroring the HTTP server: a mutating dispatch calls `emit(paths)`, which bumps `version`, nulls the graph so it rebuilds on the next read, and fires every `subscribe` listener with `{ version, paths }` — the mobile stand-in for SSE.

### What it covers

**Reads:**

| Route | Handler |
|---|---|
| `GET /version` | `{ version }` |
| `GET /graph` | `attachLayout(buildGraph(vault, memory), vault)` (cached) |
| `GET /graph/views` | `computeViewLayouts` over the cached graph |
| `GET /tree` | `FileAccess.listTree(vault)` |
| `GET /vault-data` | `buildVaultRows(vault)` (the Bases feed) |
| `GET /agent-graph` | `{ nodes: [], edges: [] }` — no relay on mobile |
| `GET /config` | `{ vault, memory }` |
| `GET /settings` | schema `DEFAULTS` (no `.settings` reconcile yet — see below) |
| `GET /schema` | `{ properties: {} }` |
| `GET /templates` | `[]` (needs a dir walk — follow-up) |
| `GET /file` | note text (or `""` if absent — parity with `GET /file` never 404ing) |
| `GET /meta` | `parseFrontmatter(text).data` |
| `GET /base` | `parseBaseFile(text, …)` (404 if the base file is missing) |
| `GET /tasks` | `collectVaultTasks(vault)` |
| `GET /cards/{decks,all,note,due}` | the SRS collectors |
| `POST /rows` | `resolveSource(spec, …)` (Bases source resolution) |
| `POST /search` | `searchVault(vault, query, opts)` |

**Content-only writes** (each ends by `emit([path])` to invalidate the graph + notify subscribers):

| Route | Handler |
|---|---|
| `PUT /file` | `FileAccess.writeNote` |
| `POST /set-property`, `POST /delete-property` | `setFrontmatterKey` / `deleteFrontmatterKey` then write |
| `POST /row/update`, `POST /row/delete`, `POST /row/reorder` | `upsertRow` / `deleteRow` / `reorderRow` (`bases/rowOps.ts`) |
| `POST /tasks/toggle` | `toggleTaskLine` on the target line, then `reorderTaskBlocks` |
| `POST /cards/review` | dual-mode — row review (`applyReviewToRow` + `upsertRow`) when `{file,index}`, else markdown-card review (`applyReview`) by `{id}` |
| `POST /replace` | `replaceInVault(vault, query, replacement, opts, scope)` |

### What it does NOT cover yet

These routes throw `NOT_SUPPORTED` (an `AppError` with status **501** — the in-process backend has no HTTP, so this surfaces as a thrown error, not a network response):

- **Structural filesystem ops** — `POST /create`, `POST /move`, `POST /delete`, `POST /restore` (need `FileAccess` extended with create/move/delete).
- **`POST /set-setting`** and **`POST /folder-icon`** — need a `.settings` (settings.yaml) writer; `GET /settings` currently returns bare schema defaults, so `.settings` reconcile/merge is a paired follow-up.
- **`POST /daily-note`** — daily-note materialization.
- **Binary asset upload** — `uploadAsset` (below) throws; asset bytes need `tauri-plugin-fs` + `convertFileSrc`.
- **`POST /backup`** (git snapshot) and **`POST /open-folder`** (spawning a sibling backend) — no git, no second process on device.

## The `FileAccess` seam — `core/src/fileAccess.ts`

`FileAccess` is the single IO interface the whole logic pipeline reads/writes through:

```ts
interface FileAccess {
  listMarkdown(root): Promise<string[]>;   // all .md, vault-relative
  listTree(root): Promise<TreeEntry[]>;     // md + .base + .sheet + .draw + folders
  readNote(root, rel): Promise<string>;
  writeNote(root, rel, contents): Promise<void>;
  listBases(root): Promise<string[]>;       // all .base, vault-relative
  statNote(root, rel): Promise<FileStat | null>;   // size + ms timestamps, null if vanished
  realPath(path): Promise<string>;          // canonicalize for cycle detection (best-effort)
}
```

- **`getFileAccess()`** resolves the active impl, lazily building the desktop default on first use: dynamic `import("./files")` + `import("node:fs/promises")` + `import("node:path")`, wiring `files.ts` fns and a `statNote`/`realPath` over `node:fs`. The dynamic imports keep `files.ts`, `node:fs`, `node:path` out of this module's *static* dep graph.
- **`setFileAccess(a)`** installs an override (mobile calls it at boot). Once set, `getFileAccess()` returns it and the lazy default never loads — so no Bun-coupled code enters the WebView bundle.

### The mobile impl — `app/src/mobile/tauriFileAccess.ts`

`tauriFileAccess()` backs `FileAccess` with `@tauri-apps/plugin-fs` (`readTextFile`/`writeTextFile`/`readDir`/`stat`). A recursive `walk` uses `readDir`, wrapped in try/catch (skip unreadable dirs, parity with the Bun `walkDir`) and **skips dotfiles** (`.git`/`.obsidian`/…) like desktop. `listMarkdown`/`listBases` collect by extension; `listTree` emits dirs plus files in `TREE_EXTS` (`.md`/`.base`/`.sheet`/`.draw`). `statNote` maps the plugin's `Date` fields to ms (`ctimeMs` falls back to `birthtime`). `realPath` is identity — iOS has no plugin `realpath` and cycle detection on the logical path suffices (symlink-vaults aren't a mobile concern).

The vault `root` is an absolute, **security-scoped** directory the user granted; paths are POSIX. The mobile entry starts access to the scoped resource (`startAccessingSecurityScopedResource`) before the first read.

## The `Transport` seam — `app/src/api.ts`

Every `api.*` verb routes through a `Transport`:

```ts
interface Transport {
  getJson<T>(path): Promise<T>;
  getText(path): Promise<string>;
  post(path, body): Promise<Response>;   // returns a Response — a web standard in WKWebView
  put(path, body): Promise<Response>;
  postJson<T>(path, body): Promise<T>;
  writeFileChecked(path, contents, baseText): Promise<{conflict:false} | {conflict:true; current}>;
  uploadAsset(targetPath, bytes): Promise<string>;
  assetUrl(target): string;
  eventsUrl(): string;
  base(): string;
}
```

The default is `httpTransport(BASE)` (fetch against the runtime-resolved core port, plus a boot-time connect-retry on GETs). **`setTransport(t)`** swaps it — the mobile entry passes `inProcessTransport(backend)`. Keeping the verbs identical (including `post`/`put` returning a `Response`, available in WKWebView) means **no call-site changes** when the backend moves in-process.

### The mobile impl — `app/src/mobile/inProcessTransport.ts`

`inProcessTransport(backend)` translates each verb into a `backend.dispatch(...)`:

- `getJson`/`getText`/`postJson` return the dispatch result directly.
- `post`/`put` wrap the result as a `Response` via `asResponse` (a string → `new Response(str)`, else a JSON `Response`) so callers that read `.json()`/`.text()` keep working.
- **`writeFileChecked`** implements the same optimistic-concurrency contract as HTTP (#46) **client-side**, since there are no HTTP status codes to 409 with: it `dispatch("GET", "/file")`, compares to `baseText`, and only `dispatch("PUT", "/file")` if they still match — else returns `{ conflict: true, current }`. There's a small read-then-write TOCTOU window (not atomic against `writeNote` the way the server's check is), acceptable for this single-process, single-tab mobile backend — there's no concurrent external writer racing the same vault.
- **`uploadAsset`** throws (binary IO not wired yet); **`assetUrl`** returns the target path unchanged; **`eventsUrl`** returns `""` on purpose — EventSource is not used on mobile.
- **`base()`** returns `"inprocess://local"`.

## Boot — `app/src/mobile/bootMobile.ts`

`bootMobile(opts?)` swaps both seams **before** `App`/`serverVersion` are imported, so the default HTTP path is never even constructed:

```ts
import { bootMobile } from "./mobile/bootMobile";
await bootMobile();                    // swap FileAccess + Transport
const { App } = await import("./App"); // App loads AFTER the swap
render(() => <App />, root);
```

Steps:

1. Resolve the vault — `opts.vault`, else `defaultVaultDir()`: `<documentDir>/Bismuth`, created via `mkdir({ recursive: true })` if absent.
2. `setFileAccess(tauriFileAccess())` — point the pipeline at the device filesystem.
3. `createLocalBackend({ vault, memory })` + `setTransport(inProcessTransport(backend))` — route all `api.*` through the in-process backend.

It returns `{ backend, vault }` so the caller can `backend.subscribe(...)`. Desktop's `index.tsx` never imports this module, so the desktop build is untouched.

## Change detection — `subscribe()` instead of SSE

There is no `/events` stream on mobile. `httpTransport.eventsUrl()` returns `/events`; `inProcessTransport.eventsUrl()` returns `""`, so no `EventSource` is opened. Instead the backend fires `ChangeListener`s on every mutating dispatch, and the mobile entry calls `backend.subscribe(evt => …)` to drive refetches — with the existing `api.version()` poll (the desktop resilience path) as a backstop. Same `{ version, paths }` shape the SSE payload carries, so the frontend's refetch logic is reused.

---

Source: `core/src/localBackend.ts`, `core/src/fileAccess.ts`, `app/src/api.ts`, `app/src/mobile/bootMobile.ts`, `app/src/mobile/inProcessTransport.ts`, `app/src/mobile/tauriFileAccess.ts`
