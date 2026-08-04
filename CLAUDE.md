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
- **relay**: A tiny Claude Code plugin (hooks only) reporting each terminal-tab session + subagents to core's in-process relay registry (`core/src/relay.ts`), and injecting the vault's memory when the daemon is enabled (see Relay + Daemon Integration)
- **mcp**: A stdio MCP server (`docs/` reference + `bismuth` CLI + `bismuth_skill`, token-frugal; plus `remember`/`recall`/`forget` when the daemon is enabled) — per-tab in dev, machine-wide from the bundled app (see MCP Integration)
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
- `bun test core` — the whole core workspace. `bun test core/test/wikilinks.test.ts` — one file. **`bun test core -- <pattern>` does NOT filter**: Bun's positional args are OR'd substring matches on the path, and `core` matches every file under `core/test/`, so the pattern is ignored. Pass an exact path instead.
- `bun run typecheck` (root) — `tsc --noEmit` per workspace, each pinning its own local `typescript` so the gate resolves offline. `core`/`cli`/`mcp`/`memory`/`daemon` pin `7.0.2`; `app`/`relay` pin `~5.6.2` — a pre-existing split left unresolved on purpose (unifying it is its own task).
- **Tests are REQUIRED to commit.** `.githooks/pre-commit` → `scripts/gate.ts`: typecheck (all workspaces) + *fast* tests for the workspaces your staged files touch (~30s). `.githooks/pre-push`: docs check + the *full* suite. Hooks ride `core.hooksPath`; a fresh clone runs `bun run hooks:install`. Bypass with `BISMUTH_SKIP_GATE=1` or `--no-verify`; run by hand with `bun run gate`.
- `BISMUTH_FAST_TESTS=1` (`bun run test:fast`) skips the SLOW suites — real agent binaries, PTY/WS integration, the layout benchmark (`core/test/slowGate.ts`, the opt-OUT sibling of `liveGate.ts`'s opt-IN). Unset (plain `bun test`, CI) runs everything, so no suite is lost to a forgotten flag.
- **`core/test/upgrade/`** (`bun run test:upgrade`) — what an existing user's data survives on update: all three historical `.settings` layouts migrate without losing values, comments or unknown keys, and `schemaSnapshot.test.ts` pins every schema default/type/bound to a committed snapshot so a silent default change can't land unreviewed (re-bless: `bun run test:bless-schema`).

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
- `server.ts` — HTTP server (Bun.serve): caching, file watching, SSE broadcast, three WS upgrades (`/terminal` PTY, `/chat` chat, `/ui` per-window app-control). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, `/ui/*`, daemon writes). Also drives `/gcal/*` + a 60s auto-sync ticker; writes a run-registry record on boot. **Full reference: `docs/api/http-reference.md`.**
- `sse.ts` — SSE registry: pushes `{version, paths, dirty:{graph,tree}}` on file changes; consumers use `dirty` to skip refetch when nothing structural moved.
- `engine.ts` merges the vault + memory graphs (+ "about" edges); `vault.ts` builds the vault graph two-pass (note nodes, then wikilink/tag/frontmatter edges); `memory.ts` the `mem:` namespace. `graph.ts` — node kinds note/memory/tag/self/daemon/cron/process (+ a vestigial `agent`, emitted by nothing); edge kinds link/message/about/tag/open/supervises.
- `layout.ts` — pure layout (pivot-MDS + force sim) → 2D + 3D `Positions`; `layout-cache.ts`'s `attachLayout()` writes them onto nodes and the frontend morphs between them (no client force sim). `community.ts` — hierarchical community detection.
- `files.ts` (I/O + path-traversal rejection) · `frontmatter.ts` (YAML, tolerates malformed) · `wikilinks.ts`/`tags.ts`.
- `visibility.ts`/`visibilityCliGate.ts` — the AI-visibility layer: per-channel deny lists gating most read routes, plus the gate on CLI dispatch. Ref: `docs/vault/visibility.md`.
- `relay.ts` — in-process registry of terminal-tab sessions + subagents, fed by `POST /relay/*` and pruned against the live pty set; read via `GET /relay/snapshot` (owner sees all; non-owner gets `redactSnapshot()`, which drops the free-text `lastMessage`).
- `uiControl.ts` — registry of OPEN app windows + request/reply channel (`/ui` WS), powering the `app` CLI + MCP app control. `runRegistry.ts` — `~/.bismuth/run/<vault>.json` (port discovery + the `0600` owner token).
- `daemon.ts`/`daemonGraph.ts`/`daemonViz.ts` — daemon state reader (never throws) + the "daemon" graph builder + pure `nodeVisualState()`. See Daemon Integration.
- `chat.ts` — the visual chat (`/chat` WS): one long-lived Agent-SDK `query()` per chat over the user's own binary. `chatProviders/` + `agentBackends/` — the provider seam and shared capability catalog behind **nine** backends (claude, opencode, codex, and the ACP-based cline/gemini/goose/openclaw/claude-code-acp/codex-acp); each control renders per declared capability. Refs: `docs/chat/overview.md`, `docs/chat/backends.md`.
- `terminal.ts` — PTY manager (`bun-pty`); injects relay provenance + a PATH shim so a bare `claude` auto-loads the relay plugin (`buildPtyEnv`, pure + tested).
- `backup.ts` (git snapshot) · `tasks.ts`/`tasks-query.ts` (Obsidian-compatible tasks + DSL) · `dates.ts` · `calendar.ts` (headless, behind the `bismuth calendar` CLI) · `basesData.ts` (vault feed for Bases) · `gcal/` (two-way Google Calendar sync) · `fileAccess.ts`/`localBackend.ts` (mobile seam + in-process backend).

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change; `rowsCache`/`tasksCache` are `createAsyncCache` instances (in-flight dedup). A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`. The frontend keeps one `EventSource("/events")` and re-fetches per event, with a low-frequency `/version` poll as fallback. Positions are backend-precomputed, never force-simulated in the browser.

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, CSS modules.

**Key components**:
- `App.tsx` — root: tab + pane tree, active-file routing, graph mode, settings persistence, global keys. `panes.ts` — pure binary-tree model for splits (Leaf/Split), unit-tested. `PaneTree.tsx`/`PaneContent.tsx` route a Leaf to a note, Bases view, `.sheet`, `.draw`, calendar, tasks, flashcards, terminal, chat, or export view.
- `tabIds.ts` — sentinel ids for non-file panes (`::graph`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`/`::chat:`). Notes/bases/sheets/drawings/settings route by path. There is no `::search` — search is the Cmd+O switcher takeover (`palette/SwitcherBar.tsx`), the app's ONE search surface.
- `Editor.tsx` (CodeMirror) + `BlockEditor.tsx` (Milkdown WYSIWYG) — two note surfaces; `editor.defaultMode` picks which opens (reactive live swap). `editor/` holds the CM extension set (live-preview, autocomplete, ` ```query ` blocks, embeds, GFM tables, find, KaTeX, Harper); `editorRegistry.ts` flushes autosaves before renames. Detail: `docs/editor/`.
- **Settings have no GUI page** — the "settings page" IS `.settings` (a hidden extensionless file per vault) opened in the editor like any note, with schema-aware autocomplete + lint. `core/src/schema/settingsSchema.ts` is the single source of truth.
- `FileTree.tsx` — drag-drop moves, rename retargets the active tab, delete undo, multi-select, icon picker, `.settings`/`.daemon` protection. `bases/` — the 12 view renderers + `markdown.ts` (shared markdown→HTML for notes/cards/transclusion/export). `api.ts` — backend client over a swappable `Transport` (in-process on mobile).
- `settings.ts` — store seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves (`settingsDiff.ts`, no comment clobbering); mirrors the schema (`settings.parity.test.ts`). `settingsCssVars.ts` projects settings + theme tokens into `:root` CSS custom properties.

**Graph rendering**: `graph/AsciiGraphRenderer.ts` is **the** renderer (no choice) — a Canvas-2D *character grid*, not WebGL, for both 2D and 3D; it only rescales the backend's precomputed layouts. **Zoom is RESOLUTION, not scale**: a mark's size never changes; a wheel notch re-rasterizes at a finer grid and steps a three-band ladder (far = cluster masses → near = glyphs + member edges). Seam: `graph/graphRenderer.ts`. Pure unit-tested modules: `respace`, `backbone`, `clusterVisual`, `cameraModel`, `lod`, `asciiGrid`, `labelSelection`. Ref: `docs/graph/overview.md`.

**Styling**: `App.css` = global styles + CSS vars; component styles colocated. Colour is centralized in **`core/src/theme/tokens.ts`** (the 4 themes ink/paper/cathode/riso + semantic/shadow tokens + category swatches — in `core` so gcal/drawing/export/schema can import it; `app/src/themes.ts` re-exports it). Ref: `docs/settings/themes.md`.

**Storybook is THE visual-verification surface** — `bun run storybook` from `app/` (:6006, Storybook 9 + `storybook-solidjs-vite`); 237 stories / 81 components. `app/.storybook/preview.ts` does two things globally that must NOT be re-solved per story: projects the real theme tokens (so **never hardcode a stand-in for a design token**) and installs an in-memory `fakeTransport` (without it every mount-fetching component renders a permanent "Loading…" that reads as a passing story). Fixtures: `app/src/ui/_{baseFixtures,fakeTransport,calendarFixtures,graphFixtures,daemonFixtures,cmHarness}`. **Caveat:** `GraphView` pauses its rAF loop when `document.visibilityState === "hidden"`, so a backgrounded automation tab samples a 0%-inked canvas — indistinguishable from a broken renderer. Use `bench/visual.ts`, which drives its own Chrome for exactly that reason.

### CLI (`cli/`)

The `bismuth` binary (thin wrapper over `@bismuth/core`) controls the vault from the shell. File-based commands run **headlessly** (no server); the app's vault watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`BISMUTH_VAULT`.

- `src/index.ts` — dispatcher: merges every group into one registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap. `src/args.ts` (`flag`/`bool`/`positionals`/`requireVault`/`out`/`fail`…) + `src/types.ts` (`Command`/`CommandMap`) = the shared seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. Groups: `file`, `note`, `search`, `graph`, `task` (+`archive`), `base` (+`create`/`validate`/`render`, +`row*`), `card`, `prop`, `calendar` (headless event CRUD via `core/src/calendar.ts`), `settings`(+`folder-icon`, +`deny-list` visibility preflight), `daemon` (no vault; +`stop`/`restart` → `daemon/src/lib/platform.ts`), `draw`, `serve`+`backup`, `export` (md|html|png; pdf/png of notes/bases browser-only), `api` (`<METHOD> <path>` passthrough), `app` (drives a RUNNING app's tabs via `/ui/*`; discovery `--api`>`BISMUTH_API`>`CLAUDE_RELAY_URL`>run-registry>`:4321`), `page` (daemon inbox, headless), `install` (machine-wide cli+mcp), `checkpoint` (git-ref bookmarks `refs/bismuth/<name>`, any `--dir`), `update` (status/apply), `gcal` (status/connect/sync/disconnect/targets/health), `relay` (`list` — live sessions + subagents), `chat` (`list`/`read`/`search` past sessions).

**Owner-token reach** (`cli/src/http.ts`): `call()` attaches `X-Bismuth-Token` from the vault's `0600` run record (`core/src/runRegistry.ts`), **loopback hosts only** — so the owner's own shell reads owner-gated routes (chat history, the unredacted relay snapshot). The agent boundary is unchanged: `chat` sits in `visibilityCliGate.ts`'s refuse-when-restricted tier, and that separation is `BISMUTH_AGENT_CHANNEL` — an env var, **not** a cryptographic boundary.

**Adding a command**: add a `Command` to a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` + `docs/bases/views/` (per view kind). This is the conceptual summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas, and views over the vault's notes (`FileView` routes a `type: base` note to `BaseView`). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`): `lexer`→`parser`→`parse` (grammar: filters/formulas/view configs); `evaluate` (AST vs a note) + `filters` (`and`/`or`/`not`/comparisons); `functions` (built-ins per value type); `query` (apply a Base to the `basesData.ts` feed → rows + grouping).

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (charts via `bases/chart.ts`). `BaseView.tsx` picks the renderer; `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` code block — the only embedded block (no ` ```base `/` ```view `/` ```tasks `). Its body is either a full inline base config (top-level `views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks: <dsl>`, `where:`, `group:`, `view:`). Rendered inline by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]` — `base` (renders another base, resolving its OWN source recursively), `notes`, or `tasks` (both take `where?`/`from?`). Frontmatter accepts a string or object (`normalizeSource()`). Resolution is cycle-guarded + **server-side** via `POST /rows {spec}`, cached server-side + client SWR (`bases/rowCache.ts`). Detail: `docs/bases/sources.md`.

**Authoring**: `bismuth base create|validate|render` (CLI) and the `skills/authoring-bismuth-bases` skill — which carries the view-selection decision table. Note `parseBaseFile` silently downgrades an invalid `views[].type` to `table`, so `base validate` reads raw frontmatter instead.

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

Purposes are in **Architecture** above; this is the layout. **Exhaustive per-file map: `docs/contributing/codebase-map.md`.**

```
core/src/
  server.ts sse.ts                     # HTTP + SSE + WS, mutating-route abstraction
  engine.ts vault.ts memory.ts graph*.ts layout*.ts community.ts   # graph build + layout
  relay.ts uiControl.ts runRegistry.ts daemon*.ts   # relay registry; /ui channel; port discovery; daemon read-window
  files.ts frontmatter.ts wikilinks.ts tags.ts backup.ts search.ts replace.ts templates.ts dailyNote.ts …
  settings.ts schema/                  # .settings lifecycle + THE settings schema (24 top-level sections)
  theme/tokens.ts                      # single source of truth for colour: 4 themes (ink/paper/cathode/riso)
  visibility.ts visibilityCliGate.ts   # AI-visibility deny lists + the CLI-dispatch gate
  chat.ts chatProviders/ agentBackends/  # visual chat + the nine backends and their capability catalog
  fileAccess.ts localBackend.ts        # mobile IO seam + in-process no-HTTP backend
  bases/ srs/ gcal/ drawing/           # Bases DSL · SRS · Google Calendar sync · .draw vector docs
core/test/  # one *.test.ts per module; helpers.ts → makeSampleVault(); upgrade/ = cross-version safety

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane-tree model, routing
  Editor.tsx editor/ · BlockEditor.tsx blocks/              # CodeMirror surface · Milkdown WYSIWYG surface
  ChatView.tsx chat*.ts                # visual chat + ~14 pure unit-tested modules (incl. chatTranscript.ts)
  GraphView.tsx graph/                 # the ONE renderer (AsciiGraphRenderer) behind the graphRenderer seam
  FileTree.tsx FileView.tsx Terminal.tsx SheetView.tsx ExportView.tsx + sheet/ export/ …
  bases/ calendar/ palette/ drawing/ intro/ ai/ mobile/ ui/ icons/ dnd/   # ui/_*.ts* = Storybook fixtures
  api.ts settings.ts settingsCssVars.ts keybindings.ts themes.ts …
app/.storybook/  # Storybook 9 config — preview.ts injects theme tokens + the in-memory transport
app/src-tauri/   # Tauri shell (Rust): spawns the core sidecar + first-run vault picker

cli/src/    # `bismuth` binary: index.ts dispatcher + args.ts seam + commands/<group>.ts
mcp/src/    # stdio MCP server: 6 always-on tools + 3 daemon-gated (app control adds ZERO tools)
relay/      # Claude Code plugin: hooks/ (→ POST /relay/*) + shim/ + .mcp.json
daemon/src/ # per-vault brain: daemon/ (session, cron, process, seeds) + lib/
skills/     # NOT a workspace — agent skills shipped to all 9 backends via 3 adapters
            #   authoring-bismuth-bases/{SKILL.md, references/<12 view kinds>.md}
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
- **"daemon"**: the daemon's supervised work — daemon hub → its crons + processes (`supervises` edges), node fill/border encoding enabled/running state. See Daemon Integration.
- **"local"**: the open note's immediate neighborhood only (`localSubgraph`, `app/src/graph/displayGraph.ts` + `localLayoutInput.ts`) — a focused read of one note's links rather than the whole vault.

`GraphMode` (`app/src/commands.ts`) is exactly `"2nd" | "3rd" | "both" | "daemon" | "local"`. The old **"agents"** mode was removed (`a6687c0`): no `GET /agent-graph`, no `agentLayout.ts`/`AgentsGraph.tsx`, nothing emits `kind:"agent"`. `relay.ts` and its `POST /relay/*` ingest routes survive — they now feed chat's subagent tracking + terminal pruning, not a graph.

**2D/3D toggle**: a **transient localStorage toggle** (not a `.settings` key) — persists across sessions but not user-facing in the settings file. Toggle via the graph toolbar or `GraphView` mode control.

### Performance Optimizations
See **Caching + data flow**; plus lazy graph-renderer init, content-gated live-preview rescans, malformed-YAML tolerance, and base SWR caching (`bases/rowCache.ts`).

### Desktop app & core sidecar (`app/src-tauri/` + `app/scripts/build-core-sidecar.ts`)

The bundled `/Applications` app **spawns its own `core` backend** (not `bun run dev`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary; on launch `src/lib.rs` picks a free port, spawns the sidecar, kills it on exit, injects `window.__BISMUTH_API__` (read by `api.ts` `resolveBase`). A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** (or missing vault) it sets `window.__OA_FIRST_RUN__` and `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/`: theme-picker + power-ups whose CTA invokes the Tauri `choose_first_vault` command → writes config + seeds `.settings` → relaunch). Deep detail: `docs/overview/install.md`.

### Mobile / iPad (`core/src/localBackend.ts` + `core/src/fileAccess.ts` + `app/src/mobile/`)

On iPad/iOS the Bun HTTP server can't run, so the app runs the **same core logic in-process, no HTTP**, via two seams: (1) **`core/src/fileAccess.ts`** `FileAccess` — desktop lazy-imports `files.ts`, mobile registers a `tauri-plugin-fs` impl via `setFileAccess()` (nothing statically imports Bun/`node:fs`); (2) **`app/src/api.ts`** swappable `Transport` (`setTransport()` → in-process). **`core/src/localBackend.ts`** `dispatch(method,path,body)` reuses engine/bases/search/tasks/srs; covers reads + content-only writes, throws `NOT_SUPPORTED` for structural fs ops/set-setting/asset upload/backup/open-folder. `bootMobile.ts` swaps both seams before importing `App`; `inProcessTransport.ts` wraps dispatch as `Response` + optimistic read-compare-write (no 409s); change detection via `backend.subscribe()` not SSE. Deep detail: `docs/mobile/overview.md`.

### MCP Integration (`mcp/` workspace)

A stdio [MCP](https://modelcontextprotocol.io) server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 6 always-on tools (`bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`, `bismuth_skill`) + 3 daemon-gated memory tools (`remember`/`recall`/`forget`, only when the vault's daemon is enabled; `memoryDir()` trusts `BISMUTH_MEMORY_DIR` else resolves via `BISMUTH_VAULT`/cwd). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed machine-wide on boot (`core/src/bismuthInstall.ts`) → copies cli+mcp+docs to `~/.bismuth`, symlinks onto PATH, registers in `~/.claude.json` (`-s user`). **App control** (drive a running window's tabs, author a daemon page) adds **ZERO new MCP tools** — it rides `bismuth_cli` via the `app`+`page` CLI groups → core's `/ui/*` control WS (`uiControl.ts` ⇄ `uiControlClient.ts`; `UI_CONTROL_BLOCKLIST` blocks chat opening). Detail: `docs/mcp/overview.md`, `docs/mcp/app-control.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`). Loads per-session inside app terminals (bundled via `BISMUTH_RELAY_BUNDLE`; nothing in `~/.claude`); `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads it. Hooks POST `/relay/*` (`SessionStart`/`UserPromptSubmit` register, `SubagentStart`/`SubagentStop` add/finish); closing a terminal tab prunes its session (`terminal.ts`'s `killSession` → `relay.ts`'s `prune`). App-local; registry lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

The **`@bismuth/daemon`** workspace is **one machine process that multiplexes per-vault brains**: machine identity at `~/.bismuth/daemon` (`daemonMachineDir()`, `BISMUTH_DAEMON_DIR`); each enabled vault's brain (memory, crons, processes, session) lives under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault each tick; a reconcile loop starts/pauses a brain as `settings.daemon.enabled` flips. `sendMessage` passes SDK per-call `cwd`=vault root, `env.BISMUTH_MEMORY_DIR`, `resume`=per-vault session-id, so concurrent sessions never race.

**Deep reference: `docs/daemon/`** (lifecycle, crons/processes, pages, memory, storage). The load-bearing points:
- **Runs as a launchd/systemd service, NOT a Tauri child** — it must outlive the app to keep firing crons. `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window (the "daemon" graph mode + `app/src/DaemonList.tsx`).
- **Memory injection is per-session + vault-scoped**, gated on the daemon being enabled — `terminal.ts` injects `BISMUTH_MEMORY_DIR` into PTYs; relay hooks + the MCP memory tools gate on the same. No global `~/.claude/settings.json` hook.
- **The daemon session's MCP is EXPLICIT wiring, not `-s user` inheritance** — `buildQueryOptions()` (`daemon/src/daemon/session.ts`, unit-tested) sets `options.mcpServers` + `settingSources:[]`. `chat.ts` deliberately does the opposite; don't "unify" them.
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain surface. Name + personality live in `<vault>/.daemon/identity.md`; `reconcileSeeds` writes any MISSING default on brain-start (`identity.md`, `dream`, `vault-review`) — add a seedable via one `seedsFor()` entry.

## Testing

Bun's native runner; each module has a colocated `*.test.ts`. Commands, the commit/push gates, the
fast-suite opt-out, and `core/test/upgrade/` are all covered under **Key Commands → Testing** above.
Full reference: `docs/contributing/testing.md`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d`/`position3d` computed in `core/src/layout.ts`; the renderer only morphs.
- **Wikilink matching is filename-based**: `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches undefined.
- **File-watch debounce**: two edits within 250ms → only the second rebuilds. **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it. **Concurrent instances**: 4321/1420 serve one; override ports for more.
