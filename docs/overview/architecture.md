# Architecture

Bismuth is a Bun-workspaces monorepo around one local backend. The backend (`core`) reads a vault of markdown notes, merges it with the daemon's memory into one knowledge graph, and serves it over HTTP, server-sent events and WebSockets to the desktop app, the `bismuth` CLI and agent tooling. This page is for engineers: it shows how the workspaces fit together and how the graph reaches the screen. For terms such as vault or companion note, see the [glossary](glossary.md).

```
                 ┌──────────────┐   HTTP + SSE + WebSocket    ┌────────────────────┐
 app (Solid) ───▶│              │◀────────────────────────────│ cli (headless calls │
 in Tauri or     │     core     │                             │  core functions)    │
 a browser       │  Bun server  │◀── relay hooks / MCP ───────│ claude sessions     │
                 └──────┬───────┘                             └────────────────────┘
                        │ reads and watches
              ┌─────────┴──────────┐
              │ vault (markdown)   │  2nd brain
              │ .daemon/memory     │  3rd brain, when the daemon is enabled
              └────────────────────┘
```

## What does each workspace do?

Each workspace is a directory in the root `package.json` `workspaces` list.

| Workspace | Package | Role |
|---|---|---|
| `core/` | `@bismuth/core` | Backend server, graph builders, caches, file watcher and every piece of business logic |
| `app/` | `@bismuth/app` | Tauri shell plus a Solid and Vite single-page app: editor, graph, panes, bases |
| `cli/` | `@bismuth/cli` | The `bismuth` binary; most commands call core functions directly with no server running |
| `relay/` | `@bismuth/relay` | A Claude Code plugin of hook scripts that report terminal sessions to core and fetch memory |
| `mcp/` | `@bismuth/mcp` | A stdio MCP server that serves `docs/` and the `bismuth` CLI to agents |
| `memory/` | `@bismuth/memory` | The pure 3rd-brain memory graph: note CRUD, backlinks, keyword search, query language |
| `daemon/` | `@bismuth/daemon` | One machine process that runs every enabled vault's memory, crons, processes and session |

`bench/` (visual checks), `scripts/` (the commit gate and docs check) and `design/` (the design-system baseline) are not workspaces. Add a dependency to one workspace with `cd <workspace> && bun add <package>`, and install all of them with `bun install` at the repo root. Per-directory file maps are in the [codebase map](../contributing/codebase-map.md).

## How do the three brains become one graph?

The three-brain model puts you at the centre of two stored layers:

- **2nd brain**: the vault, a folder of markdown files with wikilinks, tags and YAML frontmatter.
- **3rd brain**: the daemon's memory notes under `<vault>/.daemon/memory`. It exists only when `daemon.enabled` is true for the vault; otherwise the graph has no memory nodes and raises no error.

Core builds the vault graph in two passes: one `note` node per `.md` file, then edges and `tag` nodes from each note's wikilinks, tags and frontmatter. Wikilinks match by file name anywhere in the vault, not by path, and an ambiguous name resolves unpredictably. Memory notes become `mem:`-prefixed nodes. A memory note that links to a vault note produces an `about` edge, resolved by full path first and then by file name.

The merged graph then gets community labels. Detection is hierarchical Louvain, deterministic, and runs only when the graph has at least 30 nodes; a larger graph gets more nested levels, up to 4. Layouts are computed on the server, so the browser draws precomputed positions and never runs a force simulation. Node kinds, edge kinds, graph modes and layout details are in [Graph](../graph/overview.md).

## How does a client reach core?

The backend listens on port 4321 by default. The app resolves the backend URL at runtime, first match wins:

1. the `?api=<url>` query parameter, which "Open folder" sets for a sibling backend in a new window
2. `window.__BISMUTH_API__`, injected by the bundled Tauri shell for the backend it spawned on a free port
3. the `VITE_API_BASE` build variable
4. `http://localhost:4321`

Requests carry an owner token in the `X-Bismuth-Token` header. The dev script and the bundled app mint one token per launch and hand it to both core and the app; without it, content routes return 403 or silently filter notes a vault marks `chat-only` or `hidden`. The CLI reads the same token from a `0600` run record under `~/.bismuth/run`, over loopback only. The [install guide](install.md) covers dev ports and the bundled app's sidecar; the [HTTP reference](../api/http-reference.md) lists every route.

On iPad and iOS the HTTP server cannot run, so the app runs the same core logic in-process through a swappable transport. See [Mobile](../mobile/overview.md).

## How does an edit reach every client?

Core watches the vault, batches changes for 250 ms by default, works out whether links, tags or icons changed, drops only the caches that changed, bumps a version counter and pushes it over SSE. Clients refetch only what the event marks dirty, and a `GET /version` poll covers a dead stream. [Data flow](data-flow.md) covers the whole loop.

