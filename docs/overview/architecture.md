# Bismuth Architecture Overview

Bismuth is a personal knowledge management system built as a Bun monorepo with seven workspaces. This page maps that monorepo — what each workspace does, how the three-brain model becomes one merged knowledge graph, and how that graph reaches the frontend — and is the place to start when orienting yourself in the codebase.

The central concept is the **three-brain model**: a "2nd brain" (vault of markdown files) and a "3rd brain" (the per-vault daemon's memory notes, living under `<vault>/.daemon/memory` and present only when `daemon.enabled`). These data sources are merged by the core backend into a single knowledge graph, precomputed with 2D and 3D layouts, served over HTTP to a Tauri + Solid.js desktop app.

The relay plugin reports Claude Code sessions and subagents running inside the app's own terminal tabs into an in-process registry on the core server — it no longer powers a graph mode (the "agents" graph was removed in `a6687c0`), but the registry still backs `chat.ts`'s subagent lifetime tracking and `terminal.ts`'s tab-close pruning. The mcp workspace is a stdio MCP server that auto-attaches to those same sessions to serve the docs + CLI.

**What's in this doc:** monorepo layout and workspace roles → the three-brain model → graph composition and types → graph modes (2nd/3rd/both/daemon/local) → vault-change data flow → HTTP API summary → settings architecture → caching strategy.

---

## Monorepo Layout

The root `package.json` declares seven Bun workspaces:

```json
{
  "workspaces": ["core", "cli", "app", "relay", "mcp", "memory", "daemon"]
}
```

| Workspace | Package name | Role |
|-----------|--------------|------|
| `core/` | `@bismuth/core` | Backend HTTP server, graph builders, all business logic |
| `app/` | `app` | Tauri + Solid.js desktop frontend; imports `@bismuth/core` for shared types |
| `cli/` | `@bismuth/cli` | `bismuth` binary; imports `@bismuth/core` and calls core functions headlessly |
| `relay/` | `@bismuth/relay` | Claude Code hooks-only plugin; feeds core's in-process relay registry |
| `mcp/` | `@bismuth/mcp` | stdio MCP server; auto-attaches to app-terminal Claude sessions, serves `docs/` + the `bismuth` CLI token-frugally |
| `memory/` | `@bismuth/memory` | The pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL), used by the daemon, relay hooks, and MCP memory tools |
| `daemon/` | `@bismuth/daemon` | Per-vault daemon runtime; one machine process multiplexing every enabled vault's memory + crons + processes + conversation session |

Install all workspaces at once with `bun install` from the repo root. To add a package to a specific workspace: `cd <workspace> && bun add <package>`.

### `core/` — the backend

`core/src/server.ts` is the entry point. It starts a `Bun.serve` HTTP server (default port `:4321`) that:

- Accepts `--vault <dir>` and `--memory <dir>` CLI flags (both required when run standalone; the bundled app passes `<vault>/.daemon/memory` as `--memory`).
- Exposes a REST API consumed by both the app and the CLI.
- Watches the vault (including its in-vault `.daemon/memory`) for file changes, debounces them at 250 ms, selectively invalidates caches, bumps a version counter, and pushes SSE events to connected frontend clients.

`core` exports `@bismuth/core` (via `"module": "src/index.ts"`) so app and cli can import its pure functions and types.

### `app/` — the desktop frontend

A Tauri app wrapping a Vite + Solid.js SPA. Launched with `cd app && bun run dev:browser` (browser) or `bun run dev:app` (adds the native Tauri window). Both go through `app/scripts/dev.ts`, which runs `bun run ../core/src/server.ts` and `vite` concurrently via `concurrently`. `dev.ts` is a script rather than an inline `package.json` string because it needs real variable scope: it mints one random owner token per run (`core/src/ownerToken.ts`) and threads the same value to both halves — `BISMUTH_OWNER_TOKEN` to core, `VITE_OWNER_TOKEN` into the Vite bundle where `app/src/api.ts`'s `resolveOwnerToken` reads it — so dev requests present as the vault's owner instead of a filtered non-owner channel. Without it, every content route (`GET /file`, `POST /search`, …) 403s or silently filters the moment a vault marks anything `visibility: chat-only`/`hidden`. It also resolves which vault to open via `app/scripts/devVault.ts`: an exported `BISMUTH_VAULT`/`BISMUTH_MEMORY` always wins, otherwise it materialises a generated example vault at repo-root `.dev-vault/` (gitignored — dev builds write to their vault, so a committed fixture would surface as repo diffs the moment anyone clicked anything). Missing files are restored and existing ones left alone, so experiments survive restarts while `rm -rf .dev-vault` is a clean reset. The practical consequence: **a fresh clone runs with no environment setup at all.** `--app` additionally runs Tauri in this process group rather than through `tauri.conf.json`'s `beforeDevCommand`, which would re-invoke `bun run dev:browser` and collide a second core+Vite pair on `:4321`/`:1420`. The app talks to the core server at a URL resolved at runtime from (in priority order): `?api=<url>` query param → `VITE_API_BASE` build env → default `http://localhost:4321`. This resolution is in `app/src/api.ts`.

