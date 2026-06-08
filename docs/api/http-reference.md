# Core HTTP API Reference

This is the complete, exhaustive reference for the Bismuth **core backend** HTTP API, defined in [`core/src/server.ts`](../../core/src/server.ts). The server is a single `Bun.serve` instance created by `createServer({ vault, memory?, port? })`. Every route is dispatched by an exact `"<METHOD> <pathname>"` string key against one of two tables — `routes` (reads) and `mutatingRoutes` (writes) — plus a special-cased `GET /terminal` WebSocket upgrade. This page documents every entry in both tables, the WS protocol, the request/response shapes, query/body params, error codes, and which routes invalidate caches / publish SSE events.

## Server fundamentals

### Dispatch and the two tables
- The fetch handler builds `route = `${req.method} ${url.pathname}`` and looks it up as `routes[route] ?? mutatingRoutes[route]`. No match → `404 "not found"`.
- **`routes`** (the "read table") — reads + a handful of POSTs that are NOT vault mutations (search, rows resolution, backup, open-folder, relay ingest, daemon writes). Handlers in this table do **not** auto-invalidate caches or publish SSE.
- **`mutatingRoutes`** — every route here is wrapped by `mutatingHandler(run, pathOf?)`, which after running the handler calls `invalidate(...paths)` (bump `version`, clear the touched caches, publish an SSE event). Never bump `version` manually in a mutating route — the wrapper does it.

