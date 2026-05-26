# Obsidian Alternative — North Star Design

**Date:** 2026-05-25
**Status:** Approved design, pre-implementation

## Central thesis: everything is a graph

The app is **a universal graph renderer**. Every brain and every structure in the system is a
*graph* (nodes + edges), and the app's job is to render them — in one visual language, in one
window, eventually in 3D.

- Your vault is a graph (notes + links).
- The agent's memory is a graph (memories + links).
- The agent network is a graph (agents + messages + governance topology).

So the architecture's spine is a **graph engine fed by interchangeable graph sources**. The
markdown editor is *one tool for one of the graphs* (the vault). Everything else is "point another
source at the same renderer." This is what makes the project both **bounded** (one rendering core)
and **endlessly extensible** (add a source).

## North Star (the destination)

One app you double-click. It opens to your whole world as a **living graph** — the three brains
plus the live agent network — all rendered together, navigable, editable where it makes sense.

- **One icon, one project, everything inside** (a monolith) — but internally layered (below) so the
  logic runs headless on a Raspberry Pi via CLI, and as a rich GUI on your machine.
- The **graph is the home surface**; the **markdown editor** (live preview, `[[wikilinks]]`,
  backlinks) is how you work inside the vault graph.
- The graph later becomes a **3D sphere/storm**.

## The three brains (+ the live network)

The conceptual foundation. Three brains, each a graph; plus a fourth, live graph for activity.

| # | Brain | What it is | In the app |
|---|-------|-----------|------------|
| 1 | **You** | Your actual mind — the source of intent. Not stored. | A single `self` node the others relate to. |
| 2 | **Your vault** | The markdown notes you write — your externalized second brain. | A graph source (notes + links) + the editor. |
| 3 | **Claude-bot's memory** | What the agent remembers *about you and your vault* — its model of brains 1 & 2. (~160 notes.) | A graph source read from claude-bot's own memory store. |

- **Brain 3 is a brain *about* brains 1 and 2.** Its edges point *at* vault notes and facts about
  you — so "the agent's understanding mapped onto your knowledge" is itself a visible cross-brain
  layer.
- Brain 3 reads **claude-bot's** memory store specifically — never Claude Code's built-in memory.
- **The live agent network** (claude-communicate) is a *fourth* graph, but it represents **activity**
  (agents talking now), not stored knowledge. Same renderer, different source, dynamic.

Node kinds in the unified model: `self` · `note` (vault) · `memory` (bot) · `agent` (live).
Edges are within-brain (links/messages) or **cross-brain** (a memory about a note; a note about you).

## Architecture: one project, one core, two faces

A monolith — one repo, everything inside — layered so the logic is separable from the UI.

```
                 ONE PROJECT (one repo)
   ┌─────────────────────────────────────────────┐
   │  CORE ENGINE (headless, no UI)               │
   │  graph engine + sources · vault I/O ·        │
   │  relay/messaging · guardrails · governance · │
   │  bot memory · cron/dream                     │
   └───────────────▲──────────────────▲───────────┘
                   │                  │
          ┌────────┴───────┐   ┌──────┴────────────┐
          │  CLI           │   │  Desktop GUI       │
          │  headless      │   │  (Tauri + SolidJS) │
          │  runs on a Pi  │   │  graph + editor    │
          └────────────────┘   └────────────────────┘
```

- **Core engine** — all logic, no UI. Owns the graph engine and every graph source, vault
  filesystem I/O, **automatic local-git vault backup**, the relay/agent-messaging, guardrails,
  governance, bot memory, cron/dream.
- **CLI** — drives the core from the terminal, headless. *This is the Pi target:* a Pi node runs
  the CLI only (an agent / relay node / bot daemon, no screen).
- **Desktop GUI** — Tauri + SolidJS. The visual face: graph + editor + panels. Calls the same core.
- **Same brain, two bodies.** Pi = CLI; your machine = GUI.