The entry point `app/src/index.tsx` code-splits two roots. On **first run** the bundled app's `lib.rs` injects `window.__BISMUTH_FIRST_RUN__` (and does **not** start a backend); `index.tsx` then renders the full-window **Vault Intro** takeover (`app/src/intro/VaultIntro.tsx`) instead of `App` — a short slideshow ending in a native folder picker that creates the vault, with `?intro=1` forcing it in dev/browser for preview. A normal launch never loads the intro, and first-run never loads `App` (which would fire API calls against a backend that isn't there). Full detail in [install](./install.md).

### `cli/` — the `bismuth` binary

A thin dispatcher over `@bismuth/core`. Most file-based operations (list notes, read/write, tasks, bases, drawing export) run **headlessly** with no running server — e.g. `bismuth graph` (`cli/src/commands/graph.ts`) calls `buildGraph()` directly and prints the result, no server involved. Operations with no dedicated command group go through the generic `api <METHOD> <path>` passthrough (`cli/src/commands/api.ts`: "Call any server route directly, for in-memory/server-only capabilities"), which hits a running server. Vault is specified via `--vault` flag or `BISMUTH_VAULT` env var.

### `relay/` — the session registry plugin

A collection of Claude Code hook scripts. It is **not** a daemon and installs nothing in `~/.claude`. It is loaded per-session, only inside Bismuth's terminal tabs, via a PATH shim (`relay/shim/claude`) that injects `--plugin-dir <relay>` when a bare `claude` is invoked.

> **Note**: the relay-fed "agents" graph mode was removed in commit `a6687c0` ("ephemeral tooling state, not knowledge"). `relay.ts`, its four ingest routes below, terminal provenance, and the chat agent-session plumbing all survive — only the graph mode, `agentLayout.ts`, `AgentsGraph.tsx`, and `GET /agent-graph` were deleted.

Hook wiring (declared in `relay/hooks/hooks.json`):

| Hook | Script | POST endpoint | Purpose |
|------|--------|---------------|---------|
| `SessionStart` | `bin/session-start-hook.ts` | `POST /relay/session` | Register terminal-tab session as root node |
| `UserPromptSubmit` | `bin/recall-hook.ts` | `POST /relay/session` | Heartbeat / self-register on resumed sessions |
| `SubagentStart` | `bin/subagent-start-hook.ts` | `POST /relay/subagent/start` | Add child node under spawning session |
| `SubagentStop` | `bin/subagent-stop-hook.ts` | `POST /relay/subagent/stop` | Mark child finished |

All hooks are **best-effort**: they exit 0 within a 2-second budget and swallow all errors so they never block the user's Claude session. The hooks no-op if `CLAUDE_TERMINAL_ID` is absent (i.e., outside Bismuth terminals). The relay registry lives entirely in-process inside core (`core/src/relay.ts`); it does not persist across server restarts. Nothing renders this registry as a graph any more — its two consumers are `chat.ts` (which imports `DONE_SUBAGENT_TTL_MS`/`RUNNING_SUBAGENT_MAX_MS` to mirror the same finished/abandoned-subagent lifetimes for its own agent-session view) and `terminal.ts` (which calls `relay.prune()` against the live pty set on tab close).

### `mcp/` — the docs + CLI MCP server

