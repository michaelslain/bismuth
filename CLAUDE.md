# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
git clone <repo>
cd bismuth
bun install
export OA_VAULT="/path/to/your/vault"           # Directory with .md files
export OA_MEMORY="/path/to/your/memory"         # Claude-bot memory directory
cd app && bun run dev                            # Tauri app + backend on :4321
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian, built as a monorepo with four workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: Backend server that manages vaults, builds knowledge graphs, and integrates with Claude-bot memory
- **cli**: Command-line interface for managing vaults (`oa` binary)
- **app**: Tauri + Solid + TypeScript desktop application with CodeMirror editor and 3D/2D graph visualizations
- **relay**: A tiny Claude Code plugin (hooks only) reporting each terminal-tab session + subagents to core's in-process registry, powering the "agents" graph (see Relay Integration)

The system treats knowledge as a "three-brain" model:
- **You** (self node): Central hub representing the user
- **2nd Brain** (vault): Personal knowledge base with wikilinks, tags, and YAML frontmatter
- **3rd Brain** (memory): Claude-bot memory graph linked to vault notes

## Environment Setup

`bun run dev` requires two env vars (errors if unset; both dirs must exist): `OA_VAULT` (2nd-brain markdown vault) and `OA_MEMORY` (3rd-brain Claude-bot notes). First-time with no vault: `mkdir -p /tmp/test-vault /tmp/test-memory && echo "# Hello" > /tmp/test-vault/example.md`, export both, then `cd app && bun run dev`.

## Development Artifacts

Plans, design docs, and temporary dev artifacts live outside the source tree in `~/.claude/bismuth-docs/` (git-ignored).

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

Default ports `:4321` (backend) / `:1420` (Tauri) only serve one instance. For more, override: `OA_VAULT="/path" OA_MEMORY="/path" PORT=4322 bun run dev` (the standalone server takes `--port`; the frontend reads `VITE_API_BASE`). See `concurrent-agents-ports.md` in `~/.claude/bismuth-docs/`.

## Architecture

### Core Backend (`core/`)

