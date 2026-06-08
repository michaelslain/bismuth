# Installation and Running Bismuth

This file covers every step required to install, run, and build Bismuth: prerequisites, dependency installation, required environment variables, all dev-server variants (full-stack, Vite-only, standalone backend), build commands, and how to run multiple instances on non-default ports.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| **Bun** | 1.0+ | Runtime, package manager, test runner, and bundler for all workspaces |
| **Node.js** | 20+ | Required by some native addons and Tauri toolchain |
| **Rust + Tauri CLI** | Current stable | Only needed for `tauri build` (native binary); not needed for web-only dev |

Install Bun: https://bun.sh/docs/installation  
Install Tauri prerequisites: https://tauri.app/start/prerequisites/

---

## Repository Layout (Monorepo)

Bismuth is a Bun workspace monorepo. The root `package.json` declares four workspaces:

```json
"workspaces": ["core", "cli", "app", "relay"]
```

- **core** — backend HTTP server (`core/src/server.ts`)
- **app** — Tauri + Solid + Vite desktop frontend
- **cli** — `oa` command-line binary
- **relay** — Claude Code plugin hooks (no standalone process)

---

## Step 1 — Install Dependencies

Run once from the repo root. Bun installs all workspaces in a single pass.

```bash
bun install
```

This installs dependencies for all four workspaces. Do not run `npm install` or `yarn`; they do not understand Bun workspaces.

---

## Step 2 — Set Required Environment Variables

The backend server refuses to start without both variables. Both directories must already exist on disk.

| Variable | Purpose |
|---|---|
| `OA_VAULT` | Absolute path to your 2nd-brain markdown vault directory |
| `OA_MEMORY` | Absolute path to your 3rd-brain Claude-bot memory directory |

```bash
export OA_VAULT="/path/to/your/vault"
export OA_MEMORY="/path/to/your/memory"
```

### First-time / empty vault

If you have no existing vault, create placeholder directories before starting:

```bash
mkdir -p /tmp/test-vault /tmp/test-memory
echo "# Hello" > /tmp/test-vault/example.md
export OA_VAULT="/tmp/test-vault"
export OA_MEMORY="/tmp/test-memory"
```

### What happens if they are unset

The `bun run dev` script uses Bash's `${VAR:?message}` expansion, which immediately aborts with an error message if either variable is empty or unset:

```
# From app/package.json "dev" script:
bun run ../core/src/server.ts \
  --vault "${OA_VAULT:?set OA_VAULT to your 2nd-brain vault dir}" \
  --memory "${OA_MEMORY:?set OA_MEMORY to your 3rd-brain memory dir}"
```

The standalone server (`bun run core/src/server.ts ...`) checks the CLI flags directly and prints:

```
usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]
```

then exits with code 1 if either `--vault` or `--memory` is missing.

---

## Step 3 — Running in Development

### Full-stack dev (Tauri app + backend, recommended)

Run from the `app/` directory. This starts the backend and the Vite frontend concurrently using `concurrently -k` (kills both on Ctrl-C).

```bash
cd app
bun run dev
```

What this launches (from `app/package.json` "dev" script):

1. `bun run ../core/src/server.ts --vault "$OA_VAULT" --memory "$OA_MEMORY"` — backend on port **4321**
2. `vite` — Vite dev server on port **1420** (strict — fails if 1420 is taken)

Open the app at `http://localhost:1420/` in a browser, or let the Tauri window open automatically if you are running inside the Tauri shell.

**Hot reload behaviour:**
- `.tsx` / `.css` changes in `app/src/` → Vite HMR, no page reload, editor/graph state preserved
- Changes under `core/src/` → the backend process restarts; the frontend reconnects automatically via its fallback version-poll
- `settings.yaml` in the vault → re-read on the next request; no restart needed

### Vite frontend only (no backend)

```bash
cd app
bun start
```

This runs `vite` alone. You will need a separately running backend for any API calls to work.

