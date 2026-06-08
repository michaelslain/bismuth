# Crons & Background Processes

claude-bot's daemon runs two kinds of recurring work off the same on-disk pattern: **crons** (markdown files that fire a scheduled Claude session) and **background processes** (markdown files that supervise a long-lived child process). Both are plain `.md` files under `~/.claude-bot`, parsed by the same frontmatter reader, watched by the same daemon, and driven through the same UNLINK-FIRST trigger discipline — but with deliberately different runtime semantics (a cron trigger *fires a run*; a process trigger *reconciles runtime to disk*).

This page is the code-anchored reference for both. Bismuth reads and minimally writes these same files to power the "daemon" graph and `DaemonList` controls — see [../daemon/overview.md](../daemon/overview.md) and [../daemon/storage.md](../daemon/storage.md).

## Shared frontmatter parser (`lib/frontmatter.ts`)

Every cron and process file is parsed by `parseFrontmatter(content)`. It is **not** a YAML parser — understanding its quirks is a prerequisite for everything below.

- Fence regex: `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/`. No fence at the top of the file → `{ frontmatter: {}, body: content.trim() }`.
- Each frontmatter line is split on the **first `:` only**; lines without a colon are skipped.
- **Every value is a raw, trimmed string.** There is no type coercion — `enabled: false` parses to the string `"false"`, not the boolean `false`. This is why the code keys everything off the sentinels `!== "false"` (opt-out, default true) and `=== "true"` (opt-in, default false).
- Keys are kept in **insertion order**, so a rewrite can preserve field order.
- `body` is everything after the closing `---` fence. For crons the body is the prompt; for processes the body is unused.

## Filesystem layout (`lib/config.ts`)

| Constant | Value |
| --- | --- |
| `BOT_DIR` | `~/.claude-bot` |
| `CRONS_DIR` | `~/.claude-bot/crons` |
| `PROCESSES_DIR` | `~/.claude-bot/processes` |
| `LOGS_DIR` | `~/.claude-bot/logs` |
| `LAST_FIRED_FILE` | `crons/.last-fired.json` |
| `RUNNING_FILE` | `crons/.running.json` |
| `TRIGGER_DIR` | `crons/.triggers` |
| `PROCESS_TRIGGER_DIR` | `processes/.triggers` |
| Process pid files | `processes/.pids/<name>.pid` (`PIDS_SUBDIR = ".pids"`, in `process.ts`) |
| Process logs | `logs/<name>.stdout.log`, `logs/<name>.stderr.log` (append) |

