# Codebase map

Every directory of the Bismuth monorepo, what lives there and the file to open first, plus where to make the common changes.
It is for engineers finding the code behind a feature.
How the workspaces fit together at runtime is in [Architecture](../overview/architecture.md), and the commands to run and test them are in [Testing](testing.md).

## Workspaces and top-level directories

The root `package.json` lists the Bun workspaces.
`core` is named `@bismuth/core` but has no package entry point: `app`, `cli` and `daemon` import it by relative path (`../../core/src/…`), and `mcp` imports only `core/src/visibilityCliGate.ts`.
Add a dependency with `cd <workspace> && bun add <package>`.

| Directory | Package | Holds | Open first |
|---|---|---|---|
| `core/` | `@bismuth/core` | The backend: HTTP server, vault and graph logic, settings schema, Bases, tasks, chat providers, daemon read window | `core/src/server.ts` |
| `app/` | `@bismuth/app` | The Solid frontend, Storybook, and the Tauri shell | `app/src/App.tsx` |
| `cli/` | `@bismuth/cli` | The `bismuth` binary, a thin layer over `core` | `cli/src/index.ts` |
| `mcp/` | `@bismuth/mcp` | A stdio MCP server: docs, the CLI bridge, daemon-gated memory tools | `mcp/src/server.ts` |
| `memory/` | `@bismuth/memory` | The pure 3rd-brain memory graph, shared by the daemon, relay hooks and MCP | `memory/src/index.ts` |
| `daemon/` | `@bismuth/daemon` | One machine process running every enabled vault's crons, processes and session | `daemon/src/daemon/index.ts` |
| `relay/` | `@bismuth/relay` | A Claude Code plugin whose hooks report terminal sessions and inject memory | `relay/hooks/hooks.json` |
| `services/feedback/` | none | The hosted feedback relay: a standalone Bun service, deployed on its own, that emails feedback on; see [Feedback](../overview/feedback.md) | `services/feedback/server.ts` |
| `bench/` | none | Visual-check and benchmark scripts; see [Visual checks](visual-checks.md) | `bench/verify.ts` |
| `scripts/` | none | The pre-commit gate, the docs check, the design-system gate, code generators | `scripts/gate.ts` |
| `docs/` | none | This documentation tree | `docs/README.md` |
| `design/` | none | `baseline.json`, the design-system gate's accepted-debt ratchet | `design/baseline.json` |

`DESIGN.md` at the repo root holds the design system and the `governance:` block the design-system gate reads. `.githooks/` holds the git hooks. The root `dependencies` (`@napi-rs/canvas`, `pdf-lib`, `perfect-freehand`) serve `core/src/drawing/`.

## Where do I add things?

Find the change in the table, then follow its steps in the section below. A test name in the last column is a guard test that fails when you skip a step it covers; `none` means no test catches a missed step.

| To add | Start in | Guard test |
|---|---|---|
| A read or mutating endpoint | `core/src/routes/<area>.ts` | `routeTable.test.ts` |
| A graph node or edge kind | `core/src/graph.ts` | none |
| A setting | `core/src/schema/settingsSchema.ts` | `settings.parity.test.ts`, `schemaSnapshot.test.ts` |
| A design token | `core/src/theme/designTokens.ts` | `tokenRegistry.test.ts`, `tokensDoc.test.ts` |
| A command | `core/src/commands.ts` | `commands.test.ts` (catalog shape only) |
| A keybinding | `core/src/keybindings.ts` | `keybindingCoverage.test.ts`, `schemaSnapshot.test.ts` |
| A Bases view kind | `core/src/bases/types.ts` | `guides.test.ts` |
| A Bases function | `core/src/bases/functions.ts` | `functions.test.ts` |
| A pane file type | `app/src/PaneContent.tsx` | none |
| A shell component | `app/src/shell/` | design-system gate |
| A chat backend | `core/src/agentBackends/catalog.ts` | `catalogParity.test.ts` |
| A CLI command | `cli/src/commands/<group>.ts` | `guideCommands.test.ts` |
| An MCP tool | `mcp/src/server.ts` | `mcpParity.test.ts` |
| A component | `app/src/<area>/` | design-system gate |