### Shorthand from root (standalone backend only)

```bash
bun run core:serve
```

This maps to `bun run core/src/server.ts` with no flags — it will error immediately because `--vault` and `--memory` are required. You must provide them:

```bash
OA_VAULT="/your/vault" OA_MEMORY="/your/memory" bun run core:serve
# or with explicit flags:
bun run core/src/server.ts --vault /your/vault --memory /your/memory
```

---

## Standalone Backend Server

The backend can be run independently of the frontend. Both `--vault` and `--memory` are required; `--port` is optional and defaults to **4321**.

```bash
bun run core/src/server.ts \
  --vault /path/to/vault \
  --memory /path/to/memory \
  [--port 4322]
```

Parsed by `cliArg(name)` in `server.ts` (scans `Bun.argv` for `--<name>` and returns the next token). The startup sequence when invoked directly (`import.meta.main` is true):

```typescript
if (import.meta.main) {
  const vault = cliArg("vault");
  const memory = cliArg("memory");
  if (!vault || !memory) {
    console.error("usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]");
    process.exit(1);
  }
  const portArg = cliArg("port");
  const s = createServer({ vault, memory, port: portArg ? Number(portArg) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);
}
```

On boot the server:
1. Reconciles `settings.yaml` (writes defaults if absent, fills missing keys; fire-and-forget).
2. Loads runtime config (`AppConfig`) from `settings.yaml` merged over defaults.
3. Starts a file watcher on the vault (and memory directory if provided) with a debounce of `appConfig.server.fileWatchDebounceMs` (default 250 ms).
4. Binds `Bun.serve` on the configured port with WebSocket upgrade support for `/terminal`.

### `CoreConfig` interface

```typescript
export interface CoreConfig {
  vault: string;    // absolute path to vault directory (required)
  memory?: string;  // absolute path to memory directory (optional for library use; required for CLI)
  port?: number;    // defaults to 4321
}
```

---

## Building for Production

### Vite web build

Produces optimized static assets in `app/dist/`.

```bash
cd app
bun run build
```

The build uses manual chunk splitting (see `vite.config.ts`) to keep the entry bundle small: Three.js + d3-force-3d, xterm, KaTeX, jspdf + html2canvas, and marked are each split into separate lazy chunks.

### Tauri native binary

Produces a native desktop application (`.app` on macOS, `.exe` on Windows, etc.).

```bash
cd app
bun run tauri build
```

The `tauri` script in `app/package.json` delegates to `@tauri-apps/cli`. This requires Rust and the Tauri prerequisites to be installed. The `beforeBuildCommand` is `bun run build && bun run build:core-sidecar`, so the Vite frontend AND the core sidecar binary are built as part of the pipeline.

#### Self-spawned backend (bundled app)

Unlike dev (where `bun run dev` launches `core` via `concurrently`), the **bundled app runs its own backend**:

- `app/scripts/build-core-sidecar.ts` compiles `core/src/server.ts` into a standalone binary via `bun build --compile`, output to `app/src-tauri/binaries/bismuth-core-<target-triple>` (gitignored, ~58 MB). `tauri.conf.json` lists it under `bundle.externalBin` so it ships inside the `.app`.
- At launch, `app/src-tauri/src/lib.rs` (release builds only — gated on `!cfg!(debug_assertions)`) picks a **free port**, spawns the sidecar as `bismuth-core --vault <V> --memory <M> --port <free>` via `tauri-plugin-shell`, and kills it on `RunEvent::Exit` (no orphaned process). The main window is created in Rust (not in `tauri.conf.json`) with an initialization script setting `window.__OA_API__ = "http://localhost:<free>"` before any app JS runs; `api.ts` `resolveBase` reads it (precedence: `?api=` > `__OA_API__` > `VITE_API_BASE` > `:4321`). "Open folder" windows still pin their own backend via `?api=`.
- **Vault resolution**: a Finder-launched app has no shell env, so `OA_VAULT` is unset. The app reads `config.json` from the app config dir (`~/Library/Application Support/com.michael.obsidian/config.json`); on first launch (or if the saved vault is missing) it shows a native folder picker, persists the choice, and defaults memory to `~/.claude-bot/memory`. Cancelling the picker leaves the app open with no backend.

