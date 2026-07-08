# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
bun install                                       # from repo root (all 7 workspaces)
export BISMUTH_VAULT=/path/to/vault BISMUTH_MEMORY=/path/to/memory   # dev only; dirs must exist
cd app && bun run dev                             # Tauri app + backend on :4321
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian, built as a monorepo with seven workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: Backend server that manages vaults, builds knowledge graphs, and integrates with the per-vault daemon's memory
- **cli**: Command-line interface for managing vaults (`bismuth` binary)
- **app**: Tauri + Solid + TypeScript desktop application with CodeMirror editor and 3D/2D graph visualizations
- **relay**: A tiny Claude Code plugin (hooks only) reporting each terminal-tab session + subagents to core's in-process registry (the "agents" graph) AND injecting the vault's memory into those sessions (recall/collect) when the daemon is enabled (see Relay + Daemon Integration)
- **mcp**: A stdio MCP server (the `docs/` reference + `bismuth` CLI, token-frugal; plus `remember`/`recall`/`forget` when the daemon is enabled) — per-tab in dev, installed machine-wide by the bundled app (see MCP Integration)
- **memory**: `@bismuth/memory` — the pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL). Shared by the daemon, relay recall/collect hooks, and MCP memory tools; every entry point takes an explicit dir (`BISMUTH_MEMORY_DIR`)
- **daemon**: `@bismuth/daemon` — per-vault daemon runtime; ONE machine process multiplexes every enabled vault's brain (memory + crons + processes + a conversation session); bundled binary run by launchd/systemd (see Daemon Integration)

The system treats knowledge as a "three-brain" model:
- **You** (self node): central hub representing the user
- **2nd Brain** (vault): personal knowledge base with wikilinks, tags, YAML frontmatter
- **3rd Brain** (memory): the daemon's memory graph, stored per-vault under `<vault>/.daemon/memory`, linked to vault notes. Shown in the graph (`mem:` nodes + `about` edges) only when the vault's daemon is enabled.

## Environment Setup

`bun run dev` requires two env vars (errors if unset; both dirs must exist): `BISMUTH_VAULT` (2nd-brain markdown vault) + `BISMUTH_MEMORY` (a dev memory dir — the live 3rd brain now sources from `<vault>/.daemon/memory`). **Dev/standalone only** — the bundled `/Applications` app self-spawns its core backend and resolves its vault from a saved `config.json` or a first-run native folder picker (see Desktop app & core sidecar).

## Documentation

`docs/` (committed) is the exhaustive, code-anchored reference — bases/view/settings syntax, CLI, daemon, storage, HTTP API, MCP. Start at `docs/README.md`; keep it current.

## Key Commands

### Development
- `bun run dev` (in `app/`) — Tauri app + backend concurrently with hot reload. Requires `BISMUTH_VAULT` + `BISMUTH_MEMORY` env vars; no default vault
- `bun start` — Vite dev server only (app/)
- `bun run core/src/server.ts --vault <v> --memory <m>` — backend standalone (both flags required)

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
- `bun run core:serve` — Standalone core server (pass `--vault`/`--memory` or set `BISMUTH_VAULT`/`BISMUTH_MEMORY`)

### Running Multiple Agents Concurrently

Default ports `:4321`/`:1420` serve one instance. For more, override: `PORT=4322 bun run dev` (standalone server takes `--port`; frontend reads `VITE_API_BASE`).

## Architecture

### Core Backend (`core/`)

