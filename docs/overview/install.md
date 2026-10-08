# Install and run Bismuth

Bismuth installs on macOS by building the app from source and dragging it into `/Applications`; engineers can also run it from source with hot reload, either in a browser or in a native window. This page covers both paths, the one-time code-signing setup that keeps macOS permissions across updates, and the errors you can hit on startup. After installing, open [Getting started](getting-started.md) for your first vault.

```bash
git clone https://github.com/michaelslain/bismuth.git
cd bismuth
bun install
bun run build:app     # builds the app (a few minutes), then opens the dmg
```

## Install the app (macOS)

You need these tools first:

| Tool | Minimum | Needed for |
|---|---|---|
| Bun | 1.0 | Runtime, package manager, test runner and bundler for every workspace |
| Node.js | 20 | Some native addons and the Tauri toolchain |
| Rust | Current stable | The native build (`tauri build`); not needed for browser-only development |

Install Bun from [bun.sh](https://bun.sh/docs/installation). To install Rust, accept the installer's default and load it into your current shell, because the installer only updates `PATH` for new shells:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
cargo --version && rustc --version
```

Tauri may need further system packages; see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

Then build and install:

1. Run `bun install` once at the repo root. Bun installs every workspace in one pass; `npm install` and `yarn` do not understand the workspaces.
2. Run `bun run build:app` from the repo root. It builds the frontend, the backend binary, the daemon binary and the tools bundle, wraps them in a `.app` and a `.dmg`, deletes the loose `.app` so macOS lists one Bismuth, and opens the dmg.
3. Drag **Bismuth** to **Applications**, eject the dmg and launch it.

A Finder window may flash open and shut during the build. That is the dmg being styled, not the installer.

To build without the helper script, run `cd app && bun run tauri build`, then open `app/src-tauri/target/release/bundle/dmg/Bismuth_*.dmg`. This leaves both the dmg and the `.app` under `app/src-tauri/target/release/bundle/{dmg,macos}/`; delete the staged `macos/Bismuth.app` afterwards so Spotlight does not list a second copy. Re-running the build and dragging again replaces the installed app in place.

The first launch opens an intro and a folder picker; see [Getting started](getting-started.md). To stay current, see [Self-update](self-update.md). To check an existing machine for leftovers from older builds, run `bismuth doctor` ([Doctor](doctor.md)). `bismuth uninstall` removes the machine-wide CLI symlink, the MCP registrations and `~/.bismuth`, and unloads the daemon's launchd or systemd service first; it leaves your vault alone.

## macOS folder permissions surviving updates

A build signed with no certificate loses its folder permissions on every rebuild. macOS ties each privacy grant (Files and Folders, Accessibility, Full Disk Access) to the app's code identity, and an unsigned build's identity is a hash of its own bytes, which changes on every build. Create one stable self-signed certificate and every later build reuses its identity:

1. Open Keychain Access, then **Certificate Assistant**, then **Create a Certificate**.
2. Name it anything containing `Bismuth` (for example `Bismuth Self-Signed`), set Identity Type to **Self-Signed Root** and Certificate Type to **Code Signing**, then create it.

Every `tauri build` now finds it automatically: a login-keychain code-signing certificate whose name contains `Bismuth`, or the `APPLE_SIGNING_IDENTITY` environment variable if you set one. This covers `bun run build:app`, a manual `bun run tauri build`, and the self-update rebuild. With neither present the build falls back to an ad-hoc signature.

A self-signed certificate stabilises the identity only. It gives you no Apple Team ID, no Gatekeeper trust and no notarization.

The daemon binary is signed with the identifier `com.bismuth.daemon` under the same certificate. If the daemon needs Full Disk Access, grant it once after the first signed install: System Settings, Privacy and Security, Full Disk Access, add `~/.bismuth/bin/bismuth-daemon`, then run `bismuth daemon restart`. The grant survives later updates. To move an already installed ad-hoc daemon onto the certificate without rebuilding:

```bash
codesign --force --sign "<cert name>" --identifier com.bismuth.daemon ~/.bismuth/bin/bismuth-daemon && bismuth daemon restart
codesign -d -r- ~/.bismuth/bin/bismuth-daemon   # must name the identifier and a certificate, not a cdhash
```

## Develop from source

Development runs the backend and the frontend as two processes. Install dependencies once with `bun install` at the repo root, then start both from `app/`.

### Run in the browser

```bash
cd app
bun run dev:browser
```

This starts the backend on port 4321 and Vite on port 1420, and stops both on Ctrl-C. Open `http://localhost:1420/`. It mints one owner token per run and gives it to both halves, so your requests count as the vault's owner. Vite fails immediately if 1420 is taken instead of picking another port.

### Run with the native window

```bash
cd app
bun run dev:app
```

This starts the same two processes plus the Tauri window in one process group. Leave `beforeDevCommand` in `tauri.conf.json` empty: filling it starts a second backend and Vite pair that collides on ports 4321 and 1420 and takes the window down. A bare `bun run tauri dev` paints an empty window because it brings no frontend up.

### Choose which vault to open

A fresh clone needs no setup. With nothing exported, the dev script generates an example vault at `.dev-vault/` in the repo root (gitignored) and prints which vault it chose on every start.

| Variable | Meaning |
|---|---|
| `BISMUTH_VAULT` | Absolute path of the vault folder |
| `BISMUTH_MEMORY` | Absolute path of the memory folder |

Set both or neither. With only one set, the dev script stops with `set BOTH BISMUTH_VAULT and BISMUTH_MEMORY, or neither (neither = the example vault)`, because a half-set pair is usually a stale export.

```bash
export BISMUTH_VAULT="/path/to/your/vault"
export BISMUTH_MEMORY="/path/to/your/vault/.daemon/memory"
```

Dev builds write to the vault: autosave, task toggles and review scheduling all persist in `.dev-vault/`. Delete the folder (`rm -rf .dev-vault`) for a clean reset; missing example files come back on the next start, and existing ones are left alone. Once a vault's daemon is enabled, the graph reads memory from `<vault>/.daemon/memory` whatever `BISMUTH_MEMORY` says; the variable still controls the file watcher and the memory snapshots.

### Hot reload

- Edits to `.tsx` and `.css` in `app/src/` hot-reload in Vite and keep editor and graph state.
- The dev script starts the backend with plain `bun run`, so restart `dev:browser` after editing `core/src/`.
- `.settings` in the vault is re-read on the next request, with no restart.

### Run the backend alone

```bash
bun run core/src/server.ts --vault /path/to/vault --memory /path/to/memory [--port 4322]
```

`--vault` and `--memory` are required unless `BISMUTH_VAULT` and `BISMUTH_MEMORY` are exported, and a flag wins over its variable. `--port` defaults to 4321. Without both paths the server prints `usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]` and exits with code 1. Unlike the dev script, it has no example-vault fallback. `bun run core:serve` at the repo root runs the same file, so pass the flags or variables to it as well.

Vite alone is `cd app && bun run vite`. It does no vault resolution and mints no token, so it needs a backend that is already running.

### Run a second instance

`PORT=` does nothing, and `dev:browser` accepts no port option, so a second instance means starting both halves yourself on other ports, sharing one token:

```bash
TOKEN=$(openssl rand -hex 32)
BISMUTH_OWNER_TOKEN=$TOKEN bun run core/src/server.ts --port 4323 \
    --vault "$PWD/.dev-vault/vault" --memory "$PWD/.dev-vault/vault/.daemon/memory" &
cd app && VITE_OWNER_TOKEN=$TOKEN VITE_API_BASE=http://localhost:4323 \
    bun x vite --port 1422 --strictPort
```

Without the shared token, content routes return 403 or silently drop notes a vault marks `chat-only` or `hidden`. You can also point an open page at another backend with `http://localhost:1420/?api=http://localhost:4323`. The app resolves its backend as described in [Architecture](architecture.md#how-does-a-client-reach-core).

### Build and test

| Command | Where | Result |
|---|---|---|
| `bun run build` | `app/` | Production web build in `app/dist/`, with the heavy libraries split into lazy chunks |
| `bun run serve` | `app/` | `vite preview` of that build |
| `bun run tauri build` | `app/` | Native app and dmg (needs Rust) |
| `bun test core` | repo root | The core test suite |

Pass an exact path to run one test file: `bun test core/test/wikilinks.test.ts`. `bun test core -- <pattern>` does not filter, because `core` already matches every path. Hooks, gates and the visual checks are in [Testing](../contributing/testing.md).

### Startup errors

| Message | Cause | Fix |
|---|---|---|
| `set BOTH BISMUTH_VAULT and BISMUTH_MEMORY, or neither ...` | Only one of the pair is exported | Export both, or unset both |
| `usage: server --vault ... --memory ...` | Standalone backend started without both paths | Pass the flags or export the variables |
| `Port 1420 is already in use` | Another Vite instance runs | Stop it, or start Vite with `--port` as in the second-instance recipe |
| `Port 4321 is already in use` | Another backend runs | Stop it, or run the standalone backend with `--port` |
| `ENOENT` when the vault watch starts | The vault folder does not exist | Create the folder first |

Other symptoms are indexed in [Troubleshooting](troubleshooting.md).

## How it works: the bundled app

A release build ships its own backend. `app/scripts/build-core-sidecar.ts` compiles `core/src/server.ts` into a standalone binary at `app/src-tauri/binaries/bismuth-core-<target-triple>`, and `tauri.conf.json` lists it under `bundle.externalBin`. On launch, `app/src-tauri/src/lib.rs` (release builds only) picks a free port, mints a 32-byte owner token from `/dev/urandom`, and spawns the sidecar as `bismuth-core --vault <V> --memory <M> --port <free>` with `BISMUTH_OWNER_TOKEN` set. It injects `window.__BISMUTH_API__`, `window.__BISMUTH_OWNER_TOKEN__` and `window.__BISMUTH_VAULT__` into the webview before any app code runs, and kills the sidecar when the app exits. If `/dev/urandom` cannot be read, the sidecar does not start.

The sidecar signs with `app/src-tauri/Entitlements.plist`, which grants `allow-jit` (without it the compiled Bun runs about 6.5 times slower) and `disable-library-validation` (without it every terminal tab fails to load its PTY library).

A Finder-launched app has no shell environment, so `lib.rs` reads the saved vault from `config.json` in the app config directory, `~/Library/Application Support/com.bismuth.app/`. A saved vault must exist as a directory; memory is always `<vault>/.daemon/memory`. `set_last_vault` rewrites `config.json` when you open another folder as a new brain.

The `beforeBuildCommand` runs `predmg:clean`, `prebundle:relay`, `build:bismuth-tools`, `build`, `build:core-sidecar` and `build:daemon-sidecar` in order. `predmg:clean` detaches leftover `dmg.*` scratch volumes and mounted Bismuth installer volumes under `/Volumes`, and deletes `rw.*.dmg` files that a failed earlier build can leave behind, so a rebuild repairs itself.

Three resources are staged next to the sidecar, and `lib.rs` passes their paths to it:

| Resource | Variable | What the sidecar does with it |
|---|---|---|
| `resources/relay` | `BISMUTH_RELAY_BUNDLE` | Terminal tabs load the relay shim from it |
| `resources/bismuth-tools` | `BISMUTH_INSTALL_SRC` | `ensureBismuthInstalled` copies the CLI, MCP and `docs/` to `~/.bismuth`, links `bismuth` onto `PATH` and registers the MCP; skipped when the bundled hash in `~/.bismuth/.version` is unchanged |
| `resources/daemon` | `BISMUTH_DAEMON_BUNDLE` | `installDaemonFromBundle` copies the daemon binary to `~/.bismuth/bin` and registers the launchd or systemd service |

The daemon is a standalone service, not a Tauri child, because it must outlive the app to keep firing crons. It updates with the app, so there is no separate daemon updater.

## How it works: first run

On a release build, `lib.rs` shows the first-run intro when the global `intro-seen` marker is missing or there is no usable saved vault. In that case it starts no backend and sets `window.__BISMUTH_FIRST_RUN__` (plus `window.__BISMUTH_HAS_VAULT__` when a vault is already saved). `app/src/index.tsx` then loads `intro/VaultIntro` instead of `App`; adding `?intro=1` to the URL forces the intro in dev.

The intro is a slideshow (`app/src/intro/introSlides.ts`) that ends with the **Enter your vault** button. That button calls the Tauri command `choose_first_vault(theme, icon)`, which opens a folder picker, creates the folder and its `.daemon/memory`, seeds the chosen theme and icon into a `settings.yaml` at the vault root only if no settings file exists (core's `reconcileSettings` moves it into `.settings` on first boot), writes `config.json`, writes `intro-seen` and relaunches. Cancelling the picker leaves the intro in place. Dev builds skip the relaunch and navigate in place.

Two choices from the intro run after the vault opens, because the intro has no backend. The power-up commands (`daemon-setup`, `bismuth-install`, both selected by default) are stored under the `localStorage` key `bismuth-first-run-powerups`, and the agent choice under `bismuth-first-run-agent`; `App` reads and clears each once. Agent detection in the intro is the Tauri command `detect_agents`, which scans `PATH` and the usual install directories for executables.

The shortcut Cmd+Ctrl+Opt+Shift+R calls `reset_first_run`, which deletes the `intro-seen` marker and relaunches into the intro; with a saved vault, `finish_intro` then continues into it without re-picking.

## How it works: CORS

Core answers every request with `Access-Control-Allow-Origin: *`, methods `GET,PUT,POST,OPTIONS`, and headers `Content-Type, X-Bismuth-Token`, so Vite on any port and the Tauri webview reach it with no proxy.

Source: `package.json`, `app/package.json`, `app/scripts/dev.ts`, `app/scripts/devVault.ts`, `app/scripts/tauri.ts`, `app/scripts/signingIdentity.ts`, `app/scripts/build-core-sidecar.ts`, `app/scripts/build-daemon-sidecar.ts`, `app/scripts/postbuild-clean.ts`, `app/vite.config.ts`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/Entitlements.plist`, `app/src-tauri/src/lib.rs`, `app/src/index.tsx`, `app/src/api.ts`, `app/src/intro/introSlides.ts`, `app/src/storageKeys.ts`, `core/src/server.ts`, `core/src/routes/context.ts`, `core/src/bismuthInstall.ts`, `core/src/daemonInstall.ts`, `cli/src/commands/install.ts`
