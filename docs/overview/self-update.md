# Self-Update (git-based)

The bundled Bismuth app updates itself in place: it detects when the installed `/Applications/Bismuth.app` is behind `origin/main`, and on one click it pulls the latest source, rebuilds the app, and hot-swaps the `.app` bundle — no re-download, no installer, no Homebrew. The whole mechanism is git + a local rebuild, because the app was built from a local clone and the build baked in where that clone lives.

This page covers the full pipeline: how a build records its origin, how the backend detects + applies updates, how the frontend banner drives it, the Tauri/env plumbing that lets a detached script swap the bundle after the app quits, the **on-launch background install** of the bundled `@bismuth/daemon` service, and the **opt-in app self-update**.

> **Self-disables outside a bundled source build.** In `bun run dev` (or any build with no `build-origin.json` / no `BISMUTH_APP_PATH`) the whole feature is a no-op: `GET /update/status` returns `available:false` with a `reason`, and the banner never appears.

---

## The big picture

```
build time   app/scripts/build-bismuth-tools.ts
             └─ writes build-origin.json { repoRoot, sha, builtAt } into the tools resource

run time     app/src/updateCheck.ts  ──poll──> GET /update/status   (core/src/selfUpdate.ts)
             │                                   └─ git fetch + HEAD..origin/main → UpdateStatus
             ▼
             app/src/UpdateBanner.tsx  (shown when available)
               │ click UPDATE
               ├─ POST /update/apply          → startUpdate()  (returns immediately)
               │     └─ git pull --ff-only → bun run tauri build --bundles app
               │        └─ spawnRelauncher() writes + nohup-spawns a detached swap script
               ├─ poll GET /update/progress   → phase: pulling → building → ready
               └─ on "ready": invoke Tauri `quit_app`
                            ▼
             detached relauncher waits for the app pid to die, ditto-swaps the .app, reopens it
```

---

## `build-origin.json` — where the build came from

`app/scripts/build-bismuth-tools.ts` runs as part of `tauri build` (wired into `beforeBuildCommand`). After compiling the `bismuth` + `bismuth-mcp` binaries and staging `docs/`, it records the build provenance:

```ts
const originRepoRoot = canonicalRepoRoot(repoRoot);
writeFileSync(
  join(outDir, "build-origin.json"),
  JSON.stringify({ repoRoot: originRepoRoot, sha, builtAt: new Date().toISOString() }, null, 2),
);
```

- `repoRoot` — the absolute path of the **stable main-worktree clone**, the directory the self-updater will `git pull --ff-only origin main` + rebuild in. `canonicalRepoRoot()` resolves this via `git worktree list --porcelain` (which always lists the main worktree first), **not** the checkout the build ran from. This matters when a build runs inside an ephemeral `.claude/worktrees/*` checkout: baking that path would point self-update at a directory that disappears when the worktree is cleaned up, leaving the installed app reporting "update source unavailable" forever. Compilation still ships the current checkout's code; only the recorded self-update origin is canonicalized. Falls back to the build checkout path if git is unavailable / not a repo.
- `sha` — the `git rev-parse HEAD` at build time (`""` if git failed).
- `builtAt` — ISO timestamp.

The file is staged at `resources/bismuth-tools/build-origin.json`, the same resource dir the machine-wide install reads (see [machine-wide install](../mcp/overview.md)). At runtime the core sidecar receives that dir as `BISMUTH_INSTALL_SRC`, and `readBuildOrigin()` reads `${BISMUTH_INSTALL_SRC}/build-origin.json`. No `BISMUTH_INSTALL_SRC` or no file → `readBuildOrigin()` returns `null` → the updater self-disables.

---

## Backend: `core/src/selfUpdate.ts`

Three exported functions back the three `/update/*` routes. None ever throw — failures surface as an `error` phase or a `reason` string. (Full route shapes: [HTTP reference](../api/http-reference.md).)

### `getUpdateStatus()` → `UpdateStatus` (`GET /update/status`)

```ts
interface UpdateStatus {
  available: boolean;
  behind: number;          // commits HEAD is behind origin/main
  localSha: string | null;
  remoteSha: string | null;
  builtSha: string | null; // from build-origin.json
  dirty: boolean;          // working tree has uncommitted changes
  reason?: string;         // why unavailable, when applicable
}
```