| Timing constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_CRON_TIMEOUT` | `300` (s) | default per-cron session timeout |
| `CRON_CHECK_INTERVAL_MS` | `60000` | scheduler tick |
| `TRIGGER_CHECK_INTERVAL_MS` | `5000` | both trigger polls (cron + process) |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | graceful shutdown budget |
| `SHUTDOWN_POLL_MS` | `500` | shutdown poll interval |
| `RESTART_BACKOFF_RESET_MS` | `300000` | uptime past which a process restart resets backoff |
| `RESTART_BACKOFF_MAX_MS` | `60000` | restart backoff ceiling |

---

## Crons (`daemon/cron.ts`)

### Model

```ts
CronJob {
  name, schedule, cron /* parsed CronExpression */, prompt /* = markdown body */,
  catchup, enabled, notify, model?, effort?, timeout /* s; 0 = no timeout */, waitFor?
}
```

### `parseCronFrontmatter`

A file with **no `schedule`** → `null` (skipped). An **invalid** schedule (`parseCronExpression` returns null) → `null`.

| frontmatter key | mapping | default |
| --- | --- | --- |
| `schedule` | required; parsed to `CronExpression` | (null if absent/invalid) |
| `name` | `frontmatter.name ?? filename-without-.md` | filename |
| (body) | `prompt` | — |
| `catchup` | `frontmatter.catchup !== "false"` | `true` (opt-out) |
| `enabled` | `frontmatter.enabled !== "false"` | `true` (opt-out) |
| `notify` | `frontmatter.notify === "true"` | `false` (opt-in) |
| `model` | passthrough | `undefined` (session defaults haiku) |
| `effort` | passthrough | `undefined` |
| `timeout` | `parseTimeoutSecs` | `300` |
| `waitFor` | passthrough — a `pgrep -f` pattern to wait on after the session ends | `undefined` |

`parseTimeoutSecs`: empty → `300`; `"none"` or `"0"` → `0` (explicit no-timeout); otherwise `parseInt` if finite and `> 0`, else `300`.

`loadCronJobs()`: `readdir CRONS_DIR`, keep only `*.md`, parse each, skip unreadable. Dotfiles (`.last-fired.json`, `.running.json`, etc.) and the `.triggers` dir are naturally excluded because they are not `*.md`.

### Schedule parsing — hand-rolled, no library

`parseCronExpression`: trim, split on whitespace, require **exactly 5 fields** or return null. Fields stored verbatim as strings: `minute hour dayOfMonth month dayOfWeek`.

`matchesField` supports:

| syntax | rule |
| --- | --- |
| `*` | always matches |
| `*/N` (step) | `value % N === 0`; if `N <= 0` or `NaN` it **never** matches — so `*/0` and `*/abc` never fire |
| `A-B` (range) | only if no comma and exactly 2 numeric parts; `value >= A && value <= B`. Backward range `5-2` matches nothing; malformed `1-2-3` → false |
| `A,B,C` (list) | if a comma is present; matches if any part's `parseInt` equals `value`. Trailing comma `"5,"` → only `5` |
| exact int | otherwise; non-numeric → false |

**Not supported:** names (`MON`/`JAN`), `@hourly`-style macros, or combined range+step (`1-10/2`).

`shouldFire(cron, now)`: ANDs all five fields using **local time** (`getMinutes` / `getHours` / `getDate` / `getMonth()+1` / `getDay()`); Sunday = 0.

### `.last-fired.json` — exact shape

```ts
LastFiredEntry { timestamp: string, result: "success" | "failed" | "unknown" | "killed" }
```

Object keyed by `job.name` (frontmatter name, fallback filename):

```json
{ "dream": { "timestamp": "2026-06-08T14:00:03.123Z", "result": "success" } }
```

`loadLastFired` **migrates legacy** data: a plain-string value becomes `{ timestamp: <string>, result: "success" }`. Missing/unreadable → `{}`. Written via `updateLastFired(name, entry)`: read-modify-write under a per-file serial queue (`enqueueWrite`) plus `atomicWriteJson` (temp `${file}.${pid}.${ts}.${rand}.tmp`, then rename, `JSON.stringify(..., null, 2)`).

### `.running.json` — exact shape

```ts
RunningEntry { startedAt: string /* ISO */ }
```

Object keyed by `job.name`:

```json
{ "dream": { "startedAt": "2026-06-08T14:00:00.500Z" } }
```

`markRunning(name)` sets the key; `markDone(name)` deletes it (same serial-queue + atomic-temp-rename). `loadRunning` → `{}` on missing. **No migration** (unlike last-fired).

### Enable / disable

`enabled` defaults true (`!== "false"`). Disabled jobs are skipped at:

- the scheduler tick (`if (!job.enabled || runningJobs.has(name)) continue`),
- catch-up on start (only enabled jobs are considered),
- recovery (only enabled jobs are re-fired; a disabled job recorded as running is cleaned up via `markDone`).

`updateCronJob` flips `enabled` by setting `frontmatter.enabled = String(enabled)` then rewriting the file with `buildCronFile`. There is **no live kill on disable** — a job already running keeps running; it just will not fire again.

### Firing — `fireJob(name)`

1. Create an `AbortController`; add `name` to the in-memory `runningJobs` Set and the `jobAbortControllers` Map.
2. `await markRunning(name)` — so `.running.json` is on disk before the caller proceeds.
3. Snapshot the job's own cron file and the **entire** `PROCESSES_DIR` (self-modification guards).
4. Start a **background, not-awaited** session. The prompt is `[Cron: ${name}] ${prompt}` + `CRON_RESULT_INSTRUCTION` (the model must print exactly `[CRON_RESULT:SUCCESS]` or `[CRON_RESULT:FAILURE]` as its last line) + `CRON_NOTIFY_INSTRUCTION` if `notify`.
5. `sendMessage(prompt, { model, effort, abortController, timeoutSecs: timeout, newSession: true })` — **each cron runs in a NEW session**, not the daemon's persistent one.
6. If `waitFor` is set: after the session ends, poll `pgrep -f <pattern>` every 5 s until the pattern is gone or the remaining time is exhausted (`remaining = timeout*1000 - elapsed`, or `MAX_SAFE_INTEGER` if `timeout === 0`).
7. `parseCronResult` finds the **last** marker in the output; if neither marker is present → `"unknown"`. Write the `LastFiredEntry` via `updateLastFired`.
8. If `notify`: parse the last `[NOTIFY: ...]` line and call `notify()`.
9. `catch`: if the signal aborted → result `"killed"`; otherwise `"failed"`.
10. `finally`: revert the job's own cron file if the session modified or deleted it; `restoreDir(PROCESSES_DIR)` reverting any process-def changes; delete the abort controller; `await markDone(name)`; remove `name` from `runningJobs`.

### Catch-up

`getIntervalMs(cron)` estimates the schedule's period from its shape. `shouldCatchUp(job, lastFired)`:

- `!catchup` → `false`.
- never fired → `true`.
- result `"killed"`/`"failed"` → catch up if `elapsed > retryCooldownMs(interval)`, where `retryCooldownMs = max(5min, floor(interval/12))` (daily ≈ 2 h, weekly ≈ 14 h, hourly → 5-min floor).
- result `"success"`/`"unknown"` → catch up if `elapsed > interval * 1.01`.

### Scheduler lifecycle

`startCronScheduler()` (idempotent):

1. An immediate IIFE heartbeats; **returns early if `!isOwner()`**.
2. Otherwise loads jobs + last-fired and **sequentially (awaited)** fires each enabled job where `shouldCatchUp && !running`.
3. Starts `triggerInterval = setInterval(processTriggers, 5000)`.
4. Starts `cronInterval = setInterval(tick, 60000)`. Each `tick` heartbeats; if `!isOwner()` it returns (still heartbeats — **a non-owner never fires**); otherwise per job it skips if `!enabled || runningJobs.has(name)`, else fires (**not awaited** on the tick) when `shouldFire(now) || shouldCatchUp(...)`.

`stopCronScheduler()` clears both intervals. `waitForRunningJobs(timeoutMs = 10000)` polls `runningJobs.size` every 500 ms and aborts all jobs on timeout.

### Recovery — `recoverInterruptedCrons()`

**Must run before `startCronScheduler`.** If `!isOwner()` it returns. Loads `.running.json`; for each still-recorded `name`: if the job exists, is enabled, and is not already running → `await fireJob` (re-fire); otherwise `markDone` (clean up the stale entry). Boot order matters — see [daemon.md](daemon.md).

### Run-now triggers

There are two paths because the **MCP server is a separate process from the daemon** and cannot fire a job directly:

- `requestCronRun(name)` (the `cron_run` MCP tool): validate the name, confirm the job exists, `mkdir -p TRIGGER_DIR`, and write `crons/.triggers/<name>` with content `new Date().toISOString()`. The content is unused — **presence is the signal**. Filename is the job name, **no `.md`**.
- `processTriggers()` (every 5 s in the daemon): `readdir TRIGGER_DIR`, filter dotfiles. If `!isOwner()` → **unlink ALL triggers without firing** (consume-but-idle). Otherwise per trigger: **UNLINK FIRST**, then skip if already running, skip if the job is unknown, else `await fireJob`. The trigger is consumed regardless.
- `runCronJob(name)`: in-daemon **direct** path (rejects if already running). `stopCronJob(name)`: abort the controller, record `"killed"`, eager `markDone`.

> **For Bismuth readers:** Bismuth's "run now" for a cron drops a trigger file the same way (see [../daemon/overview.md](../daemon/overview.md) and [../daemon/storage.md](../daemon/storage.md)). Cron enable/disable does **not** write a trigger — the daemon re-reads cron files each tick.

### Name validation & file ops

`CRON_NAME_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9_.\-]*$/`. `validateCronName`: non-empty, `<= 100` chars, regex match, plus a path-containment check that `<CRONS_DIR>/<name>.md` stays inside `CRONS_DIR`. Files are `<name>.md`.

`buildCronFile` emits frontmatter **only for non-defaults**: always `name`/`schedule`; `model`/`effort`/`waitFor` if set; `timeout` only if `!== 300`; `catchup: false` only if explicitly false; `notify: true` only if true; `enabled: false` only if disabled. `createCronJob` refuses to overwrite; `deleteCronJob` unlinks; `updateCronJob` re-parses + rewrites.

### The shipped default cron (`defaults/crons/dream.md`)

Exact frontmatter (4 keys):

```yaml
name: dream
schedule: 0 * * * *
timeout: 1800
catchup: true
```

That means: hourly at minute 0, 30-minute timeout, catch-up on, enabled (absent → true), `notify` false, `model`/`effort` undefined.

Its **body** is a memory-consolidation routine that walks `~/.claude-bot/memory/` file-by-file (deliberately defensive against a bloated / OOM graph): survey by size, triage oversized notes, process small `auto-*` notes (extract → remember → forget), targeted recall of `type:fact`/`preference`/`project` to merge duplicates and improve, delete stale isolated notes, add aggressive `[[backlinks]]`. The scope is **strict** — memory only; it must **not** touch crons/processes/daemon config/`CLAUDE.md`, must not act on recommendations inside notes, and must not call `dream_run` or broad recall (both can recurse / OOM). It ends with a one-line report:

```
bloat-deleted=N auto-processed=N merged=N improved=N stale-deleted=N final-size=XMB
```

So "dreaming" ships as this hourly cron. The `DEFAULT_DREAM_INTERVAL_MS` (6 h) timer in config is the alternate timer path — see [memory.md](memory.md) for the dream cycle's mechanics.

---

## Background Processes (`daemon/process.ts`)

### Model

```ts
ProcessDef {
  name, command, args: string[], cwd, env: Record<string,string>,
  restart: "always" | "on-failure" | "never", restartDelay: number /* ms */, enabled
}
```

### `parseProcessFrontmatter`

`command` is **required**; missing → `null` (def skipped). Process defs use **frontmatter only** — the body is never read.

| key | mapping | default |
| --- | --- | --- |
| `command` | required | (null if absent) |
| `name` | `frontmatter.name ?? filename` | filename |
| `args` | `parseArgs` (JSON array if it starts with `[`, else whitespace-split) | `[]` |
| `cwd` | `frontmatter.cwd ?? homedir()` | `~` |
| `env` | `parseEnv` (JSON object if it starts with `{`, else `{}`) | `{}` |
| `restart` | string | `"on-failure"` |
| `restartDelay` | `parseInt(... ?? "1000")` | `1000` (ms) |
| `enabled` | `frontmatter.enabled !== "false"` | `true` |

`loadProcessDefs` returns **all** defs, including disabled ones.

### Lifecycle / supervision

In-memory state: `Map<name, ManagedProcess { def, proc, restarts, lastStart, backoff, stopping, processesDir }>`.

`startProcesses()`: `registerDef` each; **auto-spawn only if `def.enabled && !wasRegistered`** (disabled defs are registered but not spawned; re-running won't relaunch live children).

`spawnProcess(mp)`:

1. Reap a stale pid-file orphan if alive, then remove the pid file; `scanPs()` + `matchOrphans` kill argv-matching orphans.
2. Open append logs; `nodeSpawn(command, args, { cwd, env: { ...process.env, ...def.env }, stdio: ["ignore", out, err], detached: true })` then `unref()`; write the pid file.
3. `on("exit")`: remove the pid file; if `stopping` return; clear `proc`. Restart decision: `restart === "always"` OR (`restart === "on-failure" && exitCode !== 0`) — a signal exit is treated as code 1. `backoff = restartDelay` if uptime `>= RESTART_BACKOFF_RESET_MS` (5 min), else `min(backoff * 2, RESTART_BACKOFF_MAX_MS)` (60 s). Re-spawn after `setTimeout(backoff)` unless `stopping`.

### PID tracking

There is **no `.running.json` for processes**. Liveness = the in-memory `mp.proc` + `isAlive(pid)` (via `kill(pid, 0)`) + the on-disk `.pids/<name>.pid`. The pid file is the **cross-daemon link**: a fresh daemon reads it to find children orphaned by the previous instance. `readPidFile` / `writePidFile` / `removePidFile` operate on `processes/.pids/<name>.pid` (a bare integer).

`scanPs()` runs `ps -ww -eo pid,command`. `reapOrphans()` runs on boot **before** `startProcesses` (pid-file pass, then ps argv-scan). `listProcesses()` → `{ processes: ProcessInfo[], orphans: OrphanInfo[] }`; a live `proc` whose pid is dead → status `"stale"`.

```ts
ProcessInfo { name, pid, running, enabled, restart, restarts, status: "running" | "stopped" | "stale" }
```

### Stop / enable / disable

- `startProcess(name)`: synchronous; errors if there is no def or it is already running.
- `stopProcess(name, timeoutMs = 3000)`: **async**. SIGTERM the process group, poll for exit, SIGKILL after the timeout (with a +2 s hard deadline), clear `proc`, remove the pid file. Returns only after the kernel confirms exit.
- `stopProcesses(timeoutMs = 3000)`: mark all `stopping`, SIGTERM groups, poll, SIGKILL survivors, final 2 s confirm, remove pid files, `managed.clear()`.
- `enableProcess(name)`: flip `enabled: true` on disk (preserving field order + body via `writeProcessFile`), register the def — does **not** spawn (the caller must `startProcess`).
- `disableProcess(name)`: register the def, `await stopProcess` if running (must await so the child dies), flip `enabled: false` on disk; keeps the entry in `managed` so `process_start` still works.

Both `enable`/`disable` are idempotent and persist across restart.

### Process trigger port — reconcile-to-disk

This is the symmetric counterpart of cron triggers but with **different semantics**: a cron trigger *fires a run*; a process trigger *reconciles runtime to the already-edited on-disk `enabled` flag*.

- `requestProcessRun(name)`: write `processes/.triggers/<name>` with ISO content (filename = the process file basename, no `.md`).
- `processProcessTriggers()` (every 5 s): `readdir`, filter dotfiles. If `!isOwner()` → unlink all without acting. Otherwise per trigger: **UNLINK FIRST**; reject names containing `/` or `\`; read `processes/<name>.md` fresh (skip if missing / no `command`); then reconcile:
  - `enabled && !running` → `enableProcess` + `startProcess`,
  - `!enabled && running` → `disableProcess`,
  - else no-op.
  The loop never throws out. `startProcessTriggers()` / `stopProcessTriggers()` manage a single idempotent `setInterval(5000)`.

> **For Bismuth readers:** Bismuth's process enable/disable writes **both** the `enabled` frontmatter **and** a reconcile trigger here (see [../daemon/overview.md](../daemon/overview.md) and [../daemon/storage.md](../daemon/storage.md)).

---

## Keying summary

- **Crons:** `.last-fired.json` + `.running.json` keyed by `job.name` (frontmatter `name ?? filename-without-.md`); trigger files named by the job name (no extension). Usually `name == filename`.
- **Processes:** pid files `.pids/<name>.pid` + trigger files `.triggers/<name>` keyed by the file basename; the trigger handler reads `<name>.md` and rejects path separators; the `managed` map is keyed by `def.name`.
- **Trigger consumption (both):** UNLINK-FIRST then act; dotfiles excluded; a non-owner consumes-without-acting.

## Cross-links

- [daemon.md](daemon.md) — boot / shutdown order and the persistent session.
- [memory.md](memory.md) — the dream cycle.
- [storage.md](storage.md) and [../daemon/storage.md](../daemon/storage.md) — on-disk file shapes.
- [../daemon/overview.md](../daemon/overview.md) — Bismuth's daemon controls.

Source: daemon/cron.ts, daemon/process.ts, lib/config.ts, lib/frontmatter.ts, defaults/crons/dream.md