### Add an HTTP endpoint

1. Add a `'GET /path'` handler to the default factory in `core/src/routes/<area>.ts`. A write goes in that file's `<area>MutatingRoutes` factory, wrapped in `ctx.mutatingHandler(run, pathOf)`, where `pathOf` returns the written path so the watcher drops its own echo.
2. For a new area, create the file with a default `(ctx: RouteContext) => Record<string, Handler>` factory and spread it into `routes` (and any `xMutatingRoutes` into `mutatingRoutes`) in `core/src/server.ts`.
3. Add the route key to `EXPECTED` in `core/src/routes/routeTable.test.ts`.
4. Call it from `app/src/api.ts`, and document it in `docs/api/http-reference.md`.
5. To make it work on iPad and iOS, handle it in `dispatch` in `core/src/localBackend.ts`. A route that function does not handle answers 501 on mobile.

### Add a graph node or edge kind

1. Add the kind to `NodeKind` or `EdgeKind` in `core/src/graph.ts`. If it belongs to the 2nd or 3rd brain, add it to `SECOND_BRAIN_KINDS` or `THIRD_BRAIN_KINDS` there too.
2. Build it in `vault.ts`, `memory.ts` or a new builder that uses `buildGraphFromNotes` from `graphBuilder.ts`, and merge it in `engine.ts`.
3. Filter it in `selectDisplayGraph` in `app/src/graph/displayGraph.ts` and draw it in `app/src/graph/AsciiGraphRenderer.ts`.

### Add a setting

1. Add the leaf, with a `default` and a `doc` string, to `core/src/schema/settingsSchema.ts`.
2. Add the field to the `Settings` interface in `app/src/settings.ts`. `DEFAULTS` derives from the schema.
3. Run `bun run test:bless-schema` and commit the snapshot diff.
4. Document the key in `docs/settings/reference.md`.
5. If CSS reads the value, add one `--var` line to `settingsToCssVars` in `app/src/settingsCssVars.ts` and a `var()` reference in the stylesheet.

### Add a design token

1. Add the `:root` line to `app/src/global.css`.
2. Add a `DESIGN_TOKENS` entry (key, kind, group, default, doc) to `core/src/theme/designTokens.ts`.
3. Add the row to the group's table in `docs/settings/tokens.md`.

### Add a command

1. Add a `COMMAND_CATALOG` entry (`id`, `label`, `icon`) in `core/src/commands.ts`. Set `interactive: true` if the action only opens a modal.
2. Add an action for the id in `bindCommands` in `app/src/commands.ts`, and a member to `CommandHandlers` if it needs one.
3. Document it in `docs/settings/toolbar-commands.md`.

### Add a keybinding

1. Add a `KEYBINDING_CATALOG` entry (`id`, `label`, `default`, `doc`) in `core/src/keybindings.ts`. The `keybindings` schema section derives from the catalog.
2. In the handler that runs the action, test the event with `matchesKeybinding(e, <the setting>)` from `app/src/keybindings.ts`. Never write a key literal: `keybindingCoverage.test.ts` fails on one.
3. Run `bun run test:bless-schema`, and document the binding in `docs/settings/keybindings.md`.

### Add a Bases view kind

1. Add the kind to `VIEW_TYPE_VALUES` in `core/src/bases/types.ts`.
2. Write the renderer in `app/src/bases/` and add a `<Match>` arm in `ViewRenderer.tsx`. `calendar` and `flashcards` are mounted by `BaseView.tsx` itself.
3. Add a menu entry to `BASE_VIEW_KINDS` in `app/src/baseViews.ts`.
4. Write `docs/bases/views/…` and `docs/bases/authoring/<kind>.md`, and mention the kind in `docs/bases/authoring.md`. `core/test/guides.test.ts` requires exactly one authoring page per kind.

