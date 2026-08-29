# Codebase Map

This document is a module-by-module navigation guide for the Bismuth monorepo, for anyone implementing a feature, tracking down where a piece of behavior lives, or getting oriented in an unfamiliar part of the code. It covers every workspace, every `core/src` and `app/src` module (including subdirectories), the `cli/src` command layer, and the `relay` plugin. For each module it explains what the module does, what it exports, what it depends on, and where to make changes when adding new features. Use this alongside the architecture overview in `CLAUDE.md`.

**What's in here**, in reading order:
- **Workspace Layout** — the seven Bun workspaces and how they depend on each other
- **`core/`** — the backend/pure-logic library, grouped by responsibility: HTTP server, graph construction, layout, file system, knowledge parsing, settings, search, Bases, SRS, tasks, daemon integration, relay registry, terminal, plus the `drawing/` subsystem and `core/test/`
- **`app/src/`** — the Solid.js frontend, grouped by feature area: shell/panes, graph rendering, editor, file tree, Bases views, calendar, drawing, sheets, export, palette, terminal, icons, drag-and-drop, UI primitives, and mobile
- **`app/.storybook/`** — the Storybook 9 component catalog for `app/src/`: config, the runtime theme/transport seams in `preview.ts`, and the shared fixture files
- **`cli/src/`** — the `bismuth` binary's command groups
- **`relay/`** — the terminal-tab session relay plugin
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

---

### Layout

