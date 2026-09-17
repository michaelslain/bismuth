# Codebase Map

This document is a module-by-module navigation guide for the Bismuth monorepo, for anyone implementing a feature, tracking down where a piece of behavior lives, or getting oriented in an unfamiliar part of the code. It covers every workspace, every `core/src` and `app/src` module (including subdirectories), the `cli/src` command layer, and the `relay` plugin. For each module it explains what the module does, what it exports, what it depends on, and where to make changes when adding new features. Use this alongside the architecture overview in `CLAUDE.md`.

**What's in here**, in reading order:
- **Workspace Layout** — the seven Bun workspaces and how they depend on each other
- **`core/`** — the backend/pure-logic library, grouped by responsibility: HTTP server, graph construction, layout, rendering, file system, knowledge parsing, settings, theme, commands/keybindings, search, Bases, SRS, tasks, Google Calendar sync, daemon integration, AI visibility, relay registry, chat / agent backends, terminal, plus the `drawing/` subsystem and `core/test/`
- **`app/src/`** — the Solid.js frontend, grouped by feature area: shell/panes, graph rendering, editor, file tree, Bases views, calendar, drawing, sheets, export, color, palette, terminal, chat, icons, drag-and-drop, UI primitives, and mobile
- **`app/.storybook/`** — the Storybook 9 component catalog for `app/src/`: config, the runtime theme/transport seams in `preview.ts`, and the shared fixture files
- **`cli/src/`** — the `bismuth` binary's command groups
- **`relay/`** — the terminal-tab session relay plugin
- **`memory/src/`** — the pure 3rd-brain memory graph: note CRUD, frontmatter, backlinks, keyword search, the query DSL, and transcript-to-note capture
- **`daemon/src/`** — the per-vault daemon runtime: cron scheduler, process manager, file watcher, the daemon-inbox pages runtime, and the machine/device/registry plumbing under `lib/`
- **`skills/`** — agent-facing skill guides shipped outside any workspace
- **Where to Add Things** — a lookup table for common changes, at the bottom

---

## Workspace Layout

Bismuth is a Bun workspace monorepo. The root `package.json` declares seven workspaces:

```
bismuth/               root (private, no src; devDeps: emojilib, unicode-emoji-json)
  core/                @bismuth/core — backend server, all pure logic
  app/                 app — Tauri + Solid.js desktop UI
  cli/                 @bismuth/cli — `bismuth` binary wrapping @bismuth/core
  relay/               @bismuth/relay — Claude Code plugin reporting terminal-tab sessions + subagents into core's relay registry
  mcp/                 @bismuth/mcp — stdio MCP server (docs + CLI) for app-terminal Claude sessions
  memory/              @bismuth/memory — the pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL), used by the daemon, relay hooks, and MCP memory tools
  daemon/              @bismuth/daemon — per-vault daemon runtime; one machine process multiplexing every enabled vault's memory + crons + processes + conversation session
```

`core` is the library that `app`, `cli`, and `mcp` import as `@bismuth/core`. `relay` is not imported by anyone; it runs as a standalone plugin inside terminal tabs, and its `.mcp.json` auto-starts the `mcp` server in those sessions. Root-level `dependencies` (`@napi-rs/canvas`, `pdf-lib`, `perfect-freehand`) are hoisted and consumed by `core/src/drawing/`.

Three top-level directories sit outside this workspace list entirely — no `package.json`, nothing to `bun install` or import: `skills/` (agent-facing skill guides), `app/.storybook/` (the Storybook component catalog for `app/src/`), and `bench/` (visual-verification tooling, wired to root `package.json` scripts). Each gets its own section below.

Add a dep: `cd <workspace> && bun add <package>` then `bun install` at the root.

---

## `core/` — Backend + Pure Logic (`@bismuth/core`)

Everything in `core/src/` is importable by both `app` and `cli`. Modules are grouped below by responsibility.

### HTTP Server and Infrastructure

#### `server.ts`
The only Bun HTTP server. `createServer(cfg: CoreConfig)` builds and returns a `Bun.serve` handler. It owns:
- All route tables: a `routes` Record (read-only GET handlers) and a `mutatingRoutes` Record (write POST handlers run through `mutatingHandler`, which auto-invalidates caches and broadcasts SSE). A few POST endpoints that are not vault mutations (e.g. `/rows`, `/search`, `/backup`, relay endpoints, daemon shared-state writes) sit in the read table to skip the auto-invalidate.
- Cache instances: `graphCache` (an `AsyncCache<GraphData>`), `treeCache` (an `AsyncCache<TreeEntry[]>`), plain mutable `cachedRows`/`cachedTasks`.
- File watcher (Node.js `watch`) with 250 ms debounce. On fire: calls `createChangeTracker().classify()` to fingerprint changed paths, selectively invalidates caches by `dirty.graph`/`dirty.tree` flags, bumps `version`, pushes SSE.
- WebSocket upgrade on `GET /terminal` → routes to `core/src/terminal.ts`.
- `CoreConfig` interface: `{ vault: string; memory?: string; port?: number }`.
- `cliArg(name)` — reads `--name val` from `Bun.argv` (shared by both `server.ts` entry and any CLI shim).

**Where to add things:** new read route → add to `routes`; new mutating route → add to `mutatingRoutes`. Never call `graphCache.invalidate()` manually from a mutating handler; `mutatingHandler` does it.

#### `sse.ts`
Minimal SSE registry. `createSseRegistry()` returns `{ subscribe, unsubscribe, publish, size }`. `formatEvent(payload)` encodes a JSON payload as `data: ...\n\n`. `server.ts` holds one registry instance and calls `publish` on every version bump. `SseRegistry` is the exported type.

#### `asyncCache.ts`
`createAsyncCache<T>(build)` — a concurrency-safe lazy cache with three guarantees: (1) in-flight dedup (concurrent `.get()` calls share one build), (2) invalidation safety (a result whose build started before an `invalidate()` is discarded, not repopulated via a generation counter), (3) `warm()` for fire-and-forget pre-warming. Used for `graphCache` and `treeCache`.

#### `changeClassifier.ts`
`createChangeTracker()` → `{ classify(paths, read): Promise<Dirty> }`. Fingerprints each changed file's wikilinks + tags + `icon` frontmatter field (`extractFingerprint`), compares against last-known state, and returns `{ graph: boolean; tree: boolean }`. Content-only edits that don't touch links/tags/icon return `{ graph: false, tree: false }` — the server stays silent toward graph and tree consumers. `isSettingsPath(path)` checks if a path is the vault settings file — `.settings`, plus the legacy `settings.yaml` and interim `.settings/settings.yaml` (matched during the one-time migration window).

#### `error.ts`
`AppError` class and `createError(code, message?)` factory. `mutatingHandler` in `server.ts` catches `AppError` and maps `statusCode` to the HTTP response. Error codes and their HTTP status:

| Code(s) | HTTP status |
|---|---|
| `ENOENT`, `*_NOT_FOUND` | 404 |
| `EACCES` | 403 |
| `EEXIST`, `*_CONTENT_CHANGED` | 409 |
| `EINVAL`, `PARSE_ERROR`, `SCHEMA_ERROR`, `*_FORMAT_ERROR`, `BASE_CYCLE` | 400 |
| `INTERNAL_ERROR` | 500 |

#### `openFolder.ts`
`spawnVaultBackend(vault, port)` — spawns a sibling Bun process running `core/src/server.ts` pointed at a different vault. Returns `{ url }`. Called by `POST /open-folder`; the frontend opens a new window with `?api=<url>`. Mirrors the `cli/src/commands/serve.ts` approach.

#### `ownerToken.ts`
Closes the unauthenticated HTTP content oracle: core's read routes have always served vault content with no auth, so any process able to run a shell command could `curl` a `visibility: hidden` note straight back out. `mintOwnerToken()` — a per-boot random token identifying the vault's own app/CLI as the OWNER, minted by `app/scripts/dev.ts` in dev and by the bundled app at boot. `resolveRequestChannel(req, ownerToken)` → `RequestChannel = "owner" | "chat" | "daemon"` — a request presenting the token is the owner and sees everything unfiltered; anyone else is treated as an agent acting on the owner's behalf and gets the same visibility filter that already gates Claude's own tools. `ownerTokenDenyPath`/`ownerTokenDenyPaths` add the token file itself to the sandbox deny list so a spawned agent can't read its own way to ownership. An honesty boundary, not a hardened auth system — see `docs/vault/visibility.md`.

---

### Graph Construction

#### `graph.ts`
Pure types shared by every graph builder and the renderer:
- `NodeKind`: `"note" | "memory" | "agent" | "tag" | "self" | "daemon" | "cron" | "process"`
- `EdgeKind`: `"link" | "message" | "about" | "tag" | "open" | "supervises"`
- `SELF_NODE_ID = "::you"` — the self hub (frontend-injected, never from backend builders)
- `SECOND_BRAIN_KINDS` = `{"note", "tag"}`, `THIRD_BRAIN_KINDS` = `{"memory"}` — used for brain-view subgraph slicing
- `GraphNode` — id, label, kind, state (`"idle" | "awake"`), folder, parent (agent nodes), position (3D), position2d (2D), community, communityLabel, daemon (`DaemonVizState`)
- `GraphEdge` — from, to, kind
- `GraphData` — nodes, edges, views (optional `{ second?: ViewLayout; third?: ViewLayout }`)
- `ViewLayout` — `{ pos3d: Record<string, [number,number,number]>; pos2d: Record<string, [number,number]> }`
- `DaemonVizState` — enabled, running, lastResult, lastFiredMs, schedule
- Helper functions: `subgraphByKinds`, `mergeGraphs`, `emptyGraph`

**Where to add things:** new node/edge kind → add to `NodeKind`/`EdgeKind` here; emit from the appropriate builder; adjust frontend mode filter in `App.tsx`.

#### `engine.ts`
`buildGraph(vaultDir, memoryDir?)` — top-level graph compositor. Calls `buildVaultGraph` and (if memory dir present) `buildMemoryGraph`, then resolves memory→vault "about" edges by looking up each memory link target in the vault's `byBase`/`byPath` maps. Merges the two graphs with `mergeGraphs`, then stamps community assignments onto every node via `stampCommunities` (calls `detectCommunities` from `community.ts`). The result is passed to `attachLayout` in `server.ts` before serving.

#### `vault.ts`
`buildVaultGraph(root)` — builds the vault knowledge graph. Two-pass algorithm via `buildGraphFromNotes`: pass 1 creates note nodes (id = path without `.md`, label = filename stem, kind = "note", folder = top-level folder name); pass 2 reads content and extracts wikilink edges (`kind: "link"`), tag nodes, and tag edges (`kind: "tag"`). Returns `{ graph, byBase, byPath }` for cross-graph link resolution.

Also exports: `pathParts(rel)` (decompose a vault-relative path into name/ext/folder/basename/topFolder), `noteId(rel)` (strip `.md`), `resolveLinkTarget(target, byBase, byPath)`.

#### `memory.ts`
`buildMemoryGraph(root)` — builds the memory graph from memory notes in a separate directory. Node ids are prefixed `mem:`. Returns `{ nodes, edges, links: Map<base, targets[]> }` where `links` carries which vault filenames each memory note references (used by `engine.ts` to create "about" edges).