### Add a Bases function

1. Add the case to `callFunction` (global functions) or to the per-type method helper that `callMethod` dispatches to, in `core/src/bases/functions.ts`. A new summary name goes in `summarize` in `core/src/bases/query.ts`.
2. Test it in `core/test/bases/functions.test.ts`.
3. Add a row to `docs/bases/functions.md`.

### Add a pane file type

1. Make `listTree` in `core/src/files.ts` list the extension.
2. Give it a label and icon in `app/src/tabIds.ts`.
3. Add a `<Match>` arm in `app/src/PaneContent.tsx`.
4. Add a create entry in `app/src/FileTree.tsx` if users create the file themselves.

### Add a shell component

Add a slot-driven component in `app/src/shell/` that takes props only, owns no signal and fetches nothing, so it renders in Storybook with stubs. Give it a `.module.css` and a `.stories.tsx`, then wire it into `AppFrame.tsx` or `App.tsx`.

### Add a status bar segment

Extend `STATUS_BUILTINS` or the item model in `core/src/statusBarItems.ts`, evaluate it in `core/src/statusBarEval.ts`, and render it in `app/src/shell/StatusBar.tsx` and `StatusSegment.tsx`. The `statusBar` entry in `settingsSchema.ts` carries the setting.

### Add a chat backend

1. Add the id to `BACKEND_IDS` and an entry to `BACKENDS` in `core/src/agentBackends/catalog.ts`.
2. Implement it in `CHAT_BACKENDS` in `core/src/chatProviders/backends.ts`. An ACP-based agent is one entry in `ACP_AGENTS` in `core/src/chatProviders/acp/agents.ts`.
3. `core/test/agentBackends/catalogParity.test.ts` checks each capability flag against the implementation. Document the backend in `docs/chat/backends.md`.

### Add a CLI command or MCP tool

1. Export a CLI command from a group in `cli/src/commands/<group>.ts` (`commands: CommandMap`). A new group is imported and listed in `GROUPS` in `cli/src/registry.ts`. Document it in `docs/cli/reference.md`.
2. Add an MCP tool to the tool list in `mcp/src/server.ts` and a `CLI_TWINS` entry in `mcp/src/cliTwins.ts`. `cli/test/mcpParity.test.ts` fails without the twin.

### Add a component

Give it a colocated `<Name>.module.css` and `<Name>.stories.tsx`; the shared story fixtures are the `app/src/ui/_*` files. Check it with `bun run verify`, as [Visual checks](visual-checks.md) explains.

## What is in `core/`?

`core/src/` holds backend logic with no UI dependency, so `app`, `cli` and `daemon` all import it. Modules are listed by area; open the first one in each row to orient.