**Purpose**: Manages vault file system, builds knowledge graphs, watches for changes, serves HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve) with caching, file watching, mutating-route abstraction, SSE broadcast. Routes:
  - GET reads: `/version`, `/events` (SSE), `/graph`, `/graph/views` (per-brain-view layouts, computed lazily on mode switch), `/tree`, `/vault-data`, `/file`, `/meta`, `/config`, `/settings`, `/schema`, `/templates`, `/base`, `/agent-graph`, `/tasks`, `/cards/decks`, `/cards/all`, `/cards/note`, `/cards/due`, plus the daemon reads `/daemon/status`, `/daemon/devices`, `/daemon/graph` (daemon-mode graph), `/daemon/install` (see Daemon Integration)
  - POST mutations (go through `mutatingHandler` — invalidate caches + broadcast SSE): `/move`, `/delete`, `/restore`, `/create`, `/set-property`, `/delete-property`, `/set-setting` (merge one settings.yaml key in place — the backend is the single writer of settings), `/folder-icon`, `/daily-note`, `/tasks/toggle`, `/cards/review`, `/row/update` (create/update a base row — `index:null` creates), `/row/delete`, `/row/reorder` (move a row from→to), `/replace`, `/daemon/owner` (claim this device as owner)
  - POST/PUT in the read table (NOT mutations — no auto cache-invalidate): `/rows` (resolve a `SourceSpec` → `Row[]`, following base composition + scoped tasks), `/search`, `/backup` (git snapshot), `/open-folder` (spawn a sibling core server pointed at another folder; returns its `{url}` — see `openFolder.ts`), `PUT /file`, `POST /asset` (upload attachment, capped at 100 MB), `/relay/session`, `/relay/session/end`, `/relay/subagent/start`, `/relay/subagent/stop` (agent-graph ingest from the relay plugin's hooks), `/daemon/setup`, `/daemon/cron/toggle`, `/daemon/cron/run`, `/daemon/process/toggle` (all daemon-shared-state writes, NOT vault mutations — no cache invalidation)
  - GET reads also include: `GET /asset` (serve a vault media file by filename — filename-first resolution, used by embedBlock)
  - GET `/terminal` upgrades to WebSocket for terminal PTY sessions
- `sse.ts` — Server-sent event registry. `formatEvent`, `createSseRegistry`. Pushes `{version, paths, dirty: {graph, tree}}` on file changes — graph/tree consumers use `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — Graph composition. Merges vault graph + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — Builds vault knowledge graph from markdown files. Two-pass algorithm: (1) create note nodes, (2) extract wikilinks + tags + frontmatter metadata, create edges
- `graph.ts` — Graph type definitions. Node kinds: "note", "memory", "agent", "tag", "self" (the "you" hub — one per brain view, NOT from the backend builders; injected on the frontend from the open tabs/panes, see `app/src/graph/youNode.ts`), plus the daemon-mode kinds "daemon"/"cron"/"process" (a node may carry a `DaemonVizState`). Edge kinds: "link" (wikilinks), "message" (memory), "about" (memory→vault), "tag", "open" (you→an open note), "supervises" (daemon hub→cron/process)
- `layout.ts` — Pure layout computation (pivot-MDS + force simulation). Produces 2D and 3D `Positions` maps used by the renderer
- `layout-cache.ts` — `attachLayout()` writes precomputed `position2d` / `position3d` onto graph nodes, keyed by vault. Frontend morphs between them instead of running its own force sim
- `files.ts` — File I/O: list markdown, read/write notes, path-traversal rejection
- `frontmatter.ts` — YAML frontmatter parsing; tolerates malformed YAML
- `wikilinks.ts` — Extract `[[WikiLink]]` patterns from markdown
- `tags.ts` — Extract `#tag` from frontmatter and markdown body
- `memory.ts` — Build memory graph from Claude-bot memory notes (in `mem:` namespace)
- `agents.ts` — Build the "agents" graph (you → terminal-tab sessions → subagents) from the in-process relay registry; pure over a `RelaySnapshot` + the live pty-id set
- `relay.ts` — In-process registry of terminal-tab Claude sessions + their subagents, populated by the relay plugin's hooks via `POST /relay/*`, pruned against the live pty set (see Relay Integration)
- `daemon.ts` — Reads/writes the claude-bot daemon's shared state files (device-id, devices.json, owner.json, daemon.pid); exports `daemonStatus`/`listDevices`/`getOwner`/`setOwner`/`setCronEnabled`/`setProcessEnabled`/`runCron`. Never throws — degrades gracefully on missing files. Home dir from `daemon.home` setting. See Daemon Integration
- `daemonGraph.ts` — Builds the "daemon" graph (daemon hub → cron/process nodes, `supervises` edges) from the daemon's on-disk crons/processes; `daemonSnapshot`/`buildDaemonGraph`/`daemonGraph`
- `daemonViz.ts` — Pure `nodeVisualState(state)` mapping a daemon node's `{enabled, running}` → visual tokens (fill/border/opacity): disabled = dim, no border; running = solid palette fill; enabled-idle = base fill + palette border ring
- `backup.ts` — Git commit snapshot of vault
- `tasks.ts`, `tasks-query.ts` — Tasks extraction + query DSL (Obsidian Tasks-compatible)
- `terminal.ts` — PTY session manager backing the in-app terminal tabs (`bun-pty`). Injects relay provenance into each tab's env (`CLAUDE_TERMINAL_ID`, `CLAUDE_RELAY_URL`) + a PATH shim (`relay/shim/claude`) so a bare `claude` in a tab auto-loads the relay plugin via `--plugin-dir` (`buildPtyEnv`, pure + tested)
- `dates.ts` — Date math shared by tasks, SRS, calendar
- `basesData.ts` — Vault-wide data feed consumed by the Bases query engine
- `bases/` — Bases DSL: see "Bases" section below
- `srs/` — Spaced-repetition system: see "Flashcards / SRS" section below

**Caching strategy**: `cachedGraph`/`cachedTree` persist until vault/memory files change. A file-watch change starts a debounced 250ms timer; on fire the server fingerprints changed notes via `changeClassifier.ts` to mark which caches are dirty (graph/tree/both) — content-only edits that don't touch links/tags/icon stay silent. It then bumps `version` and pushes an SSE event `{version, paths, dirty}` on `/events`.

**Data flow**: frontend opens one `EventSource("/events")` on boot (`serverVersion.ts`); each event re-fetches `/graph` (or just `/file`); a low-frequency `/version` poll is the dropped-SSE fallback. The graph is computed lazily on first request after invalidation; node positions are precomputed on the backend (`layout.ts`) and attached, not force-simulated in the browser.

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, styled with CSS modules

**Key components**:
- `App.tsx` — Root. Owns the tab + pane tree, active file routing, graph mode, settings persistence, global keyboard handling
- `panes.ts` — Pure binary-tree model for split panes (Leaf/Split nodes). Fully unit-tested in `panes.test.ts`
- `PaneTree.tsx` / `PaneContent.tsx` — Renders the pane tree; each Leaf hosts a note, Bases view, spreadsheet (`.sheet`), drawing (`.draw`, via `drawing/`), calendar, tasks, flashcards, terminal, or an export view (`export/`)
- `tabIds.ts` — Sentinel ids for non-file pane contents (`::graph`, `::search`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`). Notes/bases/sheets/drawings/settings route by file path; no `::calendar` sentinel (calendar is a Bases view).
- `Editor.tsx` — CodeMirror 6 editor with markdown, live-preview, wikilink/tag autocomplete, embedded bases/tasks blocks
- `editor/` — CodeMirror extensions: `livePreview` (block rendering), `autocomplete` (wikilinks/tags), `queryBlock` (the one ` ```query ` block — renders a `BaseView` from a full inline base config OR a flat `of:`/`tasks:`/`where:`/`view:` spec; SOURCE button toggles raw editing, auto-collapses when the cursor leaves), `queryComplete` (autocomplete inside ` ```query ` blocks — keys, view types, task-DSL snippets), `taskComplete` (task-metadata autocomplete in `- [ ]` lines — `due`/`scheduled`/`priority` keywords expand to emoji), `embedBlock` (render `![[file]]` and `![](url)` inline — images, PDFs, audio, video, `.md` note transclusion; resizable, size persisted as `|WxH`), `htmlPreview` (render sanitized raw HTML — block + inline), `inlineMarkdown` (markdown rendering inside table cells), `tableModel`/`tableState`/`tableWidget` (editable GFM pipe tables — contenteditable cells, Shift+Enter multi-line, drag-resize columns/rows persisted per-note), `wikilink`, `tag`, `mathBlock`, `codeHighlight`, `harperSpellcheck`, `settingsComplete`/`yamlSchema` (settings autocomplete + lint), `editorContextMenu`
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
- `settingsCssVars.ts` — Projects appearance/ui/calendar/terminal settings into `:root` CSS custom properties; stylesheets reference them via `var(--name, fallback)`. Add a CSS-driven setting = one schema entry + one line here + one `var()` in CSS.

**Graph rendering**:
- `graph/WebGLRenderer.ts` — Three.js renderer for both 2D (flat birdseye) and 3D (volumetric orbit) modes, morphing between the backend's precomputed layouts
- `graph/LabelLayer.ts` — DOM-overlay file-name labels: pooled native `<div>`s positioned over the canvas (NOT Three.js sprites), with viewport culling, occlusion, zoom-band discovery, and an always-on hub set (incl. a bold "you" label). `setColors()` pushes per-theme `--label-text`/`--label-bg`
- `graph/labelSelection.ts` — Pure `computeAlwaysOnSet` (top-N nodes by undirected edge count). Unit-tested
- `graph/collide.ts` — Per-node collision-radius helpers (big hubs repel as their drawn circle, not a point)
- `graph/d3-force-3d.d.ts` — Type stubs for d3-force-3d library

**Styling**:
- `App.css` — Global styles, CSS variables for theme/accent/fonts
- Component styles are colocated with components

### CLI (`cli/`)

**Purpose**: Lightweight wrapper around core library.

**Entry point**: `src/index.ts` (exports `oa` binary). Imports `@oa/core` to expose vault operations from the shell.

### Bases (`core/src/bases/` + `app/src/bases/`)

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas, and one or more views over the vault's notes (`FileView` routes a `type: base` note to `BaseView`). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`):
- `lexer.ts` → `parser.ts` → `parse.ts` — Tokenize and parse the Bases expression grammar (filters, formulas, view configs)
- `evaluate.ts` — Evaluate a parsed AST against a single note
- `filters.ts` — Filter combinators (`and`, `or`, `not`, comparisons)
- `functions.ts` — Built-in functions on file/number/string/array/date values (method-dispatch tables per type)
- `query.ts` — Apply a Base to the vault data feed (`basesData.ts`) and return rows + grouping

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) spans 11 string kinds — `table|cards|list|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (charts backed by `bases/chart.ts`). `BaseView.tsx` is the host that picks the renderer (full-pane views like calendar/flashcards render directly from `data().rows`); `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` code block — the only embedded block (there is no ` ```base `/` ```view `/` ```tasks `). Its body is either a full inline base config (top-level `views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks: <dsl>`, `where:`, `group:`, `view:`). Rendered inline by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]`:
- `{ kind: "base", ref }` — render another base; **resolves that base's OWN source recursively** (composition), not just its static table rows.
- `{ kind: "notes", where?, from? }` — vault notes filtered by a Bases expression; `from: [[Base]]` scopes to that base's notes.
- `{ kind: "tasks", where?, from? }` — checkbox tasks; `from: [[Base]]` scopes extraction to that base's notes (NOT the whole vault). No `from` = degenerate global case.

Frontmatter accepts a string (`source: notes where #book`) or an object; `normalizeSource()` coerces both. Resolution is cycle-guarded and **server-side** via `POST /rows {spec}`; `BaseView.resolveRows` = `inlineRows ?? api.resolveRows(spec)`.

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
- **Bidirectional cards**: when enabled, each row yields TWO queue entries (forward + reverse); the reverse direction is scheduled independently in `*Back` companion columns (`dueBack`/`easeBack`/`intervalBack`, via `backField`). Toggle in `BaseSettings.tsx`.
- **Cram mode** reviews everything ignoring due dates and NEVER writes scheduling (practice, not review).
- Endpoints: `/cards/decks`, `/cards/all`, `/cards/note`, `/cards/due` (GET reads); `POST /cards/review` is dual-mode — `{id, response}` drives markdown cards (`applyReview`), `{file, index, response, dueField?…}` drives row cards (`applyReviewToRow`). Card add/edit/delete/reorder go through `POST /row/{update,delete,reorder}` (server-side rewrites via `bases/rowOps.ts`); `EditCardsModal.tsx` is the deck editor (list + bulk-add, drag reorder).

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs. Backend spawns a PTY via `bun-pty` and bridges it over WebSocket on `/terminal`. Frontend renders with xterm.js, with the ANSI palette wired from the graph color theme (`buildAnsiPalette`). DOM-rendered (not canvas), styled to match the editor.

