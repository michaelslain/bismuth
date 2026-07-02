# Bismuth Architecture Overview

Bismuth is a personal knowledge management system built as a Bun monorepo with seven workspaces. The central concept is the **three-brain model**: a "you" self-node at the center, a "2nd brain" (vault of markdown files), and a "3rd brain" (the per-vault daemon's memory notes, living under `<vault>/.daemon/memory` and present only when `daemon.enabled`). These data sources are merged by the core backend into a single knowledge graph, precomputed with 2D and 3D layouts, served over HTTP to a Tauri + Solid.js desktop app. The relay plugin powers a live "agents" graph by reporting Claude Code sessions running inside the app's own terminal tabs back to the core server, and the mcp workspace is a stdio MCP server that auto-attaches to those same sessions to serve the docs + CLI.

---

## Monorepo Layout

The root `package.json` declares seven Bun workspaces:

```json
{
  "workspaces": ["core", "cli", "app", "relay", "mcp", "memory", "daemon"]
}
```

| Workspace | Package name | Role |
|-----------|--------------|------|
| `core/` | `@bismuth/core` | Backend HTTP server, graph builders, all business logic |
| `app/` | `app` | Tauri + Solid.js desktop frontend; imports `@bismuth/core` for shared types |
| `cli/` | `@bismuth/cli` | `bismuth` binary; imports `@bismuth/core` and calls core functions headlessly |
| `relay/` | `@bismuth/relay` | Claude Code hooks-only plugin; feeds core's in-process relay registry |
| `mcp/` | `@bismuth/mcp` | stdio MCP server; auto-attaches to app-terminal Claude sessions, serves `docs/` + the `bismuth` CLI token-frugally |
| `memory/` | `@bismuth/memory` | The pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL), used by the daemon, relay hooks, and MCP memory tools |
| `daemon/` | `@bismuth/daemon` | Per-vault daemon runtime; one machine process multiplexing every enabled vault's memory + crons + processes + conversation session |

Install all workspaces at once with `bun install` from the repo root. To add a package to a specific workspace: `cd <workspace> && bun add <package>`.

### `core/` — the backend

`core/src/server.ts` is the entry point. It starts a `Bun.serve` HTTP server (default port `:4321`) that:

- Accepts `--vault <dir>` and `--memory <dir>` CLI flags (both required when run standalone; the bundled app passes `<vault>/.daemon/memory` as `--memory`).
- Exposes a REST API consumed by both the app and the CLI.
- Watches the vault (including its in-vault `.daemon/memory`) for file changes, debounces them at 250 ms, selectively invalidates caches, bumps a version counter, and pushes SSE events to connected frontend clients.

`core` exports `@bismuth/core` (via `"module": "src/index.ts"`) so app and cli can import its pure functions and types.

### `app/` — the desktop frontend

A Tauri app wrapping a Vite + Solid.js SPA. Launched with `cd app && bun run dev`, which runs both `bun run ../core/src/server.ts` and `vite` concurrently via `concurrently`. The app talks to the core server at a URL resolved at runtime from (in priority order): `?api=<url>` query param → `VITE_API_BASE` build env → default `http://localhost:4321`. This resolution is in `app/src/api.ts`.

The entry point `app/src/index.tsx` code-splits two roots. On **first run** the bundled app's `lib.rs` injects `window.__BISMUTH_FIRST_RUN__` (and does **not** start a backend); `index.tsx` then renders the full-window **Vault Intro** takeover (`app/src/intro/VaultIntro.tsx`) instead of `App` — a short slideshow ending in a native folder picker that creates the vault, with `?intro=1` forcing it in dev/browser for preview. A normal launch never loads the intro, and first-run never loads `App` (which would fire API calls against a backend that isn't there). Full detail in [install](./install.md).

### `cli/` — the `bismuth` binary

A thin dispatcher over `@bismuth/core`. Most file-based operations (list notes, read/write, tasks, bases, drawing export) run **headlessly** with no running server. Operations that require the in-memory relay registry (e.g., `agent-graph`) go through the generic `api <METHOD> <path>` passthrough that hits a running server. Vault is specified via `--vault` flag or `BISMUTH_VAULT` env var.