| Area | Modules |
|---|---|
| HTTP server and change feed | `server.ts` (the only Bun server), `sse.ts`, `asyncCache.ts`, `changeClassifier.ts`, `selfWriteMarks.ts`, `watchSkip.ts`, `liveWatch.ts`, `error.ts` |
| Graph and layout | `graph.ts` (types), `engine.ts`, `vault.ts`, `memory.ts`, `graphBuilder.ts`, `graphBlock.ts`, `community.ts`, `layout.ts`, `layout-cache.ts`, `layoutRunner.ts`, `layoutWorker.ts`, `layoutCompute.ts`, `brainCompose.ts`, `linkTarget.ts` |
| Files and notes | `files.ts` (I/O and path-traversal rejection), `fileAccess.ts`, `fileKinds.ts`, `pathUtils.ts`, `frontmatter.ts`, `wikilinks.ts`, `tags.ts`, `templates.ts`, `dailyNote.ts`, `search.ts`, `replace.ts`, `backup.ts`, `scratchNotes.ts` |
| Settings and UI contracts | `settings.ts`, `settingsSerialize.ts`, `commands.ts`, `keybindings.ts`, `statusBar*.ts`, `shellLayout.ts` |
| Tasks | `tasks.ts`, `taskParse.ts`, `taskFields.ts`, `taskCreate.ts`, `taskEdit.ts`, `taskReorder.ts`, `taskMigrate.ts`, `taskMigrateRun.ts`, `taskLegacy.ts` |
| Calendar | `calendar.ts`, `dates.ts`, and `gcal/` |
| AI visibility | `visibility.ts`, `visibilityFilter.ts` (the one shared filter), `visibilityCliGate.ts`, `ownership.ts` |
| Daemon read window | `daemon.ts`, `daemonGraph.ts`, `daemonState.ts`, `daemonViz.ts`, `daemonInstall.ts`, `daemonActivity.ts`, `daemonPages.ts`, `serviceUnit.ts` |
| Memory recall | `memoryRecall.ts`, `memoryEmbed.ts`, `embedModel.ts`, `embedWorker.ts`, `embedWorkerBoot.ts`, `memoryRerank.ts`, `rerankWorker.ts`, `memoryRef.ts` |
| Chat, agents and terminal | `chat.ts`, `chatModelStore.ts`, `agents.ts`, `freeAgent.ts`, `claudeWhich.ts`, `relay.ts`, `terminal.ts`, `uiControl.ts` |
| Install, update and run state | `bismuthInstall.ts`, `bismuthHome.ts`, `selfUpdate.ts`, `openFolder.ts`, `runRegistry.ts`, `ownerToken.ts` |
| Mobile | `localBackend.ts`, the in-process backend used where no HTTP server can run |

| Subdirectory | Holds | Open first |
|---|---|---|
| `core/src/routes/` | One route factory per area: `vault`, `graph`, `settings`, `bases`, `tasks`, `daemon`, `gcal`, `relay`, `agents`, `memory`, `system`, plus `context.ts` | `context.ts` |
| `core/src/bases/` | The Bases engine: lexer, parser, evaluator, filters, functions, sources, query, chart data, task rows | `query.ts` |
| `core/src/schema/` | The settings schema, validation, coercion, completion suggestions | `settingsSchema.ts` |
| `core/src/theme/` | Theme tokens, the design-token registry, custom themes, font families | `tokens.ts`, `designTokens.ts` |
| `core/src/srs/` | Flashcards: SM-2 scheduler, markdown card parser, row cards | `scheduler.ts` |
| `core/src/drawing/` | The `.draw` document model, geometry, 2D rendering, export, ink codec | `model.ts` |
| `core/src/gcal/` | Google Calendar sync: OAuth, client, mapping, sync loop | `sync.ts` |
| `core/src/chatProviders/` | The chat drivers: `acp/`, `codex/`, `opencode/`, and the `CHAT_BACKENDS` table | `backends.ts` |
| `core/src/agentBackends/` | The backend capability catalog, MCP registrars, sandbox wrapper, local-model setup | `catalog.ts` |
| `core/src/doctor/` | `bismuth doctor`: sections, runner and the fix routes | `run.ts` |
| `core/src/render/` | Headless Chrome launcher and HTML rasterising, shared with `bench/` and export | `chromeSession.ts` |

