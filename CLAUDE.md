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
- **app**: Tauri + Solid + TypeScript application with CodeMirror editor and 3D/2D graph visualizations. Runs on desktop AND iPad/iOS — mobile swaps the HTTP backend for an in-process one (see Mobile / iPad below)
- **relay**: A tiny Claude Code plugin (hooks only) reporting each terminal-tab session + subagents to core's in-process registry (the "agents" graph), and injecting the vault's memory when the daemon is enabled (see Relay + Daemon Integration)
- **mcp**: A stdio MCP server (`docs/` reference + `bismuth` CLI, token-frugal; plus `remember`/`recall`/`forget` when the daemon is enabled) — per-tab in dev, machine-wide from the bundled app (see MCP Integration)
- **memory**: `@bismuth/memory` — the pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL). Shared by the daemon, relay hooks, and MCP tools; every entry point takes an explicit dir (`BISMUTH_MEMORY_DIR`)
- **daemon**: `@bismuth/daemon` — per-vault runtime; ONE machine process multiplexes every enabled vault's brain (memory + crons + processes + a conversation session); bundled binary run by launchd/systemd (see Daemon Integration)

The system treats knowledge as a "three-brain" model: **You** (self node, the user hub), **2nd Brain** (vault: markdown with wikilinks/tags/YAML frontmatter), **3rd Brain** (the daemon's memory graph under `<vault>/.daemon/memory`, linked to vault notes; shown as `mem:` nodes + `about` edges only when the daemon is enabled).

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
- `server.ts` — HTTP server (Bun.serve): caching, file watching, SSE broadcast, three WS upgrades (`/terminal` PTY, `/chat` visual Claude chat, `/ui` per-window app-control). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, `/ui/*`, daemon writes). Also drives `/gcal/*` + a 60s auto-sync ticker; writes a run-registry record on boot. **Full reference: `docs/api/http-reference.md`.**
- `sse.ts` — SSE registry (`formatEvent`, `createSseRegistry`): pushes `{version, paths, dirty:{graph,tree}}` on file changes — consumers use the `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — graph composition: merges vault + memory + self node, creates "about" edges (memory→vault). `vault.ts` — builds vault graph from markdown (two-pass: note nodes, then wikilink/tag/frontmatter edges)
- `graph.ts` — Graph types. Node kinds: note/memory/agent/tag/self (the "you" hub, injected frontend-side via `app/src/graph/youNode.ts`) + daemon/cron/process. Edge kinds: link, message, about, tag, open, supervises
- `layout.ts` — pure layout (pivot-MDS + force sim) → 2D + 3D `Positions`. `layout-cache.ts` — `attachLayout()` writes precomputed `position2d`/`position3d` onto nodes; frontend morphs between them (no client force sim)
- `files.ts` — file I/O + path-traversal rejection. `frontmatter.ts` — YAML parse (tolerates malformed). `wikilinks.ts`/`tags.ts` — extract `[[WikiLink]]` / `#tag`. `memory.ts` — memory graph (`mem:` namespace)
- `agents.ts`/`relay.ts` — "agents" graph (you → terminal-tab sessions → subagents) over the in-process relay registry (populated by relay hooks via `POST /relay/*`, pruned against the live pty set)
- `uiControl.ts` — registry of OPEN app WINDOWS + request/reply command channel (`/ui` WS): powers the `app` CLI + MCP app control. `runRegistry.ts` — `~/.bismuth/run/<vault>.json` so out-of-app callers discover which port serves which vault
- `daemon.ts`/`daemonGraph.ts`/`daemonViz.ts` — daemon shared-state reader (never throws) + "daemon" graph builder (hub → cron/process, `supervises` edges) + pure `nodeVisualState()` (enabled/running → visual tokens). See Daemon Integration
- `backup.ts` — git snapshot of vault. `tasks.ts`/`tasks-query.ts` — Tasks extraction + query DSL (Obsidian-compatible). `dates.ts` — date math (tasks/SRS/calendar). `calendar.ts` — headless calendar-file logic (behind the `bismuth calendar` CLI). `basesData.ts` — vault feed for Bases
- `terminal.ts` — PTY manager (`bun-pty`); injects relay provenance + a PATH shim so a bare `claude` auto-loads the relay plugin (`buildPtyEnv`, pure + tested)
- `chat.ts` — visual Claude chat (`/chat` WS): one long-lived Agent-SDK `query()` per chat over the user's own `claude` binary (see `docs/chat/overview.md`). `chatProviders/` — the provider seam: a chat can instead run on **opencode** (same ChatFrame protocol, `settings.chat.provider`; router + pure event translation; see `docs/chat/providers.md`)
- `gcal/` — Google Calendar two-way sync (OAuth+PKCE, pull/push/delete, RRULE, colors). See `docs/gcal/overview.md`. `bases/`/`srs/` — see sections below
- `fileAccess.ts`/`localBackend.ts` — mobile IO seam + in-process backend (see Mobile / iPad)

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change. A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`. Frontend opens one `EventSource("/events")` (`serverVersion.ts`), re-fetching `/graph` (or `/file`) per event, with a low-freq `/version` poll as fallback. Positions are backend-precomputed, not force-simulated in the browser.

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, CSS modules.

**Key components**:
- `App.tsx` — root: owns the tab + pane tree, active file routing, graph mode, settings persistence, global keyboard handling
- `panes.ts` — pure binary-tree model for split panes (Leaf/Split nodes), unit-tested in `panes.test.ts`
- `PaneTree.tsx`/`PaneContent.tsx` — render the pane tree; each Leaf hosts a note, Bases view, spreadsheet (`.sheet`), drawing (`.draw`), calendar, tasks, flashcards, terminal, visual Claude chat (`ChatView`), or export view (`export/`)
- `tabIds.ts` — sentinel ids for non-file pane contents (`::graph`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`/`::chat:`). Notes/bases/sheets/drawings/settings route by file path; no `::calendar`/`::search` sentinel — search is the unified Cmd+O switcher takeover (`palette/SwitcherBar.tsx`: fuzzy file + content matches + Bismuth AI escalation).
- `Editor.tsx` (CodeMirror) + `BlockEditor.tsx` (Milkdown WYSIWYG) — two note surfaces; `editor.defaultMode` picks which a note opens in (reactive live swap). Block-model detail in `docs/editor/blocks.md` (`blocks/`: `blockModel` lossless md↔blocks, `milkdownEditor`, `inlineNodes`, `FormatBar`).
- `editor/` — CodeMirror extensions (detail in `docs/editor/`): live-preview (per-token reveal, focus-gated, incl. `callout.ts` + `mathBlock.ts`), `enterKeymap.ts`, bold/italic toggles, lists, wikilink/tag/slash/`:emoji:` autocomplete (+ `emojiQuickAction.ts` — the emoji-library rail on the right-click context menu, shared by note + table-cell menus, #67), ` ```query ` block, embeds, editable GFM tables (`tableModel`/`tableWidget`/`cellEditor`/`tableResizeDrag`), find bar, KaTeX+LaTeX, Harper spell+grammar, completed-task fold, `settingsComplete`/`yamlSchema`. `editorRegistry.ts` tracks live views + flushes autosaves before renames.
- `FileTree.tsx` — left sidebar: drag-drop moves, rename/move retargets active tab, delete undo (toast+Cmd+Z), multi-select, icon picker, system-folder protection (`.settings`/`.daemon`). `ContextMenu.tsx` — right-click menu. `GraphView.tsx` — mounts the Canvas2D renderer
- Settings have **no GUI page** — the "settings page" is `.settings` (a hidden extensionless file per vault; `SETTINGS_FILE` in `core/src/settings.ts`) opened in the editor like any note, with schema-aware autocomplete (`editor/settingsComplete.ts`) + lint (`editor/yamlSchema.ts`). Schema (`core/src/schema/settingsSchema.ts`) = single source of truth.
- `palette/` — `CommandPalette`, shared `PaletteModal`, `SwitcherBar` + `switcherAi`/`switcherModel` (the unified Cmd+O search takeover — the app's ONE search surface). `Flashcards.tsx` — top-level SRS review view. `Terminal.tsx` — xterm.js tab (WS via `core/src/terminal.ts`). `Toast.tsx`/`telemetry.ts` — toasts + telemetry. `serverVersion.ts` — single `EventSource` to `/events` + fallback `/version` poll
- `bases/` — 12 view renderers (Table/Cards/Kanban/List/Map/Calendar/Flashcards/Bar/Line/Stat/Heatmap + `renderValue`) plus `markdown.ts` — the shared markdown→HTML engine (KaTeX, callouts, wikilinks, tags, PDF page-break markers) used by notes/cards/transclusion/export. `calendar/` — calendar state + components. `api.ts` — backend client over a swappable `Transport` (`setTransport()` → in-process on mobile — see Mobile / iPad)
- `settings.ts` — settings store: seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves via `POST /set-setting` (`settingsDiff.ts`, no comment clobbering). `Settings` mirrors the schema (`settings.parity.test.ts`).
- `settingsCssVars.ts` — projects appearance/ui/calendar/terminal settings + the resolved theme tokens into `:root` CSS custom properties (colors, `--graph-0..4`, `--danger/--success/--warning`, `--shadow-*`); stylesheets reference via `var(--name, fallback)`. Color tokens come from `core/src/theme/tokens.ts` (the single source of truth, re-exported by `app/src/themes.ts`).

**Graph rendering**:
- `graph/CanvasGraphRenderer.ts` — Canvas-2D renderer (NOT WebGL) for 2D + 3D: 3D camera math + hit-test/hover/drag-orbit/pan/zoom/labels in one pass per frame; only rescales the backend's precomputed layouts. `graph/AgentsGraph.tsx` — cards + org-picker overlay for "agents" mode
- `graph/labelSelection.ts` — pure `computeAlwaysOnSet` (top-N nodes by undirected edge count), unit-tested. `graph/collide.ts` — per-node collision-radius helpers.

**Styling**: `App.css` = global styles + CSS vars for theme/accent/fonts; component styles colocated with components. The color system is centralized in **`core/src/theme/tokens.ts`** (12 themes, semantic + shadow tokens, category swatches — in `core` so gcal/drawing/export/schema can import it; `app/src/themes.ts` re-exports it). Ref: `docs/settings/themes.md`.

### CLI (`cli/`)

The `bismuth` binary (thin wrapper over `@bismuth/core`) controls the vault from the shell. File-based commands run **headlessly** (no server); the app's vault watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`BISMUTH_VAULT`.

- `src/index.ts` — dispatcher: merges every group into one registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap. `src/args.ts` (`flag`/`bool`/`positionals`/`requireVault`/`out`/`fail`…) + `src/types.ts` (`Command`/`CommandMap`) = the shared seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. Groups: `file`, `note`, `search`, `graph`, `task`, `base`(+`row*`), `card`, `prop`, `calendar` (headless event CRUD via `core/src/calendar.ts`), `settings`(+`folder-icon`), `daemon` (no vault), `draw`, `serve`+`backup`, `export` (md|html|png; pdf/png of notes/bases browser-only), `api` (`<METHOD> <path>` passthrough), `app` (drives a RUNNING app's tabs via `/ui/*`; discovery `--api`>`BISMUTH_API`>`CLAUDE_RELAY_URL`>run-registry>`:4321`), `page` (daemon inbox, headless), `install` (machine-wide cli+mcp), `checkpoint` (git-ref bookmarks `refs/bismuth/<name>`, any `--dir`).

**Adding a command**: add a `Command` to a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` + `docs/bases/views/` (per view kind). This is the conceptual summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas, and views over the vault's notes (`FileView` routes a `type: base` note to `BaseView`). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`): `lexer`→`parser`→`parse` (grammar: filters/formulas/view configs); `evaluate` (AST vs a note) + `filters` (`and`/`or`/`not`/comparisons); `functions` (built-ins per value type); `query` (apply a Base to the `basesData.ts` feed → rows + grouping).

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (charts via `bases/chart.ts`). `BaseView.tsx` picks the renderer; `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` code block — the only embedded block (no ` ```base `/` ```view `/` ```tasks `). Its body is either a full inline base config (top-level `views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks: <dsl>`, `where:`, `group:`, `view:`). Rendered inline by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]` — `{kind:"base",ref}` (render another base, resolving its OWN source recursively), `{kind:"notes",where?,from?}` (vault notes; `from:[[Base]]` scopes), `{kind:"tasks",where?,from?}` (checkbox tasks). Frontmatter accepts a string (`source: notes where #book`) or object (`normalizeSource()`). Resolution is cycle-guarded + **server-side** via `POST /rows {spec}`; cached server-side (`cachedRows`) + client SWR (`bases/rowCache.ts`, `reconcileRows.ts`, `changeRelevance.ts`). Body/tasks cards inline-editable (`CardEditor.tsx`). In a flat block: `of:[[Base]]` renders that base, `tasks:<dsl>` runs a task query, `where:`/`view:` filter + pick the mode.

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — no standalone page. Open one via a `type: base` md with `views: [{ type: calendar }]`; rendered by `app/src/bases/CalendarView.tsx`. `app/src/calendar/` holds shared state + components (`EventStore.ts` CRUD, `state.ts`, `dates.ts`, `categoryColor.ts`, `components/` + `components/views/` Month/Week/ThreeDay/Day/TimeGrid). A calendar base can be **two-way-synced with Google Calendar** (`core/src/gcal/`, `GcalConnectModal.tsx`) — detail in `docs/gcal/overview.md`.

### Tasks (`core/src/tasks*.ts`)

Obsidian-Tasks-compatible. Tasks are a **base source** (`source: tasks`, optionally `from: [[Base]]`), not standalone — queried via a ` ```query ` block with `tasks: <dsl>`. `tasks.ts` extracts task items from markdown (status, due/scheduled/start, recurrence, tags); `tasks-query.ts` = query DSL (relative dates, sort, AND/OR); `bases/taskRow.ts` projects tasks as base `Row`s; `POST /tasks/toggle` rewrites the markdown line.

### Flashcards / SRS (`core/src/srs/` + `app/src/bases/FlashcardsView.tsx`)

Spaced-repetition reviews. Flashcards are a **Bases view kind** (`flashcards`) over a base's rows — UI is `app/src/bases/FlashcardsView.tsx`. Two code paths share `srs/scheduler.ts` (SM-2) + `srs/types.ts`: **Markdown cards** (`srs/parser.ts` parses `?`/`??`; `srs/cards.ts` = model + `applyReview`) and **Row cards** (base rows with front/back/due/ease/interval columns; `srs/reviewRow.ts`). Queue logic is pure + unit-tested (`app/src/bases/flashcardsQueue.ts`). **Bidirectional** (toggle in `BaseSettings.tsx`): each row yields forward + reverse entries, reverse scheduled in `*Back` columns. **Cram mode** ignores due dates, never writes scheduling. Endpoints: `GET /cards/{decks,all,note,due}`; `POST /cards/review` dual-mode; card CRUD → `POST /row/{update,delete,reorder}`. Detail: `docs/flashcards/srs.md`.

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs. Backend spawns a PTY (`bun-pty`), bridges over WS on `/terminal`; frontend renders with xterm.js (DOM, ANSI palette from the graph theme). Each PTY's env (`buildPtyEnv`, pure + tested) injects relay provenance + a PATH shim (see Relay Integration).

### Sheets (`app/src/SheetView.tsx` + `app/src/sheet/`)

A `.sheet` file is a Univer workbook JSON snapshot (`@univerjs/presets`), code-split via dynamic `import()` behind `sheet/univerSheet.ts`. `sheet/snapshot.ts` (parse/serialize) + `sheet/sync.ts` (`isExternalChange` gates reloads). `PaneContent` routes `*.sheet` → `SheetView`.

### Drawing (`app/src/drawing/` + `core/src/drawing/`)

A `.draw` file is a versioned JSON `DrawingDoc` (pages, strokes, `images?`, paper background) — a multi-page vector sketch routed by `PaneContent.tsx` (lazy `DrawingPage.tsx`). **Backend (`core/src/drawing/`, pure + headless)**: `model`/`geometry` (perfect-freehand)/`smooth`/`render2d`/`paper`/`theme`/`export` (`renderDocToPng`/`renderDocToPdf` via `@napi-rs/canvas`+`pdf-lib`). **Frontend**: `DrawingCanvas.tsx` (dual canvas, stylus pressure/velocity width), `Toolbar.tsx`, `store.ts` (undo/redo), `pdfRaster.ts`. Opening an image/PDF auto-creates a `.draw` sidecar (markup). Persisted via `PUT /file`; smoothing on pointer-release. Detail: `docs/drawing/overview.md`.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure, unit-tested). Each Leaf holds a content id: a note path or a `tabIds.ts` sentinel. `PaneContent.tsx` routes a leaf id; per-window tab layout keyed by `windowId.ts`.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class content routed to a `GraphView` via `App`'s `renderGraph()`. `App` seeds a `::graph` tab when nothing is restored and reopens one if all tabs close (tabs never empty). **Tab renaming**: double/right-click → Rename sets a custom `name` on the `Leaf`, overriding `contentLabel()`.

### Commands & Sidebar Toolbar

Commands are split into pure data + behavior so the palette and sidebar header bar (`.sidebar-icons`) share one source: `core/src/commands.ts` (`COMMAND_CATALOG` → `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → live `{id,label,icon,action}` map; `resolveButtonCommands`). The bar above the file tree is configured by `toolbar:` in `.settings` — each item `{ command: <id> | commands: [<id>, …], icon, tooltip? }` (`commands` list wins; unresolved ids skip). Full list: `docs/settings/toolbar-commands.md` (incl. `create-menu`, `archive-tasks`, `detect-ai`, `find`).

**Adding a command:** add to `COMMAND_CATALOG` (core) + an `action` in `bindCommands` (app); enum/autocomplete/palette pick it up. (A new *top-level* schema key also needs the key lists in `core/test/schema/settingsSchema.test.ts`.)

**File-menu commands**: `new-folder`/`new-note`, `export`, `new-window` (`?api=`), `open-folder` (`POST /open-folder` → sibling core server). **Runtime backend base** (`app/src/api.ts`): `resolveBase` picks the backend (`?api=<url>` > `window.__BISMUTH_API__` > `VITE_API_BASE` > `:4321`), so one build serves multiple windows.

### Keybindings

Global shortcuts come from `keybindings:` in `.settings` (nothing hardcoded in `App.tsx`). Same split-data pattern as commands: `core/src/keybindings.ts` (`KEYBINDING_CATALOG` → schema) + `app/src/keybindings.ts` (`matchesKeybinding`). `"Mod"` = Cmd/Ctrl; matching **exact**; combos comma-separated; matches produced key OR physical `event.code`. **Adding one:** add to `KEYBINDING_CATALOG` (core), read `settings.keybindings.<id>` via `matchesKeybinding` — schema/autocomplete/default derived automatically.

## Workspace Management

Workspaces are linked via Bun's `workspaces` in the root `package.json`: `core` exports `@bismuth/core`, which `app`/`cli`/`mcp` import. Add a dep with `cd <workspace> && bun add <package>`; `bun install` (root) syncs all.

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
  theme/tokens.ts                      # THE single source of truth for the color system (12 themes + semantic/shadow tokens + category swatches); re-exported by app/src/themes.ts, imported by gcal/drawing/export/settingsSchema
  commands.ts keybindings.ts error.ts dates.ts basesData.ts tasks.ts tasks-query.ts taskReorder.ts terminal.ts chat.ts chatModelStore.ts calendar.ts bismuthInstall.ts claudeWhich.ts selfUpdate.ts fsPaths.ts   # calendar.ts = headless pure calendar-file logic behind the `bismuth calendar` CLI group; chatModelStore.ts = durable per-session chat model (~/.bismuth/chat/models.json, Bug #89)
  fileAccess.ts localBackend.ts   # mobile (iPad/iOS): FileAccess IO seam + in-process no-HTTP backend (dispatch) — see Mobile / iPad
  bases/   # Bases DSL (lexer/parser/evaluate/filters/functions/query)
  srs/     # SRS (cards/parser/scheduler)
  gcal/    # Google Calendar two-way sync (oauth/pkce/client/sync/recurrence/colors/map/lock/manifest/state)
core/test/  # one *.test.ts per module; helpers.ts → makeSampleVault()

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane-tree model, routing
  Editor.tsx editor/   # CodeMirror wrapper + extensions (livePreview, autocomplete, foldBlocks, queryBlock, wikilink, tag, markdownFormat, settingsComplete…)
  BlockEditor.tsx blocks/   # Milkdown WYSIWYG surface (blockModel, milkdownEditor, inlineNodes, FormatBar); closedSession.ts/navType.ts (app-wide tab-restore)
  ChatView.tsx ChatComposer.tsx chat*.ts   # visual Claude chat (NOT in blocks/): ChatView + ChatComposer + ~13 pure unit-tested modules (chatContext/chatEditorContext, chatHistory, chatModelResolution, chatEffort, chatPermissionMode, chatSlashCommands, chatQueueRestore, chatSessionStore, chatTitles, chatOrigin = daemon-vs-user icon, chatColors, chatComposerKeys)
  mobile/   # iPad/iOS boot: bootMobile.ts (swaps FileAccess+Transport before App import), inProcessTransport.ts (dispatch→Response, optimistic read-compare-write), tauriFileAccess.ts (tauri-plugin-fs IO) — see Mobile / iPad
  FileTree.tsx fileTreeOps.ts ContextMenu.tsx nativeMenu.ts FolderPrompt.tsx EmptyPane.tsx
  GraphView.tsx GraphSearch.tsx ClusterLegend.tsx graph/   # graph shell + Canvas2D CanvasGraphRenderer, AgentsGraph overlay, GraphAtmosphere, youNode, agentGraphSig, collide, labelSelection
  FileView.tsx NoteTitle.tsx Flashcards.tsx Terminal.tsx SheetView.tsx sheet/ ExportView.tsx export/
  intro/ ai/   # intro/ = first-run Vault Intro takeover (VaultIntro + marks; theme picker + power-ups; see Desktop app & core sidecar); ai/ = local offline "Detect AI text" (aiDetect.ts, transformers.js, no network)
  bases/ calendar/ palette/ drawing/   # feature view-sets (bases/: + CardEditor inline-editable cards, CardEditModal, reconcileRows, changeRelevance; kanban card image-drop: cardImageDrop/kanbanImageDrop → embed dropped images in a card's markdown description, #67)
  noteCache.ts windowId.ts baseViews.ts taskStatusMenu.tsx   # LRU note cache, per-window tab-storage keys, 12 base-view kinds, task-status context menu
  ui/      # shared primitives (Button family, Chip, Stars, StatusDot, ViewBar, SearchBar, SegmentedToggle, TextInput, Select, Field, EmptyState, Modal, gallery/, popover/)
  icons/ dnd/   # Lucide Icon+registry+picker; drag-drop geometry + viewDrag
  api.ts serverVersion.ts uiControlClient.ts settings.ts settingsCssVars.ts settingsDiff.ts keybindings.ts themes.ts appWindow.ts nativeAppMenu.ts   # uiControlClient = the /ui app-control socket; themes.ts = byte-identical re-export of core/src/theme/tokens.ts
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
- **Debug graph-not-updating**: wait the 250ms debounce + ≤5s poll; `curl :4321/version`; watch `/events` in DevTools. Content-only edits set `dirty.graph=false` (rebuild skipped) — expected.

## Common Tasks

- **Add a core endpoint**: add a route to `routes` (read) or `mutatingRoutes` (write) in `core/src/server.ts`; mutating routes go through `mutatingHandler` (auto invalidate + SSE). Add a `server.test.ts` case.
- **Add a graph node/edge kind**: update `NodeKind`/`EdgeKind` in `core/src/graph.ts`, emit from `buildVaultGraph()` (`vault.ts`), adjust frontend mode filtering in `App.tsx`.
- **Add a setting** (schema = single source of truth; default = current hardcoded value): (1) add an entry (type, `default`, `min`/`max`|enum, `doc`) to `core/src/schema/settingsSchema.ts`; (2) add the field to the `Settings` interface in `app/src/settings.ts` (`settings.parity.test.ts` enforces parity); (3) wire the consumer (CSS `--var` in `settingsCssVars.ts`, or `settings.<section>.<key>` / `appConfig.<section>.<key>`). Persist via `POST /set-setting`.
- **Debug graph construction**: run standalone (see Development commands), `curl :4321/graph | jq`; see `core/test/{vault,engine}.test.ts`.
- **Add a Bases function**: add a case to `callFunction`/`callMethod` in `core/src/bases/functions.ts`, handle its return type in `query.ts`, test in `core/test/bases/query.test.ts`.
- **Add an SRS scheduler variant**: extend `core/src/srs/scheduler.ts`; expose config in `settingsSchema.ts`, thread into `applyReview`.

## Error Handling

Backend errors use the `AppError` class (`core/src/error.ts`): `createError(code, msg)` or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` to the response (generic `Error` → 500). Code→status mapping (`ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400) lives in `error.ts`.

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
See **Caching + data flow**; plus lazy graph-renderer init, content-gated live-preview rescans, malformed-YAML tolerance, and base SWR caching (`bases/rowCache.ts`).

### Desktop app & core sidecar (`app/src-tauri/` + `app/scripts/build-core-sidecar.ts`)

The bundled `/Applications` app **spawns its own `core` backend** (not `bun run dev`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary; on launch `src/lib.rs` picks a free port, spawns the sidecar, kills it on exit, injects `window.__BISMUTH_API__` (read by `api.ts` `resolveBase`). A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** (or missing vault) it sets `window.__OA_FIRST_RUN__` and `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/`: theme-picker + power-ups whose CTA invokes the Tauri `choose_first_vault` command → writes config + seeds `.settings` → relaunch). Deep detail: `docs/overview/install.md`.

### Mobile / iPad (`core/src/localBackend.ts` + `core/src/fileAccess.ts` + `app/src/mobile/`)

On iPad/iOS the Bun HTTP server can't run, so the app runs the **same core logic in-process, no HTTP**, via two seams: (1) **`core/src/fileAccess.ts`** `FileAccess` — desktop lazy-imports `files.ts`, mobile registers a `tauri-plugin-fs` impl via `setFileAccess()` (nothing statically imports Bun/`node:fs`); (2) **`app/src/api.ts`** swappable `Transport` (`setTransport()` → in-process). **`core/src/localBackend.ts`** `dispatch(method,path,body)` reuses engine/bases/search/tasks/srs; covers reads + content-only writes, throws `NOT_SUPPORTED` for structural fs ops/set-setting/asset upload/backup/open-folder. `bootMobile.ts` swaps both seams before importing `App`; `inProcessTransport.ts` wraps dispatch as `Response` + optimistic read-compare-write (no 409s); change detection via `backend.subscribe()` not SSE. Deep detail: `docs/mobile/overview.md`.

### MCP Integration (`mcp/` workspace)

A stdio [MCP](https://modelcontextprotocol.io) server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 5 always-on tools (`bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`) + 3 daemon-gated memory tools (`remember`/`recall`/`forget`, only when the vault's daemon is enabled; `memoryDir()` trusts `BISMUTH_MEMORY_DIR` else resolves via `BISMUTH_VAULT`/cwd). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed machine-wide on boot (`core/src/bismuthInstall.ts`) → copies cli+mcp+docs to `~/.bismuth`, symlinks onto PATH, registers in `~/.claude.json` (`-s user`). **App control** (drive a running window's tabs, author a daemon page) adds **ZERO new MCP tools** — it rides `bismuth_cli` via the `app`+`page` CLI groups → core's `/ui/*` control WS (`uiControl.ts` ⇄ `uiControlClient.ts`; `UI_CONTROL_BLOCKLIST` blocks chat opening). Detail: `docs/mcp/overview.md`, `docs/mcp/app-control.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`), powering the "agents" graph. Loads per-session inside app terminals (bundled via `BISMUTH_RELAY_BUNDLE`; nothing in `~/.claude`); `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads it. Hooks POST `/relay/*` (`SessionStart`/`UserPromptSubmit` register, `SubagentStart`/`SubagentStop` add/finish); `/agent-graph` prunes closed-tab sessions. App-local; registry lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

The **`@bismuth/daemon`** workspace is **one machine process that multiplexes per-vault brains**: machine identity at `~/.bismuth/daemon` (`daemonMachineDir()`, `BISMUTH_DAEMON_DIR`); each enabled vault's brain (memory, crons, processes, session) lives under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault each tick; a reconcile loop starts/pauses a brain as `settings.daemon.enabled` flips. `sendMessage` passes SDK per-call `cwd`=vault root, `env.BISMUTH_MEMORY_DIR`, `resume`=per-vault session-id, so concurrent sessions never race.

Deep reference: `docs/daemon/`. Key points:
- **Lifecycle**: bundled binary (`app/scripts/build-daemon-sidecar.ts` → `resources/daemon`), copied to `~/.bismuth/bin` and run as a launchd/systemd **service** (NOT a Tauri child — must outlive the app to keep firing crons). `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window for the "daemon" graph mode + sidebar (`app/src/DaemonList.tsx`).
- **Memory injection** is per-session + vault-scoped: `terminal.ts` injects `BISMUTH_MEMORY_DIR` into PTYs only when the daemon is enabled; relay recall/collect hooks + the MCP `remember`/`recall`/`forget` tools all gate on it (no global `~/.claude/settings.json` hook).
- **Daemon session MCP is EXPLICIT wiring, not `-s user` inheritance**: `daemon/src/daemon/session.ts` `sendMessage` → `buildQueryOptions()` (extracted + unit-tested) sets SDK `options.mcpServers` to the machine-wide bismuth MCP (`existsSync`-gated → graceful no-MCP) with `env.BISMUTH_VAULT=ctx.root` + `settingSources:[]` (chat.ts deliberately does the opposite). First enable per machine `migrateDaemonState` copies legacy `~/.claude-bot/*` into `<vault>/.daemon` (copy-only, marker-gated).
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain/assistant surface. The daemon's **name + personality** live in **`<vault>/.daemon/identity.md`** (`name:` → folder label/hub via `daemonIdentityName()`; body = system prompt). **Seeding** (`reconcileSeeds`, `daemon/src/daemon/seeds.ts`) writes any MISSING default on brain-start: `identity.md` + default crons (`dream` hourly consolidation, `vault-review` 4-hourly). Add a seedable via one `seedsFor()` entry.

## Testing

Bun's native runner (`bun test core`, `bun test core -- [pattern]`; see Key Commands). Each module has a colocated `*.test.ts`. Notable: `core/test/{vault,engine,server,sse,layout,tasks,tasks-query,daemon,daemonViz}.test.ts`, `core/test/{bases,srs,drawing}/`, frontend `app/src/{panes,settings}.test.ts`, `app/src/graph/*.test.ts`, `app/src/calendar/*.test.ts`, `app/src/editor/*.test.ts`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d`/`position3d` computed in `core/src/layout.ts`; the renderer only morphs.
- **Wikilink matching is filename-based**: `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches undefined.
- **File-watch debounce**: two edits within 250ms → only the second rebuilds. **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it. **Concurrent instances**: 4321/1420 serve one; override ports for more.