Each PTY's env is built by `buildPtyEnv` (pure, tested): it injects relay provenance (`CLAUDE_TERMINAL_ID`, `CLAUDE_RELAY_URL`) and prepends a PATH shim (`relay/shim/claude`) so a bare `claude` auto-loads the agent-graph relay plugin via `--plugin-dir`. If `claude` can't be resolved (`Bun.which`), the shim is skipped and the tab is a plain shell. See Relay Integration.

### Sheets (`app/src/SheetView.tsx` + `app/src/sheet/`)

A `.sheet` file is a Univer workbook JSON snapshot (`@univerjs/presets` v0.25), code-split via dynamic `import()` behind `sheet/univerSheet.ts`. `sheet/snapshot.ts` (parse/serialize, pure) + `sheet/sync.ts` (`isExternalChange` gates external-edit reloads). `PaneContent` routes `*.sheet` → `SheetView`; persistence reuses `api.read`/`api.write`; created via "New Spreadsheet".

### Drawing (`app/src/drawing/` + `core/src/drawing/`)

A `.draw` file is a versioned JSON document (`DrawingDoc`: pages, strokes, paper background) — a multi-page vector sketch surface routed by `PaneContent.tsx` (lazy-loaded `DrawingPage.tsx`), created via "New Drawing".
- **Backend (`core/src/drawing/`, pure + headless)**: `model.ts` (doc schema, parse/serialize), `geometry.ts` (stroke outlines via perfect-freehand), `smooth.ts` (post-release 4-stage spline relaxation: dedupe → arc-length resample → Gaussian denoise → centripetal Catmull-Rom), `render2d.ts` (Canvas 2D draw, highlighter multiply-blend), `paper.ts` (blank/lines/grid/dots backgrounds), `theme.ts` (7-color palette, theme-aware ink), `export.ts` (`renderDocToPng`/`renderDocToPdf` via `@napi-rs/canvas` + `pdf-lib` — headless only, NOT an HTTP route).
- **Frontend (`app/src/drawing/`)**: `DrawingCanvas.tsx` (dual canvas — committed base + live draft; pointer + stylus pressure/velocity width), `Toolbar.tsx`, `store.ts` (pages + undo/redo), `input.ts` (stylus detection, width calc).
- **Persistence**: saved through the generic `PUT /file` (no dedicated drawing route). Raw input is captured lag-free; smoothing is applied on pointer-release.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure model, unit-tested). Each Leaf holds a content id: either a note path or a sentinel from `tabIds.ts` (`::settings`, `::graph`, `::terminal`, `::flashcards`, `::calendar`, plus per-base sentinels). `PaneTree.tsx` walks the tree; `PaneContent.tsx` routes a leaf id to the right view.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class tab content — `PaneContent` routes it to a full `GraphView` via `App`'s `renderGraph()` prop. There is no floating "default view": `App` seeds a `::graph` tab when nothing is restored and reopens one if all tabs close (tabs are never empty). When a pane already shows the graph, the sidebar mini-graph (`.graph-floater`) hides so it never renders twice.

