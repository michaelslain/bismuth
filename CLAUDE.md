# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
bun install                                       # from repo root (all 5 workspaces)
export OA_VAULT=/path/to/vault OA_MEMORY=/path/to/memory   # dev only; dirs must exist
cd app && bun run dev                             # Tauri app + backend on :4321
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian, built as a monorepo with five workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: Backend server that manages vaults, builds knowledge graphs, and integrates with Claude-bot memory
- **cli**: Command-line interface for managing vaults (`bismuth` binary)
- **app**: Tauri + Solid + TypeScript desktop application with CodeMirror editor and 3D/2D graph visualizations
- **relay**: A tiny Claude Code plugin (hooks only) reporting each terminal-tab session + subagents to core's in-process registry, powering the "agents" graph (see Relay Integration)
- **mcp**: A stdio MCP server (the `docs/` reference + `bismuth` CLI, token-frugal) — per-tab in dev, installed machine-wide by the bundled app (see MCP Integration)

The system treats knowledge as a "three-brain" model:
- **You** (self node): Central hub representing the user
- **2nd Brain** (vault): Personal knowledge base with wikilinks, tags, and YAML frontmatter
- **3rd Brain** (memory): Claude-bot memory graph linked to vault notes

## Environment Setup

`bun run dev` requires two env vars (errors if unset; both dirs must exist): `OA_VAULT` (2nd-brain markdown vault) and `OA_MEMORY` (3rd-brain Claude-bot notes). First-time with no vault: `mkdir -p /tmp/test-vault /tmp/test-memory && echo "# Hello" > /tmp/test-vault/example.md`, export both, then `cd app && bun run dev`. These env vars are **dev/standalone only** — the bundled `/Applications` app self-spawns its own core backend and resolves its vault from a saved `config.json` or a first-run native folder picker (see Desktop app & core sidecar).

## Documentation

`docs/` (committed) is the exhaustive, code-anchored reference for the whole system — bases/view/settings syntax, CLI, daemon, storage, HTTP API, MCP. Start at `docs/README.md`; keep it current.

## Key Commands

### Development
- `bun run dev` (in `app/`) — Run Tauri app + backend server concurrently with hot reload. Requires `OA_VAULT` (2nd-brain vault dir) and `OA_MEMORY` (3rd-brain memory dir) env vars; there is no default vault
- `bun start` — Start Vite dev server only (app/)
- `bun run core/src/server.ts --vault /path/to/vault --memory /path/to/memory` — Run backend server standalone (both flags required)

