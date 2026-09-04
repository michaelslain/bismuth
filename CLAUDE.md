# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Prerequisites**: Bun 1.0+, Node.js 20+

```bash
bun install                     # from repo root (all 7 workspaces)
cd app && bun run dev:browser   # browser: core on :4321 + Vite on :1420
cd app && bun run dev:app       # native: the same two + the Tauri window
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian, built as a monorepo with seven workspaces using Bun's workspace feature (`package.json` with `workspaces` array):

- **core**: backend server — vaults, knowledge graphs, and the read window onto the daemon's memory
- **cli**: the `bismuth` binary
- **app**: Tauri + Solid + TypeScript — CodeMirror editor + 2D/3D graph. Desktop AND iPad/iOS; mobile swaps the HTTP backend for an in-process one
- **relay**: a hooks-only Claude Code plugin reporting each terminal-tab session + subagents to core's in-process registry, and injecting the vault's memory when the daemon is enabled
- **mcp**: a stdio MCP server — per-tab in dev, machine-wide from the bundled app
- **memory**: `@bismuth/memory` — the pure 3rd-brain memory graph, shared by daemon/relay/MCP; every entry point takes an explicit dir (`BISMUTH_MEMORY_DIR`)
- **daemon**: `@bismuth/daemon` — ONE machine process multiplexing every enabled vault's brain (memory + crons + processes + a session); a bundled binary run by launchd/systemd

Knowledge is a **three-brain** model: **2nd Brain** = the vault (markdown + wikilinks/tags/frontmatter); **3rd Brain** = the daemon's memory graph under `<vault>/.daemon/memory`, joined to vault notes as `mem:` nodes + `about` edges, and present only when the daemon is enabled.

## Environment Setup

**A fresh clone runs with no setup.** `bun run dev:browser` → `app/scripts/dev.ts` → `devVault.ts`: `BISMUTH_VAULT`/`BISMUTH_MEMORY` win if exported, else it materialises a generated example vault at repo-root `.dev-vault/` (gitignored — dev builds WRITE to their vault; `rm -rf .dev-vault` = clean reset). `dev.ts` also mints ONE owner token per run for both halves — without it content routes 403 or silently filter once a vault marks anything `visibility: chat-only`/`hidden`. **Dev/standalone only** — the bundled app self-spawns core + resolves its vault from `config.json` or a first-run picker.

## Documentation

`docs/` (committed) is the exhaustive, code-anchored reference — bases/settings syntax, CLI, daemon, storage, HTTP API, MCP. Start at `docs/README.md`; keep it current.

**The design system lives OUTSIDE this repo**, at `~/Documents/dev/bismuth-design/` (a sibling checkout, not a submodule). Source comments citing `bismuth-design/ascii/…` resolve against that folder, not anything here. It is the ASCII design-system spec the app was built to. **Nothing in this repo imports it** — it was moved out because its prototype component files sat beside the real ones, free to drift and easy to mistake for shipping code.

## Key Commands

### Development
- `bun run dev:browser` (in `app/`) — core backend + Vite concurrently with hot reload, on the example vault unless `BISMUTH_VAULT`/`BISMUTH_MEMORY` are exported. `bun run dev:app` adds the Tauri window **in the same process group** (never let `tauri.conf.json`'s `beforeDevCommand` start it — that runs `bun run dev:browser` again and collides a second core+Vite pair on :4321/:1420)
- `bun run serve` (in `app/`) — `vite preview` of a production build
- `bun run core/src/server.ts --vault <v> --memory <m>` — backend standalone. Each flag falls back to `BISMUTH_VAULT`/`BISMUTH_MEMORY`, so the env vars work instead.

### Testing
- `bun test core` — the whole workspace; pass an exact path for one file. **`bun test core -- <pattern>` does NOT filter** — Bun's positional args are OR'd substring path matches and `core` already matches everything, so the pattern is ignored.
- `bun run typecheck` (root) — `tsc --noEmit` per workspace, each pinning its own local `typescript` so the gate resolves offline. `core`/`cli`/`mcp`/`memory`/`daemon` pin `7.0.2`; `app`/`relay` pin `~5.6.2` — a deliberate, unresolved split.
- **Tests are REQUIRED to commit.** `.githooks/pre-commit` → `scripts/gate.ts`: typecheck + *fast* tests for the workspaces your staged files touch. `.githooks/pre-push`: docs check + the *full* suite. Hooks ride `core.hooksPath`; a fresh clone runs `bun run hooks:install`. Bypass `BISMUTH_SKIP_GATE=1`; run by hand `bun run gate`.
- `BISMUTH_FAST_TESTS=1` (`test:fast`) skips the SLOW suites — real agent binaries, PTY/WS integration, the layout benchmark (`core/test/slowGate.ts`, the opt-OUT sibling of `liveGate.ts`'s opt-IN). Unset (plain `bun test`, CI) runs everything, so nothing is lost to a forgotten flag.
- **`core/test/upgrade/`** (`test:upgrade`) — what a user's data survives on update: every historical `.settings` layout migrates without losing values, comments or unknown keys; `schemaSnapshot.test.ts` pins each schema default/type/bound to a committed snapshot (re-bless: `bun run test:bless-schema`).

### Building
- `bun run build` (in `app/`) — Vite production build. `bun run tauri build` — native Tauri executable.

### Infrastructure
- `bun install` — all workspaces. `bun run core:serve` — standalone core server.
- **Concurrent instances**: `:4321`/`:1420` serve one. For more, `PORT=4322 bun run dev:browser` (standalone server takes `--port`; frontend reads `VITE_API_BASE`).

## Architecture

### Core Backend (`core/`)

Manages the vault filesystem, builds knowledge graphs, watches for changes, serves the HTTP API.

**Key modules**:
- `server.ts` — HTTP server (Bun.serve): caching, file watching, SSE broadcast, three WS upgrades (`/terminal` PTY, `/chat`, `/ui` per-window app-control). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, `/ui/*`, daemon writes). Also drives `/gcal/*` + a 60s sync ticker. **Full reference: `docs/api/http-reference.md`.**
- `sse.ts` — pushes `{version, paths, dirty:{graph,tree}}` on file changes; consumers use `dirty` to skip refetch when nothing structural moved.
- `engine.ts` merges the vault + memory graphs (+ "about" edges); `vault.ts` builds the vault graph two-pass (nodes, then wikilink/tag/frontmatter edges); `memory.ts` the `mem:` namespace. `graph.ts` — node kinds note/memory/tag/self/daemon/cron/process; edge kinds link/message/about/tag/open/supervises.
- `layout.ts` — pure layout (pivot-MDS + force sim) → 2D + 3D `Positions`; `layout-cache.ts`'s `attachLayout()` stamps them onto nodes and the frontend morphs between them (no client force sim). `community.ts` — hierarchical community detection.
- `files.ts` (I/O + path-traversal rejection) · `frontmatter.ts` (tolerates malformed YAML) · `wikilinks.ts`/`tags.ts`. `visibility*.ts` — AI-visibility deny lists gating most read routes + the CLI gate (`docs/vault/visibility.md`).
- `relay.ts` — in-process registry of terminal-tab sessions + subagents (fed by `POST /relay/*`, pruned against the live pty set); `GET /relay/snapshot` reads it, redacting `lastMessage` for non-owners. `uiControl.ts` — OPEN-window registry + the `/ui` WS request/reply channel behind `app` CLI + MCP app control. `runRegistry.ts` — `~/.bismuth/run/<vault>.json` (port discovery + the `0600` owner token). `daemon*.ts` — daemon state reader (never throws) + the "daemon" graph builder.
- `chat.ts` — the visual chat (`/chat` WS): one long-lived Agent-SDK `query()` per chat over the user's own binary. `chatProviders/`+`agentBackends/` — the provider seam + capability catalog behind **nine** backends (claude, opencode, codex + six ACP-based). Refs: `docs/chat/overview.md`, `docs/chat/backends.md`.
- `terminal.ts` — PTY manager (`bun-pty`); injects relay provenance + a PATH shim so a bare `claude` auto-loads the relay plugin (`buildPtyEnv`, pure + tested).
- `backup.ts` — local-only vault git snapshots. Its `.git/info/exclude` list is an **allow-list**, not a deny-list (a deny-list fails open): `.daemon/*` is excluded, then `identity.md`, `PAGES.md` and the `crons/`/`processes/`/`pages/` dirs are re-included — so `.settings` and the daemon's *definitions* ARE tracked, while `memory/` (its own repo), `logs/` and `session-id*` are not. Order is load-bearing, and the old blanket lines are PRUNED from existing vaults on the next backup.
- `tasks*.ts` · `dates.ts` · `calendar.ts` · `basesData.ts` (the vault feed for Bases) · `gcal/` · `fileAccess.ts`/`localBackend.ts` (mobile seam).

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change; `rowsCache`/`tasksCache` are `createAsyncCache` instances (in-flight dedup). A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`. The frontend keeps one `EventSource("/events")`, with a `/version` poll as fallback. **Self-write suppression**: `mutatingHandler` marks each path BEFORE writing, so the watcher drops that write's own echo; the mark is consumed on first read (one echo only, so a later external write still schedules) and taken back off when the mutation throws *or* returns ≥400. Ref: `docs/overview/data-flow.md`.

### Frontend App (`app/`)

Solid.js + TypeScript, CSS Modules.

- `App.tsx` — root: tab + pane tree, active-file routing, graph mode, settings persistence, global keys. It composes its render out of **`shell/`** (`AppFrame` `TopStrip` `TabRail` `Sidebar` `StatusBar` `EditorPane` `GraphFloater` `PaneOverlay` `DragGhost` `WindowControls` …) — presentational, slot-driven components that own no signal and never fetch, so every one renders in Storybook with stubs. `panes.ts` — pure binary-tree model for splits (Leaf/Split), unit-tested. `PaneTree.tsx`/`PaneContent.tsx` route a Leaf to a note, Bases view, `.sheet`, `.draw`, calendar, tasks, flashcards, terminal, chat, preview, or export view.
- `tabIds.ts` — sentinel ids for non-file panes (`::graph`, `::empty`, prefixed `::flashcards:`/`::term:`/`::export:`/`::chat:`); notes/bases/sheets/drawings/settings route by path. There is no `::search` — search is the Cmd+O switcher takeover (`palette/SwitcherBar.tsx`), the app's ONE search surface.
- `Editor.tsx` (CodeMirror) + `BlockEditor.tsx` (Milkdown WYSIWYG) — two note surfaces; `editor.defaultMode` picks which opens (reactive live swap). `editor/` holds the CM extension set; `editorRegistry.ts` flushes autosaves before renames. Detail: `docs/editor/`.
- **UI primitives** (`ui/`, plus `ui/ascii/`): `Text` `Heading` `Label` `Badge` `Button` `Modal` `Field` … each `export default` with a colocated `.module.css` + story. Reach for one instead of a bare `<p>`/`<span>`; `ui/uiLint.test.ts` guards the set.
- **`ViewBar` is THE view header** (graph, bases, calendar, flashcards, chat) — six NAMED SLOTS, not positional children: `identity` `locus` `facet` lead, `readouts` `config` `actions` trail. A control's region is decided by the QUESTION it answers, not its shape. A Bases view *kind* that contributes controls returns a `ViewBarSlots` object rather than stacking its own bar (`calendarSlots()`, `flashcardsSlots()`); `BaseView` owns the single bar. Collapse is ONE shared ladder in `ui/ui.css` that a control opts into by TAGGING — `data-bar-drop` on a control, `<BarLabel long short drop>` on a word. Both hooks are `data-*`, never classes: a global rule naming a module class hashes to a different local and silently matches nothing (`ui/barDropLevels.test.ts` pins every tag to a level the ladder actually defines).
- **Settings have no GUI page** — the "settings page" IS `.settings` (a hidden extensionless file per vault) opened in the editor like any note, with schema-aware autocomplete + lint. `core/src/schema/settingsSchema.ts` is the single source of truth.
- `PreviewView.tsx` + `preview/` — non-note file previews. `FileTree.tsx` — drag-drop moves, rename retargets the active tab, delete undo, multi-select, icon picker, `.settings`/`.daemon` protection. `bases/` — the 12 view renderers + `markdown.ts` (shared markdown→HTML). `api.ts` — backend client over a swappable `Transport` (in-process on mobile).
- `settings.ts` — store seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves (`settingsDiff.ts`, no comment clobbering); mirrors the schema (`settings.parity.test.ts`). `settingsCssVars.ts` projects settings + theme tokens into `:root` custom properties.

**Graph rendering**: `graph/AsciiGraphRenderer.ts` is **the** renderer (no choice) — a Canvas-2D *character grid*, not WebGL, for both 2D and 3D; it only rescales the backend's precomputed layouts. **Zoom is RESOLUTION, not scale**: a mark's size never changes; a wheel notch re-rasterizes at a finer grid and steps a three-band ladder. Seam: `graph/graphRenderer.ts`; pure unit-tested helpers alongside it. Ref: `docs/graph/overview.md`.

**Typography**: one mono family (Monaspace, `appearance.editorFont`/`uiFont`) for the whole interface, with ONE proportional exception — note prose + chat message bodies use `--prose-font` (CMU Serif), sized by `--prose-font-size` = `--editor-font-size` × `--prose-scale`. It is **not a setting**; it is three tokens in `styles/tokens.css`. Anything pulled back OUT of prose — code, frontmatter, `#tags` — returns to `--editor-font` at `--editor-font-size`, not a scaled multiple (story helpers in `ui/_fontFace.ts` assert against the live tokens, so a rule reverted to `--ui-font-stack` is caught even though both default to the same family). Ref: `docs/settings/themes.md`.

**Styling**: **CSS Modules are the rule** — every component's rules live in a colocated `<Component>.module.css` (57 of them). `App.css` is the GLOBAL layer ONLY: design tokens, the element reset, and classes written into runtime-generated HTML strings; it `@import`s `styles/{tokens,reset,content,icons}.css`. Two traps: **CSS `@import` HOISTS**, so relocating a rule out of `App.css` silently flips precedence (`cssLayering.test.ts` guards this); and a module class is **hashed at build time**, so a call site holding the old literal (`class="ft-row"`) compiles, renders, and matches nothing (`bench/moduleClassCheck.ts` catches it). Colour is centralized in **`core/src/theme/tokens.ts`** (4 themes ink/paper/cathode/riso + semantic tokens + category swatches — in `core` so gcal/drawing/export/schema can import it). Ref: `docs/settings/themes.md`.

**Storybook is THE visual-verification surface** — `bun run storybook` from `app/` (:6006, Storybook 9 + `storybook-solidjs-vite`); 608 stories / 155 components. `app/.storybook/preview.ts` does two things globally that must NOT be re-solved per story: projects the real theme tokens (so **never hardcode a stand-in for a design token**) and installs an in-memory `fakeTransport` (without it every mount-fetching component renders a permanent "Loading…" that reads as a passing story). Fixtures: `app/src/ui/_*`. **Caveat:** `GraphView` pauses its rAF loop when `document.visibilityState === "hidden"`, so a backgrounded automation tab samples a 0%-inked canvas — indistinguishable from a broken renderer; every `bench/` tool drives its own Chrome (`bench/chromeSession.ts`) for that reason.

**Visual checks (`bench/`, repo root, NOT a workspace)**: `bun run visual` is the everyday one — baseline-free invariant checks over only the stories the diff can affect (seconds). `visual:all` sweeps everything; `visual:baseline` is **not** the habitual gate (it cannot tell a deliberate restyle from a regression). Also `storyAudit.ts` (what is visibly BROKEN *now* — a baseline can never see this, since the broken state IS its recording), `probeStory.ts`, `moduleClassCheck.ts` (see Styling), `visual.ts` (shots of the RUNNING app), and `bun run play` → `playCheck.ts`, the only tool that EXECUTES a story's `play()`. **`SKIP` and `UNSAFE` are not passes** — nothing was asserted, or the tab went `hidden` mid-run. Pooled sweeps size their pool from `bench/poolSize.ts` (min of cores−1 and half of free memory), never a constant. Full detail: `docs/contributing/testing.md`.

### CLI (`cli/`)

The `bismuth` binary (a thin wrapper over `@bismuth/core`) controls the vault from the shell. File-based commands run **headlessly** (no server); the app's watcher picks up writes live. JSON output (`--pretty`); vault via `--vault`/`BISMUTH_VAULT`.

- `src/index.ts` — dispatcher: one merged registry, longest-match dispatch (two-word phrase, then one-word), `--help`, error-wrap. `src/args.ts` + `src/types.ts` are the seam every group imports.
- `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. 24 groups: `api app backends base calendar card chat checkpoint daemon draw export file gcal graph install note page prop relay search serve settings task update` (`app`+`page` drive a RUNNING app via `/ui/*`; `backup` is a command inside `serve.ts`, not a group). Every command + flag: `docs/cli/reference.md`.

**Owner-token reach** (`cli/src/http.ts`): `call()` attaches `X-Bismuth-Token` from the vault's `0600` run record, **loopback only**, so the owner's shell reads owner-gated routes. The agent boundary is `BISMUTH_AGENT_CHANNEL` — an env var, **not** a cryptographic boundary. **Adding a command**: a `Command` in a `src/commands/<group>.ts` map (or a new group imported in `index.ts`) — resolve via `args.ts`, call core, `out(result, args)`.

### Bases (`core/src/bases/` + `app/src/bases/`)

> Deep reference: `docs/bases/` + `docs/bases/views/` (per view kind). This is the summary.

A query/view system. A **base is a `type: base` md file** — its frontmatter declares filters, formulas and views over the vault's notes. There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`): `lexer`→`parser`→`parse` → `evaluate`+`filters` → `functions` → `query` (Base × the `basesData.ts` feed → rows + grouping). **Frontend** (`app/src/bases/`): one renderer per kind; `ViewType` spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap`. `BaseView.tsx` picks it, owns the single `ViewBar`, and merges in whatever slots the view kind contributes.

A base can also be **queried inside a note** via a ` ```query ` block — the only embedded block (no ` ```base `/` ```view `/` ```tasks `), holding a full inline base config or a flat query spec. Rendered by `editor/queryBlock.ts`; syntax in `docs/bases/query-block.md`.

**Sources** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]` — `base` (recursive), `notes`, or `tasks`. Cycle-guarded + **server-side** via `POST /rows {spec}` (`rowsCache`/`tasksCache`, `createAsyncCache` with in-flight dedup), client SWR in `bases/rowCache.ts`. Detail: `docs/bases/sources.md`.

**Authoring**: `bismuth base create|validate|render` + the `skills/authoring-bismuth-bases` skill. Note `parseBaseFile` silently downgrades an invalid `views[].type` to `table`, so `base validate` reads raw frontmatter instead.

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — no standalone page. Open one via a `type: base` md with `views: [{ type: calendar }]`. `app/src/calendar/` holds shared state + components (`EventStore.ts`, `state.ts`, `dates.ts`, `categoryColor.ts`, `components/views/` Month/Week/ThreeDay/Day/TimeGrid). Its toolbar renders **no bar of its own** — `calendarSlots()` returns `ViewBarSlots` that `BaseView` merges into the one bar. Time-grid drag-create lives in the pure `timeGridDrag.ts` (4px deadzone, 30-min snap floor). Two-way **Google Calendar** sync: `core/src/gcal/`, `docs/gcal/overview.md`.

### Tasks (`core/src/tasks*.ts`)

Obsidian-Tasks-compatible. Tasks are a **base source** (`source: tasks`, optionally `from: [[Base]]`), not standalone — queried via a ` ```query ` block with `tasks: <dsl>`. `tasks.ts` extracts items from markdown; `tasks-query.ts` = the DSL; `bases/taskRow.ts` projects them as `Row`s; `POST /tasks/toggle` rewrites the line. Ref: `docs/tasks/`.

### Flashcards / SRS (`core/src/srs/` + `app/src/bases/FlashcardsView.tsx`)

Flashcards are a **Bases view kind** (`flashcards`) over a base's rows. Two paths share `srs/scheduler.ts` (SM-2): **Markdown cards** (`srs/parser.ts`+`cards.ts`) and **Row cards** (`srs/reviewRow.ts`). The trap: a note is collected ONLY if it carries the `flashcards` tag (`BASE_TAG`; `flashcards/sub` = sub-deck), so an untagged note with perfect syntax yields nothing. Queue logic is pure + unit-tested (`bases/flashcardsQueue.ts`); **cram** ignores due dates and writes nothing. Card syntax, endpoints + CRUD: `docs/flashcards/srs.md`.

### Other pane surfaces

Each is routed by `PaneContent.tsx` and has its own docs page.

- **Terminal** (`core/src/terminal.ts` + `Terminal.tsx`) — backend spawns a PTY (`bun-pty`) bridged over WS on `/terminal`, xterm.js renders it. `buildPtyEnv` (pure + tested) injects relay provenance + a PATH shim. `docs/terminal/`.
- **Sheets** (`SheetView.tsx` + `sheet/`) — a `.sheet` is a Univer workbook JSON snapshot, code-split behind `sheet/univerSheet.ts`; `sync.ts`'s `isExternalChange` gates reloads. `docs/sheets/`.
- **Drawing** (`drawing/` + `core/src/drawing/`) — a `.draw` is a versioned JSON `DrawingDoc` (multi-page vector sketch). The backend half is pure + headless, so PNG/PDF render without a browser. Opening an image/PDF auto-creates a `.draw` sidecar. `docs/drawing/`.

### Panes / Tabs

A tab's content is a binary tree of Leaves and Splits (`app/src/panes.ts` — pure, unit-tested); each Leaf holds a content id (a note path or a `tabIds.ts` sentinel). `PaneContent.tsx` routes it; per-window tab layout is keyed by `windowId.ts`.

**The Knowledge Graph is the home tab.** `::graph` (`GRAPH_TAB`) is first-class content routed to `GraphView` via `App`'s `renderGraph()`; `App` seeds one when nothing is restored and reopens one if all tabs close (tabs never empty). **Tab renaming**: double/right-click → Rename sets a custom `name` on the `Leaf`, overriding `contentLabel()`.

### Commands & Sidebar Toolbar

Commands and keybindings are both **pure data in `core/` + a binding in `app/`**, so the palette, the sidebar bar and the schema enum share one source.

- **Commands**: `core/src/commands.ts` (`COMMAND_CATALOG`, 51 entries → the `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → a live `{id,label,icon,action}` map). The bar above the file tree is configured by `toolbar:` in `.settings`. A spec's `interactive: true` means the action only OPENS a modal a person must finish, so app control reports that instead of implying completion; `UI_CONTROL_BLOCKLIST` bars a few outright. **Adding one:** `COMMAND_CATALOG` + an `action` in `bindCommands`; enum/autocomplete/palette follow. Full list: `docs/settings/toolbar-commands.md`.
- **Keybindings**: `core/src/keybindings.ts` (`KEYBINDING_CATALOG`, 24 entries) + `app/src/keybindings.ts` (`matchesKeybinding`). Nothing is hardcoded in `App.tsx`. `"Mod"` = Cmd/Ctrl; matching is **exact**; combos comma-separated; matches the produced key OR physical `event.code`. Ref: `docs/settings/keybindings.md`.

**Runtime backend base** (`app/src/api.ts`): `resolveBase` picks `?api=<url>` > `window.__BISMUTH_API__` > `VITE_API_BASE` > `:4321`, so one build serves multiple windows.

## Frontend Conventions (house rules)

These are project-wide and **override framework habits**. They apply to every agent working in `app/`.

- **One component per file. PascalCase filename matching the export.** Utilities, hooks and logic modules are camelCase (`settingsDiff.ts`). Never kebab-case component files.
- **Every component has a colocated `<Component>.module.css`.** Never a parallel `styles/` tree. `app/src/styles/` is the four *global* stylesheets only.
- **A shared stylesheet means a missing component.** Two components importing one `.module.css` = a component nobody extracted; extract it and compose. Do NOT split the stylesheet into per-component copies.
- **Everything is a component, even text.** Never a bare `<p>`/`<span>`/`<h1>`/`<button>` with a class where a `ui/` primitive exists (`Text` `Heading` `Label` `Badge` `Button` `Field` …). If none fits, **the primitive is missing** — add it.
- **Break things down further than feels necessary.** The default answer to "is this big enough to extract?" is yes.
- **This is Solid, not React.** (1) No `FC` — type a component as `Component<Props>` from `solid-js`. (2) **Never destructure props.** `({ color }) => …` reads the field ONCE at setup and permanently unsubscribes from later changes — silently keeps its first value forever, with no typecheck error, test failure or warning. Take `props` whole, read `props.color` at use. Copy `ui/Text.tsx`/`Heading.tsx`/`Badge.tsx`. The generic "FC + destructured props" convention is React-shaped and does NOT apply here.
- **Variants are props, not new files** (`Heading level={1..6}`, not `Heading1.tsx`).
- **Accept an optional `className` merged onto the root element**, so a caller can adjust one instance without forking the component.
- **Pure logic lives in plain `.ts` modules with no framework imports.** That is what keeps it unit-testable and what lets the component render in Storybook.
- **Reach through the tree, not through the DOM.** Never `closest('.some-class')` or `classList` against a **class name** inside a component: CSS Modules hash it at build time, so the string compiles, renders and matches **nothing** — the guard silently stops firing, uncaught by typecheck, test or story. The child declares the event is its own via `stopPropagation`. **Trap:** that does *not* stop `onPointerDown`/`onDblClick`. Leave alone: `closest()` on **tag** selectors or **data attributes**, plain-DOM libraries (CodeMirror, the canvas renderer), and `document.documentElement.classList`.
- **Two element-hook forms, and they mean different things.** `data-<name>` (`data-pane-leaf`, `data-tabstrip`, `data-graph-floater`, `data-ft-path`) is a **runtime** hook — production CSS or JS reads it, so renaming one breaks the app. `data-testid` is a **test-only** handle: stories and tests query it, and **nothing in production CSS or JS may read it**. Pick by who consumes it; do not invent a third form.
- **Every component added or meaningfully changed gets a story** — one without is invisible to visual verification, i.e. untested.
- **Formatting:** no semicolons, single quotes, 4-space indent, `x => x` not `(x) => x`. Match the surrounding file.
- **Agent working artifacts** (plans, ledgers, scratch reports) go in `.claude/`, never in the repo source tree.

## Workspace Management

Bun `workspaces` in the root `package.json`: `core` exports `@bismuth/core`, imported by `app`/`cli`/`mcp`. Add a dep with `cd <workspace> && bun add <package>`; `bun install` at root syncs all.

## Module Organization

Purposes are in **Architecture** above; this is the layout. **Exhaustive per-file map: `docs/contributing/codebase-map.md`.**

```
core/src/
  server.ts sse.ts                # HTTP + SSE + WS, mutating-route abstraction
  engine.ts vault.ts memory.ts graph*.ts layout*.ts   # graph build + layout
  relay.ts uiControl.ts runRegistry.ts daemon*.ts     # relay registry; /ui; ports; daemon window
  settings.ts schema/             # .settings lifecycle + THE schema (24 top-level sections)
  theme/tokens.ts                 # the one source of colour: ink/paper/cathode/riso
  visibility*.ts                  # AI-visibility deny lists + the CLI-dispatch gate
  chat.ts chatProviders/ agentBackends/   # visual chat + the nine backends + capabilities
  fileAccess.ts localBackend.ts   # mobile IO seam + in-process no-HTTP backend
  bases/ srs/ gcal/ drawing/      # Bases DSL · SRS · gcal sync · .draw vector docs
core/test/   # one *.test.ts per module; upgrade/ = cross-version data safety

app/src/
  App.tsx panes.ts PaneTree.tsx PaneContent.tsx tabIds.ts   # root, pure pane model, routing
  shell/       # the App.tsx chrome, componentized (AppFrame TopStrip TabRail Sidebar …)
  ui/          # primitives: Text Heading Button Modal ViewBar BarLabel … (+ ascii/); _* = fixtures
  styles/      # the only global stylesheets: tokens cmu reset content icons
  Editor.tsx editor/ · BlockEditor.tsx blocks/   # CodeMirror · Milkdown WYSIWYG
  GraphView.tsx graph/            # the ONE renderer (AsciiGraphRenderer) behind the seam
  chat/ ChatView.tsx chat*.ts · FileTree.tsx Terminal.tsx SheetView.tsx ExportView.tsx
  bases/ calendar/ palette/ drawing/ intro/ ai/ mobile/ preview/ icons/ dnd/
app/.storybook/  # preview.ts injects theme tokens + the in-memory transport
app/src-tauri/   # Tauri shell (Rust): spawns the core sidecar + first-run vault picker
app/scripts/     # dev.ts (THE dev entry point) + devVault.ts (the generated example vault)
bench/           # NOT a workspace — the visual gate (invariants storyAudit playCheck poolSize …)

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
- **Add a Bases function**: a case in `callFunction`/`callMethod` (`core/src/bases/functions.ts`), handle its return type in `query.ts`, test in `core/test/bases/query.test.ts`.
- **Add an SRS scheduler variant**: extend `core/src/srs/scheduler.ts`, expose config in `settingsSchema.ts`, thread into `applyReview`.

## Error Handling

Backend errors use `AppError` (`core/src/error.ts`): `createError(code, msg)` or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` onto the response (generic `Error` → 500). The code→status table (`ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400) lives in `error.ts`.

## Shared Helpers

- **`graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — the walk+read+index behind `vault.ts`/`memory.ts`. Use it for any new graph source.
- **`files.ts` `walkDir(root, filter, allowDot?)`** — recursive walk behind `listTree`/`listTemplates`; `filter` returns `true`/`false`/`{data}`, and a dot-entry is skipped **unless `allowDot(rel)` opts it back in** (that third arg is how `.settings`/`.daemon` surface at all).
- **`frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits via the `yaml` Document API (preserves comments/key order/flow arrays).
- **`app/src/serverVersion.ts`** tracks a `ConnectionState`; on SSE loss it toasts + polls `/version` until reconnect.
- **`app/src/sanitizeHtml.ts`** — DOMPurify wrapper for `innerHTML` of vault-rendered HTML. Always route rendered HTML through it, built with the canonical `htmlEscape.ts`.

## Key Concepts

### Vault Structure
Markdown tree; YAML frontmatter; wikilinks `[[Another Note]]` matched by **file name, not path**; top-level folder → the `folder` field on nodes (`reading/quotes/x.md` → `folder="reading"`). The memory graph is built separately with `mem:`-prefixed nodes, joined to vault notes by "about" edges.

### Graph Modes
`GraphMode` (`app/src/commands.ts`) is exactly `"2nd" | "3rd" | "both" | "daemon" | "local"` — there is no "agents" mode (`relay.ts` feeds chat's subagent tracking + terminal pruning, not a graph). **2nd** vault notes + tags · **3rd** memory · **both** everything + cross-edges · **daemon** the hub → its crons + processes (`supervises` edges) · **local** the open note's neighborhood only (`localSubgraph`), the one mode laid out in the browser. Switched from the graph pane's own ViewBar — **not** the status bar. The **2D/3D toggle** is a transient localStorage flag, not a `.settings` key. Ref: `docs/graph/overview.md`.

### Desktop app & core sidecar (`app/src-tauri/`)

The bundled `/Applications` app **spawns its own `core` backend** (not `bun run dev:browser`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary; on launch `src/lib.rs` picks a free port, spawns the sidecar, kills it on exit, and injects `window.__BISMUTH_API__`. A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/`). Deep detail: `docs/overview/install.md`.

### Mobile / iPad (`core/src/localBackend.ts` + `core/src/fileAccess.ts` + `app/src/mobile/`)

On iPad/iOS the Bun HTTP server can't run, so the app runs the **same core logic in-process, no HTTP**, via two seams: **`fileAccess.ts`** (desktop lazy-imports `files.ts`; mobile registers a `tauri-plugin-fs` impl via `setFileAccess()` — nothing statically imports Bun/`node:fs`) and **`api.ts`**'s swappable `Transport`. `localBackend.ts`'s `dispatch()` reuses engine/bases/search/tasks/srs — reads + content-only writes, `NOT_SUPPORTED` for structural fs ops. `bootMobile.ts` swaps both seams before importing `App`; change detection via `backend.subscribe()`, not SSE. Detail: `docs/mobile/overview.md`.

### MCP Integration (`mcp/` workspace)

A stdio MCP server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 6 always-on tools (`bismuth_docs_{list,search,read}`, `bismuth_cli`, `bismuth_cli_help`, `bismuth_skill`) + 3 daemon-gated memory tools (`remember`/`recall`/`forget`). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed machine-wide on boot (`core/src/bismuthInstall.ts`). **App control** adds **ZERO new MCP tools** — it rides `bismuth_cli` via the `app`+`page` groups → core's `/ui/*` WS. Detail: `docs/mcp/overview.md`, `docs/mcp/app-control.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents to an **in-process registry** (`core/src/relay.ts`). Loads per-session inside app terminals (bundled via `BISMUTH_RELAY_BUNDLE`; nothing in `~/.claude`); `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads it. Closing a tab prunes its session; the registry lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

**One machine process multiplexing per-vault brains**: machine identity at `~/.bismuth/daemon` (`daemonMachineDir()`, `BISMUTH_DAEMON_DIR`); each enabled vault's brain (memory, crons, processes, session) under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault per tick; a reconcile loop starts/pauses a brain as `settings.daemon.enabled` flips. `sendMessage` passes `cwd`/`env.BISMUTH_MEMORY_DIR`/`resume` per call, so concurrent sessions never race.

**Deep reference: `docs/daemon/`.** The load-bearing points:
- **Runs as a launchd/systemd service, NOT a Tauri child** — it must outlive the app to keep firing crons. `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window (the "daemon" graph mode + `DaemonList.tsx`).
- **Memory injection is per-session + vault-scoped**, gated on the daemon being enabled — `terminal.ts` injects `BISMUTH_MEMORY_DIR` into PTYs; relay hooks + MCP memory tools gate on the same. No global `~/.claude/settings.json` hook.
- **The daemon session's MCP is EXPLICIT wiring by default, not `-s user` inheritance** — `buildQueryOptions()` (`daemon/src/daemon/session.ts`, unit-tested) sets `options.mcpServers` + `settingSources:[]`. `settings.daemon.inheritUserMcp` (default off) adds `settingSources: ['user']`. **User scope only, never `project`/`local`** — the session's `cwd` is the vault root, so those would auto-load a `.mcp.json` planted in user content and run it under `bypassPermissions`. `chat.ts` deliberately omits `settingSources` and already sees every server; don't "unify" them. Detail: `docs/daemon/`.
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain surface. Name + personality live in `<vault>/.daemon/identity.md`; `reconcileSeeds` writes any MISSING default on brain-start — add a seedable via one `seedsFor()` entry.
- **Every cron outcome, process lifecycle moment and brain-start is appended to a per-vault activity log** (`<vault>/.daemon/logs/activity-YYYY-MM-DD.jsonl`) — the durable history `.last-fired.json` can't give, since it keeps only one entry per cron. Read via `readActivity()`, `GET /daemon/logs`, `bismuth daemon logs`, or the `daemon_logs` MCP tool.

## Testing

Bun's native runner; each module has a colocated `*.test.ts`. Commands + gates: **Key Commands → Testing**. Visual verification: `bench/` (see **Frontend App**). Full reference: `docs/contributing/testing.md`.

## Gotchas & Edge Cases

- **Layouts come from the backend, not the browser** — the renderer only morphs.
- **SSE can silently die** (proxy/OS-sleep) — the `/version` poll recovers it.
