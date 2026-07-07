# Crons & Background Processes

The daemon runs two kinds of recurring work off the same on-disk pattern: **crons** (markdown files that fire a Claude session, either on a time schedule or when a watched vault file changes — see [File-change crons](#file-change-crons)) and **background processes** (markdown files that supervise a long-lived child process). Both are plain `.md` files under `<vault>/.daemon` — crons in `.daemon/crons`, processes in `.daemon/processes` — parsed by the same frontmatter reader, driven through the same UNLINK-FIRST trigger discipline, but with deliberately different runtime semantics (a cron trigger *fires a run*; a process trigger *reconciles runtime to disk*).

The big structural fact: there is **ONE machine runtime that multiplexes every enabled vault's brain**. The cron scheduler is a single tick loop that fans out across `loadEnabledVaults()` each tick; process supervision keeps one machine-global `managed` map. Every function takes a `VaultContext` (`loadCronJobs(ctx)`, `fireJob(ctx, job, lastFired)`, `requestCronRun(name, ctx)`, `processTriggers(ctx)`, `startProcess(name, ctx)`, …), and all paths come off that ctx (`ctx.cronsDir`, `ctx.processesDir`, `ctx.logsDir`, `ctx.lastFiredFile`, `ctx.runningFile`, `ctx.triggerDir`, `ctx.processTriggerDir` — all under `<vault>/.daemon`). In-memory runtime state is keyed `${ctx.root}::${name}` so two vaults can each own a cron or process of the same name without colliding.

Bismuth core reads and minimally writes these same files to power the "daemon" graph and `DaemonList` controls — see [overview.md](overview.md) and [storage.md](storage.md). Boot/shutdown order is in [lifecycle.md](lifecycle.md); the dream cycle's memory mechanics are in [memory.md](memory.md).

## Shared frontmatter parser (`lib/frontmatter.ts`)

Every cron and process file is parsed by `parseFrontmatter(content)`. It is **not** a YAML parser — understanding its quirks is a prerequisite for everything below.

- Fence regex: `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/`. No fence at the top of the file → `{ frontmatter: {}, body: content.trim() }`.
- Each frontmatter line is split on the **first `:` only** (`indexOf(":")`); lines without a colon are skipped.
- **Every value is a raw, trimmed string.** There is no type coercion — `enabled: false` parses to the string `"false"`, not the boolean `false`. This is why the code keys everything off the sentinels `!== "false"` (opt-out, default true) and `=== "true"` (opt-in, default false).
- `body` is everything after the closing `---` fence, trimmed. For crons the body is the prompt; for processes the body is unused.

The memory graph has its own typed parser — this one is cron/process-only.

## Filesystem layout (`lib/config.ts` → `vaultPaths(root, name)`)

Every path is **per-vault**, resolved from the vault root by `vaultPaths()` into the `VaultContext`. There is no machine-wide crons/processes dir.

| `VaultContext` field | Value |
| --- | --- |
| `ctx.daemonDir` | `<vault>/.daemon` |
| `ctx.cronsDir` | `<vault>/.daemon/crons` |
| `ctx.processesDir` | `<vault>/.daemon/processes` |
| `ctx.logsDir` | `<vault>/.daemon/logs` |
| `ctx.lastFiredFile` | `<vault>/.daemon/crons/.last-fired.json` |
| `ctx.runningFile` | `<vault>/.daemon/crons/.running.json` |
| `ctx.triggerDir` | `<vault>/.daemon/crons/.triggers` |
| `ctx.processTriggerDir` | `<vault>/.daemon/processes/.triggers` |
| Process pid files | `<vault>/.daemon/processes/.pids/<name>.pid` (`PIDS_SUBDIR = ".pids"`, in `process.ts`) |
| Process logs | `<vault>/.daemon/logs/<name>.stdout.log`, `<vault>/.daemon/logs/<name>.stderr.log` (append) |

Machine-level identity/runtime state (`daemon.pid`, `devices.json`, `owner.json`, logs, `vaults.json`) lives separately under `MACHINE_DIR` (`BISMUTH_DAEMON_DIR || ~/.bismuth/daemon`) — see [lifecycle.md](lifecycle.md) and [storage.md](storage.md).

| Timing constant (`lib/config.ts`) | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_CRON_TIMEOUT` | `300` (s) | default per-cron session timeout |
| `CRON_CHECK_INTERVAL_MS` | `60000` | scheduler tick (also the reconcile-loop tick) |
| `TRIGGER_CHECK_INTERVAL_MS` | `5000` | both trigger polls (cron + process) |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | graceful shutdown budget for running jobs |
| `SHUTDOWN_POLL_MS` | `500` | shutdown poll interval |
| `RESTART_BACKOFF_RESET_MS` | `300000` | uptime past which a process restart resets backoff |
| `RESTART_BACKOFF_MAX_MS` | `60000` | restart backoff ceiling |

(`DEFAULT_DREAM_INTERVAL_MS` = 6 h also exists in config but is not used by the cron path — dreaming ships as the hourly `dream` cron below.)

`FILE_WATCH_DEBOUNCE_MS` (`daemon/src/daemon/fileWatch.ts`, not `lib/config.ts`) = `2000` — how long the per-vault file watcher waits for quiet before flushing a batch of changed paths to file-change crons (see [File-change crons](#file-change-crons)).

---

## Crons (`daemon/cron.ts`)

### Model

`CronJob` is a discriminated union on `on` — a cron is EITHER schedule-triggered OR file-change-triggered, never both:

```ts
ScheduleCronJob {
  on: "schedule", name, schedule, cron /* parsed CronExpression */, prompt /* = markdown body */,
  catchup, enabled, notify, model?, effort?, timeout /* s; 0 = no timeout */, waitFor?
}
FileChangeCronJob {
  on: "file-change", name, watch /* vault-relative path or Bun.Glob pattern */, prompt,
  catchup: false /* always — see File-change crons below */, enabled, notify, model?, effort?,
  timeout, waitFor?
}
```

### `parseCronFrontmatter`

`on: file-change` is checked FIRST and is opt-in: any other value (including no `on` key at all) parses as the original schedule-based shape, so every cron already on disk is unaffected. A `file-change` cron with no `watch` → `null` (skipped). A schedule cron with **no `schedule`** → `null` (skipped); an **invalid** schedule (`parseCronExpression` returns null) → `null`.

| frontmatter key | mapping | default |
| --- | --- | --- |
| `on` | `"file-change"` selects the file-change shape; anything else (including absent) → schedule shape | `"schedule"` |
| `schedule` | schedule crons only; required, parsed to `CronExpression` | (null if absent/invalid) |
| `watch` | file-change crons only; required — a vault-relative path or Bun.Glob pattern | (null if absent) |
| `name` | `frontmatter.name ?? filename-without-.md` | filename |
| (body) | `prompt` | — |
| `catchup` | schedule crons: `frontmatter.catchup !== "false"`; file-change crons: always `false` (no time-based catch-up concept — see below) | `true` (opt-out, schedule only) |
| `enabled` | `frontmatter.enabled !== "false"` | `true` (opt-out) |
| `notify` | `frontmatter.notify === "true"` | `false` (opt-in) |
| `model` | passthrough | `undefined` (session defaults `haiku`) |
| `effort` | passthrough → `thinkingBudget` | `undefined` |
| `timeout` | `parseTimeoutSecs` | `300` |
| `waitFor` | passthrough — a `pgrep -f` pattern to wait on after the session ends | `undefined` |

`parseTimeoutSecs`: empty → `300`; `"none"` or `"0"` → `0` (explicit no-timeout); otherwise `parseInt` if finite and `> 0`, else `300`.

`loadCronJobs(ctx)`: `readdir ctx.cronsDir`, keep only `*.md`, parse each, skip unreadable. Dotfiles (`.last-fired.json`, `.running.json`) and the `.triggers` dir are naturally excluded because they are not `*.md`. Returns `[]` if the dir doesn't exist.

### File-change crons

A cron can fire when a vault file changes instead of on a time schedule — useful for "whenever I edit X, do Y" workflows (e.g. re-summarize a note, sync a change elsewhere, validate a file's shape).

**Authoring one** — set `on: file-change` and `watch: <vault-relative path or glob>` instead of `schedule`:

```yaml
---
name: inbox-triage
on: file-change
watch: inbox.md
notify: true
---

Read inbox.md (just changed). Triage any new items: file each under
the right project note, or ask a clarifying question by appending a
`> [!question]` callout directly below the item. Leave already-triaged
items untouched.
```

`watch` is matched with `Bun.Glob` against the vault-relative path of each changed file, so glob syntax works too: `journal/**` (anything under `journal/`), `*.md` (root-level notes only), `notes/*.md`, etc.

**Watcher architecture** — `daemon/src/daemon/fileWatch.ts` owns exactly ONE recursive `fs.watch(ctx.root)` per vault brain (started by `startVault`/stopped by `stopVault`, alongside the process-trigger loop), never one watcher per cron. Raw fs events are debounced per vault (`FILE_WATCH_DEBOUNCE_MS = 2000`) so a burst of rapid saves during an editing session collapses into ONE fire, not one per keystroke. When the debounce window closes, the batch of changed paths is matched against **every** enabled `file-change` cron's `watch` pattern in that vault (`loadCronJobs(ctx)` is re-read fresh each batch, so toggling `enabled` takes effect on the very next change — no restart, no trigger file needed). A cron with one or more matches in the batch fires via `fireFileChangeCron(ctx, job, matchedPaths)` — the exact same `fireJob` session/model/timeout/notify plumbing a scheduled fire uses, with the changed paths appended to the prompt: `\n\nTriggered by change to: <path1>, <path2>, …`. A cron that's already running when its watch matches is skipped, not queued — the next change after it finishes will fire it fresh.

**No time-based catch-up.** `shouldCatchUp` returns `false` immediately for `on: "file-change"` jobs — there is no "overdue" concept for a trigger that only fires on an actual change. A file edited while the daemon was stopped does not retroactively fire the cron; it fires on the *next* change after the daemon comes back up. `catchup` is hardcoded `false` on `FileChangeCronJob` for this reason (the frontmatter key does nothing for these).

**Self-trigger loop hazard.** `.daemon/**` churn (the daemon's own `.last-fired.json`/`.running.json`/logs/memory/session-state writes) is UNCONDITIONALLY excluded from every batch (`isDaemonInternalPath`) — the daemon's own bookkeeping can never retrigger a file-change cron. This does **not** protect against a cron whose prompt edits an ordinary vault file that matches its own `watch` pattern: that cron will refire itself on its own edit (subject only to the debounce window), forever. If you author a cron that both watches and writes vault files, either point `watch` at a different file than the one it edits, or make the edit idempotent (a second identical write is a harmless no-op) so a self-retrigger costs a wasted run rather than compounding.

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

`loadLastFired(ctx)` **migrates legacy** data: a plain-string value becomes `{ timestamp: <string>, result: "success" }`. Missing/unreadable → `{}`. Written via `updateLastFired(ctx, name, entry)`: read-modify-write under a per-file serial queue (`enqueueWrite`, keyed by absolute file path — already vault-unique) plus `atomicWriteJson` (temp `${file}.${pid}.${ts}.${rand}.tmp`, then rename, `JSON.stringify(..., null, 2)`).

### `.running.json` — exact shape

```ts
RunningEntry { startedAt: string /* ISO */ }
```

Object keyed by `job.name`:

```json
{ "dream": { "startedAt": "2026-06-08T14:00:00.500Z" } }
```

`markRunning(ctx, name)` sets the key; `markDone(ctx, name)` deletes it (same serial-queue + atomic-temp-rename). `loadRunning(ctx)` → `{}` on missing. **No migration** (unlike last-fired).

### Per-vault state keys

In-memory runtime state — the `runningJobs` Set and the `jobAbortControllers` Map — is keyed `jobKey(ctx, name) = ${ctx.root}::${name}`. On-disk write queues stay keyed by absolute file path (each vault's last-fired/running file lives under its own `.daemon`, so the path is already vault-unique).

### Enable / disable

`enabled` defaults true (`!== "false"`). Disabled jobs are skipped at:

- the scheduler tick (`if (!job.enabled || runningJobs.has(jobKey(ctx, name))) continue`) — schedule crons only; the tick also skips every `on: "file-change"` job outright (they never fire off the tick),
- the file watcher's per-batch fan-out (`fileWatch.ts`'s `flush` skips any `job.on !== "file-change" || !job.enabled`) — since `loadCronJobs(ctx)` is re-read fresh on every debounced batch, a file-change cron's enable/disable takes effect on the very next matching change, faster than a schedule cron's next-tick-or-so window,
- catch-up on start (only enabled jobs are considered; file-change jobs never catch up regardless — see above),
- recovery (only enabled jobs are re-fired; a disabled job recorded as running is cleaned up via `markDone`).

`updateCronJob(name, updates, ctx)` flips `enabled` by setting `frontmatter.enabled = String(enabled)` then rewriting the file with `buildCronFile`. There is **no live kill on disable** — a job already running keeps running; it just will not fire again.

### Firing — `fireJob(ctx, job, lastFired)`

1. Compute `key = jobKey(ctx, job.name)`; create an `AbortController`; add `key` to the in-memory `runningJobs` Set and the `jobAbortControllers` Map.
2. `await markRunning(ctx, job.name)` — so `.running.json` is on disk before the caller proceeds.
3. Snapshot the job's **own** cron file (`<ctx.cronsDir>/<name>.md`) and the **entire** `ctx.processesDir` (self-modification guards — see below).
4. Start a **background, not-awaited** session. The prompt is `[Cron: ${name}] ${prompt}` + (for a file-change fire only) `\n\nTriggered by change to: <path1>, <path2>, …` + `CRON_RESULT_INSTRUCTION` (the model must print exactly `[CRON_RESULT:SUCCESS]` or `[CRON_RESULT:FAILURE]` as its last line) + `CRON_NOTIFY_INSTRUCTION` if `notify`.
5. `sendMessage(prompt, ctx, { model, effort, abortController, timeoutSecs: timeout, newSession: true })` — **each cron runs in a NEW session**, not the vault's persistent one. `sendMessage` supplies the per-call `cwd` = `ctx.root`, `env.BISMUTH_MEMORY_DIR` = `ctx.memoryDir`, and the vault's daemon identity, so concurrent vault sessions never race.
6. If `waitFor` is set: after the session ends, poll `pgrep -f <pattern>` every 5 s until the pattern is gone or the remaining time is exhausted (`remaining = timeout*1000 - elapsed`, or `MAX_SAFE_INTEGER` if `timeout === 0`).
7. `parseCronResult` finds the **last** marker in the output; if neither marker is present → `"unknown"`. Write the `LastFiredEntry` via `updateLastFired`.
8. If `notify`: parse the last `[NOTIFY: ...]` line and call `notify("${ctx.name}: ${name}", msg)`.
9. `catch`: if the signal aborted → result `"killed"` (re-stamped with a fresh timestamp even on consecutive kills, so catch-up arithmetic isn't stuck on a stale time); otherwise `"failed"`.
10. `finally`: revert the job's own cron file if the session modified or deleted it; `restoreDir(ctx.processesDir, …)` reverting any process-def changes; delete the abort controller; `await markDone(ctx, name)`; remove `key` from `runningJobs`.

> **Self-modification guard:** only the running cron's OWN definition file is reverted — sibling crons and external edits are left alone (an earlier whole-directory snapshot wrongly reverted legitimate concurrent edits). Process definitions are still broadly guarded via `restoreDir` (rarely edited externally): modified files are restored, deleted files re-created, and any `.md` the session newly created is removed.

### Catch-up

`getIntervalMs(cron)` estimates the schedule's period from its shape. `shouldCatchUp(job, lastFired)`:

- `job.on === "file-change"` → `false`, always (checked first — file-change crons have no schedule to be overdue against; see [File-change crons](#file-change-crons)).
- `!catchup` → `false`.
- never fired → `true`.
- result `"killed"`/`"failed"` → catch up if `elapsed > retryCooldownMs(interval)`, where `retryCooldownMs = max(5min, floor(interval/12))` (daily ≈ 2 h, weekly ≈ 14 h, hourly → 5-min floor).
- result `"success"`/`"unknown"` → catch up if `elapsed > interval * 1.01` (tight multiplier so a daily cron fires on wake from sleep rather than waiting hours).

### Scheduler lifecycle — the multiplex

`startCronScheduler()` is **idempotent** (process-global, started once on boot — NOT per vault):

1. An immediate IIFE heartbeats the device; **returns early if `!isOwner()`**. Otherwise it iterates `loadEnabledVaults()` and, per vault, loads jobs + last-fired and **sequentially (awaited)** fires each enabled job where `shouldCatchUp && !running`.
2. Starts `triggerInterval = setInterval(processAllTriggers, 5000)` — which loops every enabled vault and calls `processTriggers(ctx)`.
3. Starts `cronInterval = setInterval(tick, 60000)`. Each `tick` heartbeats; if `!isOwner()` it returns (still heartbeats — **a non-owner never fires**); otherwise it fans out across `loadEnabledVaults()`, and per job skips if `!enabled || runningJobs.has(jobKey(ctx, name))` **or `on === "file-change"`** (file-change crons never fire off this tick — see below), else fires (**not awaited** on the tick) when `shouldFire(now) || shouldCatchUp(...)`.
4. Independently, `fileWatch.ts`'s per-vault `fs.watch` (started/stopped alongside each vault's brain, not by `startCronScheduler`) fires `file-change` crons directly on a debounced batch match — see [File-change crons](#file-change-crons).

`stopCronScheduler()` clears both intervals. `waitForRunningJobs(timeoutMs = 10000)` polls `runningJobs.size` every 500 ms and aborts every job's controller on timeout (used during graceful shutdown — see [lifecycle.md](lifecycle.md)).

### Recovery — `recoverInterruptedCrons(ctx)`

Per vault, **must run before that vault's brain starts ticking under the scheduler** (it's called from `startVault` on boot only). If `!isOwner()` it returns. Loads `ctx.runningFile`; for each still-recorded `name`: if the job exists, is enabled, and is not already in `runningJobs` → `await fireJob` (re-fire); otherwise `markDone` (clean up the stale entry). Boot order matters — see [lifecycle.md](lifecycle.md).

### Run-now triggers

There are two paths because the **MCP server is a separate process from the daemon** and cannot fire a job directly:

- `requestCronRun(name, ctx)` (the `cron_run` MCP tool / Bismuth "run now"): validate the name, confirm the job exists, `mkdir -p ctx.triggerDir`, and write `<ctx.triggerDir>/<name>` with content `new Date().toISOString()`. The content is unused — **presence is the signal**. Filename is the job name, **no `.md`**.
- `processTriggers(ctx)` (driven every 5 s by `processAllTriggers` over every enabled vault): `readdir ctx.triggerDir`, filter dotfiles. If `!isOwner()` → **unlink ALL triggers without firing** (consume-but-idle). Otherwise per trigger: **UNLINK FIRST**, then skip if already running, skip if the job is unknown, else `await fireJob`. The trigger is consumed regardless.
- `runCronJob(name, ctx)`: in-daemon **direct** path (rejects if already running). `stopCronJob(name, ctx)`: abort the controller, record `"killed"`, eager `markDone`.

> **For Bismuth readers:** Bismuth's "run now" for a cron drops a trigger file the same way (see [overview.md](overview.md) and [storage.md](storage.md)). Cron enable/disable does **not** write a trigger — the scheduler re-reads cron files each tick.

### Name validation & file ops

`CRON_NAME_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9_.\-]*$/`. `validateCronName(name, ctx)`: non-empty, `<= 100` chars, regex match, plus a path-containment check that `<ctx.cronsDir>/<name>.md` stays inside `ctx.cronsDir`. Files are `<name>.md`.

`buildCronFile` emits frontmatter **only for non-defaults**: always `name`; either `on: file-change` + `watch` (if `on === "file-change"`) OR `schedule` (otherwise); `model`/`effort`/`waitFor` if set; `timeout` only if `!== 300`; `catchup: false` only if explicitly false; `notify: true` only if true; `enabled: false` only if disabled. `createCronJob(opts, ctx)` refuses to overwrite and validates the `on`-appropriate required field (`watch` for file-change, a parseable `schedule` otherwise); `deleteCronJob(name, ctx)` unlinks; `updateCronJob(name, updates, ctx)` re-parses + rewrites (accepts `on`/`watch` updates too, and re-validates the same way before writing).

### The two shipped default crons (`daemon/defaultCrons.ts`)

The defaults are **embedded string constants** (not files), so they survive `bun build --compile` into the daemon binary, and are seeded non-clobbering by `reconcileSeeds` (see below). Both are adapted for Bismuth's per-vault model: memory is `$BISMUTH_MEMORY_DIR` (= `<vault>/.daemon/memory`, injected by the daemon), the vault is the working directory, and the memory tools are Bismuth's `recall`/`remember`/`forget` (there is **no** `dream_run` tool).

**`dream`** — hourly memory consolidation. Frontmatter:

```yaml
name: dream
schedule: 0 * * * *
timeout: 1800
catchup: true
```

Hourly at minute 0, 30-minute timeout, catch-up on, enabled, `notify` false. Its **body** consolidates this vault's memory graph at `$BISMUTH_MEMORY_DIR` into an atomic, densely-linked zettelkasten, walking the directory file-by-file via Bash (deliberately defensive against a bloated / OOM graph — it must **not** call `recall` with empty/broad queries). It first scopes to what changed since the last run by wrapping the pass in checkpoints:

```bash
bismuth checkpoint diff dream --dir "$BISMUTH_MEMORY_DIR"   # Step 0: only the changed notes (snapshots first)
# … survey by size, triage >100 KB notes, process auto-* notes, targeted recall to merge dupes, delete stale isolated notes …
bismuth checkpoint advance dream --dir "$BISMUTH_MEMORY_DIR" # Step 6 (LAST): record how far it got
```

The scope is **strict** — memory only; it must not touch `.daemon/crons/`, `.daemon/processes/`, daemon config, `identity.md`, or the vault's notes, must not act on recommendations inside notes, and must not read any single file >50 KB with the Read tool. It ends with a one-line report:

```
bloat-deleted=N auto-processed=N merged=N improved=N stale-deleted=N final-size=XMB
```

**`vault-review`** — every-4-hours pass over the vault to keep a living model of the user in memory. Frontmatter:

```yaml
name: vault-review
schedule: 0 */4 * * *
timeout: 900
catchup: true
notify: true
```

Its body reviews the vault (its working directory) — journal/daily notes, tasks, reading, the user's own essays vs quoted material, projects, school/work — and `remember`s a consolidated model of the user (checking `recall` first to update rather than duplicate). It scopes to what changed with `bismuth checkpoint diff vault-review --dir . --no-commit` (`--no-commit` diffs the vault's existing git history without writing to it) and ends with `bismuth checkpoint advance vault-review --dir . --no-commit`.

`DEFAULT_CRONS` (the `{ name, content }[]` array) is what `seedsFor` maps into `<vault>/.daemon/crons`.

### Seeding (`daemon/seeds.ts` → `reconcileSeeds(ctx)`)

`reconcileSeeds(ctx)` is the daemon's declarative analog of core's `reconcileSettings`. It runs every time a vault's brain comes online (boot or runtime-enable, via `ensureVaultDirs`) and writes only what's **MISSING** — `existsSync(seed.path)` → skip. `seedsFor(ctx)` returns the full set: the editable `identity.md` (`---\nname: daemon\n---` + the default personality body) and one seed per entry in `DEFAULT_CRONS` (written to `<ctx.cronsDir>/<name>.md`). So a fresh vault gets the full set; an already-set-up vault that predates a newly-added default gets just that new piece on next boot; existing files (including a user's `enabled: false` edits) are never clobbered. To add a future seedable, append one entry to `seedsFor()`.

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

`loadProcessDefs(ctx)` returns **all** defs, including disabled ones.

### Per-vault state keys

The `managed` map and the per-vault trigger intervals are keyed `procKey(ctx, name) = ${ctx.root}::${name}`, so two vaults can each run a process with the same name without colliding. Each `ManagedProcess` also remembers its own `ctx`, so the exit-handler restart path and stop/list passes can locate the right `.pids/<name>.pid` + log dir and filter by vault.

### Lifecycle / supervision

In-memory state: machine-global `Map<procKey, ManagedProcess { def, proc, restarts, lastStart, backoff, stopping, ctx }>`.

`startProcesses(ctx)`: `registerDef` each def; **auto-spawn only if `def.enabled && !wasRegistered`** (disabled defs are registered but not spawned; re-running won't relaunch live children).

`spawnProcess(mp)`:

1. Reap a stale pid-file orphan for this vault if alive, then remove the pid file; `scanPs()` + `matchOrphans` kill argv-matching orphans — **but never a pid in `managedPids()`** (another vault's legitimate child sharing the same argv must not be reaped, since `ps` shows argv only, not cwd).
2. Open append logs under `ctx.logsDir`; `nodeSpawn(command, args, { cwd, env: { ...process.env, ...def.env }, stdio: ["ignore", out, err], detached: true })` then `unref()`; write `<ctx.processesDir>/.pids/<name>.pid`.
3. `on("exit")`: remove the pid file; if `stopping` return; clear `proc`. Restart decision: `restart === "always"` OR (`restart === "on-failure" && exitCode !== 0`) — a signal exit is treated as code 1. `backoff = restartDelay` if uptime `>= RESTART_BACKOFF_RESET_MS` (5 min), else `min(backoff * 2, RESTART_BACKOFF_MAX_MS)` (60 s). Re-spawn after `setTimeout(backoff)` unless `stopping`.

### PID tracking

There is **no `.running.json` for processes**. Liveness = the in-memory `mp.proc` + `isAlive(pid)` (via `kill(pid, 0)`) + the on-disk `.pids/<name>.pid`. The pid file is the **cross-daemon link**: a fresh daemon reads it to find children orphaned by the previous instance. `readPidFile` / `writePidFile` / `removePidFile` operate on `<ctx.processesDir>/.pids/<name>.pid` (a bare integer).

`scanPs()` runs `ps -ww -eo pid,command`. `reapOrphans(ctx)` runs on boot **before** `startProcesses` for that vault (pid-file pass, then ps argv-scan); it is **boot-only**, never at runtime-enable — a cross-vault reap could kill a sibling vault's identical-argv process. `listProcesses(ctx)` → `{ processes: ProcessInfo[], orphans: OrphanInfo[] }` filtered to that vault; a live `proc` whose pid is dead → status `"stale"` (and the stale ref is cleared on observe).

```ts
ProcessInfo { name, pid, running, enabled, restart, restarts, status: "running" | "stopped" | "stale" }
```

### Stop / enable / disable

- `startProcess(name, ctx)`: synchronous; errors if there is no def or it is already running.
- `stopProcess(name, ctx, timeoutMs = 3000)`: **async**. SIGTERM the process group, poll for exit, SIGKILL after the timeout (with a +2 s hard deadline), clear `proc`, remove the pid file. Returns only after the kernel confirms exit.
- `stopProcesses(timeoutMs = 3000)`: stop **every** managed child across **all** vaults (full daemon shutdown) — mark all `stopping`, SIGTERM groups, poll, SIGKILL survivors, final 2 s confirm, remove pid files, `managed.clear()` (shared `stopAndClear` helper).
- `stopProcessesForVault(ctx, timeoutMs = 3000)`: same, but only entries whose `mp.ctx.root === ctx.root` — used when one vault's daemon is disabled at runtime. NEVER deletes on-disk state.
- `enableProcess(name, ctx)`: flip `enabled: true` on disk (preserving field order + body via `writeProcessFile`), register the def — does **not** spawn (the caller must `startProcess`).
- `disableProcess(name, ctx)`: register the def, set `stopping`, `await stopProcess` if running (must await so the child dies), flip `enabled: false` on disk; keeps the entry in `managed` so `process_start` still works.

Both `enable`/`disable` are idempotent and persist across restart. `stopAndClear` marks every entry `stopping` first — including ones mid restart-backoff — so a crash-looping process can't re-spawn as an untracked orphan after being deleted from `managed`.

### Process trigger port — reconcile-to-disk

This is the symmetric counterpart of cron triggers but with **different semantics**: a cron trigger *fires a run*; a process trigger *reconciles runtime to the already-edited on-disk `enabled` flag*.

- `requestProcessRun(name, ctx)`: validate the def exists, then write `<ctx.processTriggerDir>/<name>` with ISO content (filename = the process file basename, no `.md`).
- `processProcessTriggers(ctx)` (every 5 s per vault, via a per-vault interval): `readdir ctx.processTriggerDir`, filter dotfiles. If `!isOwner()` → unlink all without acting. Otherwise per trigger: **UNLINK FIRST**; reject names containing `/` or `\`; read `<ctx.processesDir>/<name>.md` fresh (skip if missing / no `command`); then reconcile:
  - `enabled && !running` → `enableProcess` + `startProcess`,
  - `!enabled && running` → `disableProcess`,
  - else no-op.
  The loop never throws out. `startProcessTriggers(ctx)` starts one idempotent `setInterval(5000)` per vault (keyed by `ctx.root`); `stopProcessTriggers()` clears all of them; `stopProcessTriggersForVault(ctx)` clears just one (e.g. that vault was disabled).

> **For Bismuth readers:** Bismuth's process enable/disable writes **both** the `enabled` frontmatter **and** a reconcile trigger here (see [overview.md](overview.md) and [storage.md](storage.md)).

---

## Keying summary

- **Multiplex:** ONE machine runtime iterates `loadEnabledVaults()`; the cron scheduler is process-global, process supervision is one machine-global `managed` map, and the file watcher is ONE per vault (`fileWatch.ts`'s `watchers` map, keyed `ctx.root`).
- **Crons:** `.last-fired.json` + `.running.json` keyed by `job.name` (frontmatter `name ?? filename-without-.md`); trigger files named by the job name (no extension). In-memory `runningJobs`/`jobAbortControllers` keyed `${ctx.root}::${name}`. Usually `name == filename`.
- **Processes:** pid files `.pids/<name>.pid` + trigger files `.triggers/<name>` keyed by the file basename; the trigger handler reads `<name>.md` and rejects path separators; the `managed` map + per-vault trigger intervals are keyed `${ctx.root}::${name}`.
- **Trigger consumption (both):** UNLINK-FIRST then act; dotfiles excluded; a non-owner consumes-without-acting.
- **File-change crons:** no trigger file, no dedicated in-memory key — matched fresh out of `loadCronJobs(ctx)` against each debounced batch from that vault's ONE `fileWatch.ts` watcher; still gated by the same `runningJobs` set as every other cron (keyed `${ctx.root}::${name}`), so a file-change cron and a schedule cron can never share a name and both be "running" independently.

## Cross-links

- [overview.md](overview.md) — the daemon model + Bismuth's daemon controls.
- [lifecycle.md](lifecycle.md) — boot / shutdown order, the reconcile loop, ownership.
- [storage.md](storage.md) — on-disk file shapes under `<vault>/.daemon` and `MACHINE_DIR`.
- [pages.md](pages.md) — the daemon inbox: reuses this same trigger-file port for one-shot approved actions instead of a recurring job.
- [memory.md](memory.md) — the dream cycle's memory mechanics + the 3rd-brain graph.
- [communication.md](communication.md) — sessions, identity, and the MCP/relay surface.
- [../README.md](../README.md) — the docs root.

Source: daemon/src/daemon/cron.ts, daemon/src/daemon/fileWatch.ts, daemon/src/daemon/process.ts, daemon/src/daemon/defaultCrons.ts, daemon/src/daemon/seeds.ts, daemon/src/daemon/session.ts, daemon/src/daemon/index.ts, daemon/src/lib/config.ts, daemon/src/lib/registry.ts, daemon/src/lib/frontmatter.ts