A stdio [MCP](https://modelcontextprotocol.io) server (`@bismuth/mcp`) that rides the **same auto-attach mechanism as relay**: the relay plugin's `relay/.mcp.json` declares it, so when a bare `claude` loads the plugin (`--plugin-dir <relay>`) Claude Code auto-starts the server — no flags, no approval prompts. It exposes the `docs/` reference, the repo's `skills/` guides, and the `bismuth` CLI to that session **token-frugally** (search returns snippets, not whole pages): `mcp/src/docs.ts` (pure index/search/read), `mcp/src/skills.ts` (pure skill index/read over `skills/`), `mcp/src/cli.ts` (CLI bridge), `mcp/src/server.ts` (low-level SDK server, 6 tools: `bismuth_docs_list`/`search`/`read`, `bismuth_skill`, `bismuth_cli`, `bismuth_cli_help`). Scope is app-local, like relay. See [MCP server](../mcp/overview.md).

### `skills/` — agent skill guides (not a workspace)

A plain top-level directory — no `package.json`, nothing to `bun install` — of markdown guides written in the Claude Code skill shape (a `SKILL.md` with YAML `name`/`description` frontmatter, plus optional `references/*.md`). The one skill shipped today, `skills/authoring-bismuth-bases/`, teaches an agent how to write a `type: base` note: a lookup table from "what you want to show" to one of the 12 view kinds, a read-the-matching-reference-first workflow, and cross-cutting gotchas (`source:` string-vs-object coercion and its silent-fallback footgun, `from:` composing an upstream base's own source recursively, and that the only embedded block is ` ```query `). `references/` holds one file per view kind: `bar.md`, `bullets.md`, `calendar.md`, `cards.md`, `flashcards.md`, `heatmap.md`, `kanban.md`, `line.md`, `list.md`, `map.md`, `stat.md`, `table.md`.

Only Claude Code has a native skills mechanism (`~/.claude/skills/`, auto-discovered); the other eight of Bismuth's nine agent backends do not. Three adapters make the same guide reachable from all of them: the `bismuth_skill` MCP tool above (`mcp/src/skills.ts`) — the one surface every MCP-speaking backend shares; a `~/.claude/skills/authoring-bismuth-bases` symlink into `~/.bismuth/skills/` written at install time (`core/src/bismuthInstall.ts`'s `stageSkills()` + `linkSkillToClaudeCode()`, never clobbering a foreign entry at that path), which is how Claude Code itself gets it; and, for Codex (which has no skills mechanism and instead reads a project-root `AGENTS.md` as its persistent-context channel), a one-line pointer to the `bismuth_skill` tool written into Codex's managed `AGENTS.md` block (`core/src/chatProviders/codex/driver.ts`'s `CODEX_AGENTS_MD_CONTENT`, via `core/src/agentBackends/agentsMd.ts`'s `writeAgentsMdBlock`, opt-in via `settings.codex.writeAgentsMd`). Full file-by-file breakdown: [Codebase map](../contributing/codebase-map.md).

### Storybook — the `app/` component catalog

`app/.storybook/` runs a separate dev server (Storybook 9 via `storybook-solidjs-vite`; `bun run storybook` from `app/`, port `6006`) that mounts individual `app/src/` components outside the full Tauri+Solid app shell. `preview.ts` does the two things that make a mounted component behave like it does in production instead of rendering blank or stuck loading: it projects the real theme tokens onto `:root` via `setCssVars(settingsToCssVars(DEFAULTS))` (the exact call `App.tsx` makes at runtime), and it installs an in-memory `Transport` (`app/src/api.ts`'s swappable seam — the same one mobile uses to run the app with no HTTP server) seeded from shared fixture data, so a component that fetches on mount reads back real content instead of parking on a spinner forever. The catalog holds 427 stories across 120 `*.stories.tsx` files — the `ui/` primitives, all 12 Bases view renderers, the calendar views, app-root chrome and modals, drawing, graph, editor surfaces, and `ChatView`. Shared fixtures live in `app/src/ui/_baseFixtures.tsx`, `_fakeTransport.ts`, `_calendarFixtures.ts`, `_graphFixtures.ts`, `_daemonFixtures.ts`, `_cmHarness.tsx`, and `_storyKit.tsx`. Full file breakdown: [Codebase map](../contributing/codebase-map.md).

---

## The Three-Brain Model

Bismuth treats knowledge as three layers, each producing a graph:

### 2nd Brain (vault)

The vault is a directory of markdown files. `core/src/vault.ts` builds the vault graph in two passes:

1. Create a `"note"` node for every `.md` file (id = vault-relative path minus `.md`, e.g. `reading/quotes/x`).
2. Re-read each note to extract wikilinks (`[[Another Note]]`), `#tags`, and YAML frontmatter; create `"link"`, `"tag"`, and frontmatter-derived edges.

Important details:
- Wikilink matching is **filename-based, not path-based**: `[[Another Note]]` matches any `Another Note.md` anywhere in the vault. Ambiguous matches are undefined.
- The top-level folder segment becomes the `folder` field on each node (e.g. `reading/quotes/x.md` → `folder="reading"`).
- The vault graph uses node kinds `"note"` and `"tag"`. The set `SECOND_BRAIN_KINDS = new Set(["note", "tag"])` in `graph.ts` is what the frontend mode filter applies.

The vault graph is exposed by `GET /graph`.

### 3rd Brain (memory)

The 3rd brain is the per-vault daemon's memory, living **inside the vault** at `<vault>/.daemon/memory`. It is **gated on `settings.daemon.enabled`**: the server computes `effectiveMemoryDir()` (`core/src/server.ts`) as `join(cfg.vault, ".daemon", "memory")` only when `appConfig.daemon?.enabled`, otherwise `undefined`. When the daemon is disabled there is **no 3rd brain** at all (and no error). The bundled app derives the same path Rust-side (`vault_memory_dir(vault)` → `<vault>/.daemon/memory` in `app/src-tauri/src/lib.rs`) and passes it as the sidecar's `--memory`; core then ignores it unless the daemon is enabled. There is **no** separate top-level memory directory.

When a `memoryDir` is in effect, `core/src/memory.ts` builds a graph of `"memory"` nodes with ids prefixed `mem:` (e.g. `mem:project-xyz`). The constant `THIRD_BRAIN_KINDS = new Set(["memory"])` is what the frontend mode filter applies.

---

## Graph Composition in `engine.ts`

`buildGraph(vaultDir, memoryDir?)` in `core/src/engine.ts` is the single composition entry point called by the server's graph cache:

```typescript
export async function buildGraph(vaultDir: string, memoryDir?: string): Promise<GraphData>
```

Steps:

1. `buildVaultGraph(vaultDir)` — returns `{ graph, byBase, byPath }`. `byBase` is a map from filename-without-extension (e.g. `"Another Note"`) to node id; `byPath` is a map from the full vault-relative path (e.g. `"reading/Another Note"`) to node id. Both are needed for wikilink resolution.
2. If no `memoryDir` (the daemon is disabled, so there's no 3rd brain), stamp Louvain communities onto the vault graph and return.
3. If `memoryDir` is provided, `buildMemoryGraph(memoryDir)` returns `{ nodes, edges, links }` where `links` is a map from memory node base name to the wikilink targets it references.
4. **"About" edges** are created for each memory→vault cross-reference: for each entry in `memory.links`, `resolveLinkTarget(target, vaultByBase, vaultByPath)` is called — it tries path-qualified resolution first (`vaultByPath`), then falls back to basename resolution (`vaultByBase`). A successful resolution produces an `{ from: "mem:<base>", to: <vaultNodeId>, kind: "about" }` edge.
5. `mergeGraphs([vault, { nodes: memory.nodes, edges: [...memory.edges, ...about] }])` deduplicates nodes by id (first-seen wins) and concatenates edges.
6. `stampCommunities(merged)` calls `detectCommunityHierarchy()` (`core/src/community.ts`) — deterministic, non-random **hierarchical** Louvain community detection using only edges whose both endpoints are present — and stamps four fields onto each node: `community` (the finest level's numeric id) and `communityLabel` (that level's exemplar label), which mirror the pre-hierarchy flat contract every existing consumer reads, plus `communityPath` (community id per level, COARSEST → FINEST) and `communityPathLabels` (the matching exemplar label per level).

**How many levels a vault gets** — `communityLevelsFor(nodeCount)`:

| Node count | Levels |
|---|---|
| < 360 | 1 |
| < 1620 | 2 |
| < 7290 | 3 |
| ≥ 7290 | 4 |

So a small vault gets one flat level exactly as before, and a large one gets clusters nested up to 4 deep. Levels are built bottom-up and strictly nested — two nodes sharing a finest community always share every coarser one.

**How each level picks its exemplar name** — `pickExemplar()`:
- Members within `EXEMPLAR_DEGREE_FRAC` (0.5) of the community's top degree form a pool, capped at `EXEMPLAR_POOL` (8).
- A `kind: "tag"` member in that pool wins outright over notes.
- Among the survivors, the shortest label that still fits `EXEMPLAR_FIT_CHARS` (20 characters) is picked — the field is a monospace ASCII grid with no room for a full note-title sentence as a cluster name.

The result is a `GraphData`:

```typescript
interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  views?: { second?: ViewLayout; third?: ViewLayout }; // populated lazily via GET /graph/views
}
```

Layout positions (`position3d`, `position2d`) are attached by `attachLayout()` in `core/src/layout-cache.ts` before the graph is stored in the server's `graphCache`. The frontend receives nodes already stamped with positions and morphs between them in `app/src/graph/AsciiGraphRenderer.ts` — a Canvas2D (not WebGL/Three.js) renderer that draws the graph as a monospace character field (glyphs for nodes, real vector strokes for edges) — it does not run any force simulation for "2nd"/"3rd"/"both"/"daemon" mode. ("local" mode is the one exception — see Graph Modes below.)

Over the renderer's canvas sits a shared **`GraphAtmosphere`** overlay (`app/src/graph/GraphAtmosphere.tsx`): the iridescent cluster-glow lobes (driven by the renderer's per-frame `setBloomCallback`, which projects the biggest clusters to screen space as a density field) plus a depth vignette. It is rendered as a sibling after the canvas by both `GraphView` and the first-run intro graph, so the two share one source instead of duplicating the glow-wiring.

---

## Graph Types (`core/src/graph.ts`)

### Node kinds

| Kind | Brain | Source | Description |
|------|-------|--------|-------------|
| `"note"` | 2nd | `vault.ts` | A vault markdown file |
| `"tag"` | 2nd | `vault.ts` | A `#tag` extracted from notes |
| `"memory"` | 3rd | `memory.ts` | A daemon memory note (from `<vault>/.daemon/memory`) |
| `"self"` | — | Vestigial | Not produced by any graph mode — no mode has carried a self/"you" hub since `a6687c0` removed "agents" mode (a prior `withYouNode()` helper injected one into "2nd"/"3rd"/"both" too; also removed, as visual noise). The type and `SELF_NODE_ID = "::you"` still exist, and `AsciiGraphRenderer.ts` still special-cases `kind: "self"` with an `"@"` glyph, only because the first-run Vault Intro's synthetic demo graph (`app/src/intro/vaultIntroGraph.ts`) decorates its point cloud with one — no real vault/memory/daemon data ever produces this kind |
| `"agent"` | — | Vestigial | Declared in `NodeKind` but nothing builds one any more: the graph builder and `GET /agent-graph` were deleted in `a6687c0` along with the "agents" graph mode. `core/src/agents.ts` itself still exists, reduced to the `ChatAgentSession`/`ChatAgentSubagent` types that `chat.ts` uses for per-chat subagent tracking |
| `"daemon"` | daemon | `daemonGraph.ts` | The daemon hub node (id `"::daemon"`, label defaults to `"daemon"`) |
| `"cron"` | daemon | `daemonGraph.ts` | A daemon-supervised cron job |
| `"process"` | daemon | `daemonGraph.ts` | A daemon-supervised process |

### Edge kinds

| Kind | Direction | Description |
|------|-----------|-------------|
| `"link"` | note → note | Wikilink `[[Target]]` |
| `"tag"` | note → tag | Note has this tag |
| `"message"` | memory → memory | Memory-internal links |
| `"about"` | memory → note | Cross-brain link: memory references vault note |
| `"open"` | self → note | Vestigial: unused since no mode carries a self node any more (see `"self"` above) |
| `"supervises"` | daemon → cron/process | Daemon hub to its supervised jobs |

### `GraphNode` fields

```typescript
interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  state?: "idle" | "awake";
  folder?: string;                 // top-level folder segment, e.g. "reading"
  parent?: string;                 // agent nodes only — vestigial, see Node kinds above
  position?: [x, y, z];           // 3D precomputed layout (attached by layout-cache.ts)
  position2d?: [x, y];            // 2D precomputed layout
  community?: number;              // Louvain community id, finest hierarchy level
  communityLabel?: string;         // finest level's exemplar label
  communityPath?: number[];        // community id per level, COARSEST → FINEST (length 1-4); last element === community
  communityPathLabels?: string[];  // exemplar label per level, same length as communityPath; last element === communityLabel
  daemon?: DaemonVizState;         // cron/process nodes only: enabled/running viz state
}
```

### `DaemonVizState` fields

```typescript
interface DaemonVizState {
  enabled: boolean;
  running: boolean;
  lastResult: string | null;  // "success" | "failed" | "unknown" | null (never ran)
  lastFiredMs: number | null; // epoch ms of last run, or null
  schedule?: string;          // cron expression (cron nodes only)
}
```

---

## Graph Modes

`GraphMode` (`app/src/commands.ts`) is exactly:

```typescript
export type GraphMode = "2nd" | "3rd" | "both" | "daemon" | "local";
```

The frontend switches between these five graph modes. Each mode determines which node/edge kinds to render and which backend endpoint (if any) to query. Node/edge selection per mode is pure: `app/src/graph/displayGraph.ts`'s `selectDisplayGraph()` picks and shapes the graph — and **never adds a "you"/self node** (see `"self"` in [Node kinds](#node-kinds) above for why):

| Mode | Backend source | Node kinds included |
|------|---------------|---------------------|
| `"2nd"` | `GET /graph`, filtered client-side via `subgraphByKinds()` | `note`, `tag` |
| `"3rd"` | `GET /graph`, filtered client-side via `subgraphByKinds()` | `memory` |
| `"both"` | `GET /graph` (full) | All of 2nd + 3rd |
| `"daemon"` | `GET /daemon/graph` | `daemon`, `cron`, `process` (hub built by `daemonGraph.ts` from `<vault>/.daemon`; liveness read machine-level) |
| `"local"` | No dedicated endpoint — client-side only, over the already-fetched "both" graph | The open note's neighbourhood: the note itself plus every node within 1 hop in **either** direction (outbound links and backlinks alike), restricted to `note`/`tag` kinds, via `core/src/graph.ts`'s `localSubgraph()` |

For `"2nd"` and `"3rd"` modes the frontend requests `GET /graph/views` on first mode switch to obtain per-brain precomputed layouts (`ViewLayout`). These are computed lazily by `computeViewLayouts()` and cached on the live `GraphData` object in memory. Subsequent `GET /graph` calls return the cached graph with `.views` populated.

`"local"` mode is the one exception to "layouts come from the backend, not the browser": the whole-vault positions on `localSubgraph()`'s output are meaningless at neighbourhood scale (a dozen notes scattered across a world sized for thousands), so `GraphView.tsx` re-lays the subgraph out itself with core's pure, synchronous `computeLayout()` (`LOCAL_REFINE_TICKS = 120`, 3D first then 2D seeded from it) — no backend round-trip, no cache, settling in a few ms. `localSubgraph()` also strips `community`/`communityPath`/`communityPathLabels` from its output (colouring a dozen notes by the whole vault's cluster structure said nothing at that scale), but `app/src/graph/localLayoutInput.ts`'s `localLayoutInput()` looks those fields back up from the full, un-stripped graph (`GraphView`'s `communitySource` prop) and feeds them to `computeLayout()` anyway — so a neighbour sharing the focused note's community still settles closer, without the renderer ever drawing the fields.

The 2D/3D toggle is a transient `localStorage` value, not a `.settings` key — it persists across sessions but does not appear in the settings file.

---

## Data Flow: Vault Change → Frontend Update

```
Vault .md file written
  → node:fs.watch fires (core/src/server.ts)
  → scheduleVault(filename)
  → debounce timer (250ms, configurable via server.fileWatchDebounceMs)
  → classifyVault(paths): re-fingerprints changed notes via changeClassifier.ts
      - content-only edit (no link/tag/icon change) → dirty={graph:false, tree:false}
      - structural change → dirty={graph:true} or dirty={tree:true} or both
      - `.settings` change → dirty={graph:true, tree:true}
  → applyDirty(paths, dirty):
      - graphCache.invalidate() if dirty.graph
      - treeCache.invalidate() if dirty.tree
      - cachedRows = null, cachedTasks = null (always)
      - version++
      - sse.publish({version, paths, dirty})

Frontend (app/src/serverVersion.ts):
  - Persistent EventSource on GET /events
  - On event: if dirty.graph → re-fetch GET /graph; if only file changed → re-fetch GET /file
  - Fallback: low-frequency GET /version poll (1s when disconnected, 5s when connected)
    recovers silently-dropped SSE (proxy/OS-sleep)
```

**Key invariant**: The graph is rebuilt lazily on the first `GET /graph` request after `graphCache.invalidate()`. The server never rebuilds speculatively. Node positions are precomputed in `layout.ts` (pivot-MDS + force simulation) during this rebuild and attached to nodes before caching — the frontend only morphs.

---

## HTTP API Summary

All routes are served by `core/src/server.ts`. Mutating routes go through `mutatingHandler`, which auto-invalidates caches and broadcasts SSE after the handler returns.

### Read routes (GET / read-only POST)

| Route | Description |
|-------|-------------|
| `GET /version` | Current version counter `{version}` |
| `GET /events` | SSE stream; pushes `{version, paths, dirty:{graph,tree}}` |
| `GET /graph` | Full merged knowledge graph (nodes + edges + precomputed positions) |
| `GET /graph/views` | Per-brain view layouts for 2nd/3rd mode; computed lazily, cached |
| `GET /tree` | Vault file tree as `TreeEntry[]` (with folder icons overlaid) |
| `GET /file?path=` | Raw markdown content of a vault file |
| `PUT /file` | Write vault file (also invalidates caches) |
| `GET /asset?path=` | Serve vault media file as binary (filename-first resolution) |
| `POST /asset?path=` | Upload attachment (≤100 MB); returns actual path after de-collision |
| `GET /vault-data` | All vault rows (frontmatter + metadata) as `Row[]` |
| `GET /base?file=` | Parse and return a base file's config |
| `POST /rows {spec}` | Resolve a `SourceSpec` → `Row[]` (base composition, scoped tasks) |
| `GET /meta?path=` | Parsed frontmatter of a single file |
| `GET /config` | Runtime config: `{vault, memory}` |
| `GET /settings` | Parsed app settings (`.settings` merged over defaults) |
| `GET /schema` | Property registry from `.settings` |
| `GET /templates` | List template files |
| `GET /tasks` | All vault tasks |
| `GET /cards/decks` | SRS deck list |
| `GET /cards/all` | All flashcards |
| `GET /cards/note?path=` | Cards for a specific note |
| `GET /cards/due?deck=` | Due cards (optional deck filter) |
| `GET /daemon/status` | Daemon status (machine-level, from `daemonMachineDir()`) |
| `GET /daemon/devices` | Known devices list |
| `GET /daemon/graph` | Daemon supervision graph (daemon mode), from this vault's `.daemon` dir |
| `GET /daemon/install` | Daemon install probe (`installStatus()`) |
| `POST /daemon/setup` | Idempotent, adopt-only daemon setup (`runSetup()`) |
| `POST /daemon/update` | Re-run the adopt-only install (the daemon updates WITH the app; no git pull) |
| `POST /daemon/cron/toggle {name, enabled}` | Enable/disable a cron |
| `POST /daemon/cron/run {name}` | Trigger a cron immediately |
| `POST /daemon/process/toggle {name, enabled}` | Enable/disable a process |
| `POST /relay/session` | Register a terminal-tab session |
| `POST /relay/session/end` | End a terminal-tab session |
| `POST /relay/subagent/start` | Register a subagent |
| `POST /relay/subagent/stop` | Mark a subagent finished |
| `POST /backup` | Git snapshot of vault |
| `POST /open-folder {folder}` | Spawn a sibling server for a different vault; returns `{url}` |
| `POST /search {query, opts}` | Full-text search |
| `GET /terminal` | Upgrade to WebSocket for PTY session |

### Mutating routes (POST — cache-invalidate + SSE broadcast)

| Route | Description |
|-------|-------------|
| `POST /move {from, to}` | Move/rename a file or folder |
| `POST /delete {path}` | Move to .trash |
| `POST /restore {trashPath, to}` | Restore from .trash |
| `POST /create {path, kind}` | Create file or directory |
| `POST /replace {query, replacement, opts, scope}` | Find-and-replace in vault |
| `POST /set-property {path, key, value}` | Set a single frontmatter key |
| `POST /delete-property {path, key}` | Remove a frontmatter key |
| `POST /set-setting {path[], value}` | Merge one `.settings` key in place |
| `POST /folder-icon` | Set/clear a folder icon |
| `POST /daily-note` | Create or open today's daily note |
| `POST /tasks/toggle` | Toggle a checkbox task in-place |
| `POST /cards/review` | Apply SRS review (markdown cards or row cards) |
| `POST /row/update {file, index, note}` | Create (`index:null`) or update a base row |
| `POST /row/delete {file, index}` | Delete a base row |
| `POST /row/reorder {file, from, to}` | Reorder a base row |
| `POST /daemon/owner` | Set daemon owner device (vault mutation) |

---

## Settings Architecture

`.settings` (`SETTINGS_FILE` in `core/src/settings.ts`) is a single hidden, extensionless YAML file at the vault root. It is the single source of truth for all user-configurable behavior. The backend is the **only writer** — the frontend never writes the file directly, it always calls `POST /set-setting`. A one-time `migrateSettingsLocation()` relocates two legacy layouts into it on first open: a vault-root `settings.yaml`, and an interim `.settings/settings.yaml` folder from an earlier build; both are idempotent, best-effort, and preserve the user's values via filesystem rename (falling back to copy).

- **Schema**: `core/src/schema/settingsSchema.ts` — defines all keys with type, default, min/max or enum, and doc string.
- **Reconciliation**: On server boot (and on every `GET /file?path=.settings`), `reconcileSettings()` adds any missing keys to the file without clobbering existing values or comments.
- **Frontend hydration**: `GET /settings` returns the parsed file merged over defaults. `app/src/settings.ts` stores these as a reactive Solid signal.
- **CSS variables**: `app/src/settingsCssVars.ts` projects appearance/ui settings into `:root` CSS custom properties; component stylesheets use `var(--name, fallback)`.
- **Schema-aware editor**: Opening `.settings` in the editor activates `editor/settingsComplete.ts` (autocomplete showing doc + valid range) and `editor/yamlSchema.ts` (lint).

---

## Caching Strategy

| Cache | Invalidated by | Notes |
|-------|---------------|-------|
| `graphCache` (async dedup) | `dirty.graph` file-watch events, all mutations | First read after invalidation rebuilds graph + layout |
| `treeCache` (async dedup) | `dirty.tree` file-watch events, structural mutations | |
| `cachedRows` | Any vault file change | Rebuilt lazily on next `GET /vault-data` or `POST /rows` |
| `cachedTasks` | Any vault file change | Rebuilt lazily on next task query |
| `graph.views` | When `graphCache` is invalidated | In-place mutation of live cached object; computed lazily on `GET /graph/views` |
| Search index | Any vault file change | `invalidateSearchIndex()` called in `applyDirty` |
| Client SWR row cache | SSE version bump | `app/src/bases/rowCache.ts` keyed by SSE version |
| Layout positions (localStorage) | — | Frontend caches precomputed positions in localStorage for instant paint on reload |

The `asyncCache` abstraction (`core/src/asyncCache.ts`) ensures concurrent first requests share one build and a mid-build file change doesn't repopulate a stale value.

---

## Related Documentation

- [Core graph types](../graph/overview.md)
- [Bases query system](../bases/overview.md)
- [Terminal / relay session registry](../terminal/overview.md)
- [Daemon integration](../daemon/overview.md)
- [Settings schema](../settings/reference.md)
- [HTTP API reference](../api/http-reference.md)

Source: `CLAUDE.md`, `package.json`, `core/src/engine.ts`, `core/src/server.ts`, `core/src/settings.ts`, `core/src/daemon.ts`, `core/src/daemonGraph.ts`, `core/src/graph.ts`, `core/src/community.ts`, `core/src/relay.ts`, `core/src/chat.ts`, `core/src/terminal.ts`, `relay/package.json`, `relay/hooks/hooks.json`, `relay/lib/report.ts`, `core/package.json`, `cli/package.json`, `cli/src/commands/graph.ts`, `cli/src/commands/api.ts`, `app/src/index.tsx`, `app/src/intro/VaultIntro.tsx`, `app/src/intro/vaultIntroGraph.ts`, `app/src/commands.ts`, `app/src/graph/displayGraph.ts`, `app/src/graph/localLayoutInput.ts`, `app/src/GraphView.tsx`, `app/src/graph/AsciiGraphRenderer.ts`, `app/src/graph/GraphAtmosphere.tsx`, `app/src-tauri/src/lib.rs`, `mcp/src/server.ts`, `mcp/src/skills.ts`, `skills/authoring-bismuth-bases/SKILL.md`, `core/src/bismuthInstall.ts`, `core/src/agentBackends/agentsMd.ts`, `core/src/chatProviders/codex/driver.ts`, `core/src/settings.ts`, `app/.storybook/main.ts`, `app/.storybook/preview.ts`, `app/src/ui/_baseFixtures.tsx`, `app/src/ui/_fakeTransport.ts`, `app/package.json`