## Where do settings live?

Settings are one hidden, extensionless YAML file at the vault root, `.settings`, opened in the editor like any note. The file is sparse: an absent key means its schema default. The app changes a setting through `POST /set-setting`, one key at a time, so comments and key order survive. The schema in core is the source of truth, and the app's settings store mirrors it. See [Settings](../settings/overview.md).

## How do agents connect?

Three channels reach an agent:

- **Terminal tabs** run the user's own `claude` through a shell shim that loads the relay plugin, so each session and subagent reports to core's in-process relay registry. The registry feeds `bismuth relay list` and the chat view's subagent tracking, and when the daemon is enabled the hooks also recall memory and collect transcripts. It lives only while core runs.
- **MCP** is a stdio server. The relay plugin's `.mcp.json` auto-attaches it to those sessions, and the bundled app installs it machine-wide. It serves the docs and the CLI in token-frugal slices; vault features go through the `bismuth_cli` tool, which runs the `bismuth` binary. See [MCP server](../mcp/overview.md).
- **Chat** runs a long-lived agent session per chat over a provider seam that supports several backends. See [Chat](../chat/overview.md).

The agent guides (writing a base, converting a vault between Obsidian and Bismuth, making a theme) are ordinary `docs/` pages. The MCP server's instructions, which a client reads before its first tool call, tell an agent which page to read before each task, so every backend gets the same trigger through one channel.

## How does the UI get tested without the app?

Storybook mounts individual components with the real theme tokens and an in-memory transport, so a component that fetches on mount renders real content. See [Testing](../contributing/testing.md).

## How it works: entry points

- **core**: `core/src/server.ts` starts `Bun.serve`. It owns the state, the file watcher, `mutatingHandler`, the WebSocket upgrades and one `RouteContext`; route handlers live in `core/src/routes/<area>.ts`, one factory per area. Flags are `--vault`, `--memory` and `--port`, with `BISMUTH_VAULT` and `BISMUTH_MEMORY` as fallbacks for the first two. `core/src/engine.ts` exports `buildGraph(vaultDir, memoryDir?)`, the single composition entry point; `effectiveMemoryDir()` in the server returns `<vault>/.daemon/memory` only when the daemon is enabled, and `--memory` is otherwise ignored for the graph.
- **core as a library**: `core/package.json` has no `main`, `module` or `exports`, so nothing imports `@bismuth/core` by name. `app`, `cli` and `daemon` import by relative path into `core/src/`; only `cli` lists the package as a dependency. `mcp` imports one module from core, the visibility gate in `core/src/visibilityCliGate.ts`. `core` depends on `@bismuth/memory`, which the daemon also uses.
- **graph build**: `core/src/vault.ts` (vault graph, two passes), `core/src/memory.ts` (the `mem:` namespace), `core/src/engine.ts` (merge, `about` edges, `stampCommunities`), `core/src/community.ts` (`communityLevelsFor`), `core/src/layout-cache.ts` (`attachLayout`).
- **app**: `app/scripts/dev.ts` starts core and Vite together and mints the token; `app/src/api.ts` resolves the backend URL and the token; `app/src/index.tsx` code-splits between `App` and the first-run intro. On first run the bundled shell sets `window.__BISMUTH_FIRST_RUN__` and starts no backend.
- **cli**: `cli/src/registry.ts` merges the command groups and `cli/src/index.ts` dispatches them; `cli/src/commands/api.ts` is the passthrough for server-only routes.
- **relay**: `relay/hooks/hooks.json` declares the hooks; each script in `relay/bin/` posts to `/relay/*` and no-ops without `CLAUDE_TERMINAL_ID`. The registry is `core/src/relay.ts`.
- **mcp**: `mcp/src/server.ts` (tools), `mcp/src/docs.ts` (index, search, read), `mcp/src/cli.ts` (CLI bridge), `mcp/src/instructions.ts` (`SERVER_INSTRUCTIONS`).
- **settings**: `core/src/schema/settingsSchema.ts` (schema), `core/src/settings.ts` (`reconcileSettings`, `setSettingInFile`), `app/src/settings.ts` (store), `app/src/settingsCssVars.ts` (projection onto `:root`).

Source: `package.json`, `core/package.json`, `core/src/server.ts`, `core/src/engine.ts`, `core/src/vault.ts`, `core/src/memory.ts`, `core/src/community.ts`, `core/src/relay.ts`, `core/src/visibilityCliGate.ts`, `core/src/settings.ts`, `core/src/schema/settingsSchema.ts`, `cli/src/registry.ts`, `relay/hooks/hooks.json`, `mcp/src/server.ts`, `mcp/src/instructions.ts`, `app/scripts/dev.ts`, `app/src/api.ts`, `app/src/index.tsx`, `app/src/settings.ts`
