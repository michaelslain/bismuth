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
- `server.ts` — HTTP server (Bun.serve) with caching strategy. Debounces file-watch invalidations (250ms). Returns `/graph`, `/tree`, `/file`, `/meta`, `/backup`, `/version`, `/config`, `/agent-graph` endpoints
- `engine.ts` — Graph composition. Merges vault graph + memory graph + self node, creates "about" edges linking memory to vault
- `vault.ts` — Builds vault knowledge graph from markdown files. Two-pass algorithm: (1) create note nodes from markdown files, (2) extract wikilinks + tags + frontmatter metadata, create edges
- `graph.ts` — Graph type definitions. Node kinds: "self", "note", "memory", "agent", "tag". Edge kinds: "link" (wikilinks), "message" (memory), "about" (memory→vault), "tag"
- `files.ts` — File I/O: list markdown, read/write notes
- `frontmatter.ts` — YAML frontmatter parsing; tolerates malformed YAML (real vaults have inconsistencies)
- `wikilinks.ts` — Extract `[[WikiLink]]` patterns from markdown
- `tags.ts` — Extract `#tag` from frontmatter and markdown body
- `memory.ts` — Build memory graph from Claude-bot memory notes (in `mem:` namespace)
- `agents.ts` — Build agent interaction graph (separate from vault/memory)
- `backup.ts` — Git commit snapshot of vault

**Caching strategy**: 
- `cachedGraph` persists until vault/memory files change
- File-watch changes trigger a debounced 250ms invalidation timer
- `/version` increments on cache invalidation; frontend polls and only refetches graph when version changes
- This avoids expensive graph rebuilds on rapid file edits

**Data flow**:
1. Frontend fetches `/version` periodically
2. If version incremented, frontend fetches `/graph`
3. Graph is computed lazily on first request after invalidation
4. Node positions are persisted to localStorage (2D/3D view mode in settings)

### Frontend App (`app/`)

**Framework**: Solid.js (reactive primitives) + TypeScript, styled with CSS modules

**Key components**:
- `App.tsx` — Root component. Manages tabs, active file, graph mode ("2nd"/"3rd"/"both"/"agents"), settings persistence
- `Editor.tsx` — CodeMirror 6 editor with live-preview block scanning and markdown extensions
- `FileTree.tsx` — Left sidebar showing vault file structure
- `GraphView.tsx` — Graph visualization hub (mounts the WebGL renderer, mode/view-mode controls)
- `SettingsPage.tsx` — Settings UI. Controls appearance (theme, accent, editor font/size), graph view mode (2D/3D), graph rendering options
- `api.ts` — HTTP client for core endpoints
- `settings.ts` — Settings state management, localStorage persistence

**Graph rendering**:
- `graph/WebGLRenderer.ts` — Three.js renderer for both 2D (flat birdseye) and 3D (volumetric orbit) modes, morphing between the backend's precomputed layouts
- `graph/collide.ts` — Per-node collision-radius helpers (big hubs repel as their drawn circle, not a point)
- `graph/d3-force-3d.d.ts` — Type stubs for d3-force-3d library

**Styling**:
- `App.css` — Global styles, CSS variables for theme/accent/fonts
- Component styles are colocated with components

### CLI (`cli/`)

**Purpose**: Lightweight wrapper around core library

**Entry point**: `src/index.ts` (exports `oa` binary)

Imports `@oa/core` to expose vault operations via command-line interface.

## Module Organization

```
core/src/
├── server.ts           # HTTP server, caching, file watching
├── engine.ts           # Graph composition (vault + memory + agents)
├── vault.ts            # Vault → graph builder
├── graph.ts            # Type definitions
├── memory.ts           # Memory → graph builder
├── agents.ts           # Agent graph builder
├── frontmatter.ts      # YAML parsing
├── wikilinks.ts        # WikiLink extraction
├── tags.ts             # Tag extraction (frontmatter + body)
├── files.ts            # File I/O primitives
├── backup.ts           # Git operations
└── test/               # Test suite (one .test.ts per module)

app/src/
├── App.tsx             # Root + tab/mode management
├── Editor.tsx          # CodeMirror wrapper + live-preview
├── FileTree.tsx        # Sidebar file browser
├── GraphView.tsx       # Graph view orchestrator
├── SettingsPage.tsx    # Settings UI
├── api.ts              # HTTP client
├── settings.ts         # State + localStorage
├── graph/              # Renderer
│  ├── WebGLRenderer.ts
│  ├── collide.ts
│  └── d3-force-3d.d.ts
└── App.css             # Global styles

core/test/helpers.ts       # makeSampleVault(): builds a throwaway vault+memory in tmpdirs for tests
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
2. Server detects file change, debounces 250ms, invalidates cache
3. Frontend polls `/version` endpoint, detects version increment
4. Frontend re-fetches `/graph` and updates visualization

### Performance considerations
- **Graph caching**: Only rebuilds when vault/memory files change (fs-watch + debounce)
- **Live-preview scanning**: Scans document for code blocks only when content changes, not on every keystroke
- **Node position persistence**: 2D/3D node positions stored in localStorage; on startup, nodes skip force-simulation settle step if positions are already known
- **Renderer lazy loading**: WebGL renderer only initializes when 3D mode is selected

## Common Tasks

### Adding a new endpoint to core API
1. Add handler to `createServer()` in `core/src/server.ts`
2. Implement the business logic (e.g., call `buildGraph()`, `listMarkdown()`)
3. Add CORS headers
4. Test with `bun test core/test/server.test.ts` (add test case)

### Adding a graph node kind or edge kind
1. Update `NodeKind` or `EdgeKind` types in `core/src/graph.ts`
2. Update extractors (e.g., `buildVaultGraph()` in `vault.ts`) to emit new nodes/edges
3. Update frontend graph filtering in `App.tsx` if needed (e.g., "2nd brain" excludes memory nodes)

### Adding UI settings
1. Add setting to `settings.ts` (state + localStorage key)
2. Add UI control to `SettingsPage.tsx`
3. If it affects rendering: add CSS variable or pass to renderer in `GraphView.tsx`

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

## Recent Stability & Security Updates

- **Path traversal rejection** (d5d0cdf): Core now validates vault file paths to prevent directory escape attacks
- **File-tree context menu** (e174978): New header buttons for note/folder creation, opaque UI, delete closes tab, rename/move retargets active tab
- **Undo support** (6613f27): Cmd+Z now undoes most recent delete action in file tree
- **Drag-drop moves** (2278b84): Files and folders can be rearranged by dragging within the tree

### Relay Integration (May 2026)

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
- `core/test/tags.test.ts` — Tag extraction from frontmatter and body
- `core/test/wikilinks.test.ts` — WikiLink pattern matching
- `core/test/server.test.ts` — HTTP endpoint behavior

## Gotchas & Edge Cases

- **localStorage persistence breaks between Tauri reloads**: Node positions (2D/3D layouts) are cached in localStorage, but hard-reloading the app or switching graph modes may reset positions. Workaround: node positions re-settle quickly via force simulation.
- **File-watch debounce timing**: The 250ms debounce can hide rapid successive edits. If you edit a note twice within 250ms, only the second change may trigger a graph rebuild.
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