**Language:** strong lean toward a **Rust core** (Tauri is already Rust; cross-compiles to a Pi
trivially, no runtime). The existing `claude-bot` / `claude-communicate` code gets **absorbed into
the core**; whether each subsystem is ported or reimplemented is decided per-stone when we reach it
(Stone 1 needs none of it). The old repos retire once absorbed.

## Core abstractions (the spine — built in Stone 1)

```ts
type NodeKind = 'self' | 'note' | 'memory' | 'agent';
type GraphNode = { id: string; label: string; kind: NodeKind;
                   state?: 'idle' | 'awake' | 'dead'; meta?: Record<string, unknown> };
type GraphEdge = { from: string; to: string; kind: 'link' | 'message' | 'about' };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

interface GraphSource {                 // the primary extension point — one per brain/structure
  load(): Promise<GraphData>;
  subscribe(onChange: (g: GraphData) => void): () => void;   // live updates
}

interface GraphRenderer {               // swappable view
  mount(el: HTMLElement): void;
  render(g: GraphData): void;
  destroy(): void;
}
```

- **Sources:** `VaultSource` (brain 2), `BotMemorySource` (brain 3), `AgentNetworkSource`
  (claude-communicate). Each emits `GraphData`; the app can show one, overlay, or merge them, with
  cross-brain edges between sources.
- **Renderers:** `Canvas2DRenderer` (now) → `WebGLRenderer` (three.js sphere/storm, later). Same
  data, no rewrite.

## The communicate subsystem (lives in the core)

Folded into the monolith core; surfaced by the GUI and driveable by the CLI.

- **Autonomous agent-to-agent communication** — agents message each other on their own; a message
  can **wake a sleeping agent**. (Sessions auto-register; no manual `/register`.)
- **Agent-network graph** — agents = nodes, messages = edges, exchange = thread. This is the
  `AgentNetworkSource`.
- **Spiral guardrails** — depth cap (~3 hops), per-conversation budget (~6 exchanges), per-agent
  rate limit (~5 wakes / 10 min). Runaway conversations are marked **dead** (rendered **red**).
- **Haiku for woken agents** — auto-woken instances run on Claude Haiku; hands-on human sessions
  stay on Opus. Keeps autonomous chatter cheap.
- **Governance structures** — the agent collective runs under a selectable model that sets authority
  and decision/message routing, and **shapes the graph topology**:
  - **Dictatorship** — one agent holds authority; centralized star.
  - **Democratic republic** — elected representatives vote under constitutional limits.
    *Representative, not direct democracy.*
  - **Central committee / politburo** — one-party committee decides; decentralized execution.
- **Deferred:** full chat-history mirroring across machines — too heavy for now.

## Vault backup (automatic local git)

The vault backs itself up automatically using **local git — no remote, never GitHub, never push.**
Pure on-disk version history for safety and time-travel.

