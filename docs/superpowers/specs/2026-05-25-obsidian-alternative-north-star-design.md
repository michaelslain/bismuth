# Obsidian Alternative — North Star Design

**Date:** 2026-05-25
**Status:** Approved design, pre-implementation

## North Star (the destination)

One desktop app you double-click. It opens to your whole second brain as a single
**living graph** — your notes, your Claude agents' memories, and the agents talking to
each other in real time — all in one window you can read, edit, and watch.

- **One icon.** Launching the app quietly brings its backends up; you never juggle services.
- **A markdown vault editor** — live preview, `[[wikilinks]]`, backlinks. (The Obsidian part.)
- **One graph, two feeds:**
  - **Notes** — dots = notes, lines = links. Static; your knowledge.
  - **Agents** — dots = Claude instances, lines = live messages. Moving; pulses on wake,
    glows red when a runaway conversation is killed.
- The graph later becomes a **3D sphere/storm**.

It feels like **one app**. Under the hood it is **composed**: this app is the *face*; the
existing `claude-bot` and `claude-communicate` repos are *backends* it talks to over the
vault filesystem and local HTTP. The app **supervises** those services so it still ships and
launches as a single thing.

## Why composed (not a monolith)

- `claude-communicate` is already building a `/graph` endpoint (agents as nodes, messages as
  edges, dead threads in red) — the *same shape* as Obsidian's graph view. This app renders
  it rather than recomputing it.
- `claude-bot` already writes zettelkasten markdown (frontmatter + `[[backlinks]]`) — the exact
  format this app reads. Pointing the vault at that folder surfaces agent memories for free.
- Those backends exist and are actively improved by sibling agents. Composition keeps them
  independently buildable; we request changes via the relay rather than absorbing/freezing them.
- "Render the vault + render `/graph` + edit markdown + supervise services" is **bounded**.
  "Reimplement three systems into one binary" is not.

## Architecture & principles

- **Stack:** Tauri 2 (Rust shell) + SolidJS + TypeScript + Vite. CodeMirror 6 for the editor.
- **Filesystem in Rust:** Tauri commands own vault I/O (`list_vault`, `read_file`, `write_file`,
  `watch_vault`). The JS side never touches disk directly.
- **Pure-logic index in JS:** parsing frontmatter + `[[wikilinks]]` and building the graph model
  is framework-free, dependency-light, and unit-tested.
- **Focused UI components (Solid):** file tree, tabbed editor, backlinks panel, graph panel —
  each one job, understandable in isolation.
- **Small, well-bounded modules** so each can be reasoned about and changed without breaking
  consumers.

### The two seams that make later stones cheap

These interfaces are defined in Stone 1 even though only one implementation exists at first.

1. **Graph data is source-agnostic.**
   ```ts
   type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };
   interface GraphSource {
     load(): Promise<GraphData>;
     subscribe(onChange: (g: GraphData) => void): () => void; // live updates
   }
   ```
   - `VaultSource` (Stone 1) builds `GraphData` from notes + links.
   - `AgentGraphSource` (Stone 2) builds it from `claude-communicate`'s `/graph`.
   - Same renderer consumes either, or a merged view.

2. **The renderer is an interface.**
   ```ts
   interface GraphRenderer {
     mount(el: HTMLElement): void;
     render(g: GraphData): void;
     destroy(): void;
   }
   ```
   - `Canvas2DRenderer` (Stone 1) — force-directed 2D (d3-force layout + canvas draw).
   - `WebGLRenderer` (Stone 5) — three.js sphere/storm.

Node shape carries enough to style both feeds: `{ id, label, kind: 'note'|'memory'|'agent',
state?: 'idle'|'awake'|'dead', ... }`.

---

## The stones (build in this order)

### Stone 1 — Vault app foundation `[self-contained, build first]`

A real Obsidian-class vault app whose graph already includes your agents' memories.

**Scope**
- Tauri 2 + SolidJS + TS shell; pick/open a vault folder (persists last vault).
- File tree + editor tabs; layout C (file tree left · editor center · graph-above-backlinks right).
- CodeMirror 6 **live preview**: inline-rendered markdown, syntax hides off the active line,
  `[[wikilinks]]` render as clickable links that open/create the target note.