#### `agents.ts`
Pure type-only module now — the "agents" graph mode and its former `buildAgentGraph` builder were removed in commit `a6687c0`; there is no more live graph-building logic here. What remains: `ChatAgentSubagent` (a visual-chat session's SDK Task-tool subagent — `agentId`, `agentType`, `done`) and `ChatAgentSession` (one live `ChatView` chat — `chatId`, `label`, `active`, `lastActivityAt`, `subagents`). Both types are imported only by `chat.ts`, which reports its own chat sessions/subagents in this shape via `chatAgentSnapshot()` — a separate bookkeeping path from the terminal-tab relay registry below, though the two shapes mirror each other by design.

#### `graphBuilder.ts`
`buildGraphFromNotes(root, nodeBuilder, edgeExtractor)` — shared graph construction skeleton. Lists `.md` files, builds node index maps (`byBase`, `byPath`), reads all contents in parallel, then calls `edgeExtractor` for each file. Used by both `vault.ts` and `memory.ts`. When adding a new graph source, use this function rather than reimplementing the file walk + parallel read pattern.

#### `community.ts`
`detectCommunities(nodes, edges)` — deterministic synchronous label propagation (20-iteration cap). Nodes processed in sorted id order; ties broken by smallest community id. Post-processes: assigns each community's exemplar (highest-degree member, tie → lex-smallest id) as the community label. Returns `Map<id, CommunityAssignment>`. Used by `engine.ts` to stamp `community`/`communityLabel` on nodes.

#### `communitySignificance.ts`
Is a detected partition REAL, or would a random graph with the same degree sequence score just as well? Louvain-style modularity maximization finds "communities" even in Erdos-Renyi graphs, and Bismuth's implementation searches its resolution parameter to hit a target group count derived from node count — so it always returns groups whether or not the vault has any real structure. `modularity(adj, comm)` — Newman-Girvan Q. `nullModelForGraph`/`nullModelModularity` — score the same partition against a randomized degree-preserving null model. `significance(...)` — the gate the renderer consults before asserting a community's name/territory as a claim about the user's own vault.

#### `graphBlock.ts`
The ` ```graph ` embedded block: a small, human-writable DSL describing a CUSTOM graph (nodes + edges) inside a note body, rendered inline by the editor (`app/src/editor/graphBlock.ts` → `app/src/graph/EmbeddedGraph.tsx`) with the same canvas renderer as the knowledge graph. This module is the block's pure core: `parseGraphBlock(body)`/`serializeGraphBlock(spec)` round-trip the grammar (one statement per line — a bare node token, or `a -> b`/`a - b` edges, `#` comments); `emptyGraphBlock()`, `freshNodeId`, `addNode`/`removeNode`/`renameNode`/`setNodeLabel`, `hasEdgeBetween`/`addEdge`/`removeEdgesBetween` are the mutation helpers the interactive widget edits through; `graphBlockToGraphData(spec)` projects a block to a renderable `GraphData`. Fully headless and unit-tested (`core/test/graphBlock.test.ts`), so the markdown ⇄ graph round-trip needs no DOM.

---

### Layout

#### `layout.ts`
Pure, DOM-free layout computation. `computeLayoutAsync(input, opts?)` — runs PivotMDS (Brandes & Pich, O(k·(V+E))) to get a global seed, then refines with a d3-force-3d simulation. `LayoutOptions`: `dimensions` (2 or 3), `numPivots` (default 50), `refineTicks` (default 150), `repulsion`, `linkDistance`, `centering`, `initialPositions` (skip PivotMDS and warm-start from these coordinates). The force constants (`COLLIDE_RATIO = 1.25`, `COLLIDE_ITERATIONS = 6`, `MANYBODY_THETA = 1.5`) tune the backend's own settle only — the renderer (`graph/AsciiGraphRenderer.ts`, via `graph/respace.ts`'s `scaleToSpacing()`) deliberately does **not** mirror them; it measures the settled output's own spacing and rescales to a fixed target instead of copying this module's constants (see `respace.ts`'s entry below). Also runs in a browser Worker.

#### `layout-cache.ts`
Two-tier layout cache (in-memory Map + JSON file in `~/.bismuth/layout-cache`, durable; override `BISMUTH_LAYOUT_CACHE_DIR`). `attachLayout(graph, vaultKey)` — computes both 3D and 2D layouts and attaches `position`/`position2d` to every node. 2D layout is seeded from flattened 3D so the morph flattens in place rather than scrambling. Peek-attaches brain-view layouts when already cached; otherwise they're computed lazily on `GET /graph/views`. `computeViewLayouts(graph, vaultKey)` — computes 2nd/3rd subgraph layouts on demand. `graphSig(graph, vaultKey)` — SHA-1 content hash of sorted node ids + edge endpoints. Cache version `v20` bakes current constants (LinLog energy model + degree-proportional repulsion default); bump `CACHE_VERSION` if force constants or cache shape change.

#### `linlog.ts`
`linLogLinkForce(...)` — LinLog-mode attraction (ForceAtlas2's `ln(1+d)` approximation, Jacomy et al.) for the d3-force-3d refinement stage in `layout.ts`. Attraction growing only logarithmically with distance (instead of d3's default Hooke-spring `forceLink`, proportional to `d - restLength`) is what keeps dense regions dense while sparse regions spread — cluster separation becomes a property of the model rather than something a corrective force has to impose, which is what stops communities collapsing into a hairball.

#### `brainCompose.ts`
Composes per-brain layouts (vault / memory / daemon) into one coordinate space. The honesty rule: positions are emergent WITHIN a brain, but brains themselves are PLACED — legitimate because they're separate graphs joined only by sparse "about" edges, the way a world map places countries while cities sit where they actually are. `boundingRadius`/`applyOrientation`/`bestOrientation` use only rotation and reflection (isometries that preserve every internal distance exactly) to orient one brain's cloud before placing it; `composeBrains(...)` runs the placement with a running cursor so cross-brain edges read as a coherent band instead of spaghetti.

---

### Rendering

Headless-Chrome rasterization for the backend — the machinery behind the CLI's `export` command's PDF/PNG output, and shared with the visual-verification tooling in `bench/`.

#### `render/chromeSession.ts`
The one place that launches headless Chrome and tears it down for backend-side rendering: binary path, flag set, port poll, the CDP WebSocket, and a teardown that runs on every exit path. Originally written for `bench/`'s visual tools (three of which had each grown their own copy of launch+teardown and each got the teardown wrong a different way); `bench/chromeSession.ts` now just re-exports this module (`export * from '../core/src/render/chromeSession'`) so the CLI's headless export path and every `bench/` tool share one implementation instead of two copies drifting apart. See the `bench/` section below for the launch-flag rationale (the `--disable-*background*` set that keeps a backgrounded tab's rAF loop alive).

#### `render/htmlRaster.ts`
`htmlToPdfHeadless(html)` / `htmlToPngHeadless(html, opts)` / `htmlToPdfPagesHeadless(html)` — headless HTML → PDF/PNG over CDP, used by `cli/src/commands/export.ts` for a note/base/sheet's PDF/PNG export when no browser is available to drive it. Sets the document content directly over the shared `chromeSession.ts` launcher (no filesystem round-trip, no data-URL length limit), waits for the load event, then calls `Page.printToPDF`/`Page.captureScreenshot`. Page geometry (US Letter portrait, 1in margins) matches the browser exporter's own `app/src/export/pageGeometry.ts` so Chrome's native print pipeline and the browser's manual html2canvas slicer agree on the same page box.

---

### File System

#### `files.ts`
Vault file I/O with path-traversal protection. Key exports:
- `walkDir(absRoot, filter)` — recursive dir walk; filter returns `true`/`false`/`{ data }`.
- `listMarkdown(root)` — `Bun.Glob("**/*.md")` scan, dot files excluded.
- `listTree(root)` — returns `TreeEntry[]` (files + dirs) with `icon` from frontmatter.
- `readNote(root, rel)` / `writeNote(root, rel, content)` — read/write with path-traversal guard.
- `moveEntry(root, from, to)` / `deleteEntry(root, rel)` / `createEntry(root, rel, kind)`.
- `resolveAsset(root, filename)` — filename-first resolution for `GET /asset`.
- `writeBinary(root, rel, buffer)` / `uniqueAssetPath(root, rel)` — for `POST /asset`.
- `listTemplates(root, folder)` — lists templates from a subfolder.

#### `fileAccess.ts`
`FileAccess` interface abstraction (`listMarkdown`, `readNote`, `statNote`, `writeNote`). Default is Bun fs. `setFileAccess(fa)` swaps the implementation (used by mobile to plug in Tauri FS). `getFileAccess()` returns the active implementation. Used by `graphBuilder.ts`, `basesData.ts`, and the bases pipeline so they stay decoupled from Bun directly and testable.

#### `pathUtils.ts`
`fileBasename(path)` — extracts the basename from a vault-relative path. Used in `search.ts`.

#### `concurrency.ts`
`mapWithConcurrency(items, limit, fn)` — the one bounded-concurrency worker-pool helper, shared by every caller that needs to run many async calls (file reads, stats) with a cap on how many are in flight rather than either serially or all at once (`Promise.all` over thousands of vault files risks exhausting file descriptors). Each worker claims the next index off a shared counter, so `results[i]` always corresponds to `items[i]` regardless of completion order. Extracted from `visibility.ts`; `files.ts` (`listTree`'s mtime pre-stat) and `search.ts` (`buildSearchIndex`) had each hand-rolled the same shape before switching to this.

#### `heic.ts` + `heic-convert.d.ts`
HEIC/HEIF → JPEG transcoding, so a photo dragged out of Finder is usable downstream — done in the backend (not the WebView) because Chromium can't decode HEIC natively while WebKit can, and doing it in-page would silently behave differently across the packaged macOS app, the browser dev build, and Windows/Linux. `isHeicName`/`jpegNameFor`/`looksLikeHeic` (magic-byte sniff) plus `convertHeicToJpeg` — tries `sips` first on macOS (system tool, ~10× faster), falls back to the pure-JS `heic-convert` (libheif wasm + jpeg-js) on Windows/Linux or whenever `sips` is absent/errors. `heic-convert.d.ts` is a hand-written ambient module declaration for the untyped `heic-convert` package, asserted narrow at its one import site in `heic.ts`.

#### `tmpFiles.ts`
Scratch staging for bytes that need a real filesystem path but must not enter the vault — a pasted file (or a browser-dev-build drop) arrives as bytes with no path, and chat's file-reference tools need a path to read. `tmpFilesDir()`, `safeTmpName(name)`, `stageTmpFile(bytes, name)`, `pruneTmpFiles()` (age-based cleanup on server boot, `TMP_MAX_AGE_MS` = 24h). Deliberately not the vault's attachment folder — these files are never meant to become tracked vault content.

#### `backup.ts`
Git-snapshot of a vault/memory dir + per-consumer checkpoints. Never adds a remote (local history only).
- `commitVault(dir, message)` — `ensureRepo` + `git add -A` + commit; returns `false` when there was nothing to commit. `snapshotMessage(now?, kind?)` — a human label like `"vault snapshot 2026-05-27 14:30"` (the `kind` arg relabels it for memory/checkpoint snapshots).
- `ensureRepo(dir)` — `git init` + a local `vault@local` identity if needed, then `ensureExclude` — idempotently appends `.settings` and `.daemon` to `.git/info/exclude` so the daemon's config file + whole `.daemon` brain (pid/session/logs/triggers, plus memory the daemon checkpoints itself) never land in vault history.
- `scheduleBackup(dir, message)` / `flushBackup(dir)` — coalesced autosave: debounces a burst of editor/file-watch saves into ONE commit (`BISMUTH_BACKUP_DEBOUNCE_MS`, default 30 s) with a max-wait (`BISMUTH_BACKUP_MAX_WAIT_MS`, default 5 min) so long sessions still snapshot. Checkpoint commits stay immediate.
- Checkpoints are lightweight refs under `refs/bismuth/<name>` (bookmarks, not branches) marking how far a periodic job has processed the linear autosave history. `checkpointRef(dir, ref)` (current SHA or null), `checkpointDelta(dir, ref, commitMessage?)` → `{ base, head, files: ChangedFile[] }` (files changed since the ref; first run = every tracked file as added), `advanceCheckpoint(dir, ref, commitMessage?)` (move the ref to HEAD). Used by background jobs (dream on the memory repo, vault-review on the vault repo). Called by `POST /backup`.

---

### Knowledge Parsing

#### `frontmatter.ts`
`parseFrontmatter(content)` → `{ data: Record<string, unknown>; body: string }`. YAML-tolerant: catches parse errors and returns `{}`. `setFrontmatterKey(content, key, value)` / `deleteFrontmatterKey(content, key)` — edit frontmatter in place using the `yaml` Document API (preserves comments, key order, flow arrays). `mutateFrontmatter(yaml, mutate)` — generic frontmatter mutation helper (falls back to stringify on malformed input).

#### `wikilinks.ts`
`extractWikilinks(content)` — returns all `[[target]]` strings from markdown content, stripping heading anchors (`#`) and aliases (`|`).

#### `tags.ts`
`extractTags(frontmatterData, body)` — extracts tags from both the `tags:` frontmatter array and inline `#tag` patterns in the markdown body. Returns deduped lowercase strings without `#`.

#### `memoryRef.ts`
The `??slug` MEMORY REFERENCE syntax — what `[[Wikilink]]` is for a vault note, but pointing at a 3rd-brain memory note (`<vault>/.daemon/memory/<slug>.md`). Pure and dependency-free like its siblings `wikilinks.ts`/`tags.ts`, so the editor autocomplete, the live-preview decorator, and the markdown→HTML renderer all share one definition of the grammar. `MEMORY_REF_RE`, `matchMemoryRefPrefix`, `isSrsSeparatorLine` (so a `??` inside an SRS card's own `??` separator isn't misread as a memory ref), `memorySlugFromNodeId`/`memoryRefPath`/`resolveMemorySlug`, `buildMemoryRefInsert(slug)`.

---

### Settings

#### `settings.ts`
Lifecycle for the vault's single hidden settings file. Key exports:
- `readSettings(vault)` — reads and parses `.settings`; tolerant of malformed YAML.
- `reconcileSettings(vault)` — called on boot; writes a fresh defaults file if absent, or merges in any new keys since the file was written (preserving user values, comments, unknown keys).
- `setSettingInFile(vault, path: string[], value)` — per-vault mutex-guarded atomic write of one key, addressed by a dot-path **array** (e.g. `["appearance", "theme"]`), not separate section/key args; called by `POST /set-setting`. The mutex (a promise chain keyed by vault path) prevents TOCTOU races.
- `getVaultSchema(vault)` — parses `properties:` section into a `Schema`, merged over built-in properties.
- `serializeSettingsForFrontend(vault)` — returns the settings data as a nested plain object for `GET /settings`.
- `loadAppConfig(vault)` — reads and coerces settings into `AppConfig` (backend runtime use).
- `migrateSettingsLocation(vault)` — one-time, best-effort relocation of older layouts (a vault-root `settings.yaml`, or the interim `.settings/settings.yaml` folder) into the single `.settings` file; idempotent, preserves comments/values via filesystem rename.
- `SETTINGS_FILE = ".settings"` (`LEGACY_SETTINGS_FILE = "settings.yaml"` — only relevant to `migrateSettingsLocation`).

#### `schema/settingsSchema.ts`
`SETTINGS_SCHEMA: Schema` — the single source of truth for all settings. Every key has `type`, `default`, optional `min`/`max` or enum `values`, and `doc`. `DEFAULTS` is the plain nested object the frontend seeds from synchronously. The `keybindings` section is derived from `KEYBINDING_CATALOG`; the `toolbar.command` enum is derived from `COMMAND_IDS`. To add a setting: add here first, then add to `app/src/settings.ts` `Settings` interface, then wire the consumer.

#### `schema/registry.ts`
`loadRegistry(raw)` — parses the `properties:` YAML block from settings into a `Schema` of property type/display/validation entries. `BUILTIN_PROPERTIES` — built-in properties (tags, aliases, cssclasses).

#### `schema/types.ts`
`Schema`, `SchemaEntry`, `PropertyType` — type definitions for the schema engine. `PropertyType` kinds: `"text" | "number" | "boolean" | "date" | "list" | "link" | "enum" | "object" | "keybind"`.

#### `schema/validate.ts`
`validateDocument(doc, schema)` — validates a YAML document against a schema; returns `LintDiagnostic[]` for the editor's schema linter. Used by `editor/yamlSchema.ts`.

#### `schema/coerce.ts`
`coerceValue(value, type)` — coerces a raw YAML value to the expected type.

#### `schema/suggest.ts`
`suggestCompletions(prefix, schema, path)` — generates autocomplete candidates for a YAML path prefix. Used by `editor/settingsComplete.ts`.

#### `fsPaths.ts`
`listFsPaths(partial)` — filesystem path completion: given the partial path a user is typing into a `scope: "fs"` setting, lists matching directory entries so the editor can autocomplete them. The filesystem-rooted counterpart to `settingsComplete.ts`'s vault-rooted completion, for settings that name a path OUTSIDE the vault (absolute or `~`-relative).

---

### Theme

#### `theme/tokens.ts`
THE single source of truth for Bismuth's color system — CLAUDE.md calls this out by name. Lives in `core` (not `app`) because the dependency runs app → core: every color a *core* consumer needs (gcal's event-color mapping, the drawing palette, the settings schema's theme enum) must be importable from here, and `app/src/themes.ts` is a thin, byte-identical re-export so the frontend keeps its existing import path. DOM-free and dependency-free, so it unit-tests in isolation and is safe to import from the backend, the CLI, and the browser alike. Exports: `ColorTokens` (the type every consumer reads), `THEME_NAMES`/`THEME_LABELS`/`DEFAULT_THEME` and `THEMES: Record<ThemeName, ColorTokens>` for the four ASCII-redesign themes (ink/paper/cathode/riso), `CATEGORY_SWATCHES`/`ACCENT_RAMP` (the fixed teal→rose category ramp shared by the drawing toolbar, export theme, gcal, and `App.css` fallbacks — previously hand-copied into each), `THEME_ACCENTS` (per-theme accent hex), `SEMANTIC_DARK`/`SEMANTIC_LIGHT`/`SHADOW_DARK`/`SHADOW_LIGHT` (status colors + the flat elevation shadow, projected by `settingsCssVars` into `var(--danger)`/`var(--shadow-hard)` rather than literals), and `resolveTheme`/`resolveAppearance`/`semanticTokens`/`shadowTokens`.

---

### Commands and Keybindings

Pure catalogs living in `core` (no frontend imports) precisely so the settings schema can derive enums from them — see `schema/settingsSchema.ts` above, whose `toolbar.command` enum and `keybindings` section both come from these two files.

#### `commands.ts`
`COMMAND_CATALOG: CommandSpec[]` — metadata for every command the palette and configurable toolbars expose: `id`, `label`, default Lucide `icon`, and an `interactive` flag for a command whose action only opens a modal and waits on a person to finish it (so app control reports that rather than implying completion). `COMMAND_IDS` (derives the settings schema's `toolbar.command` enum), `UI_CONTROL_BLOCKLIST`/`isUiControlAllowed`/`uiControlAllowedIds` (commands app-control may never run), `commandLabel(id)`. The frontend binds each id to a live action in `app/src/commands.ts`'s `bindCommands`.

#### `keybindings.ts`
`KEYBINDING_CATALOG: KeybindingSpec[]` — metadata for every global, app-level keyboard shortcut: id plus its default combo string (`"Mod"` = Cmd/Ctrl, comma-separated alternatives, e.g. `"Mod+\`, Mod+J"`). Derives the settings schema's `keybindings` section, so `App.tsx` always reads `settings.keybindings.<id>` rather than a hardcoded combo; the frontend's own `app/src/keybindings.ts` supplies the `KeyboardEvent` matcher.

---

### Search and Replace

#### `search.ts`
`searchVault(vault, query, opts)` — MiniSearch-backed full-text ranking + `findMatches` line-snippet extraction. `SearchOpts`: `caseSensitive`, `wholeWord`, `regex`. `invalidateSearchIndex()` — called by `mutatingHandler` after vault mutations. `buildMatcher(query, opts)` — exported pure helper for snippet extraction.

#### `replace.ts`
`replaceInVault(vault, query, replacement, opts)` — batch find-and-replace across all vault files. Returns `{ path, count }[]`.

#### `searchPrompt.ts`
`promptSearch(...)` — the AI prompt-search fallback the switcher escalates to when the literal `/search` comes up empty for a natural-language question: runs a single one-shot Agent-SDK `query()` (the user's own `claude`, machine-login auth, exactly like `chat.ts`) to re-rank the MiniSearch candidates and pick the notes that genuinely answer the question. Anti-hallucination is structural rather than a matter of trusting the model: the model may only choose from the Stage-1 candidate paths (`buildCandidateContext`/`rankCandidates`) — any path outside that set is rejected outright — and every rendered snippet (`buildSnippet`/`bestSnippet`) is sliced byte-for-byte out of the REAL note body, never from model text; `validateResults` enforces both. `consumeModelStream`/`raceWithTimeout` (`AI_SEARCH_TIMEOUT_MS` = 120s) bound the model call. Backs `POST /search-prompt`, consumed by `palette/switcherAi.ts`.

---

### Bases

The Bases subsystem is a query/view engine for vault data. Full detail in the Bases docs; here is the module breakdown.

#### `bases/types.ts`
All shared types: `SourceSpec`, `ViewType` (12 values: `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap`), `ViewConfig`, `BaseConfig`, `Row`, `FileMeta`, `EvalContext`, `ParsedBase`, `QueryBlock`, `ResultGroup`, `ViewResult`. `VIEW_TYPES` array and `isValidType(t)`.

#### `bases/sourceSpec.ts`
`normalizeSource(raw, fm)` — coerces a frontmatter `source:` value (string or object) plus surrounding frontmatter (`from`, `ref`, `where`) into a `SourceSpec`. Handles unquoted `[[Wiki]]` YAML (which parses as a nested array) via `wikiStr()`. `refToPath(ref?)` — strips `[[...]]` wrapper, appends `.md` if needed.

#### `bases/source.ts`
`resolveSource(spec, vault, rows, tasks, cycleGuard?)` — server-side `SourceSpec` resolver. Cycle-guarded (throws `BASE_CYCLE`). `{ kind: "base" }` recursively resolves the referenced base's own source. `{ kind: "notes" }` filters the vault row feed. `{ kind: "tasks" }` filters the task row feed, optionally scoped to a base's notes. Called by `POST /rows`.

#### `bases/lexer.ts` + `bases/parser.ts` + `bases/parse.ts`
The Bases expression grammar pipeline:
- `lexer.ts`: `tokenize(expr)` — tokenizes a filter/formula string into tokens.
- `parser.ts`: `parseExpr(tokens)` — builds a raw AST from tokens.
- `parse.ts`: `parseBase(config)` / `parseBaseFile(content)` — parses a BaseConfig or a full `type: base` markdown file (reading frontmatter + table rows). `parseQueryBlock(text)` — parses a ` ```query ` block body.

#### `bases/ast.ts`
AST node types for the expression grammar.

#### `bases/evaluate.ts`
`evaluateExpr(ast, ctx)` — evaluates an AST node against an `EvalContext`. Called by the filter/query pipeline for each row.

#### `bases/filters.ts`
`applyFilter(filter, ctx)` — combinator-style filter evaluation. Handles `and`, `or`, `not`, and comparison nodes.

#### `bases/functions.ts`
`callFunction(name, args, ctx)` / `callMethod(value, method, args, ctx)` — built-in function dispatch tables keyed by value type (file, number, string, array, date). To add a function: add a case here, handle its return type in `query.ts` aggregation, test in `core/test/bases/query.test.ts`.

#### `bases/query.ts`
`runView(config, rows, fileMeta?)` — applies a BaseConfig's filters + formulas to a row set and returns `ViewResult`. Handles grouping, sorting, summaries. Called client-side in `BaseView.tsx`.

#### `bases/queryBlock.ts`
`parseQueryBlock(text)` — parses a flat ` ```query ` block body into a `QueryBlock` (`of`/`tasks`/`from`/`view`/`where`/`sort`/`group`/`limit`). Used by `editor/queryBlock.ts` in the frontend.

#### `bases/taskDsl.ts`
`translateTaskDsl(dsl, today)` — one-way translation of the legacy Obsidian-Tasks query DSL into a Bases filter expression (+ any `sort by …` as a `SortSpec[]`). `looksLikeTaskDsl(text)` — the cheap discriminator `source.ts` uses to decide whether a `tasks:` `where` needs translating. `applyTaskSort(items, sort, getProperty)` — the priority-rank-aware sort every caller of a translated sort shares. The only survivor of the deleted `tasks-query.ts`.

#### `bases/rows.ts`
Row-level utilities and aggregation helpers.

#### `bases/table.ts`
`parseMarkdownTable(content)` / `serializeMarkdownTable(rows, cols)` — GFM pipe-table parsing and serialization used for inline base rows in `type: base` files.

#### `bases/rowOps.ts`
`upsertRow(vault, path, row, index?)` / `deleteRow(vault, path, index)` / `reorderRow(vault, path, from, to)` — server-side rewrite of the markdown table in a base file. Called by `POST /row/update`, `POST /row/delete`, `POST /row/reorder`.

#### `bases/taskRow.ts`
`taskToRow(task)` / `rowToTask(row)` — projects a `Task` into a `Row` for the bases pipeline, and back. Task filtering itself is not here — a task `Row[]` is filtered through the same `passesFilter` (`filters.ts`) every other source uses; see `bases/taskDsl.ts`.

#### `bases/tasksData.ts`
`buildTaskRows(vault, from?)` — collects all tasks from vault files (optionally scoped to a subset) and converts to `Row[]` via `taskToRow`. Called by `server.ts` to build `cachedTasks`.

#### `bases/values.ts`
Value coercion and display helpers for the query/filter pipeline.

#### `bases/recurrence.ts`
Recurrence rule parsing and expansion for calendar events. `parseRecurrence(text)` / `expandRecurrence(rule, start, rangeStart, rangeEnd)`.

#### `bases/chart.ts`
Chart data aggregation for bar/line/stat/heatmap views. Used by the frontend chart view components.

#### `bases/properties.ts`
Pure helpers over a base's DECLARED property set (the `properties:` list form — see `parse.ts`'s `normalizeProperties`), kept out of `query.ts` so the frontend (add-card seeding, property pickers) can read the declaration without pulling in the whole query engine. `parseBasePropertyType`/`propertyType`/`toSchemaType` bridge a Bases property type to the settings schema's `PropertyType`; `validatePropertyValue`/`coercePropertyValue` validate and coerce a value against its declared type; `declaredDefaults`/`declaredFormulas`/`declaredPropertyKeys` surface the declaration itself.

#### `bases/yamlComment.ts`
`findCommentTruncations(frontmatter)` — detects the one silent YAML footgun a Bases filter expression can hit: in YAML a `#` preceded by whitespace starts a comment even inside an unquoted (plain) scalar, so `filters: tags.contains(" #book")` silently truncates at the space-hash even though nothing is malformed YAML. `bismuth base validate` calls this to report the exact line plus the fix (wrap the whole value in single quotes) instead of leaving a base quietly broken.

---

### SRS (Spaced Repetition)

#### `srs/scheduler.ts`
SM-2-style scheduler. `schedule(prev, response, today, cfg?)` → `SchedulingInfo { due, interval, ease }`. `SrsConfig` carries SM-2 parameters (baseEase, easyBonus, lapsesIntervalChange, minEase, easeStep, easyGraduatingInterval, goodGraduatingInterval) with defaults equal to historic hardcoded constants.

#### `srs/cards.ts`
Markdown card CRUD: `collectDecks(vault)`, `collectCards(vault)`, `noteCards(vault, path)`, `dueCards(vault)`, `applyReview(vault, id, response, today)`. Cards are parsed from `?` / `??` syntax in note bodies.

#### `srs/parser.ts`
`parseCards(content, path)` — extracts cards from a markdown note's `?`/`??` delimiters.

#### `srs/reviewRow.ts`
`applyReviewToRow(vault, file, index, response, cfg?)` — applies SM-2 scheduling to a base row (row-based flashcard) by rewriting the scheduling columns in the markdown table.

#### `srs/types.ts`
`Card`, `ReviewResponse` (`"easy" | "good" | "hard" | "again"`), `SchedulingInfo`.

---

### Tasks

#### `tasks.ts`
`collectTasksFromPaths(vault, paths?)` — extracts `Task` items from vault markdown files. `toggleTaskLine(vault, path, line, newStatus)` — rewrites one checkbox line in place. `Task` fields: path, line, status (`"todo" | "done" | "in-progress" | "cancelled" | "other"`), statusChar, description, priority, tags, due/scheduled/start/done/created/cancelled (ISO date), recurrence.

#### `taskParse.ts`
The task-line PARSER (`TASK_LINE` regex, `parseTaskLine`, `extractTasks`), split out of `tasks.ts` so the FRONTEND can value-import the real producer without dragging `tasks.ts`'s `getFileAccess` → `fileAccess.ts` → (dynamically) `files.ts` → `node:fs`/`node:path` into the WebView bundle. `app/src/bases/taskScope.ts` needs this exact function so the prospective row it evaluates a view's filters against can't drift from the row a real vault scan would produce. `app/src/browserBundleGraph.test.ts` guards against a future value-import of `tasks.ts` itself silently reintroducing the Node coupling — a break that neither `bun test app` nor `bun run typecheck` can see, since both run under Bun's Node-compatible runtime, and only surfaces as a real `vite build` failure.

#### `taskFields.ts`
The bracket-field grammar for task lines (`[due 2026-09-14]`, `[every week]`, `[high]`) — `FIELD_SCAN`, `isFieldText(inner)`, `parseFields(body)`, `formatDateField(key, iso)`, `splitRecurrence(text)` (cuts a `[every …]` rule at its first trailing `#tag`), `advanceDateByRecurrence(iso, rule)`. Pure, no I/O, so `tasks.ts`, `taskLegacy.ts`, `app/src/bases/taskWrite.ts`, the editor's field autocomplete and `bases/taskCardMarkup.ts`'s chip rendering all read one definition of what a field is.

#### `taskReorder.ts`
Pure task-status and task-block primitives (`statusFromChar`/`statusToChar`/`isResolvedStatus`, `collectBlock`/`reorderTaskBlocks`), split out of `tasks.ts` for the same reason as `taskParse.ts` — so the frontend (`app/src/editor/taskFold.ts`, `app/src/bases/taskWrite.ts`) can value-import them without dragging `tasks.ts`'s filesystem coupling into the WebView bundle. Imports nothing with runtime IO, only an erased `TaskStatus` type from `tasks.ts`. `statusToChar` is also what `core/src/bases/taskRow.ts` uses for a task stored as a base row, which never passed through a checkbox line at all. Re-exported from `tasks.ts` for existing importers.

#### `taskLegacy.ts`
The Obsidian-Tasks emoji reader, read ONE LAST TIME — `hasLegacySignifier(text)`, `readLegacyLine(line, path, lineNo)`. `parseTaskLine` (`tasks.ts`) no longer reads emoji at all; this module exists so `taskMigrate.ts`/`taskMigrateRun.ts` can still convert an old line, and it is imported from nowhere else — a second reader anywhere else would put both spellings back in play.

#### `taskMigrate.ts`
`migrateTaskLine(line)` / `migrateContent(text)` — rewrites emoji task signifiers to bracket fields, reading through `taskLegacy.ts`. No longer optional: `parseTaskLine` reads bracket fields only, so an un-migrated line is invisible to the app as a dated/prioritised/recurring task. Never refuses — always rewrites, and reports the lines whose rebuild didn't round-trip (`flagged`) rather than leaving them alone. `fieldsSurvived(before, after)` is the round-trip predicate behind `flagged`. Gated per LINE (`hasLegacySignifier`) so an already-correct line beside a legacy one is left byte-identical.

#### `taskMigrateRun.ts`
`runTaskMigration(root)` — the vault-wide, once-per-vault migration pass `createServer` kicks off at boot: scan every markdown file, and only if something actually needs rewriting take a local git snapshot (`commitVault`, `backup.ts`) before writing; aborts with `blocked: true` if the snapshot fails. Desktop/dev only (the snapshot shells out to `git`, absent on iPad) — never wired into `localBackend.ts`. `BISMUTH_NO_TASK_MIGRATE=1` skips it. See [task syntax → migration](../tasks/syntax.md#migrating-from-the-emoji-syntax).

**Deleted:** `tasks-query.ts` — the standalone Obsidian-Tasks-compatible DSL parser + executor. Task filtering now runs through the Bases filter language; see `bases/taskDsl.ts` above.

---

### Google Calendar Sync

Two-way sync between a calendar base (a `type: base` + `view: calendar` markdown file) and a real Google Calendar, kept entirely OUTSIDE the vault — credentials, tokens, and the per-base event-id link manifest all live under `~/.bismuth/gcal/`, so nothing OAuth-shaped is ever committed. `server.ts`'s 60s ticker plus `discover.ts` drive sync across every calendar base that has opted in; `cli/src/commands/gcal.ts` and `docs/gcal/overview.md` are the narrative entry points. `core/src/calendar.ts` (see **Other Backend Modules** below) is the pure calendar-FILE model this subsystem reads/writes into; everything here is the Google-side half.

#### `gcal/index.ts`
In-process orchestration of the OAuth flow — one instance per core process, like `relay.ts`. Holds the short-lived pending-PKCE map (keyed by the OAuth `state`) plus an access-token cache; persists durable credentials via `state.ts`. Surface: `setCredentials`/`startAuth`/`completeAuth`/`status`/`disconnect`/`getAccessToken`/`sync`.

#### `gcal/oauth.ts` + `gcal/pkce.ts`
Google OAuth 2.0 "Authorization Code + PKCE" flow for a desktop/installed client (RFC 8252). `oauth.ts`: `buildAuthUrl`/`exchangeCode`/`refreshAccessToken`/`revokeToken`; the single requested scope is `calendar.events` — no Gmail/Drive/contacts/sharing access. `pkce.ts`: `createVerifier`/`createState`/`challengeFromVerifier` (S256 challenge via SHA-256), pure and unit-tested, using the platform CSPRNG with nothing persisted across auth attempts.

#### `gcal/state.ts`
Durable credentials/tokens stored OUTSIDE the vault at `~/.bismuth/gcal/state.json`, written with `0600` perms — the vault's own `.settings` holds only non-secret operational config. `readGcalState`/`writeGcalState`/`clearGcalState`/`clearGcalToken`; reads never throw, degrading to `{}`.

#### `gcal/client.ts`
Minimal Google Calendar API v3 calls: `primaryInfo(accessToken)` (which account connected, via a 1-item `events.list` on the primary calendar), `listEvents` (with `SyncTokenExpired` for a stale incremental sync token), plus event CRUD guarded by `PreconditionFailed`/`DuplicateId`.

#### `gcal/config.ts`
Resolves the PER-CALENDAR sync config for one calendar base from its own frontmatter (`googleCalendarId`/`googleCalendarSync`). Falls back to the legacy single global `googleCalendar.*` setting for the one base it originally named, so an existing vault keeps syncing with zero changes and migrates onto per-base keys the next time sync is toggled in that calendar's settings.

#### `gcal/discover.ts`
`listGcalSyncTargets(vault)` — finds every calendar base in the vault with per-calendar sync enabled, so the background ticker can reconcile each against its own Google calendar without a single global `basePath` to walk.

#### `gcal/manifest.ts`
Sync bookkeeping kept OUTSIDE the vault: per calendar base, the map from a Google event id → the local Bismuth row id (plus last-seen etag/updated for conflict handling). Kept out of the base file's own rows so the frontend's calendar serializer — which only re-emits known event fields — can't silently drop extra sync columns on the next in-app edit. `gcalDir`/`readManifest`/`writeManifest`/`clearManifest` — one separate link map + sync token per synced calendar, so two calendars can never clobber each other's links. Entries are keyed by `manifestKey(vault, basePath)` (`${realpath(vault)}::${basePath}`), so a vault copy never shares the real vault's links; `baseSyncFor(m, vault, basePath, { claimLegacy })` gets or creates one and, only with `claimLegacy` (the installed app), claims a pre-namespacing bare-path entry. `gcalAutoSyncEnabled()` (the installed app, or `BISMUTH_GCAL_AUTOSYNC=1`) gates the auto-sync ticker and every route that calls Google or writes the machine-wide gcal state: sync, credentials, the OAuth start + callback, and disconnect. (`baseSyncOf`, the bare-path lookup, has no caller outside its own test.)

#### `gcal/lock.ts`
`withSyncLock(fn)` — a cross-process advisory lock so two backends (e.g. the dev server and the bundled app) can never run a sync against the shared manifest at the same time. Held only for the duration of one sync; a stale lock past its TTL is reclaimed. Throws `SyncLocked` on contention.

#### `gcal/map.ts`
Pure mapping between a Google Calendar event and a Bismuth calendar-base row's fields. `fromGoogle(ev)`/`toGoogle(...)`, `signature(m)` (a content signature for change detection), `googleEventId(bismuthId)`. Single (non-recurring) and all-day events only in the current phase; recurring masters and cancelled events resolve to `null` and are counted by the caller rather than mapped.

#### `gcal/recurrence.ts`
Pure translation between Bismuth's recurrence model and Google's RRULE: `buildRRule`/`parseRRule`/`firstOccurrence`/`recurrenceSignature`. Covers daily/weekly/biweekly/monthly with an optional weekday set and end date; unsupported rules (YEARLY, COUNT-bounded, multi-rule, RDATE/EXDATE, arbitrary INTERVAL) return `null` from parsing so the caller skips the event rather than mis-syncing it.

#### `gcal/sync.ts`
The two-way sync pass itself (`syncEvents(opts)`): pull (reconcile every remote event into the base), push (insert new local events, patch changed ones via `If-Match`/412 handling), then delete (events removed locally but still linked get deleted on Google). Change detection is timestamp-free where possible — a per-event content signature in the manifest flags local edits, the remote `updated` time flags remote edits — and only a genuine conflict (both changed) consults the `ConflictPolicy` (`lastWriteWins`/`googleWins`/`bismuthWins`). Recurring and cancelled-with-no-link events are skipped in this phase.

#### `gcal/colors.ts`
`categoryColorId(category)`/`nearestGoogleColorId(hex)` — maps a Bismuth category color (a theme token like `"accent"`/`"teal"` or a custom hex) to the nearest of Google's 11 fixed event colors, since `colorId` is an ordinary event field reachable with only the `calendar.events` scope. The swatch ramp + per-theme accents are sourced from `core/src/theme/tokens.ts` (the single source), not hand-mirrored here.

---

### Daemon Integration

The in-repo `@bismuth/daemon` workspace (`daemon/src/**`) is ONE machine process that multiplexes per-vault "brains". Machine-level identity (device-id, devices.json, owner.json, daemon.pid, logs, vaults.json) lives at `~/.bismuth/daemon`; each enabled vault's brain (crons, processes, memory, session-id, identity.md) lives under `<vault>/.daemon`. These core modules are Bismuth's READ/WRITE window onto that on-disk state.

#### `daemon.ts`
Reads (and minimally writes) the daemon's shared on-disk state. Never throws. Key exports:
- `daemonMachineDir()` — the machine-level identity dir: `BISMUTH_DAEMON_DIR` env, else `~/.bismuth/daemon`.
- `vaultDaemonDir(vault)` — a vault's brain dir, `<vault>/.daemon` (where crons/processes/memory/session live).
- `daemonIdentityName(vault)` — the daemon's name from `<vault>/.daemon/identity.md`'s `name:` frontmatter; drives the sidebar folder label + daemon-graph hub. Defaults to `"daemon"`.
- `migrateDaemonState(vault, legacy?)` — one-time, COPY-ONLY migration of a legacy `~/.claude-bot/{memory,crons,processes}` directory into `<vault>/.daemon` (per-file merge, never clobbers, never deletes the source). Machine-marker-gated (`.claude-bot-migrated`) so it lands in exactly ONE vault.
- `daemonStatus()` → `DaemonStatus { running, thisDeviceId, owner }`; `listDevices()` → `DeviceList`; `setOwner(deviceId)` — writes `owner.json`.
- `setCronEnabled(name, enabled, dir?)` / `setProcessEnabled(name, enabled, dir?)` — flip `enabled` frontmatter on a cron/process `.md` (the `dir` is a vault's `.daemon` dir; process also drops a reconcile trigger).
- `runCron(name, dir?)` — request an out-of-schedule run by dropping a trigger file the daemon polls.

#### `daemonGraph.ts`
`daemonSnapshot(home?)` → `DaemonSnapshot { daemon, crons, processes }`. Reads `crons/*.md`, `.last-fired.json`, `.running.json`, `processes/*.md`. `buildDaemonGraph(snap)` → `GraphData` with daemon hub node + cron/process children connected by `supervises` edges. `daemonGraph(home?)` — convenience wrapper. `DAEMON_NODE_ID = "::daemon"`.

#### `daemonActivity.ts`
Core's READ WINDOW onto the daemon's append-only activity log (`<vault>/.daemon/logs/activity-YYYY-MM-DD.jsonl`, one JSON object per line, one file per UTC day; written by `daemon/src/lib/activityLog.ts`). `readActivity(vault, query?)` — `ActivityQuery` supports a `limit` (default `ACTIVITY_DEFAULT_LIMIT` = 100, capped at `ACTIVITY_MAX_LIMIT` = 1000). Never throws, like every other reader in this family: a missing dir, an unreadable file, or a truncated line degrades to fewer events, never an exception — exactly the moment a cron post-mortem needs this to still work. `ActivityEvent` is a deliberate literal duplicate of the daemon's own shape rather than a cross-workspace import, since `@bismuth/daemon` is a separately-versioned, separately-bundled binary. Backs `GET /daemon/logs` and `bismuth daemon logs`.

#### `daemonPages.ts`
Core's read/write window onto "daemon pages" — the daemon inbox. A page is an ordinary markdown note the daemon authors at `<vault>/.daemon/pages/<slug>.md` (full-YAML frontmatter, parsed via `frontmatter.ts`), asking the user to approve or dismiss an action; its dynamic execution state (`PageStatus = "pending" | "working" | "done" | "failed" | "dismissed"`) lives in a separate JSON sidecar under `.daemon/pages/.state/<slug>.json` rather than the page's own frontmatter, so `Editor.tsx`'s external-reload reconcile (which blocks while the user has un-flushed edits) can never race a same-file daemon write. `listDaemonPages`/`readPageState`/`resolvePage` (looks up the pressed action, stamps its prompt/model/timeout into the sidecar, drops a trigger file the daemon's `processPageTriggers` polls) /`createDaemonPage`/`markPageFailed`. Core resolves the action's prompt HERE rather than in the daemon because the daemon's own frontmatter reader is a single-line parser that can't handle nested `actions[]` YAML, while core's `parseFrontmatter` has the real `yaml` library. Backs `cli/src/commands/page.ts`.

#### `daemonViz.ts`
`nodeVisualState(state, now?)` → `DaemonVisual { fill, border, opacity }`. Pure visual encoder for daemon/cron/process nodes. Tokens are abstract; the renderer resolves them against the live theme.

| State | fill | border | opacity |
|---|---|---|---|
| disabled | `"base"` | `"none"` | 0.15 |
| running | `"palette"` | `"none"` | 1 |
| enabled-idle | `"bg"` | `"palette"` | 1 |

#### `daemonState.ts`
Shared low-level helpers: `pidAlive(pid)`, `readJsonObj(path)`, `readFrontmatter(path)`, `isEnabled(data)`. Used by `daemon.ts` and `daemonGraph.ts` to read state files.

#### `daemonInstall.ts`
Installs the bundled `@bismuth/daemon` runtime as a launchd/systemd **service** so it keeps running while the app is closed. The app stages the compiled binary at `resources/daemon` (path in `BISMUTH_DAEMON_BUNDLE`). Every function is best-effort and never throws — a failed daemon install must never block the app. Key exports:
- `DAEMON_LABEL = "com.bismuth.daemon"`; `daemonBinPath()` — the stable installed path `~/.bismuth/bin/bismuth-daemon` (env override `BISMUTH_DAEMON_BIN`).
- `installStatus()` → `InstallStatus { installed, running, binPath }` — runs `<bin> --status` and parses its JSON; degrades to `{ installed: false, running: false }` when the binary is absent or errors.
- `runSetup()` → `SetupResult { ok, binPath, error? }` — runs `<bin> --ensure-installed` (idempotent; writes the plist/unit). Called by `POST /daemon/update` (the daemon updates WITH the app — there is no git-pull self-update).
- `installDaemonFromBundle()` — boot-time: copies the staged binary to `~/.bismuth/bin` (temp-file + atomic rename to dodge ETXTBSY on the running service) and runs `runSetup`. Version-gated by a size+mtime marker; no-op in dev (no bundle env).

---

### Relay Registry

#### `relay.ts`
In-process registry of Claude Code sessions running in Bismuth terminal tabs. Populated by `POST /relay/*` routes (from the relay plugin hooks). The "agents" graph that used to render this registry (you → session → subagent) was removed in commit `a6687c0`, along with `GET /agent-graph`; the registry and its hooks stay because `chat.ts` reuses `DONE_SUBAGENT_TTL_MS`/`RUNNING_SUBAGENT_MAX_MS` for its own, separate per-chat subagent bookkeeping (see `agents.ts` above), and because `terminal.ts` still calls `prune()` on tab close so the registry doesn't leak forever. Key exports:
- `registerSession(s)` — register or heartbeat a session; drops any previous session for the same `terminalId`. Takes an optional `backend` (which agent CLI is running — `"claude"`, `"codex"`, …); an omitted value falls back to the previous session's backend, or `"claude"` for a brand-new one, so pre-multi-backend reporters keep working.
- `endSession(sessionId)` — drop session + subagents.
- `startSubagent(s)` / `stopSubagent(s)` — add/mark-done a subagent.
- `prune(liveTerminalIds)` — drop sessions whose terminal is closed, orphaned subagents, done subagents past `DONE_SUBAGENT_TTL_MS` (8 s), and never-stopped subagents past `RUNNING_SUBAGENT_MAX_MS` (2 h — a lost `SubagentStop` must not pin a node forever). Called by `terminal.ts`'s `killSession` (imported there as `relayPrune`) — the only production caller now that `GET /agent-graph` is gone.
- `snapshot(now?)` → `RelaySnapshot { sessions, subagents }`. No production caller today; used by `core/test/server.test.ts` and `core/test/terminal.test.ts` to assert on registry state.
- `resetRelay()` — test-only cleanup.

---

### App Control

#### `uiControl.ts`
In-process registry of the app's OPEN WINDOWS and a request/reply command channel to each — the core→frontend control channel powering the `bismuth app …` CLI group and, through it, MCP app control: the one surface that can drive a running window's tabs from outside the WebView (list/open/close/focus/rename/pin/reorder tabs, run a safe command). Modeled on `relay.ts`'s Map idiom plus `chat.ts`'s pending-reply idiom, and lives in core (not a daemon) for the same reason relay does — the only clients are windows of THIS running app. `registerWindow`/`unregisterWindow`/`updateTabs`/`listWindows`, `resolveTarget(windowId?)` (`TargetResolution`, defaulting to the single open window when only one exists), `sendCommand`/`resolveReply` (pure over an injectable `send` function — the actual WebSocket is wired in `server.ts`'s `case "ui"` — so the whole round-trip is unit-testable like `relay.test.ts`), `DEFAULT_COMMAND_TIMEOUT_MS` = 8000.

---

### AI Visibility

Per-file/folder AI visibility: an HONESTY boundary, not a security boundary — it keeps the daemon's and in-app chat's own tool calls from reading a marked note, and never restricts the vault owner (editor/FileTree/graph/CLI, or their own interactive terminal Claude sessions). Full threat model: `docs/vault/visibility.md`.

#### `visibility.ts`
Storage + resolution: a file's frontmatter `visibility: "chat-only" | "hidden"` (absent means INHERIT, not "visible" — what makes folder inheritance work), or a folder's entry in `.settings`'s `folderVisibility` map (folders carry no frontmatter of their own). `resolveVisibility`/`resolveFolderVisibility`/`isVisibleToChat`/`isVisibleToDaemon` are pure and fully unit-tested, mirroring `daemonViz.ts`'s `nodeVisualState`. `buildDenyPaths(vault)` is the one I/O entry point — walks the vault + settings to produce a deny-list — and is deliberately NOT cached, since visibility is resolved fresh per gate. `VisibilityUndeterminedError`, `WalkLimits`/`MAX_WALK_ENTRIES` (200,000 — a walk-size circuit breaker), `DenyEntry`/`DenyPlan`/`resolveDenyPlan` (the deny-list computation), `buildManagedSettingsDeny`/`buildSandboxDenyPaths`/`sandboxDenyRead` feed a non-Claude backend's OS-level sandbox (`agentBackends/sandboxWrapper.ts`), `sandboxFailIfUnavailable` fails closed rather than silently unfiltered when the sandbox mechanism itself is unavailable.

#### `visibilityCliGate.ts`
The visibility gate for the `bismuth` CLI binary itself, which is BOTH the vault owner's own hand (where visibility deliberately does not apply) and, when Bismuth spawns an agent, that agent's hand too (where it must). Two entry points, one trust boundary each: `gateCliArgs` — the MCP path (`mcp/src/cli.ts` spawns the CLI as a subprocess of the `bismuth_cli` tool); channel comes from `BISMUTH_MCP_CHANNEL`, defaulting to the stricter `"daemon"` channel when unset. `gateCliInvocation` — the CLI's own single dispatch point (`cli/src/index.ts`), so an agent running `bismuth` directly in a shell with no MCP layer is gated too; channel comes from `BISMUTH_AGENT_CHANNEL`, where unset means the OWNER's own hand (interactive shell, dev script, CI) and passes through with no gate at all. `mcpChannel`/`cliAgentChannel` resolve the channel; `CommandTier`/`commandTier(args)` classifies a command's sensitivity; `GateDecision`/`decideCliGate` is the pure ruling; `gateCliArgs`/`gateCliInvocation` are the two impure entry shells.

---

### Chat / Agent Backends

The visual chat (`/chat` WebSocket) drives any of **nine** agent-CLI backends behind one wire protocol. `chat.ts` is the Claude Agent-SDK driver and the single source of truth for that protocol; `chatProviders/` routes a chat session to whichever backend owns it and holds the other eight drivers; `agentBackends/` is backend-agnostic tooling (the capability catalog, install-time doctor, sandboxing, visibility gating) used by both chat and the CLI's `backends`/`install` groups. Full narrative: `docs/chat/overview.md`, `docs/chat/backends.md`.

#### `claudeWhich.ts`
Locates the user's installed `claude` binary for the Agent SDK, since a Finder-launched GUI app (and the daemon under launchd/systemd) inherits a minimal PATH that never sees a Homebrew or nvm install. `whichClaude()`/`whichBinary(name)`/`claudeLookupPath` walk an augmented PATH; `nvmBinPaths(env?)` additionally finds nvm-installed Node bin dirs (`$NVM_DIR/versions/node/<version>/bin`), preferring the default-aliased version. `claudeSpawnEnv(...)` builds the environment an SDK `query()` spawn needs. Shared by `chat.ts`, `searchPrompt.ts`, `terminal.ts`, `selfUpdate.ts`, and `bismuthInstall.ts`; `daemon/src/lib/claudeWhich.ts` is a literal copy kept in the daemon workspace, which cannot depend on `@bismuth/core`.

#### `chat.ts`
The Claude backend, and the single source of truth for the `ChatFrame` wire protocol every backend speaks. Key exports: `ChatFrame` (the discriminated union sent down the WS — manifest/session/title/text/tool/thinking/done/error/… frames), `ChatManifest`, `ChatSink = (frame: ChatFrame) => void`. `openSession`/`resumeSession`/`sendMessage` run one long-lived Agent-SDK `query()` per chat over the user's own `claude` binary. `makeUserMessage(text, images, editorContext)` assembles a turn; `stripEditorContext(text)` strips the injected `<editor-context>` preamble back off for display/history. `ChatOrigin = 'user' | 'daemon'` + `ChatScope`/`CHAT_SCOPES`/`filterSessionsByScope`/`excludeDaemonSessions` separate the user's own chats from daemon-originated ones (cron/boot sessions) in the history picker. `visibilityRefusalMessage(...)` builds the refusal text when a vault's hidden-notes policy can't be honored by the active backend/channel. `buildChatSandboxOption(...)` wires `agentBackends/sandboxWrapper.ts` in for non-Claude backends. `listChatSessions`/`sessionHistoryFrames`/`chatSnippet`/`ChatSearchHit`/`ChatSearchDoc` back the History picker + `POST /chat/search`. `computerUseChange(...)` handles live `--chrome` (browser/computer-use) toggling mid-session. `isMcpCommand`/`LOCAL_SLASH_COMMANDS`/`withLocalSlashCommands`/`formatMcpStatus` support the client-side `/mcp` slash command. `ASK_USER_QUESTION_TOOL`/`extractAskUserQuestions`/`buildAskUserQuestionAnswer` handle the SDK's `AskUserQuestion` tool. `sessionModelFromMessages`/`unstreamedAssistantFrames` reconstruct model/frame state from a resumed session's transcript.

#### `chatDaemonLegacy.ts`
A ONE-TIME BACKFILL of daemon session provenance for sessions minted before the durable `<vault>/.daemon/session-ids` set existed — on the machine that surfaced the bug, ~1,000 transcripts existed for one vault, of which 129 were daemon boot sessions and 759 were cron sessions (89% of the history picker), and the durable set alone would have started empty and left every one of them still listed. Recovers them once, up front, rather than aging them out over ~30 days.

#### `chatModelStore.ts`
Durable PER-SESSION (not per-tab) model choice, keyed by the Agent SDK's `session_id` so a conversation resumed into any tab (history picker, Cmd+Shift+T, app relaunch) comes back on the model it was last set to. Server-side because the packaged app is a WKWebView whose `localStorage` is best-effort and per-tab keys can't follow a session across tabs; re-applies the choice on resume as belt-and-braces alongside the CLI's own (verified, but only-after-first-turn) session store.

#### `chatProviders/index.ts`
The chat PROVIDER router: one seam letting a chat session run on any backend in `backends.ts`'s registry, all speaking the same `ChatFrame` wire protocol so `ChatView` renders any of them unchanged. Routing rule: a chat id with a live session anywhere routes to THAT backend (conversation continuity beats a stale provider field); otherwise the creation verbs (`open`/`send`/`resume`) honor the requested provider.

#### `chatProviders/backends.ts`
The chat-backend REGISTRY: one uniform `ChatBackend` shape per driver, so `index.ts` routes by lookup instead of a hand-written if/else chain repeating `if (target === "opencode") … else …` across eleven verbs (which could not absorb a third backend). Each driver keeps its own module-level signature untouched (`chat.ts` still takes `(chatId, text, cwd, sink, images, memoryDir, computerUse)`); the adapters here are the only place the difference between drivers is expressed.

#### `chatProviders/sessionSink.ts`
Transport-agnostic session-frame buffering shared by every backend — `chat.ts`'s Claude sessions, `opencode/opencode.ts`'s opencode sessions, `acp/driver.ts`'s six ACP-based sessions (cline/gemini/goose/openclaw/claude-code-acp/codex-acp), and `codex/driver.ts`'s codex sessions — nine backends total, each satisfying `SessionSink` structurally. Registers sessions keyed by a client chat id; on an abnormal WS drop, BUFFERS outgoing `ChatFrame`s (capped) instead of firing into the dead socket, and on reconnect/reopen flushes the buffer and (between turns) pushes a synthetic `done`.

#### `chatProviders/titleFromPrompt.ts`
Shared "synthesize a chat tab title from the user's first prompt" helper. Claude gets a real conversation-summary title off the SDK, but ACP/opencode carry no session-title field on the wire at all, so both the ACP driver and `opencode/opencodeTranslate.ts` call this on a new session's first message instead of duplicating the preamble-strip + truncate logic.

#### `chatProviders/acp/` (`agents.ts`, `driver.ts`, `protocol.ts`)
The six ACP (Agent Client Protocol)-based backends — cline, gemini, goose, openclaw, claude-code-acp, codex-acp — behind one driver. `protocol.ts` is the ACP wire types; `driver.ts` is the session lifecycle over that protocol (open/send/resume, translated to `ChatFrame`s via `sessionSink.ts`); `agents.ts` is the per-agent config (binary resolution, launch args) for each of the six.

#### `chatProviders/codex/` (`driver.ts`, `protocol.ts`)
The Codex backend: `protocol.ts` is Codex's own wire types, `driver.ts` runs a Codex session and translates it to `ChatFrame`s. Also owns `CODEX_AGENTS_MD_CONTENT` — the managed `AGENTS.md` block (written via `agentBackends/agentsMd.ts`) that points Codex at the `bismuth_skill` MCP tool, since Codex has no native skills mechanism.

#### `chatProviders/opencode/` (`opencode.ts`, `opencodeServer.ts`, `opencodeTranslate.ts`)
The opencode backend: `opencodeServer.ts` manages the local `opencode` server process, `opencode.ts` is the per-turn `opencode run --format json` driver, `opencodeTranslate.ts` converts opencode's message shape to `ChatFrame`s (and re-exports `titleFromPrompt.ts`'s helper as `opencodeTitleFromPrompt` for existing call sites).

#### `agentBackends/catalog.ts`
The PURE catalog of agent backends Bismuth can drive — deliberately zero imports (no Bun APIs, no `node:fs`, no driver modules), because it's imported by the settings schema (`.settings` autocomplete/lint, bundled for the app), the frontend (chat header pickers, capability gating), and the runtime registry alike, so it must stay safe for the browser/iPad bundle. Declares what each CLI *can* do; anything effectful (resolving a binary, spawning) lives elsewhere.

#### `agentBackends/doctor.ts`
"Which agent backends actually work on THIS machine?" The catalog is a claim about a CLI, not about this computer — a binary may be absent, or too old for a flag a driver passes. `checkBackends()` probes each one for real (resolves the binary, asks for a version string) and returns a `BackendReport[]`; backs the CLI's `backends` command and the chat header's setup screen.

#### `agentBackends/agentsMd.ts`
A managed-block writer for the `AGENTS.md` context-file convention that Codex, Cursor, Amp, and Droid all read as their "give me persistent context" channel (Gemini's variant is `GEMINI.md`). Deliberately not under `chatProviders/codex/` — Codex is the first backend to use it, not the only one that will. `writeAgentsMdBlock(cwd, content)` preserves any content the user hand-authored outside the delimited `<!-- bismuth:managed:start -->`/`...:end -->` markers.

#### `agentBackends/codexHooks.ts`
Generates a project-scoped `.codex/hooks.json` (+ its companion reporting script) so a bare `codex` launched with cwd = a Bismuth vault reports its session lifecycle into Bismuth's relay registry WITHOUT a PATH shim — Codex auto-discovers `.codex/hooks.json` for any invocation whose cwd is inside that project. See `docs/chat/backends.md`'s Surface 3.

#### `agentBackends/mcpRegistrars.ts`
Generalizes Bismuth's MCP-server registration from "Claude Code only" (`bismuthInstall.ts`'s `registerMcp()`) to every agent CLI the user has installed — useful even for a CLI Bismuth never drives as a chat backend (e.g. OpenClaw is a poor chat backend but its MCP story is fine), so this stays independent of `agentBackends/catalog.ts`. Mirrors `bismuthInstall.ts`'s `InstallIO` seam: every effectful operation is injected so the logic is testable without touching a real filesystem/CLI.

#### `agentBackends/sandboxWrapper.ts`
OS-level read-deny wrapper for a non-Claude backend, macOS only: wraps a spawn argv in `sandbox-exec` (Seatbelt) so a vault's restricted files are unreadable to the wrapped process's Read tool AND its Bash `cat`/`grep`, with ZERO cooperation from the wrapped CLI — the kernel VFS enforces it against the whole process tree. Gives a backend with no native per-path deny (opencode today) a real gate instead of "none". See `docs/vault/visibility.md`.

#### `agentBackends/visibilityGate.ts`
THE chokepoint: may backend B serve channel C for vault V, given what V hides? Exists because the per-backend chat drivers were written independently and none of codex/cline/gemini/goose/openclaw/the two ACP adapters checked visibility at all before this — the refusal `ChatFrame` existed and the docs said those backends were "refused", but in reality they would have spawned and run UNGATED against a vault with hidden notes. Seven drivers cannot be kept honest by review; one chokepoint can.

---

### Terminal

#### `terminal.ts`
PTY session manager. `createTerminalSession(cols, rows, relayUrl, cfg)` — spawns a PTY via `bun-pty`, builds its env via `buildPtyEnv`, returns a `Session { id, pty, cols, rows }`. `buildPtyEnv(p: PtyEnvParams)` — pure function that constructs the child env: strips undefined values, sets `TERM=xterm-256color`, suppresses oh-my-zsh update prompts, injects `CLAUDE_RELAY_URL`/`CLAUDE_TERMINAL_ID`, and if `claude` is resolvable: sets `BISMUTH_REAL_CLAUDE`/`BISMUTH_RELAY_PLUGIN`, sets `ZDOTDIR` for zsh (defines a `claude` function immune to PATH reordering), and prepends the shim dir to `PATH` for non-zsh shells. `killSession(id)`, `resizeSession(id, cols, rows)`, `getSession(id)`, `listSessionIds()`.

`REAL_CLAUDE` is resolved once at module load using an augmented PATH (adds Homebrew, ~/.bun/bin, ~/.local/bin, and nvm node bins) to handle GUI apps launched with minimal PATH and `claude` installed via Homebrew or nvm.

---

### Other Backend Modules

#### `dailyNote.ts`
`dailyNotePath(config, date?)` — resolves the vault-relative path for a daily note (date-formatted filename in configured folder). `dailyNoteContent(config, date?)` — generates the initial note content from a template if configured.

#### `newNoteTemplate.ts`
A brand-new note created from an optional configured template (`settings.templates.newNote`) — mirrors `dailyNote.ts`'s "config + now → initial content" shape, staying headless while all IO stays in the caller. The wrinkle this module exists for: unlike a daily note (whose filename is decided up front and never renamed), a new note is created under a placeholder name (`"Untitled.md"`) and dropped straight into the file tree's inline rename, so the name it's CREATED with is almost never the name it KEEPS. `applyNewNoteTemplate(...)` therefore prefetches the template immediately (so the user's typing overlaps the read) but expands and writes only once the rename has settled, so nothing (the expanded `{{title}}`, the `{{cursor}}` offset, the note-cache entry) binds to a path that's about to stop existing.

#### `templates.ts`
`expandTemplate(raw, ctx)` — expands template variables (`{{title}}`, `{{date}}`, `{{time}}`, etc.) in a template note. Returns `{ text }`.

#### `dates.ts`
`todayISO()`, `addDaysISO(date, days)`, `parseISO(s)`, `formatISO(d)`, `daysUntil(date)`. Shared by tasks, SRS, calendar, and the CLI.

#### `calendar.ts`
Headless, pure calendar-FILE logic — the API surface the daemon/agents drive through the `bismuth calendar …` CLI group instead of hand-editing raw YAML (which the app's own rewriter strips quotes from, adds `localUpdated` to, and can't remove one recurring occurrence from). Ported from `app/src/bases/calendarSerialize.ts` + `app/src/calendar/{dates,EventStore}.ts`. A calendar lives in a `type: base` + `view: calendar` markdown file: events are the base's row table, categories a frontmatter key; every write preserves the WHOLE frontmatter and touches only events + categories. `Category`/`CalendarEvent`/`ParsedCalendar`, `rowToEvent`/`parseCalendarFile`/`serializeCalendarFile`/`emptyCalendarFile`, `eventsForRange`/`eventsForDay`/`eventsInWindow`/`searchEvents`, `detectOverlaps`/`findEvent`, `recurrenceFromRRule`; re-exports `toDateStr`/`addDays`/`expandRecurrence` from `bases/recurrence.ts`, the canonical copy of the recurrence model.

#### `basesData.ts`
`buildVaultRows(root)` — builds the vault-wide `Row[]` feed (one per `.md` file, with `FileMeta` + frontmatter) using `getFileAccess()`. This is the unscoped vault row cache (`cachedRows` in `server.ts`).

#### `localBackend.ts`
`createLocalBackend(opts)` — in-process server for mobile (iPad) where no Bun process can run. Implements the same route surface as `server.ts` but runs entirely in-WebView. See `app/src/mobile/`.

#### `bismuthInstall.ts`
Machine-wide install of the `bismuth` CLI + MCP server. The bundled app ships compiled `bismuth`/`bismuth-mcp` binaries and the `docs/` tree as a Tauri resource (path in `BISMUTH_INSTALL_SRC`); on boot (and via `bismuth install`) `ensureBismuthInstalled()` copies that source under `~/.bismuth`, symlinks the CLI onto `PATH`, and registers the MCP server in the user's GLOBAL Claude config (`claude mcp add -s user`) — every terminal and every Claude session gets it, not just Bismuth app tabs. Version-gated + idempotent via a content hash at `~/.bismuth/.version`; every side effect is injected through an `InstallIO` seam so the logic is testable without touching a real filesystem/CLI. Also owns `stageSkills`/`linkSkillToClaudeCode`/`isSkillLinkedToClaudeCode` (symlinks `~/.claude/skills/authoring-bismuth-bases` at install — see the `skills/` section), `registerAdditionalMcp`/`getAdditionalMcpStatus` (generalized in `agentBackends/mcpRegistrars.ts`), and `uninstallBismuth()`.

#### `selfUpdate.ts`
Git-based self-update for the bundled Bismuth app. The bundled app is built from a local clone; the build bakes a `build-origin.json` (repo root + sha) into the tools resource, which `getUpdateStatus()` uses to detect when the INSTALLED build is behind `origin/main` — measured from the built sha, not the clone's live HEAD, so a developer who commits+pushes from the build-source clone still sees the update. `startUpdate()` runs `git pull --ff-only` + `bun run tauri build`, then hands off to a detached script that waits for the app to quit, swaps the `.app` bundle, and relaunches; `getUpdateProgress()` reports `UpdatePhase = "idle" | "pulling" | "building" | "ready" | "error"`. Self-disables (never throws) when there's no source build — e.g. `bun run dev:browser` — surfacing as an `"error"` phase with a reason instead. Backs `cli/src/commands/update.ts` and `GET /update/status` / `POST /update/apply`.

#### `runRegistry.ts`
A tiny on-disk registry of RUNNING core servers so an out-of-app caller (the `bismuth app …` CLI, the daemon) can discover which port serves which vault. The bundled app binds a dynamic free port visible only to its own WebView (`window.__BISMUTH_API__`), and in-app terminal tabs already get the right URL via `CLAUDE_RELAY_URL`/`BISMUTH_API`, but a separate process like the launchd daemon service has neither — so each core drops a record here on boot: `~/.bismuth/run/<b64url(vault)>.json = {port, vault, pid}`. `writeRunRecord`/`deleteRunRecord`/`readRunRecords`/`resolveRunRegistryBase(vault?)`. Best-effort, never authoritative (a hard-killed core just leaves a stale file the CLI's fetch fails past); one rule governs cleanup — a record is only ever deleted on PROOF its owner process is dead, never merely because it looks stale.

#### `tempPath.ts`
`isTempPath(p)` — true for paths under the OS temp root(s), split out of `pathUtils.ts` so that file's pure helpers stay importable from the browser bundle (this one pulls in `node:os`/`node:path`, so only server-side modules may import it). Shared by `daemon.ts` (`registerVaultRoot`) and `runRegistry.ts` (`readRunRecords`) so the two don't grow separate, possibly-drifting copies of the same guard. A temp path is grounds to DECLINE registering a record or to EXCLUDE one from results — never grounds to DELETE a record whose owning process is still alive; liveness is the only license to delete.

#### `d3-force-3d.d.ts`
Type stubs for the `d3-force-3d` library (no upstream `@types` package).

---

## `core/src/drawing/` — Drawing Backend

Pure, headless (no DOM, no Bun). All modules are importable from Node/browser Workers.

### Drawing Modules

#### `model.ts`
Schema and serialization for `.draw` files. `DrawingDoc { v: 1; kind: "drawing"; paper: Paper; pages: Page[] }`. `Stroke { t: Tool; c: string; w: number; straight?: boolean; pts: number[] }` — pts are flat `[x, y, pressure, x, y, pressure, ...]` triples, pressure 0..255. `emptyDoc()`, `parseDoc(text)`, `serializeDoc(doc)`, `roundDoc(doc)` (rounds pts to integer/byte precision).

#### `geometry.ts`
`strokeOutline(stroke, opts?)` — converts a stroke's pressure-sampled points to an outline polygon via `perfect-freehand`.

#### `smooth.ts`
`smoothStroke(stroke)` — post-release spline relaxation (applied on pointer-release, not during drawing). Reduces noise without lag.

#### `render2d.ts`
`renderDoc(doc, canvas, theme, page?)` / `renderPage(page, ctx, theme)` — Canvas 2D rendering. Highlighter strokes use `multiply` blend mode. Theme carries `bg`/`fg` color strings.

#### `paper.ts`
`renderPaper(bg, ctx, theme)` — renders blank/lines/grid/dots backgrounds onto a Canvas 2D context.

#### `theme.ts`
7-color drawing palette. `DRAWING_PALETTE` array, `paletteColor(index, theme)`.

#### `export.ts`
`renderDocToPng(doc, theme, page?, scale?)` / `renderDocToPdf(doc, theme)` — headless PNG/PDF export via `@napi-rs/canvas` + `pdf-lib`. Called by `POST /export` (or the CLI `export` command) for server-side rendering.

---

## `core/test/` — Backend Tests

Each source module has a corresponding `*.test.ts`. Notable:
- `core/test/helpers.ts` — `makeSampleVault()` used by most vault-touching tests.
- `core/test/bases/` — one test per bases module.
- `core/test/srs/` — one test per SRS module.
- `core/test/drawing/` — one test per drawing module.
- `core/test/schema/` — schema validation tests split by feature.
- `core/test/server.test.ts` — integration tests against a live server instance.
- Run: `bun test core` (all), `bun test core/test/<file>.test.ts` (one file), or `bun test <pattern>` (filter by filename — **not** `bun test core -- <pattern>`, which silently ignores the filter and runs the entire suite because `core` itself matches every path under `core/test/`; see `docs/contributing/testing.md`).

---

## `app/src/` — Frontend Application

Solid.js + TypeScript + CodeMirror 6. Styled with CSS Modules colocated with components; `App.css` is now a thin GLOBAL layer only (design tokens, the element reset, and classes written into runtime-generated HTML strings) — everything else that used to live there has moved into per-component `<Name>.module.css` files (~330 rules migrated) or `app/src/styles/` (`tokens.css`, `reset.css`, `content.css`, `icons.css`, imported by `App.css` in that load-bearing order — CSS `@import` hoists, so moving a rule between files can flip cascade precedence between two equal-specificity selectors; `cssLayering.test.ts` pins a descending ceiling on App.css's remaining class-rule count so nothing new accumulates there). `ChatView.css`, `DaemonList.css`, `PaneTree.css`, and `palette/palette.css` were deleted outright once their rules had homes.

### Root / Shell

#### `index.tsx`
Entry point. Mounts `<App />` into `#root`. Desktop entry — does not import `mobile/bootMobile.ts`.

#### `App.tsx`
Root component (3200+ lines). Owns: tab + pane tree state (via `panes.ts` model), active file routing, graph mode (`GraphMode = "2nd" | "3rd" | "both" | "daemon" | "local"`), sidebar visibility, settings persistence, global keyboard handling (reads `settings.keybindings`), command binding (via `bindCommands`), toast/gallery hosts, all modal triggers, and the drag state behind `DragGhost`. Lazily imports `GraphView` and `TerminalTab` to keep the entry bundle small. Seeds a `::graph` tab on first boot and reopens one if all tabs close. Composes its render out of the `shell/` components below (`AppFrame` as the outer frame, `TopStrip`/`StatusBar` (with `InboxIndicator`)/`Sidebar`/`EditorPane`/`TabRail`/`GraphFloater`/`PaneOverlay`/`DragGhost`/`WindowControls`/`CommandButton`), handing each one already-resolved props/slots — none of `shell/`'s own components read `settings`, fetch, or own a signal.

Key logic: `applyView(graph, view)` overwrites node positions with a brain-view's precomputed layout for 2nd/3rd modes. Storage keys: `"bismuth-tabs-v1"`, `"bismuth-sidebar-visible-v1"`, `"bismuth-graph-cache-v1"`, `"bismuth-theme-vars-v1"`.

#### `panes.ts`
Pure binary-tree pane model (no DOM, no Solid). Types: `Leaf { kind, id, content }`, `Split { kind, id, dir, ratio, a, b }`, `PaneNode = Leaf | Split`, `Tab { id, root, focusId, name? }`. Operations: `makeLeaf`, `makeTab`, `splitLeaf`, `closeLeaf`, `equalize`, `focusNeighbor`, `setContent`, `setRatio`, `findLeafByContent`, `leaves`, `leafCount`, `pruneMissing`, `migrateLegacyContent` (rewrites removed content ids on restore — `LEGACY_CONTENT_IDS`, e.g. `::search` → `::graph`), `movePane`, `reorderTabs`, `splitLeafWithNode`, `replaceLeafWithNode`, `replacePaneWithPane`, `detachLeafToTab`, `serializeTabs`, `deserializeTabs`, `resolveFocus`. Fully unit-tested in `panes.test.ts` and `PaneTree.cleanup.test.ts`.

#### `tabIds.ts`
Sentinel content ids (all start with `::`): `GRAPH_TAB = "::graph"`, `EMPTY_PANE = "::empty"`, and the prefixed ids `TERMINAL_PREFIX = "::term:"`, `EXPORT_PREFIX = "::export:"`, `DAEMON_TAB = "::daemon"` (the daemon page; its docked chat is `CHAT_PREFIX + DAEMON_CHAT_ID`, i.e. `::chat:daemon`), plus the `::flashcards:` prefix (consistent with the sentinel list in `CLAUDE.md`). `contentLabel(content, terminalIndex?)` and `contentIcon(content)` derive display strings/icons from content ids; a plain file path routed to the read-only `PreviewView` (via `previewKind()`, see `preview/`) gets its label/icon from there too. There is **no `::search` sentinel** — search is the unified Cmd+O switcher takeover (`palette/SwitcherBar.tsx`); persisted `::search` tabs from older builds are migrated to `::graph` on restore, and persisted `::inbox` tabs (the old daemon inbox tab) to `::daemon` (`LEGACY_CONTENT_IDS` in `panes.ts`).

#### `PaneTree.tsx`
Renders the binary pane tree; manages pane drag-and-drop via `dnd/viewDrag.ts`. Handles split/close/resize interactions. `PaneLeaf` (one pane's own content + focus/right-click reporting + view-drag drop target (tab/pane/tree-row POINTER drags via dnd/viewDrag.ts — the old HTML5 `application/x-bismuth-path` drag-to-split path is gone; nothing ever set that MIME)) was promoted out of this file into its own `PaneLeaf.tsx`, which in turn delegates its mini view-bar breadcrumb to `PaneHeader.tsx` and its split/chat-reference drop affordances to `PaneDropZone.tsx` — `PaneTree.tsx` itself is now just the tree walk. All four share `PaneTree.module.css` (not one module apiece — `.pane-leaf.focused .pane-header` and similar rules cross the file boundaries).

#### `PaneContent.tsx`
Routes a pane content id to the correct view component. Note path → `FileView` (or the lighter read-only `PreviewView` for a non-note file whose `previewKind()` matches — images/PDFs/code/text; see `preview/`); `*.sheet` → `SheetView`; `*.draw` → `DrawingPage`; `::graph` → (forwarded to `App`'s `renderGraph` prop); `::term:*` → `TerminalTab`; `::export:*` → `ExportView`; `::daemon` → `daemon/DaemonPageHost` (lazy); the retired `::annotate:<file>` (a restored old tab) → that file's `PreviewView`; `.settings` → `Editor`; `type: base` files → `BaseView`. Unknown/legacy sentinels fall back to `EmptyPane` (there is no `::search` route — see `tabIds.ts`).

---

### Shell (`app/src/shell/`)

The App.tsx-shell componentization: presentational chrome lifted verbatim out of `App.tsx` into its own colocated `.tsx` + `.module.css` + `.stories.tsx` triples. Every component here is posed entirely from props — slots (`JSX.Element` props) over prop-drilling, no signal ownership, no fetching — so each renders in Storybook with stub content and no transport. Cross-boundary DOM measurement (`ResizeObserver` reads for the graph floater's placement, the overlay hosts) deliberately stays in `App.tsx` rather than moving down into these components; each one only exposes the `ref` callback prop needed to receive the result.

#### `AppFrame.tsx`
The outermost grid: eight slots (`topStrip`, `sidebar`, `main`, `rail`, `floater`, `modals`, `overlays`, plus `hasRail`) composed in the same DOM order as the original inline JSX (sidebar, main, rail, floater, modals, overlays). `hasRail` stays a real prop (not simplified to a constant) because `.layout.has-rail` in `App.css` gates the `--rail-w` transition and the switcher-active override.

#### `TopStrip.tsx`
The wordmark + platform titlebar strip. macOS runs a transparent Overlay titlebar (native traffic lights float over it); Windows/Linux render `WindowControls` as `children`; the browser/dev build gets neither. Carries `data-tauri-drag-region="deep"` so descendant elements (not just the exact strip element) are draggable.

#### `WindowControls.tsx`
The typed `[-] [+] [x]` titlebar buttons for non-macOS Tauri windows. The platform gate (`isTauri() && !IS_MAC_PLATFORM`) and the `@tauri-apps/api/window` calls stay in `App.tsx`; this component only draws.

#### `Sidebar.tsx`
Vault-name eyebrow, toolbar row, file tree, and the docked graph mini-square. `toolbar` and `tree` are handed finished JSX rather than this component knowing what a command or a `FileTree` prop is.

#### `EditorPane.tsx`
The main editor column: optional update banner, the Cmd+O switcher bar overlay, and the scrollable body hosting the active tab's pane tree plus the always-mounted terminal/chat overlays.

#### `TabRail.tsx` / `TabRailRow.tsx`
The app's only tab presentation — a right-edge vertical rail, collapsed to 48px and expanding to 232px on hover/focus-within. `TabRail` is the rail shell (actions + rows as slots); `TabRailRow` is one row (icon, label or inline rename input, close-X/pin). They deliberately **share one `TabRail.module.css`** rather than each getting its own — eight hover/focus selectors span both components' elements, and per-file hashing would silently break the ones that cross the boundary.

#### `CommandButton.tsx`
The purely-presentational half of the configurable toolbar button (shared by the sidebar header bar, the tab strip, and the tab rail): an icon button plus an optional numeric `Badge`. Resolving a `{command}`/`{commands: […]}` config to a live `Command`, and computing the inbox badge's live due-count, stays in `App.tsx`'s local `ToolbarButton` wrapper.

#### `DragGhost.tsx`
The floating ghost that follows the cursor during a tab/pane drag; `pointer-events: none` so `elementFromPoint` can still resolve the drop target beneath it. Receives already-resolved pixel coordinates — the clamp arithmetic against live drag state stays in `App.tsx`.

#### `GraphFloater.tsx`
The single always-mounted Knowledge Graph wrapper, floated over whichever slot is active (sidebar mini-square, full main pane, or a tab's graph pane host) so switching tabs/splits repositions it instead of tearing down and rebuilding the renderer (which would reset the camera). `placeFloater`'s direct `top`/`left`/`width`/`height` writes onto the ref'd element stay in `App.tsx`.

#### `PaneOverlay.tsx`
Terminal-only: the always-mounted overlay shell positioned over a pane's `data-terminal-host` placeholder so a PTY survives tab/pane switches without remounting. Chat no longer needs this — a chat's WebSocket/transcript/draft live in the session registry (`app/src/chat/chatSessions.ts`), independent of any view, so `ChatView`/`DaemonChat` render inline (`PaneContent`, the daemon page) and simply unmount/remount on tab switches instead of needing a covered placeholder.

#### `StatusBar.tsx`
The status-bar field-log line: vault name, focused pane's content, connection health (from `serverVersion`'s `ConnectionState`), then right-aligned the inbox indicator and the daemon state, closed by a blinking caret. `onCopyVault` (which pushes a toast) and `onOpenInbox` (which opens a tab) stay callback props since a presentational component must not do either itself.

The `daemon` prop is the bare state (`'off' | 'idle' | 'working'`, computed in `App.tsx` from `settings.daemon.enabled` + `anyWorking()`); the wording and the tone are decided here. **Only the state word is toned** — `--faint` / `--gold` / `--green` via three literal `status-daemon-state--*` classes (literal, not a runtime-built key, so `bench/moduleClassCheck.ts` can still verify all three) — while the `daemon:` label stays `--faint`. The caret is **nested inside the daemon span**, not a sibling at the end of the bar, so it reads as one live prompt rather than loose punctuation.

**There is no graph-mode readout** (removed 2026-08-29). `mode` is no longer a prop at all — the `GraphMode` is shown and switched on the graph pane's own header toolbar, which is where a pane-scoped control belongs; this bar is app-scoped.

#### `InboxIndicator.tsx`
The daemon-inbox **notification indicator** in the status bar — not a second inbox button. The sidebar header bar's `open-inbox` toolbar entry is the *launcher* (an icon button that grows a count badge); this is the inverse: an always-present `inbox: N` readout in the field-log line that happens to be pressable. It **renders at zero** on purpose — an indicator that disappears when there is nothing to say can never be found or learned — so the resting state is quiet and the alert state lights up with a `--gold` dot plus the count promoted to `--fg`. `--gold` is the inbox's own `pending` colour (`daemonInboxLogic.ts`'s `STATUS_COLOR`), so the dot here and the row dots in the inbox it opens are one signal.

`StatusBar` renders it only while `daemon !== 'off'`, mirroring the sidebar button: the whole inbox surface is gated behind `settings.daemon.enabled`. It is a bare `<button>` plus a module class rather than `ui/Button` — following `WindowControls.tsx`'s precedent for chrome that is clickable without being button-shaped, since `ui/Button`'s `.btn` family brings border/padding/size chrome that would have to be overridden away inside an 18px `--fs-micro` line.

---

### Communication

#### `api.ts`
HTTP client and transport seam. `resolveBase(search, envBase)` — pure function to resolve backend URL (`?api=` wins, then `VITE_API_BASE`, then `http://localhost:4321`). `Transport` interface: `getJson`, `getText`, `post`, `put`, `postJson`, `uploadAsset`, `assetUrl`, `eventsUrl`, `base`. `httpTransport(base)` — the default implementation. `setTransport(t)` — swap in a mobile transport at boot. `api` object — all typed endpoint helpers (read/write, graph, tree, tasks, cards, bases, daemon, terminal-relay, etc.). `apiBase()` — the resolved backend URL (used to build `?api=` window URLs).

#### `oneShotPathChannel.ts`
`createOneShotPathChannel<T>()` — a generic "stash a value for a path, consume it once" channel: a `Map<string, T>` keyed by vault path, a `set` that stashes a value BEFORE the thing it's for exists (an editor view not yet created), a `take` that reads-then-deletes so the value fires exactly once, and a `clear` that forgets without consuming. Factored out of `pendingCursor.ts` and `pendingAnchor.ts`, which shared this exact three-function shape as two hand-rolled copies before this existed.

#### `serverVersion.ts`
Singleton `EventSource` + fallback `/version` poll. Exports: `serverVersion: Accessor<number>`, `lastChange: Accessor<ServerChange>`, `currentConnectionState: Accessor<ConnectionState>`. `onServerChange(cb)` — imperative subscription for CodeMirror extensions. Connection states: `"connected" | "disconnected" | "reconnecting"`. On SSE loss: shows a "Connection lost" toast, polls at 1 s (vs 5 s normal), attempts reconnect via exponential backoff, auto-dismisses toast on reconnect.

#### `settings.ts`
Solid store for user settings. Seeded synchronously from `DEFAULTS` (no white-screen), hydrated from `GET /settings`, persisted by diffing and calling `POST /set-setting` for each changed leaf via `settingsDiff.ts`. `Settings` interface mirrors `SETTINGS_SCHEMA` leaf-by-leaf. `FONT_STACKS`, `DEFAULT_ACCENT_PALETTE` also exported.

#### `settingsCssVars.ts`
`settingsToCssVars(s: Settings)` — pure function mapping settings to a `{ "--var": "value" }` map. `setCssVars(vars)` — applies to `:root`. All appearance, font, size, spacing, animation, and color CSS vars flow through here. To add a CSS-driven setting: one line here + one `var()` in CSS.

#### `settingsDiff.ts`
`diffLeaves(prev, next)` — walks two settings objects, returns `[path, value][]` for changed leaves. Used by `settings.ts` to compute the minimal `POST /set-setting` diff.

#### `themes.ts`
`THEME_NAMES`, `resolveAppearance(appearance)` → `ColorTokens`. Named Bismuth color themes (4 total: ink/paper/cathode/riso — the ASCII redesign's scopes). `ColorTokens`: background, foreground, neutral, accent, border, surface, surface2, accentPalette, isLight, plus the structural/category/semantic overrides each scope sets explicitly. DOM-free and unit-tested.

#### `themeColors.ts`
Derives dynamic theme-aware color values (e.g. ANSI terminal palette from theme). `buildAnsiPalette(tokens)` — maps theme colors to xterm.js ANSI color slots for `Terminal.tsx`.

---

### Graph

#### `graph/graphRenderer.ts`
The renderer seam every consumer talks to, and the owner of the types that flow across it (`GraphConfig`, `HoverNode`, `NodeForUI`, `CommunityCentroid`, the `GraphRenderer` interface itself). Three consumers — `GraphView.tsx`, `intro/VaultIntro.tsx`, `graph/EmbeddedGraph.tsx` — all hold their renderer as a `GraphRenderer`, never a concrete class. There is exactly one implementation, `AsciiGraphRenderer`. The file's header carries an EPITAPH for the second implementation this seam used to arbitrate between, `CanvasGraphRenderer.ts` (a 1885-line, zero-test dot-and-line Canvas2D renderer, chosen via a since-removed `graph.renderer` setting) — now deleted — including the four capabilities that did **not** carry over to `AsciiGraphRenderer`: the animated 2D↔3D morph, depth-ordered cell arbitration in 3D, filled degree-sized dots + a hover ring, and rounded label pills.

#### `graph/AsciiGraphRenderer.ts`
The knowledge-graph renderer — the sole implementation of `GraphRenderer`, mounted by every graph host (the full-pane graph, the sidebar mini-graph, the first-run Vault Intro, and the embedded ` ```graph ` note block). Draws the graph as a fixed-size CHARACTER GRID on a plain Canvas-2D context (`canvas.getContext("2d")` — NOT WebGL/GPU, NOT DOM nodes): nodes and labels rasterize as monospace glyphs snapped to grid cells (a degree/depth ramp `.`/`o`/`@`, see `asciiGrid.ts`'s `nodeGlyph()`); edges are the one exception, drawn as real anti-aliased vector strokes (`strokeEdges()`) beneath the glyphs, not as characters. THE LAW: zoom changes RESOLUTION (world-units-per-cell), never a glyph's on-screen size. Handles 2D and 3D (a hard camera reset on mode switch, not an animated morph); hit-testing (`pick()`, a grid cell lookup rather than a per-node distance search), hover, orbit-drag/pan, wheel/keyboard zoom, and the render loop all live here. Positions come off the backend's precomputed layout and are rescaled (not re-simulated) via `respace.ts`. Delegates its other pure arithmetic to sibling modules below (`asciiGrid.ts`, `backbone.ts`, `clusterVisual.ts`, `cameraModel.ts`, `lod.ts`, `graphFit.ts`, `graphStability.ts`, `densityField.ts`, `labelSelection.ts`). Exercised headlessly under happy-dom with a recording 2D canvas context in `AsciiGraphRenderer.test.ts` (119 tests).

#### `graph/asciiGrid.ts`
The pure half of the character grid — everything computable without a DOM. Cell metrics (`CELL_W`/`CELL_H`/`FONT_PX`), world↔cell mapping (`pxToCell`, `gridMetrics`), the resolution ladder (`resolutionT`/`resFromT`/`resFromPercent`/`snapZoomPercent`/`maxResFor`, `DEEPEST_WORLD_PER_CELL`), the degree/depth glyph ramp (`nodeGlyph`, `NODE_GLYPHS = [".", "o", "@"]`), and the cell→node hit test (`nearestCellNode`). Unit-tested (`asciiGrid.test.ts`).

#### `graph/respace.ts`
Node-count-independent resting spacing. `scaleToSpacing(positions, targetSpacing)` measures the input cloud's own median nearest-neighbour distance and solves for the single uniform scale that makes it hit a fixed target, rather than mirroring the backend's (`core/src/layout.ts`) packing constants by copy — deliberately decoupled so the two files' tuning can't silently drift apart. A pure, O(n²)-bounded rescale about the cloud's own centroid; provably order-preserving (a uniform positive scale can't flip which of two pairwise distances is smaller), and kind-agnostic (no notion of node id or `"self"` — a caller wanting the old self-pin-at-origin behavior would have to apply it around this call; none does). Memoized via `createSpacingCache`. Unit-tested (`respace.test.ts`).

#### `graph/backbone.ts`
Group-level ("the lines between the clusters at this zoom") edge synthesis: `buildLevelEdges` aggregates real edges into hub-to-hub pairs per community-hierarchy level (capped at `MAX_LEVEL_PAIRS` = 700), and `bandsForT` computes the three-band zoom handover (far mass / mid backbone / near member-edge crossfade weights) the renderer's rasterize pass keys off. Unit-tested (`backbone.test.ts`).

#### `graph/clusterVisual.ts`
Pure cluster-visual intelligence ported out of the deleted Canvas renderer: `buildColorSlots` (rank-based per-level community color assignment, fixing the old hash-based scheme's collisions on real vaults), hub-anchored cluster-name placement (`pickHubAnchor`, `clusterLabelLift`, `clusterExtent`), `inViewport`, `trimDanglingWord`, `pathOf`. Unit-tested (`clusterVisual.test.ts`).

#### `graph/cameraModel.ts`
Resolves the renderer merge's central tension, zoom-as-resolution vs. zoom-as-camera-dolly: `dollyForT` derives the 3D camera's dolly offset from the same resolution progress that drives labels/LOD/node color, so one wheel notch does both jobs instead of tracking two independent zoom states. `zoomT` is the pre-merge inverse. Unit-tested (`cameraModel.test.ts`).

#### `graph/lod.ts`
Level-of-detail aggregation for the 2D field — LIVE, the shipped default outside "local" mode. At coarse zoom, each community of the active hierarchy level draws as one aggregate mass (sized by member count) joined by aggregate edges summarizing every real link between two communities' member sets, instead of rasterizing every note. Opt-in via `GraphConfig.showLodMasses`. `lodMix`/`buildLodIndex`/`massRadii`/`massCellCode`. Unit-tested (`lod.test.ts`).

#### `graph/graphFit.ts`
Pure guards for the fit-to-box math. THE FIT LAW (2D): 100% zoom fills each axis to `FIT_FILL_FRACTION` (0.92) of the graph's own bounding-box half-extents (`boundingHalfExtents`/`fitScaleForBox`), not a circumscribing radius. `isUsableBox`/`finiteVec3`/`boundingRadius` guard against a degenerate mid-layout host box or a non-finite coordinate poisoning the whole cloud's scale. Unit-tested (`graphFit.test.ts`).

#### `graph/graphStability.ts`
Pure guards that keep the graph's shape and camera stable across re-fetches. `structuralGraphSig` ignores node positions entirely, so a same-structure re-fetch is a no-op for the renderer (it keeps whatever shape it already settled); `shouldResetView` lets the renderer reset the camera only when the visible node set changes substantially (a mode switch / brand-new graph), never on an incidental edit to the graph already on screen. Unit-tested (`graphStability.test.ts`).

#### `graph/densityField.ts`
The graph's phosphor-bloom atmosphere input. `accumulate` bins screen-fraction points (glyphs in the mid/near band, masses in the far band) into a `FIELD_W × FIELD_H` grid; `buildBloom` normalizes the result to a peak of 1 and feeds `GraphAtmosphere` via `setBloomCallback`. Unit-tested (`densityField.test.ts`).

#### `graph/labelSelection.ts`
Pure label-ladder math — both halves are live. `computeAlwaysOnSet(nodes, edges, activeFile, hubCount)` unions the top-`hubCount` nodes by undirected degree with the active file. The zoom-driven ladder (`fileLabelBudget`/`fileLabelAlpha`/`clusterLabelAlpha`/`clusterLevelAlphas`/`levelBoundaries`/`clusterLabelText`/`eyebrowWidthCells`, plus the `FILE_LABEL_*`/`CLUSTER_LABEL_MAX_CHARS` constants) crossfades cluster names to file names as resolution deepens past `FILE_LABEL_REVEAL_T`. Unit-tested (`labelSelection.test.ts`).

#### `graph/GraphAtmosphere.tsx`
Shared graph "atmosphere" overlay — the iridescent cluster-glow + depth vignette layered over the graph canvas. Extracted so `GraphView` and the first-run intro graph share one source instead of duplicating the glow divs/wiring. Rendered as a sibling after the renderer's canvas; structurally typed against any renderer exposing `setGlowCallback()` (fed by `AsciiGraphRenderer`'s per-frame top-3 community centroid projections, via `densityField.ts`). Styled by `GraphAtmosphere.module.css`.

#### `graph/d3-force-3d.d.ts`
Frontend-side type stubs for `d3-force-3d` (same as the core-side version, `core/src/d3-force-3d.d.ts`). Currently unreferenced under `app/src` — `AsciiGraphRenderer.ts` does not import `d3-force-3d` at all; only `core/src/layout.ts`'s server-side force refinement stage still uses the package.

---

### Editor

#### `Editor.tsx`
CodeMirror 6 wrapper. Builds the extension list from `settings` (live preview, spellcheck, autocomplete, fold, etc.), assembles the editor state, and manages save (autosave on change with 250 ms debounce). Reloads content on SSE version change for the active file. External edits are tagged with `ExternalReload` annotation to avoid save-on-reload loops.

#### `editor/livePreview.ts`
Block rendering for markdown elements: headings, code, blockquotes, lists, task checkboxes, horizontal rules. The heavy extension that makes the editor feel like a live-preview note app.

#### `editor/autocomplete.ts`
`vaultCompletion` — wikilink and tag autocomplete. Fetches `NoteCandidate[]` from the parent component (derived from the graph/tree). Tested in `autocomplete.test.ts`.

#### `editor/queryBlock.ts`
Renders a ` ```query ` code block inline as a `BaseView` or empty state. Supports both full inline base config and flat `of:`/`tasks:`/`where:`/`view:` spec.

#### `editor/queryComplete.ts`
Autocomplete inside ` ```query ` blocks. Tested in `queryComplete.test.ts`.

#### `editor/embedBlock.ts`
Renders `![[file]]` and `![](url)` embeds inline: images, PDFs, audio, video, `.md` note transclusion. Resizable (persists as `|WxH` in the link syntax). Asset URLs go through `api.assetUrl(target)`.

#### `editor/htmlPreview.ts`
Sanitized raw HTML blocks (both block-level and inline). Pipes through `sanitizeHtml`. Tested.

#### `editor/tableModel.ts` + `editor/tableState.ts` + `editor/tableWidget.ts`
GFM pipe table editor. `tableModel.ts`: pure table parse/serialize. `tableState.ts`: CodeMirror state facets and effects. `tableWidget.ts`: contenteditable cell widget, drag-resize columns/rows, Shift+Enter multi-line cell, click-off commit. Tested in `tableModel.test.ts`.

#### `editor/settingsComplete.ts`
Schema-aware YAML autocomplete for `.settings`. Shows each key's doc string, valid range, and current default. Uses `suggestCompletions` from `core/src/schema/suggest.ts`. `keybind` PropertyType shows a "Record shortcut…" option. Tested in `settingsComplete.test.ts` and `settingsComplete.keybind.test.ts`.

#### `editor/yamlSchema.ts`
YAML schema linter for frontmatter and `.settings`. Uses `validateDocument` from `core/src/schema/validate.ts`. Tested in `yamlSchema.test.ts` and `settingsSchemaLint.test.ts`.

#### `editor/wikilink.ts`
`parseWikilink(text)`, `resolveNotePath(target, candidates)` — wikilink parsing and resolution. Tested.

#### `editor/tag.ts`
Tag autocomplete decoration and extraction. Tested.

#### `editor/taskComplete.ts`
Task metadata autocomplete in `- [ ]` lines. Keywords expand to bracket fields (e.g. `due` → `[due `, `high` → `[high]`) — no emoji, ever. Tested.

#### `editor/foldBlocks.ts`
Fold/unfold for code blocks, frontmatter, and headings. Tested.

#### `editor/mathBlock.ts`
KaTeX-rendered math blocks (`$$...$$`) and inline math (`$...$`). Lazy-loads KaTeX via `katexLoader.ts`.

#### `editor/codeHighlight.ts`
Syntax highlighting for code fences (uses `@codemirror/language-data` for language detection).

#### `editor/codeLineNumbers.ts`
Line-number gutter inside code fences.

#### `editor/inlineMarkdown.ts`
Markdown rendering inside GFM table cells. Tested.

#### `editor/harper.ts` + `editor/harperOffsets.ts` + `editor/harperStore.ts`
Spellcheck via `harper.js`. `harper.ts` wires the linter. `harperOffsets.ts` maps byte offsets to CodeMirror positions. `harperStore.ts` caches the Harper WASM instance. All tested.

#### `editor/emoji.ts`
Emoji autocomplete (`:name:` trigger). Backed by `emoji-data.json`. Tested.

#### `editor/urls.ts`
`findBareUrls(content)` — detects bare URLs in prose for click-to-open. Tested.

#### `editor/contextMenu.ts`
Editor right-click context menu extension.

#### `editor/frontmatterUtils.ts`
`frontmatterBodyRange(state)` — returns the CodeMirror range for frontmatter vs body. Tested.

#### `editor/normalizeFrontmatter.ts`
`normalizeFrontmatterSpacing(content)` / `minimalChange(a, b)` — normalize frontmatter whitespace on load; compute a minimal diff to avoid clobbering cursor position. Tested.

#### `editor/settingsBuffer.ts`
`isSettingsBuffer(path)` — detects the `.settings` path. Tested.

#### `editor/solidWidget.ts`
Helper to mount a Solid component as a CodeMirror widget decoration.

#### `editor/templateToken.ts`
Template token expansion for the editor. Tested.

#### `editor/yamlFixHover.ts`
Hover tooltip showing YAML fix suggestions.

#### `editor/CodeHeader.tsx`
Code block header bar (language label, copy button).

#### `editor/TaskCheckbox.tsx`
Clickable task checkbox widget rendered in live preview.

---

### File Tree

#### `FileTree.tsx`
Left sidebar file tree. Drag-and-drop move (to folder), rename (in-place), right-click context menu, undo support for deletes via the delete→restore pattern.

#### `fileTreeOps.ts`
Pure file-tree operation helpers (derive drag targets, sort order, icon resolution). Tested.

#### `fileTreeRefresh.ts`
SSE-driven file tree refresh logic. Tested in `FileTree.refresh.test.ts`.

---

### Bases Views

#### `bases/BaseView.tsx`
Host component. Resolves source rows (from `POST /rows` or inline), runs `runView` client-side for filters/formulas/grouping, selects the view renderer, shows `BaseSkeleton` on cold load. SWR row cache via `RowCache` keyed by `serverVersion`.

#### `bases/rowCache.ts`
`RowCache<T>` — stale-while-revalidate cache keyed by string, freshness-tracked by server version. `peek`, `isFresh`, `set`, `markAllStale`. Tested.

#### `bases/TableView.tsx` / `CardsView.tsx` / `ListView.tsx` / `BulletsView.tsx` / `KanbanView.tsx` / `MapView.tsx` / `HeatmapView.tsx` / `BarView.tsx` / `LineView.tsx` / `StatView.tsx`
One renderer per view kind. All receive `ViewResult` from `BaseView`.

#### `bases/CalendarView.tsx`
Calendar view renderer. Delegates to `app/src/calendar/` components.

#### `bases/FlashcardsView.tsx`
Flashcard review UI. Uses `flashcardsQueue.ts` for queue logic, calls `POST /cards/review` for both markdown-card and row-card paths.

#### `bases/flashcardsQueue.ts`
`buildQueue(rows, dueField, today, cram, bidirectional)` — pure queue construction. `nextPosAfterGrade(pos, {cram, persisted})` — next position after a normal-mode review. `nextCramPos(queue, pos, retired)` + `itemKey(item)` — cram-until-easy loop: re-surface good/hard cards, retire a card only when rated easy, return `-1` when all mastered. `backField(field)` — derive the Back-direction field name. Stable row-index tracking (survives reorders). Tested.

#### `bases/renderValue.tsx`
`renderValue(value, property, fileMeta?)` — renders a row cell value to a Solid JSX node. Handles links, dates, booleans, arrays, numbers, text.

#### `bases/markdown.ts`
`renderMarkdown(md)` — converts markdown to sanitized HTML for cell/card body rendering. Uses `marked` + `sanitizeHtml`.

#### `bases/BaseSettings.tsx`
Per-base settings panel (view type switcher, field mapping, bidirectional toggle, column visibility).

#### `bases/BaseSkeleton.tsx`
Skeleton loading placeholder shown only on cold (never-cached) base loads.

#### `bases/EditCardsModal.tsx`
Deck editor: list existing cards, add cards in bulk, drag-reorder, delete. Uses `POST /row/{update,delete,reorder}`.

#### `bases/calendarBase.ts` + `bases/calendarSerialize.ts`
Calendar event serialization helpers (convert calendar events to/from base row format). Tested.

#### `bases/columnLabel.ts`
Derives human-readable column labels from property ids (e.g. `"note.myField"` → `"My Field"`).

#### `bases/BodyCard.tsx` / `bases/CardBody.tsx`
Shared card body renderers used by `CardsView` and `FlashcardsView`.

---

### Calendar

The calendar is a Bases view kind — no standalone page. `CalendarView.tsx` is the entry point from `BaseView`.

#### `calendar/state.ts`
Reactive calendar state: current view mode (`month|week|3day|day`), date range, selected date. Tested in `state.defaultView.test.ts` and `state.settings.test.ts`.

#### `calendar/EventStore.ts`
Event CRUD + persistence. Events are base rows; `EventStore` provides typed accessors and writes back via `POST /row/update`. Tested.

#### `calendar/types.ts`
`CalendarEvent`, `ViewType = "month" | "week" | "3day" | "day"`, `CategoryColor`.

#### `calendar/categoryColor.ts`
`categoryToColor(category)` — maps a category string to a theme-aware color token.

#### `calendar/dates.ts`
Date helpers specific to calendar display (week start, range construction, etc.). Tested.

#### `calendar/refresh.ts`
Triggers a calendar data refetch from SSE version changes.

#### `calendar/components/`
`EventChip.tsx`, `EventModal.tsx`, `RecurrenceDialog.tsx`, `CategoryPanel.tsx`, `Toolbar.tsx`, `DateNav.tsx`, `CalendarSettings.tsx`, `GcalSyncPanel.tsx`, `TaskChip.tsx` — calendar UI sub-components. `CalendarFrame.tsx` is the root column every calendar view mounts inside (was `.calendar-app`), giving the shared button look and UI font once at the top instead of per-view. `DayNumber.tsx` is the day-of-month number shared by `MonthView`'s cell header, `TimeGrid`'s day header and `TaskAllDayStrip`'s day header (`today`/`inline` props pick the accent-circle style).

#### `calendar/components/views/`
`MonthView.tsx`, `WeekView.tsx`, `ThreeDayView.tsx`, `DayView.tsx`, `TimeGrid.tsx` — per-view layout renderers; `TaskAllDayStrip.tsx` is the tasks register's week/3-day/day layout. Three components shared across those: `DayHeaderRow.tsx` (the weekday+date header over a run of day columns), `AllDayRow.tsx` (one cell per day under a `DayHeaderRow`, `fill` prop stretches it to the pane's bottom), and `DayGutter.tsx` (the empty left-gutter spacer that aligns those rows with `TimeGrid`'s hour labels). `TimeGrid` composes `DayHeaderRow`/`AllDayRow` for the events register and `TaskAllDayStrip` composes the same two for the tasks register, so the two registers can't disagree about column geometry.

#### `calendar/taskChipKeys.ts`
Pure keymap for a focused `TaskChip`: `chipKeyAction(e)` maps a keydown to `open`/`toggle`/`menu`/`reschedule`; `taskKey(row)` is a task's identity across re-renders (`` `${path}:${line}` ``). No framework imports. Tested.

---

### Drawing

#### `drawing/DrawingPage.tsx`
Top-level drawing pane, lazily loaded by `PaneContent`. Owns page navigation, tool state, persistence.

#### `drawing/DrawingCanvas.tsx`
Dual canvas (committed base + live draft). Handles stylus pressure/velocity width during drawing, dispatches pointer events to `input.ts`, applies smoothing on pointer-release.

#### `drawing/Toolbar.tsx`
Drawing toolbar: tool picker (pen/hl), color swatch, brush size.

#### `drawing/store.ts`
Solid store for drawing document state + undo/redo stack. Tested.

#### `drawing/input.ts`
Pure pointer event → stroke point logic. Tested.

---

### Sheets

#### `SheetView.tsx`
`.sheet` file pane. Lazy-imports `sheet/univerSheet.ts` (code-split). Handles save and external-change detection via `sheet/sync.ts`.

#### `sheet/univerSheet.ts`
Dynamic `import('@univerjs/presets')` wrapper. Creates/destroys the Univer workbook instance.

#### `sheet/snapshot.ts`
`parseSnapshot(text)` / `serializeSnapshot(workbook)` — Univer workbook JSON parse/serialize. Tested.

#### `sheet/sync.ts`
`isExternalChange(prev, next)` — detects whether a file reload is a true external change vs. a self-triggered save. Tested.

---

### Color

#### `color/parseHex.ts`
`parseHex(value)` — shared hex-color parser, factored out of four near-identical hand-rolled copies (`graph/AsciiGraphRenderer.ts`'s `parseColorToRGB`, `graph/clusterVisual.ts`'s `parseCssColorToRgb`, `graph/bloomColor.ts`'s `parseHexColor`, `export/pageGeometry.ts`'s `parseRgbColor`). Pure, no framework imports. Covers exactly what all four agreed on — `#rgb` or `#rrggbb`, case-insensitive, `#` required, exactly 3 or 6 hex digits — parsed into 0..255 integer channels; returns `null` for anything else. Deliberately does NOT cover each site's own extra behavior (some also accept `rgb()`/`rgba()`, or truncate an over-long hex, or fall back to white instead of `null`) since the four sites disagree with each other on those cases and each keeps its own wrapper around this shared core rather than this module silently picking one answer for everyone.

---

### Export

#### `export/options.ts`
Default export options, kept out of `types.ts` so that file stays type-only. `DEFAULT_PDF_FONT_SIZE` (12pt), `PDF_FONT_SIZES` (the sizes offered in the export UI), `clampPdfFontSize(pt)`, `defaultExportOptions()`, `defaultModeForView(kind)`, `hasVisualRenderer(kind)`. Shared by the CLI, the in-app `ExportView`, and tests.

#### `export/formats.ts`
`formatsFor(path)` / `isExportable(path)` — determines valid export formats by file extension:

| Extension | Formats |
|---|---|
| `.md` | `html`, `pdf`, `png`, `md` |
| `.sheet` | `html`, `pdf`, `png` |
| `.draw` | `pdf`, `png` |

`ext(path)` — the pure lowercase extension helper (kept here so `App.tsx`'s render-time gating doesn't drag in the export stack). `formatsForOptions(path, isBase, mode)` — contents-aware refinement for the export UI: a base (a `.md`) yields the data forms (`md`/`csv` added) in `"data"` mode and only the rendered forms (`html`/`pdf`/`png`) in `"visual"` mode.

#### `export/exporters.ts`
`renderPreview(path, format, deps, theme?, opts?)` — computes ONLY what the export tab displays (no bytes, no html→pdf) so flipping formats/options is instant. `renderExport(path, format, deps, theme?, opts?)` → `ExportResult` — the impure path that produces downloadable bytes, dispatching per format (md/csv text, html/pdf/png from the rendered body, drawings rasterized directly). A `type: base` md renders as its chosen view (`"visual"` → the view as its kind, `"data"` → a flat table); csv is base-only. Tested.

#### `export/resolvePalette.ts`
`readThemePalette(scheme)` — reads the LIVE app theme into a concrete `ThemePalette` so an export matches what's on screen. Browser-only: the app's CSS vars resolve through `color-mix()`/`var()`, which the export document and html2canvas can't evaluate, so each is resolved to a literal `rgb()`/hex by applying it to a probe element and reading its computed color. Headless callers (the CLI) never reach this and keep `exportTheme.ts`'s `DEFAULT_PALETTE` instead.

#### `export/exportTheme.ts`
Concrete colors/fonts for the visual export renderers (calendar/cards/kanban/list) and the document wrapper. The export document is standalone and carries none of the app's `:root` palette vars, so theme tokens and status colors are resolved to literal values here rather than emitting `var()`/`color-mix()`, which the html2canvas rasterizer may drop. `DEFAULT_TYPE_SCALE`, `DEFAULT_PALETTE: Record<ExportTheme, ThemePalette>` (the headless/CLI fallback AND the safety net if the live-DOM probe throws — embeds an inline copy of a named scope's tokens straight from `core/src/theme/tokens.ts`, never a hand-copied literal that could drift), `paletteFor`/`resolveColor`/`groupColorHex`/`hexToRgba`/`tintStyle`.

#### `export/cssColor.ts`
Normalizes modern CSS color values to html2canvas-safe `rgb()`/`rgba()`. The app's theming leans on `color-mix(in srgb, X n%, transparent)`, but Chrome serializes a computed color-mix that carries alpha as a CSS Color 4 `color(srgb r g b / a)` function, which html2canvas (1.4.x) has no parser for and throws on. `isRasterUnsafeColor(value)`/`colorSrgbToRgb(value)`/`normalizeCssColor(value, fallback)`/`sanitizeDocColorsForRaster(...)` — two layers of defense (probe-time normalization plus a document-wide sanitize pass) share this module so every export path agrees on what counts as unsafe.

#### `export/htmlTemplate.ts`
HTML export template renderer for notes. Tested.

#### `export/docFontCss.ts`
Inlines the DOCUMENT faces — note prose (CMU Serif) and the mono face (Monaspace Xenon) — as base64 `data:` URIs for export, the same technique `katexCss.ts` already used for math glyphs. Without it an export's font stack silently fell through to Georgia (measured: a prose run rendering pixel-identical to Georgia, nothing like CMU Serif) because the app loads these fonts through Vite at runtime, which a standalone exported document — or the headless Chrome the PDF path rasterizes in — has no way to resolve. `docFontInlineCss()`.

#### `export/fontFaceCss.ts`
The font FACE LIST and its CSS serialization, with no asset imports of any kind — the two embedders that need it (`docFontCss.ts`'s Vite `?inline` in the browser build, and the compiled CLI binary's Bun import attributes) obtain the actual font bytes by incompatible means and neither can import the other's module, so keeping the shared face list here is what stops the two paths from silently declaring different weights. `DocFace`, `DOC_FACES`, `faceCss(faces)`.

#### `export/katexCss.ts`
A self-contained KaTeX stylesheet for export: inlines both the stylesheet (Vite `?raw`) and every woff2 glyph font as a base64 `data:` URI, rewriting each `@font-face`'s `url(fonts/…)` to the inlined data URI, so the standalone `.html` download and the off-screen iframe the PDF/PNG rasterizers snapshot don't need network access or the running app's loaded CSS. `katexInlineCss()`. ~400 KB of base64, so dynamic-imported only when an export actually needs it.

#### `export/htmlToPdf.ts`
Client-side HTML → PDF via `jspdf`. Used for note and sheet PDF export.

#### `export/pageGeometry.ts`
Pure geometry for the browser PDF exporter: US Letter portrait (8.5in × 11in), 1in margins on every side, computed explicitly (rather than left to a `@page` CSS rule) because `htmlToPdf.ts` rasterizes the whole document with html2canvas and slices that one canvas across pages itself — html2canvas ignores `@page` rules. `PAGE_W_PT`/`PAGE_H_PT`/`MARGIN_PT`/`CONTENT_W_PT`/`CONTENT_H_PT` (PDF points, 72pt/in) and their pixel (96dpi) counterparts, `snapDownToGrid(raw, unit)`. Matches the headless CLI path's geometry (`core/src/render/htmlRaster.ts`) so both rasterizers agree on the same page box.

#### `export/sheetHtml.ts`
Sheet → HTML serialization. Tested.

#### `export/rowsHtml.ts`
Base rows → HTML table serialization. Tested.

#### `export/baseTable.ts`
Base view → Markdown table serialization. Tested.

#### `export/baseView.ts`
The "visual" base export: resolves a base's chosen view and renders it AS ITS KIND (calendar grid / cards / kanban / list). Unsupported kinds (table, map, charts, stat, heatmap, flashcards) degrade to the flat data table so export never throws. `baseViewHtml(...)` → `VisualHtml` (an HTML body fragment plus a scoped CSS block the exporter injects into the document head), composing `calendarHtml.ts`/`viewHtml.ts`/`baseTable.ts`/`rowsHtml.ts`.

#### `export/calendarHtml.ts`
Static, themeable HTML rendering of a calendar Bases view for the "visual" export — pure (no DOM, no Solid) so it runs in the same Bun-compilable path as the rest of the exporter, mirroring the live calendar's MonthView grid and TimeGrid columns as a flat HTML string html2canvas/jsPDF can rasterize (and a `.html` download can open standalone). Row→event mapping reuses `calendarSerialize.rowToEvent` — the exact mapping the live calendar uses — so an exported calendar agrees with what's on screen. `calendarHtml(...)`. Tested.

#### `export/viewHtml.ts`
Static, themeable HTML rendering of the non-calendar visual Bases views (cards, kanban, list/bullets). Pure string builders reusing the core `runView` `ViewResult` plus the same value formatting (`cellText`/`renderCellHtml`) the live views and the data table use, so a visual export reads like what's on screen. `cardsHtml`/`kanbanHtml`/`listHtml`.

#### `export/mdTable.ts`
Markdown table utilities. Tested.

#### `export/csvTable.ts`
Flat-table → CSV, the "data" export companion to `mdTable.ts`. RFC-4180 quoting (a field is wrapped in double quotes when it contains a comma, quote, or newline, with embedded quotes doubled); cells already carry the same display text as the on-screen table, so CSV matches what's shown. `tableToCsv(t)`. Tested.

#### `export/pageBreaks.ts`
Pure splitting of a note's raw markdown into page-break-delimited sections — for the PNG exporter (each section is rendered and rasterized independently, since a single raster image can't represent more than one page) and for the export preview (each section draws as its own visually distinct "sheet"). PDF instead honors the same marker by slicing the rendered canvas at each marker's div, so it needs no text-level split. `splitByPageBreaks(text)`/`pageSections(...)`.

#### `export/download.ts`
`downloadBlob(blob, filename)` — triggers a browser download.

#### `export/drawingRaster.ts`
Client-side drawing → PNG via Canvas 2D.

#### `export/inkHtml.ts`
Turns a note's ` ```draw ` fences into real pictures in the exported document — without this, every export surface outside `app/src/editor/` treats a draw fence like any other code fence, and it renders in html/pdf/png as a wall of base64 inside a grey code block. Each fence is rasterized to a transparent PNG (via `ExportDeps.drawingToPng`) at the same LOGICAL coordinate space the fence stores (`INK_LOGICAL_W` = 680 wide), then placed with CSS. `planInkPlacements(text)` computes where each picture goes; `inkDocText(strokes)`/`inkMarkdown(...)`/`inkifyMarkdown(...)` do the substitution; `InkShape`/`InkPlacement`/`INK_CSS` round out the model. CLAUDE.md names this module explicitly as the one that knows a draw fence from an ordinary one.

#### `export/types.ts`
`ExportFormat = "html" | "pdf" | "md" | "png" | "csv"`; `RenderMode = "visual" | "data"`.

#### `ExportView.tsx`
Export options pane UI (format picker, preview, download button).

---

### Daemon UI

`app/src/daemon/` (Task 5, daemon-page plan): the panels the daemon's own page composes. Each colocated `<Name>.module.css` has exactly one importer — none of these reach into another's stylesheet.

#### `daemon/DaemonPanel.tsx`
The shared panel frame every other daemon panel composes: an eyebrow title + count badge + optional trailing actions over a scrolling body. The ONLY owner of panel chrome (border, head, scroll) — `daemon/DaemonServices.tsx`/`DaemonInbox.tsx`/`DaemonLog.tsx` render one (or two) of these rather than growing their own hairline box.

#### `daemon/DaemonServices.tsx`
Crons + background services, rendered as two `DaemonPanel`s ("crons", "services"). Replaces the deleted `DaemonList.tsx` (which rendered the same rows over `GraphNode` inside the graph's now-removed daemon-mode legend card) — rewritten over the plain `DaemonCron`/`DaemonProcess` shapes `GET /daemon/snapshot` returns. Right-click keeps the shared `<ContextMenu>` (Run now / Enable / Disable); a row click opens `.daemon/crons/<name>.md` or `.daemon/processes/<name>.md`. `daemon/cronFrequency.ts` converts a cron expression to a short human string ("every 5m").

#### `daemon/DaemonInbox.tsx` + `daemon/InboxRow.tsx`
The content of the deleted `InboxView.tsx` (the former `::inbox` tab) minus its own `ViewBar`, wrapped in one `DaemonPanel`: Needs review / Scheduled / Recently resolved sections over the daemon's pages (`core/src/daemonPages.ts`), sorted/grouped by `app/src/daemonInboxLogic.ts`. `pages` is now a plain prop rather than a module-level signal read directly by the component. `InboxRow.tsx` is one row (status dot, title/source/time, snippet, inline actions), extracted from the deleted `InboxView.tsx`'s `PageRow`.

#### `daemon/DaemonLog.tsx` + `daemon/activityLine.ts`
The daemon's activity log panel (`GET /daemon/logs`, `core/src/daemonActivity.ts`): one mono row per event (`time who what duration`), toned by outcome. `activityLine.ts` is the pure formatter (`ActivityEvent` → `{time, who, what, tone, duration}`); see its own header for the event-vocabulary mapping.

#### `daemon/DaemonFace.tsx`
The living `.:[00]:.` face (Task 3, daemon-page plan) — see its own file header.

#### `daemon/DaemonPage.tsx` + `daemon/DaemonPageHost.tsx` + `daemon/DaemonChat.tsx` + `daemon/daemonPageModel.ts`
The daemon's own page (`::daemon`, routed lazily by `PaneContent.tsx`). `DaemonPage` is presentational: a `ViewBar` over a three-column stage (`DaemonServices` left, `DaemonFace` + its own chat centre, `DaemonInbox` over `DaemonLog` right), both side columns full height of the stage — no band or hairline below them; with the daemon off, only the sleeping face and an `EmptyState`, no chat. `DaemonPageHost` is the container: polls `GET /daemon/snapshot` (4s) and `GET /daemon/logs` (5s) while mounted and enabled, reads the shared inbox store, derives the mood, looks up `chatSession(DAEMON_CHAT_ID)` (`chat/chatSessions.ts` — undefined until armed) and passes `<DaemonChat/>` as the centre column's chat slot. `DaemonChat` renders `ChatTranscript` over the shared `ChatComposerBar` (with `ChatControls` as its `below`) — the composer renders identically whether or not a session exists, and a trusted press/focus on it arms the chat (`daemonChatArming.ts` — pure `isArmingGesture`/`stayArmed`; the signal is `app/src/daemon/daemonChatArm.ts`), after which App's `chatContents` memo retains the `::chat:daemon` session and the same (already-focused) composer starts driving it. Opening the page alone never spawns a chat session (see `UI_CONTROL_BLOCKLIST`'s comment in `core/src/commands.ts`). `daemonPageModel.ts` is the pure layer (`faceCaption`, `barReadouts`, `hasRecentFailure`). See `docs/daemon/overview.md` → "Daemon page".

#### `DaemonOwnerModal.tsx`
Modal for selecting which device owns the daemon. Calls `POST /daemon/owner`.

#### `DaemonSetupModal.tsx`
Modal for installing/updating the daemon service. Calls `POST /daemon/setup`.

---

### Palette

#### `palette/CommandPalette.tsx`
Full command palette. Fuzzy-matches against `COMMAND_CATALOG` bound commands plus note names. Triggered by `Cmd+K` (default keybinding).

#### `palette/SwitcherBar.tsx`
The in-window Cmd+O switcher takeover — the app's **one search surface** (the former `::search` tab folded into it). One list: fuzzy file-name matches (`rankItems`), keyword content matches (`POST /search`, debounced, deduped/freshness-gated by `switcherModel.ts`), and the Bismuth AI escalation (`POST /search-prompt`) on zero/weak results (empty-state CTA, Cmd+Enter force-path, loading/error/result panels). Also opened by the `search` command (sidebar icon / palette / native menu).

#### `palette/switcherAi.ts`
Pure AI-escalation logic: `isNaturalLanguageQuery` (3+ words — gates only the PERSISTENT affordance shown alongside results), `shouldOfferAiEscalation` (any zero-result non-empty query), and the generation-guarded `switcherAiReducer` (idle/loading/results/error — a keystroke supersedes an in-flight turn). Tested in `switcherAi.test.ts`.

#### `palette/switcherModel.ts`
Pure unified-list model: `visibleContent` (content rows only render when computed for exactly the current query, deduped against file rows) and `planSwitcherEnter` (commit / ask-ai / none). Tested in `switcherModel.test.ts`.

#### `palette/TemplatePalette.tsx`
Template picker palette.

#### `palette/PaletteModal.tsx`
Shared modal wrapper for all palettes (keyboard nav, backdrop, input focus).

---

### Terminal

#### `Terminal.tsx`
xterm.js terminal tab. WebSocket-backed (connects to `ws://localhost:4321/terminal`). ANSI palette wired from the graph color theme via `buildAnsiPalette`. DOM-rendered (not canvas), styled to match the editor.

---

### Chat

The visual chat tab: a WebSocket-backed surface (`/chat`) rendering whichever of the nine agent backends (`core/src/chatProviders/`, `core/src/agentBackends/`) is driving the session, translated into `ChatFrame`s by `core/src/chat.ts` — the single source of truth for the wire contract. `ChatView.tsx` is now a thin composition (well under 400 lines): the WebSocket, transcript, draft and every picker's state live in the session registry (`chat/chatSession.ts` + `chat/chatSessions.ts`), so a tab/pane switch unmounts the view without touching the conversation. Most of the surrounding logic is split into pure, unit-tested `chat*.ts` modules so the rules are testable without importing Solid/DOM (the pattern each module's own header names explicitly).

#### `ChatView.tsx`
The chat tab (`::chat:<id>`) — a thin, disposable composition rendered inline by `PaneContent.tsx`. The conversation itself (the `/chat` WebSocket, transcript, draft, queue, pickers) lives in the session `chat/chatSessions.ts` retains for that id, driven by App's `retainChatSessions` effect, so a tab/pane switch unmounts the view without touching the session. Renders `chat/ChatHeader.tsx` (identity crumb + readouts only) → `chat/ChatSetupGate.tsx` (the visibility-refusal/CLI-missing dead ends) when the chat can't run, else `chat/ChatTranscript.tsx` (the greeting centred when empty) + the shared `chat/ChatComposerBar.tsx` with `chat/ChatControls.tsx` as its `below`; owns the host tint and the drop target (`chat/createChatDropTarget.ts`). Focus (after a new chat, provider switch, history resume, quote-reply, etc.) is answered by `chat/createComposerFocus.ts`, not the view itself. `ChatView.module.css` holds the host, tint and `--chat-*` token localisation.

#### `chat/ChatHeader.tsx`
The chat tab's toolbar: identity (crumb) + readouts only — tools/MCP/context, via `chat/ChatControls.tsx`'s `chatControlSlots(session)` placed into `ui/ViewBar.tsx`'s named regions. Config and actions (model/effort/permission, history, new chat) are NOT in the header; they render as the quiet `chat/ChatControls.tsx` row under the composer instead (`ChatComposerBar`'s `below`). Session-driven — it takes the `ChatSession` rather than individual props; the history and auth popovers are owned by `ChatControls.tsx`/`ChatHistoryPanel.tsx`/`ChatAuthPanel.tsx`. `ChatHeader.module.css` (sole importer) carries the bar-scoped register: crumb width cap, readout gap, transparent picker triggers.

#### `ChatComposer.tsx`
The visual chat COMPOSER: a single-purpose CodeMirror editor that live-previews the draft message the way the note editor does (bold/italic/lists/`code`/```fences```/`[[wikilinks]]`), so what's typed looks like what will render once sent.

#### `chatComposerKeys.ts`
Pure key-routing for the composer: decides, from the key plus composer state, whether a keypress should be handled locally (newline, history navigation) or delegated up to `chat/ChatComposerBar.tsx` (send, stop). Tested.

#### `chat/ChatSetupGate.tsx`
The "this chat can't run" dead end, extracted so `ChatView` and the daemon page's `chat/../daemon/DaemonChat.tsx` share one implementation instead of two copies. Takes `{ session, compact?, class?, children }`: renders the visibility-refusal / claude-missing / opencode-missing `ChatSetup` states when `session` has one, else renders `children`.

#### `chat/createComposerFocus.ts`
Pure reactive helper (not a component): subscribes to `session().onFocusRequest` once both a session and a `ComposerHandle` exist, focusing and scrolling the composer into view on each request, unsubscribing on change/cleanup. Replaces the duplicated `onFocusRequest` effect that used to live separately in `ChatView` and `DaemonChat`.

#### `chatHistory.ts`
Pure shell-style prompt-history cursor for the composer: ArrowUp/ArrowDown cycle through THIS chat's own previously-sent user messages, the same way a shell's up-arrow recalls prior commands. Tested.

#### `chatSlashCommands.ts`
Pure parser for the composer's CLIENT-SIDE slash commands, intercepted in `ChatView` BEFORE the turn is sent to the backend: `/rename <name>` (tab rename), `/color <swatch|hex|clear>` (pane tint via `chatColors.ts`), `/chrome [on|off]` (computer-use toggle via `chatComputerUse.ts`). Tested.

#### `chatTranscript.ts`
The PURE frame → transcript reducer: turns the `ChatFrame` stream `core/src/chat.ts` defines into the turn/part structure the chat session (`chat/chatSession.ts`) stores and `chat/ChatTranscript.tsx` renders. Tested.

#### `chatContext.ts`
A tiny singleton mirroring `editorRegistry.ts`, but for "which files is the user looking at": the set of open editor tabs + the active file. `App.tsx` publishes a fresh snapshot on every tab/pane/focus change; `ChatView` reads the latest snapshot at send time to inject editor context into the turn.

#### `chatEditorContext.ts`
Pure "what should the `<editor-context>` preamble say" logic, split out of `ChatView.tsx` (like `fileTreeRefresh.ts`'s `decideTreeRefresh`) so it's unit-testable headlessly. Drops any file whose resolved AI visibility is `"hidden"`. Tested.

#### `chatEffort.ts` / `chatModelResolution.ts` / `chatPermissionMode.ts` / `chatProvider.ts`
Four pure per-turn setting modules split out of `ChatView.tsx` the same way, each unit-tested without Solid/DOM: `chatEffort.ts` drives the header's reasoning-Effort picker; `chatModelResolution.ts` handles model precedence + model-namespace so the chosen model survives a resume (works with `core/src/chatModelStore.ts` server-side); `chatPermissionMode.ts` makes the user's chosen permission mode STICK across turns; `chatProvider.ts` handles backend/provider choice. All four are tested.

#### `chatOrigin.ts` / `chatTitles.ts` / `chatSessionStore.ts` / `chatColors.ts` / `chatComputerUse.ts`
Five small reactive singletons, each keyed by the chat TAB id (the `::chat:<uuid>` content id's suffix — the durable identity that survives a close/reopen round-trip through `serializeTabs`), read by `tabIds.ts`'s label/icon providers or persisted to `localStorage`: `chatOrigin.ts` publishes daemon-vs-user origin from the backend's `session` frame (drives the tab icon); `chatTitles.ts` publishes conversation titles from `title` frames (drives the tab label); `chatSessionStore.ts` remembers the SDK `session_id` a tab is currently showing; `chatColors.ts` persists a per-tab pane TINT color (the `/color` slash command's target); `chatComputerUse.ts` persists per-tab `--chrome` (browser/computer-use) state. `chatColors.test.ts`/`chatComposerKeys.test.ts`/`chatComputerUse.test.ts`/`chatEditorContext.test.ts`/`chatEffort.test.ts`/`chatHistory.test.ts`/`chatModelResolution.test.ts`/`chatOrigin.test.ts`/`chatPermissionMode.test.ts`/`chatProvider.test.ts`/`chatQueueRestore.test.ts`/`chatSessionStore.test.ts`/`chatSlashCommands.test.ts`/`chatTitles.test.ts`/`chatToolIcon.test.ts`/`chatTranscript.test.ts` cover this whole pure layer.

#### `chatKeyedStore.ts`
The shared shape factored out of `chatColors.ts`/`chatSessionStore.ts`/`chatComputerUse.ts`, which had each hand-rolled the same chatId-keyed, capped, localStorage-persisted list: the same filter-then-push upsert, the same reversed-loop newest-wins lookup, and the same try/catch JSON parse/write. `createChatKeyedStore(storageKey, cap, isEntry)` returns `{read, write, upsert, remove, lookup}` over one storage key; `upsertEntry`/`removeEntry`/`lookupEntry` are its pure primitives, exported separately and unit-tested. Each of the three callers keeps its own storage key, cap, entry shape and validator, and wraps these primitives in its own exported function names — deliberately, since those keys are already real data sitting in users' browsers and a changed key or shape would silently lose their state.

#### `chatQueueRestore.ts`
Pure "what should Stop hand back to the composer" logic, split out of `ChatView.tsx` (like `chatEditorContext.ts`). Fixes a bug where stopping a chat mid-turn used to DELETE any still-queued follow-up messages instead of restoring them to the composer draft. Tested.

#### `chatToolIcon.ts`
Pure presentation rules for a chat tool chip: `toolIcon`/`pickToolIcon` pick which icon a tool call shows (`GENERIC_TOOL_ICON = 'Wrench'` as the fallback), `chipSummary`/`clamp` derive and truncate its one-line summary. Tested.

#### `ChatColorDot.tsx`
The small color swatch shown in a chat tab's Color submenu rows (`App.tsx`'s `openTabContextMenu`) — one filled dot per swatch, plus a "none" ring for the Reset row.

#### `ChatSetup.tsx`
The individual "this chat can't run" screens, rendered by `chat/ChatSetupGate.tsx` INSTEAD of the transcript+composer: either the active provider's CLI isn't installed (`setupError`), or this vault's hidden-notes policy can't be honored by the active backend (`gateRefusal` — see `core/src/chat.ts`'s `visibilityRefusalMessage`/"visibility-refused" and `core/src/agentBackends/visibilityGate.ts`).

---

### Icons

One icon system, drawn from one generated manifest — Phosphor Regular SVGs, migrated off an earlier Nerd Font glyph era (which itself replaced a still-earlier hand-authored pixel-art set). `<Icon>`'s own prop shape (`value`/`size`/`class`/`style`/`fallback`) was kept identical across the Phosphor migration specifically so the ~100 existing call sites needed no changes.

#### `icons/Icon.tsx`
`<Icon value="..." size={...} />` — the one component every call site uses to show an icon. `value` accepts a canonical icon name (any casing, optional legacy `Li`/`Lu` prefix) OR an emoji/arbitrary glyph string, so a note's `icon: 🪶` keeps showing the feather while `icon: House` renders the app's Phosphor house glyph through the same prop. Falls back to `FALLBACK_ART` for a name-shaped spec that isn't mapped (rather than showing broken-looking raw name text), or renders the literal string as a glyph otherwise.

#### `icons/iconNames.ts`
`ICON_NAMES: string[]` — the 140 canonical icon names every icon set must resolve; this is the SET-INDEPENDENT name seam `registry.ts` refers to. It does not change when the art behind a name does (Nerd Font → Phosphor → whatever comes next) — only the mapping from these names to a set's own identifiers changes.

#### `icons/iconMap.ts`
`ICON_MAP: Record<string, PhosphorEntry>` — canonical icon name → Phosphor Regular identifier; `KNOWN_MISSING` lists names with no Phosphor equivalent. This is the module a future icon-set swap replaces: `registry.ts` and the icon-SVG build script are written against its `PhosphorEntry` shape, not against Phosphor specifically, so swapping sets later means writing a new file with this shape and pointing the build script at it.

#### `icons/registry.ts` + `icons/registry-core.ts`
The icon registry: a static NAME → ART map. `registry-core.ts` is the pure, framework-free resolution logic (`normalizeIconKey`/`looksLikeIconName`/`createIconRegistry<T>`, unit-testable with no DOM); `registry.ts` binds it to the real generated manifest, exposing `IconArt`/`FALLBACK_ART`/`resolveIcon`/`isIconName`/`allIcons()`. `icons/registry-svg.test.ts` + `icons/registry-seed.test.ts` pin this resolution behavior directly (no separate `registry-svg.ts`/`registry-seed.ts` module exists): every one of the 140 canonical names resolves to real Phosphor art or a deliberate known-missing marker, never to nothing, and every icon name the command catalog (`core/src/commands.ts`) references resolves to mapped art rather than the generic fallback glyph.

#### `icons/iconMarkup.ts`
`iconMarkup(name, size?)` — static markup for an icon, for imperative call sites that cannot mount/dispose a reactive root (notably CodeMirror's `addToOptions` render hook, which gives no per-option teardown). Builds the markup straight from the registry rather than mounting `<Icon>` into a detached node and reading `innerHTML` back, so the box styles stay explicit and diffable instead of duplicating `Icon.tsx`'s box logic through a DOM round-trip.

#### `icons/nerdGlyphs.ts`
`NERD_GLYPHS: Record<string, number>` — canonical icon name → Nerd Font codepoint for all 140 names, `FALLBACK_CODEPOINT`. RETIRED from `<Icon>` as of the Phosphor migration (`registry.ts` no longer imports it) but kept for two reasons: `icons/specimen/` renders this era's glyphs in its Nerd-Font-vs-Phosphor comparison column via the real subset font, and it anchors `iconNames.ts`'s 140-name canonical list to what the incumbent set actually covered.

#### `icons/specimen/`
`IconSetSpecimen.tsx` + `SvgIcon.tsx` (each with a colocated `.module.css` + story) and `iconSetData.ts` — the decision record comparing icon sets side by side (Nerd Font incumbent vs. Phosphor), rendered as a Storybook story rather than kept only in a design doc so the actual glyphs are what get compared.

#### `icons/IconPicker.tsx`
Icon picker UI (used by folder icon assignment in the file tree).

---

### Drag and Drop

#### `dnd/geometry.ts`
Pure drop-zone geometry helpers: `computeDropZone(rect, point)` determines which zone (left/right/top/bottom/center) a drop target point falls in. Tested.

#### `dnd/viewDrag.ts`
`createViewDrag(handlers)` — wires pointer event listeners for pane drag-and-drop. Returns `DragDescriptor` and `DropTarget` types.

---

### UI Primitives (`ui/`)

Shared design-system components. All import `ui.css` for shared button/input chrome; `export default`, `Component`-typed, most now with a colocated `<Name>.module.css`.

| Component | Purpose |
|-----------|---------|
| `Button.tsx` | Base button (internal; use TextButton/IconButton) |
| `TextButton.tsx` | Text-label button |
| `IconButton.tsx` | Icon-only button |
| `IconTextButton.tsx` | Icon + text button |
| `buttonClass.ts` | `buttonClass(kind, state, size, danger)` — pure class-name builder. Tested. |
| `Chip.tsx` | Pill/tag chip |
| `Stars.tsx` | Star rating widget |
| `StatusDot.tsx` | Colored status indicator dot |
| `ViewBar.tsx` | The view header. Takes six named region slots — `identity` `locus` `facet` `readouts` `config` `actions` — laid out as a leading and a trailing group. Also exports `Crumb` and `VBtn`. |
| `SearchBar.tsx` | Search input with clear button |
| `BarLabel.tsx` | A `ViewBar` label that knows how to get smaller: both a full `long` string and an optional `short` abbreviation sit in the DOM, and CSS picks one via `data-bar-label`/`data-bar-abbr` attributes driven by the shared collapse ladder in `ui/ui.css`; an optional `drop: 'early' \| 'late'` sheds the word entirely at a given tier |
| `SegmentedToggle.tsx` | Multi-option toggle |
| `TextInput.tsx` | Styled text input |
| `Select.tsx` | Styled select dropdown |
| `Field.tsx` | Label + input field wrapper |
| `EmptyState.tsx` | Empty/loading placeholder |
| `Modal.tsx` | Modal dialog wrapper |
| `FormModal.tsx` | The settings/editor modal shape: a `Modal` panel sized as a column of header/body/footer, with a `width` prop (px) capped by `max-width: calc(100vw - 32px)`. Replaces a class six modals (event, categories, recurrence, calendar settings, base settings, query builder) used to share before each had its own module |
| `ModalBody.tsx` | The scrolling content column between a modal's header and footer; optional `maxHeight` for a tighter per-modal cap |
| `SettingsSection.tsx` | Uppercase section eyebrow with a trailing hairline, inside a settings-shaped modal |
| `SettingsGrid.tsx` | Two equal columns of settings fields |
| `SettingsField.tsx` | One labelled control in a settings form — label line (with optional icon + required/optional badge), the control, then an optional `SettingsHint` |
| `SettingsHint.tsx` | Micro faint helper text under a settings field; usable standalone too |
| `BracketToggle.tsx` | Presentational `[ ]`/`[x]` glyph — the row or label around it owns the click and the ARIA |
| `ToggleList.tsx` | Bordered, scrolling surface (max-height 320px) grouping a stack of `ToggleRow`s |
| `ToggleRow.tsx` | One on/off row in a settings form; a real switch (`role="switch"`, focusable, Enter/Space toggles), with `muted`/`locked`/`wrap`/`title` props |
| `Text.tsx` | Body/prose text primitive (`as: 'p'\|'span'\|'div'`, `size`/`tone`/`weight`/`eyebrow` props) — pages should never write a raw `<p>`/`<span>`/`<div>` standing in for prose |
| `Heading.tsx` | Section-title primitive; `level: 1..6` picks both the tag and the size/weight step off the app's one heading ramp, never shipped as separate `Heading1`..`Heading6` files |
| `Label.tsx` | Truncating-label primitive (a row's title, a card's cover text); always sets `min-width: 0` alongside `overflow: hidden` so `text-overflow: ellipsis` actually fires inside a flex row |
| `Badge.tsx` | Small count/indicator primitive (`variant: 'inline'\|'solid'`, `tone`) — a section head's row count, a toolbar button's live-count pill |
| `devWarn.ts` | Dev-only warning helper |
| `uiLint.ts` | Pure dev-time lint helpers (tested): `uppercaseWarning(children)` flags a `TextButton` label that isn't all-caps; components call these behind an `import.meta.env.DEV` guard |
| `ascii/` | `AsciiMeter.tsx`, `AsciiTree.tsx`, `Glyph.tsx`, `GraphField.tsx`, `Kbd.tsx`, `TabRail.tsx` (ASCII-rendering primitives) plus their pure math modules (`asciiMeterMath.ts`, `noiseField.ts`, `parseCombo.ts`, `rasterEdges.ts`, `treePrefix.ts`), each tested |
| `gallery/` | `galleryStore.tsx` (global image gallery), `SymbolGallery.tsx`, `sources.ts`, `types.ts`, `activeItem.ts` (tested), `galleryState.ts` |
| `popover/` | `PopoverList.tsx`, `MenuRow.tsx`, `createMenuNav.ts`, `iconMap.ts`, `rowDom.ts`, `popover.css` |

---

### Misc App Modules

#### `viewCache.ts`
`readCache(key)` / `writeCache(key, value)` — localStorage cache helpers for graph and settings. Tested.

#### `sanitizeHtml.ts`
`sanitizeHtml(dirty)` — DOMPurify wrapper. Browser/headless-aware (passes through in Bun tests). Use for any vault-rendered HTML.

#### `htmlEscape.ts`
`escapeHtml(s)` / `escapeAttr(s)` — canonical HTML escaping helpers. Use when building HTML strings; never roll per-file escapers.

#### `debounce.ts`
`debounce(fn, ms)` — generic debounce utility. Tested.

#### `appWindow.ts`
`openAppWindow(url)`, `pickFolder()`, `openExternalUrl(url)` — Tauri window and dialog abstractions. Gracefully degrades outside Tauri.

#### `nativeMenu.ts`
`openContextMenu(items, event)` — wires right-click context menus to Tauri's native menu on macOS, falls back to `ContextMenu.tsx` in browser.

#### `nativeAppMenu.ts`
`installAppMenu(handlers)` — configures the macOS native app menu (File/Edit/View) from `app.menu` Tauri config.

#### `ContextMenu.tsx`
Browser-rendered context menu component. `MenuItem` type.

#### `PreviewView.tsx`
PREVIEW tab for non-note files (images, PDFs, code/text) — the default open for a path `previewKind()` classifies. Images/PDFs take ink in place (`preview/PageInk.tsx`, toggled by the `toggle-draw-mode` key on a capture-phase keydown, like Find) into their `<file>.draw` sidecar; every kind exposes "Open in default app"/"Reveal" (Tauri) for binary formats it can't render. Handles its own Cmd/Ctrl+F find per content kind on a capture-phase keydown (App.tsx has no global find handler). Routing lives in `PaneContent.tsx`; classification in `preview/previewKind.ts`.

#### `preview/` (`assetUrl.ts`, `findMatches.ts`, `previewKind.ts`)
Pure helpers behind `PreviewView.tsx`, each tested. `previewKind(path)` classifies a path into a preview kind (image/pdf/code/text/unsupported) and backs `isPreviewPath()`/`tabIds.ts`'s label+icon derivation. `assetUrl.ts` builds the backend URL for a binary asset. `findMatches.ts` is the pure match-finding logic behind the in-preview find bar.

#### `preview/PageInk.tsx`
In-place ink over an image/PDF preview: one committed + live canvas pair per rendered page (only near the viewport), the drawing `Toolbar` while draw mode is on, its own undo stack, debounced saves to `inkSidecarFor(binary)`. The page-box/screen mapping is the pure `core/src/drawing/pageInk.ts` (tested). Story: `PageInk.stories.tsx`.

#### `GraphView.tsx`
Graph pane shell. Mounts `AsciiGraphRenderer` (the sole `GraphRenderer` implementation) + a `GraphAtmosphere` glow/vignette overlay; exposes mode/view toggles (2nd/3rd/both/daemon, 2D/3D — the "agents" mode and its `AgentsGraph` cards/org-picker overlay were removed in commit `a6687c0`). 2D/3D toggle persisted to localStorage (not `.settings`).

#### `GraphSearch.tsx`
Graph search input — highlights matching nodes in the graph.

#### `FileView.tsx`
Routes a `.md` note path to `Editor` (for regular notes) or `BaseView` (for `type: base` notes). Manages note title editing.

#### `NoteTitle.tsx`
Editable note title bar above the editor. Handles rename (writes frontmatter `title` or renames the file). Tested via `noteTitleOps.test.ts`.

#### `noteTitleOps.ts`
Pure helpers for note title operations (derive title from path, detect custom title, etc.). Tested.

#### `SearchResultRows.tsx`
Shared `.sresult` result-card renderer (`SearchResultRows` + `splitPath`) for the switcher's keyword content matches and Bismuth AI results — file header + optional AI rationale + matched snippets, with keyboard-selection support. Styles in the colocated `SearchResultRows.module.css`. (The former standalone `SearchView.tsx` Search tab was removed when search unified into the Cmd+O switcher; vault-wide find-and-replace remains via the CLI / `POST /replace`.)

#### `searchOpts.ts`
`SearchOpts` flags for `POST /search` and the `SearchResult`/`MatchSnippet` shapes shared by `/search` and `/search-prompt`.

#### `EmptyPane.tsx`
Rendered for `::empty` pane content.

#### `FolderPrompt.tsx`
Dialog for picking a vault folder (used by "Open folder" flow).

#### `Toast.tsx`
`pushToast(message, action?, ttl?)` / `dismissToast(id)` / `ToastHost` component. Global toast notification system.

#### `telemetry.ts`
`recordSseError(e)` / `recordPollCatchup(v, lastSse)` — lightweight client telemetry (counts SSE errors and poll catch-ups, logged to console). No external service.

#### `editorRegistry.ts`
`registerEditor(path, view)` / `unregisterEditor(path)` / `getEditor(path)` — global registry of live CodeMirror instances. Used to programmatically focus or update editor content.

#### `propertyRegistry.ts`
`propertyRegistry` — Solid store of vault-wide property types (derived from schema + observed frontmatter). Used by the bases engine and autocomplete. Tested.

#### `keybindings.ts`
`matchesKeybinding(event, combo)` — pure key-combo matcher. Supports `"Mod"` (Cmd/Ctrl), exact modifier matching, comma-separated alternatives, and produced key OR `event.code`. Tested.

#### `commands.ts`
`bindCommands(handlers, dailyNotes?)` — maps each catalog command id to a `BoundCommand { id, label, icon, action }`. Tested.

---

### Mobile (`app/src/mobile/`)

#### `bootMobile.ts`
`bootMobile(opts)` / `defaultVaultDir()` — swaps in Tauri FS and in-process transport for iPad. Call before importing `App`. Desktop `index.tsx` never imports this.

#### `tauriFileAccess.ts`
`FileAccess` implementation backed by `@tauri-apps/plugin-fs`.

#### `inProcessTransport.ts`
`Transport` implementation backed by `createLocalBackend` (runs `core/src/localBackend.ts` in-process).

---

## `app/.storybook/` — Component Development

Storybook 9 (`storybook-solidjs-vite`) mounts individual `app/src/` components outside the full Tauri+Solid app shell, for building and visually verifying them in isolation. `bun run storybook` (from `app/`) starts it on port `6006`; `bun run build-storybook` produces a static build. Story files are colocated with the components they document (`<Component>.stories.tsx`, matched by the glob `../src/**/*.stories.@(ts|tsx)` in `main.ts`) rather than living in a separate tree.

#### `main.ts`
Storybook config: framework `storybook-solidjs-vite`, the colocated stories glob, no addons (SB9 bakes controls/actions/viewport/backgrounds/docs into core, and `storybook-solidjs-vite` has no SB8 build, so the catalog runs on SB9 from the start).

#### `preview.ts`
Global setup every story gets, without which components render wrong or not at all:
- Loads the same Monaspace font faces `app/src/index.tsx` loads, plus `App.css`, `ui/ui.css`, and `ui/popover/popover.css` for the primitives' own chrome.
- **Runtime theme tokens**: calls `setCssVars(settingsToCssVars(DEFAULTS))` (`app/src/settingsCssVars.ts` + `core/src/schema/settingsSchema.ts`'s `DEFAULTS`) — the exact projection `App.tsx` performs at runtime — so the catalog renders in the real default ("ink") theme instead of `App.css`'s dark first-paint fallbacks.
- **Backend seam**: calls `setTransport(fakeTransport({...}))` (`app/src/api.ts`'s swappable `Transport`, the same seam `app/src/mobile/inProcessTransport.ts` uses to run the whole app with no HTTP server) seeded from `_baseFixtures.ts`'s `SAMPLE_ROWS`, so a component that fetches on mount (e.g. a card's `api.read()`, a query builder's `resolveRows`/`tree`, daemon/gcal status panels) reads back real content instead of sitting in a loading state forever — a story that renders only a spinner verifies nothing while looking like it passed.
- Disables Storybook's own background-color toolbar (the page already paints from `--bg` via `App.css`'s `body` rule).

#### Shared fixtures (`app/src/ui/_*`)
Underscore-prefixed by convention, and excluded from the catalog because they don't match the `*.stories.*` glob:
- `_storyKit.tsx` — shared layout helpers (`Label`, `labelStyle`) for the `ui/` primitives' own stories.
- `_baseFixtures.tsx` — sample Bases rows/config; `sampleViewResult` runs the REAL `core/src/bases/query.ts` `runView` over them, so a view story's `result`/`config` matches exactly what the production pipeline would hand it. Also the source of `preview.ts`'s seeded file content (`SAMPLE_ROWS`).
- `_fakeTransport.ts` — the in-memory `Transport` implementation `preview.ts` installs; covers `GET /tree`, `GET /file`, `PUT /file`, `POST /rows` with per-route logic, everything else with a generic 200 ack.
- `_calendarFixtures.ts` — sample events/categories plus a `seedCalendarState()` helper: the calendar views read `events`/`categories`/`currentDate` from `calendar/state.ts`'s module-level signals, not props, so a story must seed state before mounting one.
- `_graphFixtures.ts` — sample `GraphData`, laid out with the real `core/src/layout.ts` `computeLayout` (never hand-placed positions).
- `_daemonFixtures.ts` — sample `DaemonPage`s covering every `PageStatus` (pending/working/done/failed/dismissed) for the inbox stories.
- `_cmHarness.tsx` — mounts a minimal CodeMirror 6 `EditorView` (history + selection drawing + default/history keymap + line wrapping, nothing note-specific) for components that take a live `EditorView` as a prop (e.g. `editor/InkOverlay.tsx`) without pulling in the full `Editor.tsx` note-editing stack.
- `_fontFace.ts` — story-only assertion helpers for the mono/prose typography split: `expectProseFace`/`expectUiFace` assert an element's resolved first font-family matches the LIVE `--prose-font`/`--ui-font-stack` token (never a literal family name, so a token repoint or a changed `appearance.editorFontSize` doesn't leave the check vacuously green), `expectEditorSize` asserts exact `--editor-font-size` (not a scaled multiple), and `expectBoundToUiFont` proves a real binding to the `--ui-font-stack` token rather than mere coincidental equality by repointing the token and reading back through the same `root.style.setProperty` cascade path `settingsCssVars.ts` uses. `expectFamilyReallyLoaded(family)` proves a face genuinely resolved rather than falling through to its CSS-stack fallback: it does NOT use `document.fonts.check`, because that call answers "can text in this shorthand be rendered right now" — true for a family that doesn't exist at all (the fallback is usable) and false for a registered-but-not-yet-laid-out lazy webface, so it can't distinguish "loaded" from "missing." Instead it `document.fonts.load()`s the family, then measures a pangram in it on a canvas against the same string measured in a deliberately nonexistent family, and fails if the widths match (identical widths mean the browser silently fell through to the same fallback for both). This caught a real false positive during the two-font migration: two runs produced identical 405.71875px widths, i.e. the target family had NOT resolved despite the story otherwise looking green. Imported by `Editor.stories.tsx`, `ChatView.stories.tsx`, `ChatComposer.stories.tsx`, and `ui/_calendarAssertions.ts`; replaced the earlier single-surface `_proseFace.ts`, which no longer exists.

#### Coverage
737 story exports across 180 component story files (`*.stories.tsx`; same metric and recount
commands as `docs/contributing/testing.md`'s Storybook section — `find app/src -name
"*.stories.tsx" | wc -l` for files, `grep -rhoE "^export const [A-Za-z0-9_]+" app/src
--include="*.stories.tsx" | wc -l` for exports), spanning the `ui/` primitives (including `Text`/`Heading`/`Label`/`Badge` and the `ascii/` set), all 12 Bases view renderers (`bases/BarView.stories.tsx` through `bases/TableView.stories.tsx`), the calendar views, the `shell/` components (`AppFrame`, `TopStrip`, `Sidebar`, `TabRail`/`TabRailRow`, `EditorPane`, `GraphFloater`, `PaneOverlay`, `StatusBar`, `InboxIndicator`, `CommandButton`, `DragGhost`, `WindowControls`) and the promoted pane components (`PaneLeaf`, `PaneHeader`, `PaneDropZone`, `PaneTree`), app-root chrome and modals (`ContextMenu`, `Toast`, `NoteTitle`, the daemon/gcal modals, `InboxPageView`, the `daemon/` panels, …), `PreviewView`, drawing, graph (`GraphView`, `graph/EmbeddedGraph`), editor surfaces, and `ChatView`.

---

## `app/scripts/` — Dev, Build, and Packaging Scripts

#### `dev.ts`
The one dev entry point, in two flavours: `bun run dev:browser` (root `package.json` script `dev`, wired from `app/package.json`) runs core server + Vite and opens `http://localhost:1420`; `bun run dev:app` runs the same two plus the Tauri window. Both **default to a generated example vault** (`devVault.ts`) so a fresh clone runs with no setup — export `BISMUTH_VAULT`/`BISMUTH_MEMORY` to point at a real vault instead, overriding the default. Mints one random owner token (`core/src/ownerToken.ts`) and threads it to both halves (`BISMUTH_OWNER_TOKEN` to the core server, `VITE_OWNER_TOKEN` to Vite, baked into the bundle and read by `api.ts`'s `resolveOwnerToken`) so dev requests present as the vault's owner rather than a filtered non-owner channel — without it every content route 403s or silently filters the moment a vault marks anything `visibility: chat-only`/`hidden`. `--app` runs Tauri in-process (via `concurrently`) rather than through `tauri.conf.json`'s `beforeDevCommand`, which would otherwise start a second core+Vite pair and collide on `:4321`/`:1420`.

#### `devVault.ts` / `devVaultContent.ts`
`resolveDevVault()` / `describeChoice()` — picks between the env-supplied vault/memory dirs and a generated example vault (content authored in `devVaultContent.ts`) when neither env var is set.

#### `build-core-sidecar.ts` / `build-daemon-sidecar.ts` / `build-bismuth-tools.ts`
Compile `core/src/server.ts` / the daemon runtime / the `cli`+`mcp` pair to standalone binaries bundled into the Tauri app (see CLAUDE.md's "Desktop app & core sidecar").

#### `build-icon-font.ts` / `build-pixel-icons.ts` / `iconFontTables.ts` / `gen-dock-icons.ts` / `gen-logos.ts` / `logoMarks.ts`
Icon/logo asset generation — the icon font build, pixel-icon rasterization, platform dock icons, and the wordmark logo marks (`logoMarks.ts` tested via `logoMarks.test.ts`).

#### `bundle-relay.ts`
Bundles the `relay/` Claude Code plugin (`BISMUTH_RELAY_BUNDLE`) for injection into app terminals.

#### `postbuild-clean.ts` / `predmg-clean.ts` / `signingIdentity.ts` / `open-installer.ts` / `tauri.ts` / `buildUtils.ts`
Packaging support: post-build/pre-DMG cleanup (`postbuildClean.ts` tested via `postbuildClean.test.ts`), code-signing identity resolution, the installer launcher, the `tauri` CLI wrapper, and shared build helpers.

---

## `bench/` — Visual Verification Tooling (not a workspace)

Root-level, no `package.json` — invoked via `bun bench/<file>.ts` directly or through the root `package.json` scripts (`visual`, `visual:all`, `visual:affected`, `visual:baseline`, `play`, `verify`, `tokens:lint`, `tokens:lint:list`, `tokens:bless`). Every headless-Chrome tool here shares one launcher (`chromeSession.ts`) because a browser-automation tab that is not the foreground window reports `document.visibilityState === "hidden"`, and `GraphView` gates its rAF loop on exactly that — so a backgrounded tab's canvas samples 0% inked, indistinguishable from a broken renderer; the shared launcher's three `--disable-*background*` Chrome flags are what make any of this runnable unattended.

#### `chromeSession.ts`
Originally written here after three tools each grew their own copy of launch+teardown and each got the teardown wrong a different way (an undeleted profile dir, a `rmSync` losing a race against a still-writing Chrome, a swallowed `ENOTEMPTY`); the launcher itself has since moved to `core/src/render/chromeSession.ts` (see the core **Rendering** section above) so the CLI's headless PDF/PNG export can share it too, and this file is now a one-line re-export (`export * from '../core/src/render/chromeSession'`). Still the module every `bench/` tool imports for binary path, flag set, port poll, the CDP WebSocket, and a teardown that runs on every exit path.

#### `poolSize.ts`
The one place that answers "how many concurrent Chrome targets should a sweep run": `poolSize(max = 8)` derives concurrency from the machine rather than a hardcoded constant — a CPU budget (`cpus().length - 1`) and a memory budget (half of *current* `freemem()`, not total, divided by a ~120 MB per-tab estimate), taking the smaller. Shared by the three tools that pool browser targets (`invariants.ts`, `playCheck.ts`, `storyAudit.ts`), which each used to answer this separately — two with a hardcoded `6`, one not pooling at all (`storyAudit` measured 172 stories in 3m02s at 13% CPU before it adopted this). `--concurrency` still overrides per tool.

#### `affected.ts` (→ `bun run visual:affected`)
Maps a git diff to the stories it can actually affect, so the everyday check is seconds instead of a full sweep. Rules: `Foo.stories.tsx` → its own stories; `Foo.tsx` → `Foo.stories.tsx` if it exists; `Foo.module.css` → the colocated `Foo.stories.tsx`; `ui/ui.css`/`App.css`/`theme/tokens.ts` → EVERYTHING (global, scoping them would lie). A file with no matching story is reported, not silently dropped.

#### `checkChanged.ts` (→ `bun run visual`)
The everyday visual check: runs `invariants.ts` over only the stories `affected.ts` says the current diff can reach. `--all` runs every story; `--base <ref>` diffs against another ref.

#### `invariants.ts` (→ `bun run visual:all`)
Baseline-free visual checks — properties that hold regardless of design (readable text size, visible text, a control with a real hit area, content not escaping its container, font sizes on the project's own type scale). Nothing to re-record on a deliberate restyle, so this can run on every commit; it is the sibling of `cssBaseline.ts`, not a replacement for it — it only catches what's wrong *under any design*, not "did this change".

#### `cssBaseline.ts` (→ `bun run visual:baseline`)
The CSS-Modules-migration gate: an absolute computed-style baseline for every element in every story (`css-baseline.json` / `baselines/`), sensitive enough to prove a ~330-rule stylesheet move changed nothing visually. Deliberately NOT the everyday check — any intentional restyle makes it red until re-recorded. Freezes `Date`/animations and awaits `document.fonts.ready` for determinism (see its header for the four sources of run-to-run drift this guards against, including a blinking-caret keyframe and a calendar view that grids relative to `Date.now()`).

#### `storyAudit.ts` (skill: `story-audit-look` / `fix-audit-defects`)
Screenshots every story and flags ways a component can be visibly BROKEN, with no history/baseline needed — answers "is this wrong right now", not "did this change". Emits both DOM signals (cheap, ranked leads: clipping, narrow text, off-screen elements) and the screenshots themselves, because some wrongness (overlapping siblings that both technically fit, a control in the wrong place, the wrong icon) is only geometrically legal and only catchable by looking.

#### `playCheck.ts` (→ `bun run play`)
The only tool in the repo that actually EXECUTES a story's `play()` function rather than just rendering it — there is no Storybook test-runner in this repo, so before this existed a throwing `play()` assertion looked identical, in every other gate, to a passing one. Reads Storybook's own addons channel (`window.__STORYBOOK_ADDONS_CHANNEL__`, reachable even standalone in `iframe.html`) but distrusts its two lying signals (`StoryRender.phase` and `storyFinished`'s `status` both report success even when `play()` threw) in favor of the one honest event, `playFunctionThrewException`. Grades each story one of five outcomes, never collapsed into each other: `SKIP` (no play function — not a pass), `PASS`, `FAIL` (`play()` threw), `ERROR` (the story never rendered at all — broken import, a mount-time throw, or a genuine hang), and `UNSAFE` (`play()` ran clean but `document.visibilityState` went `"hidden"` mid-run, so a canvas/rAF-gated paint may have been measured blank without anything noticing — also not a pass). Pools targets via `poolSize.ts`.

#### `verify.ts` (→ `bun run verify`)
The one-shot an implementer runs before handing a task back: boots Storybook if nothing answers `--port` (REQUIRED, no default — 6006 is the trap every sibling tool above has, silently measuring whatever the main checkout is running in a worktree), or reuses one already there untouched; runs `playCheck.ts` + `invariants.ts` + `storyAudit.ts` over each `--prefix` in order, capturing each tool's stdout+stderr to its own log under `--out/logs/`; hashes every shot against an optional `--baseline` dir; and prints ONE summary block ending in a grep-able `RESULT: PASS`/`RESULT: FAIL` line. Fails on any tool `toolError`, a `playCheck.ts` fail/error/unsafe, a nonzero `invariants.ts` exit, or a `storyAudit.ts` `HARD_AUDIT_FLAGS` flag (`empty-render`/`crashed`/`probe-failed`) — every other audit flag is a lead, and baseline shot differences are information, never a failure. Stops any Storybook it started on every exit path (`try`/`finally` + `SIGINT`), unless `--keep`.

#### `verifyReport.ts`
The pure half of `verify.ts` — arg parsing, the shot-hash set-diff (`compareShots`), the pass/fail verdict, and the exact summary text (`summarize`) — no I/O, no `Bun.*`, no `node:fs`, so `verifyReport.test.ts` unit-tests every failure kind with zero Chrome/Storybook/filesystem involved. `verify.ts` itself is only the I/O that feeds it.

#### `tokenLint.ts` (→ `bun run tokens:lint`, `tokens:lint:list`, `tokens:bless`)
Literal-value lint over every `app/src/**/*.css` and `*.module.css` declaration — the self-policing gate for the design-token scale (`--sp-1..7`, `--h-row`/`--h-control`/`--h-band`, `--icon`, `--r-0`, `--state-*`, `--rule*`), so a later sweep can't quietly reintroduce a magic number while fixing its own surface. Flags: non-zero literal-px `border-radius` (any corner longhand; `50%` survives, since a circle is a shape, not a softened corner); literal-px `padding`/`margin`/`gap` (and longhands) — a raw px number is flagged even when it happens to equal a scale step, because the point is consuming the token, not matching the pixel by luck; literal-px `font-size`; a `box-shadow` with non-zero blur radius; any `backdrop-filter` other than `none`; and literal hex/`rgb()`/`rgba()` color values. Custom-property declarations (`--foo: …`) are exempt from the first five checks (`tokens.css` is who is allowed to write the literal a component then reads via `var()`) but NOT the color check — a component inventing its own hardcoded color in a custom property is exactly the drift the color system is otherwise free of. `--list` prints every current violation grouped by file (`--file <substr>` scopes it); `--bless` overwrites the known-violations baseline with the current violation set — a deliberate ratchet step, like `test:bless-schema`, taken at the end of a wave that fixed some but not all violations in a file.

#### `moduleClassCheck.ts`
Cross-checks emitted CSS class names against the emitted JS bundle to catch a CSS-Modules call site left holding a stale string literal (`class="ft-row"` after the rule moved to `<Component>.module.css` and hashed to `._ft-row_163am_18` — compiles, renders, matches nothing). Reads the production bundle; needs no story. Catches names, not appearance or specificity — a dropped declaration that kept its class name, or a class reached through a dynamic key, is reported as UNCHECKABLE rather than guessed at.

#### `probeStory.ts`
A one-story microscope: computed styles for a single named story in ~5 seconds, for the "does THIS component's rules still resolve" question asked repeatedly while migrating one component — `cssBaseline.ts` is still the full gate that has to be green before a commit lands. Keys elements by tag + nth-of-type chain from the story root (never by class name, which a CSS-module migration is guaranteed to change).

#### `templateDiff.ts`
Did a refactor change the emitted MARKUP? Compiles both sides of a diff through the repo's own `babel-preset-solid` and byte-compares the static `_$template(...)` strings it emits — immune to reindentation, renamed handlers, and how props are threaded. Two modes: default (templates must be exactly equal — the extraction half of a migration) and `--modulo-class` (equal after stripping `class=…` attributes — the CSS half, where a static class legitimately becomes a dynamic expression and drops out of the template).

#### `iconFontProbe.ts`
Does the icon font actually load and draw in a real, running Storybook (`cd app && bun run storybook`, then `bun bench/iconFontProbe.ts`)? Complements `app/src/icons/iconFont.test.ts` (which proves every codepoint maps to a glyph in the committed woff2 file, but can't see the browser: bundling, `@font-face` resolution, family-name match). Draws each character twice — once in the icon family, once in a nonexistent family — and compares rasters, since Symbols Nerd Font Mono's `.notdef` is the same width as every real glyph.

#### `layoutmetrics.ts` / `layoutquality.ts`
Pure, unit-testable graph-layout quality metrics (`layoutmetrics.ts`: neighbor-preservation ratio, edge-crossing rate, seeded/deterministic sampling) and the harness that runs them over a real vault through the production `layout-cache.ts` cold path (`layoutquality.ts`, read-only, never point at a real user vault). Non-finite metrics are never silently `JSON.stringify`'d to `null` — they're serialized as strings, named in a `nanFields` list, and force a nonzero exit code.

#### `visual.ts`
Deterministic before/after screenshots of the actual running app (not Storybook) — `bun bench/visual.ts --base http://localhost:1422 --out shots/`. Waits for canvas ink to stop changing before each shot instead of freezing the clock, since its readiness loop depends on real animation settling.

#### `bench.ts`
Backend hot-path benchmarks over a synthetic vault (never a real one) — wall time and max event-loop stall, runnable identically against old commits via a git worktree for before/after tables.

#### `watch.sh`
Shell loop wrapper for one of the above tools.

---

## `cli/src/` — CLI Binary

The `bismuth` binary (entry: `cli/src/index.ts`). Longest-match dispatch: tries two-word phrases first (`"task toggle"`), then single words (`"graph"`). Each command group is a thin wrapper over `@bismuth/core` functions — no running server required for file-based operations.

### `args.ts`
`flag(args, name)`, `positionals(args)`, `requireVault(args)`, `out(data, args)`, `fail(msg)` — shared CLI argument helpers.

### `types.ts`
`CommandMap = Record<string, CommandSpec>`, `CommandSpec { summary, usage?, run(args) }`.

### `commands/file.ts`
`list`, `read`, `write`, `move`, `delete`, `restore` — vault file operations.

### `commands/note.ts`
`note new` (create note, optionally from template), `templates` (list templates), `daily` — open/create today's daily note.

### `commands/search.ts`
`search`, `replace` — full-text search (`searchVault`) and vault-wide find-and-replace (`replaceInVault`); both take `--regex`/`--case`/`--word`.

### `commands/graph.ts`
`graph` — dump the full knowledge graph (vault + optional memory) as JSON.

### `commands/task.ts`
`task list` (optional `--query <dsl>`), `task toggle` — list and toggle tasks.

### `commands/base.ts`
`base read`, `rows`, `row add`, `row update`, `row delete`, `row reorder` — read a base, resolve a `SourceSpec` to `Row[]`, and mutate a base's table rows.

### `commands/card.ts`
`card decks`, `card all`, `card due`, `card note`, `card review` — SRS card management (`review` is dual-mode: markdown card vs. flashcard-base row).

### `commands/prop.ts`
`prop set`, `prop delete` — frontmatter property manipulation (there is no `prop get`).

### `commands/calendar.ts`
`calendar bases`, `create`, `list`, `range`, `get`, `search`, `day`, `overlaps`, `add`, `move`, `delete`, `override`, `delete-occurrence`, `categories`, `category add`, `category update`, `category remove` — edit a calendar base (a `type: base` + `view: calendar` markdown file) by API instead of hand-editing raw YAML, which the app's own rewriter strips quotes from, adds `localUpdated` to, and can't remove one recurring occurrence from. Every write preserves the whole frontmatter and touches only events + categories (`core/src/calendar.ts`, ported from BaseBackend). All commands are headless — the app's vault watcher picks up the writes live.

### `commands/settings.ts`
`settings get`, `settings set`, `settings schema`, `folder-icon` — read/write `.settings` keys + the per-folder icon map.

### `commands/daemon.ts`
`daemon status`, `daemon devices`, `daemon owner`, `daemon install`, `daemon setup`, `daemon update`, `daemon graph`, `daemon cron toggle`, `daemon cron run`, `daemon process toggle` — read/write the daemon's machine-level state (`~/.bismuth/daemon`) + a vault's `.daemon` crons/processes (no `--vault`).

### `commands/draw.ts`
`render` — render a `.draw` file to PNG (or `--pdf`) headless (filesystem path, no `--vault`).

### `commands/serve.ts`
`serve` (start the backend server, `createServer`), `backup` (git-snapshot the vault).

### `commands/export.ts`
`export` — export a note/base/sheet/drawing to `md|html|png|pdf`, fully headless: pdf/png of notes/bases/sheets drive real headless Chrome over CDP (`core/src/render/htmlRaster.ts`) against the exact HTML the browser exporter itself would produce, and drawings render through the headless core renderer (`core/src/drawing/export.ts`) — no browser needed for any format.

### `commands/api.ts`
`api <GET|POST|PUT> <path>` — raw HTTP call to any core API endpoint on a running server, for capabilities that live only in server memory (e.g. `bismuth api POST /relay/session` against the relay registry). The standalone `agent-graph` command (and the `GET /agent-graph` route it called) was removed along with the agents graph in commit `a6687c0`.

### `commands/app.ts`
`app windows`, `app tabs`, `app open`, `app close`, `app focus`, `app rename`, `app pin`, `app reorder`, `app run`, `app commands` — drive a RUNNING Bismuth window's tabs from the shell (and, via the `bismuth_cli` MCP tool, from a Claude session): list/open/close/focus/rename/pin/reorder tabs, run a safe command. Everything hits the running core's `/ui/*` routes, relayed over the per-window control socket the app holds open (`core/src/uiControl.ts`) — unlike the file-based groups, these REQUIRE a running app. Core discovery: `--api <url>` → `BISMUTH_API` → `CLAUDE_RELAY_URL` → the run registry (`~/.bismuth/run`, matched by `--vault`/`BISMUTH_VAULT`, else the single running core) → `:4321`. `--window <id>` targets a specific window (see `app windows`); omit it and the single open window is used.

### `commands/backends.ts`
`backends` — answers "which agent CLIs work on this machine, and what will Bismuth do with each?" The catalog (`core/src/agentBackends/catalog.ts`) declares what each CLI *can* do; this reports what is actually installed, resolving binaries and version strings. Read-only and cheap — never runs an agent turn, authenticates, spends money, starts a daemon, or writes config (registering Bismuth's MCP server with a CLI stays the explicit `bismuth install --mcp <cli>`). `--json` for machine output, `--installed` to filter to installed backends only.

### `commands/page.ts`
`page list`, `page create`, `page resolve`, `page mark-failed` — the daemon inbox (`core/src/daemonPages.ts`), run HEADLESSLY against `<vault>/.daemon/pages` like the other file-based groups. `create` goes through the validated `createDaemonPage` helper rather than a raw `file write`, since the nested `actions[]` frontmatter `resolvePage` depends on is easy to get subtly wrong by hand.

### `commands/install.ts`
`install` (machine-wide CLI + MCP install, idempotent + version-gated), `uninstall` — remove the symlink, global MCP registration, and `~/.bismuth`.

### `commands/checkpoint.ts`
`checkpoint diff`, `checkpoint advance`, `checkpoint ref` — per-consumer git bookmarks (`refs/bismuth/<name>`) over any git dir via `--dir`, for "what changed since I last ran" jobs.

### `commands/update.ts`
`update status`, `update apply` — thin wrappers over core's git-based self-update routes (`GET /update/status` / `POST /update/apply`, `core/src/selfUpdate.ts`), which carry no owner-token gate and were already reachable via `bismuth api` but undiscoverable without this group. Same API-base resolution as `commands/api.ts`: `--api <url>` → `BISMUTH_API` → `http://localhost:4321`. Self-update only applies to a bundled SOURCE build (`BISMUTH_INSTALL_SRC` + `BISMUTH_APP_PATH` set on the running core) — elsewhere `status` reports `{available:false, reason:"not-a-source-build"}`. `apply` kicks off `git pull` + rebuild in the background and returns immediately; poll `update status` or `GET /update/progress` via `bismuth api` for phase.

### `commands/gcal.ts`
`gcal status`, `gcal connect`, `gcal sync`, `gcal disconnect`, `gcal targets`, `gcal health` — Google Calendar two-way sync (`core/src/gcal/`, `docs/gcal/overview.md`) from the shell. `status`/`connect`/`sync`/`disconnect` are thin wrappers over a RUNNING server's `/gcal/*` routes (same `call()`/`resolveCore()` pattern as `app.ts`), deliberately not a direct import of `core/src/gcal/index.ts`, so the OAuth/token lifecycle stays orchestrated in exactly one place. `targets` and `health` are pure, HEADLESS reads needing no server.

### `commands/relay.ts`
`relay list` — reads Bismuth's in-process registry of Claude Code work happening inside this vault's own terminal tabs: top-level sessions (one per open tab) and the subagents they spawn (`core/src/relay.ts`), fed by the relay plugin's hooks. KNOWN GAP: this needs a running server and genuinely cannot be anything else — `relay.ts`'s registry is bare in-process Maps with no persistence, so a separate CLI process reading it directly would just construct a fresh, always-empty registry rather than the running server's.

### `commands/chat.ts`
`chat list`, `chat read`, `chat search` — read the owner's own Bismuth chat history (terminal + in-app sessions) from the shell. Wraps three OWNER-GATED server routes (`GET /chat/sessions`, `GET /chat/session-messages`, `POST /chat/search`) that all blanket-refuse (403) any request whose channel isn't `"owner"`, because a past transcript has no single vault path to filter visibility against — there is no "safe partial" response to fall back to for a non-owner caller. `cli/src/http.ts`'s `call()` attaches the vault's owner token (the same one the app's own frontend carries via `window.__BISMUTH_OWNER_TOKEN__`), so the vault's owner running `bismuth chat …` at their own shell gets what they already have access to in the app's History picker UI.

---

## `relay/` — Session Relay Plugin

A Claude Code plugin loaded per-session inside Bismuth terminal tabs. Not installed globally. No cross-machine functionality. Feeds the in-process registry in `core/src/relay.ts`; the "agents" graph that used to render that registry (you → session → subagent) was removed in commit `a6687c0`. The plugin and registry stay because `core/src/chat.ts` reuses their TTL constants and `core/src/agents.ts`'s `ChatAgentSession` shape for its own, separate per-chat subagent tracking, and because the registry remains directly inspectable via `bismuth api POST /relay/...`.

### `.claude-plugin/plugin.json`
Plugin manifest. No `commands` — the plugin exposes no slash commands; it only uses hooks.

### `.mcp.json`
Declares the `bismuth` MCP server so it auto-attaches alongside the plugin, per-session, inside every app terminal (dev repo only — see `docs/mcp/overview.md`).

### `hooks/hooks.json`
Hook definitions:
- `SessionStart` → `bin/session-start-hook.ts` (matcher `startup|resume|clear|compact` — `--resume`/`--continue` sessions and post-`/clear`/`/compact` sessions all register)
- `UserPromptSubmit` → `bin/recall-hook.ts` (heartbeat)
- `SubagentStart` → `bin/subagent-start-hook.ts`
- `SubagentStop` → `bin/subagent-stop-hook.ts`
- `SessionEnd` → `bin/session-end-hook.ts` (drops the session node on a real exit; skips `clear`/`compact`, which keep this terminal's Claude process running)

### `lib/report.ts`
`readHookInput()` — parses stdin JSON; `{}` on empty/invalid. `postRelay(path, body)` — best-effort `POST` to `CLAUDE_RELAY_URL` with a 2 s timeout. `runHook(fn)` — wraps any hook body: always exits 0, never throws. `terminalId()` — reads `CLAUDE_TERMINAL_ID` env. `relayUrl()` — reads `CLAUDE_RELAY_URL` env (default `http://localhost:4321`). `workflowId()` — reads `CLAUDE_WORKFLOW_ID`, falling back to the basename of `CLAUDE_JOB_DIR`, so subagents spawned by the same workflow orchestration share one key; `undefined` for an ordinary subagent. `memoryDir()` — reads `BISMUTH_MEMORY_DIR` (set only when the daemon is enabled; gates the recall/collect memory hooks in `recall-hook.ts`/`session-end-hook.ts`). `reportSession()` — the shared register-this-session POST used by both `session-start-hook.ts` and `recall-hook.ts`.

### `bin/session-start-hook.ts`
Calls `reportSession()` → `POST /relay/session` with `{ sessionId, terminalId, cwd }`.

### `bin/recall-hook.ts`
Heartbeats via `reportSession()` (same endpoint, bumps `lastSeen`) and, when the daemon is enabled, recalls memory relevant to the submitted prompt and returns it as `additionalContext`.

### `bin/subagent-start-hook.ts`
`POST /relay/subagent/start` with `{ parentSessionId, agentId, agentType, workflowId }` — `workflowId` from `lib/report.ts`'s `workflowId()`, omitted for an ordinary (non-workflow) subagent.

### `bin/subagent-stop-hook.ts`
`POST /relay/subagent/stop` with `{ agentId, lastMessage }`.

### `bin/session-end-hook.ts`
On a real exit (not `clear`/`compact`): `POST /relay/session/end` to drop the session node immediately rather than waiting for the terminal pane to close, and, when the daemon is enabled, collects the session transcript into memory as an auto note.

### `bin/wrap.ts`
Generic session reporter for "wrapper"-mode agent-CLI backends (`core/src/agentBackends/catalog.ts` entries with no hook system of their own) — never used for `claude`, which reports itself via real hooks instead. Runs the real binary with inherited stdio, forwards `SIGINT`/`SIGTERM` to it, posts `POST /relay/session` / `POST /relay/session/end` around the child process, and relays the child's real exit code.

### `shim/claude`
Shell script placed on `PATH` inside each terminal tab. Executes `$BISMUTH_REAL_CLAUDE --plugin-dir $BISMUTH_RELAY_PLUGIN "$@"`. Transparent — all flags and arguments pass through.

### `shim/agent-shim`
Multi-call PATH shim for non-zsh shells and any "wrapper"-mode backend beyond `claude`: `core/src/terminal.ts` symlinks one copy per resolvable backend, named after that backend's binary. The script reads its own invoked name, looks it up in the `BISMUTH_SHIM_SPECS` env var, and either execs the real binary directly (`"hooks"` mode) or routes through `bin/wrap.ts` (`"wrapper"` mode).

### `shim/zdotdir/`
zsh init dir (`.zshenv`, `.zshrc`). `ZDOTDIR` is set to this dir so `.zshrc` defines one shell function per `BISMUTH_SHIM_SPECS` entry (`claude` plus any other resolvable backend) AFTER the user's own `.zshrc` loads, making them immune to a `.zshrc` that re-prepends `PATH`.

---

## `memory/src/` — Memory Graph (`@bismuth/memory`)

The pure 3rd-brain memory graph: note CRUD, frontmatter, backlinks, keyword search, the query DSL, and transcript-to-note capture. Every entry point takes an explicit memory dir (or reads `BISMUTH_MEMORY_DIR`) — there is no machine-global default. Consumed by the daemon runtime (`daemon/src/daemon/session.ts` et al.), the relay recall/collect hooks (`relay/lib/report.ts`'s `memoryDir()`), and the per-session MCP memory tools (`remember`/`recall`/`forget`). Deliberately has no dependency on `@bismuth/core` — it has its own test suite and is imported by workspaces (`daemon`, `mcp`) that must stay standalone.

#### `dates.ts`
`todayISO(d?)` — local-date (not UTC) `YYYY-MM-DD` formatter, mirroring `core/src/dates.ts`'s `todayISO` exactly. Local matters: a dream/consolidation cron firing any evening west of Greenwich would otherwise stamp tomorrow's date on the memory it writes.

#### `graph.ts`
The note CRUD layer. `getMemoryDir()` reads `BISMUTH_MEMORY_DIR` or throws (no silent fallback to the wrong place). `NoteType` (`person|project|workflow|fact|preference|daily|auto`), `NoteFrontmatter` (`type`, `tags`, `created`, `updated`, optional `visibility: 'chat-only'|'hidden'`), `MemoryNote` (`name`, `frontmatter`, `content`, `backlinks`). `sanitizeFolder()`/`parseNoteRef()` split and traversal-guard a folder-prefixed ref like `moltbook/foo`. `isMemoryNoteVisibleToDaemon(note)` — the per-note visibility gate (memory notes are flat under `.daemon/memory`, so there is no folder-cascade tier, only this explicit per-note check). `listNotes()`, `readNote()`, `writeNote()`, `deleteNote()`, `loadAllNotes()`, `findBacklinks()` — the CRUD + backlink-lookup surface, all folder-aware.

#### `index.ts`
Barrel: re-exports `graph`, `query`, `search`, `recall`, `transcript`, `dates`.

#### `query.ts`
The query DSL. `parseQuery(queryString)` parses whitespace-separated tokens (`tag:`, `type:`, `link:`, `after:`, `before:`, `keyword:`, or a bare word treated as a keyword) into a `ParsedQuery`. `executeQuery(query, dir?, folder?)` loads all notes, applies the daemon-visibility gate, then filters by the parsed criteria (AND semantics within each filter type). `query(queryString, dir?, folder?)` — the parse+execute convenience wrapper.

#### `recall.ts`
Turns a prompt into the formatted `<bismuth-memory>` context block injected as a `UserPromptSubmit` `additionalContext` — the ONE shared implementation behind both memory auto-injectors (the relay recall hook for terminal-tab sessions, and `core/src/chat.ts` for the visual-chat session). `RECALL_BUDGET_MS` (800ms) bounds the prompt-submission critical path — `searchMemory` is raced against it, and a timeout degrades to "no recall" rather than stalling the turn. `MEMORY_BLOCK_TAG` (`'bismuth-memory'`) and `MEMORY_BANNER` — the envelope + banner that demarcates the injected 3rd-brain memory from the host model's own native memory, and that `transcript.ts`'s `stripInjectedBlocks` keys on to remove before a transcript is collected (closing the recall→collect→recall amplification loop). `formatRecall(notes)` renders the envelope; `recallMemory(dir, prompt, budgetMs?)` is the full recall-and-format call, returning `null` on a blank prompt, no matches, or budget exceeded — never throws.

#### `search.ts`
Keyword search + relevance scoring. `extractKeywords(text)` lowercases, tokenizes, and drops a large `STOP_WORDS` set plus anything under 3 chars. `TYPE_BOOST` weights results by note type (`preference` 1.4× down to `auto` 0.3×) so a preference note outranks an auto-collected transcript note for the same keyword hit. `scoreNote(note, keywords)` scores exact + stem matches across name/tags/body with per-field weights, and `searchMemory(prompt, dir?, maxResults?)` applies the daemon-visibility gate, scores every note, sorts by score, and caps the result set at `MAX_CONTEXT_BYTES` (4096) so injected recall can't blow the prompt budget.

#### `transcript.ts`
Pure transcript→auto-note logic shared by the relay `SessionEnd` hook (raw Claude Code JSONL entries) and core's visual-chat capture (SDK `SessionMessage[]`) — both normalize to the same `{type, message: {role, content}}` shape. `extractText(message)` pulls plain text out of a message, dropping `tool_use`/`tool_result`/`thinking` blocks so file dumps and diffs never reach memory. `stripInjectedBlocks(text)` removes `<system-reminder>`, `<editor-context>`, and the `<bismuth-memory>` envelope (plus a legacy bare `# Memories` block) before collection. `extractTurns(entries)` folds the entry stream into paired `Turn { user, claude }` blocks — one logical exchange (a real user prompt plus everything Claude said before the next real prompt) becomes one turn, so a multi-tool-round-trip exchange collapses to one block instead of fragmenting. `renderTurns(turns)` renders them as `## Turn N` / **You:** / **Claude:** markdown. `trimToBudget(turns, budget?)` enforces `MAX_BODY_CHARS` (12000) by dropping whole turns from the middle (never bisecting one). `CRON_PREFIX` marks a cron-fired session's prompt so cron noise never becomes a memory note. `buildAutoNoteBody(entries)` is the full pipeline — returns `null` for a cron-fired or trivial (`< MIN_BODY_CHARS`, 50) session, otherwise the rendered, budget-trimmed markdown body.

---

## `daemon/src/` — Daemon Runtime (`@bismuth/daemon`)

The per-vault daemon runtime, absorbed from claude-bot: cron scheduler, process manager, file watcher, the daemon-inbox pages runtime, and the machine/device/registry plumbing under `lib/`. Compiles to a standalone binary run by launchd/systemd, so it must outlive any single Tauri app instance and cannot import across into `@bismuth/core` — several `lib/` modules here are deliberate literal duplicates of a core module of the same purpose (visibility, `claudeWhich`, path resolution), kept in sync by comment convention rather than by import. `daemon/src/index.ts` is a barrel over `lib/config.ts` for any in-process consumer; the runnable entry is `daemon/src/daemon/index.ts`. There is no `daemon/src/memory/` — the memory graph lives entirely in the `memory` workspace (`@bismuth/memory`), which this workspace depends on.

### `daemon/` — Runtime Modules

#### `daemon/codexSession.ts`
The Codex daemon backend: runs a vault's brain on OpenAI's Codex CLI, spawned directly (`codex exec`) as a subprocess rather than via `@openai/codex-sdk` (whose own binary resolution has no PATH lookup and bundles a ~310MB platform binary — a bad fit for a daemon that itself compiles to a standalone binary). Selected only through `session.ts`'s `resolveDaemonBackend`, which refuses this backend outright for any vault with a hidden note, since Codex has no equivalent of Claude's managed-settings/sandbox/disallowed-tools visibility-gate triple. `buildCodexEnv()` builds the child environment; `sendCodexMessage()` spawns the CLI, pipes its NDJSON stdout, and returns a `BotResponse` mirroring `session.ts`'s Claude path (per-vault conversation continuity via a separate `.daemon/codex-session-id` file).

#### `daemon/cron.ts`
The cron scheduler — the daemon's largest module. `CronExpression`/`ScheduleCronJob`/`FileChangeCronJob`/`CronJob` — the two cron shapes (time-scheduled and file-change-triggered). `parseCronExpression()`/`shouldFire()` — cron-string parsing and time matching. `loadCronJobs(ctx)` reads a vault's `.daemon/crons`. `LastFiredEntry`/`loadLastFired()`/`nextLastFired()` — the one-entry-per-cron durable record `activityLog.ts`'s append-only log now supplements (the last-fired file only ever holds the latest outcome). `classifyFailure()` distinguishes `environment`/`timeout`/`job` failures. `isBackingOff()`/`backoffCooldownMs()`/`retryCooldownMs()` — exponential backoff for a repeatedly-failing cron. `shouldCatchUp()`/`shouldFireOnTick()` — whether a missed scheduled fire should catch up on the next tick. `cronMemoryInstruction(memoryDir)`/`buildCronPrompt(p)` — assembles the prompt a cron session receives, including the `{{changedSinceLastRun}}` incremental-scoping placeholder (see `incrementalCron.ts`). `fireFileChangeCron()` — fires a `FileChangeCronJob` when `fileWatch.ts` reports a matching batch. `recoverInterruptedCrons()` — on daemon restart, reconciles crons that were mid-run when the process died. `startCronScheduler()`/`stopCronScheduler()` — the per-tick (`CRON_CHECK_INTERVAL_MS`) loop fanning out over every enabled vault. `waitForRunningJobs()`/`runCronJob()` — the actual per-cron session dispatch, via `session.ts`'s `sendMessage`.

#### `daemon/defaultCrons.ts`
The default crons every vault's daemon ships with — bismuth's equivalent of claude-bot's `defaults/crons/`, embedded as string constants (not files) so they survive `bun build --compile` into the daemon binary. Seeded into `<vault>/.daemon/crons` by `seeds.ts`'s `reconcileSeeds` (non-clobbering — a user's edits are never overwritten). Both default crons (`dream`, `vault-review`) opt into `incremental: true` scoping (see `incrementalCron.ts`): the daemon diffs the relevant git ref before firing and skips the session entirely when nothing changed since the last successful run. `DEFAULT_CRONS` is the exported array of `DefaultCron` definitions.

#### `daemon/fileWatch.ts`
One filesystem watcher per vault brain (never one per cron) — a single recursive `fs.watch(ctx.root)` debounces raw events (`FILE_WATCH_DEBOUNCE_MS`, 2s) into a batch, then fans that batch out across every enabled `on: file-change` cron, matching each one's `watch` glob. `isDaemonInternalPath(relPath)` excludes `.daemon/**` unconditionally, so the daemon's own bookkeeping writes (last-fired files, logs, memory, session state) can never self-trigger a file-change cron. `matchesWatch()`, `createFileWatcher()`, `startFileWatch(ctx)`/`stopFileWatch(ctx)`/`stopAllFileWatches()`.

#### `daemon/incrementalCron.ts`
Pre-fire incremental scoping for crons with `incremental: true` frontmatter, moving the "what changed since last time" question OUT of the session (previously the model ran `bismuth checkpoint diff/advance` as a Bash step) and INTO the daemon, so a cron with nothing new to look at never spins up a session at all. `incrementalRefName(cronName)` — the `refs/bismuth/cron-<name>` ref namespace. `checkpointDirFor()` — resolves whether a cron's checkpoint lives against the vault root or the memory dir. `filterCronPaths()`/`formatChangedList()`/`decideIncrementalRun()`/`applyIncrementalPlaceholder()` are pure and unit-tested; `resolveIncrementalRun()`/`advanceIncrementalCheckpoint()` are the thin impure shell wiring them to `checkpointRef.ts`'s git calls.

#### `daemon/index.ts`
The runnable daemon entry point (compiled to the sidecar binary launchd/systemd runs). Wires together `seeds.ts`'s `reconcileSeeds`, the cron scheduler, `process.ts`'s process manager + triggers, and `fileWatch.ts`'s file watcher, driven by `lib/registry.ts`'s `loadEnabledVaults`/`loadAllVaults` and `lib/owner.ts`'s device heartbeat/ownership check.

#### `daemon/pages.ts`
The daemon-inbox execution runtime: fires the one approved action for a daemon-authored page (`core/src/daemonPages.ts` writes the page + its dynamic sidecar at `.daemon/pages/.state/<slug>.json`) once the user presses an "approve" button. Structurally identical to `process.ts`'s trigger processing — readdir the trigger dir, dotfilter, owner-gate, unlink-before-process — but a page fires a one-shot isolated session (never the persistent vault thread, never resumed). Completion is written here deterministically once the session settles; the LLM's own output is never trusted as a status signal. `processPageTriggers(ctx)` is the entry point.

#### `daemon/pagesGuide.ts`
The daemon-inbox authoring guide, seeded (non-clobbering, like `identity.md`) into `<vault>/.daemon/PAGES.md` so any page-authoring session can `Read` it and learn the page format — frontmatter schema, action shape, slug convention — with no hardcoded knowledge anywhere else. `PAGES_GUIDE` is the exported markdown string constant.

#### `daemon/process.ts`
The process manager: supervises long-running child processes (`.daemon/processes` definitions) across every enabled vault, keyed by `` `${ctx.root}::${name}` `` so two vaults can each run a same-named process without colliding. `ProcessDef`/`ProcessInfo`/`OrphanInfo`. `loadProcessDefs(ctx)` reads a vault's process definitions. `startProcesses(ctx)`/`stopProcesses(timeoutMs?)`/`stopProcessesForVault(ctx)` — lifecycle. `reapOrphans(ctx)` — recovers processes still running (PID files under `.pids/`) after a daemon restart. `startProcess()`/`stopProcess()` — single-process control. `listProcesses()`/`enableProcess()`/`disableProcess()`/`requestProcessRun()`. `processProcessTriggers(ctx)`/`startProcessTriggers(ctx)`/`stopProcessTriggers()`/`stopProcessTriggersForVault(ctx)` — the per-vault trigger-file polling loop (`TRIGGER_CHECK_INTERVAL_MS`) that lets a cron or the app request an ad-hoc process run.

#### `daemon/seeds.ts`
The single declarative registry of everything the daemon seeds into a vault's `.daemon` — the daemon's analog of core's `reconcileSettings`. `reconcileSeeds(ctx)` runs on every brain boot/enable: writes any seed that's entirely missing, and for seeds that opt into versioned refresh (currently the two default crons), upgrades an existing file in place IF it still byte-for-byte matches a known prior stock version (`PRIOR_SEED_HASHES`) — a user-edited file is never touched. This is how an already-set-up vault picks up an improved default cron automatically, without ever clobbering a hand-edited one. `Seed`, `seedsFor(ctx)`, `SeedReconcileResult`.

#### `daemon/session.ts`
The Claude backend for a vault's persistent daemon conversation, built on `@anthropic-ai/claude-agent-sdk`. `getSessionId()`/`DEFAULT_DAEMON_IDENTITY` — session continuity + the seeded default identity text. `BotResponse`/`composeBackendRefusalNote()`/`finalizeBotResponse()`. `resolveDaemonBackend()` — picks Claude vs. Codex per vault, refusing Codex outright for a vault with any hidden note (see `codexSession.ts`). `buildQueryOptions()` — assembles the SDK's `options.mcpServers` + `settingSources` explicitly (never inheriting `project`/`local` settings, since the session's `cwd` is the vault root and those scopes could auto-load a `.mcp.json` planted in user content and run it under `bypassPermissions`); `settings.daemon.inheritUserMcp` opts into also inheriting `user` scope. `sendMessage()` — the actual per-turn dispatch, threading in `lib/visibility.ts`'s deny-path building so the daemon's own tool calls stay honest about hidden vault content.

#### `daemon/sessionIds.ts`
The durable, append-only SET of session ids this vault's daemon has ever minted — `<vault>/.daemon/session-ids` — distinct from the single-value moving pointer at `.daemon/session-id` (which `saveSessionId` overwrites on every run and so only ever names the most recent one). Lets Bismuth answer "did the daemon mint this session?" for every daemon session, not just the latest — used to exclude daemon sessions from the chat page's session list. `core/src/daemon.ts`'s `readDaemonSessionIds()` parses this exact newline-delimited, oldest-first, deduped format — the two must stay in sync. `SESSION_IDS_CAP` (2000), `sessionIdsFile(ctx)`, `parseSessionIds()`/`formatSessionIds()`, `appendSessionId()`, `recordDaemonSessionId()`.

### `lib/` — Machine + Cross-Cutting Plumbing

#### `lib/activityLog.ts`
The daemon's append-only activity log — one JSON object per line (JSONL), one file per UTC day, under a vault's `logs/` dir. Exists because every cron outcome and process lifecycle event previously went only to `console.log` (wherever launchd pointed stdout) or to `.last-fired.json`, which keeps just the latest entry per cron and can't support a post-mortem on which class of failure drove a backoff. Never throws — logging is observability, not work, so a full disk or read-only vault must not take down a cron. `ActivityKind`/`ActivityOutcome`/`ActivityEvent`. `activityFileName(now)`, `formatActivityLine()`/`parseActivityLines()`, `expiredActivityFiles()`, `logActivity()`, `pruneActivityLogs()` (retention: `ACTIVITY_RETENTION_DAYS`, 30, from `lib/config.ts`).

#### `lib/agentsMd.ts`
A literal duplicate of `core/src/agentBackends/agentsMd.ts`'s managed-block writer, kept byte-identical (same start/end markers) so a vault touched by both a chat session driving Codex and the daemon's own Codex brain upserts the same `AGENTS.md` block rather than each maintaining a separate one. `AGENTS_MD_FILENAME`, `upsertAgentsMdBlock()` (pure), `writeAgentsMdBlock()`. Gated by `settings.codex.writeAgentsMd`.

#### `lib/atomicJson.ts`
The shared "write to a unique temp file, then `rename()` over the target" primitive — `rename()` is atomic on POSIX, so a concurrent reader only ever sees the old contents or the complete new ones, never a half-written file. Replaces five previously hand-rolled, subtly-different copies of this idiom across the workspace. `AtomicWriteOpts` (`ensureDir?`), `atomicWrite()`, `atomicWriteJson()`.

#### `lib/bismuthPaths.ts`
Resolves the machine-wide Bismuth tools the GUI app installs (`core/src/bismuthInstall.ts`'s `~/.bismuth/bin` + `~/.bismuth/docs`) so the daemon can hand its Claude sessions the bismuth MCP by absolute path — launchd's minimal PATH never resolves a bare `bismuth`. A deliberate literal duplicate of `bismuthInstall.ts`'s path constants, same standalone-binary rationale as `claudeWhich.ts`. `mcpBin()`, `cliBin()`, `docsDir()` — each `existsSync`-gated, degrading gracefully to no-MCP when the app never installed the tools. `ownerTokenDenyPath()`/`ownerTokenDenyPaths()`.

#### `lib/checkpointRef.ts`
The daemon's own copy of the git-ref "checkpoint" bookmark mechanism in `core/src/backup.ts` (`refs/bismuth/<ref>`) — duplicated rather than imported for the same standalone-binary reason as `visibility.ts`/`claudeWhich.ts`/`bismuthPaths.ts`. Uses plain `git` subprocesses rather than the `bismuth` CLI, since `git` is essentially always present while the CLI may not be installed. `ChangedFile`, `CheckpointDelta`, `checkpointRefSha()`, `commitTimeIso()`, `checkpointDelta()`, `advanceCheckpointRef()`. Consumed by `incrementalCron.ts`.

#### `lib/childEnv.ts` (+ `lib/childEnv.test.ts`)
Fixes Bug #105: a Finder-launched GUI app inherits launchd's bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), bakes it into the daemon's launchd plist, and the daemon then hands that same bare PATH to every cron worker it spawns — so a bare `bismuth checkpoint …` (or any other user CLI the model shells out to) fails "command not found", silently degrading incremental crons to a full re-survey every run. `extraBinDirs(home?)` returns the install dirs (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.bismuth/bin`, `~/.bun/bin`, `~/.local/bin`) that must be present regardless of the daemon's own minimal PATH. `augmentPath()` appends them. The `.test.ts` pins the bare-launchd-PATH recovery case directly.

#### `lib/claudeWhich.ts`
Locates the user's installed `claude` CLI for the Agent SDK — the compiled daemon binary doesn't bundle the SDK's native CLI and runs under a minimal PATH, so a session must be pointed at the real binary via `pathToClaudeCodeExecutable`. A copy of `core/src/claudeWhich.ts`, kept separate so the daemon workspace stays standalone. `nvmBinPaths(env?)` — resolves nvm-installed node/claude bin dirs (default-alias version preferred, newest-first fallback). `claudeLookupPath()`, `whichClaude()`, `whichBinary(name)` (generic — used by `codexSession.ts` too).

#### `lib/config.ts`
The path + constant registry for "one runtime, many brains": machine-level identity/state lives under `MACHINE_DIR` (`~/.bismuth/daemon`, or `BISMUTH_DAEMON_DIR`); each vault's brain lives under `<vault>/.daemon`, resolved into a `VaultContext` by `vaultPaths()`. `MACHINE_PID_FILE`, `MACHINE_LOGS_DIR`, `VAULTS_FILE` (frozen format: a plain array of path strings, since core and this binary version independently), `VAULTS_SEEN_FILE`. Timing/retry constants: `DEFAULT_CRON_TIMEOUT` (300s), `DEFAULT_DREAM_INTERVAL_MS`, `CRON_CHECK_INTERVAL_MS` (60s), `TRIGGER_CHECK_INTERVAL_MS` (5s), `SHUTDOWN_TIMEOUT_MS`/`SHUTDOWN_POLL_MS`, `RESTART_BACKOFF_RESET_MS`/`RESTART_BACKOFF_MAX_MS`, `ACTIVITY_RETENTION_DAYS` (30). `LAUNCHD_LABEL`, `SYSTEMD_SERVICE_NAME`.

#### `lib/device.ts`
Stable per-machine device identity. `getDeviceId(home?)` reads (or generates + atomically persists on first call) a UUID at `<home>/device-id`. `getDeviceLabel()` — a human-readable label (hostname-derived) for the multi-device owner UI.

#### `lib/frontmatter.ts`
A simple `---`-delimited frontmatter parser returning raw string key/value pairs plus the body — shared by the cron and process modules. (The memory graph has its own typed parser in `memory/src/graph.ts`.) `parseFrontmatter(content)`.

#### `lib/json.ts`
`parseJsonResponse<T>(response, fallbackRegex)` — parses a JSON response that may be wrapped in markdown code fences, falling back to regex extraction on a direct-parse failure; returns `null` on total failure. `today()` — re-exports `@bismuth/memory`'s `todayISO` under a shorter name.

#### `lib/owner.ts`
Multi-device ownership coordination. `devices.json` (every daemon upserts its own heartbeat entry each tick, even idle) and `owner.json` (absent = unclaimed, legacy single-device behavior) under `MACHINE_DIR`. `DeviceEntry`, `DevicesFile`, `Owner`, `DeviceListEntry`, `DeviceInfo`. `getOwner()`, `heartbeatDevice()`, `listDevices()`, `isOwner(home?)` (true when unclaimed, or when this device is the claimed owner), `deviceInfo()`, `setOwnerDevice()`.

#### `lib/platform.ts`
launchd (macOS) / systemd (Linux) service lifecycle. `daemonConfigPath()` — resolves the plist or `.service` path per platform. `generateDaemonConfig(opts)` — renders the config file contents. `installDaemon()`, `unloadDaemon()`, `EnsurePlan` (`'install'|'reload'|'skip'`) + `planEnsureInstalled()`, `reloadDaemon()`, `restartDaemon()`, `isDaemonProcess()`. `notify(title, message)` — OS-native desktop notification.

#### `lib/registry.ts`
The set of vault brains the daemon runs. Bismuth core writes the list of known vault roots to `VAULTS_FILE`; each vault opts in via `settings.daemon.enabled`. The cron/process loops call `loadEnabledVaults()` every tick, so toggling a vault's daemon setting takes effect without a daemon restart — no separate enable/disable RPC. `knownVaultRoots()` accepts both the canonical plain-string-array shape and a legacy `{path,...}` object shape (migrated back to strings by core on its next boot). `VAULT_SEEN_REFRESH_MS` (1 hour), `stampVaultsSeen()`, `resetVaultsSeenThrottle()`, `refreshVaultsSeen()`, `loadEnabledVaults()`, `loadAllVaults()`.

#### `lib/visibility.ts` (+ `lib/visibility.test.ts`)
The daemon's own ported copy of `core/src/visibility.ts`'s per-file/folder AI-visibility resolution — deliberately duplicated (not imported) since the daemon workspace has no dependency on `@bismuth/core`, only on `@bismuth/memory`. An honesty boundary, not a security boundary: restricts the daemon's own tool calls, never the vault owner. `Visibility`/`FileVisibility`, `resolveVisibility()`/`resolveFolderVisibility()`, `isVisibleToDaemon()`, `VisibilityUndeterminedError`, `MAX_WALK_ENTRIES` (200,000) + `WalkLimits` (discovery-walk bounds). `DenyEntry`/`DenyPlan`, `resolveDenyPlan()`, `buildDenyPaths()`. `buildManagedSettingsDeny(entries)` — the dual-form (relative + absolute) deny list fix, since a model's Read tool call may report either form. `absDenyPaths()`, `sandboxDenyRead()`, `buildSandboxDenyPaths()`, `sandboxFailIfUnavailable()`. The `.test.ts` mirrors `core/test/visibility.test.ts` for this ported copy.

#### `lib/writeQueue.ts`
Per-file serial write queue, keyed by absolute path, so two concurrent saves to the same sidecar can't race on a shared temp filename or clobber each other's load-modify-save cycle. Extracted from `cron.ts` so `activityLog.ts` shares the one implementation instead of growing a second, subtly different copy. `enqueueWrite<T>(file, fn)`.

---

## `skills/` — Agent Skill Guides

Not a Bun workspace — no `package.json`, nothing to `bun install` or import. A plain directory of markdown guides an AI agent reads before doing a specific task, in the Claude Code skill shape (a `SKILL.md` with YAML `name`/`description` frontmatter, plus optional `references/*.md`), but reachable by every agent backend Bismuth supports, not just Claude Code.

### `authoring-bismuth-bases/SKILL.md`
The one skill this repo ships. Frontmatter `description` is what an agent's skill-discovery step matches against ("Use when creating, editing, or debugging a Bismuth base..."). Body: the base/`type: base` model, a lookup table mapping "what you want to show" to one of the 12 view kinds, a 4-step workflow (pick a kind → read `references/<kind>.md` → create the note → verify by reading it back), and cross-cutting gotchas that apply to every kind (`source:` string-vs-object coercion and its silent-fallback-to-whole-vault footgun, `from:` composing an upstream base's own `source` recursively rather than intersecting static rows, and that the only embedded block is ` ```query ` — never ` ```base `/` ```view `/` ```tasks `).

### `authoring-bismuth-bases/references/<kind>.md`
One file per Bases view kind — `bar.md`, `bullets.md`, `calendar.md`, `cards.md`, `flashcards.md`, `heatmap.md`, `kanban.md`, `line.md`, `list.md`, `map.md`, `stat.md`, `table.md` (12 total, matching `ViewType` in `core/src/bases/types.ts`). `SKILL.md` tells the agent to read the matching one — its exact config keys, a working frontmatter example, its specific failure modes — before writing frontmatter for that kind, rather than guessing a key name from memory or from another kind's shape.

### How agents reach it — three adapters, one skill
Bismuth ships nine chat/agent backends (`docs/chat/backends.md`), and only Claude Code has a native skills mechanism (`~/.claude/skills/`, auto-discovered). Three separate delivery paths make the same guide reachable from all of them:
- **`bismuth_skill` MCP tool** — `mcp/src/skills.ts`'s `listSkills(root)`/`readSkill(root, name, reference?)`, registered as the `bismuth_skill` tool in `mcp/src/server.ts`. The one surface all nine backends share, since every backend that speaks MCP can call it. Omit `name` to list skills with descriptions; pass `{name, reference?}` to read `SKILL.md` or one `references/<kind>.md` file. Path-traversal-rejecting (`resolveWithin`), mirroring `mcp/src/docs.ts`'s `readDoc` on purpose — same repo, same pattern.
- **`~/.claude/skills/` symlink at install** — `core/src/bismuthInstall.ts`. `stageSkills(src, bismuthHome)` copies the repo's `skills/` into `~/.bismuth/skills` (alongside `docs/` and the `bin/` binaries) during `ensureBismuthInstalled()`; `linkSkillToClaudeCode(bismuthHome, claudeSkillsDir)` then symlinks `~/.claude/skills/authoring-bismuth-bases` → `~/.bismuth/skills/authoring-bismuth-bases` (never clobbering a foreign entry already at that path) so Claude Code's own skill auto-loading picks it up with no MCP round-trip. `SKILL_ID = "authoring-bismuth-bases"` names the one skill this install step knows about.
- **Codex's `AGENTS.md` managed block** — `core/src/chatProviders/codex/driver.ts`'s `CODEX_AGENTS_MD_CONTENT`, written via `core/src/agentBackends/agentsMd.ts`'s `writeAgentsMdBlock(cwd, content)`, opt-in per `core/src/settings.ts`'s `readCodexOptIns()` (`settings.codex.writeAgentsMd`). Codex has no skills mechanism of its own and instead reads a project-root `AGENTS.md` as its persistent-context channel; the managed block (delimited by `<!-- bismuth:managed:start -->`/`...:end -->` markers so a user's own `AGENTS.md` content is preserved) carries a one-line pointer telling Codex to call the `bismuth_skill` MCP tool before authoring a base.

---

## Where to Add Things

| What you're adding | Where |
|---|---|
| New HTTP endpoint (read) | `routes` table in `core/src/server.ts` |
| New HTTP endpoint (vault mutation) | `mutatingRoutes` table in `core/src/server.ts` |
| New graph node/edge kind | `core/src/graph.ts`, then the builder, then `App.tsx` mode filter |
| New setting | `core/src/schema/settingsSchema.ts` → `app/src/settings.ts` → consumer |
| CSS-driven setting | One entry in `settingsSchema.ts` + one line in `app/src/settingsCssVars.ts` + `var()` in CSS |
| New command | `core/src/commands.ts` `COMMAND_CATALOG` + `app/src/commands.ts` `bindCommands` |
| New keybinding | `core/src/keybindings.ts` `KEYBINDING_CATALOG` + handler reads `matchesKeybinding` |
| New Bases view kind | `core/src/bases/types.ts` `ViewType`, renderer in `app/src/bases/`, `BaseView.tsx` switch |
| New Bases function | `core/src/bases/functions.ts` dispatch, `query.ts` aggregation, test in `core/test/bases/query.test.ts` |
| New SRS scheduler variant | Extend `core/src/srs/scheduler.ts`, expose config in `settingsSchema.ts`, thread into `applyReview` |
| New graph source type | Use `buildGraphFromNotes` from `core/src/graphBuilder.ts` |
| New file type supported in panes | `app/src/tabIds.ts` (label/icon), `app/src/PaneContent.tsx` (routing) |
| New/changed `app/src/` component | Add or update its colocated `<Name>.stories.tsx`; shared fixtures in `app/src/ui/_*` (see `app/.storybook/`) |
| New App.tsx shell chrome | Add to `app/src/shell/` as a presentational, slot-driven component (props only, no signal/fetch), wire it into `AppFrame.tsx`/`App.tsx`, give it a `.module.css` + `.stories.tsx` |
| Verify a visual change | `bun run visual` (`bench/checkChanged.ts`, everyday) or `bun run visual:baseline` (`bench/cssBaseline.ts`, only after a deliberate restyle — re-records) |

Source: `CLAUDE.md`, `core/src/server.ts`, `core/src/graph.ts`, `core/src/engine.ts`, `core/src/vault.ts`, `core/src/memory.ts`, `core/src/agents.ts`, `core/src/graphBuilder.ts`, `core/src/layout.ts`, `core/src/layout-cache.ts`, `core/src/sse.ts`, `core/src/asyncCache.ts`, `core/src/changeClassifier.ts`, `core/src/relay.ts`, `core/src/daemon.ts`, `core/src/daemonGraph.ts`, `core/src/daemonViz.ts`, `core/src/daemonState.ts`, `core/src/daemonInstall.ts`, `core/src/backup.ts`, `core/src/terminal.ts`, `core/src/files.ts`, `core/src/fileAccess.ts`, `core/src/error.ts`, `core/src/settings.ts`, `core/src/schema/settingsSchema.ts`, `core/src/community.ts`, `core/src/basesData.ts`, `core/src/commands.ts`, `core/src/keybindings.ts`, `core/src/bases/types.ts`, `core/src/bases/sourceSpec.ts`, `core/src/srs/scheduler.ts`, `core/src/drawing/model.ts`, `app/src/App.tsx`, `app/src/panes.ts`, `app/src/tabIds.ts`, `app/src/api.ts`, `app/src/serverVersion.ts`, `app/src/settings.ts`, `app/src/settingsCssVars.ts`, `app/src/themes.ts`, `app/src/commands.ts`, `app/src/graph/AsciiGraphRenderer.ts`, `app/src/graph/graphRenderer.ts`, `app/src/bases/BaseView.tsx`, `app/src/bases/rowCache.ts`, `app/src/bases/flashcardsQueue.ts`, `app/src/export/formats.ts`, `app/src/export/exporters.ts`, `app/src/mobile/bootMobile.ts`, `relay/CLAUDE.md`, `relay/lib/report.ts`, `relay/hooks/hooks.json`, `relay/bin/session-end-hook.ts`, `relay/bin/wrap.ts`, `relay/shim/claude`, `relay/shim/agent-shim`, `cli/src/index.ts`, `cli/src/commands/note.ts`, `cli/src/commands/api.ts`, `package.json`, `core/package.json`, `app/package.json`, `cli/package.json`, `skills/authoring-bismuth-bases/SKILL.md`, `mcp/src/skills.ts`, `mcp/src/server.ts`, `core/src/bismuthInstall.ts`, `core/src/agentBackends/agentsMd.ts`, `core/src/chatProviders/codex/driver.ts`, `app/.storybook/main.ts`, `app/.storybook/preview.ts`, `app/src/ui/_baseFixtures.tsx`, `app/src/ui/_fakeTransport.ts`, `app/src/ui/_calendarFixtures.ts`, `app/src/ui/_graphFixtures.ts`, `app/src/ui/_daemonFixtures.ts`, `app/src/ui/_cmHarness.tsx`, `app/src/ui/_storyKit.tsx`, `app/src/shell/AppFrame.tsx`, `app/src/shell/TopStrip.tsx`, `app/src/shell/Sidebar.tsx`, `app/src/shell/EditorPane.tsx`, `app/src/shell/TabRail.tsx`, `app/src/shell/TabRailRow.tsx`, `app/src/shell/CommandButton.tsx`, `app/src/shell/DragGhost.tsx`, `app/src/shell/GraphFloater.tsx`, `app/src/shell/PaneOverlay.tsx`, `app/src/shell/StatusBar.tsx`, `app/src/shell/InboxIndicator.tsx`, `app/src/shell/WindowControls.tsx`, `app/src/PaneLeaf.tsx`, `app/src/PaneHeader.tsx`, `app/src/PaneDropZone.tsx`, `app/src/ui/Text.tsx`, `app/src/ui/Heading.tsx`, `app/src/ui/Label.tsx`, `app/src/ui/Badge.tsx`, `app/src/ui/uiLint.ts`, `app/src/PreviewView.tsx`, `app/src/preview/previewKind.ts`, `app/scripts/dev.ts`, `app/scripts/devVault.ts`, `app/src/App.css`, `bench/chromeSession.ts`, `bench/affected.ts`, `bench/checkChanged.ts`, `bench/invariants.ts`, `bench/cssBaseline.ts`, `bench/storyAudit.ts`, `bench/moduleClassCheck.ts`, `bench/probeStory.ts`, `bench/templateDiff.ts`, `bench/layoutquality.ts`, `bench/visual.ts`, `core/src/render/chromeSession.ts`, `core/src/render/htmlRaster.ts`, `core/src/theme/tokens.ts`, `core/src/gcal/index.ts`, `core/src/gcal/sync.ts`, `core/src/gcal/manifest.ts`, `core/src/gcal/colors.ts`, `core/src/bases/properties.ts`, `core/src/bases/yamlComment.ts`, `core/src/brainCompose.ts`, `core/src/linlog.ts`, `core/src/communitySignificance.ts`, `core/src/graphBlock.ts`, `core/src/concurrency.ts`, `core/src/heic.ts`, `core/src/tmpFiles.ts`, `core/src/memoryRef.ts`, `core/src/fsPaths.ts`, `core/src/ownerToken.ts`, `core/src/visibility.ts`, `core/src/visibilityCliGate.ts`, `core/src/uiControl.ts`, `core/src/searchPrompt.ts`, `core/src/taskParse.ts`, `core/src/taskReorder.ts`, `core/src/daemonActivity.ts`, `core/src/daemonPages.ts`, `core/src/calendar.ts`, `core/src/newNoteTemplate.ts`, `core/src/selfUpdate.ts`, `core/src/runRegistry.ts`, `core/src/tempPath.ts`, `core/src/claudeWhich.ts`, `app/src/color/parseHex.ts`, `app/src/export/inkHtml.ts`, `app/src/export/baseView.ts`, `app/src/export/exportTheme.ts`, `app/src/export/resolvePalette.ts`, `app/src/oneShotPathChannel.ts`, `app/src/chatKeyedStore.ts`, `memory/src/index.ts`, `memory/src/graph.ts`, `memory/src/recall.ts`, `memory/src/transcript.ts`, `daemon/src/index.ts`, `daemon/src/daemon/index.ts`, `daemon/src/daemon/cron.ts`, `daemon/src/daemon/seeds.ts`, `daemon/src/lib/config.ts`, `daemon/src/lib/visibility.ts`, `daemon/src/lib/activityLog.ts`
