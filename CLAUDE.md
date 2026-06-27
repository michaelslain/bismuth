# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
bun install                                       # from repo root (all 5 workspaces)
export BISMUTH_VAULT=/path/to/vault BISMUTH_MEMORY=/path/to/memory   # dev only; dirs must exist (legacy OA_VAULT/OA_MEMORY still read as a fallback)
cd app && bun run dev                             # Tauri app + backend on :4321
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian, built as a monorepo with seven workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: Backend server that manages vaults, builds knowledge graphs, and integrates with the per-vault daemon's memory
- **cli**: Command-line interface for managing vaults (`bismuth` binary)
- **app**: Tauri + Solid + TypeScript desktop application with CodeMirror editor and 3D/2D graph visualizations
- **relay**: A tiny Claude Code plugin (hooks only) reporting each terminal-tab session + subagents to core's in-process registry (the "agents" graph) AND injecting the vault's memory into those sessions (recall/collect) when the daemon is enabled (see Relay + Daemon Integration)
- **mcp**: A stdio MCP server (the `docs/` reference + `bismuth` CLI, token-frugal; plus `remember`/`recall`/`forget` when the daemon is enabled) — per-tab in dev, installed machine-wide by the bundled app (see MCP Integration)
- **memory**: `@bismuth/memory` — the pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL). Shared by the daemon, the relay recall/collect hooks, and the MCP memory tools; every entry point takes an explicit dir (`BISMUTH_MEMORY_DIR`)
- **daemon**: `@bismuth/daemon` — the per-vault daemon runtime, absorbed from the former standalone `claude-bot`. ONE machine process multiplexes every enabled vault's brain (memory + crons + processes + a conversation session); ships as a bundled binary run by launchd/systemd (see Daemon Integration)

The system treats knowledge as a "three-brain" model:
- **You** (self node): Central hub representing the user
- **2nd Brain** (vault): Personal knowledge base with wikilinks, tags, and YAML frontmatter
- **3rd Brain** (memory): the daemon's memory graph, stored per-vault under `<vault>/.daemon/memory`, linked to vault notes. Shown in the graph (`mem:` nodes + `about` edges) only when the vault's daemon is enabled.

## Environment Setup

`bun run dev` requires two env vars (errors if unset; both dirs must already exist): `BISMUTH_VAULT` (2nd-brain markdown vault) and `BISMUTH_MEMORY` (a memory dir for dev — note the live 3rd brain now sources from `<vault>/.daemon/memory`). Legacy `OA_VAULT`/`OA_MEMORY` are still read as a fallback. These env vars are **dev/standalone only** — the bundled `/Applications` app self-spawns its own core backend and resolves its vault from a saved `config.json` or a first-run native folder picker (see Desktop app & core sidecar).

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
- `bun run typecheck` (repo root) — `tsc --noEmit` per workspace (core/app/mcp/relay, own pinned TS each). The build/test gate does NOT type-check — run this to catch type regressions.
- Tests are located in `core/test/`

### Building
- `bun run build` (in `app/`) — Build Vite app for production
- `bun run tauri build` (in `app/`) — Build native Tauri executable

### Infrastructure
- `bun install` — Install dependencies for all workspaces
- `bun run core:serve` — Standalone core server (pass `--vault`/`--memory` or set `OA_VAULT`/`OA_MEMORY`)

### Running Multiple Agents Concurrently

Default ports `:4321`/`:1420` serve one instance. For more, override the port: `PORT=4322 bun run dev` (standalone server takes `--port`; frontend reads `VITE_API_BASE`).

## Architecture

### Core Backend (`core/`)

