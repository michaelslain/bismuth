# Installation and Running Bismuth

This file covers every step required to install, run, and build Bismuth: prerequisites, dependency installation, required environment variables, all dev-server variants (full-stack, Vite-only, standalone backend), build commands, and how to run multiple instances on non-default ports.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| **Bun** | 1.0+ | Runtime, package manager, test runner, and bundler for all workspaces |
| **Node.js** | 20+ | Required by some native addons and Tauri toolchain |
| **Rust** | Current stable | Only needed for `tauri build` (native binary); not needed for web-only dev |

Install Bun: https://bun.sh/docs/installation

### Install Rust (only for `tauri build`)

```bash
# 1. Install Rust (accept the default "1) Proceed with installation")
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Load cargo into your CURRENT shell (the installer only adds it to PATH for NEW shells)
source "$HOME/.cargo/env"

# 3. Verify
cargo --version && rustc --version
```

See also the full Tauri prerequisites: https://tauri.app/start/prerequisites/

### The daemon ships as a compiled bundled binary

The former standalone **claude-bot** sibling repo has been absorbed into the in-repo
**`@bismuth/daemon`** workspace (`daemon/src/**`) — one machine process that multiplexes per-vault
"brains". You do **not** clone or `bun install` anything separately to build it. The Tauri build
compiles the daemon to a standalone binary (`app/scripts/build-daemon-sidecar.ts` →
`app/src-tauri/resources/daemon/bin/bismuth-daemon`, staged as a Tauri **resource**). On boot the
bundled app's core sidecar copies that binary to `~/.bismuth/bin` and registers it as a
launchd/systemd service (`core/src/daemonInstall.ts` `installDaemonFromBundle()` — see
[Bundled resources](#bundled-resources-relay--daemon--machine-wide-tools) below and
[Self-update](self-update.md)). The daemon therefore updates **with** the app — there is no git
clone, no `provisionClaudeBot`, and no `daemon.autoUpdate`/`daemon.home` setting (the schema's
`daemon` object has only `enabled`). `~/.claude-bot` survives only as a one-time, copy-only legacy
migration source (`migrateDaemonState` in `core/src/daemon.ts`, gated by a `.claude-bot-migrated`
marker).

---

## macOS folder permissions surviving updates (one-time setup)

**Bug #48** — "computer permissions are not persistent between Bismuth updates." macOS TCC
(the Files-and-Folders / Accessibility / etc. privacy grant database) pins every grant to the
app's **designated requirement**, not its bundle id. Run `codesign -d -r- /Applications/Bismuth.app`
on an unsigned build and you'll see `designated => cdhash H"…"` — the default ad-hoc signature
anchors the requirement to the exact binary's own content hash. Since every rebuild produces
different bytes, every rebuild gets a fresh "identity" and macOS silently revokes every grant —
for both `Bismuth.app` and the `bismuth-daemon` service binary.

To make grants survive updates, create a **stable self-signed code-signing certificate** once
(no Apple Developer account needed):

1. Keychain Access → Certificate Assistant → **Create a Certificate…**
2. Name: anything containing `Bismuth` (e.g. `Bismuth Self-Signed`), Identity Type: *Self-Signed
   Root*, Certificate Type: **Code Signing** → Create.

That's it — **every** `tauri build` invocation now auto-detects it: the `tauri` npm script
(`app/scripts/tauri.ts`, which every build path funnels through — a plain `bun run tauri build`,
`bun run installer`/`build:app`, and the self-update rebuild pipeline in
`core/src/selfUpdate.ts` alike) and the daemon sidecar build (`app/scripts/build-daemon-sidecar.ts`)
share one detector (`app/scripts/signingIdentity.ts`): any login-keychain codesigning
certificate whose name contains `Bismuth`, or an explicit `APPLE_SIGNING_IDENTITY` env var,
wins; without either they fall back to ad-hoc exactly as before. This closed a gap in the first
version of this fix, which only wired the auto-detect into the self-update pipeline — a plain,
manually-run `bun run tauri build` (the normal build path documented above, and how the very
first install is built) never saw it and stayed ad-hoc-signed even after creating the
certificate.

**Why a self-signed (non-Apple-issued) certificate works at all**: codesign's auto-generated
designated requirement for a certificate that does *not* chain to Apple's root CA takes the
form `anchor = H"<hash of the certificate itself>"` — an anchor on the reused *certificate*,
not the binary (this is documented in Apple's [Code Signing Requirement
Language](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html)
reference for custom certificate hierarchies). Re-signing with the *same* certificate on every
rebuild keeps that requirement — and therefore the TCC identity — stable, even though the
certificate itself is self-signed and untrusted by anyone else. This is a narrower claim than
"self-signed certs are equivalent to Developer ID": a self-signed cert gets no Apple Team ID,
no Gatekeeper trust, and no notarization — it only stabilizes the one requirement field TCC
actually keys grants on. A real Developer ID (+ notarization) is worth it if Bismuth is ever
distributed as a prebuilt binary to other machines, or if you want first-launch Gatekeeper
friction (a separate, pre-existing concern from unsigned/self-signed local builds) to go away.

