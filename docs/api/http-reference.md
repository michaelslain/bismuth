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

### `GET /chat/sessions`
- **Params:** none.
- **Action:** `listChatSessions(cfg.vault)`. The SDK's session store unifies the user's **terminal Claude Code sessions AND in-app chat sessions** for the vault cwd — so this picker surfaces both.
- **Response:** `{ sessions: [...] }` — the past Claude Code sessions for this vault, for the chat history picker (the client resumes one by sending `{type:"resume",sessionId}` over the `/chat` WS).
- **Cache/SSE:** none.

### `GET /chat/session-messages`
- **Params:** `?id=<sessionId>` (optional; absent/empty → empty replay).
- **Action:** `sessionHistoryFrames(id, cfg.vault)` when `id` is present, else `[]`.
- **Response:** `{ frames: ChatFrame[] }` — one past session replayed **in order** as the same `ChatFrame`s the live `/chat` WS streams, so the client can rehydrate the transcript before binding/resuming it.
- **Cache/SSE:** none.

### `GET /gcal/status`
- **Params:** none.
- **Action:** `gcalStatus()` — reads the durable Google Calendar store (kept **outside** the vault, `~/.bismuth/gcal`).
- **Response:** `GcalStatus` = `{ connected: boolean, needsCredentials: boolean, account?: string, timeZone?: string, connectedAt?: string }`. `connected` = a refresh token is stored; `needsCredentials` = the OAuth client id/secret haven't been supplied yet.
- **Cache/SSE:** none. (These `/gcal/*` reads are SYSTEM actions, not vault mutations — like `/daemon/*` they live in the read table.)

