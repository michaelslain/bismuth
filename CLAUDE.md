# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Quick Start

```bash
# prerequisites: Bun 1.0+, Node.js 20+
bun install                     # from repo root (all 7 workspaces)
cd app && bun run dev:browser   # browser: core on :4321 + Vite on :1420
cd app && bun run dev:app       # native: the same two + the Tauri window
```

## Project Overview

**Bismuth** is a personal knowledge management system inspired by Obsidian — a Bun-workspaces monorepo of seven packages:

- **core**: backend server — vaults, knowledge graphs, and the read window onto the daemon's memory
- **cli**: the `bismuth` binary
- **app**: Tauri + Solid + TypeScript — CodeMirror editor + 2D/3D graph. Desktop AND iPad/iOS; mobile swaps the HTTP backend for an in-process one
- **relay**: a hooks-only Claude Code plugin reporting each terminal-tab session + subagents to core's registry, and injecting the vault's memory when the daemon is enabled
- **mcp**: a stdio MCP server — per-tab in dev, machine-wide from the bundled app
- **memory**: `@bismuth/memory` — the pure 3rd-brain memory graph, shared by daemon/relay/MCP; every entry point takes an explicit dir (`BISMUTH_MEMORY_DIR`)
- **daemon**: `@bismuth/daemon` — ONE machine process multiplexing every enabled vault's brain (memory + crons + processes + a session); a bundled binary run by launchd/systemd

Knowledge is a **three-brain** model: **2nd Brain** = the vault (markdown + wikilinks/tags/frontmatter); **3rd Brain** = the daemon's memory graph under `<vault>/.daemon/memory`, joined to vault notes as `mem:` nodes + `about` edges, and present only when the daemon is enabled.

## Environment Setup

**A fresh clone runs with no setup.** `bun run dev:browser` → `app/scripts/dev.ts` → `devVault.ts`: `BISMUTH_VAULT`/`BISMUTH_MEMORY` win if exported, else it materialises a generated example vault at repo-root `.dev-vault/` (gitignored — dev builds WRITE to their vault; `rm -rf .dev-vault` = clean reset). `dev.ts` also mints ONE owner token per run for both halves — without it content routes 403 or silently filter once a vault marks anything `chat-only`/`hidden`. **Dev/standalone only** — the bundled app self-spawns core + resolves its vault from `config.json` or a first-run picker.

## Documentation

`docs/` (committed) is the exhaustive, code-anchored reference — bases/settings syntax, CLI, daemon, storage, HTTP API, MCP. Start at `docs/README.md`; keep it current.

**The original ASCII design handoff is retired** — deleted in `8335a574`, so source comments citing `bismuth-design/ascii/…` name files readable only via `git show 8335a574^:design/ascii/<rest of path>`. The live design system is `DESIGN.md`, the tokens and `app/src/ui/`.

## Key Commands