`core/test/` mirrors `core/src/`; its subdirectories are `bases/`, `srs/`, `drawing/`, `schema/`, `gcal/`, `theme/`, `chatProviders/`, `agentBackends/`, `doctor/`, `render/`, `upgrade/`, `support/` and `fixtures/`. See [Testing](testing.md#where-do-tests-live).

## What is in `app/`?

`app/` holds the Solid frontend, the Storybook catalog and the Tauri shell.

| Path | Holds | Open first |
|---|---|---|
| `app/src/` | The frontend source (below) | `index.tsx`, `App.tsx` |
| `app/.storybook/` | Storybook 9 config; `preview.ts` projects the real theme tokens and installs a fake transport | `preview.ts` |
| `app/src-tauri/` | The Tauri shell: spawns the `core` sidecar and injects the API base and owner token | `src/lib.rs` |
| `app/scripts/` | The dev launcher, the sidecar builds, installer and icon generators | `dev.ts` |
| `app/test/` | Tests that sit outside `src/` | `settings.test.ts` |

### Top-level files in `app/src/`

| Area | Files |
|---|---|
| Boot | `index.tsx` mounts `App` or, on first run, `intro/VaultIntro`; `fonts.ts`; `global.css` |
| Panes and tabs | `panes.ts` (the pure Leaf/Split tree), `PaneTree.tsx`, `PaneLeaf.tsx`, `PaneHeader.tsx`, `PaneContent.tsx` (routes a leaf to its view), `tabIds.ts` (sentinel ids such as `::graph`) |
| Views a pane can show | `Editor.tsx`, `GraphView.tsx`, `Terminal.tsx`, `PreviewView.tsx`, `SheetView.tsx`, `ExportView.tsx`, `FileView.tsx`, `InboxPageView.tsx` |
| File tree | `FileTree.tsx`, `fileTree*.ts`, `treeStore.ts`, `dropIntake.ts`, `fileIntake.ts` |
| Backend client | `api.ts` (a swappable `Transport`), `serverVersion.ts` (SSE plus a `/version` poll), `serverError.ts` |
| Settings and theme | `settings.ts`, `settingsDiff.ts`, `settingsCssVars.ts`, `themes.ts`, `customThemes.ts`, `effectiveTokens.ts` |
| Commands and keys | `commands.ts`, `keybindings.ts`, `keybindingsCoverage.ts` |

### Subdirectories of `app/src/`

| Directory | Holds | Open first |
|---|---|---|
| `shell/` | The slot-driven app chrome: frame, top strip, tab rail, sidebar, status bar | `AppFrame.tsx` |
| `ui/` | The primitives (`Text`, `Heading`, `Button` family, `Modal`, `Field`, `ViewBar` …), `ascii/`, `popover/`, `gallery/`, and the `_*` story fixtures | `Text.tsx` |
| `editor/` | The CodeMirror extension set for notes: live preview, tables, tasks, query blocks, ink, completion | `livePreview.ts` |
| `milkdown/` | The Milkdown WYSIWYG bridge used by `ui/MilkdownField.tsx` | `milkdownEditor.ts` |
| `bases/` | The Bases view renderers, editors and `BaseView.tsx`, which owns the single `ViewBar` | `BaseView.tsx`, `ViewRenderer.tsx` |
| `calendar/` | Calendar state, `EventStore`, and the calendar and task-calendar components | `state.ts` |
| `graph/` | The ASCII graph renderer, camera, layers and label selection | `graphRenderer.ts` |
| `chat/` | The chat UI and `chatSessions.ts`, the registry that keeps each chat's socket and transcript alive | `chatSessions.ts` |
| `quickAsk/` | The `Mod+K` popover: a one-off daemon conversation with apply, anchored at the caret or the pane top | `QuickAskHost.tsx` |
| `daemon/` | The daemon page, its docked chat, inbox, crons and processes | `DaemonPageHost.tsx` |
| `feedback/` | The feedback page: the draft form and the daemon interview | `FeedbackPageHost.tsx` |
| `preview/` | Image, PDF and code previews, annotation stores, outline and bookmarks | `previewKind.ts` |
| `drawing/` | The `.draw` canvas, toolbar and input handling | `DrawingPage.tsx` |
| `sheet/` | Univer workbook snapshot and sync, code-split | `univerSheet.ts` |
| `export/` | Export formats, HTML and PDF pipelines | `exporters.ts` |
| `palette/` | The command palette and the Cmd+O switcher | `SwitcherBar.tsx` |
| `intro/` | The first-run vault intro | `VaultIntro.tsx` |
| `icons/` | The icon registry and picker | `Icon.tsx` |
| `dnd/` | Drag-and-drop geometry and payloads | `viewDrag.ts` |
| `mobile/` | The in-process backend wiring for iPad and iOS | `bootMobile.ts` |
| `ai/`, `color/`, `assets/` | AI-text detection, hex parsing, vendored fonts and icon manifests | |

Component files are PascalCase with a colocated `.module.css` and `.stories.tsx`; logic modules are camelCase. See the frontend rules in `CLAUDE.md`.

## What is in the other workspaces?

| Path | Holds | Open first |
|---|---|---|
| `cli/src/commands/` | One module per command group: `api`, `app`, `backends`, `base`, `calendar`, `card`, `chat`, `checkpoint`, `daemon`, `docs`, `doctor`, `draw`, `export`, `feedback`, `file`, `gcal`, `graph`, `install`, `memory`, `note`, `page`, `prop`, `relay`, `search`, `serve`, `settings`, `task`, `theme`, `update` | `cli/src/registry.ts` |
| `cli/src/` | The dispatcher (`index.ts`, longest-match over the registry), argument helpers (`args.ts`), the loopback HTTP helper (`http.ts`) | `index.ts` |
| `mcp/src/` | `server.ts` (tool list and dispatch), `docs.ts` (index, search and read of `docs/`), `cli.ts` (the CLI bridge), `memory.ts` and `daemon.ts` (daemon-gated tools), `instructions.ts` (the server instructions), `cliTwins.ts` | `server.ts` |
| `memory/src/` | `graph.ts` (note CRUD, frontmatter, backlinks), `search.ts` and `rank.ts` (BM25), `recall.ts` and `pack.ts` (prompt to injected block), `query.ts`, `transcript.ts` | `index.ts` |
| `daemon/src/daemon/` | The runtime: `cron.ts`, `process.ts`, `fileWatch.ts`, `pages.ts`, `session.ts`, `codexSession.ts`, `seeds.ts`, `persona.ts`, `defaultCrons.ts` | `index.ts` |
| `daemon/src/lib/` | Machine plumbing: `config.ts`, `registry.ts` (which vaults run), `owner.ts` and `device.ts` (multi-device ownership), `activityLog.ts`, `writeQueue.ts`, `vaultSettings.ts` | `config.ts` |
| `relay/bin/` | One script per Claude Code hook (`session-start-hook.ts`, `recall-hook.ts`, `tool-batch-hook.ts`, `subagent-*-hook.ts`, `session-end-hook.ts`) and `wrap.ts` for backends without hooks | `hooks/hooks.json` |
| `relay/shim/` | Shell shims that make a bare `claude` load the plugin inside app terminals | `shim/zdotdir/.zshrc` |

## Where do the agent guides live?

The guides an agent reads before a task are plain pages in `docs/`: `docs/bases/authoring.md` with `docs/bases/authoring/<kind>.md` for Bases, `docs/guides/converting-*` for vault conversion, and `docs/guides/custom-themes.md` for themes.
The trigger to read one is `SERVER_INSTRUCTIONS` in `mcp/src/instructions.ts`, which every MCP client receives before its first tool call; a new guide is a docs page plus one line there.
`core/test/guides.test.ts` and `cli/test/guideCommands.test.ts` keep the guides honest, as [Testing](testing.md#which-guard-tests-fail-when-a-change-is-incomplete) lists.

Source: `package.json`, `core/src/server.ts`, `core/src/routes/context.ts`, `core/src/graph.ts`, `core/src/bases/types.ts`, `core/src/schema/settingsSchema.ts`, `app/src/PaneContent.tsx`, `cli/src/registry.ts`, `mcp/src/server.ts`
