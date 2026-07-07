# The Daemon Supervisor & Lifecycle

The daemon is Bismuth's always-on background runtime — the in-repo `@bismuth/daemon` workspace (`daemon/src/**`). It is **one machine process that multiplexes many per-vault "brains"**: launched by launchd (macOS) or systemd (Linux), it stays resident and, for **every vault whose `settings.daemon.enabled` is on**, supervises that vault's background processes, runs its crons, recovers interrupted work after a crash, and (on the owner device) holds a persistent conversation session. Machine-level identity (device-id, owner, devices, pid, logs) lives in one place; each vault's brain (crons, processes, memory, session-id, identity) lives under `<vault>/.daemon`.

This page documents the process lifecycle (`daemon/src/daemon/index.ts`), the per-vault session funnel (`daemon/src/daemon/session.ts`), the single-owner device gating it leans on (`daemon/src/lib/owner.ts`), and the install/service glue (`core/src/daemonInstall.ts` + `daemon/src/lib/platform.ts`).

Cross-links: [overview.md](overview.md) (Bismuth's read window onto the daemon), [crons-and-processes.md](crons-and-processes.md) (the scheduler + process supervisor), [storage.md](storage.md) (the on-disk layout), [memory.md](memory.md) (the 3rd-brain memory store), [communication.md](communication.md) (sessions, MCP tools, relay hooks). README: [../README.md](../README.md).

---

## One runtime, many brains

The daemon is a single OS service, but the state it manages is split across two scopes:

- **Machine scope** — `MACHINE_DIR` (`daemon/src/lib/config.ts`), resolved as `BISMUTH_DAEMON_DIR || ~/.bismuth/daemon`. Holds the per-machine identity + runtime state that has nothing to do with any one vault: `device-id`, `devices.json`, `owner.json`, `daemon.pid` (`MACHINE_PID_FILE`), `logs/`, and `vaults.json` (`VAULTS_FILE` — the registry of known vault roots, written by Bismuth core).
- **Vault scope** — `<vault>/.daemon` for each enabled vault, resolved by `vaultPaths(root, name)` into a `VaultContext` carrying every path the runtime touches for that vault: `crons/`, `processes/`, `memory/`, `logs/`, `identity.md`, `session-id`, plus the cron bookkeeping files (`.last-fired.json`, `.running.json`, `.triggers/`).

The session, cron, and process modules are all threaded a `VaultContext`, so concurrent vault brains never collide on a process-global anything.

> **Note:** `~/.claude-bot` is not the daemon's home. It survives only as a one-time, copy-only legacy migration source — `migrateDaemonState` (`core/src/daemon.ts`) copies a legacy `~/.claude-bot/{memory,crons,processes}` into a vault's `.daemon` on first enable, gated by a `.claude-bot-migrated` machine marker, and never deletes the source.

---

## The daemon process (`daemon/src/daemon/index.ts`)

The runnable entry compiles to a bundled sidecar binary run as a service. Its `main()` is wrapped in `.catch()` that logs `"Fatal error: …"` and calls `process.exit(1)` — any unhandled rejection in boot takes the whole process down with a non-zero exit so the service manager restarts it. (The same file also handles two CLI modes — see [Install & service lifecycle](#install--service-lifecycle).)

### Helpers

| Helper | Responsibility |
| --- | --- |
| `log(message)` | Prefixes each line with an ISO timestamp before `console.log`. |
| `ensureDirs()` | `mkdir -p` of the **machine-only** dirs: `MACHINE_DIR` and `MACHINE_LOGS_DIR`. Not per-vault. |
| `ensureVaultDirs(ctx)` | `mkdir -p` of one vault's brain dirs (`daemonDir`, `memoryDir`, `cronsDir`, `processesDir`, `logsDir`), then `reconcileSeeds(ctx)` (see [Seeding](#seeding-reconcileseeds)). |
| `writePid()` | Writes `String(process.pid)` to `MACHINE_PID_FILE` (`~/.bismuth/daemon/daemon.pid`). |
| `removePid()` | Unlinks `MACHINE_PID_FILE`, swallowing any error. Only runs on graceful shutdown — a crash/SIGKILL leaves the pid file behind, so liveness is checked by `process.kill(pid, 0)`, not mere file presence. |

### Boot order (`main()`)

The boot sequence is **load-bearing** — each step depends on the side effects of the previous one. Do not reorder.

1. **`ensureDirs()`** — create the machine-level home + logs dir before anything reads or writes them.
2. **`writePid()`** — write `daemon.pid` so liveness checks (and Bismuth core) can find this process.
3. Log `Daemon starting (PID …)`.
4. **`heartbeatDevice()`** — upsert this device's `devices.json` entry immediately, so the device is selectable as owner before any other step.
5. **`isOwner()`** — resolve ownership **once** for this boot pass. A non-owner logs `"Not the owner device — idling (heartbeating only, no sessions)"` and still proceeds (it supervises processes + heartbeats, just never holds a session).
6. **Per enabled vault — `startVault(ctx, { owner, boot: true })`** — for each `ctx` from `loadEnabledVaults()`, bring that vault's brain fully online (reap → processes → triggers → cron recovery → owner session; detailed below).
7. **`startCronScheduler()`** — start the single 60s tick loop (`CRON_CHECK_INTERVAL_MS`). The scheduler **self-multiplexes**: it re-reads `loadEnabledVaults()` each tick and fans out across every enabled vault, so a newly enabled vault's crons fire without a restart.
8. **Reconcile loop** — `setInterval(reconcileVaults, CRON_CHECK_INTERVAL_MS)` so the set of running brains tracks `settings.daemon.enabled` across all vaults at runtime (detailed below).
9. **Signal handlers** — bind `SIGTERM` and `SIGINT` to `shutdown(signal)`.

### Bringing a vault's brain online (`startVault(ctx, { owner, boot })`)

1. **`ensureVaultDirs(ctx)`** — create the vault's brain dirs and seed any missing defaults.
2. **`reapOrphans(ctx)`** — *boot only.* Kill leftover child processes from a *previous* daemon instance **before** spawning fresh ones; otherwise survivors accumulate as duplicates on every restart. Skipped at runtime-enable because a cross-vault reap could kill a sibling vault's identical-argv process (`spawnProcess` does its own per-def defensive reap instead).
3. **`startProcesses(ctx)`** — spawn the vault's enabled background processes.
4. **`startProcessTriggers(ctx)`** — begin the per-vault trigger watcher (external programs flip a process's frontmatter + drop a trigger file; the loop reconciles runtime ↔ disk).
5. **`startFileWatch(ctx)`** — start the vault's ONE recursive `fs.watch` (`daemon/src/daemon/fileWatch.ts`), debounced (default 2s) and fanned out across every enabled `on: file-change` cron on each batch. No-ops if this vault already has a live watcher. See [crons-and-processes.md](crons-and-processes.md#file-change-crons).
6. **`recoverInterruptedCrons(ctx)`** — *boot only.* Re-fire crons that were mid-run when the daemon last died, **before** the scheduler ticks. Safe before session init because cron fires use `newSession: true`. Skipped at runtime-enable: the scheduler is already ticking, so recovery could observe a job the live tick just fired and wrongly `markDone()` it (corrupting `.running.json`) — and the scheduler's own catch-up covers overdue jobs anyway.
7. **Owner-only session init** — *boot + owner only.* `sendMessage(DAEMON_BOOT_PROMPT, ctx, { newSession: true })` wakes the persistent session. On failure it logs a warning and **continues** (the session is created lazily on the first cron/message anyway). A vault enabled at runtime skips this and wakes its session lazily.
8. Add `ctx.root` to the in-memory `activeVaults` set.

The boot prompt (`DAEMON_BOOT_PROMPT`) is:

> You are now running as a background daemon for this vault. Check memory for prior context.

### The reconcile loop (`reconcileVaults()`)

Runs every `CRON_CHECK_INTERVAL_MS`. It diffs the registry (`loadAllVaults()`, each `{ ctx, enabled }`) against the live `activeVaults` set so a vault that opted **in** to or **out** of the daemon takes effect without a restart:

- `enabled && !active` → `startVault(ctx, { owner, boot: false })` (the runtime-enable path: no reap, no recovery, lazy session).
- `!enabled && active` → `stopVault(ctx)` — tear down that vault's trigger loop, file watcher, + managed children. **Never deletes on-disk state — disable = pause.**
- A vault dropped from the registry entirely (not just disabled) won't appear in `loadAllVaults()`, so any still-`active` root not `seen` this pass is also paused (via `vaultPaths(root)`), so its processes don't leak.

Because the cron scheduler re-reads the enabled set itself, reconcile only manages per-vault process supervision + sessions — not crons.

### Graceful shutdown (`shutdown(signal)`)

Bound to `SIGTERM` and `SIGINT`:

1. Clear the reconcile interval.
2. `stopCronScheduler()`.
3. `stopProcessTriggers()` — global; tears down every vault's trigger loops.
4. `stopAllFileWatches()` — global; closes every vault's `fs.watch` (`daemon/src/daemon/fileWatch.ts`).
5. `await waitForRunningJobs(SHUTDOWN_TIMEOUT_MS)` — `SHUTDOWN_TIMEOUT_MS = 10000`. Waits for in-flight cron jobs to finish (aborting on timeout).
6. `await stopProcesses()` — global; stops every vault's managed children.
7. `activeVaults.clear()`.
8. `removePid()`.
9. Log `"Daemon stopped"` and `process.exit(0)`.

---

## The persistent session (`daemon/src/daemon/session.ts`)

Each vault's brain has **its own resumable session**. `session.ts` wraps the `@anthropic-ai/claude-agent-sdk` `query()` API; the session id is persisted per-vault at `<vault>/.daemon/session-id` (`ctx.sessionFile`), so the single runtime resumes the right thread for each vault. The session runs against the user's **own installed `claude` binary** (machine-login auth, no API key): because the compiled daemon doesn't bundle the SDK's native CLI and runs under launchd with a minimal PATH, `whichClaude()` resolves the real binary once and passes it via `pathToClaudeCodeExecutable`.

### Session id persistence

| Function | Behavior |
| --- | --- |
| `getSessionId(ctx)` | Reads + trims `ctx.sessionFile`; returns `undefined` if absent or empty. |
| `saveSessionId(ctx, id)` | `mkdir` `ctx.daemonDir`, then writes the id to `ctx.sessionFile`. Called whenever the SDK stream emits a new `session_id`. |

### `sendMessage(message, ctx, opts?)` — the single funnel

Every message to a vault's bot — daemon boot, cron fires, MCP-driven messages — flows through `sendMessage`, returning `{ result, sessionId }`.

```ts
interface SendOptions {
  model?: string;
  effort?: string;
  abortController?: AbortController;
  timeoutSecs?: number;   // session timeout; AbortController fires when exceeded
  newSession?: boolean;   // start fresh instead of resuming
}
```

**Owner gating (CONTRACT v1).** Before anything, `sendMessage` checks `await isOwner()`. If this is **not** the owner device it **throws** — non-owner devices must never hold a session or talk to the model. Ownership is machine-level (`owner.json` under `MACHINE_DIR`), not per-vault. An unclaimed install (no `owner.json`) makes `isOwner()` return `true`, preserving single-device behavior.

**SDK options it builds (all per-vault):**

| Option | Value |
| --- | --- |
| `permissionMode` | `"bypassPermissions"` |
| `allowDangerouslySkipPermissions` | `true` |
| `cwd` | `ctx.root` (the vault root) |
| `env` | `{ ...process.env, BISMUTH_MEMORY_DIR: ctx.memoryDir }` — points the memory tools at this vault's brain |
| `appendSystemPrompt` | `buildSystemPrompt(ctx)` — `"You are <name>."` + `<vault>/.daemon/identity.md` body (or the default personality), read **fresh per session** so edits take effect next message |
| `model` | `opts.model ?? "haiku"` |
| `pathToClaudeCodeExecutable` | the resolved user `claude` binary (when found) |
| `thinkingBudget` (from `effort`) | `"high"` → high, `"low"` → low, otherwise medium |

**Abort + timeout.** An `AbortController` is created if either `abortController` or `timeoutSecs` is given. When `timeoutSecs > 0`, a `setTimeout` calls `ac.abort()` and logs `[session:<name>] Timeout reached (Ns), aborting session`.

**Resume vs new.** If `existingSessionId && !opts.newSession`, it sets `options.resume = existingSessionId` (continue this vault's session). Otherwise it starts fresh. **Crons always pass `newSession: true`** — each cron runs in its OWN session, isolated from the persistent vault session.

**Streaming.** It streams events from `query()`; on a new `session_id` it `saveSessionId`s; it captures result text from the `(type: "result", subtype: "success")` message; and it clears the timeout in a `finally` block.

---

## Seeding (`reconcileSeeds`)

`ensureVaultDirs(ctx)` ends by calling `reconcileSeeds(ctx)` (`daemon/src/daemon/seeds.ts`) — the daemon's analog of core's `reconcileSettings`. It runs every time a vault's brain comes online (boot or runtime-enable) and writes only what's **MISSING**:

- A fresh vault gets the full set.
- An already-set-up vault that predates a NEW seedable gets JUST that new piece on the next boot — existing files are never touched (user edits and deliberate `enabled: false` survive).

`seedsFor(ctx)` is the single declarative registry of what gets seeded:

- **`<vault>/.daemon/identity.md`** — `---\nname: daemon\n---` + the `DEFAULT_DAEMON_IDENTITY` body. The `name:` frontmatter is the daemon's display name (drives `ctx.name` and the `"You are <name>"` prefix); the body is its editable personality/system prompt.
- **The default crons** (`daemon/src/daemon/defaultCrons.ts`, `DEFAULT_CRONS`) — embedded as string constants (not files) so they survive `bun build --compile`: **`dream`** (hourly memory consolidation, `schedule: 0 * * * *`) and **`vault-review`** (every-4h model-of-the-user pass, `schedule: 0 */4 * * *`). To disable one, set `enabled: false` rather than deleting it (a deleted seed is re-written on next boot).

Adding a future seedable is one line: append an entry to `seedsFor()`.

---

## Single-owner device gating (`daemon/src/lib/owner.ts`)

Single-owner semantics across multiple devices, machine-scoped under `MACHINE_DIR`:

- **`devices.json`** — `{ "<deviceId>": { label, lastSeenISO } }`. Every daemon UPSERTS its own entry each tick (heartbeat), even when idle or non-owner, so it stays selectable as a future owner. `deviceId` is a stable UUID persisted at `MACHINE_DIR/device-id` (`daemon/src/lib/device.ts`); `label` is `os.hostname()`.
- **`owner.json`** — `{ ownerDeviceId, ownerLabel, updatedAt }`. **Absent file = UNCLAIMED** ⇒ `isOwner()` is `true` (legacy / single-device behavior). Otherwise `isOwner()` is `ownerDeviceId === thisDeviceId`.
- **`heartbeatDevice(home?)`** — atomic (`tmp` + `rename`) upsert of this device's entry with a fresh `lastSeenISO`.
- **`setOwnerDevice(deviceId)`** — claims ownership, but rejects a device not already present in `devices.json` (a device must heartbeat before it can be made owner). Writes `owner.json` byte-compatibly with what Bismuth core reads.

Only the owner device holds sessions and fires the model; a non-owner heartbeats and supervises processes but stays idle. (Writes are atomic via `tmp`+`rename` to survive a crash mid-write.)

### Daemon-process identity (`isDaemonProcess`)

`isDaemonProcess(pidFile = MACHINE_PID_FILE)` (`daemon/src/lib/platform.ts`) returns `true` only when the calling process's pid equals the pid in `daemon.pid`. Because `process.ts` keeps its `managed` child map at module scope, a non-daemon importer (terminal-launched MCP, plugin cache, dev hot-reload) would fork untracked children; mutating process MCP tools gate on this so only the real daemon process can drive them. Read-only tools work everywhere.

---

## Install & service lifecycle

The daemon ships as a bundled, compiled binary and runs as a launchd/systemd **service** — NOT a Tauri child — because it must outlive the app to keep firing crons. Installation is **app-driven** (`core/src/daemonInstall.ts`); the daemon updates *with* the app, so there is **no git-pull self-update** (the schema `daemon` object has only `enabled`).

### Boot-time install from the bundle (`core/src/daemonInstall.ts`)

On app boot, core calls `installDaemonFromBundle()`:

- No-op in dev (no `BISMUTH_DAEMON_BUNDLE` env).
- Reads the staged binary at `<BISMUTH_DAEMON_BUNDLE>/bin/bismuth-daemon`, version-gated by a marker (`~/.bismuth/.daemon-installed`, the source binary's `size:mtime` signature) so it only re-copies when a new app build ships a new daemon.
- Copies to a temp file then **atomically renames** over `~/.bismuth/bin/bismuth-daemon` (`daemonBinPath()`, env override `BISMUTH_DAEMON_BIN`). The rename avoids `ETXTBSY` on Linux when the currently-running service binary is the destination — the running process keeps its old inode, the new binary is in place for the next restart.
- Then calls `runSetup()`.

All functions are best-effort and **never throw** — a failed daemon install must never block the app.

### Self-install (`<bin> --ensure-installed`)

`runSetup()` spawns `<bin> --ensure-installed`. That CLI mode (`daemon/src/daemon/index.ts` → `ensureInstalled()`) writes the launchd plist / systemd unit pointing at the stable installed binary path (passed via `BISMUTH_DAEMON_BIN`) and loads it: it `installDaemon()`s when the config is absent, or `reloadDaemon()`s when it already exists. Idempotent.

`installStatus()` spawns `<bin> --status`, whose `printStatus()` reports `{ installed, running, label }` — `installed` = the plist/unit exists; `running` = `daemon.pid` exists **and** that pid is alive (`process.kill(pid, 0)`), matching how core's `daemon.ts` gates "running". The result is `InstallStatus = { installed, running, binPath }`.

These are wired into core's HTTP API (read-table, never `mutatingHandler`): `GET /daemon/install-status` → `installStatus()`; `POST /daemon/install` and `POST /daemon/update` → `runSetup()`.

### Service definitions (`daemon/src/lib/platform.ts`)

| Item | macOS (launchd) | Linux (systemd) |
| --- | --- | --- |
| Service id | `LAUNCHD_LABEL` = `com.bismuth.daemon` | `SYSTEMD_SERVICE_NAME` = `bismuth-daemon` |
| Config path | `~/Library/LaunchAgents/com.bismuth.daemon.plist` | `~/.config/systemd/user/bismuth-daemon.service` |
| Keep-alive | `RunAtLoad` + `KeepAlive` both `true` | `Type=simple`, `Restart=always`, `RestartSec=5` |
| Working dir | `MACHINE_DIR` | `MACHINE_DIR` |
| stdout / stderr | `<MACHINE_DIR>/logs/bismuth-daemon.stdout.log` / `…stderr.log` | same (`append:`) |

`generateDaemonConfig(opts)` renders the plist or unit; `installDaemon` / `reloadDaemon` / `unloadDaemon` drive `launchctl` (`load`/`unload`) or `systemctl --user` (`daemon-reload`/`enable --now`/`restart`/`stop`/`disable`). `restartDaemon()` bounces the service in place without rewriting config (`launchctl kickstart -k gui/<uid>/<label>` or `systemctl --user restart`).

### How Bismuth detects a running daemon

Bismuth core reads `MACHINE_DIR/daemon.pid` and does a `process.kill(pid, 0)` liveness check (`core/src/daemon.ts`) to power the "daemon" graph mode + sidebar. The pid file is created by `writePid()` and removed only on graceful shutdown, so the liveness check (not file presence) is authoritative. See [storage.md](storage.md) and [overview.md](overview.md).

---

## Constants (`daemon/src/lib/config.ts`)

| Constant | Value |
| --- | --- |
| `MACHINE_DIR` | `BISMUTH_DAEMON_DIR || ~/.bismuth/daemon` |
| `CRON_CHECK_INTERVAL_MS` | `60000` (scheduler tick + reconcile loop) |
| `TRIGGER_CHECK_INTERVAL_MS` | `5000` |
| `SHUTDOWN_TIMEOUT_MS` | `10000` |
| `SHUTDOWN_POLL_MS` | `500` |
| `DEFAULT_CRON_TIMEOUT` | `300` (seconds) |
| `LAUNCHD_LABEL` | `com.bismuth.daemon` |
| `SYSTEMD_SERVICE_NAME` | `bismuth-daemon` |

---

Source: daemon/src/daemon/{index,session,seeds,defaultCrons}.ts, daemon/src/lib/{config,owner,device,platform}.ts, core/src/{daemon,daemonInstall}.ts
</content>
</invoke>