**Tab renaming**: Double-click or right-click → Rename on any tab to set a custom label. The name is stored as a `name` field on the `Leaf` node in `panes.ts` and overrides the automatic `contentLabel()`-derived title. Cleared by renaming to empty.

### Commands & Sidebar Toolbar

Commands are split into pure data and behavior so the palette and the sidebar header bar (`.sidebar-icons`) share one source: `core/src/commands.ts` (`COMMAND_CATALOG` pure data → schema derives the `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands(handlers)` → live `{id,label,icon,action}` map; `resolveButtonCommands` resolves a toolbar item to its ordered bound commands).

The bar above the file tree is configured by `toolbar:` in `settings.yaml`. Each item: `{ command: <id> | commands: [<id>, …], icon: <Lucide|emoji>, tooltip? }`. `commands` list wins; unresolved ids skip; button disabled only if none resolve.

**Adding a command:** add an entry to `COMMAND_CATALOG` (core) and a matching `action` binding in `bindCommands` (app). The `toolbar.command` enum, its autocomplete, and the palette pick it up automatically. (Adding any new *top-level* schema key also requires updating the hardcoded key lists in `core/test/schema/settingsSchema.test.ts`.)

**File-menu commands**: `new-folder`/`new-note` (create), `export` (export tab for focused file), `new-window` (reopen current folder in new window via `?api=`), `open-folder` (open chosen folder as new brain: `POST /open-folder` → sibling core server → `?api=<url>` window).

