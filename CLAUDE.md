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

**Three Brains** is a personal knowledge management system inspired by Obsidian, built as a monorepo with three core workspaces:

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
  - GET reads: `/version`, `/events` (SSE), `/graph`, `/tree`, `/vault-data`, `/file`, `/meta`, `/config`, `/agent-graph`, `/tasks`, `/cards/decks`, `/cards/all`, `/cards/note`, `/cards/due`
  - POST mutations (go through `mutatingHandler`): `/backup`, `/move`, `/delete`, `/restore`, `/create`, `/set-property`, `/set-setting` (merge one settings.yaml key in place — the backend is the single writer of settings), `/tasks/toggle`, `/cards/review`
  - POST reads (not mutations): `/rows` (resolve a `SourceSpec` → `Row[]`, following base composition + scoped tasks)
  - GET `/terminal` upgrades to WebSocket for terminal PTY sessions
- `sse.ts` — Server-sent event registry. `formatEvent`, `createSseRegistry`. Pushes `{version, paths, dirty: {graph, tree}}` on file changes — graph/tree consumers use `dirty` flag to skip refetch when no structural change occurred
- `engine.ts` — Graph composition. Merges vault graph + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — Builds vault knowledge graph from markdown files. Two-pass algorithm: (1) create note nodes, (2) extract wikilinks + tags + frontmatter metadata, create edges
- `graph.ts` — Graph type definitions. Node kinds: "self", "note", "memory", "agent", "tag". Edge kinds: "link" (wikilinks), "message" (memory), "about" (memory→vault), "tag"
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
- `PaneTree.tsx` / `PaneContent.tsx` — Renders the pane tree; each Leaf hosts a note, Bases view, calendar, tasks, flashcards, or terminal
- `tabIds.ts` — Sentinel ids for non-file pane contents (`::settings`, `::graph`, `::terminal`, etc.)
- `Editor.tsx` — CodeMirror 6 editor with markdown, live-preview, wikilink/tag autocomplete, embedded bases/tasks blocks
- `editor/` — CodeMirror extensions: `livePreview` (block rendering), `autocomplete` (wikilinks/tags), `basesBlock` (embed Bases view in a doc), `tasksQuery` (embed task queries), `wikilink`, `tag`
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
- `graph/LabelLayer.ts` — Sprite-based file-name labels with viewport culling, occlusion, zoom-band discovery, and an "always-on" hub set
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

**Frontend views** (`app/src/bases/`): one renderer per view kind — `TableView`, `CardsView`, `KanbanView`, `ListView`, `MapView`. `renderValue.tsx` formats cell values consistently across views. `BaseView.tsx` is the host that picks the right renderer.

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
- `components/views/` — `MonthView`, `ThreeDayView`, `TimeGrid`

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
- `srs/cards.ts` — Card model + persistence
- `srs/scheduler.ts` — SM-2-style scheduling (next-due, ease factor)
- Endpoints: `/cards/decks`, `/cards/all`, `/cards/note`, `/cards/due`, `POST /cards/review`
- `Flashcards.tsx` — Review UI

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs. Backend spawns a PTY via `bun-pty` and bridges it over WebSocket on `/terminal`. Frontend renders with xterm.js, with the ANSI palette wired from the graph color theme (`buildAnsiPalette`). DOM-rendered (not canvas), styled to match the editor.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure model, unit-tested). Each Leaf holds a content id: either a note path or a sentinel from `tabIds.ts` (`::settings`, `::graph`, `::terminal`, `::flashcards`, `::calendar`, plus per-base sentinels). `PaneTree.tsx` walks the tree; `PaneContent.tsx` routes a leaf id to the right view.

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
├── changeClassifier.ts  # Tracks note-level changes (wikilinks/tags/icon) to selectively invalidate graph vs tree
├── tasks.ts             # Tasks extraction
├── tasks-query.ts       # Tasks query DSL
├── terminal.ts          # PTY session manager (bun-pty)
├── dates.ts             # Date math (shared by tasks/SRS/calendar)
├── basesData.ts         # Vault-wide data feed for Bases
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
├── bases/               # Base view renderers (Table/Cards/Kanban/List/Map)
├── calendar/            # Calendar feature (CalendarPage, EventStore, views/, components/)
├── palette/             # Command palette + quick switcher
├── serverVersion.ts     # SSE subscription + version poll
├── api.ts               # HTTP client
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

### Performance considerations
- **Graph caching**: Only rebuilds when vault/memory files change (fs-watch + debounce)
- **Backend-precomputed layouts**: `layout.ts` produces both 2D and 3D positions on the server; the renderer morphs between them instead of running a force sim in the browser
- **Live-preview scanning**: Scans document for code blocks only when content changes, not on every keystroke
- **Label layer**: Sprite-based, viewport-culled, with a stable "always-on" set of top-N hubs so labels don't pop in and out as you orbit

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

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `OA_VAULT: not set` when running `bun run dev` | Set environment variable: `export OA_VAULT="/path/to/vault"` before running |
| `OA_MEMORY: not set` | Set environment variable: `export OA_MEMORY="/path/to/memory"` before running |
| Backend on :4321 doesn't respond | Check that `core/src/server.ts` started (look for "Server running" message) |
| Frontend on :5173 shows connection error | Backend may be crashed; check that OA_VAULT and OA_MEMORY directories exist and are readable |
| Graph nodes not updating after editing .md | Wait for file-watch debounce (250ms) + frontend version poll (may take a second or two) |
| Tests fail with file permission errors | Ensure test helper can create temp directories in `/tmp` (or adjust `core/test/helpers.ts` path) |
