# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
git clone <repo>
cd obsidian-alternative
bun install
export OA_VAULT="/path/to/your/vault"           # Directory with .md files
export OA_MEMORY="/path/to/your/memory"         # Claude-bot memory directory
cd app && bun run dev                            # Tauri app + backend on :4321
```

For first-time setup without existing vaults, see **Creating Test Vaults** below.

## Project Overview

**Three Brains** is a personal knowledge management system inspired by Obsidian, built as a monorepo with three core workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: Backend server that manages vaults, builds knowledge graphs, and integrates with Claude-bot memory
- **cli**: Command-line interface for managing vaults (`oa` binary)
- **app**: Tauri + Solid + TypeScript desktop application with CodeMirror editor and 3D/2D graph visualizations

The system treats knowledge as a "three-brain" model:
- **You** (self node): Central hub representing the user
- **2nd Brain** (vault): Personal knowledge base with wikilinks, tags, and YAML frontmatter
- **3rd Brain** (memory): Claude-bot memory graph linked to vault notes

## Environment Setup

**Required environment variables** for running `bun run dev`:

| Variable | Purpose | Example |
|----------|---------|---------|
| `OA_VAULT` | 2nd-brain vault directory (markdown files) | `~/my-vault` or `/tmp/test-vault` |
| `OA_MEMORY` | 3rd-brain memory directory (Claude-bot notes) | `~/.claude/memories` or `/tmp/test-memory` |

The dev command will error if these are not set. Both directories must exist before running.

**Creating Test Vaults** (for development):
```bash
mkdir -p /tmp/test-vault /tmp/test-memory
echo "# Hello\nSome content" > /tmp/test-vault/example.md
export OA_VAULT="/tmp/test-vault"
export OA_MEMORY="/tmp/test-memory"
cd app && bun run dev
```

## Development Artifacts

Plans, brainstorming notes, design docs, and other temporary development artifacts are stored in the global `~/.claude/` directory (outside the source tree):
- `~/.claude/obsidian-alternative-docs/` — Brainstorming, planning docs, design notes, and reference materials

These are not committed to the repo and are git-ignored.

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

When multiple Claude Code sessions run this project, port conflicts occur on default `:4321` (backend) and `:1420` (Tauri). Override with:

```bash
OA_VAULT="/path" OA_MEMORY="/path" PORT=4322 bun run dev
```

Check `concurrent-agents-ports.md` in `~/.claude/obsidian-alternative-docs/` for port assignments across active sessions.

## Architecture

### Core Backend (`core/`)

**Purpose**: Manages vault file system, builds knowledge graphs, watches for changes, serves HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve) with caching, file watching, mutating-route abstraction, SSE broadcast. Routes:
  - GET reads: `/version`, `/events` (SSE), `/graph`, `/graph/views` (per-brain-view layouts, computed lazily on mode switch), `/tree`, `/vault-data`, `/file`, `/meta`, `/config`, `/settings`, `/schema`, `/templates`, `/base`, `/agent-graph`, `/tasks`, `/cards/decks`, `/cards/all`, `/cards/note`, `/cards/due`
  - POST mutations (go through `mutatingHandler` — invalidate caches + broadcast SSE): `/move`, `/delete`, `/restore`, `/create`, `/set-property`, `/delete-property`, `/set-setting` (merge one settings.yaml key in place — the backend is the single writer of settings), `/folder-icon`, `/daily-note`, `/tasks/toggle`, `/cards/review`, `/row/update`, `/row/delete`, `/replace`
  - POST/PUT in the read table (NOT mutations — no auto cache-invalidate): `/rows` (resolve a `SourceSpec` → `Row[]`, following base composition + scoped tasks), `/search`, `/backup` (git snapshot), `PUT /file`
  - GET `/terminal` upgrades to WebSocket for terminal PTY sessions
- `sse.ts` — Server-sent event registry. `formatEvent`, `createSseRegistry`. Pushes `{version, paths, dirty: {graph, tree}}` on file changes — graph/tree consumers use `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — Graph composition. Merges vault graph + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — Builds vault knowledge graph from markdown files. Two-pass algorithm: (1) create note nodes, (2) extract wikilinks + tags + frontmatter metadata, create edges
- `graph.ts` — Graph type definitions. Node kinds: "note", "memory", "agent", "tag", "self" (the "you" hub — one per brain view, NOT from the backend builders; injected on the frontend from the open tabs/panes, see `app/src/graph/youNode.ts`). Edge kinds: "link" (wikilinks), "message" (memory), "about" (memory→vault), "tag", "open" (you→an open note)
- `layout.ts` — Pure layout computation (pivot-MDS + force simulation). Produces 2D and 3D `Positions` maps used by the renderer
- `layout-cache.ts` — `attachLayout()` writes precomputed `position2d` / `position3d` onto graph nodes, keyed by vault. Frontend morphs between them instead of running its own force sim
- `files.ts` — File I/O: list markdown, read/write notes, path-traversal rejection
- `frontmatter.ts` — YAML frontmatter parsing; tolerates malformed YAML
- `wikilinks.ts` — Extract `[[WikiLink]]` patterns from markdown
- `tags.ts` — Extract `#tag` from frontmatter and markdown body
- `memory.ts` — Build memory graph from Claude-bot memory notes (in `mem:` namespace)
- `agents.ts` — Build agent interaction graph from Claude Communicate relay
- `backup.ts` — Git commit snapshot of vault
- `tasks.ts`, `tasks-query.ts` — Tasks extraction + query DSL (Obsidian Tasks-compatible)
- `terminal.ts` — PTY session manager backing the in-app terminal tabs (`bun-pty`)
- `dates.ts` — Date math shared by tasks, SRS, calendar
- `basesData.ts` — Vault-wide data feed consumed by the Bases query engine
- `bases/` — Bases DSL: see "Bases" section below
- `srs/` — Spaced-repetition system: see "Flashcards / SRS" section below