### Testing
- `bun test core` — Run all tests in core workspace (uses Bun's test runner)
- `bun test core -- wikilinks` — Run tests matching filename pattern
- Tests are located in `core/test/`

### Building
- `bun run build` (in `app/`) — Build Vite app for production
- `bun run tauri build` (in `app/`) — Build native Tauri executable

### Infrastructure
- `bun install` — Install dependencies for all workspaces
- `bun run core:serve` — Standalone server startup (shorthand for core server)

### Running Multiple Agents Concurrently

Default ports `:4321`/`:1420` serve one instance. For more, override the port: `PORT=4322 bun run dev` (standalone server takes `--port`; frontend reads `VITE_API_BASE`).

## Architecture

### Core Backend (`core/`)

**Purpose**: Manages vault file system, builds knowledge graphs, watches for changes, serves HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve) with caching, file watching, the mutating-route abstraction, SSE broadcast, and the WS `/terminal` upgrade. Three route tables: **GET reads**, **POST mutations** (via `mutatingHandler` → invalidate caches + broadcast SSE), and **read-table POST/PUT** (no cache-invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, daemon writes, etc.). **Full route reference: `docs/api/http-reference.md`.**
- `sse.ts` — Server-sent event registry. `formatEvent`, `createSseRegistry`. Pushes `{version, paths, dirty: {graph, tree}}` on file changes — graph/tree consumers use `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — Graph composition. Merges vault graph + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — Builds vault knowledge graph from markdown files. Two-pass algorithm: (1) create note nodes, (2) extract wikilinks + tags + frontmatter metadata, create edges
- `graph.ts` — Graph types. Node kinds: "note", "memory", "agent", "tag", "self" (the "you" hub — injected on the frontend from open tabs/panes, see `app/src/graph/youNode.ts`, NOT from backend builders), + daemon-mode "daemon"/"cron"/"process" (may carry `DaemonVizState`). Edge kinds: "link", "message", "about" (memory→vault), "tag", "open" (you→open note), "supervises" (daemon→cron/process)
- `layout.ts` — Pure layout computation (pivot-MDS + force simulation). Produces 2D and 3D `Positions` maps used by the renderer
- `layout-cache.ts` — `attachLayout()` writes precomputed `position2d` / `position3d` onto graph nodes, keyed by vault. Frontend morphs between them instead of running its own force sim
- `files.ts` — File I/O: list markdown, read/write notes, path-traversal rejection
- `frontmatter.ts` — YAML frontmatter parsing; tolerates malformed YAML
- `wikilinks.ts` — Extract `[[WikiLink]]` patterns from markdown
- `tags.ts` — Extract `#tag` from frontmatter and markdown body
- `memory.ts` — Build memory graph from Claude-bot memory notes (in `mem:` namespace)
- `agents.ts` — Build the "agents" graph (you → terminal-tab sessions → subagents) from the in-process relay registry; pure over a `RelaySnapshot` + the live pty-id set
- `relay.ts` — In-process registry of terminal-tab Claude sessions + their subagents, populated by the relay plugin's hooks via `POST /relay/*`, pruned against the live pty set (see Relay Integration)
- `daemon.ts` — Reads/writes the claude-bot daemon's shared state files (device-id, devices.json, owner.json, daemon.pid); exports status/device/owner/cron/process accessors. Never throws — degrades gracefully on missing files. Home dir from `daemon.home` setting. See Daemon Integration
- `daemonGraph.ts` — Builds the "daemon" graph (daemon hub → cron/process nodes, `supervises` edges) from the daemon's on-disk crons/processes; `daemonSnapshot`/`buildDaemonGraph`/`daemonGraph`
- `daemonViz.ts` — Pure `nodeVisualState(state)` mapping a daemon node's `{enabled, running}` → visual tokens (fill/border/opacity): disabled = dim; running = solid palette fill; enabled-idle = `bg` (hollow) fill + palette border ring
- `backup.ts` — Git commit snapshot of vault
- `tasks.ts`, `tasks-query.ts` — Tasks extraction + query DSL (Obsidian Tasks-compatible)
- `terminal.ts` — PTY session manager backing the in-app terminal tabs (`bun-pty`). Injects relay provenance into each tab's env (`CLAUDE_TERMINAL_ID`, `CLAUDE_RELAY_URL`) + a PATH shim (`relay/shim/claude`) so a bare `claude` in a tab auto-loads the relay plugin via `--plugin-dir` (`buildPtyEnv`, pure + tested)
- `dates.ts` — Date math shared by tasks, SRS, calendar
- `basesData.ts` — Vault-wide data feed consumed by the Bases query engine
- `bases/` — Bases DSL: see "Bases" section below
- `srs/` — Spaced-repetition system: see "Flashcards / SRS" section below

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change. A change starts a 250ms debounce; on fire the server fingerprints changed notes via `changeClassifier.ts` to mark caches dirty (graph/tree/both — content-only edits that don't touch links/tags/icon stay silent), bumps `version`, and pushes an SSE `{version, paths, dirty}` on `/events`. The frontend opens one `EventSource("/events")` on boot (`serverVersion.ts`), re-fetching `/graph` (or just `/file`) per event, with a low-frequency `/version` poll as dropped-SSE fallback. The graph is computed lazily after invalidation; positions are precomputed on the backend (`layout.ts`), not force-simulated in the browser.

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, styled with CSS modules

**Key components**:
- `App.tsx` — Root. Owns the tab + pane tree, active file routing, graph mode, settings persistence, global keyboard handling
- `panes.ts` — Pure binary-tree model for split panes (Leaf/Split nodes). Fully unit-tested in `panes.test.ts`
- `PaneTree.tsx` / `PaneContent.tsx` — Renders the pane tree; each Leaf hosts a note, Bases view, spreadsheet (`.sheet`), drawing (`.draw`, via `drawing/`), calendar, tasks, flashcards, terminal, or an export view (`export/`)
- `tabIds.ts` — Sentinel ids for non-file pane contents (`::graph`, `::search`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`). Notes/bases/sheets/drawings/settings route by file path; no `::calendar` sentinel (calendar is a Bases view).
- `Editor.tsx` — CodeMirror 6 editor with markdown, live-preview, wikilink/tag autocomplete, embedded bases/tasks blocks
- `editor/` — CodeMirror extensions (full detail in `docs/editor/`): live-preview, wikilink/tag autocomplete, the one ` ```query ` block (→ `BaseView`), `![[file]]`/`![](url)` embeds (resizable `|WxH`), editable GFM tables (`tableModel`/`tableState`/`tableWidget`), math/code highlighting + line numbers, Harper spellcheck, `settingsComplete`/`yamlSchema`, inline markdown, context menu
- `FileTree.tsx` — Left sidebar. Drag-drop moves, rename/move retargets active tab, undo support for deletes
- `ContextMenu.tsx` — Right-click menu for file tree and editor
- `GraphView.tsx` — Mounts the WebGL renderer and label layer, exposes mode/view toggles
- Settings have **no GUI page** — the "settings page" is `settings.yaml` opened in the editor, with schema-aware autocomplete (`editor/settingsComplete.ts`, shows each key's doc + valid range) and lint (`editor/yamlSchema.ts`). The schema (`core/src/schema/settingsSchema.ts`) is the single source of truth.
- `palette/` — `CommandPalette`, `QuickSwitcher`, shared `PaletteModal`
- `Flashcards.tsx` — Top-level SRS review view, routable via a sentinel id
- `Terminal.tsx` / `Terminal.css` — xterm.js terminal tab, WebSocket-backed by `core/src/terminal.ts`
- `Toast.tsx`, `telemetry.ts` — Toast notifications, lightweight client telemetry (SSE errors, poll catch-ups)
- `serverVersion.ts` — Single `EventSource` to `/events` plus fallback `/version` poll
- `bases/` — Bases view renderers (Table, Cards, Kanban, List, Map, Calendar, Flashcards, Bar, Line, Stat, Heatmap, plus shared `renderValue`)
- `calendar/` — Calendar state + components (no standalone page; rendered as a Bases view — see "Calendar" section below)
- `api.ts` — HTTP client for core endpoints
- `settings.ts` — Settings store: seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves via `POST /set-setting` (`settingsDiff.ts`) so the backend merges in place without clobbering comments. `Settings` interface mirrors the schema (`settings.parity.test.ts`).
- `settingsCssVars.ts` — Projects appearance/ui/calendar/terminal settings into `:root` CSS custom properties; stylesheets reference them via `var(--name, fallback)`.

**Graph rendering**:
- `graph/WebGLRenderer.ts` — Three.js renderer for both 2D (flat birdseye) and 3D (volumetric orbit) modes, morphing between the backend's precomputed layouts
- `graph/LabelLayer.ts` — DOM-overlay file-name labels: pooled native `<div>`s (NOT Three.js sprites), with viewport culling, occlusion, zoom-band discovery, and an always-on hub set (incl. a bold "you" label). `setColors()` pushes per-theme label colors
- `graph/labelSelection.ts` — Pure `computeAlwaysOnSet` (top-N nodes by undirected edge count). Unit-tested
- `graph/collide.ts` — Per-node collision-radius helpers (big hubs repel as their drawn circle, not a point)
- `graph/d3-force-3d.d.ts` — Type stubs for d3-force-3d library

**Styling**:
- `App.css` — Global styles, CSS variables for theme/accent/fonts
- Component styles are colocated with components

### CLI (`cli/`)

The `bismuth` binary (thin wrapper over `@oa/core`) controls the whole vault from the shell. File-based commands run **headlessly** (no server); the app's vault watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`OA_VAULT`.

- `src/index.ts` — dispatcher: merges every group into one registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap.
- `src/args.ts` (`flag`/`bool`/`positionals`/`requireVault`/`out`/`fail`…) + `src/types.ts` (`Command`/`CommandMap`) — the shared seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. Groups: `file`, `note`, `search`, `graph`, `task`, `base`(+`row*`), `card`, `prop`, `settings`(+`folder-icon`), `daemon` (reads/writes `~/.claude-bot`, no vault), `draw`, `serve`+`backup`, `export` (→ md|html|png; **pdf browser-only**), `api` (`<METHOD> <path>` passthrough to a running server, for in-memory things like the relay registry), `install` (machine-wide cli+mcp, see MCP Integration).

**Adding a command**: add a `Command` to a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` (overview, sources, query-syntax, filters, functions, query-block) + `docs/bases/views/` (per view kind). This is the conceptual summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas, and one or more views over the vault's notes (`FileView` routes a `type: base` note to `BaseView`). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`):
- `lexer.ts` → `parser.ts` → `parse.ts` — Tokenize and parse the Bases expression grammar (filters, formulas, view configs)
- `evaluate.ts` — Evaluate a parsed AST against a single note
- `filters.ts` — Filter combinators (`and`, `or`, `not`, comparisons)
- `functions.ts` — Built-in functions on file/number/string/array/date values (method-dispatch tables per type)
- `query.ts` — Apply a Base to the vault data feed (`basesData.ts`) and return rows + grouping

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) spans 12 kinds — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (`bullets` = markdown list; charts via `bases/chart.ts`). `BaseView.tsx` hosts/picks the renderer (full-pane views like calendar/flashcards render from `data().rows`); `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` code block — the only embedded block (there is no ` ```base `/` ```view `/` ```tasks `). Its body is either a full inline base config (top-level `views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks: <dsl>`, `where:`, `group:`, `view:`). Rendered inline by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]`:
- `{ kind: "base", ref }` — render another base, resolving that base's OWN source recursively (composition), not just its static rows.
- `{ kind: "notes", where?, from? }` — vault notes filtered by a Bases expr; `from: [[Base]]` scopes to that base's notes.
- `{ kind: "tasks", where?, from? }` — checkbox tasks; `from: [[Base]]` scopes extraction to that base's notes (no `from` = global).

Frontmatter accepts a string (`source: notes where #book`) or object; `normalizeSource()` coerces both. Resolution is cycle-guarded and **server-side** via `POST /rows {spec}`; `BaseView.resolveRows` = `inlineRows ?? api.resolveRows(spec)`. Perf: server caches the unscoped vault row feed (`cachedRows`); client keeps an SSE-version-keyed stale-while-revalidate cache (`bases/rowCache.ts`) so reopening paints instantly (`BaseSkeleton` only on cold load) while revalidating.

In a flat block: `of: [[Base]]` renders that base, `tasks: <dsl>` runs a task query (optionally `from: [[Base]]`), `where:`/`view:` filter and pick the mode. It does not iterate notes itself (that's a base's job); neither `of:` nor `tasks:` → empty state.

**Scoped-tasks example**: a `Do Now` base with `source: tasks` + `from: "[[Google Keep]]"` shows only the tasks inside the `Google Keep` base's notes (not the whole vault).

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — there is no standalone calendar page. To open a calendar, create a `type: base` md with `views: [{ type: calendar }]` (or switch an existing base to calendar view). The calendar view is rendered by `app/src/bases/CalendarView.tsx`.

The `app/src/calendar/` directory holds the shared state + components the view consumes: `EventStore.ts` (event CRUD + persistence), `state.ts` (reactive view state), `dates.ts` (date helpers), `types.ts`, `categoryColor.ts` (status→color), `refresh.ts`, `components/` (`EventChip`/`EventModal`/`RecurrenceDialog`/`CategoryPanel`/`Toolbar`), and `components/views/` (`Month`/`Week`/`ThreeDay`/`Day`/`TimeGrid`).

### Tasks (`core/src/tasks*.ts`)

Obsidian-Tasks-compatible. Tasks are a **base source** (`source: tasks`, optionally `from: [[Base]]`), not a standalone subsystem — a focused list is just a base (see Bases "Sources & composition"), queried via a ` ```query ` block with `tasks: <dsl>` (no separate ` ```tasks ` block).
- `tasks.ts` — extract task items from markdown (status, due/scheduled/start, recurrence, tags); `collectTasksFromPaths` scopes to a note subset. `tasks-query.ts` — query DSL (error-collecting, relative dates, sort, AND/OR). `bases/taskRow.ts` — `taskToRow`/`filterTaskRows` project tasks as base `Row`s. `POST /tasks/toggle` rewrites the markdown line.

### Flashcards / SRS (`core/src/srs/` + `app/src/bases/FlashcardsView.tsx`)

Spaced-repetition reviews. Flashcards are a **Bases view kind** (`flashcards`) over a base's rows — the review UI is `app/src/bases/FlashcardsView.tsx`, not a standalone page. There are two code paths:
- **Markdown cards** (`srs/parser.ts` parses `?`/`??` syntax out of notes; `srs/cards.ts` = card model + persistence + `applyReview`).
- **Row cards** (a base's rows with front/back/due/ease/interval columns; `srs/reviewRow.ts` `applyReviewToRow` applies SM-2 to a row's scheduling columns).
- `srs/scheduler.ts` — SM-2-style scheduling (next-due, ease factor) shared by both. `srs/types.ts` — shared types.
- `app/src/bases/flashcardsQueue.ts` — pure, unit-tested review-queue logic: `buildQueue(rows, dueField, today, cram, bidirectional)`, `nextPosAfterGrade`, stable row-index tracking.
- **Bidirectional cards** (toggle in `BaseSettings.tsx`): each row yields forward + reverse queue entries, the reverse scheduled independently in `*Back` columns (`dueBack`/`easeBack`/`intervalBack`, via `backField`).
- **Cram mode** reviews everything ignoring due dates and never writes scheduling.
- Endpoints: `/cards/{decks,all,note,due}` (GET); `POST /cards/review` is dual-mode (`{id, response}` → markdown via `applyReview`, `{file, index, …}` → row via `applyReviewToRow`). Card add/edit/delete/reorder go through `POST /row/{update,delete,reorder}` (`bases/rowOps.ts`); `EditCardsModal.tsx` is the deck editor.

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs. Backend spawns a PTY via `bun-pty` and bridges it over WebSocket on `/terminal`. Frontend renders with xterm.js, with the ANSI palette wired from the graph color theme (`buildAnsiPalette`). DOM-rendered (not canvas), styled to match the editor.

Each PTY's env (`buildPtyEnv`, pure + tested) injects relay provenance + a PATH shim (`relay/shim/claude`) so a bare `claude` auto-loads the relay plugin via `--plugin-dir`; falls back to a plain shell if `claude` isn't found (`Bun.which`). See Relay Integration.

### Sheets (`app/src/SheetView.tsx` + `app/src/sheet/`)

A `.sheet` file is a Univer workbook JSON snapshot (`@univerjs/presets` v0.25), code-split via dynamic `import()` behind `sheet/univerSheet.ts`. `sheet/snapshot.ts` (parse/serialize) + `sheet/sync.ts` (`isExternalChange` gates external-edit reloads). `PaneContent` routes `*.sheet` → `SheetView`; created via "New Spreadsheet".

### Drawing (`app/src/drawing/` + `core/src/drawing/`)

A `.draw` file is a versioned JSON `DrawingDoc` (pages, strokes, paper background) — a multi-page vector sketch surface routed by `PaneContent.tsx` (lazy `DrawingPage.tsx`), created via "New Drawing".
- **Backend (`core/src/drawing/`, pure + headless)**: `model.ts` (schema/serialize), `geometry.ts` (perfect-freehand outlines), `smooth.ts` (spline relaxation), `render2d.ts` (Canvas 2D, highlighter multiply-blend), `paper.ts` (blank/lines/grid/dots), `theme.ts` (7-color palette), `export.ts` (`renderDocToPng`/`renderDocToPdf` via `@napi-rs/canvas`+`pdf-lib`).
- **Frontend (`app/src/drawing/`)**: `DrawingCanvas.tsx` (dual canvas — committed base + live draft; stylus pressure/velocity width), `Toolbar.tsx`, `store.ts` (pages + undo/redo), `input.ts`.
- **Persistence**: generic `PUT /file` (no dedicated route); raw input is lag-free, smoothing applied on pointer-release.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure model, unit-tested). Each Leaf holds a content id: either a note path or a sentinel from `tabIds.ts` (`::settings`, `::graph`, `::terminal`, `::flashcards`, `::calendar`, plus per-base sentinels). `PaneTree.tsx` walks the tree; `PaneContent.tsx` routes a leaf id to the right view.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class tab content — `PaneContent` routes it to a `GraphView` via `App`'s `renderGraph()` prop. `App` seeds a `::graph` tab when nothing is restored and reopens one if all tabs close (tabs are never empty). When a pane shows the graph, the sidebar mini-graph (`.graph-floater`) hides so it never renders twice.