**Runtime backend base** (`app/src/api.ts`): `BASE` is resolved at runtime — `?api=<url>` query param wins, then the `VITE_API_BASE` build env, then the default port — so one frontend build serves multiple windows each talking to a different backend. `apiBase()` exposes the resolved value for building `?api=` window URLs.

### Keybindings

Global shortcuts come from the `keybindings:` section of `settings.yaml` — nothing is hardcoded in `App.tsx`. Same split-data pattern as commands: `core/src/keybindings.ts` (`KEYBINDING_CATALOG` pure data → schema derives the section) + `app/src/keybindings.ts` (pure matcher `matchesKeybinding` + authoring helpers). `"Mod"` = Cmd/Ctrl; modifier matching is **exact**; combos are comma-separated alternatives; matches the produced key OR physical `event.code` (so Option-composed chars still match). The `keybind` PropertyType drives an order-free shortcut autocomplete in `editor/settingsComplete.ts` (incl. a "Record shortcut…" option).

**Adding a keybinding:** add an entry to `KEYBINDING_CATALOG` (core) and read `settings.keybindings.<id>` via `matchesKeybinding` at the handler — schema field, autocomplete, and default are derived automatically.

## Workspace Management

Workspaces are linked via Bun's `workspaces` in the root `package.json`: `core` exports `@oa/core`, which `app` (UI) and `cli` both import; `relay` is the hooks-only plugin. Add a dep with `cd <workspace> && bun add <package>`; `bun install` (root) syncs all.