### `GET /gcal/callback`
> The OAuth loopback redirect target. Google sends the user's browser here as a **top-level navigation** (not `fetch` → no CORS); `POST /gcal/auth/start` builds the redirect URI as `http://127.0.0.1:<this server's port>/gcal/callback`.
- **Params:** `?code=<auth code>&state=<state>` on success, or `?error=<reason>` on cancel/denial.
- **Action:** on `code`+`state`, `gcalCompleteAuth(code, state)` exchanges the code (Authorization Code + PKCE) and persists the refresh token.
- **Response:** a small self-contained **HTML page** (`text/html`, status 200) — a green checkmark "Connected as `<account>`…" on success, or a red ✕ with the error/missing-code message. The message text is HTML-escaped. (Never JSON — it's rendered in the system browser.)
- **Cache/SSE:** none.

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

### `GET /bismuth/install`
- **Params:** none.
- **Response:** `BismuthStatus` = `{ installed: boolean, version: string|null, cliPath: string|null, cliLinked: boolean, mcpRegistered: boolean }` — read-only status of the **machine-wide** `bismuth` CLI + MCP install (`getBismuthStatus`, `core/src/bismuthInstall.ts`). `installed` = a version marker exists at `~/.bismuth/.version`; `version` is its stored content hash; `cliPath`/`cliLinked` describe the CLI symlink on PATH; `mcpRegistered` = `claude mcp get bismuth` succeeds. **Never throws.** See [machine-wide install](../mcp/overview.md).

### `GET /update/status`
- **Params:** none.
- **Response:** `UpdateStatus` = `{ available: boolean, behind: number, localSha: string|null, remoteSha: string|null, builtSha: string|null, dirty: boolean, reason?: string }` — the git-based self-update probe (`getUpdateStatus`, `core/src/selfUpdate.ts`). Best-effort `git fetch origin main`, then compares `HEAD..origin/main`. `available` = `behind > 0`. **Self-disables** (returns `available:false` + a `reason`) when this isn't a bundled source build: `"not-a-source-build"` (no `build-origin.json` / `OA_BISMUTH_INSTALL_SRC` unset — e.g. `bun run dev`), `"not-a-git-repo"`, or `"no-upstream"`. **Never throws.** See [self-update](../overview/self-update.md).

### `GET /update/progress`
- **Params:** none.
- **Response:** `UpdateProgress` = `{ phase: "idle"|"pulling"|"building"|"ready"|"error", message?: string, log?: string }` — the in-memory state of the current/last self-update run (`getUpdateProgress`). Polled by `UpdateBanner.tsx` after `POST /update/apply`. `log` carries the tail of git/build stderr on failure. **Never throws.**

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

### `POST /list-dir`
- **Body:** `{ path?: string, only?: "dir" | "file" }`. `path` is the partial filesystem path the user is typing (absolute or `~`-relative); `only` narrows to dirs or files.
- **Action:** `listFsPaths(path, only)` (`core/src/fsPaths.ts`) — `readdir`s the parent of `path` and returns matching children, display paths preserving the `~`/`/` form. Backs `scope: "fs"` settings autocomplete (e.g. `daemon.home`).
- **Response:** `{ entries: { path: string, kind: "file" | "dir" }[] }` (dirs first, then alpha; capped client-side at 50). A missing/unreadable parent or relative `path` → `{ entries: [] }`.
- **Cache/SSE:** none (read-only despite POST).

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
- **`POST /daemon/update`** — body none. `runUpdate()` spawns claude-bot's `bin/update.ts` (no flag): `git pull --ff-only` + `bun install` + restart the daemon (claude-bot's own `restartDaemon` — Bismuth never calls launchctl). Idempotent — `"up-to-date"` when already at `origin/main`. Response `UpdateResult` = `{ action: "updated"|"up-to-date"|"would-update"|"no-remote", from?, to?, restarted?, warnings? }`. System action, not a vault mutation. See [claude-bot install](../claude-bot/install.md).
- **`POST /daemon/cron/toggle`** — body `{ name?, enabled? }`. `setCronEnabled(name, enabled)` (rewrites the `enabled` frontmatter in `<home>/crons/<name>.md`). Response `{ ok: true }`. `400 "missing name/enabled"` if `name` absent or `enabled` not a boolean. Unknown name → `setCronEnabled` throws `AppError("ENOENT")` → `404` via the dispatch catch.
- **`POST /daemon/cron/run`** — body `{ name? }`. `runCron(name)` (drops a trigger file the daemon polls). Response `{ ok: true }`. `400 "missing name"` if absent. Unknown name → `404`.
- **`POST /daemon/process/toggle`** — body `{ name?, enabled? }`. `setProcessEnabled(name, enabled)`. Response `{ ok: true }`. `400 "missing name/enabled"` on bad input; unknown name → `404`.

### Machine-wide install / self-update (read table)
These run system actions (filesystem + git + `claude mcp` + a rebuild) but are **not** vault mutations, so they live in the read table with no vault-cache invalidation. All never throw.

- **`POST /bismuth/install`** — body none. `ensureBismuthInstalled(process.env.OA_BISMUTH_INSTALL_SRC)` — the idempotent, version-gated machine-wide install of the `bismuth` CLI + MCP from the bundled tools resource (`core/src/bismuthInstall.ts`). Response `InstallResult` = `{ action, status: BismuthStatus, warnings: string[] }`, where `action` ∈ `"up-to-date"` | `"installed"` | `"updated"` | `"would-install"` | `"would-update"` | `"skipped-no-src"`. A no-op (`"up-to-date"`) when the bundled-binary content hash matches `~/.bismuth/.version` AND the CLI symlink + MCP registration are present; `"skipped-no-src"` when `OA_BISMUTH_INSTALL_SRC` is unset / incomplete (the dev case). See [machine-wide install](../mcp/overview.md).
- **`POST /update/apply`** — body none. `startUpdate()` (`core/src/selfUpdate.ts`) — starts the git self-update and **returns immediately** with the initial `UpdateProgress` (the heavy `git pull` + `bun run tauri build` runs in the background; poll `GET /update/progress`). Idempotent while a run is in flight (returns the current `state`). Guards: returns `phase:"error"` when not a bundled source build, when the repo has uncommitted changes (`dirty`), and `phase:"idle"` when already up to date. See [self-update](../overview/self-update.md).

### Google Calendar OAuth (read table)
These drive the Google Calendar OAuth flow + connection lifecycle. All secrets and tokens live **outside** the vault (`~/.bismuth/gcal`), so these are SYSTEM actions, not vault mutations — they live in the read table with **no** cache-invalidation. The single requested OAuth scope is `calendar.events` (events read+write only; no Gmail/Drive/contacts). The two-way *sync* itself (`POST /gcal/sync`) IS a vault mutation — see below.

- **`POST /gcal/credentials`** — body `{ clientId, clientSecret }`. `gcalSetCredentials(...)` stores the OAuth client id + secret in the durable store outside the vault (the secret never enters `settings.yaml`/git). Sent once from the connect modal. Response `{ ok: true }`. `400 "missing clientId/clientSecret"` if either is absent.
- **`POST /gcal/auth/start`** — body none. Builds `redirectUri = http://127.0.0.1:<server.port>/gcal/callback` (Google desktop clients accept any 127.0.0.1 port, so the callback lands back on THIS backend) and returns `gcalStartAuth(redirectUri)`. Response `{ url: <Google consent URL> }` for the frontend to open in the system browser. A thrown error (e.g. credentials not set) → `400` with the message.
- **`POST /gcal/disconnect`** — body none. `gcalDisconnect()` clears the stored tokens. Response `{ ok: true }`.

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
- **Body:** `{ path: string, line: number, status?: string }` (`line` is 0-based). With an explicit `status` (the right-click status menu) the line's box char is set to exactly that value (`setTaskLineStatus(line, status, today)`); without it, it's the plain binary toggle (checkbox click — `toggleTaskLine(line, today)`).
- **Action:** rewrites the markdown task line. For a recurring task, the rewrite returns TWO lines (the next occurrence inserted above the completed one, separated by `\n`), spliced back as a single array slot so order is preserved after `join(eol)` (`\r\n`/`\n` matched to the file's existing line endings). The whole file is then passed through `reorderTaskBlocks` so resolved (done/cancelled) tasks sink to the bottom of their list.
- **Response:** `"ok"`.
- **Errors:** `AppError("EINVAL", "line out of range", 400)` if `line < 0 || line >= lines.length`.
- **`pathOf`:** `path`.

### `POST /tasks/archive`
- **Body:** `{ path?: string }` (a missing/non-JSON body is tolerated → treated as `{}`). With a `path`, only that note is archived; without one, the whole vault (`listMarkdown`, every `.md`).
- **Action:** `archiveResolvedTasks(...)` strips completed/cancelled tasks from the note text, rewriting only files that actually changed (`removed > 0`). Removal is permanent (git history retains the prior state via the autosave snapshots).
- **Response:** `{ removed: number, files: number }` — total tasks removed and the number of files touched. Single-`path` form returns `files: removed > 0 ? 1 : 0`.
- **`pathOf`:** the body's `path` (single-note archive invalidates just that note; a vault-wide archive passes `undefined` → full invalidation).

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

### `POST /gcal/sync`
> Unlike the other `/gcal/*` routes (read table, system actions), the actual two-way sync **rewrites the calendar base file**, so it IS a vault mutation and lives in `mutatingRoutes`.
- **Body:** `{ basePath?: string }` (missing/non-JSON body tolerated → `{}`). A manual "Sync now" from the per-calendar modal may pass an explicit `basePath` so it targets the right calendar immediately, without waiting for the debounced `settings.yaml` write to round-trip into `appConfig`.
- **Action:** resolves sync args from `appConfig.googleCalendar` (`gcalSyncArgs`): `basePath` (override or `googleCalendar.basePath`), `calendarId` (default `"primary"`), `policy` (`conflictPolicy`, default `"lastWriteWins"`), `timeZone`, and the appearance `theme`. Then `gcalSync(...)` reconciles the configured Google calendar with the configured calendar base in **both directions** (last-write-wins). A thrown sync error → `400` with the message.
- **Response:** the `gcalSync` result JSON.
- **Errors:** `400 "set googleCalendar.basePath to the calendar base you want to sync"` when no base path is configured (neither body override nor `appConfig.googleCalendar.basePath`).
- **`pathOf`:** `appConfig.googleCalendar?.basePath || undefined` — invalidates the base file (graph/tree per `classifyVault` + SSE re-render of the open calendar); a sync with no configured base falls through to `undefined` → full invalidation.

#### Auto-sync ticker
Separately from the manual route, `createServer` installs an **unref'd 60s `setInterval`** that auto-syncs when `appConfig.googleCalendar.enabled` is set, a `basePath` is configured, `gcalStatus().connected` is true, and at least `max(1, syncIntervalMinutes || 15)` minutes have elapsed since the last run. A `gcalAutoSyncRunning` run-guard prevents overlap; failures are logged (`[gcal] auto-sync failed: …`) and swallowed. It's a no-op in tests (`googleCalendar.enabled` defaults to `false`) and the unref'd timer never keeps the process alive. This is the same `gcalSyncArgs(appConfig)` path as the manual route, just driven by settings.

---

## WebSocket: `GET /chat`

A special-cased upgrade handled before the route tables (alongside `GET /terminal`). Drives the **headless Claude Code chat driver** (`core/src/chat.ts`) — the in-app visual Claude chat — over a text-JSON protocol.

### Upgrade request
- **Method/path:** `GET /chat`.
- **Query params:** optional `?chatId=<stable id>`. A client passes a stable `chatId` to resume conversation continuity across reconnects; absent → one is generated (`newChatId()`).
- **Origin policy:** the SAME allow-list as `/terminal` — allowed with no `Origin` header (same-origin / Tauri webview), or an origin matching `http(s)://localhost|127.0.0.1[:port]`, `tauri://...`, or `http(s)://10.x.x.x[:port]`; otherwise `403 "forbidden origin"`.
- This is a read-path upgrade (not a vault mutation). On a failed `server.upgrade`, returns `400 "upgrade failed"`; success returns the Bun-managed `101`. The socket carries `{ kind: "chat", chatId }`.

### Message protocol (client → server)
Text JSON frames (`ChatFrame` inputs), discriminated by `type`:
- **`{type:"user",text}`** — run a turn (slash commands are just text). On a brand-new chat this binds the session's sink via `chatSend(chatId, text, vault, sink)`.
- **`{type:"resume",sessionId}`** — bind this chat socket to an existing Claude Code session (`chatResume`); its init manifest streams back and the next `{type:"user"}` continues the resumed conversation. (Sessions come from `GET /chat/sessions`; transcript from `GET /chat/session-messages`.)
- **`{type:"permission_response",id,behavior,always?}`** — answer a "permission" frame; `behavior` must be `"allow"` or `"deny"`, `always` defaults `false` (`chatRespondPermission`).
- **`{type:"set_permission_mode",mode}`** — switch permission mode live (`chatSetPermissionMode`).
- **`{type:"set_model",model}`** — switch model live (`chatSetModel`).
- **`{type:"stop"}`** — interrupt the in-flight turn (`chatAbort`).

Frames may arrive as text or binary (decoded UTF-8); a frame that doesn't parse as JSON, or whose `type`/fields don't match one of the above, is silently ignored.

### Server → client
`ChatFrame`s stream back via the session's sink — `ws.send(JSON.stringify(frame))` (each frame is the same shape `GET /chat/session-messages` replays). On `open`, the server **rebinds the sink** (`chatRebindSink`) to THIS socket: a reconnect (same `chatId`) mid-turn re-points the live session's sink here so in-flight drain frames (the turn's tail + `done`) flow to the new socket instead of the dead one. A brand-new chat has no session yet, so rebind is a no-op until the first `{type:"user"}`.

### Lifecycle
On `close`:
- **Clean close** (code `1000`) — intentional tab-close → tear the session down now (`closeChat(chatId)`).
- **Abnormal close** (reload `1001`, network drop `1006`, etc.) — keep the session alive for a **30000ms** grace window (`scheduleChatClose(chatId, 30_000)`) so a reconnect with the same `chatId` resumes the same `claude` conversation instead of spawning a fresh one. The next `sendMessage` cancels the pending close.

---

## WebSocket: `GET /terminal`

A special-cased upgrade handled before the route tables. Backs the in-app terminal tabs (xterm.js ↔ `bun-pty` via `core/src/terminal.ts`).

### Upgrade request
- **Method/path:** `GET /terminal`.
- **Query params:** `?cols=<int>&rows=<int>` (required; both must be integers in `1..500`, otherwise `400 "bad cols/rows"`), plus an optional `?termId=<stable id>` used for reattach (see below).
- **Origin policy:** allowed when there is **no** `Origin` header (same-origin / Tauri webview), or the origin matches `http(s)://localhost|127.0.0.1[:port]`, `tauri://...`, or `http(s)://10.x.x.x[:port]`. Otherwise `403 "forbidden origin"`.
- **Session resolution (reattach / pool / spawn):**
  - **Reattach** — if `termId` names a still-alive PTY (`getSessionByTermId`, within the post-disconnect grace window), the upgrade pipes to the SAME shell — preserving the running process, cwd, and env. Its pending kill timer is cancelled (`cancelSessionKill`) and it's resized to the new `cols`/`rows`.
  - **Pooled** — otherwise a pre-warmed shell is claimed from the pool (`claimPooledSession`) so the tab paints its already-rendered prompt instantly.
  - **Fresh** — falling back to `createTerminalSession({ cwd: vault, cols, rows, relayPort: server.port, termId })` (the session reports relay provenance to THIS server's port so in-tab Claude sessions reach the right core).
- On a failed `server.upgrade`, a freshly-created session is killed immediately; a reattached live shell is never hard-killed (its grace timer reclaims it if no socket reconnects) — either way `400 "upgrade failed"` is returned. Success returns the Bun-managed `101`.

### Message protocol (client → server)
Binary/text frames where the **first byte is a tag**:
- **tag `0x00`** — terminal input: the remaining bytes (`subarray(1)`, UTF-8 decoded) are written to the PTY.
- **tag `0x01`** (and length ≥ 5) — resize: bytes 1..4 are two little-endian `Uint16`s — `cols` (offset 0) then `rows` (offset 2) — passed to `resizeSession`.
- Zero-length frames are ignored.

### Server → client
On `open`, the server attaches a switchable sink (`attachSink`) that first flushes any buffered output (a pre-warmed pool prompt, or bytes produced during a brief disconnect) so the prompt shows immediately, then streams live PTY bytes via `ws.send(encode(d))`. On `pty.onExit`, the socket is closed with code `1000` (`"exited"`) so the client treats it as a real exit (close the tab), not a dropped connection to reconnect.

### Lifecycle
On `close`, the live sink is detached (`detachSink` — output resumes buffering for a possible reattach) and the exit listener disposed. Then:
- **Clean close** (code `1000`) — the shell process exited (server-side close after `pty.onExit`) or the client intentionally disposed the tab. The PTY is killed now (`killSession`).
- **Abnormal close** (reload → `1001`, network drop → `1006`, etc.) — the PTY is kept alive for a grace window (`scheduleSessionKill(sessionId, reattachGraceMs())`, default **30000ms**, overridable via `OA_TERMINAL_GRACE_MS`) so a reconnecting client can reattach by `termId` and keep its running process.

The server also pre-warms one login shell on boot (`prewarmPool(vault, server.port)`, cwd = vault) so the first tab paints instantly; best-effort (a spawn failure never takes the server down).

### `idleTimeout`
`Bun.serve` is configured with `idleTimeout: 255` (Bun's max). Bun's default 10s would drop a connection mid-request for the few slow handlers (notably `POST /daemon/setup`, which git-clones + bun-installs claude-bot on first run).

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
| GET | `/chat/sessions` | read | no |
| GET | `/chat/session-messages` | read | no |
| GET | `/gcal/status` | read | no |
| GET | `/gcal/callback` | read | no |
| POST | `/gcal/credentials` | read | no |
| POST | `/gcal/auth/start` | read | no |
| POST | `/gcal/disconnect` | read | no |
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
| POST | `/daemon/update` | read | no |
| POST | `/daemon/cron/toggle` | read | no |
| POST | `/daemon/cron/run` | read | no |
| POST | `/daemon/process/toggle` | read | no |
| GET | `/bismuth/install` | read | no |
| POST | `/bismuth/install` | read | no |
| GET | `/update/status` | read | no |
| POST | `/update/apply` | read | no |
| GET | `/update/progress` | read | no |
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
| POST | `/tasks/archive` | mutating | yes |
| POST | `/cards/review` | mutating | yes |
| POST | `/daily-note` | mutating | yes (full) |
| POST | `/daemon/owner` | mutating | yes (no-op scope) |
| POST | `/gcal/sync` | mutating | yes (base file) |
| GET | `/terminal` | (WS upgrade) | n/a |
| GET | `/chat` | (WS upgrade) | n/a |

Source: core/src/server.ts, core/src/sse.ts, core/test/server.test.ts, core/src/graph.ts, core/src/daemon.ts, core/src/search.ts, core/src/claudebot.ts, core/src/files.ts, core/src/tasks.ts, core/src/fsPaths.ts, core/src/selfUpdate.ts, core/src/terminal.ts, core/src/chat.ts, core/src/gcal/index.ts, core/src/gcal/sync.ts
