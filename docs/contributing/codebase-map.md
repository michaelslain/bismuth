# Codebase Map

This document is a module-by-module navigation guide for the Bismuth monorepo. It covers every workspace, every `core/src` and `app/src` module (including subdirectories), the `cli/src` command layer, and the `relay` plugin. For each module it explains what the module does, what it exports, what it depends on, and where to make changes when adding new features. Use this alongside the architecture overview in `CLAUDE.md`.

---

## Workspace Layout

Bismuth is a Bun workspace monorepo. The root `package.json` declares five workspaces:

```
bismuth/               root (private, no src; devDeps: emojilib, unicode-emoji-json)
  core/                @bismuth/core — backend server, all pure logic
  app/                 app — Tauri + Solid.js desktop UI
  cli/                 @bismuth/cli — `bismuth` binary wrapping @bismuth/core
  relay/               @bismuth/relay — Claude Code plugin for the agent graph
  mcp/                 @bismuth/mcp — stdio MCP server (docs + CLI) for app-terminal Claude sessions
```

`core` is the library that `app`, `cli`, and `mcp` import as `@bismuth/core`. `relay` is not imported by anyone; it runs as a standalone plugin inside terminal tabs, and its `.mcp.json` auto-starts the `mcp` server in those sessions. Root-level `dependencies` (`@napi-rs/canvas`, `pdf-lib`, `perfect-freehand`) are hoisted and consumed by `core/src/drawing/`.

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
`createChangeTracker()` → `{ classify(paths, read): Promise<Dirty> }`. Fingerprints each changed file's wikilinks + tags + `icon` frontmatter field (`extractFingerprint`), compares against last-known state, and returns `{ graph: boolean; tree: boolean }`. Content-only edits that don't touch links/tags/icon return `{ graph: false, tree: false }` — the server stays silent toward graph and tree consumers. `isSettingsPath(path)` checks if a path is `settings.yaml`.