**Purpose**: Manages vault file system, builds knowledge graphs, watches for changes, serves HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve): caching, file watching, mutating-route abstraction, SSE broadcast, two WS upgrades: `/terminal` (PTY) + `/chat` (visual Claude chat, `chat.ts`). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, daemon writes). Also drives `/gcal/*` (Google Calendar sync) + a 60s auto-sync ticker. **Full reference: `docs/api/http-reference.md`.**
- `sse.ts` — Server-sent event registry. `formatEvent`, `createSseRegistry`. Pushes `{version, paths, dirty: {graph, tree}}` on file changes — graph/tree consumers use `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — Graph composition. Merges vault graph + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — Builds vault knowledge graph from markdown files. Two-pass algorithm: (1) create note nodes, (2) extract wikilinks + tags + frontmatter metadata, create edges
- `graph.ts` — Graph types. Node kinds: note/memory/agent/tag/self (the "you" hub — injected frontend-side from open tabs, `app/src/graph/youNode.ts`, NOT a backend builder) + daemon-mode daemon/cron/process (`DaemonVizState`). Edge kinds: link, message, about (memory→vault), tag, open (you→note), supervises (daemon→cron/process)
- `layout.ts` — Pure layout computation (pivot-MDS + force simulation). Produces 2D and 3D `Positions` maps used by the renderer
- `layout-cache.ts` — `attachLayout()` writes precomputed `position2d` / `position3d` onto graph nodes, keyed by vault. Frontend morphs between them instead of running its own force sim
- `files.ts` — File I/O: list markdown, read/write notes, path-traversal rejection
- `frontmatter.ts` — YAML frontmatter parsing; tolerates malformed YAML
- `wikilinks.ts` — Extract `[[WikiLink]]` patterns from markdown
- `tags.ts` — Extract `#tag` from frontmatter and markdown body
- `memory.ts` — Build memory graph from Claude-bot memory notes (in `mem:` namespace)
- `agents.ts` — builds the "agents" graph (you → terminal-tab sessions → subagents) from the relay registry; pure over a `RelaySnapshot` + live pty-id set
- `relay.ts` — in-process registry of terminal-tab Claude sessions + subagents, populated by relay hooks via `POST /relay/*`, pruned against the live pty set (see Relay Integration)
- `daemon.ts` — reads/writes the claude-bot daemon's shared state (device-id, devices.json, owner.json, daemon.pid); status/device/owner/cron/process accessors. Never throws. Home from `daemon.home`. See Daemon Integration
- `daemonGraph.ts` — Builds the "daemon" graph (daemon hub → cron/process nodes, `supervises` edges) from the daemon's on-disk crons/processes; `daemonSnapshot`/`buildDaemonGraph`/`daemonGraph`
- `daemonViz.ts` — Pure `nodeVisualState(state)` mapping a daemon node's `{enabled, running}` → visual tokens (fill/border/opacity): disabled = dim; running = solid palette fill; enabled-idle = `bg` (hollow) fill + palette border ring
- `backup.ts` — Git commit snapshot of vault
- `tasks.ts`, `tasks-query.ts` — Tasks extraction + query DSL (Obsidian Tasks-compatible)
- `terminal.ts` — PTY session manager for the in-app terminal tabs (`bun-pty`). Injects relay provenance (`CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL`) + a PATH shim so a bare `claude` auto-loads the relay plugin (`buildPtyEnv`, pure + tested)
- `chat.ts` — drives the visual Claude Code chat (`/chat` WS): one long-lived Agent-SDK `query()` session per chat over the user's own `claude` binary (machine-login auth, no API key), unified with terminal sessions. See `docs/chat/overview.md`
- `gcal/` — Google Calendar two-way sync (OAuth 2.0 + PKCE, three-phase pull/push/delete, conflict policies, RRULE recurrence, color mapping). State outside the vault at `~/.bismuth/gcal/`. See `docs/gcal/overview.md`
- `dates.ts` — Date math shared by tasks, SRS, calendar
- `basesData.ts` — Vault-wide data feed consumed by the Bases query engine
- `bases/` — Bases DSL: see "Bases" section below
- `srs/` — Spaced-repetition system: see "Flashcards / SRS" section below

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change. A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (graph/tree/both; content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`. The frontend opens one `EventSource("/events")` (`serverVersion.ts`), re-fetching `/graph` (or just `/file`) per event, with a low-freq `/version` poll as dropped-SSE fallback. Positions are backend-precomputed (`layout.ts`), not force-simulated in the browser.

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, styled with CSS modules

**Key components**:
- `App.tsx` — Root. Owns the tab + pane tree, active file routing, graph mode, settings persistence, global keyboard handling
- `panes.ts` — Pure binary-tree model for split panes (Leaf/Split nodes). Fully unit-tested in `panes.test.ts`
- `PaneTree.tsx` / `PaneContent.tsx` — Renders the pane tree; each Leaf hosts a note, Bases view, spreadsheet (`.sheet`), drawing (`.draw`, via `drawing/`), calendar, tasks, flashcards, terminal, a visual Claude chat (`ChatView`), or an export view (`export/`)
- `tabIds.ts` — Sentinel ids for non-file pane contents (`::graph`, `::search`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`/`::chat:`). Notes/bases/sheets/drawings/settings route by file path; no `::calendar` sentinel (calendar is a Bases view).
- `Editor.tsx` (CodeMirror) + `BlockEditor.tsx` (Milkdown WYSIWYG) — two note editor surfaces; the `editor.defaultMode` setting picks which one a note opens in (no per-note toggle, reactive live swap). WYSIWYG/block model detail in `docs/editor/blocks.md` (`blocks/`: `blockModel` lossless md↔blocks, `milkdownEditor`, `inlineNodes` chips, `FormatBar`)
- `editor/` — CodeMirror extensions (full detail in `docs/editor/`): live-preview (per-token reveal, focus-gated), bold/italic toggles (`markdownFormat`, Cmd+B/I), ordered + parity-bulleted lists, wikilink/tag autocomplete, ` ```query ` block, `![[file]]`/`![](url)` embeds, editable GFM tables (`tableModel`/`tableWidget`), in-note find bar (`findPanel`, cmd+f), KaTeX math + LaTeX highlight (`latexHighlight`) + macros (`mathMacros`), Harper spell+grammar, completed-task fold (`taskFold`), `settingsComplete`/`yamlSchema`
- `FileTree.tsx` — Left sidebar. Drag-drop moves, rename/move retargets active tab, undo support for deletes
- `ContextMenu.tsx` — Right-click menu for file tree and editor
- `GraphView.tsx` — Mounts the WebGL renderer and label layer, exposes mode/view toggles
- Settings have **no GUI page** — the "settings page" is `settings.yaml` opened in the editor, with schema-aware autocomplete (`editor/settingsComplete.ts`) + lint (`editor/yamlSchema.ts`). The schema (`core/src/schema/settingsSchema.ts`) is the single source of truth.
- `palette/` — `CommandPalette`, `QuickSwitcher`, shared `PaletteModal`
- `Flashcards.tsx` — Top-level SRS review view, routable via a sentinel id
- `Terminal.tsx` — xterm.js terminal tab, WebSocket-backed by `core/src/terminal.ts`
- `Toast.tsx`, `telemetry.ts` — Toasts, lightweight client telemetry
- `serverVersion.ts` — Single `EventSource` to `/events` + fallback `/version` poll
- `bases/` — Bases view renderers (Table, Cards, Kanban, List, Map, Calendar, Flashcards, Bar, Line, Stat, Heatmap, plus shared `renderValue`)
- `calendar/` — Calendar state + components (rendered as a Bases view — see "Calendar" below)
- `api.ts` — HTTP client for core
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

The `bismuth` binary (thin wrapper over `@bismuth/core`) controls the whole vault from the shell. File-based commands run **headlessly** (no server); the app's vault watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`OA_VAULT`.

- `src/index.ts` — dispatcher: merges every group into one registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap.
- `src/args.ts` (`flag`/`bool`/`positionals`/`requireVault`/`out`/`fail`…) + `src/types.ts` (`Command`/`CommandMap`) — the shared seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. Groups: `file`, `note`, `search`, `graph`, `task`, `base`(+`row*`), `card`, `prop`, `settings`(+`folder-icon`), `daemon` (no vault), `draw`, `serve`+`backup`, `export` (md|html|png; pdf+png of notes/bases browser-only, only `.draw`→png headless), `api` (`<METHOD> <path>` passthrough), `install` (machine-wide cli+mcp), `checkpoint` (git-ref bookmarks `refs/bismuth/<name>`; no vault, any `--dir`).

**Adding a command**: add a `Command` to a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` (overview, sources, query-syntax, filters, functions, query-block) + `docs/bases/views/` (per view kind). This is the conceptual summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas, and one or more views over the vault's notes (`FileView` routes a `type: base` note to `BaseView`). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`):
- `lexer.ts` → `parser.ts` → `parse.ts` — tokenize + parse the Bases grammar (filters, formulas, view configs)
- `evaluate.ts` — evaluate a parsed AST against a single note; `filters.ts` — `and`/`or`/`not`/comparisons
- `functions.ts` — built-in functions per value type (file/number/string/array/date), method-dispatch tables
- `query.ts` — apply a Base to the vault feed (`basesData.ts`) → rows + grouping

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (charts via `bases/chart.ts`). `BaseView.tsx` hosts/picks the renderer; `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` code block — the only embedded block (there is no ` ```base `/` ```view `/` ```tasks `). Its body is either a full inline base config (top-level `views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks: <dsl>`, `where:`, `group:`, `view:`). Rendered inline by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]`:
- `{ kind: "base", ref }` — render another base, resolving that base's OWN source recursively (composition), not just its static rows.
- `{ kind: "notes", where?, from? }` — vault notes filtered by a Bases expr; `from: [[Base]]` scopes to that base's notes.
- `{ kind: "tasks", where?, from? }` — checkbox tasks; `from: [[Base]]` scopes extraction to that base's notes (no `from` = global).

Frontmatter accepts a string (`source: notes where #book`) or object (`normalizeSource()`). Resolution is cycle-guarded + **server-side** via `POST /rows {spec}`. Perf: server caches the unscoped row feed (`cachedRows`); client keeps an SSE-version-keyed SWR cache (`bases/rowCache.ts`), reuses row identity (`reconcileRows.ts`) and skips irrelevant re-resolves (`changeRelevance.ts`). Body/tasks cards are inline-editable (`CardEditor.tsx`+`cardBodySplit.ts`).

In a flat block: `of: [[Base]]` renders that base, `tasks: <dsl>` runs a task query (optionally `from: [[Base]]`), `where:`/`view:` filter + pick the mode; neither `of:` nor `tasks:` → empty state.

**Scoped-tasks example**: a `Do Now` base with `source: tasks` + `from: "[[Google Keep]]"` shows only the tasks inside the `Google Keep` base's notes (not the whole vault).

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — there is no standalone calendar page. To open a calendar, create a `type: base` md with `views: [{ type: calendar }]` (or switch an existing base to calendar view). The calendar view is rendered by `app/src/bases/CalendarView.tsx`.

The `app/src/calendar/` directory holds the shared state + components the view consumes: `EventStore.ts` (CRUD + persistence), `state.ts` (reactive view state), `dates.ts`, `categoryColor.ts` (status→color), `refresh.ts`, `components/` (`EventChip`/`EventModal`/`RecurrenceDialog`/`CategoryPanel`/`Toolbar`) + `components/views/` (`Month`/`Week`/`ThreeDay`/`Day`/`TimeGrid`).

A calendar base can be **two-way-synced with Google Calendar** (`core/src/gcal/`, `GcalConnectModal.tsx`, `googleCalendar.*` settings) — full OAuth/sync detail in `docs/gcal/overview.md`.

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

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure model, unit-tested). Each Leaf holds a content id: a note path or a `tabIds.ts` sentinel (see the sentinel list above). `PaneTree.tsx` walks the tree; `PaneContent.tsx` routes a leaf id; per-window tab layout is keyed by `windowId.ts`.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class content — `PaneContent` routes it to a `GraphView` via `App`'s `renderGraph()` prop. `App` seeds a `::graph` tab when nothing is restored and reopens one if all tabs close (tabs are never empty); the sidebar mini-graph hides when a pane shows the graph.