### Development
- `bun run dev:browser` (in `app/`) — core + Vite concurrently with hot reload, on the example vault unless `BISMUTH_VAULT`/`BISMUTH_MEMORY` are exported. `bun run dev:app` adds the Tauri window **in the same process group** (never let `tauri.conf.json`'s `beforeDevCommand` start it — that re-runs `dev:browser` and collides a second core+Vite pair on :4321/:1420)
- `bun run serve` (in `app/`) — `vite preview` of a production build
- `bun run core/src/server.ts --vault <v> --memory <m>` — backend standalone. Each flag falls back to `BISMUTH_VAULT`/`BISMUTH_MEMORY`.

### Testing
Bun's native runner; each module has a colocated `*.test.ts`. Full reference: `docs/contributing/testing.md`.
- `bun test core` — the whole workspace; pass an exact path for one file. **`bun test core -- <pattern>` does NOT filter** — Bun's positional args are OR'd substring path matches and `core` already matches everything, so the pattern is ignored.
- `bun run typecheck` (root) — `tsc --noEmit` per workspace, each pinning its own local `typescript` so the gate resolves offline. `core`/`cli`/`mcp`/`memory`/`daemon` pin `7.0.2`; `app`/`relay` pin `~5.6.2` — a deliberate, unresolved split.
- **Tests are REQUIRED to commit.** `.githooks/pre-commit` → `scripts/gate.ts`: typecheck + *fast* tests for the workspaces your staged files touch. `.githooks/pre-push`: docs check + the *full* suite. Hooks ride `core.hooksPath`; a fresh clone runs `bun run hooks:install`. Bypass `BISMUTH_SKIP_GATE=1`; by hand `bun run gate`.
- **The design-system gate + `tokenLint`** run as one `scripts/gate.ts` step whenever a staged path touches `app/src/`, `DESIGN.md`, `design/` or `scripts/designSystem/` — component/story/token conformance against `DESIGN.md`'s governance block (incl. `globalReach`, `oneGlobalFile`); ratchet `design/baseline.json`. Exceptions: a `design-system-ignore <check-id>: <reason>` line comment. A separate step runs `bench/moduleClassCheck.ts` (builds the app, ~11s) when a staged path matches `app/src/**/*.css`. Detail: `docs/contributing/testing.md`.
- `BISMUTH_FAST_TESTS=1` (`test:fast`) skips the SLOW suites — real agent binaries, PTY/WS integration, the layout benchmark (`core/test/slowGate.ts`, the opt-OUT sibling of `liveGate.ts`'s opt-IN). Unset (plain `bun test`, CI) runs everything, so nothing is lost to a forgotten flag.
- **`core/test/upgrade/`** (`test:upgrade`) — what a user's data survives on update: every historical `.settings` layout migrates without losing values, comments or unknown keys; `schemaSnapshot.test.ts` pins each schema default/type/bound to a snapshot (re-bless: `bun run test:bless-schema`).

### Building
`bun run build` (in `app/`) — Vite production build. `bun run tauri build` — native executable.

### Infrastructure
- `bun install` — all workspaces. `bun run core:serve` — standalone core.
- **Concurrent instances**: `:4321`/`:1420` serve one. **`PORT=` does nothing** — `server.ts` reads a `--port` CLI arg and otherwise hardcodes 4321, and `dev.ts` passes none, so a second `dev:browser` dies `EADDRINUSE` and takes Vite down with it. Start the two halves yourself instead, sharing ONE owner token (without it content routes 403 or silently filter once a vault marks anything `chat-only`/`hidden`):
  ```bash
  TOKEN=$(openssl rand -hex 32)
  BISMUTH_OWNER_TOKEN=$TOKEN bun run core/src/server.ts --port 4323 \
      --vault "$PWD/.dev-vault/vault" --memory "$PWD/.dev-vault/memory" &
  cd app && VITE_OWNER_TOKEN=$TOKEN VITE_API_BASE=http://localhost:4323 \
      bun x vite --port 1422 --strictPort
  ```

## Architecture

### Core Backend (`core/`)

Manages the vault filesystem, builds knowledge graphs, watches for changes, serves the HTTP API. **Key modules**:
- `server.ts` — HTTP server (Bun.serve): caching, file watching, SSE broadcast, three WS upgrades (`/terminal` PTY, `/chat`, `/ui` per-window app-control). Three route tables: **GET reads**, **POST mutations** (`mutatingHandler` → invalidate + SSE), **read-table POST/PUT** (no invalidate: `/rows`, `/search`, `PUT /file`, `/relay/*`, `/ui/*`, daemon writes). Also drives `/gcal/*` + a 60s sync ticker. **Handlers live in `core/src/routes/<area>.ts`** — one factory per area (`vault` `graph` `settings` `bases` `tasks` `daemon` `gcal` `relay` `agents` `system`, plus shared `context.ts`), each exports a default read factory `(ctx: RouteContext) => Record<string, Handler>` and, where it has writes, a named `xMutatingRoutes` — and `server.ts` keeps the state, the watcher, `mutatingHandler`, the WS upgrades and `Bun.serve`, builds ONE `RouteContext`, and spreads the defaults into `routes` and the `*MutatingRoutes` into `mutatingRoutes`. **Full reference: `docs/api/http-reference.md`**
- `sse.ts` — pushes `{version, paths, dirty:{graph,tree}}` on file changes; `dirty` lets consumers skip refetch when nothing structural moved.
- `engine.ts` merges the vault + memory graphs (+ "about" edges); `vault.ts` builds the vault graph two-pass (nodes, then wikilink/tag/frontmatter edges); `memory.ts` the `mem:` namespace. `graph.ts` — node kinds note/memory/tag/self/daemon/cron/process, edge kinds link/message/about/tag/open/supervises.
- `layout.ts` — pure layout (pivot-MDS + force sim) → 2D + 3D `Positions`; `layout-cache.ts`'s `attachLayout()` stamps them onto nodes, the frontend morphs between them (no client force sim). `community.ts` — hierarchical community detection.
- `files.ts` (I/O + path-traversal rejection) · `frontmatter.ts` (tolerates malformed YAML) · `wikilinks.ts`/`tags.ts` · `visibility*.ts` (AI-visibility deny lists gating most read routes + the CLI gate — `docs/vault/visibility.md`); `visibilityFilter.ts` is the ONE shared filter (`agentDenyEntries`, `filterByPath`/`filterGraph`/`filterTree`) the HTTP routes and the CLI both use, so an agent's cross-note commands return results minus hidden notes instead of refusing (fail-closed when visibility can't be determined).
- `relay.ts` — the relay registry (below). `uiControl.ts` — OPEN-window registry + the `/ui` WS request/reply channel behind `app` CLI + MCP app control. `runRegistry.ts` — `~/.bismuth/run/<vault>.json` (port discovery + the `0600` owner token). `daemon*.ts` — daemon state reader (never throws) + the daemon graph builder.
- `chat.ts` — the visual chat (`/chat` WS): one long-lived Agent-SDK `query()` per chat over the user's own binary. `chatProviders/`+`agentBackends/` — the provider seam + capability catalog behind **ten** backends (claude, opencode, codex + seven ACP-based; eight shown in the picker). Refs: `docs/chat/{overview,backends}.md`.
- `tasks*.ts` · `dates.ts` · `calendar.ts` · `basesData.ts` (the vault feed for Bases) · `gcal/` · `fileAccess.ts`/`localBackend.ts` (mobile seam).
- `backup.ts` — local-only vault git snapshots. Its `.git/info/exclude` is an **allow-list** (a deny-list fails open) and its line order is load-bearing — `docs/overview/storage.md`.

**Caching + data flow**: `cachedGraph`/`cachedTree` persist until vault/memory files change; `rowsCache`/`tasksCache` are `createAsyncCache` instances (in-flight dedup). A change → 250ms debounce → `changeClassifier.ts` marks caches dirty (content-only edits stay silent), bumps `version`, pushes SSE `{version, paths, dirty}` on `/events`; the frontend keeps one `EventSource`, with a `/version` poll as fallback. A mutation marks the paths it writes (`core/src/selfWriteMarks.ts`) so the watcher drops its own echo — `POST /daily-note` does NOT mark yet. Ref: `docs/overview/data-flow.md`.

### Frontend App (`app/`)

Solid.js + TypeScript, CSS Modules.

- `App.tsx` — root: tabs + pane tree, active-file routing, graph mode, settings persistence, global keys; its render is composed from **`shell/`** (`AppFrame` `TopStrip` `TabRail` `Sidebar` `EditorPane` …) — slot-driven components that own no signal and never fetch, so each renders in Storybook with stubs. `panes.ts` — the pure Leaf/Split tree; `PaneTree.tsx`/`PaneContent.tsx` route a Leaf to its view.
- `tabIds.ts` — sentinel ids for non-file panes (`::graph`, `::daemon`, `::empty`, prefixed `::term:`/`::export:`/`::chat:`); notes/bases/sheets/drawings/settings route by path. No `::search` — search is the Cmd+O switcher takeover (`palette/SwitcherBar.tsx`), the app's ONE search surface.
- `Editor.tsx` (CodeMirror) — the note surface. `editor/` holds the CM extension set; `editorRegistry.ts` flushes autosaves before renames. `milkdown/` holds the Milkdown WYSIWYG bridge (`createDocEditor`) behind `ui/MilkdownField.tsx`, used only for `markdown`-typed Bases properties (e.g. a kanban card's `description`), not for notes. Detail: `docs/editor/`.
- **Ink lives IN the note, as a ` ```draw ` fence** — no sidecar. **The fence's MODE IS ITS INFO STRING** (` ```draw ` = attached over the block above, ` ```draw block ` = standalone) — never infer it from a blank line. Their coordinate contracts are **asymmetric**, and anything rendering a note must tell a draw fence from an ordinary one (export: `export/inkHtml.ts`). Pure core: `core/src/drawing/drawBlocks.ts`. Contract: `docs/editor/ink.md`.
- **UI primitives** (`ui/`, plus `ui/ascii/`): `Text` `Heading` `Label` `Badge` `Button` `Modal` `Field` … each `export default` with a colocated `.module.css` + story; `ui/uiLint.test.ts` guards the set.
- **`ViewBar` is THE view header** (graph, bases, calendar, flashcards, chat) — six NAMED SLOTS, not positional children: `identity` `locus` `facet` lead, `readouts` `config` `actions` trail; a control's region is decided by the QUESTION it answers. A Bases view kind returns `ViewBarSlots` (`calendarSlots()`, `flashcardsSlots()`) rather than stacking its own bar; `BaseView` owns the single bar. Collapse is ONE ladder in `ui/ViewBar.module.css`, opted into by `data-bar-drop` on a control or `<BarLabel long short drop>` on a word (`data-*`, never classes; `ui/barDropLevels.test.ts` pins every tag). The chat controls row under the composer has its own separate `@container chatrow` ladder — `docs/chat/overview.md`.
- **`app/src/chat/` and `app/src/daemon/` own every chat and daemon file** (component, `.module.css`, story, test together; the old flat `chat*`/`daemon*` files are gone). Where a logic module would have collided in case with its component, it carries a suffix: `chat/chatTranscriptLogic.ts`, `daemon/daemonInboxApi.ts`, `daemon/daemonIdentityLogic.ts`. First-run intro hand-off (agent choice + power-ups) is `intro/firstRunHandoff.ts` (`runFirstRunHandoff`, called from one `App` `onMount`); AI-text detection is `ai/detectAiActive.ts`.
- **Chat sessions live in a registry, not a component**: `app/src/chat/chatSessions.ts`'s `chatSession(id)` keeps a chat's WebSocket, transcript and draft alive independent of any view. Chat views (`ChatView`, `DaemonChat`) render inline in `PaneContent`/the daemon page and read a session by id; `PaneOverlay` is terminal-only (a PTY, not chat, survives a pane switch that way now).
- **Settings have no GUI page** — the "settings page" IS `.settings` (a hidden extensionless file per vault) opened in the editor like any note, with schema-aware autocomplete + lint. **Sparse**: a new vault gets a comment-only seed, reconcile never adds keys, and an absent key IS its schema default (`docs/settings/overview.md`). `core/src/schema/settingsSchema.ts` is the source of truth.
- `PreviewView.tsx` + `preview/` — non-note previews. `FileTree.tsx` — drag-drop moves, rename retargets the active tab, delete undo, multi-select, icon picker, `.settings`/`.daemon` protection. `bases/` — the 12 view renderers + `markdown.ts` (shared markdown→HTML). `api.ts` — backend client over a swappable `Transport` (in-process on mobile).
- `settings.ts` — store seeded from `DEFAULTS`, hydrated from `GET /settings`, persisted by PATCHing only changed leaves (`settingsDiff.ts`, no comment clobbering); mirrors the schema (`settings.parity.test.ts`). `settingsCssVars.ts` projects settings + theme tokens into `:root` vars.

**Graph rendering**: `graph/AsciiGraphRenderer.ts` is **the** renderer (no choice) — a Canvas-2D *character grid*, not WebGL, for both 2D and 3D; it only rescales the backend's precomputed layouts. **Zoom is RESOLUTION, not scale**: a mark's size never changes; a wheel notch re-rasterizes at a finer grid, stepping a three-band ladder. Seam: `graph/graphRenderer.ts`, with pure unit-tested helpers alongside. Ref: `docs/graph/overview.md`.

**Typography**: exactly two font-family settings. `appearance.uiFont` (default `Monaspace Xenon`) = all chrome plus the mono constructs inside a note (code, inline code, frontmatter, math, tags) and config buffers. `appearance.proseFont` (default `'IBM Plex Serif'`, Lora selectable) = note prose/headings/tables and chat bodies + composer, at `--prose-font-size` (editor size × the face's measured `--prose-scale`, `PROSE_SCALES`). Anything pulled back out of prose returns to `--ui-font-stack` at ONE size, `--code-font-size`, set in exactly one place per surface (`global.css`'s editor size-reset list, `chat/ChatTextBubble.module.css`) — never a second competing rule. Outside the editor, `<Text register="prose">` puts written text in the prose face. Scale ratios + rationale: `docs/settings/themes.md`.

**Styling**: **CSS Modules are the rule** — every component's rules live in a colocated `<Component>.module.css`. `global.css` is the GLOBAL layer ONLY (tokens, element reset, classes written into runtime-generated HTML strings, app-wide rules like `overscroll-behavior: none`) — one file, no `@import`s. Two traps: **CSS `@import` HOISTS**, so relocating a rule out of `global.css` silently flips precedence (`cssLayering.test.ts`); and a module class is **hashed at build time**, so a call site holding the old literal (`class="ft-row"`) compiles, renders, and matches nothing (`bench/moduleClassCheck.ts`). Colour is centralized in **`core/src/theme/tokens.ts`** (4 themes ink/paper/cathode/riso + semantic tokens + category swatches — in `core` so gcal/drawing/export/schema can import it). Every `:root` token is registered in `core/src/theme/designTokens.ts` (`DESIGN_TOKENS`: key = CSS var minus `--`, kind, group, default, doc); `app/src/tokenRegistry.test.ts` fails on an unregistered one. A vault overrides tokens via `.settings` `appearance.tokens` or a theme's `tokens:` — custom themes are `.themes/<name>.yaml` partial overrides (`label`, `extends`, `tokens:`; `bismuth theme tokens|create|validate|use`), agent guide `docs/guides/custom-themes.md`. Refs: `docs/settings/tokens.md`, `docs/settings/themes.md`.

**Storybook is THE visual-verification surface** — `bun run storybook` from `app/` (:6006, Storybook 9 + `storybook-solidjs-vite`). `app/.storybook/preview.ts` already projects the real theme tokens and installs an in-memory `fakeTransport` — **never re-solve either per story, never hardcode a stand-in token**. Fixtures: `app/src/ui/_*`. **A story id comes from `meta.title`, NOT the file path** — copy keys from `curl -s :6006/index.json | jq -r '.entries|keys[]'`; a hand-built id renders a red "Couldn't find story" panel, not an error. `GraphView` pauses rAF while `document.visibilityState === "hidden"`, so a backgrounded tab samples a blank canvas; `bench/` tools drive their own Chrome via `bench/chromeSession.ts` (a re-export of `core/src/render/chromeSession.ts`). Rules + URL shape: `docs/contributing/testing.md`.

**Visual checks (`bench/`, repo root, NOT a workspace)**: `bun run visual` is the everyday gate (invariants over stories the diff affects); `visual:all` sweeps everything; `visual:baseline` is **not** the habitual gate; `storyAudit.ts` finds what is visibly broken now; `bun run play` is the only tool that executes `play()`. **`SKIP`/`UNSAFE` are not passes.** `bun run verify --port <n> --prefix <p>` is an implementer's one-shot proof (`--port` REQUIRED — 6006 in a worktree measures the main checkout). Every tool + flag: `docs/contributing/testing.md`.

### CLI (`cli/`)

The `bismuth` binary (a thin wrapper over `@bismuth/core`) controls the vault from the shell. File-based commands run **headlessly** (no server); the app's watcher picks up writes live. JSON out (`--pretty`); vault via `--vault`/`BISMUTH_VAULT`.

- `src/registry.ts` — one merged registry (+ `resolveCommand`), dispatched by `src/index.ts` (longest-match: three-word, then two-word, then one-word). `src/commands/<group>.ts` — each exports `commands: CommandMap`, calls core directly. 28 groups: `api app backends base calendar card chat checkpoint daemon docs doctor draw export file gcal graph install memory note page prop relay search serve settings task theme update` (`app` drives a RUNNING window via `/ui/*`; `page` is the daemon inbox, headless; `backup` is a command inside `serve.ts`, not a group). Every command + flag: `docs/cli/reference.md`.

**Owner-token reach** (`cli/src/http.ts`): `call()` attaches `X-Bismuth-Token` from the vault's `0600` run record, **loopback only**. The agent boundary is `BISMUTH_AGENT_CHANNEL` — an env var, **not** a cryptographic one.

### Bases (`core/src/bases/` + `app/src/bases/`)

A query/view system (deep reference: `docs/bases/`, per kind in `docs/bases/views/`). A **base is a `type: base` md file** whose frontmatter declares filters, formulas and ONE view over the vault's notes — flat: `view: <kind>` + every view key top-level. Another view of the same rows = another base with `source: base` + `ref: "[[That Base]]"` (rows only — the referenced base's filters/formulas do not carry over). A legacy `views:` list reads first-entry-only and is flattened on the first write (>1 entries: writes fail, `base validate` reports it). There is **no `.base` extension**.

**Backend pipeline** (`core/src/bases/`): `lexer`→`parser`→`parse` → `evaluate`+`filters` → `functions` → `query` (Base × the `basesData.ts` feed → rows + grouping). **Frontend** (`app/src/bases/`): one renderer per kind; `ViewType` spans 12 — `table|cards|list|bullets|kanban|map|calendar|flashcards|bar|line|stat|heatmap`. `bases/ViewRenderer.tsx` switches on the kind; `BaseView.tsx` owns the single `ViewBar` and merges in whatever slots the view kind contributes.

A base can also be **queried inside a note** via a ` ```query ` block — the only embedded block (no ` ```base `/` ```tasks `); `editor/queryBlock.ts`, `docs/bases/query-block.md`.

**Sources** (`sourceSpec.ts`, `source.ts`): every base/view resolves a `SourceSpec` to a uniform `Row[]` — `base` (recursive), `notes`, or `tasks`. Cycle-guarded + **server-side** via `POST /rows {spec}` (`rowsCache`/`tasksCache`, in-flight dedup), client SWR in `bases/rowCache.ts`. No `source:` = the base's own body rows, else every note; `source: base` with no `ref:` resolves to 0 rows on the CLI. Detail: `docs/bases/sources.md`.

**Authoring**: `bismuth base create|validate|render` + the agent guide `docs/bases/authoring.md` (+ `docs/bases/authoring/<kind>.md`), which the MCP server instructions tell every agent to read before touching a base. `parseBaseFile` silently downgrades an invalid `view:` kind to `table`, so `base validate` reads raw frontmatter instead.

### Calendar (`app/src/calendar/` + `app/src/bases/CalendarView.tsx`)

Calendar is a **Bases view kind** — no standalone page; open one via a `type: base` md with `view: calendar`. `app/src/calendar/` holds shared state + components; its toolbar is `calendarSlots()` merged into `BaseView`'s bar. Two-way **Google Calendar** sync: `core/src/gcal/`, `docs/gcal/overview.md`. The **tasks register** (`mode: tasks`) creates from a day cell's inline composer, not the bar. Ref: `docs/bases/views/calendar.md`.

### Tasks (`core/src/tasks*.ts`)

Task metadata is **bracketed fields** on the checkbox line (`[due 2026-09-14]`, `[high]`, `[every week]`) — **the only spelling the parser reads**; Obsidian-Tasks emoji signifiers are no longer a read path (a vault converts on first open after a git snapshot, or via `bismuth task migrate --dry-run`). Tasks are a **base source** (`source: tasks`, optionally `from: [[Base]]`), never standalone; `mode: tasks` renders any view's rows as tasks (`bases/TaskRow.tsx`). `taskParse.ts`/`taskFields.ts` read, `taskMigrate*.ts` convert, `POST /tasks/*` write back; a legacy `tasks: <dsl>` block still translates via `bases/taskDsl.ts`. Ref: `docs/tasks/`.

### Flashcards / SRS (`core/src/srs/` + `app/src/bases/FlashcardsView.tsx`)

Flashcards are a **Bases view kind** (`flashcards`) over a base's rows. Two paths share `srs/scheduler.ts` (SM-2): **Markdown cards** (`srs/parser.ts`+`cards.ts`) and **Row cards** (`srs/reviewRow.ts`). The trap: a note is collected ONLY if it carries the `flashcards` tag (`BASE_TAG`; `flashcards/sub` = sub-deck) — an untagged note with perfect syntax yields nothing. Queue logic is pure + unit-tested (`bases/flashcardsQueue.ts`); **cram** ignores due dates and writes nothing. Syntax, endpoints + CRUD: `docs/flashcards/srs.md`.

### Other pane surfaces

Each is routed by `PaneContent.tsx` and has its own docs page.

- **Terminal** (`core/src/terminal.ts` + `Terminal.tsx`) — a PTY (`bun-pty`) bridged over WS on `/terminal`, rendered by xterm.js; `buildPtyEnv` (pure + tested) injects relay provenance + a PATH shim. `docs/terminal/`.
- **Sheets** (`SheetView.tsx` + `sheet/`) — a `.sheet` is a Univer workbook JSON snapshot, code-split behind `sheet/univerSheet.ts`; `sync.ts`'s `isExternalChange` gates reloads. `docs/sheets/`.
- **Drawing** (`drawing/` + `core/src/drawing/`) — a `.draw` is a versioned JSON `DrawingDoc` (multi-page vector sketch); the backend half is pure + headless, so PNG/PDF render without a browser. Images and PDFs are inked IN PLACE on their preview tab into a `<file>.draw` sidecar (written only once something is drawn); a PDF's highlights, margin and bookmarks live in that same sidecar behind one `preview/createAnnotationStore.ts`. `docs/drawing/`.

### Panes / Tabs

A tab's content is a `panes.ts` Leaf/Split tree; each Leaf holds a note path or a `tabIds.ts` sentinel, per-window layout keyed by `windowId.ts`. **The Knowledge Graph is the home tab** (`homePage:` exists but never reaches the app — `GET /settings` drops top-level scalars). `::graph` (`GRAPH_TAB`) is first-class content routed to `GraphView` via `App`'s `renderGraph()`; `App` seeds one when nothing is restored and reopens one if all tabs close (tabs never empty).

### Commands & Sidebar Toolbar

Commands and keybindings are both **pure data in `core/` + a binding in `app/`**, so the palette, the sidebar bar and the schema enum share one source.

- **Commands**: `core/src/commands.ts` (`COMMAND_CATALOG`, 55 entries → the `toolbar.command` enum) + `app/src/commands.ts` (`bindCommands` → a live `{id,label,icon,action}` map); the bar above the file tree is `toolbar:` in `.settings`, where an item's `commands:` list is a **fallback** (first resolvable id runs). `interactive: true` = the action only OPENS a modal; `UI_CONTROL_BLOCKLIST` bars a few from app control. **Adding one:** `COMMAND_CATALOG` + an `action` in `bindCommands`. Ref: `docs/settings/toolbar-commands.md`.
- **Keybindings**: `core/src/keybindings.ts` (`KEYBINDING_CATALOG`, 52 entries) + `app/src/keybindings.ts` (`matchesKeybinding`). App.tsx's global handler is catalog-driven bar two deliberate literals (`keybindingCoverage.test.ts`). `"Mod"` = Cmd/Ctrl; `"Ctrl"`/`"Cmd"`/`"Meta"` are separate EXACT tokens; matching is exact, on the produced key OR `event.code`. Transient widgets share `ui-dismiss`/`ui-confirm` via `ui/widgetKeys.ts`. Ref: `docs/settings/keybindings.md`.

**Status bar**: `statusBar:` in `.settings` — ordered segments (builtin / `{token}` text / query count / approved shell `run:`), served by owner-only `GET /status-bar`; `homePage:` is meant to pick what a new tab opens but is not applied yet. Ref: `docs/settings/status-bar.md`.

**Runtime backend base** (`app/src/api.ts`): `resolveBase` picks `?api=<url>` > `window.__BISMUTH_API__` > `VITE_API_BASE` > `:4321`, so one build serves many windows.

## Frontend Conventions (house rules)

Project-wide, and they **override framework habits**. Every agent working in `app/` follows them.

- **One component per file. PascalCase filename matching the export.** Utilities, hooks and logic modules are camelCase (`settingsDiff.ts`). Never kebab-case component files.
- **Every component has a colocated `<Component>.module.css`** with exactly ONE importer; `app/src/global.css` is the only other stylesheet. Two importers = a component nobody extracted — extract and compose, never copy the stylesheet.
- **Everything is a component, even text.** Never a bare `<p>`/`<span>`/`<h1>`/`<button>` with a class where a `ui/` primitive exists (`Text` `Heading` `Label` `Badge` `Button` `Field` …). If none fits, **the primitive is missing** — add it.
- **One button family.** A clicked command is `TextButton`/`IconButton`/`IconTextButton`/`SegmentedToggle`/`ChipToggle` — never a raw `<button>` (JSX or `createElement('button')`) nor `ui/Button` imported directly. `ui/oneButton.test.ts` fails the gate otherwise; exceptions are a per-file allow-list with reasons.
- **Break things down further than feels necessary.** The default answer to "is this big enough to extract?" is yes.
- **This is Solid, not React.** (1) No `FC` — type a component as `Component<Props>` from `solid-js`. (2) **Never destructure props** — `({ color }) => …` reads the field ONCE and silently keeps its first value forever (no typecheck error, test failure or warning). Take `props` whole, read `props.color` at use; copy `ui/Text.tsx`.
- **Variants are props, not new files** (`Heading level={1..6}`, not `Heading1.tsx`).
- **Accept an optional `className` merged onto the root element**, so a caller can adjust one instance without forking the component.
- **Pure logic lives in plain `.ts` modules with no framework imports** — that is what keeps it unit-testable and lets the component render in Storybook.
- **Reach through the tree, not through the DOM.** Never `closest('.some-class')`/`classList` against a **class name** in a component (hashed → the guard silently stops firing); the child claims its event with `stopPropagation` — which does *not* stop `onPointerDown`/`onDblClick`. Fine: **tag** selectors, **data attributes**, plain-DOM libraries, `document.documentElement.classList`.
- **Two element-hook forms.** `data-<name>` (`data-pane-leaf`, `data-ft-path`) is a **runtime** hook production CSS/JS reads; `data-testid` is **test-only** and nothing in production may read it. Never invent a third form.
- **Every component added or meaningfully changed gets a story** — one without is invisible to visual verification, i.e. untested.
- **Formatting:** no semicolons, single quotes, 4-space indent, `x => x` not `(x) => x`. Match the surrounding file.
- **Agent working artifacts** (plans, ledgers, scratch reports) go in `.claude/`, never in the repo source tree.

## Module Organization

Bun `workspaces` in the root `package.json`: `core` is named `@bismuth/core` but has no package entry point — `app`/`cli`/`daemon` import it by relative path (`../../core/src/…`); `mcp` imports only `core/src/visibilityCliGate` (the visibility gate + `mcpChannel`). Add a dep with `cd <workspace> && bun add <package>`; `bun install` at root syncs all. Purposes are in **Architecture** above. **Per-file map: `docs/contributing/codebase-map.md`** (not exhaustive — newer `app/src/bases`/`editor`/`chat` files may be missing). Non-workspace top-level dirs: `bench/` (the visual gate), `scripts/` (gate + docs check).

## Development Workflow

- **Hot-reload**: Vite hot-reloads `.tsx`/`.css` (state preserved); **backend restarts** on `core/src` changes; `.settings` re-reads per request. Vault `.md` edit → debounce → invalidate → version bump → SSE → re-fetch.
- **Graph not updating?** Wait the 250ms debounce + ≤5s poll; `curl :4321/version`; watch `/events`. Content-only edits set `dirty.graph=false` (rebuild skipped) — expected. **Layouts come from the backend**, the renderer only morphs; a silently-dead SSE (proxy/OS-sleep) is recovered by that `/version` poll.

## Common Tasks

**`docs/contributing/codebase-map.md` → "Where to Add Things"** is the lookup table (endpoint, graph kind, setting, command, keybinding, Bases view kind/function, pane file type, shell component, visual verification). The one that bites: a **setting** is schema-first (`settingsSchema.ts` → `app/src/settings.ts`, `settings.parity.test.ts` enforces parity; default = the current hardcoded value). A new **design token** = a `global.css` `:root` line + a `DESIGN_TOKENS` entry in `core/src/theme/designTokens.ts` (+ its row in `docs/settings/tokens.md`, whose kind/default/doc `core/test/theme/tokensDoc.test.ts` pins to the registry).

## Error Handling

Backend errors use `AppError` (`core/src/error.ts`): `createError(code, msg)` or `new AppError(code, msg, status)`. `mutatingHandler` maps `AppError.statusCode` onto the response (generic `Error` → 500). The code→status table (`ENOENT`/`*_NOT_FOUND` 404, `EACCES` 403, `EEXIST`/`*_CONTENT_CHANGED` 409, `EINVAL`/`PARSE_ERROR`/`SCHEMA_ERROR`/`*_FORMAT_ERROR`/`BASE_CYCLE` 400) is in `error.ts`.

## Shared Helpers

- **`graphBuilder.ts` `buildGraphFromNotes(root, nodeBuilder, edgeExtractor)`** — the walk+read+index behind `vault.ts`/`memory.ts` — use it for any new graph source.
- **`files.ts` `walkDir(root, filter, allowDot?)`** — recursive walk behind `listTree`/`listTemplates`; `filter` returns `true`/`false`/`{data}`, and a dot-entry is skipped **unless `allowDot(rel)` opts it back in** (that arg is how `.settings`/`.daemon` surface at all).
- **`frontmatter.ts` `mutateFrontmatter(yaml, mutate)`** — edits via the `yaml` Document API (preserves comments/key order/flow arrays).
- **`app/src/serverVersion.ts`** tracks a `ConnectionState`; on SSE loss it toasts + polls `/version` until reconnect.
- **`app/src/sanitizeHtml.ts`** — DOMPurify wrapper for `innerHTML` of vault-rendered HTML. Always route rendered HTML through it, built with the canonical `htmlEscape.ts`.

## Key Concepts

### Vault Structure
Markdown tree; YAML frontmatter; wikilinks `[[Another Note]]` matched by **file name, not path**; top-level folder → the `folder` field on nodes (`reading/quotes/x.md` → `folder="reading"`). The memory graph is built separately with `mem:`-prefixed nodes, joined by "about" edges. **A binary (image/PDF) carries its own tags via a companion note `<file>.md`** (`core/src/fileKinds.ts`'s `companionPathFor`, created lazily on first edit) — hidden in the file tree while the binary exists, a real note everywhere else (graph node, tag graph, Bases), and redirected to the binary's own preview on open (`App.tsx`'s `openFile`); see `docs/vault/frontmatter.md`.

### Graph Modes
`GraphMode` (`app/src/commands.ts`) is exactly `"2nd" | "3rd" | "both" | "local"` — no "agents" or "daemon" mode. **2nd** vault + tags · **3rd** memory · **both** + cross-edges · **local** the open note's neighborhood (`localSubgraph`, the one mode laid out in the browser). Switched from the graph pane's ViewBar; 2D/3D is a transient localStorage flag. Ref: `docs/graph/overview.md`.

### Desktop app & core sidecar (`app/src-tauri/`)

The bundled `/Applications` app **spawns its own `core` backend** (not `dev:browser`). `build-core-sidecar.ts` compiles `core/src/server.ts` to a standalone binary; on launch `src/lib.rs` picks a free port, mints a per-launch owner token (sidecar env `BISMUTH_OWNER_TOKEN` = webview `window.__BISMUTH_OWNER_TOKEN__`), spawns the sidecar, kills it on exit, and injects `window.__BISMUTH_API__`. A Finder-launched app has no shell env, so `lib.rs` resolves the vault from `config.json`; on **first run** `index.tsx` renders the **Vault Intro** takeover (`app/src/intro/`). Detail: `docs/overview/install.md`.

### Mobile / iPad (`core/src/localBackend.ts` + `core/src/fileAccess.ts` + `app/src/mobile/`)

On iPad/iOS the Bun HTTP server can't run, so the app runs the **same core logic in-process, no HTTP**, via two seams: **`fileAccess.ts`** (desktop lazy-imports `files.ts`; mobile registers a `tauri-plugin-fs` impl via `setFileAccess()` — nothing statically imports Bun/`node:fs`) and **`api.ts`**'s swappable `Transport`. `localBackend.ts`'s `dispatch()` reuses engine/bases/search/tasks/srs — reads + content-only writes; structural fs ops answer 501. `bootMobile.ts` swaps both seams before importing `App`; change detection via `backend.subscribe()`, not SSE. Ref: `docs/mobile/overview.md`.

### MCP Integration (`mcp/` workspace)

A stdio MCP server serving the `docs/` reference + `bismuth` CLI **token-frugally**: 6 always-on tools (`bismuth_docs_{list,search,read}`, `bismuth_doctor`, `bismuth_cli`, `bismuth_cli_help`) + 3 daemon-gated memory tools (`remember`/`recall`/`forget`). **Dev**: auto-attaches per-tab via relay's `.mcp.json`. **Bundled app**: installed machine-wide on boot (`core/src/bismuthInstall.ts`). **App control** adds **ZERO new MCP tools** — it rides `bismuth_cli` via the `app` group → core's `/ui/*` WS (plus the headless `page` group for inbox pages). **No skills, no slash commands**: agent guides (`docs/bases/authoring.md`, `docs/guides/converting-*.md`) are plain docs pages, and the trigger to read one is `mcp/src/instructions.ts`'s `SERVER_INSTRUCTIONS` ("EVERY time you … a base, first read bases/authoring.md"), which every client receives before its first tool call — a new guide = a docs page + one instructions line. **MCP↔CLI parity**: every MCP tool has a CLI twin (`mcp/src/cliTwins.ts`'s `CLI_TWINS`) and every CLI command is reachable via `bismuth_cli`; `cli/test/mcpParity.test.ts` fails a tool added without one. Detail: `docs/mcp/{overview,app-control}.md`.

### Relay Integration (`relay/` workspace + `core/src/relay.ts`)

A small Claude Code plugin (`relay/`) reports each terminal-tab Claude session + its subagents via `POST /relay/*` to an **in-process registry** (`core/src/relay.ts`; `GET /relay/snapshot` redacts `lastMessage` for non-owners). Loads per-session inside app terminals only (bundled via `BISMUTH_RELAY_BUNDLE`; nothing in `~/.claude`) — `terminal.ts` injects `CLAUDE_TERMINAL_ID`/`CLAUDE_RELAY_URL` + a zsh shim so a bare `claude` auto-loads it. Pruned against the live pty set; lives only while core runs.

### Daemon Integration (`daemon/` workspace + `core/src/daemon.ts` + `daemonGraph.ts`)

**One machine process multiplexing per-vault brains**: machine identity at `~/.bismuth/daemon` (`daemonMachineDir()`, `BISMUTH_DAEMON_DIR`); each enabled vault's brain (memory, crons, processes, session) under `<vault>/.daemon`. The cron scheduler fans out over every enabled vault per tick; a reconcile loop starts/pauses a brain as `settings.daemon.enabled` flips. `sendMessage` passes `cwd`/`env.BISMUTH_MEMORY_DIR`/`resume` per call, so concurrent sessions never race.

**Deep reference: `docs/daemon/`.** The load-bearing points:
- **Runs as a launchd/systemd service, NOT a Tauri child** — it must outlive the app to keep firing crons. `core/src/daemon.ts`/`daemonGraph.ts` are Bismuth's READ window: the `::daemon` page (`daemon/DaemonPageHost.tsx`, fed by `GET /daemon/snapshot` + `/daemon/logs`) with an inline `::chat:daemon` chat (`daemon/DaemonChat.tsx`) that only a trusted gesture on its composer arms — opening the page spawns no session. `daemonGraph()` now only backs `bismuth daemon graph`.
- **Memory injection is per-session + vault-scoped**, gated on the daemon being enabled — `terminal.ts` injects `BISMUTH_MEMORY_DIR` into PTYs; no global `~/.claude/settings.json` hook.
- **The daemon session's MCP is EXPLICIT wiring** (`buildQueryOptions()`, `settingSources:[]`); `settings.daemon.inheritUserMcp` adds **user scope only, never `project`/`local`** — the session's cwd is the vault, so those would run a planted `.mcp.json` under `bypassPermissions`. `chat.ts` deliberately differs; don't unify them.
- `settings.daemon.enabled` is the master switch for the whole 3rd-brain surface. Name + personality live in `<vault>/.daemon/identity.md`; `reconcileSeeds` writes any MISSING default on brain-start — add a seedable via one `seedsFor()` entry.
- Cron/process/brain-start activity: `<vault>/.daemon/logs/activity-YYYY-MM-DD.jsonl` (`bismuth daemon logs`).