## Module Organization

Module purposes are in the **Architecture** section above; this is just the layout.

```
core/src/
  server.ts sse.ts                    # HTTP + SSE + WS, mutating-route abstraction
  engine.ts vault.ts memory.ts agents.ts relay.ts graphBuilder.ts   # graph composition + builders (relay.ts = agent-graph registry)
  daemon.ts daemonGraph.ts daemonViz.ts   # claude-bot daemon state reader + daemon-mode graph + node-visual encoder
  drawing/   # .draw vector docs (model/geometry/smooth/render2d/paper/theme/export — pure, headless)
  graph.ts layout.ts layout-cache.ts community.ts          # types, layout, community detection
  files.ts frontmatter.ts wikilinks.ts tags.ts pathUtils.ts backup.ts
  asyncCache.ts changeClassifier.ts   # dedup cache + selective-invalidation classifier
  search.ts replace.ts templates.ts dailyNote.ts openFolder.ts   # back POST /search,/replace,/daily-note,/open-folder
  settings.ts                          # settings.yaml lifecycle (reconcile, per-vault write mutex, property registry)
  commands.ts keybindings.ts error.ts dates.ts basesData.ts tasks.ts tasks-query.ts terminal.ts
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
```

## Development Workflow

### Running the full stack
`cd app && bun run dev` runs the Tauri app + backend concurrently — open `http://localhost:1420/` (dev server) or the native Tauri window; backend on `:4321`. Tests: `bun test core`.

### Editing notes & hot-reload
- Editing a `.md` in the vault: server debounces 250ms → invalidates cache → bumps version → pushes SSE with changed paths + `dirty:{graph,tree}` flags; frontend re-fetches `/graph` (or just `/file`). A low-frequency `/version` poll recovers a silently-dropped SSE (proxy/sleep). Two edits within 250ms = only the second triggers an update.
- `bun run dev`: Vite hot-reloads `.tsx`/`.css` (preserves editor/graph state); the **backend restarts** on `core/src` changes (client auto-reconnects via the fallback poll); `settings.yaml` is re-read per request (no restart).

### Debugging
- **Graph not updating:** wait for the 250ms debounce + ≤5s poll; `curl :4321/version`; check the `/events` SSE stream in DevTools. Content-only edits set `dirty.graph=false` (rebuild skipped) — expected.
- **Terminal dead:** check the `/terminal` WebSocket (DevTools → WS); a crashed PTY needs an app restart.