**Tab renaming**: double/right-click → Rename sets a custom `name` on the `Leaf` (`panes.ts`), overriding `contentLabel()`; clear by renaming to empty.

### Commands & Sidebar Toolbar

Commands are split into pure data + behavior so the palette and the sidebar header bar (`.sidebar-icons`) share one source: `core/src/commands.ts` (`COMMAND_CATALOG` → the `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → live `{id,label,icon,action}` map; `resolveButtonCommands`).

The bar above the file tree is configured by `toolbar:` in `settings.yaml`. Each item: `{ command: <id> | commands: [<id>, …], icon, tooltip? }`. `commands` list wins; unresolved ids skip. Full command list: `docs/settings/toolbar-commands.md` (incl. `create-menu` "+Create" chooser w/ New-base submenu, `archive-tasks`, `detect-ai`, `find`).

**Adding a command:** add an entry to `COMMAND_CATALOG` (core) + an `action` binding in `bindCommands` (app); the enum, autocomplete, and palette pick it up. (A new *top-level* schema key also needs the key lists in `core/test/schema/settingsSchema.test.ts`.)

**File-menu commands**: `new-folder`/`new-note`, `export`, `new-window` (`?api=`), `open-folder` (`POST /open-folder` → sibling core server → `?api=` window).

**Runtime backend base** (`app/src/api.ts`): `resolveBase` picks the backend (`?api=<url>` > `window.__OA_API__` > `VITE_API_BASE` > `:4321`), so one build serves multiple windows; `apiBase()` builds `?api=` URLs.

### Keybindings

Global shortcuts come from `keybindings:` in `settings.yaml` (nothing hardcoded in `App.tsx`). Same split-data pattern as commands: `core/src/keybindings.ts` (`KEYBINDING_CATALOG` → schema) + `app/src/keybindings.ts` (`matchesKeybinding`). `"Mod"` = Cmd/Ctrl; matching is **exact**; combos comma-separated; matches the produced key OR physical `event.code`. The `keybind` PropertyType drives an order-free autocomplete in `editor/settingsComplete.ts` ("Record shortcut…").

**Adding a keybinding:** add an entry to `KEYBINDING_CATALOG` (core) and read `settings.keybindings.<id>` via `matchesKeybinding` at the handler — schema field, autocomplete, and default are derived automatically.

## Workspace Management

Workspaces are linked via Bun's `workspaces` in the root `package.json`: `core` exports `@bismuth/core`, which `app` (UI), `cli`, and `mcp` import; `relay` is the hooks-only plugin and `mcp` is the stdio MCP server (deps `@modelcontextprotocol/sdk`). Add a dep with `cd <workspace> && bun add <package>`; `bun install` (root) syncs all.

## Module Organization

Purposes are in **Architecture** above; this is the layout.

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
  commands.ts keybindings.ts error.ts dates.ts basesData.ts tasks.ts tasks-query.ts taskReorder.ts terminal.ts chat.ts bismuthInstall.ts claudeWhich.ts selfUpdate.ts fsPaths.ts
  bases/   # Bases DSL (lexer/parser/evaluate/filters/functions/query)
  srs/     # SRS (cards/parser/scheduler)
  gcal/    # Google Calendar two-way sync (oauth/pkce/client/sync/recurrence/colors/map/lock/manifest/state)
core/test/  # one *.test.ts per module; helpers.ts → makeSampleVault()

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane-tree model, routing
  Editor.tsx editor/   # CodeMirror wrapper + extensions (livePreview, autocomplete, foldBlocks, queryBlock, wikilink, tag, markdownFormat, settingsComplete…)
  BlockEditor.tsx blocks/   # Milkdown WYSIWYG surface (blockModel, milkdownEditor, inlineNodes, FormatBar); ChatView.tsx (visual Claude chat) + GcalConnectModal.tsx; closedSession.ts/navType.ts (tab-restore)
  FileTree.tsx fileTreeOps.ts ContextMenu.tsx nativeMenu.ts FolderPrompt.tsx EmptyPane.tsx
  GraphView.tsx GraphSearch.tsx ClusterLegend.tsx graph/   # graph shell + WebGL renderer, DOM LabelLayer, GraphAtmosphere (shared glow/vignette), youNode, agentGraphSig, collide, labelSelection
  FileView.tsx NoteTitle.tsx Flashcards.tsx Terminal.tsx SheetView.tsx sheet/ ExportView.tsx export/
  intro/   # first-run Vault Intro takeover (VaultIntro.tsx + marks.tsx; theme picker + power-ups; gated in index.tsx) — see Desktop app & core sidecar
  ai/      # local offline "Detect AI text" command (aiDetect.ts, transformers.js — no network)
  bases/ calendar/ palette/ drawing/   # feature view-sets (bases/: + CardEditor inline-editable cards, reconcileRows, changeRelevance)
  noteCache.ts windowId.ts baseViews.ts taskStatusMenu.tsx   # LRU note cache, per-window tab-storage keys, 12 base-view kinds, task-status context menu
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
3. Wire the consumer: **CSS** → a `--var` in `settingsCssVars.ts`; **frontend** → read `settings.<section>.<key>` (reactive); **backend** → `appConfig.<section>.<key>` (cached `loadAppConfig`). Edits persist via `POST /set-setting` (merges one key in place).

### Debugging graph construction
Run the server standalone (`bun run core/src/server.ts --vault <v> --memory <m>`), `curl :4321/graph | jq`; see `core/test/vault.test.ts` / `engine.test.ts` for examples.

### Adding a Bases function
Add a case to the `callFunction`/`callMethod` dispatch in `core/src/bases/functions.ts`, handle its return type in `query.ts` aggregation, and test in `core/test/bases/query.test.ts`.

### Adding an SRS scheduler variant
Extend `core/src/srs/scheduler.ts`; expose config in `settingsSchema.ts` and thread into `applyReview`.

## Error Handling

Backend errors use the `AppError` class (`core/src/error.ts`): `createError(code, msg)` (factory picks status from code) or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` to the response; generic `Error` → 500. Codes → status: `ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400, `INTERNAL_ERROR` 500.

## Shared Helpers (avoid re-duplicating)

- **`core/src/graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — file walk + read + index used by both `vault.ts` and `memory.ts`. Use it for any new graph source.
- **`core/src/files.ts` `walkDir(root, filter)`** — recursive dir walk behind `listTree`/`listTemplates`; filter returns `true`/`false`/`{data}`.
- **`core/src/frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits frontmatter via the `yaml` Document API (preserves comments/key order/flow arrays), falls back to stringify on malformed input.
- **Resilience**: `app/src/serverVersion.ts` tracks a `ConnectionState`; on SSE loss it toasts "Connection lost" and polls `/version` at 1s until reconnect.
- **`app/src/sanitizeHtml.ts` `sanitizeHtml(dirty)`** — DOMPurify wrapper for safe `innerHTML` of vault-rendered HTML (browser/headless-aware). Always route rendered HTML through it; build it with the canonical `app/src/htmlEscape.ts` (`escapeHtml`/`escapeAttr`), not per-file escapers.

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
Debounced file-watch + version-gated refetch + backend-precomputed layouts (see **Caching + data flow**); plus lazy WebGL init, content-gated live-preview rescans, malformed-YAML tolerance, and base loads via server row cache + client SWR cache (`bases/rowCache.ts`).

### Desktop app & core sidecar (`app/src-tauri/` + `app/scripts/build-core-sidecar.ts`)

The bundled `/Applications` app **spawns its own `core` backend** (not `bun run dev`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary (`bun build --compile`, via `externalBin`); on launch `src/lib.rs` picks a free port, spawns the sidecar, kills it on exit, injects `window.__OA_API__` (read by `api.ts` `resolveBase`). A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** (or a missing vault) it sets `window.__OA_FIRST_RUN__` and `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/`): theme-picker + power-ups slideshow whose CTA invokes the Tauri `choose_first_vault` command (writes config + seeds `settings.yaml` → relaunch). The build stages `resources/relay` + `resources/bismuth-tools` (machine-wide install on boot). Deep detail: `docs/overview/install.md`.

### MCP Integration (`mcp/` workspace)

A stdio [MCP](https://modelcontextprotocol.io) server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 5 tools (`bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed **machine-wide** on boot (`core/src/bismuthInstall.ts`, version-gated) → copies `bismuth`+`bismuth-mcp`+docs to `~/.bismuth`, symlinks cli onto PATH, registers in `~/.claude.json`. Deep detail: `docs/mcp/overview.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`), powering the "agents" graph. Loads per-session inside app terminals (bundled via `OA_RELAY_BUNDLE`; nothing in `~/.claude`). `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads the plugin. Hooks POST `/relay/*` (`SessionStart`/`UserPromptSubmit` register, `SubagentStart`/`SubagentStop` add/finish). `agents.ts` builds the graph; `/agent-graph` prunes closed-tab sessions. App-local; registry lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

The daemon was absorbed from the former standalone `claude-bot` into the **`@bismuth/daemon`** workspace. It's **one machine process that multiplexes per-vault brains**: machine-level identity (device-id/devices.json/owner.json/daemon.pid) lives at `~/.bismuth/daemon` (`daemonMachineDir()`, env `BISMUTH_DAEMON_DIR`); each enabled vault's brain — memory, crons, processes, and a conversation session — lives under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault each tick (vault-keyed state); a reconcile loop starts/pauses a vault's brain as `settings.daemon.enabled` flips. `sendMessage` passes the SDK per-call `cwd`=vault root, `env.BISMUTH_MEMORY_DIR`, `resume`=per-vault session-id, and the identity from `.daemon/identity.md` (name + personality), so concurrent vault sessions never race.

- **Lifecycle**: ships as a bundled binary (`app/scripts/build-daemon-sidecar.ts` → `resources/daemon`), copied to `~/.bismuth/bin` and run as a launchd/systemd **service** (NOT a Tauri child — it must outlive the app to keep firing crons). `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window onto its state for the "daemon" graph mode + sidebar (`app/src/DaemonList.tsx`). **NOTE: the Rust `lib.rs` install/spawn wiring is the one remaining piece — see the consolidation status.**
- **Memory injection** is per-session + vault-scoped: `terminal.ts` injects `BISMUTH_MEMORY_DIR` into Bismuth terminal PTYs only when the daemon is enabled; the relay plugin's recall (UserPromptSubmit) + collect (SessionEnd) hooks and the MCP `remember`/`recall`/`forget` tools all gate on it. There is **no** global `~/.claude/settings.json` hook anymore.
- **Migration**: on first enable per machine, `migrateDaemonState` COPIES a legacy `~/.claude-bot/{memory,crons,processes}` into `<vault>/.daemon` (copy-only — never deletes the source; machine-marker-gated to one vault).
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain/assistant surface (memory injection + `.daemon` folder visibility + 3rd-brain & daemon graph modes). The daemon's **name + personality** live together in **`<vault>/.daemon/identity.md`** (a normal markdown file shown in the sidebar): the `name:` frontmatter drives the folder label, the daemon-graph hub, and the bot's self-identity (`daemonIdentityName()` in core; the registry in `@bismuth/daemon`), and the body is its system prompt (read fresh per session via `appendSystemPrompt`, default seeded on setup). (`daemon.name`/`daemon.home`/`daemon.autoUpdate` were removed from settings.)

## Testing

Tests use Bun's native test runner. Run with:
```bash
bun test core
bun test core -- [pattern]  # Filter by filename
```

Each module has a colocated `*.test.ts`. Notable: `core/test/{vault,engine,server,sse,layout,tasks,tasks-query,daemon,daemonViz}.test.ts`, `core/test/{bases,srs,drawing}/`, and frontend `app/src/{panes,settings}.test.ts`, `app/src/graph/{collide,labelSelection}.test.ts`, `app/src/calendar/*.test.ts`, `app/src/editor/{wikilink,tag,tableModel}.test.ts`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d`/`position3d` are computed in `core/src/layout.ts`, attached via `layout-cache.ts`; the renderer only morphs.
- **Wikilink matching is filename-based, not path-based**: `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches are undefined.
- **File-watch debounce**: two edits within 250ms → only the second rebuilds. **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it. **Concurrent instances**: 4321/1420 serve one; override ports for more.