## Repository Layout (Monorepo)

Bismuth is a Bun workspace monorepo. The root `package.json` declares seven workspaces:

```json
"workspaces": ["core", "cli", "app", "relay", "mcp", "memory", "daemon"]
```

- **core** — backend HTTP server (`core/src/server.ts`)
- **app** — Tauri + Solid + Vite desktop frontend
- **cli** — `bismuth` command-line binary
- **relay** — Claude Code plugin hooks (no standalone process)
- **mcp** — stdio MCP server serving `docs/` + the `bismuth` CLI to app-terminal Claude sessions
- **memory** — `@bismuth/memory`, the pure 3rd-brain memory graph (note CRUD + frontmatter + backlinks, keyword search, query DSL), used by the daemon, relay hooks, and MCP memory tools
- **daemon** — `@bismuth/daemon`, the per-vault daemon runtime; one machine process multiplexing every enabled vault's memory + crons + processes + conversation session

---

## Step 1 — Install Dependencies

Run once from the repo root. Bun installs all workspaces in a single pass.

```bash
bun install
```

This installs dependencies for all seven workspaces. Do not run `npm install` or `yarn`; they do not understand Bun workspaces.

---

## Step 2 — Set Required Environment Variables

The backend server refuses to start without both variables. Both directories must already exist on disk.

| Variable | Purpose |
|---|---|
| `BISMUTH_VAULT` | Absolute path to your 2nd-brain markdown vault directory |
| `BISMUTH_MEMORY` | Absolute path to your 3rd-brain memory directory (dev only; the bundled app derives it as `<vault>/.daemon/memory`) |

```bash
export BISMUTH_VAULT="/path/to/your/vault"
export BISMUTH_MEMORY="/path/to/your/memory"
```

### First-time / empty vault

If you have no existing vault, create placeholder directories before starting:

```bash
mkdir -p /tmp/test-vault /tmp/test-memory
echo "# Hello" > /tmp/test-vault/example.md
export BISMUTH_VAULT="/tmp/test-vault"
export BISMUTH_MEMORY="/tmp/test-memory"
```

### What happens if they are unset

The `bun run dev` script uses Bash's `${VAR:?message}` expansion, which immediately aborts with an error message if either variable is empty or unset:

```
# From app/package.json "dev" script:
bun run ../core/src/server.ts \
  --vault "${BISMUTH_VAULT:?set BISMUTH_VAULT to your 2nd-brain vault dir}" \
  --memory "${BISMUTH_MEMORY:?set BISMUTH_MEMORY to your 3rd-brain memory dir}"
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

1. `bun run ../core/src/server.ts --vault "$BISMUTH_VAULT" --memory "$BISMUTH_MEMORY"` — backend on port **4321**
2. `vite` — Vite dev server on port **1420** (strict — fails if 1420 is taken)

Open the app at `http://localhost:1420/` in a browser, or let the Tauri window open automatically if you are running inside the Tauri shell.