#### `error.ts`
`AppError` class and `createError(code, message?)` factory. Error codes and their HTTP status: `ENOENT`/`*_NOT_FOUND` → 404, `EACCES` → 403, `EEXIST`/`*_CONTENT_CHANGED` → 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` → 400, `INTERNAL_ERROR` → 500. `mutatingHandler` in `server.ts` catches `AppError` and maps `statusCode` to the HTTP response.

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
`buildMemoryGraph(root)` — builds the memory graph from Claude-bot notes in a separate directory. Node ids are prefixed `mem:`. Returns `{ nodes, edges, links: Map<base, targets[]> }` where `links` carries which vault filenames each memory note references (used by `engine.ts` to create "about" edges).

#### `agents.ts`
`buildAgentGraph(snapshot, liveTerminalIds, now?)` — pure function. Builds the "agents" graph from a `RelaySnapshot` (from `relay.ts`) and the live pty id set (from `terminal.ts`). Sessions with closed terminal tabs are dropped. A session with a live (non-done) subagent stays "awake" even without a recent heartbeat. Returns `{ nodes, edges }` — no "you" hub (frontend injects it via `withYouNode`). Session node id: `agent:sess:<sessionId>`, subagent node id: `agent:sub:<agentId>`.

#### `graphBuilder.ts`
`buildGraphFromNotes(root, nodeBuilder, edgeExtractor)` — shared graph construction skeleton. Lists `.md` files, builds node index maps (`byBase`, `byPath`), reads all contents in parallel, then calls `edgeExtractor` for each file. Used by both `vault.ts` and `memory.ts`. When adding a new graph source, use this function rather than reimplementing the file walk + parallel read pattern.

#### `community.ts`
`detectCommunities(nodes, edges)` — deterministic synchronous label propagation (20-iteration cap). Nodes processed in sorted id order; ties broken by smallest community id. Post-processes: assigns each community's exemplar (highest-degree member, tie → lex-smallest id) as the community label. Returns `Map<id, CommunityAssignment>`. Used by `engine.ts` to stamp `community`/`communityLabel` on nodes.

---

### Layout

#### `layout.ts`
Pure, DOM-free layout computation. `computeLayoutAsync(input, opts?)` — runs PivotMDS (Brandes & Pich, O(k·(V+E))) to get a global seed, then refines with a d3-force-3d simulation. `LayoutOptions`: `dimensions` (2 or 3), `numPivots` (default 50), `refineTicks` (default 150), `repulsion`, `linkDistance`, `centering`, `initialPositions` (skip PivotMDS and warm-start from these coordinates). The force constants (`COLLIDE_RATIO = 1.25`, `COLLIDE_ITERATIONS = 6`, `MANYBODY_THETA = 1.5`) are kept in sync with `WebGLRenderer.ts` so a precomputed layout matches what the renderer would settle to. Also runs in a browser Worker.

#### `layout-cache.ts`
Two-tier layout cache (in-memory Map + JSON file in `~/.bismuth/layout-cache`, durable; override `OA_LAYOUT_CACHE_DIR`). `attachLayout(graph, vaultKey)` — computes both 3D and 2D layouts and attaches `position`/`position2d` to every node. 2D layout is seeded from flattened 3D so the morph flattens in place rather than scrambling. Peek-attaches brain-view layouts when already cached; otherwise they're computed lazily on `GET /graph/views`. `computeViewLayouts(graph, vaultKey)` — computes 2nd/3rd subgraph layouts on demand. `graphSig(graph, vaultKey)` — SHA-1 content hash of sorted node ids + edge endpoints. Cache version `v9` bakes current constants + the persisted warm-seed; bump `CACHE_VERSION` if force constants or cache shape change.

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
`commitVault(vault)` / `snapshotMessage()` — runs `git add -A && git commit -m "<message>"` in the vault directory. Called by `POST /backup`.

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
Settings.yaml lifecycle. Key exports:
- `readSettings(vault)` — reads and parses `settings.yaml`; tolerant of malformed YAML.
- `reconcileSettings(vault)` — called on boot; writes a fresh defaults file if absent, or merges in any new keys since the file was written (preserving user values, comments, unknown keys).
- `setSettingInFile(vault, path: string[], value)` — per-vault mutex-guarded atomic write of one key, addressed by a dot-path **array** (e.g. `["appearance", "theme"]`), not separate section/key args; called by `POST /set-setting`. The mutex (a promise chain keyed by vault path) prevents TOCTOU races.
- `getVaultSchema(vault)` — parses `properties:` section into a `Schema`, merged over built-in properties.
- `serializeSettingsForFrontend(vault)` — returns the settings data as a nested plain object for `GET /settings`.
- `loadAppConfig(vault)` — reads and coerces settings into `AppConfig` (backend runtime use).
- `SETTINGS_FILE = "settings.yaml"`.

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

#### `daemon.ts`
Reads (and minimally writes) the claude-bot daemon's shared on-disk state. Never throws. Key exports:
- `claudeBotHome()` — resolves home: `OA_CLAUDEBOT_HOME` env > settings override > `~/.claude-bot`.
- `setClaudeBotHomeOverride(home)` — called by `server.ts` on settings load.
- `daemonStatus()` → `DaemonStatus { running, thisDeviceId, owner }`.
- `listDevices()` → `DeviceList`.
- `setOwner(deviceId, label)` — writes `owner.json`.
- `setCronEnabled(name, enabled)` / `setProcessEnabled(name, enabled)` — frontmatter mutation on cron/process `.md` files.
- `runCron(name)` — triggers a cron run by touching the run trigger file.

#### `daemonGraph.ts`
`daemonSnapshot(home?)` → `DaemonSnapshot { daemon, crons, processes }`. Reads `crons/*.md`, `.last-fired.json`, `.running.json`, `processes/*.md`. `buildDaemonGraph(snap)` → `GraphData` with daemon hub node + cron/process children connected by `supervises` edges. `daemonGraph(home?)` — convenience wrapper. `DAEMON_NODE_ID = "::daemon"`.

#### `daemonViz.ts`
`nodeVisualState(state, now?)` → `DaemonVisual { fill, border, opacity }`. Pure visual encoder for daemon/cron/process nodes. Three states: disabled (fill=`"base"`, border=`"none"`, opacity=0.15), running (fill=`"palette"`, border=`"none"`, opacity=1), enabled-idle (fill=`"bg"`, border=`"palette"`, opacity=1). Tokens are abstract; the renderer resolves them against the live theme.

#### `daemonState.ts`
Shared low-level helpers: `pidAlive(pid)`, `readJsonObj(path)`, `readFrontmatter(path)`, `isEnabled(data)`. Used by `daemon.ts` and `daemonGraph.ts` to read state files.

#### `claudebot.ts`
`installStatus()` → `InstallStatus { installed, running, daemonLabel, home, plistPath }`. `runSetup(dryRun?)` → `SetupResult { action, status }`. Both spawn the `claude-bot` package's `bin/ensure-installed.ts` entrypoint as a subprocess (keeping daemon side effects quarantined). The entrypoint is adopt-only. `installStatus` never throws — degrades to `{ installed: false, running: false }` on any error.

---

### Relay Registry

#### `relay.ts`
In-process registry of Claude Code sessions running in Bismuth terminal tabs. Populated by `POST /relay/*` routes (from the relay plugin hooks). Key exports:
- `registerSession(s)` — register or heartbeat a session; drops any previous session for the same `terminalId`.
- `endSession(sessionId)` — drop session + subagents.
- `startSubagent(s)` / `stopSubagent(s)` — add/mark-done a subagent.
- `prune(liveTerminalIds)` — drop sessions whose terminal is closed, orphaned subagents, and done subagents past `DONE_SUBAGENT_TTL_MS` (60 s). Called at GET /agent-graph time.
- `snapshot(now?)` → `RelaySnapshot { sessions, subagents }`.
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

## `core/src/schema/` — Schema Engine

Four modules backing the shared settings/property schema:

| Module | Responsibility |
|--------|---------------|
| `types.ts` | `Schema`, `SchemaEntry`, `PropertyType` type definitions |
| `settingsSchema.ts` | `SETTINGS_SCHEMA` + `DEFAULTS` — single source of truth for all settings |
| `registry.ts` | `loadRegistry(raw)` — parses `properties:` YAML into a Schema; `BUILTIN_PROPERTIES` |
| `validate.ts` | `validateDocument(doc, schema)` — YAML lint diagnostics for the editor |
| `coerce.ts` | `coerceValue(value, type)` — raw YAML → typed value |
| `suggest.ts` | `suggestCompletions(prefix, schema, path)` — autocomplete candidates |

---

## `core/src/srs/` — Spaced Repetition

| Module | Responsibility |
|--------|---------------|
| `types.ts` | `Card`, `ReviewResponse`, `SchedulingInfo` |
| `scheduler.ts` | `schedule(prev, response, today, cfg?)` — SM-2 scheduling, `SrsConfig` |
| `parser.ts` | `parseCards(content, path)` — markdown `?`/`??` card extraction |
| `cards.ts` | `collectDecks`, `dueCards`, `applyReview` — vault-wide card CRUD |
| `reviewRow.ts` | `applyReviewToRow` — SM-2 applied to base-row flashcards |

---

## `core/src/bases/` — Bases Expression Engine

| Module | Responsibility |
|--------|---------------|
| `types.ts` | All shared types (`Row`, `ViewType`, `SourceSpec`, etc.) |
| `ast.ts` | AST node types |
| `lexer.ts` | `tokenize(expr)` |
| `parser.ts` | `parseExpr(tokens)` |
| `parse.ts` | `parseBase`, `parseBaseFile`, `parseQueryBlock` |
| `evaluate.ts` | `evaluateExpr(ast, ctx)` |
| `filters.ts` | `applyFilter(filter, ctx)` |
| `functions.ts` | Built-in function/method dispatch tables |
| `query.ts` | `runView(config, rows)` — filters + formulas + grouping |
| `queryBlock.ts` | `parseQueryBlock(text)` — flat ` ```query ` block parser |
| `source.ts` | `resolveSource(spec, vault, rows, tasks)` — server-side SourceSpec resolver |
| `sourceSpec.ts` | `normalizeSource(raw, fm)`, `refToPath(ref?)` |
| `rows.ts` | Row utilities and aggregation |
| `table.ts` | GFM pipe-table parse/serialize |
| `rowOps.ts` | `upsertRow`, `deleteRow`, `reorderRow` — markdown table rewrite |
| `taskRow.ts` | `taskToRow`, `filterTaskRows` |
| `tasksData.ts` | `buildTaskRows(vault, from?)` |
| `values.ts` | Value coercion and display |
| `recurrence.ts` | Calendar recurrence rule parsing and expansion |
| `chart.ts` | Chart data aggregation for bar/line/stat/heatmap |

---

## `core/test/` — Backend Tests

Each source module has a corresponding `*.test.ts`. Notable:
- `core/test/helpers.ts` — `makeSampleVault()` used by most vault-touching tests.
- `core/test/bases/` — one test per bases module.
- `core/test/srs/` — one test per SRS module.
- `core/test/drawing/` — one test per drawing module.
- `core/test/schema/` — schema validation tests split by feature.
- `core/test/server.test.ts` — integration tests against a live server instance.
- Run: `bun test core` (all) or `bun test core -- <pattern>` (filter by filename).

---

## `app/src/` — Frontend Application

Solid.js + TypeScript + CodeMirror 6 + Three.js. Styled with CSS Modules colocated with components and a global `App.css`.

### Root / Shell

#### `index.tsx`
Entry point. Mounts `<App />` into `#root`. Desktop entry — does not import `mobile/bootMobile.ts`.

#### `App.tsx`
Root component. Owns: tab + pane tree state (via `panes.ts` model), active file routing, graph mode (`GraphMode = "2nd" | "3rd" | "both" | "agents" | "daemon"`), sidebar visibility, settings persistence, global keyboard handling (reads `settings.keybindings`), command binding (via `bindCommands`), toast/gallery hosts, all modal triggers. Lazily imports `GraphView` and `TerminalTab` to keep the entry bundle small. Seeds a `::graph` tab on first boot and reopens one if all tabs close.

Key logic: `applyView(graph, view)` overwrites node positions with a brain-view's precomputed layout for 2nd/3rd modes. Storage keys: `"oa-tabs-v1"`, `"oa-sidebar-visible-v1"`, `"oa-graph-cache-v1"`, `"oa-theme-vars-v1"`.

#### `panes.ts`
Pure binary-tree pane model (no DOM, no Solid). Types: `Leaf { kind, id, content }`, `Split { kind, id, dir, ratio, a, b }`, `PaneNode = Leaf | Split`, `Tab { id, root, focusId, name? }`. Operations: `makeLeaf`, `makeTab`, `splitLeaf`, `closeLeaf`, `equalize`, `focusNeighbor`, `setContent`, `setRatio`, `findLeafByContent`, `leaves`, `leafCount`, `pruneMissing`, `movePane`, `reorderTabs`, `splitLeafWithNode`, `replaceLeafWithNode`, `replacePaneWithPane`, `detachLeafToTab`, `serializeTabs`, `deserializeTabs`, `resolveFocus`. Fully unit-tested in `panes.test.ts`.

#### `tabIds.ts`
Sentinel content ids (all start with `::`): `SEARCH_TAB = "::search"`, `GRAPH_TAB = "::graph"`, `EMPTY_PANE = "::empty"`, and the prefixed ids `TERMINAL_PREFIX = "::term:"`, `EXPORT_PREFIX = "::export:"`, plus the `::flashcards:` prefix (consistent with the sentinel list in `CLAUDE.md`). `contentLabel(content, terminalIndex?)` and `contentIcon(content)` derive display strings/icons from content ids.

#### `PaneTree.tsx`
Renders the binary pane tree; manages pane drag-and-drop via `dnd/viewDrag.ts`. Handles split/close/resize interactions.

#### `PaneContent.tsx`
Routes a pane content id to the correct view component. Note path → `FileView`; `*.sheet` → `SheetView`; `*.draw` → `DrawingPage`; `::graph` → (forwarded to `App`'s `renderGraph` prop); `::term:*` → `TerminalTab`; `::search` → `SearchView`; `::export:*` → `ExportView`; `settings.yaml` → `Editor`; `type: base` files → `BaseView`.

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
`THEME_NAMES`, `LIGHT_THEMES`, `resolveAppearance(appearance)` → `ColorTokens`. Named Bismuth color themes (12 total, 6 dark + 6 light). `ColorTokens`: background, foreground, neutral, accent, border, surface, surface2, accentPalette, isLight, categoryGreen/Gold/Rose. DOM-free and unit-tested.

#### `themeColors.ts`
Derives dynamic theme-aware color values (e.g. ANSI terminal palette from theme). `buildAnsiPalette(tokens)` — maps theme colors to xterm.js ANSI color slots for `Terminal.tsx`.

---

### Graph

#### `graph/WebGLRenderer.ts`
Three.js renderer. Handles both 2D (flat birdseye with OrbitControls locked to Z) and 3D (volumetric orbit) modes. Morphs between the backend's precomputed positions — never runs its own force settle from scratch. Key behaviors: edge crowding (screen-space bucketing, dimming dense fans), hover highlight (dim non-neighbors, cull crowded non-focused edges), daemon-mode node fill/border rendering via `nodeVisualState`. Force constants (`COLLIDE_RATIO`, `COLLIDE_ITERATIONS`) kept in sync with `core/src/layout.ts`.

#### `graph/LabelLayer.ts`
DOM-overlay labels. A pool of reused `<div>` elements positioned absolutely over the WebGL canvas. `updateVisibility()` (throttled ~6/s) selects which labels show: top-N hubs (always-on set), nearest-camera discovery, hover/active/search, greedy occlusion, depth+zoom fade in 3D, dot-size gate + grid declutter in 2D. `reposition()` (every frame) re-projects label positions from 3D world to screen pixels via a translate transform. `setColors(colors)` pushes per-theme `--label-text`/`--label-bg`.

#### `graph/labelSelection.ts`
`computeAlwaysOnSet(nodes, topN)` — pure function, returns the top-N nodes by undirected degree count. `renderedPixelRadius(node, nodeSize, camera, viewMode)` — computes a node's screen-space dot radius for 2D gate decisions. Unit-tested.

#### `graph/youNode.ts`
`withYouNode(g, openContents)` — pure function. Prepends the `SELF_NODE_ID` hub node at origin `[0,0,0]` and adds `"open"` edges to all currently-open note panes that exist in the graph. Sentinel content ids (starting with `::`) are skipped. Does not mutate input graph.

#### `graph/agentGraphSig.ts`
`agentGraphSig(graph)` — computes a lightweight change signature for the agents graph (node count + edge count hash). Used by `App.tsx` to dedup polling — only re-renders when the signature changes.

#### `graph/agentLayout.ts`
Layout utilities specific to the agents graph (radial arrangement of session + subagent nodes).

#### `graph/agentOrg.ts`
Agent graph org-chart layout helpers.

#### `graph/AgentsGraph.tsx`
Standalone component for the agents-mode graph sidebar panel.

#### `graph/collide.ts`
`nodeCollideRadius(node, nodeSize)` / `drawnNodeRadius(node, nodeSize)` — per-node collision-radius helpers. Large hubs use their drawn circle as the collision radius (not a point), padded by `COLLIDE_SIZE_PADDING`. Unit-tested.

#### `graph/d3-force-3d.d.ts`
Frontend-side type stubs for `d3-force-3d` (same as the core-side version).

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
Schema-aware YAML autocomplete for `settings.yaml`. Shows each key's doc string, valid range, and current default. Uses `suggestCompletions` from `core/src/schema/suggest.ts`. `keybind` PropertyType shows a "Record shortcut…" option. Tested in `settingsComplete.test.ts` and `settingsComplete.keybind.test.ts`.

#### `editor/yamlSchema.ts`
YAML schema linter for frontmatter and `settings.yaml`. Uses `validateDocument` from `core/src/schema/validate.ts`. Tested in `yamlSchema.test.ts` and `settingsSchemaLint.test.ts`.

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
`isSettingsBuffer(path)` — detects the settings.yaml path. Tested.

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
`buildQueue(rows, dueField, today, cram, bidirectional)` — pure queue construction. `nextPosAfterGrade(queue, pos, grade)` — next position after a review. `backField(field)` — derive the Back-direction field name. Stable row-index tracking (survives reorders). Tested.

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
`formatsFor(path)` / `isExportable(path)` — determines valid export formats by file extension. Matrix: `.md` → `["html", "pdf", "md"]`; `.sheet` → `["html", "pdf"]`; `.draw` → `["pdf", "png"]`.

#### `export/exporters.ts`
`exportFile(path, format, api)` — dispatches to the format-specific exporter. Tested.

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
`ExportFormat = "html" | "pdf" | "md" | "png"`.

#### `ExportView.tsx`
Export options pane UI (format picker, preview, download button).

---

### Daemon UI

#### `DaemonList.tsx`
Sidebar panel shown in daemon graph mode. Lists crons and processes with enable/disable/run right-click actions.

#### `DaemonOwnerModal.tsx`
Modal for selecting which device owns the claude-bot daemon. Calls `POST /daemon/owner`.

#### `DaemonSetupModal.tsx`
Modal for adopting/installing the claude-bot daemon. Calls `POST /daemon/setup`.

---

### Palette

#### `palette/CommandPalette.tsx`
Full command palette. Fuzzy-matches against `COMMAND_CATALOG` bound commands plus note names. Triggered by `Cmd+K` (default keybinding).

#### `palette/QuickSwitcher.tsx`
Note quick-switcher. Fuzzy-matches vault note names.

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

Shared design-system components. All import `ui.css` for shared button/input chrome.

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
| `devWarn.ts` | Dev-only warning helper |
| `uiLint.ts` | UI lint checks (tested) |
| `gallery/` | `galleryStore.tsx` (global image gallery), `SymbolGallery.tsx`, `sources.ts`, `types.ts` |
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

#### `ClusterLegend.tsx`
Community cluster legend overlay on the graph (shown in "both"/"2nd"/"3rd" modes, hidden in daemon mode).

#### `GraphView.tsx`
Graph pane shell. Mounts `WebGLRenderer` + `LabelLayer`, exposes mode/view toggles (2nd/3rd/both/agents/daemon, 2D/3D). 2D/3D toggle persisted to localStorage (not settings.yaml).

#### `GraphSearch.tsx`
Graph search input — highlights matching nodes in the graph.

#### `FileView.tsx`
Routes a `.md` note path to `Editor` (for regular notes) or `BaseView` (for `type: base` notes). Manages note title editing.

#### `NoteTitle.tsx`
Editable note title bar above the editor. Handles rename (writes frontmatter `title` or renames the file). Tested via `noteTitleOps.test.ts`.

#### `noteTitleOps.ts`
Pure helpers for note title operations (derive title from path, detect custom title, etc.). Tested.

#### `SearchView.tsx`
Full-text search pane. Calls `POST /search`, displays `SearchResult[]` with snippets.

#### `searchOpts.ts`
`SearchOpts` type and serialization helpers. Tested.

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
`settings get`, `settings set`, `settings schema`, `folder-icon` — read/write settings.yaml keys + the per-folder icon map.

### `commands/daemon.ts`
`daemon status`, `daemon devices`, `daemon owner`, `daemon install`, `daemon setup`, `daemon update`, `daemon graph`, `daemon cron toggle`, `daemon cron run`, `daemon process toggle` — read/write the claude-bot daemon's `~/.claude-bot` state (no `--vault`).

### `commands/draw.ts`
`render` — render a `.draw` file to PNG (or `--pdf`) headless (filesystem path, no `--vault`).

### `commands/serve.ts`
`serve` (start the backend server, `createServer`), `backup` (git-snapshot the vault).

### `commands/export.ts`
`export` — export a note/base/sheet/drawing to `md|html|png|pdf` (pdf of notes/bases/sheets is browser-only).

### `commands/api.ts`
`agent-graph` (fetch the live agents graph from a running server), `api <GET|POST|PUT> <path>` — raw HTTP call to any core API endpoint (for in-memory things like the relay registry).

### `commands/install.ts`
`install` (machine-wide CLI + MCP install, idempotent + version-gated), `uninstall` — remove the symlink, global MCP registration, and `~/.bismuth`.

### `commands/checkpoint.ts`
`checkpoint diff`, `checkpoint advance`, `checkpoint ref` — per-consumer git bookmarks (`refs/bismuth/<name>`) over any git dir via `--dir`, for "what changed since I last ran" jobs.

---

## `relay/` — Agent Graph Plugin

A Claude Code plugin loaded per-session inside Bismuth terminal tabs. Not installed globally. No cross-machine functionality.

### `.claude-plugin/plugin.json`
Plugin manifest. No `commands` — the plugin exposes no slash commands; it only uses hooks.

### `hooks/hooks.json`
Hook definitions:
- `SessionStart` → `bin/session-start-hook.ts` (matcher includes `resume` for `--resume`/`--continue`)
- `UserPromptSubmit` → `bin/recall-hook.ts` (heartbeat)
- `SubagentStart` → `bin/subagent-start-hook.ts`
- `SubagentStop` → `bin/subagent-stop-hook.ts`

### `lib/report.ts`
`readHookInput()` — parses stdin JSON; `{}` on empty/invalid. `postRelay(path, body)` — best-effort `POST` to `CLAUDE_RELAY_URL` with 2 s timeout. `runHook(fn)` — wraps any hook body: always exits 0, never throws. `terminalId()` — reads `CLAUDE_TERMINAL_ID` env. `relayUrl()` — reads `CLAUDE_RELAY_URL` env (default `http://localhost:4321`).

### `bin/session-start-hook.ts`
`POST /relay/session` with `{ sessionId, terminalId, cwd }`.

### `bin/recall-hook.ts`
`POST /relay/session` (heartbeat — same endpoint, bumps `lastSeen`).

### `bin/subagent-start-hook.ts`
`POST /relay/subagent/start` with `{ parentSessionId, agentId, agentType }`.

### `bin/subagent-stop-hook.ts`
`POST /relay/subagent/stop` with `{ agentId, lastMessage }`.

### `shim/claude`
Shell script placed on `PATH` inside each terminal tab. Executes `$BISMUTH_REAL_CLAUDE --plugin-dir $BISMUTH_RELAY_PLUGIN "$@"`. Transparent — all flags and arguments pass through.

### `shim/zdotdir/`
zsh init dir (`.zshenv`, `.zshrc`). `ZDOTDIR` is set to this dir so the `claude` function is defined AFTER the user's `.zshrc` loads, making it immune to `.zshrc` that re-prepend `PATH`.

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

Source: /Users/michaelslain/Documents/dev/bismuth/CLAUDE.md, /Users/michaelslain/Documents/dev/bismuth/core/src/server.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/graph.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/engine.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/vault.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/memory.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/agents.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/graphBuilder.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/layout.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/layout-cache.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/sse.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/asyncCache.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/changeClassifier.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/relay.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemon.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemonGraph.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemonViz.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemonState.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/claudebot.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/terminal.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/files.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/fileAccess.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/error.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/settings.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/schema/settingsSchema.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/community.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/basesData.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/commands.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/keybindings.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/types.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/sourceSpec.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/srs/scheduler.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/drawing/model.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/App.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/panes.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/tabIds.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/api.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/serverVersion.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/settings.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/settingsCssVars.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/themes.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/commands.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/graph/WebGLRenderer.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/graph/LabelLayer.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/graph/youNode.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseView.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/rowCache.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/flashcardsQueue.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/export/formats.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/mobile/bootMobile.ts, /Users/michaelslain/Documents/dev/bismuth/relay/CLAUDE.md, /Users/michaelslain/Documents/dev/bismuth/relay/lib/report.ts, /Users/michaelslain/Documents/dev/bismuth/cli/src/index.ts, /Users/michaelslain/Documents/dev/bismuth/cli/src/commands/note.ts, /Users/michaelslain/Documents/dev/bismuth/package.json, /Users/michaelslain/Documents/dev/bismuth/core/package.json, /Users/michaelslain/Documents/dev/bismuth/app/package.json, /Users/michaelslain/Documents/dev/bismuth/cli/package.json
