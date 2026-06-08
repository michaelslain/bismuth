# The claude-bot Daemon Supervisor

The daemon is claude-bot's always-on background process. It is launched by launchd (macOS) or systemd (Linux) and stays resident: it spawns and supervises background processes, runs the cron scheduler, recovers interrupted work after a crash, heartbeats this device into the multi-device roster, and — on the owner device only — holds the persistent bot session. This page documents the process lifecycle (`daemon/index.ts`), the persistent session funnel (`daemon/session.ts`), and the owner-gating / platform glue it leans on.

Cross-links: [crons-and-processes.md](crons-and-processes.md) (the scheduler + process supervisor in depth), [install.md](install.md) (launchd/systemd units + adopt-only install), [storage.md](storage.md) (the on-disk layout). For Bismuth's read-only window onto a running daemon, see [../daemon/overview.md](../daemon/overview.md) and [../daemon/storage.md](../daemon/storage.md).

## The daemon process (`daemon/index.ts`)

The daemon's entry point is launched by the OS service manager (see [install.md](install.md)). Its top-level body is `main()`, wrapped in a `.catch()` that logs `"Fatal error"` and calls `process.exit(1)` — any unhandled rejection in boot takes the whole process down with a non-zero exit so the service manager can restart it.

### Helpers

| Helper | Responsibility |
| --- | --- |
| `log(...)` | Prefixes each line with an ISO timestamp before writing it. |
| `ensureDirs()` | `mkdir -p` of `BOT_DIR`, `LOGS_DIR`, `CRONS_DIR`, `MEMORY_DIR`, `PROCESSES_DIR`. |
| `writePid()` | Writes `String(process.pid)` to `PID_FILE` (`~/.claude-bot/daemon.pid`). |
| `removePid()` | Unlinks `PID_FILE`, swallowing any error. |

### Boot order (`main()`)

The boot sequence is **load-bearing** — each step depends on the side effects of the previous one. Do not reorder.

1. **`ensureDirs()`** — every later step assumes `BOT_DIR` and its subdirectories exist.
2. **`writePid()`** — writes `daemon.pid` so liveness checks (and Bismuth) can find this process.
3. **`reapOrphans()`** — kills leftover child processes from a *previous* daemon instance **before** spawning fresh ones. If a crash left children alive, skipping this would accumulate duplicate processes on every restart.
4. **`startProcesses()`** — spawns the enabled background processes.
5. **`startProcessTriggers()`** — begins polling `processes/.triggers` and reconciling process state in a loop.
6. **`recoverInterruptedCrons()`** — re-fires crons that were mid-run when the daemon last died, **before** the scheduler starts. Order matters: if the catch-up scheduler ran first it could `markRunning` a job, and then recovery's `markDone` would mark a live job as finished and wipe `.running.json`. Recovery is safe to run before session init because `fireJob` uses `newSession: true` (each cron gets its own session — see below).
7. **`heartbeatDevice()`** — writes this device's `devices.json` entry immediately, so the device is selectable as owner before the first scheduler tick.
8. **`startCronScheduler()`** — starts the 60s tick loop. The loop keeps heartbeating and gates firing on ownership: it runs on **every** device, but only the owner actually fires crons.
9. **Owner-only session init** — `if (isOwner())`, initialize the persistent bot session by calling `sendMessage(...)` with:

   > You are now running as a background daemon. Check memory for any prior context. Set up any crons you need.

   This "can take 30+ seconds." On failure it logs a warning and **continues** — the session is lazily created on the first message anyway. A non-owner device instead logs `"Not the owner device — idling (heartbeating only, no session, no crons)"`.

### Graceful shutdown (`shutdown(signal)`)

Bound to `SIGTERM` and `SIGINT`. The sequence:

1. `stopCronScheduler()`
2. `stopProcessTriggers()`
3. `await waitForRunningJobs(SHUTDOWN_TIMEOUT_MS)` — `SHUTDOWN_TIMEOUT_MS = 10000`. Polls every `SHUTDOWN_POLL_MS = 500`ms for in-flight cron jobs to finish; on timeout it aborts every running cron's `AbortController`.
4. `await stopProcesses()`
5. `removePid()`
6. log `"Daemon stopped"`
7. `process.exit(0)`

## The persistent session (`daemon/session.ts`)

The bot is **one resumable session**. `session.ts` wraps the `@anthropic-ai/claude-agent-sdk` `query()` API, and the session id is persisted at `~/.claude-bot/session-id` (`SESSION_FILE`). This session has full Claude Code capabilities (bash, files, subagents), the claude-bot MCP memory tools, and the `~/.claude-bot/CLAUDE.md` personality.

### Session id persistence