**Caching strategy**:
- `cachedGraph` and `cachedTree` persist until vault/memory files change
- File-watch changes trigger a debounced 250ms invalidation timer
- On invalidation, the server fingerprints changed notes via `changeClassifier.ts` to determine which caches are dirty (graph, tree, or both)
- Only truly "dirty" caches are invalidated; content-only edits that don't affect links/tags/icon stay silent to graph/tree consumers
- The server bumps `version` (so editors reconcile external edits) and pushes an SSE event on `/events` with `{version, paths, dirty}` so subscribers know which caches need refetching

**Data flow**:
1. Frontend opens a single `EventSource("/events")` connection on boot (`app/src/serverVersion.ts`)
2. On each SSE event, frontend re-fetches `/graph` (or just `/file` for the changed path)
3. A low-frequency `/version` poll runs as a belt-and-suspenders fallback for dropped SSE connections (proxies, sleep)
4. Graph is computed lazily on first request after invalidation
5. Node positions are precomputed on the backend (`layout.ts`) and attached to nodes, not force-simulated in the browser

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, styled with CSS modules

**Key components**:
- `App.tsx` — Root. Owns the tab + pane tree, active file routing, graph mode, settings persistence, global keyboard handling
- `panes.ts` — Pure binary-tree model for split panes (Leaf/Split nodes). Fully unit-tested in `panes.test.ts`
- `PaneTree.tsx` / `PaneContent.tsx` — Renders the pane tree; each Leaf hosts a note, Bases view, spreadsheet (`.sheet`), drawing (`.draw`, via `drawing/`), calendar, tasks, flashcards, terminal, or an export view (`export/`)
- `tabIds.ts` — Sentinel ids for non-file pane contents (`::calendar`, `::search`, `::empty`, plus prefixed `::flashcards:`, `::term:`, `::export:`); settings/graph/notes are routed by file path or their own ids
- `Editor.tsx` — CodeMirror 6 editor with markdown, live-preview, wikilink/tag autocomplete, embedded bases/tasks blocks
- `editor/` — CodeMirror extensions: `livePreview` (block rendering), `autocomplete` (wikilinks/tags), `basesBlock`/`viewBlock` (embed Bases/view in a doc), `tasksQuery` (embed task queries), `wikilink`, `tag`, `mathBlock`, `codeHighlight`, `harperSpellcheck`, `settingsComplete`/`yamlSchema` (settings autocomplete + lint), `editorContextMenu`
- `FileTree.tsx` — Left sidebar. Drag-drop moves, rename/move retargets active tab, undo support for deletes
- `ContextMenu.tsx` — Right-click menu for file tree and editor
- `GraphView.tsx` — Mounts the WebGL renderer and label layer, exposes mode/view toggles
- Settings have **no GUI page** — the "settings page" is `settings.yaml` opened in the editor, with schema-aware autocomplete (`editor/settingsComplete.ts`, shows each key's doc + valid range) and lint (`editor/yamlSchema.ts`). The schema (`core/src/schema/settingsSchema.ts`) is the single source of truth.
- `palette/` — `CommandPalette`, `QuickSwitcher`, shared `PaletteModal`
- `Flashcards.tsx` — Top-level SRS review view, routable via a sentinel id
- `Terminal.tsx` / `Terminal.css` — xterm.js terminal tab, WebSocket-backed by `core/src/terminal.ts`
- `Toast.tsx`, `telemetry.ts` — Toast notifications, lightweight client telemetry (SSE errors, poll catch-ups)
- `serverVersion.ts` — Single `EventSource` to `/events` plus fallback `/version` poll
- `bases/` — Bases view renderers (Table, Cards, Kanban, List, Map, plus shared `renderValue`)
- `calendar/` — Calendar feature: see "Calendar" section below
- `api.ts` — HTTP client for core endpoints
- `settings.ts` — Settings store: seeded synchronously from the spine `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves via `POST /set-setting` (see `settingsDiff.ts`) so the backend can merge in place without clobbering comments / the property registry. Precise `Settings` interface mirrors the schema (kept honest by `settings.parity.test.ts`).
- `settingsCssVars.ts` — Projects appearance/ui/calendar/terminal settings into `:root` CSS custom properties; stylesheets reference them via `var(--name, fallback)`. Add a CSS-driven setting = one schema entry + one line here + one `var()` in CSS.

**Graph rendering**:
- `graph/WebGLRenderer.ts` — Three.js renderer for both 2D (flat birdseye) and 3D (volumetric orbit) modes, morphing between the backend's precomputed layouts
- `graph/LabelLayer.ts` — DOM-overlay file-name labels: each visible label is a native `<div>` (UI font, theme-matched via CSS vars) absolutely positioned over the canvas — NOT Three.js sprites. Pooled/reused divs, viewport culling, occlusion, zoom-band discovery, an "always-on" hub set, and a bold/larger always-on "you" hub label. `setColors()` pushes per-theme `--label-text`/`--label-bg` custom props onto the overlay
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

Obsidian-Bases-compatible query/view system. A `.base` YAML file declares filters, formulas, and one or more views over the vault's notes.

**Backend pipeline** (`core/src/bases/`):
- `lexer.ts` → `parser.ts` → `parse.ts` — Tokenize and parse the Bases expression grammar (filters, formulas, view configs)
- `evaluate.ts` — Evaluate a parsed AST against a single note
- `filters.ts` — Filter combinators (`and`, `or`, `not`, comparisons)
- `functions.ts` — Built-in functions on file/number/string/array/date values (method-dispatch tables per type)
- `query.ts` — Apply a Base to the vault data feed (`basesData.ts`) and return rows + grouping

**Frontend views** (`app/src/bases/`): one renderer per view kind. `ViewType` (`core/src/bases/types.ts`) now spans 11 kinds — `TableView`, `CardsView`, `KanbanView`, `ListView`, `MapView`, plus `CalendarView`, `FlashcardsView`, and the chart views `BarView`/`LineView`/`StatView`/`HeatmapView` (backed by `core/src/bases/chart.ts`). `renderValue.tsx` formats cell values consistently across views. `BaseView.tsx` is the host that picks the right renderer.

Bases can also be embedded inside a note via a code block; the editor extension `editor/basesBlock.ts` renders them inline.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]`:
- `{ kind: "base", ref }` — render another base; **resolves that base's OWN source recursively** (composition), not just its static table rows.
- `{ kind: "notes", where?, from? }` — vault notes filtered by a Bases expression; `from: [[Base]]` scopes to that base's notes.
- `{ kind: "tasks", where?, from? }` — checkbox tasks; `from: [[Base]]` scopes extraction to that base's notes (NOT the whole vault). No `from` = degenerate global case.

Frontmatter accepts a string (`source: notes where #book`, plus top-level `from:`/`ref:`) or an object; `normalizeSource()` coerces both. `resolveSource`/`resolveBaseRows` are cycle-guarded (a `seen` set). All resolution is **server-side** via `POST /rows {spec}` (one resolver); `BaseView.resolveRows` is just `inlineRows ?? api.resolveRows(spec)`.

A ` ```view ` block references a base (`of: [[Base]]`) or runs a task query (`tasks: <dsl>`, optionally `from: [[Base]]`). It does **not** iterate notes itself — that's a base's job. A block with neither `of:` nor `tasks:` has no source and renders an empty state.

**Scoped-tasks example** (Google Keep → Do Now): a `Google Keep` base with `source: notes` + `where: file.inFolder("Google Keep")` (cards view); a `Do Now` base with `source: tasks` + `from: "[[Google Keep]]"` (list, grouped) shows only the tasks inside Google Keep's notes.

### Calendar (`app/src/calendar/`)

Standalone calendar feature with its own state store and views.

- `CalendarPage.tsx` — Top-level view
- `EventStore.ts` — Event state + persistence (tested in `EventStore.test.ts`)
- `state.ts` — Reactive view state (active date, zoom, selection)
- `dates.ts` — Date helpers (tested in `dates.test.ts`)
- `types.ts` — Event / category types
- `refresh.ts` — Refresh wiring
- `components/` — `EventChip`, `EventModal`, `RecurrenceDialog`, `CategoryPanel`, `Toolbar`
- `components/views/` — `MonthView`, `WeekView`, `ThreeDayView`, `DayView`, `TimeGrid`

### Tasks (`core/src/tasks*.ts`)

Obsidian-Tasks-compatible task system. Tasks are not a standalone subsystem — they are a **base source** (`source: tasks`, optionally `from: [[Base]]` to scope to a base's notes). There is no global Tasks page; a focused list is just a base. See the Bases "Sources & composition" section.
- `core/src/tasks.ts` — Extract task items from markdown (status, due/scheduled/start dates, recurrence, tags); `collectTasksFromPaths` scopes extraction to a note subset
- `core/src/tasks-query.ts` — Query DSL (`not done`, `due before tomorrow`, etc.)
- `core/src/bases/taskRow.ts` — `taskToRow`/`filterTaskRows`: project tasks as base `Row`s so any view renders them
- `editor/tasksQuery.ts` — CodeMirror extension that renders an inline ` ```tasks ` query block inside a note (the lightweight throwaway path)
- `POST /tasks/toggle` — Server-side toggle endpoint (rewrites the markdown line)

### Flashcards / SRS (`core/src/srs/` + `app/src/Flashcards.tsx`)

Spaced-repetition reviews extracted from markdown notes:
- `srs/parser.ts` — Parses `?` / `??` flashcard syntax out of notes
- `srs/cards.ts` — Card model + persistence; also exports `applyReview` (the review-recording entry point)
- `srs/scheduler.ts` — SM-2-style scheduling (next-due, ease factor)
- `srs/types.ts`, `srs/reviewRow.ts` — Card/review types and `applyReviewToRow` (row-based reviews for Bases)
- Endpoints: `/cards/decks`, `/cards/all`, `/cards/note`, `/cards/due`, `POST /cards/review`
- `Flashcards.tsx` — Review UI

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs. Backend spawns a PTY via `bun-pty` and bridges it over WebSocket on `/terminal`. Frontend renders with xterm.js, with the ANSI palette wired from the graph color theme (`buildAnsiPalette`). DOM-rendered (not canvas), styled to match the editor.

### Sheets (`app/src/SheetView.tsx` + `app/src/sheet/`)

A real spreadsheet document type — a sibling to notes and bases, **not** a Bases view (the data lives in the file's cells, not in notes). A `.sheet` file is a Univer workbook JSON snapshot (`IWorkbookData`). Powered by the **Univer** SDK (`@univerjs/presets` + `preset-sheets-core`/`-sort`/`-filter`, v0.25). Free-form A1 cells, 400+ formulas with a recalc dependency graph, sort/filter, number formats, merged cells, freeze panes.

- All Univer code is quarantined behind one adapter, `app/src/sheet/univerSheet.ts` (`mountSheet`/`getSnapshot`/`setDark`/`dispose`), reached only via dynamic `import()` from `SheetView.tsx` so Univer is code-split out of the main bundle. Each mount gets a fresh child container (disposing then re-creating into the same node renders blank).
- `app/src/sheet/snapshot.ts` (pure, unit-tested): `parseSnapshot` (empty/whitespace ⇒ blank workbook), `serializeSnapshot`. `app/src/sheet/sync.ts` (pure, unit-tested): `isExternalChange` — the single-writer reload predicate.
- Routing: `PaneContent.tsx` sends `*.sheet` paths to `SheetView` (like `*.base` → `BaseView`). `core/src/files.ts` `listTree` lists `.sheet` so they appear in the tree. `tabIds.ts` gives them a `Table` icon + extension-stripped label.
- Persistence reuses `api.read`/`api.write` (no new endpoints). Edits debounce-save (snapshot-equality skip avoids no-op writes); the **baseline is Univer's own serialization of the freshly-mounted workbook**, so mount-time commands aren't mistaken for edits and an unedited sheet is never written. A version/echo guard (`isExternalChange` + a `dirty` flag) reloads on genuine external edits but never clobbers in-progress edits.
- Created via "New Spreadsheet" (file-tree context menu, toolbar, command palette) — an empty file that `SheetView` turns into a blank workbook on first open. Dark mode tracks `settings.appearance.theme` live via `univerAPI.toggleDarkMode`.
- **Not in v1** (deferred, each cheap to add): `.xlsx` import/export, charts, pivot tables, real-time collaboration, vault cross-references. Tauri/WKWebView canvas rendering is unverified (developed/tested in the browser).

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure model, unit-tested). Each Leaf holds a content id: either a note path or a sentinel from `tabIds.ts` (`::settings`, `::graph`, `::terminal`, `::flashcards`, `::calendar`, plus per-base sentinels). `PaneTree.tsx` walks the tree; `PaneContent.tsx` routes a leaf id to the right view.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is a first-class tab content — `PaneContent` routes it to a full `GraphView` via a `renderGraph()` prop supplied by `App` (which owns the graph data + mode). There is **no floating "default view"**: `App` seeds a `::graph` tab when nothing is restored, and the close handlers reopen one if every tab closes (tabs are never empty). The `new-tab` and `open-graph` commands both open it. When the active tab already shows the graph in a pane, the sidebar mini-graph (`.graph-floater`) hides + its slot collapses so the graph never renders twice at once.

### Commands & Sidebar Toolbar

Commands are split into pure data and behavior so the palette and the sidebar header bar (`.sidebar-icons`, above the file tree) share one source:
- `core/src/commands.ts` — `COMMAND_CATALOG` (`id`, `label`, `icon`) + `COMMAND_IDS`. Pure data; lives in core so the settings schema derives the `toolbar.command` enum from it.
- `app/src/commands.ts` — `bindCommands(handlers)` maps each id to a live `{id, label, icon, action}`. Both `CommandPalette` and the toolbar `<For>` consume the map. `resolveButtonCommands(btn, map)` resolves a toolbar item to its ordered list of bound commands (precedence below), dropping unresolved ids — the toolbar `<For>` uses it to fire each command on click.

The bar above the file tree is configured by the `toolbar:` list in `settings.yaml` (seeded with New note / New folder / Open terminal). Each item is `{ command: <id> | commands: [<id>, …], icon: <Lucide name|emoji>, tooltip?: <text> }`. A button runs either one command (`command:`) or several in order (`commands:`, a list) on a single click; a non-empty `commands` wins over `command` (setting both → a lint warning). At runtime, ids that don't resolve are silently skipped, and a button renders **disabled** only when *none* of its ids resolve. A top-level list slips past the section-merge loop in `serializeSettingsForFrontend`, so it's special-cased via `readToolbarFrom` (mirrors `folderIcons`) — items with no resolvable command and other malformed items are dropped, an explicit empty list is honored. The `command:`/`icon:` fields and the `commands:` list members autocomplete inside the list via `editor/settingsComplete.ts` (the bare list-scalar case has its own branch).

**Adding a command:** add an entry to `COMMAND_CATALOG` (core) and a matching `action` binding in `bindCommands` (app). The `toolbar.command` enum, its autocomplete, and the palette pick it up automatically. (Adding any new *top-level* schema key also requires updating the hardcoded key lists in `core/test/schema/settingsSchema.test.ts`.)

### Keybindings

Global keyboard shortcuts are configured via the `keybindings:` section of `settings.yaml` (the **last** section in a fresh file) — nothing is hardcoded in `App.tsx`. Same split-data pattern as commands:
- `core/src/keybindings.ts` — `KEYBINDING_CATALOG` (`id`, `label`, `default`, `doc`) + `KEYBINDING_IDS`. Pure data in core; the settings schema derives the `keybindings` object section from it (one `keybind`-typed key per action, defaulting to the previously hardcoded combo).
- `app/src/keybindings.ts` — the pure matcher: `parseCombo`/`matchesCombo`/`matchesKeybinding`, plus the authoring helpers (`KEYBIND_MODIFIERS`, `KEYBIND_KEYS`, `modifierFamily`, `eventToCombo`). `"Mod"` = Cmd on macOS / Ctrl elsewhere (CodeMirror convention); modifier matching is **exact** (so `Mod+D` and `Mod+Shift+D` stay distinct); combos are comma-separated alternatives (`"Mod+\`, Mod+J"`). Matches the produced key OR the physical `event.code` (so macOS Option-composed chars like `Alt+S`→"ß" still match). `App.tsx` `handleGlobalKeydown` matches events against `settings.keybindings.<id>`.
- **`keybind` PropertyType** (`core/src/schema/types.ts`, validated leniently in `validate.ts`) drives a smart, order-free shortcut autocomplete in `editor/settingsComplete.ts` (`keybindCompletions`): completes the current `+`-separated token with the remaining modifier families + the key list, plus a **"Record shortcut…"** option that listens to the keyboard for 3s and writes the captured combo.

**Adding a keybinding:** add an entry to `KEYBINDING_CATALOG` (core) and read `settings.keybindings.<id>` via `matchesKeybinding` at the handler. The schema field, autocomplete, and `keybindings.<id>` default are derived automatically.

## Workspace Management

The three workspaces are linked via Bun's `workspaces` feature in the root `package.json`:
- `core` exports `@oa/core` (backend library)
- `app` imports `@oa/core` for the UI
- `cli` imports `@oa/core` for command-line operations

To add a dependency to a workspace: `cd <workspace> && bun add <package>`. Use `bun install` (root) to sync all workspaces.

## Module Organization

```
core/src/
├── server.ts            # HTTP + SSE + WS, mutating-route abstraction
├── sse.ts               # SSE registry / event formatting
├── engine.ts            # Graph composition (vault + memory + agents)
├── vault.ts             # Vault → graph builder
├── graph.ts             # Graph type definitions
├── memory.ts            # Memory → graph builder
├── agents.ts            # Agent graph builder (Claude Communicate)
├── layout.ts            # Pure layout (pivot-MDS + forces) → Positions
├── layout-cache.ts      # Attach precomputed positions to nodes
├── frontmatter.ts       # YAML parsing (tolerant)
├── wikilinks.ts         # WikiLink extraction
├── tags.ts              # Tag extraction (frontmatter + body)
├── files.ts             # File I/O, path-traversal rejection
├── backup.ts            # Git snapshot of vault
├── error.ts             # AppError class + ERROR_CODES registry for typed error semantics
├── graphBuilder.ts      # Shared graph builder helper: eliminates vault/memory duplication
├── changeClassifier.ts  # Tracks note-level changes (wikilinks/tags/icon) to selectively invalidate graph vs tree
├── commands.ts          # COMMAND_CATALOG (pure command metadata)
├── keybindings.ts       # KEYBINDING_CATALOG (pure shortcut metadata + defaults)
├── tasks.ts             # Tasks extraction
├── tasks-query.ts       # Tasks query DSL
├── terminal.ts          # PTY session manager (bun-pty)
├── dates.ts             # Date math (shared by tasks/SRS/calendar)
├── basesData.ts         # Vault-wide data feed for Bases
├── asyncCache.ts        # Deduped, invalidation-safe async cache (backs /graph, /tree)
├── community.ts         # Louvain-style community detection → node community/color stamping
├── search.ts            # Full-text vault search (MiniSearch) + snippet rendering (POST /search)
├── replace.ts           # Vault-wide find-and-replace with git snapshot (POST /replace)
├── templates.ts         # {{token}} template expansion ({{date}}/{{time}}/{{title}}/{{cursor}})
├── dailyNote.ts         # Daily-note creation via template expansion (POST /daily-note)
├── settings.ts          # settings.yaml lifecycle: reconcile on boot, per-vault write mutex, property registry
├── pathUtils.ts         # Vault path validation/manipulation helpers
├── bases/               # Bases DSL — lexer, parser, evaluate, filters, functions, query
└── srs/                 # SRS — cards, parser, scheduler

core/test/
├── helpers.ts           # makeSampleVault(): throwaway vault+memory in tmpdirs
└── *.test.ts            # One per module (vault, engine, memory, server, sse, terminal, tasks, srs, bases, ...)

app/src/
├── EmptyPane.tsx        # Placeholder view for empty panes; quick switcher + new terminal
├── fileTreeOps.ts       # File tree manipulation (drag/drop, rename, undo, retarget)
├── debounce.ts          # Debounce utility (reusable across components)
├── App.tsx              # Root: pane tree, routing, keyboard
├── panes.ts             # Pure pane-tree model
├── PaneTree.tsx         # Pane-tree renderer
├── PaneContent.tsx      # Routes a leaf id to its view
├── tabIds.ts            # Sentinel ids for non-file panes
├── Editor.tsx           # CodeMirror wrapper
├── editor/              # CM extensions (livePreview, autocomplete, basesBlock, tasksQuery, wikilink, tag)
├── FileTree.tsx         # Sidebar with drag-drop / undo
├── ContextMenu.tsx      # Right-click menu
├── GraphView.tsx        # Graph view shell
├── graph/               # Renderer + label layer + collide
├── Flashcards.tsx       # SRS review view
├── Terminal.tsx         # xterm.js terminal tab
├── SheetView.tsx        # Spreadsheet pane: load/save/reload + lazy Univer mount
├── sheet/               # Univer adapter (univerSheet.ts) + pure snapshot/sync (unit-tested)
├── bases/               # Base view renderers (Table/Cards/Kanban/List/Map/Bar/Line/Heatmap/Stat)
├── calendar/            # Calendar feature (CalendarPage, EventStore, views/, components/)
├── palette/             # Command palette + quick switcher
├── ui/                  # Shared primitives: Button/IconButton/TextButton/IconTextButton, Chip, Stars, StatusDot, ViewBar, SearchBar, SegmentedToggle, buttonClass, popover/
├── icons/               # Lucide Icon renderer + name registry + IconPicker
├── dnd/                 # Drag-drop geometry + DOM drag tracking (viewDrag) for panes/tabs
├── drawing/             # `.draw` document type: DrawingPage/DrawingCanvas/Toolbar/store/input
├── export/              # Export note/base/sheet → HTML/PDF/Markdown/PNG (ExportView + exporters/formats)
├── graph/               # WebGL renderer, DOM LabelLayer, youNode (self-hub injection), AgentsGraph, collide, labelSelection
├── nativeMenu.ts        # Opens the shared ContextMenu from a right-click (pane/editor menus)
├── serverVersion.ts     # SSE subscription + version poll
├── api.ts               # HTTP client
├── keybindings.ts       # Pure shortcut matcher (parseCombo/matchesKeybinding) + eventToCombo
├── settings.ts          # Store: sync seed + hydrate + per-key PATCH persist
├── settingsCssVars.ts   # settings → :root CSS custom properties
├── settingsDiff.ts      # pure leaf-diff for per-key persistence
├── Toast.tsx
├── telemetry.ts
├── App.css              # Global styles + CSS variables
└── *.test.ts            # Unit tests for pure modules (panes, settings)
```

## Development Workflow

### Running the full stack
```bash
cd app && bun run dev
```
This runs the Tauri app + backend server concurrently. Open `http://localhost:5173` in the browser (dev server) or use the native Tauri window. Backend runs on port 4321.

### Running tests
```bash
bun test core
```
Tests use Bun's built-in test runner. Each module has a corresponding `.test.ts` file with unit tests.

### Editing notes
1. Edit `.md` files in the vault dir you launched with (`OA_VAULT` / `--vault`)
2. Server detects file change, debounces 250ms, invalidates cache, bumps version, pushes SSE event with changed paths
3. Frontend receives the SSE event and re-fetches `/graph` (or just the touched `/file`)
4. A low-frequency `/version` poll catches up if the SSE connection silently dies

### Hot-Reload Behavior

During `bun run dev`:
- **Frontend (Vite)**: Hot-reload on .tsx/.css changes; preserves editor state and graph navigation
- **Backend server**: Restarts on core/src changes; reconnects client automatically via SSE fallback poll
- **Settings**: Changes to `settings.yaml` are picked up on next request (no server restart needed)
- **Asset imports**: Changed icon/image files hot-reload via Vite; no manual restart required

Note: File-system watch debounces 250ms. If you edit a note twice within 250ms, only the second edit triggers an update.

### Cache & Debugging Patterns

**Graph not updating after editing .md:**
1. Wait for file-watch debounce (250ms) + frontend poll catchup (≤5s)
2. Check `/version` endpoint: `curl http://localhost:4321/version | jq .version`
3. Check SSE connection: open browser DevTools, Network tab, look for `/events` stream
4. If SSE is closed: the connection silently died (proxy/sleep); fallback poll (`serverVersion.ts`) will catch it within 5s

**Debug cache invalidation:**
- SSE payload includes `dirty: {graph, tree}` flags
- Graph rebuild only if `dirty.graph=true`; same for tree
- Content-only edits (no wikilink/tag/icon changes) set `dirty.graph=false` to skip expensive rebuild

**Terminal not responding:**
- Check WebSocket connection on `/terminal` (DevTools → Network → WS)
- PTY process may have crashed; check backend console for `terminal.ts` errors
- Restart the app to spawn a fresh PTY

### Performance considerations
- **Graph caching**: Only rebuilds when vault/memory files change (fs-watch + debounce)
- **Backend-precomputed layouts**: `layout.ts` produces both 2D and 3D positions on the server; the renderer morphs between them instead of running a force sim in the browser
- **Live-preview scanning**: Scans document for code blocks only when content changes, not on every keystroke
- **Label layer**: DOM-overlay native-text labels (not sprites), viewport-culled, with a stable "always-on" set of top-N hubs so labels don't pop in and out as you orbit

## Common Tasks

### Adding a new endpoint to core API
1. Add a route entry to the `routes` (read) or `mutatingRoutes` (write) table in `core/src/server.ts`
2. Implement the business logic (e.g., call `buildGraph()`, `listMarkdown()`)
3. Mutating routes go through `mutatingHandler`, which automatically invalidates the cache and broadcasts an SSE event after the handler runs — don't bump version manually
4. Test with `bun test core/test/server.test.ts` (add a case)

### Adding a graph node kind or edge kind
1. Update `NodeKind` or `EdgeKind` types in `core/src/graph.ts`
2. Update extractors (e.g., `buildVaultGraph()` in `vault.ts`) to emit new nodes/edges
3. Update frontend graph filtering in `App.tsx` if needed (e.g., "2nd brain" excludes memory nodes)

### Adding a setting
The schema is the single source of truth; defaults must equal the current hardcoded value so upgrades are behaviorally a no-op.
1. Add an entry (type, `default`, `min`/`max` or enum, a clear `doc`) to the right section of `core/src/schema/settingsSchema.ts`. New top-level section? Add it there. `DEFAULTS`, the YAML autocomplete, and the linter pick it up automatically; on next app open `reconcileSettings` adds the key to existing `settings.yaml` files (preserving user values/comments/unknown keys).
2. Add the matching field to the `Settings` interface in `app/src/settings.ts` (`settings.parity.test.ts` fails until schema ↔ interface match).
3. Wire the consumer:
   - **CSS-driven** (looks/sizes/spacing/colors): add a `--var` mapping in `app/src/settingsCssVars.ts` and reference `var(--name, <fallback>)` in the stylesheet.
   - **Frontend logic**: read `settings.<section>.<key>` directly (the store is reactive).
   - **Backend** (layout/debounce/SRS/etc.): read from `appConfig.<section>.<key>` in `core/src/server.ts` (cached via `loadAppConfig`, reloaded on settings change); thread into the module. User edits persist through `POST /set-setting`, which merges one key in place.

### Debugging graph construction
1. Run `bun run core/src/server.ts --vault /path/to/vault --memory /path/to/memory` manually
2. Call `curl http://localhost:4321/graph | jq` to inspect graph structure
3. Check `core/test/vault.test.ts` or `core/test/engine.test.ts` for examples

### Adding a Bases function
1. Add the function signature to `core/src/bases/functions.ts` (maps function name → implementation)
2. Update `core/src/bases/query.ts` to handle the return type in aggregation
3. Add tests in `core/test/bases/query.test.ts`

### Adding an SRS scheduler variant
1. Extend `core/src/srs/scheduler.ts` with new algorithm (SM-2 variant, custom decay, etc.)
2. Expose config in `core/src/schema/settingsSchema.ts` (e.g., `srs.algorithm`); thread into `applyReview` (`core/src/srs/cards.ts`)

## Error Handling

Backend errors use the `AppError` class (`core/src/error.ts`): `createError("ENOENT", "File not found")` (factory, picks status from code) or `new AppError(code, msg, status)`. `mutatingHandler` in `server.ts` maps `AppError.statusCode` to the HTTP response; generic `Error` → 500. Codes → status: `ENOENT`/`CARD_NOT_FOUND`/`BASE_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`CARD_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`CARD_FORMAT_ERROR`/`BASE_CYCLE` 400, `INTERNAL_ERROR` 500.

## Shared Helpers (avoid re-duplicating)

- **`core/src/graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — file walk + read + index used by both `vault.ts` and `memory.ts`. Use it for any new graph source.
- **`core/src/files.ts` `walkDir(root, filter)`** — recursive dir walk behind `listTree`/`listTemplates`; filter returns `true`/`false`/`{data}`.
- **`core/src/frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits frontmatter via the `yaml` Document API (preserves comments/key order/flow arrays), falls back to stringify on malformed input.
- **Resilience**: `app/src/serverVersion.ts` tracks a `ConnectionState` (connected/disconnected/reconnecting). On SSE loss it shows a "Connection lost" toast and polls `/version` at 1s (vs 5s) until reconnect, then auto-dismisses.

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
- **"agents"**: Agent interaction network showing Claude Code instances communicating via relay (see Relay Integration below)

The "agents" graph mode visualizes Claude Code instances running this project across machines. Each agent is a node; directed edges represent messages between agents. Built from `/agent-graph` endpoint (populated by `agents.ts` from Claude Communicate relay heartbeats).

### Performance Optimizations
1. **Debounced file-watch**: 250ms delay prevents thrashing on rapid edits
2. **Version-based polling**: Frontend only refetches graph when `/version` increments
3. **Node position persistence**: 2D/3D layouts cached in localStorage
4. **Lazy renderer init**: WebGL only loads when needed
5. **Frontmatter tolerance**: Malformed YAML doesn't crash graph builder

### Relay Integration

**Three Brains** integrates with **Claude Communicate** (inter-agent relay system) to:
- Track which Claude Code instances are running the project (via `/agent-graph` endpoint)
- Visualize agent communication network in "agents" graph mode
- Enable agents to coordinate vault changes across machines

See `claude-communicate-project-status` in claude-bot memory for Phase 2 (auto-discovery, circular prevention).

## Testing

Tests use Bun's native test runner. Run with:
```bash
bun test core
bun test core -- [pattern]  # Filter by filename
```

Common test files:
- `core/test/vault.test.ts` — Note graph building, wikilink extraction
- `core/test/engine.test.ts` — Graph composition (vault + memory + agents)
- `core/test/tags.test.ts`, `wikilinks.test.ts` — Extraction
- `core/test/server.test.ts`, `sse.test.ts` — HTTP + SSE behavior
- `core/test/bases/` — Bases DSL (lexer/parser/evaluate/query)
- `core/test/srs/` — SRS scheduler + parser
- `core/test/tasks.test.ts`, `tasks-query.test.ts` — Tasks
- `core/test/layout.test.ts` — Layout computation
- `core/test/terminal.test.ts`, `terminal-ws.test.ts` — PTY + WebSocket
- `app/src/panes.test.ts`, `settings.test.ts` — Pure frontend modules
- `app/src/graph/collide.test.ts`, `labelSelection.test.ts` — Graph helpers
- `app/src/calendar/EventStore.test.ts`, `dates.test.ts` — Calendar
- `app/src/editor/wikilink.test.ts`, `tag.test.ts` — Editor extensions

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser**: `position2d` / `position3d` are computed in `core/src/layout.ts` and attached via `layout-cache.ts`. The renderer morphs between them — it does not run a local force simulation. If positions look wrong, suspect the backend layout, not browser state.
- **File-watch debounce timing**: The 250ms debounce can hide rapid successive edits. If you edit a note twice within 250ms, only the second change triggers a graph rebuild.
- **SSE can silently die**: Proxies and OS sleep can drop the `/events` connection without an explicit close. The fallback `/version` poll catches this — if updates feel slow, check the EventSource state in `serverVersion.ts` and telemetry counters in `telemetry.ts`.
- **Wikilink matching is filename-based, not path-based**: `[[Another Note]]` matches a file named `Another Note.md` anywhere in the vault, even in different folders. Ambiguous matches are undefined behavior.
- **Memory graph requires Claude-bot memory directory**: If `OA_MEMORY` points to a non-existent or empty directory, the memory graph will be empty. Set up sample notes in memory directory to see "3rd brain" mode.
- **Concurrent agent port conflicts**: Running multiple instances on the same machine requires port overrides; see "Running Multiple Agents Concurrently" section. Default 4321/1420 will only work for one instance.