Steps (all best-effort, injectable `GitRunner` for tests):

1. `readBuildOrigin()` — no origin/`repoRoot` → `{ available:false, reason:"not-a-source-build" }`.
2. `git -C <repoRoot> rev-parse --is-inside-work-tree` — fails → `reason:"not-a-git-repo"`.
3. `git fetch --quiet origin main` (best-effort, 20 s; offline still reports against the last-known remote).
4. `git rev-parse origin/main` — fails → `reason:"no-upstream"`.
5. `localSha = git rev-parse HEAD`, `remoteSha = origin/main`, `behind = git rev-list --count HEAD..origin/main`, `dirty = git status --porcelain` non-empty.
6. Return `{ available: behind > 0, behind, localSha, remoteSha, builtSha, dirty }`.

### `startUpdate()` → `UpdateProgress` (`POST /update/apply`)

Validates, sets `phase:"pulling"`, and fires the pipeline **without awaiting** so the HTTP request returns immediately; the frontend then polls progress. Idempotent while a run is in flight (returns the current `state` if already `pulling`/`building`).

Guard rails before kicking off:
- Not a bundled source build (no `build-origin.json` or no `BISMUTH_APP_PATH`) → `phase:"error"`, `"self-update unavailable (not a bundled source build)"`.
- `getUpdateStatus().available === false` → `phase:"idle"`, `"already up to date"`.
- `dirty` working tree → `phase:"error"`, `"the Bismuth repo has uncommitted changes — won't overwrite"`.

The pipeline (`runPipeline`):
1. `git pull --ff-only origin main` (120 s). Non-zero (diverged/conflict) → `phase:"error"` with the stderr tail.
2. `phase:"building"`, then `bun run tauri build --bundles app` in `<repoRoot>/app` (900 s). **`--bundles app` deliberately skips the `.dmg`**: self-update only swaps the `.app`, and the dmg packaging step (`bundle_dmg.sh`) is intermittently flaky, so building it would only add a failure mode. (`bun` is resolved via `Bun.which("bun", { PATH })` because in the compiled sidecar `process.execPath` is the sidecar binary, not bun.)
3. On build success: `spawnRelauncher(repoRoot, appPath)`, then `phase:"ready"`, `"update ready — relaunching…"`.

`buildPath()` augments `PATH` with `/opt/homebrew/bin`, `/usr/local/bin`, `~/.cargo/bin`, `~/.bun/bin`, `~/.local/bin` — a Finder-launched sidecar inherits only the minimal launchd `PATH`, so git/bun/cargo wouldn't otherwise resolve for a from-source rebuild.

### `getUpdateProgress()` → `UpdateProgress` (`GET /update/progress`)

Returns the in-memory `state`:

```ts
type UpdatePhase = "idle" | "pulling" | "building" | "ready" | "error";
interface UpdateProgress { phase: UpdatePhase; message?: string; log?: string }
```

`log` holds the tail (≤2000 chars) of git/build stderr on failure.

### The detached relauncher

`spawnRelauncher()` writes a one-shot bash script to `tmpdir()` and launches it with `nohup … &` so it **reparents to launchd and outlives the sidecar** (which dies when the app quits). The script:

```bash
NEW="<repoRoot>/app/src-tauri/target/release/bundle/macos/Bismuth.app"
DEST="<BISMUTH_APP_PATH>"          # the running /Applications/Bismuth.app
APP_PID="<BISMUTH_APP_PID>"
[[ -d "$NEW" ]] || exit 1
# wait up to 120s for the app to actually quit
if [[ -n "$APP_PID" ]]; then
  for _ in $(seq 1 240); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.5; done
fi
sleep 1
rm -rf "$DEST"
/usr/bin/ditto "$NEW" "$DEST"
/usr/bin/open "$DEST"
```

It waits on the app's pid, removes the old bundle, `ditto`-copies the freshly built `.app` into place, and reopens it. Its log goes to `/tmp/bismuth-update.log`.

---

## Frontend: detect → banner → apply

### `app/src/updateCheck.ts` — auto-check with boot retry

A module-level singleton that polls `GET /update/status` into an `updateStatus` signal:

- **Boot retry:** the sidecar may still be starting when the webview loads, so the first check retries every `BOOT_RETRY_MS` (4 s), up to `BOOT_MAX_TRIES` (60 ≈ 4 min), until it answers.
- **Periodic:** once reachable, re-checks every `PERIODIC_MS` (5 min).
- `check()` swallows fetch errors (returns `false` so a not-yet-reachable backend isn't surfaced). `recheckUpdate()` forces an immediate re-check (used after an apply no-ops).

In dev / non-source builds the backend returns `available:false`, so this is a harmless no-op.

**Opt-in app auto-update (`update.autoUpdate`, default off).** Every successful `check()` also calls `maybeAutoUpdate()`. When the setting is on **and** the just-fetched status is `available`, it drives the exact same pipeline as the banner button — without any click:

1. `POST /update/apply` (`api.applyUpdate()`); if it returns `phase:"error"`, bail (reset the once-guard so a later check can retry).
2. Poll `GET /update/progress` (`api.updateProgress()`) every 2 s; transient poll failures are ignored (keep polling).
3. On `phase:"ready"` → dynamically `import("@tauri-apps/api/core")` and `invoke("quit_app")` (the detached relauncher then swaps the `.app` + reopens). Outside Tauri the import/invoke is swallowed.
4. On `phase:"error"` / `phase:"idle"` → stop polling and reset the once-guard so a later check retries.

It runs at most once per session (a module-level `autoStarted` flag, reset only on the bail/error/idle paths). When the setting is **off** (the default) `maybeAutoUpdate()` returns immediately and the manual `UpdateBanner` path below is unchanged. It's a no-op in dev / non-source builds because the backend reports `available:false`.

### `app/src/UpdateBanner.tsx` — the slim top bar

Shown only when `updateStatus()?.available` and not dismissed. Reads `behind` to render "Bismuth update available — N commit(s) behind". The **UPDATE** button's `update()` flow:

1. `POST /update/apply` (`api.applyUpdate()`). If it comes back `phase:"error"`, toast the message and stop.
2. Poll `GET /update/progress` (`api.updateProgress()`) every 2 s, reflecting `phase` in the button ("Pulling…" → "Building… (a few min)" → "Relaunching…"). Transient poll failures are ignored (keep polling).
3. On `phase:"ready"` → call `quitApp()`.
4. On `phase:"error"` → toast `message`, re-enable. On `phase:"idle"` (already up to date) → stop + `recheckUpdate()`.

`quitApp()` dynamically imports `@tauri-apps/api/core` and `invoke("quit_app")`. If that import/invoke fails (e.g. not in Tauri), it falls back to a toast: "Update built — quit and reopen Bismuth to apply it."

---

## On-launch daemon install + opt-in app self-update

The daemon updates **with the app** — there is no separate git-pull daemon auto-update. The bundled `@bismuth/daemon` runtime ships baked into the `.app` (staged at `resources/daemon`); a fresh app build means a fresh daemon binary, copied into place on the next boot.

### 1. The `@bismuth/daemon` service — `core/src/daemonInstall.ts`

On every server boot the sidecar fires `installDaemonFromBundle()` (without awaiting) from `core/src/server.ts`:

```ts
// Boot-time: install/refresh the bundled daemon as a launchd/systemd service so it keeps
// running while the app is closed. No-op in dev (no BISMUTH_DAEMON_BUNDLE); best-effort.
void installDaemonFromBundle();
```

There is **no `BISMUTH_APP_PATH` gate and no git pull** — it's a bundle-copy + service-register, not a self-update of the daemon's source:

- No `BISMUTH_DAEMON_BUNDLE` env (dev / standalone) → no-op. Otherwise it reads the bundled binary at `${BISMUTH_DAEMON_BUNDLE}/bin/bismuth-daemon`.
- **Version-gated by a marker** (`~/.bismuth/.daemon-installed`, holding the source binary's `size:mtime`): if the marker matches and the installed binary exists, it just re-ensures the service (`runSetup()`) and returns; otherwise it copies the binary to `~/.bismuth/bin/bismuth-daemon` (via a temp file + atomic `rename`, to dodge `ETXTBSY` when the running service holds the old inode), rewrites the marker, and runs `runSetup()`.
- `runSetup()` runs `<bin> --ensure-installed`, which writes the launchd plist / systemd unit pointing at that stable installed path (service ids: launchd `com.bismuth.daemon`, systemd `bismuth-daemon`). `SetupResult` is `{ ok, binPath, error? }`.
- `installStatus()` shells out to `<bin> --status` → `InstallStatus = { installed, running, binPath }`.
- Best-effort throughout: every function catches and never throws, so a failed daemon install can never block the app.

The daemon was absorbed from the former standalone **claude-bot** repo into the in-repo `@bismuth/daemon` workspace (`daemon/src/**`) — one machine process that multiplexes per-vault brains. Machine identity (device-id, devices.json, owner.json, daemon.pid, logs, vaults.json) lives at `~/.bismuth/daemon`; each enabled vault's brain (crons, processes, memory, session-id, `identity.md`) lives under `<vault>/.daemon`. There is **no `daemon.autoUpdate`/`daemon.home` setting** (the schema `daemon` object has only `enabled`) and **no git-pull self-update path** for it. The manual equivalent of the boot install is `POST /daemon/update`, which also just calls `runSetup()` (re-registers the service); it does not pull source.

### 2. The Bismuth app itself — `update.autoUpdate`

The app's own background self-update lives on the **frontend**, driven by `maybeAutoUpdate()` in `app/src/updateCheck.ts` (detailed above). It is **opt-in via `update.autoUpdate`** (default `false`): when on and a status check reports an available update, it auto-applies the same `POST /update/apply` → poll-progress → `quit_app` pipeline and relaunches when the rebuild is ready; when off (the default), nothing happens automatically and the manual `UpdateBanner` is the only path. It's a no-op in dev / non-source builds because the backend reports `available:false`.

---

## Tauri plumbing: `app/src-tauri/src/lib.rs`

The env the self-updater depends on is injected here when the bundled app spawns its core sidecar (`start_backend`):

- **`BISMUTH_INSTALL_SRC`** — set to the bundled `resources/bismuth-tools` dir (which contains `build-origin.json`). Also drives the machine-wide install. `readBuildOrigin()` reads from here.
- **`BISMUTH_APP_PATH`** — the running `…/Bismuth.app` path, derived from `current_exe()` by walking ancestors for the `.app` extension (`running_app_path()`). `None` in dev (the binary isn't inside a `.app`), which self-disables the updater.
- **`BISMUTH_APP_PID`** — `std::process::id()` of the Tauri app, so the relauncher knows which pid to wait on.

The **`quit_app`** Tauri command is a one-liner registered in the invoke handler:

```rust
#[tauri::command]
fn quit_app(app: tauri::AppHandle) { app.exit(0); }
```

The frontend invokes it once `phase:"ready"`; the app exits, the detached relauncher (waiting on `BISMUTH_APP_PID`) swaps the bundle and reopens it.

---

## Why it self-disables in dev / non-source builds

| Condition | Effect |
|---|---|
| `bun run dev` | The Tauri setup only spawns its own backend when `!cfg!(debug_assertions)`; the dev backend has no `BISMUTH_APP_PATH`/`BISMUTH_INSTALL_SRC` injected → `getUpdateStatus()` → `reason:"not-a-source-build"`. |
| Build with no `build-origin.json` | `readBuildOrigin()` → `null` → `reason:"not-a-source-build"`. |
| `repoRoot` isn't a git checkout | `reason:"not-a-git-repo"`. |
| No `origin/main` upstream | `reason:"no-upstream"`. |
| Dirty working tree | Status still reports `available`, but `POST /update/apply` refuses (`"won't overwrite"`). |

---

## Related

- [Machine-wide install (CLI + MCP)](../mcp/overview.md) — the sibling install path that shares `BISMUTH_INSTALL_SRC` and the bundled tools resource.
- [HTTP API reference](../api/http-reference.md) — exact shapes of `/update/status`, `/update/apply`, `/update/progress`, `/bismuth/install`.
- [Install & run](install.md) — building the bundled app from source.

Source: core/src/selfUpdate.ts, app/src/updateCheck.ts, app/src/UpdateBanner.tsx, app/src-tauri/src/lib.rs, app/scripts/build-bismuth-tools.ts, core/src/server.ts, core/src/daemonInstall.ts, core/src/schema/settingsSchema.ts, app/src/api.ts