**Purpose**: manages the vault filesystem, builds knowledge graphs, watches for changes, serves the HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve): caching, file watching, mutating-route abstraction, SSE broadcast, three WS upgrades: `/terminal` (PTY) + `/chat` (visual Claude chat, `chat.ts`) + `/ui` (per-window app-control channel, `uiControl.ts`). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, `/ui/windows`, `/ui/command`, daemon writes). Also drives `/gcal/*` + a 60s auto-sync ticker; writes a run-registry record (`runRegistry.ts`) on boot for out-of-app discovery. **Full reference: `docs/api/http-reference.md`.**
- `sse.ts` — SSE registry (`formatEvent`, `createSseRegistry`): pushes `{version, paths, dirty:{graph,tree}}` on file changes — consumers use the `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — graph composition: merges vault + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — builds vault graph from markdown, two-pass: (1) create note nodes, (2) extract wikilinks + tags + frontmatter, create edges
- `graph.ts` — Graph types. Node kinds: note/memory/agent/tag/self (the "you" hub — injected frontend-side from open tabs via `app/src/graph/youNode.ts`, NOT a backend builder) + daemon-mode daemon/cron/process. Edge kinds: link, message, about (memory→vault), tag, open (you→note), supervises (daemon→cron/process)
- `layout.ts` — pure layout (pivot-MDS + force sim) → 2D + 3D `Positions` maps. `layout-cache.ts` — `attachLayout()` writes precomputed `position2d`/`position3d` onto nodes, keyed by vault; frontend morphs between them instead of its own force sim
- `files.ts` — file I/O: list markdown, read/write notes, path-traversal rejection. `frontmatter.ts` — YAML parse, tolerates malformed. `wikilinks.ts` — extract `[[WikiLink]]`. `tags.ts` — extract `#tag` from frontmatter + body. `memory.ts` — build memory graph from memory notes (`mem:` namespace)
- `agents.ts` — builds the "agents" graph (you → terminal-tab sessions → subagents) from the relay registry; pure over a `RelaySnapshot` + live pty-id set
- `relay.ts` — in-process registry of terminal-tab Claude sessions + subagents, populated by relay hooks via `POST /relay/*`, pruned against the live pty set
- `uiControl.ts` — in-process registry of OPEN app WINDOWS + a request/reply command channel to each (the `/ui` WS): powers the `app` CLI group + MCP app control (list/open/close/focus tabs, run a safe command). Pure over injectable sockets, unit-tested like `relay.test.ts`. `runRegistry.ts` — `~/.bismuth/run/<vault>.json` records so an out-of-app caller (the `bismuth app …` CLI, the daemon) discovers which port serves which vault
- `daemon.ts` — reads/writes the daemon's shared state (device-id, devices.json, owner.json, daemon.pid); status/device/owner/cron/process accessors. Never throws. See Daemon Integration
- `daemonGraph.ts` — builds the "daemon" graph (daemon hub → cron/process nodes, `supervises` edges) from on-disk crons/processes; `daemonSnapshot`/`buildDaemonGraph`/`daemonGraph`
- `daemonViz.ts` — pure `nodeVisualState(state)` mapping `{enabled, running}` → visual tokens: disabled = dim; running = solid palette fill; enabled-idle = `bg` (hollow) fill + palette border ring
- `backup.ts` — git commit snapshot of vault. `tasks.ts`/`tasks-query.ts` — Tasks extraction + query DSL (Obsidian Tasks-compatible)
- `terminal.ts` — PTY session manager for in-app terminal tabs (`bun-pty`); injects relay provenance (`CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL`) + a PATH shim so a bare `claude` auto-loads the relay plugin (`buildPtyEnv`, pure + tested)
- `chat.ts` — drives the visual Claude chat (`/chat` WS): one long-lived Agent-SDK `query()` session per chat over the user's own `claude` binary (machine-login auth, no API key). See `docs/chat/overview.md`
- `gcal/` — Google Calendar two-way sync (OAuth 2.0 + PKCE, three-phase pull/push/delete, conflict policies, RRULE recurrence, colors). State at `~/.bismuth/gcal/`. See `docs/gcal/overview.md`
- `dates.ts` — date math shared by tasks/SRS/calendar. `basesData.ts` — vault-wide data feed for the Bases query engine
- `bases/` — Bases DSL: see "Bases" section below
- `srs/` — Spaced-repetition system: see "Flashcards / SRS" section below

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change. A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (graph/tree/both; content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`. Frontend opens one `EventSource("/events")` (`serverVersion.ts`), re-fetching `/graph` (or just `/file`) per event, with a low-freq `/version` poll as dropped-SSE fallback. Positions are backend-precomputed (`layout.ts`), not force-simulated in the browser.

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, CSS modules.

**Key components**:
- `App.tsx` — root: owns the tab + pane tree, active file routing, graph mode, settings persistence, global keyboard handling
- `panes.ts` — pure binary-tree model for split panes (Leaf/Split nodes), unit-tested in `panes.test.ts`
- `PaneTree.tsx`/`PaneContent.tsx` — render the pane tree; each Leaf hosts a note, Bases view, spreadsheet (`.sheet`), drawing (`.draw`), calendar, tasks, flashcards, terminal, visual Claude chat (`ChatView`), or export view (`export/`)
- `tabIds.ts` — sentinel ids for non-file pane contents (`::graph`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`/`::chat:`). Notes/bases/sheets/drawings/settings route by file path; no `::calendar` sentinel (calendar is a Bases view) and no `::search` sentinel — search is the unified Cmd+O switcher takeover (`palette/SwitcherBar.tsx`: fuzzy file matches + keyword content matches + Bismuth AI escalation), which the `search` command also opens; legacy persisted `::search` tabs migrate to `::graph` on restore (`panes.ts`).
- `Editor.tsx` (CodeMirror) + `BlockEditor.tsx` (Milkdown WYSIWYG) — two note surfaces; `editor.defaultMode` picks which a note opens in (no per-note toggle, reactive live swap). Block-model detail in `docs/editor/blocks.md` (`blocks/`: `blockModel` lossless md↔blocks, `milkdownEditor`, `inlineNodes` chips, `FormatBar`).
- `editor/` — CodeMirror extensions (detail in `docs/editor/`): live-preview (per-token reveal, focus-gated, incl. `callout.ts` admonitions + `mathBlock.ts` multi-line math), `enterKeymap.ts` (list-continuation + math-fence Enter guards), bold/italic toggles, ordered + parity-bulleted lists, wikilink/tag/slash autocomplete (`slashMenu.ts`+`slashComplete.ts`), ` ```query ` block, embeds, editable GFM tables, find bar, KaTeX+LaTeX (`latexHighlight`/`mathMacros`), Harper spell+grammar, completed-task fold, `settingsComplete`/`yamlSchema`. `editorRegistry.ts` tracks live views + flushes autosaves before renames.
- `FileTree.tsx` — left sidebar: drag-drop moves, rename/move retargets active tab, delete undo (toast+Cmd+Z), multi-select, icon picker, system-folder protection (`.settings`/`.daemon` can't be renamed/deleted/dragged). `ContextMenu.tsx` — right-click menu. `GraphView.tsx` — mounts the Canvas2D renderer, exposes mode/view toggles
- Settings have **no GUI page** — the "settings page" is `.settings` (a single hidden, extensionless file per vault; `SETTINGS_FILE` in `core/src/settings.ts`, migrated from the legacy `settings.yaml`) opened in the editor like any note, with schema-aware autocomplete (`editor/settingsComplete.ts`) + lint (`editor/yamlSchema.ts`). Schema (`core/src/schema/settingsSchema.ts`) = single source of truth.
- `palette/` — `CommandPalette`, shared `PaletteModal`, and `SwitcherBar` + `switcherAi`/`switcherModel` (the unified Cmd+O search takeover — the app's ONE search surface). `Flashcards.tsx` — top-level SRS review view (sentinel id). `Terminal.tsx` — xterm.js tab, WS-backed by `core/src/terminal.ts`. `Toast.tsx`/`telemetry.ts` — toasts + client telemetry. `serverVersion.ts` — single `EventSource` to `/events` + fallback `/version` poll
- `bases/` — Bases view renderers (Table, Cards, Kanban, List, Map, Calendar, Flashcards, Bar, Line, Stat, Heatmap, + shared `renderValue`) plus `markdown.ts`: the shared markdown→HTML rendering engine (KaTeX, callouts, wikilinks, tags, code masking, PDF page-break markers) used by notes, cards, transclusion, and export alike. `calendar/` — calendar state + components (a Bases view). `api.ts` — HTTP client for core
- `settings.ts` — settings store: seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves via `POST /set-setting` (`settingsDiff.ts`) so the backend merges in place without clobbering comments. `Settings` mirrors the schema (`settings.parity.test.ts`).
- `settingsCssVars.ts` — projects appearance/ui/calendar/terminal settings into `:root` CSS custom properties; stylesheets reference via `var(--name, fallback)`.

**Graph rendering**:
- `graph/CanvasGraphRenderer.ts` — plain Canvas-2D renderer (NOT WebGL/GPU) for both 2D (flat birdseye) + 3D (volumetric orbit) modes: full 3D camera math + hit-testing/hover/drag-orbit/pan/zoom/labels drawn in one pass per frame; only rescales the backend's precomputed layouts (no client-side force re-simulation). `graph/AgentsGraph.tsx` — cards + org-picker overlay for "agents" mode (`agentGraphSig.ts`/`agentLayout.ts`/`agentOrg.ts`)
- `graph/labelSelection.ts` — pure `computeAlwaysOnSet` (top-N nodes by undirected edge count), unit-tested. `graph/collide.ts` — per-node collision-radius helpers (big hubs repel as their drawn circle).

**Styling**: `App.css` = global styles + CSS vars for theme/accent/fonts; component styles colocated with components.

### CLI (`cli/`)

The `bismuth` binary (thin wrapper over `@bismuth/core`) controls the whole vault from the shell. File-based commands run **headlessly** (no server); the app's vault watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`BISMUTH_VAULT`.

- `src/index.ts` — dispatcher: merges every group into one registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap. `src/args.ts` (`flag`/`bool`/`positionals`/`requireVault`/`out`/`fail`…) + `src/types.ts` (`Command`/`CommandMap`) = the shared seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. Groups: `file`, `note`, `search`, `graph`, `task`, `base`(+`row*`), `card`, `prop`, `settings`(+`folder-icon`), `daemon` (no vault), `draw`, `serve`+`backup`, `export` (md|html|png; pdf+png of notes/bases browser-only, only `.draw`→png headless), `api` (`<METHOD> <path>` passthrough), `app` (drives a RUNNING app's tabs via `/ui/*` — needs a server; core discovery `--api`>`BISMUTH_API`>`CLAUDE_RELAY_URL`>run-registry>`:4321`), `page` (daemon inbox: list/create/resolve — headless), `install` (machine-wide cli+mcp), `checkpoint` (git-ref bookmarks `refs/bismuth/<name>`; no vault, any `--dir`).

**Adding a command**: add a `Command` to a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` + `docs/bases/views/` (per view kind). This is the conceptual summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas, and views over the vault's notes (`FileView` routes a `type: base` note to `BaseView`). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`): `lexer.ts`→`parser.ts`→`parse.ts` (tokenize + parse the grammar: filters, formulas, view configs); `evaluate.ts` (AST against a single note) + `filters.ts` (`and`/`or`/`not`/comparisons); `functions.ts` (built-ins per value type — file/number/string/array/date, method-dispatch tables); `query.ts` (apply a Base to the vault feed `basesData.ts` → rows + grouping).

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (charts via `bases/chart.ts`). `BaseView.tsx` picks the renderer; `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` code block — the only embedded block (no ` ```base `/` ```view `/` ```tasks `). Its body is either a full inline base config (top-level `views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks: <dsl>`, `where:`, `group:`, `view:`). Rendered inline by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]`:
- `{ kind: "base", ref }` — render another base, resolving that base's OWN source recursively (composition), not just its static rows.
- `{ kind: "notes", where?, from? }` — vault notes filtered by a Bases expr; `from: [[Base]]` scopes to that base's notes.
- `{ kind: "tasks", where?, from? }` — checkbox tasks; `from: [[Base]]` scopes extraction (no `from` = global).

Frontmatter accepts a string (`source: notes where #book`) or object (`normalizeSource()`). Resolution is cycle-guarded + **server-side** via `POST /rows {spec}`. Perf: server caches the unscoped feed (`cachedRows`); client keeps an SSE-version-keyed SWR cache (`bases/rowCache.ts`), reuses row identity (`reconcileRows.ts`), skips irrelevant re-resolves (`changeRelevance.ts`). Body/tasks cards inline-editable (`CardEditor.tsx`+`cardBodySplit.ts`).

In a flat block: `of: [[Base]]` renders that base, `tasks: <dsl>` runs a task query (optionally `from: [[Base]]`, e.g. scoping to one base's notes), `where:`/`view:` filter + pick the mode; neither → empty state.

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — no standalone page. Open one via a `type: base` md with `views: [{ type: calendar }]`; rendered by `app/src/bases/CalendarView.tsx`. `app/src/calendar/` holds shared state + components: `EventStore.ts` (CRUD + persistence), `state.ts`, `dates.ts`, `categoryColor.ts`, `refresh.ts`, `components/` (`EventChip`/`EventModal`/`RecurrenceDialog`/`CategoryPanel`/`Toolbar`) + `components/views/` (`Month`/`Week`/`ThreeDay`/`Day`/`TimeGrid`). A calendar base can be **two-way-synced with Google Calendar** (`core/src/gcal/`, `GcalConnectModal.tsx`) — detail in `docs/gcal/overview.md`.

### Tasks (`core/src/tasks*.ts`)

Obsidian-Tasks-compatible. Tasks are a **base source** (`source: tasks`, optionally `from: [[Base]]`), not standalone — a focused list is just a base (see Bases "Sources & composition"), queried via a ` ```query ` block with `tasks: <dsl>` (no separate ` ```tasks ` block). `tasks.ts` extracts task items from markdown (status, due/scheduled/start, recurrence, tags; `collectTasksFromPaths` scopes to a subset); `tasks-query.ts` = query DSL (error-collecting, relative dates, sort, AND/OR); `bases/taskRow.ts` (`taskToRow`/`filterTaskRows`) projects tasks as base `Row`s; `POST /tasks/toggle` rewrites the markdown line.

### Flashcards / SRS (`core/src/srs/` + `app/src/bases/FlashcardsView.tsx`)

Spaced-repetition reviews. Flashcards are a **Bases view kind** (`flashcards`) over a base's rows — UI is `app/src/bases/FlashcardsView.tsx`, not a standalone page. Two code paths share `srs/scheduler.ts` (SM-2 next-due/ease) + `srs/types.ts`:
- **Markdown cards** — `srs/parser.ts` parses `?`/`??` from notes; `srs/cards.ts` = model + persistence + `applyReview`.
- **Row cards** — a base's rows with front/back/due/ease/interval columns; `srs/reviewRow.ts` `applyReviewToRow` applies SM-2 to scheduling columns.
- `app/src/bases/flashcardsQueue.ts` — pure, unit-tested queue logic: `buildQueue(rows, dueField, today, cram, bidirectional)`, `nextPosAfterGrade`.
- **Bidirectional** (toggle in `BaseSettings.tsx`): each row yields forward + reverse entries, reverse scheduled independently in `*Back` columns (via `backField`). **Cram mode** reviews everything ignoring due dates, never writes scheduling.
- Endpoints: `/cards/{decks,all,note,due}` (GET); `POST /cards/review` is dual-mode (`{id, response}` → markdown, `{file, index, …}` → row). Card add/edit/delete/reorder → `POST /row/{update,delete,reorder}` (`bases/rowOps.ts`); `EditCardsModal.tsx` = deck editor.

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs. Backend spawns a PTY via `bun-pty`, bridges over WebSocket on `/terminal`; frontend renders with xterm.js, ANSI palette wired from the graph theme (`buildAnsiPalette`), DOM-rendered (not canvas), styled to match the editor. Each PTY's env (`buildPtyEnv`, pure + tested) injects relay provenance + a PATH shim (`relay/shim/claude`) so a bare `claude` auto-loads the relay plugin via `--plugin-dir`; falls back to a plain shell if `claude` isn't found (`Bun.which`). See Relay Integration.

### Sheets (`app/src/SheetView.tsx` + `app/src/sheet/`)

A `.sheet` file is a Univer workbook JSON snapshot (`@univerjs/presets` v0.25), code-split via dynamic `import()` behind `sheet/univerSheet.ts`. `sheet/snapshot.ts` (parse/serialize) + `sheet/sync.ts` (`isExternalChange` gates reloads). `PaneContent` routes `*.sheet` → `SheetView`; created via "New Spreadsheet".

### Drawing (`app/src/drawing/` + `core/src/drawing/`)

A `.draw` file is a versioned JSON `DrawingDoc` (pages, strokes, `images?: ImageEl[]`, paper background) — a multi-page vector sketch surface routed by `PaneContent.tsx` (lazy `DrawingPage.tsx`), created via "New Drawing".
- **Backend (`core/src/drawing/`, pure + headless)**: `model.ts` (schema/serialize), `geometry.ts` (perfect-freehand outlines), `smooth.ts` (spline relaxation), `render2d.ts` (Canvas 2D, highlighter multiply-blend), `paper.ts` (blank/lines/grid/dots), `theme.ts` (7-color palette), `export.ts` (`renderDocToPng`/`renderDocToPdf` via `@napi-rs/canvas`+`pdf-lib`, headless).
- **Frontend (`app/src/drawing/`)**: `DrawingCanvas.tsx` (dual canvas — committed base + live draft; stylus pressure/velocity width, module-level image cache), `Toolbar.tsx`, `store.ts` (pages + undo/redo), `input.ts`, `pdfRaster.ts` (client-side PDF→per-page raster via pdf.js). `DrawingPage.tsx` also drives **image/PDF markup**: opening an image or PDF auto-creates a `.draw` sidecar so it can be annotated like a drawing. Persisted via generic `PUT /file` (no dedicated route); raw input lag-free, smoothing on pointer-release.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure, unit-tested). Each Leaf holds a content id: a note path or a `tabIds.ts` sentinel. `PaneTree.tsx` walks the tree; `PaneContent.tsx` routes a leaf id; per-window tab layout keyed by `windowId.ts`.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class content — `PaneContent` routes it to a `GraphView` via `App`'s `renderGraph()` prop. `App` seeds a `::graph` tab when nothing is restored and reopens one if all tabs close (tabs never empty); the sidebar mini-graph hides when a pane shows the graph. **Tab renaming**: double/right-click → Rename sets a custom `name` on the `Leaf` (`panes.ts`), overriding `contentLabel()`; clear by renaming to empty.

### Commands & Sidebar Toolbar

Commands are split into pure data + behavior so the palette and sidebar header bar (`.sidebar-icons`) share one source: `core/src/commands.ts` (`COMMAND_CATALOG` → `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → live `{id,label,icon,action}` map; `resolveButtonCommands`). The bar above the file tree is configured by `toolbar:` in `.settings` — each item `{ command: <id> | commands: [<id>, …], icon, tooltip? }` (`commands` list wins; unresolved ids skip). Full list: `docs/settings/toolbar-commands.md` (incl. `create-menu`, `archive-tasks`, `detect-ai`, `find`).

**Adding a command:** add to `COMMAND_CATALOG` (core) + an `action` in `bindCommands` (app); enum/autocomplete/palette pick it up. (A new *top-level* schema key also needs the key lists in `core/test/schema/settingsSchema.test.ts`.)

**File-menu commands**: `new-folder`/`new-note`, `export`, `new-window` (`?api=`), `open-folder` (`POST /open-folder` → sibling core server → `?api=` window). **Runtime backend base** (`app/src/api.ts`): `resolveBase` picks the backend (`?api=<url>` > `window.__BISMUTH_API__` > `VITE_API_BASE` > `:4321`), so one build serves multiple windows; `apiBase()` builds `?api=` URLs.

### Keybindings

Global shortcuts come from `keybindings:` in `.settings` (nothing hardcoded in `App.tsx`). Same split-data pattern as commands: `core/src/keybindings.ts` (`KEYBINDING_CATALOG` → schema) + `app/src/keybindings.ts` (`matchesKeybinding`). `"Mod"` = Cmd/Ctrl; matching **exact**; combos comma-separated; matches produced key OR physical `event.code`. **Adding one:** add to `KEYBINDING_CATALOG` (core), read `settings.keybindings.<id>` via `matchesKeybinding` — schema/autocomplete/default derived automatically.

## Workspace Management

Workspaces are linked via Bun's `workspaces` in the root `package.json`: `core` exports `@bismuth/core`, which `app`/`cli`/`mcp` import; `relay` is the hooks-only plugin, `mcp` the stdio MCP server. Add a dep with `cd <workspace> && bun add <package>`; `bun install` (root) syncs all.

## Module Organization

Purposes are in **Architecture** above; this is the layout.

```
core/src/
  server.ts sse.ts                    # HTTP + SSE + WS, mutating-route abstraction
  engine.ts vault.ts memory.ts agents.ts relay.ts uiControl.ts runRegistry.ts graphBuilder.ts   # graph composition + builders (relay = agent-graph registry; uiControl = app-control window channel; runRegistry = port discovery)
  daemon.ts daemonGraph.ts daemonViz.ts daemonState.ts   # daemon: state reader + daemon-mode graph + node-visual encoder + shared file-read helpers
  drawing/   # .draw vector docs (model/geometry/smooth/render2d/paper/theme/export — pure, headless)
  graph.ts layout.ts layout-cache.ts community.ts          # types, layout, community detection
  files.ts frontmatter.ts wikilinks.ts tags.ts pathUtils.ts backup.ts
  asyncCache.ts changeClassifier.ts   # dedup cache + selective-invalidation classifier
  search.ts replace.ts templates.ts dailyNote.ts openFolder.ts   # back POST /search,/replace,/daily-note,/open-folder
  settings.ts                          # .settings lifecycle (reconcile, per-vault write mutex, property registry)
  commands.ts keybindings.ts error.ts dates.ts basesData.ts tasks.ts tasks-query.ts taskReorder.ts terminal.ts chat.ts bismuthInstall.ts claudeWhich.ts selfUpdate.ts fsPaths.ts
  bases/   # Bases DSL (lexer/parser/evaluate/filters/functions/query)
  srs/     # SRS (cards/parser/scheduler)
  gcal/    # Google Calendar two-way sync (oauth/pkce/client/sync/recurrence/colors/map/lock/manifest/state)
core/test/  # one *.test.ts per module; helpers.ts → makeSampleVault()

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane-tree model, routing
  Editor.tsx editor/   # CodeMirror wrapper + extensions (livePreview, autocomplete, foldBlocks, queryBlock, wikilink, tag, markdownFormat, settingsComplete…)
  BlockEditor.tsx blocks/   # Milkdown WYSIWYG surface (blockModel, milkdownEditor, inlineNodes, FormatBar); ChatView.tsx + chatContext.ts (visual Claude chat, editor-tab context injection); closedSession.ts/navType.ts (app-wide tab-restore, not chat-specific)
  FileTree.tsx fileTreeOps.ts ContextMenu.tsx nativeMenu.ts FolderPrompt.tsx EmptyPane.tsx
  GraphView.tsx GraphSearch.tsx ClusterLegend.tsx graph/   # graph shell + Canvas2D CanvasGraphRenderer, AgentsGraph overlay, GraphAtmosphere (shared glow/vignette), youNode, agentGraphSig, collide, labelSelection
  FileView.tsx NoteTitle.tsx Flashcards.tsx Terminal.tsx SheetView.tsx sheet/ ExportView.tsx export/
  intro/   # first-run Vault Intro takeover (VaultIntro.tsx + marks.tsx; theme picker + power-ups; gated in index.tsx) — see Desktop app & core sidecar
  ai/      # local offline "Detect AI text" command (aiDetect.ts, transformers.js — no network)
  bases/ calendar/ palette/ drawing/   # feature view-sets (bases/: + CardEditor inline-editable cards, reconcileRows, changeRelevance)
  noteCache.ts windowId.ts baseViews.ts taskStatusMenu.tsx   # LRU note cache, per-window tab-storage keys, 12 base-view kinds, task-status context menu
  ui/      # shared primitives (Button/IconButton/TextButton/IconTextButton, Chip, Stars, StatusDot, ViewBar, SearchBar, SegmentedToggle, TextInput, Select, Field, EmptyState, Modal, gallery/, popover/) + buttonClass
  icons/ dnd/   # Lucide Icon+registry+picker; drag-drop geometry + viewDrag
  api.ts serverVersion.ts uiControlClient.ts settings.ts settingsCssVars.ts settingsDiff.ts keybindings.ts themes.ts appWindow.ts nativeAppMenu.ts   # uiControlClient = the /ui app-control socket, wired in App.tsx beside the tab-persistence effect
  Toast.tsx telemetry.ts App.css   # toasts, client telemetry, global styles + CSS vars
app/src-tauri/   # Tauri shell (Rust): lib.rs spawns the core sidecar + first-run vault picker (see Desktop app & core sidecar)

mcp/src/
  docs.ts cli.ts memory.ts server.ts   # stdio MCP server: docs index/search/read + CLI bridge + memory tools = 5 always-on + 3 daemon-gated (see MCP Integration). App control adds ZERO tools — it rides bismuth_cli (the `app`/`page` CLI groups)
relay/   # Claude Code plugin: hooks/ (→ POST /relay/*) + shim/ (zsh claude wrapper) + .mcp.json (declares the bismuth MCP, dev); see Relay Integration
daemon/src/lib/bismuthPaths.ts   # existsSync-gated ~/.bismuth/bin paths (mcp/cli/docs) — the daemon session's explicit MCP wiring (literal dup of bismuthInstall.ts, like claudeWhich.ts)
```

## Development Workflow

- **Full stack**: `cd app && bun run dev` runs Tauri app + backend concurrently — open `http://localhost:1420/` or the native window; backend on `:4321`. Tests: `bun test core`.
- **Hot-reload**: Vite hot-reloads `.tsx`/`.css` (state preserved); **backend restarts** on `core/src` changes; `.settings` re-read per request (no restart). Vault `.md` edit → debounce → invalidate → version bump → SSE → frontend re-fetch (see **Caching + data flow**).
- **Debug graph-not-updating**: wait the 250ms debounce + ≤5s poll; `curl :4321/version`; watch `/events` in DevTools. Content-only edits set `dirty.graph=false` (rebuild skipped) — expected. **Terminal dead**: check the `/terminal` WS; a crashed PTY needs an app restart.

## Common Tasks

- **Add a core endpoint**: add a route to `routes` (read) or `mutatingRoutes` (write) in `core/src/server.ts`; mutating routes go through `mutatingHandler` (auto cache-invalidate + SSE — don't bump version manually). Add a `core/test/server.test.ts` case.
- **Add a graph node/edge kind**: update `NodeKind`/`EdgeKind` in `core/src/graph.ts`, emit from the extractors (`buildVaultGraph()` in `vault.ts`), adjust frontend mode filtering in `App.tsx` if needed.
- **Add a setting** (schema is the single source of truth; defaults must equal the current hardcoded value so upgrades are a no-op): (1) add an entry (type, `default`, `min`/`max` or enum, `doc`) to `core/src/schema/settingsSchema.ts` — `DEFAULTS`/autocomplete/linter/`reconcileSettings` pick it up; (2) add the field to the `Settings` interface in `app/src/settings.ts` (`settings.parity.test.ts` enforces parity); (3) wire the consumer — CSS `--var` in `settingsCssVars.ts`, frontend `settings.<section>.<key>` (reactive), backend `appConfig.<section>.<key>` (`loadAppConfig`). Persist via `POST /set-setting`.
- **Debug graph construction**: run standalone (`bun run core/src/server.ts --vault <v> --memory <m>`), `curl :4321/graph | jq`; see `core/test/vault.test.ts`/`engine.test.ts`.
- **Add a Bases function**: add a case to `callFunction`/`callMethod` in `core/src/bases/functions.ts`, handle its return type in `query.ts`, test in `core/test/bases/query.test.ts`.
- **Add an SRS scheduler variant**: extend `core/src/srs/scheduler.ts`; expose config in `settingsSchema.ts`, thread into `applyReview`.

## Error Handling

Backend errors use the `AppError` class (`core/src/error.ts`): `createError(code, msg)` or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` to the response; generic `Error` → 500. Codes → status: `ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400, `INTERNAL_ERROR` 500.

## Shared Helpers (avoid re-duplicating)

- **`core/src/graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — file walk + read + index used by `vault.ts` + `memory.ts`. Use it for any new graph source.
- **`core/src/files.ts` `walkDir(root, filter)`** — recursive dir walk behind `listTree`/`listTemplates`; filter returns `true`/`false`/`{data}`.
- **`core/src/frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits frontmatter via the `yaml` Document API (preserves comments/key order/flow arrays), falls back to stringify on malformed input.
- **Resilience**: `app/src/serverVersion.ts` tracks a `ConnectionState`; on SSE loss it toasts "Connection lost" + polls `/version` at 1s until reconnect.
- **`app/src/sanitizeHtml.ts` `sanitizeHtml(dirty)`** — DOMPurify wrapper for safe `innerHTML` of vault-rendered HTML (browser/headless-aware). Always route rendered HTML through it; build with the canonical `app/src/htmlEscape.ts` (`escapeHtml`/`escapeAttr`), not per-file escapers.

## Key Concepts

### Vault Structure
Markdown tree; YAML frontmatter (`---\ntags: [a, b]\n---`); wikilinks `[[Another Note]]` (matched by file name, not path); top-level folder → `folder` field on nodes (e.g., "reading/quotes/x.md" → folder="reading").

### Memory Integration
Memory notes live in a separate dir; the memory graph is built separately with nodes prefixed `mem:` (e.g., `mem:project-xyz`); "about" edges connect memory nodes to vault notes that reference vault filenames.

### Graph Modes
- **"2nd" brain**: self + vault notes + tags (excludes memory). **"3rd" brain**: self + memory. **"both"**: full brain + cross-edges.
- **"agents"**: live tree of Claude Code work in THIS app's terminal tabs — you → each terminal-tab session → its subagents (depth 1). Built from `/agent-graph` (`agents.ts` over the relay registry, filtered to open tabs); frontend polls it (change-signature dedup) only while agents mode is active. See Relay Integration.
- **"daemon"**: the daemon's supervised work — daemon hub → its crons + processes (`supervises` edges), node fill/border encoding enabled/running state. See Daemon Integration.

**2D/3D toggle**: a **transient localStorage toggle** (not a `.settings` key) — persists across sessions but not user-facing in the settings file. Toggle via the graph toolbar or `GraphView` mode control.

### Performance Optimizations
Debounced file-watch + version-gated refetch + backend-precomputed layouts (see **Caching + data flow**); plus lazy graph-renderer init, content-gated live-preview rescans, malformed-YAML tolerance, base loads via server row cache + client SWR cache (`bases/rowCache.ts`).

### Desktop app & core sidecar (`app/src-tauri/` + `app/scripts/build-core-sidecar.ts`)

The bundled `/Applications` app **spawns its own `core` backend** (not `bun run dev`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary; on launch `src/lib.rs` picks a free port, spawns the sidecar, kills it on exit, injects `window.__BISMUTH_API__` (read by `api.ts` `resolveBase`). A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** (or missing vault) it sets `window.__OA_FIRST_RUN__` and `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/`: theme-picker + power-ups slideshow whose CTA invokes the Tauri `choose_first_vault` command → writes config + seeds `.settings` → relaunch). Deep detail: `docs/overview/install.md`.

### MCP Integration (`mcp/` workspace)

A stdio [MCP](https://modelcontextprotocol.io) server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 5 always-on tools (`bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`) + 3 daemon-gated memory tools (`remember`/`recall`/`forget`, exposed only when `BISMUTH_MEMORY_DIR` is set). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed **machine-wide** on boot (`core/src/bismuthInstall.ts`) → copies `bismuth`+`bismuth-mcp`+docs to `~/.bismuth`, symlinks cli onto PATH, registers in `~/.claude.json` (`-s user`, for interactive sessions). **App control** (drive a running window's tabs, author a daemon page) adds **ZERO new MCP tools** — it routes through the existing `bismuth_cli` via the `app`+`page` CLI groups → core's `/ui/*` routes over a per-window control WS (`core/src/uiControl.ts` ⇄ `app/src/uiControlClient.ts`); chat opening is blocklisted at two layers (`UI_CONTROL_BLOCKLIST` in `core/src/commands.ts` + open-tab rejects `::chat:`). Detail: `docs/mcp/overview.md`, `docs/mcp/app-control.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`), powering the "agents" graph. Loads per-session inside app terminals (bundled via `BISMUTH_RELAY_BUNDLE`; nothing in `~/.claude`). `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads the plugin. Hooks POST `/relay/*` (`SessionStart`/`UserPromptSubmit` register, `SubagentStart`/`SubagentStop` add/finish). `/agent-graph` prunes closed-tab sessions. App-local; registry lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

The **`@bismuth/daemon`** workspace is **one machine process that multiplexes per-vault brains**: machine-level identity lives at `~/.bismuth/daemon` (`daemonMachineDir()`, env `BISMUTH_DAEMON_DIR`); each enabled vault's brain (memory, crons, processes, a conversation session) lives under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault each tick; a reconcile loop starts/pauses a vault's brain as `settings.daemon.enabled` flips. `sendMessage` passes the SDK per-call `cwd`=vault root, `env.BISMUTH_MEMORY_DIR`, `resume`=per-vault session-id, so concurrent vault sessions never race.

- **Lifecycle**: bundled binary (`app/scripts/build-daemon-sidecar.ts` → `resources/daemon`), copied to `~/.bismuth/bin` and run as a launchd/systemd **service** (NOT a Tauri child — must outlive the app to keep firing crons). `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window for the "daemon" graph mode + sidebar (`app/src/DaemonList.tsx`). (Rust `lib.rs` install/spawn wiring is the one remaining piece.)
- **Memory injection** is per-session + vault-scoped: `terminal.ts` injects `BISMUTH_MEMORY_DIR` into PTYs only when the daemon is enabled; the relay recall (UserPromptSubmit) + collect (SessionEnd) hooks and the MCP `remember`/`recall`/`forget` tools all gate on it. No global `~/.claude/settings.json` hook anymore.
- **Daemon session MCP is EXPLICIT wiring, not `-s user` inheritance**: `daemon/src/daemon/session.ts` `sendMessage` → `buildQueryOptions()` sets the SDK `options.mcpServers` to the machine-wide bismuth MCP (stdio `~/.bismuth/bin/bismuth-mcp`, discovered via `daemon/src/lib/bismuthPaths.ts`, `existsSync`-gated → graceful no-MCP) with `env.BISMUTH_VAULT=ctx.root` (closes the `bismuth_cli` vault-targeting gap) + `settingSources:[]` (don't inherit a human's ambient config — chat.ts deliberately does the opposite). `buildQueryOptions` is extracted + unit-tested so this doesn't silently regress. (SDK skew: core 0.3.186, daemon 0.2.141 — both expose the shape.)
- **Migration**: on first enable per machine, `migrateDaemonState` COPIES legacy `~/.claude-bot/{memory,crons,processes}` into `<vault>/.daemon` (copy-only, never deletes source; machine-marker-gated to one vault).
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain/assistant surface (memory injection + `.daemon` folder visibility + 3rd-brain & daemon graph modes). The daemon's **name + personality** live in **`<vault>/.daemon/identity.md`**: `name:` frontmatter drives the folder label/hub/self-identity (`daemonIdentityName()`); the body is its system prompt (`appendSystemPrompt`). **Seeding** (`reconcileSeeds(ctx)`, `daemon/src/daemon/seeds.ts`) writes any MISSING seeded default on every brain-start: `identity.md` + default crons (`dream` = hourly memory consolidation, `vault-review` = 4-hourly model-of-the-user pass, `defaultCrons.ts`). Later defaults land next boot; existing files never clobbered. Add a seedable via one `seedsFor()` entry. (`daemon.name`/`daemon.home`/`daemon.autoUpdate` removed from settings.)

## Testing

Tests use Bun's native test runner. Run with:
```bash
bun test core
bun test core -- [pattern]  # Filter by filename
```

Each module has a colocated `*.test.ts`. Notable: `core/test/{vault,engine,server,sse,layout,tasks,tasks-query,daemon,daemonViz}.test.ts`, `core/test/{bases,srs,drawing}/`, and frontend `app/src/{panes,settings}.test.ts`, `app/src/graph/{collide,labelSelection}.test.ts`, `app/src/calendar/*.test.ts`, `app/src/editor/{wikilink,tag,tableModel}.test.ts`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d`/`position3d` computed in `core/src/layout.ts`, attached via `layout-cache.ts`; the renderer only morphs.
- **Wikilink matching is filename-based, not path-based**: `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches undefined.
- **File-watch debounce**: two edits within 250ms → only the second rebuilds. **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it. **Concurrent instances**: 4321/1420 serve one; override ports for more.