### `mutatingHandler` mechanics
`mutatingHandler(run, pathOf?)` clones the request, runs `run(req, url)`, then if `pathOf` is supplied it re-parses the cloned JSON body and passes the result to `pathOf(body)`:
- `pathOf` returns `string` → invalidate that single path.
- returns `string[]` → invalidate all of them.
- returns `undefined` (or no `pathOf`, or body wasn't JSON) → `invalidate()` with **no paths** = full invalidation (`{graph:true, tree:true}`).

`invalidate(...paths)` decides dirtiness: with no paths, both graph and tree are dirty; with paths it calls `classifyVault(paths)` (re-fingerprints changed notes via wikilinks+tags+icon — a content-only edit that touches no link/tag/icon is dirty to neither graph nor tree). `applyDirty` then invalidates `graphCache`/`treeCache` (only the dirty ones), always invalidates the search index, nulls `cachedRows`/`cachedTasks`, increments `version`, and `sse.publish({ version, paths, dirty })`.

### Caches
- `graphCache` / `treeCache` — deduped async caches (concurrent first requests share one build; a mid-build invalidation won't repopulate a stale value). Warmed on boot off the critical path.
- `cachedRows` (vault feed for Bases) and `cachedTasks` (task rows) — plain lazy caches, nulled on any vault change, rebuilt on next read.
- The search index is invalidated on every vault change.

### Response helpers
- `ok(data?)` → `Response.json(data)` when `data !== undefined`, else the plain text body `"ok"` (status 200).
- `error(message, statusCode = 400)` → plain-text body with the given status.
- Thrown `AppError` is mapped to its `statusCode`; any other thrown `Error` → `500`. Error codes → status: `ENOENT`/`*_NOT_FOUND` → 404, `EACCES` → 403, `EEXIST`/`*_CONTENT_CHANGED` → 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` → 400, `INTERNAL_ERROR` → 500.

### CORS
Every response is post-processed by `withCors`, setting:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET,PUT,POST,OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

A bare `OPTIONS` request to any path returns `204`-ish (`new Response(null)`) with the CORS headers. (Verified: `OPTIONS /graph` returns `Access-Control-Allow-Origin: *` and `Methods` containing `GET`.)

### Default port
`cfg.port ?? 4321`. The CLI entrypoint reads `--vault`, `--memory` (both required) and optional `--port` (default 4321). Tests pass `port: 0` to bind an ephemeral port.

### Missing query param
`requireQueryParam(url, param)` throws `AppError("EINVAL", "missing ?<param>=", 400)` when absent → surfaces as `400`. Used by `/base` (`file`), `/file` (`path`), `/asset` (`path`), `/meta` (`path`), `/cards/note` (`path`), `POST /asset` (`path`).

---

## GET reads (`routes` table)

These do not touch caches or SSE unless noted. All return `200` on success.

### `GET /version`
- **Params:** none.
- **Response:** `{ "version": <number> }`. Monotonically non-decreasing; bumped on every mutation/file-change. The dropped-SSE fallback poll hits this.
- **Cache/SSE:** none.

### `GET /events`
- **Params:** none.
- **Response:** an SSE stream (`Content-Type: text/event-stream`, `Cache-Control: no-store`, `Connection: keep-alive`). On subscribe, if `version > 0` it immediately enqueues a snapshot frame `data: {"version":<n>,"paths":[]}\n\n` so a fresh client learns the current version without waiting. A `: keepalive\n\n` comment is sent every `server.sseHeartbeatMs` to keep the TCP connection past Bun's idle timeout.
- **Event frame shape** (published by `applyDirty`): `data: {"version":<n>,"paths":[<changed paths>],"dirty":{"graph":<bool>,"tree":<bool>}}\n\n`. (The boot snapshot frame omits `dirty`.) Graph/tree consumers skip refetching when their `dirty` flag is `false`; the editor always reconciles on a version bump.
- **Cache/SSE:** this IS the SSE stream. Cleans up the heartbeat interval + unsubscribes on cancel.
- **Gotcha:** Bun does not flush response headers until the first `enqueue`, so on a brand-new server (`version === 0`, no snapshot sent) `await fetch('/events')` can hang until the first real event — tests "prime" with a mutation first.

### `GET /graph`
- **Params:** none.
- **Response:** `GraphData` — `{ nodes: GraphNode[], edges: GraphEdge[], views?: { second?: ViewLayout, third?: ViewLayout } }`. Served from `graphCache` (built via `attachLayout(buildGraph(vault, memory), vault)` — merged 2nd+3rd brain graph with precomputed `position`/`position2d`). `views` is present only after a prior `GET /graph/views` call (it mutates the cached object in place).
  - `GraphNode`: `{ id, label, kind, state?, folder?, parent?, position?, position2d?, community?, communityLabel?, daemon? }`. `kind ∈ "note"|"memory"|"agent"|"tag"|"self"|"daemon"|"cron"|"process"`. The backend **never** emits a `self` node here (the "you" hub is injected client-side). `position` is `[x,y,z]`; `position2d` is `[x,y]`.
  - `GraphEdge`: `{ from, to, kind }`. `kind ∈ "link"|"message"|"about"|"tag"|"open"|"supervises"`.
  - Example edge: `{ from: "mem:michael-profile", to: "internship", kind: "about" }`.
- **Cache/SSE:** read-only; concurrent requests deduped via the async cache.

### `GET /graph/views`
- **Params:** none.
- **Response:** `{ second?: ViewLayout, third?: ViewLayout }` where `ViewLayout = { pos3d: Record<id,[x,y,z]>, pos2d: Record<id,[x,y]> }`. Computed lazily (`computeViewLayouts`) on the brain-mode switch.
- **Side effect:** attaches the computed `views` onto the live cached graph object **in place** (no cache invalidation), so a subsequent `GET /graph` also returns `views`. A genuine file change still rebuilds the graph fresh.

### `GET /templates`
- **Params:** none.
- **Response:** array of `{ name, path }` for `.md` files in the templates folder (`appConfig.templates.folder`, default `"Templates"`). Returns `[]` if the folder is absent. Example: `{ name: "Daily", path: "Templates/Daily.md" }`.

### `GET /tree`
- **Params:** none.
- **Response:** `TreeEntry[]` — `{ path, icon?, kind: "file"|"dir" }`. Files carry their `icon` frontmatter if present; directories get an `icon` overlaid from `settings.yaml`'s `folderIcons` map (applied per-request on a shallow copy so a folder-icon change shows without a structural tree change). Examples: `{ path: "fire.md", icon: "🔥", kind: "file" }`, `{ path: "plain.md", kind: "file" }`, `{ path: "projects", icon: "Folder", kind: "dir" }`.
- Served from `treeCache`.

### `GET /vault-data`
- **Params:** none.
- **Response:** `Row[]` — one row per note: `{ file: { name, path, tags, ... }, note: { ...frontmatter } }`. Served from `cachedRows` (lazy `buildVaultRows`). Example: a note `housing.md` yields `{ file: { name: "housing", tags: ["logistics", ...] }, note: { status: "in-progress", priority: 1, ... } }`.

### `GET /base`
- **Params:** `?file=<vault-relative path>` (required).
- **Response:** `{ config, rows }` from `parseBaseFile(text, { name, path })`. `config.views` is the parsed views array (e.g. `config.views[0].type === "calendar"`); `rows` is `Row[]` with `rows[i].note` carrying that row's data (e.g. `rows[0].note.title === "X"`).
- **Errors:** `404 "not found"` if the file is missing/unreadable (uses `readNote`, which rejects traversal and throws on a missing file — surfaced as 404 with no separate existence probe).

### `GET /file`
- **Params:** `?path=<vault-relative path>` (required).
- **Response:** the raw file text (`200`, plain body). A missing file returns an empty string with `200` (not 404). Special case: requesting `path === settings.yaml` (`SETTINGS_FILE`) first runs `reconcileSettings(vault)` so a never-initialized settings file is materialized from schema defaults before the read (so the editor never shows a blank settings page).
- **Errors:** `400` if `path` is missing.

### `PUT /file`
> Listed in the read `routes` table, NOT `mutatingRoutes`, but it explicitly calls `await invalidate(path)` itself.
- **Body:** `{ path: string, contents: string }`.
- **Action:** `writeNote(vault, path, contents)` then `invalidate(path)`.
- **Response:** `"ok"`.
- **Cache/SSE:** invalidates (bumps version, publishes SSE with the changed path) — equivalent to a mutation. Used by the frontend to save settings.yaml and arbitrary notes.

### `GET /asset`
- **Params:** `?path=<filename or vault-relative path>` (required).
- **Action:** `resolveAsset(vault, path)` resolves **filename-first** (matches a file by basename anywhere in the vault), then streams the bytes. Used by `![[file]]` embeds (images/PDF/audio/video).
- **Response:** the binary file with `Content-Type` inferred from the extension (`Bun.file`), `Cache-Control: private, max-age=60`. Falls back to `application/octet-stream` if the type is unknown.
- **Errors:** `404 "asset not found"` if unresolvable; `400` if `path` missing.

### `GET /meta`
- **Params:** `?path=<vault-relative path>` (required).
- **Response:** the note's parsed YAML frontmatter object (`parseFrontmatter(...).data`). Missing file → `{}` (empty object, 200). Example: `{ status: "in-progress", priority: 1, tags: ["logistics"] }`.
- **Errors:** `400` if `path` missing.

### `GET /config`
- **Params:** none.
- **Response:** `{ vault: <string>, memory: <string>|null }` — a read-only view of how core was launched. `memory` is `null` when not configured.

### `GET /settings`
- **Params:** none.
- **Response:** parsed app settings (file merged over `DEFAULTS`) for frontend hydration, via `serializeSettingsForFrontend`. The `properties` registry is **omitted** from this payload (it lives at `/schema`). Example fields: `appearance.theme` (default `"oxide-duotone"`), `graph.nodeSize` (default `6`).

### `GET /schema`
- **Params:** none.
- **Response:** the property registry parsed from `settings.yaml`'s `properties:` block (`getVaultSchema`), for note validation + autocomplete. Read fresh on demand — editing `settings.yaml` (via `PUT /file`) refreshes this without a restart. Example: `{ due: { type: "date" }, rating: { type: "number" } }`.

### `GET /agent-graph`
- **Params:** none.
- **Action:** `relayPrune(live)` against the live PTY set (`listSessionIds()`) — closed tabs leave no terminal-close hook, so this is where stale sessions are dropped — then `buildAgentGraph(relaySnapshot(), live)`.
- **Response:** a `GraphData`-shaped object (`{ nodes, edges }`) of the "agents" graph: you → terminal-tab sessions → subagents. Session node id pattern `agent:sess:<sessionId>` (`kind:"agent"`, `label` derived from cwd basename); subagent node id `agent:sub:<agentId>` (`kind:"agent"`, `label` = agentType, `parent` = the session node id). Session→subagent edges are `{ from, to, kind: "message" }`.
- **Cache/SSE:** none (polled by the frontend while agents mode is active).

### `GET /tasks`
- **Params:** none.
- **Response:** all vault tasks (`collectVaultTasks(vault)`) — extracted checkbox tasks with status/dates/recurrence/tags.

### `GET /cards/decks`
- **Params:** none.
- **Response:** decks with due counts (`collectDecks(vault, today)`). Example: `[{ name: "math", due: 1, ... }]`.

### `GET /cards/all`
- **Params:** none.
- **Response:** every card regardless of due date (`collectCards(vault)`).

### `GET /cards/note`
- **Params:** `?path=<vault-relative path>` (required).
- **Response:** all cards parsed from one note (`noteCards(vault, path)`). Tagless notes are fine (cards still parse).
- **Errors:** `400` if `path` missing.

### `GET /cards/due`
- **Params:** `?deck=<name>` (optional; absent → all decks).
- **Response:** due cards (`dueCards(vault, today, deck?)`). Each card has an `id` (used by `POST /cards/review`).

### `GET /daemon/status`
- **Params:** none.
- **Response:** `DaemonStatus` = `{ running: boolean, thisDeviceId: string|null, owner: Owner|null }`. `running` = `daemon.pid` exists AND that pid is alive. `owner` = `{ ownerDeviceId, ownerLabel, updatedAt }` or `null` (unclaimed). Reads claude-bot shared state under `OA_CLAUDEBOT_HOME` (env wins) / `daemon.home` setting / `~/.claude-bot`. **Never throws** (degrades to defaults).

### `GET /daemon/devices`
- **Params:** none.
- **Response:** `DeviceList` = `{ devices: DeviceEntry[], ownerDeviceId: string|null }`. `DeviceEntry = { deviceId, label, lastSeenISO, isOwner, isThis }`. Reads `devices.json`.

### `GET /daemon/graph`
- **Params:** none.
- **Response:** the daemon-mode `GraphData` (`attachLayout(daemonGraph(), "daemon")`): a `kind:"daemon"` hub node (always present, even with zero crons/processes) → `cron`/`process` child nodes, `supervises` edges. Positions (`position`/`position2d`) are attached so the WebGL renderer can place nodes; layout is cached by graph signature so polled state changes keep stable positions. **Never emits a `self` node.** Never throws (degrades to the bare hub).

### `GET /daemon/install`
- **Params:** none.
- **Response:** `InstallStatus` = `{ installed: boolean, running: boolean, daemonLabel?: string, home?: string, plistPath?: string }`. Read-only install probe bridged to the claude-bot package (`installStatus`). **Never throws / never 500** — degrades to `{ installed:false, running:false }` (the `UNKNOWN_STATUS` default) when the entrypoint can't be reached.

---

## POST in the read table (NOT mutations)

These are POSTs (or could be), but they are **not** vault mutations — they live in `routes`, so they do not auto-invalidate caches or publish SSE. The body carries the payload; the POST verb is used for request-body semantics, not because they write the vault.

### `POST /rows`
- **Body:** `{ spec: SourceSpec }` where `SourceSpec` is one of:
  - `{ kind: "base", ref }` — render another base (recursive composition).
  - `{ kind: "notes", where?, from? }` — vault notes filtered by a Bases expr; `from: "[[Base]]"` scopes to that base's notes.
  - `{ kind: "tasks", where?, from? }` — checkbox tasks; `from: "[[Base]]"` scopes extraction to that base's notes (no `from` = global).
- **Action:** `resolveSource(spec, { root: vault, today, vaultRows, vaultTasks })`. Providers are memoized per-call (`getCachedRows` / `getCachedTasks`, built at most once per `/rows`); scoped task extraction bypasses the cache and runs fresh.
- **Response:** `Row[]`. Example: `{ spec: { kind: "tasks", from: "[[Keep]]" } }` → only the tasks inside the `Keep` base's scoped notes (`rows.map(r => r.note.description)` = `["scoped task"]`). `{ spec: { kind: "notes", where: 'file.hasTag("book")' } }` returns the matching note rows from the shared cache (invalidated by a file change so a newly-tagged note appears on the next call).
- **Cache/SSE:** none (read-only despite POST). See [bases overview](../bases/overview.md).

### `POST /search`
- **Body:** `{ query: string, opts: { caseSensitive: boolean, wholeWord: boolean, regex: boolean } }`.
- **Action:** `searchVault(vault, query, opts)` (Omnisearch-style ranking).
- **Response:** `SearchResult[]` = `{ path, matchCount, snippets: MatchSnippet[] }[]`.
- **Errors:** an invalid regex (etc.) is caught and returned as `400` with the error message (so the UI shows it inline) — NOT a 500.
- **Cache/SSE:** none.

### `POST /backup`
- **Body:** none.
- **Action:** `commitVault(vault, snapshotMessage())` — a git snapshot of the vault.
- **Response:** `{ committed: boolean }` (`false` when there was nothing to commit).
- **Cache/SSE:** none.

### `POST /open-folder`
- **Body:** `{ folder: string, memory?: string }`. `memory` defaults to this server's `cfg.memory`.
- **Action:** spawns a sibling core server pointed at `folder` (process-per-vault, like Obsidian) via `spawnVaultBackend`.
- **Response:** `{ url: <new server URL>, vault: <resolved folder> }`. The frontend opens a window with `?api=<url>`.
- **Errors:** `AppError("EINVAL", "no memory dir configured", 400)` if neither a body `memory` nor `cfg.memory` is set.
- **Cache/SSE:** none (read-only w.r.t. THIS vault — only launches a new process).

### Relay ingest (`POST /relay/*`)
Posted by the relay plugin's hooks loaded per-session inside app terminals. They update the in-process agent registry — **not** the vault — so they live in the read table (no cache invalidation). All are best-effort; a `400` is silently swallowed client-side. All return `{ ok: true }` on success.

- **`POST /relay/session`** — body `{ sessionId?, terminalId?, cwd? }`. `registerSession(...)`. `400 "missing sessionId/terminalId"` if either is absent. (`cwd` defaults to `""`.)
- **`POST /relay/session/end`** — body `{ sessionId? }`. `endSession(sessionId)`. `400 "missing sessionId"` if absent.
- **`POST /relay/subagent/start`** — body `{ parentSessionId?, agentId?, agentType? }`. `startSubagent(...)`; `agentType` defaults to `"agent"`. `400 "missing parentSessionId/agentId"` if either is absent.
- **`POST /relay/subagent/stop`** — body `{ agentId?, lastMessage? }`. `stopSubagent(...)`. `400 "missing agentId"` if absent.

### Daemon system actions / writes (read table)
These mutate the claude-bot daemon's shared on-disk files (NOT the vault), so they live in the read table with **no vault-cache invalidation** (the frontend re-polls `/daemon/graph`).

- **`POST /daemon/setup`** — body none. `runSetup()` (idempotent, adopt-only). Response `SetupResult` = `{ action, status: InstallStatus }` (`action` is a string like `"adopted"`). Surfaces a real error (500) if the entrypoint can't be resolved or the subprocess fails — but it must NOT 404 and must NOT bump the vault version.
- **`POST /daemon/cron/toggle`** — body `{ name?, enabled? }`. `setCronEnabled(name, enabled)` (rewrites the `enabled` frontmatter in `<home>/crons/<name>.md`). Response `{ ok: true }`. `400 "missing name/enabled"` if `name` absent or `enabled` not a boolean. Unknown name → `setCronEnabled` throws `AppError("ENOENT")` → `404` via the dispatch catch.
- **`POST /daemon/cron/run`** — body `{ name? }`. `runCron(name)` (drops a trigger file the daemon polls). Response `{ ok: true }`. `400 "missing name"` if absent. Unknown name → `404`.
- **`POST /daemon/process/toggle`** — body `{ name?, enabled? }`. `setProcessEnabled(name, enabled)`. Response `{ ok: true }`. `400 "missing name/enabled"` on bad input; unknown name → `404`.

### `POST /asset`
> Listed in the read table — uploading an attachment is NOT a graph/tree/search mutation (attachments are excluded from those caches; the subsequent note edit that inserts the embed triggers its own invalidation).
- **Params:** `?path=<desired vault-relative path under the attachments folder>` (required).
- **Body:** the raw attachment bytes.
- **Action:** validates the target with `isSafeAssetTarget` (rejects empty/`.`/`..`/dot-prefixed segments — blocks writing into `.git/`, `.obsidian/`, etc.), enforces a 100 MB cap (`MAX_ASSET_BYTES`, checked against both `Content-Length` and the actual byte length), de-collides the filename (`uniqueAssetPath`, never overwrites), and `writeBinary(...)`.
- **Response:** `{ path: <final relative path actually used> }` so the caller inserts the right `![[basename]]`.
- **Errors:** `400 "invalid attachment path"` (unsafe target) or `400 "missing ?path="`; `413 "attachment too large"` (over 100 MB).
- **Cache/SSE:** none.

---

## POST mutations (`mutatingRoutes` table)

Every route here is wrapped by `mutatingHandler`. After the handler runs, the wrapper invalidates the path(s) returned by its `pathOf` (or fully, if `pathOf` is absent / returns `undefined`), bumping `version` and publishing an SSE event. The `pathOf` for each route is noted below. All return `200` on success (`"ok"` text or a JSON body).

### `POST /replace`
- **Body:** `{ query: string, replacement: string, opts: { caseSensitive, wholeWord, regex }, scope: string }`.
- **Action:** takes a git snapshot FIRST (`commitVault`, the undo path), then `replaceInVault(...)`.
- **Response:** the `replaceInVault` result JSON. An invalid regex etc. is returned as `400` with the message.
- **`pathOf`:** `scope` when it's a single-file path (`scope && scope !== "vault"`); for a vault-wide replace it returns `undefined` → full invalidation.

### `POST /move`
- **Body:** `{ from: string, to: string }`.
- **Action:** `moveEntry(vault, from, to)`.
- **Response:** `"ok"`.
- **`pathOf`:** `[from, to]` (both invalidated).
- **Used for:** rename + move in the file tree.

### `POST /delete`
- **Body:** `{ path: string }`.
- **Action:** `deleteEntry(vault, path)` (moves into `.trash/<timestamp>-<basename>`).
- **Response:** `{ trashPath: string }` — the trash location, used by `/restore`.
- **`pathOf`:** `path`.

### `POST /restore`
- **Body:** `{ trashPath: string, to: string }`.
- **Action:** `moveEntry(vault, trashPath, to)` (move it back out of `.trash`).
- **Response:** `"ok"`.
- **`pathOf`:** `to`.

### `POST /create`
- **Body:** `{ path: string, kind: "file" | "dir" }`.
- **Action:** `createEntry(vault, path, kind)`.
- **Response:** `"ok"`.
- **Errors:** `409` on collision (creating an existing path).
- **`pathOf`:** `path`.

### `POST /set-setting`
- **Body:** `{ path: string[], value: unknown }` — `path` is an **array** of key segments (e.g. `["appearance", "editorFont"]`). The single backend write path for `settings.yaml`: merges one value in place, preserving comments, the `properties` registry, and unknown keys. Serialized via a per-vault write mutex (concurrent writes to different keys don't clobber each other).
- **Response:** `{ ok: true }`.
- **Errors:** `400 "bad path"` if `path` is not an array of strings (e.g. passing the dotted string `"appearance.theme"` → 400).
- **`pathOf`:** constant `SETTINGS_FILE` (`"settings.yaml"`) so subscribers re-hydrate.

### `POST /set-property`
- **Body:** `{ path: string, key: string, value: unknown }`.
- **Action:** flips a single frontmatter key on a note (used by Bases kanban drag-drop). Preserves other keys.
- **Response:** `"ok"`.
- **Errors:** `404 "note not found"` if the path doesn't exist — it does NOT silently create the note.
- **`pathOf`:** `path`.

### `POST /delete-property`
- **Body:** `{ path: string, key: string }`.
- **Action:** removes a single frontmatter key (e.g. resetting a note's icon). Sibling keys preserved. Removing the **last** frontmatter key drops the whole `---` block (no empty fence left).
- **Response:** `"ok"`.
- **Errors:** `404 "note not found"` if the path doesn't exist.
- **`pathOf`:** `path`.

### `POST /row/update`
- **Body:** `{ file: string, index: number | null, note: Record<string, unknown> }`. `index === null` → **append** a new row; otherwise replace the row at `index`.
- **Action:** `upsertRow(text, { name, path: file }, index ?? null, note)` then `writeNote`.
- **Response:** `"ok"`.
- **`pathOf`:** `file`.

### `POST /row/delete`
- **Body:** `{ file: string, index: number }`.
- **Action:** `deleteRow(text, { name, path: file }, index)` then `writeNote`. (Reads the file with `readNote`, so a missing file → 404.)
- **Response:** `"ok"`.
- **`pathOf`:** `file`.

### `POST /row/reorder`
- **Body:** `{ file: string, from: number, to: number }`.
- **Action:** `reorderRow(text, { name, path: file }, from, to)` then `writeNote`.
- **Response:** `"ok"`.
- **`pathOf`:** `file`.

### `POST /folder-icon`
- **Body:** `{ path: string, icon?: string | null }`. Folders have no frontmatter, so the mapping lives in `settings.yaml`'s `folderIcons` and is overlaid onto `/tree` dir entries.
- **Action:** `setFolderIcon(vault, path, icon ?? "")`. An empty/`null` icon **removes** a previously-set folder icon.
- **Response:** `"ok"`.
- **Errors:** `400 "missing path"` if `path` is empty/non-string; `400 "invalid path"` for absolute or traversal paths (`startsWith("/")`, or a `..`/`.` segment).
- **`pathOf`:** constant `"settings.yaml"` → `classifyVault` marks both graph & tree dirty (so the sidebar refetches).

### `POST /tasks/toggle`
- **Body:** `{ path: string, line: number }` (`line` is 0-based).
- **Action:** rewrites the markdown task line via `toggleTaskLine(line, today)`. For a recurring task, the toggle returns TWO lines (the next occurrence inserted above the completed one, separated by `\n`), spliced back as a single array slot so order is preserved after `join("\n")`.
- **Response:** `"ok"`.
- **Errors:** `AppError("EINVAL", "line out of range", 400)` if `line < 0 || line >= lines.length`.
- **`pathOf`:** `path`.

### `POST /cards/review`
Dual-mode SRS review.
- **Body (row-based, flashcard base):** `{ file: string, index: number, response: ReviewResponse, dueField?, easeField?, intervalField? }`. When `file != null && index != null`, advances the scheduling columns on row `index` of the base file via `applyReviewToRow(row.note, response, today, appConfig.srs, fields?)`. Pass the `*Back` triple (`dueField`/`easeField`/`intervalField`) for a bidirectional reverse review (each direction schedules independently); default is the forward columns. Errors: `AppError("EINVAL", "row not found: <file>#<index>", 400)` if the row index is out of range.
- **Body (legacy markdown card):** `{ id: string, response: ReviewResponse, question? }`. `id` is `"${notePath}::${cardIndex}::${subIndex}"`. Calls `applyReview(vault, id, response, today, question, appConfig.srs)` — rewrites the inline `<!--SR:...-->` schedule comment.
- **`response`** is a `ReviewResponse` (e.g. `"good"`).
- **Response:** `"ok"`.
- **Errors:** `400 "missing cardId"` if neither row coords nor `id` are supplied; `404` for an unknown markdown card id (e.g. `m.md::99::0`).
- **`pathOf`:** `file` — row-based reviews invalidate the base file; legacy markdown reviews leave `pathOf` returning `undefined` → full invalidation.

### `POST /daily-note`
- **Body:** `{ id: string }` — the id of a daily-note config in `settings.yaml`'s `dailyNotes:` list.
- **Action:** computes today's path (`dailyNotePath(config, now)`). If it already exists, returns it **without** clobbering; otherwise creates it from the configured template (`dailyNoteContent`).
- **Response:** `{ path: string, created: boolean }` — `created: true` on first creation, `false` when reopening an existing note. Example created path: `Journal/2026-06-07 journal.md`.
- **Errors:** `400 "unknown daily note: <id>"` for an unknown id.
- **`pathOf`:** none passed → full invalidation.

### `POST /daemon/owner`
- **Body:** `{ deviceId: string }`.
- **Action:** `setOwner(deviceId)` — writes `owner.json` byte-compatibly with what the daemon reads. owner.json lives OUTSIDE the vault.
- **Response:** the new `Owner` = `{ ownerDeviceId, ownerLabel, updatedAt }` (exactly these three keys). A follow-up `GET /daemon/status` reflects it.
- **Errors:** `400` (with the message) when `deviceId` is missing/empty, or when `setOwner` throws because the device isn't a known, heartbeating device (e.g. `deviceId: "nope"`).
- **`pathOf`:** constant `"::daemon-owner"` (a non-vault sentinel) so the path-derived invalidation is effectively a no-op for graph/tree.

---

## WebSocket: `GET /terminal`

A special-cased upgrade handled before the route tables. Backs the in-app terminal tabs (xterm.js ↔ `bun-pty` via `core/src/terminal.ts`).

### Upgrade request
- **Method/path:** `GET /terminal`.
- **Query params (required):** `?cols=<int>&rows=<int>`. Both must be integers in `1..500`; otherwise `400 "bad cols/rows"`.
- **Origin policy:** allowed when there is **no** `Origin` header (same-origin / Tauri webview), or the origin matches `http(s)://localhost|127.0.0.1[:port]`, `tauri://...`, or `http(s)://10.x.x.x[:port]`. Otherwise `403 "forbidden origin"`.
- On upgrade, `createTerminalSession({ cwd: vault, cols, rows, relayPort: server.port })` is created (the session reports relay provenance to THIS server's port so in-tab Claude sessions reach the right core). If the upgrade fails, the session is killed and `400 "upgrade failed"` is returned. Success returns the Bun-managed `101`.

### Message protocol (client → server)
Binary/text frames where the **first byte is a tag**:
- **tag `0x00`** — terminal input: the remaining bytes (`subarray(1)`, UTF-8 decoded) are written to the PTY.
- **tag `0x01`** (and length ≥ 5) — resize: bytes 1..4 are two little-endian `Uint16`s — `cols` (offset 0) then `rows` (offset 2) — passed to `resizeSession`.
- Zero-length frames are ignored.

### Server → client
On `open`, the server pipes `pty.onData(d)` → `ws.send(encode(d))` (raw terminal output bytes). On `pty.onExit`, the socket is closed.

### Lifecycle
On `close`, the PTY data/exit listeners are disposed immediately (so no `ws.send` hits a closed socket), then `killSession` is scheduled after a **3000ms** grace period (absorbs kernel/network races; there is no resume in v1).

---

## Quick route index

| Method | Path | Table | Invalidates / SSE |
|---|---|---|---|
| GET | `/version` | read | no |
| GET | `/events` | read | (is the SSE stream) |
| GET | `/graph` | read | no |
| GET | `/graph/views` | read | no (mutates cached graph in place) |
| GET | `/templates` | read | no |
| GET | `/tree` | read | no |
| GET | `/vault-data` | read | no |
| GET | `/base` | read | no |
| GET | `/file` | read | no |
| PUT | `/file` | read | **yes** (calls `invalidate(path)`) |
| GET | `/asset` | read | no |
| POST | `/asset` | read | no |
| GET | `/meta` | read | no |
| GET | `/config` | read | no |
| GET | `/settings` | read | no |
| GET | `/schema` | read | no |
| GET | `/agent-graph` | read | no |
| POST | `/relay/session` | read | no |
| POST | `/relay/session/end` | read | no |
| POST | `/relay/subagent/start` | read | no |
| POST | `/relay/subagent/stop` | read | no |
| GET | `/tasks` | read | no |
| POST | `/rows` | read | no |
| POST | `/backup` | read | no |
| POST | `/open-folder` | read | no |
| POST | `/search` | read | no |
| GET | `/cards/decks` | read | no |
| GET | `/cards/all` | read | no |
| GET | `/cards/note` | read | no |
| GET | `/cards/due` | read | no |
| GET | `/daemon/status` | read | no |
| GET | `/daemon/devices` | read | no |
| GET | `/daemon/graph` | read | no |
| GET | `/daemon/install` | read | no |
| POST | `/daemon/setup` | read | no |
| POST | `/daemon/cron/toggle` | read | no |
| POST | `/daemon/cron/run` | read | no |
| POST | `/daemon/process/toggle` | read | no |
| POST | `/replace` | mutating | yes |
| POST | `/move` | mutating | yes (from+to) |
| POST | `/delete` | mutating | yes |
| POST | `/restore` | mutating | yes (to) |
| POST | `/create` | mutating | yes |
| POST | `/set-setting` | mutating | yes (settings.yaml) |
| POST | `/set-property` | mutating | yes |
| POST | `/delete-property` | mutating | yes |
| POST | `/row/update` | mutating | yes |
| POST | `/row/delete` | mutating | yes |
| POST | `/row/reorder` | mutating | yes |
| POST | `/folder-icon` | mutating | yes (settings.yaml) |
| POST | `/tasks/toggle` | mutating | yes |
| POST | `/cards/review` | mutating | yes |
| POST | `/daily-note` | mutating | yes (full) |
| POST | `/daemon/owner` | mutating | yes (no-op scope) |
| GET | `/terminal` | (WS upgrade) | n/a |

Source: core/src/server.ts, core/src/sse.ts, core/test/server.test.ts, core/src/graph.ts, core/src/daemon.ts, core/src/search.ts, core/src/claudebot.ts, core/src/files.ts