- Frontmatter aware: parse YAML `status` / `priority` / `tags`; surface them (badge/header).
- Backlinks panel for the active note.
- **Living graph** (Canvas2DRenderer fed by VaultSource): notes + memories as a force graph;
  click a node to open the note; highlight neighbors of the active note.
- `watch_vault` → re-index on external file changes (so agent writes show up live).

**Done when:** open a folder of markdown (including `claude-bot` memories), edit notes with
live preview, follow/create wikilinks, see backlinks, and see the whole vault as an interactive
2D graph that updates when files change on disk.

**Dependencies:** none outside this repo.

### Stone 2 — Live agent graph `[needs /graph contract]`

The agents appear and move on the same graph.

**Scope**
- Agree the `/graph` payload + transport with `claude-communicate` (via the relay): node/edge
  schema, live channel (SSE/WebSocket preferred, polling fallback), agent `state` + dead-thread flag.
- `AgentGraphSource` consumes `/graph`; agents render as nodes, messages as edges.
- Live behavior: pulse on wake, edges animate as messages fly, threads glow red when killed.
- View control: toggle/overlay note-graph vs agent-graph (and a combined view).

**Done when:** with the relay running, agents and their live conversations appear on the graph
in real time alongside notes.

**Dependencies:** `claude-communicate` `/graph` endpoint (in progress) — coordinate contract now.

### Stone 3 — Backend supervision (the "one app" feel) `[self-contained]`

**Scope**
- On launch, the app starts and monitors `claude-communicate` (relay) and `claude-bot` (daemon)
  as managed child processes; status indicator; graceful shutdown with the app.
- Config for backend paths/commands; "not installed / not running" handled gracefully (the app
  still works as a pure vault editor without them).

**Done when:** double-clicking the app brings the backends up; closing it shuts them down; status
is visible.

**Dependencies:** knowledge of how each repo is launched (confirm via relay).

### Stone 4 — Agent interaction from the app `[needs messaging contract]`

**Scope**
- Messages panel: read agent messages/threads (from relay or files) and display them.
- Send a message / trigger an action by calling existing `claude-communicate` / `claude-bot`
  interfaces (HTTP or shelling out to their CLIs) — no reimplementation.
- Light `claude-bot` controls (e.g., trigger a remember, view scheduled crons).

**Done when:** you can read and send agent messages and fire basic bot actions without leaving
the app.

**Dependencies:** `claude-communicate` send/message interface; `claude-bot` CLI/MCP surface —
confirm via relay.

### Stone 5 — 3D graph (sphere / storm) `[self-contained]`

**Scope**
- `WebGLRenderer` (three.js) implementing `GraphRenderer`; 3D force layout; sphere/storm
  aesthetic; toggle 2D ↔ 3D. Both feeds (notes + agents) render in 3D.

**Done when:** the living graph can be viewed as an interactive 3D sphere/storm with no change
to the data layer.

**Dependencies:** none (relies only on the Stone 1 renderer interface).

---

## Testing

- **Unit tests (TDD):** the index/parser — frontmatter parsing, `[[wikilink]]` extraction
  (including aliases/headings), and graph construction from notes/edges. Pure logic, high value.
- **Component smoke tests:** editor mounts and round-trips a file; renderer mounts and draws a
  small graph.
- **Manual run** for visual/interaction work (live preview feel, graph behavior, 3D).

## Out of scope (for the whole project, for now)

- Reimplementing any `claude-bot` / `claude-communicate` internals inside the app.
- Full chat-history mirroring across machines (the sibling agent deferred this too).
- Mobile / web builds — desktop (Tauri) only.
- Plugin system / themes marketplace.

## Open questions (resolve via relay coordination, not blocking Stone 1)

- `/graph` payload schema + live transport (Stone 2).
- Message read/send interface and where messages are persisted (Stone 4).
- Exact launch commands + health checks for each backend (Stone 3).