#### `layout.ts`
Pure, DOM-free layout computation. `computeLayoutAsync(input, opts?)` — runs PivotMDS (Brandes & Pich, O(k·(V+E))) to get a global seed, then refines with a d3-force-3d simulation. `LayoutOptions`: `dimensions` (2 or 3), `numPivots` (default 50), `refineTicks` (default 150), `repulsion`, `linkDistance`, `centering`, `initialPositions` (skip PivotMDS and warm-start from these coordinates). The force constants (`COLLIDE_RATIO = 1.25`, `COLLIDE_ITERATIONS = 6`, `MANYBODY_THETA = 1.5`) tune the backend's own settle only — the renderer (`graph/AsciiGraphRenderer.ts`, via `graph/respace.ts`'s `scaleToSpacing()`) deliberately does **not** mirror them; it measures the settled output's own spacing and rescales to a fixed target instead of copying this module's constants (see `respace.ts`'s entry below). Also runs in a browser Worker.

#### `layout-cache.ts`
Two-tier layout cache (in-memory Map + JSON file in `~/.bismuth/layout-cache`, durable; override `BISMUTH_LAYOUT_CACHE_DIR`). `attachLayout(graph, vaultKey)` — computes both 3D and 2D layouts and attaches `position`/`position2d` to every node. 2D layout is seeded from flattened 3D so the morph flattens in place rather than scrambling. Peek-attaches brain-view layouts when already cached; otherwise they're computed lazily on `GET /graph/views`. `computeViewLayouts(graph, vaultKey)` — computes 2nd/3rd subgraph layouts on demand. `graphSig(graph, vaultKey)` — SHA-1 content hash of sorted node ids + edge endpoints. Cache version `v20` bakes current constants (LinLog energy model + degree-proportional repulsion default); bump `CACHE_VERSION` if force constants or cache shape change.

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

---

### Search and Replace

#### `search.ts`
`searchVault(vault, query, opts)` — MiniSearch-backed full-text ranking + `findMatches` line-snippet extraction. `SearchOpts`: `caseSensitive`, `wholeWord`, `regex`. `invalidateSearchIndex()` — called by `mutatingHandler` after vault mutations. `buildMatcher(query, opts)` — exported pure helper for snippet extraction.

#### `replace.ts`
`replaceInVault(vault, query, replacement, opts)` — batch find-and-replace across all vault files. Returns `{ path, count }[]`.

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
`parseQueryBlock(text)` — parses a flat ` ```query ` block body into a `QueryBlock`. Used by `editor/queryBlock.ts` in the frontend.

#### `bases/rows.ts`
Row-level utilities and aggregation helpers.

#### `bases/table.ts`
`parseMarkdownTable(content)` / `serializeMarkdownTable(rows, cols)` — GFM pipe-table parsing and serialization used for inline base rows in `type: base` files.

#### `bases/rowOps.ts`
`upsertRow(vault, path, row, index?)` / `deleteRow(vault, path, index)` / `reorderRow(vault, path, from, to)` — server-side rewrite of the markdown table in a base file. Called by `POST /row/update`, `POST /row/delete`, `POST /row/reorder`.

#### `bases/taskRow.ts`
`taskToRow(task)` / `filterTaskRows(rows, filter)` — projects a `Task` into a `Row` for the bases pipeline.

#### `bases/tasksData.ts`
`buildTaskRows(vault, from?)` — collects all tasks from vault files (optionally scoped to a subset) and converts to `Row[]` via `taskToRow`. Called by `server.ts` to build `cachedTasks`.

#### `bases/values.ts`
Value coercion and display helpers for the query/filter pipeline.

#### `bases/recurrence.ts`
Recurrence rule parsing and expansion for calendar events. `parseRecurrence(text)` / `expandRecurrence(rule, start, rangeStart, rangeEnd)`.

#### `bases/chart.ts`
Chart data aggregation for bar/line/stat/heatmap views. Used by the frontend chart view components.

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

#### `tasks-query.ts`
Obsidian-Tasks-compatible DSL parser + executor. `parseTaskQuery(text)` — error-collecting parser. `filterTasks(tasks, query)` — applies a parsed query; supports relative dates, AND/OR combinators, sort.

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

### Terminal

#### `terminal.ts`
PTY session manager. `createTerminalSession(cols, rows, relayUrl, cfg)` — spawns a PTY via `bun-pty`, builds its env via `buildPtyEnv`, returns a `Session { id, pty, cols, rows }`. `buildPtyEnv(p: PtyEnvParams)` — pure function that constructs the child env: strips undefined values, sets `TERM=xterm-256color`, suppresses oh-my-zsh update prompts, injects `CLAUDE_RELAY_URL`/`CLAUDE_TERMINAL_ID`, and if `claude` is resolvable: sets `BISMUTH_REAL_CLAUDE`/`BISMUTH_RELAY_PLUGIN`, sets `ZDOTDIR` for zsh (defines a `claude` function immune to PATH reordering), and prepends the shim dir to `PATH` for non-zsh shells. `killSession(id)`, `resizeSession(id, cols, rows)`, `getSession(id)`, `listSessionIds()`.

`REAL_CLAUDE` is resolved once at module load using an augmented PATH (adds Homebrew, ~/.bun/bin, ~/.local/bin, and nvm node bins) to handle GUI apps launched with minimal PATH and `claude` installed via Homebrew or nvm.

---

### Other Backend Modules

#### `dailyNote.ts`
`dailyNotePath(config, date?)` — resolves the vault-relative path for a daily note (date-formatted filename in configured folder). `dailyNoteContent(config, date?)` — generates the initial note content from a template if configured.

#### `templates.ts`
`expandTemplate(raw, ctx)` — expands template variables (`{{title}}`, `{{date}}`, `{{time}}`, etc.) in a template note. Returns `{ text }`.

#### `dates.ts`
`todayISO()`, `addDaysISO(date, days)`, `parseISO(s)`, `formatISO(d)`, `daysUntil(date)`. Shared by tasks, SRS, calendar, and the CLI.

#### `basesData.ts`
`buildVaultRows(root)` — builds the vault-wide `Row[]` feed (one per `.md` file, with `FileMeta` + frontmatter) using `getFileAccess()`. This is the unscoped vault row cache (`cachedRows` in `server.ts`).

#### `localBackend.ts`
`createLocalBackend(opts)` — in-process server for mobile (iPad) where no Bun process can run. Implements the same route surface as `server.ts` but runs entirely in-WebView. See `app/src/mobile/`.

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
Sentinel content ids (all start with `::`): `GRAPH_TAB = "::graph"`, `EMPTY_PANE = "::empty"`, and the prefixed ids `TERMINAL_PREFIX = "::term:"`, `EXPORT_PREFIX = "::export:"`, plus the `::flashcards:` prefix (consistent with the sentinel list in `CLAUDE.md`). `contentLabel(content, terminalIndex?)` and `contentIcon(content)` derive display strings/icons from content ids; a plain file path routed to the read-only `PreviewView` (via `previewKind()`, see `preview/`) gets its label/icon from there too. There is **no `::search` sentinel** — search is the unified Cmd+O switcher takeover (`palette/SwitcherBar.tsx`); persisted `::search` tabs from older builds are migrated to `::graph` on restore (`LEGACY_CONTENT_IDS` in `panes.ts`).

#### `PaneTree.tsx`
Renders the binary pane tree; manages pane drag-and-drop via `dnd/viewDrag.ts`. Handles split/close/resize interactions. `PaneLeaf` (one pane's own content + focus/right-click reporting + HTML5-drag-to-split + view-drag drop target) was promoted out of this file into its own `PaneLeaf.tsx`, which in turn delegates its mini view-bar breadcrumb to `PaneHeader.tsx` and its split/chat-reference drop affordances to `PaneDropZone.tsx` — `PaneTree.tsx` itself is now just the tree walk. All four share `PaneTree.module.css` (not one module apiece — `.pane-leaf.focused .pane-header` and similar rules cross the file boundaries).

#### `PaneContent.tsx`
Routes a pane content id to the correct view component. Note path → `FileView` (or the lighter read-only `PreviewView` for a non-note file whose `previewKind()` matches — images/PDFs/code/text; see `preview/`); `*.sheet` → `SheetView`; `*.draw` → `DrawingPage`; `::graph` → (forwarded to `App`'s `renderGraph` prop); `::term:*` → `TerminalTab`; `::export:*` → `ExportView`; `.settings` → `Editor`; `type: base` files → `BaseView`. Unknown/legacy sentinels fall back to `EmptyPane` (there is no `::search` route — see `tabIds.ts`).

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
The always-mounted terminal/chat overlay shell, positioned over a pane's `data-terminal-host`/`data-chat-host` placeholder so a PTY or chat WebSocket survives tab/pane switches without remounting. One component branches on `props.kind` for the two nearly-identical original `App.tsx` `<For>` bodies.

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
Shared graph "atmosphere" overlay — the iridescent cluster-glow + depth vignette layered over the graph canvas. Extracted so `GraphView` and the first-run intro graph share one source instead of duplicating the glow divs/wiring. Rendered as a sibling after the renderer's canvas; structurally typed against any renderer exposing `setGlowCallback()` (fed by `AsciiGraphRenderer`'s per-frame top-3 community centroid projections, via `densityField.ts`). Styled by `graphAtmosphere.css`.

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
Task metadata autocomplete in `- [ ]` lines. Keywords expand to emoji signifiers (e.g. `due` → `📅`). Tested.

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
`EventChip.tsx`, `EventModal.tsx`, `RecurrenceDialog.tsx`, `CategoryPanel.tsx`, `Toolbar.tsx` — calendar UI sub-components.

#### `calendar/components/views/`
`Month.tsx`, `Week.tsx`, `ThreeDay.tsx`, `Day.tsx`, `TimeGrid.tsx` — per-view layout renderers.

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

### Export

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

#### `export/htmlTemplate.ts`
HTML export template renderer for notes. Tested.

#### `export/htmlToPdf.ts`
Client-side HTML → PDF via `jspdf`. Used for note and sheet PDF export.

#### `export/sheetHtml.ts`
Sheet → HTML serialization. Tested.

#### `export/rowsHtml.ts`
Base rows → HTML table serialization. Tested.

#### `export/baseTable.ts`
Base view → Markdown table serialization. Tested.

#### `export/mdTable.ts`
Markdown table utilities. Tested.

#### `export/download.ts`
`downloadBlob(blob, filename)` — triggers a browser download.

#### `export/drawingRaster.ts`
Client-side drawing → PNG via Canvas 2D.

#### `export/types.ts`
`ExportFormat = "html" | "pdf" | "md" | "png" | "csv"`; `RenderMode = "visual" | "data"`.

#### `ExportView.tsx`
Export options pane UI (format picker, preview, download button).

---

### Daemon UI

#### `DaemonList.tsx`
Sidebar panel shown in daemon graph mode. Lists crons and processes with enable/disable/run right-click actions.

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
Pure AI-escalation logic: `isNaturalLanguageQuery` (3+ words), `shouldOfferAiEscalation`, and the generation-guarded `switcherAiReducer` (idle/loading/results/error — a keystroke supersedes an in-flight turn). Tested in `switcherAi.test.ts`.

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

### Icons

#### `icons/Icon.tsx`
`<Icon name="..." size={...} />` — renders a Lucide icon by name. Uses the icon registry.

#### `icons/registry.ts` + `icons/registry-core.ts`
Icon registry: maps icon names to SVG path data. `iconNames()` returns all registered names. `registry-core.ts` seeds the initial set; `registry.ts` is the full runtime registry. Tested.

#### `icons/IconPicker.tsx`
Icon picker UI (used by folder icon assignment in the file tree).

#### `icons/iconElement.tsx` + `icons/iconMarkup.ts`
Helpers for rendering icons as DOM elements and raw SVG markup (used in tooltips and exports).

#### `icons/seedNames.ts`
Exports the list of icon names available at build time.

---

### Drag and Drop

#### `dnd/geometry.ts`
Pure drop-zone geometry helpers: `computeDropZone(rect, point)` determines which zone (left/right/top/bottom/center) a drop target point falls in. Tested.

#### `dnd/viewDrag.ts`
`createViewDrag(handlers)` — wires pointer event listeners for pane drag-and-drop. Returns `DragDescriptor` and `DropTarget` types.

---

### UI Primitives (`ui/`)

Shared design-system components. All import `ui.css` for shared button/input chrome; `export default`, `FC`/`Component`-typed, most now with a colocated `<Name>.module.css`.

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
| `ViewBar.tsx` | Horizontal toolbar bar (`Crumb`, `ViewBarSpacer`, `VBtn`) |
| `SearchBar.tsx` | Search input with clear button |
| `SegmentedToggle.tsx` | Multi-option toggle |
| `TextInput.tsx` | Styled text input |
| `Select.tsx` | Styled select dropdown |
| `Field.tsx` | Label + input field wrapper |
| `EmptyState.tsx` | Empty/loading placeholder |
| `Modal.tsx` | Modal dialog wrapper |
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
Read-only PREVIEW tab for non-note files (images, PDFs, code/text) — the default open for a path `previewKind()` classifies, a lighter alternative to the `.draw` markup surface. Images/PDFs expose an "Annotate" button handing off to `.draw` (`::annotate:`); every kind exposes "Open in default app"/"Reveal" (Tauri) for binary formats it can't render. Handles its own Cmd/Ctrl+F find per content kind on a capture-phase keydown (App.tsx has no global find handler). Routing lives in `PaneContent.tsx`; classification in `preview/previewKind.ts`.

#### `preview/` (`assetUrl.ts`, `findMatches.ts`, `previewKind.ts`)
Pure helpers behind `PreviewView.tsx`, each tested. `previewKind(path)` classifies a path into a preview kind (image/pdf/code/text/unsupported) and backs `isPreviewPath()`/`tabIds.ts`'s label+icon derivation. `assetUrl.ts` builds the backend URL for a binary asset. `findMatches.ts` is the pure match-finding logic behind the in-preview find bar.

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

#### `searchResults.tsx`
Shared `.sresult` result-card renderer (`SearchResultRows` + `splitPath`) for the switcher's keyword content matches and Bismuth AI results — file header + optional AI rationale + matched snippets, with keyboard-selection support. Styles in `searchResults.css`. (The former standalone `SearchView.tsx` Search tab was removed when search unified into the Cmd+O switcher; vault-wide find-and-replace remains via the CLI / `POST /replace`.)

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
- `_cmHarness.tsx` — mounts a minimal CodeMirror 6 `EditorView` (history + selection drawing + default/history keymap + line wrapping, nothing note-specific) for components that take a live `EditorView` as a prop (e.g. `editor/ink/InkOverlay.tsx`) without pulling in the full `Editor.tsx` note-editing stack.

#### Coverage
427 story exports across 120 component story files, spanning the `ui/` primitives (including `Text`/`Heading`/`Label`/`Badge` and the `ascii/` set), all 12 Bases view renderers (`bases/BarView.stories.tsx` through `bases/TableView.stories.tsx`), the calendar views, the `shell/` components (`AppFrame`, `TopStrip`, `Sidebar`, `TabRail`/`TabRailRow`, `EditorPane`, `GraphFloater`, `PaneOverlay`, `StatusBar`, `InboxIndicator`, `CommandButton`, `DragGhost`, `WindowControls`) and the promoted pane components (`PaneLeaf`, `PaneHeader`, `PaneDropZone`, `PaneTree`), app-root chrome and modals (`ContextMenu`, `Toast`, `NoteTitle`, the daemon/gcal modals, `InboxView`/`InboxPageView`, …), `PreviewView`, drawing, graph (`GraphView`, `graph/EmbeddedGraph`), editor surfaces, and `ChatView`.

---

## `app/scripts/` — Dev, Build, and Packaging Scripts

#### `dev.ts`
The one dev entry point, in two flavours: `bun run dev` (root `package.json` script `dev`, wired from `app/package.json`) runs core server + Vite and opens `http://localhost:1420`; `bun run dev:app` runs the same two plus the Tauri window. Both **default to a generated example vault** (`devVault.ts`) so a fresh clone runs with no setup — export `BISMUTH_VAULT`/`BISMUTH_MEMORY` to point at a real vault instead, overriding the default. Mints one random owner token (`core/src/ownerToken.ts`) and threads it to both halves (`BISMUTH_OWNER_TOKEN` to the core server, `VITE_OWNER_TOKEN` to Vite, baked into the bundle and read by `api.ts`'s `resolveOwnerToken`) so dev requests present as the vault's owner rather than a filtered non-owner channel — without it every content route 403s or silently filters the moment a vault marks anything `visibility: chat-only`/`hidden`. `--app` runs Tauri in-process (via `concurrently`) rather than through `tauri.conf.json`'s `beforeDevCommand`, which would otherwise start a second core+Vite pair and collide on `:4321`/`:1420`.

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

Root-level, no `package.json` — invoked via `bun bench/<file>.ts` directly or through the four root `package.json` scripts (`visual`, `visual:all`, `visual:affected`, `visual:baseline`). Every headless-Chrome tool here shares one launcher (`chromeSession.ts`) because a browser-automation tab that is not the foreground window reports `document.visibilityState === "hidden"`, and `GraphView` gates its rAF loop on exactly that — so a backgrounded tab's canvas samples 0% inked, indistinguishable from a broken renderer; the shared launcher's three `--disable-*background*` Chrome flags are what make any of this runnable unattended.

#### `chromeSession.ts`
The one place that launches headless Chrome and tears it down: binary path, flag set, port poll, CDP WebSocket + request/response plumbing, and a teardown that runs on every exit path. Written after three tools each grew their own copy of launch+teardown and each got the teardown wrong a different way (an undeleted profile dir, a `rmSync` losing a race against a still-writing Chrome, a swallowed `ENOTEMPTY`).

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

### `commands/settings.ts`
`settings get`, `settings set`, `settings schema`, `folder-icon` — read/write `.settings` keys + the per-folder icon map.

### `commands/daemon.ts`
`daemon status`, `daemon devices`, `daemon owner`, `daemon install`, `daemon setup`, `daemon update`, `daemon graph`, `daemon cron toggle`, `daemon cron run`, `daemon process toggle` — read/write the daemon's machine-level state (`~/.bismuth/daemon`) + a vault's `.daemon` crons/processes (no `--vault`).

### `commands/draw.ts`
`render` — render a `.draw` file to PNG (or `--pdf`) headless (filesystem path, no `--vault`).

### `commands/serve.ts`
`serve` (start the backend server, `createServer`), `backup` (git-snapshot the vault).

### `commands/export.ts`
`export` — export a note/base/sheet/drawing to `md|html|png|pdf` (pdf of notes/bases/sheets is browser-only).

### `commands/api.ts`
`api <GET|POST|PUT> <path>` — raw HTTP call to any core API endpoint on a running server, for capabilities that live only in server memory (e.g. `bismuth api POST /relay/session` against the relay registry). The standalone `agent-graph` command (and the `GET /agent-graph` route it called) was removed along with the agents graph in commit `a6687c0`.

### `commands/install.ts`
`install` (machine-wide CLI + MCP install, idempotent + version-gated), `uninstall` — remove the symlink, global MCP registration, and `~/.bismuth`.

### `commands/checkpoint.ts`
`checkpoint diff`, `checkpoint advance`, `checkpoint ref` — per-consumer git bookmarks (`refs/bismuth/<name>`) over any git dir via `--dir`, for "what changed since I last ran" jobs.

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
| New graph source type | Use `buildGraphFromNotes` from `core/src/graphBuilder.ts` |
| New file type supported in panes | `app/src/tabIds.ts` (label/icon), `app/src/PaneContent.tsx` (routing) |
| New/changed `app/src/` component | Add or update its colocated `<Name>.stories.tsx`; shared fixtures in `app/src/ui/_*` (see `app/.storybook/`) |
| New App.tsx shell chrome | Add to `app/src/shell/` as a presentational, slot-driven component (props only, no signal/fetch), wire it into `AppFrame.tsx`/`App.tsx`, give it a `.module.css` + `.stories.tsx` |
| Verify a visual change | `bun run visual` (`bench/checkChanged.ts`, everyday) or `bun run visual:baseline` (`bench/cssBaseline.ts`, only after a deliberate restyle — re-records) |

Source: `CLAUDE.md`, `core/src/server.ts`, `core/src/graph.ts`, `core/src/engine.ts`, `core/src/vault.ts`, `core/src/memory.ts`, `core/src/agents.ts`, `core/src/graphBuilder.ts`, `core/src/layout.ts`, `core/src/layout-cache.ts`, `core/src/sse.ts`, `core/src/asyncCache.ts`, `core/src/changeClassifier.ts`, `core/src/relay.ts`, `core/src/daemon.ts`, `core/src/daemonGraph.ts`, `core/src/daemonViz.ts`, `core/src/daemonState.ts`, `core/src/daemonInstall.ts`, `core/src/backup.ts`, `core/src/terminal.ts`, `core/src/files.ts`, `core/src/fileAccess.ts`, `core/src/error.ts`, `core/src/settings.ts`, `core/src/schema/settingsSchema.ts`, `core/src/community.ts`, `core/src/basesData.ts`, `core/src/commands.ts`, `core/src/keybindings.ts`, `core/src/bases/types.ts`, `core/src/bases/sourceSpec.ts`, `core/src/srs/scheduler.ts`, `core/src/drawing/model.ts`, `app/src/App.tsx`, `app/src/panes.ts`, `app/src/tabIds.ts`, `app/src/api.ts`, `app/src/serverVersion.ts`, `app/src/settings.ts`, `app/src/settingsCssVars.ts`, `app/src/themes.ts`, `app/src/commands.ts`, `app/src/graph/AsciiGraphRenderer.ts`, `app/src/graph/graphRenderer.ts`, `app/src/bases/BaseView.tsx`, `app/src/bases/rowCache.ts`, `app/src/bases/flashcardsQueue.ts`, `app/src/export/formats.ts`, `app/src/export/exporters.ts`, `app/src/mobile/bootMobile.ts`, `relay/CLAUDE.md`, `relay/lib/report.ts`, `relay/hooks/hooks.json`, `relay/bin/session-end-hook.ts`, `relay/bin/wrap.ts`, `relay/shim/claude`, `relay/shim/agent-shim`, `cli/src/index.ts`, `cli/src/commands/note.ts`, `cli/src/commands/api.ts`, `package.json`, `core/package.json`, `app/package.json`, `cli/package.json`, `skills/authoring-bismuth-bases/SKILL.md`, `mcp/src/skills.ts`, `mcp/src/server.ts`, `core/src/bismuthInstall.ts`, `core/src/agentBackends/agentsMd.ts`, `core/src/chatProviders/codex/driver.ts`, `app/.storybook/main.ts`, `app/.storybook/preview.ts`, `app/src/ui/_baseFixtures.tsx`, `app/src/ui/_fakeTransport.ts`, `app/src/ui/_calendarFixtures.ts`, `app/src/ui/_graphFixtures.ts`, `app/src/ui/_daemonFixtures.ts`, `app/src/ui/_cmHarness.tsx`, `app/src/ui/_storyKit.tsx`, `app/src/shell/AppFrame.tsx`, `app/src/shell/TopStrip.tsx`, `app/src/shell/Sidebar.tsx`, `app/src/shell/EditorPane.tsx`, `app/src/shell/TabRail.tsx`, `app/src/shell/TabRailRow.tsx`, `app/src/shell/CommandButton.tsx`, `app/src/shell/DragGhost.tsx`, `app/src/shell/GraphFloater.tsx`, `app/src/shell/PaneOverlay.tsx`, `app/src/shell/StatusBar.tsx`, `app/src/shell/InboxIndicator.tsx`, `app/src/shell/WindowControls.tsx`, `app/src/PaneLeaf.tsx`, `app/src/PaneHeader.tsx`, `app/src/PaneDropZone.tsx`, `app/src/ui/Text.tsx`, `app/src/ui/Heading.tsx`, `app/src/ui/Label.tsx`, `app/src/ui/Badge.tsx`, `app/src/ui/uiLint.ts`, `app/src/PreviewView.tsx`, `app/src/preview/previewKind.ts`, `app/scripts/dev.ts`, `app/scripts/devVault.ts`, `app/src/App.css`, `bench/chromeSession.ts`, `bench/affected.ts`, `bench/checkChanged.ts`, `bench/invariants.ts`, `bench/cssBaseline.ts`, `bench/storyAudit.ts`, `bench/moduleClassCheck.ts`, `bench/probeStory.ts`, `bench/templateDiff.ts`, `bench/layoutquality.ts`, `bench/visual.ts`