- The vault folder is a git repo (the core runs `git init` if it isn't one yet). This is the
  **vault's** repo — entirely separate from the app's own source repo.
- **Auto-commit** on a debounce after edits settle (e.g. ~a few seconds after the last change) plus
  a periodic snapshot and a commit on app close. Never commits on every keystroke.
- Commit messages are timestamped snapshots (e.g. `vault snapshot 2026-05-25 19:40` + changed files).
- **Strictly local:** the core never adds a remote and never pushes. If the user's vault already has
  a remote, the backup still only commits locally and leaves pushing to the user.
- Lives in the core, so it works headless — the **CLI/Pi** node backs up its vault the same way.
- Sets up the future "version history / time-travel" view in the GUI for free (later stone/feature).

---

## The stones (build in this order)

### Stone 1 — Graph engine + the two static brains + editor `[self-contained, build first]`

The spine, plus everything that's just local markdown.

**Scope**
- Project skeleton: monolith repo with a **core** (graph engine + abstractions above), a **CLI** entry,
  and a **Tauri + SolidJS GUI** — all sharing the core.
- `GraphData` / `GraphSource` / `GraphRenderer` + `Canvas2DRenderer`.
- `VaultSource` (brain 2) and `BotMemorySource` (brain 3) — both read local markdown graphs
  (frontmatter + `[[wikilinks]]`). `self` node for brain 1. Cross-brain `about` edges where bot
  memories reference vault notes.
- GUI: layout C (file tree · editor · graph-above-backlinks). CodeMirror 6 **live preview**
  (inline-rendered markdown, clickable wikilinks). Backlinks panel. Task frontmatter
  (`status`/`priority`/`tags`) surfaced.
- File-watch → re-index so external writes (incl. agent writes) show up live.
- **Automatic local-git vault backup** (init if needed, debounced auto-commit, commit on close;
  local only, never pushes) — see "Vault backup" above.

**Done when:** open the app on your vault + claude-bot memory, edit notes with live preview, and see
all three brains as one interactive 2D graph (three colors + cross-brain links) that updates on disk
changes. Edits get auto-committed to the vault's local git history. The CLI can dump/query the same
graph headlessly.

**Dependencies:** none.

### Stone 2 — The live network brain (agents + governance) `[in-core]`

**Scope**
- `AgentNetworkSource`: agents as nodes, live messages as edges, into the same renderer.
- Live behavior: pulse on wake, edges animate, dead threads render **red** (guardrails).
- **Governance visualization:** active model shapes topology (dictator star / representatives
  highlighted / committee subgraph); role + authority legible at a glance.
- View control: show one brain, overlay, or merge.

**Done when:** with the relay running, the agent network and its live conversations appear on the
graph alongside the brains, dead threads show red, and the governance structure is visible.

**Dependencies:** the communicate subsystem in the core (port/reimplement decided here).

### Stone 3 — One-app supervision / Pi parity `[in-core]`

**Scope**
- GUI launch brings the core's services (relay, bot daemon/cron) up and monitors them; status
  indicator; graceful shutdown. The CLI runs the same services headless on a Pi.
- Config for paths/commands; degrades gracefully (pure vault editor if services are off).

**Done when:** double-clicking the app brings everything up; the CLI runs the same on a Pi with no screen.

### Stone 4 — Interaction (messages, governance, bot controls) `[in-core]`

**Scope**
- Messages panel: read agent messages/threads; send a message from the app.
- **Governance control:** view and switch the active model (dictatorship / democratic republic /
  central committee).
- Light bot controls (trigger a remember, view crons).

**Done when:** you can read/send agent messages, switch governance, and fire basic bot actions
without leaving the app — all also available via CLI.

### Stone 5 — 3D graph (sphere / storm) `[self-contained]`

**Scope**
- `WebGLRenderer` (three.js) implementing `GraphRenderer`; 3D force layout; sphere/storm aesthetic;
  toggle 2D ↔ 3D. All sources render in 3D with no data-layer change.

**Done when:** the living graph can be viewed as an interactive 3D sphere/storm.

---

## Testing

- **Unit tests (TDD):** the graph layer — markdown/frontmatter/`[[wikilink]]` parsing, building
  `GraphData` per source, cross-brain edge resolution. Pure logic, high value.
- **Component smoke tests:** editor mounts and round-trips a file; renderer mounts and draws a small
  graph; CLI dumps a graph from a fixture vault.
- **Manual run** for visual/interaction work (live preview, graph behavior, 3D).

## Out of scope (for now)

- Full chat-history mirroring across machines.
- Mobile / web builds — desktop (Tauri) + CLI (incl. Pi) only.
- Plugin marketplace / themes ecosystem.

## Open questions (resolved per-stone, not blocking Stone 1)

- Core language final call (Rust strongly preferred) and port-vs-reimplement per subsystem (Stones 2–4).
- Agent-network live transport + payload, incl. guardrail/dead fields and governance metadata (Stone 2).
- Governance representation + how switching is triggered (Stones 2 & 4).
- Backend launch/health for supervision and Pi (Stone 3).
