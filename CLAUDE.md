# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
bun install                                       # from repo root (all 7 workspaces)
cd app && bun run dev                             # browser: core on :4321 + Vite on :1420
cd app && bun run dev:app                         # native: the same two + the Tauri window
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian, built as a monorepo with seven workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: backend server — vaults, knowledge graphs, and the read window onto the per-vault daemon's memory
- **cli**: the `bismuth` binary
- **app**: Tauri + Solid + TypeScript — CodeMirror editor + 2D/3D graph. Desktop AND iPad/iOS; mobile swaps the HTTP backend for an in-process one
- **relay**: a hooks-only Claude Code plugin reporting each terminal-tab session + subagents to core's in-process registry, and injecting the vault's memory when the daemon is enabled
- **mcp**: a stdio MCP server (`docs/` reference + `bismuth` CLI + `bismuth_skill`; plus `remember`/`recall`/`forget` when the daemon is enabled) — per-tab in dev, machine-wide from the bundled app
- **memory**: `@bismuth/memory` — the pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL), shared by daemon/relay/MCP; every entry point takes an explicit dir (`BISMUTH_MEMORY_DIR`)
- **daemon**: `@bismuth/daemon` — ONE machine process multiplexing every enabled vault's brain (memory + crons + processes + a conversation session); a bundled binary run by launchd/systemd

Knowledge is a **three-brain** model: **2nd Brain** = the vault (markdown + wikilinks/tags/frontmatter); **3rd Brain** = the daemon's memory graph under `<vault>/.daemon/memory`, joined to vault notes as `mem:` nodes + `about` edges, and present only when the daemon is enabled.

## Environment Setup