(Performance characteristics are covered under **Performance Optimizations** below.)

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
- **`app/src/sanitizeHtml.ts` `sanitizeHtml(dirty)`** — DOMPurify wrapper for safe `innerHTML` of any vault-rendered HTML (markdown, live-preview, cards, calendar, export). Browser/headless-aware (passes input through when no `window`, so Bun tests work). Always route rendered HTML through it — used by `bases/markdown.ts`, `editor/htmlPreview.ts`, `editor/livePreview.ts`.

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
Debounced 250ms file-watch; version-based polling (refetch only when `/version` increments); backend-precomputed 2D/3D layouts (renderer morphs, no browser force-sim) cached in localStorage; lazy WebGL init; live-preview rescans only on content change; malformed-YAML-tolerant graph builder.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`), powering the "agents" graph. No daemon, nothing installed in `~/.claude` — the plugin loads per-session only inside app terminals.

`terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + the PATH shim so a bare `claude` auto-loads the plugin. Plugin hooks POST `/relay/*`: `SessionStart`/`UserPromptSubmit` register/heartbeat, `SubagentStart`/`SubagentStop` add/finish subagents (best-effort, no-op without `CLAUDE_TERMINAL_ID`). `agents.ts` builds the graph; `/agent-graph` prunes closed-tab sessions at read time.

Scope: app-local only. No cross-machine agents, no messaging. Registry lives only while the core server runs.

### Daemon Integration (`core/src/daemon.ts` + `daemonGraph.ts` + `daemonViz.ts`)

Bismuth reads (and minimally writes) the **claude-bot daemon's** shared on-disk state to power the "daemon" graph mode and the daemon sidebar (`app/src/DaemonList.tsx`, which replaces `ClusterLegend` in daemon mode). The daemon itself is a separate background process; Bismuth never starts/stops it.
- `daemon.ts` reads `device-id`/`devices.json`/`owner.json`/`daemon.pid` and the crons/processes under the daemon home (the `daemon.home` setting; defaults to `~/.claude-bot`). `daemonGraph.ts` turns crons/processes into a hub+children graph with `supervises` edges; `daemonViz.ts` is the pure node-visual encoder.
- Endpoints: GET `/daemon/status`, `/daemon/devices`, `/daemon/graph` (polled by the frontend only while in daemon mode), `/daemon/install`; POST `/daemon/owner` (claims this device — a vault mutation), and the shared-state writes `/daemon/setup`, `/daemon/cron/toggle`, `/daemon/cron/run`, `/daemon/process/toggle` (NOT vault mutations — no SSE/cache invalidation). Right-click a cron/process in `DaemonList` to enable/disable or run it.
- Setup is **idempotent / adopt-only**: it never clobbers, restarts, or repoints a live daemon (see the claude-bot setup contract).

## Testing

Tests use Bun's native test runner. Run with:
```bash
bun test core
bun test core -- [pattern]  # Filter by filename
```

Each module has a colocated `*.test.ts`. Notable: `core/test/{vault,engine,server,sse,layout,tasks,tasks-query,daemon,daemonViz}.test.ts`, `core/test/{bases,srs,drawing}/`, and frontend `app/src/{panes,settings}.test.ts`, `app/src/graph/{collide,labelSelection}.test.ts`, `app/src/calendar/*.test.ts`, `app/src/editor/{wikilink,tag,tableModel}.test.ts`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d`/`position3d` are computed in `core/src/layout.ts`, attached via `layout-cache.ts`; the renderer only morphs. If positions look wrong, suspect the backend layout.
- **File-watch debounce**: the 250ms debounce hides rapid successive edits (two within 250ms → only the second rebuilds).
- **SSE can silently die**: proxies/OS-sleep drop `/events` without a close — the fallback `/version` poll recovers it (`serverVersion.ts`, `telemetry.ts`).
- **Wikilink matching is filename-based, not path-based**: `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches are undefined.
- **Memory graph needs `OA_MEMORY`**: a missing/empty dir → empty "3rd brain".
- **Concurrent-instance port conflicts**: default 4321/1420 serve one instance; override ports for more (see "Running Multiple Agents Concurrently").