**Hot reload behaviour:**
- `.tsx` / `.css` changes in `app/src/` → Vite HMR, no page reload, editor/graph state preserved
- Changes under `core/src/` → the backend process restarts; the frontend reconnects automatically via its fallback version-poll
- `.settings` in the vault → re-read on the next request; no restart needed

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
BISMUTH_VAULT="/your/vault" BISMUTH_MEMORY="/your/memory" bun run core:serve
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
1. Reconciles `.settings` (the vault's single hidden, extensionless settings file — `SETTINGS_FILE` in `core/src/settings.ts:17`; migrates any legacy `settings.yaml` or interim `.settings/settings.yaml` into it first via `migrateSettingsLocation()`, then writes defaults if absent, fills missing keys; fire-and-forget).
2. Loads runtime config (`AppConfig`) from `.settings` merged over defaults.
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
bun run build:app     # from the repo root: builds, then opens the dmg installer
# — or, lower-level —
cd app && bun run tauri build
```

`build:app` (root `package.json`) runs `cd app && bun run installer`, which is `tauri build` followed by `scripts/open-installer.ts` (opens the built dmg so you can drag it in). The `tauri` script (`app/scripts/tauri.ts`) wraps `@tauri-apps/cli` and requires Rust + the Tauri prerequisites — it also auto-detects a stable macOS signing identity and passes it to every `tauri` invocation (see [macOS folder permissions surviving updates](#macos-folder-permissions-surviving-updates-one-time-setup) above). The `beforeBuildCommand` (`predmg:clean → prebundle:relay → build:bismuth-tools → build → build:core-sidecar → build:daemon-sidecar`) builds the Vite frontend, the relay resource, the bismuth-tools resource, the compiled core sidecar, and the compiled daemon resource as part of the pipeline.

**To install**: the build writes a `.dmg` and the `.app` it wraps under `src-tauri/target/release/bundle/{dmg,macos}/`. `tauri build` does **not** auto-open an installer window — open the dmg yourself (`open src-tauri/target/release/bundle/dmg/Bismuth_*.dmg`) and drag **Bismuth → Applications**, then eject. Or skip the dmg entirely and drag `src-tauri/target/release/bundle/macos/Bismuth.app` straight into `/Applications`. Re-running the build and re-dragging replaces the prior copy in place.

> A Finder window that flashes open and closed **during the build** is `bundle_dmg.sh` running its Finder-prettifying AppleScript to style the dmg (icon layout / background) — it is **not** the installer, and it auto-closes when that step finishes. The dmg is still written to the path above. (To suppress it, build with `CI=true bun run tauri build`, which passes `--skip-jenkins` to `bundle_dmg.sh` — the dmg then has no custom styling but builds identically.)

#### Self-spawned backend (bundled app)

Unlike dev (where `bun run dev` launches `core` via `concurrently`), the **bundled app runs its own backend**:

- `app/scripts/build-core-sidecar.ts` compiles `core/src/server.ts` into a standalone binary via `bun build --compile`, output to `app/src-tauri/binaries/bismuth-core-<target-triple>` (gitignored, ~58 MB). `tauri.conf.json` lists it under `bundle.externalBin` so it ships inside the `.app`.
- At launch, `app/src-tauri/src/lib.rs` (release builds only — gated on `!cfg!(debug_assertions)`) picks a **free port**, spawns the sidecar as `bismuth-core --vault <V> --memory <M> --port <free>` via `tauri-plugin-shell`, and kills it on `RunEvent::Exit` (no orphaned process). The main window is created in Rust (not in `tauri.conf.json`) with an initialization script setting `window.__BISMUTH_API__ = "http://localhost:<free>"` before any app JS runs; `api.ts` `resolveBase` reads it (precedence: `?api=` > `__BISMUTH_API__` > `VITE_API_BASE` > `:4321`). "Open folder" windows still pin their own backend via `?api=`.
- **Vault resolution**: a Finder-launched app has no shell env, so `BISMUTH_VAULT` is unset. The app reads `config.json` from the app config dir (`~/Library/Application Support/com.bismuth.app/config.json`); when a valid saved vault exists (`read_valid_config` — the path is set and is a real directory), it spawns the backend against it, deriving memory as `<vault>/.daemon/memory` (`vault_memory_dir`). A one-time startup migration (`migrate_legacy_config_dir`, run before any config read) renames the legacy config dir (`…/com.michael.obsidian` → `…/com.bismuth.app`) when it exists, so users upgrading across the bundle-id rename keep their saved vault.
- **No vault yet → the intro, not a bare picker**: when there is no usable vault, `lib.rs` does **not** jump straight to a folder picker. Instead it builds the window with **no backend** and renders a full-window onboarding takeover (see [First-run intro](#first-run-intro-the-vault-takeover) below). The native folder picker is only opened later, by the intro's final CTA.

#### First-run intro (the vault takeover)

The very first time a bundled app is launched — or any time the global *intro-seen* marker is absent — the user does not land in a folder picker. They land in a **full-window slideshow** that introduces Bismuth and then opens their vault. This replaces the old "first launch → native folder picker" path.

**Gating (Rust → JS):** In `lib.rs`'s `setup` (release only, `!cfg!(debug_assertions)`):

```rust
let valid = if !cfg!(debug_assertions) { read_valid_config(&app.handle()) } else { None };
let has_vault = valid.is_some();
let first_run = !cfg!(debug_assertions) && (!has_seen_intro(&app.handle()) || !has_vault);
```

So the intro shows when **either** the user has never finished it (`intro-seen` marker absent) **or** there is no usable vault. When `first_run`, `injected` is `None` (no backend is spawned — the intro is backend-free), and `build_main_window` writes an init script setting `window.__BISMUTH_FIRST_RUN__ = true` (plus `window.__BISMUTH_HAS_VAULT__ = true` when a vault is already configured, i.e. a replay). `app/src/index.tsx` reads that flag and code-splits the root so first-run loads `intro/VaultIntro` instead of `App`:

```ts
const firstRun =
  (isTauri() && window.__BISMUTH_FIRST_RUN__ === true) ||
  new URLSearchParams(window.location.search).has("intro");
const Root = lazy(() => (firstRun ? import("./intro/VaultIntro") : import("./App")));
```

`?intro=1` in the URL forces the intro in dev/browser for previewing (no native picker / backend in that mode — `enterVault` just logs).

**The `intro-seen` marker (separate from the vault config):** A *global*, app-level flag at `<app-config-dir>/intro-seen` — written by `mark_intro_seen`, checked by `has_seen_intro`. It is deliberately kept **separate from `config.json`**: it is one flag across all vaults (the intro is not re-shown per vault), and replaying it never touches the saved vault paths.

**The slideshow** (`app/src/intro/VaultIntro.tsx`) is an arrow-key/dot-navigable sequence of slides (`SlideKey`):

| Slide | What it shows |
|---|---|
| `welcome` | "Notes that think." — wikilinks pitch, centered crystal mark |
| `theme` | "Pick your palette." — a `Select` dropdown over all themes; choosing one **live-recolors a real 3D knowledge graph** (the app's own `WebGLRenderer` drawing a baked-layout dummy point-cloud, `SMALL_GRAPH`) and re-themes the whole takeover |
| `graph` | "Three brains, one mind." — the same 3D graph carries over, cross-fading to a bigger condensed cloud (`BIG_GRAPH`) |
| `daemon` | "An agent that never sleeps." — the background Bismuth daemon |
| `claude` | "Let Claude tend it." — MCP / Claude Code |
| `powerups` | "Optional power-ups." — toggle which setups to run after the vault opens (see below) |
| `begin` | "Open your vault." — the final CTA, **"Enter your vault"** |

The theme picker only recolors live; it commits **nothing** until the CTA. On commit, the chosen theme name is passed to the Tauri command (below) which **seeds the new vault's `appearance.theme`** so the app paints in that theme on first boot.

**The CTA → `choose_first_vault`:** "Enter your vault" (`enterVault`) invokes the Tauri command `choose_first_vault(theme, icon)`, which:
1. opens the **native folder picker** ("Open or create your Bismuth vault");
2. on cancel returns `Ok(false)` → the intro stays put (`busy` cleared);
3. on a pick: `create_dir_all` the folder, derive memory as `<vault>/.daemon/memory` (also created), `seed_vault_settings` writes a minimal legacy-path `settings.yaml` (`appearance: { theme, icon }`) **only if none exists** (Rust still targets the old root filename here — the sidecar's `reconcileSettings`/`migrateSettingsLocation` (`core/src/settings.ts:29`) renames it into the real `.settings` file on first boot and fills in the rest of the schema, preserving those seeded keys), persists `config.json`, calls `mark_intro_seen`, and `app.restart()`s into the new vault.

In dev (`tauri dev`), `choose_first_vault` **skips** `app.restart()` (a restart would tear down the `beforeDevCommand` backend → white screen, and the dev vault comes from `BISMUTH_VAULT` regardless) — the frontend just navigates to `/` itself.

**Power-ups (queued for after the vault opens):** The `powerups` slide offers optional setups (`POWER_UPS` in `VaultIntro.tsx`), both default-on: **DAEMON** (command `daemon-setup`) and **CLI + MCP** (command `bismuth-install`). The intro has no backend, so it can't run them itself — `enterVault` writes the chosen command-palette ids to `localStorage["bismuth-first-run-powerups"]` (and caches the theme CSS vars under `bismuth-theme-vars-v1` for the post-restart first paint). The restarted app reads that key and runs the chosen commands against the real backend. Re-running either is idempotent (CLI+MCP re-syncs on boot, the daemon re-installs from the bundle version-gated on launch), so leaving them checked is safe even when already installed.

**Replay (secret keybind):** The frontend can replay the onboarding via two Tauri commands:
- `reset_first_run` — removes **only** the `intro-seen` marker (leaving `config.json` intact) and relaunches; with a vault still configured this re-shows the intro and then drops the user back into their current vault. Bound to a secret keybind.
- `finish_intro` — used when replaying with a vault already configured: marks the intro seen and relaunches **into the existing vault without re-picking** (the intro's CTA continues here instead of `choose_first_vault` when `window.__BISMUTH_HAS_VAULT__` is set).

`set_last_vault(vault)` is the related "open another folder as a new brain" persist — it writes the new vault into `config.json` (preserving the existing memory dir, ignoring an empty/nonexistent path) so the next cold launch reopens it.

#### Bundled resources: relay + daemon + machine-wide tools

`beforeBuildCommand` also stages three more resources alongside the core sidecar, and `lib.rs` points the sidecar at them via env vars (`tauri.conf.json` lists `resources/relay`, `resources/bismuth-tools`, `resources/daemon`):

- **`resources/relay`** (`app/scripts/bundle-relay.ts`, hooks-only — no `node_modules`/`.mcp.json`) → `BISMUTH_RELAY_BUNDLE`. `core/src/terminal.ts` resolves the relay shim from it so app terminal tabs auto-load the agent-graph relay plugin (the source-relative `relay/` doesn't exist inside the compiled sidecar). The shim's zdotdir sources the user's `~/.zshrc` first, so oh-my-zsh + their `PATH` + their `claude` all still work — the `claude` function is added on top.
- **`resources/bismuth-tools`** (`app/scripts/build-bismuth-tools.ts` — compiled `bismuth` + `bismuth-mcp` binaries + the `docs/` tree) → `BISMUTH_INSTALL_SRC`. On boot the sidecar runs `ensureBismuthInstalled` (`core/src/bismuthInstall.ts`): a **version-gated, idempotent** machine-wide install — copies the tools to `~/.bismuth/`, symlinks `bismuth` onto `PATH`, and registers the MCP in the user's global `~/.claude.json` (`claude mcp add -s user`). No-op when the bundled binaries are unchanged (hash at `~/.bismuth/.version`). See [MCP server](../mcp/overview.md).
- **`resources/daemon`** (`app/scripts/build-daemon-sidecar.ts` — the compiled `@bismuth/daemon` runtime as `bin/bismuth-daemon`) → `BISMUTH_DAEMON_BUNDLE`. On boot the sidecar runs `installDaemonFromBundle` (`core/src/daemonInstall.ts`): **version-gated** on the source binary's size+mtime, it copies the binary to `~/.bismuth/bin/bismuth-daemon` (atomic temp-rename so an updating, still-running service doesn't hit `ETXTBSY`) and runs `<bin> --ensure-installed` to register the launchd `com.bismuth.daemon` / systemd `bismuth-daemon` service. Because the daemon must **outlive** the app to keep firing crons, it's a standalone service — NOT a Tauri-managed child like the core sidecar. No-op in dev (no `BISMUTH_DAEMON_BUNDLE`).

> **DMG build hygiene**: tauri's `bundle_dmg.sh` can fail if a prior failed build left a `/Volumes/dmg.*` scratch volume mounted. `beforeBuildCommand` runs `app/scripts/predmg-clean.ts` first to detach stale volumes + remove `rw.*.dmg` scratch, so re-running `tauri build` self-heals.

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
BISMUTH_VAULT="/path/to/second-vault" \
BISMUTH_MEMORY="/path/to/second-memory" \
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
| `set BISMUTH_VAULT to your 2nd-brain vault dir` | `BISMUTH_VAULT` is unset or empty | `export BISMUTH_VAULT="/absolute/path"` |
| `set BISMUTH_MEMORY to your 3rd-brain memory dir` | `BISMUTH_MEMORY` is unset or empty | `export BISMUTH_MEMORY="/absolute/path"` |
| `usage: server --vault ... --memory ...` | Running `bun run core:serve` without flags | Supply both `--vault` and `--memory` |
| `Port 1420 is already in use` | Another Vite instance is running | Kill it or start with `vite --port 1421` |
| `Port 4321 is already in use` | Another backend is running | Use `--port 4322` |
| `ENOENT` on vault watch start | Vault directory does not exist | Create the directory before starting |

Source: /Users/michaelslain/Documents/dev/bismuth/CLAUDE.md, /Users/michaelslain/Documents/dev/bismuth/package.json, /Users/michaelslain/Documents/dev/bismuth/app/package.json, /Users/michaelslain/Documents/dev/bismuth/core/src/server.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/settings.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/daemonInstall.ts, /Users/michaelslain/Documents/dev/bismuth/app/scripts/build-daemon-sidecar.ts, /Users/michaelslain/Documents/dev/bismuth/app/vite.config.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/api.ts, /Users/michaelslain/Documents/dev/bismuth/app/src-tauri/src/lib.rs, /Users/michaelslain/Documents/dev/bismuth/app/src-tauri/tauri.conf.json, /Users/michaelslain/Documents/dev/bismuth/app/src/index.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/intro/VaultIntro.tsx