**Tab renaming**: double-click or right-click → Rename sets a custom label, stored as `name` on the `Leaf` node (`panes.ts`), overriding the `contentLabel()` title; clear by renaming to empty.

### Commands & Sidebar Toolbar

Commands are split into pure data + behavior so the palette and the sidebar header bar (`.sidebar-icons`) share one source: `core/src/commands.ts` (`COMMAND_CATALOG` → the `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → live `{id,label,icon,action}` map; `resolveButtonCommands`).

The bar above the file tree is configured by `toolbar:` in `settings.yaml`. Each item: `{ command: <id> | commands: [<id>, …], icon: <Lucide|emoji>, tooltip? }`. `commands` list wins; unresolved ids skip; button disabled only if none resolve.

**Adding a command:** add an entry to `COMMAND_CATALOG` (core) and a matching `action` binding in `bindCommands` (app). The `toolbar.command` enum, its autocomplete, and the palette pick it up automatically. (Adding any new *top-level* schema key also requires updating the hardcoded key lists in `core/test/schema/settingsSchema.test.ts`.)

**File-menu commands**: `new-folder`/`new-note`, `export` (focused file), `new-window` (reopen folder via `?api=`), `open-folder` (open a folder as a new brain: `POST /open-folder` → sibling core server → `?api=` window).

**Runtime backend base** (`app/src/api.ts`): `resolveBase` picks the backend at runtime (`?api=<url>` > `window.__OA_API__` > `VITE_API_BASE` > `:4321`), so one frontend build serves multiple windows each talking to a different backend; `apiBase()` exposes it for building `?api=` window URLs.

### Keybindings

Global shortcuts come from `keybindings:` in `settings.yaml` (nothing hardcoded in `App.tsx`). Same split-data pattern as commands: `core/src/keybindings.ts` (`KEYBINDING_CATALOG` → schema) + `app/src/keybindings.ts` (matcher `matchesKeybinding` + helpers). `"Mod"` = Cmd/Ctrl; modifier matching is **exact**; combos comma-separated; matches the produced key OR physical `event.code` (Option-composed chars still match). The `keybind` PropertyType drives an order-free autocomplete in `editor/settingsComplete.ts` (incl. "Record shortcut…").

**Adding a keybinding:** add an entry to `KEYBINDING_CATALOG` (core) and read `settings.keybindings.<id>` via `matchesKeybinding` at the handler — schema field, autocomplete, and default are derived automatically.

## Workspace Management

Workspaces are linked via Bun's `workspaces` in the root `package.json`: `core` exports `@oa/core`, which `app` (UI), `cli`, and `mcp` import; `relay` is the hooks-only plugin and `mcp` is the stdio MCP server (deps `@modelcontextprotocol/sdk`). Add a dep with `cd <workspace> && bun add <package>`; `bun install` (root) syncs all.

## Module Organization

Module purposes are in the **Architecture** section above; this is just the layout.

```
core/src/
  server.ts sse.ts                    # HTTP + SSE + WS, mutating-route abstraction
  engine.ts vault.ts memory.ts agents.ts relay.ts graphBuilder.ts   # graph composition + builders (relay.ts = agent-graph registry)
  daemon.ts daemonGraph.ts daemonViz.ts daemonState.ts   # claude-bot daemon: state reader + daemon-mode graph + node-visual encoder + shared file-read helpers
  drawing/   # .draw vector docs (model/geometry/smooth/render2d/paper/theme/export — pure, headless)
  graph.ts layout.ts layout-cache.ts community.ts          # types, layout, community detection
  files.ts frontmatter.ts wikilinks.ts tags.ts pathUtils.ts backup.ts
  asyncCache.ts changeClassifier.ts   # dedup cache + selective-invalidation classifier
  search.ts replace.ts templates.ts dailyNote.ts openFolder.ts   # back POST /search,/replace,/daily-note,/open-folder
  settings.ts                          # settings.yaml lifecycle (reconcile, per-vault write mutex, property registry)
  commands.ts keybindings.ts error.ts dates.ts basesData.ts tasks.ts tasks-query.ts terminal.ts bismuthInstall.ts claudeWhich.ts
  bases/   # Bases DSL (lexer/parser/evaluate/filters/functions/query)
  srs/     # SRS (cards/parser/scheduler)
core/test/  # one *.test.ts per module; helpers.ts → makeSampleVault()

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane-tree model, routing
  Editor.tsx editor/   # CodeMirror wrapper + extensions (livePreview, autocomplete, foldBlocks, queryBlock, wikilink, tag, settingsComplete…)
  FileTree.tsx fileTreeOps.ts ContextMenu.tsx nativeMenu.ts FolderPrompt.tsx EmptyPane.tsx
  GraphView.tsx GraphSearch.tsx ClusterLegend.tsx graph/   # graph shell + WebGL renderer, DOM LabelLayer, youNode (+withYouAgents), agentGraphSig, collide, labelSelection
  FileView.tsx NoteTitle.tsx Flashcards.tsx Terminal.tsx SheetView.tsx sheet/ ExportView.tsx export/
  bases/ calendar/ palette/ drawing/   # feature view-sets
  ui/      # shared primitives (Button/IconButton/TextButton/IconTextButton, Chip, Stars, StatusDot, ViewBar, SearchBar, SegmentedToggle, TextInput, Select, Field, EmptyState, Modal, gallery/, popover/) + buttonClass
  icons/ dnd/   # Lucide Icon+registry+picker; drag-drop geometry + viewDrag
  api.ts serverVersion.ts settings.ts settingsCssVars.ts settingsDiff.ts keybindings.ts themes.ts appWindow.ts nativeAppMenu.ts
  Toast.tsx telemetry.ts App.css   # toasts, client telemetry, global styles + CSS vars
app/src-tauri/   # Tauri shell (Rust): lib.rs spawns the core sidecar + first-run vault picker (see Desktop app & core sidecar)

mcp/src/
  docs.ts cli.ts server.ts   # stdio MCP server: docs index/search/read + CLI bridge + 5 tools (see MCP Integration)
relay/   # Claude Code plugin: hooks/ (→ POST /relay/*) + shim/ (zsh claude wrapper); see Relay Integration
```

## Development Workflow

### Running the full stack
`cd app && bun run dev` runs the Tauri app + backend concurrently — open `http://localhost:1420/` (dev server) or the native Tauri window; backend on `:4321`. Tests: `bun test core`.

### Editing notes & hot-reload
- Vault `.md` edit → 250ms debounce → cache-invalidate → version bump → SSE (`{paths, dirty:{graph,tree}}`); frontend re-fetches `/graph` (or just `/file`); the `/version` poll recovers a dropped SSE (see **Caching strategy** + **Data flow** above).
- `bun run dev`: Vite hot-reloads `.tsx`/`.css` (state preserved); **backend restarts** on `core/src` changes; `settings.yaml` re-read per request (no restart).

### Debugging
- **Graph not updating:** wait the 250ms debounce + ≤5s poll; `curl :4321/version`; watch `/events` in DevTools. Content-only edits set `dirty.graph=false` (rebuild skipped) — expected.
- **Terminal dead:** check the `/terminal` WebSocket; a crashed PTY needs an app restart.

## Common Tasks

### Adding a new endpoint to core API
Add a route to the `routes` (read) or `mutatingRoutes` (write) table in `core/src/server.ts`; mutating routes go through `mutatingHandler` (auto cache-invalidate + SSE — don't bump version manually). Add a `core/test/server.test.ts` case.

### Adding a graph node kind or edge kind
Update `NodeKind`/`EdgeKind` in `core/src/graph.ts`, emit them from the extractors (`buildVaultGraph()` in `vault.ts`), and adjust frontend mode filtering in `App.tsx` if needed.

### Adding a setting
The schema is the single source of truth; defaults must equal the current hardcoded value so upgrades are a behavioral no-op.
1. Add an entry (type, `default`, `min`/`max` or enum, `doc`) to `core/src/schema/settingsSchema.ts` — `DEFAULTS`, autocomplete, linter, and `reconcileSettings` (adds the key to existing files, preserving comments) pick it up automatically.
2. Add the matching field to the `Settings` interface in `app/src/settings.ts` (`settings.parity.test.ts` enforces schema ↔ interface match).
3. Wire the consumer: **CSS-driven** → a `--var` in `settingsCssVars.ts` + `var(--name, <fallback>)` in CSS; **frontend logic** → read `settings.<section>.<key>` (reactive); **backend** → read `appConfig.<section>.<key>` in `server.ts` (cached via `loadAppConfig`). Edits persist via `POST /set-setting` (merges one key in place).

### Debugging graph construction
Run the server standalone (`bun run core/src/server.ts --vault <v> --memory <m>`), `curl :4321/graph | jq`; see `core/test/vault.test.ts` / `engine.test.ts` for examples.

### Adding a Bases function
Add a case to the `callFunction`/`callMethod` dispatch in `core/src/bases/functions.ts`, handle its return type in `query.ts` aggregation, and test in `core/test/bases/query.test.ts`.

### Adding an SRS scheduler variant
Extend `core/src/srs/scheduler.ts`; expose config in `settingsSchema.ts` (e.g. `srs.algorithm`) and thread into `applyReview`.

## Error Handling

Backend errors use the `AppError` class (`core/src/error.ts`): `createError(code, msg)` (factory picks status from code) or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` to the response; generic `Error` → 500. Codes → status: `ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400, `INTERNAL_ERROR` 500.

## Shared Helpers (avoid re-duplicating)

- **`core/src/graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — file walk + read + index used by both `vault.ts` and `memory.ts`. Use it for any new graph source.
- **`core/src/files.ts` `walkDir(root, filter)`** — recursive dir walk behind `listTree`/`listTemplates`; filter returns `true`/`false`/`{data}`.
- **`core/src/frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits frontmatter via the `yaml` Document API (preserves comments/key order/flow arrays), falls back to stringify on malformed input.
- **Resilience**: `app/src/serverVersion.ts` tracks a `ConnectionState` (connected/disconnected/reconnecting). On SSE loss it shows a "Connection lost" toast and polls `/version` at 1s (vs 5s) until reconnect, then auto-dismisses.
- **`app/src/sanitizeHtml.ts` `sanitizeHtml(dirty)`** — DOMPurify wrapper for safe `innerHTML` of any vault-rendered HTML; browser/headless-aware (passes through when no `window`, so Bun tests work). Always route rendered HTML through it. Build that HTML by escaping with the canonical `app/src/htmlEscape.ts` (`escapeHtml`/`escapeAttr`), not per-file escapers.

## Key Concepts

### Vault Structure
- Markdown files in a directory tree
- YAML frontmatter: `---\ntags: [a, b]\n---`
- Wikilinks: `[[Another Note]]` (matched by file name, not path)
- Folders: Top-level folder becomes `folder` field on nodes (e.g., "reading/quotes/x.md" → folder="reading")

### Memory Integration
- Claude-bot memory notes live in a separate directory (e.g., `~/.claude/memories/`)
- Memory graph is built separately, nodes prefixed with `mem:` (e.g., `mem:project-xyz`)
- "About" edges connect memory nodes to vault notes (if memory references vault filenames)

### Graph Modes
- **"2nd" brain**: Self + vault notes + tags (excludes memory)
- **"3rd" brain**: Self + memory (excludes vault)
- **"both"**: Full brain (self + vault + memory + edges between them)
- **"agents"**: Live tree of the Claude Code work running in THIS app's terminal tabs — you → each terminal-tab session → its subagents (see Relay Integration below)
- **"daemon"**: The claude-bot daemon's supervised work — a daemon hub → its crons + processes (`supervises` edges), node fill/border encoding enabled/running state (see Daemon Integration below)

The "agents" mode visualizes Claude Code sessions in Bismuth's own terminal tabs + their subagents (you → session → subagents, depth 1). Built from `/agent-graph` (`agents.ts` over the relay registry, filtered to open tabs); the frontend polls it (change-signature dedup) only while agents mode is active.

**2D/3D toggle**: The renderer's 2D vs 3D mode is a **transient localStorage toggle** (not a `settings.yaml` key). It persists across sessions via `localStorage` but is not user-facing in the settings file. Toggle via the graph toolbar or the `GraphView` mode control.

### Performance Optimizations
Debounced file-watch + version-gated refetch + backend-precomputed layouts (see **Caching + data flow**); plus lazy WebGL init, content-change-gated live-preview rescans, malformed-YAML tolerance, and base loads via server row cache + client SWR cache (`bases/rowCache.ts`).

### Desktop app & core sidecar (`app/src-tauri/` + `app/scripts/build-core-sidecar.ts`)

The bundled `/Applications` app is self-contained — it **spawns its own `core` backend** instead of relying on `bun run dev`. `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary (`bun build --compile` → `binaries/bismuth-core-<triple>`, shipped via `externalBin`). On launch (release only, `!cfg!(debug_assertions)`), `src/lib.rs` picks a free port, spawns the sidecar (`--vault --memory --port`) via `tauri-plugin-shell`, kills it on exit, and builds the main window with an init script setting `window.__OA_API__` (read by `api.ts` `resolveBase`). **Vault resolution**: a Finder-launched app has no shell env, so `lib.rs` reads `config.json` from the app-config dir and, on first run or a missing vault, shows a native folder picker (memory → `~/.claude-bot/memory`). `openFolder.ts` `coreLaunchArgv` re-execs the compiled binary vs `bun run server.ts` (compiled-binary detection). The build also stages `resources/relay` (hooks-only) + `resources/bismuth-tools` (compiled cli+mcp+docs); `lib.rs` passes `OA_RELAY_BUNDLE`/`OA_BISMUTH_INSTALL_SRC` to the sidecar (relay auto-loads in tabs; machine-wide install runs on boot — see MCP Integration). Deep detail: `docs/overview/install.md`.

### MCP Integration (`mcp/` workspace)

A stdio [MCP](https://modelcontextprotocol.io) server serving the `docs/` reference + `bismuth` CLI **token-frugally** (snippet-only search): `docs.ts`/`cli.ts`/`server.ts` (low-level `@modelcontextprotocol/sdk`, no zod). 5 tools: `bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`. **Dev**: auto-attaches per-tab via the relay plugin's `relay/.mcp.json`. **Bundled app**: installed **machine-wide** — on boot the sidecar runs a version-gated idempotent install (`core/src/bismuthInstall.ts`) copying compiled `bismuth`+`bismuth-mcp`+docs to `~/.bismuth`, symlinking the cli onto PATH (`/usr/local/bin`), and registering the mcp in the user's global `~/.claude.json` (`claude mcp add -s user`). Also `bismuth install` + an in-app command. Deep detail: `docs/mcp/overview.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`), powering the "agents" graph. Loads per-session inside app terminals (bundled via `OA_RELAY_BUNDLE`; nothing in `~/.claude`).

`terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim (ZDOTDIR) so a bare `claude` auto-loads the plugin — the shim sources the user's rc, so oh-my-zsh + their `claude` keep working. Hooks POST `/relay/*`: `SessionStart`/`UserPromptSubmit` register/heartbeat, `SubagentStart`/`SubagentStop` add/finish (best-effort, no-op without `CLAUDE_TERMINAL_ID`). `agents.ts` builds the graph; `/agent-graph` prunes closed-tab sessions. App-local only; registry lives only while core runs.

### Daemon Integration (`core/src/daemon.ts` + `daemonGraph.ts` + `daemonViz.ts`)

Bismuth reads (and minimally writes) the **claude-bot daemon's** shared on-disk state to power the "daemon" graph mode + sidebar (`app/src/DaemonList.tsx`, replaces `ClusterLegend` in daemon mode). The daemon is a separate process; Bismuth never starts/stops it.
- `daemon.ts` reads `device-id`/`devices.json`/`owner.json`/`daemon.pid` and the crons/processes under the daemon home (the `daemon.home` setting; defaults to `~/.claude-bot`). `daemonGraph.ts` turns crons/processes into a hub+children graph with `supervises` edges; `daemonViz.ts` is the pure node-visual encoder.
- Endpoints: GET `/daemon/{status,devices,graph,install}` (graph polled only in daemon mode); POST `/daemon/owner` (vault mutation) + shared-state writes `/daemon/{setup,cron/toggle,cron/run,process/toggle}` (not mutations). Right-click a cron/process in `DaemonList` to enable/disable/run.
- Setup is **idempotent / adopt-only**: never clobbers, restarts, or repoints a live daemon.

## Testing

Tests use Bun's native test runner. Run with:
```bash
bun test core
bun test core -- [pattern]  # Filter by filename
```

Each module has a colocated `*.test.ts`. Notable: `core/test/{vault,engine,server,sse,layout,tasks,tasks-query,daemon,daemonViz}.test.ts`, `core/test/{bases,srs,drawing}/`, and frontend `app/src/{panes,settings}.test.ts`, `app/src/graph/{collide,labelSelection}.test.ts`, `app/src/calendar/*.test.ts`, `app/src/editor/{wikilink,tag,tableModel}.test.ts`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d`/`position3d` are computed in `core/src/layout.ts`, attached via `layout-cache.ts`; the renderer only morphs. If positions look wrong, suspect the backend layout.
- **Wikilink matching is filename-based, not path-based**: `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches are undefined.
- **File-watch debounce**: two edits within 250ms → only the second rebuilds. **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it. **Concurrent instances**: 4321/1420 serve one; override ports for more.