### Preview the Vite build

```bash
cd app
bun run serve
```

Maps to `vite preview`, serving the production build on a local port for smoke-testing.

---

## Running Multiple Instances on Alternate Ports

The defaults are **backend :4321** and **Vite :1420**. Only one instance can use each port. To run a second Bismuth instance (e.g. for a different vault):

### Override the backend port

Pass `--port` to the standalone server, or set `PORT` as an env var recognized by the `dev` script:

```bash
# Standalone backend on a custom port:
bun run core/src/server.ts \
  --vault /path/to/second-vault \
  --memory /path/to/second-memory \
  --port 4322

# Full-stack dev (PORT env var threads through to the dev script):
OA_VAULT="/path/to/second-vault" \
OA_MEMORY="/path/to/second-memory" \
PORT=4322 \
cd app && bun run dev
```

### Point the frontend at a non-default backend

The frontend resolves the backend base URL at runtime in this priority order (from `app/src/api.ts`):

1. **`?api=<url>` query parameter** — wins over everything; trailing slashes are trimmed. Set automatically when "Open Folder" opens a sibling backend in a new window.
2. **`VITE_API_BASE` build-time env var** — used to bake a non-standard backend URL into the build.
3. **Default** — `http://localhost:4321`

To develop against a backend on port 4322, either:

```bash
# Option A: set VITE_API_BASE at Vite start time
VITE_API_BASE="http://localhost:4322" bun start

# Option B: open the app with ?api= in the URL
open http://localhost:1420/?api=http://localhost:4322
```

### Vite strict port

Vite's dev server is configured with `strictPort: true` at port 1420 (`vite.config.ts`). If 1420 is taken, Vite fails immediately rather than trying another port. To run a second frontend, you must start Vite with an explicit `--port` flag:

```bash
cd app
VITE_API_BASE="http://localhost:4322" vite --port 1421
```

---

## Testing

Tests use Bun's native test runner. No additional test setup is required.

```bash
# Run all core tests
bun test core

# Filter by filename pattern
bun test core -- wikilinks
bun test core -- server
bun test core -- vault
```

Test files live in `core/test/` (one `*.test.ts` per module). Frontend tests (`panes.test.ts`, `settings.parity.test.ts`, `graph/collide.test.ts`, etc.) live colocated with source in `app/src/`.

---

## CORS

The backend sets permissive CORS headers on every response:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

This allows the Vite dev server (any port) and the Tauri webview to reach the backend without proxy configuration.

---

## Common Startup Errors

| Error | Cause | Fix |
|---|---|---|
| `set OA_VAULT to your 2nd-brain vault dir` | `OA_VAULT` is unset or empty | `export OA_VAULT="/absolute/path"` |
| `set OA_MEMORY to your 3rd-brain memory dir` | `OA_MEMORY` is unset or empty | `export OA_MEMORY="/absolute/path"` |
| `usage: server --vault ... --memory ...` | Running `bun run core:serve` without flags | Supply both `--vault` and `--memory` |
| `Port 1420 is already in use` | Another Vite instance is running | Kill it or start with `vite --port 1421` |
| `Port 4321 is already in use` | Another backend is running | Use `--port 4322` |
| `ENOENT` on vault watch start | Vault directory does not exist | Create the directory before starting |

Source: /Users/michaelslain/Documents/dev/bismuth/CLAUDE.md, /Users/michaelslain/Documents/dev/bismuth/package.json, /Users/michaelslain/Documents/dev/bismuth/app/package.json, /Users/michaelslain/Documents/dev/bismuth/core/src/server.ts, /Users/michaelslain/Documents/dev/bismuth/app/vite.config.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/api.ts