| Function | Behavior |
| --- | --- |
| `getSessionId()` | Reads + trims `SESSION_FILE`; returns `undefined` if absent or empty. |
| `saveSessionId(id)` | `mkdir` `BOT_DIR`, then writes the id to `SESSION_FILE`. |

### `sendMessage(message, opts?)` — the single funnel

Every message to the bot — daemon boot, cron fires, MCP-driven messages — flows through `sendMessage`. It returns a `BotResponse` of `{ result: string, sessionId: string }`.

```ts
type SendOptions = {
  model?: string;
  effort?: "high" | "low" | string;
  abortController?: AbortController;
  timeoutSecs?: number;
  newSession?: boolean;
};
```

**Owner gating (CONTRACT v1).** Before doing anything, `sendMessage` checks `await isOwner()`. If this is **not** the owner device, it **throws** — non-owner devices must never hold a session or talk to the model. An unclaimed install (no `owner.json`) makes `isOwner()` return `true`, preserving normal single-device behavior.

**SDK options it builds:**

| Option | Value |
| --- | --- |
| `permissionMode` | `"bypassPermissions"` |
| `allowDangerouslySkipPermissions` | `true` |
| `cwd` | `BOT_DIR` |
| `model` | `opts.model ?? "haiku"` |
| `thinkingBudget` (from `effort`) | `"high"` → high, `"low"` → low, otherwise medium |

**Abort + timeout.** An `AbortController` is created if either `abortController` or `timeoutSecs` is given. When `timeoutSecs > 0`, a `setTimeout(timeoutSecs * 1000)` calls `ac.abort()` and logs `"[session] Timeout reached (Ns), aborting session"`.

**Resume vs new.** If `existingSessionId && !opts.newSession`, it sets `options.resume = existingSessionId` (continue the persistent session). Otherwise it starts fresh. **Crons always pass `newSession: true`** — each cron runs in its OWN session, isolated from the persistent daemon session.

**Streaming.** It streams events from `query()`; when a new `session_id` arrives it calls `saveSessionId`; it captures the result text from the `(type: "result", subtype: "success")` message; and it clears the timeout in a `finally` block.

## Owner gating / multi-device (`lib/owner.ts`)

Single-owner semantics across multiple devices. Full detail lives in [install.md](install.md) and [storage.md](storage.md); the contract:

- **`isOwner(home?)`** — `owner.json` absent → `true`; otherwise `ownerDeviceId === thisDeviceId`.
- **`heartbeatDevice(home?)`** — upserts `devices[deviceId] = { label: os.hostname(), lastSeenISO: <ISO> }`. Called every cron tick even when idle or non-owner, so a device stays selectable as a future owner.
- Every cron tick and **both** trigger loops re-check `isOwner()`. Non-owner devices heartbeat and consume triggers, but never fire crons, never start/stop processes, never recover interrupted work, and never hold a session.

## launchd / systemd (`lib/platform.ts`)

How the OS keeps the daemon alive. Full plist/unit text is in [install.md](install.md); the constants:

**macOS (launchd):**

| Item | Value |
| --- | --- |
| `LAUNCHD_LABEL` | `com.claude-bot.daemon` |
| plist | `~/Library/LaunchAgents/com.claude-bot.daemon.plist` |
| Keep-alive | `RunAtLoad` + `KeepAlive` both `true` |
| stdout / stderr | `~/.claude-bot/logs/claude-bot.stdout.log` / `…/claude-bot.stderr.log` |
| `WorkingDirectory` | `BOT_DIR` |

**Linux (systemd):**

| Item | Value |
| --- | --- |
| `SYSTEMD_SERVICE_NAME` | `claude-bot` |
| unit | `~/.config/systemd/user/claude-bot.service` |
| service | `Type=simple`, `Restart=always`, `RestartSec=5` |

**`isDaemonProcess(pidFile = PID_FILE)`** — returns `true` only when the calling process's pid equals the pid stored in `daemon.pid`. Used to gate the mutating process MCP tools so only the real daemon process can drive them.

## `daemon.pid` (cross-link)

Bismuth detects a running daemon by reading `~/.claude-bot/daemon.pid` and doing a `process.kill(pid, 0)` liveness check. See [../daemon/storage.md](../daemon/storage.md) and [../daemon/overview.md](../daemon/overview.md).

## Constants (`lib/config.ts`)

| Constant | Value |
| --- | --- |
| `CRON_CHECK_INTERVAL_MS` | `60000` |
| `TRIGGER_CHECK_INTERVAL_MS` | `5000` |
| `SHUTDOWN_TIMEOUT_MS` | `10000` |
| `SHUTDOWN_POLL_MS` | `500` |

---

Source: daemon/index.ts, daemon/session.ts, lib/owner.ts, lib/platform.ts, lib/config.ts