### `relay/` — the agent-graph plugin

A collection of Claude Code hook scripts. It is **not** a daemon and installs nothing in `~/.claude`. It is loaded per-session, only inside Bismuth's terminal tabs, via a PATH shim (`relay/shim/claude`) that injects `--plugin-dir <relay>` when a bare `claude` is invoked.

Hook wiring (declared in `relay/hooks/hooks.json`):

| Hook | Script | POST endpoint | Purpose |
|------|--------|---------------|---------|
| `SessionStart` | `bin/session-start-hook.ts` | `POST /relay/session` | Register terminal-tab session as root node |
| `UserPromptSubmit` | `bin/recall-hook.ts` | `POST /relay/session` | Heartbeat / self-register on resumed sessions |
| `SubagentStart` | `bin/subagent-start-hook.ts` | `POST /relay/subagent/start` | Add child node under spawning session |
| `SubagentStop` | `bin/subagent-stop-hook.ts` | `POST /relay/subagent/stop` | Mark child finished |

All hooks are **best-effort**: they exit 0 within a 2-second budget and swallow all errors so they never block the user's Claude session. The hooks no-op if `CLAUDE_TERMINAL_ID` is absent (i.e., outside Bismuth terminals). The relay registry lives entirely in-process inside core (`core/src/relay.ts`); it does not persist across server restarts.

### `mcp/` — the docs + CLI MCP server