**A fresh clone runs with no setup.** `bun run dev` → `app/scripts/dev.ts` → `devVault.ts`: `BISMUTH_VAULT`/`BISMUTH_MEMORY` win if exported, else it materialises a generated example vault at repo-root `.dev-vault/` (gitignored — dev builds WRITE to their vault; missing files are restored, existing left alone, `rm -rf .dev-vault` = clean reset). `dev.ts` also mints ONE owner token per run for both halves (`BISMUTH_OWNER_TOKEN` → core, `VITE_OWNER_TOKEN` → the bundle, read by `api.ts`'s `resolveOwnerToken`) — without it content routes 403 or silently filter once a vault marks anything `visibility: chat-only`/`hidden`. **Dev/standalone only** — the bundled app self-spawns core + resolves its vault from `config.json` or a first-run picker (see Desktop app & core sidecar).

## Documentation

`docs/` (committed) is the exhaustive, code-anchored reference — bases/settings syntax, CLI, daemon, storage, HTTP API, MCP. Start at `docs/README.md`; keep it current.

## Key Commands

### Development
- `bun run dev` (in `app/`) — core backend + Vite concurrently with hot reload, on the example vault unless `BISMUTH_VAULT`/`BISMUTH_MEMORY` are exported. `bun run dev:app` adds the Tauri window **in the same process group** (never let `tauri.conf.json`'s `beforeDevCommand` start it — that runs `bun run dev` again and collides a second core+Vite pair on :4321/:1420)
- `bun run serve` (in `app/`) — `vite preview` of a production build
- `bun run core/src/server.ts --vault <v> --memory <m>` — backend standalone (both flags required)

### Testing
- `bun test core` — the whole core workspace; `bun test core/test/wikilinks.test.ts` — one file. **`bun test core -- <pattern>` does NOT filter** — Bun's positional args are OR'd substring path matches and `core` already matches everything, so the pattern is ignored. Pass an exact path.
- `bun run typecheck` (root) — `tsc --noEmit` per workspace, each pinning its own local `typescript` so the gate resolves offline. `core`/`cli`/`mcp`/`memory`/`daemon` pin `7.0.2`; `app`/`relay` pin `~5.6.2` — a deliberate, unresolved split.
- **Tests are REQUIRED to commit.** `.githooks/pre-commit` → `scripts/gate.ts`: typecheck (all workspaces) + *fast* tests for the workspaces your staged files touch. `.githooks/pre-push`: docs check + the *full* suite. Hooks ride `core.hooksPath`; a fresh clone runs `bun run hooks:install`. Bypass with `BISMUTH_SKIP_GATE=1`; run by hand with `bun run gate`.
- `BISMUTH_FAST_TESTS=1` (`bun run test:fast`) skips the SLOW suites — real agent binaries, PTY/WS integration, the layout benchmark (`core/test/slowGate.ts`, the opt-OUT sibling of `liveGate.ts`'s opt-IN). Unset (plain `bun test`, CI) runs everything, so nothing is lost to a forgotten flag.
- **`core/test/upgrade/`** (`bun run test:upgrade`) — what a user's data survives on update: all three historical `.settings` layouts migrate without losing values, comments or unknown keys; `schemaSnapshot.test.ts` pins every schema default/type/bound to a committed snapshot (re-bless: `bun run test:bless-schema`).

### Building
- `bun run build` (in `app/`) — Vite production build. `bun run tauri build` — native Tauri executable.

### Infrastructure
- `bun install` — all workspaces. `bun run core:serve` — standalone core server.
- **Concurrent instances**: `:4321`/`:1420` serve one. For more, `PORT=4322 bun run dev` (standalone server takes `--port`; frontend reads `VITE_API_BASE`).

## Architecture

### Core Backend (`core/`)

Manages the vault filesystem, builds knowledge graphs, watches for changes, serves the HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve): caching, file watching, SSE broadcast, three WS upgrades (`/terminal` PTY, `/chat`, `/ui` per-window app-control). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, `/ui/*`, daemon writes). Also drives `/gcal/*` + a 60s sync ticker. **Full reference: `docs/api/http-reference.md`.**
- `sse.ts` — pushes `{version, paths, dirty:{graph,tree}}` on file changes; consumers use `dirty` to skip refetch when nothing structural moved.
- `engine.ts` merges the vault + memory graphs (+ "about" edges); `vault.ts` builds the vault graph two-pass (nodes, then wikilink/tag/frontmatter edges); `memory.ts` the `mem:` namespace. `graph.ts` — node kinds note/memory/tag/self/daemon/cron/process; edge kinds link/message/about/tag/open/supervises.
- `layout.ts` — pure layout (pivot-MDS + force sim) → 2D + 3D `Positions`; `layout-cache.ts`'s `attachLayout()` stamps them onto nodes and the frontend morphs between them (no client force sim). `community.ts` — hierarchical community detection.

- `files.ts` (I/O + path-traversal rejection) · `frontmatter.ts` (tolerates malformed YAML) · `wikilinks.ts`/`tags.ts`.
- `visibility.ts`/`visibilityCliGate.ts` — AI-visibility: per-channel deny lists gating most read routes + the CLI gate. Ref: `docs/vault/visibility.md`.
- `relay.ts` — in-process registry of terminal-tab sessions + subagents (fed by `POST /relay/*`, pruned against the live pty set); `GET /relay/snapshot` redacts `lastMessage` for non-owners.
- `uiControl.ts` — registry of OPEN windows + a request/reply channel (`/ui` WS) behind the `app` CLI + MCP app control. `runRegistry.ts` — `~/.bismuth/run/<vault>.json` (port discovery + the `0600` owner token).
- `daemon.ts`/`daemonGraph.ts`/`daemonViz.ts` — daemon state reader (never throws) + the "daemon" graph builder + pure `nodeVisualState()`.
- `chat.ts` — the visual chat (`/chat` WS): one long-lived Agent-SDK `query()` per chat over the user's own binary. `chatProviders/`+`agentBackends/` — the provider seam + capability catalog behind **nine** backends (claude, opencode, codex + six ACP-based). Refs: `docs/chat/overview.md`, `docs/chat/backends.md`.
- `terminal.ts` — PTY manager (`bun-pty`); injects relay provenance + a PATH shim so a bare `claude` auto-loads the relay plugin (`buildPtyEnv`, pure + tested).
- `backup.ts` · `tasks.ts`/`tasks-query.ts` · `dates.ts` · `calendar.ts` · `basesData.ts` (the vault feed for Bases) · `gcal/` · `fileAccess.ts`/`localBackend.ts` (mobile seam).

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change; `rowsCache`/`tasksCache` are `createAsyncCache` instances (in-flight dedup). A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`. The frontend keeps one `EventSource("/events")` and re-fetches per event, with a `/version` poll as fallback. Ref: `docs/overview/data-flow.md`.

### Frontend App (`app/`)

Solid.js + TypeScript, CSS Modules.

- `App.tsx` — root: tab + pane tree, active-file routing, graph mode, settings persistence, global keys. It composes its render out of **`shell/`** — `AppFrame` `TopStrip` `TabRail`/`TabRailRow` `Sidebar` `StatusBar` `EditorPane` `GraphFloater` `PaneOverlay` `DragGhost` `WindowControls` `CommandButton` — presentational, slot-driven components that own no signal and never fetch (so every one renders in Storybook with stubs). `panes.ts` — pure binary-tree model for splits (Leaf/Split), unit-tested. `PaneTree.tsx`/`PaneContent.tsx` route a Leaf (via `PaneLeaf`/`PaneHeader`/`PaneDropZone`) to a note, Bases view, `.sheet`, `.draw`, calendar, tasks, flashcards, terminal, chat, preview, or export view.
- `tabIds.ts` — sentinel ids for non-file panes (`::graph`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`/`::chat:`); notes/bases/sheets/drawings/settings route by path. There is no `::search` — search is the Cmd+O switcher takeover (`palette/SwitcherBar.tsx`), the app's ONE search surface.
- `Editor.tsx` (CodeMirror) + `BlockEditor.tsx` (Milkdown WYSIWYG) — two note surfaces; `editor.defaultMode` picks which opens (reactive live swap). `editor/` holds the CM extension set (live-preview, autocomplete, ` ```query ` blocks, embeds, GFM tables, find, KaTeX, Harper); `editorRegistry.ts` flushes autosaves before renames. Detail: `docs/editor/`.
- **UI primitives** (`ui/`): `Text` `Heading` `Label` `Badge` `Button` `Modal` `Field` … each `export default` with a colocated `.module.css` + story. Reach for one instead of a bare `<p>`/`<span>`; `ui/uiLint.test.ts` guards the set. Also `ui/ascii/` (Glyph, Kbd, AsciiTree, AsciiMeter, GraphField).
- **Settings have no GUI page** — the "settings page" IS `.settings` (a hidden extensionless file per vault) opened in the editor like any note, with schema-aware autocomplete + lint. `core/src/schema/settingsSchema.ts` is the single source of truth.
- `PreviewView.tsx` + `preview/` — non-note file previews (`assetUrl`, `findMatches`, `previewKind`).
- `FileTree.tsx` — drag-drop moves, rename retargets the active tab, delete undo, multi-select, icon picker, `.settings`/`.daemon` protection. `bases/` — the 12 view renderers + `markdown.ts` (shared markdown→HTML). `api.ts` — backend client over a swappable `Transport` (in-process on mobile).
- `settings.ts` — store seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves (`settingsDiff.ts`, no comment clobbering); mirrors the schema (`settings.parity.test.ts`). `settingsCssVars.ts` projects settings + theme tokens into `:root` custom properties.

**Graph rendering**: `graph/AsciiGraphRenderer.ts` is **the** renderer (no choice) — a Canvas-2D *character grid*, not WebGL, for both 2D and 3D; it only rescales the backend's precomputed layouts. **Zoom is RESOLUTION, not scale**: a mark's size never changes; a wheel notch re-rasterizes at a finer grid and steps a three-band ladder (far = cluster masses → near = glyphs + member edges). Seam: `graph/graphRenderer.ts`. Pure unit-tested: `respace` `backbone` `clusterVisual` `cameraModel` `lod` `asciiGrid` `labelSelection`. Ref: `docs/graph/overview.md`.

**Styling**: **CSS Modules are the rule** — every component's rules live in a colocated `<Component>.module.css` (37 of them). `App.css` is now the GLOBAL layer ONLY: design tokens, the element reset, and classes written into runtime-generated HTML strings; it `@import`s `styles/{tokens,reset,content,icons}.css`. Two traps: **CSS `@import` HOISTS**, so an imported stylesheet is emitted AHEAD of every rule left in `App.css` and relocating a rule silently flips precedence (`cssLayering.test.ts` guards this); and a module class is **hashed at build time**, so a call site still holding the old literal (`class="ft-row"`) compiles, renders, and matches nothing — `bench/moduleClassCheck.ts` cross-checks emitted CSS against emitted JS to catch exactly that. Colour is centralized in **`core/src/theme/tokens.ts`** (the 4 themes ink/paper/cathode/riso + semantic/shadow tokens + category swatches — in `core` so gcal/drawing/export/schema can import it; `app/src/themes.ts` re-exports it). Ref: `docs/settings/themes.md`.

**Storybook is THE visual-verification surface** — `bun run storybook` from `app/` (:6006, Storybook 9 + `storybook-solidjs-vite`); 427 stories / 120 components. `app/.storybook/preview.ts` does two things globally that must NOT be re-solved per story: projects the real theme tokens (so **never hardcode a stand-in for a design token**) and installs an in-memory `fakeTransport` (without it every mount-fetching component renders a permanent "Loading…" that reads as a passing story). Fixtures: `app/src/ui/_{baseFixtures,fakeTransport,calendarFixtures,graphFixtures,daemonFixtures,cmHarness}`. **Caveat:** `GraphView` pauses its rAF loop when `document.visibilityState === "hidden"`, so a backgrounded automation tab samples a 0%-inked canvas — indistinguishable from a broken renderer; every `bench/` tool drives its own Chrome (`bench/chromeSession.ts`) for exactly that reason.

**Visual checks (`bench/`, repo root, NOT a workspace)**: `bun run visual` is the everyday one — baseline-free invariant checks over only the stories the diff can affect (seconds). `visual:all` sweeps everything, `visual:affected` maps changed files → stories, `visual:baseline` records every computed property of every element and is **not** the habitual gate (it cannot tell a deliberate restyle from a regression, so any design change costs a full re-record). Also `storyAudit.ts` (flags what is visibly BROKEN *now* — a baseline can never see this, since the broken state IS its recording), `probeStory.ts` (one-story microscope), `moduleClassCheck.ts` (see Styling), `visual.ts` (shots of the RUNNING app). Full detail: `docs/contributing/testing.md`.

### CLI (`cli/`)

The `bismuth` binary (a thin wrapper over `@bismuth/core`) controls the vault from the shell. File-based commands run **headlessly** (no server); the app's watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`BISMUTH_VAULT`.

- `src/index.ts` — dispatcher: one merged registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap. `src/args.ts` + `src/types.ts` are the seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. Groups: `file` `note` `search` `graph` `task` `base` `card` `prop` `calendar` `settings` `daemon` `draw` `serve` `backup` `export` `api` `app` (drives a RUNNING app's tabs via `/ui/*`) `page` `install` `checkpoint` `update` `gcal` `relay` `chat`. Every command + flag: `docs/cli/reference.md`.

**Owner-token reach** (`cli/src/http.ts`): `call()` attaches `X-Bismuth-Token` from the vault's `0600` run record, **loopback only**, so the owner's shell reads owner-gated routes. The agent boundary is `BISMUTH_AGENT_CHANNEL` — an env var, **not** a cryptographic boundary.

**Adding a command**: add a `Command` to a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` + `docs/bases/views/` (per view kind). This is the summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas and views over the vault's notes. There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`): `lexer`→`parser`→`parse` → `evaluate`+`filters` → `functions` → `query` (Base × the `basesData.ts` feed → rows + grouping).

**Frontend views** (`app/src/bases/`): one renderer per kind. `ViewType` (`core/src/bases/types.ts`) spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap` (charts via `bases/chart.ts`). `BaseView.tsx` picks the renderer; `renderValue.tsx` formats cells.

A base can also be **queried inside a note** via a ` ```query ` block — the only embedded block (no ` ```base `/` ```view `/` ```tasks `). Its body is a full inline base config (`views:`/`filters:`/`formulas:`/`source:`) or a flat query spec (`of: [[Base]]`, `tasks:`, `where:`, `group:`, `view:`). Rendered by `editor/queryBlock.ts`.

**Sources & composition** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]` — `base` (recursive), `notes`, or `tasks`. Cycle-guarded + **server-side** via `POST /rows {spec}`, cached server-side + client SWR (`bases/rowCache.ts`). Detail: `docs/bases/sources.md`.

**Authoring**: `bismuth base create|validate|render` + the `skills/authoring-bismuth-bases` skill (it carries the view-selection decision table). Note `parseBaseFile` silently downgrades an invalid `views[].type` to `table`, so `base validate` reads raw frontmatter instead.

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — no standalone page. Open one via a `type: base` md with `views: [{ type: calendar }]`. `app/src/calendar/` holds shared state + components (`EventStore.ts` CRUD, `state.ts`, `dates.ts`, `categoryColor.ts`, `components/views/` Month/Week/ThreeDay/Day/TimeGrid). A calendar base can be **two-way-synced with Google Calendar** (`core/src/gcal/`) — `docs/gcal/overview.md`.

### Tasks (`core/src/tasks*.ts`)

Obsidian-Tasks-compatible. Tasks are a **base source** (`source: tasks`, optionally `from: [[Base]]`), not standalone — queried via a ` ```query ` block with `tasks: <dsl>`. `tasks.ts` extracts items from markdown; `tasks-query.ts` = the DSL; `bases/taskRow.ts` projects them as `Row`s; `POST /tasks/toggle` rewrites the line. Ref: `docs/tasks/`.

### Flashcards / SRS (`core/src/srs/` + `app/src/bases/FlashcardsView.tsx`)

Flashcards are a **Bases view kind** (`flashcards`) over a base's rows (`bases/FlashcardsView.tsx`). Two paths share `srs/scheduler.ts` (SM-2): **Markdown cards** (`srs/parser.ts`+`cards.ts`) and **Row cards** (`srs/reviewRow.ts`). **Markdown card syntax** — a note is collected ONLY if it carries the `flashcards` tag (`BASE_TAG`; `flashcards/sub` = sub-deck), so an untagged note with perfect syntax yields nothing: **inline** `front::back` (basic) or `front:::back` (reversed, 2 sub-cards); **multi-line** separated by a lone `?`/`??` on its OWN line (a trailing inline `?` is NOT a card); **cloze** via `==x==`, `{{x}}` or `**x**` (`CLOZE_RE`). Queue logic is pure + unit-tested (`bases/flashcardsQueue.ts`). **Bidirectional** (toggle in `BaseSettings.tsx`) schedules the reverse in `*Back` columns; **cram mode** ignores due dates and never writes scheduling. Endpoints + CRUD: `docs/flashcards/srs.md`.

### Terminal (`core/src/terminal.ts` + `app/src/Terminal.tsx`)

In-app terminal tabs: backend spawns a PTY (`bun-pty`) bridged over WS on `/terminal`; frontend renders with xterm.js. Each PTY's env (`buildPtyEnv`, pure + tested) injects relay provenance + a PATH shim.

### Sheets (`app/src/SheetView.tsx` + `app/src/sheet/`)

A `.sheet` is a Univer workbook JSON snapshot (`@univerjs/presets`), code-split behind `sheet/univerSheet.ts`. `sheet/snapshot.ts` (parse/serialize) + `sheet/sync.ts` (`isExternalChange` gates reloads). `PaneContent` routes `*.sheet` → `SheetView`.

### Drawing (`app/src/drawing/` + `core/src/drawing/`)

A `.draw` is a versioned JSON `DrawingDoc` (pages, strokes, `images?`, paper background) — a multi-page vector sketch routed by `PaneContent.tsx` (lazy `DrawingPage.tsx`). **Backend (`core/src/drawing/`, pure + headless)**: `model`/`geometry`/`smooth`/`render2d`/`paper`/`export` (`renderDocToPng`/`renderDocToPdf`). **Frontend**: `DrawingCanvas.tsx` (dual canvas, stylus pressure/velocity width), `Toolbar.tsx`, `store.ts`, `pdfRaster.ts`. Opening an image/PDF auto-creates a `.draw` sidecar; persisted via `PUT /file`. Detail: `docs/drawing/overview.md`.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure, unit-tested); each Leaf holds a content id (a note path or a `tabIds.ts` sentinel). `PaneContent.tsx` routes it; per-window tab layout is keyed by `windowId.ts`.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class content routed to `GraphView` via `App`'s `renderGraph()`; `App` seeds one when nothing is restored and reopens one if all tabs close (tabs never empty). **Tab renaming**: double/right-click → Rename sets a custom `name` on the `Leaf`, overriding `contentLabel()`.

### Commands & Sidebar Toolbar

Commands are pure data + behavior so the palette and the sidebar header bar share one source: `core/src/commands.ts` (`COMMAND_CATALOG` → the `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → a live `{id,label,icon,action}` map). The bar above the file tree is configured by `toolbar:` in `.settings` — each item `{ command | commands: [...], icon, tooltip? }`. Full list: `docs/settings/toolbar-commands.md`.

**Adding a command:** `COMMAND_CATALOG` (core) + an `action` in `bindCommands` (app); enum/autocomplete/palette follow. (A new *top-level* schema key also needs the key lists in `core/test/schema/settingsSchema.test.ts`.)

**Runtime backend base** (`app/src/api.ts`): `resolveBase` picks `?api=<url>` > `window.__BISMUTH_API__` > `VITE_API_BASE` > `:4321`, so one build serves multiple windows.

### Keybindings

Global shortcuts come from `keybindings:` in `.settings` (nothing hardcoded in `App.tsx`). Same split as commands: `core/src/keybindings.ts` (`KEYBINDING_CATALOG` → schema) + `app/src/keybindings.ts` (`matchesKeybinding`). `"Mod"` = Cmd/Ctrl; matching is **exact**; combos comma-separated; matches the produced key OR physical `event.code`. **Adding one:** add to `KEYBINDING_CATALOG`, read `settings.keybindings.<id>` via `matchesKeybinding`.

## Frontend Conventions (house rules)

These are project-wide and **override framework habits**. They apply to every agent working in `app/`.

- **One component per file. PascalCase filename matching the export.** Utilities, hooks and logic modules are camelCase (`settingsDiff.ts`). Never kebab-case component files.
- **Every component has a colocated `<Component>.module.css`.** Never a parallel `styles/` tree. `app/src/styles/` is the four *global* stylesheets only.
- **A shared stylesheet means a missing component.** If two components import the same `.module.css`, the shared rules are a component nobody extracted — extract it and have both compose it. Do not "fix" this by splitting the stylesheet into per-component copies.
- **Everything is a component, even text.** Never write a bare `<p>`/`<span>`/`<h1>`/`<button>` with a class where a `ui/` primitive exists (`Text` `Heading` `Label` `Badge` `Button` `Field` …). If no primitive fits, **the primitive is missing** — add it rather than working around it. `ui/Text.tsx` states this in its own doc comment.
- **Break things down further than feels necessary.** The default answer to "is this big enough to extract?" is yes.
- **This is Solid, not React — two habits from React will break it.** (1) There is no `FC`; type a component as `Component<Props>` from `solid-js`. (2) **Never destructure props.** `({ color }) => …` reads the field ONCE at setup and permanently unsubscribes the component from later changes, so it silently keeps its first value forever — no typecheck error, no test failure, no console warning. Take `props` whole and read `props.color` at the point of use. `ui/Text.tsx`, `ui/Heading.tsx` and `ui/Badge.tsx` are the pattern to copy. A general "type components as FC, destructure props in the signature" convention is React-shaped and does not apply here.
- **Variants are props, not new files** (`Heading level={1..6}`, not `Heading1.tsx`).
- **Accept an optional `className` merged onto the root element**, so a caller can adjust one instance without forking the component.
- **Pure logic lives in plain `.ts` modules with no framework imports.** That is what keeps it unit-testable and what lets the component render in Storybook.
- **Reach through the tree, not through the DOM.** Never call `e.target.closest('.some-class')` or check `classList` against a **class name** from inside a component. CSS Modules hash the class at build time, so the string compiles, renders, and matches **nothing** — the guard silently stops firing at runtime with no typecheck, no test and no story catching it. The child should declare the event is its own via `stopPropagation`. **Trap:** `stopPropagation` on `onClick` does *not* stop `onPointerDown` or `onDblClick` — a row that drags on pointerdown needs all three.
  Allowed and should be left alone: `closest()` on **tag** selectors (`'input, textarea, button'`), `closest()` on **data attributes** (`'[data-pane-leaf]'`), plain-DOM libraries (CodeMirror extensions, the canvas renderer, `ui/popover/rowDom.ts`), and `document.documentElement.classList`.
- **Every component you add or meaningfully change gets a story.** A component with no story is invisible to the visual-verification workflow and effectively untested.
- **Formatting:** no semicolons, single quotes, 4-space indent, `x => x` not `(x) => x`. Match the surrounding file.
- **Agent working artifacts** (plans, ledgers, scratch reports) go in `.claude/`, never in the repo source tree.

## Workspace Management

Bun `workspaces` in the root `package.json`: `core` exports `@bismuth/core`, imported by `app`/`cli`/`mcp`. Add a dep with `cd <workspace> && bun add <package>`; `bun install` at root syncs all.

## Module Organization

Purposes are in **Architecture** above; this is the layout. **Exhaustive per-file map: `docs/contributing/codebase-map.md`.**

```
core/src/
  server.ts sse.ts                     # HTTP + SSE + WS, mutating-route abstraction
  engine.ts vault.ts memory.ts graph*.ts layout*.ts community.ts   # graph build + layout
  relay.ts uiControl.ts runRegistry.ts daemon*.ts   # relay registry; /ui channel; ports; daemon read-window
  files.ts frontmatter.ts wikilinks.ts tags.ts backup.ts search.ts templates.ts dailyNote.ts …
  settings.ts schema/                  # .settings lifecycle + THE schema (24 top-level sections)
  theme/tokens.ts                      # the one source of colour: 4 themes (ink/paper/cathode/riso)
  visibility.ts visibilityCliGate.ts   # AI-visibility deny lists + the CLI-dispatch gate
  chat.ts chatProviders/ agentBackends/  # visual chat + the nine backends + capability catalog
  fileAccess.ts localBackend.ts        # mobile IO seam + in-process no-HTTP backend
  bases/ srs/ gcal/ drawing/           # Bases DSL · SRS · gcal sync · .draw vector docs
core/test/  # one *.test.ts per module; helpers.ts → makeSampleVault(); upgrade/ = cross-version safety

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane-tree model, routing
  shell/       # the App.tsx chrome, componentized: AppFrame TopStrip TabRail TabRailRow Sidebar
               #   StatusBar CommandButton EditorPane GraphFloater PaneOverlay DragGhost WindowControls
  PaneLeaf.tsx PaneHeader.tsx PaneDropZone.tsx EmptyPane.tsx   # the pieces a Leaf renders
  ui/          # primitives: Text Heading Label Badge Button Modal … (+ ascii/ gallery/ popover/)
  styles/      # the only global stylesheets: tokens.css reset.css content.css icons.css
  Editor.tsx editor/ · BlockEditor.tsx blocks/              # CodeMirror surface · Milkdown WYSIWYG surface
  ChatView.tsx chat*.ts                # visual chat + ~14 pure unit-tested modules
  GraphView.tsx graph/                 # the ONE renderer (AsciiGraphRenderer) behind the graphRenderer seam
  FileTree.tsx FileView.tsx Terminal.tsx SheetView.tsx ExportView.tsx PreviewView.tsx + sheet/ export/ …
  bases/ calendar/ palette/ drawing/ intro/ ai/ mobile/ preview/ icons/ dnd/  # ui/_*.ts* = story fixtures
  api.ts settings.ts settingsCssVars.ts keybindings.ts themes.ts …
app/.storybook/  # Storybook 9 config — preview.ts injects theme tokens + the in-memory transport
app/src-tauri/   # Tauri shell (Rust): spawns the core sidecar + first-run vault picker
app/scripts/     # dev.ts (THE dev entry point) + devVault.ts (the generated example vault) + builders
bench/           # NOT a workspace — the visual gate: invariants checkChanged affected cssBaseline
                 #   storyAudit probeStory moduleClassCheck chromeSession

cli/src/    # `bismuth` binary: index.ts dispatcher + args.ts seam + commands/<group>.ts
mcp/src/    # stdio MCP server: 6 always-on tools + 3 daemon-gated (app control adds ZERO tools)
relay/      # Claude Code plugin: hooks/ (→ POST /relay/*) + shim/ + .mcp.json
daemon/src/ # per-vault brain: daemon/ (session, cron, process, seeds) + lib/
skills/     # NOT a workspace — agent skills shipped to all 9 backends via 3 adapters
```

## Development Workflow

- **Hot-reload**: Vite hot-reloads `.tsx`/`.css` (state preserved); **backend restarts** on `core/src` changes; `.settings` is re-read per request. Vault `.md` edit → debounce → invalidate → version bump → SSE → re-fetch.
- **Graph not updating?** Wait the 250ms debounce + ≤5s poll; `curl :4321/version`; watch `/events` in DevTools. Content-only edits set `dirty.graph=false` (rebuild skipped) — expected.

## Common Tasks

- **Add a core endpoint**: a route in `routes` (read) or `mutatingRoutes` (write) in `core/src/server.ts` — mutating goes through `mutatingHandler` (auto invalidate + SSE). Add a `server.test.ts` case.
- **Add a shell component**: a slot-driven, props-only `.tsx` + `.module.css` + `.stories.tsx` in `app/src/shell/`, wired into `AppFrame.tsx`.
- **Add a graph node/edge kind**: `NodeKind`/`EdgeKind` in `core/src/graph.ts`, emit from `buildVaultGraph()`, adjust mode filtering in `App.tsx`.
- **Add a setting** (schema = single source of truth; default = the current hardcoded value): (1) entry in `core/src/schema/settingsSchema.ts`; (2) the field on `Settings` in `app/src/settings.ts` (`settings.parity.test.ts` enforces parity); (3) wire the consumer (a CSS `--var` in `settingsCssVars.ts`, or `settings.<section>.<key>`). Persist via `POST /set-setting`.
- **Debug graph construction**: run standalone, `curl :4321/graph | jq`; see `core/test/{vault,engine}.test.ts`.
- **Add a Bases function**: a case in `callFunction`/`callMethod` (`core/src/bases/functions.ts`), handle its return type in `query.ts`, test in `core/test/bases/query.test.ts`.
- **Add an SRS scheduler variant**: extend `core/src/srs/scheduler.ts`, expose config in `settingsSchema.ts`, thread into `applyReview`.

## Error Handling

Backend errors use `AppError` (`core/src/error.ts`): `createError(code, msg)` or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` onto the response (generic `Error` → 500). The code→status table (`ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400) lives in `error.ts`.

## Shared Helpers

- **`core/src/graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — the walk+read+index behind `vault.ts` + `memory.ts`. Use it for any new graph source.
- **`core/src/files.ts` `walkDir(root, filter)`** — recursive walk behind `listTree`/`listTemplates`; filter returns `true`/`false`/`{data}`.
- **`core/src/frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits via the `yaml` Document API (preserves comments/key order/flow arrays), falls back to stringify on malformed input.
- **`app/src/serverVersion.ts`** tracks a `ConnectionState`; on SSE loss it toasts "Connection lost" + polls `/version` at 1s until reconnect.
- **`app/src/sanitizeHtml.ts`** — DOMPurify wrapper for `innerHTML` of vault-rendered HTML. Always route rendered HTML through it, built with the canonical `app/src/htmlEscape.ts`, not per-file escapers.

## Key Concepts

### Vault Structure
Markdown tree; YAML frontmatter; wikilinks `[[Another Note]]` matched by **file name, not path**; top-level folder → the `folder` field on nodes (`reading/quotes/x.md` → `folder="reading"`). The memory graph is built separately with `mem:`-prefixed nodes, joined to vault notes by "about" edges.

### Graph Modes
- **"2nd"** vault notes + tags · **"3rd"** memory · **"both"** everything + cross-edges · **"daemon"** the daemon hub → its crons + processes (`supervises` edges; fill/border encode enabled/running) · **"local"** the open note's immediate neighborhood only (`localSubgraph`, `graph/displayGraph.ts` + `localLayoutInput.ts`), the one mode laid out in the browser. Ref: `docs/graph/overview.md`.

`GraphMode` (`app/src/commands.ts`) is exactly `"2nd" | "3rd" | "both" | "daemon" | "local"` — there is no "agents" mode; `relay.ts` + `POST /relay/*` feed chat's subagent tracking + terminal pruning, not a graph.

**2D/3D toggle**: a transient localStorage flag, not a `.settings` key — persists across sessions but never appears in the settings file. Toggle from the graph toolbar.

### Performance
See **Caching + data flow**; plus lazy graph-renderer init, content-gated live-preview rescans, malformed-YAML tolerance, and base SWR caching (`bases/rowCache.ts`).

### Desktop app & core sidecar (`app/src-tauri/`)

The bundled `/Applications` app **spawns its own `core` backend** (not `bun run dev`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary; on launch `src/lib.rs` picks a free port, spawns the sidecar, kills it on exit, and injects `window.__BISMUTH_API__`. A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** it sets `window.__OA_FIRST_RUN__` and `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/` → Tauri `choose_first_vault` → writes config + seeds `.settings` → relaunch). Deep detail: `docs/overview/install.md`.

### Mobile / iPad (`core/src/localBackend.ts` + `core/src/fileAccess.ts` + `app/src/mobile/`)

On iPad/iOS the Bun HTTP server can't run, so the app runs the **same core logic in-process, no HTTP**, via two seams: **`core/src/fileAccess.ts`** (desktop lazy-imports `files.ts`; mobile registers a `tauri-plugin-fs` impl via `setFileAccess()` — nothing statically imports Bun/`node:fs`) and **`app/src/api.ts`**'s swappable `Transport`. **`core/src/localBackend.ts`** `dispatch(method,path,body)` reuses engine/bases/search/tasks/srs — reads + content-only writes, `NOT_SUPPORTED` for structural fs ops/set-setting/upload/backup. `bootMobile.ts` swaps both seams before importing `App`; change detection via `backend.subscribe()`, not SSE. Detail: `docs/mobile/overview.md`.

### MCP Integration (`mcp/` workspace)

A stdio MCP server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 6 always-on tools (`bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`, `bismuth_skill`) + 3 daemon-gated memory tools (`remember`/`recall`/`forget`). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed machine-wide on boot (`core/src/bismuthInstall.ts`) → cli+mcp+docs to `~/.bismuth`, symlinked onto PATH, registered in `~/.claude.json`. **App control** adds **ZERO new MCP tools** — it rides `bismuth_cli` via the `app`+`page` groups → core's `/ui/*` WS. Detail: `docs/mcp/overview.md`, `docs/mcp/app-control.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`). Loads per-session inside app terminals (bundled via `BISMUTH_RELAY_BUNDLE`; nothing in `~/.claude`); `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads it. Closing a tab prunes its session; the registry lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

**One machine process multiplexing per-vault brains**: machine identity at `~/.bismuth/daemon` (`daemonMachineDir()`, `BISMUTH_DAEMON_DIR`); each enabled vault's brain (memory, crons, processes, session) under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault per tick; a reconcile loop starts/pauses a brain as `settings.daemon.enabled` flips. `sendMessage` passes per-call `cwd`, `env.BISMUTH_MEMORY_DIR` and `resume`, so concurrent sessions never race.

**Deep reference: `docs/daemon/`.** The load-bearing points:
- **Runs as a launchd/systemd service, NOT a Tauri child** — it must outlive the app to keep firing crons. `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window (the "daemon" graph mode + `DaemonList.tsx`).
- **Memory injection is per-session + vault-scoped**, gated on the daemon being enabled — `terminal.ts` injects `BISMUTH_MEMORY_DIR` into PTYs; relay hooks + MCP memory tools gate on the same. No global `~/.claude/settings.json` hook.
- **The daemon session's MCP is EXPLICIT wiring, not `-s user` inheritance** — `buildQueryOptions()` (`daemon/src/daemon/session.ts`, unit-tested) sets `options.mcpServers` + `settingSources:[]`. `chat.ts` deliberately does the opposite; don't "unify" them.
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain surface. Name + personality live in `<vault>/.daemon/identity.md`; `reconcileSeeds` writes any MISSING default on brain-start — add a seedable via one `seedsFor()` entry.
- **Every cron outcome, process lifecycle moment, and brain-start is appended to a per-vault activity log** (`<vault>/.daemon/logs/activity-YYYY-MM-DD.jsonl`, JSONL, `daemon/src/lib/activityLog.ts`) — the durable history `.last-fired.json` can't provide, since that file only keeps one entry per cron. Read back via `core/src/daemonActivity.ts`'s `readActivity()`, `GET /daemon/logs`, `bismuth daemon logs`, or the `daemon_logs` MCP tool. Ref: `docs/daemon/storage.md#activity-log-logsactivity-yyyy-mm-ddjsonl`.

## Testing

Bun's native runner; each module has a colocated `*.test.ts`. Commands, the commit/push gates, the fast-suite opt-out and `core/test/upgrade/` are under **Key Commands → Testing** above; visual verification is `bench/` (see **Frontend App**). Full reference: `docs/contributing/testing.md`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser** — `position2d`/`position3d` from `core/src/layout.ts`; the renderer only morphs.
- **Wikilink matching is filename-based** — `[[Another Note]]` matches `Another Note.md` anywhere; ambiguous matches are undefined.
- **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it.