A stdio [MCP](https://modelcontextprotocol.io) server (`@bismuth/mcp`) that rides the **same auto-attach mechanism as relay**: the relay plugin's `relay/.mcp.json` declares it, so when a bare `claude` loads the plugin (`--plugin-dir <relay>`) Claude Code auto-starts the server — no flags, no approval prompts. It exposes the `docs/` reference and the `bismuth` CLI to that session **token-frugally** (search returns snippets, not whole pages): `mcp/src/docs.ts` (pure index/search/read), `mcp/src/cli.ts` (CLI bridge), `mcp/src/server.ts` (low-level SDK server, 5 tools: `bismuth_docs_list`/`search`/`read`, `bismuth_cli`, `bismuth_cli_help`). Scope is app-local, like relay. See [MCP server](../mcp/overview.md).

---

## The Three-Brain Model

Bismuth treats knowledge as three layers, each producing a graph:

### Self node ("you")

Node kind: `"self"`, id: `"::you"`.

The self node is **not** produced by the backend graph builders. It is a synthetic hub injected on the **frontend** (`app/src/graph/youNode.ts`) because its connectivity depends on live client state: which notes are open in which panes. The `::` prefix is a sentinel that can never collide with a vault note id (a vault-relative path minus `.md`).

In "agents" mode, `withYouAgents` additionally connects the self node to every root agent session (top-level terminal-tab sessions that have no parent).

### 2nd Brain (vault)

The vault is a directory of markdown files. `core/src/vault.ts` builds the vault graph in two passes:

1. Create a `"note"` node for every `.md` file (id = vault-relative path minus `.md`, e.g. `reading/quotes/x`).
2. Re-read each note to extract wikilinks (`[[Another Note]]`), `#tags`, and YAML frontmatter; create `"link"`, `"tag"`, and frontmatter-derived edges.

Important details:
- Wikilink matching is **filename-based, not path-based**: `[[Another Note]]` matches any `Another Note.md` anywhere in the vault. Ambiguous matches are undefined.
- The top-level folder segment becomes the `folder` field on each node (e.g. `reading/quotes/x.md` → `folder="reading"`).
- The vault graph uses node kinds `"note"` and `"tag"`. The set `SECOND_BRAIN_KINDS = new Set(["note", "tag"])` in `graph.ts` is what the frontend mode filter applies.

The vault graph is exposed by `GET /graph`.

### 3rd Brain (memory)

The 3rd brain is the per-vault daemon's memory, living **inside the vault** at `<vault>/.daemon/memory`. It is **gated on `settings.daemon.enabled`**: the server computes `effectiveMemoryDir()` (`core/src/server.ts`) as `join(cfg.vault, ".daemon", "memory")` only when `appConfig.daemon?.enabled`, otherwise `undefined`. When the daemon is disabled there is **no 3rd brain** at all (and no error). The bundled app derives the same path Rust-side (`vault_memory_dir(vault)` → `<vault>/.daemon/memory` in `app/src-tauri/src/lib.rs`) and passes it as the sidecar's `--memory`; core then ignores it unless the daemon is enabled. There is **no** separate top-level memory directory.

When a `memoryDir` is in effect, `core/src/memory.ts` builds a graph of `"memory"` nodes with ids prefixed `mem:` (e.g. `mem:project-xyz`). The constant `THIRD_BRAIN_KINDS = new Set(["memory"])` is what the frontend mode filter applies.

---

## Graph Composition in `engine.ts`

`buildGraph(vaultDir, memoryDir?)` in `core/src/engine.ts` is the single composition entry point called by the server's graph cache:

```typescript
export async function buildGraph(vaultDir: string, memoryDir?: string): Promise<GraphData>
```

Steps:

1. `buildVaultGraph(vaultDir)` — returns `{ graph, byBase, byPath }`. `byBase` is a map from filename-without-extension (e.g. `"Another Note"`) to node id; `byPath` is a map from the full vault-relative path (e.g. `"reading/Another Note"`) to node id. Both are needed for wikilink resolution.
2. If no `memoryDir` (the daemon is disabled, so there's no 3rd brain), stamp Louvain communities onto the vault graph and return.
3. If `memoryDir` is provided, `buildMemoryGraph(memoryDir)` returns `{ nodes, edges, links }` where `links` is a map from memory node base name to the wikilink targets it references.
4. **"About" edges** are created for each memory→vault cross-reference: for each entry in `memory.links`, `resolveLinkTarget(target, vaultByBase, vaultByPath)` is called — it tries path-qualified resolution first (`vaultByPath`), then falls back to basename resolution (`vaultByBase`). A successful resolution produces an `{ from: "mem:<base>", to: <vaultNodeId>, kind: "about" }` edge.
5. `mergeGraphs([vault, { nodes: memory.nodes, edges: [...memory.edges, ...about] }])` deduplicates nodes by id (first-seen wins) and concatenates edges.
6. `stampCommunities(merged)` runs Louvain community detection using only edges whose both endpoints are present, then stamps `community` (numeric id) and `communityLabel` (highest-degree member's label in that community) onto each node.

The result is a `GraphData`:

```typescript
interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  views?: { second?: ViewLayout; third?: ViewLayout }; // populated lazily via GET /graph/views
}
```

Layout positions (`position3d`, `position2d`) are attached by `attachLayout()` in `core/src/layout-cache.ts` before the graph is stored in the server's `graphCache`. The frontend receives nodes already stamped with positions and morphs between them in the Three.js renderer — it does not run any force simulation.

Over the renderer's canvas sits a shared **`GraphAtmosphere`** overlay (`app/src/graph/GraphAtmosphere.tsx`): the iridescent cluster-glow lobes (driven by the renderer's per-frame `setGlowCallback`, which projects the biggest clusters to screen space) plus a depth vignette. It is rendered as a sibling after the canvas by both `GraphView` and the first-run intro graph, so the two share one source instead of duplicating the glow-wiring.

---

## Graph Types (`core/src/graph.ts`)

### Node kinds

| Kind | Brain | Source | Description |
|------|-------|--------|-------------|
| `"note"` | 2nd | `vault.ts` | A vault markdown file |
| `"tag"` | 2nd | `vault.ts` | A `#tag` extracted from notes |
| `"memory"` | 3rd | `memory.ts` | A daemon memory note (from `<vault>/.daemon/memory`) |
| `"self"` | All | Frontend only | The "you" hub; id always `"::you"` |
| `"agent"` | agents | `agents.ts` | A Claude Code session or subagent in an app terminal |
| `"daemon"` | daemon | `daemonGraph.ts` | The daemon hub node (id `"::daemon"`, label defaults to `"daemon"`) |
| `"cron"` | daemon | `daemonGraph.ts` | A daemon-supervised cron job |
| `"process"` | daemon | `daemonGraph.ts` | A daemon-supervised process |

### Edge kinds

| Kind | Direction | Description |
|------|-----------|-------------|
| `"link"` | note → note | Wikilink `[[Target]]` |
| `"tag"` | note → tag | Note has this tag |
| `"message"` | memory → memory | Memory-internal links |
| `"about"` | memory → note | Cross-brain link: memory references vault note |
| `"open"` | self → note | Frontend-only: you have this note open in a pane |
| `"supervises"` | daemon → cron/process | Daemon hub to its supervised jobs |

### `GraphNode` fields

```typescript
interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  state?: "idle" | "awake";
  folder?: string;           // top-level folder segment, e.g. "reading"
  parent?: string;           // agent nodes only: parent session id
  position?: [x, y, z];     // 3D precomputed layout (attached by layout-cache.ts)
  position2d?: [x, y];      // 2D precomputed layout
  community?: number;        // Louvain community id
  communityLabel?: string;   // highest-degree member's label in the community
  daemon?: DaemonVizState;   // cron/process nodes only: enabled/running viz state
}
```

### `DaemonVizState` fields

```typescript
interface DaemonVizState {
  enabled: boolean;
  running: boolean;
  lastResult: string | null;  // "success" | "failed" | "unknown" | null (never ran)
  lastFiredMs: number | null; // epoch ms of last run, or null
  schedule?: string;          // cron expression (cron nodes only)
}
```

---

## Graph Modes

The frontend switches between five graph modes. Each mode determines which node/edge kinds to render and which backend endpoint to query:

| Mode | Backend source | Node kinds included |
|------|---------------|---------------------|
| `"2nd"` | `GET /graph` (subset) | `self`, `note`, `tag` |
| `"3rd"` | `GET /graph` (subset) | `self`, `memory` |
| `"both"` | `GET /graph` (full) | All of 2nd + 3rd |
| `"agents"` | `GET /agent-graph` | `self`, `agent` |
| `"daemon"` | `GET /daemon/graph` | `daemon`, `cron`, `process` (hub built by `daemonGraph.ts` from `<vault>/.daemon`; liveness read machine-level) |

For `"2nd"` and `"3rd"` modes the frontend requests `GET /graph/views` on first mode switch to obtain per-brain precomputed layouts (`ViewLayout`). These are computed lazily by `computeViewLayouts()` and cached on the live `GraphData` object in memory. Subsequent `GET /graph` calls return the cached graph with `.views` populated.

The 2D/3D toggle is a transient `localStorage` value, not a `.settings` key — it persists across sessions but does not appear in the settings file.

---

## Data Flow: Vault Change → Frontend Update

```
Vault .md file written
  → node:fs.watch fires (core/src/server.ts)
  → scheduleVault(filename)
  → debounce timer (250ms, configurable via server.fileWatchDebounceMs)
  → classifyVault(paths): re-fingerprints changed notes via changeClassifier.ts
      - content-only edit (no link/tag/icon change) → dirty={graph:false, tree:false}
      - structural change → dirty={graph:true} or dirty={tree:true} or both
      - `.settings` change → dirty={graph:true, tree:true}
  → applyDirty(paths, dirty):
      - graphCache.invalidate() if dirty.graph
      - treeCache.invalidate() if dirty.tree
      - cachedRows = null, cachedTasks = null (always)
      - version++
      - sse.publish({version, paths, dirty})

Frontend (app/src/serverVersion.ts):
  - Persistent EventSource on GET /events
  - On event: if dirty.graph → re-fetch GET /graph; if only file changed → re-fetch GET /file
  - Fallback: low-frequency GET /version poll (1s when disconnected, 5s when connected)
    recovers silently-dropped SSE (proxy/OS-sleep)
```

**Key invariant**: The graph is rebuilt lazily on the first `GET /graph` request after `graphCache.invalidate()`. The server never rebuilds speculatively. Node positions are precomputed in `layout.ts` (pivot-MDS + force simulation) during this rebuild and attached to nodes before caching — the frontend only morphs.

---

## HTTP API Summary

All routes are served by `core/src/server.ts`. Mutating routes go through `mutatingHandler`, which auto-invalidates caches and broadcasts SSE after the handler returns.

### Read routes (GET / read-only POST)

| Route | Description |
|-------|-------------|
| `GET /version` | Current version counter `{version}` |
| `GET /events` | SSE stream; pushes `{version, paths, dirty:{graph,tree}}` |
| `GET /graph` | Full merged knowledge graph (nodes + edges + precomputed positions) |
| `GET /graph/views` | Per-brain view layouts for 2nd/3rd mode; computed lazily, cached |
| `GET /tree` | Vault file tree as `TreeEntry[]` (with folder icons overlaid) |
| `GET /file?path=` | Raw markdown content of a vault file |
| `PUT /file` | Write vault file (also invalidates caches) |
| `GET /asset?path=` | Serve vault media file as binary (filename-first resolution) |
| `POST /asset?path=` | Upload attachment (≤100 MB); returns actual path after de-collision |
| `GET /vault-data` | All vault rows (frontmatter + metadata) as `Row[]` |
| `GET /base?file=` | Parse and return a base file's config |
| `POST /rows {spec}` | Resolve a `SourceSpec` → `Row[]` (base composition, scoped tasks) |
| `GET /meta?path=` | Parsed frontmatter of a single file |
| `GET /config` | Runtime config: `{vault, memory}` |
| `GET /settings` | Parsed app settings (`.settings` merged over defaults) |
| `GET /schema` | Property registry from `.settings` |
| `GET /templates` | List template files |
| `GET /agent-graph` | Live Claude Code agent tree (agents mode) |
| `GET /tasks` | All vault tasks |
| `GET /cards/decks` | SRS deck list |
| `GET /cards/all` | All flashcards |
| `GET /cards/note?path=` | Cards for a specific note |
| `GET /cards/due?deck=` | Due cards (optional deck filter) |
| `GET /daemon/status` | Daemon status (machine-level, from `daemonMachineDir()`) |
| `GET /daemon/devices` | Known devices list |
| `GET /daemon/graph` | Daemon supervision graph (daemon mode), from this vault's `.daemon` dir |
| `GET /daemon/install` | Daemon install probe (`installStatus()`) |
| `POST /daemon/setup` | Idempotent, adopt-only daemon setup (`runSetup()`) |
| `POST /daemon/update` | Re-run the adopt-only install (the daemon updates WITH the app; no git pull) |
| `POST /daemon/cron/toggle {name, enabled}` | Enable/disable a cron |
| `POST /daemon/cron/run {name}` | Trigger a cron immediately |
| `POST /daemon/process/toggle {name, enabled}` | Enable/disable a process |
| `POST /relay/session` | Register a terminal-tab session |
| `POST /relay/session/end` | End a terminal-tab session |
| `POST /relay/subagent/start` | Register a subagent |
| `POST /relay/subagent/stop` | Mark a subagent finished |
| `POST /backup` | Git snapshot of vault |
| `POST /open-folder {folder}` | Spawn a sibling server for a different vault; returns `{url}` |
| `POST /search {query, opts}` | Full-text search |
| `GET /terminal` | Upgrade to WebSocket for PTY session |

### Mutating routes (POST — cache-invalidate + SSE broadcast)

| Route | Description |
|-------|-------------|
| `POST /move {from, to}` | Move/rename a file or folder |
| `POST /delete {path}` | Move to .trash |
| `POST /restore {trashPath, to}` | Restore from .trash |
| `POST /create {path, kind}` | Create file or directory |
| `POST /replace {query, replacement, opts, scope}` | Find-and-replace in vault |
| `POST /set-property {path, key, value}` | Set a single frontmatter key |
| `POST /delete-property {path, key}` | Remove a frontmatter key |
| `POST /set-setting {path[], value}` | Merge one `.settings` key in place |
| `POST /folder-icon` | Set/clear a folder icon |
| `POST /daily-note` | Create or open today's daily note |
| `POST /tasks/toggle` | Toggle a checkbox task in-place |
| `POST /cards/review` | Apply SRS review (markdown cards or row cards) |
| `POST /row/update {file, index, note}` | Create (`index:null`) or update a base row |
| `POST /row/delete {file, index}` | Delete a base row |
| `POST /row/reorder {file, from, to}` | Reorder a base row |
| `POST /daemon/owner` | Set daemon owner device (vault mutation) |

---

## Settings Architecture

`.settings` (`SETTINGS_FILE` in `core/src/settings.ts`) is a single hidden, extensionless YAML file at the vault root. It is the single source of truth for all user-configurable behavior. The backend is the **only writer** — the frontend never writes the file directly, it always calls `POST /set-setting`. A one-time `migrateSettingsLocation()` relocates two legacy layouts into it on first open: a vault-root `settings.yaml`, and an interim `.settings/settings.yaml` folder from an earlier build; both are idempotent, best-effort, and preserve the user's values via filesystem rename (falling back to copy).

- **Schema**: `core/src/schema/settingsSchema.ts` — defines all keys with type, default, min/max or enum, and doc string.
- **Reconciliation**: On server boot (and on every `GET /file?path=.settings`), `reconcileSettings()` adds any missing keys to the file without clobbering existing values or comments.
- **Frontend hydration**: `GET /settings` returns the parsed file merged over defaults. `app/src/settings.ts` stores these as a reactive Solid signal.
- **CSS variables**: `app/src/settingsCssVars.ts` projects appearance/ui settings into `:root` CSS custom properties; component stylesheets use `var(--name, fallback)`.
- **Schema-aware editor**: Opening `.settings` in the editor activates `editor/settingsComplete.ts` (autocomplete showing doc + valid range) and `editor/yamlSchema.ts` (lint).

---

## Caching Strategy

| Cache | Invalidated by | Notes |
|-------|---------------|-------|
| `graphCache` (async dedup) | `dirty.graph` file-watch events, all mutations | First read after invalidation rebuilds graph + layout |
| `treeCache` (async dedup) | `dirty.tree` file-watch events, structural mutations | |
| `cachedRows` | Any vault file change | Rebuilt lazily on next `GET /vault-data` or `POST /rows` |
| `cachedTasks` | Any vault file change | Rebuilt lazily on next task query |
| `graph.views` | When `graphCache` is invalidated | In-place mutation of live cached object; computed lazily on `GET /graph/views` |
| Search index | Any vault file change | `invalidateSearchIndex()` called in `applyDirty` |
| Client SWR row cache | SSE version bump | `app/src/bases/rowCache.ts` keyed by SSE version |
| Layout positions (localStorage) | — | Frontend caches precomputed positions in localStorage for instant paint on reload |

The `asyncCache` abstraction (`core/src/asyncCache.ts`) ensures concurrent first requests share one build and a mid-build file change doesn't repopulate a stale value.

---

## Related Documentation

- [Core graph types](../graph/overview.md)
- [Bases query system](../bases/overview.md)
- [Relay / agents graph](../terminal/overview.md)
- [Daemon integration](../daemon/overview.md)
- [Settings schema](../settings/reference.md)
- [HTTP API reference](../api/http-reference.md)

Source: /Users/michaelslain/Documents/dev/bismuth/CLAUDE.md, /Users/michaelslain/Documents/dev/bismuth/package.json, /Users/michaelslain/Documents/dev/bismuth/core/src/engine.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/server.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/settings.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemon.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemonGraph.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/graph.ts, /Users/michaelslain/Documents/dev/bismuth/relay/package.json, /Users/michaelslain/Documents/dev/bismuth/relay/hooks/hooks.json, /Users/michaelslain/Documents/dev/bismuth/relay/lib/report.ts, /Users/michaelslain/Documents/dev/bismuth/core/package.json, /Users/michaelslain/Documents/dev/bismuth/cli/package.json, /Users/michaelslain/Documents/dev/bismuth/app/src/index.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/intro/VaultIntro.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/graph/GraphAtmosphere.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src-tauri/src/lib.rs
